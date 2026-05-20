import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import {
  buildBoiExrUrl,
  fetchBoiRepresentativeRates,
  parseBaseCurrenciesList,
  type BoiRateRow,
} from '../_shared/boi-exchange-rates.ts';

const LOG_PREFIX = '[boi-exchange-rates-sync]';

function log(...args: unknown[]) {
  console.log(LOG_PREFIX, ...args);
}

function logError(...args: unknown[]) {
  console.error(LOG_PREFIX, ...args);
}

async function upsertRates(admin: ReturnType<typeof createClient>, rows: BoiRateRow[]) {
  const payload = rows.map((r) => ({
    rate_date: r.rate_date,
    base_currency: r.base_currency,
    target_currency: r.target_currency,
    rate: r.rate,
    source: r.source,
  }));

  const { data, error } = await admin
    .from('boi_exchange_rates')
    .upsert(payload, {
      onConflict: 'rate_date,base_currency,target_currency,source',
    })
    .select('id, rate_date, base_currency, target_currency, rate');

  if (error) throw error;
  return data ?? [];
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

  const cronSecret = Deno.env.get('BOI_RATES_SYNC_CRON_SECRET');
  const cronHeader = req.headers.get('x-cron-secret');
  const cronOk = !!cronSecret && cronHeader === cronSecret;

  let authorized = cronOk;
  if (!authorized && authHeader.startsWith('Bearer ')) {
    const userClient = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: { user }, error } = await userClient.auth.getUser();
    authorized = !error && !!user;
  }

  if (!authorized) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let body: { dryRun?: boolean; currencies?: string[] } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const dryRun = Boolean(body.dryRun);
  const baseCurrencies = Array.isArray(body.currencies) && body.currencies.length > 0
    ? body.currencies.map((c) => String(c).trim().toUpperCase()).filter((c) => /^[A-Z]{3}$/.test(c))
    : parseBaseCurrenciesList(Deno.env.get('BOI_BASE_CURRENCIES'));

  log('Start', { dryRun, baseCurrencies, auth: cronOk ? 'cron-secret' : 'bearer-user' });

  try {
    const apiUrl = buildBoiExrUrl(baseCurrencies, 1);
    const rows = await fetchBoiRepresentativeRates(baseCurrencies, 1);
    log('Fetched from BOI', {
      count: rows.length,
      dates: [...new Set(rows.map((r) => r.rate_date))],
      pairs: rows.map((r) => `${r.base_currency}/${r.target_currency}`),
    });

    if (dryRun) {
      return new Response(
        JSON.stringify({
          success: true,
          dryRun: true,
          fetched: rows.length,
          rates: rows,
          apiUrl,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const saved = await upsertRates(admin, rows);

    return new Response(
      JSON.stringify({
        success: true,
        fetched: rows.length,
        saved: saved.length,
        rates: saved,
        apiUrl,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError('Sync failed', message);
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
