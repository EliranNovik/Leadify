const supabase = require('../config/supabase');

function parseNumericId(value) {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : parseInt(String(value), 10);
  return Number.isFinite(n) ? n : null;
}

function isNewLeadId(leadId) {
  return String(leadId).includes('-');
}

function pickContactRow(raw) {
  if (!raw) return null;
  return Array.isArray(raw) ? raw[0] ?? null : raw;
}

function fromContactRow(row, fallbackName, contactId) {
  return {
    name: row?.name?.trim() || fallbackName,
    email: row?.email?.trim() || '',
    phone: row?.mobile?.trim() || row?.phone?.trim() || '',
    contactId,
  };
}

async function lookupContactById(contactId, fallbackName) {
  const { data: legacyRow } = await supabase
    .from('leads_contact')
    .select('name, email, phone, mobile')
    .eq('id', contactId)
    .maybeSingle();

  if (legacyRow) {
    return fromContactRow(legacyRow, fallbackName, contactId);
  }

  const { data: newRow } = await supabase
    .from('contacts')
    .select('name, email, phone, mobile')
    .eq('id', contactId)
    .maybeSingle();

  if (newRow) {
    return fromContactRow(newRow, fallbackName, contactId);
  }

  return null;
}

async function fetchMainContactForLead(leadId, fallbackName) {
  const query = supabase
    .from('lead_leadcontact')
    .select('contact_id, main, leads_contact(name, email, phone)');

  const { data: links } = isNewLeadId(String(leadId))
    ? await query.eq('newlead_id', leadId)
    : await query.eq('lead_id', parseNumericId(leadId));

  if (links?.length) {
    const mainLink =
      links.find((link) => link.main === 'true' || link.main === true || link.main === 1) ??
      links[0];
    const row = pickContactRow(mainLink.leads_contact);
    if (row) {
      return fromContactRow(row, fallbackName, mainLink.contact_id ?? null);
    }
  }

  if (!isNewLeadId(String(leadId))) {
    const numericLeadId = parseNumericId(leadId);
    if (numericLeadId != null) {
      const { data: leadRow } = await supabase
        .from('leads_lead')
        .select('name')
        .eq('id', numericLeadId)
        .maybeSingle();
      if (leadRow?.name?.trim()) {
        return { name: leadRow.name.trim(), email: '', phone: '', contactId: null };
      }
    }
  }

  return { name: fallbackName, email: '', phone: '', contactId: null };
}

async function resolvePaymentPlanContact(params) {
  const fallbackName =
    params.clientNameFallback?.trim() ||
    params.leadNameFallback?.trim() ||
    'Client';
  const clientId = parseNumericId(params.clientId);
  const leadId = params.leadId;

  if (!leadId) {
    return { name: fallbackName, email: '', phone: '', contactId: clientId };
  }

  const numericLeadId = isNewLeadId(String(leadId)) ? null : parseNumericId(leadId);

  if (numericLeadId != null && clientId != null && clientId === numericLeadId) {
    return fetchMainContactForLead(leadId, params.leadNameFallback?.trim() || fallbackName);
  }

  if (clientId != null) {
    const linkQuery = supabase
      .from('lead_leadcontact')
      .select('contact_id, leads_contact(name, email, phone, mobile)');

    const { data: link } = isNewLeadId(String(leadId))
      ? await linkQuery.eq('newlead_id', leadId).eq('contact_id', clientId).maybeSingle()
      : numericLeadId != null
        ? await linkQuery.eq('lead_id', numericLeadId).eq('contact_id', clientId).maybeSingle()
        : { data: null };

    const row = pickContactRow(link?.leads_contact);
    if (row) {
      return fromContactRow(row, fallbackName, clientId);
    }

    const direct = await lookupContactById(clientId, fallbackName);
    if (direct) {
      return direct;
    }

    return { name: fallbackName, email: '', phone: '', contactId: clientId };
  }

  return fetchMainContactForLead(leadId, fallbackName);
}

module.exports = {
  resolvePaymentPlanContact,
  fetchMainContactForLead,
  lookupContactById,
};
