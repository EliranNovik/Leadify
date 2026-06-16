-- =============================================================================
-- Google Sheet "QLeads" offline conversion export — RPC for candidates
-- =============================================================================
-- Reuses public.google_sheet_conversion_exports (destination = q_leads_capital_firm).
-- Edge function `google-sheets-qleads-sync` appends rows and inserts logs.
-- Run in Supabase SQL editor after 2026-05-12_google_sheet_bad_leads_export.sql.
-- Requires lead_balance_to_nis (from 2026-05-20_google_sheet_hqleads_export.sql).
-- =============================================================================

DROP FUNCTION IF EXISTS public.get_leads_for_qleads_google_sheet_export(int);

CREATE OR REPLACE FUNCTION public.get_leads_for_qleads_google_sheet_export(p_limit int DEFAULT 200)
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
    AND (
      (
        l.eligible IS TRUE
        AND trim(l.stage::text)::bigint >= 0
        AND trim(l.stage::text)::bigint <= 20
      )
      OR trim(l.stage::text)::bigint >= 20
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.google_sheet_conversion_exports e
      WHERE e.lead_id = l.id
        AND e.destination = 'q_leads_capital_firm'
    )
  ORDER BY coalesce(l.expert_eligibility_date, l.created_at) ASC
  LIMIT greatest(1, least(p_limit, 500));
$$;

COMMENT ON FUNCTION public.get_leads_for_qleads_google_sheet_export(int) IS
  'QLeads Google Sheet: firm ee79359b-..., Capital sources, gclid optional. (eligible=true stage 0–20) OR (stage >= 20), not yet exported.';

REVOKE ALL ON FUNCTION public.get_leads_for_qleads_google_sheet_export(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_leads_for_qleads_google_sheet_export(int) TO service_role;
