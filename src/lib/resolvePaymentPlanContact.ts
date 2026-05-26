import { supabase } from './supabase';

export type ResolvedPaymentPlanContact = {
  name: string;
  email: string;
  phone: string;
  contactId: number | null;
};

type ContactRow = {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
};

function parseNumericId(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : parseInt(String(value), 10);
  return Number.isFinite(n) ? n : null;
}

function isNewLeadId(leadId: string | number): boolean {
  return String(leadId).includes('-');
}

function pickContactRow(raw: ContactRow | ContactRow[] | null | undefined): ContactRow | null {
  if (!raw) return null;
  return Array.isArray(raw) ? raw[0] ?? null : raw;
}

function fromContactRow(
  row: ContactRow | null,
  fallbackName: string,
  contactId: number | null,
): ResolvedPaymentPlanContact {
  return {
    name: row?.name?.trim() || fallbackName,
    email: row?.email?.trim() || '',
    phone: row?.phone?.trim() || '',
    contactId,
  };
}

async function fetchMainContactForLead(
  leadId: string | number,
  fallbackName: string,
): Promise<ResolvedPaymentPlanContact> {
  const isNewLead = isNewLeadId(leadId);

  const query = supabase
    .from('lead_leadcontact')
    .select('contact_id, main, leads_contact(name, email, phone)');

  const { data: links } = isNewLead
    ? await query.eq('newlead_id', leadId)
    : await query.eq('lead_id', parseNumericId(leadId));

  if (links?.length) {
    const mainLink =
      links.find((link) => link.main === 'true' || link.main === true || link.main === 1) ??
      links[0];
    const row = pickContactRow(mainLink.leads_contact as ContactRow | ContactRow[]);
    if (row) {
      return fromContactRow(row, fallbackName, mainLink.contact_id ?? null);
    }
  }

  if (!isNewLead) {
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

/**
 * Resolve billing contact for a payment plan row.
 * client_id is leads_contact.id (FinancesTab), NOT contacts.id — always verify via lead_leadcontact.
 * Legacy main-client rows may store the numeric lead id as client_id.
 */
export async function resolvePaymentPlanContact(params: {
  leadId: string | number | null | undefined;
  clientId: number | string | null | undefined;
  clientNameFallback?: string | null;
  leadNameFallback?: string | null;
}): Promise<ResolvedPaymentPlanContact> {
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
    return {
      name: params.leadNameFallback?.trim() || fallbackName,
      email: '',
      phone: '',
      contactId: clientId,
    };
  }

  if (clientId != null) {
    const linkQuery = supabase
      .from('lead_leadcontact')
      .select('contact_id, leads_contact(name, email, phone)');

    const { data: link } = isNewLeadId(String(leadId))
      ? await linkQuery.eq('newlead_id', leadId).eq('contact_id', clientId).maybeSingle()
      : numericLeadId != null
        ? await linkQuery.eq('lead_id', numericLeadId).eq('contact_id', clientId).maybeSingle()
        : { data: null };

    const row = pickContactRow(link?.leads_contact as ContactRow | ContactRow[] | null | undefined);
    if (row) {
      return fromContactRow(row, fallbackName, clientId);
    }

    return { name: fallbackName, email: '', phone: '', contactId: clientId };
  }

  return fetchMainContactForLead(leadId, fallbackName);
}
