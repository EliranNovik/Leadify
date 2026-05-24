-- =============================================================================
-- Google Sheet "HQLeads" offline conversion export — helpers + RPC
-- =============================================================================
-- Reuses public.google_sheet_conversion_exports (destination = hq_leads_capital_firm).
-- Edge function `google-sheets-hqleads-sync` appends rows and inserts logs.
-- Run after 2026-05-12_google_sheet_bad_leads_export.sql.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.clamp_probability_part(p_val numeric)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT greatest(0, least(100, round(coalesce(p_val, 0))))::int;
$$;

CREATE OR REPLACE FUNCTION public.parse_legal_potential_value(p_val text)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_val IS NULL OR trim(p_val) = '' THEN NULL
    WHEN trim(p_val) ~ '^\d+$' THEN public.clamp_probability_part(trim(p_val)::numeric)
    ELSE NULL
  END;
$$;

/** Mirrors caseProbabilityFromFactors() in ProbabilitySlidersModal.tsx (γ = 0.72). */
CREATE OR REPLACE FUNCTION public.lead_case_probability(
  p_legal_potential text,
  p_seriousness numeric,
  p_financial_ability numeric,
  p_probability numeric
)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $$
  WITH parsed AS (
    SELECT
      public.parse_legal_potential_value(p_legal_potential) AS l_raw,
      CASE
        WHEN p_seriousness IS NULL THEN NULL
        ELSE public.clamp_probability_part(p_seriousness)
      END AS s_raw,
      CASE
        WHEN p_financial_ability IS NULL THEN NULL
        ELSE public.clamp_probability_part(p_financial_ability)
      END AS f_raw,
      public.clamp_probability_part(p_probability) AS stored_prob
  )
  SELECT CASE
    WHEN l_raw IS NULL AND s_raw IS NULL AND f_raw IS NULL THEN stored_prob
    ELSE round((
      (
        power(coalesce(l_raw, 0)::numeric / 100.0, 0.72)
        + power(coalesce(s_raw, 0)::numeric / 100.0, 0.72)
        + power(coalesce(f_raw, 0)::numeric / 100.0, 0.72)
      ) / 3.0
    ) * 100)::int
  END
  FROM parsed;
$$;

CREATE OR REPLACE FUNCTION public.normalize_lead_currency_iso(p_currency text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_currency IS NULL OR trim(p_currency) = '' THEN 'ILS'
    WHEN trim(p_currency) = '₪' THEN 'ILS'
    WHEN trim(p_currency) = '$' THEN 'USD'
    WHEN trim(p_currency) = '€' THEN 'EUR'
    WHEN trim(p_currency) = '£' THEN 'GBP'
    WHEN upper(trim(p_currency)) IN ('NIS', 'ILS') THEN 'ILS'
    WHEN upper(trim(p_currency)) IN ('USD', 'EUR', 'GBP', 'CHF', 'CAD', 'AUD') THEN upper(trim(p_currency))
    ELSE 'ILS'
  END;
$$;

/** Balance converted to NIS (BOI rate when available, legacy static fallback). */
CREATE OR REPLACE FUNCTION public.lead_balance_to_nis(p_balance numeric, p_currency text)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ctx AS (
    SELECT
      greatest(0, coalesce(p_balance, 0)) AS bal,
      public.normalize_lead_currency_iso(p_currency) AS iso
  )
  SELECT round(
    CASE
      WHEN ctx.iso = 'ILS' THEN ctx.bal
      ELSE ctx.bal * coalesce(
        (SELECT r.rate FROM public.get_latest_boi_exchange_rate(ctx.iso, 'ILS') r LIMIT 1),
        CASE ctx.iso
          WHEN 'USD' THEN 3.2
          WHEN 'EUR' THEN 3.7
          WHEN 'GBP' THEN 4.4
          ELSE 1
        END
      )
    END,
    2
  )
  FROM ctx;
$$;

CREATE OR REPLACE FUNCTION public.is_lead_balance_nis(p_balance numeric, p_currency text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT public.lead_balance_to_nis(p_balance, p_currency) >= 20000;
$$;

DROP FUNCTION IF EXISTS public.get_leads_for_hqleads_google_sheet_export(int);

CREATE OR REPLACE FUNCTION public.get_leads_for_hqleads_google_sheet_export(p_limit int DEFAULT 200)
RETURNS TABLE (
  id uuid,
  created_at timestamptz,
  utm_params jsonb,
  lead_number text,
  lead_name text,
  source_id bigint,
  conversion_value_nis numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    l.id,
    coalesce(l.expert_eligibility_date, l.created_at) AS created_at,
    l.utm_params,
    l.lead_number::text,
    coalesce(l.name::text, '') AS lead_name,
    l.source_id::bigint,
    public.lead_balance_to_nis(l.balance::numeric, l.balance_currency) AS conversion_value_nis
  FROM public.leads l
  WHERE l.source_id IS NOT NULL
    AND l.source_id IN (
      SELECT sf.source_id
      FROM public.sources_firms sf
      WHERE sf.firm_id = 'ee79359b-10c5-449f-bb13-c1ce222916ef'::uuid
    )
    AND l.stage IS NOT NULL
    AND trim(l.stage::text) ~ '^[0-9]+$'
    AND trim(l.stage::text)::bigint >= 20
    AND coalesce(l.utm_params ->> 'gclid', '') <> ''
    AND public.lead_case_probability(
      l.legal_potential::text,
      l.seriousness::numeric,
      l.financial_ability::numeric,
      l.probability::numeric
    ) >= 50
    AND public.lead_balance_to_nis(l.balance::numeric, l.balance_currency) >= 20000
    AND NOT EXISTS (
      SELECT 1
      FROM public.google_sheet_conversion_exports e
      WHERE e.lead_id = l.id
        AND e.destination = 'hq_leads_capital_firm'
    )
  ORDER BY coalesce(l.expert_eligibility_date, l.created_at) ASC
  LIMIT greatest(1, least(p_limit, 500));
$$;

COMMENT ON FUNCTION public.get_leads_for_hqleads_google_sheet_export(int) IS
  'HQLeads Google Sheet: Capital sources, stage >= 20, case probability >= 50%, balance >= 20000 NIS, gclid, not yet exported.';

REVOKE ALL ON FUNCTION public.get_leads_for_hqleads_google_sheet_export(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_leads_for_hqleads_google_sheet_export(int) TO service_role;
