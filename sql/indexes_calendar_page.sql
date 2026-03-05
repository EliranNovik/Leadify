-- =============================================================================
-- Indexes for CalendarPage.tsx – speed up calendar and related queries
-- =============================================================================
-- Run in Supabase SQL Editor. Safe to run multiple times (IF NOT EXISTS).
-- Covers: main calendar meetings list, past-stages lookup, legacy meetings by date,
-- assign-staff modal, staff meetings, employees/categories (shared with other index files).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. MEETINGS – main calendar list and assign-staff modal
-- -----------------------------------------------------------------------------
-- Main query: .or('status.is.null', 'status.neq.canceled'), .gte/.lte meeting_date, .order('meeting_date', { ascending: false })
-- Partial index so only non-canceled meetings are indexed; supports date range + ORDER BY meeting_date DESC
CREATE INDEX IF NOT EXISTS idx_meetings_calendar_active_date
  ON public.meetings (meeting_date DESC)
  WHERE (status IS NULL OR status <> 'canceled');

-- Assign-staff modal: .order('meeting_date').order('meeting_time'), same status filter
CREATE INDEX IF NOT EXISTS idx_meetings_date_time_asc
  ON public.meetings (meeting_date ASC, meeting_time ASC)
  WHERE (status IS NULL OR status <> 'canceled');

-- -----------------------------------------------------------------------------
-- 2. LEADS_LEADSTAGE – past-stages lookup (used to show “past” badges)
-- -----------------------------------------------------------------------------
-- Queries: .in('stage', [35, 40]).not('lead_id', 'is', null) and .not('newlead_id', 'is', null)
CREATE INDEX IF NOT EXISTS idx_leads_leadstage_stage_lead_id
  ON public.leads_leadstage (stage)
  WHERE lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_leadstage_stage_newlead_id
  ON public.leads_leadstage (stage)
  WHERE newlead_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 3. LEADS_LEAD – legacy meetings by date range
-- -----------------------------------------------------------------------------
-- fetchLegacyMeetingsForDateRange: .gte('meeting_date', from).lte('meeting_date', to).not('meeting_date', null).order('meeting_date')
-- Assign-staff direct legacy: same date range + .or('status.eq.0', 'status.is.null').neq('stage', 91)
CREATE INDEX IF NOT EXISTS idx_leads_lead_meeting_date
  ON public.leads_lead (meeting_date)
  WHERE meeting_date IS NOT NULL;

-- Optional: composite for “active” legacy leads by meeting date (assign-staff and similar)
CREATE INDEX IF NOT EXISTS idx_leads_lead_meeting_date_active
  ON public.leads_lead (meeting_date)
  WHERE meeting_date IS NOT NULL
    AND (status IS NULL OR status = 0)
    AND (stage IS NULL OR stage <> 91);

-- -----------------------------------------------------------------------------
-- 4. OUTLOOK_TEAMS_MEETINGS – staff meetings
-- -----------------------------------------------------------------------------
-- .order('start_date_time')
CREATE INDEX IF NOT EXISTS idx_outlook_teams_meetings_start_date_time
  ON public.outlook_teams_meetings (start_date_time);

-- -----------------------------------------------------------------------------
-- 5. LEADS – calendar join filter (optional)
-- -----------------------------------------------------------------------------
-- Joins are by leads.id (PK). This partial index can help when filtering by unactivated_at and stage in the same query.
CREATE INDEX IF NOT EXISTS idx_leads_unactivated_stage
  ON public.leads (unactivated_at, stage)
  WHERE unactivated_at IS NULL;

-- =============================================================================
-- Optional: verify indexes
-- =============================================================================
-- SELECT schemaname, tablename, indexname
-- FROM pg_indexes
-- WHERE tablename IN ('meetings', 'leads_leadstage', 'leads_lead', 'outlook_teams_meetings', 'leads')
--   AND indexname LIKE 'idx_%'
-- ORDER BY tablename, indexname;
