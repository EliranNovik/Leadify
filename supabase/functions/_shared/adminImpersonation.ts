const GRANT_TTL_SEC = 8 * 60 * 60;

function grantSecret(): string {
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
}

async function hmacSign(message: string): Promise<string> {
  const secret = grantSecret();
  if (!secret) throw new Error('Missing service role key');

  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function createSwitchGrant(adminAuthUserId: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + GRANT_TTL_SEC;
  const payload = { adminAuthUserId, exp };
  const sig = await hmacSign(JSON.stringify(payload));
  return btoa(JSON.stringify({ ...payload, sig }));
}

export async function verifySwitchGrant(
  grant: string,
  expectedAdminAuthUserId: string,
): Promise<boolean> {
  try {
    const parsed = JSON.parse(atob(grant)) as {
      adminAuthUserId?: string;
      exp?: number;
      sig?: string;
    };
    if (!parsed?.adminAuthUserId || !parsed?.exp || !parsed?.sig) return false;
    if (parsed.adminAuthUserId !== expectedAdminAuthUserId) return false;
    if (parsed.exp < Math.floor(Date.now() / 1000)) return false;

    const expectedSig = await hmacSign(
      JSON.stringify({ adminAuthUserId: parsed.adminAuthUserId, exp: parsed.exp }),
    );
    return parsed.sig === expectedSig;
  } catch {
    return false;
  }
}

export function isTruthyFlag(value: unknown): boolean {
  return value === true || value === 'true' || value === 't' || value === 1 || value === '1';
}

export async function createWorkerLoginTokenForUser(
  serviceClient: ReturnType<typeof import('https://esm.sh/@supabase/supabase-js@2').createClient>,
  targetUserId: string,
) {
  const id = String(targetUserId || '').trim();
  if (!id) {
    throw new Error('targetUserId is required');
  }

  const { data: targetUser, error: targetError } = await serviceClient
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

  const { data: linkData, error: linkError } = await serviceClient.auth.admin.generateLink({
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
