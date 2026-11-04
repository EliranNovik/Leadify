/**
 * AI chat “Send invoice”: rows marked sent-to-finance that still have no invoice sent.
 * Uses the same email + WhatsApp proforma templates as FinancesTab; language comes from the lead.
 */
import { supabase } from './supabase';
import { formatLeadMoneyAmount } from './leadCurrencyDisplay';
import {
  looksLikeLeadNumberQuery,
  matchesLeadNumberOrName,
  normalizeLeadNumberToken,
} from './rmqAiChatContext';
import {
  resolvePaymentReminderDateRange,
} from './paymentReminderAi';
import { HEBREW_LANGUAGE_ID } from './bulkMeetingReminders';
import type { ProformaSendLanguage } from './proformaSendLanguage';
import {
  buildSendInvoiceInputForPaymentPlan,
  paymentPlanHasProforma,
} from './paymentPlanInvoiceAutomation';
import { ensureProformasForAutomationPayments } from './proformaAutomationCreate';
import {
  collectProformaSendPartialErrors,
  sendProformaInvoiceBundle,
} from './proformaSendInvoice';

export type SendInvoiceRow = {
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
  sentToFinanceAt: string;
  sentToFinanceLabel: string;
  clientId: number | null;
  clientName: string;
  orderLabel: string;
  language: string;
  languageId: number | null;
  sendLanguage: ProformaSendLanguage;
  value: number;
  valueVat: number;
  currencyId: number | null;
  proforma: string | null;
  hasProforma: boolean;
};

export type SendInvoiceSendResult = {
  id: string;
  leadNumber: string;
  name: string;
  ok: boolean;
  language?: ProformaSendLanguage;
  detail?: string;
  error?: string;
};

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

function jerusalemDateKey(value: string): string {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
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

function sentToFinanceAtRaw(row: {
  sent_to_finance_at?: unknown;
  ready_to_pay?: unknown;
  sent_to_finance?: unknown;
}): string {
  return String(row.sent_to_finance_at || '').trim();
}

function wasSentToFinance(row: {
  ready_to_pay?: unknown;
  sent_to_finance?: unknown;
  sent_to_finance_at?: unknown;
}): boolean {
  return (
    Boolean(row.ready_to_pay) ||
    Boolean(row.sent_to_finance) ||
    Boolean(row.sent_to_finance_at)
  );
}

function legacyCurrencyCode(row: { accounting_currencies?: unknown; currency_id?: unknown }): string {
  const nested = row.accounting_currencies as
    | { iso_code?: string; name?: string }
    | Array<{ iso_code?: string; name?: string }>
    | null
    | undefined;
  const currency = Array.isArray(nested) ? nested[0] : nested;
  const code = String(currency?.iso_code || currency?.name || '').trim();
  if (code) return code;
  switch (Number(row.currency_id)) {
    case 2:
      return 'EUR';
    case 3:
      return 'USD';
    case 4:
      return 'GBP';
    default:
      return 'ILS';
  }
}

function orderLabelFrom(value: unknown): string {
  if (value == null || value === '') return 'Payment';
  const raw = String(value);
  if (!Number.isNaN(Number(raw))) {
    const n = Number(raw);
    if (n === 1) return 'First Payment';
    if (n === 2) return 'Second Payment';
    if (n === 3) return 'Third Payment';
    return `Payment ${n}`;
  }
  return raw;
}

export function sendInvoiceLanguageForLead(
  language: string | null | undefined,
  languageId: number | null,
): ProformaSendLanguage {
  if (languageId != null && Number(languageId) === HEBREW_LANGUAGE_ID) return 'he';
  const name = String(language || '').toLowerCase();
  if (name.includes('hebrew') || name.includes('עברית') || name === 'he' || name === 'heb') {
    return 'he';
  }
  return 'en';
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

  return {
    newLeadIds: (newLeads || []).map((row) => String(row.id)),
    legacyLeadIds: (legacyLeads || [])
      .map((row) => Number(row.id))
      .filter((id) => Number.isFinite(id)),
  };
}

async function resolveActor(): Promise<{ name: string; employeeId: number | null }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { name: 'Staff', employeeId: null };
  const { data: userRow } = await supabase
    .from('users')
    .select('full_name, email, employee_id')
    .eq('auth_id', user.id)
    .maybeSingle();
  let displayName = (userRow?.full_name as string)?.trim() || '';
  const employeeId =
    userRow?.employee_id != null && Number.isFinite(Number(userRow.employee_id))
      ? Number(userRow.employee_id)
      : null;
  if (!displayName && employeeId != null) {
    const { data: emp } = await supabase
      .from('tenants_employee')
      .select('display_name')
      .eq('id', employeeId)
      .maybeSingle();
    displayName = emp?.display_name?.trim() || '';
  }
  return { name: displayName || user.email || 'Staff', employeeId };
}

export async function listSendInvoiceCandidates(args: {
  period?: string;
  date?: string;
  date_from?: string;
  date_to?: string;
  query?: string;
}): Promise<{ period: string; rows: SendInvoiceRow[] }> {
  const nameFilter = String(args.query || '').trim();
  const leadScoped = looksLikeLeadNumberQuery(nameFilter);
  const hasPeriodArgs = Boolean(
    String(args.period || '').trim() ||
      String(args.date || '').trim() ||
      String(args.date_from || '').trim() ||
      String(args.date_to || '').trim(),
  );
  const range =
    leadScoped && !hasPeriodArgs
      ? { from: '1970-01-01', to: '2999-12-31', label: `lead ${nameFilter}` }
      : resolvePaymentReminderDateRange(args);
  const resolvedLeads = leadScoped
    ? await resolveLeadIdsForQuery(nameFilter)
    : { newLeadIds: [] as string[], legacyLeadIds: [] as number[] };

  const start = `${range.from}T00:00:00+02:00`;
  const end = `${addIsoDays(range.to, 1)}T00:00:00+03:00`;
  const sentDayFilter = `and(sent_to_finance_at.gte.${start},sent_to_finance_at.lt.${end})`;

  let newQuery = supabase
    .from('payment_plans')
    .select(
      'id, lead_id, value, value_vat, currency, currency_id, due_date, payment_order, paid, paid_at, cancel_date, client_id, client_name, proforma, ready_to_pay, sent_to_finance, sent_to_finance_at, invoice_sent, invoice_sent_at, invoice_send_automation_sent_at',
    )
    .is('cancel_date', null)
    .is('paid_at', null)
    .not('paid', 'eq', true)
    .eq('ready_to_pay', true)
    .order('sent_to_finance_at', { ascending: false })
    .limit(500);

  let legacyQuery = supabase
    .from('finances_paymentplanrow')
    .select(
      'id, lead_id, value, value_base, vat_value, currency_id, due_date, order, actual_date, cancel_date, client_id, ready_to_pay, sent_to_finance, sent_to_finance_at, invoice_sent, invoice_sent_at, invoice_send_automation_sent_at, accounting_currencies!finances_paymentplanrow_currency_id_fkey(name, iso_code)',
    )
    .is('cancel_date', null)
    .is('actual_date', null)
    .eq('ready_to_pay', true)
    .order('sent_to_finance_at', { ascending: false })
    .limit(500);

  if (leadScoped && resolvedLeads.newLeadIds.length) {
    newQuery = newQuery.in('lead_id', resolvedLeads.newLeadIds);
  } else if (!leadScoped) {
    newQuery = newQuery.or(sentDayFilter);
  } else {
    newQuery = newQuery.or(sentDayFilter);
  }

  if (leadScoped && resolvedLeads.legacyLeadIds.length) {
    legacyQuery = legacyQuery.in('lead_id', resolvedLeads.legacyLeadIds);
  } else {
    legacyQuery = legacyQuery.or(sentDayFilter);
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

  const [newLeads, legacyLeads, legacyProformas] = await Promise.all([
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
    (legacyRows || []).length
      ? fetchRowsInChunks(
          (legacyRows || []).map((row) => Number(row.id)).filter((id) => Number.isFinite(id)),
          async (chunk) => {
            const { data } = await supabase
              .from('proformainvoice')
              .select('id, ppr_id')
              .in('ppr_id', chunk)
              .is('cxd_date', null);
            return data || [];
          },
        )
      : Promise.resolve([]),
  ]);

  const newLeadById = new Map(newLeads.map((lead) => [String(lead.id), lead]));
  const legacyLeadById = new Map(legacyLeads.map((lead) => [String(lead.id), lead]));
  const legacyProformaByPpr = new Map(
    (legacyProformas || [])
      .filter((row) => row.ppr_id != null)
      .map((row) => [Number(row.ppr_id), row]),
  );

  const rows: SendInvoiceRow[] = [];

  for (const row of newRows || []) {
    if (row.paid || row.paid_at || row.cancel_date || invoiceWasSent(row) || !wasSentToFinance(row)) {
      continue;
    }
    const sentAt = sentToFinanceAtRaw(row);
    if (!leadScoped && (!sentAt || !inJerusalemDateRange(sentAt, range.from, range.to))) {
      continue;
    }
    if (leadScoped && !sentAt && !wasSentToFinance(row)) continue;
    const lead = newLeadById.get(String(row.lead_id || ''));
    const name = String(lead?.name || row.client_name || '');
    const leadNumber = String(lead?.lead_number || '');
    if (nameFilter && !matchesLeadNumberOrName(leadNumber, name, nameFilter)) continue;
    const amount = parseMoney(row.value) + parseMoney(row.value_vat);
    const currency = String(row.currency || '');
    const language = String(lead?.language || '');
    const languageId = lead?.language_id != null ? Number(lead.language_id) : null;
    const dueDate = String(row.due_date || '').slice(0, 10);
    const hasProforma = Boolean(row.proforma && String(row.proforma).trim() !== '');
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
      sentToFinanceAt: sentAt,
      sentToFinanceLabel: sentAt ? jerusalemLabel(sentAt) : '—',
      clientId: row.client_id != null ? Number(row.client_id) : null,
      clientName: String(row.client_name || name || ''),
      orderLabel: orderLabelFrom(row.payment_order),
      language,
      languageId: Number.isFinite(languageId as number) ? languageId : null,
      sendLanguage: sendInvoiceLanguageForLead(language, languageId),
      value: parseMoney(row.value),
      valueVat: parseMoney(row.value_vat),
      currencyId: row.currency_id != null ? Number(row.currency_id) : null,
      proforma: row.proforma ? String(row.proforma) : null,
      hasProforma,
    });
  }

  for (const row of legacyRows || []) {
    if (row.actual_date || row.cancel_date || invoiceWasSent(row) || !wasSentToFinance(row)) {
      continue;
    }
    const sentAt = sentToFinanceAtRaw(row);
    if (!leadScoped && (!sentAt || !inJerusalemDateRange(sentAt, range.from, range.to))) {
      continue;
    }
    const lead = legacyLeadById.get(String(row.lead_id || ''));
    const name = String(lead?.name || '');
    const leadNumber = String(lead?.lead_number || row.lead_id || '');
    if (nameFilter && !matchesLeadNumberOrName(leadNumber, name, nameFilter)) continue;
    const amount = parseMoney(row.value) || parseMoney(row.value_base) + parseMoney(row.vat_value);
    const currency = legacyCurrencyCode(row);
    const language = String(lead?.language || '');
    const languageId = lead?.language_id != null ? Number(lead.language_id) : null;
    const dueDate = String(row.due_date || '').slice(0, 10);
    const hasProforma = legacyProformaByPpr.has(Number(row.id));
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
      sentToFinanceAt: sentAt,
      sentToFinanceLabel: sentAt ? jerusalemLabel(sentAt) : '—',
      clientId: row.client_id != null ? Number(row.client_id) : null,
      clientName: name,
      orderLabel: orderLabelFrom(row.order),
      language,
      languageId: Number.isFinite(languageId as number) ? languageId : null,
      sendLanguage: sendInvoiceLanguageForLead(language, languageId),
      value: parseMoney(row.value) || parseMoney(row.value_base),
      valueVat: parseMoney(row.vat_value),
      currencyId: row.currency_id != null ? Number(row.currency_id) : null,
      proforma: null,
      hasProforma,
    });
  }

  rows.sort((a, b) => String(b.sentToFinanceAt).localeCompare(String(a.sentToFinanceAt)));
  return { period: range.label, rows };
}

export async function sendInvoiceForRow(row: SendInvoiceRow): Promise<SendInvoiceSendResult> {
  try {
    const language = row.sendLanguage || 'en';
    const actor = await resolveActor();
    let proforma = row.proforma;
    let legacyProformas: Array<{ id: string | number; ppr_id?: number | string | null }> = [];

    if (row.kind === 'legacy') {
      const { data } = await supabase
        .from('proformainvoice')
        .select('id, ppr_id')
        .eq('ppr_id', Number(row.recordId))
        .is('cxd_date', null);
      legacyProformas = data || [];
    }

    const payment = {
      id: row.recordId,
      isLegacy: row.kind === 'legacy',
      client_id: row.clientId,
      client: row.clientName || row.name,
      dueDate: row.dueDate || undefined,
      order: row.orderLabel,
      value: row.value,
      valueVat: row.valueVat,
      currency: row.currency,
      currency_id: row.currencyId,
      proforma,
      paid: false,
    };

    if (!paymentPlanHasProforma(payment, legacyProformas)) {
      const batch = await ensureProformasForAutomationPayments([payment], {
        leadId: row.kind === 'legacy' ? `legacy_${row.leadId}` : row.leadId,
        leadNumber: row.leadNumber,
        isLegacyLead: row.kind === 'legacy',
        createdBy: actor.name,
        employeeId: actor.employeeId,
        legacyProformas,
      });
      if (batch.addedLegacyProformas.length) {
        legacyProformas = [...legacyProformas, ...batch.addedLegacyProformas];
      }
      const created = batch.newProformaByPaymentId.get(String(row.recordId));
      if (created) proforma = created;
    }

    const input = await buildSendInvoiceInputForPaymentPlan(
      { ...payment, proforma },
      {
        leadId: row.kind === 'legacy' ? row.leadId : row.leadId,
        leadNumber: row.leadNumber,
        isLegacyLead: row.kind === 'legacy',
        language,
        legacyProformas,
      },
    );
    if (!input) {
      return {
        id: row.id,
        leadNumber: row.leadNumber,
        name: row.name,
        ok: false,
        language,
        error: 'Could not build invoice send (missing proforma or contact).',
      };
    }

    const result = await sendProformaInvoiceBundle(input);
    const partials = collectProformaSendPartialErrors(result);
    if (!result.emailSent && !result.whatsAppSent) {
      return {
        id: row.id,
        leadNumber: row.leadNumber,
        name: row.name,
        ok: false,
        language,
        error: partials[0] || 'Failed to send invoice',
      };
    }

    const channels = [
      result.emailSent ? 'email' : null,
      result.whatsAppSent ? `WhatsApp${result.whatsAppPhone ? ` ${result.whatsAppPhone}` : ''}` : null,
    ]
      .filter(Boolean)
      .join(' + ');

    return {
      id: row.id,
      leadNumber: row.leadNumber,
      name: row.name,
      ok: true,
      language,
      detail: `${language === 'he' ? 'HE' : 'EN'} · ${channels}${
        partials.length ? ` (${partials.join('; ')})` : ''
      }`,
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

export async function sendInvoices(
  rows: SendInvoiceRow[],
  onProgress?: (done: number, total: number) => void,
): Promise<SendInvoiceSendResult[]> {
  const results: SendInvoiceSendResult[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    results.push(await sendInvoiceForRow(rows[i]));
    onProgress?.(i + 1, rows.length);
  }
  return results;
}

export function toSendInvoicesCard(
  period: string,
  rows: SendInvoiceRow[],
  phase: 'pick_scope' | 'pick_period' | 'review' | 'done' = 'review',
  leadQuery?: string,
): {
  kind: 'send_invoices';
  phase: 'pick_scope' | 'pick_period' | 'review' | 'done';
  period: string;
  count: number;
  rows: SendInvoiceRow[];
  leadQuery?: string;
} {
  return {
    kind: 'send_invoices',
    phase,
    period,
    count: rows.length,
    rows,
    ...(leadQuery ? { leadQuery } : {}),
  };
}
