-- Keep one Smart Scan source row per Graph attachment (duplicate Graph persists
-- were creating new emails + re-classifying the same PDF).
-- Safe to re-run.

WITH ranked AS (
  SELECT
    id,
    source_graph_attachment_id,
    ROW_NUMBER() OVER (
      PARTITION BY source_graph_attachment_id
      ORDER BY processed_at DESC NULLS LAST, updated_at DESC NULLS LAST, created_at DESC
    ) AS rn
  FROM public.smart_scan_documents
  WHERE parent_id IS NULL
    AND source_graph_attachment_id IS NOT NULL
)
UPDATE public.smart_scan_documents d
SET ignored = TRUE,
    updated_at = NOW()
FROM ranked r
WHERE d.id = r.id
  AND r.rn > 1
  AND d.ignored = FALSE;

UPDATE public.smart_scan_documents child
SET ignored = TRUE,
    updated_at = NOW()
FROM public.smart_scan_documents parent
WHERE child.parent_id = parent.id
  AND parent.ignored = TRUE
  AND child.ignored = FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS smart_scan_documents_attachment_uidx
  ON public.smart_scan_documents (source_graph_attachment_id)
  WHERE parent_id IS NULL
    AND ignored = FALSE
    AND source_graph_attachment_id IS NOT NULL;
