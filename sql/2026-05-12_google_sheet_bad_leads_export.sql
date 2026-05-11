-- =============================================================================
-- Google Sheet "BadLeads" offline conversion export — log + RPC for candidates
-- =============================================================================
-- Run in Supabase SQL editor (or migrations).
-- Edge function `google-sheets-bad-leads-sync` appends rows and inserts logs.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.google_sheet_conversion_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  /** Stable id for this integration (e.g. bad_leads_capital_firm). */
  destination text NOT NULL,
  lead_id uuid NOT NULL REFERENCES public.leads (id) ON DELETE CASCADE,
  lead_number text,
  lead_name text,
  gclid text NOT NULL,
  conversion_name text NOT NULL DEFAULT 'BadLeads',
  conversion_time timestamptz NOT NULL,
  conversion_value numeric NOT NULL DEFAULT 0,
  conversion_currency text NOT NULL DEFAULT 'ils',
  spreadsheet_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT google_sheet_conversion_exports_lead_destination_unique UNIQUE (lead_id, destination)
);

CREATE INDEX IF NOT EXISTS idx_google_sheet_conversion_exports_dest_created
  ON public.google_sheet_conversion_exports (destination, created_at DESC);

COMMENT ON TABLE public.google_sheet_conversion_exports IS 'Rows successfully appended to Google Ads offline conversion spreadsheets.';

ALTER TABLE public.google_sheet_conversion_exports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "google_sheet_conversion_exports_select_authenticated"
  ON public.google_sheet_conversion_exports;
CREATE POLICY "google_sheet_conversion_exports_select_authenticated"
  ON public.google_sheet_conversion_exports
  FOR SELECT
  TO authenticated
  USING (true);

-- Service role (edge functions) bypasses RLS for INSERT.

-- ---------------------------------------------------------------------------
-- Candidates: firm-linked sources, stage id <= 20, inactive / unactivated,
-- gclid present, exclude "double -diff. source", not yet exported.
-- Firm UUID is fixed for this sheet (Capital / provider mapping).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_leads_for_bad_leads_google_sheet_export(p_limit int DEFAULT 200)
RETURNS TABLE (
  id uuid,
  created_at timestamptz,
  utm_params jsonb,
  lead_number text,
  lead_name text,
  source_id bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    l.id,
    l.created_at,
    l.utm_params,
    l.lead_number::text,
    coalesce(l.name::text, '') AS lead_name,
    l.source_id::bigint
  FROM public.leads l
  WHERE l.source_id IS NOT NULL
    AND l.source_id IN (
      SELECT sf.source_id
      FROM public.sources_firms sf
      WHERE sf.firm_id = 'ee79359b-10c5-449f-bb13-c1ce222916ef'::uuid
    )
    AND l.stage IS NOT NULL
    AND trim(l.stage::text) ~ '^[0-9]+$'
    AND trim(l.stage::text)::bigint <= 20
    AND (
      lower(trim(coalesce(l.status::text, ''))) = 'inactive'
      OR l.unactivated_at IS NOT NULL
    )
    AND coalesce(trim(l.unactivation_reason), '') IS DISTINCT FROM 'double -diff. source'
    AND coalesce(l.utm_params ->> 'gclid', '') <> ''
    AND NOT EXISTS (
      SELECT 1
      FROM public.google_sheet_conversion_exports e
      WHERE e.lead_id = l.id
        AND e.destination = 'bad_leads_capital_firm'
    )
  ORDER BY l.created_at ASC
  LIMIT greatest(1, least(p_limit, 500));
$$;

COMMENT ON FUNCTION public.get_leads_for_bad_leads_google_sheet_export(int) IS
  'BadLeads Google Sheet: firm ee79359b-..., stage id <= 20, inactive/unactivated, gclid, exclude double -diff. source, not yet exported.';

REVOKE ALL ON FUNCTION public.get_leads_for_bad_leads_google_sheet_export(int) FROM PUBLIC;
-- Only edge (service_role) may call — returns PII + gclid.
GRANT EXECUTE ON FUNCTION public.get_leads_for_bad_leads_google_sheet_export(int) TO service_role;
