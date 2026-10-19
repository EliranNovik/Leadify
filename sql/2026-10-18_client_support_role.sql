-- ============================================================================
-- 2026-10-18: Client Support role
--
-- One employee per lead, like the Retention Handler it sits beside in the Roles tab, so it is one
-- id column on each lead table rather than a join table.
--
-- `BIGINT` with no foreign key, matching retainer_handler_id (sql/add_retainer_handler_id.sql):
-- legacy rows hold employee ids that no longer all resolve, and a constraint added now would make
-- this migration fail on them rather than on anything to do with this role.
--
-- Safe to run more than once.
-- ============================================================================

ALTER TABLE leads
ADD COLUMN IF NOT EXISTS client_support_id BIGINT;

ALTER TABLE leads_lead
ADD COLUMN IF NOT EXISTS client_support_id BIGINT;

COMMENT ON COLUMN leads.client_support_id IS 'Employee ID for the client support role';
COMMENT ON COLUMN leads_lead.client_support_id IS 'Employee ID for the client support role';

-- Partial, because the question asked of this column is always "which leads does this person
-- support" — never "which leads have nobody", and the unassigned rows are the bulk of the table.
CREATE INDEX IF NOT EXISTS idx_leads_client_support_id
  ON leads (client_support_id)
  WHERE client_support_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_lead_client_support_id
  ON leads_lead (client_support_id)
  WHERE client_support_id IS NOT NULL;

-- ============================================================================
-- Note on history: history_leads / history_leads_lead and their trigger functions list every
-- column by name, so they keep working untouched but will not record this one. Extending them
-- means re-creating both trigger bodies, which is a separate change — replacing them from an old
-- snapshot would silently drop any column added to them since.
-- ============================================================================
