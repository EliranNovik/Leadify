-- ============================================================================
-- active_handler_type: three-way ownership race
--
-- 1 = Retention handler is active on the case
-- 2 = Case handler is active (default)
-- 3 = Client support is active
--
-- Only one of the three may be active at a time. The ClientHeader role switcher and
-- Handler / Retention / Client Support pipelines all read this column.
-- ============================================================================

COMMENT ON COLUMN leads.active_handler_type IS
  'Active owner of the case: 1=retention handler, 2=case handler, 3=client support';

COMMENT ON COLUMN leads_lead.active_handler_type IS
  'Active owner of the case: 1=retention handler, 2=case handler, 3=client support';
