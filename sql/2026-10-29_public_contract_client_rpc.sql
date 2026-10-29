-- The client behind a contract link, read with the link's own token.
--
-- WHY
--   /public-contract/<id>/<token> is open to anyone holding the link, so the page runs as `anon`.
--   It read the lead straight out of `public.leads`, which meant `anon` needed SELECT on the whole
--   table — and `anon` is the role our public web app key maps to, so that grant exposed every
--   lead in the CRM to anyone who opened a browser console. This function is what lets that grant
--   go: it answers for one contract, only when the caller proves it holds that contract's token.
--
--   Legacy leads (`leads_lead`) are included so the signing page has one way in for both kinds.
--
-- Fields are named exactly as the page's old `select` named them, since that is what the contract
-- placeholders are filled from.
--
-- Safe to re-run.

CREATE OR REPLACE FUNCTION public.public_contract_client(
  p_contract_id uuid,
  p_public_token text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contract record;
  v_result jsonb;
BEGIN
  IF p_contract_id IS NULL OR p_public_token IS NULL OR btrim(p_public_token) = '' THEN
    RETURN NULL;
  END IF;

  -- The token is the password on the link. No token, no lead.
  SELECT id, client_id, legacy_id
    INTO v_contract
  FROM public.contracts
  WHERE id = p_contract_id
    AND public_token IS NOT NULL
    AND public_token = p_public_token
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_contract.legacy_id IS NOT NULL THEN
    SELECT jsonb_build_object(
      'lead_type', 'legacy',
      'id', l.id,
      'lead_number', l.lead_number,
      'manual_id', l.manual_id,
      'master_id', l.master_id,
      'name', l.name,
      'email', l.email,
      'phone', l.phone,
      'mobile', l.mobile,
      -- The closer, so the page can show who to speak to without reading the lead itself.
      'closer_id', l.closer_id,
      'closer', NULL
    )
      INTO v_result
    FROM public.leads_lead l
    WHERE l.id = v_contract.legacy_id
    LIMIT 1;

    RETURN v_result;
  END IF;

  IF v_contract.client_id IS NOT NULL THEN
    SELECT jsonb_build_object(
      'lead_type', 'new',
      'id', l.id,
      'lead_number', l.lead_number,
      'name', l.name,
      'email', l.email,
      'phone', l.phone,
      'mobile', l.mobile,
      'topic', l.topic,
      -- New leads hold the closer as a display name, not an id.
      'closer', l.closer,
      'closer_id', NULL
    )
      INTO v_result
    FROM public.leads l
    WHERE l.id = v_contract.client_id
    LIMIT 1;

    RETURN v_result;
  END IF;

  -- An employee, firm or recruitment contract: no client lead to return.
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.public_contract_client(uuid, text) IS
  'Lead behind a public contract link (new or legacy), returned only to a caller that supplies the contract public_token. Lets anon lose SELECT on public.leads.';

GRANT EXECUTE ON FUNCTION public.public_contract_client(uuid, text) TO anon, authenticated;

/*
 * Check with a real link:
 *
 *   SELECT public.public_contract_client('<contract uuid>', '<public_token>');
 *
 * A wrong token, or a contract that belongs to an employee rather than a client, returns NULL.
 */
