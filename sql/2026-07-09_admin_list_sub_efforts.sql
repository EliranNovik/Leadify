-- Admin helpers: list ALL sub_efforts + sync/fetch misc_category links (bypasses RLS).
-- Run in Supabase SQL editor.

CREATE OR REPLACE FUNCTION public.admin_list_sub_efforts()
RETURNS SETOF jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    to_jsonb(se.*) || jsonb_build_object(
      'linked_misc_category_ids',
      COALESCE(
        (
          SELECT jsonb_agg(l.misc_category_id ORDER BY l.misc_category_id)
          FROM public.sub_effort_misc_categories l
          WHERE l.sub_effort_id = se.id
        ),
        '[]'::jsonb
      )
    )
  FROM public.sub_efforts se
  ORDER BY se.sort_order ASC NULLS LAST, se.id ASC;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_sub_effort_misc_category_links()
RETURNS TABLE (
  id bigint,
  sub_effort_id bigint,
  misc_category_id integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.id, l.sub_effort_id, l.misc_category_id
  FROM public.sub_effort_misc_categories l
  ORDER BY l.sub_effort_id ASC, l.misc_category_id ASC;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_sub_effort_misc_category_ids(p_sub_effort_id bigint)
RETURNS integer[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    array_agg(l.misc_category_id ORDER BY l.misc_category_id),
    '{}'::integer[]
  )
  FROM public.sub_effort_misc_categories l
  WHERE l.sub_effort_id = p_sub_effort_id;
$$;

-- Replace all case-type links for one sub effort; returns saved misc_category ids.
-- DROP required when upgrading from the older version that returned integer (count).
DROP FUNCTION IF EXISTS public.admin_sync_sub_effort_misc_categories(bigint, integer[]);

CREATE OR REPLACE FUNCTION public.admin_sync_sub_effort_misc_categories(
  p_sub_effort_id bigint,
  p_misc_category_ids integer[]
)
RETURNS integer[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.sub_effort_misc_categories
  WHERE sub_effort_id = p_sub_effort_id;

  IF p_misc_category_ids IS NOT NULL AND COALESCE(array_length(p_misc_category_ids, 1), 0) > 0 THEN
    INSERT INTO public.sub_effort_misc_categories (sub_effort_id, misc_category_id)
    SELECT p_sub_effort_id, cat_id
    FROM unnest(p_misc_category_ids) AS cat_id
    ON CONFLICT (sub_effort_id, misc_category_id) DO NOTHING;
  END IF;

  RETURN (
    SELECT COALESCE(
      array_agg(l.misc_category_id ORDER BY l.misc_category_id),
      '{}'::integer[]
    )
    FROM public.sub_effort_misc_categories l
    WHERE l.sub_effort_id = p_sub_effort_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_sub_efforts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_sub_effort_misc_category_links() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_sub_effort_misc_category_ids(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_sync_sub_effort_misc_categories(bigint, integer[]) TO authenticated;
