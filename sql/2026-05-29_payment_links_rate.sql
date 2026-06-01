-- Exchange rate locked at checkout / payment (ILS per 1 unit of foreign currency).
-- Primary source for paid proforma/NIS totals; BOI as-of logic remains fallback when rate IS NULL.

ALTER TABLE public.payment_links
  ADD COLUMN IF NOT EXISTS rate NUMERIC;

COMMENT ON COLUMN public.payment_links.rate IS
  'ILS per 1 unit of payment currency, saved when Pelecard session is created and on successful payment';

CREATE INDEX IF NOT EXISTS idx_payment_links_rate_paid
  ON public.payment_links (payment_plan_id, rate)
  WHERE status = 'paid' AND rate IS NOT NULL;

-- Include stored rate in payment-plan exchange context (frontend proformaExchangeRate.ts).
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
    'locked_at', pl.pelecard_raw_response -> 'pelecardCharge' -> 'lockedAt',
    'stored_rate', pl.rate
  )
  FROM public.payment_links pl
  WHERE pl.payment_plan_id = p_payment_plan_id
    AND pl.status IN ('processing', 'paid')
  ORDER BY (pl.rate IS NOT NULL) DESC, (pl.pelecard_raw_response ? 'pelecardCharge') DESC, pl.updated_at DESC
  LIMIT 1;
$$;

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
        'locked_at', pl.pelecard_raw_response -> 'pelecardCharge' -> 'lockedAt',
        'stored_rate', pl.rate
      ) AS ctx
    FROM public.payment_links pl
    WHERE pl.payment_plan_id = ANY (p_payment_plan_ids)
      AND pl.status IN ('processing', 'paid')
    ORDER BY
      pl.payment_plan_id,
      (pl.rate IS NOT NULL) DESC,
      (pl.pelecard_raw_response ? 'pelecardCharge') DESC,
      pl.updated_at DESC
  ) sub;
$$;
