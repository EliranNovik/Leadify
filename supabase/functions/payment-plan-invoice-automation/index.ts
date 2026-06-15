import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';

const LOG_PREFIX = '[payment-plan-invoice-automation]';

function log(...args: unknown[]) {
  console.log(LOG_PREFIX, ...args);
}

/**
 * Daily cron entry point for scheduled invoice sends.
 * Delegates to the Node backend which sends Outlook email + WhatsApp.
 *
 * Env:
 *   PAYMENT_PLAN_INVOICE_AUTOMATION_CRON_SECRET
 *   BACKEND_URL (or BACKEND_PUBLIC_URL)
 */
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

  const cronSecret = Deno.env.get('PAYMENT_PLAN_INVOICE_AUTOMATION_CRON_SECRET');
  const cronHeader = req.headers.get('x-cron-secret');
  if (!cronSecret || cronHeader !== cronSecret) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const backendUrl = (
    Deno.env.get('BACKEND_URL') ||
    Deno.env.get('BACKEND_PUBLIC_URL') ||
    ''
  ).replace(/\/+$/, '');

  if (!backendUrl) {
    return new Response(
      JSON.stringify({ error: 'BACKEND_URL is not configured on the edge function' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  let body: { dryRun?: boolean; dueDate?: string } = {};
  try {
    const text = await req.text();
    if (text) body = JSON.parse(text);
  } catch {
    // empty body is fine
  }

  const dryRun = Boolean(body.dryRun);

  try {
    const res = await fetch(`${backendUrl}/api/payment-plan-invoice-automation/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-cron-secret': cronSecret,
      },
      body: JSON.stringify({ dryRun, dueDate: body.dueDate }),
    });

    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      log('Backend run failed', res.status, payload);
      return new Response(JSON.stringify({ ok: false, ...payload }), {
        status: res.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    log(
      `Due ${payload.dueDate}: sent=${payload.sent} modern=${payload.pendingModern} legacy=${payload.pendingLegacy} errors=${payload.errors?.length ?? 0}`,
    );

    return new Response(JSON.stringify({ ok: true, ...payload }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log('Request to backend failed:', message);
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
