const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error('Missing Supabase configuration. Please check your .env file.');
}

// #region agent log
const AGENT_LOG_ENDPOINT = 'http://127.0.0.1:7270/ingest/eeb50a38-afe4-4c94-8d17-bf7f20d90d0c';
const agentRedact = (text) =>
  String(text)
    .replace(/[\w.+-]+%40[\w.-]+/gi, '<email>')
    .replace(/[\w.+-]+@[\w.-]+/g, '<email>')
    .replace(/\d{7,}/g, '<num>');

const agentLoggingFetch = async (input, init) => {
  const callerStack = new Error().stack || '';
  const response = await fetch(input, init);
  const url = String(typeof input === 'string' ? input : input?.url || input);
  if (response.status >= 400 && url.includes('/rest/v1/')) {
    try {
      const parsedUrl = new URL(url);
      const body = await response.clone().json().catch(() => ({}));
      let bodyKeys = [];
      if (typeof init?.body === 'string') {
        try {
          const parsed = JSON.parse(init.body);
          const first = Array.isArray(parsed) ? parsed[0] : parsed;
          bodyKeys = first && typeof first === 'object' ? Object.keys(first) : [];
        } catch { /* non-JSON body */ }
      }
      const appFrames = callerStack
        .split('\n')
        .filter((line) => line.includes('/backend/src/') && !line.includes('config/supabase.js'))
        .slice(0, 6)
        .map((line) => line.trim());
      await fetch(AGENT_LOG_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '0da584' },
        body: JSON.stringify({
          sessionId: '0da584',
          runId: 'supabase-errors',
          hypothesisId: 'backend-rest-error',
          location: 'backend/src/config/supabase.js:agentLoggingFetch',
          message: `PostgREST ${response.status} ${body?.code || ''} on ${parsedUrl.pathname.replace('/rest/v1/', '')}`,
          data: {
            side: 'backend',
            method: (init?.method || 'GET').toUpperCase(),
            table: parsedUrl.pathname.replace('/rest/v1/', ''),
            query: agentRedact(decodeURIComponent(parsedUrl.search)).slice(0, 700),
            pgCode: body?.code ?? null,
            pgMessage: agentRedact(body?.message ?? '').slice(0, 300),
            pgDetails: agentRedact(body?.details ?? '').slice(0, 300),
            bodyKeys,
            appFrames,
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
    } catch { /* instrumentation must never break the request */ }
  }
  return response;
};
// #endregion

// Create Supabase client with service role key for admin operations
const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  },
  // #region agent log
  global: { fetch: agentLoggingFetch },
  // #endregion
});

module.exports = supabase; 