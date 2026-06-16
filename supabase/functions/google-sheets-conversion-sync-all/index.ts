import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import {
  googleSheetsCronAuthorized,
  resolveGoogleSheetsCronSecret,
} from '../_shared/googleSheetsCronAuth.ts';

const LOG_PREFIX = '[google-sheets-conversion-sync-all]';

const SYNC_TARGETS = [
  { slug: 'google-sheets-bad-leads-sync', label: 'BadLeads' },
  { slug: 'google-sheets-qleads-sync', label: 'QLeads' },
  { slug: 'google-sheets-hqleads-sync', label: 'HQLeads' },
  { slug: 'google-sheets-salesleads-sync', label: 'SalesLeads' },
] as const;

function log(...args: unknown[]) {
  console.log(LOG_PREFIX, ...args);
}

function logError(...args: unknown[]) {
  console.error(LOG_PREFIX, ...args);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseAnon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const authHeader = req.headers.get('Authorization') ?? '';
  const cronSecret = resolveGoogleSheetsCronSecret(req);
  const cronOk = googleSheetsCronAuthorized(req, 'BAD_LEADS_SYNC_CRON_SECRET');

  let authorized = cronOk;
  if (!authorized && authHeader.startsWith('Bearer ')) {
    const userClient = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: { user }, error } = await userClient.auth.getUser();
    if (!error && user) {
      const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
      let row: { is_superuser?: unknown } | null = null;
      const { data: byAuth } = await admin
        .from('users')
        .select('is_superuser')
        .eq('auth_id', user.id)
        .maybeSingle();
      row = byAuth;
      if (!row && user.email) {
        const { data: byEmail } = await admin
          .from('users')
          .select('is_superuser')
          .eq('email', user.email)
          .maybeSingle();
        row = byEmail;
      }
      const isSuper =
        row?.is_superuser === true || row?.is_superuser === 'true' || row?.is_superuser === 1;
      authorized = isSuper;
    }
  }

  if (!authorized) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!cronSecret) {
    return new Response(
      JSON.stringify({ error: 'GOOGLE_SHEETS_SYNC_CRON_SECRET is not configured on the server' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  let body: { limit?: number; dryRun?: boolean; debug?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const limit = Math.min(500, Math.max(1, Number(body.limit) || 200));
  const dryRun = Boolean(body.dryRun);
  const debug = Boolean(body.debug);

  log('Starting orchestrated sync', { limit, dryRun, debug, targets: SYNC_TARGETS.length });

  const results: Array<{
    label: string;
    slug: string;
    ok: boolean;
    status: number;
    appended?: number;
    candidateCount?: number;
    error?: string;
  }> = [];

  for (const target of SYNC_TARGETS) {
    const url = `${supabaseUrl}/functions/v1/${target.slug}`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${serviceKey}`,
          apikey: serviceKey,
          'x-cron-secret': cronSecret,
        },
        body: JSON.stringify({ limit, dryRun, debug }),
      });
      const text = await res.text();
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(text) as Record<string, unknown>;
      } catch {
        payload = { raw: text.slice(0, 500) };
      }

      const ok = res.ok && payload.ok !== false && !payload.error;
      results.push({
        label: target.label,
        slug: target.slug,
        ok,
        status: res.status,
        appended: typeof payload.appended === 'number' ? payload.appended : undefined,
        candidateCount: typeof payload.candidateCount === 'number' ? payload.candidateCount : undefined,
        error: ok ? undefined : String(payload.error ?? text.slice(0, 200)),
      });
      log(`Finished ${target.label}`, { ok, status: res.status, appended: payload.appended });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logError(`Failed ${target.label}`, msg);
      results.push({ label: target.label, slug: target.slug, ok: false, status: 0, error: msg });
    }
  }

  const allOk = results.every((r) => r.ok);
  const totalAppended = results.reduce((sum, r) => sum + (r.appended ?? 0), 0);

  return new Response(
    JSON.stringify({
      ok: allOk,
      dryRun,
      totalAppended,
      results,
      ...(debug ? { debug: { limit, cronConfigured: Boolean(cronSecret) } } : {}),
    }),
    {
      status: allOk ? 200 : 207,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    },
  );
});
