/**
 * Send proforma invoice to the linked contact via WhatsApp template (whatsapp_templates_v2).
 * Default template: id 38 — map params in Admin (invoice_link, payment_link, lead_number, name, …).
 * Override: VITE_PROFORMA_WHATSAPP_TEMPLATE_ID
 */
import { supabase } from './supabase';
import { buildApiUrl } from './api';
import {
  buildPublicProformaUrl,
  ensureLegacyProformaPublicToken,
  ensureNewProformaPublicToken,
  type ProformaLinkKind,
} from './proformaPublicLink';
import { resolveProformaPaymentLinkUrl } from './proformaPaymentLink';
import {
  generateParamsFromDefinitions,
  getTemplateParamDefinitions,
  type ProformaWhatsAppParamContext,
} from './whatsappTemplateParamMapping';
import { generateTemplateParameters } from './whatsappTemplateParams';
import { fetchLeadContacts } from './contactHelpers';
import {
  normalizePhoneForWhatsApp,
  pickWhatsAppPhoneFromContactFields,
  toWhatsAppApiLanguageCode,
} from './whatsappPhone';
import type { ProformaSendEmailInput } from './proformaSendEmail';
import {
  getProformaWhatsAppTemplateId,
  PROFORMA_WHATSAPP_TEMPLATE_ID_EN_DEFAULT,
  PROFORMA_WHATSAPP_TEMPLATE_ID_HE,
} from './proformaSendLanguage';

/** @deprecated Use getProformaWhatsAppTemplateId('en') */
export const PROFORMA_WHATSAPP_TEMPLATE_ID_DEFAULT = PROFORMA_WHATSAPP_TEMPLATE_ID_EN_DEFAULT;

/** English default; env may override. Hebrew uses 40. */
export const PROFORMA_WHATSAPP_TEMPLATE_ID = getProformaWhatsAppTemplateId('en');

export { PROFORMA_WHATSAPP_TEMPLATE_ID_HE };

export type ProformaSendWhatsAppInput = ProformaSendEmailInput;

type WhatsAppTemplateRow = {
  id: number;
  name: string;
  language: string | null;
  content: string | null;
  params: number | string | null;
};

async function fetchProformaWhatsAppTemplate(templateId: number): Promise<WhatsAppTemplateRow> {
  const { data, error } = await supabase
    .from('whatsapp_templates_v2')
    .select('id, name, language, content, params, active, whatsapp_template_id')
    .eq('id', templateId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load WhatsApp template ${templateId}: ${error.message}`);
  }

  if (!data) {
    throw new Error(
      `WhatsApp template id ${templateId} was not found in whatsapp_templates_v2.`,
    );
  }

  if (!data.active) {
    throw new Error(
      `WhatsApp template id ${templateId} ("${data.name}") is not active.`,
    );
  }

  return data as WhatsAppTemplateRow;
}

async function resolveContactIdForWhatsApp(
  input: ProformaSendWhatsAppInput,
): Promise<number | null> {
  if (input.contactId != null && input.contactId !== '' && !Number.isNaN(Number(input.contactId))) {
    return Number(input.contactId);
  }
  if (!input.leadId) return null;

  const contacts = await fetchLeadContacts(input.leadId, Boolean(input.isLegacyLead));
  const main = contacts.find((c) => c.isMain) || contacts[0];
  return main?.id ?? null;
}

/** Resolve a WhatsApp-ready phone number, or null when none is available. */
export async function resolveProformaContactPhone(
  input: ProformaSendWhatsAppInput,
): Promise<string | null> {
  const displayRaw = input.contactPhone?.trim();
  if (displayRaw) {
    const fromDisplay = normalizePhoneForWhatsApp(displayRaw);
    if (fromDisplay) return fromDisplay;
  }

  const contactId = await resolveContactIdForWhatsApp(input);
  if (contactId != null) {
    const { data: legacyContact } = await supabase
      .from('leads_contact')
      .select('phone, mobile')
      .eq('id', contactId)
      .maybeSingle();

    const legacyRaw = pickWhatsAppPhoneFromContactFields(
      legacyContact?.phone,
      legacyContact?.mobile,
    );
    if (legacyRaw) {
      const normalized = normalizePhoneForWhatsApp(legacyRaw);
      if (normalized) return normalized;
    }

    const { data: newContact } = await supabase
      .from('contacts')
      .select('phone, mobile')
      .eq('id', contactId)
      .maybeSingle();

    const newRaw = pickWhatsAppPhoneFromContactFields(newContact?.phone, newContact?.mobile);
    if (newRaw) {
      const normalized = normalizePhoneForWhatsApp(newRaw);
      if (normalized) return normalized;
    }
  }

  return null;
}

async function resolveContactPhone(input: ProformaSendWhatsAppInput): Promise<string> {
  const phone = await resolveProformaContactPhone(input);
  if (phone) return phone;
  throw new Error(
    'No phone number found for WhatsApp. Add a phone on the proforma contact or link a payment-plan contact.',
  );
}

function formatWhatsAppSendError(result: Record<string, unknown>, fallback: string): string {
  const parts: string[] = [];
  if (typeof result.error === 'string' && result.error.trim()) {
    parts.push(result.error);
  }
  if (typeof result.details === 'string' && result.details.trim()) {
    parts.push(result.details);
  } else if (result.details && typeof result.details === 'object') {
    const nested = result.details as { error?: { message?: string } };
    if (nested.error?.message) {
      parts.push(nested.error.message);
    }
  }
  if (typeof result.code === 'string' || typeof result.code === 'number') {
    parts.push(`(code ${result.code})`);
  }
  return parts.length > 0 ? parts.join(' ') : fallback;
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

function buildClientForWhatsAppParams(
  input: ProformaSendWhatsAppInput,
  publicUrl: string,
  paymentLinkUrl: string,
) {
  const isLegacy = Boolean(input.isLegacyLead);
  const leadId = input.leadId;
  const paymentPlanId =
    input.paymentPlanId ?? (input.kind === 'new' ? input.recordId : null);
  return {
    id: isLegacy && leadId != null ? `legacy_${leadId}` : leadId,
    lead_type: isLegacy ? 'legacy' : 'new',
    name: input.clientName,
    lead_id: leadId,
    lead_number: input.leadNumber,
    proformaPublicUrl: publicUrl,
    proformaLeadNumber: input.leadNumber,
    paymentLinkUrl,
    paymentPlanId,
  };
}

function normalizeLeadIdForApi(input: ProformaSendWhatsAppInput): string | number {
  if (input.isLegacyLead && input.leadId != null) {
    const n = Number(input.leadId);
    return Number.isFinite(n) ? `legacy_${n}` : `legacy_${input.leadId}`;
  }
  return input.leadId ?? '';
}

export async function sendProformaInvoiceWhatsApp(
  input: ProformaSendWhatsAppInput,
): Promise<{ phoneNumber: string }> {
  const whatsAppTemplateId = getProformaWhatsAppTemplateId(input.language ?? 'en');
  const template = await fetchProformaWhatsAppTemplate(whatsAppTemplateId);
  const phoneNumber = await resolveContactPhone(input);
  const senderName = await resolveSenderName();

  const token =
    input.kind === 'legacy'
      ? await ensureLegacyProformaPublicToken(input.recordId)
      : await ensureNewProformaPublicToken(input.recordId);
  const publicUrl = buildPublicProformaUrl(input.kind, input.recordId, token);

  const paymentPlanId =
    input.paymentPlanId ?? (input.kind === 'new' ? input.recordId : null);
  const paymentLinkUrl =
    (await resolveProformaPaymentLinkUrl({
      paymentPlanId,
      leadClientId: input.leadId,
    })) || '';

  const proformaContext: ProformaWhatsAppParamContext = {
    invoiceLink: publicUrl,
    paymentLink: paymentLinkUrl,
    leadNumber: input.leadNumber,
    paymentPlanId,
  };

  const clientForParams = buildClientForWhatsAppParams(input, publicUrl, paymentLinkUrl);
  const contactIdNum = await resolveContactIdForWhatsApp(input);

  const paramCount = Number(template.params) || 0;
  let templateParameters: Array<{ type: string; text: string }> = [];

  if (paramCount > 0) {
    const paramDefinitions = await getTemplateParamDefinitions(template.id, template.name);

    if (paramDefinitions.length === 0) {
      throw new Error(
        `WhatsApp template "${template.name}" (id ${template.id}) has no saved param_mapping. ` +
          `Edit template ${template.id} in Admin, map all ${paramCount} parameters (Name → Lead # → Invoice Link → …), then Save.`,
      );
    }

    if (paramDefinitions.length !== paramCount) {
      throw new Error(
        `param_mapping has ${paramDefinitions.length} entries but template "${template.name}" requires ${paramCount}. ` +
          'Update all parameter slots in Admin and save.',
      );
    }

    templateParameters = await generateParamsFromDefinitions(
      paramDefinitions,
      clientForParams,
      contactIdNum,
      proformaContext,
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

  const templateIdNum = Number(template.id);
  const templateLanguage = toWhatsAppApiLanguageCode(template.language || 'en');

  const messagePayload: Record<string, unknown> = {
    leadId: normalizeLeadIdForApi(input),
    phoneNumber,
    sender_name: senderName,
    isTemplate: true,
    templateId: templateIdNum,
    templateName: template.name,
    templateLanguage,
    contactId: contactIdNum,
  };

  if (paramCount > 0) {
    messagePayload.templateParameters = templateParameters;
    messagePayload.message = filledContent || 'Template sent';
  } else {
    messagePayload.message = template.content || 'Invoice';
  }

  const response = await fetch(buildApiUrl('/api/whatsapp/send-message'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(messagePayload),
  });

  const result = await response.json().catch(() => ({}));

  const isDbSaveError =
    !response.ok &&
    result?.error &&
    (String(result.error).includes('save') ||
      String(result.error).includes('Failed to save message'));

  if (isDbSaveError) {
    console.warn('[sendProformaInvoiceWhatsApp] WhatsApp likely sent; database save failed:', result);
    return { phoneNumber };
  }

  if (!response.ok && !isDbSaveError) {
    if (result?.code === 'RE_ENGAGEMENT_REQUIRED') {
      throw new Error(
        'WhatsApp 24-hour rule: use a template message after 24 hours of client inactivity.',
      );
    }
    console.error('[sendProformaInvoiceWhatsApp] API error', {
      templateId: templateIdNum,
      templateName: template.name,
      templateLanguage,
      paramCount,
      parameters: templateParameters.map((p, i) => ({
        slot: i + 1,
        preview: String(p.text || '').slice(0, 80),
      })),
      result,
    });
    throw new Error(
      formatWhatsAppSendError(
        result as Record<string, unknown>,
        'Failed to send invoice via WhatsApp.',
      ),
    );
  }

  console.info('[sendProformaInvoiceWhatsApp] sent', {
    templateId: templateIdNum,
    templateLanguage,
    phoneNumber,
    paramCount,
  });
  return { phoneNumber };
}
