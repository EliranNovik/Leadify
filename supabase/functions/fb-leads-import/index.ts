import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const LOG_PREFIX = '[fb-leads-import]';
const DEFAULT_EXPORT_URL =
  'https://bjwobzmsizdhfygzxgnt.supabase.co/functions/v1/fb-leads-export';
const MAX_PAGES_PER_RUN = 10;
const SOURCE_FIELD_NAMES = new Set([
  'source_code',
  'source code',
  'source-code',
  'sourcecode',
  'source_code_value',
]);

const headers = { ...corsHeaders, 'Content-Type': 'application/json' };

function log(...args: unknown[]) {
  console.log(LOG_PREFIX, ...args);
}

function logError(...args: unknown[]) {
  console.error(LOG_PREFIX, ...args);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

function trimSecret(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Same 32-bit integer rule as the Facebook webhook's parseIntegerSourceCode. */
function parseIntegerSourceCode(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || !Number.isInteger(numeric)) return null;
  if (numeric < -2147483648 || numeric > 2147483647) return null;
  return numeric;
}

function parseFormSourceCodes(raw: string | null | undefined): Record<string, number> {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const numeric = parseIntegerSourceCode(value);
      if (numeric !== null && key.trim()) out[key.trim()] = numeric;
    }
    return out;
  } catch (error) {
    logError('FACEBOOK_FORM_SOURCE_CODES is not valid JSON', error);
    return {};
  }
}

function resolveSourceCodeFromIdentifier(
  identifier: string | null,
  formSourceCodes: Record<string, number>,
): number | null {
  if (!identifier) return null;
  if (formSourceCodes[identifier] !== undefined) return formSourceCodes[identifier];
  return parseIntegerSourceCode(identifier);
}

function textOrNull(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

/** Graph field_data array, a name→value object, or a payload that nests field_data. */
function readFieldMap(fieldData: unknown): Map<string, string> {
  const map = new Map<string, string>();
  const absorb = (name: string, value: unknown) => {
    const key = name.trim().toLowerCase();
    if (!key || map.has(key)) return;
    const raw = Array.isArray(value) ? value.find((item) => textOrNull(item)) : value;
    const text = textOrNull(raw);
    if (text) map.set(key, text);
  };

  if (Array.isArray(fieldData)) {
    for (const item of fieldData) {
      if (!item || typeof item !== 'object') continue;
      const row = item as { name?: unknown; values?: unknown };
      if (row.name != null) absorb(String(row.name), row.values);
    }
    return map;
  }

  if (fieldData && typeof fieldData === 'object') {
    const obj = fieldData as Record<string, unknown>;
    if (Array.isArray(obj.field_data)) return readFieldMap(obj.field_data);
    for (const [key, value] of Object.entries(obj)) absorb(key, value);
  }
  return map;
}

type ExportLead = {
  leadgen_id?: unknown;
  full_name?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  email?: unknown;
  phone?: unknown;
  form_id?: unknown;
  page_id?: unknown;
  campaign_id?: unknown;
  ad_id?: unknown;
  field_data?: unknown;
  created_at?: unknown;
};

type MappedLead = {
  leadgenId: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  topic: string | null;
  sourceCode: number | null;
  formId: string | null;
  pageId: string | null;
  campaignId: string | null;
  adId: string | null;
  createdAt: string | null;
};

function mapExportLead(
  lead: ExportLead,
  formSourceCodes: Record<string, number>,
  defaultSourceCode: number | null,
): MappedLead | null {
  const fields = readFieldMap(lead.field_data);
  const field = (name: string) => fields.get(name.toLowerCase()) ?? null;

  const leadgenId = textOrNull(lead.leadgen_id);
  if (!leadgenId) return null;

  const firstName = textOrNull(lead.first_name) || field('first_name');
  const lastName = textOrNull(lead.last_name) || field('last_name');
  const fullName = textOrNull(lead.full_name) || field('full_name') || field('name');
  const name = fullName || (firstName && lastName ? `${firstName} ${lastName}` : firstName || lastName);

  let sourceFromField: number | null = null;
  for (const key of SOURCE_FIELD_NAMES) {
    sourceFromField = parseIntegerSourceCode(fields.get(key));
    if (sourceFromField !== null) break;
  }

  const formId = textOrNull(lead.form_id);
  const sourceFromForm = resolveSourceCodeFromIdentifier(formId, formSourceCodes);
  const sourceFromLeadgen = sourceFromField === null && sourceFromForm === null
    ? resolveSourceCodeFromIdentifier(leadgenId, formSourceCodes)
    : null;
  const sourceCode = sourceFromField ?? sourceFromForm ?? sourceFromLeadgen ?? defaultSourceCode;

  return {
    leadgenId,
    name,
    email: (textOrNull(lead.email) || field('email'))?.toLowerCase() ?? null,
    phone: textOrNull(lead.phone) || field('phone_number') || field('phone'),
    topic: field('about') || field('additional_info') || field('message'),
    sourceCode,
    formId,
    pageId: textOrNull(lead.page_id),
    campaignId: textOrNull(lead.campaign_id),
    adId: textOrNull(lead.ad_id),
    createdAt: textOrNull(lead.created_at),
  };
}

function isSourceRejection(message: string): boolean {
  const text = message.toLowerCase();
  return text.includes('not found in misc_leadsource') || text.includes('is inactive');
}

function cronAuthorized(req: Request): boolean {
  const header = trimSecret(req.headers.get('x-cron-secret'));
  if (!header) return false;
  const names = [
    'FB_LEADS_IMPORT_CRON_SECRET',
    'GOOGLE_SHEETS_SYNC_CRON_SECRET',
    'PAYMENT_PLAN_INVOICE_AUTOMATION_CRON_SECRET',
  ];
  return names.some((name) => trimSecret(Deno.env.get(name)) === header);
}

function authorized(req: Request): boolean {
  const bearer = trimSecret(req.headers.get('Authorization')?.replace(/^Bearer\s+/i, ''));
  const serviceKey = trimSecret(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
  if (bearer && serviceKey && bearer === serviceKey) return true;
  return cronAuthorized(req);
}

type ImportBody = {
  dryRun?: boolean;
  limit?: number;
  exportSecret?: string;
  exportUrl?: string;
  defaultSourceCode?: unknown;
  formSourceCodes?: unknown;
};

async function readCursor(admin: SupabaseClient): Promise<string | null> {
  const { data, error } = await admin
    .from('fb_lead_import_state')
    .select('cursor_since')
    .eq('id', 1)
    .maybeSingle();
  if (error) throw new Error(`Could not read import cursor: ${error.message}`);
  return textOrNull(data?.cursor_since);
}

async function saveCursor(admin: SupabaseClient, cursor: string | null): Promise<void> {
  const { error } = await admin
    .from('fb_lead_import_state')
    .upsert({ id: 1, cursor_since: cursor, updated_at: new Date().toISOString() }, { onConflict: 'id' });
  if (error) throw new Error(`Could not save import cursor: ${error.message}`);
}

async function fetchExportPage(
  exportUrl: string,
  exportSecret: string,
  since: string | null,
  limit: number,
): Promise<{ count: number; nextSince: string | null; leads: ExportLead[] }> {
  const url = new URL(exportUrl);
  if (since) url.searchParams.set('since', since);
  url.searchParams.set('limit', String(limit));

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { 'X-Export-Secret': exportSecret },
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Facebook lead export HTTP ${response.status}: ${raw.slice(0, 300)}`);
  }
  let body: { count?: unknown; next_since?: unknown; leads?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    throw new Error('Facebook lead export returned non-JSON');
  }
  const leads = Array.isArray(body.leads) ? body.leads as ExportLead[] : [];
  const count = typeof body.count === 'number' ? body.count : leads.length;
  return { count, nextSince: textOrNull(body.next_since), leads };
}

async function importLead(
  admin: SupabaseClient,
  mapped: MappedLead,
): Promise<'created' | 'duplicate' | 'skipped'> {
  const { data: existing, error: existingError } = await admin
    .from('fb_imported_leadgen')
    .select('leadgen_id, lead_id')
    .eq('leadgen_id', mapped.leadgenId)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing?.lead_id) return 'duplicate';

  if (!mapped.name || !mapped.email) {
    log('Skipped lead missing name or email', { leadgenId: mapped.leadgenId });
    return 'skipped';
  }
  if (mapped.sourceCode === null) {
    log('Skipped lead with no source code', { leadgenId: mapped.leadgenId, formId: mapped.formId });
    return 'skipped';
  }

  if (!existing) {
    const { error: claimError } = await admin
      .from('fb_imported_leadgen')
      .insert({ leadgen_id: mapped.leadgenId });
    if (claimError) {
      if (claimError.code === '23505') return 'duplicate';
      throw new Error(claimError.message);
    }
  }

  const { data: created, error: insertError } = await admin.rpc('create_lead_with_source_validation', {
    p_lead_name: mapped.name,
    p_lead_email: mapped.email,
    p_lead_phone: mapped.phone,
    p_lead_topic: mapped.topic,
    p_lead_language: 'EN',
    p_lead_source: 'Facebook',
    p_created_by: 'facebook@webhook',
    p_source_code: mapped.sourceCode,
    p_balance_currency: 'NIS',
    p_proposal_currency: 'NIS',
  });

  if (insertError) {
    await admin.from('fb_imported_leadgen').delete().eq('leadgen_id', mapped.leadgenId).is('lead_id', null);
    if (isSourceRejection(insertError.message || '')) {
      log('Skipped lead, source rejected', { leadgenId: mapped.leadgenId, message: insertError.message });
      return 'skipped';
    }
    throw new Error(insertError.message);
  }

  const row = Array.isArray(created) ? created[0] : created;
  const leadId = row?.id ? String(row.id) : null;
  if (!leadId) {
    await admin.from('fb_imported_leadgen').delete().eq('leadgen_id', mapped.leadgenId).is('lead_id', null);
    throw new Error(`Lead insert returned no id for leadgen_id ${mapped.leadgenId}`);
  }

  const { error: linkError } = await admin
    .from('fb_imported_leadgen')
    .update({ lead_id: leadId })
    .eq('leadgen_id', mapped.leadgenId);
  if (linkError) logError('Lead created but dedupe row was not linked', mapped.leadgenId, linkError.message);

  const { error: metaError } = await admin
    .from('leads')
    .update({
      utm_params: {
        leadgen_id: mapped.leadgenId,
        form_id: mapped.formId,
        page_id: mapped.pageId,
        campaign_id: mapped.campaignId,
        ad_id: mapped.adId,
        facebook_created_at: mapped.createdAt,
        arrived_via: 'facebook_lead_export',
      },
    })
    .eq('id', leadId);
  if (metaError) logError('Lead created but facebook meta was not saved', mapped.leadgenId, metaError.message);

  log('Created lead', { leadgenId: mapped.leadgenId, leadNumber: row?.lead_number, sourceCode: mapped.sourceCode });
  return 'created';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!authorized(req)) return json({ error: 'Unauthorized' }, 401);

  let body: ImportBody = {};
  try {
    const text = await req.text();
    body = text ? JSON.parse(text) as ImportBody : {};
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const exportSecret = trimSecret(typeof body.exportSecret === 'string' ? body.exportSecret : null)
    || trimSecret(Deno.env.get('FB_LEADS_EXPORT_SECRET'));
  if (!exportSecret) {
    return json({ error: 'FB_LEADS_EXPORT_SECRET is not set' }, 500);
  }

  const exportUrl = trimSecret(typeof body.exportUrl === 'string' ? body.exportUrl : null)
    || trimSecret(Deno.env.get('FB_LEADS_EXPORT_URL'))
    || DEFAULT_EXPORT_URL;

  const requestedLimit = Number(body.limit ?? Deno.env.get('FB_LEADS_IMPORT_LIMIT') ?? 100);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(500, Math.max(1, Math.floor(requestedLimit)))
    : 100;

  const formSourceRaw = typeof body.formSourceCodes === 'string'
    ? body.formSourceCodes
    : Deno.env.get('FACEBOOK_FORM_SOURCE_CODES');
  const formSourceCodes = parseFormSourceCodes(formSourceRaw);
  const defaultSourceCode = parseIntegerSourceCode(
    body.defaultSourceCode ?? Deno.env.get('FACEBOOK_DEFAULT_SOURCE_CODE'),
  );
  const dryRun = Boolean(body.dryRun);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return json({ error: 'Supabase service role is not configured' }, 500);

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  try {
    let since = await readCursor(admin);
    const summary = {
      dryRun,
      pages: 0,
      fetched: 0,
      created: 0,
      duplicates: 0,
      skipped: 0,
      cursor: since,
      blocked: false,
    };

    for (let page = 0; page < MAX_PAGES_PER_RUN; page += 1) {
      const batch = await fetchExportPage(exportUrl, exportSecret, since, limit);
      summary.pages += 1;
      summary.fetched += batch.leads.length;
      log('Export page', { since, count: batch.count, leads: batch.leads.length, nextSince: batch.nextSince });

      let pageFailed = false;
      for (const rawLead of batch.leads) {
        const mapped = mapExportLead(rawLead, formSourceCodes, defaultSourceCode);
        if (!mapped) {
          summary.skipped += 1;
          continue;
        }
        if (dryRun) continue;
        try {
          const outcome = await importLead(admin, mapped);
          if (outcome === 'created') summary.created += 1;
          else if (outcome === 'duplicate') summary.duplicates += 1;
          else summary.skipped += 1;
        } catch (error) {
          pageFailed = true;
          summary.blocked = true;
          logError('Lead insert failed, cursor not advanced', mapped.leadgenId, error instanceof Error ? error.message : error);
          break;
        }
      }

      if (pageFailed || dryRun) break;

      const previousSince = since;
      const nextSince = batch.nextSince;
      if (nextSince && nextSince !== previousSince) {
        await saveCursor(admin, nextSince);
        since = nextSince;
        summary.cursor = nextSince;
      }

      // count === limit means another page is waiting. Stop when the cursor cannot move.
      const moreWaiting = batch.count >= limit && Boolean(nextSince) && nextSince !== previousSince;
      if (!moreWaiting) break;
    }

    return json({ success: true, ...summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Facebook lead import failed';
    logError(message);
    return json({ error: message }, 500);
  }
});
