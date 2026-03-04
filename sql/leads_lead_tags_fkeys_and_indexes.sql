-- =============================================================================
-- leads_lead_tags: foreign keys and indexes for join performance
-- =============================================================================
-- Your schema already defines these FKs; this script adds them only if missing
-- and adds indexes on FK columns so joins (e.g. tags on leads/leads_lead) are fast.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Foreign keys (skip if constraint already exists)
-- -----------------------------------------------------------------------------

-- lead_id -> leads_lead(id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'leads_lead_tags_lead_id_873b102c_fk_leads_lead_id'
      AND conrelid = 'public.leads_lead_tags'::regclass
  ) THEN
    ALTER TABLE public.leads_lead_tags
      ADD CONSTRAINT leads_lead_tags_lead_id_873b102c_fk_leads_lead_id
      FOREIGN KEY (lead_id) REFERENCES public.leads_lead(id) ON DELETE CASCADE;
  END IF;
END $$;

-- leadtag_id -> misc_leadtag(id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'leads_lead_tags_leadtag_id_4ba4e673_fk_misc_leadtag_id'
      AND conrelid = 'public.leads_lead_tags'::regclass
  ) THEN
    ALTER TABLE public.leads_lead_tags
      ADD CONSTRAINT leads_lead_tags_leadtag_id_4ba4e673_fk_misc_leadtag_id
      FOREIGN KEY (leadtag_id) REFERENCES public.misc_leadtag(id)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

-- newlead_id -> leads(id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'leads_lead_tags_newlead_id_fkey'
      AND conrelid = 'public.leads_lead_tags'::regclass
  ) THEN
    ALTER TABLE public.leads_lead_tags
      ADD CONSTRAINT leads_lead_tags_newlead_id_fkey
      FOREIGN KEY (newlead_id) REFERENCES public.leads(id) ON DELETE CASCADE;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2. Indexes on FK columns (for fast joins / lookups)
-- -----------------------------------------------------------------------------

-- Joins: leads_lead_tags.lead_id = leads_lead.id (legacy tags by lead)
CREATE INDEX IF NOT EXISTS idx_leads_lead_tags_lead_id
  ON public.leads_lead_tags (lead_id)
  WHERE lead_id IS NOT NULL;

-- Joins: leads_lead_tags.newlead_id = leads.id (new lead tags by lead)
CREATE INDEX IF NOT EXISTS idx_leads_lead_tags_newlead_id
  ON public.leads_lead_tags (newlead_id)
  WHERE newlead_id IS NOT NULL;

-- Joins: leads_lead_tags.leadtag_id = misc_leadtag.id (tag name lookup)
CREATE INDEX IF NOT EXISTS idx_leads_lead_tags_leadtag_id
  ON public.leads_lead_tags (leadtag_id)
  WHERE leadtag_id IS NOT NULL;

-- Optional: composite for “all tags for a legacy lead” (lead_id already indexed above)
-- CREATE INDEX IF NOT EXISTS idx_leads_lead_tags_lead_id_leadtag_id
--   ON public.leads_lead_tags (lead_id, leadtag_id);

-- Optional: composite for “all tags for a new lead”
-- CREATE INDEX IF NOT EXISTS idx_leads_lead_tags_newlead_id_leadtag_id
--   ON public.leads_lead_tags (newlead_id, leadtag_id);

ANALYZE public.leads_lead_tags;
