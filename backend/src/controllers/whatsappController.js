const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const pushNotificationService = require('../services/pushNotificationService');

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// WhatsApp API configuration
const WHATSAPP_API_URL = 'https://graph.facebook.com/v19.0';
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;

// Check if we're in development mode (no WhatsApp credentials)
const isDevelopmentMode = !PHONE_NUMBER_ID || !ACCESS_TOKEN;

// Debug environment variables
console.log('WhatsApp Environment Check:');
console.log('PHONE_NUMBER_ID:', PHONE_NUMBER_ID ? 'SET' : 'NOT SET');
console.log('ACCESS_TOKEN:', ACCESS_TOKEN ? 'SET' : 'NOT SET');
console.log('isDevelopmentMode:', isDevelopmentMode);

// In-memory cache to track which message IDs have already sent notifications
// This prevents duplicate notifications in race conditions
const notificationSentCache = new Set();
const NOTIFICATION_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Helper to check and mark notification as sent
const markNotificationSent = (messageId) => {
  if (!messageId) return false;
  const key = `whatsapp_${messageId}`;
  if (notificationSentCache.has(key)) {
    return true; // Already sent
  }
  notificationSentCache.add(key);
  // Auto-cleanup after TTL to prevent memory leaks
  setTimeout(() => {
    notificationSentCache.delete(key);
  }, NOTIFICATION_CACHE_TTL);
  return false; // Not sent yet
};

// Helper utilities
const normalizePhone = (phone) => {
  if (!phone || phone === null || phone === '') return '';
  return phone.replace(/\D/g, '');
};

const parseAdditionalPhones = (value) => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.filter(Boolean);
    }
    if (typeof parsed === 'string') {
      return parsed.split(/[,;|\s]+/).map(item => item.trim()).filter(Boolean);
    }
  } catch (error) {
    // Not JSON, fall back to string parsing
  }
  return value.split(/[,;|\s]+/).map(item => item.trim()).filter(Boolean);
};

const buildWhatsappNotificationPreview = (messageData, senderName, phoneNumber, messageType) => {
  const displayName = senderName || phoneNumber || 'Unknown contact';
  const prefix = `${displayName}: `;

  if (messageData.voice_note || messageType === 'audio' || messageType === 'voice') {
    return `${prefix}Sent a voice message`;
  }

  if (messageType === 'image' || messageType === 'video') {
    if (messageData.caption && messageData.caption.trim()) {
      return `${prefix}${messageData.caption.trim().substring(0, 80)}`;
    }
    return `${prefix}Sent a ${messageType} message`;
  }

  if (messageData.message && messageData.message.trim()) {
    return `${prefix}${messageData.message.trim().substring(0, 80)}`;
  }

  if (messageData.caption && messageData.caption.trim()) {
    return `${prefix}${messageData.caption.trim().substring(0, 80)}`;
  }

  return `${prefix}Sent a ${messageType || 'message'}`;
};

/**
 * Find user IDs (UUIDs) who have roles assigned to a lead
 * Uses users.employee_id → tenants_employee.id relationship
 * @param {Object} lead - The lead object (new lead)
 * @param {Object} legacyLead - The legacy lead object
 * @returns {Promise<string[]>} Array of user UUIDs from users table
 */
const findUsersWithRolesForLead = async (lead, legacyLead) => {
  const employeeIds = new Set();

  try {
    if (lead) {
      // For new leads: roles are stored differently:
      // - scheduler, closer, handler: stored as display names (text fields)
      // - manager, expert, helper: stored as employee IDs (numeric fields: meeting_manager_id, expert_id, meeting_lawyer_id)
      
      // Check text role fields (scheduler, closer, handler)
      const textRoleFields = ['scheduler', 'closer', 'handler'];
      const textRoleValues = textRoleFields
        .map(field => lead[field])
        .filter(value => value && value !== '---' && value !== null && value !== '');

      if (textRoleValues.length > 0) {
        // Find employees with matching display names
        const { data: employees, error: empError } = await supabase
          .from('tenants_employee')
          .select('id, display_name')
          .in('display_name', textRoleValues);

        if (!empError && employees) {
          employees.forEach(emp => {
            if (emp.id) {
              employeeIds.add(emp.id);
            }
          });
        }
      }

      // Check numeric role fields (manager, expert, helper)
      const numericRoleFields = [
        'meeting_manager_id',  // manager
        'expert_id',            // expert
        'meeting_lawyer_id',    // helper
        'case_handler_id'       // handler (also has numeric field)
      ];
      const numericRoleIds = numericRoleFields
        .map(field => lead[field])
        .filter(id => id !== null && id !== undefined && id !== '');

      if (numericRoleIds.length > 0) {
        // Add employee IDs directly from numeric fields
        numericRoleIds.forEach(id => employeeIds.add(id));
      }
    } else if (legacyLead) {
      // For legacy leads: roles are stored as employee IDs (bigint) in leads_lead table
      const roleFields = [
        'meeting_scheduler_id',
        'meeting_manager_id',
        'meeting_lawyer_id',
        'expert_id',
        'closer_id',
        'case_handler_id'
      ];
      const roleIds = roleFields
        .map(field => legacyLead[field])
        .filter(id => id !== null && id !== undefined && id !== '');

      if (roleIds.length > 0) {
        // Add employee IDs directly
        roleIds.forEach(id => employeeIds.add(id));
      }
    }

    // Now find users where employee_id matches the employee IDs we found
    // users.employee_id → tenants_employee.id
    const userIds = new Set();
    
    if (employeeIds.size > 0) {
      const employeeIdsArray = Array.from(employeeIds);
      const { data: users, error: usersError } = await supabase
        .from('users')
        .select('id, employee_id')
        .in('employee_id', employeeIdsArray);

      if (!usersError && users) {
        users.forEach(user => {
          if (user.id) {
            userIds.add(user.id); // user.id is the UUID from users table
          }
        });
      } else if (usersError) {
        console.error('Error fetching users by employee_id:', usersError);
      }
    }

    return Array.from(userIds);
  } catch (error) {
    console.error('Error finding users with roles for lead:', error);
    return [];
  }
};

const pickPreferredLeadLink = (links = []) => {
  if (!links || links.length === 0) return null;
  return [...links].sort((a, b) => {
    const mainScore = (link) => {
      if (link.main === true || link.main === 'true' || link.main === 't' || link.main === '1') {
        return 0;
      }
      return 1;
    };
    const typeScore = (link) => (link.newlead_id ? 0 : 1);
    const aMain = mainScore(a);
    const bMain = mainScore(b);
    if (aMain !== bMain) return aMain - bMain;
    const aType = typeScore(a);
    const bType = typeScore(b);
    if (aType !== bType) return aType - bType;
    return 0;
  })[0];
};

const findLeadAndContactByPhone = async (phoneNumber, incomingVariations, incomingNormalized) => {
  try {
    const normalizedSet = new Set(
      incomingVariations
        .map(normalizePhone)
        .filter(Boolean)
    );
    if (incomingNormalized) {
      normalizedSet.add(incomingNormalized);
    }

    const rawSearchValues = Array.from(new Set(
      incomingVariations
        .concat([phoneNumber])
        .filter(Boolean)
    ));

    const contactSelectColumns = `
      id,
      name,
      phone,
      mobile,
      additional_phones,
      newlead_id,
      lead_leadcontact (
        lead_id,
        newlead_id,
        main
      )
    `;

    const contactCandidatesMap = new Map();
    const addContacts = (rows) => {
      (rows || []).forEach(row => {
        if (!contactCandidatesMap.has(row.id)) {
          contactCandidatesMap.set(row.id, row);
        }
      });
    };

    if (rawSearchValues.length > 0) {
      const { data: phoneMatches } = await supabase
        .from('leads_contact')
        .select(contactSelectColumns)
        .in('phone', rawSearchValues);
      if (phoneMatches) addContacts(phoneMatches);

      const { data: mobileMatches } = await supabase
        .from('leads_contact')
        .select(contactSelectColumns)
        .in('mobile', rawSearchValues);
      if (mobileMatches) addContacts(mobileMatches);
    }

    if (!contactCandidatesMap.size && incomingNormalized) {
      const suffix = incomingNormalized.slice(-7);
      if (suffix.length >= 4) {
        const { data: partialMatches } = await supabase
          .from('leads_contact')
          .select(contactSelectColumns)
          .or(`phone.ilike.%${suffix}%,mobile.ilike.%${suffix}%,additional_phones.ilike.%${suffix}%`);
        if (partialMatches) addContacts(partialMatches);
      }
    }

    const candidates = Array.from(contactCandidatesMap.values());
    for (const contact of candidates) {
      const contactPhones = [
        contact.phone,
        contact.mobile,
        ...parseAdditionalPhones(contact.additional_phones || '')
      ].filter(Boolean);

      const contactNormalizedPhones = contactPhones
        .map(normalizePhone)
        .filter(Boolean);

      const hasMatch = contactNormalizedPhones.some(number => normalizedSet.has(number));
      if (!hasMatch) continue;

      const preferredLink = pickPreferredLeadLink(contact.lead_leadcontact || []);
      let leadData = null;
      let leadType = null;

      if (preferredLink && preferredLink.newlead_id) {
        const { data: newLead } = await supabase
          .from('leads')
          .select('id, name, lead_number, phone, mobile, scheduler, closer, handler, meeting_manager_id, expert_id, meeting_lawyer_id, case_handler_id')
          .eq('id', preferredLink.newlead_id)
          .maybeSingle();
        if (newLead) {
          leadData = newLead;
          leadType = 'new';
        }
      }

      if (!leadData && preferredLink && preferredLink.lead_id) {
        const { data: legacyLead } = await supabase
          .from('leads_lead')
          .select('id, name, meeting_scheduler_id, meeting_manager_id, meeting_lawyer_id, expert_id, closer_id, case_handler_id')
          .eq('id', preferredLink.lead_id)
          .maybeSingle();
        if (legacyLead) {
          leadData = legacyLead;
          leadType = 'legacy';
        }
      }

      if (!leadData && contact.newlead_id) {
        const { data: fallbackLead } = await supabase
          .from('leads')
          .select('id, name, lead_number, phone, mobile, scheduler, closer, handler, meeting_manager_id, expert_id, meeting_lawyer_id, case_handler_id')
          .eq('id', contact.newlead_id)
          .maybeSingle();
        if (fallbackLead) {
          leadData = fallbackLead;
          leadType = 'new';
        }
      }

      return {
        contact,
        contactId: contact.id,
        leadData,
        leadType
      };
    }

    return null;
  } catch (error) {
    console.error('❌ Error matching contact by phone:', error);
    return null;
  }
};

// WhatsApp Controller initialized

// Verify webhook endpoint
const verifyWebhook = async (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verified successfully');
    res.status(200).send(challenge);
  } else {
    console.log('Webhook verification failed');
    res.sendStatus(403);
  }
};

// Handle incoming webhook messages
const handleWebhook = async (req, res) => {
  try {
    const body = req.body;
    
    // Log webhook structure for debugging
    console.log('🔍 Webhook received:', {
      object: body.object,
      hasEntry: !!body.entry,
      entryLength: body.entry?.length
    });
    
    if (body.object === 'whatsapp_business_account') {
      const entry = body.entry[0];
      const changes = entry.changes[0];
      const value = changes.value;
      
      // Log webhook value structure
      console.log('🔍 Webhook value structure:', {
        hasMessages: !!value.messages,
        messagesLength: value.messages?.length,
        hasContacts: !!value.contacts,
        contactsLength: value.contacts?.length,
        hasStatuses: !!value.statuses,
        statusesLength: value.statuses?.length
      });
      
      if (value.messages && value.messages.length > 0) {
        const message = value.messages[0];
        const contacts = value.contacts || [];
        
        // Log contacts for debugging
        if (contacts.length > 0) {
          console.log('🔍 Webhook contacts:', contacts.map(c => ({
            wa_id: c.wa_id,
            profileName: c.profile?.name
          })));
        }
        
        await processIncomingMessage(message, contacts);
      }
      
      if (value.statuses && value.statuses.length > 0) {
        const status = value.statuses[0];
        await updateMessageStatus(status);
      }
    }
    
    res.sendStatus(200);
  } catch (error) {
    console.error('❌ Error handling webhook:', error);
    res.sendStatus(500);
  }
};

// Process incoming message
const processIncomingMessage = async (message, webhookContacts = []) => {
  try {
    const {
      from: phoneNumber,
      timestamp,
      type,
      id: whatsappMessageId,
      text,
      image,
      document,
      audio,
      video,
      location,
      contacts,
      button,
      interactive
    } = message;

    // Check for duplicate messages early to avoid unnecessary processing
    if (whatsappMessageId) {
      const { data: existingMessages, error: checkError } = await supabase
        .from('whatsapp_messages')
        .select('id, whatsapp_message_id')
        .eq('whatsapp_message_id', whatsappMessageId)
        .limit(1);
      
      if (!checkError && existingMessages && existingMessages.length > 0) {
        console.log(`⚠️ Duplicate message detected: whatsapp_message_id ${whatsappMessageId} already exists. Skipping.`);
        return; // Exit early to prevent duplicate processing
      }
    }

    // Find lead by phone number (handle various formats)
    const phoneWithoutCountry = phoneNumber.replace(/^972/, '');
    const phoneWithCountry = phoneNumber.startsWith('972') ? phoneNumber : `972${phoneNumber}`;
    const phoneWithPlus = phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber}`;
    const phoneWithoutPlus = phoneNumber.replace(/^\+/, '');

    // Create multiple variations of the incoming phone number
    const incomingNormalized = normalizePhone(phoneNumber);
    const incomingVariations = [
      incomingNormalized,
      incomingNormalized.replace(/^972/, ''), // Remove country code
      incomingNormalized.replace(/^00972/, ''), // Remove 00972 prefix
      incomingNormalized.replace(/^0/, ''), // Remove leading 0
      `972${incomingNormalized.replace(/^972/, '')}`, // Add country code
      `0${incomingNormalized.replace(/^0/, '')}`, // Add leading 0
      incomingNormalized.replace(/^972/, '0'), // Replace 972 with 0
      incomingNormalized.replace(/^0/, '972'), // Replace 0 with 972
    ];
    

    
    // Get all leads and find by normalized phone number
    // Include both text role fields (scheduler, closer, handler) and numeric role fields (meeting_manager_id, expert_id, meeting_lawyer_id, case_handler_id)
    const { data: allLeads, error: allLeadsError } = await supabase
      .from('leads')
      .select('id, name, lead_number, phone, mobile, scheduler, closer, handler, meeting_manager_id, expert_id, meeting_lawyer_id, case_handler_id')
      .not('phone', 'is', null)
      .not('phone', 'eq', '');
    
    if (allLeadsError) {
      console.error('Error fetching leads:', allLeadsError);
      return;
    }
    
    // Find ALL matching leads by normalized phone number comparison
    const matchingLeads = [];
    for (const potentialLead of allLeads) {
      const leadPhoneNormalized = normalizePhone(potentialLead.phone);
      const leadMobileNormalized = normalizePhone(potentialLead.mobile);
      
      // Check if any variation matches
      let foundMatch = false;
      
      for (const variation of incomingVariations) {
        if (leadPhoneNormalized === variation || leadMobileNormalized === variation) {
          foundMatch = true;
          break;
        }
      }
      
      if (foundMatch) {
        matchingLeads.push({ type: 'new', data: potentialLead });
      }
    }

    // Also check legacy leads
    const { data: allLegacyLeads, error: allLegacyLeadsError } = await supabase
      .from('leads_lead')
      .select('id, name, phone, mobile, meeting_scheduler_id, meeting_manager_id, meeting_lawyer_id, expert_id, closer_id, case_handler_id')
      .not('phone', 'is', null)
      .not('phone', 'eq', '');
    
    if (!allLegacyLeadsError && allLegacyLeads) {
      for (const potentialLegacyLead of allLegacyLeads) {
        const leadPhoneNormalized = normalizePhone(potentialLegacyLead.phone || '');
        const leadMobileNormalized = normalizePhone(potentialLegacyLead.mobile || '');
        
        let foundMatch = false;
        for (const variation of incomingVariations) {
          if (leadPhoneNormalized === variation || leadMobileNormalized === variation) {
            foundMatch = true;
            break;
          }
        }
        
        if (foundMatch) {
          matchingLeads.push({ type: 'legacy', data: potentialLegacyLead });
        }
      }
    }

    // Find ALL matching contacts and their associated leads
    const matchingContacts = [];
    const matchingContactsWithLeads = [];
    
    // Find all contacts that match the phone number
    // Use multiple queries since Supabase doesn't support complex OR with IN
    const contactQueries = [
      supabase
        .from('leads_contact')
        .select('id, name, phone, mobile, additional_phones, newlead_id, lead_leadcontact(lead_id, newlead_id, main)')
        .in('phone', incomingVariations),
      supabase
        .from('leads_contact')
        .select('id, name, phone, mobile, additional_phones, newlead_id, lead_leadcontact(lead_id, newlead_id, main)')
        .in('mobile', incomingVariations)
    ];
    
    const contactResults = await Promise.all(contactQueries);
    const allContactsMap = new Map();
    
    contactResults.forEach(result => {
      if (!result.error && result.data) {
        result.data.forEach(contact => {
          if (!allContactsMap.has(contact.id)) {
            allContactsMap.set(contact.id, contact);
          }
        });
      }
    });
    
    const allContacts = Array.from(allContactsMap.values());
    const contactsError = contactResults.find(r => r.error)?.error;
    
    if (!contactsError && allContacts) {
      for (const contact of allContacts) {
        const contactPhones = [
          contact.phone,
          contact.mobile,
          ...parseAdditionalPhones(contact.additional_phones || '')
        ].filter(Boolean);
        
        const contactNormalizedPhones = contactPhones
          .map(normalizePhone)
          .filter(Boolean);
        
        // Check if any normalized contact phone matches any variation
        const hasMatch = contactNormalizedPhones.some(number => 
          incomingVariations.some(variation => normalizePhone(variation) === number)
        );
        
        if (hasMatch) {
          matchingContacts.push(contact.id);
          
          // Find all leads associated with this contact
          const contactLinks = contact.lead_leadcontact || [];
          let leadsAddedFromContact = 0;
          
          for (const link of contactLinks) {
            if (link.newlead_id) {
              // Check if this lead is already in matchingLeads
              const existingLead = matchingLeads.find(ml => ml.type === 'new' && ml.data.id === link.newlead_id);
              if (!existingLead) {
                const { data: newLead, error: leadError } = await supabase
                  .from('leads')
                  .select('id, name, lead_number, phone, mobile, scheduler, closer, handler, meeting_manager_id, expert_id, meeting_lawyer_id, case_handler_id')
                  .eq('id', link.newlead_id)
                  .maybeSingle();
                if (newLead) {
                  matchingLeads.push({ type: 'new', data: newLead });
                  leadsAddedFromContact++;
                  console.log(`✅ Added new lead ${newLead.id} (${newLead.name}) from contact ${contact.id}`);
                } else if (leadError) {
                  console.error(`❌ Error fetching new lead ${link.newlead_id} for contact ${contact.id}:`, leadError);
                }
              } else {
                console.log(`ℹ️ Lead ${link.newlead_id} already in matchingLeads (from contact ${contact.id})`);
              }
            }
            if (link.lead_id) {
              // Check if this legacy lead is already in matchingLeads
              const existingLead = matchingLeads.find(ml => ml.type === 'legacy' && ml.data.id === link.lead_id);
              if (!existingLead) {
                const { data: legacyLead, error: legacyError } = await supabase
                  .from('leads_lead')
                  .select('id, name, meeting_scheduler_id, meeting_manager_id, meeting_lawyer_id, expert_id, closer_id, case_handler_id')
                  .eq('id', link.lead_id)
                  .maybeSingle();
                if (legacyLead) {
                  matchingLeads.push({ type: 'legacy', data: legacyLead });
                  leadsAddedFromContact++;
                  console.log(`✅ Added legacy lead ${legacyLead.id} (${legacyLead.name || legacyLead.id}) from contact ${contact.id}`);
                } else if (legacyError) {
                  console.error(`❌ Error fetching legacy lead ${link.lead_id} for contact ${contact.id}:`, legacyError);
                }
              } else {
                console.log(`ℹ️ Legacy lead ${link.lead_id} already in matchingLeads (from contact ${contact.id})`);
              }
            }
          }
          
          // Also check contact's direct newlead_id
          if (contact.newlead_id) {
            const existingLead = matchingLeads.find(ml => ml.type === 'new' && ml.data.id === contact.newlead_id);
            if (!existingLead) {
              const { data: newLead, error: directLeadError } = await supabase
                .from('leads')
                .select('id, name, lead_number, phone, mobile, scheduler, closer, handler, meeting_manager_id, expert_id, meeting_lawyer_id, case_handler_id')
                .eq('id', contact.newlead_id)
                .maybeSingle();
              if (newLead) {
                matchingLeads.push({ type: 'new', data: newLead });
                leadsAddedFromContact++;
                console.log(`✅ Added new lead ${newLead.id} (${newLead.name}) from contact ${contact.id} (direct newlead_id)`);
              } else if (directLeadError) {
                console.error(`❌ Error fetching direct newlead_id ${contact.newlead_id} for contact ${contact.id}:`, directLeadError);
              }
            }
          }
          
          console.log(`📋 Contact ${contact.id} matched: added ${leadsAddedFromContact} lead(s) to matchingLeads`);
          
          matchingContactsWithLeads.push({
            contactId: contact.id,
            contactLinks: contactLinks
          });
        }
      }
    }

    // Find the contact profile for this phone number from webhook contacts
    const contactProfile = webhookContacts.find(contact => contact.wa_id === phoneNumber);
    const profileName = contactProfile?.profile?.name;
    const profilePictureUrl = contactProfile?.profile?.picture; // Extract profile picture URL

    // Log profile information for debugging
    console.log('🔍 WhatsApp message profile info:', {
      phoneNumber,
      webhookContacts: webhookContacts.length,
      contactProfile: !!contactProfile,
      profileName,
      profilePictureUrl: !!profilePictureUrl,
      matchingLeadsCount: matchingLeads.length,
      matchingContactsCount: matchingContacts.length
    });

    // Log summary of all matches found
    console.log(`📊 Match Summary for ${phoneNumber}:`, {
      directLeads: matchingLeads.filter(ml => {
        // Check if this lead was found directly (not through contacts)
        // We can't easily distinguish, but we'll log the total
        return true;
      }).length,
      totalMatchingLeads: matchingLeads.length,
      matchingContacts: matchingContacts.length,
      newLeads: matchingLeads.filter(ml => ml.type === 'new').length,
      legacyLeads: matchingLeads.filter(ml => ml.type === 'legacy').length,
      leadIds: matchingLeads.map(ml => `${ml.type}:${ml.data.id}`).join(', ')
    });

    // Determine the best sender name to use
    let senderName;
    if (matchingLeads.length > 0) {
      // Use the first matching lead's name
      senderName = matchingLeads[0].data.name || 'Unknown Client';
    } else {
      // For unknown leads, try to get the WhatsApp profile name from webhook
      if (profileName) {
        senderName = profileName;
        console.log('✅ Using WhatsApp profile name from webhook:', profileName);
      } else {
        // Fallback: use a more user-friendly format for the phone number
        const formattedPhone = phoneNumber.replace(/^972/, '0').replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3');
        senderName = `WhatsApp User (${formattedPhone})`;
        console.log('⚠️ No profile name available, using formatted phone:', formattedPhone);
      }
    }

    // Store profile picture in all matching leads/contacts if available
    if (profilePictureUrl) {
      // Update all matching contacts
      if (matchingContacts.length > 0) {
        await supabase
          .from('leads_contact')
          .update({ whatsapp_profile_picture_url: profilePictureUrl })
          .in('id', matchingContacts);
        console.log(`✅ Updated ${matchingContacts.length} contact profile pictures`);
      }
      
      // Update all matching new leads (if no contacts found)
      const newLeads = matchingLeads.filter(ml => ml.type === 'new').map(ml => ml.data.id);
      if (newLeads.length > 0 && matchingContacts.length === 0) {
        await supabase
          .from('leads')
          .update({ whatsapp_profile_picture_url: profilePictureUrl })
          .in('id', newLeads);
        console.log(`✅ Updated ${newLeads.length} lead profile pictures`);
      }
    }

    // Prepare base message data (without lead_id/legacy_id/contact_id - will be added per match)
    const baseMessageData = {
      sender_name: senderName,
      phone_number: phoneNumber, // Store the original phone number from WhatsApp
      direction: 'in',
      sent_at: new Date(parseInt(timestamp) * 1000).toISOString(),
      whatsapp_message_id: whatsappMessageId,
      whatsapp_status: 'delivered',
      whatsapp_timestamp: new Date(parseInt(timestamp) * 1000).toISOString(),
      message_type: type,
      message: '',
      media_url: null,
      media_id: null,
      media_filename: null,
      media_mime_type: null,
      media_size: null,
      caption: null,
      profile_picture_url: profilePictureUrl || null, // Store profile picture URL from webhook
      voice_note: false // Will be set for voice notes
    };

    const isUnknownLeadMessage = matchingLeads.length === 0;
    
    // Update phone numbers for all matching new leads if they don't match exactly
    const newLeadsToUpdate = matchingLeads
      .filter(ml => ml.type === 'new')
      .map(ml => ml.data)
      .filter(lead => lead.phone !== phoneNumber && lead.mobile !== phoneNumber);
    
    if (newLeadsToUpdate.length > 0) {
      const leadIdsToUpdate = newLeadsToUpdate.map(l => l.id);
      await supabase
        .from('leads')
        .update({ phone: phoneNumber })
        .in('id', leadIdsToUpdate);
      console.log(`✅ Updated phone number for ${leadIdsToUpdate.length} leads`);
    }

    // Use first matching lead for media owner identifier (or phone number if no matches)
    const mediaOwnerIdentifier = matchingLeads.length > 0
      ? (matchingLeads[0].type === 'new' ? matchingLeads[0].data.id : `legacy_${matchingLeads[0].data.id}`)
      : phoneNumber;

    // Handle different message types
    switch (type) {
      case 'text':
        baseMessageData.message = text.body;
        break;
      
      case 'image':
        baseMessageData.message = image.caption || '';
        baseMessageData.media_id = image.id;
        baseMessageData.media_url = image.id; // Set media_url to WhatsApp media ID
        baseMessageData.media_mime_type = image.mime_type;
        baseMessageData.media_size = image.file_size;
        baseMessageData.caption = image.caption;
        // Download and store image (use phone number as fallback for unknown leads)
        await downloadAndStoreMedia(image.id, 'image', mediaOwnerIdentifier);
        break;
      
      case 'document':
        baseMessageData.message = document.filename;
        baseMessageData.media_id = document.id;
        baseMessageData.media_url = document.id; // Set media_url to WhatsApp media ID
        baseMessageData.media_filename = document.filename;
        baseMessageData.media_mime_type = document.mime_type;
        baseMessageData.media_size = document.file_size;
        // Download and store document (use phone number as fallback for unknown leads)
        await downloadAndStoreMedia(document.id, 'document', mediaOwnerIdentifier);
        break;
      
      case 'audio':
        // Check if this is a voice note (WhatsApp voice notes typically have specific mime types or are short duration)
        // Voice notes usually have mime_type 'audio/ogg; codecs=opus' or 'audio/aac' and are typically under 2 minutes
        const isVoiceNote = audio.mime_type?.includes('ogg') || 
                           audio.mime_type?.includes('opus') || 
                           audio.mime_type?.includes('aac') ||
                           (audio.voice === true); // WhatsApp sometimes includes a voice flag
        
        baseMessageData.message = isVoiceNote ? 'Voice message' : 'Audio message';
        baseMessageData.media_id = audio.id;
        baseMessageData.media_url = audio.id; // Set media_url to WhatsApp media ID
        baseMessageData.media_mime_type = audio.mime_type;
        baseMessageData.media_size = audio.file_size;
        baseMessageData.voice_note = isVoiceNote; // Mark as voice note
        await downloadAndStoreMedia(audio.id, 'audio', mediaOwnerIdentifier);
        break;
      
      case 'video':
        baseMessageData.message = video.caption || 'Video message';
        baseMessageData.media_id = video.id;
        baseMessageData.media_url = video.id; // Set media_url to WhatsApp media ID
        baseMessageData.media_mime_type = video.mime_type;
        baseMessageData.media_size = video.file_size;
        baseMessageData.caption = video.caption;
        await downloadAndStoreMedia(video.id, 'video', mediaOwnerIdentifier);
        break;
      
      case 'location':
        baseMessageData.message = `Location: ${location.latitude}, ${location.longitude}`;
        baseMessageData.message_type = 'location';
        break;
      
      case 'contacts':
        baseMessageData.message = 'Contact shared';
        baseMessageData.message_type = 'contact';
        break;
      
      case 'button':
        // Handle button response from template message
        baseMessageData.message = `Button clicked: ${button.payload}`;
        baseMessageData.message_type = 'button_response';
        console.log('🔘 Button response received:', {
          buttonId: button.id,
          payload: button.payload,
          phoneNumber,
          matchingLeadsCount: matchingLeads.length
        });
        
        // Handle specific button actions based on payload
        if (button.payload === 'RESCHEDULE' || button.payload === 'reschedule') {
          baseMessageData.message = '📅 Client clicked "Reschedule" button';
          console.log('📅 Reschedule request from:', senderName || phoneNumber);
        }
        break;
      
      case 'interactive':
        // Handle interactive messages (buttons, lists)
        if (interactive?.type === 'button_reply') {
          baseMessageData.message = `Button clicked: ${interactive.button_reply.title}`;
          baseMessageData.message_type = 'button_response';
          console.log('🔘 Interactive button clicked:', {
            buttonText: interactive.button_reply.title,
            buttonId: interactive.button_reply.id,
            phoneNumber
          });
        } else if (interactive?.type === 'list_reply') {
          baseMessageData.message = `List option selected: ${interactive.list_reply.title}`;
          baseMessageData.message_type = 'list_response';
          console.log('📋 List option selected:', {
            optionText: interactive.list_reply.title,
            optionId: interactive.list_reply.id,
            phoneNumber
          });
        }
        break;
    }

    // Create message records for all matching leads and contacts
    const messagesToInsert = [];
    
    if (matchingLeads.length === 0 && matchingContacts.length === 0) {
      // Unknown lead - save one record with no lead_id/legacy_id/contact_id
      messagesToInsert.push({
        ...baseMessageData,
        lead_id: null,
        legacy_id: null,
        contact_id: null
      });
    } else {
      // For each matching lead, create a message record
      for (const matchingLead of matchingLeads) {
        if (matchingLead.type === 'new') {
          messagesToInsert.push({
            ...baseMessageData,
            lead_id: matchingLead.data.id,
            legacy_id: null,
            contact_id: null // Will be updated if contact matches
          });
        } else {
          messagesToInsert.push({
            ...baseMessageData,
            lead_id: null,
            legacy_id: matchingLead.data.id,
            contact_id: null // Will be updated if contact matches
          });
        }
      }
      
      // For each matching contact, create a message record (if not already created for its lead)
      for (const contactWithLeads of matchingContactsWithLeads) {
        const contactId = contactWithLeads.contactId;
        const contactLinks = contactWithLeads.contactLinks;
        
        // Check if we already have a message for this contact's leads
        for (const link of contactLinks) {
          let alreadyExists = false;
          
          if (link.newlead_id) {
            alreadyExists = messagesToInsert.some(msg => msg.lead_id === link.newlead_id);
            if (!alreadyExists) {
              messagesToInsert.push({
                ...baseMessageData,
                lead_id: link.newlead_id,
                legacy_id: null,
                contact_id: contactId
              });
            } else {
              // Update existing message to include contact_id
              const existingMsg = messagesToInsert.find(msg => msg.lead_id === link.newlead_id);
              if (existingMsg) {
                existingMsg.contact_id = contactId;
              }
            }
          }
          
          if (link.lead_id) {
            alreadyExists = messagesToInsert.some(msg => msg.legacy_id === link.lead_id);
            if (!alreadyExists) {
              messagesToInsert.push({
                ...baseMessageData,
                lead_id: null,
                legacy_id: link.lead_id,
                contact_id: contactId
              });
            } else {
              // Update existing message to include contact_id
              const existingMsg = messagesToInsert.find(msg => msg.legacy_id === link.lead_id);
              if (existingMsg) {
                existingMsg.contact_id = contactId;
              }
            }
          }
        }
        
        // Also handle contact's direct newlead_id
        if (contactWithLeads.contactId && !contactLinks.some(link => link.newlead_id)) {
          // Check if contact has a direct newlead_id that we haven't handled
          const { data: contactData } = await supabase
            .from('leads_contact')
            .select('newlead_id')
            .eq('id', contactWithLeads.contactId)
            .maybeSingle();
          
          if (contactData?.newlead_id) {
            const alreadyExists = messagesToInsert.some(msg => msg.lead_id === contactData.newlead_id);
            if (!alreadyExists) {
              messagesToInsert.push({
                ...baseMessageData,
                lead_id: contactData.newlead_id,
                legacy_id: null,
                contact_id: contactId
              });
            } else {
              const existingMsg = messagesToInsert.find(msg => msg.lead_id === contactData.newlead_id);
              if (existingMsg) {
                existingMsg.contact_id = contactId;
              }
            }
          }
        }
      }
    }

    // Save all messages to database
    const { error: insertError } = await supabase
      .from('whatsapp_messages')
      .insert(messagesToInsert);

    if (insertError) {
      console.error('Error saving incoming message:', insertError);
    } else {
      // Log all saved messages
      const newLeadsCount = messagesToInsert.filter(msg => msg.lead_id).length;
      const legacyLeadsCount = messagesToInsert.filter(msg => msg.legacy_id).length;
      const unknownCount = messagesToInsert.filter(msg => !msg.lead_id && !msg.legacy_id).length;
      
      console.log(`✅ Saved ${messagesToInsert.length} message record(s):`, {
        newLeads: newLeadsCount,
        legacyLeads: legacyLeadsCount,
        unknown: unknownCount,
        phoneNumber
      });
      
      if (matchingLeads.length > 0) {
        matchingLeads.forEach(ml => {
          console.log(`  - ${ml.type === 'new' ? 'New' : 'Legacy'} lead: ${ml.data.name || ml.data.id}`);
        });
      }
      if (matchingContacts.length > 0) {
        console.log(`  - ${matchingContacts.length} matching contact(s)`);
      }
      if (isUnknownLeadMessage) {
        console.log(`🆕 NEW LEAD: ${senderName} (${phoneNumber}) - This will appear on WhatsApp Leads page!`);
      }

      // Send push notifications (non-blocking - don't await to avoid delaying webhook response)
      // Use setImmediate to send notifications asynchronously after the webhook response
      setImmediate(async () => {
        try {
          // Check in-memory cache to prevent duplicate notifications (handles race conditions)
          if (whatsappMessageId && markNotificationSent(whatsappMessageId)) {
            console.log(`⚠️ Duplicate notification prevented: whatsapp_message_id ${whatsappMessageId} notification already sent. Skipping.`);
            return; // Exit early to prevent duplicate notifications
          }

          // Also double-check database to be extra safe
          if (whatsappMessageId) {
            const { data: existingMessages, error: checkError } = await supabase
              .from('whatsapp_messages')
              .select('id, whatsapp_message_id')
              .eq('whatsapp_message_id', whatsappMessageId)
              .limit(1);
            
            if (!checkError && existingMessages && existingMessages.length > 0) {
              // If message exists and we're here, it means we're processing the first webhook
              // But if multiple webhooks arrived simultaneously, the cache will catch duplicates
              console.log(`✅ Processing notification for whatsapp_message_id ${whatsappMessageId}`);
            }
          }

          const notificationStartTime = Date.now();
          const previewText = buildWhatsappNotificationPreview(baseMessageData, senderName, phoneNumber, type);
          // Use whatsapp_message_id in tag for browser-level deduplication
          const notificationTag = baseMessageData.whatsapp_message_id 
            ? `whatsapp-msg-${baseMessageData.whatsapp_message_id}`
            : `whatsapp-${phoneNumber || Date.now()}`;
          const notificationPayload = {
            title: '💬 New WhatsApp Message',
            body: previewText,
            icon: '/whatsapp-icon.svg',
            badge: '/icon-72x72.png',
            url: phoneNumber ? `/whatsapp-leads?phone=${encodeURIComponent(phoneNumber)}` : '/whatsapp-leads',
            tag: notificationTag, // Browser will deduplicate notifications with the same tag
            id: baseMessageData.whatsapp_message_id || phoneNumber || Date.now(),
            type: 'notification',
            vibrate: [200, 100, 200],
          };

          // Log notification decision
          console.log(`📱 Notification decision:`, {
            isUnknownLeadMessage,
            matchingLeadsCount: matchingLeads.length,
            matchingContactsCount: matchingContacts.length,
            phoneNumber,
            whatsappMessageId
          });

          if (isUnknownLeadMessage) {
            // For unknown leads, send to all users
            const result = await pushNotificationService.sendNotificationToAll(notificationPayload);
            const duration = Date.now() - notificationStartTime;
            console.log(`📱 Sent push notifications to all users (${result.sent}/${result.total}) in ${duration}ms`);
          } else if (matchingLeads.length > 0) {
            // For existing leads (including those found through contacts), send notifications to users with assigned roles
            // This includes:
            // - Leads matched directly by phone number
            // - Leads found through matching contacts
            console.log(`📱 Processing notifications for ${matchingLeads.length} matching lead(s):`, 
              matchingLeads.map(ml => ({
                type: ml.type,
                id: ml.data.id,
                name: ml.data.name || 'Unknown'
              }))
            );
            
            // Parallelize role lookups for all leads
            const roleLookupStartTime = Date.now();
            const roleLookupPromises = matchingLeads.map(matchingLead => {
              const lead = matchingLead.type === 'new' ? matchingLead.data : null;
              const legacyLead = matchingLead.type === 'legacy' ? matchingLead.data : null;
              return findUsersWithRolesForLead(lead, legacyLead);
            });
            
            const roleLookupResults = await Promise.all(roleLookupPromises);
            const roleLookupDuration = Date.now() - roleLookupStartTime;
            
            // Combine all user IDs from all matching leads
            const allUserIds = new Set();
            roleLookupResults.forEach((userIds, index) => {
              const matchingLead = matchingLeads[index];
              console.log(`  - ${matchingLead.type === 'new' ? 'New' : 'Legacy'} lead ${matchingLead.data.id}: ${userIds.length} user(s) with roles`);
              userIds.forEach(userId => allUserIds.add(userId));
            });
            
            if (allUserIds.size > 0) {
              const sendStartTime = Date.now();
              const sendResults = await Promise.allSettled(
                Array.from(allUserIds).map(async (userId) => {
                  try {
                    const result = await pushNotificationService.sendNotificationToUser(userId, notificationPayload);
                    return { userId, result, success: true };
                  } catch (error) {
                    return { userId, error: error.message || error, success: false };
                  }
                })
              );
              
              const sendDuration = Date.now() - sendStartTime;
              const totalDuration = Date.now() - notificationStartTime;
              
              // Count actually sent notifications (check result.sent > 0)
              let totalSent = 0;
              let totalSubscriptions = 0;
              const userIdsArray = Array.from(allUserIds);
              
              sendResults.forEach((result, index) => {
                if (result.status === 'fulfilled' && result.value.success) {
                  const { result: notificationResult } = result.value;
                  if (notificationResult && notificationResult.sent !== undefined) {
                    totalSent += notificationResult.sent || 0;
                    totalSubscriptions += notificationResult.total || 0;
                  } else {
                    // Fallback: if result doesn't have sent/total, assume it succeeded
                    totalSent += 1;
                    totalSubscriptions += 1;
                  }
                } else {
                  const userId = userIdsArray[index];
                  const error = result.status === 'rejected' 
                    ? result.reason 
                    : (result.value?.error || 'Unknown error');
                  console.error(`❌ Failed to send notification to user ${userId}:`, error);
                }
              });
              
              console.log(`📱 ✅ Push notification results for ${matchingLeads.length} matching lead(s):`, {
                usersWithRoles: allUserIds.size,
                notificationsSent: totalSent,
                subscriptionsTotal: totalSubscriptions,
                roleLookupTime: `${roleLookupDuration}ms`,
                sendTime: `${sendDuration}ms`,
                totalTime: `${totalDuration}ms`,
                leads: matchingLeads.map(ml => `${ml.type}:${ml.data.id}`).join(', '),
                userIds: Array.from(allUserIds)
              });
              
              if (totalSent === 0 && allUserIds.size > 0) {
                console.warn(`⚠️ No push notifications were actually sent. Users may not have active subscriptions.`, {
                  userIds: Array.from(allUserIds),
                  notificationTag: notificationPayload.tag
                });
              }
            } else {
              console.log(`ℹ️ No assigned users found for ${matchingLeads.length} matching lead(s), not sending WhatsApp notification.`, {
                leads: matchingLeads.map(ml => `${ml.type}:${ml.data.id}`).join(', ')
              });
            }
          } else {
            // This should not happen if contact matching worked correctly
            // But log it as a warning in case contacts were found but leads weren't added
            console.warn(`⚠️ No matching leads found but contacts=${matchingContacts.length}. This might indicate an issue with contact-to-lead linking.`, {
              phoneNumber,
              whatsappMessageId,
              matchingContactsCount: matchingContacts.length
            });
          }
        } catch (notificationError) {
          console.error('Error sending push notification for WhatsApp message:', notificationError);
        }
      });
    }

  } catch (error) {
    console.error('Error processing incoming message:', error);
  }
};

// Download and store media file
const downloadAndStoreMedia = async (mediaId, type, leadId) => {
  try {

    
    // In production mode, we don't need to download and store locally
    // Just store the WhatsApp media ID for later retrieval
    if (!isDevelopmentMode) {
  
      return;
    }
    
    // Get media URL from WhatsApp
    const mediaResponse = await axios.get(
      `${WHATSAPP_API_URL}/${mediaId}`,
      {
        headers: {
          'Authorization': `Bearer ${ACCESS_TOKEN}`
        }
      }
    );

    const mediaUrl = mediaResponse.data.url;
    
    // Download media file
    const fileResponse = await axios.get(mediaUrl, {
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`
      },
      responseType: 'stream'
    });

    // Create uploads directory if it doesn't exist
    const uploadsDir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    // Save file with unique name
    const fileName = `${leadId}_${Date.now()}_${mediaId}.${getFileExtension(fileResponse.headers['content-type'])}`;
    const filePath = path.join(uploadsDir, fileName);
    
    const writer = fs.createWriteStream(filePath);
    fileResponse.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
    
        resolve();
      });
      writer.on('error', reject);
    });

  } catch (error) {
    console.error('Error downloading media:', error);
  }
};

// Get file extension from MIME type
const getFileExtension = (mimeType) => {
  const extensions = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'audio/mpeg': 'mp3',
    'audio/ogg': 'ogg',
    'video/mp4': 'mp4',
    'video/avi': 'avi'
  };
  return extensions[mimeType] || 'bin';
};

// Update message status
const updateMessageStatus = async (status) => {
  try {
    const { id: whatsappMessageId, status: messageStatus, timestamp } = status;
    
    console.log('📱 WhatsApp Status Update:', {
      messageId: whatsappMessageId,
      status: messageStatus,
      timestamp: timestamp
    });

    const { error } = await supabase
      .from('whatsapp_messages')
      .update({
        whatsapp_status: messageStatus,
        whatsapp_timestamp: new Date(parseInt(timestamp) * 1000).toISOString()
      })
      .eq('whatsapp_message_id', whatsappMessageId);

    if (error) {
      console.error('Error updating message status:', error);
    } else {
      console.log('✅ Message status updated successfully:', messageStatus);
    }

  } catch (error) {
    console.error('Error updating message status:', error);
  }
};

// Send WhatsApp message
const sendMessage = async (req, res) => {
  try {
    // Log the FULL request body first, especially templateId
    console.log('📨 ===== SEND MESSAGE REQUEST RECEIVED =====');
    console.log('📨 Full request body:', JSON.stringify(req.body, null, 2));
    console.log('📨 Template ID in request:', req.body.templateId, '(type:', typeof req.body.templateId, ')');
    console.log('📨 Is Template:', req.body.isTemplate);
    
    console.log('📨 Received send message request:', { 
      leadId: req.body.leadId, 
      phoneNumber: req.body.phoneNumber, 
      messageLength: req.body.message?.length, 
      isTemplate: req.body.isTemplate,
      templateName: req.body.templateName,
      templateId: req.body.templateId,
      templateIdType: typeof req.body.templateId,
      templateParameters: req.body.templateParameters
    });
    const { leadId, message, phoneNumber, isTemplate, templateName, templateLanguage, templateParameters, templateId, contactId } = req.body;
    
    // Log immediately after destructuring
    console.log('🔍 After destructuring - templateId:', templateId, '(type:', typeof templateId, ')');

    // Validate inputs: for templates, message is optional (only required if template has parameters)
    if (!phoneNumber) {
      return res.status(400).json({ error: 'Phone number is required' });
    }
    
    if (!isTemplate && !message) {
      return res.status(400).json({ error: 'Message is required for non-template messages' });
    }
    
    // For templates with parameters, message should contain the parameter value
    if (isTemplate && templateParameters && templateParameters.length > 0 && !message) {
      return res.status(400).json({ error: 'Template parameter value is required' });
    }

    // Handle different lead types
    let lead = null;
    let isLegacyLead = false;
    
    if (leadId === null) {
      // This is a new WhatsApp lead (no lead ID yet)
      console.log('📱 Sending message to new WhatsApp lead (no lead ID)');
      lead = {
        id: null,
        name: 'WhatsApp Lead',
        lead_number: phoneNumber
      };
    } else if (leadId && leadId.toString().startsWith('legacy_')) {
      // For legacy leads, get from leads_lead table
      isLegacyLead = true;
      const legacyId = parseInt(leadId.replace('legacy_', ''));
      const { data: legacyLead, error: legacyError } = await supabase
        .from('leads_lead')
        .select('id, name, meeting_date, meeting_time')
        .eq('id', legacyId)
        .single();

      if (legacyError || !legacyLead) {
        return res.status(404).json({ error: 'Legacy lead not found' });
      }
      
      lead = {
        id: legacyId,
        name: legacyLead.name,
        lead_number: legacyId.toString(),
        meeting_date: legacyLead.meeting_date,
        meeting_time: legacyLead.meeting_time
      };
    } else {
      // For new leads, get from leads table
      const { data: newLead, error: newError } = await supabase
        .from('leads')
        .select('id, name, lead_number')
        .eq('id', leadId)
        .single();

      if (newError || !newLead) {
        return res.status(404).json({ error: 'Lead not found' });
      }
      
      // Fetch latest meeting for this lead
      const { data: latestMeeting, error: meetingError } = await supabase
        .from('meetings')
        .select('meeting_date, meeting_time')
        .eq('client_id', leadId)
        .order('meeting_date', { ascending: false })
        .order('meeting_time', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      lead = {
        ...newLead,
        meeting_date: latestMeeting?.meeting_date || null,
        meeting_time: latestMeeting?.meeting_time || null
      };
    }

    let whatsappMessageId;
    let responseData;

    if (isDevelopmentMode) {
      // Mock WhatsApp API response for development
      console.log('📱 Sending message in DEVELOPMENT MODE (mock)');
      console.log('📱 Message:', message);
      console.log('📱 Phone:', phoneNumber);

      whatsappMessageId = `mock_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      responseData = {
        success: true,
        messageId: whatsappMessageId,
        message: 'Message sent successfully (MOCK MODE)'
      };
    } else {
      console.log('📱 Sending message via REAL WhatsApp API');
      console.log('📱 Message:', message);
      console.log('📱 Phone:', phoneNumber);
      console.log('📱 Is Template:', isTemplate);
      
      let messagePayload;
      
      if (isTemplate) {
        // Fetch template details from database using the template_id (database id)
        let finalTemplateName = templateName;
        let finalTemplateLanguage = templateLanguage;
        
        if (templateId) {
          // Try new table first (whatsapp_templates_v2)
          let { data: template, error: templateError } = await supabase
            .from('whatsapp_templates_v2')
            .select('id, name, language, whatsapp_template_id')
            .eq('id', templateId)
            .eq('active', true)
            .single();
          
          // Template lookup completed (no fallback needed - using new table only)
          
          if (!templateError && template) {
            finalTemplateName = template.name || templateName;
            finalTemplateLanguage = template.language || templateLanguage || 'en_US';
            console.log(`✅ Found template by database ID ${templateId}: ${finalTemplateName} (${finalTemplateLanguage}), WhatsApp ID: ${template.whatsapp_template_id || template.number_id}`);
          } else {
            console.warn(`⚠️ Template with database ID ${templateId} not found, using provided templateName: ${templateName}`);
          }
        }
        
        console.log('📱 Sending TEMPLATE message');
        console.log('📱 Template ID:', templateId);
        console.log('📱 Template Name:', finalTemplateName);
        console.log('📱 Template Language:', finalTemplateLanguage);
        console.log('📱 Template Parameters:', templateParameters);
        
        // Send template message
        messagePayload = {
          messaging_product: 'whatsapp',
          to: phoneNumber,
          type: 'template',
          template: {
            name: finalTemplateName || 'second_test',
            language: {
              code: finalTemplateLanguage || 'en_US'
            }
          }
        };
        
        // Always add components section if template parameters are expected
        // If no parameters provided, use default values
        if (templateParameters && templateParameters.length > 0) {
          // First, get required param count from template
          let requiredParamCount = 0;
          try {
            const { data: templateInfo } = await supabase
              .from('whatsapp_templates_v2')
              .select('params')
              .eq('id', templateId)
              .single();
            
            if (templateInfo) {
              requiredParamCount = Number(templateInfo.params) || 0;
            }
          } catch (err) {
            console.warn('Could not fetch template param count:', err);
          }
          
          // Process parameters: replace empty strings with placeholders, then filter/validate
          const processedParameters = templateParameters.map((param, index) => {
            if (!param || !param.text || param.text.trim().length === 0) {
              // Replace empty parameters with placeholder
              console.warn(`⚠️ Parameter ${index + 1} is empty, using placeholder`);
              return {
                type: 'text',
                text: 'N/A'
              };
            }
            return {
              type: param.type || 'text',
              text: param.text.trim()
            };
          });
          
          // Ensure we have the correct number of parameters
          while (processedParameters.length < requiredParamCount) {
            console.warn(`⚠️ Missing parameter ${processedParameters.length + 1}, adding placeholder`);
            processedParameters.push({
              type: 'text',
              text: 'N/A'
            });
          }
          
          // Use only the required number of parameters (in case we have extras)
          const finalParameters = processedParameters.slice(0, requiredParamCount > 0 ? requiredParamCount : processedParameters.length);
          
          if (finalParameters.length > 0) {
            console.log('📱 Template has valid parameters, using them:', finalParameters);
            messagePayload.template.components = [
              {
                type: 'body',
                parameters: finalParameters
              }
            ];
          } else {
            console.warn('⚠️ All template parameters are empty, cannot send template message');
            return res.status(400).json({ 
              error: 'Template parameters are required but were not provided or are empty. Please ensure client name and meeting information are available.' 
            });
          }
        } else {
          // No parameters provided - check template params count from database
          // Fetch template info to get param count
          try {
            const { data: templateInfo, error: templateError } = await supabase
              .from('whatsapp_templates_v2')
              .select('params')
              .eq('id', templateId)
              .single();
            
            if (!templateError && templateInfo) {
              const paramCount = Number(templateInfo.params) || 0;
              if (paramCount > 0) {
                console.warn(`⚠️ Template requires ${paramCount} parameter(s) but none were provided. Sending with empty parameters.`);
                messagePayload.template.components = [
                  {
                    type: 'body',
                    parameters: Array(paramCount).fill(null).map(() => ({ type: 'text', text: '' }))
                  }
                ];
              }
            }
          } catch (error) {
            console.error('❌ Error checking template params:', error);
          }
        }
        
        console.log('📱 Template payload:', JSON.stringify(messagePayload, null, 2));
      } else {
        // Send regular text message
        messagePayload = {
          messaging_product: 'whatsapp',
          to: phoneNumber,
          type: 'text',
          text: { body: message }
        };
      }
      
      const response = await axios.post(
        `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages`,
        messagePayload,
        {
          headers: {
            'Authorization': `Bearer ${ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
          }
        }
      );

      whatsappMessageId = response.data.messages[0].id;
      responseData = {
        success: true,
        messageId: whatsappMessageId,
        message: 'Message sent successfully'
      };
    }

    // Resolve template_id: Use the database ID directly from frontend
    // Since we're now fetching templates directly from database, the templateId should be the database id
    let finalTemplateId = null;
    if (isTemplate && templateName) {
      // The templateId from frontend should be the database primary key (id column)
      if (templateId !== undefined && templateId !== null) {
        const templateIdNum = Number(templateId);
        if (!isNaN(templateIdNum) && templateIdNum > 0) {
          // Verify the template exists in database (try new table first)
          let { data: templateById, error: errorById } = await supabase
            .from('whatsapp_templates_v2')
            .select('id, name, language, whatsapp_template_id')
            .eq('id', templateIdNum)
            .eq('active', true)
            .single();
          
          if (!errorById && templateById) {
            finalTemplateId = templateIdNum;
            const templateName = templateById.name;
            console.log(`✅ Template ID ${finalTemplateId} verified in database (name: ${templateName}, language: ${templateById.language})`);
          } else {
            console.warn(`⚠️ Template ID ${templateIdNum} not found in database, will try to find by name+language as fallback`);
          }
        } else {
          console.warn(`⚠️ Invalid template ID provided: ${templateId}, will try to find by name+language`);
        }
      }
      
      // If templateId lookup failed (or wasn't provided), try multiple lookup strategies
      if (finalTemplateId === null) {
        console.log(`🔍 Looking up template by name: "${templateName}", language: "${templateLanguage || 'en_US'}"`);
        
        // PRIORITY 2: Look up by name + language (exact match first)
        let { data: templateByName, error: errorByName } = await supabase
          .from('whatsapp_templates_v2')
          .select('id, name, language')
          .eq('name', templateName)
          .eq('language', templateLanguage || 'en_US')
          .maybeSingle();
        
        if (!templateByName) {
          // 2. Try case-insensitive match: name + language
          const { data: templateByNameCI } = await supabase
            .from('whatsapp_templates_v2')
            .select('id, name, language')
            .ilike('name', templateName)
            .ilike('language', templateLanguage || 'en_US')
            .maybeSingle();
          templateByName = templateByNameCI;
        }
        
        if (!templateByName) {
          // 3. Try by name only (ignore language)
          const { data: templateByNameOnly } = await supabase
            .from('whatsapp_templates_v2')
            .select('id, name, language')
            .eq('name', templateName)
            .maybeSingle();
          templateByName = templateByNameOnly;
        }
        
        if (!templateByName) {
          // 4. Try case-insensitive by name only
          const { data: templateByNameCIONly } = await supabase
            .from('whatsapp_templates_v2')
            .select('id, name, language')
            .ilike('name', templateName)
            .maybeSingle();
          templateByName = templateByNameCIONly;
        }
        
        if (templateByName && templateByName.id) {
          finalTemplateId = Number(templateByName.id);
          console.log(`✅ Found template by name/language: ID ${finalTemplateId} (name: ${templateByName.name}, language: ${templateByName.language})`);
        } else {
          // Last resort: List all templates with similar names for debugging
          const { data: similarTemplates } = await supabase
            .from('whatsapp_templates_v2')
            .select('id, name, language, whatsapp_template_id')
            .ilike('name', `%${templateName}%`)
            .limit(5);
          
          if (similarTemplates && similarTemplates.length > 0) {
            console.log(`🔍 Found ${similarTemplates.length} similar templates:`, similarTemplates);
            console.warn(`⚠️ Template "${templateName}" (${templateLanguage || 'en_US'}) not found with exact match. Similar templates found but not matched. Saving template_id as NULL`);
          } else {
            console.warn(`⚠️ Template "${templateName}" (${templateLanguage || 'en_US'}) not found in database at all. Saving template_id as NULL`);
          }
          finalTemplateId = null;
        }
      }
    }

    // Save message to database
    const messageData = {
      lead_id: leadId === null ? null : (isLegacyLead ? null : leadId), // Set to null for new WhatsApp leads and legacy leads
      legacy_id: isLegacyLead ? lead.id : null, // Set legacy_id for legacy leads
      contact_id: contactId || null, // Store contact_id if provided
      phone_number: phoneNumber, // Store phone number for new WhatsApp leads
      sender_name: req.body.sender_name || 'You',
      direction: 'out',
      message: isTemplate 
        ? (req.body.message || `[Template: ${templateName}]`) // Use filled content from frontend if provided
        : message,
      template_id: finalTemplateId, // Store template ID for proper matching (converted to number)
      sent_at: new Date().toISOString(),
      whatsapp_message_id: whatsappMessageId,
      whatsapp_status: 'pending', // Start as pending, will be updated by webhook
      message_type: 'text', // Always use 'text' as the database doesn't support 'template' type
      whatsapp_timestamp: new Date().toISOString()
    };

    // Log the message data being saved (with special emphasis on template_id)
    console.log('💾 Saving message to database:', JSON.stringify(messageData, null, 2));
    console.log(`📌 Template ID being saved: ${finalTemplateId} (isTemplate: ${isTemplate}, templateId from request: ${templateId})`);
    
    // CRITICAL: Log exactly what we're about to insert
    console.log('💾 ===== ABOUT TO INSERT MESSAGE =====');
    console.log('💾 Message data object:', JSON.stringify(messageData, null, 2));
    console.log('💾 Template ID value:', messageData.template_id, '(type:', typeof messageData.template_id, ')');
    console.log('💾 Final Template ID variable:', finalTemplateId, '(type:', typeof finalTemplateId, ')');
    
    const { data: insertedData, error: insertError } = await supabase
      .from('whatsapp_messages')
      .insert([messageData])
      .select('id, template_id, whatsapp_message_id'); // Select back the inserted data to verify template_id was saved

    if (insertError) {
      console.error('❌ ===== INSERT ERROR =====');
      console.error('❌ Error saving outgoing message:', insertError);
      console.error('❌ Error details:', JSON.stringify(insertError, null, 2));
      console.error('❌ Message data that failed:', JSON.stringify(messageData, null, 2));
      return res.status(500).json({ error: 'Failed to save message', details: insertError.message });
    }

    // Verify template_id was saved correctly
    console.log('✅ ===== INSERT RESULT =====');
    console.log('✅ Inserted data returned:', JSON.stringify(insertedData, null, 2));
    
    if (insertedData && insertedData.length > 0) {
      const savedMessage = insertedData[0];
      console.log(`✅ Message saved successfully. ID: ${savedMessage.id}, WhatsApp Message ID: ${savedMessage.whatsapp_message_id}`);
      console.log(`✅ Template ID saved in database: ${savedMessage.template_id} (expected: ${finalTemplateId})`);
      
      if (isTemplate && finalTemplateId !== null) {
        if (savedMessage.template_id === null || savedMessage.template_id === undefined) {
          console.error(`❌ CRITICAL ERROR: Template ID is NULL in database but should be ${finalTemplateId}!`);
          console.error(`❌ This indicates the insert failed to save template_id. Check database constraints.`);
        } else if (savedMessage.template_id !== finalTemplateId) {
          console.error(`⚠️ WARNING: Template ID mismatch! Expected: ${finalTemplateId}, Saved: ${savedMessage.template_id}`);
        } else {
          console.log(`✅ SUCCESS: Template ID correctly saved as ${savedMessage.template_id}`);
        }
      } else if (isTemplate && finalTemplateId === null) {
        console.warn(`⚠️ Template message but templateId is null - this might be expected if templateId was not provided`);
      }
    } else {
      console.error('❌ CRITICAL: Message inserted but no data returned from insert operation!');
      console.error('❌ This means we cannot verify if template_id was saved.');
    }

    console.log('✅ Message sent successfully:', responseData);
    res.json(responseData);

  } catch (error) {
    console.error('Error sending message:', error);
    
    // Check if it's a WhatsApp API error
    if (error.response && error.response.data && error.response.data.error) {
      const whatsappError = error.response.data.error;
      if (whatsappError.code === 131047) {
        res.status(400).json({ 
          error: 'Message failed: More than 24 hours have passed since the customer last replied. You can only send template messages after 24 hours.',
          code: 'RE_ENGAGEMENT_REQUIRED'
        });
      } else {
        res.status(400).json({ 
          error: `WhatsApp API Error: ${whatsappError.message}`,
          code: whatsappError.code
        });
      }
    } else {
      res.status(500).json({ error: 'Failed to send message' });
    }
  }
};

// Send WhatsApp media
const sendMedia = async (req, res) => {
  try {


    const { leadId, mediaUrl, mediaType, caption, phoneNumber, contactId } = req.body;

    if (!mediaUrl || !phoneNumber) {
      return res.status(400).json({ error: 'Media URL and phone number are required' });
    }

    // Handle different lead types
    let lead = null;
    let isLegacyLead = false;
    
    if (leadId === null) {
      // This is a new WhatsApp lead (no lead ID yet)
      console.log('📱 Sending media to new WhatsApp lead (no lead ID)');
      lead = {
        id: null,
        name: 'WhatsApp Lead',
        lead_number: phoneNumber
      };
    } else if (leadId && leadId.toString().startsWith('legacy_')) {
      // For legacy leads, get from leads_lead table
      isLegacyLead = true;
      const legacyId = parseInt(leadId.replace('legacy_', ''));
      const { data: legacyLead, error: legacyError } = await supabase
        .from('leads_lead')
        .select('id, name')
        .eq('id', legacyId)
        .single();

      if (legacyError || !legacyLead) {
        return res.status(404).json({ error: 'Legacy lead not found' });
      }
      
      lead = {
        id: legacyId,
        name: legacyLead.name,
        lead_number: legacyId.toString()
      };
    } else {
      // For new leads, get from leads table
      const { data: newLead, error: newError } = await supabase
        .from('leads')
        .select('id, name, lead_number')
        .eq('id', leadId)
        .single();

      if (newError || !newLead) {
        return res.status(404).json({ error: 'Lead not found' });
      }
      
      lead = newLead;
    }

    let whatsappMessageId;
    let responseData;

    if (isDevelopmentMode) {
      // Mock WhatsApp API response for development

      whatsappMessageId = `mock_media_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      responseData = {
        success: true,
        messageId: whatsappMessageId,
        message: 'Media message sent successfully (MOCK MODE)'
      };
    } else {
      // Send media message using the mediaUrl (which should be the media ID from upload)
      const messagePayload = {
        messaging_product: 'whatsapp',
        to: phoneNumber,
        type: mediaType,
        [mediaType]: {
          id: mediaUrl // Use the media ID from the upload step
        }
      };

      if (caption) {
        messagePayload[mediaType].caption = caption;
      }



      const response = await axios.post(
        `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages`,
        messagePayload,
        {
          headers: {
            'Authorization': `Bearer ${ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
          }
        }
      );

      whatsappMessageId = response.data.messages[0].id;
      responseData = {
        success: true,
        messageId: whatsappMessageId,
        message: 'Media message sent successfully'
      };
    }

    // Save message to database
    const messageData = {
      lead_id: isLegacyLead ? null : leadId, // Set to null for legacy leads
      legacy_id: isLegacyLead ? lead.id : null, // Set legacy_id for legacy leads
      contact_id: contactId || null, // Store contact_id if provided
      phone_number: phoneNumber, // Store phone number
      sender_name: req.body.sender_name || 'You',
      direction: 'out',
      message: caption || `${mediaType} message`,
      sent_at: new Date().toISOString(),
      whatsapp_message_id: whatsappMessageId,
      whatsapp_status: 'pending', // Start as pending, will be updated by webhook
      message_type: mediaType,
      media_url: mediaUrl,
      media_id: mediaUrl, // Also store as media_id for consistency
      caption: caption,
      voice_note: req.body.voiceNote || false // Store voice note flag
    };

    const { error: insertError } = await supabase
      .from('whatsapp_messages')
      .insert([messageData]);

    if (insertError) {
      console.error('Error saving outgoing media message:', insertError);
      return res.status(500).json({ error: 'Failed to save message' });
    }

    res.json(responseData);

  } catch (error) {
    console.error('Error sending media message:', error);
    res.status(500).json({ error: 'Failed to send media message' });
  }
};

// Get message status
const getMessageStatus = async (req, res) => {
  try {
    const { messageId } = req.params;

    const { data: message, error } = await supabase
      .from('whatsapp_messages')
      .select('whatsapp_status, whatsapp_timestamp, error_message')
      .eq('whatsapp_message_id', messageId)
      .single();

    if (error || !message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    res.json(message);

  } catch (error) {
    console.error('Error getting message status:', error);
    res.status(500).json({ error: 'Failed to get message status' });
  }
};

// Get conversation history
const getConversation = async (req, res) => {
  try {
    const { leadId } = req.params;

    const { data: messages, error } = await supabase
      .from('whatsapp_messages')
      .select('*')
      .eq('lead_id', leadId)
      .order('sent_at', { ascending: true });

    if (error) {
      console.error('Error fetching conversation:', error);
      return res.status(500).json({ error: 'Failed to fetch conversation' });
    }

    res.json(messages);

  } catch (error) {
    console.error('Error getting conversation:', error);
    res.status(500).json({ error: 'Failed to get conversation' });
  }
};

// Debug endpoint to find leads by phone number
const findLeadsByPhone = async (req, res) => {
  try {
    const { phoneNumber } = req.params;
    
    const { data: leads, error } = await supabase
      .from('leads')
      .select('id, name, lead_number, phone, mobile, created_at')
      .or(`phone.eq.${phoneNumber},mobile.eq.${phoneNumber}`)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error finding leads:', error);
      return res.status(500).json({ error: 'Failed to find leads' });
    }

    res.json(leads);

  } catch (error) {
    console.error('Error finding leads by phone:', error);
    res.status(500).json({ error: 'Failed to find leads by phone' });
  }
};

// Upload media to WhatsApp
const uploadMedia = async (req, res) => {
  try {


    const { file } = req;
    const { leadId, caption } = req.body;

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Upload file to your server first
    const uploadsDir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    // Note: WebM files should now be converted to OGG on the frontend using OpusMediaRecorder
    // If we still receive WebM, it means the conversion failed - we'll let WhatsApp API handle the error
    const fileName = `${leadId}_${Date.now()}_${file.originalname}`;
    const filePath = path.join(uploadsDir, fileName);

    fs.writeFileSync(filePath, file.buffer);

    let mediaId;
    let responseData;

    if (isDevelopmentMode) {
      // Mock media upload for development

      mediaId = fileName; // Use the actual filename as the media ID
      responseData = {
        success: true,
        mediaId: mediaId,
        fileName: fileName
      };
    } else {
      // Upload to WhatsApp
      const formData = new FormData();
      formData.append('messaging_product', 'whatsapp');
      formData.append('file', fs.createReadStream(filePath));



      const response = await axios.post(
        `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/media`,
        formData,
        {
          headers: {
            'Authorization': `Bearer ${ACCESS_TOKEN}`,
            ...formData.getHeaders()
          }
        }
      );

      mediaId = response.data.id;
      responseData = {
        success: true,
        mediaId: mediaId,
        fileName: fileName
      };
      

    }

    res.json(responseData);

  } catch (error) {
    console.error('Error uploading media:', error);
    res.status(500).json({ error: 'Failed to upload media' });
  }
};

// Get media from WhatsApp
const getMedia = async (req, res) => {
  try {
    const { mediaId } = req.params;

    if (!mediaId) {
      return res.status(400).json({ error: 'Media ID is required' });
    }

    // Check if this is a mock/test media ID
    if (mediaId.includes('mock_') || mediaId.includes('test_')) {
      return res.status(404).json({ error: 'Mock media not available in production' });
    }

    if (isDevelopmentMode) {
      // In development mode, serve from local uploads
      const uploadsDir = path.join(__dirname, '../../uploads');

      
      // First try exact match
      let filePath = path.join(uploadsDir, mediaId);
      if (fs.existsSync(filePath)) {
        return res.sendFile(filePath);
      }
      
      // If not found, search for files containing the media ID
      try {
        const files = fs.readdirSync(uploadsDir);
        const matchingFile = files.find(file => file.includes(mediaId));
        
        if (matchingFile) {
          filePath = path.join(uploadsDir, matchingFile);
          return res.sendFile(filePath);
        } else {
          return res.status(404).json({ error: 'Media not found' });
        }
      } catch (error) {
        console.error('❌ Error reading uploads directory:', error);
        return res.status(500).json({ error: 'Failed to read uploads directory' });
      }
    } else {
      // Get media URL from WhatsApp
      try {
        const mediaResponse = await axios.get(
          `${WHATSAPP_API_URL}/${mediaId}`,
          {
            headers: {
              'Authorization': `Bearer ${ACCESS_TOKEN}`
            }
          }
        );

        const mediaUrl = mediaResponse.data.url;
        
        // Download and serve the media
        const fileResponse = await axios.get(mediaUrl, {
          headers: {
            'Authorization': `Bearer ${ACCESS_TOKEN}`
          },
          responseType: 'stream'
        });

        // Set appropriate headers
        res.setHeader('Content-Type', fileResponse.headers['content-type'] || 'application/octet-stream');
        res.setHeader('Content-Length', fileResponse.headers['content-length'] || '');
        res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        
        // Pipe the file stream to response
        fileResponse.data.pipe(res);
      } catch (error) {
        const errorData = error.response?.data;
        const errorCode = errorData?.error?.code;
        const errorSubcode = errorData?.error?.error_subcode;
        const statusCode = error.response?.status;
        
        // Handle Graph API errors (media expired, invalid, or missing permissions)
        if (statusCode === 400 || statusCode === 404 || (errorCode === 100 && errorSubcode === 33)) {
          // Media expired or doesn't exist - this is expected for old messages
          // Log at info level, not error, since this is normal behavior
          console.log(`ℹ️  Media ${mediaId} is no longer available (expired or invalid)`);
          return res.status(404).json({ 
            error: 'Media not found or no longer available',
            message: 'This media has expired or is no longer accessible. WhatsApp media URLs are temporary.',
            code: errorCode,
            subcode: errorSubcode
          });
        }
        
        // Log actual errors (network issues, auth problems, etc.)
        console.error('Error getting media from WhatsApp API:', error.response?.data || error.message);
        return res.status(500).json({ 
          error: 'Failed to get media from WhatsApp',
          message: errorData?.error?.message || error.message
        });
      }
    }

  } catch (error) {
    console.error('Error getting media:', error);
    res.status(500).json({ error: 'Failed to get media' });
  }
};

// Edit WhatsApp message (new feature)
const editMessage = async (req, res) => {
  try {
    const { messageId, newMessage } = req.body;

    if (!messageId || !newMessage) {
      return res.status(400).json({ error: 'Message ID and new message are required' });
    }

    if (isDevelopmentMode) {
      // Mock response for development
      console.log('🔧 Mock edit message:', { messageId, newMessage });
      
      // Get current user from request (assuming it's passed in the request)
      const currentUserId = req.body.currentUserId || null;
      
      // Update the message in database
      const { error: updateError } = await supabase
        .from('whatsapp_messages')
        .update({ 
          message: newMessage,
          updated_at: new Date().toISOString(),
          is_edited: true,
          edited_at: new Date().toISOString(),
          edited_by: currentUserId
        })
        .eq('whatsapp_message_id', messageId);

      if (updateError) {
        console.error('Error updating message in database:', updateError);
        return res.status(500).json({ error: 'Failed to update message in database' });
      }

      return res.json({ 
        success: true, 
        message: 'Message edited successfully (MOCK MODE)' 
      });
    } else {
      // Edit message using WhatsApp API
      const editPayload = {
        messaging_product: 'whatsapp',
        status: 'edited',
        message: {
          message_id: messageId
        }
      };

      const response = await axios.post(
        `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages`,
        {
          ...editPayload,
          text: {
            body: newMessage
          }
        },
        {
          headers: {
            'Authorization': `Bearer ${ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
          }
        }
      );

      // Get current user from request (assuming it's passed in the request)
      const currentUserId = req.body.currentUserId || null;
      
      // Update message in database
      const { error: updateError } = await supabase
        .from('whatsapp_messages')
        .update({ 
          message: newMessage,
          updated_at: new Date().toISOString(),
          is_edited: true,
          edited_at: new Date().toISOString(),
          edited_by: currentUserId
        })
        .eq('whatsapp_message_id', messageId);

      if (updateError) {
        console.error('Error updating message in database:', updateError);
        return res.status(500).json({ error: 'Failed to update message in database' });
      }

      return res.json({ 
        success: true, 
        message: 'Message edited successfully' 
      });
    }

  } catch (error) {
    console.error('Error editing message:', error);
    res.status(500).json({ error: 'Failed to edit message' });
  }
};

// Delete WhatsApp message (new feature)
const deleteMessage = async (req, res) => {
  try {
    const { messageId, deleteForEveryone } = req.body;

    if (!messageId) {
      return res.status(400).json({ error: 'Message ID is required' });
    }

    if (isDevelopmentMode) {
      // Mock response for development
      console.log('🗑️ Mock delete message:', { messageId, deleteForEveryone });
      
      // Get current user from request
      const currentUserId = req.body.currentUserId || null;
      
      if (deleteForEveryone) {
        // Soft delete - mark as deleted for everyone
        const { error: updateError } = await supabase
          .from('whatsapp_messages')
          .update({ 
            is_deleted: true,
            deleted_for_everyone: true,
            deleted_at: new Date().toISOString(),
            deleted_by: currentUserId
          })
          .eq('whatsapp_message_id', messageId);

        if (updateError) {
          console.error('Error deleting message in database:', updateError);
          return res.status(500).json({ error: 'Failed to delete message in database' });
        }
      }

      return res.json({ 
        success: true, 
        message: 'Message deleted successfully (MOCK MODE)' 
      });
    } else {
      // Delete message using WhatsApp API
      const response = await axios.delete(
        `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages/${messageId}`,
        {
          headers: {
            'Authorization': `Bearer ${ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
          },
          data: {
            status: deleteForEveryone ? 'delete_for_everyone' : 'delete_for_me'
          }
        }
      );

      // Get current user from request
      const currentUserId = req.body.currentUserId || null;
      
      // Update message in database
      if (deleteForEveryone) {
        const { error: updateError } = await supabase
          .from('whatsapp_messages')
          .update({ 
            is_deleted: true,
            deleted_for_everyone: true,
            deleted_at: new Date().toISOString(),
            deleted_by: currentUserId
          })
          .eq('whatsapp_message_id', messageId);

        if (updateError) {
          console.error('Error deleting message in database:', updateError);
          return res.status(500).json({ error: 'Failed to delete message in database' });
        }
      }

      return res.json({ 
        success: true, 
        message: 'Message deleted successfully' 
      });
    }

  } catch (error) {
    console.error('Error deleting message:', error);
    res.status(500).json({ error: 'Failed to delete message' });
  }
};

// Get templates from WhatsApp API
const getTemplates = async (req, res) => {
  try {
    if (isDevelopmentMode) {
      // Mock templates for development
      console.log('📋 Mock templates for development');
      return res.json({
        success: true,
        templates: [
          {
            name: 'hello_world',
            language: 'en_US',
            status: 'APPROVED',
            category: 'UTILITY',
            components: [
              {
                type: 'BODY',
                text: 'Hello! Welcome to our service.'
              }
            ]
          }
        ]
      });
    }

    // Use the WhatsApp Business Account ID directly
    // From Meta Business Suite: asset_id=1290806625806976 is the WABA ID
    const WABA_ID = process.env.WHATSAPP_WABA_ID || '1290806625806976';
    console.log('✅ Using WABA ID:', WABA_ID);

    // Fetch templates from WhatsApp API using WABA ID
    const response = await axios.get(
      `${WHATSAPP_API_URL}/${WABA_ID}/message_templates`,
      {
        headers: {
          'Authorization': `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        },
        params: {
          limit: 100 // Get up to 100 templates
        }
      }
    );

    const templates = response.data.data || [];
    console.log('📋 Templates fetched from WhatsApp API:', templates.length);

    // Save templates to database
    if (templates.length > 0) {
      try {
        // Transform WhatsApp API template format to database format
        // Store the original WhatsApp template ID for reference
        const templatesToInsert = templates.map(template => {
          // Find the component text from the template structure
          const bodyComponent = template.components?.find(comp => comp.type === 'BODY');
          const textContent = bodyComponent?.text || '';
          
          // Count the number of variables in the template
          // WhatsApp uses {{1}}, {{2}}, etc. for variables
          const variableCount = (textContent.match(/\{\{\d+\}\}/g) || []).length;
          
          // Template has parameters if there are any variables
          const hasParams = variableCount > 0;
          
          console.log(`📋 Template: ${template.name}, Variables: ${variableCount}, HasParams: ${hasParams}`);
          
          return {
            whatsappTemplateId: template.id, // Store WhatsApp template ID separately
            name360: template.name || null,
            title: template.name || null,
            params: hasParams ? '1' : '0',
            active: template.status === 'APPROVED' ? 't' : 'f',
            category_id: null, // Don't save category as text - should be a foreign key ID
            content: textContent || null,
            language: template.language || null // Save the language field from WhatsApp API
          };
        });

        // Insert or update templates in database
        let newCount = 0;
        let updatedCount = 0;
        let skippedCount = 0;
        
        for (const template of templatesToInsert) {
          try {
            // Check if template exists by number_id (WhatsApp template ID)
            const { data: existingTemplate } = await supabase
              .from('whatsapp_whatsapptemplate')
              .select('id')
              .eq('number_id', template.whatsappTemplateId)
              .single();

            // Prepare template data with number_id as WhatsApp template ID
            const templateData = {
              id: Number(template.whatsappTemplateId) % 2147483647, // Use a portion of WhatsApp ID as our ID (within int range)
              number_id: template.whatsappTemplateId, // WhatsApp template ID
              name360: template.name360,
              title: template.title,
              params: template.params,
              active: template.active,
              category_id: template.category_id,
              content: template.content,
              language: template.language || 'en_US' // Save language field, default to en_US
            };

            if (existingTemplate) {
              // Skip if template already exists (don't update)
              skippedCount++;
              console.log(`⏭️  Skipping existing template: ${template.title} (${template.whatsappTemplateId})`);
            } else {
              // Insert new template - use number_id % max_int as id
              const { error: insertError } = await supabase
                .from('whatsapp_whatsapptemplate')
                .insert(templateData);

              if (insertError) {
                console.error(`❌ Error inserting template ${template.whatsappTemplateId}:`, insertError);
              } else {
                newCount++;
                console.log(`✅ Inserted new template: ${template.title} (${template.whatsappTemplateId})`);
              }
            }
          } catch (dbError) {
            console.error(`❌ Error processing template ${template.whatsappTemplateId}:`, dbError);
          }
        }

        console.log(`✅ Saved ${newCount} new templates to database (${skippedCount} skipped, ${updatedCount} updated)`);
      } catch (dbError) {
        console.error('❌ Error saving templates to database:', dbError);
        // Continue even if database save fails
      }
    }

    return res.json({
      success: true,
      templates: templates
    });
  } catch (error) {
    console.error('Error fetching templates:', error);
    
    // Log detailed error information
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
      console.error('Response headers:', error.response.headers);
    } else if (error.request) {
      console.error('Request details:', error.request);
    }
    
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch templates',
      details: error.response?.data || error.message,
      status: error.response?.status
    });
  }
};

// Sync templates from WhatsApp API to database
const syncTemplates = async (req, res) => {
  try {
    console.log('🔄 Sync templates request received');
    
    const templateSyncService = require('../services/whatsappTemplateSyncService');
    const result = await templateSyncService.syncTemplatesToDatabase();
    
    if (result.success) {
      res.json({
        success: true,
        message: `Sync complete: ${result.new} new, ${result.updated} updated, ${result.skipped} skipped`,
        ...result
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error || 'Failed to sync templates'
      });
    }
  } catch (error) {
    console.error('❌ Error in syncTemplates:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to sync templates'
    });
  }
};

module.exports = {
  verifyWebhook,
  handleWebhook,
  sendMessage,
  sendMedia,
  getMessageStatus,
  getConversation,
  findLeadsByPhone,
  uploadMedia,
  getMedia,
  updateMessageStatus,
  editMessage,
  deleteMessage,
  getTemplates,
  syncTemplates
}; 