-- Bank of Israel representative exchange rates (daily snapshot).
-- Uses table boi_exchange_rates — does NOT touch existing public.currency_rates.
-- Schedule sync: edge function boi-exchange-rates-sync

CREATE TABLE IF NOT EXISTS public.boi_exchange_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_date DATE NOT NULL,
  base_currency TEXT NOT NULL,
  target_currency TEXT NOT NULL,
  rate NUMERIC(18, 8) NOT NULL,
  source TEXT NOT NULL DEFAULT 'bank_of_israel',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT boi_exchange_rates_unique_day_pair
    UNIQUE (rate_date, base_currency, target_currency, source)
);

CREATE INDEX IF NOT EXISTS idx_boi_exchange_rates_rate_date
  ON public.boi_exchange_rates (rate_date DESC);

CREATE INDEX IF NOT EXISTS idx_boi_exchange_rates_pair_latest
  ON public.boi_exchange_rates (base_currency, target_currency, rate_date DESC);

COMMENT ON TABLE public.boi_exchange_rates IS 'Daily BOI representative FX (OF00): units of target_currency per 1 base_currency';
COMMENT ON COLUMN public.boi_exchange_rates.rate IS 'ILS amount per 1 unit of base_currency when target_currency is ILS';

ALTER TABLE public.boi_exchange_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS boi_exchange_rates_select_authenticated ON public.boi_exchange_rates;
CREATE POLICY boi_exchange_rates_select_authenticated
  ON public.boi_exchange_rates
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS boi_exchange_rates_select_service_role ON public.boi_exchange_rates;
CREATE POLICY boi_exchange_rates_select_service_role
  ON public.boi_exchange_rates
  FOR SELECT
  TO service_role
  USING (true);

DROP POLICY IF EXISTS boi_exchange_rates_insert_service_role ON public.boi_exchange_rates;
CREATE POLICY boi_exchange_rates_insert_service_role
  ON public.boi_exchange_rates
  FOR INSERT
  TO service_role
  WITH CHECK (true);

DROP POLICY IF EXISTS boi_exchange_rates_update_service_role ON public.boi_exchange_rates;
CREATE POLICY boi_exchange_rates_update_service_role
  ON public.boi_exchange_rates
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.get_latest_boi_exchange_rate(
  p_base_currency TEXT,
  p_target_currency TEXT DEFAULT 'ILS'
)
RETURNS TABLE (
  rate_date DATE,
  base_currency TEXT,
  target_currency TEXT,
  rate NUMERIC,
  source TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT cr.rate_date, cr.base_currency, cr.target_currency, cr.rate, cr.source
  FROM public.boi_exchange_rates cr
  WHERE cr.base_currency = UPPER(TRIM(p_base_currency))
    AND cr.target_currency = UPPER(TRIM(p_target_currency))
  ORDER BY cr.rate_date DESC
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_latest_boi_exchange_rate(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_latest_boi_exchange_rate(TEXT, TEXT) TO service_role;

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
