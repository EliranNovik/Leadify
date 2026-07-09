-- Remove duplicate lead_sub_efforts rows (same lead + same sub_effort template).
-- Keeps the best row: active, with documents/notes, then oldest.
-- Run once in Supabase SQL editor, then re-open the lead in CRM.

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY
        COALESCE(new_lead_id::text, 'legacy:' || legacy_lead_id::text),
        sub_effort_id
      ORDER BY
        CASE WHEN active IS NOT FALSE THEN 0 ELSE 1 END,
        CASE
          WHEN document_url IS NOT NULL
            AND btrim(document_url::text) NOT IN ('', 'null', '[]', '{}')
          THEN 0
          ELSE 1
        END,
        CASE
          WHEN coalesce(btrim(internal_notes), '') <> ''
            OR coalesce(btrim(client_notes), '') <> ''
          THEN 0
          ELSE 1
        END,
        created_at ASC NULLS LAST,
        id ASC
    ) AS rn
  FROM public.lead_sub_efforts
  WHERE sub_effort_id IS NOT NULL
)
DELETE FROM public.lead_sub_efforts AS lse
USING ranked AS r
WHERE lse.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS lead_sub_efforts_new_lead_sub_effort_key
  ON public.lead_sub_efforts (new_lead_id, sub_effort_id)
  WHERE new_lead_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS lead_sub_efforts_legacy_lead_sub_effort_key
  ON public.lead_sub_efforts (legacy_lead_id, sub_effort_id)
  WHERE legacy_lead_id IS NOT NULL;
