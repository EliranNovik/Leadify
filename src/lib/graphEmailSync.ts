import { supabase } from './supabase';

export interface GraphSyncClient {
  id: string | number;
  email?: string | null;
  lead_number?: string | null;
  lead_type?: string | null;
  topic?: string | null;
}

export interface GraphClientSyncOptions {
  lookbackDays?: number;
  maxResults?: number;
  searchAdditionalTerms?: string[];
}

const DEFAULT_LOOKBACK_DAYS = 30;
const DEFAULT_MAX_RESULTS = 30;
const LAW_OFFICE_DOMAIN = 'lawoffice.org.il';

const normaliseAddress = (value: string | null | undefined) =>
  (value ?? '').trim().toLowerCase();

const normaliseRecipientList = (recipients: any[] | null | undefined) =>
  (recipients || [])
    .map((recipient) => recipient?.emailAddress?.address)
    .filter(Boolean)
    .map((address: string) => address.trim())
    .join(', ');

export const stripSignatureAndQuotedTextPreserveHtml = (html: string): string => {
  if (!html) return '';

  const text = html.trim();
  if (!text) return '';

  const lower = text.toLowerCase();

  const markers = [
    '-------- original message --------',
    '-----original message-----',
    '----- original message -----',
    'from:',
    'sent:',
    'date:',
    'to:',
    'cc:',
    'subject:',
    'reply-to:',
    '<blockquote',
    '<div class="gmail_quote"',
    '<div class="yahoo_quoted"',
    '<div class="moz-forward-container"',
    '<hr data-route="replied-message-separator"',
    '<p class="m_-',
    '<p class="gmail',
    '<p class="mso',
    '<p class="WordSection',
    '<div id="divRplyFwdMsg"',
    '<div id="divRplyMsg"',
    'best regards',
    'kind regards',
    'sincerely',
    'thank you',
    'thanks,',
    'thanks.',
    'sent from my iphone',
    'sent from my ipad',
    'sent from outlook',
    'get outlook for',
  ];

  let cutoff = text.length;
  markers.forEach((marker) => {
    const idx = lower.indexOf(marker);
    if (idx !== -1 && idx < cutoff) {
      cutoff = idx;
    }
  });

  let truncated = cutoff < text.length ? text.slice(0, cutoff) : text;

  truncated = truncated
    .replace(/(<br\s*\/?>\s*){3,}/gi, '<br><br>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return truncated;
};

export interface GraphClientSyncResult {
  processed: number;
  matched: number;
}

export const syncEmailsForClient = async (
  token: string,
  client: GraphSyncClient,
  options: GraphClientSyncOptions = {}
): Promise<GraphClientSyncResult> => {
  if (!token) throw new Error('Missing access token for Microsoft Graph');
  if (!client?.id) throw new Error('Missing client identifier for Graph sync');

  const { lookbackDays = DEFAULT_LOOKBACK_DAYS, maxResults = DEFAULT_MAX_RESULTS, searchAdditionalTerms = [] } = options;

  const clientEmailNormalised = normaliseAddress(typeof client.email === 'string' ? client.email : String(client.email ?? ''));
  const clientLeadNumber = (client.lead_number ?? '').toString().trim();
  if (!clientEmailNormalised && !clientLeadNumber) {
    return { processed: 0, matched: 0 };
  }

  const searchTerms = [
    clientLeadNumber && `"${clientLeadNumber}"`,
    clientEmailNormalised && `"${clientEmailNormalised}"`,
    ...searchAdditionalTerms.map((term) => (term ? `"${term}"` : '')).filter(Boolean),
  ].filter(Boolean);

  if (searchTerms.length === 0) {
    return { processed: 0, matched: 0 };
  }

  const lookbackDate = new Date();
  lookbackDate.setDate(lookbackDate.getDate() - lookbackDays);

  const query = new URL('https://graph.microsoft.com/v1.0/me/messages');
  query.searchParams.set('$search', searchTerms.join(' OR '));
  query.searchParams.set('$top', String(Math.max(1, Math.min(maxResults, 50))));
  query.searchParams.set('$select', 'id,subject,from,toRecipients,ccRecipients,receivedDateTime,body,conversationId,hasAttachments');
  query.searchParams.set('$filter', `receivedDateTime ge ${lookbackDate.toISOString()}`);

  const response = await fetch(query.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      ConsistencyLevel: 'eventual',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    let message = `Failed to fetch from Microsoft Graph: ${response.status}`;
    try {
      const parsed = JSON.parse(errorText);
      if (parsed?.error?.message) {
        message = parsed.error.message;
      }
    } catch (error) {
      // ignore JSON parse errors
    }
    throw new Error(message);
  }

  const { value: messages = [] } = await response.json();
  if (!messages.length) {
    return { processed: 0, matched: 0 };
  }

  const filteredMessages = messages.filter((message: any) => {
    const fromEmail = normaliseAddress(message?.from?.emailAddress?.address);
    const toEmails = (message?.toRecipients || []).map((recipient: any) => normaliseAddress(recipient?.emailAddress?.address));
    const ccEmails = (message?.ccRecipients || []).map((recipient: any) => normaliseAddress(recipient?.emailAddress?.address));
    const subject = (message?.subject || '').toString();

    if (clientEmailNormalised) {
      if (fromEmail === clientEmailNormalised) return true;
      if (toEmails.includes(clientEmailNormalised)) return true;
      if (ccEmails.includes(clientEmailNormalised)) return true;
    }

    if (clientLeadNumber) {
      if (subject.includes(clientLeadNumber)) return true;
      if (subject.includes(`L${clientLeadNumber}`)) return true;
      if (subject.includes(`#${clientLeadNumber}`)) return true;
      if (subject.includes(`#L${clientLeadNumber}`)) return true;
    }

    return false;
  });

  if (!filteredMessages.length) {
    return { processed: messages.length, matched: 0 };
  }

  filteredMessages.sort(
    (a: any, b: any) =>
      new Date(b.receivedDateTime).getTime() - new Date(a.receivedDateTime).getTime()
  );

  const idString = client.id.toString();
  const isLegacyLead = client.lead_type === 'legacy' || idString.startsWith('legacy_');
  const legacyId = isLegacyLead
    ? (() => {
        const numeric = parseInt(idString.replace(/[^0-9]/g, ''), 10);
        return Number.isFinite(numeric) ? numeric : null;
      })()
    : null;

  const clientId = isLegacyLead ? null : idString;

  const emailsToUpsert = filteredMessages.map((message: any) => {
    const fromEmail = normaliseAddress(message?.from?.emailAddress?.address);
    const isOutgoing = fromEmail.includes(LAW_OFFICE_DOMAIN);
    const originalBody = message?.body?.content || '';
    const processedBody = !isOutgoing
      ? stripSignatureAndQuotedTextPreserveHtml(originalBody)
      : originalBody;

    const cleanedBody = processedBody || originalBody || '';

    return {
      message_id: message.id,
      client_id: clientId,
      legacy_id: legacyId,
      thread_id: message.conversationId || null,
      sender_name: message?.from?.emailAddress?.name || null,
      sender_email: message?.from?.emailAddress?.address || null,
      recipient_list: normaliseRecipientList([
        ...(message?.toRecipients || []),
        ...(message?.ccRecipients || []),
      ]),
      subject: message.subject || null,
      body_html: cleanedBody,
      body_preview: cleanedBody,
      sent_at: message.receivedDateTime,
      direction: isOutgoing ? 'outgoing' : 'incoming',
      attachments: message.attachments || null,
    };
  });

  if (!emailsToUpsert.length) {
    return { processed: messages.length, matched: 0 };
  }

  const { error } = await supabase
    .from('emails')
    .upsert(emailsToUpsert, { onConflict: 'message_id' });

  if (error) {
    throw new Error(`Failed to sync emails to database: ${error.message}`);
  }

  return { processed: messages.length, matched: emailsToUpsert.length };
};

