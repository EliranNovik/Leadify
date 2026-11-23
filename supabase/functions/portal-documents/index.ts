import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const BUCKET = 'lead-sub-efforts-documents';
const TAX_INVOICE_BUCKET = 'payment-plan-tax-invoice-documents';
const SIGNED_SECONDS = 60 * 60 * 24;

type LeadSummary = {
  new_lead_id?: string | null;
  legacy_lead_id?: number | string | null;
  lead_number?: string | null;
};

function leadKeys(summary: LeadSummary | undefined): Set<string> {
  const keys = new Set<string>();
  if (!summary) return keys;
  if (summary.new_lead_id) keys.add(String(summary.new_lead_id));
  if (summary.legacy_lead_id != null && summary.legacy_lead_id !== '') {
    keys.add(String(summary.legacy_lead_id));
  }
  if (summary.lead_number) keys.add(String(summary.lead_number));
  return keys;
}

/**
 * How a case number can be spelled inside a storage path. `buildCaseDocumentStoragePath`
 * (src/lib/caseDocumentsStorage.ts) replaces anything unsafe, so case L209994/3 is filed under
 * both `L209994/3/` (older uploads) and `L209994_3/` (everything the drive writes). Missing the
 * second spelling left the client with documents they could see but never open.
 */
function pathSpellings(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];
  const sanitized = trimmed.replace(/[^\w.\-()+]/g, '_');
  return sanitized === trimmed ? [trimmed] : [trimmed, sanitized];
}

function matchesAnyKey(segment: string, allowed: Set<string>): boolean {
  if (!segment) return false;
  for (const key of allowed) {
    if (pathSpellings(key).includes(segment)) return true;
  }
  return false;
}

function isStoragePathAllowed(path: string, summary: LeadSummary | undefined): boolean {
  const allowed = leadKeys(summary);
  if (!allowed.size) return false;

  if (path.startsWith('case-documents/')) {
    const rest = path.slice('case-documents/'.length);
    for (const key of allowed) {
      for (const spelling of pathSpellings(key)) {
        if (rest.startsWith(`${spelling}/`)) return true;
      }
    }
    return false;
  }

  if (path.startsWith('sub-efforts/')) {
    const leadKey = path.split('/')[1] ?? '';
    return matchesAnyKey(leadKey, allowed);
  }

  // Legacy layout: <leadId>/<subEffortRowId>/<filename>
  const leadKey = path.split('/')[0] ?? '';
  return matchesAnyKey(leadKey, allowed);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const admin = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const sessionToken = String(body.session_token ?? '').trim();
    const storagePaths: string[] = Array.isArray(body.storage_paths)
      ? body.storage_paths.map((p: unknown) => String(p ?? '').trim()).filter(Boolean)
      : [];

    if (!sessionToken) {
      return new Response(JSON.stringify({ ok: false, error: 'Missing session' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: sessionData, error: sessionErr } = await admin.rpc('portal_validate_session', {
      p_token: sessionToken,
    });

    if (sessionErr || !sessionData?.ok) {
      return new Response(JSON.stringify({ ok: false, error: 'Invalid session' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!storagePaths.length) {
      return new Response(JSON.stringify({ ok: true, urls: {} }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const leadSummary = sessionData.lead_summary as LeadSummary | undefined;
    const urls: Record<string, string> = {};
    const bucket = String(body.bucket ?? '').trim();

    if (bucket === TAX_INVOICE_BUCKET) {
      const { data: docRows, error: docErr } = await admin
        .from('payment_plan_tax_invoice_documents')
        .select('storage_path, payment_plan_id, is_legacy')
        .in('storage_path', storagePaths);
      if (docErr) throw docErr;

      const rows = (docRows ?? []) as Array<{
        storage_path: string;
        payment_plan_id: number;
        is_legacy: boolean;
      }>;
      const newIds = rows.filter((row) => !row.is_legacy).map((row) => row.payment_plan_id);
      const legacyIds = rows.filter((row) => row.is_legacy).map((row) => row.payment_plan_id);
      const allowedPlanIds = new Set<string>();

      if (newIds.length && leadSummary?.new_lead_id) {
        const { data: plans, error: planErr } = await admin
          .from('payment_plans')
          .select('id, lead_id')
          .in('id', newIds);
        if (planErr) throw planErr;
        for (const plan of plans ?? []) {
          if (String(plan.lead_id) === String(leadSummary.new_lead_id)) {
            allowedPlanIds.add(`new:${plan.id}`);
          }
        }
      }
      if (legacyIds.length && leadSummary?.legacy_lead_id != null && leadSummary.legacy_lead_id !== '') {
        const { data: plans, error: planErr } = await admin
          .from('finances_paymentplanrow')
          .select('id, lead_id')
          .in('id', legacyIds);
        if (planErr) throw planErr;
        for (const plan of plans ?? []) {
          if (String(plan.lead_id) === String(leadSummary.legacy_lead_id)) {
            allowedPlanIds.add(`legacy:${plan.id}`);
          }
        }
      }

      const signErrors: string[] = [];
      for (const row of rows) {
        const key = `${row.is_legacy ? 'legacy' : 'new'}:${row.payment_plan_id}`;
        if (!allowedPlanIds.has(key)) continue;
        const { data, error } = await admin.storage
          .from(TAX_INVOICE_BUCKET)
          .createSignedUrl(row.storage_path, SIGNED_SECONDS);
        if (!error && data?.signedUrl) {
          urls[row.storage_path] = data.signedUrl;
        } else if (error?.message) {
          signErrors.push(error.message);
        }
      }

      if (!Object.keys(urls).length) {
        const error = !rows.length
          ? 'Tax invoice file was not found'
          : !allowedPlanIds.size
            ? 'Tax invoice does not belong to this case'
            : signErrors[0] || 'Could not sign the tax invoice';
        return new Response(JSON.stringify({ ok: false, error }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ ok: true, urls }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    for (const path of storagePaths) {
      if (!isStoragePathAllowed(path, leadSummary)) continue;

      const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, SIGNED_SECONDS);
      if (!error && data?.signedUrl) {
        urls[path] = data.signedUrl;
      }
    }

    return new Response(JSON.stringify({ ok: true, urls }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
