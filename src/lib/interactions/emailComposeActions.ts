/**
 * Shared Reply / Reply All / Forward helpers for email compose UIs.
 */

const OFFICE_DOMAIN = '@lawoffice.org.il';

export type EmailComposeMode = 'reply' | 'reply_all' | 'forward';

export type ComposeSourceMessage = {
  id?: string;
  message_id?: string | null;
  subject?: string | null;
  body_html?: string | null;
  body_preview?: string | null;
  sender_email?: string | null;
  sender_name?: string | null;
  recipient_list?: string | null;
  sent_at?: string | null;
  direction?: 'incoming' | 'outgoing' | string | null;
  from?: string | null;
  to?: string | null;
};

export function parseEmailAddressList(value: string | null | undefined): string[] {
  if (!value) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of String(value).split(/[,;]+/)) {
    const match = part.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    const email = (match?.[0] || part).trim().toLowerCase();
    if (!email || !email.includes('@') || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

export function isInternalMailboxAddress(email: string | null | undefined): boolean {
  const e = String(email || '').toLowerCase().trim();
  return !e ? false : e.endsWith(OFFICE_DOMAIN) || e === 'office@lawoffice.org.il';
}

export function withReSubject(subject: string | null | undefined): string {
  const raw = String(subject || '').trim() || '(no subject)';
  return /^re\s*:/i.test(raw) ? raw : `Re: ${raw}`;
}

export function withFwdSubject(subject: string | null | undefined): string {
  const raw = String(subject || '').trim() || '(no subject)';
  return /^(fwd|fw)\s*:/i.test(raw) ? raw : `Fwd: ${raw}`;
}

function plainPreview(message: ComposeSourceMessage): string {
  const html = message.body_html || message.body_preview || '';
  return String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function buildForwardBody(message: ComposeSourceMessage): string {
  const when = message.sent_at
    ? new Date(message.sent_at).toLocaleString()
    : '';
  const from = message.sender_email || message.from || '';
  const to = message.recipient_list || message.to || '';
  const subject = message.subject || '(no subject)';
  const body = plainPreview(message);
  return [
    '',
    '---------- Forwarded message ----------',
    `From: ${from}`,
    when ? `Date: ${when}` : null,
    `Subject: ${subject}`,
    to ? `To: ${to}` : null,
    '',
    body,
  ]
    .filter((line) => line !== null)
    .join('\n');
}

export function buildComposeDraft(
  message: ComposeSourceMessage | null | undefined,
  mode: EmailComposeMode,
  opts: {
    userEmail?: string | null;
    fallbackTo?: string | null;
  } = {},
): { to: string[]; cc: string[]; subject: string; body: string } {
  const userEmail = String(opts.userEmail || '').toLowerCase().trim();
  const fallbackTo = String(opts.fallbackTo || '').toLowerCase().trim();

  if (!message) {
    return {
      to: fallbackTo ? [fallbackTo] : [],
      cc: [],
      subject: '',
      body: '',
    };
  }

  const sender = String(message.sender_email || message.from || '')
    .toLowerCase()
    .trim();
  const recipients = parseEmailAddressList(message.recipient_list || message.to || '');
  const outgoing =
    message.direction === 'outgoing' || isInternalMailboxAddress(sender);

  if (mode === 'forward') {
    return {
      to: [],
      cc: [],
      subject: withFwdSubject(message.subject),
      body: buildForwardBody(message),
    };
  }

  // Reply / Reply all
  let to: string[] = [];
  if (outgoing) {
    // Replying to our own sent mail → original external recipients
    to = recipients.filter((e) => e !== userEmail && !isInternalMailboxAddress(e));
    if (to.length === 0 && fallbackTo) to = [fallbackTo];
  } else if (sender && sender !== userEmail && !isInternalMailboxAddress(sender)) {
    to = [sender];
  } else if (fallbackTo) {
    to = [fallbackTo];
  }

  let cc: string[] = [];
  if (mode === 'reply_all') {
    const pool = [...recipients];
    if (sender) pool.push(sender);
    cc = pool.filter(
      (e) =>
        e &&
        e !== userEmail &&
        !isInternalMailboxAddress(e) &&
        !to.includes(e),
    );
    // Deduplicate
    cc = Array.from(new Set(cc));
  }

  return {
    to: Array.from(new Set(to)),
    cc,
    subject: withReSubject(message.subject),
    body: '',
  };
}

export function resolveEmailDeleteFilter(message: ComposeSourceMessage & { db_id?: string | number }): {
  by: 'id' | 'message_id';
  value: string;
} | null {
  if (message.db_id != null && String(message.db_id).trim() !== '') {
    return { by: 'id', value: String(message.db_id) };
  }
  const rawId = String(message.id || '').trim();
  const messageId = String(message.message_id || '').trim();
  const uuidRe =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (rawId && uuidRe.test(rawId)) return { by: 'id', value: rawId };
  if (messageId && messageId !== rawId) return { by: 'message_id', value: messageId };
  if (rawId && !rawId.startsWith('local-') && !rawId.startsWith('email_')) {
    return { by: 'message_id', value: rawId };
  }
  if (rawId.startsWith('email_')) {
    const numeric = rawId.replace(/^email_/, '');
    if (/^\d+$/.test(numeric)) return { by: 'id', value: numeric };
  }
  return null;
}
