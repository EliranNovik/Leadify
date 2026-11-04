/**
 * AI chat payment reminders: unpaid rows whose proforma/invoice was already sent,
 * then WhatsApp templates 53 (Hebrew) / 52 (all other languages).
 */
import { supabase } from './supabase';
import { buildApiUrl } from './api';
import {
  buildPublicProformaUrl,
  ensureLegacyProformaPublicToken,
  ensureNewProformaPublicToken,
} from './proformaPublicLink';
import { ensurePaymentLinkUrlForInvoice } from './proformaPaymentLink';
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
import { resolvePaymentPlanContact } from './resolvePaymentPlanContact';
import { formatLeadMoneyAmount } from './leadCurrencyDisplay';
import { HEBREW_LANGUAGE_ID } from './bulkMeetingReminders';
import {
  looksLikeLeadNumberQuery,
  matchesLeadNumberOrName,
  normalizeLeadNumberToken,
} from './rmqAiChatContext';

export const PAYMENT_REMINDER_WHATSAPP_TEMPLATE_ID_HE = 53;
export const PAYMENT_REMINDER_WHATSAPP_TEMPLATE_ID_OTHER = 52;

export type PaymentReminderPeriodPreset = 'today' | 'yesterday' | 'last_week' | 'custom';

export type PaymentReminderRow = {
  id: string;
  kind: 'new' | 'legacy';
  recordId: string;
  leadId: string;
  leadNumber: string;
  name: string;
  amount: number;
  currency: string;
  amountLabel: string;
  dueDate: string;
  dueLabel: string;
  invoiceAt: string;
  invoiceLabel: string;
  clientId: number | null;
  language: string;
  languageId: number | null;
  templateId: number;
  reminderSentCount: number;
  reminderSentAt: string | null;
  reminderSentLabel: string | null;
};

export type PaymentReminderSendResult = {
  id: string;
  leadNumber: string;
  name: string;
  ok: boolean;
  phone?: string;
  error?: string;
  templateId?: number;
  /** True when this row was not messaged because another selected row already covered the same contact. */
  skippedDuplicate?: boolean;
};

/** Map DB reminder stamp columns onto UI / report payment rows. */
export function paymentReminderSentFields(row: {
  payment_reminder_sent_count?: unknown;
  payment_reminder_sent_at?: unknown;
} | null | undefined): {
  payment_reminder_sent_count: number;
  payment_reminder_sent_at: string | null;
} {
  const raw = Number(row?.payment_reminder_sent_count);
  const count = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
  const at = row?.payment_reminder_sent_at ? String(row.payment_reminder_sent_at) : null;
  return {
    payment_reminder_sent_count: count,
    payment_reminder_sent_at: at,
  };
}

function paymentReminderContactDedupeKey(opts: {
  contactId: number | null;
  phone: string;
  leadId: string;
  clientId: number | null;
}): string {
  if (opts.contactId != null && Number.isFinite(opts.contactId)) {
    return `cid:${opts.contactId}`;
  }
  if (opts.phone) return `phone:${opts.phone}`;
  if (opts.clientId != null && Number.isFinite(opts.clientId)) {
    return `lead:${opts.leadId}:client:${opts.clientId}`;
  }
  return `lead:${opts.leadId}`;
}

/** Increment reminder count and set latest send time on every stamped payment row. */
export async function stampPaymentReminderSent(rows: PaymentReminderRow[]): Promise<void> {
  if (!rows.length) return;
  const now = new Date().toISOString();
  const newIds = [
    ...new Set(rows.filter((row) => row.kind === 'new').map((row) => row.recordId).filter(Boolean)),
  ];
  const legacyIds = [
    ...new Set(
      rows
        .filter((row) => row.kind === 'legacy')
        .map((row) => Number(row.recordId))
        .filter((id) => Number.isFinite(id)),
    ),
  ];

  if (newIds.length) {
    const { data } = await supabase
      .from('payment_plans')
      .select('id, payment_reminder_sent_count')
      .in('id', newIds);
    const countById = new Map(
      (data || []).map((row) => [String(row.id), Number(row.payment_reminder_sent_count) || 0]),
    );
    await Promise.all(
      newIds.map((id) =>
        supabase
          .from('payment_plans')
          .update({
            payment_reminder_sent_count: (countById.get(String(id)) || 0) + 1,
            payment_reminder_sent_at: now,
          })
          .eq('id', id),
      ),
    );
  }

  if (legacyIds.length) {
    const { data } = await supabase
      .from('finances_paymentplanrow')
      .select('id, payment_reminder_sent_count')
      .in('id', legacyIds);
    const countById = new Map(
      (data || []).map((row) => [String(row.id), Number(row.payment_reminder_sent_count) || 0]),
    );
    await Promise.all(
      legacyIds.map((id) =>
        supabase
          .from('finances_paymentplanrow')
          .update({
            payment_reminder_sent_count: (countById.get(String(id)) || 0) + 1,
            payment_reminder_sent_at: now,
          })
          .eq('id', id),
      ),
    );
  }
}

function jerusalemTodayIso(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function addIsoDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
}

function normalizeDay(raw: string): string {
  const value = String(raw || '').trim();
  const lower = value.toLowerCase();
  if (!value || lower === 'today') return jerusalemTodayIso();
  if (lower === 'yesterday') return addIsoDays(jerusalemTodayIso(), -1);
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = value.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (dmy) {
    const day = dmy[1].padStart(2, '0');
    const month = dmy[2].padStart(2, '0');
    const year = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
    return `${year}-${month}-${day}`;
  }
  return value;
}

function jerusalemDateKey(value: string): string {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value).slice(0, 10);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(parsed);
}

function jerusalemLabel(value: string): string {
  if (!value) return '—';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-');
    return `${day}/${month}/${year}`;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return jerusalemDateKey(value) || '—';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(parsed);
}

function inJerusalemDateRange(value: string, from: string, to: string): boolean {
  const key = jerusalemDateKey(value);
  return Boolean(key && key >= from && key <= to);
}

function parseMoney(value: unknown): number {
  const n = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function invoiceSentAtRaw(row: {
  invoice_sent_at?: unknown;
  invoice_send_automation_sent_at?: unknown;
}): string {
  return (
    String(row.invoice_sent_at || '').trim() ||
    String(row.invoice_send_automation_sent_at || '').trim()
  );
}

function invoiceWasSent(row: {
  invoice_sent?: unknown;
  invoice_sent_at?: unknown;
  invoice_send_automation_sent_at?: unknown;
}): boolean {
  return (
    Boolean(row.invoice_sent) ||
    Boolean(row.invoice_sent_at) ||
    Boolean(row.invoice_send_automation_sent_at)
  );
}

function legacyCurrencyCode(row: { accounting_currencies?: unknown }): string {
  const nested = row.accounting_currencies as
    | { iso_code?: string; name?: string }
    | Array<{ iso_code?: string; name?: string }>
    | null
    | undefined;
  const currency = Array.isArray(nested) ? nested[0] : nested;
  return String(currency?.iso_code || currency?.name || '').trim();
}

export function resolvePaymentReminderDateRange(args: {
  period?: string;
  date?: string;
  date_from?: string;
  date_to?: string;
}): { from: string; to: string; label: string } {
  const period = String(args.period || args.date || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
  const fromRaw = String(args.date_from || '').trim();
  const toRaw = String(args.date_to || '').trim();

  if (fromRaw || toRaw) {
    const from = normalizeDay(fromRaw || toRaw);
    const to = normalizeDay(toRaw || fromRaw);
    const start = from <= to ? from : to;
    const end = from <= to ? to : from;
    return {
      from: start,
      to: end,
      label:
        start === end
          ? jerusalemLabel(start)
          : `${jerusalemLabel(start)}–${jerusalemLabel(end)}`,
    };
  }

  const today = jerusalemTodayIso();
  if (period === 'yesterday') {
    const day = addIsoDays(today, -1);
    return { from: day, to: day, label: jerusalemLabel(day) };
  }
  if (period === 'last_week' || period === 'lastweek') {
    const to = today;
    const from = addIsoDays(today, -6);
    return { from, to, label: `${jerusalemLabel(from)}–${jerusalemLabel(to)}` };
  }
  if (period && period !== 'today') {
    const day = normalizeDay(period);
    return { from: day, to: day, label: jerusalemLabel(day) };
  }
  return { from: today, to: today, label: jerusalemLabel(today) };
}

function isHebrewLead(language: string | null | undefined, languageId: number | null): boolean {
  if (languageId != null && Number(languageId) === HEBREW_LANGUAGE_ID) return true;
  const name = String(language || '').toLowerCase();
  return name.includes('hebrew') || name.includes('עברית') || name === 'he' || name === 'heb';
}

export function paymentReminderTemplateIdForLead(
  language: string | null | undefined,
  languageId: number | null,
): number {
  return isHebrewLead(language, languageId)
    ? PAYMENT_REMINDER_WHATSAPP_TEMPLATE_ID_HE
    : PAYMENT_REMINDER_WHATSAPP_TEMPLATE_ID_OTHER;
}

async function fetchRowsInChunks<T>(
  ids: Array<string | number>,
  load: (chunk: Array<string | number>) => Promise<T[]>,
  chunkSize = 120,
): Promise<T[]> {
  const rows: T[] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    rows.push(...(await load(ids.slice(i, i + chunkSize))));
  }
  return rows;
}

async function resolveLeadIdsForQuery(query: string): Promise<{
  newLeadIds: string[];
  legacyLeadIds: number[];
}> {
  const raw = String(query || '').trim();
  if (!raw || !looksLikeLeadNumberQuery(raw)) {
    return { newLeadIds: [], legacyLeadIds: [] };
  }
  const token = normalizeLeadNumberToken(raw);
  const withL = `L${token}`;
  const variants = [...new Set([raw, token, withL, `l${token}`, token.toUpperCase()])];
  const orFilter = variants.map((value) => `lead_number.eq.${value}`).join(',');

  const [{ data: newLeads }, { data: legacyLeads }] = await Promise.all([
    supabase.from('leads').select('id, lead_number').or(orFilter).limit(20),
    supabase.from('leads_lead').select('id, lead_number').or(orFilter).limit(20),
  ]);

  // Also catch stored values that only match after stripping L/C.
  const extraNew =
    !newLeads?.length && token
      ? (
          await supabase
            .from('leads')
            .select('id, lead_number')
            .or(`lead_number.ilike.%${token}%,lead_number.ilike.L${token}%`)
            .limit(20)
        ).data || []
      : [];
  const extraLegacy =
    !legacyLeads?.length && token
      ? (
          await supabase
            .from('leads_lead')
            .select('id, lead_number')
            .or(`lead_number.ilike.%${token}%,lead_number.ilike.L${token}%`)
            .limit(20)
        ).data || []
      : [];

  const matchedNew = [...(newLeads || []), ...extraNew].filter((lead) =>
    matchesLeadNumberOrName(lead.lead_number, '', raw),
  );
  const matchedLegacy = [...(legacyLeads || []), ...extraLegacy].filter((lead) =>
    matchesLeadNumberOrName(lead.lead_number, '', raw),
  );

  return {
    newLeadIds: [...new Set(matchedNew.map((lead) => String(lead.id)))],
    legacyLeadIds: [
      ...new Set(
        matchedLegacy
          .map((lead) => Number(lead.id))
          .filter((id) => Number.isFinite(id)),
      ),
    ],
  };
}

export async function listPaymentReminderCandidates(args: {
  period?: string;
  date?: string;
  date_from?: string;
  date_to?: string;
  query?: string;
}): Promise<{ period: string; rows: PaymentReminderRow[] }> {
  const nameFilter = String(args.query || '').trim();
  const leadScoped = looksLikeLeadNumberQuery(nameFilter);
  const hasPeriodArgs = Boolean(
    String(args.period || '').trim() ||
      String(args.date || '').trim() ||
      String(args.date_from || '').trim() ||
      String(args.date_to || '').trim(),
  );
  // Single-lead reminds: all unpaid invoiced rows for that lead (ignore default "today").
  const range =
    leadScoped && !hasPeriodArgs
      ? { from: '1970-01-01', to: '2999-12-31', label: `lead ${nameFilter}` }
      : resolvePaymentReminderDateRange(args);
  const resolvedLeads = leadScoped
    ? await resolveLeadIdsForQuery(nameFilter)
    : { newLeadIds: [] as string[], legacyLeadIds: [] as number[] };
  const start = `${range.from}T00:00:00+02:00`;
  const end = `${addIsoDays(range.to, 1)}T00:00:00+03:00`;
  const invoiceDayOr = `and(invoice_sent_at.gte.${start},invoice_sent_at.lt.${end}),and(invoice_send_automation_sent_at.gte.${start},invoice_send_automation_sent_at.lt.${end})`;

  let newQuery = supabase
    .from('payment_plans')
    .select(
      'id, lead_id, value, value_vat, currency, due_date, paid, paid_at, cancel_date, client_id, client_name, invoice_sent, invoice_sent_at, invoice_send_automation_sent_at, payment_reminder_sent_count, payment_reminder_sent_at',
    )
    .is('cancel_date', null)
    .is('paid_at', null)
    .not('paid', 'eq', true)
    .order('invoice_sent_at', { ascending: false })
    .limit(500);

  let legacyQuery = supabase
    .from('finances_paymentplanrow')
    .select(
      'id, lead_id, value, value_base, vat_value, currency_id, due_date, actual_date, cancel_date, client_id, invoice_sent, invoice_sent_at, invoice_send_automation_sent_at, payment_reminder_sent_count, payment_reminder_sent_at, accounting_currencies!finances_paymentplanrow_currency_id_fkey(name, iso_code)',
    )
    .is('cancel_date', null)
    .is('actual_date', null)
    .order('invoice_sent_at', { ascending: false })
    .limit(500);

  // Specific lead: load that lead's unpaid invoiced rows (any send day). Period lists stay date-scoped.
  if (leadScoped && resolvedLeads.newLeadIds.length) {
    newQuery = newQuery.in('lead_id', resolvedLeads.newLeadIds);
  } else if (!leadScoped) {
    newQuery = newQuery.or(invoiceDayOr);
  } else {
    newQuery = newQuery.or(invoiceDayOr);
  }

  if (leadScoped && resolvedLeads.legacyLeadIds.length) {
    legacyQuery = legacyQuery.in('lead_id', resolvedLeads.legacyLeadIds);
  } else {
    legacyQuery = legacyQuery.or(invoiceDayOr);
  }

  const [{ data: newRows, error: newError }, { data: legacyRows, error: legacyError }] =
    await Promise.all([newQuery, legacyQuery]);

  if (newError && legacyError) {
    throw new Error(newError.message || legacyError.message || 'Failed to load payment rows');
  }

  const newLeadIds = [
    ...new Set(
      [
        ...resolvedLeads.newLeadIds,
        ...(newRows || []).map((row) => String(row.lead_id || '')).filter(Boolean),
      ],
    ),
  ];
  const legacyLeadIds = [
    ...new Set([
      ...resolvedLeads.legacyLeadIds,
      ...(legacyRows || [])
        .map((row) => Number(row.lead_id))
        .filter((id) => Number.isFinite(id)),
    ]),
  ];

  const [newLeads, legacyLeads] = await Promise.all([
    newLeadIds.length
      ? fetchRowsInChunks(newLeadIds, async (chunk) => {
          const { data } = await supabase
            .from('leads')
            .select('id, name, lead_number, language, language_id')
            .in('id', chunk);
          return data || [];
        })
      : Promise.resolve([]),
    legacyLeadIds.length
      ? fetchRowsInChunks(legacyLeadIds, async (chunk) => {
          const { data } = await supabase
            .from('leads_lead')
            .select('id, name, lead_number, language, language_id')
            .in('id', chunk);
          return data || [];
        })
      : Promise.resolve([]),
  ]);

  const newLeadById = new Map(newLeads.map((lead) => [String(lead.id), lead]));
  const legacyLeadById = new Map(legacyLeads.map((lead) => [String(lead.id), lead]));

  const rows: PaymentReminderRow[] = [];

  for (const row of newRows || []) {
    if (row.paid || row.paid_at || row.cancel_date || !invoiceWasSent(row)) continue;
    const invoiceAt = invoiceSentAtRaw(row);
    if (!leadScoped && (!invoiceAt || !inJerusalemDateRange(invoiceAt, range.from, range.to))) {
      continue;
    }
    const lead = newLeadById.get(String(row.lead_id || ''));
    const name = String(lead?.name || row.client_name || '');
    const leadNumber = String(lead?.lead_number || '');
    if (nameFilter && !matchesLeadNumberOrName(leadNumber, name, nameFilter)) {
      continue;
    }
    const amount = parseMoney(row.value) + parseMoney(row.value_vat);
    const currency = String(row.currency || '');
    const language = String(lead?.language || '');
    const languageId = lead?.language_id != null ? Number(lead.language_id) : null;
    const dueDate = String(row.due_date || '').slice(0, 10);
    const reminder = paymentReminderSentFields(row);
    rows.push({
      id: `new-${row.id}`,
      kind: 'new',
      recordId: String(row.id),
      leadId: String(row.lead_id || ''),
      leadNumber,
      name,
      amount,
      currency,
      amountLabel: amount ? formatLeadMoneyAmount(amount, currency) : '—',
      dueDate,
      dueLabel: dueDate ? jerusalemLabel(dueDate) : '—',
      invoiceAt,
      invoiceLabel: jerusalemLabel(invoiceAt),
      clientId: row.client_id != null ? Number(row.client_id) : null,
      language,
      languageId: Number.isFinite(languageId as number) ? languageId : null,
      templateId: paymentReminderTemplateIdForLead(language, languageId),
      reminderSentCount: reminder.payment_reminder_sent_count,
      reminderSentAt: reminder.payment_reminder_sent_at,
      reminderSentLabel: reminder.payment_reminder_sent_at
        ? jerusalemLabel(reminder.payment_reminder_sent_at)
        : null,
    });
  }

  for (const row of legacyRows || []) {
    if (row.actual_date || row.cancel_date || !invoiceWasSent(row)) continue;
    const invoiceAt = invoiceSentAtRaw(row);
    if (!leadScoped && (!invoiceAt || !inJerusalemDateRange(invoiceAt, range.from, range.to))) {
      continue;
    }
    const lead = legacyLeadById.get(String(row.lead_id || ''));
    const name = String(lead?.name || '');
    const leadNumber = String(lead?.lead_number || row.lead_id || '');
    if (nameFilter && !matchesLeadNumberOrName(leadNumber, name, nameFilter)) {
      continue;
    }
    const amount = parseMoney(row.value) || parseMoney(row.value_base) + parseMoney(row.vat_value);
    const currency = legacyCurrencyCode(row);
    const language = String(lead?.language || '');
    const languageId = lead?.language_id != null ? Number(lead.language_id) : null;
    const dueDate = String(row.due_date || '').slice(0, 10);
    const reminder = paymentReminderSentFields(row);
    rows.push({
      id: `legacy-${row.id}`,
      kind: 'legacy',
      recordId: String(row.id),
      leadId: String(row.lead_id || ''),
      leadNumber,
      name,
      amount,
      currency,
      amountLabel: amount ? formatLeadMoneyAmount(amount, currency) : '—',
      dueDate,
      dueLabel: dueDate ? jerusalemLabel(dueDate) : '—',
      invoiceAt,
      invoiceLabel: jerusalemLabel(invoiceAt),
      clientId: row.client_id != null ? Number(row.client_id) : null,
      language,
      languageId: Number.isFinite(languageId as number) ? languageId : null,
      templateId: paymentReminderTemplateIdForLead(language, languageId),
      reminderSentCount: reminder.payment_reminder_sent_count,
      reminderSentAt: reminder.payment_reminder_sent_at,
      reminderSentLabel: reminder.payment_reminder_sent_at
        ? jerusalemLabel(reminder.payment_reminder_sent_at)
        : null,
    });
  }

  rows.sort((a, b) => String(b.invoiceAt).localeCompare(String(a.invoiceAt)));
  return { period: range.label, rows };
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

async function fetchReminderTemplate(templateId: number): Promise<{
  id: number;
  name: string;
  language: string | null;
  content: string | null;
  params: number | string | null;
}> {
  const { data, error } = await supabase
    .from('whatsapp_templates_v2')
    .select('id, name, language, content, params, active')
    .eq('id', templateId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load WhatsApp template ${templateId}: ${error.message}`);
  if (!data) throw new Error(`WhatsApp template id ${templateId} was not found.`);
  if (!data.active) throw new Error(`WhatsApp template id ${templateId} ("${data.name}") is not active.`);
  return data as {
    id: number;
    name: string;
    language: string | null;
    content: string | null;
    params: number | string | null;
  };
}

async function resolveReminderPhone(row: PaymentReminderRow): Promise<{
  phone: string;
  contactId: number | null;
  contactName: string;
}> {
  const contact = await resolvePaymentPlanContact({
    leadId: row.leadId,
    clientId: row.clientId,
    clientNameFallback: row.name,
    leadNameFallback: row.name,
  });
  let phone = normalizePhoneForWhatsApp(contact.phone);
  if (!phone && contact.contactId != null) {
    const { data: legacyContact } = await supabase
      .from('leads_contact')
      .select('phone, mobile')
      .eq('id', contact.contactId)
      .maybeSingle();
    phone = normalizePhoneForWhatsApp(
      pickWhatsAppPhoneFromContactFields(legacyContact?.phone, legacyContact?.mobile) || '',
    );
    if (!phone) {
      const { data: newContact } = await supabase
        .from('contacts')
        .select('phone, mobile')
        .eq('id', contact.contactId)
        .maybeSingle();
      phone = normalizePhoneForWhatsApp(
        pickWhatsAppPhoneFromContactFields(newContact?.phone, newContact?.mobile) || '',
      );
    }
  }
  if (!phone) {
    throw new Error('No phone number on the payment contact');
  }
  return { phone, contactId: contact.contactId, contactName: contact.name || row.name };
}

async function resolveProformaPublicUrl(row: PaymentReminderRow): Promise<string> {
  try {
    if (row.kind === 'new') {
      const token = await ensureNewProformaPublicToken(row.recordId);
      return buildPublicProformaUrl('new', row.recordId, token);
    }
    const pprId = Number(row.recordId);
    const leadId = Number(row.leadId);
    let query = supabase
      .from('proformainvoice')
      .select('id')
      .eq('ppr_id', pprId)
      .is('cxd_date', null)
      .limit(1)
      .maybeSingle();
    const { data: byPpr } = await query;
    const proformaId = byPpr?.id;
    if (proformaId == null && Number.isFinite(leadId)) {
      const { data: byLead } = await supabase
        .from('proformainvoice')
        .select('id')
        .eq('lead_id', leadId)
        .is('cxd_date', null)
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (byLead?.id == null) return '';
      const token = await ensureLegacyProformaPublicToken(byLead.id);
      return buildPublicProformaUrl('legacy', byLead.id, token);
    }
    if (proformaId == null) return '';
    const token = await ensureLegacyProformaPublicToken(proformaId);
    return buildPublicProformaUrl('legacy', proformaId, token);
  } catch {
    return '';
  }
}

export async function sendPaymentReminderWhatsApp(
  row: PaymentReminderRow,
): Promise<PaymentReminderSendResult> {
  try {
    const templateId = row.templateId || paymentReminderTemplateIdForLead(row.language, row.languageId);
    const template = await fetchReminderTemplate(templateId);
    const { phone, contactId, contactName } = await resolveReminderPhone(row);
    const senderName = await resolveSenderName();
    const publicUrl = await resolveProformaPublicUrl(row);
    const paymentLinkUrl =
      (await ensurePaymentLinkUrlForInvoice({
        paymentPlanId: row.kind === 'new' ? row.recordId : null,
        leadId: row.leadId,
        isLegacyLead: row.kind === 'legacy',
        kind: row.kind,
        clientName: row.name,
        leadNumber: row.leadNumber,
        contactId,
      })) || '';

    const proformaContext: ProformaWhatsAppParamContext = {
      invoiceLink: publicUrl,
      paymentLink: paymentLinkUrl,
      leadNumber: row.leadNumber,
      paymentPlanId: row.kind === 'new' ? row.recordId : null,
    };
    const clientForParams = {
      id: row.kind === 'legacy' ? `legacy_${row.leadId}` : row.leadId,
      lead_type: row.kind === 'legacy' ? 'legacy' : 'new',
      name: contactName || row.name,
      lead_id: row.leadId,
      lead_number: row.leadNumber,
      proformaPublicUrl: publicUrl,
      proformaLeadNumber: row.leadNumber,
      paymentLinkUrl,
      paymentPlanId: row.kind === 'new' ? row.recordId : null,
    };

    const paramCount = Number(template.params) || 0;
    let templateParameters: Array<{ type: string; text: string }> = [];
    if (paramCount > 0) {
      const paramDefinitions = await getTemplateParamDefinitions(template.id, template.name);
      if (paramDefinitions.length > 0) {
        templateParameters = await generateParamsFromDefinitions(
          paramDefinitions,
          clientForParams,
          contactId,
          proformaContext,
        );
      }
      while (templateParameters.length < paramCount) {
        templateParameters.push({ type: 'text', text: '' });
      }
      templateParameters = templateParameters.map((param) => ({
        type: 'text',
        text: (param.text || '').trim(),
      }));
    }

    let filledContent = template.content || '';
    templateParameters.forEach((param, index) => {
      if (param?.text) {
        filledContent = filledContent.replace(
          new RegExp(`\\{\\{${index + 1}\\}\\}`, 'g'),
          param.text,
        );
      }
    });

    const leadIdForApi =
      row.kind === 'legacy'
        ? `legacy_${String(row.leadId).replace(/^legacy_?/i, '')}`
        : row.leadId;

    const messagePayload: Record<string, unknown> = {
      leadId: leadIdForApi,
      phoneNumber: phone,
      sender_name: senderName,
      isTemplate: true,
      templateId: Number(template.id),
      templateName: template.name,
      templateLanguage: toWhatsAppApiLanguageCode(template.language || 'en'),
      contactId,
      message: paramCount > 0 ? filledContent || 'Template sent' : template.content || 'Payment reminder',
    };
    if (paramCount > 0) messagePayload.templateParameters = templateParameters;

    const response = await fetch(buildApiUrl('/api/whatsapp/send-message'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messagePayload),
    });
    const result = await response.json().catch(() => ({}));
    const isDbSaveError =
      !response.ok &&
      result?.error &&
      (String(result.error).includes('save') || String(result.error).includes('Failed to save message'));

    if (!response.ok && !isDbSaveError) {
      const err =
        result?.code === 'RE_ENGAGEMENT_REQUIRED'
          ? 'WhatsApp 24-hour rule blocked the send'
          : String(result?.error || result?.details || `HTTP ${response.status}`);
      return {
        id: row.id,
        leadNumber: row.leadNumber,
        name: row.name,
        ok: false,
        error: err,
        templateId,
      };
    }

    return {
      id: row.id,
      leadNumber: row.leadNumber,
      name: row.name,
      ok: true,
      phone,
      templateId,
    };
  } catch (error) {
    return {
      id: row.id,
      leadNumber: row.leadNumber,
      name: row.name,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function sendPaymentReminders(
  rows: PaymentReminderRow[],
  onProgress?: (done: number, total: number) => void,
): Promise<PaymentReminderSendResult[]> {
  type GroupItem = {
    row: PaymentReminderRow;
    phone?: string;
    resolveError?: string;
  };

  const groups = new Map<string, GroupItem[]>();
  for (const row of rows) {
    let key: string;
    let phone: string | undefined;
    let resolveError: string | undefined;
    try {
      const resolved = await resolveReminderPhone(row);
      phone = resolved.phone;
      key = paymentReminderContactDedupeKey({
        contactId: resolved.contactId,
        phone: resolved.phone,
        leadId: row.leadId,
        clientId: row.clientId,
      });
    } catch (error) {
      key = `__error__:${row.id}`;
      resolveError = error instanceof Error ? error.message : String(error);
    }
    const list = groups.get(key) || [];
    list.push({ row, phone, resolveError });
    groups.set(key, list);
  }

  const resultById = new Map<string, PaymentReminderSendResult>();
  const groupEntries = [...groups.entries()];
  for (let i = 0; i < groupEntries.length; i += 1) {
    const [, group] = groupEntries[i];
    const primary = group[0];
    let primaryResult: PaymentReminderSendResult;

    if (primary.resolveError) {
      primaryResult = {
        id: primary.row.id,
        leadNumber: primary.row.leadNumber,
        name: primary.row.name,
        ok: false,
        error: primary.resolveError,
      };
    } else {
      primaryResult = await sendPaymentReminderWhatsApp(primary.row);
      if (primaryResult.ok) {
        try {
          await stampPaymentReminderSent(group.map((item) => item.row));
        } catch {
          // Message already went out; keep send as success even if stamp fails.
        }
      }
    }

    resultById.set(primary.row.id, primaryResult);
    for (const dup of group.slice(1)) {
      resultById.set(dup.row.id, {
        id: dup.row.id,
        leadNumber: dup.row.leadNumber,
        name: dup.row.name,
        ok: primaryResult.ok,
        phone: primaryResult.phone || primary.phone,
        error: primaryResult.ok
          ? undefined
          : primaryResult.error || 'Skipped because the primary contact send failed',
        templateId: primaryResult.templateId,
        skippedDuplicate: true,
      });
    }
    onProgress?.(i + 1, groupEntries.length);
  }

  return rows.map(
    (row) =>
      resultById.get(row.id) || {
        id: row.id,
        leadNumber: row.leadNumber,
        name: row.name,
        ok: false,
        error: 'Missing send result',
      },
  );
}

/** Tool / UI JSON card payload. */
export function toPaymentRemindersCard(
  period: string,
  rows: PaymentReminderRow[],
  phase: 'pick_scope' | 'pick_period' | 'review' | 'done' = 'review',
  select: 'all' | 'first' = 'all',
  leadQuery?: string,
): {
  kind: 'payment_reminders';
  phase: 'pick_scope' | 'pick_period' | 'review' | 'done';
  period: string;
  count: number;
  select: 'all' | 'first';
  rows: PaymentReminderRow[];
  leadQuery?: string;
} {
  return {
    kind: 'payment_reminders',
    phase,
    period,
    count: rows.length,
    select,
    rows,
    ...(leadQuery ? { leadQuery } : {}),
  };
}
