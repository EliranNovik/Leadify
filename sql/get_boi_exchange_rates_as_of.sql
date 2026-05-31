-- BOI rates as they existed at a point in time (uses boi_exchange_rates.created_at).
-- Prevents using a rate row synced AFTER payment / checkout.

CREATE INDEX IF NOT EXISTS idx_boi_exchange_rates_created_at
  ON public.boi_exchange_rates (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_boi_exchange_rates_rate_date_created_at
  ON public.boi_exchange_rates (rate_date DESC, created_at DESC);

CREATE OR REPLACE FUNCTION public.get_boi_exchange_rates_as_of(
  p_as_of TIMESTAMPTZ DEFAULT now()
)
RETURNS SETOF public.boi_exchange_rates
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH eligible AS (
    SELECT cr.*
    FROM public.boi_exchange_rates cr
    WHERE cr.created_at <= p_as_of
  ),
  d AS (
    SELECT MAX(e.rate_date) AS rd
    FROM eligible e
  )
  SELECT e.*
  FROM eligible e
  CROSS JOIN d
  WHERE d.rd IS NOT NULL AND e.rate_date = d.rd
  ORDER BY e.base_currency;
$$;

GRANT EXECUTE ON FUNCTION public.get_boi_exchange_rates_as_of(TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_boi_exchange_rates_as_of(TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_boi_exchange_rates_as_of(TIMESTAMPTZ) TO anon;

-- Locked Pelecard charge snapshot (pelecard_raw_response.pelecardCharge) for a payment plan row.
CREATE OR REPLACE FUNCTION public.get_locked_pelecard_charge_for_payment_plan(
  p_payment_plan_id BIGINT
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pl.pelecard_raw_response -> 'pelecardCharge'
  FROM public.payment_links pl
  WHERE pl.payment_plan_id = p_payment_plan_id
    AND pl.status IN ('processing', 'paid')
    AND pl.pelecard_raw_response ? 'pelecardCharge'
  ORDER BY pl.updated_at DESC
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_locked_pelecard_charge_for_payment_plan(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_locked_pelecard_charge_for_payment_plan(BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_locked_pelecard_charge_for_payment_plan(BIGINT) TO anon;

CREATE OR REPLACE FUNCTION public.get_locked_pelecard_charges_for_payment_plans(
  p_payment_plan_ids BIGINT[]
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    jsonb_object_agg(sub.payment_plan_id::TEXT, sub.charge),
    '{}'::JSONB
  )
  FROM (
    SELECT DISTINCT ON (pl.payment_plan_id)
      pl.payment_plan_id,
      pl.pelecard_raw_response -> 'pelecardCharge' AS charge
    FROM public.payment_links pl
    WHERE pl.payment_plan_id = ANY (p_payment_plan_ids)
      AND pl.status IN ('processing', 'paid')
      AND pl.pelecard_raw_response ? 'pelecardCharge'
    ORDER BY pl.payment_plan_id, pl.updated_at DESC
  ) sub;
$$;

GRANT EXECUTE ON FUNCTION public.get_locked_pelecard_charges_for_payment_plans(BIGINT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_locked_pelecard_charges_for_payment_plans(BIGINT[]) TO service_role;

-- Payment-plan exchange context: locked Pelecard charge + timestamps for as-of BOI lookup.
CREATE OR REPLACE FUNCTION public.get_payment_plan_exchange_context(
  p_payment_plan_id BIGINT
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'pelecard_charge', pl.pelecard_raw_response -> 'pelecardCharge',
    'link_paid_at', pl.paid_at,
    'link_updated_at', pl.updated_at,
    'locked_at', pl.pelecard_raw_response -> 'pelecardCharge' -> 'lockedAt'
  )
  FROM public.payment_links pl
  WHERE pl.payment_plan_id = p_payment_plan_id
    AND pl.status IN ('processing', 'paid')
  ORDER BY (pl.pelecard_raw_response ? 'pelecardCharge') DESC, pl.updated_at DESC
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_payment_plan_exchange_context(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_payment_plan_exchange_context(BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_payment_plan_exchange_context(BIGINT) TO anon;

CREATE OR REPLACE FUNCTION public.get_payment_plan_exchange_contexts(
  p_payment_plan_ids BIGINT[]
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    jsonb_object_agg(sub.payment_plan_id::TEXT, sub.ctx),
    '{}'::JSONB
  )
  FROM (
    SELECT DISTINCT ON (pl.payment_plan_id)
      pl.payment_plan_id,
      jsonb_build_object(
        'pelecard_charge', pl.pelecard_raw_response -> 'pelecardCharge',
        'link_paid_at', pl.paid_at,
        'link_updated_at', pl.updated_at,
        'locked_at', pl.pelecard_raw_response -> 'pelecardCharge' -> 'lockedAt'
      ) AS ctx
    FROM public.payment_links pl
    WHERE pl.payment_plan_id = ANY (p_payment_plan_ids)
      AND pl.status IN ('processing', 'paid')
    ORDER BY pl.payment_plan_id, (pl.pelecard_raw_response ? 'pelecardCharge') DESC, pl.updated_at DESC
  ) sub;
$$;

GRANT EXECUTE ON FUNCTION public.get_payment_plan_exchange_contexts(BIGINT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_payment_plan_exchange_contexts(BIGINT[]) TO service_role;
