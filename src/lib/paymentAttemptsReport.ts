import { buildPaymentPagePath } from './proformaPaymentLink';
import { supabase } from './supabase';
import {
  extractPelecardCodeFromText,
  formatPelecardHistoryStatus,
  getPelecardFailureCopy,
  isPelecardApprovedCode,
} from './pelecardErrors';

export type PaymentAttemptOutcome = 'went_through' | 'failed' | 'cancelled' | 'pending';

export type PaymentChannel = 'credit_card' | 'bank' | 'apple_pay' | 'google_pay';

export const PAYMENT_CHANNEL_LABEL: Record<PaymentChannel, string> = {
  credit_card: 'Credit card',
  bank: 'Bank',
  apple_pay: 'Apple Pay',
  google_pay: 'Google Pay',
};

export type PaymentAttemptRow = {
  id: string;
  at: string | null;
  outcome: PaymentAttemptOutcome;
  status: string;
  code: string | null;
  title: string | null;
  explanation: string | null;
  errorMessage: string | null;
  amount: number | null;
  currency: string;
  /** Shekel amount sent to the bank when the invoice currency is not shekels. */
  chargedNis: number | null;
  /** What staff should do about this attempt. */
  nextStep: string | null;
  /** This attempt failed, and the payment link was paid afterwards. */
  paidLater: boolean;
  /** Same card or several cards across this lead's declines. */
  declineCardNote: string | null;
  method: string | null;
  cardBrand: string | null;
  cardLastFour: string | null;
  paymentChannel: PaymentChannel | null;
  authNumber: string | null;
  billingEmail: string | null;
  /** Failed attempts for this client inside the selected dates. */
  declineCount: number;
  clientName: string | null;
  leadLabel: string | null;
  clientPath: string | null;
  paymentPath: string | null;
  linkId: string;
  linkStatus: string | null;
  transactionRef: string | null;
  pelecardTransactionId: string | null;
  invoiceStatus: string | null;
  invoiceNumber: string | null;
  invoiceProblem: boolean;
  /** How many stored rows were the same attempt. */
  copies: number;
};

type LinkRow = {
  id: string | number;
  payment_plan_id?: number | null;
  client_id?: string | null;
  legacy_id?: number | null;
  plan_contact_id?: number | null;
  total_amount?: number | null;
  currency?: string | null;
  payment_method?: string | null;
  status?: string | null;
  pelecard_status_code?: string | null;
  pelecard_transaction_id?: string | null;
  payper_invoice_status?: string | null;
  payper_invoice_number?: string | null;
  billing_contact_name?: string | null;
  billing_contact_email?: string | null;
  description?: string | null;
  created_at?: string | null;
  paid_at?: string | null;
  secure_token?: string | null;
  pelecard_raw_response?: unknown;
};

const LINK_COLUMNS =
  'id, payment_plan_id, client_id, legacy_id, plan_contact_id, total_amount, currency, payment_method, status, pelecard_status_code, pelecard_transaction_id, payper_invoice_status, payper_invoice_number, billing_contact_name, billing_contact_email, description, secure_token, pelecard_raw_response, created_at, paid_at';

const LINK_COLUMNS_SAFE =
  'id, payment_plan_id, client_id, legacy_id, plan_contact_id, total_amount, currency, payment_method, status, pelecard_status_code, secure_token, created_at, paid_at';

export type PaymentAttemptsRange = { from: string; to: string };

function rangeBounds(range: PaymentAttemptsRange): { fromIso: string; untilIso: string } {
  let from = range.from;
  let to = range.to;
  if (from > to) {
    from = range.to;
    to = range.from;
  }
  const [fromYear, fromMonth, fromDay] = from.split('-').map(Number);
  const [toYear, toMonth, toDay] = to.split('-').map(Number);
  return {
    fromIso: new Date(fromYear, fromMonth - 1, fromDay, 0, 0, 0, 0).toISOString(),
    untilIso: new Date(toYear, toMonth - 1, toDay + 1, 0, 0, 0, 0).toISOString(),
  };
}

const BRAND_BY_CODE: Record<string, string> = {
  '1': 'Mastercard',
  '2': 'Visa',
  '3': 'Diners',
  '4': 'American Express',
  '5': 'Isracard',
  '6': 'JCB',
  '7': 'Discover',
  '8': 'Maestro',
};

const COMPANY_BY_CODE: Record<string, string> = {
  '1': 'Isracard',
  '2': 'Visa',
  '3': 'Diners',
  '4': 'American Express',
  '5': 'JCB',
  '6': 'Max',
};

function pelecardSources(raw: unknown): Record<string, unknown>[] {
  if (!raw || typeof raw !== 'object') return [];
  const root = raw as Record<string, unknown>;
  const sources = [root];
  if (root.callback && typeof root.callback === 'object') sources.push(root.callback as Record<string, unknown>);
  const pelecard = root.pelecard;
  if (pelecard && typeof pelecard === 'object') {
    const payload = pelecard as Record<string, unknown>;
    sources.push(payload);
    const result = payload.ResultData || payload.resultData;
    if (result && typeof result === 'object') sources.push(result as Record<string, unknown>);
  }
  return sources;
}

function pickField(source: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return null;
}

function brandFromWords(value: string): string | null {
  const lower = value.toLowerCase();
  if (lower.includes('master')) return 'Mastercard';
  if (lower.includes('visa')) return 'Visa';
  if (lower.includes('amex') || lower.includes('american')) return 'American Express';
  if (lower.includes('diners')) return 'Diners';
  if (lower.includes('isra')) return 'Isracard';
  if (lower.includes('jcb')) return 'JCB';
  if (lower.includes('discover')) return 'Discover';
  if (lower.includes('maestro')) return 'Maestro';
  if (lower.includes('max') || lower.includes('leumi')) return 'Max';
  return null;
}

function brandFromCardNumber(value: string): string | null {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 6) return null;
  if (digits.startsWith('4')) return 'Visa';
  const firstTwo = Number(digits.slice(0, 2));
  const firstFour = Number(digits.slice(0, 4));
  if ((firstTwo >= 51 && firstTwo <= 55) || (firstFour >= 2221 && firstFour <= 2720)) return 'Mastercard';
  if (digits.startsWith('34') || digits.startsWith('37')) return 'American Express';
  if (
    digits.startsWith('36') ||
    digits.startsWith('38') ||
    (Number(digits.slice(0, 3)) >= 300 && Number(digits.slice(0, 3)) <= 305)
  ) {
    return 'Diners';
  }
  if (digits.startsWith('35')) return 'JCB';
  return null;
}

function cardBrandFromRaw(raw: unknown): string | null {
  const sources = pelecardSources(raw);
  for (const source of sources) {
    const brand = pickField(source, ['CreditCardBrand', 'creditCardBrand', 'CardBrand', 'cardBrand']);
    if (!brand) continue;
    if (/^\d+$/.test(brand)) return BRAND_BY_CODE[brand] || null;
    const named = brandFromWords(brand);
    if (named) return named;
  }
  for (const source of sources) {
    const label = pickField(source, ['CardType', 'cardType', 'CreditCardType', 'creditCardType']);
    if (!label || /^\d+$/.test(label)) continue;
    const named = brandFromWords(label);
    if (named) return named;
  }
  for (const source of sources) {
    const number = pickField(source, ['CreditCardNumber', 'creditCardNumber', 'CardNumber', 'cardNumber']);
    if (!number) continue;
    const fromNumber = brandFromCardNumber(number);
    if (fromNumber) return fromNumber;
  }
  for (const source of sources) {
    const company = pickField(source, ['CreditCardCompany', 'creditCardCompany']);
    if (!company) continue;
    if (/^\d+$/.test(company)) return COMPANY_BY_CODE[company] || null;
    return brandFromWords(company);
  }
  return null;
}

function cardLastFourFromRaw(raw: unknown): string | null {
  for (const source of pelecardSources(raw)) {
    const number = pickField(source, [
      'CreditCardNumber',
      'creditCardNumber',
      'CardNumber',
      'cardNumber',
      'CreditCard4Digits',
      'creditCard4Digits',
      'Last4',
      'last4',
    ]);
    if (!number) continue;
    const digits = number.replace(/\D/g, '');
    if (digits.length >= 4 && digits.slice(-4) !== '0000') return digits.slice(-4);
  }
  return null;
}

function cleanAuthNumber(value: string | null | undefined): string | null {
  const trimmed = String(value || '').trim();
  if (!trimmed || /^0+$/.test(trimmed)) return null;
  return trimmed;
}

function authNumberFromRaw(raw: unknown): string | null {
  for (const source of pelecardSources(raw)) {
    const auth = cleanAuthNumber(
      pickField(source, [
        'DebitApproveNumber',
        'debitApproveNumber',
        'AuthorizationNumber',
        'authorizationNumber',
        'ApprovalNo',
        'approvalNo',
        'AuthNumber',
        'authNumber',
      ]),
    );
    if (auth) return auth;
  }
  return null;
}

function channelFromSource(source: Record<string, unknown>): PaymentChannel | null {
  if (source.openFinancePending === true) return 'bank';
  const bank = pickField(source, [
    'BankTransferStatus',
    'bankTransferStatus',
    'OpenFinanceStatus',
    'openFinanceStatus',
  ]);
  if (bank) return 'bank';

  for (const [key, value] of Object.entries(source)) {
    if (value == null || typeof value === 'object') continue;
    const text = String(value).trim().toLowerCase();
    if (!text || text === 'false' || text === '0' || text === 'no') continue;
    const keyName = key.toLowerCase();
    const mentionsMethod = /apple|google|gpay|wallet|paytype|paymenttype|paymentmethod|sptype|digital/.test(keyName);
    const apple = /apple\s*pay|applepay/.test(text) || (mentionsMethod && keyName.includes('apple'));
    const google = /google\s*pay|googlepay|\bgpay\b/.test(text) || (mentionsMethod && /google|gpay/.test(keyName));
    if (apple) return 'apple_pay';
    if (google) return 'google_pay';
  }
  return null;
}

function paymentChannelFromRaw(raw: unknown, code: string | null, errorMessage: string | null): PaymentChannel | null {
  for (const source of pelecardSources(raw)) {
    const channel = channelFromSource(source);
    if (channel) return channel;
  }
  if (code === '665' || code === '655' || code === '666') return 'bank';
  if (/bank transfer|open finance/i.test(errorMessage || '')) return 'bank';
  if (cardBrandFromRaw(raw) || cardLastFourFromRaw(raw) || authNumberFromRaw(raw)) return 'credit_card';
  return null;
}

function isShekelCurrency(currency: string | null | undefined): boolean {
  const value = String(currency || '').trim().toLowerCase();
  return value === '₪' || value === 'nis' || value === 'ils' || value.includes('shekel');
}

function chargedNisFromRaw(raw: unknown, currency: string | null | undefined): number | null {
  if (isShekelCurrency(currency)) return null;
  if (!raw || typeof raw !== 'object') return null;
  const charge = (raw as { pelecardCharge?: { chargeTotalNis?: unknown } }).pelecardCharge;
  const total = Number(charge?.chargeTotalNis);
  if (!Number.isFinite(total) || total <= 0) return null;
  return Math.round(total);
}

function linkWasPaid(status: string | null | undefined): boolean {
  const value = String(status || '').trim().toLowerCase();
  return value === 'paid' || value === 'success';
}

function staffNextStep(input: {
  status: string | null;
  code: string | null;
  errorMessage: string | null;
  paidLater: boolean;
}): string | null {
  if (input.paidLater) return 'This link was paid later. Do not ask the client to pay again.';
  const recorded = outcomeOf(input.status);
  const outcome = resolvedOutcome(input.status, input.code);
  if (outcome === 'went_through') return null;
  if (recorded === 'went_through' && codeContradictsApproval(input.code)) {
    return 'Our system marked this link paid, but this Pelecard code is not an approval. Do not treat the money as received.';
  }
  if (outcome === 'pending') return 'No charge was made. Send the same payment link again.';
  const reason = String(input.errorMessage || '').trim();
  const urlReason =
    reason === 'server_error' || reason === 'missing_payment_id' || reason === 'payment_not_found'
      ? reason
      : undefined;
  const copy = getPelecardFailureCopy({
    statusCode: input.code,
    statusDescription: urlReason ? undefined : input.errorMessage,
    urlReason,
    variant: outcome === 'cancelled' ? 'cancelled' : 'failed',
  });
  const steps = copy.actions.filter((action) => !/do not need a new link/i.test(action));
  return steps.slice(0, 2).join(' ') || null;
}

function outcomeOf(status: string | null | undefined): PaymentAttemptOutcome {
  const value = String(status || '').trim().toLowerCase();
  if (value === 'success' || value === 'paid') return 'went_through';
  if (value === 'failed') return 'failed';
  if (value === 'cancelled' || value === 'canceled') return 'cancelled';
  return 'pending';
}

/** 000 is a card approval. 302 means the debit succeeded and our page missed the reply. 665 is a finished bank transfer. */
function codeContradictsApproval(code: string | null | undefined): boolean {
  const value = String(code || '').trim();
  if (!value) return false;
  if (isPelecardApprovedCode(value) || value === '302' || value === '665') return false;
  return true;
}

function resolvedOutcome(status: string | null | undefined, code: string | null): PaymentAttemptOutcome {
  const recorded = outcomeOf(status);
  if (recorded === 'went_through' && codeContradictsApproval(code)) return 'failed';
  return recorded;
}

function invoiceProblem(status: string | null | undefined, outcome: PaymentAttemptOutcome): boolean {
  const value = String(status || '').trim().toLowerCase();
  if (!value || value === 'success' || value === 'pending') return false;
  return outcome === 'went_through' || value === 'failed' || value.startsWith('skipped');
}

function explain(status: string | null, code: string | null, errorMessage: string | null) {
  const reason = String(errorMessage || '').trim();
  if (reason === 'server_error' || reason === 'missing_payment_id' || reason === 'payment_not_found') {
    const copy = getPelecardFailureCopy({ statusCode: code, urlReason: reason });
    return { label: status || 'failed', code, title: copy.title, explanation: copy.explanation };
  }
  if (resolvedOutcome(status, code) === 'went_through') {
    const copy = getPelecardFailureCopy({ statusCode: '000' });
    return { label: status || 'success', code: code || '000', title: copy.title, explanation: copy.explanation };
  }
  const view = formatPelecardHistoryStatus({
    status: outcomeOf(status) === 'went_through' ? 'failed' : status,
    statusCode: code,
    errorMessage,
  });
  if (view.title || view.explanation) return view;
  return view;
}

async function selectLinks(ids: Array<string | number>): Promise<LinkRow[]> {
  if (!ids.length) return [];
  const rows: LinkRow[] = [];
  for (let i = 0; i < ids.length; i += 80) {
    const chunk = ids.slice(i, i + 80);
    const full = await supabase.from('payment_links').select(LINK_COLUMNS).in('id', chunk);
    if (!full.error) {
      rows.push(...((full.data ?? []) as LinkRow[]));
      continue;
    }
    const safe = await supabase.from('payment_links').select(LINK_COLUMNS_SAFE).in('id', chunk);
    if (safe.error) throw safe.error;
    rows.push(...((safe.data ?? []) as LinkRow[]));
  }
  return rows;
}

async function recentLinks(fromIso: string, untilIso: string): Promise<LinkRow[]> {
  const rows: LinkRow[] = [];
  const pageSize = 500;
  for (let offset = 0; offset < 4000; offset += pageSize) {
    const full = await supabase
      .from('payment_links')
      .select(LINK_COLUMNS)
      .gte('created_at', fromIso)
      .lt('created_at', untilIso)
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (!full.error) {
      const batch = (full.data ?? []) as LinkRow[];
      rows.push(...batch);
      if (batch.length < pageSize) break;
      continue;
    }
    const safe = await supabase
      .from('payment_links')
      .select(LINK_COLUMNS_SAFE)
      .gte('created_at', fromIso)
      .lt('created_at', untilIso)
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (safe.error) throw safe.error;
    const batch = (safe.data ?? []) as LinkRow[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}

export async function fetchPaymentAttemptsReport(range: PaymentAttemptsRange): Promise<PaymentAttemptRow[]> {
  const { fromIso, untilIso } = rangeBounds(range);
  const txRows: Array<{
    id: string | number;
    payment_link_id?: string | number | null;
    status?: string | null;
    payment_method?: string | null;
    amount?: number | null;
    error_message?: string | null;
    created_at?: string | null;
    completed_at?: string | null;
    transaction_reference?: string | null;
  }> = [];
  const pageSize = 500;
  for (let offset = 0; offset < 4000; offset += pageSize) {
    const { data: transactions, error: txError } = await supabase
      .from('payment_transactions')
      .select('id, payment_link_id, status, payment_method, amount, error_message, created_at, completed_at, transaction_reference')
      .gte('created_at', fromIso)
      .lt('created_at', untilIso)
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (txError) throw txError;
    const batch = transactions ?? [];
    txRows.push(...batch);
    if (batch.length < pageSize) break;
  }
  const linkIds = [...new Set(txRows.map((tx) => tx.payment_link_id).filter((id) => id != null))];
  const [linked, recent] = await Promise.all([selectLinks(linkIds), recentLinks(fromIso, untilIso)]);
  const linkById = new Map<string, LinkRow>();
  for (const link of [...linked, ...recent]) linkById.set(String(link.id), link);

  const newLeadIds = [
    ...new Set(
      [...linkById.values()]
        .filter((link) => link.legacy_id == null && link.client_id)
        .map((link) => String(link.client_id)),
    ),
  ];
  const legacyIds = [
    ...new Set(
      [...linkById.values()]
        .map((link) => Number(link.legacy_id))
        .filter((id) => Number.isFinite(id)),
    ),
  ];
  const contactIds = [
    ...new Set(
      [...linkById.values()]
        .map((link) => Number(link.plan_contact_id))
        .filter((id) => Number.isFinite(id)),
    ),
  ];

  const [newLeads, legacyLeads, contacts] = await Promise.all([
    newLeadIds.length
      ? supabase.from('leads').select('id, name, lead_number').in('id', newLeadIds.slice(0, 200))
      : Promise.resolve({ data: [], error: null }),
    legacyIds.length
      ? supabase.from('leads_lead').select('id, name, lead_number').in('id', legacyIds.slice(0, 200))
      : Promise.resolve({ data: [], error: null }),
    contactIds.length
      ? supabase.from('leads_contact').select('id, name').in('id', contactIds.slice(0, 200))
      : Promise.resolve({ data: [], error: null }),
  ]);

  const newLeadById = new Map((newLeads.data ?? []).map((lead) => [String(lead.id), lead]));
  const legacyLeadById = new Map((legacyLeads.data ?? []).map((lead) => [String(lead.id), lead]));
  const contactById = new Map((contacts.data ?? []).map((contact) => [String(contact.id), contact]));

  const nameFor = (link: LinkRow | undefined) => {
    if (!link) {
      return {
        clientName: null as string | null,
        leadLabel: null as string | null,
        clientPath: null as string | null,
        paymentPath: null as string | null,
      };
    }
    const lead = link.legacy_id != null
      ? legacyLeadById.get(String(link.legacy_id))
      : newLeadById.get(String(link.client_id ?? ''));
    const contact = contactById.get(String(link.plan_contact_id ?? ''));
    const clientName =
      link.billing_contact_name?.trim() ||
      contact?.name?.trim() ||
      lead?.name?.trim() ||
      link.description?.trim() ||
      null;
    const leadNumber = lead?.lead_number ? String(lead.lead_number).trim() : '';
    const leadLabel = leadNumber || (link.legacy_id != null ? `Legacy ${link.legacy_id}` : null);
    let clientPath: string | null = null;
    if (link.legacy_id != null && Number.isFinite(Number(link.legacy_id))) {
      clientPath = `/clients/${encodeURIComponent(String(link.legacy_id))}`;
    } else if (leadNumber) {
      clientPath = `/clients/${encodeURIComponent(leadNumber)}`;
    } else if (link.client_id) {
      clientPath = `/clients/${encodeURIComponent(String(link.client_id))}`;
    }
    const token = link.secure_token ? String(link.secure_token).trim() : '';
    return { clientName, leadLabel, clientPath, paymentPath: token ? buildPaymentPagePath(token) : null };
  };

  const rows: PaymentAttemptRow[] = [];
  const seenLinkIds = new Set<string>();

  for (const tx of txRows) {
    const link = linkById.get(String(tx.payment_link_id ?? ''));
    if (link) seenLinkIds.add(String(link.id));
    const errorMessage = typeof tx.error_message === 'string' && tx.error_message.trim() ? tx.error_message.trim() : null;
    const code =
      extractPelecardCodeFromText(errorMessage) ||
      (link?.pelecard_status_code ? String(link.pelecard_status_code).trim() : null) ||
      null;
    const outcome = resolvedOutcome(tx.status, code);
    const view = explain(tx.status, code, errorMessage);
    const linkCode = link?.pelecard_status_code ? String(link.pelecard_status_code).trim() : null;
    const paidLater = outcomeOf(tx.status) === 'failed' && linkWasPaid(link?.status) && !codeContradictsApproval(linkCode);
    const names = nameFor(link);
    const invoiceStatus = link?.payper_invoice_status ? String(link.payper_invoice_status) : null;
    rows.push({
      id: `tx-${tx.id}`,
      at: tx.completed_at || tx.created_at || null,
      outcome,
      status: String(tx.status || 'unknown'),
      code: view.code || code,
      title: view.title,
      explanation: view.explanation,
      errorMessage,
      amount: tx.amount != null ? Number(tx.amount) : link?.total_amount != null ? Number(link.total_amount) : null,
      currency: link?.currency || '₪',
      chargedNis: chargedNisFromRaw(link?.pelecard_raw_response, link?.currency),
      paidLater,
      nextStep: staffNextStep({
        status: tx.status,
        code: view.code || code,
        errorMessage,
        paidLater,
      }),
      declineCardNote: null,
      method: tx.payment_method || link?.payment_method || null,
      cardBrand: cardBrandFromRaw(link?.pelecard_raw_response),
      cardLastFour: cardLastFourFromRaw(link?.pelecard_raw_response),
      paymentChannel: paymentChannelFromRaw(link?.pelecard_raw_response, view.code || code, errorMessage),
      authNumber: authNumberFromRaw(link?.pelecard_raw_response),
      billingEmail: link?.billing_contact_email?.trim() || null,
      declineCount: 0,
      clientName: names.clientName,
      leadLabel: names.leadLabel,
      clientPath: names.clientPath,
      paymentPath: names.paymentPath,
      linkId: String(tx.payment_link_id ?? ''),
      linkStatus: link?.status ? String(link.status) : null,
      transactionRef: tx.transaction_reference ? String(tx.transaction_reference) : null,
      pelecardTransactionId: link?.pelecard_transaction_id ? String(link.pelecard_transaction_id) : null,
      invoiceStatus,
      invoiceNumber: link?.payper_invoice_number ? String(link.payper_invoice_number) : null,
      invoiceProblem: invoiceProblem(invoiceStatus, outcome),
      copies: 1,
    });
  }

  for (const link of linkById.values()) {
    if (seenLinkIds.has(String(link.id))) continue;
    const code = link.pelecard_status_code ? String(link.pelecard_status_code).trim() : null;
    const outcome = resolvedOutcome(link.status, code);
    const view = explain(link.status, code, null);
    const paidLater = false;
    const names = nameFor(link);
    const invoiceStatus = link.payper_invoice_status ? String(link.payper_invoice_status) : null;
    rows.push({
      id: `link-${link.id}`,
      at: link.paid_at || link.created_at || null,
      outcome,
      status: String(link.status || 'pending'),
      code: view.code || code,
      title: view.title,
      explanation: view.explanation,
      errorMessage: null,
      amount: link.total_amount != null ? Number(link.total_amount) : null,
      currency: link.currency || '₪',
      chargedNis: chargedNisFromRaw(link.pelecard_raw_response, link.currency),
      paidLater,
      nextStep: staffNextStep({
        status: link.status || null,
        code: view.code || code,
        errorMessage: null,
        paidLater,
      }),
      declineCardNote: null,
      method: link.payment_method || 'pelecard',
      cardBrand: cardBrandFromRaw(link.pelecard_raw_response),
      cardLastFour: cardLastFourFromRaw(link.pelecard_raw_response),
      paymentChannel: paymentChannelFromRaw(link.pelecard_raw_response, view.code || code, null),
      authNumber: authNumberFromRaw(link.pelecard_raw_response),
      billingEmail: link.billing_contact_email?.trim() || null,
      declineCount: 0,
      clientName: names.clientName,
      leadLabel: names.leadLabel,
      clientPath: names.clientPath,
      paymentPath: names.paymentPath,
      linkId: String(link.id),
      linkStatus: link.status ? String(link.status) : null,
      transactionRef: null,
      pelecardTransactionId: link.pelecard_transaction_id ? String(link.pelecard_transaction_id) : null,
      invoiceStatus,
      invoiceNumber: link.payper_invoice_number ? String(link.payper_invoice_number) : null,
      invoiceProblem: invoiceProblem(invoiceStatus, outcome),
      copies: 1,
    });
  }

  const fromMs = new Date(fromIso).getTime();
  const untilMs = new Date(untilIso).getTime();
  const inRange = rows.filter((row) => {
    const ts = row.at ? new Date(row.at).getTime() : NaN;
    return Number.isFinite(ts) && ts >= fromMs && ts < untilMs;
  });
  const unique = collapseSameAttempts(inRange);
  attachDeclineCounts(unique);
  unique.sort((a, b) => {
    const aTs = a.at ? new Date(a.at).getTime() : 0;
    const bTs = b.at ? new Date(b.at).getTime() : 0;
    return bTs - aTs;
  });
  return unique;
}

function minuteKey(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 16);
  return date.toISOString().slice(0, 16);
}

function rowDetailScore(row: PaymentAttemptRow): number {
  return (row.errorMessage ? 4 : 0) + (row.transactionRef ? 2 : 0) + (row.pelecardTransactionId ? 1 : 0);
}

/** Callback and status checks insert a new row for the same charge. Keep one row per attempt. */
function collapseSameAttempts(rows: PaymentAttemptRow[]): PaymentAttemptRow[] {
  const grouped = new Map<string, PaymentAttemptRow>();

  for (const row of rows) {
    const key = [
      row.linkId,
      row.outcome,
      row.code || '',
      minuteKey(row.at),
      row.amount ?? '',
    ].join('|');
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { ...row });
      continue;
    }
    const keep = rowDetailScore(row) > rowDetailScore(existing) ? row : existing;
    const other = keep === row ? existing : row;
    grouped.set(key, {
      ...keep,
      copies: existing.copies + row.copies,
      errorMessage: keep.errorMessage || other.errorMessage,
      transactionRef: keep.transactionRef || other.transactionRef,
      pelecardTransactionId: keep.pelecardTransactionId || other.pelecardTransactionId,
      explanation: keep.explanation || other.explanation,
      title: keep.title || other.title,
      clientPath: keep.clientPath || other.clientPath,
      paymentPath: keep.paymentPath || other.paymentPath,
      clientName: keep.clientName || other.clientName,
      leadLabel: keep.leadLabel || other.leadLabel,
      cardBrand: keep.cardBrand || other.cardBrand,
      cardLastFour: keep.cardLastFour || other.cardLastFour,
      paymentChannel: keep.paymentChannel || other.paymentChannel,
      authNumber: keep.authNumber || other.authNumber,
      billingEmail: keep.billingEmail || other.billingEmail,
      chargedNis: keep.chargedNis ?? other.chargedNis,
      paidLater: keep.paidLater || other.paidLater,
      nextStep:
        keep.paidLater || other.paidLater
          ? 'This link was paid later. Do not ask the client to pay again.'
          : keep.nextStep || other.nextStep,
    });
  }

  return [...grouped.values()];
}

function clientAttemptKey(row: PaymentAttemptRow): string {
  return row.clientPath || row.leadLabel || row.clientName || '';
}

function attachDeclineCounts(rows: PaymentAttemptRow[]): void {
  const counts = new Map<string, number>();
  const cards = new Map<string, Set<string>>();
  for (const row of rows) {
    if (row.outcome !== 'failed') continue;
    const key = clientAttemptKey(row);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
    if (!cards.has(key)) cards.set(key, new Set());
    if (row.cardLastFour) cards.get(key)?.add(row.cardLastFour);
  }
  for (const row of rows) {
    const key = clientAttemptKey(row);
    row.declineCount = key ? counts.get(key) || 0 : 0;
    const usedCards = key ? cards.get(key) : undefined;
    if (row.outcome !== 'failed' || row.declineCount < 2 || !usedCards || usedCards.size === 0) {
      row.declineCardNote = null;
      continue;
    }
    if (usedCards.size === 1) {
      row.declineCardNote = `Same card ··${[...usedCards][0]}`;
    } else {
      row.declineCardNote = `${usedCards.size} different cards`;
    }
  }
}
