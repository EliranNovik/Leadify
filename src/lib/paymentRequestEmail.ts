import { supabase } from './supabase';
import {
  getProformaWhatsAppTemplateId,
  PROFORMA_EMAIL_TEMPLATE_ID_EN,
  PROFORMA_EMAIL_TEMPLATE_ID_HE,
  PROFORMA_WHATSAPP_TEMPLATE_ID_EN_DEFAULT,
  PROFORMA_WHATSAPP_TEMPLATE_ID_HE,
} from './proformaSendLanguage';
import { fetchStage60RecordsInRange, STAGE60_SELECT, type Stage60Record } from './stage60SignDate';

/** Email templates used when sending a proforma: 179 Hebrew, 180 English. */
export const PAYMENT_REQUEST_EMAIL_TEMPLATE_IDS = [
  PROFORMA_EMAIL_TEMPLATE_ID_HE,
  PROFORMA_EMAIL_TEMPLATE_ID_EN,
] as const;

/** WhatsApp templates used when sending a proforma: 40 Hebrew, 41 English (plus env override). */
export const PAYMENT_REQUEST_WHATSAPP_TEMPLATE_IDS = [
  ...new Set([
    PROFORMA_WHATSAPP_TEMPLATE_ID_HE,
    PROFORMA_WHATSAPP_TEMPLATE_ID_EN_DEFAULT,
    getProformaWhatsAppTemplateId('he'),
    getProformaWhatsAppTemplateId('en'),
  ]),
];

const PAGE = 1000;

function isoDateLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Inclusive local calendar range for the last 30 days ending today. */
export function last30DaysRange(from = new Date()): { from: string; to: string } {
  const end = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 29);
  return { from: isoDateLocal(start), to: isoDateLocal(end) };
}

/** Inclusive local calendar range for the last 7 days ending today. */
export function last7DaysRange(from = new Date()): { from: string; to: string } {
  const end = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 6);
  return { from: isoDateLocal(start), to: isoDateLocal(end) };
}

async function fetchAllPaged<T>(
  runPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;
  for (;;) {
    const to = from + PAGE - 1;
    const { data, error } = await runPage(from, to);
    if (error) throw error;
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

export async function fetchAllStage60Records(): Promise<Stage60Record[]> {
  return fetchAllPaged<Stage60Record>((from, to) =>
    supabase.from('leads_leadstage').select(STAGE60_SELECT).eq('stage', 60).range(from, to),
  );
}

function hasProformaValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || trimmed.toLowerCase() === 'null' || trimmed === '{}') return false;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && Object.keys(parsed).length === 0) return false;
    } catch {
      // treat as truthy string
    }
    return true;
  }
  if (typeof value === 'object') return Object.keys(value as object).length > 0;
  return Boolean(value);
}

function isPaymentPaid(row: { paid?: unknown; paid_at?: unknown; actual_date?: unknown }): boolean {
  if (row.actual_date != null && String(row.actual_date).trim()) return true;
  if (row.paid === true || row.paid === 'true' || row.paid === 1 || row.paid === '1') return true;
  if (row.paid_at != null && String(row.paid_at).trim()) return true;
  return false;
}

export function emailLeadKey(kind: 'new' | 'legacy', id: string | number): string {
  return `${kind}:${String(id).replace(/^legacy_?/i, '')}`;
}

export type PaymentRequestLeadKey = {
  kind: 'new' | 'legacy';
  id: string;
  /** Parent legacy lead when this row is a sub-lead. Invoice mail is often stored on the master. */
  masterId?: string | null;
  /** Legacy payment-plan contact (`finances_paymentplanrow.client_id`). */
  contactId?: string | number | null;
};

export function paymentRowEmailLeadKey(row: {
  leadId?: string | null;
  leadType?: 'new' | 'legacy';
}): string | null {
  const raw = String(row.leadId || '').trim();
  if (!raw) return null;
  if (row.leadType === 'legacy' || raw.startsWith('legacy')) {
    const id = raw.replace(/^legacy_?/i, '');
    return id ? emailLeadKey('legacy', id) : null;
  }
  return emailLeadKey('new', raw);
}

function contactKey(id: string | number | null | undefined): string | null {
  if (id == null || id === '') return null;
  const raw = String(id).trim();
  return raw || null;
}

async function fetchPaymentRequestTemplateNames(): Promise<string[]> {
  const { data } = await supabase
    .from('misc_emailtemplate')
    .select('id, name')
    .in('id', [...PAYMENT_REQUEST_EMAIL_TEMPLATE_IDS]);
  return (data || [])
    .map((row) => String(row.name || '').trim())
    .filter((name) => name.length >= 4);
}

type EmailLeadHit = {
  client_id?: string | null;
  legacy_id?: string | number | null;
  contact_id?: string | number | null;
};
type WhatsAppLeadHit = {
  lead_id?: string | null;
  legacy_id?: string | number | null;
  contact_id?: string | number | null;
};

function addEmailHits(hits: EmailLeadHit[], leadKeys: Set<string>, contactIds: Set<string>) {
  for (const row of hits) {
    const clientId = String(row.client_id || '').trim();
    if (clientId) leadKeys.add(emailLeadKey('new', clientId));
    const legacyRaw = String(row.legacy_id ?? '').trim();
    if (legacyRaw) leadKeys.add(emailLeadKey('legacy', legacyRaw.replace(/^legacy_?/i, '')));
    const contact = contactKey(row.contact_id);
    if (contact) contactIds.add(contact);
  }
}

function addWhatsAppHits(hits: WhatsAppLeadHit[], leadKeys: Set<string>, contactIds: Set<string>) {
  for (const row of hits) {
    const leadId = String(row.lead_id || '').trim();
    if (leadId) leadKeys.add(emailLeadKey('new', leadId));
    const legacyRaw = String(row.legacy_id ?? '').trim();
    if (legacyRaw) leadKeys.add(emailLeadKey('legacy', legacyRaw.replace(/^legacy_?/i, '')));
    const contact = contactKey(row.contact_id);
    if (contact) contactIds.add(contact);
  }
}

async function fetchLegacyMasterIds(legacyIds: string[]): Promise<Map<string, string>> {
  const masterById = new Map<string, string>();
  const numeric = [
    ...new Set(legacyIds.map((id) => Number(String(id).replace(/^legacy_?/i, ''))).filter((id) => Number.isFinite(id))),
  ];
  for (let i = 0; i < numeric.length; i += 400) {
    const chunk = numeric.slice(i, i + 400);
    if (!chunk.length) continue;
    const { data, error } = await supabase.from('leads_lead').select('id, master_id').in('id', chunk);
    if (error) {
      console.warn('Payment request master_id lookup failed:', error);
      continue;
    }
    for (const row of data || []) {
      if (row?.id == null || row.master_id == null) continue;
      const id = String(row.id);
      const master = String(row.master_id);
      if (id && master && master !== id) masterById.set(id, master);
    }
  }
  return masterById;
}

async function enrichPaymentRequestKeys(keys: PaymentRequestLeadKey[]): Promise<PaymentRequestLeadKey[]> {
  const needMaster = keys.filter((key) => key.kind === 'legacy' && !key.masterId).map((key) => key.id);
  if (!needMaster.length) return keys;
  const masters = await fetchLegacyMasterIds(needMaster);
  if (!masters.size) return keys;
  return keys.map((key) => {
    if (key.kind !== 'legacy' || key.masterId) return key;
    const masterId = masters.get(key.id);
    return masterId ? { ...key, masterId } : key;
  });
}

async function fetchLeadKeysWithPaymentRequestWhatsApp(
  newIds: string[],
  legacyIds: string[],
  contactIds: string[],
  leadKeys: Set<string>,
  foundContacts: Set<string>,
): Promise<void> {
  const runChunked = async (ids: Array<string | number>, column: 'lead_id' | 'legacy_id' | 'contact_id') => {
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      if (!chunk.length) continue;
      try {
        const { data, error } = await supabase
          .from('whatsapp_messages')
          .select('lead_id, legacy_id, contact_id, template_id')
          .eq('direction', 'out')
          .in('template_id', PAYMENT_REQUEST_WHATSAPP_TEMPLATE_IDS)
          .in(column, chunk);
        if (error) throw error;
        addWhatsAppHits((data || []) as WhatsAppLeadHit[], leadKeys, foundContacts);
      } catch (err) {
        console.warn(`Payment request WhatsApp lookup (${column}) failed:`, err);
      }
    }
  };

  await runChunked(newIds, 'lead_id');
  await runChunked(
    legacyIds.map((id) => Number(id)).filter((id) => Number.isFinite(id)),
    'legacy_id',
  );
  await runChunked(
    contactIds.map((id) => Number(id)).filter((id) => Number.isFinite(id)),
    'contact_id',
  );
}

async function queryOutgoingPaymentRequestEmails(
  column: 'client_id' | 'legacy_id' | 'contact_id',
  chunk: Array<string | number>,
  subjectOr: string,
): Promise<EmailLeadHit[]> {
  const hits: EmailLeadHit[] = [];
  try {
    const { data, error } = await supabase
      .from('emails')
      .select('client_id, legacy_id, contact_id, template_id')
      .eq('direction', 'outgoing')
      .in('template_id', [...PAYMENT_REQUEST_EMAIL_TEMPLATE_IDS])
      .in(column, chunk);
    if (error) throw error;
    hits.push(...((data || []) as EmailLeadHit[]));
  } catch (err) {
    console.warn(`Payment request email template lookup (${column}) failed:`, err);
  }

  // Graph-sent invoices do not store emails.template_id — always match template subjects too.
  if (subjectOr) {
    try {
      const { data, error } = await supabase
        .from('emails')
        .select('client_id, legacy_id, contact_id, subject')
        .eq('direction', 'outgoing')
        .or(subjectOr)
        .in(column, chunk);
      if (error) throw error;
      hits.push(...((data || []) as EmailLeadHit[]));
    } catch (err) {
      console.warn(`Payment request email subject lookup (${column}) failed:`, err);
    }
  }

  return hits;
}

/**
 * Leads that already received the proforma payment request by email (179 / 180)
 * or WhatsApp (40 / 41). Email matches template_id when present, and always also
 * matches outgoing subject (Graph sends do not persist template_id).
 * Legacy sub-leads also match the parent master_id and the payment-row contact.
 */
export async function fetchLeadKeysWithPaymentRequestEmail(
  keys: PaymentRequestLeadKey[],
): Promise<Set<string>> {
  const sent = new Set<string>();
  if (!keys.length) return sent;

  const enriched = await enrichPaymentRequestKeys(keys);
  const foundLeadKeys = new Set<string>();
  const foundContacts = new Set<string>();

  const newIds = [...new Set(enriched.filter((k) => k.kind === 'new').map((k) => k.id))];
  const legacyIds = [
    ...new Set(
      enriched.flatMap((k) => {
        if (k.kind !== 'legacy') return [];
        return [k.id, k.masterId].filter((id): id is string => Boolean(id));
      }),
    ),
  ];
  const contactIds = [
    ...new Set(enriched.map((k) => contactKey(k.contactId)).filter((id): id is string => Boolean(id))),
  ];

  const names = await fetchPaymentRequestTemplateNames();
  const subjectOr = names.map((name) => `subject.ilike.%${name.replace(/[%(),]/g, '')}%`).join(',');

  const runChunked = async (ids: Array<string | number>, column: 'client_id' | 'legacy_id' | 'contact_id') => {
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      if (!chunk.length) continue;
      addEmailHits(await queryOutgoingPaymentRequestEmails(column, chunk, subjectOr), foundLeadKeys, foundContacts);
    }
  };

  await runChunked(newIds, 'client_id');
  await runChunked(
    legacyIds.map((id) => Number(id)).filter((id) => Number.isFinite(id)),
    'legacy_id',
  );
  await runChunked(
    contactIds.map((id) => Number(id)).filter((id) => Number.isFinite(id)),
    'contact_id',
  );
  await fetchLeadKeysWithPaymentRequestWhatsApp(newIds, legacyIds, contactIds, foundLeadKeys, foundContacts);

  for (const key of enriched) {
    const self = emailLeadKey(key.kind, key.id);
    if (foundLeadKeys.has(self)) {
      sent.add(self);
      continue;
    }
    if (key.masterId && foundLeadKeys.has(emailLeadKey('legacy', key.masterId))) {
      sent.add(self);
      continue;
    }
    const contact = contactKey(key.contactId);
    if (contact && foundContacts.has(contact)) sent.add(self);
  }

  return sent;
}

export async function countSignedLeadsMissingPaymentPlan(): Promise<number> {
  try {
    const range = last30DaysRange();
    const [stageRows, newPlans, legacyPlans] = await Promise.all([
      fetchStage60RecordsInRange(range.from, range.to),
      fetchAllPaged<{ lead_id: string | null }>((from, to) =>
        supabase.from('payment_plans').select('lead_id').is('cancel_date', null).range(from, to),
      ).catch(() => []),
      fetchAllPaged<{ lead_id: string | number | null }>((from, to) =>
        supabase.from('finances_paymentplanrow').select('lead_id').is('cancel_date', null).range(from, to),
      ).catch(() => []),
    ]);

    const signedNew = new Set<string>();
    const signedLegacy = new Set<string>();
    for (const row of stageRows) {
      if (row.newlead_id) signedNew.add(String(row.newlead_id));
      if (row.lead_id != null && Number.isFinite(Number(row.lead_id))) {
        signedLegacy.add(String(row.lead_id));
      }
    }

    const withPlanNew = new Set<string>();
    const withPlanLegacy = new Set<string>();
    for (const row of newPlans) {
      if (row.lead_id) withPlanNew.add(String(row.lead_id));
    }
    for (const row of legacyPlans) {
      if (row.lead_id != null && String(row.lead_id).trim()) {
        withPlanLegacy.add(String(row.lead_id).replace(/^legacy_?/i, ''));
      }
    }

    let missing = 0;
    for (const id of signedNew) {
      if (!withPlanNew.has(id)) missing += 1;
    }
    for (const id of signedLegacy) {
      if (!withPlanLegacy.has(id)) missing += 1;
    }
    return missing;
  } catch (err) {
    console.warn('countSignedLeadsMissingPaymentPlan:', err);
    return 0;
  }
}

type DueCollectionRow = {
  kind: 'new' | 'legacy';
  leadId: string;
  clientId: string | number | null;
  orderCode: string;
  hasProforma: boolean;
  invoiceSent: boolean;
};

function normalizeDueOrderCode(order: string | number | null | undefined): string {
  if (order == null) return '';
  const raw = String(order).trim();
  if (!raw) return '';
  if (!Number.isNaN(Number(raw))) return raw;
  switch (raw.toLowerCase()) {
    case 'first payment':
      return '1';
    case 'intermediate payment':
      return '5';
    case 'final payment':
      return '9';
    case 'single payment':
      return '90';
    case 'expense (no vat)':
      return '99';
    default:
      return raw;
  }
}

function rowHasInvoiceSentFlag(row: {
  invoice_sent?: unknown;
  invoice_sent_at?: unknown;
  invoice_send_automation_sent_at?: unknown;
}): boolean {
  return Boolean(row.invoice_sent) || Boolean(row.invoice_sent_at) || Boolean(row.invoice_send_automation_sent_at);
}

/** Same per-contact collapse Collection uses when Due date included is on. */
function dedupeDueRowsByContact<T extends { leadId: string; clientId: string | number | null; orderCode: string }>(
  rows: T[],
): T[] {
  const orderRank: Record<string, number> = { '9': 3, '5': 2, '1': 1, '90': 0, '99': 0 };
  const byContact = new Map<string, T>();
  for (const row of rows) {
    const key = row.clientId != null ? `${row.leadId}_${row.clientId}` : row.leadId;
    const existing = byContact.get(key);
    const rank = orderRank[row.orderCode] ?? -1;
    const existingRank = existing ? (orderRank[existing.orderCode] ?? -1) : -1;
    if (!existing || rank > existingRank) byContact.set(key, row);
  }
  return Array.from(byContact.values());
}

async function fetchLegacyProformaMaps(legacyLeadIds: number[]): Promise<{
  byPpr: Set<number>;
  leadLevel: Set<string>;
}> {
  const byPpr = new Set<number>();
  const leadLevel = new Set<string>();
  for (let i = 0; i < legacyLeadIds.length; i += 400) {
    const batch = legacyLeadIds.slice(i, i + 400);
    if (!batch.length) continue;
    const { data } = await supabase
      .from('proformainvoice')
      .select('ppr_id, lead_id, client_id')
      .in('lead_id', batch)
      .is('cxd_date', null);
    for (const invoice of data || []) {
      const pprId = Number(invoice.ppr_id);
      if (invoice.ppr_id != null && Number.isFinite(pprId)) byPpr.add(pprId);
      else if (invoice.lead_id != null) {
        const leadId = String(invoice.lead_id);
        const clientId = invoice.client_id != null ? String(invoice.client_id) : 'any';
        leadLevel.add(`${leadId}_${clientId}`);
      }
    }
  }
  return { byPpr, leadLevel };
}

/** Unpaid due rows in the last 30 days, using Collection proforma + invoice-sent rules. */
async function fetchDueUnpaidRowsLast30Days(): Promise<DueCollectionRow[]> {
  const { from, to } = last30DaysRange();
  const [modern, legacy] = await Promise.all([
    fetchAllPaged<any>((fromIdx, toIdx) =>
      supabase
        .from('payment_plans')
        .select(
          'id, lead_id, paid, paid_at, proforma, ready_to_pay, due_date, cancel_date, payment_order, invoice_sent, invoice_sent_at, invoice_send_automation_sent_at',
        )
        .is('cancel_date', null)
        .eq('ready_to_pay', true)
        .not('due_date', 'is', null)
        .gte('due_date', from)
        .lte('due_date', to)
        .or('paid.is.null,paid.eq.false')
        .range(fromIdx, toIdx),
    ).catch(() => []),
    fetchAllPaged<any>((fromIdx, toIdx) =>
      supabase
        .from('finances_paymentplanrow')
        .select(
          'id, lead_id, client_id, actual_date, due_date, cancel_date, order, invoice_sent, invoice_sent_at, invoice_send_automation_sent_at',
        )
        .is('cancel_date', null)
        .not('due_date', 'is', null)
        .gte('due_date', from)
        .lte('due_date', to)
        .is('actual_date', null)
        .range(fromIdx, toIdx),
    ).catch(() => []),
  ]);

  const rows: DueCollectionRow[] = [];
  for (const row of modern) {
    if (row.cancel_date) continue;
    if (isPaymentPaid(row)) continue;
    if (!row.lead_id) continue;
    rows.push({
      kind: 'new',
      leadId: String(row.lead_id),
      clientId: null,
      orderCode: normalizeDueOrderCode(row.payment_order),
      hasProforma: hasProformaValue(row.proforma),
      invoiceSent: rowHasInvoiceSentFlag(row),
    });
  }

  const unpaidLegacy = legacy.filter((row) => !isPaymentPaid(row) && row.lead_id != null);
  const legacyLeadIds = [
    ...new Set(
      unpaidLegacy
        .map((row) => Number(String(row.lead_id).replace(/^legacy_?/i, '')))
        .filter((id) => Number.isFinite(id)),
    ),
  ];
  const { byPpr, leadLevel } = await fetchLegacyProformaMaps(legacyLeadIds);
  for (const row of unpaidLegacy) {
    const leadId = String(row.lead_id).replace(/^legacy_?/i, '');
    rows.push({
      kind: 'legacy',
      leadId,
      clientId: row.client_id ?? null,
      orderCode: normalizeDueOrderCode(row.order),
      hasProforma: legacyRowHasProforma(row, byPpr, leadLevel),
      invoiceSent: rowHasInvoiceSentFlag(row),
    });
  }

  return rows;
}

function legacyRowHasProforma(
  row: { id?: unknown; lead_id?: unknown; client_id?: unknown },
  byPpr: Set<number>,
  leadLevel: Set<string>,
): boolean {
  const pprId = Number(row.id);
  if (Number.isFinite(pprId) && byPpr.has(pprId)) return true;
  const leadId = String(row.lead_id ?? '').replace(/^legacy_?/i, '');
  if (!leadId) return false;
  const clientId = row.client_id != null && String(row.client_id).trim() ? String(row.client_id) : null;
  if (clientId && leadLevel.has(`${leadId}_${clientId}`)) return true;
  return leadLevel.has(`${leadId}_any`);
}

export type DueLast30DayFocusCounts = {
  noProforma: number;
  unsent: number;
  sent: number;
};

/** Shared last-30-days due counts that match Collection filters (filter first, then one row per contact). */
export async function countDueLast30DayFocus(): Promise<DueLast30DayFocusCounts> {
  const empty: DueLast30DayFocusCounts = { noProforma: 0, unsent: 0, sent: 0 };
  try {
    const rows = await fetchDueUnpaidRowsLast30Days();
    const marked = await applyInvoiceSentFromPaymentRequest(
      rows.map((row) => ({
        leadId: row.kind === 'legacy' ? `legacy_${row.leadId}` : row.leadId,
        leadType: row.kind,
        clientId: row.clientId,
        collected: false,
        hasProforma: row.hasProforma,
        invoiceSent: row.invoiceSent,
        orderCode: row.orderCode,
      })),
    );

    return {
      noProforma: dedupeDueRowsByContact(marked.filter((row) => !row.hasProforma)).length,
      unsent: dedupeDueRowsByContact(marked.filter((row) => row.hasProforma && !row.invoiceSent)).length,
      sent: dedupeDueRowsByContact(marked.filter((row) => row.hasProforma && row.invoiceSent)).length,
    };
  } catch (err) {
    console.warn('countDueLast30DayFocus:', err);
    return empty;
  }
}

/** Due unpaid rows in the last 30 days with a due date and no proforma created. */
export async function countDueNoProformaLast30Days(): Promise<number> {
  const counts = await countDueLast30DayFocus();
  return counts.noProforma;
}

/** Due unpaid rows in the last 30 days that have a proforma but no payment-request email or WhatsApp. */
export async function countDueUnsentProformaThisWeek(): Promise<number> {
  const counts = await countDueLast30DayFocus();
  return counts.unsent;
}

/** Due unpaid rows in the last 30 days that have a proforma already sent. */
export async function countDuePendingProformaSentLast30Days(): Promise<number> {
  const counts = await countDueLast30DayFocus();
  return counts.sent;
}

function paymentRowsToLookupKeys<
  T extends { leadId?: string | null; leadType?: 'new' | 'legacy'; clientId?: string | number | null },
>(rows: T[]): PaymentRequestLeadKey[] {
  return rows
    .map((row) => {
      const key = paymentRowEmailLeadKey(row);
      if (!key) return null;
      const [kind, id] = key.split(':') as ['new' | 'legacy', string];
      if (!id) return null;
      return {
        kind,
        id,
        contactId: row.clientId ?? null,
      } satisfies PaymentRequestLeadKey;
    })
    .filter((row): row is PaymentRequestLeadKey => Boolean(row));
}

export async function filterPaymentRowsByProformaEmail<
  T extends { leadId?: string | null; leadType?: 'new' | 'legacy'; clientId?: string | number | null },
>(rows: T[], mode: 'any' | 'not_sent' | 'sent'): Promise<T[]> {
  if (mode === 'any' || !rows.length) return rows;
  const sent = await fetchLeadKeysWithPaymentRequestEmail(paymentRowsToLookupKeys(rows));
  return rows.filter((row) => {
    const key = paymentRowEmailLeadKey(row);
    if (!key) return mode === 'not_sent';
    const hasEmail = sent.has(key);
    return mode === 'sent' ? hasEmail : !hasEmail;
  });
}

/** Mark unpaid proforma rows as invoice-sent when email/WhatsApp already went out (including legacy sub-leads). */
export async function applyInvoiceSentFromPaymentRequest<
  T extends {
    leadId?: string | null;
    leadType?: 'new' | 'legacy';
    clientId?: string | number | null;
    collected?: boolean;
    hasProforma?: boolean;
    invoiceSent?: boolean;
  },
>(rows: T[]): Promise<T[]> {
  const pending = rows.filter((row) => !row.collected && row.hasProforma && !row.invoiceSent);
  if (!pending.length) return rows;
  const sent = await fetchLeadKeysWithPaymentRequestEmail(paymentRowsToLookupKeys(pending));
  if (!sent.size) return rows;
  return rows.map((row) => {
    if (row.invoiceSent || row.collected || !row.hasProforma) return row;
    const key = paymentRowEmailLeadKey(row);
    return key && sent.has(key) ? { ...row, invoiceSent: true } : row;
  });
}
