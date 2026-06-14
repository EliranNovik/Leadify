import { supabase } from './supabase';
import { buildClientFinancesTabPath, buildClientInteractionsTabPath } from './proformaClientNavigation';
import type { ProformaSendEmailInput } from './proformaSendEmail';
import type { ProformaSendLanguage } from './proformaSendLanguage';
import { resolvePaymentPlanContact } from './resolvePaymentPlanContact';
import type { SelectedLeadContact } from './interactionsCommunicationPreset';

export type CollectionPaymentRowLike = {
  id: string;
  leadId: string;
  leadType: 'new' | 'legacy';
  leadName: string;
  clientName: string;
  clientId?: number | null;
  caseNumber: string;
  hasProforma: boolean;
};

export function parseCollectionRowRecordId(rowId: string): { kind: 'new' | 'legacy'; recordId: string } | null {
  if (rowId.startsWith('legacy-')) {
    return { kind: 'legacy', recordId: rowId.slice('legacy-'.length) };
  }
  if (rowId.startsWith('new-')) {
    return { kind: 'new', recordId: rowId.slice('new-'.length) };
  }
  return null;
}

function resolvePaymentRecord(rowId: string): { table: 'payment_plans' | 'finances_paymentplanrow'; id: string | number } {
  const parsed = parseCollectionRowRecordId(rowId);
  if (!parsed) {
    throw new Error('Invalid payment row id');
  }
  if (parsed.kind === 'legacy') {
    const numericId = Number(parsed.recordId);
    if (Number.isNaN(numericId)) {
      throw new Error('Invalid legacy payment row id');
    }
    return { table: 'finances_paymentplanrow', id: numericId };
  }
  return { table: 'payment_plans', id: parsed.recordId };
}

export function buildFinancesTabPathForRow(row: CollectionPaymentRowLike): string | null {
  const leadNumber = row.caseNumber?.replace(/^#/, '').trim() || '';
  const isLegacy = row.leadType === 'legacy';
  const leadId = isLegacy ? row.leadId.replace(/^legacy_/, '') : row.leadId;
  return buildClientFinancesTabPath({
    isLegacy,
    leadNumber: leadNumber || null,
    leadId,
  });
}

export function buildInteractionsTabPathForRow(row: CollectionPaymentRowLike): string | null {
  const leadNumber = row.caseNumber?.replace(/^#/, '').trim() || '';
  const isLegacy = row.leadType === 'legacy';
  const leadId = isLegacy ? row.leadId.replace(/^legacy_/, '') : row.leadId;
  return buildClientInteractionsTabPath({
    isLegacy,
    leadNumber: leadNumber || null,
    leadId,
  });
}

export function buildWhatsAppClientSliceForRow(
  row: CollectionPaymentRowLike,
  selection?: SelectedLeadContact,
): {
  id: string;
  name: string;
  lead_number: string;
  phone?: string;
  mobile?: string;
  lead_type?: string;
} {
  const leadNumber = row.caseNumber?.replace(/^#/, '').trim() || '';
  const isLegacy = row.leadType === 'legacy';
  const id = isLegacy
    ? row.leadId.startsWith('legacy_')
      ? row.leadId
      : `legacy_${row.leadId.replace(/^legacy_/, '')}`
    : row.leadId;

  return {
    id,
    name: row.leadName || row.clientName || 'Client',
    lead_number: leadNumber,
    phone: selection?.contact.phone || undefined,
    mobile: selection?.contact.mobile || undefined,
    lead_type: isLegacy ? 'legacy' : 'new',
  };
}

export function uniqueLeadsFromRows(rows: CollectionPaymentRowLike[]): CollectionPaymentRowLike[] {
  const seen = new Set<string>();
  const out: CollectionPaymentRowLike[] = [];
  for (const row of rows) {
    if (seen.has(row.leadId)) continue;
    seen.add(row.leadId);
    out.push(row);
  }
  return out;
}

export async function resolveProformaViewPath(row: CollectionPaymentRowLike): Promise<string | null> {
  if (!row.hasProforma) return null;
  const parsed = parseCollectionRowRecordId(row.id);
  if (!parsed) return null;

  if (parsed.kind === 'new') {
    return `/proforma/${parsed.recordId}`;
  }

  const pprId = Number(parsed.recordId);
  if (Number.isNaN(pprId)) return null;

  const leadId = row.leadId.replace(/^legacy_/, '');
  const numericLeadId = Number(leadId);
  if (Number.isNaN(numericLeadId)) return null;

  const { data: byPpr } = await supabase
    .from('proformainvoice')
    .select('id')
    .eq('ppr_id', pprId)
    .is('cxd_date', null)
    .limit(1)
    .maybeSingle();
  if (byPpr?.id != null) {
    return `/proforma-legacy/${byPpr.id}`;
  }

  if (row.clientId != null) {
    const { data: byClient } = await supabase
      .from('proformainvoice')
      .select('id')
      .eq('lead_id', numericLeadId)
      .eq('client_id', row.clientId)
      .is('ppr_id', null)
      .is('cxd_date', null)
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (byClient?.id != null) {
      return `/proforma-legacy/${byClient.id}`;
    }
  }

  const { data: byLead } = await supabase
    .from('proformainvoice')
    .select('id')
    .eq('lead_id', numericLeadId)
    .is('cxd_date', null)
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();

  return byLead?.id != null ? `/proforma-legacy/${byLead.id}` : null;
}

export type CollectionInvoicePickerRow = CollectionPaymentRowLike & {
  amount: number;
  currency: string;
  orderLabel: string;
  proformaDate: string | null;
  collected: boolean;
};

export type CollectionInvoicePickerOption = {
  rowId: string;
  path: string;
  contactName: string;
  contactEmail: string;
  leadNumber: string;
  leadName: string;
  orderLabel: string;
  amount: number;
  currency: string;
  proformaDate: string | null;
  collected: boolean;
};

export async function buildInvoicePickerOptionsForRows(
  rows: CollectionInvoicePickerRow[],
): Promise<CollectionInvoicePickerOption[]> {
  const options: CollectionInvoicePickerOption[] = [];

  for (const row of rows) {
    const path = await resolveProformaViewPath(row);
    if (!path) continue;

    const contact = await resolvePaymentPlanContact({
      leadId: row.leadType === 'legacy' ? row.leadId.replace(/^legacy_/, '') : row.leadId,
      clientId: row.clientId ?? null,
      clientNameFallback: row.clientName,
      leadNameFallback: row.leadName,
    });

    options.push({
      rowId: row.id,
      path,
      contactName: contact.name || row.clientName || row.leadName || 'Client',
      contactEmail: contact.email || '',
      leadNumber: row.caseNumber?.replace(/^#/, '').trim() || '',
      leadName: row.leadName || row.clientName || '',
      orderLabel: row.orderLabel || '',
      amount: row.amount,
      currency: row.currency,
      proformaDate: row.proformaDate,
      collected: row.collected,
    });
  }

  return options;
}

export async function buildSendInvoiceInputForRow(
  row: CollectionPaymentRowLike,
  language: ProformaSendLanguage,
): Promise<ProformaSendEmailInput | null> {
  if (!row.hasProforma) return null;

  const contact = await resolvePaymentPlanContact({
    leadId: row.leadType === 'legacy' ? row.leadId.replace(/^legacy_/, '') : row.leadId,
    clientId: row.clientId ?? null,
    clientNameFallback: row.clientName,
    leadNameFallback: row.leadName,
  });

  const leadNumber = row.caseNumber?.replace(/^#/, '').trim() || '';
  const parsed = parseCollectionRowRecordId(row.id);
  if (!parsed) return null;

  if (parsed.kind === 'new') {
    return {
      kind: 'new',
      recordId: parsed.recordId,
      paymentPlanId: parsed.recordId,
      contactId: contact.contactId,
      contactEmail: contact.email || null,
      contactPhone: contact.phone || null,
      clientName: contact.name || row.clientName || 'Client',
      leadNumber,
      leadId: row.leadId,
      isLegacyLead: false,
      language,
    };
  }

  const viewPath = await resolveProformaViewPath(row);
  if (!viewPath) return null;
  const proformaId = viewPath.split('/').pop();
  if (!proformaId) return null;

  const numericLeadId = Number(row.leadId.replace(/^legacy_/, ''));
  return {
    kind: 'legacy',
    recordId: proformaId,
    paymentPlanId: Number(parsed.recordId),
    contactId: contact.contactId,
    contactEmail: contact.email || null,
    contactPhone: contact.phone || null,
    clientName: contact.name || row.clientName || 'Client',
    leadNumber,
    leadId: Number.isNaN(numericLeadId) ? row.leadId : numericLeadId,
    isLegacyLead: true,
    language,
  };
}

export async function markRowsSentToFinance(rows: CollectionPaymentRowLike[]): Promise<{ ok: number; failed: number }> {
  let ok = 0;
  let failed = 0;
  const now = new Date().toISOString();

  for (const row of rows) {
    try {
      const { table, id } = resolvePaymentRecord(row.id);
      const { error } = await supabase
        .from(table)
        .update({ sent_to_finance: true, sent_to_finance_at: now })
        .eq('id', id);
      if (error) throw error;
      ok += 1;
    } catch {
      failed += 1;
    }
  }

  return { ok, failed };
}

export async function resolveContactsForRows(
  rows: CollectionPaymentRowLike[],
): Promise<Array<{ row: CollectionPaymentRowLike; email: string; phone: string; name: string }>> {
  const results: Array<{ row: CollectionPaymentRowLike; email: string; phone: string; name: string }> = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const contact = await resolvePaymentPlanContact({
      leadId: row.leadType === 'legacy' ? row.leadId.replace(/^legacy_/, '') : row.leadId,
      clientId: row.clientId ?? null,
      clientNameFallback: row.clientName,
      leadNameFallback: row.leadName,
    });
    const key = `${row.leadId}:${row.clientId ?? ''}:${contact.email}:${contact.phone}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      row,
      email: contact.email,
      phone: contact.phone,
      name: contact.name,
    });
  }

  return results;
}
