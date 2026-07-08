import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import {
  createSwitchGrant,
  createWorkerLoginTokenForUser,
  isTruthyFlag,
  verifySwitchGrant,
} from '../_shared/adminImpersonation.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function verifyActiveBypassSession(
  authHeader: string,
  adminAuthUserId: string,
  sessionAuthUserId: string,
): Promise<boolean> {
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData?.user?.id) return false;
  if (authData.user.id !== sessionAuthUserId) return false;

  const serviceClient = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: adminRow } = await serviceClient
    .from('users')
    .select('is_superuser, is_active')
    .eq('auth_id', adminAuthUserId)
    .maybeSingle();

  if (!adminRow || adminRow.is_active === false) return false;
  return isTruthyFlag(adminRow.is_superuser);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ success: false, error: 'Method not allowed' }, 405);
  }

  try {
    const authHeader = req.headers.get('Authorization');
    const body = await req.json().catch(() => ({}));
    const targetUserId = String(body?.targetUserId || body?.userId || '').trim();
    const adminAuthUserId = String(body?.adminAuthUserId || '').trim();
    const sessionAuthUserId = String(body?.sessionAuthUserId || '').trim();
    const switchGrant = String(body?.switchGrant || body?.switch_grant || '').trim();

    if (!targetUserId || !adminAuthUserId) {
      return json({ success: false, error: 'targetUserId and adminAuthUserId are required' }, 400);
    }

    let grantValid = false;
    let resolvedGrant = switchGrant;

    if (switchGrant) {
      grantValid = await verifySwitchGrant(switchGrant, adminAuthUserId);
    }

    if (!grantValid) {
      if (!authHeader || !sessionAuthUserId) {
        return json({
          success: false,
          error: 'Admin switch grant expired. Please sign in again from the login page.',
        }, 403);
      }

      const bypassValid = await verifyActiveBypassSession(
        authHeader,
        adminAuthUserId,
        sessionAuthUserId,
      );
      if (!bypassValid) {
        return json({
          success: false,
          error: 'Admin switch grant expired. Please sign in again from the login page.',
        }, 403);
      }

      resolvedGrant = await createSwitchGrant(adminAuthUserId);
    }

    const serviceClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const tokenPayload = await createWorkerLoginTokenForUser(serviceClient, targetUserId);

    return json({
      success: true,
      switch_grant: resolvedGrant,
      ...tokenPayload,
    });
  } catch (error) {
    console.error('admin-switch-worker error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return json({ success: false, error: message }, 500);
  }
});
