-- Header search RPC — exclusive intent paths (critical for speed).
-- Safe to re-run.
--
-- WHY exclusive IF branches: plpgsql vars are query parameters, so a giant
-- UNION with "WHERE v_is_phone AND …" still plans/scans every branch.
-- Each intent runs ONLY its own SQL.

CREATE INDEX IF NOT EXISTS idx_leads_email_lower ON public.leads (lower(email));
CREATE INDEX IF NOT EXISTS idx_leads_name_lower ON public.leads (lower(name));
CREATE INDEX IF NOT EXISTS idx_leads_phone_digits
  ON public.leads ((regexp_replace(coalesce(phone::text, ''), '\D', '', 'g')))
  WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_mobile_digits
  ON public.leads ((regexp_replace(coalesce(mobile::text, ''), '\D', '', 'g')))
  WHERE mobile IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_lead_email_lower ON public.leads_lead (lower(email));
CREATE INDEX IF NOT EXISTS idx_leads_lead_name_lower ON public.leads_lead (lower(name));
CREATE INDEX IF NOT EXISTS idx_leads_lead_phone_digits
  ON public.leads_lead ((regexp_replace(coalesce(phone::text, ''), '\D', '', 'g')))
  WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_lead_mobile_digits
  ON public.leads_lead ((regexp_replace(coalesce(mobile::text, ''), '\D', '', 'g')))
  WHERE mobile IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_contact_email_lower ON public.leads_contact (lower(email));
CREATE INDEX IF NOT EXISTS idx_leads_contact_name_lower ON public.leads_contact (lower(name));
CREATE INDEX IF NOT EXISTS idx_leads_contact_phone_digits
  ON public.leads_contact ((regexp_replace(coalesce(phone::text, ''), '\D', '', 'g')))
  WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_contact_mobile_digits
  ON public.leads_contact ((regexp_replace(coalesce(mobile::text, ''), '\D', '', 'g')))
  WHERE mobile IS NOT NULL;

-- Trigram indexes: make Hebrew / last-name / contains searches usable (not seq-scan).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_leads_name_lower_trgm
  ON public.leads USING gin (lower(name) gin_trgm_ops)
  WHERE name IS NOT NULL AND btrim(name) <> '';
CREATE INDEX IF NOT EXISTS idx_leads_lead_name_lower_trgm
  ON public.leads_lead USING gin (lower(name) gin_trgm_ops)
  WHERE name IS NOT NULL AND btrim(name) <> '';
CREATE INDEX IF NOT EXISTS idx_leads_contact_name_lower_trgm
  ON public.leads_contact USING gin (lower(name) gin_trgm_ops)
  WHERE name IS NOT NULL AND btrim(name) <> '';

DROP FUNCTION IF EXISTS public.search_leads_header(text, integer);
DROP FUNCTION IF EXISTS public.search_leads_header(text, integer, text[]);

CREATE OR REPLACE FUNCTION public.search_leads_header(
  p_query text,
  p_limit integer DEFAULT 20,
  p_variants text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
SET statement_timeout = '2.5s'
AS $$
DECLARE
  v_raw text := btrim(COALESCE(p_query, ''));
  v_raw_noprefix text;
  v_lower text;
  v_digits text;
  v_master text := NULL;
  v_suffix integer := NULL;
  v_has_slash boolean := false;
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 40);
  v_prefix text;
  v_phone_forms text[] := ARRAY[]::text[];
  v_name_terms text[] := ARRAY[]::text[];
  v_name_prefixes text[] := ARRAY[]::text[];
  v_slash_parts text[];
  v_has_formatting boolean;
  v_has_non_latin boolean := false;
  v_result jsonb;
BEGIN
  IF length(v_raw) < 2 THEN
    RETURN '[]'::jsonb;
  END IF;

  v_lower := lower(v_raw);
  v_prefix := v_lower || '%';
  v_has_non_latin := v_raw ~ '[^[:ascii:]]';
  -- Lean name terms only (client already caps fuzzy). Prefix match uses btree/trgm.
  v_name_terms := ARRAY(
    SELECT DISTINCT lower(btrim(v))
    FROM unnest(
      CASE
        WHEN p_variants IS NULL OR cardinality(p_variants) IS NULL OR cardinality(p_variants) = 0
          THEN ARRAY[v_lower]
        ELSE p_variants
      END
    ) AS v
    WHERE length(btrim(COALESCE(v, ''))) >= 2
    LIMIT 4
  );
  IF cardinality(v_name_terms) = 0 THEN
    v_name_terms := ARRAY[v_lower];
  END IF;
  v_name_prefixes := ARRAY(SELECT t || '%' FROM unnest(v_name_terms) AS t);
  v_raw_noprefix := regexp_replace(v_raw, '^[LC]', '', 'i');
  v_has_slash := position('/' in v_raw_noprefix) > 0;
  v_has_formatting := length(v_raw) > length(regexp_replace(v_raw, '\D', '', 'g'));

  IF v_has_slash THEN
    v_slash_parts := string_to_array(v_raw_noprefix, '/');
    IF array_length(v_slash_parts, 1) = 2
       AND v_slash_parts[1] ~ '^\d+$'
       AND v_slash_parts[2] ~ '^\d+$'
    THEN
      v_master := v_slash_parts[1];
      v_suffix := v_slash_parts[2]::integer;
      v_digits := v_master;
    ELSE
      v_digits := regexp_replace(v_raw, '\D', '', 'g');
    END IF;
  ELSE
    v_digits := regexp_replace(v_raw, '\D', '', 'g');
    v_master := CASE WHEN v_digits ~ '^\d+$' THEN v_digits ELSE NULL END;
  END IF;

  /* ===================== EMAIL ===================== */
  IF position('@' in v_raw) > 0 THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.match_score DESC, x.created_at DESC NULLS LAST), '[]'::jsonb)
    INTO v_result
    FROM (
      SELECT * FROM (
      SELECT DISTINCT ON (lead_type, id, COALESCE(contact_id, '')) *
      FROM (
        (
          SELECT
            l.id::text AS id,
            COALESCE(l.lead_number::text, l.id::text) AS lead_number,
            l.manual_id::text AS manual_id,
            COALESCE(l.name, '') AS name,
            COALESCE(l.email, '') AS email,
            COALESCE(l.phone::text, '') AS phone,
            COALESCE(l.mobile::text, '') AS mobile,
            COALESCE(l.topic, '') AS topic,
            COALESCE(l.stage::text, '') AS stage,
            l.created_at,
            l.status::text AS status,
            l.master_id::text AS master_id,
            l.category_id::text AS category_id,
            'new'::text AS lead_type,
            false AS is_contact,
            NULL::text AS contact_name,
            NULL::boolean AS is_main_contact,
            NULL::text AS contact_id,
            NULL::text AS portal_profile_image_path,
            95 AS match_score
          FROM public.leads l
          WHERE l.email IS NOT NULL AND lower(l.email) LIKE v_prefix
          ORDER BY l.created_at DESC NULLS LAST
          LIMIT v_limit
        )
        UNION ALL
        (
          SELECT
            ll.id::text,
            COALESCE(NULLIF(btrim(COALESCE(ll.lead_number::text, '')), ''), ll.id::text),
            ll.manual_id::text,
            COALESCE(ll.name, ''), COALESCE(ll.email, ''),
            COALESCE(ll.phone::text, ''), COALESCE(ll.mobile::text, ''),
            COALESCE(ll.topic, ''), COALESCE(ll.stage::text, ''),
            ll.cdate, ll.status::text, ll.master_id::text, ll.category_id::text,
            'legacy', false, NULL::text, NULL::boolean, NULL::text, NULL::text, 95
          FROM public.leads_lead ll
          WHERE ll.email IS NOT NULL AND lower(ll.email) LIKE v_prefix
          ORDER BY ll.cdate DESC NULLS LAST
          LIMIT v_limit
        )
        UNION ALL
        (
          SELECT
            COALESCE(llc.newlead_id::text, ll.id::text),
            COALESCE(nl.lead_number::text, NULLIF(btrim(COALESCE(ll.lead_number::text, '')), ''), ll.id::text, ''),
            COALESCE(nl.manual_id::text, ll.manual_id::text),
            COALESCE(lc.name, nl.name, ll.name, ''),
            COALESCE(lc.email, nl.email, ll.email, ''),
            COALESCE(lc.phone::text, nl.phone::text, ll.phone::text, ''),
            COALESCE(lc.mobile::text, nl.mobile::text, ll.mobile::text, ''),
            COALESCE(nl.topic, ll.topic, ''),
            COALESCE(nl.stage::text, ll.stage::text, ''),
            COALESCE(nl.created_at, ll.cdate),
            COALESCE(nl.status::text, ll.status::text),
            COALESCE(nl.master_id::text, ll.master_id::text),
            COALESCE(nl.category_id::text, ll.category_id::text),
            CASE WHEN nl.id IS NOT NULL THEN 'new' ELSE 'legacy' END,
            true,
            lc.name,
            (lower(btrim(COALESCE(llc.main::text, ''))) IN ('true', 't', '1', 'yes', 'y')),
            lc.id::text,
            lc.portal_profile_image_path::text,
            88
          FROM (
            SELECT id FROM public.leads_contact
            WHERE email IS NOT NULL AND lower(email) LIKE v_prefix
            LIMIT (v_limit * 2)
          ) hit
          JOIN public.leads_contact lc ON lc.id = hit.id
          JOIN public.lead_leadcontact llc ON llc.contact_id = lc.id
          LEFT JOIN public.leads nl ON nl.id = llc.newlead_id
          LEFT JOIN public.leads_lead ll ON ll.id = llc.lead_id
        )
      ) u
      WHERE u.id IS NOT NULL AND btrim(u.id) <> ''
      ORDER BY lead_type, id, COALESCE(contact_id, ''), match_score DESC
    ) deduped
    ORDER BY match_score DESC, created_at DESC NULLS LAST
    LIMIT v_limit
    ) x;
    RETURN COALESCE(v_result, '[]'::jsonb);
  END IF;

  /* ===================== LEAD NUMBER ===================== */
  IF v_raw ~* '^[LC]\d' OR v_has_slash
     OR (
       v_digits <> ''
       AND v_raw_noprefix ~ '^\d+$'
       AND length(v_digits) BETWEEN 3 AND 10
       AND v_digits NOT LIKE '0%'
       AND v_digits NOT LIKE '972%'
       AND v_digits NOT LIKE '00972%'
       AND NOT (v_digits LIKE '5%' AND length(v_digits) BETWEEN 7 AND 10)
     )
  THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.match_score DESC, x.created_at DESC NULLS LAST), '[]'::jsonb)
    INTO v_result
    FROM (
      SELECT * FROM (
      SELECT DISTINCT ON (lead_type, id) *
      FROM (
        (
          SELECT
            l.id::text AS id,
            COALESCE(l.lead_number::text, l.id::text) AS lead_number,
            l.manual_id::text AS manual_id,
            COALESCE(l.name, '') AS name,
            COALESCE(l.email, '') AS email,
            COALESCE(l.phone::text, '') AS phone,
            COALESCE(l.mobile::text, '') AS mobile,
            COALESCE(l.topic, '') AS topic,
            COALESCE(l.stage::text, '') AS stage,
            l.created_at,
            l.status::text AS status,
            l.master_id::text AS master_id,
            l.category_id::text AS category_id,
            'new'::text AS lead_type,
            false AS is_contact,
            NULL::text AS contact_name,
            NULL::boolean AS is_main_contact,
            NULL::text AS contact_id,
            NULL::text AS portal_profile_image_path,
            CASE WHEN v_suffix IS NOT NULL THEN 100 ELSE 90 END AS match_score
          FROM public.leads l
          WHERE l.lead_number IS NOT NULL
            AND (
              (
                v_suffix IS NOT NULL AND v_master IS NOT NULL
                AND (
                  l.lead_number::text = v_master || '/' || v_suffix::text
                  OR l.lead_number::text = 'L' || v_master || '/' || v_suffix::text
                  OR l.lead_number::text = 'C' || v_master || '/' || v_suffix::text
                )
              )
              OR (
                v_suffix IS NULL AND length(v_digits) >= 6
                AND (
                  l.lead_number::text = v_digits
                  OR l.lead_number::text = 'L' || v_digits
                  OR l.lead_number::text = 'C' || v_digits
                  OR l.lead_number::text ILIKE v_digits || '/%'
                  OR l.lead_number::text ILIKE 'L' || v_digits || '/%'
                  OR l.lead_number::text ILIKE 'C' || v_digits || '/%'
                )
              )
              OR (
                v_suffix IS NULL AND length(v_digits) BETWEEN 1 AND 5
                AND (
                  l.lead_number::text ILIKE v_digits || '%'
                  OR l.lead_number::text ILIKE 'L' || v_digits || '%'
                  OR l.lead_number::text ILIKE 'C' || v_digits || '%'
                )
              )
            )
          ORDER BY l.created_at DESC NULLS LAST
          LIMIT v_limit
        )
        UNION ALL
        (
          SELECT
            ll.id::text,
            COALESCE(NULLIF(btrim(COALESCE(ll.lead_number::text, '')), ''), NULLIF(btrim(COALESCE(ll.manual_id::text, '')), ''), ll.id::text),
            ll.manual_id::text,
            COALESCE(ll.name, ''), COALESCE(ll.email, ''),
            COALESCE(ll.phone::text, ''), COALESCE(ll.mobile::text, ''),
            COALESCE(ll.topic, ''), COALESCE(ll.stage::text, ''),
            ll.cdate, ll.status::text, ll.master_id::text, ll.category_id::text,
            'legacy', false, NULL::text, NULL::boolean, NULL::text, NULL::text,
            CASE WHEN v_suffix IS NOT NULL THEN 100 ELSE 90 END
          FROM public.leads_lead ll
          WHERE (
              (
                v_suffix IS NOT NULL AND v_master IS NOT NULL
                AND (
                  ll.lead_number::text = v_master || '/' || v_suffix::text
                  OR ll.lead_number::text = 'L' || v_master || '/' || v_suffix::text
                  OR ll.lead_number::text = 'C' || v_master || '/' || v_suffix::text
                  OR ll.manual_id::text = v_master || '/' || v_suffix::text
                  OR ll.manual_id::text = 'L' || v_master || '/' || v_suffix::text
                  OR ll.manual_id::text = 'C' || v_master || '/' || v_suffix::text
                )
              )
              OR (
                v_suffix IS NULL AND length(v_digits) >= 6
                AND (
                  ll.lead_number::text = v_digits
                  OR ll.lead_number::text = 'L' || v_digits
                  OR ll.lead_number::text = 'C' || v_digits
                  OR ll.manual_id::text = v_digits
                  OR ll.manual_id::text = 'L' || v_digits
                  OR ll.manual_id::text = 'C' || v_digits
                  OR ll.lead_number::text ILIKE v_digits || '/%'
                  OR ll.lead_number::text ILIKE 'L' || v_digits || '/%'
                  OR ll.lead_number::text ILIKE 'C' || v_digits || '/%'
                  OR ll.id::text = v_digits
                )
              )
              OR (
                v_suffix IS NULL AND length(v_digits) BETWEEN 1 AND 5
                AND (
                  ll.lead_number::text ILIKE v_digits || '%'
                  OR ll.lead_number::text ILIKE 'L' || v_digits || '%'
                  OR ll.lead_number::text ILIKE 'C' || v_digits || '%'
                  OR ll.manual_id::text ILIKE v_digits || '%'
                  OR ll.manual_id::text ILIKE 'L' || v_digits || '%'
                  OR ll.manual_id::text ILIKE 'C' || v_digits || '%'
                  OR ll.id::text LIKE v_digits || '%'
                )
              )
            )
          ORDER BY ll.cdate DESC NULLS LAST
          LIMIT v_limit
        )
        UNION ALL
        (
          SELECT
            s.id, s.lead_number, s.manual_id, s.name, s.email, s.phone, s.mobile,
            s.topic, s.stage, s.created_at, s.status, s.master_id, s.category_id,
            s.lead_type, false, NULL::text, NULL::boolean, NULL::text, NULL::text, 95
          FROM (
            SELECT
              ll.id::text AS id,
              (v_master || '/' || (row_number() OVER (ORDER BY ll.id ASC) + 1)::text) AS lead_number,
              ll.manual_id::text AS manual_id,
              COALESCE(ll.name, '') AS name,
              COALESCE(ll.email, '') AS email,
              COALESCE(ll.phone::text, '') AS phone,
              COALESCE(ll.mobile::text, '') AS mobile,
              COALESCE(ll.topic, '') AS topic,
              COALESCE(ll.stage::text, '') AS stage,
              ll.cdate AS created_at,
              ll.status::text AS status,
              ll.master_id::text AS master_id,
              ll.category_id::text AS category_id,
              'legacy'::text AS lead_type,
              (row_number() OVER (ORDER BY ll.id ASC) + 1) AS ordinal_suffix
            FROM public.leads_lead ll
            WHERE v_master IS NOT NULL
              AND v_master ~ '^\d+$'
              AND ll.master_id IS NOT NULL
              AND ll.master_id::text = v_master
          ) s
          WHERE v_suffix IS NULL OR s.ordinal_suffix = v_suffix
          LIMIT v_limit
        )
      ) u
      WHERE u.id IS NOT NULL AND btrim(u.id) <> ''
      ORDER BY lead_type, id, match_score DESC
    ) deduped
    ORDER BY match_score DESC, created_at DESC NULLS LAST
    LIMIT v_limit
    ) x;
    RETURN COALESCE(v_result, '[]'::jsonb);
  END IF;

  /* ===================== PHONE ===================== */
  -- Prefer equality on normalized digits (uses expression btree indexes).
  -- Prefix LIKE only for short progressive queries (4–6 digits) — full-number
  -- LIKE-after-regexp was seq-scanning and timing out, which made phones "disappear".
  IF v_digits <> ''
     AND length(v_digits) >= 4
     AND (
       v_has_formatting
       OR v_digits LIKE '00972%'
       OR v_digits LIKE '972%'
       OR v_digits LIKE '0%'
       OR (v_digits LIKE '5%' AND length(v_digits) >= 5)
     )
  THEN
    v_phone_forms := ARRAY[
      v_digits,
      CASE WHEN v_digits LIKE '0%' AND length(v_digits) > 1 THEN substr(v_digits, 2) END,
      CASE WHEN v_digits LIKE '5%' THEN '0' || v_digits END,
      CASE WHEN v_digits LIKE '5%' THEN '972' || v_digits END,
      CASE WHEN v_digits LIKE '972%' AND length(v_digits) > 3 THEN substr(v_digits, 4) END,
      CASE
        WHEN v_digits LIKE '972%' AND length(v_digits) > 3 AND substr(v_digits, 4) NOT LIKE '0%'
          THEN '0' || substr(v_digits, 4)
      END,
      CASE WHEN v_digits LIKE '0%' AND length(v_digits) > 1 THEN '972' || substr(v_digits, 2) END,
      CASE WHEN v_digits LIKE '00972%' AND length(v_digits) > 5 THEN substr(v_digits, 6) END,
      CASE
        WHEN v_digits LIKE '00972%' AND length(v_digits) > 5 AND substr(v_digits, 6) NOT LIKE '0%'
          THEN '0' || substr(v_digits, 6)
      END,
      CASE
        WHEN v_digits LIKE '00972%' AND length(v_digits) > 5
          THEN '972' || CASE
            WHEN substr(v_digits, 6) LIKE '0%' THEN substr(v_digits, 7)
            ELSE substr(v_digits, 6)
          END
      END
    ];
    v_phone_forms := ARRAY(
      SELECT DISTINCT f FROM unnest(v_phone_forms) AS f
      WHERE f IS NOT NULL AND length(f) >= 4
      LIMIT 10
    );

    IF cardinality(v_phone_forms) = 0 THEN
      RETURN '[]'::jsonb;
    END IF;

    SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.match_score DESC, x.created_at DESC NULLS LAST), '[]'::jsonb)
    INTO v_result
    FROM (
      SELECT * FROM (
      SELECT DISTINCT ON (lead_type, id, COALESCE(contact_id, '')) *
      FROM (
        (
          SELECT
            l.id::text AS id,
            COALESCE(l.lead_number::text, l.id::text) AS lead_number,
            l.manual_id::text AS manual_id,
            COALESCE(l.name, '') AS name,
            COALESCE(l.email, '') AS email,
            COALESCE(l.phone::text, '') AS phone,
            COALESCE(l.mobile::text, '') AS mobile,
            COALESCE(l.topic, '') AS topic,
            COALESCE(l.stage::text, '') AS stage,
            l.created_at,
            l.status::text AS status,
            l.master_id::text AS master_id,
            l.category_id::text AS category_id,
            'new'::text AS lead_type,
            false AS is_contact,
            NULL::text AS contact_name,
            NULL::boolean AS is_main_contact,
            NULL::text AS contact_id,
            NULL::text AS portal_profile_image_path,
            85 AS match_score
          FROM public.leads l
          WHERE
            regexp_replace(coalesce(l.phone::text, ''), '\D', '', 'g') = ANY (v_phone_forms)
            OR regexp_replace(coalesce(l.mobile::text, ''), '\D', '', 'g') = ANY (v_phone_forms)
            OR (
              length(v_digits) BETWEEN 4 AND 6
              AND (
                regexp_replace(coalesce(l.phone::text, ''), '\D', '', 'g') LIKE v_digits || '%'
                OR regexp_replace(coalesce(l.mobile::text, ''), '\D', '', 'g') LIKE v_digits || '%'
                OR (
                  v_digits LIKE '0%'
                  AND length(v_digits) > 1
                  AND (
                    regexp_replace(coalesce(l.phone::text, ''), '\D', '', 'g') LIKE substr(v_digits, 2) || '%'
                    OR regexp_replace(coalesce(l.mobile::text, ''), '\D', '', 'g') LIKE substr(v_digits, 2) || '%'
                  )
                )
              )
            )
          ORDER BY l.created_at DESC NULLS LAST
          LIMIT v_limit
        )
        UNION ALL
        (
          SELECT
            ll.id::text,
            COALESCE(NULLIF(btrim(COALESCE(ll.lead_number::text, '')), ''), ll.id::text),
            ll.manual_id::text,
            COALESCE(ll.name, ''), COALESCE(ll.email, ''),
            COALESCE(ll.phone::text, ''), COALESCE(ll.mobile::text, ''),
            COALESCE(ll.topic, ''), COALESCE(ll.stage::text, ''),
            ll.cdate, ll.status::text, ll.master_id::text, ll.category_id::text,
            'legacy', false, NULL::text, NULL::boolean, NULL::text, NULL::text, 85
          FROM public.leads_lead ll
          WHERE
            regexp_replace(coalesce(ll.phone::text, ''), '\D', '', 'g') = ANY (v_phone_forms)
            OR regexp_replace(coalesce(ll.mobile::text, ''), '\D', '', 'g') = ANY (v_phone_forms)
            OR (
              length(v_digits) BETWEEN 4 AND 6
              AND (
                regexp_replace(coalesce(ll.phone::text, ''), '\D', '', 'g') LIKE v_digits || '%'
                OR regexp_replace(coalesce(ll.mobile::text, ''), '\D', '', 'g') LIKE v_digits || '%'
                OR (
                  v_digits LIKE '0%'
                  AND length(v_digits) > 1
                  AND (
                    regexp_replace(coalesce(ll.phone::text, ''), '\D', '', 'g') LIKE substr(v_digits, 2) || '%'
                    OR regexp_replace(coalesce(ll.mobile::text, ''), '\D', '', 'g') LIKE substr(v_digits, 2) || '%'
                  )
                )
              )
            )
          ORDER BY ll.cdate DESC NULLS LAST
          LIMIT v_limit
        )
        UNION ALL
        (
          SELECT
            COALESCE(llc.newlead_id::text, ll.id::text),
            COALESCE(nl.lead_number::text, NULLIF(btrim(COALESCE(ll.lead_number::text, '')), ''), ll.id::text, ''),
            COALESCE(nl.manual_id::text, ll.manual_id::text),
            COALESCE(lc.name, nl.name, ll.name, ''),
            COALESCE(lc.email, nl.email, ll.email, ''),
            COALESCE(lc.phone::text, nl.phone::text, ll.phone::text, ''),
            COALESCE(lc.mobile::text, nl.mobile::text, ll.mobile::text, ''),
            COALESCE(nl.topic, ll.topic, ''),
            COALESCE(nl.stage::text, ll.stage::text, ''),
            COALESCE(nl.created_at, ll.cdate),
            COALESCE(nl.status::text, ll.status::text),
            COALESCE(nl.master_id::text, ll.master_id::text),
            COALESCE(nl.category_id::text, ll.category_id::text),
            CASE WHEN nl.id IS NOT NULL THEN 'new' ELSE 'legacy' END,
            true,
            lc.name,
            (lower(btrim(COALESCE(llc.main::text, ''))) IN ('true', 't', '1', 'yes', 'y')),
            lc.id::text,
            lc.portal_profile_image_path::text,
            80
          FROM (
            SELECT id FROM public.leads_contact
            WHERE
              regexp_replace(coalesce(phone::text, ''), '\D', '', 'g') = ANY (v_phone_forms)
              OR regexp_replace(coalesce(mobile::text, ''), '\D', '', 'g') = ANY (v_phone_forms)
              OR (
                length(v_digits) BETWEEN 4 AND 6
                AND (
                  regexp_replace(coalesce(phone::text, ''), '\D', '', 'g') LIKE v_digits || '%'
                  OR regexp_replace(coalesce(mobile::text, ''), '\D', '', 'g') LIKE v_digits || '%'
                  OR (
                    v_digits LIKE '0%'
                    AND length(v_digits) > 1
                    AND (
                      regexp_replace(coalesce(phone::text, ''), '\D', '', 'g') LIKE substr(v_digits, 2) || '%'
                      OR regexp_replace(coalesce(mobile::text, ''), '\D', '', 'g') LIKE substr(v_digits, 2) || '%'
                    )
                  )
                )
              )
            LIMIT (v_limit * 2)
          ) hit
          JOIN public.leads_contact lc ON lc.id = hit.id
          JOIN public.lead_leadcontact llc ON llc.contact_id = lc.id
          LEFT JOIN public.leads nl ON nl.id = llc.newlead_id
          LEFT JOIN public.leads_lead ll ON ll.id = llc.lead_id
        )
      ) u
      WHERE u.id IS NOT NULL AND btrim(u.id) <> ''
      ORDER BY lead_type, id, COALESCE(contact_id, ''), match_score DESC
    ) deduped
    ORDER BY match_score DESC, created_at DESC NULLS LAST
    LIMIT v_limit
    ) x;
    RETURN COALESCE(v_result, '[]'::jsonb);
  END IF;

  /* ===================== NAME ===================== */
  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.match_score DESC, x.created_at DESC NULLS LAST), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT * FROM (
    SELECT DISTINCT ON (lead_type, id, COALESCE(contact_id, '')) *
    FROM (
      (
        SELECT
          l.id::text AS id,
          COALESCE(l.lead_number::text, l.id::text) AS lead_number,
          l.manual_id::text AS manual_id,
          COALESCE(l.name, '') AS name,
          COALESCE(l.email, '') AS email,
          COALESCE(l.phone::text, '') AS phone,
          COALESCE(l.mobile::text, '') AS mobile,
          COALESCE(l.topic, '') AS topic,
          COALESCE(l.stage::text, '') AS stage,
          l.created_at,
          l.status::text AS status,
          l.master_id::text AS master_id,
          l.category_id::text AS category_id,
          'new'::text AS lead_type,
          false AS is_contact,
          NULL::text AS contact_name,
          NULL::boolean AS is_main_contact,
          NULL::text AS contact_id,
          NULL::text AS portal_profile_image_path,
          70 AS match_score
        FROM public.leads l
        WHERE l.name IS NOT NULL
          AND (
            lower(l.name) LIKE ANY (v_name_prefixes)
            OR (length(v_lower) >= 3 AND lower(l.name) LIKE ('% ' || v_lower || '%'))
            OR (v_has_non_latin AND lower(l.name) LIKE ('%' || v_lower || '%'))
          )
        ORDER BY l.created_at DESC NULLS LAST
        LIMIT v_limit
      )
      UNION ALL
      (
        SELECT
          ll.id::text,
          COALESCE(NULLIF(btrim(COALESCE(ll.lead_number::text, '')), ''), ll.id::text),
          ll.manual_id::text,
          COALESCE(ll.name, ''), COALESCE(ll.email, ''),
          COALESCE(ll.phone::text, ''), COALESCE(ll.mobile::text, ''),
          COALESCE(ll.topic, ''), COALESCE(ll.stage::text, ''),
          ll.cdate, ll.status::text, ll.master_id::text, ll.category_id::text,
          'legacy', false, NULL::text, NULL::boolean, NULL::text, NULL::text, 70
        FROM public.leads_lead ll
        WHERE ll.name IS NOT NULL
          AND (
            lower(ll.name) LIKE ANY (v_name_prefixes)
            OR (length(v_lower) >= 3 AND lower(ll.name) LIKE ('% ' || v_lower || '%'))
            OR (v_has_non_latin AND lower(ll.name) LIKE ('%' || v_lower || '%'))
          )
        ORDER BY ll.cdate DESC NULLS LAST
        LIMIT v_limit
      )
      UNION ALL
      (
        SELECT
          COALESCE(llc.newlead_id::text, ll.id::text),
          COALESCE(nl.lead_number::text, NULLIF(btrim(COALESCE(ll.lead_number::text, '')), ''), ll.id::text, ''),
          COALESCE(nl.manual_id::text, ll.manual_id::text),
          COALESCE(lc.name, nl.name, ll.name, ''),
          COALESCE(lc.email, nl.email, ll.email, ''),
          COALESCE(lc.phone::text, nl.phone::text, ll.phone::text, ''),
          COALESCE(lc.mobile::text, nl.mobile::text, ll.mobile::text, ''),
          COALESCE(nl.topic, ll.topic, ''),
          COALESCE(nl.stage::text, ll.stage::text, ''),
          COALESCE(nl.created_at, ll.cdate),
          COALESCE(nl.status::text, ll.status::text),
          COALESCE(nl.master_id::text, ll.master_id::text),
          COALESCE(nl.category_id::text, ll.category_id::text),
          CASE WHEN nl.id IS NOT NULL THEN 'new' ELSE 'legacy' END,
          true,
          lc.name,
          (lower(btrim(COALESCE(llc.main::text, ''))) IN ('true', 't', '1', 'yes', 'y')),
          lc.id::text,
          lc.portal_profile_image_path::text,
          65
        FROM (
          SELECT id FROM public.leads_contact
          WHERE name IS NOT NULL
            AND (
              lower(name) LIKE ANY (v_name_prefixes)
              OR (length(v_lower) >= 3 AND lower(name) LIKE ('% ' || v_lower || '%'))
              OR (v_has_non_latin AND lower(name) LIKE ('%' || v_lower || '%'))
            )
          LIMIT (v_limit * 2)
        ) hit
        JOIN public.leads_contact lc ON lc.id = hit.id
        JOIN public.lead_leadcontact llc ON llc.contact_id = lc.id
        LEFT JOIN public.leads nl ON nl.id = llc.newlead_id
        LEFT JOIN public.leads_lead ll ON ll.id = llc.lead_id
      )
    ) u
    WHERE u.id IS NOT NULL AND btrim(u.id) <> ''
    ORDER BY lead_type, id, COALESCE(contact_id, ''), match_score DESC
  ) deduped
  ORDER BY match_score DESC, created_at DESC NULLS LAST
  LIMIT v_limit
  ) x;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_leads_header(text, integer, text[])
  TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
