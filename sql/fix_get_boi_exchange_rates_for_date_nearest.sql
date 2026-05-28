-- Fix: get_boi_exchange_rates_for_date must use latest rate_date on/before p_rate_date,
-- not an exact match (BOI daily rates often lag; weekends/holidays have no new row).

CREATE OR REPLACE FUNCTION public.get_boi_exchange_rates_for_date(
  p_rate_date DATE DEFAULT NULL
)
RETURNS SETOF public.boi_exchange_rates
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH d AS (
    SELECT COALESCE(
      (
        SELECT MAX(rate_date)
        FROM public.boi_exchange_rates
        WHERE p_rate_date IS NULL OR rate_date <= p_rate_date
      ),
      (SELECT MAX(rate_date) FROM public.boi_exchange_rates)
    ) AS rd
  )
  SELECT cr.*
  FROM public.boi_exchange_rates cr
  CROSS JOIN d
  WHERE d.rd IS NOT NULL AND cr.rate_date = d.rd
  ORDER BY cr.base_currency;
$$;

GRANT EXECUTE ON FUNCTION public.get_boi_exchange_rates_for_date(DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_boi_exchange_rates_for_date(DATE) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_boi_exchange_rates_for_date(DATE) TO anon;
