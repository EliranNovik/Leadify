const mailboxTokenService = require('./mailboxTokenService');
const mailboxStateService = require('./mailboxStateService');
const graphAuthService = require('./graphAuthService');
const supabase = require('../config/supabase');
const pushNotificationService = require('./pushNotificationService');

const EMAIL_HEADERS_TABLE = process.env.EMAIL_HEADERS_TABLE || 'emails';
const EMAIL_CONTACTS_TABLE = process.env.EMAIL_CONTACTS_TABLE || 'email_contacts';
const EMAIL_BODIES_TABLE = process.env.EMAIL_BODIES_TABLE || 'email_bodies';
const EMAIL_ATTACHMENTS_TABLE = process.env.EMAIL_ATTACHMENTS_TABLE || 'email_attachments';
const ALLOWLIST_TABLE = process.env.CLIENT_ALLOWLIST_TABLE || 'client_email_allowlist';
const TRACKED_THREADS_TABLE = process.env.TRACKED_THREADS_TABLE || 'tracked_threads';
const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';
const DEFAULT_SYNC_BATCH = parseInt(process.env.GRAPH_DELTA_PAGE_SIZE || '50', 10);
const MAX_DELTA_PAGES = Math.max(1, parseInt(process.env.GRAPH_DELTA_MAX_PAGES || '4', 10) || 4);
const DELTA_MESSAGE_SELECT =
  'id,subject,from,toRecipients,ccRecipients,conversationId,bodyPreview,receivedDateTime,sentDateTime,isRead,hasAttachments,internetMessageId,parentFolderId';
const MEMBERSHIP_DOMAINS = (process.env.CLIENT_EMAIL_DOMAINS || '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
const WEBHOOK_URL = process.env.GRAPH_WEBHOOK_NOTIFICATION_URL;
/** Graph max for mail message subscriptions (~2.9 days). */
const GRAPH_MAIL_SUBSCRIPTION_MAX_MINUTES = Math.min(
  4230,
  Math.max(60, parseInt(process.env.GRAPH_MAIL_SUBSCRIPTION_MAX_MINUTES || '4200', 10) || 4200)
);
const _renewBeforeEnv = parseInt(process.env.GRAPH_SUBSCRIPTION_RENEW_BEFORE_MS || '', 10);
/** Renew / extend subscription when remaining lifetime is below this (default 36h). */
const GRAPH_SUBSCRIPTION_RENEW_BEFORE_MS =
  Number.isFinite(_renewBeforeEnv) && _renewBeforeEnv > 0 ? _renewBeforeEnv : 36 * 60 * 60 * 1000;

const normalise = (value) => (value || '').trim().toLowerCase();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asUuidOrNull = (value) => {
  const text = value == null ? '' : String(value).trim();
  return UUID_RE.test(text) ? text : null;
};

// Check if email is from @lawoffice.org.il domain (internal office email)
const isOfficeDomain = (email) => {
  if (!email) return false;
  const normalized = normalise(email);
  return normalized.endsWith('@lawoffice.org.il');
};

// Blocked sender emails to ignore (should not be saved to emails table)
const BLOCKED_SENDER_EMAILS = new Set([
  'wordpress@german-and-austrian-citizenship.lawoffice.org.il',
  'wordpress@insolvency-law.com',
  'wordpress@citizenship-for-children.usa-immigration.lawyer',
  'lawoffic@israel160.jetserver.net',
  'list@wordfence.com',
  'wordpress@usa-immigration.lawyer',
  'wordpress@heritage-based-european-citizenship.lawoffice.org.il',
  'wordpress@heritage-based-european-citizenship-heb.lawoffice.org.il',
  'no-reply@lawzana.com',
  'support@lawfirms1.com',
  'no-reply@zoom.us',
  'info@israel-properties.com',
  'notifications@invoice4u.co.il',
  'isetbeforeyou@yahoo.com',
  'no-reply@support.microsoft.com',
  'ivy@pipe.hnssd.com',
  'no-reply@mail.instagram.com',
  'no_reply@email.apple.com',
  'noreplay@maskyoo.co.il',
  'email@german-and-austrian-citizenship.lawoffice.org.il',
  'noreply@mobilepunch.com',
  'notification@facebookmail.com',
  'news@events.imhbusiness.com',
  'khawaish@usareaimmigrationservices.com',
  'message@shidurit.com',
  'contact@legalimmigrationisrael.com',
  'artalegal@googlegroups.com',
  'alljobs@alljob.co.il',
  'info@crocoblock.com',
  'noreply@business.facebook.com',
  'newsletter@mag.genealogie.com',
  'ancestry@email.ancestry.de',
  'publicity@genealogy.org.il',
]);

// Blocked domains to ignore (add domain names here, e.g., 'example.com')
const BLOCKED_DOMAINS = [
  // 'lawoffice.org.il', // Removed - block specific addresses instead via BLOCKED_SENDER_EMAILS
];

// Check if email should be filtered out (specific blocked addresses)
const shouldFilterEmail = (email) => {
  if (!email) return false;
  const normalized = normalise(email);
  
  // Check if email is in blocked list
  if (BLOCKED_SENDER_EMAILS.has(normalized)) {
    return true;
  }
  
  // Check if email domain is blocked
  const emailDomain = normalized.split('@')[1];
  if (emailDomain && BLOCKED_DOMAINS.some(domain => emailDomain === domain || emailDomain.endsWith(`.${domain}`))) {
    return true;
  }
  
  return false;
};

// Check if email domain is @lawoffice.org.il
const isLawofficeDomain = (email) => {
  if (!email) return false;
  const normalized = normalise(email);
  return normalized.endsWith('@lawoffice.org.il');
};

// Check if email should be filtered as internal-to-internal email
// Block if: sender is @lawoffice.org.il AND all recipients are @lawoffice.org.il
const shouldFilterInternalEmail = (senderEmail, recipientList) => {
  if (!senderEmail) return false;
  
  // Check if sender is from @lawoffice.org.il domain
  if (!isLawofficeDomain(senderEmail)) {
    return false;
  }
  
  // Check if recipient_list exists and is not empty
  if (!recipientList || !recipientList.trim()) {
    return false;
  }
  
  // Parse recipient list (comma-separated)
  const recipients = recipientList
    .split(',')
    .map(addr => normalise(addr.trim()))
    .filter(Boolean);
  
  // If no valid recipients, don't filter (edge case)
  if (recipients.length === 0) {
    return false;
  }
  
  // Check if ALL recipients are from @lawoffice.org.il domain
  const allRecipientsAreInternal = recipients.every(addr => isLawofficeDomain(addr));
  
  // Block only if sender is internal AND all recipients are internal
  return allRecipientsAreInternal;
};

const stripHtml = (html = '') =>
  html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6]|li|table|blockquote)>/gi, '\n')
    .replace(/<\/td>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const buildRecipientList = (payload = {}) => {
  const combined = [
    ...(Array.isArray(payload.to) ? payload.to : []),
    ...(Array.isArray(payload.cc) ? payload.cc : []),
    ...(Array.isArray(payload.bcc) ? payload.bcc : []),
  ];
  return combined.filter((address) => typeof address === 'string' && address.trim().length > 0);
};

const chunkArray = (arr, size = 100) => {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
};

/** Chunk size for lead/contact email `.in()` lookups. Override with GRAPH_EMAIL_MAPPING_CHUNK (10–99). */
const _emailChunkEnv = parseInt(process.env.GRAPH_EMAIL_MAPPING_CHUNK || '40', 10);
const EMAIL_MAPPING_CHUNK = Math.min(99, Math.max(10, Number.isFinite(_emailChunkEnv) ? _emailChunkEnv : 40));

/** Exact `.in()` only — `.or(ilike…)` seq-scans large lead/contact tables and hits 57014. */
const selectRowsMatchingEmailChunk = async (table, selectFields, chunk) => {
  if (!chunk.length) {
    return { data: [], error: null };
  }
  return supabase.from(table).select(selectFields).in('email', chunk);
};

// Fetch ALL leads and contacts that match email addresses
// Returns: { email: [{ clientId, legacyId, contactId, leadId }] }
const applyAddressMatches = (addMapping, leadMatches, legacyMatches, contactMatches) => {
  (leadMatches || []).forEach((lead) => {
    if (lead?.email && !shouldFilterEmail(lead.email)) {
      addMapping(lead.email, { clientId: lead.id, legacyId: null, contactId: null, leadId: lead.id });
    }
  });
  (legacyMatches || []).forEach((lead) => {
    if (lead?.email && !shouldFilterEmail(lead.email)) {
      addMapping(lead.email, { clientId: null, legacyId: lead.id, contactId: null, leadId: lead.id });
    }
  });
  return (contactMatches || []).filter((c) => c?.id && c?.email && !shouldFilterEmail(c.email));
};

const fetchLeadMappingsForAddresses = async (addresses) => {
  const unique = Array.from(new Set(addresses.map((addr) => normalise(addr)).filter(Boolean)));
  if (!unique.length) {
    return {};
  }

  const mapping = {};
  unique.forEach((email) => {
    mapping[email] = [];
  });

  const addMapping = (email, value) => {
    const key = normalise(email);
    if (!key || !mapping[key]) return;
    const exists = mapping[key].some(
      (m) => m.clientId === value.clientId && m.legacyId === value.legacyId && m.contactId === value.contactId
    );
    if (!exists) {
      mapping[key].push(value);
    }
  };

  try {
    let usedRpc = false;
    try {
      const { data: rpcData, error: rpcError } = await supabase.rpc('sync_lookup_addresses', {
        p_emails: unique,
      });
      if (rpcError) {
        console.warn('⚠️ sync_lookup_addresses RPC unavailable:', rpcError.message || rpcError);
      } else if (rpcData && typeof rpcData === 'object') {
        usedRpc = true;
        const parsed = typeof rpcData === 'string' ? JSON.parse(rpcData) : rpcData;
        const contactMatches = applyAddressMatches(
          addMapping,
          parsed.leads,
          parsed.legacy,
          parsed.contacts
        );
        const contactIds = contactMatches.map((c) => c.id);
        const relByContact = new Map();
        for (const relChunk of chunkArray(contactIds, 200)) {
          const { data: rels, error: relError } = await supabase
            .from('lead_leadcontact')
            .select('contact_id,lead_id,newlead_id')
            .in('contact_id', relChunk);
          if (relError) {
            console.error('❌ Failed to resolve lead_leadcontact for email addresses:', relError.message || relError);
            continue;
          }
          (rels || []).forEach((rel) => {
            const list = relByContact.get(rel.contact_id) || [];
            list.push(rel);
            relByContact.set(rel.contact_id, list);
          });
        }
        contactMatches.forEach((contact) => {
          if (contact.newlead_id) {
            addMapping(contact.email, {
              clientId: contact.newlead_id,
              legacyId: null,
              contactId: contact.id,
              leadId: contact.newlead_id,
            });
          }
          (relByContact.get(contact.id) || []).forEach((rel) => {
            if (rel.lead_id) {
              addMapping(contact.email, {
                clientId: null,
                legacyId: rel.lead_id,
                contactId: contact.id,
                leadId: rel.lead_id,
              });
            }
            if (rel.newlead_id) {
              addMapping(contact.email, {
                clientId: rel.newlead_id,
                legacyId: null,
                contactId: contact.id,
                leadId: rel.newlead_id,
              });
            }
          });
        });
      }
    } catch (rpcErr) {
      console.warn('⚠️ sync_lookup_addresses RPC failed, using .in() fallback:', rpcErr.message || rpcErr);
    }

    if (!usedRpc) {
    for (const chunk of chunkArray(unique, EMAIL_MAPPING_CHUNK)) {
      const { data: leadMatches, error: leadError } = await supabase
        .from('leads')
        .select('id,email')
        .in('email', chunk);

      if (leadError) {
        console.error('❌ Failed to resolve leads for email addresses:', leadError.message || leadError);
      } else {
        (leadMatches || []).forEach((lead) => {
          // Skip leads with filtered emails (internal office emails or specific addresses)
          if (lead?.email && !shouldFilterEmail(lead.email)) {
            addMapping(lead.email, { clientId: lead.id, legacyId: null, contactId: null, leadId: lead.id });
          }
        });
      }

      const { data: legacyMatches, error: legacyError } = await selectRowsMatchingEmailChunk(
        'leads_lead',
        'id,email',
        chunk
      );

      if (legacyError) {
        console.error('❌ Failed to resolve legacy leads for email addresses:', legacyError.message || legacyError);
      } else {
        (legacyMatches || []).forEach((lead) => {
          // Skip leads with filtered emails (internal office emails or specific addresses)
          if (lead?.email && !shouldFilterEmail(lead.email)) {
            addMapping(lead.email, { clientId: null, legacyId: lead.id, contactId: null, leadId: lead.id });
          }
        });
      }

      const { data: contactMatches, error: contactError } = await selectRowsMatchingEmailChunk(
        'leads_contact',
        'id,email,newlead_id',
        chunk
      );

      if (contactError) {
        console.error('❌ Failed to resolve contacts for email addresses:', contactError.message || contactError);
      } else {
        // For each matching contact, find all leads it's associated with
        for (const contact of contactMatches || []) {
          if (!contact?.email) continue;
          
          // Skip contacts with filtered emails (internal office emails or specific addresses)
          if (shouldFilterEmail(contact.email)) {
            continue;
          }

          // Get leads associated with this contact (new leads)
          if (contact.newlead_id) {
            addMapping(contact.email, {
              clientId: contact.newlead_id,
              legacyId: null,
              contactId: contact.id,
              leadId: contact.newlead_id,
            });
          }
        }

        const contactIds = (contactMatches || [])
          .filter((c) => c?.id && c?.email && !shouldFilterEmail(c.email))
          .map((c) => c.id);
        const relByContact = new Map();
        for (const relChunk of chunkArray(contactIds, 200)) {
          const { data: rels, error: relError } = await supabase
            .from('lead_leadcontact')
            .select('contact_id,lead_id,newlead_id')
            .in('contact_id', relChunk);
          if (relError) {
            console.error('❌ Failed to resolve lead_leadcontact for email addresses:', relError.message || relError);
            continue;
          }
          (rels || []).forEach((rel) => {
            const list = relByContact.get(rel.contact_id) || [];
            list.push(rel);
            relByContact.set(rel.contact_id, list);
          });
        }

        (contactMatches || []).forEach((contact) => {
          if (!contact?.email || shouldFilterEmail(contact.email)) return;
          (relByContact.get(contact.id) || []).forEach((rel) => {
            if (rel.lead_id) {
              addMapping(contact.email, {
                clientId: null,
                legacyId: rel.lead_id,
                contactId: contact.id,
                leadId: rel.lead_id,
              });
            }
            if (rel.newlead_id) {
              addMapping(contact.email, {
                clientId: rel.newlead_id,
                legacyId: null,
                contactId: contact.id,
                leadId: rel.newlead_id,
              });
            }
          });
        });
      }
    }
    }

    // Do not ILIKE-scan leads_lead / leads_contact for unmatched addresses.
    // That seq-scans large tables and was pinning CPU (57014). Indexed RPC/eq lookup is enough.
  } catch (error) {
    console.error('❌ Error while resolving lead mappings for emails:', error.message || error);
  }

  return mapping;
};

const uniqueMatches = (matches = []) => {
  const map = new Map();
  matches.forEach((match) => {
    if (!match) return;
    const key = `${match.clientId || 'null'}|${match.legacyId || 'null'}|${match.contactId || 'null'}`;
    if (!map.has(key)) map.set(key, match);
  });
  return Array.from(map.values());
};

const preferContactMatches = (matches = []) => {
  const withContact = matches.filter((m) => m.contactId);
  const covered = new Set();
  withContact.forEach((m) => {
    if (m.clientId) covered.add(`c:${m.clientId}`);
    if (m.legacyId) covered.add(`l:${m.legacyId}`);
  });
  const without = matches.filter((m) => {
    if (m.contactId) return false;
    const leadKey = m.clientId ? `c:${m.clientId}` : m.legacyId ? `l:${m.legacyId}` : null;
    return leadKey ? !covered.has(leadKey) : true;
  });
  return [...withContact, ...without];
};

const contactIdsFromMatches = (matches = []) =>
  [...new Set(matches.map((m) => m.contactId).filter((id) => id != null && Number(id) > 0).map(Number))];

const primaryMatchFrom = (matches = []) => {
  const ordered = preferContactMatches(matches);
  return (
    ordered.find((m) => m.clientId && m.contactId) ||
    ordered.find((m) => m.clientId) ||
    ordered.find((m) => m.legacyId && m.contactId) ||
    ordered[0] ||
    null
  );
};

const collectMatchesForEmailRow = (row, leadMappings) => {
  const recipientAddresses = row.recipient_list
    ? row.recipient_list.split(',').map((addr) => normalise(addr)).filter(Boolean)
    : [];
  const senderEmail = row.sender_email ? normalise(row.sender_email) : null;
  const isOutgoing = row.direction === 'outgoing';
  const collected = [];

  const addFromAddress = (addr) => {
    (leadMappings[addr] || []).forEach((match) => collected.push(match));
  };

  if (isOutgoing) {
    recipientAddresses.forEach(addFromAddress);
  } else {
    if (senderEmail) addFromAddress(senderEmail);
    // Client on To/Cc of an employee-received thread (sender may be another lawyer)
    recipientAddresses.filter((addr) => addr && !isLawofficeDomain(addr)).forEach(addFromAddress);
  }

  return uniqueMatches(collected);
};

async function linkEmailContacts(emailId, contactIds) {
  const ids = [...new Set((contactIds || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
  if (!emailId || !ids.length) return;
  const rows = ids.map((contact_id) => ({
    email_id: String(emailId),
    contact_id,
  }));
  const { error } = await supabase.from(EMAIL_CONTACTS_TABLE).upsert(rows, {
    onConflict: 'email_id,contact_id',
    ignoreDuplicates: true,
  });
  if (error) {
    console.warn(`⚠️ email_contacts link failed for email ${emailId}:`, error.message || error);
  }
}

let warnedEmailsWriteTimeout = false;
let mailboxWriteRpcsAvailable = true;
let emailRowRpcAvailable = true;
/** After one seq-scan timeout, skip further message_id lookups this process. */
let skipMessageIdLookups = false;

function isStatementTimeout(error) {
  const msg = String(error?.message || error || '');
  return error?.code === '57014' || /statement timeout/i.test(msg);
}

function isMissingRpc(error) {
  return /could not find the function|schema cache|PGRST202/i.test(String(error?.message || error || ''));
}

function warnEmailsWriteTimeout(context, message) {
  console.error(`❌ ${context}:`, message);
  if (!warnedEmailsWriteTimeout && /timeout|57014/i.test(String(message || ''))) {
    warnedEmailsWriteTimeout = true;
    console.error(
      '❌ emails writes are timing out. Re-run sql/2026-08-16_emails_sync_lookup_and_drop_mv_trigger.sql (do not DROP TRIGGER while sync is running).'
    );
  }
}

function disableMessageIdLookups(reason) {
  if (skipMessageIdLookups) return;
  skipMessageIdLookups = true;
  console.warn(
    `⚠️ Skipping further emails.message_id lookups (${reason}). Inserts will proceed without a pre-check.`
  );
}

async function findEmailRowByMessageId(messageId) {
  if (!messageId || skipMessageIdLookups) return null;
  if (emailRowRpcAvailable) {
    const { data, error } = await supabase.rpc('email_row_for_message', { p_message_id: messageId });
    if (!error) {
      const row = Array.isArray(data) ? data[0] : data;
      return row?.id ? row : null;
    }
    if (isMissingRpc(error)) {
      emailRowRpcAvailable = false;
    } else {
      if (isStatementTimeout(error)) disableMessageIdLookups('statement timeout');
      warnEmailsWriteTimeout('Failed to load existing emails by message_id', error.message || error);
      return null;
    }
  }

  const { data, error } = await supabase
    .from(EMAIL_HEADERS_TABLE)
    .select('id, message_id, contact_id, client_id, legacy_id')
    .eq('message_id', messageId)
    .order('id', { ascending: true })
    .limit(1);
  if (error) {
    if (isStatementTimeout(error)) disableMessageIdLookups('statement timeout');
    warnEmailsWriteTimeout('Failed to load existing emails by message_id', error.message || error);
    return null;
  }
  return data?.[0] || null;
}

async function insertMailboxEmailRow(row) {
  // emails.user_id_fkey does not accept CRM users.id — inserting it logs 23503 on every row.
  const rpcRow = { ...row, user_id: null };
  if (mailboxWriteRpcsAvailable) {
    let error = null;
    const result = await supabase.rpc('insert_mailbox_email', { p_row: rpcRow });
    if (!result.error && result.data) {
      return { id: result.data, error: null };
    }
    error = result.error;
    if (!error) {
      return { id: null, error: null };
    }
    if (error && isMissingRpc(error)) {
      mailboxWriteRpcsAvailable = false;
      console.warn(
        '⚠️ insert_mailbox_email RPC missing; falling back to table insert. Run sql/2026-08-16_emails_sync_lookup_and_drop_mv_trigger.sql'
      );
    } else if (error) {
      if (isStatementTimeout(error)) {
        warnEmailsWriteTimeout(
          `Failed to store email ${row.message_id?.substring(0, 20) || 'unknown'}...`,
          error.message || error
        );
        return { id: null, error };
      }
      console.warn('⚠️ insert_mailbox_email RPC error, trying table insert:', error.message || error);
    }
  }

  const attempts = [{ ...row, user_id: null }];
  if (row.client_id || row.legacy_id) {
    attempts.push({ ...row, client_id: null, legacy_id: null, user_id: null });
  }
  let lastError = null;
  for (const attempt of attempts) {
    const { data, error } = await supabase
      .from(EMAIL_HEADERS_TABLE)
      .insert([attempt])
      .select('id, message_id')
      .maybeSingle();
    if (!error && data?.id) return { id: data.id, error: null };
    if (error?.code === '23505') {
      const existing = await findEmailRowByMessageId(row.message_id);
      return { id: existing?.id || null, error: null, duplicate: true };
    }
    lastError = error;
    if (!isStatementTimeout(error)) break;
  }
  warnEmailsWriteTimeout(
    `Failed to store email ${row.message_id?.substring(0, 20) || 'unknown'}...`,
    (lastError && (lastError.message || lastError)) || 'insert failed'
  );
  return { id: null, error: lastError };
}

async function patchMailboxEmailBody(id, patch) {
  if (!id || !patch || !Object.keys(patch).length) return;
  const hasAttachments = Object.prototype.hasOwnProperty.call(patch, 'attachments');
  if (mailboxWriteRpcsAvailable) {
    const { error } = await supabase.rpc('update_mailbox_email_body', {
      p_id: id,
      p_body_html: patch.body_html ?? null,
      p_body_preview: patch.body_preview ?? null,
      p_body_cached: patch.body_cached ?? null,
      p_attachments: hasAttachments ? patch.attachments : null,
      p_has_attachments: hasAttachments,
    });
    if (!error) return;
    if (isMissingRpc(error)) {
      mailboxWriteRpcsAvailable = false;
    } else {
      warnEmailsWriteTimeout(`Failed to update email rows for id ${id}`, error.message || error);
      return;
    }
  }

  const { error } = await supabase.from(EMAIL_HEADERS_TABLE).update(patch).eq('id', id);
  if (error) {
    warnEmailsWriteTimeout(`Failed to update email rows for id ${id}`, error.message || error);
  }
}

const parseFolderDeltaState = (raw) => {
  const empty = { inbox: null, sent: null, sentSubId: null, sentSubExp: null };
  if (!raw || typeof raw !== 'string') return empty;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) {
    // Legacy MsgFolderRoot / single-folder URL — wrong scope, start fresh folder tokens.
    return empty;
  }
  try {
    const parsed = JSON.parse(trimmed);
    return {
      inbox: parsed.inbox || parsed.inboxDelta || null,
      sent: parsed.sent || parsed.sentDelta || null,
      sentSubId: parsed.sentSubId || null,
      sentSubExp: parsed.sentSubExp || null,
    };
  } catch {
    return empty;
  }
};

const serializeFolderDeltaState = (state = {}) =>
  JSON.stringify({
    inbox: state.inbox || null,
    sent: state.sent || null,
    sentSubId: state.sentSubId || null,
    sentSubExp: state.sentSubExp || null,
  });

const mergeGraphMessages = (base = [], extra = []) => {
  const seen = new Set(base.map((m) => m?.id).filter(Boolean));
  const out = [...base];
  for (const msg of extra) {
    if (!msg?.id || seen.has(msg.id)) continue;
    out.push(msg);
    seen.add(msg.id);
  }
  return out;
};

const fetchRecentMessagesSnapshot = async ({ accessToken, mailboxAddress, top = 25, folder = 'Inbox' }) => {
  try {
    const folderName = folder === 'SentItems' ? 'SentItems' : 'Inbox';
    const url = `${GRAPH_BASE_URL}/users/${mailboxAddress}/mailFolders('${folderName}')/messages?$orderby=receivedDateTime desc&$select=id,subject,from,toRecipients,ccRecipients,conversationId,bodyPreview,receivedDateTime,sentDateTime,isRead,hasAttachments,internetMessageId,parentFolderId&$top=${top}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Prefer: `outlook.body-preview="text"`,
      },
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.error('⚠️  Snapshot fetch failed:', errorText);
      return [];
    }
    const json = await response.json();
    return Array.isArray(json.value) ? json.value : [];
  } catch (error) {
    console.error('⚠️  Snapshot fetch error:', error.message || error);
    return [];
  }
};

const fetchJson = async (url, options = {}) => {
  const response = await fetch(url, options);
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Graph request failed (${response.status}): ${errorText}`);
  }
  return response.json();
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** GET JSON from Graph with 429 / MailboxConcurrency backoff (serial callers should still pass delay between calls). */
const fetchGraphJsonWithRetry = async (url, options = {}, { maxAttempts = 6 } = {}) => {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await fetch(url, options);
    if (response.status === 429) {
      let waitMs = parseInt(response.headers.get('Retry-After') || '', 10);
      if (!Number.isFinite(waitMs) || waitMs < 1) {
        waitMs = Math.min(60, 2 ** attempt);
      } else {
        waitMs = Math.min(120, waitMs);
      }
      waitMs *= 1000;
      const snippet = (await response.text()).slice(0, 200);
      console.warn(`⚠️ Graph 429 (attempt ${attempt}/${maxAttempts}), waiting ${waitMs}ms: ${snippet}`);
      await sleep(waitMs);
      lastError = new Error(`Graph request failed (429): ${snippet}`);
      continue;
    }
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Graph request failed (${response.status}): ${errorText}`);
    }
    return response.json();
  }
  throw lastError || new Error('Graph request failed after retries');
};

/** Metadata only (no contentBytes) for UI + download-by-id. */
const normalizeAttachmentForStorage = (att) => {
  if (!att || !att.id) return null;
  const size =
    typeof att.size === 'number' && Number.isFinite(att.size)
      ? att.size
      : typeof att.sizeInBytes === 'number' && Number.isFinite(att.sizeInBytes)
        ? att.sizeInBytes
        : 0;
  return {
    id: att.id,
    name: att.name || 'attachment',
    contentType: att.contentType || 'application/octet-stream',
    size,
    isInline: Boolean(att.isInline),
  };
};

/**
 * List message attachments from Graph (lightweight; excludes contentBytes).
 * Paginates @odata.nextLink up to 200 items total.
 */
const isGraphMessageNotFound = (err) => {
  const msg = err?.message || String(err);
  return msg.includes('404') || msg.includes('ErrorItemNotFound') || msg.includes('itemNotFound');
};

const fetchMessageAttachmentsMetadata = async (accessToken, mailboxAddress, messageId) => {
  const encodedUser = encodeURIComponent(mailboxAddress);
  const encodedMsg = encodeURIComponent(messageId);
  let url = `${GRAPH_BASE_URL}/users/${encodedUser}/messages/${encodedMsg}/attachments?$select=id,name,contentType,size,isInline&$top=50`;
  const headers = { Authorization: `Bearer ${accessToken}` };
  const collected = [];
  while (url && collected.length < 200) {
    const json = await fetchGraphJsonWithRetry(url, { headers });
    const page = Array.isArray(json.value) ? json.value : [];
    for (const raw of page) {
      const n = normalizeAttachmentForStorage(raw);
      if (n) collected.push(n);
    }
    url = json['@odata.nextLink'] || null;
  }
  return collected;
};

const toGraphRecipients = (list = []) => {
  const normalized = Array.isArray(list) ? list : list != null && list !== '' ? [list] : [];
  return normalized
    .map((address) => (typeof address === 'string' ? address.trim() : ''))
    .filter((address) => Boolean(address))
    .map((address) => ({
      emailAddress: {
        address,
      },
    }));
};

class GraphMailboxSyncService {
  async syncMailboxForUser(userId, options = {}) {
    const { reset = false, trigger = 'manual' } = options;
    const tokenRecord = await mailboxTokenService.getTokenByUserId(userId);
    if (!tokenRecord) {
      throw new Error('Mailbox is not connected for this user');
    }
    if (tokenRecord.status === 'needs_reconnect') {
      const err = new Error('Your mailbox connection has expired. Please reconnect your mailbox to continue syncing emails.');
      err.code = 'EXPIRED_REFRESH_TOKEN';
      throw err;
    }

    const resolvedUserId = tokenRecord.user_id;
    if (!resolvedUserId) {
      throw new Error('Mailbox token is missing CRM user reference');
    }

    const { accessToken } = await graphAuthService.getAccessTokenForUser(userId);
    if (!accessToken) {
      throw new Error('Unable to acquire Microsoft Graph access token');
    }

    const state = await mailboxStateService.getState(resolvedUserId);
    const folderState = reset ? parseFolderDeltaState(null) : parseFolderDeltaState(state?.delta_link);
    const mailboxAddress = tokenRecord.mailbox_address;

    console.log(
      `📥 Initiating Graph sync for user=${resolvedUserId} mailbox=${mailboxAddress} trigger=${trigger}${
        reset ? ' (full resync)' : ''
      }`
    );

    const [inboxDelta, sentDelta] = await Promise.all([
      this.fetchFolderDelta({
        accessToken,
        mailboxAddress,
        folder: 'Inbox',
        deltaLink: folderState.inbox,
      }),
      this.fetchFolderDelta({
        accessToken,
        mailboxAddress,
        folder: 'SentItems',
        deltaLink: folderState.sent,
      }),
    ]);

    let messages = mergeGraphMessages(inboxDelta.messages, sentDelta.messages);

    // Recent snapshots cover mail that arrives while a first-time folder crawl is
    // still paging, and recover if a folder delta token is quiet.
    const [inboxSnapshot, sentSnapshot] = await Promise.all([
      fetchRecentMessagesSnapshot({
        accessToken,
        mailboxAddress,
        top: DEFAULT_SYNC_BATCH,
        folder: 'Inbox',
      }),
      fetchRecentMessagesSnapshot({
        accessToken,
        mailboxAddress,
        top: DEFAULT_SYNC_BATCH,
        folder: 'SentItems',
      }),
    ]);
    const beforeSnapshot = messages.length;
    messages = mergeGraphMessages(messages, inboxSnapshot);
    messages = mergeGraphMessages(messages, sentSnapshot);
    console.log(
      `📬 Graph sync ${mailboxAddress}: inboxDelta=${inboxDelta.messages.length} sentDelta=${sentDelta.messages.length} snapshots=+${messages.length - beforeSnapshot} total=${messages.length}`
    );

    const skipFullBodies = ['scheduled', 'interval', 'initial'].includes(String(trigger));
    const stored = await this.persistMessages(resolvedUserId, mailboxAddress, messages, accessToken, {
      skipFullBodies,
    });

    const nextFolderState = {
      inbox: inboxDelta.nextDeltaLink || folderState.inbox,
      sent: sentDelta.nextDeltaLink || folderState.sent,
      sentSubId: folderState.sentSubId,
      sentSubExp: folderState.sentSubExp,
    };

    await mailboxStateService.upsertState(resolvedUserId, {
      delta_link: serializeFolderDeltaState(nextFolderState),
      last_synced_at: new Date().toISOString(),
    });

    try {
      await this.ensureInboxMailSubscription(resolvedUserId, accessToken, mailboxAddress);
    } catch (subErr) {
      console.warn(`⚠️ Graph Inbox subscription ensure failed (sync still succeeded):`, subErr.message || subErr);
    }
    try {
      await this.ensureSentItemsMailSubscription(resolvedUserId, accessToken, mailboxAddress);
    } catch (subErr) {
      console.warn(`⚠️ Graph Sent Items subscription ensure failed (sync still succeeded):`, subErr.message || subErr);
    }

    try {
      const dbState = await mailboxStateService.getState(resolvedUserId);
      const subscriptionId = dbState?.subscription_id;
      const subscriptionExpiry = dbState?.subscription_expiry;

      if (subscriptionId && subscriptionExpiry) {
        const expiresAt = new Date(subscriptionExpiry).getTime();
        const now = Date.now();
        const isExpired = expiresAt < now;
        const expiresSoon = expiresAt - now < 24 * 60 * 60 * 1000;

        console.log(`✅ Graph webhook subscription for user ${resolvedUserId} (${mailboxAddress})`, {
          subscriptionId,
          expiresAt: subscriptionExpiry,
          status: isExpired ? 'expired' : expiresSoon ? 'expires_soon' : 'active',
        });
      } else {
        console.log(
          `ℹ️  No Graph mail subscription in DB for user ${resolvedUserId} (${mailboxAddress}) — set GRAPH_WEBHOOK_NOTIFICATION_URL to enable push-triggered sync`
        );
      }
    } catch (error) {
      console.error(`⚠️  Error reading subscription from DB for user ${resolvedUserId}:`, error.message || error);
    }

    return {
      synced: stored.processed,
      inserted: stored.inserted,
      skipped: stored.skipped,
      trackedConversations: stored.trackedCount,
      deltaLink: serializeFolderDeltaState(nextFolderState),
    };
  }

  /**
   * Microsoft Graph delta tokens and sync generations always expire eventually (410 / SyncStateNotFound).
   * Webhook subscriptions + periodic sync keep a fresh delta link; this cannot be disabled on Microsoft's side.
   */
  async deleteGraphMailSubscription(accessToken, subscriptionId) {
    if (!subscriptionId) return;
    const res = await fetch(`${GRAPH_BASE_URL}/subscriptions/${encodeURIComponent(subscriptionId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok && res.status !== 404) {
      const t = await res.text();
      throw new Error(`DELETE subscription failed (${res.status}): ${t}`);
    }
  }

  nextMailSubscriptionExpiryIso() {
    return new Date(Date.now() + GRAPH_MAIL_SUBSCRIPTION_MAX_MINUTES * 60 * 1000).toISOString();
  }

  /**
   * Create or renew a Graph change notification on Inbox messages so webhooks trigger sync before delta goes stale.
   * Requires GRAPH_WEBHOOK_NOTIFICATION_URL (public HTTPS URL to POST /api/graph/webhook).
   * clientState must be the internal CRM user id — webhook handler uses it to enqueue sync.
   */
  async ensureInboxMailSubscription(resolvedUserId, accessToken, mailboxAddress) {
    if (!WEBHOOK_URL) {
      return { skipped: true, reason: 'GRAPH_WEBHOOK_NOTIFICATION_URL not set' };
    }
    if (!resolvedUserId || !accessToken || !mailboxAddress) {
      return { skipped: true, reason: 'missing_parameters' };
    }

    const state = await mailboxStateService.getState(resolvedUserId);
    const now = Date.now();
    const subId = state?.subscription_id || null;
    const subExpMs = state?.subscription_expiry ? new Date(state.subscription_expiry).getTime() : 0;

    if (subId && subExpMs > now + GRAPH_SUBSCRIPTION_RENEW_BEFORE_MS) {
      return { skipped: true, reason: 'subscription_valid', expiry: state.subscription_expiry };
    }

    if (subId && subExpMs > now) {
      try {
        const newExp = this.nextMailSubscriptionExpiryIso();
        const res = await fetch(`${GRAPH_BASE_URL}/subscriptions/${encodeURIComponent(subId)}`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ expirationDateTime: newExp }),
        });
        const text = await res.text();
        if (!res.ok) {
          throw new Error(text || `PATCH ${res.status}`);
        }
        let json = {};
        if (text) {
          try {
            json = JSON.parse(text);
          } catch {
            json = {};
          }
        }
        const expiry = json.expirationDateTime || newExp;
        await mailboxStateService.upsertState(resolvedUserId, {
          subscription_id: json.id || subId,
          subscription_expiry: expiry,
        });
        console.log(`🔔 Extended Graph mail subscription for user ${resolvedUserId} until ${expiry}`);
        return { renewed: true, subscriptionId: json.id || subId, expirationDateTime: expiry };
      } catch (patchErr) {
        console.warn(`⚠️ Subscription PATCH failed, recreating:`, patchErr.message || patchErr);
        await this.deleteGraphMailSubscription(accessToken, subId).catch(() => {});
        await mailboxStateService.upsertState(resolvedUserId, {
          subscription_id: null,
          subscription_expiry: null,
        });
      }
    } else if (subId) {
      await this.deleteGraphMailSubscription(accessToken, subId).catch(() => {});
      await mailboxStateService.upsertState(resolvedUserId, {
        subscription_id: null,
        subscription_expiry: null,
      });
    }

    const expirationDateTime = this.nextMailSubscriptionExpiryIso();
    const resource = `users/${encodeURIComponent(mailboxAddress)}/mailFolders('Inbox')/messages`;
    const body = {
      changeType: 'created,updated',
      notificationUrl: WEBHOOK_URL,
      resource,
      expirationDateTime,
      clientState: String(resolvedUserId),
    };

    const res = await fetch(`${GRAPH_BASE_URL}/subscriptions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Create subscription failed (${res.status}): ${text.slice(0, 500)}`);
    }
    const json = JSON.parse(text);
    await mailboxStateService.upsertState(resolvedUserId, {
      subscription_id: json.id,
      subscription_expiry: json.expirationDateTime || expirationDateTime,
    });
    console.log(`🔔 Created Graph mail subscription for user ${resolvedUserId} (${mailboxAddress}) until ${json.expirationDateTime}`);
    return { created: true, subscriptionId: json.id, expirationDateTime: json.expirationDateTime };
  }

  /**
   * Push notifications on Sent Items so employee → client Outlook sends sync immediately.
   * Subscription id is stored in mailbox_state.delta_link JSON (sentSubId / sentSubExp).
   */
  async ensureSentItemsMailSubscription(resolvedUserId, accessToken, mailboxAddress) {
    if (!WEBHOOK_URL) {
      return { skipped: true, reason: 'GRAPH_WEBHOOK_NOTIFICATION_URL not set' };
    }
    if (!resolvedUserId || !accessToken || !mailboxAddress) {
      return { skipped: true, reason: 'missing_parameters' };
    }

    const state = await mailboxStateService.getState(resolvedUserId);
    const folderState = parseFolderDeltaState(state?.delta_link);
    const now = Date.now();
    const subId = folderState.sentSubId || null;
    const subExpMs = folderState.sentSubExp ? new Date(folderState.sentSubExp).getTime() : 0;

    const persistSentSub = async (id, expiry) => {
      const latest = parseFolderDeltaState((await mailboxStateService.getState(resolvedUserId))?.delta_link);
      latest.sentSubId = id || null;
      latest.sentSubExp = expiry || null;
      await mailboxStateService.upsertState(resolvedUserId, {
        delta_link: serializeFolderDeltaState(latest),
      });
    };

    if (subId && subExpMs > now + GRAPH_SUBSCRIPTION_RENEW_BEFORE_MS) {
      return { skipped: true, reason: 'subscription_valid', expiry: folderState.sentSubExp };
    }

    if (subId && subExpMs > now) {
      try {
        const newExp = this.nextMailSubscriptionExpiryIso();
        const res = await fetch(`${GRAPH_BASE_URL}/subscriptions/${encodeURIComponent(subId)}`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ expirationDateTime: newExp }),
        });
        const text = await res.text();
        if (!res.ok) {
          throw new Error(text || `PATCH ${res.status}`);
        }
        let json = {};
        if (text) {
          try {
            json = JSON.parse(text);
          } catch {
            json = {};
          }
        }
        const expiry = json.expirationDateTime || newExp;
        await persistSentSub(json.id || subId, expiry);
        console.log(`🔔 Extended Graph Sent Items subscription for user ${resolvedUserId} until ${expiry}`);
        return { renewed: true, subscriptionId: json.id || subId, expirationDateTime: expiry };
      } catch (patchErr) {
        console.warn(`⚠️ Sent Items subscription PATCH failed, recreating:`, patchErr.message || patchErr);
        await this.deleteGraphMailSubscription(accessToken, subId).catch(() => {});
        await persistSentSub(null, null);
      }
    } else if (subId) {
      await this.deleteGraphMailSubscription(accessToken, subId).catch(() => {});
      await persistSentSub(null, null);
    }

    const expirationDateTime = this.nextMailSubscriptionExpiryIso();
    const resource = `users/${encodeURIComponent(mailboxAddress)}/mailFolders('SentItems')/messages`;
    const body = {
      changeType: 'created,updated',
      notificationUrl: WEBHOOK_URL,
      resource,
      expirationDateTime,
      clientState: String(resolvedUserId),
    };

    const res = await fetch(`${GRAPH_BASE_URL}/subscriptions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Create Sent Items subscription failed (${res.status}): ${text.slice(0, 500)}`);
    }
    const json = JSON.parse(text);
    const expiry = json.expirationDateTime || expirationDateTime;
    await persistSentSub(json.id, expiry);
    console.log(
      `🔔 Created Graph Sent Items subscription for user ${resolvedUserId} (${mailboxAddress}) until ${expiry}`
    );
    return { created: true, subscriptionId: json.id, expirationDateTime: expiry };
  }

  /** Ensure webhook subscription only (no mail fetch). Used after OAuth connect from the client. */
  async ensureSubscriptionForUser(userId) {
    const tokenRecord = await mailboxTokenService.getTokenByUserId(userId);
    if (!tokenRecord) {
      throw new Error('Mailbox is not connected for this user');
    }
    const resolvedUserId = tokenRecord.user_id;
    if (!resolvedUserId) {
      throw new Error('Mailbox token is missing CRM user reference');
    }
    const { accessToken } = await graphAuthService.getAccessTokenForUser(userId);
    if (!accessToken) {
      throw new Error('Unable to acquire Microsoft Graph access token');
    }
    const inbox = await this.ensureInboxMailSubscription(
      resolvedUserId,
      accessToken,
      tokenRecord.mailbox_address
    );
    const sent = await this.ensureSentItemsMailSubscription(
      resolvedUserId,
      accessToken,
      tokenRecord.mailbox_address
    ).catch((err) => {
      console.warn(`⚠️ Sent Items subscription after connect failed:`, err.message || err);
      return { skipped: true, reason: err.message || 'sent_subscription_failed' };
    });
    return { inbox, sent };
  }

  async syncAllMailboxes(options = {}) {
    const tokens = await mailboxTokenService.getAllTokens();
    if (!tokens.length) {
      return { processed: 0, successful: 0, failed: 0 };
    }

    const results = await tokens.reduce(
      async (promise, token) => {
        const acc = await promise;
        if (!token?.user_id) {
          return acc;
        }
        if (token.status === 'needs_reconnect') {
          acc.failed += 1;
          acc.details.push({
            userId: token.user_id,
            mailbox: token.mailbox_address,
            error: 'needs_reconnect',
          });
          return acc;
        }

        try {
          const summary = await this.syncMailboxForUser(token.user_id, {
            ...options,
            trigger: options.trigger || 'scheduler',
          });
          acc.successful += 1;
          acc.details.push({
            userId: token.user_id,
            mailbox: token.mailbox_address,
            summary,
          });
        } catch (error) {
          acc.failed += 1;
          acc.details.push({
            userId: token.user_id,
            mailbox: token.mailbox_address,
            error: error.message || 'Unknown error',
          });
        }

        return acc;
      },
      Promise.resolve({ successful: 0, failed: 0, details: [] })
    );

    return {
      processed: tokens.length,
      ...results,
    };
  }

  async ensureSubscription({ userId, accessToken, state, mailboxAddress }) {
    // Subscriptions are stored in the database (mailbox_state table)
    // We just read from DB - subscriptions are created/managed elsewhere
    try {
      const dbState = await mailboxStateService.getState(userId);
      const subscriptionId = dbState?.subscription_id || state?.subscription_id;
      const subscriptionExpiry = dbState?.subscription_expiry || state?.subscription_expiry;

      if (subscriptionId && subscriptionExpiry) {
        const expiresAt = new Date(subscriptionExpiry).getTime();
        const now = Date.now();
        const isExpired = expiresAt < now;
        const expiresSoon = expiresAt - now < 24 * 60 * 60 * 1000;

        console.log(`✅ Subscription found in DB for user ${userId} (${mailboxAddress})`, {
          subscriptionId,
          expiresAt: subscriptionExpiry,
          isExpired,
          expiresSoon,
          status: isExpired ? 'expired' : expiresSoon ? 'expires_soon' : 'active',
        });
      } else {
        console.log(`ℹ️  No subscription found in DB for user ${userId} (${mailboxAddress})`);
      }
    } catch (error) {
      console.error('⚠️  Error reading subscription from DB:', {
        userId,
        mailbox: mailboxAddress,
        error: error.message || error,
      });
    }
  }

  async refreshAllSubscriptions() {
    const tokens = await mailboxTokenService.getAllTokens();
    if (!tokens.length) {
      return { processed: 0, successful: 0, failed: 0, skipped: 0, details: [] };
    }

    const acc = { successful: 0, failed: 0, skipped: 0, details: [] };

    for (const token of tokens) {
      if (!token?.user_id) continue;
      try {
        const tokenRecord = await mailboxTokenService.getTokenByUserId(token.user_id);
        if (!tokenRecord?.refresh_token) {
          acc.skipped += 1;
          acc.details.push({
            userId: token.user_id,
            mailbox: token.mailbox_address,
            status: 'skipped',
            reason: 'no_refresh_token',
          });
          continue;
        }
        if (tokenRecord.status === 'needs_reconnect') {
          acc.skipped += 1;
          acc.details.push({
            userId: token.user_id,
            mailbox: token.mailbox_address,
            status: 'skipped',
            reason: 'needs_reconnect',
          });
          continue;
        }

        const { accessToken } = await graphAuthService.getAccessTokenForUser(token.user_id);
        if (!accessToken) {
          throw new Error('No access token');
        }

        const inbox = await this.ensureInboxMailSubscription(
          token.user_id,
          accessToken,
          tokenRecord.mailbox_address
        );
        const sent = await this.ensureSentItemsMailSubscription(
          token.user_id,
          accessToken,
          tokenRecord.mailbox_address
        );
        acc.successful += 1;
        acc.details.push({
          userId: token.user_id,
          mailbox: token.mailbox_address,
          inbox,
          sent,
        });
      } catch (error) {
        acc.failed += 1;
        acc.details.push({
          userId: token.user_id,
          mailbox: token.mailbox_address,
          status: 'failed',
          error: error.message || 'Unknown error',
        });
      }
    }

    return {
      processed: tokens.length,
      ...acc,
    };
  }

  async checkSubscriptionsStatus() {
    if (!WEBHOOK_URL) {
      return {
        webhookUrlConfigured: false,
        webhookUrl: null,
        message: 'GRAPH_WEBHOOK_NOTIFICATION_URL not configured',
        subscriptions: [],
      };
    }

    const tokens = await mailboxTokenService.getAllTokens();
    const subscriptions = [];

    for (const token of tokens) {
      if (!token?.user_id) continue;

      const state = await mailboxStateService.getState(token.user_id);
      const expiresAt = state?.subscription_expiry ? new Date(state.subscription_expiry).getTime() : 0;
      const now = Date.now();
      const isExpired = expiresAt < now;
      const expiresSoon = expiresAt - now < 24 * 60 * 60 * 1000;

      subscriptions.push({
        userId: token.user_id,
        mailbox: token.mailbox_address,
        subscriptionId: state?.subscription_id || null,
        expiry: state?.subscription_expiry || null,
        isExpired,
        expiresSoon,
        status: !state?.subscription_id ? 'missing' : isExpired ? 'expired' : expiresSoon ? 'expires_soon' : 'active',
      });
    }

    return {
      webhookUrlConfigured: true,
      webhookUrl: WEBHOOK_URL,
      totalMailboxes: tokens.length,
      subscriptions,
    };
  }

  async fetchFolderDelta({ accessToken, mailboxAddress, folder, deltaLink }) {
    const folderName = folder === 'SentItems' ? 'SentItems' : 'Inbox';
    const initialUrl = `${GRAPH_BASE_URL}/users/${encodeURIComponent(mailboxAddress)}/mailFolders('${folderName}')/messages/delta?$select=${DELTA_MESSAGE_SELECT}&$top=${DEFAULT_SYNC_BATCH}`;
    let url = deltaLink || initialUrl;
    const messages = [];
    let nextLink = null;
    let retried410 = false;
    let pages = 0;

    while (url && pages < MAX_DELTA_PAGES) {
      pages += 1;
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Prefer: `outlook.body-preview="text"`,
        },
      });

      if (response.status === 410) {
        const errorText = await response.text();
        if (!retried410) {
          console.warn(
            `⚠️ Graph ${folderName} delta returned 410; restarting that folder once. ${errorText.slice(0, 240)}`
          );
          retried410 = true;
          messages.length = 0;
          nextLink = null;
          url = initialUrl;
          pages = 0;
          continue;
        }
        throw new Error(`Graph ${folderName} delta request failed (${response.status}): ${errorText}`);
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Graph ${folderName} delta request failed (${response.status}): ${errorText}`);
      }

      const json = await response.json();
      if (Array.isArray(json.value)) {
        messages.push(...json.value);
      }

      if (json['@odata.nextLink']) {
        url = json['@odata.nextLink'];
        if (pages >= MAX_DELTA_PAGES) {
          nextLink = url;
          break;
        }
      } else {
        url = null;
        nextLink = json['@odata.deltaLink'] || (retried410 ? null : deltaLink);
      }
    }

    return { messages, nextDeltaLink: nextLink, folder: folderName, pages };
  }

  async fetchDeltaMessages({ accessToken, mailboxAddress, deltaLink }) {
    const state = parseFolderDeltaState(deltaLink);
    const [inbox, sent] = await Promise.all([
      this.fetchFolderDelta({
        accessToken,
        mailboxAddress,
        folder: 'Inbox',
        deltaLink: state.inbox,
      }),
      this.fetchFolderDelta({
        accessToken,
        mailboxAddress,
        folder: 'SentItems',
        deltaLink: state.sent,
      }),
    ]);
    return {
      messages: mergeGraphMessages(inbox.messages, sent.messages),
      nextDeltaLink: serializeFolderDeltaState({
        ...state,
        inbox: inbox.nextDeltaLink || state.inbox,
        sent: sent.nextDeltaLink || state.sent,
      }),
    };
  }

  async persistMessages(userId, mailboxAddress, messages = [], accessToken = null, options = {}) {
    if (!messages.length) {
      return { processed: 0, inserted: 0, skipped: 0, trackedCount: 0 };
    }

    const rows = messages.map((msg) => {
      const normalizedMailbox = normalise(mailboxAddress);
      const senderFromGraph = normalise(msg.from?.emailAddress?.address) || null;
      const effectiveSender = senderFromGraph || normalizedMailbox || null;
      const senderName =
        msg.from?.emailAddress?.name ||
        msg.from?.emailAddress?.address ||
        normalizedMailbox ||
        null;
      const toList = (msg.toRecipients || [])
        .map((r) => normalise(r.emailAddress?.address))
        .filter(Boolean);
      const ccList = (msg.ccRecipients || [])
        .map((r) => normalise(r.emailAddress?.address))
        .filter(Boolean);
      const recipientList = [...toList, ...ccList]
        .filter(Boolean)
        .join(', ');

      const direction = effectiveSender === normalizedMailbox ? 'outgoing' : 'incoming';
      const sentAt = msg.sentDateTime || msg.receivedDateTime || new Date().toISOString();

      // Note: bodyPreview from Graph API is truncated (usually ~255 chars)
      // We'll fetch the full body separately and update it
      // For now, store the preview but mark that we need to fetch the full body
      return {
        message_id: msg.id,
        user_id: userId,
        sender_name: senderName,
        sender_email: effectiveSender,
        recipient_list: recipientList,
        subject: msg.subject || '(no subject)',
        body_html: '', // Will be populated when full body is fetched
        body_preview: msg.bodyPreview || '', // Truncated preview from Graph API
        sent_at: sentAt,
        direction,
        thread_id: msg.conversationId || null,
        attachments: null,
        client_id: null,
        legacy_id: null,
        contact_id: null,
        body_cached: false, // Flag to indicate full body needs to be fetched
      };
    });

    const addressSet = new Set();
    rows.forEach((row) => {
      if (row.sender_email) {
        addressSet.add(row.sender_email);
      }
      if (row.recipient_list) {
        row.recipient_list
          .split(',')
          .map((addr) => normalise(addr))
          .filter(Boolean)
          .forEach((addr) => addressSet.add(addr));
      }
    });

    let leadMappings = {};
    if (addressSet.size > 0) {
      leadMappings = await fetchLeadMappingsForAddresses(Array.from(addressSet));
    }

    const OFFICE_EMAIL = 'office@lawoffice.org.il';
    const LEADS_EMAIL = 'leads@lawoffice.org.il';
    const prepared = [];
    let filteredOut = 0;

    for (const row of rows) {
      const senderEmail = row.sender_email ? normalise(row.sender_email) : null;
      const recipientList = row.recipient_list || '';
      const recipientListLower = recipientList.toLowerCase();

      const recipientAddresses = row.recipient_list
        ? row.recipient_list.split(',').map((addr) => normalise(addr)).filter(Boolean)
        : [];
      const hasExternalRecipient = recipientAddresses.some((addr) => addr && !isLawofficeDomain(addr));

      // Keep website/newsletter blocks unless a non-office client is on To/Cc.
      if (senderEmail && shouldFilterEmail(senderEmail) && !hasExternalRecipient) {
        console.log(
          `🚫 Skipping email ${row.message_id?.substring(0, 20) || 'unknown'}... - sender is blocked | sender=${row.sender_email || 'unknown'} | recipients=${row.recipient_list || 'none'}`
        );
        filteredOut += 1;
        continue;
      }

      if (shouldFilterInternalEmail(senderEmail, recipientList)) {
        console.log(
          `🚫 Skipping email ${row.message_id?.substring(0, 20) || 'unknown'}... - internal to internal email | sender=${row.sender_email || 'unknown'} | recipients=${row.recipient_list || 'none'}`
        );
        filteredOut += 1;
        continue;
      }

      const matches = preferContactMatches(collectMatchesForEmailRow(row, leadMappings));
      const hasOfficeRecipient = recipientListLower.includes(OFFICE_EMAIL);
      // Only drop leads@ mail when it did not match a client contact/lead.
      if (recipientListLower.includes(LEADS_EMAIL) && matches.length === 0 && !hasOfficeRecipient) {
        console.log(
          `🚫 Skipping email ${row.message_id?.substring(0, 20) || 'unknown'}... - recipient is leads@lawoffice.org.il with no client match | sender=${row.sender_email || 'unknown'} | recipients=${row.recipient_list || 'none'}`
        );
        filteredOut += 1;
        continue;
      }

      if (matches.length === 0 && !hasOfficeRecipient) {
        console.log(
          `📭 No lead/contact match for message ${row.message_id.substring(0, 20)}... | sender=${row.sender_email || 'unknown'} | recipients=${row.recipient_list || 'none'}`
        );
        filteredOut += 1;
        continue;
      }

      const primary = primaryMatchFrom(matches);
      prepared.push({
        row: {
          ...row,
          client_id: primary?.clientId || null,
          legacy_id: primary?.legacyId || null,
          contact_id: primary?.contactId || null,
        },
        contactIds: contactIdsFromMatches(matches),
      });
    }

    if (!prepared.length) {
      console.log(`📭 No emails to save after filtering (${rows.length} processed, 0 matched criteria)`);
      return { processed: messages.length, inserted: 0, skipped: rows.length, trackedCount: 0 };
    }

    // Do not SELECT emails by message_id first — that seq-scans ~5M rows and times out.
    // insert_mailbox_email returns the existing id on unique_violation when an index exists.
    const toInsert = [];
    let duplicatesSkipped = 0;

    for (const item of prepared) {
      if (!item.row.message_id) {
        filteredOut += 1;
        continue;
      }
      toInsert.push(item);
    }

    let insertedCount = 0;
    let errorCount = 0;
    const insertedForBodies = [];

    for (const item of toInsert) {
      const result = await insertMailboxEmailRow(item.row);
      if (result.id && !result.error) {
        if (result.duplicate) {
          duplicatesSkipped += 1;
        } else {
          insertedCount += 1;
          insertedForBodies.push({ ...item.row, id: result.id });
        }
        await linkEmailContacts(result.id, item.contactIds);
        continue;
      }
      errorCount += 1;
    }

    if (errorCount > 0) {
      console.warn(`⚠️ Completed with ${insertedCount} inserted, ${errorCount} failed out of ${toInsert.length} new`);
    } else {
      console.log(`✅ Successfully inserted ${insertedCount} email record(s); linked contacts on ${prepared.length} matched message(s)`);
    }

    const newLeadEmails = toInsert
      .filter((item) => !item.row.client_id && !item.row.legacy_id)
      .filter((item) => (item.row.recipient_list || '').toLowerCase().includes(OFFICE_EMAIL))
      .map((item) => item.row);

    if (newLeadEmails.length) {
      console.log(`📧 Sending push notifications for ${newLeadEmails.length} new email lead(s)`);
      await Promise.all(
        newLeadEmails.map(async (emailRow) => {
          const senderLabel = emailRow.sender_name || emailRow.sender_email || 'Email lead';
          const preview = stripHtml(emailRow.body_preview || emailRow.body_html || '').substring(0, 120);
          try {
            await pushNotificationService.sendNotificationToAll({
              title: '✉️ New Email Lead',
              body: preview ? `${senderLabel}: ${preview}` : `${senderLabel} sent a message`,
              icon: '/icon-192x192.png',
              badge: '/icon-72x72.png',
              url: '/email-leads',
              tag: `email-lead-${emailRow.message_id}`,
              id: emailRow.message_id,
              type: 'notification',
              vibrate: [200, 100, 200],
            });
          } catch (notificationError) {
            console.error('⚠️  Failed to send email lead notification:', notificationError);
          }
        })
      );
    } else {
      console.log(`ℹ️  No new email leads to notify (${insertedCount} new emails processed)`);
    }

    if (accessToken && insertedForBodies.length && !options.skipFullBodies) {
      this.fetchFullBodiesForMessages(userId, mailboxAddress, insertedForBodies, accessToken).catch((err) => {
        console.error('⚠️  Error fetching full email bodies:', err.message || err);
      });
    } else if (options.skipFullBodies && insertedForBodies.length) {
      console.log(
        `⏭️ Skipping eager full-body fetch for ${insertedForBodies.length} new email(s) on scheduled sync (loaded when opened)`
      );
    }

    console.log(`📥 Stored ${insertedCount} new emails (processed ${messages.length}, ${duplicatesSkipped} already saved, ${filteredOut} filtered out)`);

    return {
      processed: messages.length,
      inserted: insertedCount,
      skipped: filteredOut + duplicatesSkipped + errorCount,
      trackedCount: 0,
    };
  }

  // Fetch full email bodies for messages that only have truncated previews
  async fetchFullBodiesForMessages(userId, mailboxAddress, emailRows, accessToken) {
    if (!emailRows || emailRows.length === 0 || !accessToken) return;

    const graphDelayMs = Math.max(
      200,
      parseInt(process.env.GRAPH_EMAIL_BODY_GRAPH_DELAY_MS || '500', 10) || 500
    );

    const uniqueMessageIds = [...new Set(emailRows.map((r) => r.message_id).filter(Boolean))];
    const idByMessageId = new Map();
    emailRows.forEach((row) => {
      if (row?.message_id && row?.id && !idByMessageId.has(row.message_id)) {
        idByMessageId.set(row.message_id, row.id);
      }
    });
    console.log(
      `📧 Fetching full bodies + attachment metadata: ${uniqueMessageIds.length} unique Graph message(s) for ${emailRows.length} DB row(s) (serial + 429 backoff; avoids MailboxConcurrency)`
    );

    const graphHeaders = {
      Authorization: `Bearer ${accessToken}`,
      Prefer: `outlook.body-preview="text"`,
    };

    for (let u = 0; u < uniqueMessageIds.length; u++) {
      const messageId = uniqueMessageIds[u];
      const encodedUser = encodeURIComponent(mailboxAddress);
      const encodedMsg = encodeURIComponent(messageId);

      let fullBody = '';
      try {
        const message = await fetchGraphJsonWithRetry(
          `${GRAPH_BASE_URL}/users/${encodedUser}/messages/${encodedMsg}?$select=body`,
          { headers: graphHeaders }
        );
        fullBody = message.body?.content || '';
      } catch (err) {
        console.error(`⚠️  Error fetching body for ${messageId?.substring(0, 40) || 'unknown'}...:`, err.message || err);
      }

      let attachmentsMeta = [];
      let attachmentsFetched = false;
      try {
        attachmentsMeta = await fetchMessageAttachmentsMetadata(accessToken, mailboxAddress, messageId);
        attachmentsFetched = true;
      } catch (attErr) {
        if (!isGraphMessageNotFound(attErr)) {
          console.warn(
            `⚠️  Error fetching attachments for ${messageId?.substring(0, 40) || 'unknown'}...:`,
            attErr.message || attErr
          );
        }
      }

      const hasBody = Boolean(fullBody && fullBody.trim().length > 0);
      const patch = {};
      // Keep full HTML in email_bodies only. Writing it onto public.emails
      // (and into body_preview) was a top CPU cost on the 5M-row table.
      if (hasBody) {
        patch.body_cached = true;
      }
      if (attachmentsFetched) {
        patch.attachments = attachmentsMeta.length ? attachmentsMeta : null;
      }

      const dbId = idByMessageId.get(messageId);
      if (Object.keys(patch).length > 0) {
        if (dbId) {
          await patchMailboxEmailBody(dbId, patch);
        } else {
          console.warn(
            `⚠️  Skipping emails body patch for ${messageId.substring(0, 24)}... (no row id; avoiding message_id scan)`
          );
        }
      }

      if (hasBody && dbId) {
        const { error: bodyUpsertError } = await supabase.from(EMAIL_BODIES_TABLE).upsert({
          email_id: dbId,
          body_html: fullBody,
          updated_at: new Date().toISOString(),
        });
        if (bodyUpsertError) {
          console.warn(`⚠️  email_bodies upsert skipped for message ${messageId.substring(0, 20)}...:`, bodyUpsertError.message);
        }
      }

      if (u + 1 < uniqueMessageIds.length) {
        await sleep(graphDelayMs);
      }
    }

    console.log(`✅ Finished full-body + attachments pass (${uniqueMessageIds.length} unique message(s))`);
  }

  /**
   * Older syncs stored `attachments: []` when hasAttachments was true, or never fetched metadata.
   * Refreshes attachment JSON for recent cached rows that still have null/empty attachments.
   */
  async backfillAttachmentMetadata(userId, mailboxAddress, accessToken, { limit = 30 } = {}) {
    if (!userId || !mailboxAddress || !accessToken) return;

    const graphDelayMs = Math.max(
      200,
      parseInt(process.env.GRAPH_EMAIL_BODY_GRAPH_DELAY_MS || '500', 10) || 500
    );

    const sinceIso = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const take = Math.min(80, Math.max(5, limit * 2));
    const { data: rows, error } = await supabase
      .from(EMAIL_HEADERS_TABLE)
      .select('id, message_id, attachments')
      .eq('user_id', userId)
      .eq('body_cached', true)
      .gte('sent_at', sinceIso)
      .order('sent_at', { ascending: false })
      .limit(take);

    if (error || !rows?.length) {
      if (error) console.warn('⚠️  backfillAttachmentMetadata query failed:', error.message);
      return;
    }

    const needsMeta = rows.filter((r) => {
      if (!r.message_id) return false;
      const a = r.attachments;
      if (a == null) return true;
      if (Array.isArray(a) && a.length === 0) return true;
      return false;
    });
    const uniqueIds = [...new Set(needsMeta.map((r) => r.message_id).filter(Boolean))].slice(0, limit);

    if (!uniqueIds.length) return;

    console.log(`📎 Backfilling attachment metadata for up to ${uniqueIds.length} message(s)`);

    const idByMessageId = new Map();
    needsMeta.forEach((row) => {
      if (row?.message_id && row?.id && !idByMessageId.has(row.message_id)) {
        idByMessageId.set(row.message_id, row.id);
      }
    });

    for (let i = 0; i < uniqueIds.length; i++) {
      const messageId = uniqueIds[i];
      try {
        const attachmentsMeta = await fetchMessageAttachmentsMetadata(accessToken, mailboxAddress, messageId);
        const payload = attachmentsMeta.length ? attachmentsMeta : null;
        const dbId = idByMessageId.get(messageId);
        if (dbId) {
          await patchMailboxEmailBody(dbId, { attachments: payload });
        } else {
          console.warn(
            `⚠️  Skipping attachment backfill for ${messageId?.substring(0, 24)}... (no row id; avoiding message_id scan)`
          );
        }
      } catch (err) {
        if (!isGraphMessageNotFound(err)) {
          console.warn(`⚠️  Attachment backfill Graph error for ${messageId?.substring(0, 24)}...:`, err.message || err);
        }
      }
      if (i + 1 < uniqueIds.length) {
        await sleep(graphDelayMs);
      }
    }
  }

  matchesAllowList(addresses, allowList) {
    if (!allowList.length) return false;
    return allowList.some((entry) => {
      if (entry.email && addresses.includes(entry.email)) return true;
      if (entry.domain) {
        return addresses.some((addr) => addr.endsWith(entry.domain));
      }
      return false;
    });
  }

  async loadAllowList() {
    try {
      const { data, error } = await supabase
        .from(ALLOWLIST_TABLE)
        .select('email,domain,active')
        .eq('active', true);
      if (error) throw error;
      return (data || []).map((row) => ({
        email: normalise(row.email),
        domain: normalise(row.domain).replace(/^\*@/, '@'),
      }));
    } catch (error) {
      console.warn('⚠️  Allow-list table not available:', error.message || error);
      return [];
    }
  }

  async loadTrackedConversations(userId) {
    try {
      const { data, error } = await supabase
        .from(TRACKED_THREADS_TABLE)
        .select('conversation_id')
        .eq('user_id', userId)
        .eq('is_tracked', true);
      if (error) throw error;
      return new Set((data || []).map((row) => row.conversation_id));
    } catch (error) {
      console.warn('⚠️  Tracked conversations table not available:', error.message || error);
      return new Set();
    }
  }

  async listEmails(userId, { page = 1, pageSize = 25 } = {}) {
    if (!userId) throw new Error('userId is required');
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from(EMAIL_HEADERS_TABLE)
      .select('*')
      .eq('user_id', userId)
      .order('received_at', { ascending: false })
      .range(from, to);
    if (error) {
      throw new Error(error.message || 'Failed to query emails');
    }
    return data || [];
  }

  async getEmailById(userId, emailId) {
    if (!emailId) throw new Error('emailId is required');

    const idValue = String(emailId);
    const isNumericId = /^\d+$/.test(idValue);

    const buildQuery = (withUserFilter = true) => {
      let query = supabase.from(EMAIL_HEADERS_TABLE).select('*').limit(1);
      query = isNumericId ? query.eq('id', Number(idValue)) : query.eq('message_id', idValue);
      if (withUserFilter && userId) {
        query = query.eq('user_id', userId);
      }
      return query;
    };

    let { data, error } = await buildQuery(true);
    if (error) throw new Error(error.message || 'Failed to load email');

    let record = data?.[0] || null;

    if (!record && userId) {
      const fallbackQuery = buildQuery(false).is('user_id', null);
      const { data: legacyData, error: legacyError } = await fallbackQuery;
      if (legacyError) throw new Error(legacyError.message || 'Failed to load legacy email');

      if (legacyData && legacyData.length) {
        const legacyRecord = legacyData[0];
        const updateQuery = isNumericId
          ? supabase.from(EMAIL_HEADERS_TABLE).update({ user_id: userId }).eq('id', Number(idValue))
          : supabase.from(EMAIL_HEADERS_TABLE).update({ user_id: userId }).eq('message_id', idValue);
        await updateQuery;
        record = { ...legacyRecord, user_id: userId };
      }
    }

    if (!record) {
      const { data: fallbackData, error: fallbackError } = await buildQuery(false);
      if (fallbackError) throw new Error(fallbackError.message || 'Failed to load email');
      record = fallbackData?.[0] || null;
    }

    return record;
  }

  normalizeAttachmentsArray(raw) {
    if (raw == null) return [];
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    if (typeof raw === 'object' && raw !== null && Array.isArray(raw.value)) {
      return raw.value;
    }
    return [];
  }

  /**
   * When attachments are missing or [], fetch metadata from Graph and persist (so UI can list files).
   * Returns the attachment array to include in API responses (may be empty). Does not throw on 404.
   */
  async ensureAttachmentsOnHeader(userId, header) {
    if (!header?.id || !header.message_id || String(header.message_id).startsWith('offer_')) {
      return this.normalizeAttachmentsArray(header.attachments);
    }

    const { data: row } = await supabase
      .from(EMAIL_HEADERS_TABLE)
      .select('attachments')
      .eq('id', header.id)
      .maybeSingle();

    const fromDb = this.normalizeAttachmentsArray(row?.attachments ?? header.attachments);
    if (fromDb.length > 0) return fromDb;

    const emailOwnerId = header.user_id || userId;
    const tokenRecord = await mailboxTokenService.getTokenByUserId(emailOwnerId);
    if (!tokenRecord?.mailbox_address) return [];

    let accessToken;
    try {
      ({ accessToken } = await graphAuthService.getAccessTokenForUser(emailOwnerId));
    } catch {
      return [];
    }
    if (!accessToken) return [];

    try {
      const list = await fetchMessageAttachmentsMetadata(
        accessToken,
        tokenRecord.mailbox_address,
        header.message_id
      );
      const payload = list.length ? list : null;
      await supabase.from(EMAIL_HEADERS_TABLE).update({ attachments: payload }).eq('id', header.id);
      return list;
    } catch (e) {
      if (!isGraphMessageNotFound(e)) {
        console.warn(`⚠️  ensureAttachmentsOnHeader failed for ${header.message_id?.substring(0, 30)}...:`, e.message || e);
      }
      return [];
    }
  }

  /** @returns {{ body: string, attachments: any[] }} */
  async getEmailBody(userId, emailId) {
    const header = await this.getEmailById(userId, emailId);
    if (!header) throw new Error('Email not found');

    const attachments = await this.ensureAttachmentsOnHeader(userId, header);

    // Check if this is an "offer_" message ID (optimistic price offer insert)
    const isOfferEmail = header.message_id && header.message_id.startsWith('offer_');

    if (isOfferEmail) {
      if (header.body_html && header.body_html.trim() !== '') {
        console.log(`✅ Returning body_html for offer email: ${header.message_id.substring(0, 30)}...`);
        return { body: header.body_html, attachments };
      }

      if (header.body_preview && header.body_preview.trim() !== '') {
        console.log(`✅ Returning body_preview for offer email: ${header.message_id.substring(0, 30)}...`);
        return { body: header.body_preview, attachments };
      }

      console.warn(`⚠️ No body_html or body_preview found for offer email: ${header.message_id}`);
      throw new Error('Email body not available for price offer email');
    }

    if (header.body_html && header.body_html.trim() !== '') {
      return { body: header.body_html, attachments };
    }

    const { data, error } = await supabase
      .from(EMAIL_BODIES_TABLE)
      .select('body_html')
      .eq('email_id', header.id)
      .limit(1);
    if (error) throw new Error(error.message || 'Failed to load email body');

    if (data && data.length && data[0].body_html && data[0].body_html.trim() !== '') {
      return { body: data[0].body_html, attachments };
    }

    const html = await this.fetchAndCacheBody(userId, header);
    const headerAfter = await this.getEmailById(userId, emailId);
    const attachmentsAfter = await this.ensureAttachmentsOnHeader(userId, headerAfter || header);
    return { body: html, attachments: attachmentsAfter };
  }

  async fetchAndCacheBody(userId, header) {
    // Use the email's owner user_id if available, otherwise fall back to the provided userId
    // This ensures we fetch from the correct mailbox that owns the email
    const emailOwnerId = header.user_id || userId;
    const tokenRecord = await mailboxTokenService.getTokenByUserId(emailOwnerId);
    if (!tokenRecord) {
      throw new Error(`Mailbox is not connected for user ${emailOwnerId} (email owner)`);
    }

    const { accessToken } = await graphAuthService.getAccessTokenForUser(emailOwnerId);
    if (!accessToken) throw new Error('Unable to acquire Microsoft Graph access token');

    const message = await fetchJson(
      `${GRAPH_BASE_URL}/users/${tokenRecord.mailbox_address}/messages/${header.message_id}?$select=body`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    const bodyHtml = message.body?.content || '';

    await supabase.from(EMAIL_BODIES_TABLE).upsert({
      email_id: header.id,
      body_html: bodyHtml,
      updated_at: new Date().toISOString(),
    });

    let attachmentsPayload = null;
    let attachmentsOk = false;
    try {
      const list = await fetchMessageAttachmentsMetadata(
        accessToken,
        tokenRecord.mailbox_address,
        header.message_id
      );
      attachmentsOk = true;
      attachmentsPayload = list.length ? list : null;
    } catch (e) {
      if (!isGraphMessageNotFound(e)) {
        console.warn(`⚠️  fetchAndCacheBody: attachments list failed for ${header.message_id}:`, e.message || e);
      }
    }

    const headerUpdate = { body_cached: true };
    if (attachmentsOk) {
      headerUpdate.attachments = attachmentsPayload;
    }

    await supabase.from(EMAIL_HEADERS_TABLE).update(headerUpdate).eq('id', header.id);

    return bodyHtml;
  }

  async downloadAttachment(userId, emailId, attachmentId) {
    const header = await this.getEmailById(userId, emailId);
    if (!header) throw new Error('Email not found');
    
    // Use the email's owner user_id if available, otherwise fall back to the provided userId
    // This ensures we fetch from the correct mailbox that owns the email
    const emailOwnerId = header.user_id || userId;
    const tokenRecord = await mailboxTokenService.getTokenByUserId(emailOwnerId);
    if (!tokenRecord) {
      throw new Error(`Mailbox is not connected for user ${emailOwnerId} (email owner)`);
    }

    const { accessToken } = await graphAuthService.getAccessTokenForUser(emailOwnerId);
    if (!accessToken) throw new Error('Unable to acquire Microsoft Graph access token');

    const attachment = await fetchJson(
      `${GRAPH_BASE_URL}/users/${tokenRecord.mailbox_address}/messages/${header.message_id}/attachments/${attachmentId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!attachment?.contentBytes) {
      throw new Error('Attachment does not include content bytes');
    }

    const buffer = Buffer.from(attachment.contentBytes, 'base64');
    return {
      buffer,
      fileName: attachment.name || 'attachment',
      contentType: attachment.contentType || 'application/octet-stream',
    };
  }

  async toggleThreadTracking(userId, conversationId, shouldTrack) {
    if (!conversationId) throw new Error('conversationId is required');
    const { error } = await supabase.from(TRACKED_THREADS_TABLE).upsert(
      {
        user_id: userId,
        conversation_id: conversationId,
        is_tracked: shouldTrack,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,conversation_id' }
    );
    if (error) throw new Error(error.message || 'Failed to update tracking state');
  }

  async sendEmail(userId, payload = {}) {
    if (!userId) {
      throw new Error('userId is required to send email');
    }

    const tokenRecord = await mailboxTokenService.getTokenByUserId(userId);
    if (!tokenRecord) {
      throw new Error('Mailbox is not connected for this user');
    }

    const { accessToken } = await graphAuthService.getAccessTokenForUser(userId);
    if (!accessToken) {
      throw new Error('Unable to acquire Microsoft Graph access token');
    }

    const toRecipients = toGraphRecipients(payload.to);
    if (!toRecipients.length) {
      throw new Error('At least one recipient email address is required');
    }

    const ccRecipients = toGraphRecipients(payload.cc);
    const bccRecipients = toGraphRecipients(payload.bcc);

    const attachments = Array.isArray(payload.attachments)
      ? payload.attachments
          .filter((item) => item && item.contentBytes)
          .map((item) => ({
            '@odata.type': '#microsoft.graph.fileAttachment',
            name: item.name || 'attachment',
            contentType: item.contentType || 'application/octet-stream',
            contentBytes: item.contentBytes,
            ...(item.contentId ? { contentId: String(item.contentId) } : {}),
            ...(item.isInline ? { isInline: true } : {}),
          }))
      : [];

    const replyToRecipients = toGraphRecipients(payload.replyTo);

    const bodyContent = typeof payload.bodyHtml === 'string' && payload.bodyHtml.length > 0
      ? payload.bodyHtml
      : payload.bodyText || '';

    if (!bodyContent || !bodyContent.trim()) {
      throw new Error('Email body content is required');
    }

    const message = {
      subject: payload.subject || '(no subject)',
      body: {
        contentType: payload.bodyContentType || 'HTML',
        content: bodyContent,
      },
      toRecipients,
      ...(ccRecipients.length ? { ccRecipients } : {}),
      ...(bccRecipients.length ? { bccRecipients } : {}),
      ...(attachments.length ? { attachments } : {}),
      ...(replyToRecipients.length ? { replyTo: replyToRecipients } : {}),
      importance: payload.importance || 'normal',
      internetMessageHeaders: Array.isArray(payload.internetMessageHeaders) ? payload.internetMessageHeaders : undefined,
    };

    const mailboxAddress = tokenRecord.mailbox_address;
    if (!mailboxAddress) {
      throw new Error('Mailbox address is missing for this user');
    }

    const createDraftResponse = await fetch(`${GRAPH_BASE_URL}/users/${encodeURIComponent(mailboxAddress)}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });

    if (!createDraftResponse.ok) {
      const errorText = await createDraftResponse.text();
      throw new Error(`Failed to create draft message: ${errorText}`);
    }

    const draft = await createDraftResponse.json();
    const messageId = draft?.id;
    if (!messageId) {
      throw new Error('Microsoft Graph did not return a message ID for the draft');
    }

    const sendResponse = await fetch(
      `${GRAPH_BASE_URL}/users/${encodeURIComponent(mailboxAddress)}/messages/${messageId}/send`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!sendResponse.ok) {
      const errorText = await sendResponse.text();
      throw new Error(`Failed to send email: ${errorText}`);
    }

    const sendResult = {
      id: messageId,
      conversationId: draft?.conversationId || null,
      internetMessageId: draft?.internetMessageId || null,
      sentAt: draft?.sentDateTime || draft?.createdDateTime || new Date().toISOString(),
    };

    const recordArgs = {
      userId: tokenRecord.user_id,
      userInternalId: tokenRecord.user_id,
      mailboxAddress,
      payload,
      result: sendResult,
    };

    try {
      await this.recordOutgoingEmail(recordArgs);
    } catch (error) {
      console.error('⚠️  Unable to record outgoing email:', error.message || error);
    }

    return sendResult;
  }

  async recordOutgoingEmail({ userId, userInternalId, mailboxAddress, payload = {}, result }) {
    try {
      const context = payload.context || {};
      const legacyIdRaw =
        context.legacyLeadId ??
        (context.leadType === 'legacy' || (context.clientId && String(context.clientId).startsWith('legacy_'))
          ? context.clientId
          : null);
      const legacyId =
        legacyIdRaw != null && legacyIdRaw !== ''
          ? Number(String(legacyIdRaw).replace(/legacy_/i, ''))
          : null;
      const isLegacy = Number.isFinite(legacyId);
      const clientId = !isLegacy ? context.clientId ?? null : null;

      const recipients = buildRecipientList(payload);
      const senderEmail = normalise(mailboxAddress);
      const recipientListStr = recipients.join(', ');
      const contextContactId = context.contactId || context.contact_id || null;
      const hasLeadContext = !!(clientId || legacyId || contextContactId);

      if (!hasLeadContext && shouldFilterInternalEmail(senderEmail, recipientListStr)) {
        console.log(
          `🚫 Skipping outgoing email record - internal to internal email (no lead context) | sender=${mailboxAddress || 'unknown'} | recipients=${recipients.join(', ') || 'none'}`
        );
        return;
      }

      const LEADS_EMAIL = 'leads@lawoffice.org.il';
      if (!hasLeadContext && recipientListStr.toLowerCase().includes(LEADS_EMAIL)) {
        console.log(
          `🚫 Skipping outgoing email record - recipient is leads@lawoffice.org.il (no client match) | sender=${mailboxAddress || 'unknown'} | recipients=${recipients.join(', ') || 'none'}`
        );
        return;
      }

      const attachmentsMeta = Array.isArray(payload.attachments)
        ? payload.attachments.map((attachment) => ({
            name: attachment?.name || 'attachment',
            contentType: attachment?.contentType || 'application/octet-stream',
          }))
        : null;

      const htmlBody = payload.bodyHtml || '';
      const bodyPreview = stripHtml(htmlBody) || payload.bodyText || '';
      const resolvedUserId =
        asUuidOrNull(context.userInternalId) ||
        asUuidOrNull(userInternalId) ||
        asUuidOrNull(userId);

      const normalizedRecipients = recipients.map((addr) => normalise(addr)).filter(Boolean);
      const recipientMappings = await fetchLeadMappingsForAddresses(normalizedRecipients);
      const collected = [];
      if (clientId || legacyId || contextContactId) {
        collected.push({
          clientId: clientId || null,
          legacyId: legacyId || null,
          contactId: contextContactId || null,
        });
      }
      normalizedRecipients.forEach((addr) => {
        (recipientMappings[addr] || []).forEach((match) => collected.push(match));
      });
      const matches = preferContactMatches(uniqueMatches(collected));
      const primary = primaryMatchFrom(matches) || {
        clientId: clientId || null,
        legacyId: legacyId || null,
        contactId: contextContactId || null,
      };
      const contactIds = contactIdsFromMatches(matches);
      if (contextContactId) contactIds.push(Number(contextContactId));

      const record = {
        message_id: context.crmMessageId || result.id,
        user_id: resolvedUserId,
        client_id: primary.clientId ?? null,
        legacy_id: primary.legacyId ?? null,
        contact_id: primary.contactId ?? null,
        thread_id: result.conversationId,
        sender_name: context.senderName || null,
        sender_email: mailboxAddress,
        recipient_list: recipients.join(', '),
        subject: payload.subject || '(no subject)',
        body_html: htmlBody || payload.bodyText || '',
        body_preview: bodyPreview,
        sent_at: result.sentAt || new Date().toISOString(),
        direction: 'outgoing',
        attachments: attachmentsMeta,
      };

      const inserted = await insertMailboxEmailRow(record);
      if (inserted.error) {
        console.error(
          '⚠️  Failed to store outgoing email',
          inserted.error.message || inserted.error,
          `| message_id=${record.message_id} | client_id=${record.client_id || 'null'}`
        );
        return;
      }
      if (inserted.id) {
        await linkEmailContacts(inserted.id, contactIds);
      }
      console.log(
        `💾 Saved outgoing email ${result.id?.substring(0, 20) || 'unknown'}... | client_id=${record.client_id || 'null'} | legacy_id=${record.legacy_id || 'null'} | contact_id=${record.contact_id || 'null'} | contacts=${contactIds.length}`
      );
    } catch (error) {
      console.error('⚠️  Unable to record outgoing email:', error.message || error);
    }
  }

  async persistOutgoingEmailRow(record = {}) {
    if (!record.message_id) {
      throw new Error('message_id is required');
    }
    const row = {
      message_id: record.message_id,
      user_id: asUuidOrNull(record.user_id),
      sender_name: record.sender_name ?? null,
      sender_email: record.sender_email ?? null,
      recipient_list: record.recipient_list ?? null,
      subject: record.subject || '(no subject)',
      body_html: record.body_html || '',
      body_preview: record.body_preview ?? null,
      sent_at: record.sent_at || new Date().toISOString(),
      direction: record.direction || 'outgoing',
      attachments: record.attachments ?? null,
      client_id: record.client_id ?? null,
      legacy_id: record.legacy_id ?? null,
      contact_id: record.contact_id ?? null,
      thread_id: record.thread_id ?? null,
      body_cached: record.body_cached !== false,
    };
    const inserted = await insertMailboxEmailRow(row);
    if (inserted.error) {
      const err = new Error(inserted.error.message || 'Failed to store email');
      err.code = inserted.error.code;
      throw err;
    }
    return { id: inserted.id || null };
  }

  async listPriceOfferEmails({ clientId, legacyId } = {}) {
    if (!clientId && (legacyId == null || legacyId === '')) {
      return [];
    }
    let query = supabase
      .from(EMAIL_HEADERS_TABLE)
      .select('id, message_id, sender_name, sender_email, body_html, body_preview, sent_at, subject')
      .gte('message_id', 'offer_')
      .lt('message_id', 'offer`')
      .order('sent_at', { ascending: true })
      .limit(100);
    if (clientId) {
      query = query.eq('client_id', String(clientId).trim());
    } else {
      query = query.eq('legacy_id', Number(legacyId));
    }
    const { data, error } = await query;
    if (error) {
      throw new Error(error.message || 'Failed to list price offer emails');
    }
    const rows = (data || []).filter((row) => String(row?.message_id || '').startsWith('offer_'));
    console.log(
      `📋 listPriceOfferEmails client_id=${clientId || 'null'} legacy_id=${legacyId || 'null'} rows=${rows.length}`
    );
    return rows;
  }
}

module.exports = new GraphMailboxSyncService();


