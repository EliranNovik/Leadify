const { randomUUID } = require('crypto');
const supabase = require('../config/supabase');

function getPublicAppOrigin() {
  return (
    process.env.CRM_PUBLIC_URL ||
    process.env.FRONTEND_URL ||
    'http://localhost:5173'
  ).replace(/\/+$/, '');
}

function newPublicToken() {
  return randomUUID();
}

function buildPublicProformaUrl(kind, id, token) {
  const path =
    kind === 'legacy'
      ? `/public-proforma-legacy/${id}/${token}`
      : `/public-proforma/${id}/${token}`;
  return `${getPublicAppOrigin()}${path}`;
}

async function ensureNewProformaPublicToken(paymentPlanId) {
  const { data, error } = await supabase
    .from('payment_plans')
    .select('public_token')
    .eq('id', paymentPlanId)
    .single();

  if (error) {
    throw new Error(error.message || 'Failed to load proforma link');
  }

  if (data?.public_token) return data.public_token;

  const token = newPublicToken();
  const { error: updateError } = await supabase
    .from('payment_plans')
    .update({ public_token: token })
    .eq('id', paymentPlanId);

  if (updateError) {
    throw new Error(updateError.message || 'Failed to create share link');
  }

  return token;
}

async function ensureLegacyProformaPublicToken(proformaId) {
  const { data, error } = await supabase
    .from('proformainvoice')
    .select('public_token')
    .eq('id', proformaId)
    .single();

  if (error) {
    throw new Error(error.message || 'Failed to load proforma link');
  }

  if (data?.public_token) return data.public_token;

  const token = newPublicToken();
  const { error: updateError } = await supabase
    .from('proformainvoice')
    .update({ public_token: token })
    .eq('id', proformaId);

  if (updateError) {
    throw new Error(updateError.message || 'Failed to create share link');
  }

  return token;
}

module.exports = {
  getPublicAppOrigin,
  buildPublicProformaUrl,
  ensureNewProformaPublicToken,
  ensureLegacyProformaPublicToken,
};
