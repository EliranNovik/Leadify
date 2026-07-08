import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import {
  createSwitchGrant,
  createWorkerLoginTokenForUser,
  isTruthyFlag,
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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ success: false, error: 'Method not allowed' }, 405);
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ success: false, error: 'Authorization required' }, 401);
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData?.user?.id) {
      return json({ success: false, error: 'Invalid session' }, 401);
    }

    const serviceClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: adminRow, error: adminError } = await serviceClient
      .from('users')
      .select('id, is_superuser, is_active')
      .eq('auth_id', authData.user.id)
      .maybeSingle();

    if (adminError || !adminRow) {
      return json({ success: false, error: 'User profile not found' }, 403);
    }

    if (adminRow.is_active === false) {
      return json({ success: false, error: 'Account is inactive' }, 403);
    }

    if (!isTruthyFlag(adminRow.is_superuser)) {
      return json({ success: false, error: 'Superuser access required' }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const targetUserId = String(body?.targetUserId || body?.userId || '').trim();
    if (!targetUserId) {
      return json({ success: false, error: 'targetUserId is required' }, 400);
    }

    const tokenPayload = await createWorkerLoginTokenForUser(serviceClient, targetUserId);
    const switchGrant = await createSwitchGrant(authData.user.id);

    return json({
      success: true,
      switch_grant: switchGrant,
      ...tokenPayload,
    });
  } catch (error) {
    console.error('admin-impersonate-worker error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return json({ success: false, error: message }, 500);
  }
});
