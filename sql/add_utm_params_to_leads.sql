-- Add utm_params column to leads table for storing Google Ads / landing page query params as JSONB.
-- Written by: backend webhook catchFormData (POST /hook/catch). Run this migration before using UTM capture.
-- Params: lpurl, targetid, matchtype, device, campaignid, adgroupid, keyword, target, subid (and any others sent).
-- If no params are sent, column remains NULL. Lead creation (create_lead_with_source_validation + trigger) is unchanged.

ALTER TABLE leads
ADD COLUMN IF NOT EXISTS utm_params jsonb DEFAULT NULL;

COMMENT ON COLUMN leads.utm_params IS 'Google Ads / landing page query parameters (e.g. lpurl, targetid, matchtype, device, campaignid, adgroupid, keyword, target, subid) stored as JSON. NULL when not provided.';
