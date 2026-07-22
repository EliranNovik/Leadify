-- Fix portal_get_sub_efforts payload to match portalApi: { rows, category_id }.
-- Safe to re-run after 2026-07-21_lead_sub_efforts_manually_added.sql (IF NOT EXISTS + REPLACE).
-- Previous manually_added migration briefly returned { sub_efforts } only, which emptied the portal workflow.

ALTER TABLE public.lead_sub_efforts
  ADD COLUMN IF NOT EXISTS manually_added boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.lead_sub_efforts.manually_added IS
  'True when staff added this template on the lead; shown even if not linked to the lead case type.';

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
  v_has_junction boolean;
  v_has_exclusions boolean;
  v_has_manually_added boolean;
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
        lse.updated_by
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
        lse.updated_by
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

  RETURN jsonb_build_object(
    'rows', COALESCE(v_rows, '[]'::JSONB),
    'category_id', v_category_id
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
