/**
 * Pelecard ParamX is free text capped at ~19 characters (AdditionalDetailsParamX /
 * “more information” in the merchant UI).
 *
 * Preferred value: `{leadNumber}-{plan_contact_id}` from payment_links
 * (e.g. `12345-678` or `12345.2-678` for subleads).
 *
 * Lead number sources:
 * - New leads: `leads.lead_number` via payment_links.client_id → leads.id
 * - Legacy leads: payment_links.legacy_id (= leads_lead.id), which is the display lead number
 *
 * Fallback: short random code when lead/contact are missing.
 */

const PELECARD_PARAM_X_MAX = 19;

function clipParamX(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  return value.slice(0, PELECARD_PARAM_X_MAX);
}

/** Same rules as payment_links insert / ensurePaymentLinkPlanContact. */
function isLegacyPaymentLink(payment) {
  return (
    payment?.legacy_id != null ||
    payment?.is_legacy_payment_plan === true ||
    String(payment?.client_id || '').startsWith('legacy_')
  );
}

/** Sanitize lead_number for ParamX (no spaces; sublead `/` → `.`). */
function sanitizeLeadNumberForParamX(leadNumber) {
  return String(leadNumber || '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/\//g, '.');
}

function parseLegacyNumericId(raw) {
  if (raw == null || raw === '') return null;
  const digits = String(raw).trim().replace(/^legacy_/, '');
  if (!/^\d+$/.test(digits)) return null;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Sync lead number for ParamX from columns already on the payment_links row / joins.
 * Does not invent values from UUIDs.
 */
function resolveLeadNumberForParamX(payment) {
  if (!payment) return null;

  if (isLegacyPaymentLink(payment)) {
    // Legacy: payment_links.legacy_id = leads_lead.id (the CRM lead number)
    const fromLegacyCol = parseLegacyNumericId(payment.legacy_id);
    if (fromLegacyCol != null) return sanitizeLeadNumberForParamX(fromLegacyCol);

    const fromClient = parseLegacyNumericId(payment.client_id);
    if (fromClient != null) return sanitizeLeadNumberForParamX(fromClient);

    // enrichPaymentRow sets leads.lead_number = String(leads_lead.id)
    if (payment.leads?.lead_number != null && String(payment.leads.lead_number).trim() !== '') {
      const n = parseLegacyNumericId(payment.leads.lead_number);
      if (n != null) return sanitizeLeadNumberForParamX(n);
      return sanitizeLeadNumberForParamX(payment.leads.lead_number);
    }
    return null;
  }

  // New lead: leads.lead_number from leads table (joined on payment_links.client_id)
  const fromJoin = payment.leads?.lead_number;
  if (fromJoin != null && String(fromJoin).trim() !== '') {
    return sanitizeLeadNumberForParamX(fromJoin);
  }
  if (payment.lead_number != null && String(payment.lead_number).trim() !== '') {
    return sanitizeLeadNumberForParamX(payment.lead_number);
  }
  return null;
}

/**
 * When sync resolution fails, load the correct lead number from DB.
 * - New: SELECT lead_number FROM leads WHERE id = payment_links.client_id
 * - Legacy: payment_links.legacy_id / leads_lead.id
 */
async function ensureLeadNumberForParamX(payment, supabase) {
  if (!payment || !supabase) return payment;
  if (resolveLeadNumberForParamX(payment)) return payment;

  if (isLegacyPaymentLink(payment)) {
    const legacyId =
      parseLegacyNumericId(payment.legacy_id) ?? parseLegacyNumericId(payment.client_id);
    if (legacyId == null) return payment;

    const { data, error } = await supabase
      .from('leads_lead')
      .select('id')
      .eq('id', legacyId)
      .maybeSingle();
    if (error) {
      console.warn('[Pelecard] legacy lead lookup for ParamX failed:', error.message || error);
    }
    const id = data?.id != null ? Number(data.id) : legacyId;
    const leadNumber = String(id);
    return {
      ...payment,
      legacy_id: id,
      lead_number: leadNumber,
      leads: { ...(payment.leads || {}), lead_number: leadNumber },
    };
  }

  const clientId = payment.client_id;
  if (!clientId || String(clientId).startsWith('legacy_')) return payment;

  const { data, error } = await supabase
    .from('leads')
    .select('lead_number')
    .eq('id', clientId)
    .maybeSingle();
  if (error) {
    console.warn('[Pelecard] new lead lookup for ParamX failed:', error.message || error);
    return payment;
  }
  const leadNumber = data?.lead_number != null ? String(data.lead_number).trim() : '';
  if (!leadNumber) return payment;

  return {
    ...payment,
    lead_number: leadNumber,
    leads: { ...(payment.leads || {}), lead_number: leadNumber },
  };
}

/**
 * Build ParamX as leadNumber-planContactId within the 19-char Pelecard limit.
 * Returns null when either part is missing.
 */
function buildLeadContactParamX(payment) {
  const contactId = payment?.plan_contact_id;
  if (contactId == null || String(contactId).trim() === '') return null;

  const lead = resolveLeadNumberForParamX(payment);
  if (!lead) return null;

  const contactPart = String(contactId).trim();
  if (!/^\d+$/.test(contactPart)) return null;

  const sep = '-';
  const maxLead = PELECARD_PARAM_X_MAX - contactPart.length - sep.length;
  if (maxLead < 1) return clipParamX(contactPart);

  const leadPart = lead.slice(0, maxLead);
  return clipParamX(`${leadPart}${sep}${contactPart}`);
}

/** @deprecated Use buildLeadContactParamX */
function buildLeadPlanParamX(payment) {
  return buildLeadContactParamX(payment);
}

/**
 * Parse `{lead}-{planContactId}` ParamX. Contact id is the trailing numeric segment.
 */
function parseLeadContactParamX(raw) {
  const value = clipParamX(raw);
  if (!value) return null;
  const match = value.match(/^(.*)-(\d+)$/);
  if (!match) return null;
  const leadNumber = String(match[1] || '').trim();
  const planContactId = Number(match[2]);
  if (!leadNumber || !Number.isFinite(planContactId)) return null;
  return { leadNumber, planContactId };
}

/** @deprecated Use parseLeadContactParamX */
function parseLeadPlanParamX(raw) {
  const parsed = parseLeadContactParamX(raw);
  if (!parsed) return null;
  return {
    leadNumber: parsed.leadNumber,
    paymentPlanId: parsed.planContactId,
    planContactId: parsed.planContactId,
  };
}

function generatePelecardParamX() {
  // Legacy fallback e.g. pms4wo4vs0lv64k — always ≤ 19 chars
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return clipParamX(`p${stamp}${rand}`);
}

function readStoredParamX(payment) {
  const raw = payment?.pelecard_raw_response;
  if (!raw || typeof raw !== 'object') return null;
  return clipParamX(raw.paramX || raw.initParamX || null);
}

/**
 * Prefer lead number + plan_contact_id; never send a long secure_token
 * (Pelecard truncates ~19 and used to show clipped `payment_176…` values).
 */
function resolvePelecardParamX(payment, secureToken) {
  const fromLeadContact = buildLeadContactParamX(payment);
  if (fromLeadContact) return fromLeadContact;

  const stored = readStoredParamX(payment);
  if (stored) return stored;

  const token = String(secureToken || payment?.secure_token || '').trim();
  if (token && token.length <= PELECARD_PARAM_X_MAX) return token;

  return generatePelecardParamX();
}

function withParamXInRaw(payment, paramX) {
  const previous =
    payment?.pelecard_raw_response && typeof payment.pelecard_raw_response === 'object'
      ? payment.pelecard_raw_response
      : {};
  return {
    ...previous,
    paramX,
    initParamX: paramX,
  };
}

module.exports = {
  PELECARD_PARAM_X_MAX,
  clipParamX,
  isLegacyPaymentLink,
  sanitizeLeadNumberForParamX,
  resolveLeadNumberForParamX,
  ensureLeadNumberForParamX,
  buildLeadContactParamX,
  buildLeadPlanParamX,
  parseLeadContactParamX,
  parseLeadPlanParamX,
  generatePelecardParamX,
  readStoredParamX,
  resolvePelecardParamX,
  withParamXInRaw,
};
