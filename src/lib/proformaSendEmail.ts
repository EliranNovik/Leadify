/**
 * Send proforma invoice to the linked contact via Outlook (Microsoft Graph backend).
 * Uses misc_emailtemplate id 180 with {{link}}, {{payment_link}}, {{lead_number}}, {{client_name}}.
 */
import { supabase } from './supabase';
import {
  buildPublicProformaUrl,
  ensureLegacyProformaPublicToken,
  ensureNewProformaPublicToken,
  type ProformaLinkKind,
} from './proformaPublicLink';
import { resolveProformaPaymentLinkUrl } from './proformaPaymentLink';
import { getMailboxStatus, sendEmailViaBackend } from './mailboxApi';
import {
  getProformaEmailTemplateId,
  getProformaInvoiceLinkLabel,
  getProformaPaymentLinkLabel,
  PROFORMA_EMAIL_TEMPLATE_ID_EN,
  type ProformaSendLanguage,
} from './proformaSendLanguage';

/** @deprecated Use PROFORMA_EMAIL_TEMPLATE_ID_EN */
export const PROFORMA_EMAIL_TEMPLATE_ID = PROFORMA_EMAIL_TEMPLATE_ID_EN;

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ProformaSendEmailInput = {
  kind: ProformaLinkKind;
  recordId: string | number;
  /** Payment plan row id (payment_plans.id or finances_paymentplanrow.id) for {{payment_link}} */
  paymentPlanId?: string | number | null;
  contactId?: string | number | null;
  contactEmail?: string | null;
  /** Phone shown on the proforma (used for WhatsApp when contact DB lookup differs). */
  contactPhone?: string | null;
  clientName: string;
  leadNumber: string;
  leadId?: string | number | null;
  isLegacyLead?: boolean;
  /** English: template 180. Hebrew: template 179. */
  language?: ProformaSendLanguage;
};

const parseTemplateContent = (rawContent: string | null | undefined): string => {
  if (!rawContent) return '';

  const sanitizeTemplateText = (text: string) =>
    text
      .split('\n')
      .map((line) => line.replace(/\s+$/g, ''))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+\n/g, '\n')
      .trim();

  const tryParseDelta = (input: string) => {
    try {
      const parsed = JSON.parse(input);
      const ops = parsed?.delta?.ops || parsed?.ops;
      if (Array.isArray(ops)) {
        const text = ops
          .map((op: { insert?: string }) => (typeof op?.insert === 'string' ? op.insert : ''))
          .join('');
        return sanitizeTemplateText(text);
      }
    } catch {
      // ignore
    }
    return null;
  };

  const cleanHtml = (input: string) => {
    let text = input;
    const htmlMatch = text.match(/html\s*:\s*(.*)/is);
    if (htmlMatch) text = htmlMatch[1];
    text = text
      .replace(/^{?delta\s*:\s*\{.*?\},?/is, '')
      .replace(/^{|}$/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\r/g, '');
    return sanitizeTemplateText(text);
  };

  let text = tryParseDelta(rawContent);
  if (text !== null) return text;

  text = tryParseDelta(
    rawContent
      .replace(/^"|"$/g, '')
      .replace(/\\"/g, '"')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t'),
  );
  if (text !== null) return text;

  const normalised = rawContent
    .replace(/\\"/g, '"')
    .replace(/\r/g, '')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t');
  const insertRegex = /"?insert"?\s*:\s*"([^"\n]*)"/g;
  const inserts: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = insertRegex.exec(normalised))) {
    inserts.push(match[1]);
  }
  if (inserts.length > 0) {
    return sanitizeTemplateText(inserts.join('').replace(/\\n/g, '\n').replace(/\\t/g, '\t'));
  }

  return sanitizeTemplateText(cleanHtml(rawContent));
};

const containsRTL = (text?: string | null): boolean => {
  if (!text) return false;
  return /[\u0590-\u05FF\u0600-\u06FF\u0700-\u074F]/.test(text);
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatProformaEmailHtml(plainBody: string): string {
  if (!plainBody) return '';

  let htmlBody = plainBody;
  const hasHtmlTags = /<[a-z][\s\S]*>/i.test(htmlBody);

  if (!hasHtmlTags) {
    htmlBody = htmlBody.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '<br>');
  } else {
    htmlBody = htmlBody
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/(<br\s*\/?>|\n)/gi, '<br>')
      .replace(/\n/g, '<br>');
  }

  const isRTL = containsRTL(htmlBody);
  if (isRTL) {
    return `<div dir="rtl" style="text-align: right; direction: rtl; font-family: 'Segoe UI', Arial, 'Helvetica Neue', sans-serif;">${htmlBody}</div>`;
  }
  return `<div dir="ltr" style="text-align: left; direction: ltr; font-family: 'Segoe UI', Arial, 'Helvetica Neue', sans-serif;">${htmlBody}</div>`;
}

/** Remove any leftover {placeholder} / {{placeholder}} tokens from the final email text. */
function stripRemainingBraces(text: string): string {
  return text
    .replace(/\{\{\s*[a-z_]+\s*\}\}/gi, '')
    .replace(/\{\s*[a-z_]+\s*\}/gi, '')
    .replace(/\{\{|\}\}/g, '')
    .replace(/\{|\}/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function applyProformaPlaceholders(
  content: string,
  vars: { publicUrl: string; paymentLinkUrl: string; leadNumber: string; clientName: string },
  options?: { includeLeadAndClient?: boolean; language?: ProformaSendLanguage },
): string {
  const language = options?.language ?? 'en';
  const linkLabel = getProformaInvoiceLinkLabel(language);
  const linkHtml = vars.publicUrl
    ? `<a href="${escapeHtml(vars.publicUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(linkLabel)}</a>`
    : '';

  const linkValue = linkHtml || linkLabel;

  const paymentLinkLabel = getProformaPaymentLinkLabel(language);
  const paymentLinkHtml = vars.paymentLinkUrl
    ? `<a href="${escapeHtml(vars.paymentLinkUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(paymentLinkLabel)}</a>`
    : '';
  const paymentLinkValue = paymentLinkHtml || paymentLinkLabel;

  const includeLeadAndClient = options?.includeLeadAndClient !== false;

  let result = content
    .replace(/\{\{\s*link\s*\}\}/gi, linkValue)
    .replace(/\{\s*link\s*\}/gi, linkValue)
    .replace(/\{\{\s*payment_link\s*\}\}/gi, paymentLinkValue)
    .replace(/\{\s*payment_link\s*\}/gi, paymentLinkValue);

  if (includeLeadAndClient) {
    result = result
      .replace(/\{\{\s*lead_number\s*\}\}/gi, vars.leadNumber)
      .replace(/\{\{\s*client_name\s*\}\}/gi, vars.clientName)
      .replace(/\{\s*lead_number\s*\}/gi, vars.leadNumber)
      .replace(/\{\s*client_name\s*\}/gi, vars.clientName);
  } else {
    result = result
      .replace(/\{\{\s*lead_number\s*\}\}/gi, '')
      .replace(/\{\{\s*client_name\s*\}\}/gi, '')
      .replace(/\{\s*lead_number\s*\}/gi, '')
      .replace(/\{\s*client_name\s*\}/gi, '');
  }

  return stripRemainingBraces(result);
}

function buildProformaEmailSubject(
  templateName: string,
  vars: { publicUrl: string; leadNumber: string; clientName: string },
  language: ProformaSendLanguage = 'en',
): string {
  const base =
    applyProformaPlaceholders(templateName, vars, { includeLeadAndClient: false, language }).trim() ||
    'Invoice';
  return [base, vars.leadNumber, vars.clientName].filter((part) => part.length > 0).join(' — ');
}

/** Resolve a valid invoice email, or null when none is available. */
export async function resolveProformaContactEmail(
  contactId: string | number | null | undefined,
  fallbackEmail?: string | null,
): Promise<string | null> {
  const trimmed = fallbackEmail?.trim();
  if (trimmed && emailRegex.test(trimmed)) return trimmed;

  if (contactId == null || contactId === '') {
    return null;
  }

  const { data: newContact } = await supabase
    .from('contacts')
    .select('email')
    .eq('id', contactId)
    .maybeSingle();

  const newEmail = newContact?.email?.trim();
  if (newEmail && emailRegex.test(newEmail)) return newEmail;

  const { data: legacyContact } = await supabase
    .from('leads_contact')
    .select('email')
    .eq('id', contactId)
    .maybeSingle();

  const legacyEmail = legacyContact?.email?.trim();
  if (legacyEmail && emailRegex.test(legacyEmail)) return legacyEmail;

  return null;
}

async function resolveContactEmail(
  contactId: string | number | null | undefined,
  fallbackEmail?: string | null,
): Promise<string> {
  const email = await resolveProformaContactEmail(contactId, fallbackEmail);
  if (email) return email;
  throw new Error('No valid email address found for the proforma contact.');
}

async function fetchProformaEmailTemplate(
  templateId: number,
): Promise<{ name: string; content: string }> {
  const { data, error } = await supabase
    .from('misc_emailtemplate')
    .select('name, content')
    .eq('id', templateId)
    .single();

  if (error || !data) {
    throw new Error(`Invoice email template (${templateId}) was not found.`);
  }

  return {
    name: (data.name as string) || 'Invoice',
    content: parseTemplateContent(data.content as string),
  };
}

export async function sendProformaInvoiceEmail(input: ProformaSendEmailInput): Promise<void> {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user?.id) {
    throw new Error('You must be signed in to send emails.');
  }

  const mailbox = await getMailboxStatus(user.id);
  if (!mailbox?.connected) {
    const err = new Error('MAILBOX_NOT_CONNECTED');
    (err as Error & { code?: string }).code = 'MAILBOX_NOT_CONNECTED';
    throw err;
  }

  const to = await resolveContactEmail(input.contactId, input.contactEmail);
  const token =
    input.kind === 'legacy'
      ? await ensureLegacyProformaPublicToken(input.recordId)
      : await ensureNewProformaPublicToken(input.recordId);
  const publicUrl = buildPublicProformaUrl(input.kind, input.recordId, token);

  const paymentPlanId =
    input.paymentPlanId ??
    (input.kind === 'new' ? input.recordId : null);
  const paymentLinkUrl =
    (await resolveProformaPaymentLinkUrl({
      paymentPlanId,
      leadClientId: input.leadId,
    })) || '';

  const language = input.language ?? 'en';
  const emailTemplateId = getProformaEmailTemplateId(language);
  const template = await fetchProformaEmailTemplate(emailTemplateId);
  const vars = {
    publicUrl,
    paymentLinkUrl,
    leadNumber: input.leadNumber,
    clientName: input.clientName,
  };

  const plainBody = applyProformaPlaceholders(template.content, vars, { language });
  const bodyHtml = formatProformaEmailHtml(plainBody);
  const subject = buildProformaEmailSubject(template.name, vars, language);

  const contactIdNum =
    input.contactId != null && input.contactId !== '' && !Number.isNaN(Number(input.contactId))
      ? Number(input.contactId)
      : null;

  await sendEmailViaBackend({
    userId: user.id,
    subject,
    bodyHtml,
    bodyContentType: 'HTML',
    to: [to],
    context: {
      clientId: input.isLegacyLead ? null : input.leadId ?? null,
      legacyLeadId:
        input.isLegacyLead && input.leadId != null && !Number.isNaN(Number(input.leadId))
          ? Number(input.leadId)
          : null,
      leadType: input.isLegacyLead ? 'legacy' : 'new',
      leadNumber: input.leadNumber,
      contactEmail: to,
      contactName: input.clientName,
      contactId: contactIdNum,
    },
  });
}
