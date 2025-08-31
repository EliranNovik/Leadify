-- SQL to add legacy_lead_id column to meetings table
ALTER TABLE meetings ADD COLUMN legacy_lead_id INTEGER;
ALTER TABLE meetings ADD CONSTRAINT fk_meetings_legacy_lead FOREIGN KEY (legacy_lead_id) REFERENCES leads_lead(id);
-- Add index for performance
CREATE INDEX idx_meetings_legacy_lead_id ON meetings(legacy_lead_id);
