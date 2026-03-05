-- =============================================================================
-- Tags: Foreign keys and indexes for leads_lead_tags + misc_leadtag
-- =============================================================================
-- Use for: LeadsReportPage (export/filter by tags), InfoTab, PipelinePage,
-- EditLeadDrawer, CloserSuperPipelinePage – fast lookups and joins.
-- Run in Supabase SQL Editor. Safe to run multiple times (IF NOT EXISTS).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. FOREIGN KEYS on leads_lead_tags
-- -----------------------------------------------------------------------------
-- Add only if no FK exists from this column to the target table (any constraint name).

-- lead_id -> leads_lead(id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
    WHERE tc.table_schema = 'public' AND tc.table_name = 'leads_lead_tags'
      AND tc.constraint_type = 'FOREIGN KEY'
      AND ccu.table_name = 'leads_lead' AND ccu.column_name = 'id'
  ) THEN
    ALTER TABLE public.leads_lead_tags
      ADD CONSTRAINT fk_leads_lead_tags_lead_id
      FOREIGN KEY (lead_id) REFERENCES public.leads_lead(id) ON DELETE CASCADE;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- newlead_id -> leads(id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
    WHERE tc.table_schema = 'public' AND tc.table_name = 'leads_lead_tags'
      AND tc.constraint_type = 'FOREIGN KEY'
      AND ccu.table_name = 'leads' AND ccu.column_name = 'id'
  ) THEN
    ALTER TABLE public.leads_lead_tags
      ADD CONSTRAINT fk_leads_lead_tags_newlead_id
      FOREIGN KEY (newlead_id) REFERENCES public.leads(id) ON DELETE CASCADE;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- leadtag_id -> misc_leadtag(id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
    WHERE tc.table_schema = 'public' AND tc.table_name = 'leads_lead_tags'
      AND tc.constraint_type = 'FOREIGN KEY'
      AND ccu.table_name = 'misc_leadtag' AND ccu.column_name = 'id'
  ) THEN
    ALTER TABLE public.leads_lead_tags
      ADD CONSTRAINT fk_leads_lead_tags_leadtag_id
      FOREIGN KEY (leadtag_id) REFERENCES public.misc_leadtag(id) ON DELETE CASCADE;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- -----------------------------------------------------------------------------
-- 2. INDEXES on leads_lead_tags (for joins and filter-by-tag queries)
-- -----------------------------------------------------------------------------

-- Lookup by legacy lead: “all tags for this leads_lead row”
CREATE INDEX IF NOT EXISTS idx_leads_lead_tags_lead_id
  ON public.leads_lead_tags (lead_id)
  WHERE lead_id IS NOT NULL;

-- Lookup by new lead: “all tags for this leads row”
CREATE INDEX IF NOT EXISTS idx_leads_lead_tags_newlead_id
  ON public.leads_lead_tags (newlead_id)
  WHERE newlead_id IS NOT NULL;

-- Lookup by tag: “all leads (legacy or new) with this tag” (filter by leadtag_id)
CREATE INDEX IF NOT EXISTS idx_leads_lead_tags_leadtag_id
  ON public.leads_lead_tags (leadtag_id)
  WHERE leadtag_id IS NOT NULL;

-- Composite: filter new leads by tag (LeadsReportPage: .in('leadtag_id', tagIds) then get newlead_id)
CREATE INDEX IF NOT EXISTS idx_leads_lead_tags_leadtag_newlead
  ON public.leads_lead_tags (leadtag_id, newlead_id)
  WHERE leadtag_id IS NOT NULL AND newlead_id IS NOT NULL;

-- Composite: filter legacy leads by tag (LeadsReportPage: .in('leadtag_id', tagIds) then get lead_id)
CREATE INDEX IF NOT EXISTS idx_leads_lead_tags_leadtag_lead
  ON public.leads_lead_tags (leadtag_id, lead_id)
  WHERE leadtag_id IS NOT NULL AND lead_id IS NOT NULL;

-- Cover “tags for these lead ids” (e.g. .in('newlead_id', ids) / .in('lead_id', ids))
CREATE INDEX IF NOT EXISTS idx_leads_lead_tags_newlead_id_leadtag
  ON public.leads_lead_tags (newlead_id, leadtag_id)
  WHERE newlead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_lead_tags_lead_id_leadtag
  ON public.leads_lead_tags (lead_id, leadtag_id)
  WHERE lead_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 3. INDEXES on misc_leadtag (for dropdowns and tag name lookups)
-- -----------------------------------------------------------------------------

-- Active tags for dropdown: .eq('active', true).order('order').order('name')
CREATE INDEX IF NOT EXISTS idx_misc_leadtag_active
  ON public.misc_leadtag (active)
  WHERE active = true;

CREATE INDEX IF NOT EXISTS idx_misc_leadtag_order_name
  ON public.misc_leadtag ("order", name)
  WHERE active = true;

-- Lookup by name: .eq('name', tagName).single()
CREATE INDEX IF NOT EXISTS idx_misc_leadtag_name
  ON public.misc_leadtag (name)
  WHERE name IS NOT NULL AND name <> '';

-- Optional: firm_id if you filter by firm
CREATE INDEX IF NOT EXISTS idx_misc_leadtag_firm_id
  ON public.misc_leadtag (firm_id)
  WHERE firm_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 4. ANALYZE (update stats for planner)
-- -----------------------------------------------------------------------------
ANALYZE public.leads_lead_tags;
ANALYZE public.misc_leadtag;
