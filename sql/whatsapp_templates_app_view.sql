-- View that returns WhatsApp templates in the app-ready shape so the client can
-- select directly without client-side mapping. Run once; safe to re-run (CREATE OR REPLACE).
--
-- Usage: supabase.from('whatsapp_templates_app').select('*').order('title', { ascending: true })

CREATE OR REPLACE VIEW public.whatsapp_templates_app AS
SELECT
  id,
  name AS title,
  name AS name360,
  COALESCE(params, '0') AS params,
  CASE WHEN active THEN 't' ELSE 'f' END AS active,
  ''::text AS category_id,
  0::bigint AS firm_id,
  COALESCE(
    (NULLIF(TRIM(REGEXP_REPLACE(whatsapp_template_id, '[^0-9]', '', 'g')), '')::bigint),
    0
  ) AS number_id,
  COALESCE(content, '') AS content,
  COALESCE(language, 'en_US') AS language
FROM public.whatsapp_templates_v2
WHERE active = true;

-- Optional: grant select to roles that need it (if RLS is used on the view)
-- ALTER VIEW public.whatsapp_templates_app SET (security_invoker = false);
-- Supabase anon/authenticated can read the view if they can read whatsapp_templates_v2.

COMMENT ON VIEW public.whatsapp_templates_app IS 'App-ready WhatsApp templates (no client mapping). Use from Supabase: .from(''whatsapp_templates_app'').select(''*'').order(''title'')';
