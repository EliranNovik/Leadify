import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const BUCKET = 'lead-sub-efforts-documents';
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

function isStoragePathAllowed(path: string, summary: LeadSummary | undefined): boolean {
  const allowed = leadKeys(summary);
  if (!allowed.size) return false;

  if (path.startsWith('case-documents/')) {
    const leadNumber = summary?.lead_number ? String(summary.lead_number) : '';
    if (leadNumber) {
      return path.includes(`/${leadNumber}/`) || path.startsWith(`case-documents/${leadNumber}/`);
    }
    return true;
  }

  if (path.startsWith('sub-efforts/')) {
    const leadKey = path.split('/')[1] ?? '';
    return allowed.has(leadKey);
  }

  // Legacy layout: <leadId>/<subEffortRowId>/<filename>
  const leadKey = path.split('/')[0] ?? '';
  return allowed.has(leadKey);
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
