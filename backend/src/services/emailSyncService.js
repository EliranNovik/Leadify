const { ConfidentialClientApplication } = require('@azure/msal-node');
const supabase = require('../config/supabase');

const LOOKBACK_DAYS = parseInt(process.env.GRAPH_EMAIL_LOOKBACK_DAYS || '7', 10);
const MAX_MESSAGES_PER_FOLDER = parseInt(process.env.GRAPH_EMAIL_MAX_RESULTS || '100', 10);
const GRAPH_SCOPES = ['https://graph.microsoft.com/.default'];

const stripHtml = (html) => {
  if (!html) return '';
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?(?!p\b|br\b|div\b|span\b|strong\b|em\b|ul\b|ol\b|li\b|a\b)[^>]+>/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
};

const sanitizeEmailHtml = (html) => {
  if (!html) return '';
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<\s*iframe[^>]*>[\s\S]*?<\s*\/\s*iframe>/gi, '')
    .replace(/on\w+="[^"]*"/gi, '')
    .replace(/on\w+='[^']*'/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/data:[^'"]*/gi, '')
    .replace(/<meta[^>]*>/gi, '')
    .replace(/<link[^>]*>/gi, '')
    .replace(/<object[^>]*>[\s\S]*?<\/object>/gi, '')
    .replace(/<embed[^>]*>[\s\S]*?<\/embed>/gi, '')
    .replace(/<applet[^>]*>[\s\S]*?<\/applet>/gi, '')
    .replace(/<base[^>]*>/gi, '')
    .replace(/<form[^>]*>[\s\S]*?<\/form>/gi, '')
    .replace(/<input[^>]*>/gi, '');
};

const extractHtmlBody = (html) => {
  if (!html) return '';
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return bodyMatch ? bodyMatch[1] : html;
};

const stripSignatureAndQuotedTextPreserveHtml = (html) => {
  if (!html) return '';
  let processed = html;
  processed = processed.replace(/(<div[^>]*class="?signature"?[^>]*>[\s\S]*?<\/div>)/gi, '');
  processed = processed.replace(/(<p[^>]*class="?signature"?[^>]*>[\s\S]*?<\/p>)/gi, '');
  processed = processed.replace(/(<div[^>]*id="?signature"?[^>]*>[\s\S]*?<\/div>)/gi, '');
  processed = processed.replace(/(<p[^>]*id="?signature"?[^>]*>[\s\S]*?<\/p>)/gi, '');
  processed = processed.replace(/(<blockquote[^>]*>[\s\S]*?<\/blockquote>)/gi, '');
  processed = processed.replace(/(From:\s.*?<br[^>]*>[\s\S]*?$)/gi, '');
  return processed;
};

const cleanMicrosoftDiagnosticEmail = (html) => {
  if (!html) return html;
  const lower = html.toLowerCase();
  const isDiagnostic =
    lower.includes('delivery has failed') ||
    lower.includes('diagnostic information for administrators') ||
    lower.includes('microsoftexchange') ||
    lower.includes('undeliverable');

  if (!isDiagnostic) return html;

  let cleaned = html;
  cleaned = cleaned.replace(/<b>Diagnostic information for administrators:<\/b>.*?(?=<b>|$)/gis, '');
  cleaned = cleaned.replace(/Generating server:.*?<br\s*\/?>/gi, '');
  cleaned = cleaned.replace(/Receiving server:.*?<br\s*\/?>/gi, '');
  cleaned = cleaned.replace(/\d+\/\d+\/\d+ \d+:\d+:\d+ (AM|PM).*?<br\s*\/?>/gi, '');
  cleaned = cleaned.replace(/\d+\.\d+\.\d+.*?<br\s*\/?>/gi, '');
  cleaned = cleaned.replace(/DNS.*?<br\s*\/?>/gi, '');
  cleaned = cleaned.replace(/Original message headers:.*$/gis, '');
  cleaned = cleaned.replace(/(<br\s*\/?>){3,}/gi, '<br><br>');
  return cleaned;
};

const convertBodyToHtml = (text) => {
  if (!text) return '';
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const urlRegex = /(https?:\/\/[^\s]+)/gi;
  const withLinks = escaped.replace(urlRegex, (url) => {
    const safeUrl = url.replace(/"/g, '&quot;');
    return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${url}</a>`;
  });
  return withLinks.replace(/\n/g, '<br>');
};

const normaliseAddress = (value) => (value || '').trim().toLowerCase();

const buildRecipientList = (msg) => {
  const to = (msg.toRecipients || []).map((r) => r.emailAddress?.address).filter(Boolean);
  const cc = (msg.ccRecipients || []).map((r) => r.emailAddress?.address).filter(Boolean);
  return [...to, ...cc].join(', ');
};

const normaliseContact = (contact) => ({
  id: contact.id,
  idString: contact.id ? String(contact.id) : null,
  client_uuid: contact.client_uuid || (contact.id ? String(contact.id) : null),
  lead_number: contact.lead_number ? String(contact.lead_number) : null,
  name: contact.name || '',
  email: contact.email ? contact.email.toLowerCase() : null,
  lead_type: contact.lead_type || 'new',
});

const buildContactIndexes = (contacts) => {
  const byEmail = new Map();
  const byLeadNumber = new Map();

  contacts.forEach((contact) => {
    const normalised = normaliseContact(contact);
    if (normalised.email) {
      if (!byEmail.has(normalised.email)) {
        byEmail.set(normalised.email, []);
      }
      byEmail.get(normalised.email).push(normalised);
    }

    if (normalised.lead_number) {
      if (!byLeadNumber.has(normalised.lead_number)) {
        byLeadNumber.set(normalised.lead_number, []);
      }
      byLeadNumber.get(normalised.lead_number).push(normalised);
    }
  });

  return { byEmail, byLeadNumber };
};

const findContactsForMessage = (message, indexes) => {
  const matches = new Map();

  const fromEmail = normaliseAddress(message.from?.emailAddress?.address);
  const toEmails = (message.toRecipients || []).map((r) => normaliseAddress(r.emailAddress?.address)).filter(Boolean);
  const ccEmails = (message.ccRecipients || []).map((r) => normaliseAddress(r.emailAddress?.address)).filter(Boolean);

  const allEmails = [fromEmail, ...toEmails, ...ccEmails].filter(Boolean);
  allEmails.forEach((email) => {
    const candidates = indexes.byEmail.get(email);
    if (candidates) {
      candidates.forEach((contact) => {
        matches.set(`${contact.lead_type}-${contact.idString || contact.lead_number}`, contact);
      });
    }
  });

  const subject = (message.subject || '').toLowerCase();
  indexes.byLeadNumber.forEach((contacts, leadNumber) => {
    if (!leadNumber) return;
    if (
      subject.includes(leadNumber.toLowerCase()) ||
      subject.includes(`l${leadNumber.toLowerCase()}`) ||
      subject.includes(`#${leadNumber.toLowerCase()}`) ||
      subject.includes(`#l${leadNumber.toLowerCase()}`)
    ) {
      contacts.forEach((contact) => {
        matches.set(`${contact.lead_type}-${contact.idString || contact.lead_number}`, contact);
      });
    }
  });

  return Array.from(matches.values());
};

const getLegacyId = (contact) => {
  if (!contact) return null;
  if (contact.lead_type !== 'legacy') return null;
  const raw = contact.lead_number || contact.idString || contact.id || '';
  const numeric = parseInt(String(raw).replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(numeric) ? numeric : null;
};

const createPreviewFromHtml = (html) => {
  const text = stripHtml(html);
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
};

class EmailSyncService {
  constructor() {
    this.mailboxUser =
      process.env.GRAPH_MAILBOX_USER ||
      process.env.GRAPH_SHARED_MAILBOX ||
      process.env.GRAPH_MAILBOX_UPN ||
      process.env.GRAPH_MAILBOX_ADDRESS ||
      null;

    if (!process.env.VITE_MSAL_CLIENT_ID || !process.env.AZURE_CLIENT_SECRET || !process.env.VITE_MSAL_TENANT_ID) {
      console.warn('⚠️  Missing Azure AD credentials for Microsoft Graph.');
    }

    this.msalClient = new ConfidentialClientApplication({
      auth: {
        clientId: process.env.VITE_MSAL_CLIENT_ID,
        clientSecret: process.env.AZURE_CLIENT_SECRET,
        authority: `https://login.microsoftonline.com/${process.env.VITE_MSAL_TENANT_ID}`,
      },
    });
  }

  async getAccessToken() {
    try {
      const response = await this.msalClient.acquireTokenByClientCredential({
        scopes: GRAPH_SCOPES,
      });
      if (!response?.accessToken) {
        throw new Error('No access token returned from Microsoft Graph');
      }
      return response.accessToken;
    } catch (error) {
      console.error('❌ Failed to acquire Microsoft Graph token:', error);
      throw new Error('Failed to acquire Microsoft Graph access token');
    }
  }

  buildFolderUrl(folderSegment, filterField, sinceIso, top) {
    const mailbox = encodeURIComponent(this.mailboxUser);
    const selectFields = [
      'id',
      'subject',
      'from',
      'toRecipients',
      'ccRecipients',
      'sentDateTime',
      'receivedDateTime',
      'body',
      'conversationId',
      'hasAttachments',
      'internetMessageId',
    ].join(',');

    const expand = '$expand=attachments';
    const filter = `${filterField} ge ${sinceIso}`;
    const orderBy = `$orderby=${filterField} desc`;
    const topClause = `$top=${top}`;

    return `https://graph.microsoft.com/v1.0/users/${mailbox}/${folderSegment}/messages?$select=${selectFields}&${expand}&$filter=${filter}&${orderBy}&${topClause}`;
  }

  async fetchFolderMessages(accessToken, folderSegment, filterField, sinceIso, top) {
    const messages = [];
    let url = this.buildFolderUrl(folderSegment, filterField, sinceIso, top);

    while (url && messages.length < top) {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ Microsoft Graph error (${response.status}) for ${folderSegment}:`, errorText);
        throw new Error(`Failed to fetch messages from Microsoft Graph (${folderSegment})`);
      }

      const json = await response.json();
      if (Array.isArray(json.value)) {
        messages.push(...json.value);
      }

      if (json['@odata.nextLink'] && messages.length < top) {
        url = json['@odata.nextLink'];
      } else {
        url = null;
      }
    }

    return messages;
  }

  async fetchMailboxMessages(accessToken, options = {}) {
    if (!this.mailboxUser) {
      throw new Error('Microsoft Graph mailbox user not configured. Set GRAPH_MAILBOX_USER environment variable.');
    }

    const lookbackDays = Number.isFinite(options.lookbackDays) ? options.lookbackDays : LOOKBACK_DAYS;
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - lookbackDays);
    const sinceIso = sinceDate.toISOString();
    const top = Math.max(10, Math.min(options.top || MAX_MESSAGES_PER_FOLDER, 500));

    console.log(
      `📬 Fetching Microsoft Graph emails for ${this.mailboxUser} (lookback ${lookbackDays} days, max ${top} per folder)`
    );

    const [inboxMessages, sentMessages] = await Promise.all([
      this.fetchFolderMessages(accessToken, "mailFolders('Inbox')", 'receivedDateTime', sinceIso, top),
      this.fetchFolderMessages(accessToken, "mailFolders('SentItems')", 'sentDateTime', sinceIso, top),
    ]);

    const mergedMap = new Map();
    [...inboxMessages, ...sentMessages].forEach((msg) => {
      if (!msg || !msg.id) return;
      mergedMap.set(msg.id, msg);
    });

    const merged = Array.from(mergedMap.values());
    console.log(`📥 Retrieved ${merged.length} unique messages from Microsoft Graph`);

    merged.sort((a, b) => {
      const aTime = new Date(a.receivedDateTime || a.sentDateTime || 0).getTime();
      const bTime = new Date(b.receivedDateTime || b.sentDateTime || 0).getTime();
      return bTime - aTime;
    });

    return merged;
  }

  async fetchContacts() {
    console.log('👥 Fetching contacts from Supabase for email matching...');

    const [{ data: newLeads, error: newLeadsError }, { data: legacyLeads, error: legacyLeadsError }] = await Promise.all([
      supabase.from('leads').select('id, name, email, lead_number'),
      supabase.from('leads_lead').select('id, name, email'),
    ]);

    if (newLeadsError) {
      console.error('❌ Error fetching new leads:', newLeadsError);
    }

    if (legacyLeadsError) {
      console.error('❌ Error fetching legacy leads:', legacyLeadsError);
    }

    const contacts = [
      ...(newLeads || []).map((lead) => ({
        ...lead,
        lead_type: 'new',
        client_uuid: lead.id ? String(lead.id) : null,
      })),
      ...(legacyLeads || []).map((lead) => ({
        ...lead,
        lead_type: 'legacy',
        lead_number: lead.id ? String(lead.id) : null,
        client_uuid: null,
      })),
    ];

    console.log(`👥 Prepared ${contacts.length} contacts (${newLeads?.length || 0} new + ${legacyLeads?.length || 0} legacy)`);

    return contacts;
  }

  async syncEmails(options = {}) {
    const mailboxes = await this.resolveMailboxList(options);

    if (!mailboxes.length) {
      throw new Error('No mailboxes configured. Provide GRAPH_MAILBOX_USER or ensure users table contains email addresses.');
    }

    console.log(`📬 Starting Graph email sync for ${mailboxes.length} mailbox(es).`);

    const aggregate = {
      mailboxes: [],
      processed: 0,
      matched: 0,
      inserted: 0,
      skipped: 0,
      failures: [],
    };

    for (const mailbox of mailboxes) {
      const trimmedMailbox = mailbox.trim().toLowerCase();
      if (!trimmedMailbox) continue;

      console.log(`📫 Syncing mailbox: ${trimmedMailbox}`);

      try {
        const result = await this.syncSingleMailbox(trimmedMailbox, options);
        aggregate.mailboxes.push({ mailbox: trimmedMailbox, ...result });
        aggregate.processed += result.processed;
        aggregate.matched += result.matched;
        aggregate.inserted += result.inserted;
        aggregate.skipped += result.skipped;
      } catch (error) {
        console.error(`❌ Failed to sync mailbox ${trimmedMailbox}:`, error);
        aggregate.failures.push({ mailbox: trimmedMailbox, error: error.message || String(error) });
      }
    }

    return aggregate;
  }

  async syncSingleMailbox(mailbox, options = {}) {
    const previousMailbox = this.mailboxUser;
    this.mailboxUser = mailbox;

    try {
      const accessToken = await this.getAccessToken();
      const [messages, contacts] = await Promise.all([
        this.fetchMailboxMessages(accessToken, options),
        this.fetchContacts(),
      ]);

      if (!messages.length) {
        console.log(`📭 No messages retrieved from Microsoft Graph for ${mailbox}.`);
        return {
          processed: 0,
          matched: 0,
          inserted: 0,
          skipped: 0,
        };
      }

      const domain = (process.env.GRAPH_MAILBOX_DOMAIN || 'lawoffice.org.il').toLowerCase();
      const contactIndexes = buildContactIndexes(contacts);
      const emailsToUpsert = [];
      const skippedWithoutContact = [];

      messages.forEach((msg) => {
        const fromEmail = normaliseAddress(msg.from?.emailAddress?.address);
        const toEmails = (msg.toRecipients || []).map((r) => normaliseAddress(r.emailAddress?.address)).filter(Boolean);
        const ccEmails = (msg.ccRecipients || []).map((r) => normaliseAddress(r.emailAddress?.address)).filter(Boolean);

        const involvesDomain =
          fromEmail.includes(domain) ||
          toEmails.some((email) => email.includes(domain)) ||
          ccEmails.some((email) => email.includes(domain));

        if (!involvesDomain) {
          return;
        }

        const matchingContacts = findContactsForMessage(msg, contactIndexes);
        if (matchingContacts.length === 0) {
          skippedWithoutContact.push(msg.subject || msg.id);
          return;
        }

        const preferredContact =
          matchingContacts.find((contact) => contact.lead_type !== 'legacy') || matchingContacts[0];
        const isLegacy = preferredContact.lead_type === 'legacy';
        const legacyId = getLegacyId(preferredContact);
        const clientUuid = !isLegacy ? preferredContact.client_uuid : null;

        const originalBody = msg.body?.content || '';
        const cleanedBody = isLegacy
          ? originalBody
          : stripSignatureAndQuotedTextPreserveHtml(originalBody);
        const diagnosticFreeBody = cleanMicrosoftDiagnosticEmail(cleanedBody);
        const htmlBody = sanitizeEmailHtml(extractHtmlBody(diagnosticFreeBody || originalBody));
        const finalBody = htmlBody || convertBodyToHtml(originalBody);
        const preview = createPreviewFromHtml(finalBody);

        const sentAt = msg.sentDateTime || msg.receivedDateTime || new Date().toISOString();
        const direction = fromEmail.includes(domain) ? 'outgoing' : 'incoming';

        const attachments =
          msg.attachments && Array.isArray(msg.attachments) && msg.attachments.length > 0
            ? msg.attachments.map((att) => ({
                id: att.id,
                name: att.name,
                contentType: att.contentType,
                size: att.size,
                isInline: att.isInline,
                contentBytes: att.contentBytes || null,
              }))
            : null;

        emailsToUpsert.push({
          message_id: msg.id,
          internet_message_id: msg.internetMessageId || null,
          client_id: clientUuid,
          legacy_id: legacyId,
          thread_id: msg.conversationId || null,
          sender_name: msg.from?.emailAddress?.name || null,
          sender_email: msg.from?.emailAddress?.address || null,
          recipient_list: buildRecipientList(msg),
          subject: msg.subject || '(no subject)',
          body_html: finalBody,
          body_preview: preview,
          sent_at: sentAt,
          direction,
          attachments,
          updated_at: new Date().toISOString(),
        });
      });

      if (!emailsToUpsert.length) {
        console.log(`📭 No emails matched any contacts for ${mailbox}.`);
        return {
          processed: messages.length,
          matched: 0,
          inserted: 0,
          skipped: skippedWithoutContact.length,
          skippedSubjects: skippedWithoutContact,
        };
      }

      console.log(`💾 Upserting ${emailsToUpsert.length} emails into Supabase for ${mailbox}...`);
      const { data, error } = await supabase
        .from('emails')
        .upsert(emailsToUpsert, { onConflict: 'message_id' })
        .select('id, message_id');

      if (error) {
        console.error('❌ Failed to upsert emails into Supabase:', error);
        throw new Error(`Failed to upsert emails into database: ${error.message}`);
      }

      console.log(`✅ Upserted ${emailsToUpsert.length} emails for ${mailbox} (Supabase returned ${data?.length || 0} rows)`);

      return {
        processed: messages.length,
        matched: emailsToUpsert.length,
        inserted: data?.length || 0,
        skipped: skippedWithoutContact.length,
        skippedSubjects: skippedWithoutContact,
      };
    } finally {
      this.mailboxUser = previousMailbox;
    }
  }

  async resolveMailboxList(options = {}) {
    const mailboxSet = new Set();

    const addMailbox = (value) => {
      if (!value || typeof value !== 'string') return;
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .forEach((item) => mailboxSet.add(item.toLowerCase()));
    };

    if (Array.isArray(options.mailboxes)) {
      options.mailboxes.forEach((item) => addMailbox(item));
    }

    if (options.mailbox && typeof options.mailbox === 'string') {
      addMailbox(options.mailbox);
    }

    addMailbox(process.env.GRAPH_MAILBOX_USER);
    addMailbox(process.env.GRAPH_SHARED_MAILBOX);
    addMailbox(process.env.GRAPH_MAILBOX_UPN);
    addMailbox(process.env.GRAPH_MAILBOX_ADDRESS);
    addMailbox(process.env.GRAPH_MAILBOX_LIST);

    if (mailboxSet.size > 0) {
      return Array.from(mailboxSet);
    }

    const domainFilter = (process.env.GRAPH_MAILBOX_DOMAIN || '').toLowerCase();
    try {
      const { data, error } = await supabase.from('users').select('email').not('email', 'is', null);
      if (error) {
        console.error('❌ Error fetching user emails for mailbox list:', error);
        return [];
      }

      (data || []).forEach((row) => {
        if (!row?.email) return;
        const email = row.email.trim().toLowerCase();
        if (!email) return;
        if (domainFilter && !email.endsWith(`@${domainFilter}`)) return;
        mailboxSet.add(email);
      });
    } catch (error) {
      console.error('❌ Unexpected error resolving mailbox list from users table:', error);
      return [];
    }

    return Array.from(mailboxSet);
  }
}

module.exports = new EmailSyncService();


