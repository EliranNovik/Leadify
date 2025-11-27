-- Simple unified search: lead_number, email, phone, name only
-- Uses UNION ALL to allow index usage
CREATE OR REPLACE FUNCTION public.search_leads_unified(
  query_text TEXT,
  max_results INT DEFAULT 10
)
RETURNS TABLE (
  id TEXT,
  lead_number TEXT,
  manual_id TEXT,
  name TEXT,
  email TEXT,
  phone TEXT,
  mobile TEXT, 
  topic TEXT,
  stage TEXT,
  source TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  notes TEXT,
  special_notes TEXT,
  next_followup TEXT,
  probability TEXT,
  category TEXT,
  language TEXT,
  balance TEXT,
  lead_type TEXT,
  unactivation_reason TEXT,
  deactivate_note TEXT,
  is_fuzzy_match BOOLEAN,
  is_contact BOOLEAN,
  contact_name TEXT,
  is_main_contact BOOLEAN,
  match_score INT
)
LANGUAGE plpgsql
AS $$
DECLARE
  trimmed_query TEXT := btrim(coalesce(query_text, ''));
  normalized_query TEXT;
  digits_only TEXT;
BEGIN
  IF trimmed_query = '' THEN
    RETURN;
  END IF;

  normalized_query := lower(trimmed_query);
  digits_only := regexp_replace(trimmed_query, '\D', '', 'g');

  RETURN QUERY
  WITH params AS (
    SELECT
      trimmed_query,
      normalized_query,
      digits_only,
      normalized_query || '%' AS prefix_query
  ),
  -- New leads: UNION ALL for index usage
  new_leads AS (
    (
    SELECT DISTINCT ON (l.id)
      l.id::TEXT AS id,
      coalesce(l.lead_number::TEXT, l.id::TEXT) AS lead_number,
      l.manual_id,
      l.name,
      l.email,
      l.phone,
      l.mobile,
      l.topic,
      coalesce(l.stage::TEXT, '') AS stage,
      l.source,
      l.created_at,
      l.created_at AS updated_at,
      l.general_notes AS notes,
      l.special_notes,
      l.next_followup::TEXT AS next_followup,
      l.probability::TEXT AS probability,
      l.category,
      l.language,
      l.balance::TEXT AS balance,
      'new'::TEXT AS lead_type,
      l.unactivation_reason,
      l.deactivate_notes AS deactivate_note,
      false AS is_contact,
      NULL::TEXT AS contact_name,
      NULL::BOOLEAN AS is_main_contact,
      6 AS match_score
    FROM public.leads l, params
    WHERE l.lead_number IS NOT NULL AND lower(l.lead_number) LIKE params.prefix_query
    LIMIT (max_results * 3)
    )
    UNION ALL
    (
    SELECT DISTINCT ON (l.id)
      l.id::TEXT AS id,
      coalesce(l.lead_number::TEXT, l.id::TEXT) AS lead_number,
      l.manual_id,
      l.name,
      l.email,
      l.phone,
      l.mobile,
      l.topic,
      coalesce(l.stage::TEXT, '') AS stage,
      l.source,
      l.created_at,
      l.created_at AS updated_at,
      l.general_notes AS notes,
      l.special_notes,
      l.next_followup::TEXT AS next_followup,
      l.probability::TEXT AS probability,
      l.category,
      l.language,
      l.balance::TEXT AS balance,
      'new'::TEXT AS lead_type,
      l.unactivation_reason,
      l.deactivate_notes AS deactivate_note,
      false AS is_contact,
      NULL::TEXT AS contact_name,
      NULL::BOOLEAN AS is_main_contact,
      5 AS match_score
    FROM public.leads l, params
    WHERE l.name IS NOT NULL AND lower(l.name) LIKE params.prefix_query
    LIMIT (max_results * 3)
    )
    UNION ALL
    (
    SELECT DISTINCT ON (l.id)
      l.id::TEXT AS id,
      coalesce(l.lead_number::TEXT, l.id::TEXT) AS lead_number,
      l.manual_id,
      l.name,
      l.email,
      l.phone,
      l.mobile,
      l.topic,
      coalesce(l.stage::TEXT, '') AS stage,
      l.source,
      l.created_at,
      l.created_at AS updated_at,
      l.general_notes AS notes,
      l.special_notes,
      l.next_followup::TEXT AS next_followup,
      l.probability::TEXT AS probability,
      l.category,
      l.language,
      l.balance::TEXT AS balance,
      'new'::TEXT AS lead_type,
      l.unactivation_reason,
      l.deactivate_notes AS deactivate_note,
      false AS is_contact,
      NULL::TEXT AS contact_name,
      NULL::BOOLEAN AS is_main_contact,
      5 AS match_score
    FROM public.leads l, params
    WHERE l.email IS NOT NULL AND lower(l.email) = params.normalized_query
    LIMIT (max_results * 3)
    )
  ),
  -- Legacy leads: UNION ALL for index usage
  legacy_leads AS (
    (
    SELECT DISTINCT ON (ll.id)
      ('legacy_' || ll.id::TEXT) AS id,
      ll.id::TEXT AS lead_number,
      ll.manual_id,
      ll.name,
      ll.email,
      ll.phone,
      ll.mobile,
      ll.topic,
      coalesce(ll.stage::TEXT, '') AS stage,
      ll.source_id::TEXT AS source,
      ll.cdate AS created_at,
      ll.udate AS updated_at,
      ll.notes,
      ll.special_notes,
      ll.next_followup,
      ll.probability,
      ll.category,
      ll.language_id::TEXT AS language,
      NULL::TEXT AS balance,
      'legacy'::TEXT AS lead_type,
      ll.unactivation_reason,
      ll.deactivate_notes AS deactivate_note,
      false AS is_contact,
      NULL::TEXT AS contact_name,
      NULL::BOOLEAN AS is_main_contact,
      6 AS match_score
    FROM public.leads_lead ll, params
    WHERE params.digits_only <> '' AND (ll.id)::TEXT LIKE params.digits_only || '%'
    LIMIT (max_results * 2)
    )
    UNION ALL
    (
    SELECT DISTINCT ON (ll.id)
      ('legacy_' || ll.id::TEXT) AS id,
      ll.id::TEXT AS lead_number,
      ll.manual_id,
      ll.name,
      ll.email,
      ll.phone,
      ll.mobile,
      ll.topic,
      coalesce(ll.stage::TEXT, '') AS stage,
      ll.source_id::TEXT AS source,
      ll.cdate AS created_at,
      ll.udate AS updated_at,
      ll.notes,
      ll.special_notes,
      ll.next_followup,
      ll.probability,
      ll.category,
      ll.language_id::TEXT AS language,
      NULL::TEXT AS balance,
      'legacy'::TEXT AS lead_type,
      ll.unactivation_reason,
      ll.deactivate_notes AS deactivate_note,
      false AS is_contact,
      NULL::TEXT AS contact_name,
      NULL::BOOLEAN AS is_main_contact,
      5 AS match_score
    FROM public.leads_lead ll, params
    WHERE ll.name IS NOT NULL AND lower(ll.name) LIKE params.prefix_query
    LIMIT (max_results * 2)
    )
    UNION ALL
    (
    SELECT DISTINCT ON (ll.id)
      ('legacy_' || ll.id::TEXT) AS id,
      ll.id::TEXT AS lead_number,
      ll.manual_id,
      ll.name,
      ll.email,
      ll.phone,
      ll.mobile,
      ll.topic,
      coalesce(ll.stage::TEXT, '') AS stage,
      ll.source_id::TEXT AS source,
      ll.cdate AS created_at,
      ll.udate AS updated_at,
      ll.notes,
      ll.special_notes,
      ll.next_followup,
      ll.probability,
      ll.category,
      ll.language_id::TEXT AS language,
      NULL::TEXT AS balance,
      'legacy'::TEXT AS lead_type,
      ll.unactivation_reason,
      ll.deactivate_notes AS deactivate_note,
      false AS is_contact,
      NULL::TEXT AS contact_name,
      NULL::BOOLEAN AS is_main_contact,
      5 AS match_score
    FROM public.leads_lead ll, params
    WHERE ll.email IS NOT NULL AND lower(ll.email) = params.normalized_query
    LIMIT (max_results * 2)
    )
  ),
  -- Contacts: UNION ALL for index usage
  contact_matches AS (
    (
    SELECT DISTINCT ON (coalesce(llc.newlead_id::TEXT, 'legacy_' || llc.lead_id::TEXT), llc.contact_id)
      coalesce(llc.newlead_id::TEXT, 'legacy_' || llc.lead_id::TEXT) AS id,
      coalesce(nl.lead_number::TEXT, ll.id::TEXT) AS lead_number,
      coalesce(nl.manual_id, ll.manual_id) AS manual_id,
      coalesce(nl.name, ll.name, lc.name) AS name,
      coalesce(nl.email, ll.email, lc.email) AS email,
      coalesce(nl.phone, ll.phone, lc.phone) AS phone,
      coalesce(nl.mobile, ll.mobile, lc.mobile) AS mobile,
      coalesce(nl.topic, ll.topic) AS topic,
      coalesce(nl.stage::TEXT, ll.stage::TEXT, '') AS stage,
      coalesce(nl.source, ll.source_id::TEXT) AS source,
      coalesce(nl.created_at, ll.cdate) AS created_at,
      coalesce(ll.udate, nl.created_at, ll.cdate) AS updated_at,
      coalesce(nl.general_notes, ll.notes, NULL::TEXT) AS notes,
      coalesce(nl.special_notes, ll.special_notes, NULL::TEXT) AS special_notes,
      coalesce(nl.next_followup::TEXT, ll.next_followup, NULL::TEXT) AS next_followup,
      coalesce(nl.probability::TEXT, ll.probability, NULL::TEXT) AS probability,
      coalesce(nl.category::TEXT, ll.category, NULL::TEXT) AS category,
      coalesce(nl.language::TEXT, ll.language_id::TEXT, NULL::TEXT) AS language,
      coalesce(nl.balance::TEXT, NULL::TEXT) AS balance,
      CASE WHEN nl.id IS NOT NULL THEN 'new' ELSE 'legacy' END AS lead_type,
      coalesce(nl.unactivation_reason, ll.unactivation_reason) AS unactivation_reason,
      coalesce(nl.deactivate_notes, ll.deactivate_notes) AS deactivate_note,
      true AS is_contact,
      lc.name AS contact_name,
      llc.main::BOOLEAN AS is_main_contact,
      5 AS match_score
    FROM public.leads_contact lc
    JOIN public.lead_leadcontact llc ON llc.contact_id = lc.id
    LEFT JOIN public.leads nl ON nl.id = llc.newlead_id
    LEFT JOIN public.leads_lead ll ON ll.id = llc.lead_id
    CROSS JOIN params
    WHERE lc.name IS NOT NULL AND lower(lc.name) LIKE params.prefix_query
    LIMIT max_results
    )
    UNION ALL
    (
    SELECT DISTINCT ON (coalesce(llc.newlead_id::TEXT, 'legacy_' || llc.lead_id::TEXT), llc.contact_id)
      coalesce(llc.newlead_id::TEXT, 'legacy_' || llc.lead_id::TEXT) AS id,
      coalesce(nl.lead_number::TEXT, ll.id::TEXT) AS lead_number,
      coalesce(nl.manual_id, ll.manual_id) AS manual_id,
      coalesce(nl.name, ll.name, lc.name) AS name,
      coalesce(nl.email, ll.email, lc.email) AS email,
      coalesce(nl.phone, ll.phone, lc.phone) AS phone,
      coalesce(nl.mobile, ll.mobile, lc.mobile) AS mobile,
      coalesce(nl.topic, ll.topic) AS topic,
      coalesce(nl.stage::TEXT, ll.stage::TEXT, '') AS stage,
      coalesce(nl.source, ll.source_id::TEXT) AS source,
      coalesce(nl.created_at, ll.cdate) AS created_at,
      coalesce(ll.udate, nl.created_at, ll.cdate) AS updated_at,
      coalesce(nl.general_notes, ll.notes, NULL::TEXT) AS notes,
      coalesce(nl.special_notes, ll.special_notes, NULL::TEXT) AS special_notes,
      coalesce(nl.next_followup::TEXT, ll.next_followup, NULL::TEXT) AS next_followup,
      coalesce(nl.probability::TEXT, ll.probability, NULL::TEXT) AS probability,
      coalesce(nl.category::TEXT, ll.category, NULL::TEXT) AS category,
      coalesce(nl.language::TEXT, ll.language_id::TEXT, NULL::TEXT) AS language,
      coalesce(nl.balance::TEXT, NULL::TEXT) AS balance,
      CASE WHEN nl.id IS NOT NULL THEN 'new' ELSE 'legacy' END AS lead_type,
      coalesce(nl.unactivation_reason, ll.unactivation_reason) AS unactivation_reason,
      coalesce(nl.deactivate_notes, ll.deactivate_notes) AS deactivate_note,
      true AS is_contact,
      lc.name AS contact_name,
      llc.main::BOOLEAN AS is_main_contact,
      5 AS match_score
    FROM public.leads_contact lc
    JOIN public.lead_leadcontact llc ON llc.contact_id = lc.id
    LEFT JOIN public.leads nl ON nl.id = llc.newlead_id
    LEFT JOIN public.leads_lead ll ON ll.id = llc.lead_id
    CROSS JOIN params
    WHERE lc.email IS NOT NULL AND lower(lc.email) = params.normalized_query
    LIMIT max_results
    )
  )
  SELECT
    combined.id,
    combined.lead_number,
    combined.manual_id,
    combined.name,
    combined.email,
    combined.phone,
    combined.mobile,
    combined.topic,
    combined.stage,
    combined.source,
    combined.created_at,
    combined.updated_at,
    combined.notes,
    combined.special_notes,
    combined.next_followup,
    combined.probability,
    combined.category,
    combined.language,
    combined.balance,
    combined.lead_type,
    combined.unactivation_reason,
    combined.deactivate_note,
    (combined.match_score < 5) AS is_fuzzy_match,
    combined.is_contact,
    combined.contact_name,
    combined.is_main_contact,
    combined.match_score
  FROM (
    SELECT * FROM new_leads
    UNION ALL
    SELECT * FROM legacy_leads
    UNION ALL
    SELECT * FROM contact_matches
  ) AS combined
  ORDER BY match_score DESC, created_at DESC NULLS LAST
  LIMIT max_results;
END;
$$;
