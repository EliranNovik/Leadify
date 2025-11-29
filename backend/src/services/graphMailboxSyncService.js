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

const normalise = (value) => (value || '').trim().toLowerCase();

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

const fetchLeadMappingsForAddresses = async (addresses) => {
  const unique = Array.from(new Set(addresses.map((addr) => normalise(addr)).filter(Boolean)));
  if (!unique.length) {
    return {};
  }

  const mapping = {};

  const addMapping = (email, value) => {
    const key = normalise(email);
    if (!key) return;
    if (!mapping[key]) {
      mapping[key] = value;
    }
  };

  try {
    for (const chunk of chunkArray(unique, 99)) {
      const { data: leadMatches, error: leadError } = await supabase
        .from('leads')
        .select('id,email')
        .in('email', chunk);

      if (leadError) {
        console.error('❌ Failed to resolve leads for email addresses:', leadError.message || leadError);
      } else {
        (leadMatches || []).forEach((lead) => {
          if (lead?.email) {
            addMapping(lead.email, { clientId: lead.id, legacyId: null });
          }
        });
      }

      const { data: legacyMatches, error: legacyError } = await supabase
        .from('leads_lead')
        .select('id,email')
        .in('email', chunk);

      if (legacyError) {
        console.error('❌ Failed to resolve legacy leads for email addresses:', legacyError.message || legacyError);
      } else {
        (legacyMatches || []).forEach((lead) => {
          if (lead?.email) {
            addMapping(lead.email, { clientId: null, legacyId: lead.id });
          }
        });
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

    const tokenResponse = await graphAuthService.acquireTokenByRefreshToken(tokenRecord.refresh_token, account);
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

    if (WEBHOOK_URL) {
      await this.ensureSubscription({
        userId: resolvedUserId,
        accessToken: tokenResponse.accessToken,
        state,
        mailboxAddress,
      });
    }

    return {
      synced: stored.processed,
      inserted: stored.inserted,
      skipped: stored.skipped,
      trackedConversations: stored.trackedCount,
      deltaLink: nextDeltaLink || deltaLink || null,
    };
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
    try {
      const expiresAt = state?.subscription_expiry ? new Date(state.subscription_expiry).getTime() : 0;
      const now = Date.now();
      const needsRenewal = !state?.subscription_id || !state?.subscription_expiry || expiresAt - now < 24 * 60 * 60 * 1000;
      if (!needsRenewal) return;

      if (state?.subscription_id) {
        await fetch(`${GRAPH_BASE_URL}/subscriptions/${state.subscription_id}`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }).catch(() => null);
      }

      const payload = {
        changeType: 'created,updated',
        notificationUrl: WEBHOOK_URL,
        // Monitor the root folder so all child folders are included
        resource: `/users/${mailboxAddress}/mailFolders('MsgFolderRoot')/messages`,
        expirationDateTime: new Date(Date.now() + 60 * 60 * 1000 * 48).toISOString(),
        clientState: String(userId),
      };

      const response = await fetchJson(`${GRAPH_BASE_URL}/subscriptions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      await mailboxStateService.upsertState(userId, {
        subscription_id: response.id,
        subscription_expiry: response.expirationDateTime,
      });
    } catch (error) {
      console.error('⚠️  Unable to create Graph subscription:', error.message || error);
    }
  }

  async fetchDeltaMessages({ accessToken, mailboxAddress, deltaLink }) {
    let url =
      deltaLink ||
      `${GRAPH_BASE_URL}/users/${mailboxAddress}/mailFolders('MsgFolderRoot')/messages/delta?$select=id,subject,from,toRecipients,ccRecipients,conversationId,bodyPreview,receivedDateTime,sentDateTime,isRead,hasAttachments,internetMessageId,parentFolderId&$top=${DEFAULT_SYNC_BATCH}`;
    const messages = [];
    let nextLink = null;

    while (url) {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Prefer: `outlook.body-preview="text"`,
        },
      });

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
        nextLink = json['@odata.deltaLink'] || deltaLink;
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
      const senderEmail = normalise(msg.from?.emailAddress?.address);
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

      const direction = senderEmail === normalizedMailbox ? 'outgoing' : 'incoming';
      const sentAt = msg.sentDateTime || msg.receivedDateTime || new Date().toISOString();

      // Note: bodyPreview from Graph API is truncated (usually ~255 chars)
      // We'll fetch the full body separately and update it
      // For now, store the preview but mark that we need to fetch the full body
      return {
        message_id: msg.id,
        user_id: userId,
        sender_name: senderName,
        sender_email: senderEmail || normalizedMailbox || null,
        recipient_list: recipientList,
        subject: msg.subject || '(no subject)',
        body_html: '', // Will be populated when full body is fetched
        body_preview: msg.bodyPreview || '', // Truncated preview from Graph API
        sent_at: sentAt,
        direction,
        attachments: msg.hasAttachments ? [] : null,
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

    // Process rows and find contact_id for each
    for (const row of rows) {
      const recipientAddresses = row.recipient_list
        ? row.recipient_list
            .split(',')
            .map((addr) => normalise(addr))
            .filter(Boolean)
        : [];

      const recipientMatch = recipientAddresses
        .map((addr) => leadMappings[addr])
        .find((entry) => entry);
      const senderMatch = row.sender_email ? leadMappings[row.sender_email] : null;
      const match = senderMatch || recipientMatch;

      if (match) {
        row.client_id = match.clientId || null;
        row.legacy_id = match.legacyId || null;
        
        // Find contact_id by email address
        let contactId = null;
        const isLegacyLead = match.legacyId !== null;
        const leadIdForQuery = isLegacyLead ? match.legacyId : match.clientId;
        
        if (leadIdForQuery) {
          // Get all contacts for this lead
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
              .select('id, email')
              .in('id', contactIds);
            
            if (!contactsError && contacts && contacts.length > 0) {
              // Find the contact that matches the email address
              const normalizedSenderEmail = normalise(row.sender_email);
              const normalizedRecipientEmails = recipientAddresses.map(addr => normalise(addr));
              
              // Check sender email first
              if (normalizedSenderEmail) {
                const matchingContact = contacts.find(c => normalise(c.email) === normalizedSenderEmail);
                if (matchingContact) {
                  contactId = matchingContact.id;
                }
              }
              
              // If no sender match, check recipient emails
              if (!contactId) {
                for (const recipientEmail of normalizedRecipientEmails) {
                  const matchingContact = contacts.find(c => normalise(c.email) === recipientEmail);
                  if (matchingContact) {
                    contactId = matchingContact.id;
                    break;
                  }
                }
              }
              
              // If still no match, try partial email matching (fallback)
              if (!contactId) {
                // Try matching by email domain or partial match
                const senderEmailDomain = normalizedSenderEmail ? normalizedSenderEmail.split('@')[0] : null;
                if (senderEmailDomain && senderEmailDomain.length >= 3) {
                  for (const contact of contacts) {
                    const contactEmailNormalized = normalise(contact.email || '');
                    if (contactEmailNormalized) {
                      const contactEmailDomain = contactEmailNormalized.split('@')[0];
                      // Match if email username matches (at least 3 characters)
                      if (contactEmailDomain && contactEmailDomain.length >= 3 && 
                          (contactEmailDomain.includes(senderEmailDomain) || senderEmailDomain.includes(contactEmailDomain))) {
                        contactId = contact.id;
                        console.log(`✅ Found matching contact ${contact.id} by email partial match for ${row.sender_email}`);
                        break;
                      }
                    }
                  }
                }
                
                // If still no match, try recipient emails with partial matching
                if (!contactId) {
                  for (const recipientEmail of normalizedRecipientEmails) {
                    const recipientEmailDomain = recipientEmail.split('@')[0];
                    if (recipientEmailDomain && recipientEmailDomain.length >= 3) {
                      for (const contact of contacts) {
                        const contactEmailNormalized = normalise(contact.email || '');
                        if (contactEmailNormalized) {
                          const contactEmailDomain = contactEmailNormalized.split('@')[0];
                          if (contactEmailDomain && contactEmailDomain.length >= 3 &&
                              (contactEmailDomain.includes(recipientEmailDomain) || recipientEmailDomain.includes(contactEmailDomain))) {
                            contactId = contact.id;
                            console.log(`✅ Found matching contact ${contact.id} by recipient email partial match`);
                            break;
                          }
                        }
                      }
                      if (contactId) break;
                    }
                  }
                }
              }
              
              // If still no match, use the main contact
              if (!contactId) {
                const mainContactRel = leadContacts.find(lc => lc.main === true || lc.main === 't');
                if (mainContactRel) {
                  contactId = mainContactRel.contact_id;
                }
              }
            }
          }
        }
        
        row.contact_id = contactId;
      } else {
        console.log(
          `📭 No lead match for message ${row.message_id} | sender=${row.sender_email || 'unknown'} | recipients=${
            row.recipient_list || 'none'
          }`
        );
      }
    }

    if (!rows.length) {
      return { processed: messages.length, inserted: 0, skipped: 0, trackedCount: 0 };
    }

    const { error } = await supabase
      .from(EMAIL_HEADERS_TABLE)
      .upsert(rows, { onConflict: 'message_id' });
    if (error) {
      console.error('❌ Failed to store email headers:', error.message || error);
      throw new Error('Unable to store email headers');
    }

    // Check which emails are actually new (not already in database)
    // This prevents sending duplicate notifications for emails that were already synced
    const messageIds = rows.map(row => row.message_id).filter(Boolean);
    let existingMessageIds = new Set();
    
    if (messageIds.length > 0) {
      const { data: existingEmails, error: checkError } = await supabase
        .from(EMAIL_HEADERS_TABLE)
        .select('message_id')
        .in('message_id', messageIds);
      
      if (!checkError && existingEmails) {
        existingMessageIds = new Set(existingEmails.map(e => e.message_id));
      }
    }

    const newLeadEmails = rows.filter((row) => {
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
      console.log(`ℹ️  No new email leads to notify (${rows.length} emails processed, ${existingMessageIds.size} already existed)`);
    }

    // After storing headers, fetch full bodies for messages that need them
    // This runs asynchronously so it doesn't block the sync
    if (accessToken) {
      this.fetchFullBodiesForMessages(userId, mailboxAddress, rows, accessToken).catch(err => {
        console.error('⚠️  Error fetching full email bodies:', err.message || err);
        // Don't throw - this is a background operation
      });
    }

    console.log(`📥 Stored ${rows.length} emails (processed ${messages.length})`);

    return {
      processed: messages.length,
      inserted: rows.length,
      skipped: 0,
      trackedCount: 0,
    };
  }

  // Fetch full email bodies for messages that only have truncated previews
  async fetchFullBodiesForMessages(userId, mailboxAddress, emailRows, accessToken) {
    if (!emailRows || emailRows.length === 0 || !accessToken) return;

    console.log(`📧 Fetching full bodies for ${emailRows.length} email(s)...`);

    // Fetch full bodies in parallel (but limit concurrency to avoid rate limits)
    const BATCH_SIZE = 5;
    for (let i = 0; i < emailRows.length; i += BATCH_SIZE) {
      const batch = emailRows.slice(i, i + BATCH_SIZE);
      
      await Promise.all(
        batch.map(async (row) => {
          try {
            // Fetch full body from Graph API
            const message = await fetchJson(
              `${GRAPH_BASE_URL}/users/${mailboxAddress}/messages/${row.message_id}?$select=body`,
              {
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                },
              }
            );

            const fullBody = message.body?.content || '';
            
            if (!fullBody || fullBody.trim().length === 0) {
              // If no body content, keep the preview
              return;
            }

            // Update both body_html and body_preview with full content
            const { error: updateError } = await supabase
              .from(EMAIL_HEADERS_TABLE)
              .update({
                body_html: fullBody,
                body_preview: fullBody, // Store full content in preview too
                body_cached: true,
              })
              .eq('message_id', row.message_id);

            if (updateError) {
              console.error(`⚠️  Failed to update body for ${row.message_id}:`, updateError.message);
            } else {
              // Also store in email_bodies table for consistency
              const { data: headerData } = await supabase
                .from(EMAIL_HEADERS_TABLE)
                .select('id')
                .eq('message_id', row.message_id)
                .single();

              if (headerData?.id) {
                await supabase.from(EMAIL_BODIES_TABLE).upsert({
                  email_id: headerData.id,
                  body_html: fullBody,
                  updated_at: new Date().toISOString(),
                });
              }
            }
          } catch (err) {
            console.error(`⚠️  Error fetching body for ${row.message_id}:`, err.message || err);
            // Continue with other messages even if one fails
          }
        })
      );

      // Small delay between batches to avoid rate limiting
      if (i + BATCH_SIZE < emailRows.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    console.log(`✅ Finished fetching full bodies for ${emailRows.length} email(s)`);
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

  async getEmailBody(userId, emailId) {
    const header = await this.getEmailById(userId, emailId);
    if (!header) throw new Error('Email not found');

    const { data, error } = await supabase
      .from(EMAIL_BODIES_TABLE)
      .select('body_html')
      .eq('email_id', header.id)
      .limit(1);
    if (error) throw new Error(error.message || 'Failed to load email body');

    if (data && data.length) {
      return data[0].body_html;
    }

    const html = await this.fetchAndCacheBody(userId, header);
    return html;
  }

  async fetchAndCacheBody(userId, header) {
    const tokenRecord = await mailboxTokenService.getTokenByUserId(userId);
    if (!tokenRecord) throw new Error('Mailbox is not connected');

    const tokenResponse = await graphAuthService.acquireTokenByRefreshToken(tokenRecord.refresh_token, {
      homeAccountId: tokenRecord.home_account_id,
      environment: tokenRecord.environment,
      tenantId: tokenRecord.tenant_id,
      username: tokenRecord.mailbox_address,
    });
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

    await supabase
      .from(EMAIL_HEADERS_TABLE)
      .update({ body_cached: true })
      .eq('id', header.id);

    return bodyHtml;
  }

  async downloadAttachment(userId, emailId, attachmentId) {
    const header = await this.getEmailById(userId, emailId);
    if (!header) throw new Error('Email not found');
    const tokenRecord = await mailboxTokenService.getTokenByUserId(userId);
    if (!tokenRecord) throw new Error('Mailbox is not connected');

    const tokenResponse = await graphAuthService.acquireTokenByRefreshToken(tokenRecord.refresh_token, {
      homeAccountId: tokenRecord.home_account_id,
      environment: tokenRecord.environment,
      tenantId: tokenRecord.tenant_id,
      username: tokenRecord.mailbox_address,
    });
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

    const tokenResponse = await graphAuthService.acquireTokenByRefreshToken(tokenRecord.refresh_token, {
      homeAccountId: tokenRecord.home_account_id,
      environment: tokenRecord.environment,
      tenantId: tokenRecord.tenant_id,
      username: tokenRecord.mailbox_address,
    });

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
      const attachmentsMeta = Array.isArray(payload.attachments)
        ? payload.attachments.map((attachment) => ({
            name: attachment?.name || 'attachment',
            contentType: attachment?.contentType || 'application/octet-stream',
          }))
        : null;

      const htmlBody = payload.bodyHtml || '';
      const bodyPreview = stripHtml(htmlBody) || payload.bodyText || '';

      const resolvedUserId = context.userInternalId ?? userInternalId ?? userId;

      const emailRecord = {
        message_id: result.id,
        user_id: resolvedUserId,
        client_id: clientId,
        legacy_id: isLegacy ? legacyId : null,
        contact_id: context.contactId || context.contact_id || null,
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

      const { error } = await supabase.from(EMAIL_HEADERS_TABLE).upsert(emailRecord, {
        onConflict: 'message_id',
      });

      if (error) {
        console.error('⚠️  Failed to persist outgoing email:', error.message || error);
      }
    } catch (error) {
      console.error('⚠️  Unable to record outgoing email:', error.message || error);
    }
  }
}

module.exports = new GraphMailboxSyncService();


