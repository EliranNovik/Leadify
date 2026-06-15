const supabase = require('../config/supabase');
const graphMailboxSyncService = require('./graphMailboxSyncService');
const graphAuthService = require('./graphAuthService');
const { getProformaEmailTemplateId } = require('../lib/proformaSendLanguage');
const {
  buildPublicProformaUrl,
  ensureLegacyProformaPublicToken,
  ensureNewProformaPublicToken,
} = require('../lib/proformaPublicLink');
const { resolveProformaPaymentLinkUrl } = require('../lib/proformaPaymentLink');
const {
  parseEmailTemplateContent,
  formatPlainEmailHtml,
  applyProformaPlaceholders,
  buildProformaEmailSubject,
} = require('../lib/proformaEmailPlaceholders');
const { invokeExpressHandler } = require('../lib/invokeExpressHandler');
const { sendMessage } = require('../controllers/whatsappController');
const {
  pickWhatsAppPhoneFromContactFields,
  toWhatsAppApiLanguageCode,
  normalizePhoneForWhatsApp,
} = require('../lib/whatsappPhone');
const { resolvePaymentPlanContact } = require('../lib/resolvePaymentPlanContact');
const { getProformaWhatsAppTemplateId } = require('../lib/proformaSendLanguage');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sanitizeWhatsAppTemplateVariableText(text) {
  if (!text) return '';
  return String(text)
    .replace(/[\n\r\t]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

async function resolveProformaContactEmail(contactId, fallbackEmail) {
  const trimmed = fallbackEmail?.trim();
  if (trimmed && EMAIL_REGEX.test(trimmed)) return trimmed;

  if (contactId == null || contactId === '') return null;

  const { data: newContact } = await supabase
    .from('contacts')
    .select('email')
    .eq('id', contactId)
    .maybeSingle();

  const newEmail = newContact?.email?.trim();
  if (newEmail && EMAIL_REGEX.test(newEmail)) return newEmail;

  const { data: legacyContact } = await supabase
    .from('leads_contact')
    .select('email')
    .eq('id', contactId)
    .maybeSingle();

  const legacyEmail = legacyContact?.email?.trim();
  if (legacyEmail && EMAIL_REGEX.test(legacyEmail)) return legacyEmail;

  return null;
}

async function resolveProformaContactPhone(input) {
  const displayRaw = input.contactPhone?.trim();
  if (displayRaw) {
    const fromDisplay = normalizePhoneForWhatsApp(displayRaw);
    if (fromDisplay) return fromDisplay;
  }

  const contactId = input.contactId;
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

async function fetchProformaEmailTemplate(templateId) {
  const { data, error } = await supabase
    .from('misc_emailtemplate')
    .select('name, content')
    .eq('id', templateId)
    .single();

  if (error || !data) {
    throw new Error(`Invoice email template (${templateId}) was not found.`);
  }

  return {
    name: (data.name || 'Invoice').trim(),
    content: parseEmailTemplateContent(data.content),
  };
}

async function fetchProformaWhatsAppTemplate(templateId) {
  const { data, error } = await supabase
    .from('whatsapp_templates_v2')
    .select('id, name, language, content, params, active, param_mapping')
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
  return data;
}

async function resolveSenderNameByAuthUserId(authUserId) {
  if (!authUserId) return 'Staff';

  const { data: userRow } = await supabase
    .from('users')
    .select('full_name, email, employee_id')
    .eq('auth_id', authUserId)
    .maybeSingle();

  let displayName = userRow?.full_name?.trim() || '';
  if (!displayName && userRow?.employee_id) {
    const { data: emp } = await supabase
      .from('tenants_employee')
      .select('display_name')
      .eq('id', userRow.employee_id)
      .maybeSingle();
    displayName = emp?.display_name?.trim() || '';
  }

  return displayName || userRow?.email || 'Staff';
}

async function getTemplateParamDefinitions(templateId, templateName) {
  const { data: template } = await supabase
    .from('whatsapp_templates_v2')
    .select('param_mapping')
    .eq('id', templateId)
    .maybeSingle();

  if (template?.param_mapping && Array.isArray(template.param_mapping) && template.param_mapping.length) {
    return template.param_mapping;
  }

  return [];
}

async function generateProformaWhatsAppParams(definitions, input, proformaContext, contactId) {
  const parameters = [];

  for (const def of definitions) {
    let value = '';
    switch (def.type) {
      case 'name':
      case 'contact_name':
      case 'client_name':
        value = sanitizeWhatsAppTemplateVariableText(input.clientName || 'Client');
        break;
      case 'invoice_link':
        value = sanitizeWhatsAppTemplateVariableText(proformaContext.invoiceLink || '');
        break;
      case 'payment_link':
        value = sanitizeWhatsAppTemplateVariableText(proformaContext.paymentLink || '');
        break;
      case 'lead_number':
        value = sanitizeWhatsAppTemplateVariableText(proformaContext.leadNumber || '');
        break;
      case 'custom':
        value = def.value || '';
        break;
      default:
        value = '';
    }
    parameters.push({ type: 'text', text: value });
  }

  return parameters;
}

function normalizeLeadIdForApi(input) {
  if (input.isLegacyLead && input.leadId != null) {
    const n = Number(input.leadId);
    return Number.isFinite(n) ? `legacy_${n}` : `legacy_${input.leadId}`;
  }
  return input.leadId ?? '';
}

async function sendProformaInvoiceEmailBackend(input, mailboxUserId) {
  if (!mailboxUserId) {
    const err = new Error('MAILBOX_NOT_CONNECTED');
    err.code = 'MAILBOX_NOT_CONNECTED';
    throw err;
  }

  const status = await graphAuthService.getConnectionStatus(mailboxUserId);
  if (!status?.connected) {
    const err = new Error('MAILBOX_NOT_CONNECTED');
    err.code = 'MAILBOX_NOT_CONNECTED';
    throw err;
  }

  const to = await resolveProformaContactEmail(input.contactId, input.contactEmail);
  if (!to) {
    throw new Error('No valid email address found for the proforma contact.');
  }

  const token =
    input.kind === 'legacy'
      ? await ensureLegacyProformaPublicToken(input.recordId)
      : await ensureNewProformaPublicToken(input.recordId);
  const publicUrl = buildPublicProformaUrl(input.kind, input.recordId, token);

  const paymentPlanId = input.paymentPlanId ?? (input.kind === 'new' ? input.recordId : null);
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
  const bodyHtml = formatPlainEmailHtml(plainBody);
  const subject = buildProformaEmailSubject(template.name, vars, language);

  const contactIdNum =
    input.contactId != null && input.contactId !== '' && !Number.isNaN(Number(input.contactId))
      ? Number(input.contactId)
      : null;

  await graphMailboxSyncService.sendEmail(mailboxUserId, {
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
      userInternalId: mailboxUserId,
    },
  });
}

async function sendProformaInvoiceWhatsAppBackend(input, senderAuthUserId) {
  const language = input.language ?? 'en';
  const whatsAppTemplateId = getProformaWhatsAppTemplateId(language);
  const template = await fetchProformaWhatsAppTemplate(whatsAppTemplateId);
  const phoneNumber = await resolveProformaContactPhone(input);
  if (!phoneNumber) {
    throw new Error('No phone number found for WhatsApp.');
  }

  const senderName = await resolveSenderNameByAuthUserId(senderAuthUserId);

  const token =
    input.kind === 'legacy'
      ? await ensureLegacyProformaPublicToken(input.recordId)
      : await ensureNewProformaPublicToken(input.recordId);
  const publicUrl = buildPublicProformaUrl(input.kind, input.recordId, token);

  const paymentPlanId = input.paymentPlanId ?? (input.kind === 'new' ? input.recordId : null);
  const paymentLinkUrl =
    (await resolveProformaPaymentLinkUrl({
      paymentPlanId,
      leadClientId: input.leadId,
    })) || '';

  const proformaContext = {
    invoiceLink: publicUrl,
    paymentLink: paymentLinkUrl,
    leadNumber: input.leadNumber,
    paymentPlanId,
  };

  const contactIdNum =
    input.contactId != null && !Number.isNaN(Number(input.contactId))
      ? Number(input.contactId)
      : null;

  const paramCount = Number(template.params) || 0;
  let templateParameters = [];

  if (paramCount > 0) {
    const paramDefinitions = await getTemplateParamDefinitions(template.id, template.name);
    if (paramDefinitions.length === 0) {
      throw new Error(
        `WhatsApp template "${template.name}" (id ${template.id}) has no param_mapping.`,
      );
    }
    if (paramDefinitions.length !== paramCount) {
      throw new Error(
        `param_mapping has ${paramDefinitions.length} entries but template requires ${paramCount}.`,
      );
    }

    templateParameters = await generateProformaWhatsAppParams(
      paramDefinitions,
      input,
      proformaContext,
      contactIdNum,
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
        filledContent = filledContent.replace(new RegExp(`\\{\\{${index + 1}\\}\\}`, 'g'), param.text);
      }
    });
  }

  const messagePayload = {
    leadId: normalizeLeadIdForApi(input),
    phoneNumber,
    sender_name: senderName,
    isTemplate: true,
    templateId: Number(template.id),
    templateName: template.name,
    templateLanguage: toWhatsAppApiLanguageCode(template.language || 'en'),
    contactId: contactIdNum,
  };

  if (paramCount > 0) {
    messagePayload.templateParameters = templateParameters;
    messagePayload.message = filledContent || 'Template sent';
  } else {
    messagePayload.message = template.content || 'Invoice';
  }

  const { status, data } = await invokeExpressHandler(sendMessage, { body: messagePayload });

  const isDbSaveError =
    status >= 400 &&
    data?.error &&
    (String(data.error).includes('save') || String(data.error).includes('Failed to save message'));

  if (isDbSaveError) {
    return { phoneNumber };
  }

  if (status >= 400) {
    if (data?.code === 'RE_ENGAGEMENT_REQUIRED') {
      throw new Error(
        'WhatsApp 24-hour rule: use a template message after 24 hours of client inactivity.',
      );
    }
    const parts = [data?.error, data?.details].filter(Boolean);
    throw new Error(parts.join(' ') || 'Failed to send invoice via WhatsApp.');
  }

  return { phoneNumber };
}

async function sendProformaInvoiceBundleBackend(input, mailboxUserId) {
  const contact =
    input.contactId != null || input.contactEmail || input.contactPhone
      ? {
          contactId: input.contactId ?? null,
          email: input.contactEmail || '',
          phone: input.contactPhone || '',
          name: input.clientName,
        }
      : await resolvePaymentPlanContact({
          leadId: input.isLegacyLead
            ? String(input.leadId).replace(/^legacy_/, '')
            : input.leadId,
          clientId: input.contactId ?? null,
          clientNameFallback: input.clientName,
        });

  const resolvedEmail = await resolveProformaContactEmail(contact.contactId, contact.email);
  const resolvedPhone = await resolveProformaContactPhone({
    ...input,
    contactId: contact.contactId,
    contactPhone: contact.phone || input.contactPhone,
  });

  if (!resolvedEmail && !resolvedPhone) {
    throw new Error('No email or phone number found for this proforma contact.');
  }

  let emailSent = false;
  let emailError = null;
  if (resolvedEmail) {
    try {
      await sendProformaInvoiceEmailBackend(
        { ...input, contactEmail: resolvedEmail, contactId: contact.contactId },
        mailboxUserId,
      );
      emailSent = true;
    } catch (err) {
      emailError = err;
    }
  }

  let whatsAppSent = false;
  let whatsAppPhone = '';
  let whatsAppError = null;
  if (resolvedPhone) {
    try {
      const wa = await sendProformaInvoiceWhatsAppBackend(
        { ...input, contactPhone: resolvedPhone, contactId: contact.contactId },
        mailboxUserId,
      );
      whatsAppSent = true;
      whatsAppPhone = wa.phoneNumber;
    } catch (err) {
      whatsAppError = err;
    }
  }

  if (!emailSent && !whatsAppSent) {
    const primary = emailError || whatsAppError;
    if (primary) throw primary;
    throw new Error('Failed to send invoice.');
  }

  return { emailSent, emailError, whatsAppSent, whatsAppPhone, whatsAppError };
}

module.exports = {
  sendProformaInvoiceBundleBackend,
  resolveProformaContactEmail,
  resolveProformaContactPhone,
};
