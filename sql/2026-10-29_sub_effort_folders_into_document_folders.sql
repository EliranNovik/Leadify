-- Sub-effort folders become document folders, so every screen shows one tree.
--
-- `public.lead_sub_effort_folders` was a flat list per sub-effort, with membership kept inside
-- `lead_sub_efforts.document_url`. The documents drive and the case documents drawer read
-- `public.document_folders`, nested and shared, with membership on `lead_case_documents.folder_id`.
-- The sub-effort modal now reads that tree as well, so the folders staff already made are moved
-- across here: same titles, same notes, same files inside them.
--
-- A folder lands in the tree of the lead and the case document category its sub-effort belongs to,
-- which is the tree the drawer tab of that category shows. Two sub-efforts of one lead that share
-- a category and a folder name therefore end up sharing the folder — that is the point of one tree.
--
-- Run after sql/2026-10-21_document_folders.sql and
-- sql/2026-10-28_sub_effort_documents_into_case_documents.sql. Safe to run again: a folder already
-- moved is matched rather than duplicated, and files already filed are left alone.

-- A run that stopped half way leaves its working tables behind in the session.
DROP TABLE IF EXISTS sub_effort_folder_files;
DROP TABLE IF EXISTS sub_effort_folder_map;
DROP TABLE IF EXISTS sub_effort_folder_moves;

/*
 * Every old folder with the lead number the UI addresses it by and the category it belongs to.
 *
 * The lead number is the one the client page holds (`leads.lead_number`, or the legacy lead's own
 * number / manual id), because that is the scope key the drawer and the sub-effort modal build
 * their folder scope from. A sub-effort whose lead resolves to nothing is reported at the end and
 * left alone: its folders have no tree to live in.
 *
 * The old table let a name be anything; `document_folders` writes a folder's place as
 * `parent/child`, so a slash in a name is refused. Such a name is tidied exactly as the folder
 * dialog tidies what staff type (normalizeFolderTitle in src/lib/documentFolders.ts): slashes
 * become spaces, runs of spaces close up, 80 characters is the most it keeps. Both names are
 * reported below.
 */
CREATE TEMP TABLE sub_effort_folder_moves AS
SELECT *
FROM (
  SELECT
    f.id                                     AS old_folder_id,
    f.lead_sub_effort_id,
    btrim(coalesce(f.title, ''))             AS source_title,
    nullif(
      btrim(left(
        regexp_replace(
          replace(replace(coalesce(f.title, ''), '/', ' '), chr(92), ' '),
          '[[:space:]]+', ' ', 'g'
        ),
        80
      )),
      ''
    )                                        AS title,
    nullif(btrim(coalesce(f.note, '')), '')  AS note,
    f.created_by,
    f.created_at,
    f.sort_order,
    coalesce(
      nullif(btrim(l.lead_number), ''),
      nullif(btrim(ll.lead_number::text), ''),
      nullif(btrim(ll.manual_id::text), '')
    )                                        AS scope_key,
    s.case_document_classification_id        AS classification_id
  FROM public.lead_sub_effort_folders f
  JOIN public.lead_sub_efforts se ON se.id = f.lead_sub_effort_id
  LEFT JOIN public.sub_efforts s ON s.id = se.sub_effort_id
  LEFT JOIN public.leads l ON l.id = se.new_lead_id
  LEFT JOIN public.leads_lead ll ON ll.id = se.legacy_lead_id
) AS computed
-- A name that was only a slash, or only spaces, is no name at all.
WHERE title IS NOT NULL;

-- What is about to move, per lead.
SELECT scope_key, count(*) AS folders
FROM sub_effort_folder_moves
WHERE scope_key IS NOT NULL
GROUP BY scope_key
ORDER BY folders DESC;

-- The names that had to change to fit a path.
SELECT source_title, title AS moved_as
FROM sub_effort_folder_moves
WHERE title <> source_title
ORDER BY source_title;

/*
 * The folders themselves, at the top of their category's tree: the old table had no nesting, so
 * nothing is deeper than one level. `created_at` is kept so the oldest folder still reads as the
 * oldest. The unique index on sibling titles is what makes a repeat run, and two sub-efforts
 * sharing a folder name, resolve to one row.
 */
INSERT INTO public.document_folders (
  scope_type,
  scope_key,
  classification_id,
  area,
  parent_id,
  title,
  note,
  sort_order,
  created_by,
  created_at
)
SELECT DISTINCT ON (scope_key, coalesce(classification_id::text, ''), lower(title))
  'lead',
  scope_key,
  classification_id,
  -- The area the case documents drawer and the sub-effort modal both read.
  'ClientHeaderDocuments',
  NULL,
  title,
  note,
  coalesce(sort_order, 0),
  created_by,
  created_at
FROM sub_effort_folder_moves
WHERE scope_key IS NOT NULL
ORDER BY scope_key, coalesce(classification_id::text, ''), lower(title), created_at
ON CONFLICT DO NOTHING;

-- Old folder id → the folder it is now, which is how the files below find their place.
CREATE TEMP TABLE sub_effort_folder_map AS
SELECT
  m.old_folder_id,
  m.lead_sub_effort_id,
  d.id AS new_folder_id
FROM sub_effort_folder_moves m
JOIN public.document_folders d
  ON d.scope_type = 'lead'
 AND d.scope_key = m.scope_key
 AND d.parent_id IS NULL
 AND coalesce(d.area, '') = 'ClientHeaderDocuments'
 AND coalesce(d.classification_id::text, '') = coalesce(m.classification_id::text, '')
 AND lower(d.title) = lower(m.title)
WHERE m.scope_key IS NOT NULL;

/*
 * Each file's folder, read out of the sub-effort's own document list. A file is matched to its
 * case document row by storage path, which is the one thing both sides record.
 */
CREATE TEMP TABLE sub_effort_folder_files AS
SELECT DISTINCT
  btrim(item->>'path')     AS storage_path,
  map.new_folder_id
FROM public.lead_sub_efforts se
CROSS JOIN LATERAL jsonb_array_elements(
  CASE jsonb_typeof(to_jsonb(se.document_url))
    WHEN 'array'  THEN to_jsonb(se.document_url)
    WHEN 'object' THEN jsonb_build_array(to_jsonb(se.document_url))
    ELSE '[]'::jsonb
  END
) AS item
JOIN sub_effort_folder_map map
  ON map.lead_sub_effort_id = se.id
 AND map.old_folder_id::text = btrim(item->>'folder_id')
WHERE btrim(coalesce(item->>'path', '')) <> '';

UPDATE public.lead_case_documents d
SET folder_id = f.new_folder_id
FROM sub_effort_folder_files f
WHERE d.storage_path = f.storage_path
  AND d.folder_id IS NULL;

/*
 * The sub-effort's own list is rewritten to the new ids as well. The modal prefers the case
 * document row, so this is for a file that has none — one whose object is gone, say — which would
 * otherwise show at the top of the tree with its folder forgotten.
 */
UPDATE public.lead_sub_efforts se
SET document_url = rewritten.items
FROM (
  SELECT
    se2.id,
    jsonb_agg(
      CASE
        WHEN map.new_folder_id IS NOT NULL
          THEN jsonb_set(item, '{folder_id}', to_jsonb(map.new_folder_id::text))
        ELSE item
      END
      ORDER BY ordinality
    ) AS items
  FROM public.lead_sub_efforts se2
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE jsonb_typeof(to_jsonb(se2.document_url))
      WHEN 'array'  THEN to_jsonb(se2.document_url)
      WHEN 'object' THEN jsonb_build_array(to_jsonb(se2.document_url))
      ELSE '[]'::jsonb
    END
  ) WITH ORDINALITY AS t(item, ordinality)
  LEFT JOIN sub_effort_folder_map map
    ON map.lead_sub_effort_id = se2.id
   AND map.old_folder_id::text = btrim(item->>'folder_id')
  WHERE jsonb_typeof(to_jsonb(se2.document_url)) IN ('array', 'object')
  GROUP BY se2.id
  HAVING bool_or(map.new_folder_id IS NOT NULL)
) AS rewritten
WHERE se.id = rewritten.id;

-- What moved, and what could not.
SELECT count(*) AS folders_moved FROM sub_effort_folder_map;
SELECT count(*) AS files_filed FROM sub_effort_folder_files;
SELECT count(*) AS folders_without_a_lead
FROM sub_effort_folder_moves
WHERE scope_key IS NULL;
SELECT count(*) AS folders_without_a_usable_name
FROM public.lead_sub_effort_folders f
WHERE nullif(
      btrim(left(
        regexp_replace(
          replace(replace(coalesce(f.title, ''), '/', ' '), chr(92), ' '),
          '[[:space:]]+', ' ', 'g'
        ),
        80
      )),
      ''
    ) IS NULL;

/*
 * `public.lead_sub_effort_folders` is deliberately left in place: nothing reads it any more, and
 * keeping it means this can be checked against what it held. Drop it once the trees look right.
 */

DROP TABLE sub_effort_folder_files;
DROP TABLE sub_effort_folder_map;
DROP TABLE sub_effort_folder_moves;
