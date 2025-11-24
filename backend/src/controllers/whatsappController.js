const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

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
          .select('id, name, lead_number, phone, mobile')
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
          .select('id, name')
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
          .select('id, name, lead_number, phone, mobile')
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
    const { data: allLeads, error: allLeadsError } = await supabase
      .from('leads')
      .select('id, name, lead_number, phone, mobile')
      .not('phone', 'is', null)
      .not('phone', 'eq', '');
    
    if (allLeadsError) {
      console.error('Error fetching leads:', allLeadsError);
      return;
    }
    
    // Find lead by normalized phone number comparison
    let lead = null;
    let legacyLead = null;
    for (const potentialLead of allLeads) {
      const leadPhoneNormalized = normalizePhone(potentialLead.phone);
      const leadMobileNormalized = normalizePhone(potentialLead.mobile);
      
      // Check if any variation matches
      let foundMatch = false;
      let matchType = '';
      
      for (const variation of incomingVariations) {
        if (leadPhoneNormalized === variation || leadMobileNormalized === variation) {
          foundMatch = true;
          matchType = leadPhoneNormalized === variation ? 'phone' : 'mobile';
          break;
        }
      }
      
      if (foundMatch) {
        lead = potentialLead;
        break;
      }
    }

    // Attempt to match contact/lead relationship by contact phone if direct lead lookup failed
    let contactId = null;
    if (!lead) {
      const contactMatch = await findLeadAndContactByPhone(phoneNumber, incomingVariations, incomingNormalized);
      if (contactMatch) {
        contactId = contactMatch.contactId;
        if (contactMatch.leadType === 'new' && contactMatch.leadData) {
          lead = contactMatch.leadData;
        } else if (contactMatch.leadType === 'legacy' && contactMatch.leadData) {
          legacyLead = contactMatch.leadData;
        }
      }
    }

    // Find the contact profile for this phone number from webhook contacts
    const contactProfile = webhookContacts.find(contact => contact.wa_id === phoneNumber);
    const profileName = contactProfile?.profile?.name;

    // Log profile information for debugging
    console.log('🔍 WhatsApp message profile info:', {
      phoneNumber,
      webhookContacts: webhookContacts.length,
      contactProfile: !!contactProfile,
      profileName,
      leadFound: !!lead,
      leadName: lead?.name
    });

    // Determine the best sender name to use
    let senderName;
    if (lead) {
      senderName = lead.name || 'Unknown Client';
    } else if (legacyLead) {
      senderName = legacyLead.name || 'Unknown Client';
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

    // Find contact by phone number if not already determined
    if ((lead || legacyLead) && !contactId) {
      const isLegacyLead = !!legacyLead && !lead;
      const leadIdForQuery = isLegacyLead ? legacyLead.id : lead.id;

      // First, get all contacts for this lead
      let leadContactsQuery = supabase
        .from('lead_leadcontact')
        .select('contact_id, main');
      
      if (isLegacyLead) {
        leadContactsQuery = leadContactsQuery.eq('lead_id', leadIdForQuery);
      } else {
        leadContactsQuery = leadContactsQuery.eq('newlead_id', leadIdForQuery);
      }
      
      const { data: leadContacts, error: leadContactsError } = await leadContactsQuery;
      
      if (!leadContactsError && leadContacts && leadContacts.length > 0) {
        const contactIds = leadContacts.map(lc => lc.contact_id).filter(Boolean);
        
        // Get contact details
        const { data: contacts, error: contactsError } = await supabase
          .from('leads_contact')
          .select('id, phone, mobile')
          .in('id', contactIds);
        
        if (!contactsError && contacts && contacts.length > 0) {
          // Find the contact that matches the phone number
          for (const contact of contacts) {
            const contactPhoneNormalized = normalizePhone(contact.phone || '');
            const contactMobileNormalized = normalizePhone(contact.mobile || '');
            
            for (const variation of incomingVariations) {
              if (contactPhoneNormalized === variation || contactMobileNormalized === variation) {
                contactId = contact.id;
                console.log(`✅ Found matching contact ${contact.id} for phone ${phoneNumber}`);
                break;
              }
            }
            if (contactId) break;
          }
        }
        
        // If no contact found by phone match, try matching by last 4 digits (fallback)
        if (!contactId && contacts && contacts.length > 0) {
          const incomingLast4 = incomingNormalized.slice(-4);
          if (incomingLast4.length >= 4) {
            for (const contact of contacts) {
              const contactPhoneNormalized = normalizePhone(contact.phone || '');
              const contactMobileNormalized = normalizePhone(contact.mobile || '');
              const contactPhoneLast4 = contactPhoneNormalized.slice(-4);
              const contactMobileLast4 = contactMobileNormalized.slice(-4);
              
              if ((contactPhoneLast4 === incomingLast4 && contactPhoneLast4.length >= 4) ||
                  (contactMobileLast4 === incomingLast4 && contactMobileLast4.length >= 4)) {
                contactId = contact.id;
                console.log(`✅ Found matching contact ${contact.id} by last 4 digits (${incomingLast4}) for phone ${phoneNumber}`);
                break;
              }
            }
          }
        }
        
        // If still no contact found, use the main contact
        if (!contactId) {
          const mainContactRel = leadContacts.find(lc => lc.main === true || lc.main === 't');
          if (mainContactRel) {
            contactId = mainContactRel.contact_id;
            console.log(`✅ Using main contact ${contactId} for lead ${leadIdForQuery}`);
          }
        }
      }
    }

    // Prepare message data - handle both known and unknown leads
    let messageData = {
      lead_id: lead ? lead.id : null, // null for unknown leads
      legacy_id: legacyLead ? legacyLead.id : null,
      contact_id: contactId, // Add contact_id
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
      caption: null
    };
    
    // Update the lead's phone number if it's a known lead and doesn't match exactly
    if (lead && lead.phone !== phoneNumber && lead.mobile !== phoneNumber) {
      await supabase
        .from('leads')
        .update({ phone: phoneNumber })
        .eq('id', lead.id);
    }

    const mediaOwnerIdentifier = lead
      ? lead.id
      : legacyLead
        ? `legacy_${legacyLead.id}`
        : phoneNumber;

    // Handle different message types
    switch (type) {
      case 'text':
        messageData.message = text.body;
        break;
      
      case 'image':
        messageData.message = image.caption || '';
        messageData.media_id = image.id;
        messageData.media_url = image.id; // Set media_url to WhatsApp media ID
        messageData.media_mime_type = image.mime_type;
        messageData.media_size = image.file_size;
        messageData.caption = image.caption;
        // Download and store image (use phone number as fallback for unknown leads)
        await downloadAndStoreMedia(image.id, 'image', mediaOwnerIdentifier);
        break;
      
      case 'document':
        messageData.message = document.filename;
        messageData.media_id = document.id;
        messageData.media_url = document.id; // Set media_url to WhatsApp media ID
        messageData.media_filename = document.filename;
        messageData.media_mime_type = document.mime_type;
        messageData.media_size = document.file_size;
        // Download and store document (use phone number as fallback for unknown leads)
        await downloadAndStoreMedia(document.id, 'document', mediaOwnerIdentifier);
        break;
      
      case 'audio':
        messageData.message = 'Audio message';
        messageData.media_id = audio.id;
        messageData.media_url = audio.id; // Set media_url to WhatsApp media ID
        messageData.media_mime_type = audio.mime_type;
        messageData.media_size = audio.file_size;
        await downloadAndStoreMedia(audio.id, 'audio', mediaOwnerIdentifier);
        break;
      
      case 'video':
        messageData.message = video.caption || 'Video message';
        messageData.media_id = video.id;
        messageData.media_url = video.id; // Set media_url to WhatsApp media ID
        messageData.media_mime_type = video.mime_type;
        messageData.media_size = video.file_size;
        messageData.caption = video.caption;
        await downloadAndStoreMedia(video.id, 'video', mediaOwnerIdentifier);
        break;
      
      case 'location':
        messageData.message = `Location: ${location.latitude}, ${location.longitude}`;
        messageData.message_type = 'location';
        break;
      
      case 'contacts':
        messageData.message = 'Contact shared';
        messageData.message_type = 'contact';
        break;
      
      case 'button':
        // Handle button response from template message
        messageData.message = `Button clicked: ${button.payload}`;
        messageData.message_type = 'button_response';
        console.log('🔘 Button response received:', {
          buttonId: button.id,
          payload: button.payload,
          phoneNumber,
          leadName: lead?.name
        });
        
        // Handle specific button actions based on payload
        if (button.payload === 'RESCHEDULE' || button.payload === 'reschedule') {
          messageData.message = '📅 Client clicked "Reschedule" button';
          console.log('📅 Reschedule request from:', lead?.name || phoneNumber);
          
          // You can add custom logic here, such as:
          // - Creating a meeting/call scheduled event
          // - Sending a notification to the case manager
          // - Updating the lead status
        }
        break;
      
      case 'interactive':
        // Handle interactive messages (buttons, lists)
        if (interactive?.type === 'button_reply') {
          messageData.message = `Button clicked: ${interactive.button_reply.title}`;
          messageData.message_type = 'button_response';
          console.log('🔘 Interactive button clicked:', {
            buttonText: interactive.button_reply.title,
            buttonId: interactive.button_reply.id,
            phoneNumber,
            leadName: lead?.name
          });
        } else if (interactive?.type === 'list_reply') {
          messageData.message = `List option selected: ${interactive.list_reply.title}`;
          messageData.message_type = 'list_response';
          console.log('📋 List option selected:', {
            optionText: interactive.list_reply.title,
            optionId: interactive.list_reply.id,
            phoneNumber,
            leadName: lead?.name
          });
        }
        break;
    }

    // Save message to database
    const { error: insertError } = await supabase
      .from('whatsapp_messages')
      .insert([messageData]);

    if (insertError) {
      console.error('Error saving incoming message:', insertError);
    } else {
      if (lead) {
        console.log(`✅ Saved message from known lead: ${lead.name} (${phoneNumber})`);
      } else if (legacyLead) {
        console.log(`✅ Saved message from legacy lead: ${legacyLead.name || legacyLead.id} (${phoneNumber})`);
      } else {
        console.log(`🆕 Saved message from NEW LEAD: ${senderName} (${phoneNumber}) - This will appear on WhatsApp Leads page!`);
      }
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
    console.log('📨 Received send message request:', { 
      leadId: req.body.leadId, 
      phoneNumber: req.body.phoneNumber, 
      messageLength: req.body.message?.length, 
      isTemplate: req.body.isTemplate,
      templateName: req.body.templateName,
      templateParameters: req.body.templateParameters
    });
    const { leadId, message, phoneNumber, isTemplate, templateName, templateLanguage, templateParameters, contactId } = req.body;

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
        console.log('📱 Sending TEMPLATE message');
        console.log('📱 Template Name:', templateName);
        console.log('📱 Template Language:', templateLanguage);
        console.log('📱 Template Language Code:', templateLanguage || 'en_US');
        console.log('📱 Template Parameters:', templateParameters);
        
        // Send template message
        messagePayload = {
          messaging_product: 'whatsapp',
          to: phoneNumber,
          type: 'template',
          template: {
            name: templateName || 'second_test',
            language: {
              code: templateLanguage || 'en_US'
            }
          }
        };
        
        // Always add components section if template parameters are expected
        // If no parameters provided, use default values
        if (templateParameters && templateParameters.length > 0) {
          console.log('📱 Template has user-provided parameters, using them');
          messagePayload.template.components = [
            {
              type: 'body',
              parameters: templateParameters
            }
          ];
        } else {
          // No parameters provided - check if this template needs parameters based on template name
          // If template is "missed_appointment", it needs 2 parameters
          if (templateName === 'missed_appointment') {
            console.log('📱 No params provided for missed_appointment - sending 2 default parameters');
            messagePayload.template.components = [
              {
                type: 'body',
                parameters: [
                  { type: 'text', text: 'Customer' },
                  { type: 'text', text: 'Appointment' }
                ]
              }
            ];
          } else {
            // For other templates, don't add components section
            console.log('📱 Sending template without components section');
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

    // Save message to database
    const messageData = {
      lead_id: leadId === null ? null : (isLegacyLead ? null : leadId), // Set to null for new WhatsApp leads and legacy leads
      legacy_id: isLegacyLead ? lead.id : null, // Set legacy_id for legacy leads
      contact_id: contactId || null, // Store contact_id if provided
      phone_number: phoneNumber, // Store phone number for new WhatsApp leads
      sender_name: req.body.sender_name || 'You',
      direction: 'out',
      message: isTemplate ? `[Template: ${templateName}] ${templateParameters?.[0]?.text || ''}` : message,
      sent_at: new Date().toISOString(),
      whatsapp_message_id: whatsappMessageId,
      whatsapp_status: 'pending', // Start as pending, will be updated by webhook
      message_type: 'text', // Always use 'text' as the database doesn't support 'template' type
      whatsapp_timestamp: new Date().toISOString()
    };

    // Log the message data being saved
    console.log('💾 Saving message to database:', JSON.stringify(messageData, null, 2));
    
    const { error: insertError } = await supabase
      .from('whatsapp_messages')
      .insert([messageData]);

    if (insertError) {
      console.error('❌ Error saving outgoing message:', insertError);
      console.error('❌ Error details:', JSON.stringify(insertError, null, 2));
      return res.status(500).json({ error: 'Failed to save message', details: insertError.message });
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
      sender_name: req.body.sender_name || 'You',
      direction: 'out',
      message: caption || `${mediaType} message`,
      sent_at: new Date().toISOString(),
      whatsapp_message_id: whatsappMessageId,
      whatsapp_status: 'pending', // Start as pending, will be updated by webhook
      message_type: mediaType,
      media_url: mediaUrl,
      caption: caption
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
        console.error('Error getting media from WhatsApp API:', error.response?.data || error.message);
        
        // If it's a 400 error (media not found), return a proper error
        if (error.response?.status === 400) {
          return res.status(404).json({ 
            error: 'Media not found or no longer available',
            details: error.response.data?.error?.message || 'Media ID does not exist'
          });
        }
        
        return res.status(500).json({ error: 'Failed to get media from WhatsApp' });
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
  getTemplates
}; 