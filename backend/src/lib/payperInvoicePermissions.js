const supabase = require('../config/supabase');

function isTruthyFlag(value) {
  return value === true || value === 'true' || value === 't' || value === 1 || value === '1';
}

async function resolveUserRow(authUserId) {
  const id = String(authUserId || '').trim();
  if (!id) return null;

  const { data: byAuth } = await supabase
    .from('users')
    .select('id, auth_id, email, is_superuser, employee_id')
    .eq('auth_id', id)
    .maybeSingle();
  if (byAuth) return byAuth;

  const { data: byId } = await supabase
    .from('users')
    .select('id, auth_id, email, is_superuser, employee_id')
    .eq('id', id)
    .maybeSingle();
  if (byId) return byId;

  if (id.includes('@')) {
    const { data: byEmail } = await supabase
      .from('users')
      .select('id, auth_id, email, is_superuser, employee_id')
      .eq('email', id)
      .maybeSingle();
    return byEmail || null;
  }

  return null;
}

/**
 * Manual Payper invoice retry: requires is_superuser OR tenants_employee.is_collection.
 */
async function canRetryPayperInvoice(authUserId) {
  const userRow = await resolveUserRow(authUserId);
  if (!userRow) {
    return false;
  }

  if (isTruthyFlag(userRow.is_superuser)) {
    return true;
  }

  if (!userRow.employee_id) {
    return false;
  }

  const { data: employee } = await supabase
    .from('tenants_employee')
    .select('is_collection')
    .eq('id', userRow.employee_id)
    .maybeSingle();

  return Boolean(employee && isTruthyFlag(employee.is_collection));
}

module.exports = {
  canRetryPayperInvoice,
};
