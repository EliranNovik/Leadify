const supabase = require('../config/supabase');

async function createWorkerLoginToken(targetUserId) {
  const id = String(targetUserId || '').trim();
  if (!id) {
    throw new Error('targetUserId is required');
  }

  const { data: targetUser, error: targetError } = await supabase
    .from('users')
    .select('id, email, auth_id, employee_id, is_active, extern')
    .eq('id', id)
    .maybeSingle();

  if (targetError || !targetUser) {
    throw new Error('Target user not found');
  }

  if (targetUser.is_active === false) {
    throw new Error('Target user is inactive');
  }

  const isExternal =
    targetUser.extern === true ||
    targetUser.extern === 'true' ||
    targetUser.extern === 1 ||
    targetUser.extern === '1';
  if (isExternal) {
    throw new Error('Cannot sign in as an external user');
  }

  if (!targetUser.email || !targetUser.auth_id) {
    throw new Error('Target user is missing email or auth account');
  }

  const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email: targetUser.email,
  });

  if (linkError) {
    throw linkError;
  }

  const tokenHash = linkData?.properties?.hashed_token;
  if (!tokenHash) {
    throw new Error('Failed to generate worker login token');
  }

  return {
    email: targetUser.email,
    token_hash: tokenHash,
    auth_id: String(targetUser.auth_id),
    user_id: String(targetUser.id),
    employee_id: targetUser.employee_id != null ? Number(targetUser.employee_id) : null,
  };
}

module.exports = {
  createWorkerLoginToken,
};
