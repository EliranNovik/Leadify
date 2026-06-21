import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const BUCKET = 'client-portal-contact-profiles';
const SIGNED_SECONDS = 60 * 60 * 24;
const MAX_BYTES = 5 * 1024 * 1024;

function storageLeadKey(leadSummary: Record<string, unknown> | undefined): string | null {
  if (!leadSummary) return null;
  const legacyId = leadSummary.legacy_lead_id;
  const newId = leadSummary.new_lead_id;
  if (legacyId != null && String(legacyId).trim() !== '') {
    return `legacy-${legacyId}`;
  }
  if (newId != null && String(newId).trim() !== '') {
    return `new-${newId}`;
  }
  return null;
}

function isAllowedProfilePath(path: string, leadSummary: Record<string, unknown> | undefined): boolean {
  if (!path.startsWith('contact-profiles/')) return false;
  const leadKey = storageLeadKey(leadSummary);
  if (leadKey && path.startsWith(`contact-profiles/${leadKey}/`)) return true;
  const leadNumber = String(leadSummary?.lead_number ?? '').trim();
  if (leadNumber && path.startsWith(`contact-profiles/${leadNumber}/`)) return true;
  return false;
}

function pathMatchesContact(storagePath: string, contactId: number): boolean {
  if (!Number.isFinite(contactId) || contactId <= 0) return false;
  return new RegExp(`^contact-profiles/[^/]+/${contactId}/`).test(storagePath);
}

function decodeBase64ToBytes(base64: string): Uint8Array {
  const normalized = base64.includes(',') ? base64.split(',').pop() ?? '' : base64;
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
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
    const action = String(body.action ?? 'sign_urls').trim();

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

    const leadSummary = sessionData.lead_summary as Record<string, unknown> | undefined;

    if (action === 'upload') {
      const storagePath = String(body.storage_path ?? '').trim();
      const contactId = Number(body.contact_id);
      const contentType = String(body.content_type ?? 'image/jpeg').trim() || 'image/jpeg';
      const fileBase64 = String(body.file_base64 ?? '');

      if (!storagePath || !fileBase64) {
        return new Response(JSON.stringify({ ok: false, error: 'Missing upload data' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (!isAllowedProfilePath(storagePath, leadSummary) || !pathMatchesContact(storagePath, contactId)) {
        return new Response(JSON.stringify({ ok: false, error: 'Invalid storage path' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { data: sessionRow, error: sessionRowErr } = await admin
        .from('client_portal_sessions')
        .select('id')
        .eq('session_token', sessionToken)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();

      if (sessionRowErr || !sessionRow?.id) {
        return new Response(JSON.stringify({ ok: false, error: 'Session not found' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { data: uploadToken, error: tokenErr } = await admin
        .from('client_portal_upload_tokens')
        .select('id')
        .eq('session_id', sessionRow.id)
        .eq('storage_path', storagePath)
        .eq('used', false)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();

      if (tokenErr || !uploadToken?.id) {
        return new Response(JSON.stringify({ ok: false, error: 'Invalid or expired upload token' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const bytes = decodeBase64ToBytes(fileBase64);
      if (bytes.length > MAX_BYTES) {
        return new Response(JSON.stringify({ ok: false, error: 'File exceeds 5MB limit' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { error: uploadErr } = await admin.storage.from(BUCKET).upload(storagePath, bytes, {
        contentType,
        upsert: true,
      });

      if (uploadErr) {
        return new Response(JSON.stringify({ ok: false, error: uploadErr.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ ok: true, storage_path: storagePath }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const storagePaths: string[] = Array.isArray(body.storage_paths)
      ? body.storage_paths.map((p: unknown) => String(p ?? '').trim()).filter(Boolean)
      : [];

    if (!storagePaths.length) {
      return new Response(JSON.stringify({ ok: true, urls: {} }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const urls: Record<string, string> = {};

    for (const path of storagePaths) {
      if (!isAllowedProfilePath(path, leadSummary)) continue;

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
