const mailboxTokenService = require('./mailboxTokenService');
const mailboxStateService = require('./mailboxStateService');
const graphAuthService = require('./graphAuthService');
const supabase = require('../config/supabase');
const pushNotificationService = require('./pushNotificationService');

const EMAIL_HEADERS_TABLE = process.env.EMAIL_HEADERS_TABLE || 'emails';
const EMAIL_BODIES_TABLE = process.env.EMAIL_BODIES_TABLE || 'email_bodies';
const EMAIL_ATTACHMENTS_TABLE = process.env.EMAIL_ATTACHMENTS_TABLE || 'email_attachments';
const ALLOWLIST_TABLE = process.env.CLIENT_ALLOWLIST_TABLE || 'client_email_allowlist';
const TRACKED_THREADS_TABLE = process.env.TRACKED_THREADS_TABLE || 'tracked_threads';
const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';
const DEFAULT_SYNC_BATCH = parseInt(process.env.GRAPH_DELTA_PAGE_SIZE || '50', 10);
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
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
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

/** PostgREST `.or()` filter: case-insensitive exact email match (quoted value so `@` / `.` parse correctly). */
const emailIlikeOrFilter = (column, emails) =>
  emails
    .map((e) => {
      if (!e) return null;
      const esc = e
        .replace(/\\/g, '\\\\')
        .replace(/%/g, '\\%')
        .replace(/_/g, '\\_')
        .replace(/"/g, '\\"');
      return `${column}.ilike."${esc}"`;
    })
    .filter(Boolean)
    .join(',');

/** Smaller chunks keep `.or()` query strings under proxy/PostgREST limits. Override with GRAPH_EMAIL_MAPPING_CHUNK (10–99). */
const _emailChunkEnv = parseInt(process.env.GRAPH_EMAIL_MAPPING_CHUNK || '40', 10);
const EMAIL_MAPPING_CHUNK = Math.min(99, Math.max(10, Number.isFinite(_emailChunkEnv) ? _emailChunkEnv : 40));

/** Try case-insensitive `.or(ilike…)`; on failure fall back to exact `.in()` (still normalized addresses from Graph). */
const selectRowsMatchingEmailChunk = async (table, selectFields, chunk) => {
  if (!chunk.length) {
    return { data: [], error: null };
  }
  const emailOr = emailIlikeOrFilter('email', chunk);
  let res = await supabase.from(table).select(selectFields).or(emailOr);
  if (res.error) {
    console.warn(
      `⚠️ ${table} email lookup .or() failed (${res.error.code || ''} ${res.error.message || res.error}); using .in() fallback`
    );
    res = await supabase.from(table).select(selectFields).in('email', chunk);
  }
  return res;
};

// Fetch ALL leads and contacts that match email addresses
// Returns: { email: [{ clientId, legacyId, contactId, leadId }] }
const fetchLeadMappingsForAddresses = async (addresses) => {
  const unique = Array.from(new Set(addresses.map((addr) => normalise(addr)).filter(Boolean)));
  if (!unique.length) {
    return {};
  }

  const mapping = {};

  // Initialize arrays for each email
  unique.forEach((email) => {
    mapping[email] = [];
  });

  const addMapping = (email, value) => {
    const key = normalise(email);
    if (!key || !mapping[key]) return;
    // Check if this exact mapping already exists (avoid duplicates)
    const exists = mapping[key].some(
      (m) => m.clientId === value.clientId && m.legacyId === value.legacyId && m.contactId === value.contactId
    );
    if (!exists) {
      mapping[key].push(value);
    }
  };

  try {
    for (const chunk of chunkArray(unique, 99)) {
      const emailOr = emailIlikeOrFilter('email', chunk);
      // Fetch new leads that match email addresses (case-insensitive)
      const { data: leadMatches, error: leadError } = await supabase
        .from('leads')
        .select('id,email')
        .or(emailOr);

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

          // Get leads associated with this contact (legacy leads via lead_leadcontact)
          const { data: legacyContactRels, error: legacyRelError } = await supabase
            .from('lead_leadcontact')
            .select('lead_id,newlead_id')
            .eq('contact_id', contact.id);

          if (!legacyRelError && legacyContactRels) {
            legacyContactRels.forEach((rel) => {
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
          }
        }
      }
    }
  } catch (error) {
    console.error('❌ Error while resolving lead mappings for emails:', error.message || error);
  }

  return mapping;
};

const fetchRecentMessagesSnapshot = async ({ accessToken, mailboxAddress, top = 25 }) => {
  try {
    const url = `${GRAPH_BASE_URL}/users/${mailboxAddress}/mailFolders('Inbox')/messages?$orderby=receivedDateTime desc&$select=id,subject,from,toRecipients,ccRecipients,conversationId,bodyPreview,receivedDateTime,sentDateTime,isRead,hasAttachments,internetMessageId,parentFolderId&$top=${top}`;
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

const toGraphRecipients = (list = []) =>
  (Array.isArray(list) ? list : [])
    .map((address) => (typeof address === 'string' ? address.trim() : ''))
    .filter((address) => Boolean(address))
    .map((address) => ({
      emailAddress: {
        address,
      },
    }));

class GraphMailboxSyncService {
  async syncMailboxForUser(userId, options = {}) {
    const { reset = false, trigger = 'manual' } = options;
    const tokenRecord = await mailboxTokenService.getTokenByUserId(userId);
    if (!tokenRecord) {
      throw new Error('Mailbox is not connected for this user');
    }

    const resolvedUserId = tokenRecord.user_id;
    if (!resolvedUserId) {
      throw new Error('Mailbox token is missing CRM user reference');
    }

    const account = {
      homeAccountId: tokenRecord.home_account_id,
      environment: tokenRecord.environment,
      tenantId: tokenRecord.tenant_id,
      username: tokenRecord.mailbox_address,
    };

    let tokenResponse;
    try {
      tokenResponse = await graphAuthService.acquireTokenByRefreshToken(tokenRecord.refresh_token, account);
    } catch (error) {
      if (error?.code === 'EXPIRED_REFRESH_TOKEN') {
        // Clear the expired token so user can reconnect
        await mailboxTokenService.removeToken(userId);
        throw new Error('Your mailbox connection has expired. Please reconnect your mailbox to continue syncing emails.');
      }
      throw error;
    }
    
    if (!tokenResponse?.accessToken) {
      throw new Error('Unable to acquire Microsoft Graph access token');
    }

    if (tokenResponse.refreshToken && tokenResponse.refreshToken !== tokenRecord.refresh_token) {
      await mailboxTokenService.upsertToken({
        userId,
        mailboxAddress: tokenRecord.mailbox_address,
        msUserId: tokenRecord.ms_user_id,
        tenantId: tokenRecord.tenant_id,
        homeAccountId: tokenResponse.account?.homeAccountId || tokenRecord.home_account_id,
        environment: tokenResponse.account?.environment || tokenRecord.environment,
        refreshToken: tokenResponse.refreshToken,
        expiresOn: tokenResponse.expiresOn?.toISOString?.() || null,
      });
    }

    const state = await mailboxStateService.getState(resolvedUserId);
    const deltaLink = reset ? null : state?.delta_link || null;
    const mailboxAddress = tokenRecord.mailbox_address;

    console.log(
      `📥 Initiating Graph sync for user=${resolvedUserId} mailbox=${mailboxAddress} trigger=${trigger}${
        reset ? ' (full resync)' : ''
      }`
    );

    let { messages, nextDeltaLink } = await this.fetchDeltaMessages({
      accessToken: tokenResponse.accessToken,
      mailboxAddress,
      deltaLink,
    });

    const isInitialSync = !deltaLink;
    if (!messages.length) {
      // If delta returned no messages (either on first sync or later),
      // take a fresh snapshot of the most recent Inbox messages.
      // Upsert on message_id keeps this idempotent and also recovers from
      // any missed delta pages or invalid delta links.
      const snapshotMessages = await fetchRecentMessagesSnapshot({
        accessToken: tokenResponse.accessToken,
        mailboxAddress,
        top: DEFAULT_SYNC_BATCH,
      });
      if (snapshotMessages.length) {
        console.log(
          `📸 Snapshot fallback fetched ${snapshotMessages.length} Inbox messages` +
            (isInitialSync ? ' (initial sync)' : ' (delta empty, using snapshot)')
        );
        messages = snapshotMessages;
      }
    }

    console.log(`📬 Graph sync: fetched ${messages.length} messages for ${mailboxAddress}${deltaLink ? ' (delta)' : ''}`);

    const stored = await this.persistMessages(resolvedUserId, mailboxAddress, messages, tokenResponse.accessToken);

    await mailboxStateService.upsertState(resolvedUserId, {
      delta_link: nextDeltaLink || deltaLink || null,
      last_synced_at: new Date().toISOString(),
    });

    try {
      await this.ensureInboxMailSubscription(resolvedUserId, tokenResponse.accessToken, mailboxAddress);
    } catch (subErr) {
      console.warn(`⚠️ Graph mail subscription ensure failed (sync still succeeded):`, subErr.message || subErr);
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
      deltaLink: nextDeltaLink || deltaLink || null,
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
    const account = {
      homeAccountId: tokenRecord.home_account_id,
      environment: tokenRecord.environment,
      tenantId: tokenRecord.tenant_id,
      username: tokenRecord.mailbox_address,
    };
    const tokenResponse = await graphAuthService.acquireTokenByRefreshToken(
      tokenRecord.refresh_token,
      account
    );
    if (!tokenResponse?.accessToken) {
      throw new Error('Unable to acquire Microsoft Graph access token');
    }
    return this.ensureInboxMailSubscription(
      resolvedUserId,
      tokenResponse.accessToken,
      tokenRecord.mailbox_address
    );
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

        const account = {
          homeAccountId: tokenRecord.home_account_id,
          environment: tokenRecord.environment,
          tenantId: tokenRecord.tenant_id,
          username: tokenRecord.mailbox_address,
        };
        const tokenResponse = await graphAuthService.acquireTokenByRefreshToken(
          tokenRecord.refresh_token,
          account
        );
        if (!tokenResponse?.accessToken) {
          throw new Error('No access token');
        }

        const result = await this.ensureInboxMailSubscription(
          token.user_id,
          tokenResponse.accessToken,
          tokenRecord.mailbox_address
        );
        acc.successful += 1;
        acc.details.push({
          userId: token.user_id,
          mailbox: token.mailbox_address,
          ...result,
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

  async fetchDeltaMessages({ accessToken, mailboxAddress, deltaLink }) {
    const initialUrl = `${GRAPH_BASE_URL}/users/${mailboxAddress}/mailFolders('MsgFolderRoot')/messages/delta?$select=id,subject,from,toRecipients,ccRecipients,conversationId,bodyPreview,receivedDateTime,sentDateTime,isRead,hasAttachments,internetMessageId,parentFolderId&$top=${DEFAULT_SYNC_BATCH}`;
    let url = deltaLink || initialUrl;
    const messages = [];
    let nextLink = null;
    let retried410 = false;

    while (url) {
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
            `⚠️ Graph delta returned 410 (expired or invalid delta); restarting from full delta once. ${errorText.slice(0, 240)}`
          );
          retried410 = true;
          messages.length = 0;
          nextLink = null;
          url = initialUrl;
          continue;
        }
        throw new Error(`Graph delta request failed (${response.status}): ${errorText}`);
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Graph delta request failed (${response.status}): ${errorText}`);
      }

      const json = await response.json();
      if (Array.isArray(json.value)) {
        messages.push(...json.value);
      }

      if (json['@odata.nextLink']) {
        url = json['@odata.nextLink'];
      } else {
        url = null;
        // After a 410 retry the previous delta token is invalid — do not fall back to it if Graph omits a new link.
        nextLink = json['@odata.deltaLink'] || (retried410 ? null : deltaLink);
      }
    }

    return { messages, nextDeltaLink: nextLink };
  }

  async persistMessages(userId, mailboxAddress, messages = [], accessToken = null) {
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
        // Filled after insert by fetchFullBodiesForMessages (Graph list attachments); avoid storing [] forever
        attachments: null,
        client_id: null,
        legacy_id: null,
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

    // Process rows and create multiple email records - one for each matching lead/contact
    // This ensures emails appear in all leads where the email address matches
    const expandedRows = [];
    
    for (const row of rows) {
      const recipientAddresses = row.recipient_list
        ? row.recipient_list
            .split(',')
            .map((addr) => normalise(addr))
            .filter(Boolean)
        : [];

      const senderEmail = row.sender_email ? normalise(row.sender_email) : null;
      // Outgoing = synced mailbox is the sender — match To/Cc to leads/contacts (not blocked-sender list).
      const isOutgoing = row.direction === 'outgoing';

      // Collect matches based on sender vs recipient logic
      const allMatches = new Set();
      const matchKeys = new Set(); // Track unique match keys to avoid duplicates

      if (isOutgoing) {
        // Outgoing: match leads/contacts by recipient addresses
        recipientAddresses.forEach((addr) => {
          const recipientMatches = leadMappings[addr] || [];
          recipientMatches.forEach((match) => {
            const key = `${match.clientId || 'null'}_${match.legacyId || 'null'}_${match.contactId || 'null'}`;
            if (!matchKeys.has(key)) {
              matchKeys.add(key);
              allMatches.add(match);
            }
          });
        });
      } else {
        // Incoming: match by sender only (avoid attaching to wrong lead via other recipients)
        if (senderEmail) {
          const senderMatches = leadMappings[senderEmail] || [];
          senderMatches.forEach((match) => {
            // Only include matches where the sender email matches a contact in the lead
            // This means we only keep matches that have a contactId (sender matched a contact)
            // OR matches where the sender email matches the lead's main email directly
            const key = `${match.clientId || 'null'}_${match.legacyId || 'null'}_${match.contactId || 'null'}`;
            if (!matchKeys.has(key)) {
              matchKeys.add(key);
              allMatches.add(match);
            }
          });
        }
        // Do NOT match based on recipients when sender is a client email
        // This prevents incorrect matching when recipient list contains emails from other leads
      }

      if (allMatches.size > 0) {
        // Filter out matches where lead/contact email is from @lawoffice.org.il domain
        // Fetch lead/contact emails to verify they're not internal office emails
        const leadIdsToCheck = new Set();
        const contactIdsToCheck = new Set();
        allMatches.forEach((match) => {
          if (match.clientId) {
            leadIdsToCheck.add({ type: 'new', id: match.clientId });
          }
          if (match.legacyId) {
            leadIdsToCheck.add({ type: 'legacy', id: match.legacyId });
          }
          if (match.contactId) {
            contactIdsToCheck.add(match.contactId);
          }
        });

        // Fetch lead emails to check for @lawoffice.org.il domain
        const leadEmailsMap = new Map();
        if (leadIdsToCheck.size > 0) {
          const newLeadIds = Array.from(leadIdsToCheck).filter(l => l.type === 'new').map(l => l.id);
          const legacyLeadIds = Array.from(leadIdsToCheck).filter(l => l.type === 'legacy').map(l => l.id);

          if (newLeadIds.length > 0) {
            const { data: newLeads } = await supabase
              .from('leads')
              .select('id,email')
              .in('id', newLeadIds);
            (newLeads || []).forEach((lead) => {
              leadEmailsMap.set(`new_${lead.id}`, lead.email);
            });
          }

          if (legacyLeadIds.length > 0) {
            const { data: legacyLeads } = await supabase
              .from('leads_lead')
              .select('id,email')
              .in('id', legacyLeadIds);
            (legacyLeads || []).forEach((lead) => {
              leadEmailsMap.set(`legacy_${lead.id}`, lead.email);
            });
          }
        }

        // Fetch contact emails to check for @lawoffice.org.il domain
        const contactEmailsMap = new Map();
        if (contactIdsToCheck.size > 0) {
          const { data: contacts } = await supabase
            .from('leads_contact')
            .select('id,email')
            .in('id', Array.from(contactIdsToCheck));
          (contacts || []).forEach((contact) => {
            contactEmailsMap.set(contact.id, contact.email);
          });
        }

        // Filter out matches where lead or contact email should be filtered
        // Outgoing: do not drop matches based on lead/contact stored email domain (handled elsewhere on sender).
        const filteredMatches = Array.from(allMatches).filter((match) => {
          if (isOutgoing) {
            return true;
          }
          
          // For incoming emails, we should NOT filter based on lead/contact email domain
          // A client might send from their personal email (e.g., client@gmail.com) even if
          // the lead/contact record has an office email. We should save the email because
          // the sender is a legitimate client (not from @lawoffice.org.il).
          // The sender email domain filtering is handled elsewhere (in the main filter at line ~947).
          // 
          // REMOVED: Filtering based on lead/contact email domain for incoming emails
          // This was too aggressive and was blocking legitimate client emails
          
          return true;
        });

        if (filteredMatches.length === 0) {
          console.log(
            `🚫 Skipping email ${row.message_id.substring(0, 20)}... - all matched leads/contacts have filtered emails | sender=${row.sender_email || 'unknown'} | recipients=${row.recipient_list || 'none'}`
          );
        } else {
          // Deduplicate: Ensure each message_id is saved only once per unique client_id, legacy_id, or contact_id
          // Priority: If we have both a match with contact_id and without contact_id for the same lead, prefer the one with contact_id
          const deduplicatedMatches = new Map();
          const leadsWithContacts = new Set(); // Track leads that already have a match with contact_id
          
          // First pass: Add all matches with contact_id
          filteredMatches.forEach((match) => {
            if (match.contactId) {
              const contactKey = `contact_${match.contactId}`;
              if (!deduplicatedMatches.has(contactKey)) {
                deduplicatedMatches.set(contactKey, match);
                // Mark this lead as having a contact match
                if (match.clientId) {
                  leadsWithContacts.add(`client_${match.clientId}`);
                }
                if (match.legacyId) {
                  leadsWithContacts.add(`legacy_${match.legacyId}`);
                }
              }
            }
          });
          
          // Second pass: Add matches without contact_id, but only if the lead doesn't already have a contact match
          filteredMatches.forEach((match) => {
            if (!match.contactId) {
              const leadKey = match.clientId ? `client_${match.clientId}` : (match.legacyId ? `legacy_${match.legacyId}` : null);
              if (leadKey && !leadsWithContacts.has(leadKey) && !deduplicatedMatches.has(leadKey)) {
                deduplicatedMatches.set(leadKey, match);
              }
            }
          });
          
          // Create one row for each deduplicated match
          deduplicatedMatches.forEach((match) => {
            const emailRow = {
              ...row,
              client_id: match.clientId || null,
              legacy_id: match.legacyId || null,
              contact_id: match.contactId || null,
            };
            expandedRows.push(emailRow);
          });
          console.log(
            `✅ Created ${deduplicatedMatches.size} email record(s) for message ${row.message_id.substring(0, 20)}... (deduplicated from ${filteredMatches.length} filtered matches, ${allMatches.size} total matches) | sender=${row.sender_email || 'unknown'} | recipients=${row.recipient_list || 'none'}`
          );
        }
      } else {
        // No matches found - check if it's an office email
        const OFFICE_EMAIL = 'office@lawoffice.org.il';
        const recipientList = (row.recipient_list || '').toLowerCase();
        const hasOfficeRecipient = recipientList.includes(OFFICE_EMAIL.toLowerCase());
        
        if (hasOfficeRecipient) {
          // Save office emails even without lead/contact match
          expandedRows.push({
            ...row,
            client_id: null,
            legacy_id: null,
            contact_id: null,
          });
          console.log(
            `✅ Created email record for office email ${row.message_id.substring(0, 20)}... (office@lawoffice.org.il recipient)`
          );
        } else {
          console.log(
            `📭 No lead/contact match for message ${row.message_id.substring(0, 20)}... | sender=${row.sender_email || 'unknown'} | recipients=${row.recipient_list || 'none'}`
          );
        }
      }
    }
    
    // Use expanded rows (all rows already have matches or are office emails)
    // Filter rows: only save emails that match client_id, contact_id, or office@lawoffice.org.il recipient
    const OFFICE_EMAIL = 'office@lawoffice.org.il';
    const LEADS_EMAIL = 'leads@lawoffice.org.il'; // Ignore emails sent to this address
    const filteredRows = expandedRows.filter((row) => {
      const senderEmail = row.sender_email ? normalise(row.sender_email) : null;
      const recipientList = row.recipient_list || '';
      
      // Skip emails from blocked senders (specific addresses in BLOCKED_SENDER_EMAILS)
      if (senderEmail && shouldFilterEmail(senderEmail)) {
        console.log(
          `🚫 Skipping email ${row.message_id?.substring(0, 20) || 'unknown'}... - sender is blocked | sender=${row.sender_email || 'unknown'} | recipients=${row.recipient_list || 'none'}`
        );
        return false;
      }
      
      // Skip internal-to-internal emails (@lawoffice.org.il to @lawoffice.org.il)
      if (shouldFilterInternalEmail(senderEmail, recipientList)) {
        console.log(
          `🚫 Skipping email ${row.message_id?.substring(0, 20) || 'unknown'}... - internal to internal email | sender=${row.sender_email || 'unknown'} | recipients=${row.recipient_list || 'none'}`
        );
        return false;
      }
      
      // Skip emails sent to leads@lawoffice.org.il
      const recipientListLower = recipientList.toLowerCase();
      if (recipientListLower.includes(LEADS_EMAIL.toLowerCase())) {
        console.log(
          `🚫 Skipping email ${row.message_id?.substring(0, 20) || 'unknown'}... - recipient is leads@lawoffice.org.il (filtered) | sender=${row.sender_email || 'unknown'} | recipients=${row.recipient_list || 'none'}`
        );
        return false;
      }
      
      // Check if recipient email is office@lawoffice.org.il
      const hasOfficeRecipient = recipientList.includes(OFFICE_EMAIL.toLowerCase());
      
      // Check if email has client_id or legacy_id (matched to a lead)
      const hasLeadMatch = !!(row.client_id || row.legacy_id);
      
      // Check if email has contact_id (matched to a contact)
      const hasContactMatch = !!row.contact_id;
      
      // Save email if ANY of these conditions are met:
      const shouldSave = hasOfficeRecipient || hasLeadMatch || hasContactMatch;
      
      if (shouldSave) {
        const reasons = [];
        if (hasOfficeRecipient) reasons.push('office@lawoffice.org.il recipient');
        if (hasLeadMatch) reasons.push(`lead match (client_id=${row.client_id || 'null'}, legacy_id=${row.legacy_id || 'null'})`);
        if (hasContactMatch) reasons.push(`contact match (contact_id=${row.contact_id})`);
        console.log(
          `✅ Saving email ${row.message_id.substring(0, 20)}... - reason: ${reasons.join(', ')} | sender=${row.sender_email || 'unknown'} | recipients=${row.recipient_list || 'none'}`
        );
      } else {
        console.log(
          `📭 Skipping email ${row.message_id.substring(0, 20)}... - no match: sender=${row.sender_email || 'unknown'} | recipients=${row.recipient_list || 'none'} | client_id=${row.client_id || 'null'} | legacy_id=${row.legacy_id || 'null'} | contact_id=${row.contact_id || 'null'}`
        );
      }
      
      return shouldSave;
    });

    if (!filteredRows.length) {
      console.log(`📭 No emails to save after filtering (${rows.length} processed, 0 matched criteria)`);
      return { processed: messages.length, inserted: 0, skipped: rows.length, trackedCount: 0 };
    }

    // Check for duplicates before upserting
    // Since we now allow multiple rows with same message_id (different client_id/legacy_id/contact_id),
    // we need to check for exact duplicates: same message_id + same client_id + same legacy_id + same contact_id
    const messageIds = [...new Set(filteredRows.map(row => row.message_id).filter(Boolean))];
    let existingEmailKeys = new Set();
    /** message_ids that already had at least one row before this sync (used for lead push dedupe) */
    const existingMessageIds = new Set();

    if (messageIds.length > 0) {
      const { data: existingEmails, error: checkError } = await supabase
        .from(EMAIL_HEADERS_TABLE)
        .select('message_id, client_id, legacy_id, contact_id')
        .in('message_id', messageIds);

      if (!checkError && existingEmails) {
        existingEmails.forEach((e) => {
          const key = `${e.message_id}_${e.client_id || 'null'}_${e.legacy_id || 'null'}_${e.contact_id || 'null'}`;
          existingEmailKeys.add(key);
          if (e.message_id) {
            existingMessageIds.add(e.message_id);
          }
        });
      }
    }

    // Secondary dedupe: same Graph message_id + same preview + same lead/contact (must include message_id).
    // Without message_id, identical truncated previews across *different* messages blocked inserts for valid new mail.
    const bodyPreviewKeys = new Set();
    const rowsWithBodyPreview = filteredRows.filter(
      (row) => row.message_id && row.body_preview && (row.legacy_id || row.contact_id)
    );

    if (rowsWithBodyPreview.length > 0) {
      const legacyIds = [...new Set(rowsWithBodyPreview.map((row) => row.legacy_id).filter(Boolean))];
      const contactIds = [...new Set(rowsWithBodyPreview.map((row) => row.contact_id).filter(Boolean))];

      if (legacyIds.length > 0) {
        const bodyPreviews = [
          ...new Set(
            rowsWithBodyPreview.filter((row) => row.legacy_id && row.body_preview).map((row) => row.body_preview)
          ),
        ];
        if (bodyPreviews.length > 0) {
          for (const bodyPreview of bodyPreviews) {
            const { data: existingByBodyPreview, error: bodyPreviewError } = await supabase
              .from(EMAIL_HEADERS_TABLE)
              .select('message_id, body_preview, legacy_id, contact_id')
              .eq('body_preview', bodyPreview)
              .in('legacy_id', legacyIds)
              .not('body_preview', 'is', null);

            if (!bodyPreviewError && existingByBodyPreview) {
              existingByBodyPreview.forEach((e) => {
                if (e.message_id && e.legacy_id && e.body_preview) {
                  bodyPreviewKeys.add(`${e.message_id}_${e.body_preview}_legacy_${e.legacy_id}`);
                }
              });
            }
          }
        }
      }

      if (contactIds.length > 0) {
        const bodyPreviews = [
          ...new Set(
            rowsWithBodyPreview.filter((row) => row.contact_id && row.body_preview).map((row) => row.body_preview)
          ),
        ];
        if (bodyPreviews.length > 0) {
          for (const bodyPreview of bodyPreviews) {
            const { data: existingByBodyPreview, error: bodyPreviewError } = await supabase
              .from(EMAIL_HEADERS_TABLE)
              .select('message_id, body_preview, legacy_id, contact_id')
              .eq('body_preview', bodyPreview)
              .in('contact_id', contactIds)
              .not('body_preview', 'is', null);

            if (!bodyPreviewError && existingByBodyPreview) {
              existingByBodyPreview.forEach((e) => {
                if (e.message_id && e.contact_id && e.body_preview) {
                  bodyPreviewKeys.add(`${e.message_id}_${e.body_preview}_contact_${e.contact_id}`);
                }
              });
            }
          }
        }
      }
    }

    // Filter out emails that already exist (exact duplicates: same message_id + client_id + legacy_id + contact_id)
    // Also filter out duplicates based on body_preview + legacy_id or body_preview + contact_id
    const newEmailsToSave = filteredRows.filter((row) => {
      if (!row.message_id) {
        console.warn(`⚠️  Skipping email without message_id: ${JSON.stringify(row).substring(0, 100)}`);
        return false;
      }
      
      // Check for message_id duplicates
      const key = `${row.message_id}_${row.client_id || 'null'}_${row.legacy_id || 'null'}_${row.contact_id || 'null'}`;
      const isMessageIdDuplicate = existingEmailKeys.has(key);
      if (isMessageIdDuplicate) {
        console.log(`🔄 Skipping duplicate email record ${row.message_id.substring(0, 20)}... (client_id=${row.client_id || 'null'}, legacy_id=${row.legacy_id || 'null'}, contact_id=${row.contact_id || 'null'}) already exists`);
        return false;
      }
      
      if (row.message_id && row.body_preview && row.legacy_id) {
        const bodyPreviewKey = `${row.message_id}_${row.body_preview}_legacy_${row.legacy_id}`;
        if (bodyPreviewKeys.has(bodyPreviewKey)) {
          console.log(
            `🔄 Skipping duplicate email record ${row.message_id.substring(0, 20)}... (same message_id + body_preview + legacy_id=${row.legacy_id})`
          );
          return false;
        }
      }

      if (row.message_id && row.body_preview && row.contact_id) {
        const bodyPreviewKey = `${row.message_id}_${row.body_preview}_contact_${row.contact_id}`;
        if (bodyPreviewKeys.has(bodyPreviewKey)) {
          console.log(
            `🔄 Skipping duplicate email record ${row.message_id.substring(0, 20)}... (same message_id + body_preview + contact_id=${row.contact_id})`
          );
          return false;
        }
      }
      
      return true;
    });

    if (!newEmailsToSave.length) {
      console.log(`📭 No new email records to save (all ${filteredRows.length} matched email records already exist in database)`);
      return { processed: messages.length, inserted: 0, skipped: filteredRows.length, trackedCount: 0 };
    }

    console.log(`💾 Saving ${newEmailsToSave.length} new email record(s) out of ${filteredRows.length} matched (${filteredRows.length - newEmailsToSave.length} duplicates skipped, ${messages.length - filteredRows.length} filtered out)`);

    // Use insert (not upsert) since we allow multiple rows with same message_id
    // (different client_id/legacy_id/contact_id combinations)
    // We've already checked for duplicates above
    // Insert in batches to avoid timeout issues
    const BATCH_SIZE = 50; // Insert 50 records at a time
    let insertedCount = 0;
    let errorCount = 0;
    
    for (let i = 0; i < newEmailsToSave.length; i += BATCH_SIZE) {
      const batch = newEmailsToSave.slice(i, i + BATCH_SIZE);
      try {
        const { error } = await supabase
          .from(EMAIL_HEADERS_TABLE)
          .insert(batch);
        
        if (error) {
          // If error is due to unique constraint violation, log but continue
          if (error.code === '23505') {
            console.warn(`⚠️ Batch ${Math.floor(i / BATCH_SIZE) + 1}: Some email records may have duplicate key violations (race condition), continuing...`);
            errorCount += batch.length;
          } else if (error.message && error.message.includes('timeout')) {
            console.warn(`⚠️ Batch ${Math.floor(i / BATCH_SIZE) + 1}: Timeout error, retrying with smaller batch...`);
            // Retry with smaller batches (10 at a time)
            for (let j = 0; j < batch.length; j += 10) {
              const smallBatch = batch.slice(j, j + 10);
              const { error: retryError } = await supabase
                .from(EMAIL_HEADERS_TABLE)
                .insert(smallBatch);
              if (retryError) {
                console.error(`❌ Failed to store small batch ${Math.floor(j / 10) + 1}:`, retryError.message || retryError);
                errorCount += smallBatch.length;
              } else {
                insertedCount += smallBatch.length;
              }
            }
          } else {
            console.error(`❌ Batch ${Math.floor(i / BATCH_SIZE) + 1}: Failed to store email headers:`, error.message || error);
            errorCount += batch.length;
          }
        } else {
          insertedCount += batch.length;
        }
      } catch (err) {
        console.error(`❌ Batch ${Math.floor(i / BATCH_SIZE) + 1}: Exception while inserting emails:`, err.message || err);
        errorCount += batch.length;
      }
    }
    
    if (errorCount > 0) {
      console.warn(`⚠️ Completed with ${insertedCount} inserted, ${errorCount} failed out of ${newEmailsToSave.length} total`);
    } else {
      console.log(`✅ Successfully inserted ${insertedCount} email record(s)`);
    }

    // Check which emails are actually new (not already in database)
    // This prevents sending duplicate notifications for emails that were already synced
    // Note: existingMessageIds was already populated above, so we can reuse it
    const newLeadEmails = newEmailsToSave.filter((row) => {
      // Only include emails that are NEW (not already in database)
      if (existingMessageIds.has(row.message_id)) {
        return false; // Skip emails that already exist
      }
      
      // Only include emails that are new leads (no client_id or legacy_id)
      if (row.client_id || row.legacy_id) return false;
      
      // Only send push notification if recipient email is office@lawoffice.org.il
      const recipientList = (row.recipient_list || '').toLowerCase();
      const targetEmail = 'office@lawoffice.org.il';
      return recipientList.includes(targetEmail.toLowerCase());
    });
    
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
              tag: `email-lead-${emailRow.message_id}`, // Browser will deduplicate by tag
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
      console.log(`ℹ️  No new email leads to notify (${newEmailsToSave.length} new emails processed)`);
    }

    // After storing headers, fetch full bodies for messages that need them
    // This runs asynchronously so it doesn't block the sync
    if (accessToken) {
      this.fetchFullBodiesForMessages(userId, mailboxAddress, newEmailsToSave, accessToken).catch(err => {
        console.error('⚠️  Error fetching full email bodies:', err.message || err);
        // Don't throw - this is a background operation
      });
      this.backfillAttachmentMetadata(userId, mailboxAddress, accessToken, { limit: 40 }).catch((err) => {
        console.error('⚠️  Error backfilling attachment metadata:', err.message || err);
      });
    }

    const duplicatesSkipped = filteredRows.length - newEmailsToSave.length;
    const filteredOut = rows.length - filteredRows.length;
    console.log(`📥 Stored ${newEmailsToSave.length} new emails (processed ${messages.length}, ${duplicatesSkipped} duplicates skipped, ${filteredOut} filtered out)`);

    return {
      processed: messages.length,
      inserted: insertedCount,
      skipped: filteredOut + duplicatesSkipped + (newEmailsToSave.length - insertedCount),
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
    console.log(
      `📧 Fetching full bodies + attachment metadata: ${uniqueMessageIds.length} unique Graph message(s) for ${emailRows.length} DB row(s) (serial + 429 backoff; avoids MailboxConcurrency)`
    );

    const applyLeadKeysToEmailUpdate = (query, row) => {
      if (row.client_id == null) query = query.is('client_id', null);
      else query = query.eq('client_id', row.client_id);
      if (row.legacy_id == null) query = query.is('legacy_id', null);
      else query = query.eq('legacy_id', row.legacy_id);
      if (row.contact_id == null) query = query.is('contact_id', null);
      else query = query.eq('contact_id', row.contact_id);
      return query;
    };

    const graphHeaders = {
      Authorization: `Bearer ${accessToken}`,
      Prefer: `outlook.body-preview="text"`,
    };

    for (let u = 0; u < uniqueMessageIds.length; u++) {
      const messageId = uniqueMessageIds[u];
      const rowsForMessage = emailRows.filter((r) => r.message_id === messageId);
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
      if (hasBody) {
        patch.body_html = fullBody;
        patch.body_preview = fullBody;
        patch.body_cached = true;
      }
      if (attachmentsFetched) {
        patch.attachments = attachmentsMeta.length ? attachmentsMeta : null;
      }

      if (Object.keys(patch).length > 0) {
        for (const row of rowsForMessage) {
          let q = supabase.from(EMAIL_HEADERS_TABLE).update(patch).eq('message_id', messageId);
          q = applyLeadKeysToEmailUpdate(q, row);
          const { error: updateError } = await q;
          if (updateError) {
            console.error(`⚠️  Failed to update email row for ${messageId.substring(0, 24)}...:`, updateError.message);
          }
        }
      }

      if (hasBody) {
        const { data: headerRow } = await supabase
          .from(EMAIL_HEADERS_TABLE)
          .select('id')
          .eq('message_id', messageId)
          .order('id', { ascending: true })
          .limit(1)
          .maybeSingle();

        if (headerRow?.id) {
          const { error: bodyUpsertError } = await supabase.from(EMAIL_BODIES_TABLE).upsert({
            email_id: headerRow.id,
            body_html: fullBody,
            updated_at: new Date().toISOString(),
          });
          if (bodyUpsertError) {
            console.warn(`⚠️  email_bodies upsert skipped for message ${messageId.substring(0, 20)}...:`, bodyUpsertError.message);
          }
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

    const take = Math.min(200, Math.max(5, limit * 5));
    const { data: rows, error } = await supabase
      .from(EMAIL_HEADERS_TABLE)
      .select('message_id, attachments')
      .eq('user_id', userId)
      .eq('body_cached', true)
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

    for (let i = 0; i < uniqueIds.length; i++) {
      const messageId = uniqueIds[i];
      try {
        const attachmentsMeta = await fetchMessageAttachmentsMetadata(accessToken, mailboxAddress, messageId);
        const payload = attachmentsMeta.length ? attachmentsMeta : null;
        const { error: upErr } = await supabase
          .from(EMAIL_HEADERS_TABLE)
          .update({ attachments: payload })
          .eq('user_id', userId)
          .eq('message_id', messageId);
        if (upErr) {
          console.warn(`⚠️  Failed to backfill attachments for ${messageId?.substring(0, 24)}...:`, upErr.message);
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

    let tokenResponse;
    try {
      tokenResponse = await graphAuthService.acquireTokenByRefreshToken(tokenRecord.refresh_token, {
        homeAccountId: tokenRecord.home_account_id,
        environment: tokenRecord.environment,
        tenantId: tokenRecord.tenant_id,
        username: tokenRecord.mailbox_address,
      });
    } catch {
      return [];
    }
    if (!tokenResponse?.accessToken) return [];

    try {
      const list = await fetchMessageAttachmentsMetadata(
        tokenResponse.accessToken,
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

    let tokenResponse;
    try {
      tokenResponse = await graphAuthService.acquireTokenByRefreshToken(tokenRecord.refresh_token, {
        homeAccountId: tokenRecord.home_account_id,
        environment: tokenRecord.environment,
        tenantId: tokenRecord.tenant_id,
        username: tokenRecord.mailbox_address,
      });
    } catch (error) {
      if (error?.code === 'EXPIRED_REFRESH_TOKEN') {
        // Clear the expired token so user can reconnect
        await mailboxTokenService.removeToken(emailOwnerId);
        throw new Error('Your mailbox connection has expired. Please reconnect your mailbox to view email content.');
      }
      throw error;
    }
    if (!tokenResponse?.accessToken) throw new Error('Unable to acquire Microsoft Graph access token');

    const message = await fetchJson(
      `${GRAPH_BASE_URL}/users/${tokenRecord.mailbox_address}/messages/${header.message_id}?$select=body`,
      {
        headers: {
          Authorization: `Bearer ${tokenResponse.accessToken}`,
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
        tokenResponse.accessToken,
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

    let tokenResponse;
    try {
      tokenResponse = await graphAuthService.acquireTokenByRefreshToken(tokenRecord.refresh_token, {
        homeAccountId: tokenRecord.home_account_id,
        environment: tokenRecord.environment,
        tenantId: tokenRecord.tenant_id,
        username: tokenRecord.mailbox_address,
      });
    } catch (error) {
      if (error?.code === 'EXPIRED_REFRESH_TOKEN') {
        // Clear the expired token so user can reconnect
        await mailboxTokenService.removeToken(emailOwnerId);
        throw new Error('Your mailbox connection has expired. Please reconnect your mailbox to view email content.');
      }
      throw error;
    }
    if (!tokenResponse?.accessToken) throw new Error('Unable to acquire Microsoft Graph access token');

    const attachment = await fetchJson(
      `${GRAPH_BASE_URL}/users/${tokenRecord.mailbox_address}/messages/${header.message_id}/attachments/${attachmentId}`,
      {
        headers: {
          Authorization: `Bearer ${tokenResponse.accessToken}`,
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

    let tokenResponse;
    try {
      tokenResponse = await graphAuthService.acquireTokenByRefreshToken(tokenRecord.refresh_token, {
        homeAccountId: tokenRecord.home_account_id,
        environment: tokenRecord.environment,
        tenantId: tokenRecord.tenant_id,
        username: tokenRecord.mailbox_address,
      });
    } catch (error) {
      if (error?.code === 'EXPIRED_REFRESH_TOKEN') {
        // Clear the expired token so user can reconnect
        await mailboxTokenService.removeToken(userId);
        throw new Error('Your mailbox connection has expired. Please reconnect your mailbox to send emails.');
      }
      throw error;
    }

    if (!tokenResponse?.accessToken) {
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
        Authorization: `Bearer ${tokenResponse.accessToken}`,
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
          Authorization: `Bearer ${tokenResponse.accessToken}`,
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

    await this.recordOutgoingEmail({
      userId: tokenRecord.user_id,
      userInternalId: tokenRecord.user_id,
      mailboxAddress,
      payload,
      result: sendResult,
    });

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
      
      // Check if we have a lead context (client_id or legacy_id) - if so, always save the email
      // even if it's internal-to-internal, because it's relevant to that lead
      const hasLeadContext = !!(clientId || legacyId || context.contactId);
      
      // Skip internal-to-internal emails (@lawoffice.org.il to @lawoffice.org.il)
      // BUT only if we don't have a lead context (emails sent from a lead's context should be saved)
      if (!hasLeadContext && shouldFilterInternalEmail(senderEmail, recipientListStr)) {
        console.log(
          `🚫 Skipping outgoing email record - internal to internal email (no lead context) | sender=${mailboxAddress || 'unknown'} | recipients=${recipients.join(', ') || 'none'}`
        );
        return; // Don't save this email
      }
      
      // Skip emails sent to leads@lawoffice.org.il (unless we have lead context)
      const LEADS_EMAIL = 'leads@lawoffice.org.il';
      const recipientListStrLower = recipientListStr.toLowerCase();
      if (!hasLeadContext && recipientListStrLower.includes(LEADS_EMAIL.toLowerCase())) {
        console.log(
          `🚫 Skipping outgoing email record - recipient is leads@lawoffice.org.il (filtered, no lead context) | sender=${mailboxAddress || 'unknown'} | recipients=${recipients.join(', ') || 'none'}`
        );
        return; // Don't save this email
      }
      
      const attachmentsMeta = Array.isArray(payload.attachments)
        ? payload.attachments.map((attachment) => ({
            name: attachment?.name || 'attachment',
            contentType: attachment?.contentType || 'application/octet-stream',
          }))
        : null;

      const htmlBody = payload.bodyHtml || '';
      const bodyPreview = stripHtml(htmlBody) || payload.bodyText || '';

      const resolvedUserId = context.userInternalId ?? userInternalId ?? userId;

      // Find ALL leads/contacts that match the recipient email addresses
      // This ensures the email appears in all leads where any recipient email matches
      const normalizedRecipients = recipients.map((addr) => normalise(addr)).filter(Boolean);
      const recipientMappings = await fetchLeadMappingsForAddresses(normalizedRecipients);

      // Collect all unique matches
      const allMatches = new Set();
      const matchKeys = new Set();

      // Add the original lead/contact from context (the one the email was sent from)
      if (clientId || legacyId) {
        const originalMatch = {
          clientId: clientId,
          legacyId: legacyId,
          contactId: context.contactId || context.contact_id || null,
        };
        const key = `${clientId || 'null'}_${legacyId || 'null'}_${originalMatch.contactId || 'null'}`;
        if (!matchKeys.has(key)) {
          matchKeys.add(key);
          allMatches.add(originalMatch);
        }
      }

      // Add all matches from recipient email addresses
      normalizedRecipients.forEach((recipientEmail) => {
        const recipientMatches = recipientMappings[recipientEmail] || [];
        recipientMatches.forEach((match) => {
          const key = `${match.clientId || 'null'}_${match.legacyId || 'null'}_${match.contactId || 'null'}`;
          if (!matchKeys.has(key)) {
            matchKeys.add(key);
            allMatches.add({
              clientId: match.clientId,
              legacyId: match.legacyId,
              contactId: match.contactId,
            });
          }
        });
      });

      // Filter out matches where lead/contact email is from @lawoffice.org.il domain
      // Fetch lead/contact emails to verify they're not internal office emails
      const leadIdsToCheck = new Set();
      const contactIdsToCheck = new Set();
      allMatches.forEach((match) => {
        if (match.clientId) {
          leadIdsToCheck.add({ type: 'new', id: match.clientId });
        }
        if (match.legacyId) {
          leadIdsToCheck.add({ type: 'legacy', id: match.legacyId });
        }
        if (match.contactId) {
          contactIdsToCheck.add(match.contactId);
        }
      });

      // Fetch lead emails to check for @lawoffice.org.il domain
      const leadEmailsMap = new Map();
      if (leadIdsToCheck.size > 0) {
        const newLeadIds = Array.from(leadIdsToCheck).filter(l => l.type === 'new').map(l => l.id);
        const legacyLeadIds = Array.from(leadIdsToCheck).filter(l => l.type === 'legacy').map(l => l.id);

        if (newLeadIds.length > 0) {
          const { data: newLeads } = await supabase
            .from('leads')
            .select('id,email')
            .in('id', newLeadIds);
          (newLeads || []).forEach((lead) => {
            leadEmailsMap.set(`new_${lead.id}`, lead.email);
          });
        }

        if (legacyLeadIds.length > 0) {
          const { data: legacyLeads } = await supabase
            .from('leads_lead')
            .select('id,email')
            .in('id', legacyLeadIds);
          (legacyLeads || []).forEach((lead) => {
            leadEmailsMap.set(`legacy_${lead.id}`, lead.email);
          });
        }
      }

      // Fetch contact emails to check for @lawoffice.org.il domain
      const contactEmailsMap = new Map();
      if (contactIdsToCheck.size > 0) {
        const { data: contacts } = await supabase
          .from('leads_contact')
          .select('id,email')
          .in('id', Array.from(contactIdsToCheck));
        (contacts || []).forEach((contact) => {
          contactEmailsMap.set(contact.id, contact.email);
        });
      }

      // Filter out matches where lead or contact email should be filtered
      // BUT: If we have explicit lead context (clientId, legacyId, or contactId from context),
      // we should NOT filter based on email domain - these are system-sent emails that should always be saved
      const originalContextMatch = {
        clientId: clientId,
        legacyId: legacyId,
        contactId: context.contactId || context.contact_id || null,
      };
      
      const filteredMatches = Array.from(allMatches).filter((match) => {
        // If this match is the original context match (the lead/contact the email was sent from),
        // always include it regardless of email domain - it's a system-sent email
        const isOriginalContext = 
          (match.clientId && match.clientId === originalContextMatch.clientId) ||
          (match.legacyId && match.legacyId === originalContextMatch.legacyId) ||
          (match.contactId && match.contactId === originalContextMatch.contactId);
        
        if (isOriginalContext) {
          return true; // Always include original context match
        }
        
        // For other matches (found by recipient email), filter based on email domain
        // Check contact email if contact_id exists
        if (match.contactId) {
          const contactEmail = contactEmailsMap.get(match.contactId);
          if (contactEmail && shouldFilterEmail(contactEmail)) {
            console.log(`🚫 Skipping outgoing email record for contact ${match.contactId} (${contactEmail}) - filtered email`);
            return false;
          }
        }

        // Check lead email
        if (match.clientId) {
          const leadEmail = leadEmailsMap.get(`new_${match.clientId}`);
          if (leadEmail && shouldFilterEmail(leadEmail)) {
            console.log(`🚫 Skipping outgoing email record for new lead ${match.clientId} (${leadEmail}) - filtered email`);
            return false;
          }
        }
        if (match.legacyId) {
          const leadEmail = leadEmailsMap.get(`legacy_${match.legacyId}`);
          if (leadEmail && shouldFilterEmail(leadEmail)) {
            console.log(`🚫 Skipping outgoing email record for legacy lead ${match.legacyId} (${leadEmail}) - filtered email`);
            return false;
          }
        }

        return true;
      });

      if (filteredMatches.length === 0) {
        console.log(
          `🚫 Skipping outgoing email ${result.id?.substring(0, 20) || 'unknown'}... - all matched leads/contacts have filtered emails | sender=${mailboxAddress || 'unknown'} | recipients=${recipients.join(', ') || 'none'}`
        );
        return; // Don't save any email records
      }

      // Deduplicate: Ensure each message_id is saved only once per unique client_id, legacy_id, or contact_id
      // Priority: If we have both a match with contact_id and without contact_id for the same lead, prefer the one with contact_id
      const deduplicatedMatches = new Map();
      const leadsWithContacts = new Set(); // Track leads that already have a match with contact_id
      
      // First pass: Add all matches with contact_id
      filteredMatches.forEach((match) => {
        if (match.contactId) {
          const contactKey = `contact_${match.contactId}`;
          if (!deduplicatedMatches.has(contactKey)) {
            deduplicatedMatches.set(contactKey, match);
            // Mark this lead as having a contact match
            if (match.clientId) {
              leadsWithContacts.add(`client_${match.clientId}`);
            }
            if (match.legacyId) {
              leadsWithContacts.add(`legacy_${match.legacyId}`);
            }
          }
        }
      });
      
      // Second pass: Add matches without contact_id, but only if the lead doesn't already have a contact match
      filteredMatches.forEach((match) => {
        if (!match.contactId) {
          const leadKey = match.clientId ? `client_${match.clientId}` : (match.legacyId ? `legacy_${match.legacyId}` : null);
          if (leadKey && !leadsWithContacts.has(leadKey) && !deduplicatedMatches.has(leadKey)) {
            deduplicatedMatches.set(leadKey, match);
          }
        }
      });

      // Create one email record for each deduplicated match
      const emailRecords = Array.from(deduplicatedMatches.values()).map((match) => ({
        message_id: result.id,
        user_id: resolvedUserId,
        client_id: match.clientId,
        legacy_id: match.legacyId,
        contact_id: match.contactId,
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
      }));

      if (emailRecords.length === 0) {
        // No matches found - save one record without lead/contact association (for office emails, etc.)
        emailRecords.push({
          message_id: result.id,
          user_id: resolvedUserId,
          client_id: null,
          legacy_id: null,
          contact_id: null,
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
        });
      }

      // Check for duplicates based on body_preview + legacy_id or body_preview + contact_id
      // This prevents saving the same email content multiple times for the same lead/contact
      const bodyPreviewKeys = new Set();
      const recordsWithBodyPreview = emailRecords.filter(record => record.body_preview && (record.legacy_id || record.contact_id));
      
      if (recordsWithBodyPreview.length > 0) {
        const legacyIds = [...new Set(recordsWithBodyPreview.map(record => record.legacy_id).filter(Boolean))];
        const contactIds = [...new Set(recordsWithBodyPreview.map(record => record.contact_id).filter(Boolean))];
        
        // Query for existing emails with same body_preview and legacy_id
        if (legacyIds.length > 0) {
          const bodyPreviews = [...new Set(recordsWithBodyPreview.filter(record => record.legacy_id && record.body_preview).map(record => record.body_preview))];
          for (const bodyPreview of bodyPreviews) {
            const { data: existingByBodyPreview, error: bodyPreviewError } = await supabase
              .from(EMAIL_HEADERS_TABLE)
              .select('body_preview, legacy_id, contact_id')
              .eq('body_preview', bodyPreview)
              .in('legacy_id', legacyIds)
              .not('body_preview', 'is', null);
            
            if (!bodyPreviewError && existingByBodyPreview) {
              existingByBodyPreview.forEach((e) => {
                if (e.legacy_id) {
                  const key = `${e.body_preview}_legacy_${e.legacy_id}`;
                  bodyPreviewKeys.add(key);
                }
              });
            }
          }
        }
        
        // Query for existing emails with same body_preview and contact_id
        if (contactIds.length > 0) {
          const bodyPreviews = [...new Set(recordsWithBodyPreview.filter(record => record.contact_id && record.body_preview).map(record => record.body_preview))];
          for (const bodyPreview of bodyPreviews) {
            const { data: existingByBodyPreview, error: bodyPreviewError } = await supabase
              .from(EMAIL_HEADERS_TABLE)
              .select('body_preview, legacy_id, contact_id')
              .eq('body_preview', bodyPreview)
              .in('contact_id', contactIds)
              .not('body_preview', 'is', null);
            
            if (!bodyPreviewError && existingByBodyPreview) {
              existingByBodyPreview.forEach((e) => {
                if (e.contact_id) {
                  const key = `${e.body_preview}_contact_${e.contact_id}`;
                  bodyPreviewKeys.add(key);
                }
              });
            }
          }
        }
      }
      
      // Filter out duplicates based on body_preview + legacy_id or body_preview + contact_id
      const uniqueEmailRecords = emailRecords.filter((record) => {
        // Check for body_preview duplicates with legacy_id
        if (record.body_preview && record.legacy_id) {
          const bodyPreviewKey = `${record.body_preview}_legacy_${record.legacy_id}`;
          if (bodyPreviewKeys.has(bodyPreviewKey)) {
            console.log(`🔄 Skipping duplicate outgoing email record ${result.id?.substring(0, 20) || 'unknown'}... (same body_preview + legacy_id=${record.legacy_id}) already exists`);
            return false;
          }
        }
        
        // Check for body_preview duplicates with contact_id
        if (record.body_preview && record.contact_id) {
          const bodyPreviewKey = `${record.body_preview}_contact_${record.contact_id}`;
          if (bodyPreviewKeys.has(bodyPreviewKey)) {
            console.log(`🔄 Skipping duplicate outgoing email record ${result.id?.substring(0, 20) || 'unknown'}... (same body_preview + contact_id=${record.contact_id}) already exists`);
            return false;
          }
        }
        
        return true;
      });

      if (uniqueEmailRecords.length === 0) {
        console.log(`📭 No new outgoing email records to save (all ${emailRecords.length} records are duplicates based on body_preview)`);
        return;
      }

      console.log(`💾 Saving ${uniqueEmailRecords.length} email record(s) for outgoing email ${result.id.substring(0, 20)}... (${emailRecords.length - uniqueEmailRecords.length} duplicates filtered)`);

      // Use insert (not upsert) since we allow multiple rows with same message_id
      // Insert in batches to avoid timeout issues
      const BATCH_SIZE = 50;
      let insertedCount = 0;
      
      for (let i = 0; i < uniqueEmailRecords.length; i += BATCH_SIZE) {
        const batch = uniqueEmailRecords.slice(i, i + BATCH_SIZE);
        try {
          const { error } = await supabase.from(EMAIL_HEADERS_TABLE).insert(batch);
          
          if (error) {
            // If error is due to unique constraint violation, log but continue
            if (error.code === '23505') {
              console.warn(`⚠️ Batch ${Math.floor(i / BATCH_SIZE) + 1}: Some outgoing email records may have duplicate key violations (race condition), continuing...`);
            } else if (error.message && error.message.includes('timeout')) {
              console.warn(`⚠️ Batch ${Math.floor(i / BATCH_SIZE) + 1}: Timeout error, retrying with smaller batch...`);
              // Retry with smaller batches (10 at a time)
              for (let j = 0; j < batch.length; j += 10) {
                const smallBatch = batch.slice(j, j + 10);
                const { error: retryError } = await supabase.from(EMAIL_HEADERS_TABLE).insert(smallBatch);
                if (retryError) {
                  console.error(`❌ Failed to store small batch ${Math.floor(j / 10) + 1}:`, retryError.message || retryError);
                } else {
                  insertedCount += smallBatch.length;
                }
              }
            } else {
              console.error(`❌ Batch ${Math.floor(i / BATCH_SIZE) + 1}: Failed to persist outgoing email:`, error.message || error);
            }
          } else {
            insertedCount += batch.length;
          }
        } catch (err) {
          console.error(`❌ Batch ${Math.floor(i / BATCH_SIZE) + 1}: Exception while inserting outgoing emails:`, err.message || err);
        }
      }
      
      if (insertedCount < uniqueEmailRecords.length) {
        console.warn(`⚠️ Inserted ${insertedCount} out of ${uniqueEmailRecords.length} outgoing email record(s)`);
      }
    } catch (error) {
      console.error('⚠️  Unable to record outgoing email:', error.message || error);
    }
  }
}

module.exports = new GraphMailboxSyncService();


