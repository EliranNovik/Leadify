-- Portal Case Status: the folders of a step come from the drive's own tree.
--
-- Staff file a sub-effort's documents into `public.document_folders` now — the same folders the
-- case documents drawer and the documents drive show — rather than into the flat
-- `public.lead_sub_effort_folders` this once read. A client was therefore shown folders that no
-- longer held anything, with every file loose beside them.
--
-- Every folder on the way down to one of the step's files is returned, each with its parent, so
-- the portal can show the folders the way the drive does rather than as one flat row of names.
--
-- Only the folders block of `portal_get_sub_efforts` changes; the rest is as it was in
-- sql/2026-07-22_portal_get_sub_efforts_updated_by_photo.sql.
--
-- Run after sql/2026-10-29_sub_effort_folders_into_document_folders.sql. Safe to re-run.

-- Portal: category defaults + manually added client-visible rows; skip exclusions when provisioning.
CREATE OR REPLACE FUNCTION public.portal_get_sub_efforts(p_token UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.client_portal_sessions;
  v_category_id integer;
  v_legacy_lead_id bigint;
  v_new_lead_id uuid;
  v_rows JSONB;
  v_folders JSONB;
  v_has_junction boolean;
  v_has_exclusions boolean;
  v_has_manually_added boolean;
  v_has_folders boolean;
  v_has_sub_categories boolean;
  v_has_photo_fn boolean;
BEGIN
  v_session := public._portal_session_row(p_token);
  IF v_session IS NULL THEN
    RETURN NULL;
  END IF;

  v_legacy_lead_id := v_session.legacy_lead_id;
  v_new_lead_id := v_session.new_lead_id;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'sub_effort_misc_categories'
  ) INTO v_has_junction;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'lead_sub_effort_exclusions'
  ) INTO v_has_exclusions;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'lead_sub_efforts'
      AND column_name = 'manually_added'
  ) INTO v_has_manually_added;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'lead_sub_effort_folders'
  ) INTO v_has_folders;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'sub_category_efforts'
  ) INTO v_has_sub_categories;

  SELECT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = '_portal_employee_photo_by_display_name'
  ) INTO v_has_photo_fn;

  IF v_legacy_lead_id IS NOT NULL THEN
    SELECT ll.category_id INTO v_category_id
    FROM public.leads_lead ll
    WHERE ll.id = v_legacy_lead_id;
  ELSIF v_new_lead_id IS NOT NULL THEN
    SELECT l.category_id INTO v_category_id
    FROM public.leads l
    WHERE l.id = v_new_lead_id;
  END IF;

  IF v_has_junction AND v_category_id IS NOT NULL THEN
    IF v_legacy_lead_id IS NOT NULL THEN
      INSERT INTO public.lead_sub_efforts (
        sub_effort_id,
        legacy_lead_id,
        new_lead_id,
        internal,
        active,
        sort_order,
        created_by
      )
      SELECT
        se.id,
        v_legacy_lead_id,
        NULL,
        NOT COALESCE(se.default_client_visible, TRUE),
        TRUE,
        COALESCE(se.sort_order, 0),
        'Client portal'
      FROM public.sub_efforts se
      INNER JOIN public.sub_effort_misc_categories link ON link.sub_effort_id = se.id
      WHERE link.misc_category_id = v_category_id
        AND COALESCE(se.active, TRUE) = TRUE
        AND NOT EXISTS (
          SELECT 1
          FROM public.lead_sub_efforts existing
          WHERE existing.sub_effort_id = se.id
            AND existing.legacy_lead_id = v_legacy_lead_id
        )
        AND (
          NOT v_has_exclusions
          OR NOT EXISTS (
            SELECT 1
            FROM public.lead_sub_effort_exclusions ex
            WHERE ex.sub_effort_id = se.id
              AND ex.legacy_lead_id = v_legacy_lead_id
          )
        );
    ELSE
      INSERT INTO public.lead_sub_efforts (
        sub_effort_id,
        legacy_lead_id,
        new_lead_id,
        internal,
        active,
        sort_order,
        created_by
      )
      SELECT
        se.id,
        NULL,
        v_new_lead_id,
        NOT COALESCE(se.default_client_visible, TRUE),
        TRUE,
        COALESCE(se.sort_order, 0),
        'Client portal'
      FROM public.sub_efforts se
      INNER JOIN public.sub_effort_misc_categories link ON link.sub_effort_id = se.id
      WHERE link.misc_category_id = v_category_id
        AND COALESCE(se.active, TRUE) = TRUE
        AND NOT EXISTS (
          SELECT 1
          FROM public.lead_sub_efforts existing
          WHERE existing.sub_effort_id = se.id
            AND existing.new_lead_id = v_new_lead_id
        )
        AND (
          NOT v_has_exclusions
          OR NOT EXISTS (
            SELECT 1
            FROM public.lead_sub_effort_exclusions ex
            WHERE ex.sub_effort_id = se.id
              AND ex.new_lead_id = v_new_lead_id
          )
        );
    END IF;
  END IF;

  IF v_legacy_lead_id IS NOT NULL THEN
    SELECT COALESCE(
      jsonb_agg(row_to_json(t)::JSONB ORDER BY t.sort_order ASC, t.template_sort_order ASC, t.id ASC),
      '[]'::JSONB
    )
    INTO v_rows
    FROM (
      SELECT DISTINCT ON (lse.sub_effort_id)
        lse.id,
        lse.sub_effort_id,
        se.name AS sub_effort_name,
        se.description AS sub_effort_description,
        lse.active,
        lse.client_notes,
        lse.document_url,
        lse.sort_order,
        se.sort_order AS template_sort_order,
        lse.created_at,
        lse.updated_at,
        lse.updated_by,
        CASE
          WHEN v_has_photo_fn AND NULLIF(btrim(lse.updated_by), '') IS NOT NULL
          THEN public._portal_employee_photo_by_display_name(lse.updated_by)
          ELSE NULL
        END AS updated_by_photo_url,
        CASE
          WHEN v_has_sub_categories THEN (
            SELECT COALESCE(
              jsonb_agg(
                jsonb_build_object(
                  'id', sce.id,
                  'name', sce.name,
                  'description', sce.description,
                  'sort_order', sce.sort_order
                )
                ORDER BY sce.sort_order ASC, sce.name ASC
              ),
              '[]'::JSONB
            )
            FROM public.sub_category_efforts sce
            WHERE sce.sub_effort_id = se.id
          )
          ELSE '[]'::JSONB
        END AS sub_category_efforts
      FROM public.lead_sub_efforts lse
      INNER JOIN public.sub_efforts se ON se.id = lse.sub_effort_id
      WHERE lse.legacy_lead_id = v_legacy_lead_id
        AND lse.internal = FALSE
        AND (
          NOT v_has_junction
          OR v_category_id IS NULL
          OR (v_has_manually_added AND COALESCE(lse.manually_added, FALSE) = TRUE)
          OR EXISTS (
            SELECT 1
            FROM public.sub_effort_misc_categories link
            WHERE link.sub_effort_id = se.id
              AND link.misc_category_id = v_category_id
          )
        )
      ORDER BY
        lse.sub_effort_id,
        CASE
          WHEN lse.document_url IS NOT NULL
            AND btrim(lse.document_url::text) NOT IN ('', 'null', '[]', '{}')
          THEN 0
          ELSE 1
        END,
        CASE WHEN coalesce(btrim(lse.client_notes), '') <> '' THEN 0 ELSE 1 END,
        lse.sort_order ASC,
        lse.created_at ASC,
        lse.id ASC
    ) t;
  ELSE
    SELECT COALESCE(
      jsonb_agg(row_to_json(t)::JSONB ORDER BY t.sort_order ASC, t.template_sort_order ASC, t.id ASC),
      '[]'::JSONB
    )
    INTO v_rows
    FROM (
      SELECT DISTINCT ON (lse.sub_effort_id)
        lse.id,
        lse.sub_effort_id,
        se.name AS sub_effort_name,
        se.description AS sub_effort_description,
        lse.active,
        lse.client_notes,
        lse.document_url,
        lse.sort_order,
        se.sort_order AS template_sort_order,
        lse.created_at,
        lse.updated_at,
        lse.updated_by,
        CASE
          WHEN v_has_photo_fn AND NULLIF(btrim(lse.updated_by), '') IS NOT NULL
          THEN public._portal_employee_photo_by_display_name(lse.updated_by)
          ELSE NULL
        END AS updated_by_photo_url,
        CASE
          WHEN v_has_sub_categories THEN (
            SELECT COALESCE(
              jsonb_agg(
                jsonb_build_object(
                  'id', sce.id,
                  'name', sce.name,
                  'description', sce.description,
                  'sort_order', sce.sort_order
                )
                ORDER BY sce.sort_order ASC, sce.name ASC
              ),
              '[]'::JSONB
            )
            FROM public.sub_category_efforts sce
            WHERE sce.sub_effort_id = se.id
          )
          ELSE '[]'::JSONB
        END AS sub_category_efforts
      FROM public.lead_sub_efforts lse
      INNER JOIN public.sub_efforts se ON se.id = lse.sub_effort_id
      WHERE lse.new_lead_id = v_new_lead_id
        AND lse.internal = FALSE
        AND (
          NOT v_has_junction
          OR v_category_id IS NULL
          OR (v_has_manually_added AND COALESCE(lse.manually_added, FALSE) = TRUE)
          OR EXISTS (
            SELECT 1
            FROM public.sub_effort_misc_categories link
            WHERE link.sub_effort_id = se.id
              AND link.misc_category_id = v_category_id
          )
        )
      ORDER BY
        lse.sub_effort_id,
        CASE
          WHEN lse.document_url IS NOT NULL
            AND btrim(lse.document_url::text) NOT IN ('', 'null', '[]', '{}')
          THEN 0
          ELSE 1
        END,
        CASE WHEN coalesce(btrim(lse.client_notes), '') <> '' THEN 0 ELSE 1 END,
        lse.sort_order ASC,
        lse.created_at ASC,
        lse.id ASC
    ) t;
  END IF;

  /*
   * Folders, from the one tree the CRM files into (`public.document_folders`), named by the step
   * whose files are in them: the portal timeline reads this list per step. A folder the drive has
   * hidden from the client, or whose parent is hidden, is left out.
   *
   * The older per-step table is still read for anything not yet moved across by
   * sql/2026-10-29_sub_effort_folders_into_document_folders.sql, so a half-migrated database shows
   * both rather than neither. `client_visible` is read through to_jsonb, because it only arrived
   * with sql/2026-10-28_client_visible_documents.sql.
   */
  WITH RECURSIVE step_rows AS (
    SELECT lse.id, lse.document_url
    FROM public.lead_sub_efforts lse
    WHERE lse.internal = FALSE
      AND (
        (v_legacy_lead_id IS NOT NULL AND lse.legacy_lead_id = v_legacy_lead_id)
        OR (v_new_lead_id IS NOT NULL AND lse.new_lead_id = v_new_lead_id)
      )
  ),
  hidden AS (
    SELECT df.id
    FROM public.document_folders df
    WHERE to_jsonb(df)->>'client_visible' = 'false'
    UNION ALL
    SELECT child.id
    FROM public.document_folders child
    INNER JOIN hidden h ON child.parent_id = h.id
  ),
  -- The folder each of the step's files is in.
  holding AS (
    SELECT DISTINCT
      s.id AS lead_sub_effort_id,
      btrim(item->>'folder_id') AS folder_id
    FROM step_rows s
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE jsonb_typeof(to_jsonb(s.document_url))
        WHEN 'array'  THEN to_jsonb(s.document_url)
        WHEN 'object' THEN jsonb_build_array(to_jsonb(s.document_url))
        ELSE '[]'::JSONB
      END
    ) AS item
    WHERE btrim(COALESCE(item->>'folder_id', '')) <> ''
  ),
  -- And every folder above it, so the client walks down the path the case team filed it under
  -- instead of meeting a folder that appears to belong nowhere.
  climbed AS (
    SELECT h.lead_sub_effort_id, df.id, df.parent_id
    FROM holding h
    INNER JOIN public.document_folders df ON df.id::TEXT = h.folder_id
    UNION
    SELECT c.lead_sub_effort_id, up.id, up.parent_id
    FROM climbed c
    INNER JOIN public.document_folders up ON up.id = c.parent_id
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', df.id,
        'title', df.title,
        'note', df.note,
        'parent_id', df.parent_id,
        'sort_order', df.sort_order,
        'created_at', df.created_at,
        'created_by', df.created_by,
        'lead_sub_effort_id', c.lead_sub_effort_id
      )
      ORDER BY df.sort_order ASC, df.created_at ASC, df.title ASC
    ),
    '[]'::JSONB
  )
  INTO v_folders
  FROM climbed c
  INNER JOIN public.document_folders df ON df.id = c.id
  WHERE df.id NOT IN (SELECT h.id FROM hidden h);

  IF v_has_folders THEN
    SELECT COALESCE(v_folders, '[]'::JSONB) || COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', f.id,
            'title', f.title,
            'note', f.note,
            'parent_id', NULL,
            'sort_order', f.sort_order,
            'created_at', f.created_at,
            'created_by', f.created_by,
            'lead_sub_effort_id', f.lead_sub_effort_id
          )
          ORDER BY f.sort_order ASC, f.created_at ASC, f.title ASC
        )
        FROM public.lead_sub_effort_folders f
        INNER JOIN public.lead_sub_efforts lse ON lse.id = f.lead_sub_effort_id
        WHERE lse.internal = FALSE
          AND (
            (v_legacy_lead_id IS NOT NULL AND lse.legacy_lead_id = v_legacy_lead_id)
            OR (v_new_lead_id IS NOT NULL AND lse.new_lead_id = v_new_lead_id)
          )
          -- Only while a file still points at it: once the folder has been moved across, the row
          -- left behind in the old table is a copy of a folder the client is already being shown.
          AND EXISTS (
            SELECT 1
            FROM jsonb_array_elements(
              CASE jsonb_typeof(to_jsonb(lse.document_url))
                WHEN 'array'  THEN to_jsonb(lse.document_url)
                WHEN 'object' THEN jsonb_build_array(to_jsonb(lse.document_url))
                ELSE '[]'::JSONB
              END
            ) AS legacy_item
            WHERE btrim(legacy_item->>'folder_id') = f.id::TEXT
          )
      ),
      '[]'::JSONB
    )
    INTO v_folders;
  END IF;

  RETURN jsonb_build_object(
    'rows', COALESCE(v_rows, '[]'::JSONB),
    'category_id', v_category_id,
    'folders', COALESCE(v_folders, '[]'::JSONB)
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
