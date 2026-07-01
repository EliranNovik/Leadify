/** Matches FinancesTab / proformaVat — order 99 / "Expense (no VAT)". */
function isExpenseNoVatPayment(order) {
  if (order === 99 || order === '99') return true;
  if (typeof order === 'string') {
    const text = order.toLowerCase();
    return text.includes('expense') && text.includes('no vat');
  }
  return false;
}

function resolvePaymentOrderFromLink(paymentLink) {
  if (!paymentLink) return null;
  if (paymentLink.payment_plans?.payment_order != null) {
    return paymentLink.payment_plans.payment_order;
  }
  if (paymentLink.legacy_payment_plan?.order != null) {
    return paymentLink.legacy_payment_plan.order;
  }
  return null;
}

function isExpenseNoVatPaymentLink(paymentLink) {
  return isExpenseNoVatPayment(resolvePaymentOrderFromLink(paymentLink));
}

function isLegacyPaymentPlanLink(paymentLink) {
  return (
    paymentLink?.legacy_id != null ||
    paymentLink?.is_legacy_payment_plan === true ||
    String(paymentLink?.client_id || '').startsWith('legacy_')
  );
}

/** Load payment_order when Payper runs before fetchPaymentByToken enrichment. */
async function enrichPaymentPlanOrderForPayper(paymentLink) {
  if (!paymentLink?.payment_plan_id || resolvePaymentOrderFromLink(paymentLink) != null) {
    return paymentLink;
  }

  const supabase = require('../config/supabase');
  const planId = paymentLink.payment_plan_id;

  if (isLegacyPaymentPlanLink(paymentLink)) {
    const { data } = await supabase
      .from('finances_paymentplanrow')
      .select('id, order')
      .eq('id', planId)
      .maybeSingle();
    if (data) {
      return { ...paymentLink, legacy_payment_plan: data };
    }
    return paymentLink;
  }

  const { data } = await supabase
    .from('payment_plans')
    .select('payment_order')
    .eq('id', planId)
    .maybeSingle();
  if (data) {
    return {
      ...paymentLink,
      payment_plans: { ...(paymentLink.payment_plans || {}), ...data },
    };
  }
  return paymentLink;
}

module.exports = {
  isExpenseNoVatPayment,
  resolvePaymentOrderFromLink,
  isExpenseNoVatPaymentLink,
  isLegacyPaymentPlanLink,
  enrichPaymentPlanOrderForPayper,
};
