const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const pushNotificationService = require('../services/pushNotificationService');
const pexCrmChatWebhookService = require('../services/pexCrmChatWebhookService');
const {
  canonicalWhatsAppPhone,
  digitsOnlyPhone,
  collectWhatsAppPhoneVariants,
  whatsAppPhoneLookupNeedle,
} = require('../lib/whatsappPhone');

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

/** WhatsApp Cloud API rejects newlines (and similar) in template body variables — causes HTTP 400. */
function sanitizeWhatsAppTemplateVariableText(text) {
  if (text == null || typeof text !== 'string') return '';
  let s = text;
  s = s.replace(/\\r\\n/g, ' ').replace(/\\n/g, ' ').replace(/\\r/g, ' ');
  s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  s = s
    .split(/\n+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .join(', ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function isStatementTimeoutError(error) {
  const msg = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`.toLowerCase();
  const code = String(error?.code || '');
  return code === '57014' || msg.includes('statement timeout') || msg.includes('canceling statement');
}

function rpcMissing(error) {
  const msg = String(error?.message || '').toLowerCase();
  return msg.includes('could not find the function') || msg.includes('schema cache');
}

function normalizeInsertedRows(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (typeof data === 'object') return [data];
  return [];
}

/**
 * Persist a WhatsApp row without blocking on stage-eval / MV triggers.
 * Prefers insert_whatsapp_message (skips triggers). Falls back to table insert.
 */
async function insertWhatsAppMessage(messageData) {
  const payload = { p_row: messageData };
  let rpcData = null;
  let rpcError = null;

  ({ data: rpcData, error: rpcError } = await supabase.rpc('insert_whatsapp_message', payload));
  if (rpcError && rpcMissing(rpcError)) {
    ({ data: rpcData, error: rpcError } = await supabase.rpc('insert_whatsapp_outgoing', payload));
  }

  if (!rpcError && rpcData) {
    return { data: normalizeInsertedRows(rpcData), error: null };
  }

  if (rpcError && !rpcMissing(rpcError) && !isStatementTimeoutError(rpcError)) {
    console.warn('insert_whatsapp_message RPC failed, falling back to table insert:', rpcError.message);
  } else if (rpcError && isStatementTimeoutError(rpcError)) {
    console.warn('insert_whatsapp_message RPC timed out, falling back to table insert:', rpcError.message);
  }

  const { data, error } = await supabase
    .from('whatsapp_messages')
    .insert([messageData])
    .select('id, template_id, whatsapp_message_id');

  return { data: normalizeInsertedRows(data), error };
}

async function insertWhatsAppMessageRows(rows) {
  const inserted = [];
  let lastError = null;
  for (const row of rows) {
    const result = await insertWhatsAppMessage(row);
    if (result.error) {
      lastError = result.error;
      console.error('Error saving WhatsApp row:', {
        phoneNumber: row.phone_number,
        leadId: row.lead_id,
        contactId: row.contact_id,
        direction: row.direction,
        error: result.error,
      });
      continue;
    }
    inserted.push(...result.data);
  }
  if (inserted.length === 0 && lastError) {
    return { data: [], error: lastError };
  }
  // Partial fan-out: return the error so Meta retries. Duplicate handling skips
  // identities that already exist and inserts the rest.
  return { data: inserted, error: lastError };
}

async function insertOutgoingWhatsAppMessage(messageData) {
  return insertWhatsAppMessage(messageData);
}

function withTimeout(promise, ms, fallback) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        resolve({ data: [], error });
      },
    );
  });
}

/** Don't hold the Send response for the 8s DB statement timeout. */
async function insertOutgoingWhatsAppMessageBounded(messageData, waitMs = 2500) {
  const savePromise = insertOutgoingWhatsAppMessage(messageData);
  const raced = await withTimeout(savePromise, waitMs, {
    data: [],
    error: {
      message: 'save-wait-timeout',
      details: 'canceling statement due to statement timeout',
    },
  });

  if (raced?.error?.message === 'save-wait-timeout') {
    savePromise
      .then((result) => {
        if (result.error) {
          console.error('Background WhatsApp save failed:', result.error);
        } else {
          console.log('Background WhatsApp save completed:', result.data?.[0]?.id);
        }
      })
      .catch((err) => console.error('Background WhatsApp save rejected:', err));
  }

  return raced;
}

function respondWhatsAppSent(res, responseData, insertResult) {
  const { data, error } = insertResult;
  if (error) {
    console.error('❌ Error saving outgoing message after WhatsApp dispatch:', error);
    return res.status(200).json({
      ...responseData,
      saved: false,
      saveError: error.message,
      warning:
        'Message was sent on WhatsApp but the CRM save timed out. Refresh if it does not appear.',
    });
  }

  const row = data?.[0];
  if (row?.id) {
    responseData.rowId = row.id;
  }
  return res.status(200).json({
    ...responseData,
    saved: true,
  });
}

// Helper utilities
const normalizePhone = (phone) => {
  if (!phone || phone === null || phone === '') return '';
  return canonicalWhatsAppPhone(phone) || digitsOnlyPhone(phone);
};

const NEW_LEAD_MATCH_SELECT =
  'id, name, lead_number, phone, mobile, scheduler, closer, handler, meeting_manager_id, expert_id, meeting_lawyer_id, case_handler_id';
const LEGACY_LEAD_MATCH_SELECT =
  'id, name, phone, mobile, meeting_scheduler_id, meeting_manager_id, meeting_lawyer_id, expert_id, closer_id, case_handler_id';

function leadPhonesMatchIncoming(lead, incomingNormalized, incomingVariations) {
  const np = normalizePhone(lead?.phone);
  const nm = normalizePhone(lead?.mobile);
  if (incomingNormalized && (np === incomingNormalized || nm === incomingNormalized)) return true;
  return (incomingVariations || []).some((variation) => {
    const nv = normalizePhone(variation);
    return (np && (np === variation || np === nv)) || (nm && (nm === variation || nm === nv));
  });
}

async function findMatchingLeadsForInboundPhone(incomingNormalized, incomingVariations) {
  const matchingLeads = [];
  const seen = new Set();
  const push = (type, data) => {
    if (!data?.id) return;
    const key = `${type}:${data.id}`;
    if (seen.has(key)) return;
    if (!leadPhonesMatchIncoming(data, incomingNormalized, incomingVariations)) return;
    seen.add(key);
    matchingLeads.push({ type, data });
  };

  const values = [...new Set([
    ...(incomingVariations || []),
    incomingNormalized,
    ...collectWhatsAppPhoneVariants([incomingNormalized, ...(incomingVariations || [])]),
  ].filter(Boolean))];
  if (values.length) {
    const [{ data: byPhone }, { data: byMobile }, { data: legPhone }, { data: legMobile }] = await Promise.all([
      supabase.from('leads').select(NEW_LEAD_MATCH_SELECT).in('phone', values),
      supabase.from('leads').select(NEW_LEAD_MATCH_SELECT).in('mobile', values),
      supabase.from('leads_lead').select(LEGACY_LEAD_MATCH_SELECT).in('phone', values),
      supabase.from('leads_lead').select(LEGACY_LEAD_MATCH_SELECT).in('mobile', values),
    ]);
    (byPhone || []).forEach((lead) => push('new', lead));
    (byMobile || []).forEach((lead) => push('new', lead));
    (legPhone || []).forEach((lead) => push('legacy', lead));
    (legMobile || []).forEach((lead) => push('legacy', lead));
  }

  if (matchingLeads.length === 0 && incomingNormalized && incomingNormalized.length >= 7) {
    const last8Digits = incomingNormalized.length >= 8 ? incomingNormalized.slice(-8) : '';
    const last7Digits = whatsAppPhoneLookupNeedle(incomingNormalized);
    const needles = [...new Set([last8Digits, last7Digits].filter((n) => n && n.length >= 6))];
    const orFilter = needles
      .flatMap((needle) => [`phone.ilike.%${needle}%`, `mobile.ilike.%${needle}%`])
      .join(',');
    const [{ data: newLeadsByLast8 }, { data: legacyLeadsByLast8 }] = await Promise.all([
      supabase.from('leads').select(NEW_LEAD_MATCH_SELECT).or(orFilter),
      supabase.from('leads_lead').select(LEGACY_LEAD_MATCH_SELECT).or(orFilter),
    ]);
    (newLeadsByLast8 || []).forEach((lead) => push('new', lead));
    (legacyLeadsByLast8 || []).forEach((lead) => push('legacy', lead));
  }

  return matchingLeads;
}

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
    // IMPORTANT: push_subscriptions.user_id references auth.users.id, not users.id
    // So we need to get auth_id from users table (which is auth.users.id)
    const userIds = new Set();
    
    if (employeeIds.size > 0) {
      const employeeIdsArray = Array.from(employeeIds);
      const { data: users, error: usersError } = await supabase
        .from('users')
        .select('id, employee_id, auth_id')
        .in('employee_id', employeeIdsArray);

      if (!usersError && users) {
        users.forEach(user => {
          // Use auth_id (auth.users.id) instead of id (users.id)
          // because push_subscriptions.user_id references auth.users.id
          const authUserId = user.auth_id || user.id;
          if (authUserId) {
            userIds.add(authUserId);
            if (user.id !== authUserId) {
              console.log(`🔄 Mapped user.id ${user.id} to auth_id ${authUserId} for push notifications`);
            }
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
        .concat(collectWhatsAppPhoneVariants([phoneNumber, incomingNormalized, ...incomingVariations]))
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

    // Store direct lead matches for fallback if no contacts found
    let directNewLeadMatch = null;
    let directLegacyLeadMatch = null;

    // If no exact matches found, try last 8 then last 7 (dashed Israeli numbers)
    if (!contactCandidatesMap.size && incomingNormalized && incomingNormalized.length >= 7) {
      const last8Digits = incomingNormalized.length >= 8 ? incomingNormalized.slice(-8) : '';
      const last7Digits = whatsAppPhoneLookupNeedle(incomingNormalized);
      const needles = [...new Set([last8Digits, last7Digits].filter((n) => n && n.length >= 6))];
      const contactOrFilter = needles
        .flatMap((needle) => [
          `phone.ilike.%${needle}%`,
          `mobile.ilike.%${needle}%`,
          `additional_phones.ilike.%${needle}%`,
        ])
        .join(',');
      const leadOrFilter = needles
        .flatMap((needle) => [`phone.ilike.%${needle}%`, `mobile.ilike.%${needle}%`])
        .join(',');
      
      // Search in leads_contact table with last 8 / last 7 digits
      // This will find contacts that match, and we'll use lead_leadcontact to find associated leads
      const { data: contactPartialMatches } = await supabase
        .from('leads_contact')
        .select(contactSelectColumns)
        .or(contactOrFilter);
      if (contactPartialMatches) addContacts(contactPartialMatches);
      
      // Also search via lead_leadcontact junction table to find leads associated with matching contacts
      // First, find all contacts matching last 8 / last 7 digits
      const { data: matchingContactsByLast8 } = await supabase
        .from('leads_contact')
        .select('id')
        .or(contactOrFilter);
      
      if (matchingContactsByLast8 && matchingContactsByLast8.length > 0) {
        const matchingContactIds = matchingContactsByLast8.map(c => c.id);
        
        // Find all leads (new and legacy) linked to these contacts via lead_leadcontact
        const { data: linkedLeadsViaContacts } = await supabase
          .from('lead_leadcontact')
          .select('newlead_id, lead_id')
          .in('contact_id', matchingContactIds);
        
        if (linkedLeadsViaContacts && linkedLeadsViaContacts.length > 0) {
          // Get unique new lead IDs
          const newLeadIds = [...new Set(linkedLeadsViaContacts
            .filter(ll => ll.newlead_id)
            .map(ll => ll.newlead_id)
          )];
          
          // Get unique legacy lead IDs
          const legacyLeadIds = [...new Set(linkedLeadsViaContacts
            .filter(ll => ll.lead_id)
            .map(ll => ll.lead_id)
          )];
          
          // Fetch the actual new leads
          if (newLeadIds.length > 0) {
            const { data: newLeadsFromContacts } = await supabase
              .from('leads')
              .select('id, name, lead_number, phone, mobile, scheduler, closer, handler, meeting_manager_id, expert_id, meeting_lawyer_id, case_handler_id')
              .in('id', newLeadIds);
            
            if (newLeadsFromContacts && newLeadsFromContacts.length > 0 && !directNewLeadMatch) {
              directNewLeadMatch = newLeadsFromContacts[0];
            }
          }
          
          // Fetch the actual legacy leads
          if (legacyLeadIds.length > 0) {
            const { data: legacyLeadsFromContacts } = await supabase
              .from('leads_lead')
              .select('id, name, phone, mobile, meeting_scheduler_id, meeting_manager_id, meeting_lawyer_id, expert_id, closer_id, case_handler_id')
              .in('id', legacyLeadIds);
            
            if (legacyLeadsFromContacts && legacyLeadsFromContacts.length > 0 && !directLegacyLeadMatch) {
              directLegacyLeadMatch = legacyLeadsFromContacts[0];
            }
          }
        }
      }
      
      // Also search directly in leads table (new leads) for phone and mobile columns
      // This catches leads that might not have contacts linked yet
      if (!directNewLeadMatch) {
        const { data: newLeadsMatches } = await supabase
          .from('leads')
          .select('id, name, lead_number, phone, mobile, scheduler, closer, handler, meeting_manager_id, expert_id, meeting_lawyer_id, case_handler_id')
          .or(leadOrFilter)
          .limit(1);
        
        if (newLeadsMatches && newLeadsMatches.length > 0) {
          directNewLeadMatch = newLeadsMatches[0];
          
          // Try to find associated contacts via lead_leadcontact
          const { data: linkedContacts } = await supabase
            .from('lead_leadcontact')
            .select('contact_id')
            .eq('newlead_id', directNewLeadMatch.id);
          
          if (linkedContacts && linkedContacts.length > 0) {
            const contactIds = linkedContacts.map(lc => lc.contact_id);
            const { data: contacts } = await supabase
              .from('leads_contact')
              .select(contactSelectColumns)
              .in('id', contactIds);
            if (contacts) addContacts(contacts);
          }
        }
      }
      
      // Also search directly in leads_lead table (legacy leads) for phone and mobile columns
      // This catches legacy leads that might not have contacts linked yet
      if (!directLegacyLeadMatch) {
        const { data: legacyLeadsMatches } = await supabase
          .from('leads_lead')
          .select('id, name, phone, mobile, meeting_scheduler_id, meeting_manager_id, meeting_lawyer_id, expert_id, closer_id, case_handler_id')
          .or(leadOrFilter)
          .limit(1);
        
        if (legacyLeadsMatches && legacyLeadsMatches.length > 0) {
          directLegacyLeadMatch = legacyLeadsMatches[0];
          
          // Try to find associated contacts via lead_leadcontact
          const { data: linkedContacts } = await supabase
            .from('lead_leadcontact')
            .select('contact_id')
            .eq('lead_id', directLegacyLeadMatch.id);
          
          if (linkedContacts && linkedContacts.length > 0) {
            const contactIds = linkedContacts.map(lc => lc.contact_id);
            const { data: contacts } = await supabase
              .from('leads_contact')
              .select(contactSelectColumns)
              .in('id', contactIds);
            if (contacts) addContacts(contacts);
          }
        }
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

    // If no contacts found but we found leads directly via last 8 digits matching,
    // return the first matching lead
    if (!contactCandidatesMap.size) {
      if (directNewLeadMatch) {
        return {
          contact: null,
          contactId: null,
          leadData: directNewLeadMatch,
          leadType: 'new'
        };
      }
      
      if (directLegacyLeadMatch) {
        return {
          contact: null,
          contactId: null,
          leadData: directLegacyLeadMatch,
          leadType: 'legacy'
        };
      }
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
    
    let persistFailed = false;
    if (body.object === 'whatsapp_business_account') {
      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          const value = change.value || {};

          console.log('🔍 Webhook value structure:', {
            hasMessages: !!value.messages,
            messagesLength: value.messages?.length,
            hasContacts: !!value.contacts,
            contactsLength: value.contacts?.length,
            hasStatuses: !!value.statuses,
            statusesLength: value.statuses?.length,
            from: value.messages?.map((m) => m.from) || [],
          });

          const contacts = value.contacts || [];
          if (contacts.length > 0) {
            console.log('🔍 Webhook contacts:', contacts.map((c) => ({
              wa_id: c.wa_id,
              profileName: c.profile?.name,
            })));
          }

          for (const message of value.messages || []) {
            const saved = await processIncomingMessage(message, contacts);
            if (saved === false) persistFailed = true;
          }

          for (const status of value.statuses || []) {
            await updateMessageStatus(status);
          }
        }
      }
    }
    
    if (persistFailed) {
      console.error('❌ Inbound WhatsApp persist failed; returning 500 so Meta retries');
      return res.status(500).json({ error: 'Failed to persist inbound WhatsApp message' });
    }
    res.sendStatus(200);
  } catch (error) {
    console.error('❌ Error handling webhook:', error);
    res.sendStatus(500);
  }
};

// Process incoming message
const processIncomingMessage = async (message, webhookContacts = []) => {
  let inboundSaved = false;
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
      interactive,
      sticker,
      reaction,
      errors,
    } = message;

    // Existing copies of this Meta id (fan-out writes one row per lead). Skip those
    // identities later; do not abort the whole webhook or remaining leads never save.
    const existingIdentityKeys = new Set();
    if (whatsappMessageId) {
      const { data: existingMessages, error: checkError } = await supabase
        .from('whatsapp_messages')
        .select('id, lead_id, legacy_id')
        .eq('whatsapp_message_id', whatsappMessageId);

      if (!checkError && existingMessages) {
        for (const row of existingMessages) {
          if (row.lead_id) existingIdentityKeys.add(`new:${row.lead_id}`);
          else if (row.legacy_id) existingIdentityKeys.add(`legacy:${row.legacy_id}`);
          else existingIdentityKeys.add('unmatched');
        }
      }
    }

    // Find lead by phone number (handle various formats)
    const phoneWithoutCountry = phoneNumber.replace(/^972/, '');
    const phoneWithCountry = phoneNumber.startsWith('972') ? phoneNumber : `972${phoneNumber}`;
    const phoneWithPlus = phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber}`;
    const phoneWithoutPlus = phoneNumber.replace(/^\+/, '');

    // Create multiple variations of the incoming phone number
    const incomingNormalized = normalizePhone(phoneNumber);
    const extraTrunkZero =
      incomingNormalized.startsWith('972') && incomingNormalized.length >= 12
        ? `9720${incomingNormalized.slice(3)}`
        : '';
    const incomingVariations = [
      incomingNormalized,
      digitsOnlyPhone(phoneNumber),
      phoneNumber,
      incomingNormalized.replace(/^972/, ''),
      incomingNormalized.replace(/^00972/, ''),
      incomingNormalized.replace(/^0/, ''),
      `972${incomingNormalized.replace(/^972/, '')}`,
      `0${incomingNormalized.replace(/^0/, '')}`,
      incomingNormalized.replace(/^972/, '0'),
      incomingNormalized.replace(/^0/, '972'),
      extraTrunkZero,
      incomingNormalized ? `+${incomingNormalized}` : '',
      ...collectWhatsAppPhoneVariants([phoneNumber, incomingNormalized]),
    ].filter(Boolean);
    

    
    const matchingLeads = await findMatchingLeadsForInboundPhone(incomingNormalized, incomingVariations);

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
    
    // If no exact contact matches found, try last 8 then last 7 (dashed Israeli numbers)
    if (allContactsMap.size === 0 && incomingNormalized && incomingNormalized.length >= 7) {
      const last8Digits = incomingNormalized.length >= 8 ? incomingNormalized.slice(-8) : '';
      const last7Digits = whatsAppPhoneLookupNeedle(incomingNormalized);
      const needles = [...new Set([last8Digits, last7Digits].filter((n) => n && n.length >= 6))];
      const contactOrFilter = needles
        .flatMap((needle) => [
          `phone.ilike.%${needle}%`,
          `mobile.ilike.%${needle}%`,
          `additional_phones.ilike.%${needle}%`,
        ])
        .join(',');
      
      // Search in leads_contact table with last 8 / last 7 digits
      const { data: contactPartialMatches } = await supabase
        .from('leads_contact')
        .select('id, name, phone, mobile, additional_phones, newlead_id, lead_leadcontact(lead_id, newlead_id, main)')
        .or(contactOrFilter);
      
      if (contactPartialMatches) {
        contactPartialMatches.forEach(contact => {
          const contactPhones = [
            contact.phone,
            contact.mobile,
            ...parseAdditionalPhones(contact.additional_phones || ''),
          ].filter(Boolean);
          const hasCanonicalMatch = contactPhones.some((number) =>
            incomingVariations.some((variation) => normalizePhone(variation) === normalizePhone(number)),
          );
          if (hasCanonicalMatch && !allContactsMap.has(contact.id)) {
            allContactsMap.set(contact.id, contact);
          }
        });
      }
    }

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
      totalMatchingLeads: matchingLeads.length,
      matchingContacts: matchingContacts.length,
      newLeads: matchingLeads.filter(ml => ml.type === 'new').length,
      legacyLeads: matchingLeads.filter(ml => ml.type === 'legacy').length,
      leadIds: matchingLeads.map(ml => `${ml.type}:${ml.data.id}`).join(', ')
    });
    if (matchingLeads.length > 3) {
      console.warn(
        `⚠️ Phone ${phoneNumber} matched ${matchingLeads.length} leads; inbound insert will write multiple rows`,
      );
    }

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
      voice_note: false, // Will be set for voice notes
      is_read: false,
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
        {
          const storedFileName = await downloadAndStoreMedia(image.id, 'image', mediaOwnerIdentifier);
          if (storedFileName) baseMessageData.media_url = storedFileName;
        }
        break;
      
      case 'document':
        baseMessageData.message = document.filename;
        baseMessageData.media_id = document.id;
        baseMessageData.media_url = document.id; // Set media_url to WhatsApp media ID
        baseMessageData.media_filename = document.filename;
        baseMessageData.media_mime_type = document.mime_type;
        baseMessageData.media_size = document.file_size;
        {
          const storedFileName = await downloadAndStoreMedia(document.id, 'document', mediaOwnerIdentifier);
          if (storedFileName) baseMessageData.media_url = storedFileName;
        }
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
        {
          const storedFileName = await downloadAndStoreMedia(audio.id, 'audio', mediaOwnerIdentifier);
          if (storedFileName) baseMessageData.media_url = storedFileName;
        }
        break;
      
      case 'video':
        baseMessageData.message = video.caption || 'Video message';
        baseMessageData.media_id = video.id;
        baseMessageData.media_url = video.id; // Set media_url to WhatsApp media ID
        baseMessageData.media_mime_type = video.mime_type;
        baseMessageData.media_size = video.file_size;
        baseMessageData.caption = video.caption;
        {
          const storedFileName = await downloadAndStoreMedia(video.id, 'video', mediaOwnerIdentifier);
          if (storedFileName) baseMessageData.media_url = storedFileName;
        }
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
        } else {
          baseMessageData.message =
            baseMessageData.message ||
            `[Interactive WhatsApp message: ${interactive?.type || 'unknown'}]`;
          baseMessageData.message_type = 'text';
        }
        break;

      case 'sticker': {
        // Stickers aren't a first-class DB type — store as image when media id exists.
        const stickerId = sticker?.id;
        if (stickerId) {
          baseMessageData.message = 'Sticker';
          baseMessageData.message_type = 'image';
          baseMessageData.media_id = stickerId;
          baseMessageData.media_url = stickerId;
          baseMessageData.media_mime_type = sticker?.mime_type || null;
          const storedFileName = await downloadAndStoreMedia(stickerId, 'image', mediaOwnerIdentifier);
          if (storedFileName) baseMessageData.media_url = storedFileName;
        } else {
          baseMessageData.message = 'Sticker';
          baseMessageData.message_type = 'text';
        }
        break;
      }

      case 'reaction':
        baseMessageData.message = reaction?.emoji
          ? `Reacted ${reaction.emoji}`
          : 'Reaction';
        baseMessageData.message_type = 'text';
        break;

      case 'unsupported':
        // Meta sends this when the Cloud API cannot expose the real payload
        // (e.g. some channel/product messages). Persist as text so the chat still shows.
        baseMessageData.message =
          errors?.[0]?.message ||
          'Unsupported WhatsApp message (type not available via API)';
        baseMessageData.message_type = 'text';
        console.warn('⚠️ Unsupported WhatsApp inbound message type from Meta', {
          phoneNumber,
          whatsappMessageId,
          errors: errors || null,
        });
        break;

      default:
        baseMessageData.message =
          baseMessageData.message ||
          (typeof text?.body === 'string' && text.body.trim()
            ? text.body
            : `[WhatsApp message type: ${type || 'unknown'}]`);
        baseMessageData.message_type = 'text';
        console.warn('⚠️ Unhandled WhatsApp inbound message type; storing as text', {
          type,
          phoneNumber,
          whatsappMessageId,
        });
        break;
    }

    // DB check: whatsapp_messages_message_type_check — never insert unknown types.
    const ALLOWED_WHATSAPP_MESSAGE_TYPES = new Set([
      'text',
      'image',
      'document',
      'audio',
      'video',
      'location',
      'contact',
      'button_response',
      'list_response',
    ]);
    if (!ALLOWED_WHATSAPP_MESSAGE_TYPES.has(String(baseMessageData.message_type || ''))) {
      console.warn('⚠️ Coercing invalid message_type to text', {
        originalType: baseMessageData.message_type,
        webhookType: type,
        phoneNumber,
      });
      if (!baseMessageData.message) {
        baseMessageData.message = `[WhatsApp message type: ${baseMessageData.message_type || type || 'unknown'}]`;
      }
      baseMessageData.message_type = 'text';
    }

    // One inbound event → one row per matching lead/contact. The UI must filter by
    // that lead so each case shows its own copy, not every copy for the phone.
    const messagesToInsert = [];
    const seenLeadKeys = new Set();

    if (matchingLeads.length === 0 && matchingContacts.length === 0) {
      messagesToInsert.push({
        ...baseMessageData,
        lead_id: null,
        legacy_id: null,
        contact_id: null,
      });
    } else {
      for (const matchingLead of matchingLeads) {
        if (matchingLead.type === 'new') {
          const key = `new:${matchingLead.data.id}`;
          if (seenLeadKeys.has(key)) continue;
          seenLeadKeys.add(key);
          messagesToInsert.push({
            ...baseMessageData,
            lead_id: matchingLead.data.id,
            legacy_id: null,
            contact_id: null,
          });
        } else {
          const key = `legacy:${matchingLead.data.id}`;
          if (seenLeadKeys.has(key)) continue;
          seenLeadKeys.add(key);
          messagesToInsert.push({
            ...baseMessageData,
            lead_id: null,
            legacy_id: matchingLead.data.id,
            contact_id: null,
          });
        }
      }

      for (const contactWithLeads of matchingContactsWithLeads) {
        const contactId = contactWithLeads.contactId;
        const contactLinks = contactWithLeads.contactLinks || [];

        for (const link of contactLinks) {
          if (link.newlead_id) {
            const existingMsg = messagesToInsert.find((msg) => msg.lead_id === link.newlead_id);
            if (existingMsg) {
              existingMsg.contact_id = contactId;
            } else {
              const key = `new:${link.newlead_id}`;
              if (seenLeadKeys.has(key)) continue;
              seenLeadKeys.add(key);
              messagesToInsert.push({
                ...baseMessageData,
                lead_id: link.newlead_id,
                legacy_id: null,
                contact_id: contactId,
              });
            }
          }

          if (link.lead_id) {
            const existingMsg = messagesToInsert.find((msg) => msg.legacy_id === link.lead_id);
            if (existingMsg) {
              existingMsg.contact_id = contactId;
            } else {
              const key = `legacy:${link.lead_id}`;
              if (seenLeadKeys.has(key)) continue;
              seenLeadKeys.add(key);
              messagesToInsert.push({
                ...baseMessageData,
                lead_id: null,
                legacy_id: link.lead_id,
                contact_id: contactId,
              });
            }
          }
        }
      }
    }

    if (messagesToInsert.length === 0) {
      messagesToInsert.push({
        ...baseMessageData,
        lead_id: null,
        legacy_id: null,
        contact_id: matchingContacts[0] || null,
      });
    }

    for (let i = messagesToInsert.length - 1; i >= 0; i--) {
      const row = messagesToInsert[i];
      const key = row.lead_id
        ? `new:${row.lead_id}`
        : row.legacy_id
          ? `legacy:${row.legacy_id}`
          : 'unmatched';
      if (existingIdentityKeys.has(key)) {
        messagesToInsert.splice(i, 1);
      }
    }

    if (messagesToInsert.length === 0 && existingIdentityKeys.size > 0) {
      console.log(
        `⚠️ Duplicate message detected: whatsapp_message_id ${whatsappMessageId} already saved for all matching leads. Skipping.`,
      );
      return true;
    }

    // Save all messages to database (skip stage-eval triggers that time out on busy leads)
    let { data: insertedRows, error: insertError } = await insertWhatsAppMessageRows(messagesToInsert);
    if (!insertedRows.length && messagesToInsert.some((row) => row.lead_id || row.legacy_id)) {
      console.warn(
        'Inbound WhatsApp insert with lead_id failed (often statement_timeout on stage eval). Retrying one unmatched row.',
        insertError,
      );
      ({ data: insertedRows, error: insertError } = await insertWhatsAppMessageRows([
        {
          ...baseMessageData,
          lead_id: null,
          legacy_id: null,
          contact_id: matchingContacts[0] || null,
        },
      ]));
    }

    if (!insertedRows.length) {
      console.error('Error saving incoming message:', insertError);
      return false;
    }

    inboundSaved = true;
    if (insertError) {
      console.error('Inbound WhatsApp saved only partially; returning failure so Meta retries:', insertError);
      return false;
    }
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
          // This prevents duplicate notifications for both known and unknown leads
          if (whatsappMessageId && markNotificationSent(whatsappMessageId)) {
            console.log(`⚠️ Duplicate notification prevented: whatsapp_message_id ${whatsappMessageId} notification already sent. Skipping.`);
            return; // Exit early to prevent duplicate notifications
          }
          
          // Log notification attempt
          console.log(`📱 Processing push notification for whatsapp_message_id: ${whatsappMessageId || 'N/A'}, isUnknownLead: ${isUnknownLeadMessage}`);

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
          
          // Use PNG icon for better mobile support (SVG not well supported in push notifications)
          // Try PNG first, fallback to SVG, then to default icon
          // The pushNotificationService will convert relative paths to absolute URLs
          const notificationPayload = {
            title: '💬 New WhatsApp Message',
            body: previewText,
            icon: '/whatsapp-icon.png', // Try PNG first (better mobile support)
            badge: '/icon-72x72.png',
            url: phoneNumber ? `/whatsapp-leads?phone=${encodeURIComponent(phoneNumber)}` : '/whatsapp-leads',
            tag: notificationTag, // Browser will deduplicate notifications with the same tag
            id: baseMessageData.whatsapp_message_id || phoneNumber || Date.now(),
            type: 'whatsapp', // Set type to 'whatsapp' for better identification
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
            // But only if we haven't already sent a notification for this message
            // Check if notification was already sent (using the same deduplication as known leads)
            if (whatsappMessageId && markNotificationSent(whatsappMessageId)) {
              console.log(`⚠️ Duplicate unknown lead notification prevented: whatsapp_message_id ${whatsappMessageId} already notified. Skipping.`);
              return;
            }
            
            const result = await pushNotificationService.sendNotificationToAll(notificationPayload);
            const duration = Date.now() - notificationStartTime;
            console.log(`📱 Sent push notifications to all users for unknown lead (${result.sent}/${result.total}) in ${duration}ms`, {
              phoneNumber,
              whatsappMessageId,
              notificationTag
            });
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
                
                // Diagnostic: Check if subscriptions exist in database
                try {
                  const { data: subscriptionCheck, error: checkError } = await supabase
                    .from('push_subscriptions')
                    .select('id, user_id, endpoint, created_at')
                    .in('user_id', Array.from(allUserIds));
                  
                  if (!checkError && subscriptionCheck) {
                    if (subscriptionCheck.length === 0) {
                      console.warn(`📋 Diagnostic: No push subscriptions found in database for user(s): ${Array.from(allUserIds).join(', ')}`);
                      console.warn(`💡 Users need to enable push notifications in Settings > Notifications tab`);
                    } else {
                      console.log(`📋 Diagnostic: Found ${subscriptionCheck.length} subscription(s) in database:`, 
                        subscriptionCheck.map(s => ({ userId: s.user_id, endpoint: s.endpoint?.substring(0, 50) + '...', createdAt: s.created_at }))
                      );
                    }
                  } else if (checkError) {
                    console.error(`❌ Error checking subscriptions:`, checkError);
                  }
                } catch (diagError) {
                  console.error(`❌ Error running subscription diagnostic:`, diagError);
                }
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
    return true;
  } catch (error) {
    console.error('Error processing incoming message:', error);
    if (!inboundSaved && message?.from) {
      try {
        const fallback = await insertWhatsAppMessage({
          phone_number: message.from,
          sender_name: message.from,
          direction: 'in',
          message:
            message.text?.body ||
            `[WhatsApp message type: ${message.type || 'unknown'}]`,
          sent_at: message.timestamp
            ? new Date(parseInt(message.timestamp, 10) * 1000).toISOString()
            : new Date().toISOString(),
          whatsapp_message_id: message.id || null,
          whatsapp_status: 'delivered',
          message_type: 'text',
          whatsapp_timestamp: message.timestamp
            ? new Date(parseInt(message.timestamp, 10) * 1000).toISOString()
            : new Date().toISOString(),
          is_read: false,
        });
        if (fallback.error) {
          console.error('Emergency inbound WhatsApp save failed:', fallback.error);
          return false;
        }
        console.log('🛟 Emergency-saved inbound WhatsApp row for', message.from);
        return true;
      } catch (fallbackError) {
        console.error('Emergency inbound WhatsApp save failed:', fallbackError);
        return false;
      }
    }
    return false;
  }
};

const getUploadsDir = () => path.join(__dirname, '../../uploads');

/** Resolve a persisted upload on disk (filename or WhatsApp media id embedded in name). */
const findStoredMediaFilePath = (mediaId) => {
  if (!mediaId) return null;

  const uploadsDir = getUploadsDir();
  if (!fs.existsSync(uploadsDir)) return null;

  const exactPath = path.join(uploadsDir, mediaId);
  if (fs.existsSync(exactPath)) return exactPath;

  try {
    const files = fs.readdirSync(uploadsDir);
    const matchingFile = files.find((file) => file.includes(mediaId));
    return matchingFile ? path.join(uploadsDir, matchingFile) : null;
  } catch (error) {
    console.error('Error reading uploads directory:', error);
    return null;
  }
};

// Durable storage for WhatsApp media. WhatsApp media IDs expire (~30 days) and the backend's
// local disk is ephemeral, so media is copied into a private Supabase Storage bucket and served
// from there indefinitely. Object keys are flat and equal to the stored filename / media_url.
const WHATSAPP_MEDIA_BUCKET = process.env.WHATSAPP_MEDIA_BUCKET || 'whatsapp-media';

/** Upload a media buffer to the durable bucket. Returns true on success (best-effort, never throws). */
const uploadMediaToBucket = async (key, buffer, contentType) => {
  if (!key || !buffer) return false;
  try {
    const { error } = await supabase.storage
      .from(WHATSAPP_MEDIA_BUCKET)
      .upload(key, buffer, { contentType: contentType || 'application/octet-stream', upsert: true });
    if (error) {
      console.warn(`⚠️ Supabase Storage upload failed for "${key}": ${error.message}`);
      return false;
    }
    return true;
  } catch (e) {
    console.warn(`⚠️ Supabase Storage upload threw for "${key}": ${e.message}`);
    return false;
  }
};

/** Download a media object from the durable bucket. Returns { buffer, contentType } or null. */
const downloadMediaFromBucket = async (key) => {
  if (!key) return null;
  try {
    const { data, error } = await supabase.storage.from(WHATSAPP_MEDIA_BUCKET).download(key);
    if (error || !data) return null;
    const arrayBuffer = await data.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      contentType: data.type || 'application/octet-stream',
    };
  } catch (e) {
    return null;
  }
};

// Download and store media file (persist to Supabase Storage + local cache so WhatsApp's
// temporary media IDs remain viewable long after Meta drops them).
const downloadAndStoreMedia = async (mediaId, type, leadId) => {
  if (!mediaId || !ACCESS_TOKEN) return null;

  try {
    const existingPath = findStoredMediaFilePath(mediaId);
    if (existingPath) {
      return path.basename(existingPath);
    }

    const mediaResponse = await axios.get(`${WHATSAPP_API_URL}/${mediaId}`, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    });

    const mediaUrl = mediaResponse.data.url;

    const fileResponse = await axios.get(mediaUrl, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
      responseType: 'arraybuffer',
    });

    const contentType = fileResponse.headers['content-type'] || 'application/octet-stream';
    const buffer = Buffer.from(fileResponse.data);
    const fileName = `${leadId}_${Date.now()}_${mediaId}.${getFileExtension(contentType)}`;

    // Primary: durable copy in Supabase Storage (survives redeploys & multiple instances).
    const uploadedToBucket = await uploadMediaToBucket(fileName, buffer, contentType);

    // Secondary: best-effort local cache so this instance can serve it without a round-trip.
    try {
      const uploadsDir = getUploadsDir();
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }
      fs.writeFileSync(path.join(uploadsDir, fileName), buffer);
    } catch (diskError) {
      console.warn(`⚠️ Could not write local media cache for ${fileName}: ${diskError.message}`);
    }

    console.log(
      `✅ Stored WhatsApp ${type} media: ${fileName}${uploadedToBucket ? ' (bucket + local cache)' : ' (local cache only — bucket upload failed)'}`,
    );
    return fileName;
  } catch (error) {
    console.error(`Error downloading ${type} media ${mediaId}:`, error.response?.data || error.message);
    return null;
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

/** Pass through Meta template language code as stored in whatsapp_templates_v2. */
function toWhatsAppApiLanguageCode(lang) {
  const code = lang != null ? String(lang).trim() : '';
  return code || 'en';
}

/** Alternate Meta language codes to try when the primary returns #132001. */
function getWhatsAppLanguageVariants(lang) {
  const primary = toWhatsAppApiLanguageCode(lang);
  const variants = [primary];
  const lower = primary.toLowerCase();
  if (lower === 'en') variants.push('en_US');
  else if (lower === 'en_us') variants.push('en');
  else if (lower === 'he') variants.push('he_IL');
  else if (lower === 'he_il') variants.push('he');
  else if (lower === 'fr') variants.push('fr_FR');
  else if (lower === 'fr_fr') variants.push('fr');
  return [...new Set(variants)];
}

async function postWhatsAppMessage(messagePayload) {
  const url = `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages`;
  const headers = {
    Authorization: `Bearer ${ACCESS_TOKEN}`,
    'Content-Type': 'application/json',
  };

  if (messagePayload?.type !== 'template') {
    return axios.post(url, messagePayload, { headers });
  }

  const baseLang = messagePayload.template?.language?.code;
  const variants = getWhatsAppLanguageVariants(baseLang);
  let lastError;

  for (let i = 0; i < variants.length; i += 1) {
    const payload = {
      ...messagePayload,
      template: {
        ...messagePayload.template,
        language: { code: variants[i] },
      },
    };

    try {
      const response = await axios.post(url, payload, { headers });
      if (i > 0) {
        console.log(
          `✅ Template sent with fallback language "${variants[i]}" (primary "${baseLang}" was rejected by Meta)`,
        );
      }
      return response;
    } catch (error) {
      lastError = error;
      const whatsappCode = error.response?.data?.error?.code;
      if (whatsappCode === 132001 && i < variants.length - 1) {
        console.warn(
          `⚠️ Template "${payload.template?.name}" not found for language "${variants[i]}", trying "${variants[i + 1]}"...`,
        );
        continue;
      }
      throw error;
    }
  }

  throw lastError;
}

async function resolveWhatsAppTemplateForSend(templateId) {
  const templateIdNum = Number(templateId);
  if (!Number.isFinite(templateIdNum) || templateIdNum <= 0) {
    return { error: 'Invalid template ID', code: 'INVALID_TEMPLATE_ID' };
  }

  const { data: template, error: templateError } = await supabase
    .from('whatsapp_templates_v2')
    .select('id, name, language, whatsapp_template_id, active, params')
    .eq('id', templateIdNum)
    .single();

  if (templateError || !template) {
    return {
      error: `Template ID ${templateIdNum} not found. Sync templates from Meta in Admin.`,
      code: 'TEMPLATE_NOT_FOUND',
    };
  }

  if (template.active === false) {
    return {
      error: `Template "${template.name}" (${template.language || 'unknown'}) is not active. Pick an approved template or sync from Meta.`,
      code: 'TEMPLATE_INACTIVE',
    };
  }

  if (!template.name) {
    return {
      error: `Template ID ${templateIdNum} has no name in the database. Sync templates from Meta.`,
      code: 'TEMPLATE_NAME_MISSING',
    };
  }

  return { template: template };
}

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
      templateParameters: req.body.templateParameters,
      templateButtonParameters: req.body.templateButtonParameters,
    });
    const {
      leadId,
      message,
      phoneNumber,
      isTemplate,
      templateName,
      templateLanguage,
      templateParameters,
      templateButtonParameters,
      templateId,
      contactId,
    } = req.body;
    
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
    const routeViaPex = await pexCrmChatWebhookService.isPexWhatsAppConversation({
      leadId: leadId === null ? null : (isLegacyLead ? null : leadId),
      legacyId: isLegacyLead ? lead.id : null,
      phoneNumber,
    });

    if (routeViaPex) {
      console.log('📣 PEX WhatsApp thread — skip Meta send, save row + notify PEX');
      whatsappMessageId = pexCrmChatWebhookService.buildPexCrmMessageId();
      responseData = {
        success: true,
        messageId: whatsappMessageId,
        via: 'pex',
        message: 'Message saved. PEX will send it.',
      };
    } else if (isDevelopmentMode) {
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
        if (!templateId) {
          return res.status(400).json({
            error: 'templateId is required for template messages.',
            code: 'TEMPLATE_ID_REQUIRED',
          });
        }

        const resolved = await resolveWhatsAppTemplateForSend(templateId);
        if (resolved.error) {
          return res.status(400).json({
            error: resolved.error,
            code: resolved.code,
          });
        }

        const dbTemplate = resolved.template;
        const finalTemplateName = dbTemplate.name;
        const finalTemplateLanguage = toWhatsAppApiLanguageCode(dbTemplate.language);

        console.log('📱 Sending TEMPLATE message');
        console.log('📱 Template ID:', templateId);
        console.log('📱 Template Name (from DB):', finalTemplateName);
        console.log('📱 Template Language (from DB):', finalTemplateLanguage);
        console.log('📱 Template Parameters:', templateParameters);

        messagePayload = {
          messaging_product: 'whatsapp',
          to: phoneNumber,
          type: 'template',
          template: {
            name: finalTemplateName,
            language: {
              code: finalTemplateLanguage,
            },
          },
        };

        const requiredParamCount = Number(dbTemplate.params) || 0;

        if (templateParameters && templateParameters.length > 0) {
          const processedParameters = templateParameters.map((param, index) => {
            const trimmed = param && param.text != null ? String(param.text).trim() : '';
            const sanitized = sanitizeWhatsAppTemplateVariableText(trimmed);
            if (!sanitized.length) {
              console.warn(`⚠️ Parameter ${index + 1} is empty, using placeholder`);
              return {
                type: 'text',
                text: 'N/A',
              };
            }
            return {
              type: param.type || 'text',
              text: sanitized,
            };
          });

          while (processedParameters.length < requiredParamCount) {
            console.warn(`⚠️ Missing parameter ${processedParameters.length + 1}, adding placeholder`);
            processedParameters.push({
              type: 'text',
              text: 'N/A',
            });
          }

          const finalParameters = processedParameters.slice(
            0,
            requiredParamCount > 0 ? requiredParamCount : processedParameters.length,
          );

          if (finalParameters.length > 0) {
            console.log('📱 Template has valid parameters, using them:', finalParameters);
            messagePayload.template.components = [
              {
                type: 'body',
                parameters: finalParameters,
              },
            ];
          } else {
            console.warn('⚠️ All template parameters are empty, cannot send template message');
            return res.status(400).json({
              error: 'Template parameters are required but were not provided or are empty. Please ensure client name and meeting information are available.',
            });
          }
        } else if (requiredParamCount > 0) {
          console.warn(`⚠️ Template requires ${requiredParamCount} parameter(s) but none were provided. Sending with empty parameters.`);
          messagePayload.template.components = [
            {
              type: 'body',
              parameters: Array(requiredParamCount).fill(null).map(() => ({ type: 'text', text: '' })),
            },
          ];
        }

        // Dynamic URL / copy-code buttons need separate components (not counted in body params).
        if (Array.isArray(templateButtonParameters) && templateButtonParameters.length > 0) {
          if (!messagePayload.template.components) {
            messagePayload.template.components = [];
          }
          templateButtonParameters.forEach((btnParam, i) => {
            const text =
              btnParam && btnParam.text != null
                ? String(btnParam.text).trim()
                : typeof btnParam === 'string'
                  ? btnParam.trim()
                  : '';
            if (!text) {
              console.warn(`⚠️ Skipping empty template button parameter at index ${i}`);
              return;
            }
            const index =
              btnParam && btnParam.index != null && String(btnParam.index).trim() !== ''
                ? String(btnParam.index)
                : String(i);
            const subType =
              (btnParam && btnParam.sub_type) ||
              (btnParam && btnParam.subType) ||
              'url';
            messagePayload.template.components.push({
              type: 'button',
              sub_type: subType,
              index,
              parameters: [
                {
                  type: 'text',
                  text,
                },
              ],
            });
          });
          console.log(
            '📱 Template button parameters:',
            messagePayload.template.components.filter((c) => c.type === 'button'),
          );
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
      
      const response = await postWhatsAppMessage(messagePayload);

      whatsappMessageId = response.data.messages[0].id;
      responseData = {
        success: true,
        messageId: whatsappMessageId,
        message: 'Message sent successfully'
      };
    }

    // Resolve template_id for DB storage (already validated before send when isTemplate)
    let finalTemplateId = null;
    if (isTemplate && templateId != null) {
      const templateIdNum = Number(templateId);
      if (Number.isFinite(templateIdNum) && templateIdNum > 0) {
        finalTemplateId = templateIdNum;
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
      whatsapp_status: routeViaPex ? 'sent' : 'pending', // PEX has no Meta status webhook
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
    
    const insertResult = await insertOutgoingWhatsAppMessageBounded(messageData);
    const insertedData = insertResult.data;

    if (insertResult.error) {
      console.error('❌ ===== INSERT ERROR =====');
      console.error('❌ Error saving outgoing message:', insertResult.error);
      console.error('❌ Error details:', JSON.stringify(insertResult.error, null, 2));
      console.error('❌ Message data that failed:', JSON.stringify(messageData, null, 2));
      return respondWhatsAppSent(res, responseData, insertResult);
    }

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

    if (routeViaPex && insertedData?.[0]?.id) {
      responseData.rowId = insertedData[0].id;
      await pexCrmChatWebhookService.notifyWhatsAppRow(insertedData[0].id);
    }

    console.log('✅ Message sent successfully:', responseData);
    return respondWhatsAppSent(res, responseData, insertResult);

  } catch (error) {
    console.error('Error sending message:', error);
    
    // Check if it's a WhatsApp API error
    if (error.response && error.response.data && error.response.data.error) {
      const whatsappError = error.response.data.error;
      const details =
        (whatsappError.error_data &&
          (whatsappError.error_data.details || whatsappError.error_data)) ||
        whatsappError.error_user_msg ||
        null;
      console.error('WhatsApp API error details:', JSON.stringify(whatsappError, null, 2));
      if (whatsappError.code === 131047) {
        res.status(400).json({ 
          error: 'Message failed: More than 24 hours have passed since the customer last replied. You can only send template messages after 24 hours.',
          code: 'RE_ENGAGEMENT_REQUIRED',
          details,
        });
      } else if (whatsappError.code === 132001) {
        res.status(400).json({
          error: `WhatsApp API Error: ${whatsappError.message}. The template name/language in the database may not match Meta. Sync templates in Admin → WhatsApp Templates, and deactivate duplicate rows (e.g. referral_poland vs refferal_poland).`,
          code: whatsappError.code,
          details,
        });
      } else {
        res.status(400).json({
          error: `WhatsApp API Error: ${whatsappError.message}`,
          code: whatsappError.code,
          details,
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
    const routeViaPex = await pexCrmChatWebhookService.isPexWhatsAppConversation({
      leadId: leadId === null ? null : (isLegacyLead ? null : leadId),
      legacyId: isLegacyLead ? lead.id : null,
      phoneNumber,
    });

    if (routeViaPex) {
      console.log('📣 PEX WhatsApp thread — skip Meta media send, save row + notify PEX');
      whatsappMessageId = pexCrmChatWebhookService.buildPexCrmMessageId();
      responseData = {
        success: true,
        messageId: whatsappMessageId,
        via: 'pex',
        message: 'Media saved. PEX will send it.',
      };
    } else if (isDevelopmentMode) {
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
      whatsapp_status: routeViaPex ? 'sent' : 'pending',
      message_type: mediaType,
      media_url: mediaUrl,
      media_id: mediaUrl, // Also store as media_id for consistency
      caption: caption,
      voice_note: req.body.voiceNote || false // Store voice note flag
    };

    const insertResult = await insertOutgoingWhatsAppMessageBounded(messageData);
    const insertedMedia = insertResult.data;

    if (insertResult.error) {
      console.error('Error saving outgoing media message:', insertResult.error);
      return respondWhatsAppSent(res, responseData, insertResult);
    }

    if (routeViaPex && insertedMedia?.[0]?.id) {
      responseData.rowId = insertedMedia[0].id;
      await pexCrmChatWebhookService.notifyWhatsAppRow(insertedMedia[0].id);
    }

    return respondWhatsAppSent(res, responseData, insertResult);

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
    const { leadId, caption, phoneNumber } = req.body;

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const routeViaPex = await pexCrmChatWebhookService.isPexWhatsAppConversation({
      leadId,
      phoneNumber,
    });

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
    await uploadMediaToBucket(fileName, file.buffer, file.mimetype || 'application/octet-stream');

    let mediaId;
    let responseData;

    if (routeViaPex || isDevelopmentMode) {
      if (routeViaPex) {
        console.log('📣 PEX WhatsApp thread — skip Meta media upload, store file for PEX');
      }
      mediaId = fileName;
      responseData = {
        success: true,
        mediaId,
        fileName,
        via: routeViaPex ? 'pex' : undefined,
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

/**
 * Recover the original WhatsApp Graph media id from the value stored in
 * whatsapp_messages.media_url. That value can be:
 *   - a raw WhatsApp media id (e.g. "1549564263545850"), or
 *   - a locally-stored filename "{leadId}_{ts}_{whatsappMediaId}.{ext}" or
 *     "legacy_{id}_{ts}_{whatsappMediaId}.{ext}" (the id is the trailing numeric segment), or
 *   - some other filename, in which case we fall back to looking up media_id in the DB.
 * This lets any backend instance re-fetch media from Meta even when the local
 * file is missing (fresh dev box, redeploy on ephemeral disk, scaled-out instance).
 */
const resolveWhatsAppMediaId = async (mediaParam) => {
  if (!mediaParam) return null;

  // Already a raw WhatsApp media id
  if (/^\d+$/.test(mediaParam)) return mediaParam;

  // Stored filename: strip extension and take the trailing numeric segment
  const base = mediaParam.replace(/\.[a-z0-9]+$/i, '');
  const lastSegment = base.split('_').pop();
  if (lastSegment && /^\d+$/.test(lastSegment)) return lastSegment;

  // Fall back to the DB: media_id is preserved even when media_url holds a filename
  try {
    const { data } = await supabase
      .from('whatsapp_messages')
      .select('media_id')
      .eq('media_url', mediaParam)
      .not('media_id', 'is', null)
      .limit(1)
      .maybeSingle();
    if (data?.media_id && /^\d+$/.test(String(data.media_id))) {
      return String(data.media_id);
    }
  } catch (error) {
    console.error('Error resolving WhatsApp media id from DB:', error.message);
  }

  return null;
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

    // 1) Serve the persisted file when this instance has it on disk (fastest path)
    const storedPath = findStoredMediaFilePath(mediaId);
    if (storedPath) {
      return res.sendFile(storedPath);
    }

    // 2) Serve from durable Supabase Storage (survives redeploys & works across instances)
    const fromBucket = await downloadMediaFromBucket(mediaId);
    if (fromBucket) {
      res.setHeader('Content-Type', fromBucket.contentType);
      res.setHeader('Content-Length', String(fromBucket.buffer.length));
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      return res.send(fromBucket.buffer);
    }

    // 3) Otherwise re-fetch from WhatsApp. The path param may be a stored filename,
    //    so recover the original Graph media id before calling Meta.
    if (!ACCESS_TOKEN) {
      return res.status(404).json({ error: 'Media not found' });
    }

    const graphMediaId = await resolveWhatsAppMediaId(mediaId);
    if (!graphMediaId) {
      console.log(`ℹ️  Could not resolve a WhatsApp media id for "${mediaId}" (no local file, no bucket object, no media_id in DB)`);
      return res.status(404).json({ error: 'Media not found' });
    }

    // 4) Fetch from WhatsApp (temporary download URLs; media is retained by Meta for ~30 days)
    try {
        const mediaResponse = await axios.get(
          `${WHATSAPP_API_URL}/${graphMediaId}`,
          {
            headers: {
              'Authorization': `Bearer ${ACCESS_TOKEN}`
            }
          }
        );

        const mediaUrl = mediaResponse.data.url;
        
        // Download the media (buffered so we can both serve it and back-fill durable storage)
        const fileResponse = await axios.get(mediaUrl, {
          headers: {
            'Authorization': `Bearer ${ACCESS_TOKEN}`
          },
          responseType: 'arraybuffer'
        });

        const contentType = fileResponse.headers['content-type'] || 'application/octet-stream';
        const buffer = Buffer.from(fileResponse.data);

        // Back-fill the durable bucket under the requested key so future loads no longer
        // depend on Meta's 30-day window. Fire-and-forget; never block the response.
        void uploadMediaToBucket(mediaId, buffer, contentType);

        // Set appropriate headers
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', String(buffer.length));
        res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

        return res.send(buffer);
      } catch (error) {
        const errorData = error.response?.data;
        const errorCode = errorData?.error?.code;
        const errorSubcode = errorData?.error?.error_subcode;
        const statusCode = error.response?.status;

        // Auth/token problems must NOT be reported as "media expired" — surface them clearly.
        if (errorCode === 190 || errorData?.error?.type === 'OAuthException') {
          console.error(
            `❌ WhatsApp access token rejected (code ${errorCode}) while fetching media ${graphMediaId}: ${errorData?.error?.message}`,
          );
          return res.status(502).json({
            error: 'WhatsApp access token invalid or expired',
            message: errorData?.error?.message,
            code: errorCode,
          });
        }

        // Genuine "media no longer available" (older than Meta's ~30-day retention or invalid id)
        if (statusCode === 400 || statusCode === 404 || (errorCode === 100 && errorSubcode === 33)) {
          console.log(`ℹ️  Media ${graphMediaId} is no longer available on WhatsApp (expired or invalid)`);
          return res.status(404).json({ 
            error: 'Media not found or no longer available',
            message: 'This media has expired or is no longer accessible. WhatsApp media URLs are temporary.',
            code: errorCode,
            subcode: errorSubcode
          });
        }
        
        // Log actual errors (network issues, etc.)
        console.error('Error getting media from WhatsApp API:', error.response?.data || error.message);
        return res.status(500).json({ 
          error: 'Failed to get media from WhatsApp',
          message: errorData?.error?.message || error.message
        });
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