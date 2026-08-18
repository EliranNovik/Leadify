/**
 * Send a digital contract signing link via existing WhatsApp (whatsapp_templates_v2)
 * and email (misc_emailtemplate) templates, using the same backends as portal / proforma.
 *
 * Template IDs: VITE_CONTRACT_WHATSAPP_TEMPLATE_ID_EN / _HE and
 * VITE_CONTRACT_EMAIL_TEMPLATE_ID_EN / _HE, or the first active template whose
 * name contains contract / agreement / חוזה / הסכם.
 *
 * Map WhatsApp params in Admin: Name, Lead #, Contract signing link.
 * Email placeholders: {{contract_link}} / {{link}}, {{client_name}}, {{lead_number}}.
 */
import { v4 as uuidv4 } from 'uuid';
import { supabase } from './supabase';
import { buildApiUrl, getFrontendBaseUrl } from './api';
import { fetchLeadContacts, type ContactInfo } from './contactHelpers';
import { getMailboxStatus, sendEmailViaBackend } from './mailboxApi';
import { convertBodyToHtml } from './emailBodyHtml';
import { buildOutgoingHtmlWithSignature } from './emailSignature';
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
import { buildEmployeeContractPublicUrl } from './employeeDigitalContracts';
import { buildFirmContractPublicUrl } from './firmDigitalContracts';
import { buildRecruitmentContractPublicUrl } from './recruitmentDigitalContracts';

export type ContractSendLanguage = 'en' | 'he';
export type ContractSendChannel = 'whatsapp' | 'email';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TEMPLATE_NAME_RE = /contract|agreement|sign.?ing|חוזה|הסכם/i;

export type ContractSendRecipient = {
  id?: number | null;
  name?: string;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
};

export type ContractSendInput = {
  contractId: string;
  publicUrl: string;
  language: ContractSendLanguage;
  channels: ContractSendChannel[];
  recipients: ContractSendRecipient[];
  clientName: string;
  leadNumber?: string | null;
  leadId?: string | number | null;
  isLegacyLead?: boolean;
};

export type ContractSendChannelResult = {
  recipient: string;
  channel: ContractSendChannel;
  ok: boolean;
  skipped?: boolean;
  error?: string;
};

export type ContractSendResult = {
  results: ContractSendChannelResult[];
  whatsappTemplateName?: string;
  emailTemplateName?: string;
};

type WhatsAppTemplateRow = {
  id: number;
  name: string;
  language: string | null;
  content: string | null;
  params: number | string | null;
};

function envPositiveInt(name: string): number | null {
  const n = Number(import.meta.env[name] || '');
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function getContractWhatsAppTemplateId(language: ContractSendLanguage): number | null {
  return language === 'he'
    ? envPositiveInt('VITE_CONTRACT_WHATSAPP_TEMPLATE_ID_HE')
    : envPositiveInt('VITE_CONTRACT_WHATSAPP_TEMPLATE_ID_EN') ||
        envPositiveInt('VITE_CONTRACT_WHATSAPP_TEMPLATE_ID');
}

export function getContractEmailTemplateId(language: ContractSendLanguage): number | null {
  return language === 'he'
    ? envPositiveInt('VITE_CONTRACT_EMAIL_TEMPLATE_ID_HE')
    : envPositiveInt('VITE_CONTRACT_EMAIL_TEMPLATE_ID_EN') ||
        envPositiveInt('VITE_CONTRACT_EMAIL_TEMPLATE_ID');
}

export async function ensureContractPublicUrl(opts: {
  contractId: string;
  publicToken?: string | null;
  mode?: 'client' | 'employee' | 'firm' | 'recruitment';
}): Promise<{ publicToken: string; publicUrl: string }> {
  let publicToken = opts.publicToken || '';
  if (!publicToken) {
    publicToken = uuidv4();
    const { error } = await supabase
      .from('contracts')
      .update({ public_token: publicToken })
      .eq('id', opts.contractId);
    if (error) throw new Error(error.message || 'Failed to create public contract link');
  }

  const mode = opts.mode || 'client';
  const publicUrl =
    mode === 'recruitment'
      ? buildRecruitmentContractPublicUrl(opts.contractId, publicToken)
      : mode === 'employee'
        ? buildEmployeeContractPublicUrl(opts.contractId, publicToken)
        : mode === 'firm'
          ? buildFirmContractPublicUrl(opts.contractId, publicToken)
          : `${getFrontendBaseUrl()}/public-contract/${opts.contractId}/${publicToken}`;

  return { publicToken, publicUrl };
}

/** Meta URL-button suffix after `/public-*-contract/`. */
export function getContractUrlButtonSuffix(publicUrl: string): string {
  const raw = String(publicUrl || '').trim();
  if (!raw) return '';
  const markers = [
    '/public-contract/',
    '/public-hr-contract/',
    '/public-firm-contract/',
    '/public-recruitment-contract/',
  ];
  const lower = raw.toLowerCase();
  for (const marker of markers) {
    const idx = lower.indexOf(marker);
    if (idx >= 0) return raw.slice(idx + marker.length).split(/[?#]/)[0];
  }
  try {
    const u = new URL(raw);
    return u.pathname.replace(/^\/+/, '');
  } catch {
    return '';
  }
}

function langPrefix(language: ContractSendLanguage): string {
  return language === 'he' ? 'he' : 'en';
}

async function resolveWhatsAppTemplate(language: ContractSendLanguage): Promise<WhatsAppTemplateRow> {
  const forcedId = getContractWhatsAppTemplateId(language);
  if (forcedId) {
    const { data, error } = await supabase
      .from('whatsapp_templates_v2')
      .select('id, name, language, content, params, active')
      .eq('id', forcedId)
      .maybeSingle();
    if (error) throw new Error(`Failed to load WhatsApp template ${forcedId}: ${error.message}`);
    if (!data) throw new Error(`WhatsApp template id ${forcedId} was not found.`);
    if (!data.active) {
      throw new Error(`WhatsApp template id ${forcedId} ("${data.name}") is not active.`);
    }
    return data as WhatsAppTemplateRow;
  }

  const { data, error } = await supabase
    .from('whatsapp_templates_v2')
    .select('id, name, language, content, params, active')
    .eq('active', true);
  if (error) throw new Error(`Failed to list WhatsApp templates: ${error.message}`);

  const prefix = langPrefix(language);
  const match = (data || []).find((row) => {
    const lang = String(row.language || '').toLowerCase();
    const name = String(row.name || '');
    return lang.startsWith(prefix) && TEMPLATE_NAME_RE.test(name);
  });
  if (!match) {
    throw new Error(
      `No WhatsApp contract template found for ${language === 'he' ? 'Hebrew' : 'English'}. ` +
        `Name a template with “contract” (or set VITE_CONTRACT_WHATSAPP_TEMPLATE_ID_${language.toUpperCase()}).`,
    );
  }
  return match as WhatsAppTemplateRow;
}

async function resolveEmailTemplate(
  language: ContractSendLanguage,
): Promise<{ id: number; name: string; content: string }> {
  const forcedId = getContractEmailTemplateId(language);
  if (forcedId) {
    return fetchEmailTemplateById(forcedId);
  }

  const { data: langs } = await supabase.from('misc_language').select('id, name');
  const want = language === 'he' ? /hebrew|^he/i : /english|^en/i;
  const languageId = (langs || []).find((row) => want.test(String(row.name || '')))?.id ?? null;

  let query = supabase.from('misc_emailtemplate').select('id, name, content, language_id, active');
  if (languageId != null) query = query.eq('language_id', languageId);

  const { data, error } = await query;
  if (error) throw new Error(`Failed to list email templates: ${error.message}`);

  const rows = (data || []).filter((row) => {
    const active = row.active === true || row.active === 't' || row.active === 'true' || row.active == null;
    return active && TEMPLATE_NAME_RE.test(String(row.name || ''));
  });
  const match = rows[0];
  if (!match) {
    throw new Error(
      `No email contract template found for ${language === 'he' ? 'Hebrew' : 'English'}. ` +
        `Name a template with “contract” (or set VITE_CONTRACT_EMAIL_TEMPLATE_ID_${language.toUpperCase()}).`,
    );
  }
  return {
    id: Number(match.id),
    name: String(match.name || 'Contract'),
    content: unwrapEmailTemplateContent(String(match.content || '')),
  };
}

async function fetchEmailTemplateById(templateId: number): Promise<{ id: number; name: string; content: string }> {
  const { data, error } = await supabase
    .from('misc_emailtemplate')
    .select('id, name, content')
    .eq('id', templateId)
    .single();
  if (error || !data) {
    throw new Error(`Email template (${templateId}) was not found.`);
  }
  return {
    id: Number(data.id),
    name: (data.name as string) || 'Contract',
    content: unwrapEmailTemplateContent(String(data.content || '')),
  };
}

function unwrapEmailTemplateContent(raw: string): string {
  let content = raw;
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
  return content;
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

function normalizeLeadIdForApi(leadId: string | number | null | undefined, isLegacyLead: boolean): string | number | null {
  if (leadId == null || leadId === '') return null;
  const raw = String(leadId).replace(/^legacy_/, '');
  if (isLegacyLead) {
    const n = Number(raw);
    return Number.isFinite(n) ? `legacy_${n}` : `legacy_${raw}`;
  }
  return raw;
}

function resolvePhone(recipient: ContractSendRecipient): string | null {
  const raw = pickWhatsAppPhoneFromContactFields(recipient.phone, recipient.mobile);
  if (!raw) return null;
  const digits = normalizePhoneForWhatsApp(raw);
  return digits || null;
}

function resolveEmail(recipient: ContractSendRecipient): string | null {
  const email = recipient.email?.trim();
  if (email && EMAIL_RE.test(email)) return email;
  return null;
}

function formatWhatsAppSendError(result: Record<string, unknown>, fallback: string): string {
  const parts: string[] = [];
  if (typeof result.error === 'string' && result.error.trim()) parts.push(result.error);
  if (typeof result.details === 'string' && result.details.trim()) parts.push(result.details);
  return parts.join(' — ') || fallback;
}

async function sendContractWhatsApp(opts: {
  input: ContractSendInput;
  recipient: ContractSendRecipient;
  template: WhatsAppTemplateRow;
  senderName: string;
}): Promise<ContractSendChannelResult> {
  const phoneNumber = resolvePhone(opts.recipient);
  const label = opts.recipient.name || phoneNumber || 'Recipient';
  const base = { recipient: label, channel: 'whatsapp' as const };

  if (!phoneNumber) {
    return { ...base, ok: false, skipped: true, error: 'No phone number' };
  }

  const paramCount = Number(opts.template.params) || 0;
  const clientForParams = {
    id: opts.input.isLegacyLead
      ? `legacy_${String(opts.input.leadId || '').replace(/^legacy_/, '')}`
      : opts.input.leadId,
    lead_type: opts.input.isLegacyLead ? 'legacy' : 'new',
    name: opts.recipient.name || opts.input.clientName,
    lead_id: opts.input.leadId,
    lead_number: opts.input.leadNumber || '',
    contractLink: opts.input.publicUrl,
  };
  const proformaContext: ProformaWhatsAppParamContext = {
    contractLink: opts.input.publicUrl,
    invoiceLink: opts.input.publicUrl,
    leadNumber: opts.input.leadNumber || '',
  };

  let templateParameters: Array<{ type: string; text: string }> = [];
  let filledContent = opts.template.content || '';

  if (paramCount > 0) {
    const definitions = await getTemplateParamDefinitions(opts.template.id, opts.template.name);
    if (definitions.length === 0) {
      throw new Error(
        `WhatsApp template "${opts.template.name}" (id ${opts.template.id}) has no saved param_mapping. ` +
          `Edit it in Admin and map Name / Lead # / Contract signing link, then Save.`,
      );
    }
    if (definitions.length !== paramCount) {
      throw new Error(
        `param_mapping has ${definitions.length} entries but template "${opts.template.name}" requires ${paramCount}. ` +
          'Update all parameter slots in Admin and save.',
      );
    }
    templateParameters = await generateParamsFromDefinitions(
      definitions,
      clientForParams,
      opts.recipient.id && opts.recipient.id > 0 ? opts.recipient.id : null,
      proformaContext,
    );
    while (templateParameters.length < paramCount) {
      templateParameters.push({ type: 'text', text: '' });
    }
    templateParameters = templateParameters.map((param) => ({
      type: 'text',
      text: (param.text || '').trim(),
    }));
    templateParameters.forEach((param, index) => {
      if (param?.text) {
        filledContent = filledContent.replace(new RegExp(`\\{\\{${index + 1}\\}\\}`, 'g'), param.text);
      }
    });
  }

  const messagePayload: Record<string, unknown> = {
    leadId: normalizeLeadIdForApi(opts.input.leadId ?? null, Boolean(opts.input.isLegacyLead)),
    phoneNumber,
    sender_name: opts.senderName,
    isTemplate: true,
    templateId: Number(opts.template.id),
    templateName: opts.template.name,
    templateLanguage: toWhatsAppApiLanguageCode(opts.template.language || opts.input.language),
    contactId: opts.recipient.id && opts.recipient.id > 0 ? opts.recipient.id : null,
  };

  if (paramCount > 0) {
    messagePayload.templateParameters = templateParameters;
    messagePayload.message = filledContent || 'Contract signing link';
  } else {
    messagePayload.message = opts.template.content || opts.input.publicUrl;
  }

  const urlSuffix = getContractUrlButtonSuffix(opts.input.publicUrl);
  if (urlSuffix) {
    messagePayload.templateButtonParameters = [
      {
        type: 'text',
        text: urlSuffix,
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
  if (isDbSaveError) return { ...base, ok: true };

  if (!response.ok) {
    if (result?.code === 'RE_ENGAGEMENT_REQUIRED') {
      return {
        ...base,
        ok: false,
        error: 'WhatsApp 24-hour rule: this template could not be sent after 24 hours of inactivity.',
      };
    }
    return { ...base, ok: false, error: formatWhatsAppSendError(result, 'Failed to send WhatsApp') };
  }

  return { ...base, ok: true };
}

async function sendContractEmail(opts: {
  input: ContractSendInput;
  recipient: ContractSendRecipient;
  template: { name: string; content: string };
  userId: string;
}): Promise<ContractSendChannelResult> {
  const to = resolveEmail(opts.recipient);
  const label = opts.recipient.name || to || 'Recipient';
  const base = { recipient: label, channel: 'email' as const };
  if (!to) return { ...base, ok: false, skipped: true, error: 'No email address' };

  const rawLeadId = opts.input.leadId != null ? String(opts.input.leadId).replace(/^legacy_/, '') : '';
  const ctx = {
    clientId: opts.input.isLegacyLead ? null : rawLeadId || null,
    legacyId:
      opts.input.isLegacyLead && rawLeadId && !Number.isNaN(Number(rawLeadId))
        ? Number(rawLeadId)
        : null,
    clientName: opts.recipient.name || opts.input.clientName,
    contactName: opts.recipient.name || opts.input.clientName,
    leadNumber: opts.input.leadNumber || '',
    leadType: opts.input.isLegacyLead ? 'legacy' : 'new',
    contractLink: opts.input.publicUrl,
    templateLanguage: opts.input.language,
  };

  const plainBody = await replaceEmailTemplateParams(opts.template.content, ctx);
  const { html: bodyHtml, inlineAttachments } = await buildOutgoingHtmlWithSignature(
    convertBodyToHtml(plainBody),
  );
  const subject =
    (await replaceEmailTemplateParams(opts.template.name, ctx)) ||
    (opts.input.language === 'he' ? 'חוזה לחתימה' : 'Contract for signature');

  await sendEmailViaBackend({
    userId: opts.userId,
    subject,
    bodyHtml,
    bodyContentType: 'HTML',
    to: [to],
    attachments: inlineAttachments.length > 0 ? inlineAttachments : undefined,
    context: {
      clientId: opts.input.isLegacyLead ? null : rawLeadId || null,
      legacyLeadId:
        opts.input.isLegacyLead && rawLeadId && !Number.isNaN(Number(rawLeadId))
          ? Number(rawLeadId)
          : null,
      leadType: opts.input.isLegacyLead ? 'legacy' : 'new',
      leadNumber: opts.input.leadNumber || null,
      contactEmail: to,
      contactName: opts.recipient.name || null,
      contactId: opts.recipient.id && opts.recipient.id > 0 ? opts.recipient.id : null,
    },
  });

  return { ...base, ok: true };
}

export async function previewContractSendTemplates(language: ContractSendLanguage): Promise<{
  whatsappName: string | null;
  emailName: string | null;
  whatsappError: string | null;
  emailError: string | null;
}> {
  const [wa, email] = await Promise.allSettled([
    resolveWhatsAppTemplate(language),
    resolveEmailTemplate(language),
  ]);
  return {
    whatsappName: wa.status === 'fulfilled' ? wa.value.name : null,
    emailName: email.status === 'fulfilled' ? email.value.name : null,
    whatsappError:
      wa.status === 'rejected'
        ? wa.reason instanceof Error
          ? wa.reason.message
          : 'WhatsApp template not found'
        : null,
    emailError:
      email.status === 'rejected'
        ? email.reason instanceof Error
          ? email.reason.message
          : 'Email template not found'
        : null,
  };
}

export async function loadContractSendContacts(
  leadId: string | number,
  isLegacyLead: boolean,
): Promise<ContactInfo[]> {
  return fetchLeadContacts(leadId, isLegacyLead);
}

export async function sendContractViaTemplates(input: ContractSendInput): Promise<ContractSendResult> {
  if (!input.recipients.length) {
    throw new Error('Choose at least one recipient');
  }
  if (!input.channels.length) {
    throw new Error('Choose WhatsApp, email, or both');
  }

  const wantWhatsApp = input.channels.includes('whatsapp');
  const wantEmail = input.channels.includes('email');

  let userId: string | null = null;
  if (wantEmail) {
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user?.id) throw new Error('You must be signed in to send emails.');
    userId = user.id;
    const mailbox = await getMailboxStatus(userId);
    if (!mailbox?.connected) {
      const err = new Error('MAILBOX_NOT_CONNECTED');
      (err as Error & { code?: string }).code = 'MAILBOX_NOT_CONNECTED';
      throw err;
    }
  }

  const [whatsappTemplate, emailTemplate, senderName] = await Promise.all([
    wantWhatsApp ? resolveWhatsAppTemplate(input.language) : Promise.resolve(null),
    wantEmail ? resolveEmailTemplate(input.language) : Promise.resolve(null),
    wantWhatsApp ? resolveSenderName() : Promise.resolve('Staff'),
  ]);

  const results: ContractSendChannelResult[] = [];

  for (const recipient of input.recipients) {
    if (wantWhatsApp && whatsappTemplate) {
      try {
        results.push(
          await sendContractWhatsApp({
            input,
            recipient,
            template: whatsappTemplate,
            senderName,
          }),
        );
      } catch (error) {
        results.push({
          recipient: recipient.name || 'Recipient',
          channel: 'whatsapp',
          ok: false,
          error: error instanceof Error ? error.message : 'Failed to send WhatsApp',
        });
      }
    }
    if (wantEmail && emailTemplate && userId) {
      try {
        results.push(
          await sendContractEmail({
            input,
            recipient,
            template: emailTemplate,
            userId,
          }),
        );
      } catch (error) {
        results.push({
          recipient: recipient.name || 'Recipient',
          channel: 'email',
          ok: false,
          error: error instanceof Error ? error.message : 'Failed to send email',
        });
      }
    }
  }

  return {
    results,
    whatsappTemplateName: whatsappTemplate?.name,
    emailTemplateName: emailTemplate?.name,
  };
}
