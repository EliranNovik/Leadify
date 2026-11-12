-- Cursor and dedupe store for the fb-leads-import edge function.
-- Run this in the Supabase SQL editor before deploying the function.
-- Service role (the edge function) bypasses RLS. No policies are added, so the anon key cannot read these tables.

CREATE TABLE IF NOT EXISTS fb_lead_import_state (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  -- Exact next_since string returned by the export. NULL means the next pull omits since.
  cursor_since text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO fb_lead_import_state (id, cursor_since)
VALUES (1, NULL)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS fb_imported_leadgen (
  leadgen_id text PRIMARY KEY,
  lead_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE fb_lead_import_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE fb_imported_leadgen ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE fb_lead_import_state TO service_role;
GRANT ALL ON TABLE fb_imported_leadgen TO service_role;
REVOKE ALL ON TABLE fb_lead_import_state FROM anon, authenticated;
REVOKE ALL ON TABLE fb_imported_leadgen FROM anon, authenticated;

COMMENT ON TABLE fb_lead_import_state IS 'Pull cursor for Facebook lead export (fb-leads-import).';
COMMENT ON TABLE fb_imported_leadgen IS 'leadgen_id values already saved, so a repeated export page does not create a second lead.';
