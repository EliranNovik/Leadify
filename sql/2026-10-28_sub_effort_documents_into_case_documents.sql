-- Sub-effort uploads recorded as case documents, for every lead that already has some.
--
-- Files uploaded onto a sub-effort were only ever written to storage plus the row's
-- `document_url` JSON. `lead_case_documents` is the one table the documents drive
-- (public.document_index), the client portal and every document count read, so those files are
-- visible nowhere but the case documents drawer, which reads `document_url` as a second source.
-- A lead filed this way shows in the drive as a case with no documents, or does not show at all.
--
-- This backfills the missing rows against the objects already in storage: nothing is copied or
-- moved. New uploads are recorded in both places by src/lib/subEffortCaseDocuments.ts.
--
-- Run after sql/2026-10-21_document_index_view.sql and
-- sql/2026-10-28_client_visible_documents.sql. Safe to run again: a file already listed as a case
-- document is skipped.

/*
 * Taken once into a table rather than read from a view twice: the rows to add are defined by what
 * is missing from `lead_case_documents`, which the insert below then changes.
 *
 * The lead number matches what the case documents drawer asks for: a legacy lead by its own number
 * when it has one and by `leads_lead.id` otherwise, which is the key the scan centre files under
 * and the one the sub-effort's storage paths already read.
 *
 * The upload time comes from the object name (`${Date.now()}_report.pdf`), the only per-file record
 * of it, falling back to the stored object and then the sub-effort's creation. The row's
 * `updated_at` is deliberately unused: it moves whenever anything on the case is edited, which
 * would date every file under it to that moment.
 */
CREATE TEMP TABLE sub_effort_case_documents AS
WITH items AS (
  SELECT
    se.sub_effort_id,
    se.legacy_lead_id,
    se.new_lead_id,
    se.internal,
    se.created_at AS row_created_at,
    coalesce(nullif(btrim(se.updated_by), ''), nullif(btrim(se.created_by), '')) AS filed_by,
    btrim(item->>'path')                 AS storage_path,
    nullif(btrim(item->>'name'), '')     AS item_name,
    nullif(btrim(item->>'mimeType'), '') AS item_mime_type
  FROM public.lead_sub_efforts se
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE jsonb_typeof(to_jsonb(se.document_url))
      WHEN 'array'  THEN to_jsonb(se.document_url)
      WHEN 'object' THEN jsonb_build_array(to_jsonb(se.document_url))
      ELSE '[]'::jsonb
    END
  ) AS item
  WHERE btrim(coalesce(item->>'path', '')) <> ''
    -- Email attachments live in their own bucket, which the documents view does not read.
    AND coalesce(nullif(btrim(item->>'bucket'), ''), 'lead-sub-efforts-documents')
        = 'lead-sub-efforts-documents'
)
SELECT DISTINCT ON (d.storage_path)
  coalesce(
    nullif(btrim(l.lead_number), ''),
    nullif(btrim(ll.lead_number::text), ''),
    nullif(btrim(ll.manual_id::text), ''),
    nullif(btrim(d.legacy_lead_id::text), '')
  )                                                                   AS lead_number,
  d.storage_path,
  coalesce(d.item_name, regexp_replace(d.storage_path, '^.*/', ''))   AS file_name,
  nullif(obj.metadata->>'size', '')::bigint                           AS file_size,
  d.item_mime_type                                                    AS mime_type,
  s.case_document_classification_id                                   AS classification_id,
  d.filed_by                                                          AS uploaded_by,
  d.internal                                                          AS sub_effort_internal,
  coalesce(
    CASE
      WHEN regexp_replace(d.storage_path, '^.*/', '') ~ '^\d{13}_'
        THEN to_timestamp(
          (substring(regexp_replace(d.storage_path, '^.*/', '') from '^(\d{13})_'))::bigint / 1000.0
        )
      WHEN regexp_replace(d.storage_path, '^.*/', '') ~ '^\d{10}_'
        THEN to_timestamp(
          (substring(regexp_replace(d.storage_path, '^.*/', '') from '^(\d{10})_'))::bigint
        )
    END,
    obj.created_at,
    d.row_created_at
  )                                                                   AS created_at
FROM items d
LEFT JOIN public.sub_efforts s ON s.id = d.sub_effort_id
LEFT JOIN public.leads l ON l.id = d.new_lead_id
LEFT JOIN public.leads_lead ll ON ll.id = d.legacy_lead_id
LEFT JOIN storage.objects obj
  ON obj.bucket_id = 'lead-sub-efforts-documents'
 AND obj.name = d.storage_path
WHERE NOT EXISTS (
  SELECT 1 FROM public.lead_case_documents existing
  WHERE existing.storage_path = d.storage_path
)
ORDER BY d.storage_path, d.row_created_at;

-- What is about to be filed, and under which case.
SELECT lead_number, count(*) AS files
FROM sub_effort_case_documents
GROUP BY lead_number
ORDER BY files DESC;

INSERT INTO public.lead_case_documents (
  lead_number,
  onedrive_subfolder,
  onedrive_item_id,
  storage_path,
  file_name,
  file_size,
  mime_type,
  classification_id,
  uploaded_by,
  ai_summary_status,
  created_at
)
SELECT
  lead_number,
  -- The area the case documents drawer reads, so the file keeps the place staff already see it in.
  'ClientHeaderDocuments',
  NULL,
  storage_path,
  file_name,
  file_size,
  mime_type,
  classification_id,
  uploaded_by,
  -- Not summarised: a sub-effort upload never offered a summary, and a backlog of scans would
  -- otherwise queue one each.
  'skipped',
  created_at
FROM sub_effort_case_documents
WHERE lead_number IS NOT NULL;

/*
 * A sub-effort hidden from the client must not have its files surface in the portal's documents
 * tab. Guarded because client visibility may not have been added yet.
 */
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'lead_case_documents'
      AND column_name = 'client_visible'
  ) THEN
    UPDATE public.lead_case_documents d
    SET client_visible = false
    FROM sub_effort_case_documents src
    WHERE d.storage_path = src.storage_path
      AND src.sub_effort_internal IS TRUE
      AND d.client_visible IS NOT FALSE;
  END IF;
END $$;

-- Files still outside the drive, which can only be entries whose lead could not be resolved.
SELECT count(*) AS unfiled_without_lead
FROM sub_effort_case_documents
WHERE lead_number IS NULL;

DROP TABLE sub_effort_case_documents;
