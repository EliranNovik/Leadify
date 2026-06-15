import { supabase } from './supabase';
import { embedLegacyBankInNotes, fetchBankAccountById, type BankAccountSnapshot } from './bankAccounts';
import { generateProformaName } from './proforma';
import { ensureProformaPaymentLink } from './proformaPaymentLink';
import { computeProformaVatFromPayment } from './proformaVat';
import { displaySymbolForPaymentSave, resolveCurrencyIdForSave } from './paymentPlanCurrency';
import { resolvePaymentPlanContact } from './resolvePaymentPlanContact';
import { paymentPlanHasProforma } from './paymentPlanInvoiceAutomation';

export const DEFAULT_INVOICE_AUTOMATION_BANK_ACCOUNT_ID = '27cf7983-ffc4-4a3f-b61b-900815f95c7e';

export type EnsureProformaPaymentInput = {
  id: string | number;
  isLegacy?: boolean;
  client_id?: number | null;
  client?: string;
  dueDate?: string;
  order: string;
  value: number;
  valueVat: number;
  currency?: string;
  currency_id?: number | null;
  proforma?: string | null;
  paid?: boolean;
};

export type EnsureProformaContext = {
  leadId: string | number;
  leadNumber: string;
  isLegacyLead: boolean;
  createdBy: string;
  employeeId: number | null;
  legacyProformas: Array<{ id: string | number; ppr_id?: number | string | null }>;
};

export type EnsureProformasBatchResult = {
  createdCount: number;
  newProformaByPaymentId: Map<string, string>;
  addedLegacyProformas: Array<{ id: number; ppr_id: number }>;
};

async function resolveContactForPayment(
  payment: EnsureProformaPaymentInput,
  ctx: EnsureProformaContext,
) {
  return resolvePaymentPlanContact({
    leadId: ctx.isLegacyLead ? String(ctx.leadId).replace(/^legacy_/, '') : ctx.leadId,
    clientId: payment.client_id ?? null,
    clientNameFallback: payment.client,
  });
}

async function createNewLeadAutomationProforma(
  payment: EnsureProformaPaymentInput,
  ctx: EnsureProformaContext,
  bankDetails: BankAccountSnapshot,
  contact: Awaited<ReturnType<typeof resolveContactForPayment>>,
): Promise<string> {
  const proformaName = await generateProformaName();
  const subtotal = payment.value;
  const currencyId = resolveCurrencyIdForSave({
    currency: payment.currency,
    currency_id: payment.currency_id,
  });
  const currency = displaySymbolForPaymentSave({
    currency: payment.currency,
    currency_id: currencyId,
  });
  const { addVat, vat, totalWithVat } = computeProformaVatFromPayment({
    currency,
    currency_id: currencyId,
    valueVat: payment.valueVat,
    paymentOrder: payment.order,
    dueDate: payment.dueDate,
    subtotal,
  });

  const proformaContent = JSON.stringify({
    client: contact.name,
    clientId: ctx.leadId,
    contactId: payment.client_id ?? contact.contactId,
    proformaName,
    payment: subtotal + (addVat ? vat : 0),
    base: subtotal,
    vat,
    language: 'EN',
    rows: [{ description: payment.order, qty: 1, rate: subtotal, total: subtotal }],
    total: subtotal,
    totalWithVat,
    addVat,
    currency,
    currency_id: currencyId,
    bankAccount: bankDetails.name,
    bankAccountId: DEFAULT_INVOICE_AUTOMATION_BANK_ACCOUNT_ID,
    bankAccountDetails: bankDetails,
    notes: '',
    email: contact.email,
    phone: contact.phone,
    lead_number: ctx.leadNumber,
    createdAt: new Date().toISOString(),
    createdBy: ctx.createdBy,
  });

  const { error } = await supabase
    .from('payment_plans')
    .update({ proforma: proformaContent })
    .eq('id', payment.id);
  if (error) throw error;

  await ensureProformaPaymentLink({
    paymentPlanId: payment.id,
    leadClientId: ctx.leadId,
    leadType: 'new',
    value: subtotal,
    valueVat: vat,
    currency,
    order: payment.order,
    clientName: contact.name,
    leadNumber: ctx.leadNumber,
    planContactId: payment.client_id ?? contact.contactId,
  });

  return proformaContent;
}

async function createLegacyAutomationProforma(
  payment: EnsureProformaPaymentInput,
  ctx: EnsureProformaContext,
  bankDetails: BankAccountSnapshot,
  contact: Awaited<ReturnType<typeof resolveContactForPayment>>,
): Promise<number> {
  const leadIdNum = parseInt(String(ctx.leadId).replace(/^legacy_/, ''), 10);
  if (!Number.isFinite(leadIdNum)) {
    throw new Error('Invalid legacy lead id');
  }

  const subtotal = payment.value;
  const currencyId = resolveCurrencyIdForSave({
    currency: payment.currency,
    currency_id: payment.currency_id,
  });
  const currencySymbol = displaySymbolForPaymentSave({
    currency: payment.currency,
    currency_id: currencyId,
  });
  const { addVat, vat, totalWithVat } = computeProformaVatFromPayment({
    currency: currencySymbol,
    currency_id: currencyId,
    valueVat: payment.valueVat,
    paymentOrder: payment.order,
    dueDate: payment.dueDate,
    subtotal,
  });

  const proformaName = await generateProformaName();
  const rowsData = [
    {
      description: payment.order,
      qty: 1,
      rate: subtotal,
      total: subtotal,
    },
  ];

  const notes = embedLegacyBankInNotes(proformaName, bankDetails);

  const { data: proformaId, error } = await supabase.rpc('create_proforma_with_rows', {
    p_lead_id: leadIdNum,
    p_total: totalWithVat,
    p_total_base: subtotal,
    p_vat_value: vat,
    p_notes: notes,
    p_sub_total: subtotal,
    p_add_vat: addVat ? 't' : 'f',
    p_currency_id: currencyId,
    p_client_id: contact.contactId,
    p_bank_account_id: null,
    p_ppr_id: Number(payment.id),
    p_creator_id: ctx.employeeId,
    p_rows: rowsData,
  });

  if (error) throw error;
  const numericId = Number(proformaId);
  if (!Number.isFinite(numericId)) {
    throw new Error('Failed to create legacy proforma');
  }
  return numericId;
}

export async function ensureProformasForAutomationPayments(
  payments: EnsureProformaPaymentInput[],
  ctx: EnsureProformaContext,
): Promise<EnsureProformasBatchResult> {
  const bankDetails = await fetchBankAccountById(DEFAULT_INVOICE_AUTOMATION_BANK_ACCOUNT_ID);
  if (!bankDetails) {
    throw new Error('Default bank account is not configured.');
  }

  const newProformaByPaymentId = new Map<string, string>();
  const addedLegacyProformas: Array<{ id: number; ppr_id: number }> = [];
  let createdCount = 0;
  let legacyProformas = [...ctx.legacyProformas];

  for (const payment of payments) {
    if (payment.paid) continue;
    if (paymentPlanHasProforma(payment, legacyProformas)) continue;

    const contact = await resolveContactForPayment(payment, ctx);

    if (payment.isLegacy) {
      const legacyProformaId = await createLegacyAutomationProforma(
        payment,
        ctx,
        bankDetails,
        contact,
      );
      const legacyRow = { id: legacyProformaId, ppr_id: Number(payment.id) };
      addedLegacyProformas.push(legacyRow);
      legacyProformas = [...legacyProformas, legacyRow];
      createdCount += 1;
    } else {
      const proformaJson = await createNewLeadAutomationProforma(
        payment,
        ctx,
        bankDetails,
        contact,
      );
      newProformaByPaymentId.set(String(payment.id), proformaJson);
      createdCount += 1;
    }
  }

  return { createdCount, newProformaByPaymentId, addedLegacyProformas };
}
