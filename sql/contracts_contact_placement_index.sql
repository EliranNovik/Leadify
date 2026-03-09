-- Optional: Improve contract placement consistency
-- 1. Index for fetching contracts by client (and contact) - helps ContactInfoTab contract load
-- 2. When creating a contract, set contact_id to the lead's main contact so the contract is always tied to the right contact in the DB.

-- Composite index for the common query: contracts for a client (and optional contact_id filter)
CREATE INDEX IF NOT EXISTS idx_contracts_client_id_contact_id
  ON public.contracts (client_id, contact_id);

-- Note: contact_id column and idx_contracts_contact_id already exist (see add_contact_id_to_contracts.sql).
-- Setting contact_id on insert (to the main contact id) ensures the contract appears for the correct contact when the UI or other consumers query by contact_id.
