-- Archive a signed contract and replace it with an amended draft.
--
-- Why: a lead has one live contract. When the client wants changes to an already
-- signed contract we need to keep the signed original for the record, archive it,
-- and start a fresh draft cloned from it without the signature and date.
--
-- Design notes:
--  * status/signed_at are NOT touched on archive. 'signed' is checked in ~69 places
--    and drives signed-date reporting, so overwriting it would make the lead look
--    like it never signed. archived_at is a separate flag; archived contracts stay
--    status='signed' forever.
--  * pre_sign_content exists because signing OVERWRITES custom_content with the body
--    that already has {{text:ID}} / {{signature:ID}} / {{date:ID}} substituted
--    (the signature becomes a raw data:image base64 string in a text node), so the
--    unsigned body is otherwise unrecoverable. We snapshot it at sign time so the
--    amended clone can start from a clean placeholder body.
--  * All additive and nullable: no backfill, no constraint changes, no policy changes.
--    contracts' RLS policies are row-level only (no column lists), so the anon
--    public-signing UPDATE keeps working with the new columns.

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by TEXT,
  ADD COLUMN IF NOT EXISTS archive_reason TEXT,
  ADD COLUMN IF NOT EXISTS superseded_by_contract_id UUID,
  ADD COLUMN IF NOT EXISTS pre_sign_content JSONB;

-- Link an archived contract to the amended draft that replaced it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contracts_superseded_by_contract_id_fkey'
      AND conrelid = 'public.contracts'::regclass
  ) THEN
    ALTER TABLE public.contracts
      ADD CONSTRAINT contracts_superseded_by_contract_id_fkey
      FOREIGN KEY (superseded_by_contract_id)
      REFERENCES public.contracts(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- The hot path is "the live contract(s) for this lead", which now always filters
-- archived_at IS NULL. Partial indexes keep those lookups cheap.
CREATE INDEX IF NOT EXISTS idx_contracts_client_active
  ON public.contracts (client_id)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_contracts_legacy_active
  ON public.contracts (legacy_id)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_contracts_archived_at
  ON public.contracts (archived_at)
  WHERE archived_at IS NOT NULL;

COMMENT ON COLUMN public.contracts.archived_at IS
  'Set when a (usually signed) contract is superseded by an amended one. Archived contracts keep status/signed_at intact and are excluded from live contract lookups.';
COMMENT ON COLUMN public.contracts.superseded_by_contract_id IS
  'The amended contract created from this archived one.';
COMMENT ON COLUMN public.contracts.pre_sign_content IS
  'Snapshot of the contract body taken at sign time, before client field / signature / date placeholders were substituted into custom_content. Source for cloning an amended draft.';

-- ---------------------------------------------------------------------------
-- Legacy leads keep their contract as HTML columns on the junction row rather
-- than as a row in contracts, so there is nothing there to flag. Archive them in
-- place; the amended contract is then created in public.contracts with legacy_id
-- set, which ContactInfoTab already fetches and renders for legacy leads.
-- ---------------------------------------------------------------------------
ALTER TABLE public.lead_leadcontact
  ADD COLUMN IF NOT EXISTS contract_archived_at TIMESTAMPTZ;

COMMENT ON COLUMN public.lead_leadcontact.contract_archived_at IS
  'Set when this legacy contract (contract_html / signed_contract_html) is archived in favour of an amended contract row in public.contracts.';
