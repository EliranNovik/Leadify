-- Version history for revised price offers (Offer 1 / Offer 2 tabs).
-- Safe to re-run.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS proposal_versions jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.leads_lead
  ADD COLUMN IF NOT EXISTS proposal_versions jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.leads.proposal_versions IS
  'JSON array of sent/saved price offer versions: [{id, body, senderName, sentAt, total, currency}]';
COMMENT ON COLUMN public.leads_lead.proposal_versions IS
  'JSON array of sent/saved price offer versions: [{id, body, senderName, sentAt, total, currency}]';
