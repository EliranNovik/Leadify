-- Compatibility shim: leftover clients still SELECT public.misc_currency
-- (id, front_name, iso_code, name ORDER BY name). That table was never created;
-- the real table is public.currencies. Nothing in this repo queries misc_currency.
-- Safe to re-run.

CREATE OR REPLACE VIEW public.misc_currency
WITH (security_invoker = true) AS
SELECT
  id,
  front_name,
  iso_code,
  name
FROM public.currencies;

GRANT SELECT ON public.misc_currency TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
