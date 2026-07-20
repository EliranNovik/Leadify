/**
 * Send client portal access code to lead contacts via WhatsApp + email templates.
 * English: WhatsApp 50, email 192. Hebrew: WhatsApp 49, email 193.
 */
import { supabase } from './supabase';
import { buildApiUrl } from './api';
import { fetchLeadContacts, type ContactInfo } from './contactHelpers';
import { getMailboxStatus, sendEmailViaBackend } from './mailboxApi';
import {
  generateParamsFromDefinitions,
  getTemplateParamDefinitions,
  type ProformaWhatsAppParamContext,
} from './whatsappTemplateParamMapping';
import {
  normalizePhoneForWhatsApp,
  pickWhatsAppPhoneFromContactFields,
  toWhatsAppApiLanguageCode,
} from './whatsappPhone';
import { replaceEmailTemplateParams } from './emailTemplateParams';

export type PortalSendCodeLanguage = 'en' | 'he';

/** English defaults */
export const PORTAL_ACCESS_WHATSAPP_TEMPLATE_ID_EN = 50;
export const PORTAL_ACCESS_EMAIL_TEMPLATE_ID_EN = 192;
/** Hebrew */
export const PORTAL_ACCESS_WHATSAPP_TEMPLATE_ID_HE = 49;
export const PORTAL_ACCESS_EMAIL_TEMPLATE_ID_HE = 193;

/** @deprecated Prefer language-specific helpers */
export const PORTAL_ACCESS_WHATSAPP_TEMPLATE_ID = PORTAL_ACCESS_WHATSAPP_TEMPLATE_ID_EN;
/** @deprecated Prefer language-specific helpers */
export const PORTAL_ACCESS_EMAIL_TEMPLATE_ID = PORTAL_ACCESS_EMAIL_TEMPLATE_ID_EN;

export function getPortalAccessWhatsAppTemplateId(
  language: PortalSendCodeLanguage = 'en',
): number {
  return language === 'he'
    ? PORTAL_ACCESS_WHATSAPP_TEMPLATE_ID_HE
    : PORTAL_ACCESS_WHATSAPP_TEMPLATE_ID_EN;
}

export function getPortalAccessEmailTemplateId(
  language: PortalSendCodeLanguage = 'en',
): number {
  return language === 'he'
    ? PORTAL_ACCESS_EMAIL_TEMPLATE_ID_HE
    : PORTAL_ACCESS_EMAIL_TEMPLATE_ID_EN;
}

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type PortalSendCodeContact = Pick<
  ContactInfo,
  'id' | 'name' | 'email' | 'phone' | 'mobile'
>;

export type PortalSendCodeInput = {
  leadId: string;
  isLegacyLead: boolean;
  leadNumber?: string | null;
  portalLink: string;
  accessCode: string;
  contacts: PortalSendCodeContact[];
  language?: PortalSendCodeLanguage;
};

export type PortalSendCodeChannelResult = {
  contactId: number;
  contactName: string;
  channel: 'whatsapp' | 'email';
  ok: boolean;
  skipped?: boolean;
  error?: string;
};

export type PortalSendCodeResult = {
  results: PortalSendCodeChannelResult[];
  whatsappSent: number;
  emailSent: number;
  failed: number;
  skipped: number;
};

type WhatsAppTemplateRow = {
  id: number;
  name: string;
  language: string | null;
  content: string | null;
  params: number | string | null;
};

function formatWhatsAppSendError(result: Record<string, unknown>, fallback: string): string {
  const parts: string[] = [];
  if (typeof result.error === 'string' && result.error.trim()) {
    parts.push(result.error);
  }
  if (typeof result.details === 'string' && result.details.trim()) {
    parts.push(result.details);
  } else if (result.details && typeof result.details === 'object') {
    const nested = result.details as { error?: { message?: string }; details?: string };
    if (typeof nested.details === 'string' && nested.details.trim()) {
      parts.push(nested.details);
    } else if (nested.error?.message) {
      parts.push(nested.error.message);
    }
  }
  if (typeof result.code === 'string' || typeof result.code === 'number') {
    parts.push(`(code ${result.code})`);
  }
  return parts.length > 0 ? parts.join(' ') : fallback;
}

/** Suffix for Meta URL button (`…/portal/{{1}}`) — lead ref, percent-encoded when needed. */
export function getPortalUrlButtonSuffix(portalLink: string): string {
  const raw = String(portalLink || '').trim();
  if (!raw) return '';
  const marker = '/portal/';
  const idx = raw.toLowerCase().indexOf(marker);
  if (idx >= 0) {
    return raw.slice(idx + marker.length).split(/[?#]/)[0];
  }
  try {
    const u = new URL(raw);
    const pathIdx = u.pathname.toLowerCase().indexOf(marker);
    if (pathIdx >= 0) {
      return u.pathname.slice(pathIdx + marker.length).replace(/^\/+/, '');
    }
  } catch {
    /* ignore */
  }
  return '';
}

async function resolveSenderName(): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return 'Staff';

  const { data: userRow } = await supabase
    .from('users')
    .select('full_name, email, employee_id')
    .eq('auth_id', user.id)
    .maybeSingle();

  let displayName = (userRow?.full_name as string)?.trim() || '';
  if (!displayName && userRow?.employee_id) {
    const { data: emp } = await supabase
      .from('tenants_employee')
      .select('display_name')
      .eq('id', userRow.employee_id)
      .maybeSingle();
    displayName = emp?.display_name?.trim() || '';
  }

  return displayName || user.email || 'Staff';
}

function normalizeLeadIdForApi(leadId: string, isLegacyLead: boolean): string | number {
  const raw = String(leadId || '').replace(/^legacy_/, '');
  if (isLegacyLead) {
    const n = Number(raw);
    return Number.isFinite(n) ? `legacy_${n}` : `legacy_${raw}`;
  }
  return raw;
}

function buildClientForParams(input: PortalSendCodeInput, contactName: string) {
  const raw = String(input.leadId || '').replace(/^legacy_/, '');
  return {
    id: input.isLegacyLead ? `legacy_${raw}` : raw,
    lead_type: input.isLegacyLead ? 'legacy' : 'new',
    name: contactName,
    lead_id: raw,
    lead_number: input.leadNumber || '',
    portalLink: input.portalLink,
    accessCode: input.accessCode,
  };
}

async function fetchWhatsAppTemplate(templateId: number): Promise<WhatsAppTemplateRow> {
  const { data, error } = await supabase
    .from('whatsapp_templates_v2')
    .select('id, name, language, content, params, active')
    .eq('id', templateId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load WhatsApp template ${templateId}: ${error.message}`);
  }
  if (!data) {
    throw new Error(`WhatsApp template id ${templateId} was not found.`);
  }
  if (!data.active) {
    throw new Error(`WhatsApp template id ${templateId} ("${data.name}") is not active.`);
  }
  return data as WhatsAppTemplateRow;
}

async function fetchEmailTemplate(templateId: number): Promise<{ name: string; content: string }> {
  const { data, error } = await supabase
    .from('misc_emailtemplate')
    .select('name, content')
    .eq('id', templateId)
    .single();

  if (error || !data) {
    throw new Error(`Email template (${templateId}) was not found.`);
  }

  let content = String(data.content || '');
  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === 'object' && typeof parsed.content === 'string') {
      content = parsed.content;
    } else if (typeof parsed === 'string') {
      content = parsed;
    }
  } catch {
    // plain HTML / text
  }

  return {
    name: (data.name as string) || 'Client portal access',
    content,
  };
}

function containsRTL(text?: string | null): boolean {
  if (!text) return false;
  return /[\u0590-\u05FF\u0600-\u06FF\u0700-\u074F]/.test(text);
}

function formatEmailHtml(plainBody: string): string {
  if (!plainBody) return '';
  let htmlBody = plainBody;
  const hasHtmlTags = /<[a-z][\s\S]*>/i.test(htmlBody);
  if (!hasHtmlTags) {
    htmlBody = htmlBody.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '<br>');
  }
  const isRTL = containsRTL(htmlBody);
  if (isRTL) {
    return `<div dir="rtl" style="text-align: right; direction: rtl; font-family: 'Segoe UI', Arial, sans-serif;">${htmlBody}</div>`;
  }
  return `<div dir="ltr" style="text-align: left; direction: ltr; font-family: 'Segoe UI', Arial, sans-serif;">${htmlBody}</div>`;
}

function resolveContactPhone(contact: PortalSendCodeContact): string | null {
  const raw = pickWhatsAppPhoneFromContactFields(contact.phone, contact.mobile);
  if (!raw) return null;
  return normalizePhoneForWhatsApp(raw);
}

function resolveContactEmail(contact: PortalSendCodeContact): string | null {
  const email = contact.email?.trim();
  if (email && emailRegex.test(email)) return email;
  return null;
}

async function sendPortalWhatsApp(
  input: PortalSendCodeInput,
  contact: PortalSendCodeContact,
  template: WhatsAppTemplateRow,
  senderName: string,
): Promise<PortalSendCodeChannelResult> {
  const base = {
    contactId: contact.id,
    contactName: contact.name || 'Contact',
    channel: 'whatsapp' as const,
  };

  const phoneNumber = resolveContactPhone(contact);
  if (!phoneNumber) {
    return { ...base, ok: false, skipped: true, error: 'No phone number' };
  }

  const portalContext: ProformaWhatsAppParamContext = {
    portalLink: input.portalLink,
    accessCode: input.accessCode,
    leadNumber: input.leadNumber || '',
  };
  const clientForParams = buildClientForParams(input, contact.name || 'Client');
  const paramCount = Number(template.params) || 0;
  let templateParameters: Array<{ type: string; text: string }> = [];

  if (paramCount > 0) {
    const paramDefinitions = await getTemplateParamDefinitions(template.id, template.name);
    if (paramDefinitions.length === 0) {
      throw new Error(
        `WhatsApp template "${template.name}" (id ${template.id}) has no saved param_mapping. ` +
          `Map parameters in Admin (include Access Code / Portal Link as needed), then Save.`,
      );
    }
    if (paramDefinitions.length !== paramCount) {
      throw new Error(
        `param_mapping has ${paramDefinitions.length} entries but template "${template.name}" requires ${paramCount}.`,
      );
    }
    templateParameters = await generateParamsFromDefinitions(
      paramDefinitions,
      clientForParams,
      contact.id,
      portalContext,
    );
    while (templateParameters.length < paramCount) {
      templateParameters.push({ type: 'text', text: '' });
    }
    templateParameters = templateParameters.map((param) => ({
      type: 'text',
      text: (param.text || '').trim(),
    }));
  }

  let filledContent = template.content || '';
  if (templateParameters.length > 0) {
    templateParameters.forEach((param, index) => {
      if (param?.text) {
        filledContent = filledContent.replace(
          new RegExp(`\\{\\{${index + 1}\\}\\}`, 'g'),
          param.text,
        );
      }
    });
  }

  const messagePayload: Record<string, unknown> = {
    leadId: normalizeLeadIdForApi(input.leadId, input.isLegacyLead),
    phoneNumber,
    sender_name: senderName,
    isTemplate: true,
    templateId: Number(template.id),
    templateName: template.name,
    templateLanguage: toWhatsAppApiLanguageCode(template.language || 'en'),
    contactId: contact.id,
  };

  if (paramCount > 0) {
    messagePayload.templateParameters = templateParameters;
    messagePayload.message = filledContent || 'Template sent';
  } else {
    messagePayload.message = template.content || 'Client portal access';
  }

  // Meta `client_portal` templates usually have a dynamic URL button (/portal/{{1}})
  // that is separate from body params (access code). Body-only payloads return 400.
  const portalPathSuffix = getPortalUrlButtonSuffix(input.portalLink);
  if (portalPathSuffix) {
    messagePayload.templateButtonParameters = [
      {
        type: 'text',
        text: portalPathSuffix,
        index: '0',
        sub_type: 'url',
      },
    ];
  }

  const response = await fetch(buildApiUrl('/api/whatsapp/send-message'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(messagePayload),
  });
  const result = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  const isDbSaveError =
    !response.ok &&
    result?.error &&
    (String(result.error).includes('save') || String(result.error).includes('Failed to save message'));

  if (isDbSaveError) {
    return { ...base, ok: true };
  }

  if (!response.ok) {
    if (result?.code === 'RE_ENGAGEMENT_REQUIRED') {
      return {
        ...base,
        ok: false,
        error: 'WhatsApp 24-hour rule: use a template message after 24 hours of client inactivity.',
      };
    }
    return {
      ...base,
      ok: false,
      error: formatWhatsAppSendError(result, 'Failed to send WhatsApp.'),
    };
  }

  return { ...base, ok: true };
}

async function sendPortalEmail(
  input: PortalSendCodeInput,
  contact: PortalSendCodeContact,
  template: { name: string; content: string },
  userId: string,
): Promise<PortalSendCodeChannelResult> {
  const base = {
    contactId: contact.id,
    contactName: contact.name || 'Contact',
    channel: 'email' as const,
  };

  const to = resolveContactEmail(contact);
  if (!to) {
    return { ...base, ok: false, skipped: true, error: 'No email address' };
  }

  const rawLeadId = String(input.leadId || '').replace(/^legacy_/, '');
  const plainBody = await replaceEmailTemplateParams(template.content, {
    clientId: input.isLegacyLead ? null : rawLeadId,
    legacyId: input.isLegacyLead && !Number.isNaN(Number(rawLeadId)) ? Number(rawLeadId) : null,
    clientName: contact.name || 'Client',
    contactName: contact.name || 'Client',
    leadNumber: input.leadNumber || '',
    leadType: input.isLegacyLead ? 'legacy' : 'new',
    portalLink: input.portalLink,
    accessCode: input.accessCode,
  });

  const bodyHtml = formatEmailHtml(plainBody);
  const subject =
    (await replaceEmailTemplateParams(template.name, {
      clientName: contact.name || 'Client',
      contactName: contact.name || 'Client',
      leadNumber: input.leadNumber || '',
      portalLink: input.portalLink,
      accessCode: input.accessCode,
    })) || 'Client portal access';

  await sendEmailViaBackend({
    userId,
    subject,
    bodyHtml,
    bodyContentType: 'HTML',
    to: [to],
    context: {
      clientId: input.isLegacyLead ? null : rawLeadId,
      legacyLeadId:
        input.isLegacyLead && !Number.isNaN(Number(rawLeadId)) ? Number(rawLeadId) : null,
      leadType: input.isLegacyLead ? 'legacy' : 'new',
      leadNumber: input.leadNumber || null,
      contactEmail: to,
      contactName: contact.name || null,
      contactId: contact.id,
    },
  });

  return { ...base, ok: true };
}

export async function loadPortalSendContacts(
  leadId: string,
  isLegacyLead: boolean,
): Promise<ContactInfo[]> {
  return fetchLeadContacts(leadId, isLegacyLead);
}

export async function sendPortalAccessCode(
  input: PortalSendCodeInput,
): Promise<PortalSendCodeResult> {
  const accessCode = input.accessCode?.trim();
  if (!accessCode) {
    throw new Error('Set and save a portal password before sending the access code.');
  }
  if (!input.portalLink?.trim()) {
    throw new Error('Portal link is missing for this lead.');
  }
  if (!input.contacts.length) {
    throw new Error('Select at least one contact.');
  }

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user?.id) {
    throw new Error('You must be signed in to send portal access.');
  }

  const contactsWithEmail = input.contacts.filter((c) => resolveContactEmail(c));
  if (contactsWithEmail.length > 0) {
    const mailbox = await getMailboxStatus(user.id);
    if (!mailbox?.connected) {
      const err = new Error('MAILBOX_NOT_CONNECTED');
      (err as Error & { code?: string }).code = 'MAILBOX_NOT_CONNECTED';
      throw err;
    }
  }

  const language = input.language ?? 'en';
  const whatsappTemplateId = getPortalAccessWhatsAppTemplateId(language);
  const emailTemplateId = getPortalAccessEmailTemplateId(language);

  const [waTemplate, emailTemplate, senderName] = await Promise.all([
    fetchWhatsAppTemplate(whatsappTemplateId),
    contactsWithEmail.length > 0
      ? fetchEmailTemplate(emailTemplateId)
      : Promise.resolve({ name: '', content: '' }),
    resolveSenderName(),
  ]);

  const results: PortalSendCodeChannelResult[] = [];

  for (const contact of input.contacts) {
    try {
      results.push(await sendPortalWhatsApp(input, contact, waTemplate, senderName));
    } catch (e) {
      results.push({
        contactId: contact.id,
        contactName: contact.name || 'Contact',
        channel: 'whatsapp',
        ok: false,
        error: e instanceof Error ? e.message : 'WhatsApp send failed',
      });
    }

    try {
      results.push(await sendPortalEmail(input, contact, emailTemplate, user.id));
    } catch (e) {
      results.push({
        contactId: contact.id,
        contactName: contact.name || 'Contact',
        channel: 'email',
        ok: false,
        error: e instanceof Error ? e.message : 'Email send failed',
      });
    }
  }

  return {
    results,
    whatsappSent: results.filter((r) => r.channel === 'whatsapp' && r.ok && !r.skipped).length,
    emailSent: results.filter((r) => r.channel === 'email' && r.ok && !r.skipped).length,
    failed: results.filter((r) => !r.ok && !r.skipped).length,
    skipped: results.filter((r) => r.skipped).length,
  };
}
