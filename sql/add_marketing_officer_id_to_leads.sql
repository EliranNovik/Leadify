-- Marketing Officer role on leads (Roles tab). Run in Supabase SQL editor if missing.
-- Collection manager uses existing meeting_collection_id; this adds marketing_officer_id only.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS marketing_officer_id BIGINT REFERENCES tenants_employee (id);

ALTER TABLE leads_lead
  ADD COLUMN IF NOT EXISTS marketing_officer_id BIGINT REFERENCES tenants_employee (id);

COMMENT ON COLUMN leads.marketing_officer_id IS 'Assigned marketing officer (tenants_employee.id)';
COMMENT ON COLUMN leads_lead.marketing_officer_id IS 'Assigned marketing officer (tenants_employee.id)';
