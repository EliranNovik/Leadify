import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { GoogleAuth } from 'npm:google-auth-library@9.15.1';
import { corsHeaders } from '../_shared/cors.ts';

const DESTINATION = 'bad_leads_capital_firm';
const DEFAULT_SPREADSHEET_ID = '1hPgtAhMJ_GNAQJkh46U9xL5rDD6LMBCDw9NXYOAddWs';
/** Default tab title in your BadLeads workbook (override with GOOGLE_SHEET_BAD_LEADS_TAB). */
const DEFAULT_SHEET_TAB = 'conversion-import-template';

const LOG_PREFIX = '[google-sheets-bad-leads-sync]';

function log(...args: unknown[]) {
  console.log(LOG_PREFIX, ...args);
}

function logError(...args: unknown[]) {
  console.error(LOG_PREFIX, ...args);
}

/** A1 range with sheet title quoted for Google Sheets API (hyphens, spaces, etc.). */
function sheetRangeA1(tabName: string, cellRange: string): string {
  const t = tabName.trim();
  if (!t) throw new Error('Sheet tab name is empty; set GOOGLE_SHEET_BAD_LEADS_TAB');
  const escaped = t.replace(/'/g, "''");
  return `'${escaped}'!${cellRange}`;
}

function formatConversionTimeJerusalem(iso: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const g = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? '';
  const month = g('month');
  const day = g('day');
  const year = g('year');
  let hour = g('hour');
  let minute = g('minute');
  if (hour.length === 1) hour = `0${hour}`;
  if (minute.length === 1) minute = `0${minute}`;
  return `${month}/${day}/${year} ${hour}:${minute}`;
}

async function getGoogleAccessToken(): Promise<string> {
  const email = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_EMAIL');
  const pk = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY')?.replace(/\\n/g, '\n');
  if (!email || !pk) {
    throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY');
  }
  const auth = new GoogleAuth({
    credentials: { client_email: email, private_key: pk },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const client = await auth.getClient();
  const tok = await client.getAccessToken();
  const token = typeof tok === 'string' ? tok : tok?.token;
  if (!token) throw new Error('Google access token empty');
  return token;
}

async function appendSheetRows(
  spreadsheetId: string,
  tabName: string,
  rows: (string | number)[][],
  accessToken: string,
): Promise<{ updatedRange?: string; updatedRows?: number; updatedCells?: number; spreadsheetId: string; tabName: string }> {
  const a1 = sheetRangeA1(tabName, 'A:E');
  const range = encodeURIComponent(a1);
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  log('Sheets append request', { spreadsheetId, tabName, a1, rowCount: rows.length });
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values: rows }),
  });
  const rawText = await res.text();
  if (!res.ok) {
    logError('Sheets append HTTP error', res.status, rawText.slice(0, 800));
    throw new Error(`Google Sheets API ${res.status}: ${rawText.slice(0, 500)}`);
  }
  let body: { updates?: { updatedRange?: string; updatedRows?: number; updatedCells?: number } } = {};
  try {
    body = JSON.parse(rawText);
  } catch {
    logError('Sheets append: non-JSON success body', rawText.slice(0, 200));
  }
  const u = body.updates ?? {};
  log('Sheets append OK', {
    updatedRange: u.updatedRange,
    updatedRows: u.updatedRows,
    updatedCells: u.updatedCells,
  });
  return {
    spreadsheetId,
    tabName,
    updatedRange: u.updatedRange,
    updatedRows: u.updatedRows,
    updatedCells: u.updatedCells,
  };
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

  const cronSecret = Deno.env.get('BAD_LEADS_SYNC_CRON_SECRET');
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

  let body: { dryRun?: boolean; limit?: number; debug?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const dryRun = Boolean(body.dryRun);
  const debug = Boolean(body.debug);
  const limit = Math.min(500, Math.max(1, Number(body.limit) || 200));

  log('Request', { dryRun, debug, limit, auth: cronOk ? 'cron-secret' : 'bearer-user' });

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const { data: leads, error: rpcErr } = await admin.rpc('get_leads_for_bad_leads_google_sheet_export', {
    p_limit: limit,
  });
  if (rpcErr) {
    logError('RPC get_leads_for_bad_leads_google_sheet_export failed', rpcErr);
    return new Response(JSON.stringify({ error: rpcErr.message, ...(debug ? { debug: { rpcError: rpcErr } } : {}) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const list = (leads ?? []) as Array<{
    id: string;
    created_at: string;
    utm_params: Record<string, unknown> | null;
    lead_number: string | null;
    lead_name: string | null;
    source_id: number | string;
  }>;

  log('RPC returned rows', { count: list.length });

  const spreadsheetId = Deno.env.get('GOOGLE_SHEET_BAD_LEADS_SPREADSHEET_ID') ?? DEFAULT_SPREADSHEET_ID;
  const tabName = Deno.env.get('GOOGLE_SHEET_BAD_LEADS_TAB')?.trim() || DEFAULT_SHEET_TAB;

  type LogRow = {
    destination: string;
    lead_id: string;
    lead_number: string | null;
    lead_name: string | null;
    gclid: string;
    conversion_name: string;
    conversion_time: string;
    conversion_value: number;
    conversion_currency: string;
    spreadsheet_id: string;
  };

  const filterStats = {
    skippedNullUtm: 0,
    skippedUtmJsonParse: 0,
    skippedEmptyGclid: 0,
    included: 0,
  };
  const valueRows: (string | number)[][] = [];
  const logRows: LogRow[] = [];
  const preview: Array<{ lead_id: string; lead_number: string | null; gclid_prefix: string }> = [];

  for (const l of list) {
    if (l.utm_params == null) {
      filterStats.skippedNullUtm++;
      continue;
    }
    let up: Record<string, unknown> = {};
    if (typeof l.utm_params === 'string') {
      try {
        up = JSON.parse(l.utm_params) as Record<string, unknown>;
      } catch {
        filterStats.skippedUtmJsonParse++;
        continue;
      }
    } else if (typeof l.utm_params === 'object') {
      up = l.utm_params as Record<string, unknown>;
    }
    const gclid = typeof up.gclid === 'string' ? up.gclid.trim() : '';
    if (!gclid) {
      filterStats.skippedEmptyGclid++;
      continue;
    }
    filterStats.included++;
    const convTime = formatConversionTimeJerusalem(l.created_at);
    valueRows.push([gclid, 'BadLeads', convTime, 0, 'ils']);
    logRows.push({
      destination: DESTINATION,
      lead_id: l.id,
      lead_number: l.lead_number,
      lead_name: l.lead_name,
      gclid,
      conversion_name: 'BadLeads',
      conversion_time: l.created_at,
      conversion_value: 0,
      conversion_currency: 'ils',
      spreadsheet_id: spreadsheetId,
    });
    if (preview.length < 8) {
      preview.push({
        lead_id: l.id,
        lead_number: l.lead_number,
        gclid_prefix: `${gclid.slice(0, 10)}…`,
      });
    }
  }

  log('After gclid / utm filter', { ...filterStats, valueRowCount: valueRows.length });

  const debugPayload = {
    destination: DESTINATION,
    spreadsheetId,
    tabName,
    googleEmailConfigured: Boolean(Deno.env.get('GOOGLE_SERVICE_ACCOUNT_EMAIL')),
    googlePkConfigured: Boolean(Deno.env.get('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY')),
    filter: filterStats,
    preview,
  };

  if (list.length === 0) {
    return new Response(
      JSON.stringify({
        ok: true,
        dryRun,
        candidateCount: 0,
        appended: 0,
        wouldAppend: 0,
        message: 'No matching leads to export (RPC returned 0 rows).',
        ...(debug ? { debug: debugPayload } : {}),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  if (dryRun) {
    return new Response(
      JSON.stringify({
        ok: true,
        dryRun: true,
        candidateCount: list.length,
        appended: 0,
        wouldAppend: valueRows.length,
        message:
          'Dry run only counts candidates. Nothing is written to Google Sheets and nothing is inserted into google_sheet_conversion_exports. Use “Sync to sheet” to write.',
        ...(debug ? { debug: debugPayload } : {}),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  if (valueRows.length === 0) {
    return new Response(
      JSON.stringify({
        ok: true,
        dryRun: false,
        candidateCount: list.length,
        appended: 0,
        wouldAppend: 0,
        message: 'RPC returned leads but none had a usable gclid in utm_params after parsing.',
        ...(debug ? { debug: debugPayload } : {}),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  let appendMeta: { updatedRange?: string; updatedRows?: number; updatedCells?: number; spreadsheetId: string; tabName: string } | undefined;
  try {
    const token = await getGoogleAccessToken();
    log('Google access token OK (length)', token.length);
    appendMeta = await appendSheetRows(spreadsheetId, tabName, valueRows, token);
  } catch (e) {
    logError('Google Sheets append or token failed', e);
    return new Response(
      JSON.stringify({
        error: String(e),
        candidateCount: list.length,
        wouldAppend: valueRows.length,
        ...(debug ? { debug: { ...debugPayload, appendMeta } } : {}),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  }

  const { error: insErr, data: insData } = await admin.from('google_sheet_conversion_exports').insert(logRows).select('id');
  if (insErr) {
    logError('Log insert failed after successful sheet append', insErr);
    return new Response(
      JSON.stringify({
        error: `Sheet updated but log insert failed: ${insErr.message}. Re-sync may duplicate sheet rows until logs are repaired.`,
        appended: valueRows.length,
        insertError: insErr,
        ...(debug ? { debug: { ...debugPayload, appendMeta, insertedIdsSample: insData } } : {}),
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  log('DB insert OK', { inserted: logRows.length, returnedIds: (insData ?? []).length });

  return new Response(
    JSON.stringify({
      ok: true,
      dryRun: false,
      candidateCount: list.length,
      appended: valueRows.length,
      spreadsheetId,
      tabName,
      sheets: appendMeta,
      ...(debug ? { debug: { ...debugPayload, appendMeta, insertedRowCount: (insData ?? []).length } } : {}),
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
