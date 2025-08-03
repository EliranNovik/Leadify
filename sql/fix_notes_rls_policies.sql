-- Fix RLS policies for lead_notes table

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view notes for leads they have access to" ON lead_notes;
DROP POLICY IF EXISTS "Users can insert notes for leads they have access to" ON lead_notes;
DROP POLICY IF EXISTS "Users can update notes they created" ON lead_notes;
DROP POLICY IF EXISTS "Users can delete notes they created" ON lead_notes;

-- Create more permissive policies for authenticated users
CREATE POLICY "Authenticated users can view notes" ON lead_notes
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can insert notes" ON lead_notes
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Users can update notes they created" ON lead_notes
  FOR UPDATE USING (auth.uid() = created_by);

CREATE POLICY "Users can delete notes they created" ON lead_notes
  FOR DELETE USING (auth.uid() = created_by);

-- Alternative: If you want to keep the lead-based access control, use this version instead:
-- CREATE POLICY "Users can view notes for leads they have access to" ON lead_notes
--   FOR SELECT USING (
--     auth.role() = 'authenticated' AND (
--       EXISTS (
--         SELECT 1 FROM leads 
--         WHERE leads.id = lead_notes.lead_id 
--         AND (
--           leads.handler = auth.jwt() ->> 'email' 
--           OR leads.manager = auth.jwt() ->> 'email'
--           OR leads.handler IS NULL
--           OR leads.manager IS NULL
--         )
--       )
--     )
--   );

-- CREATE POLICY "Users can insert notes for leads they have access to" ON lead_notes
--   FOR INSERT WITH CHECK (
--     auth.role() = 'authenticated' AND (
--       EXISTS (
--         SELECT 1 FROM leads 
--         WHERE leads.id = lead_notes.lead_id 
--         AND (
--           leads.handler = auth.jwt() ->> 'email' 
--           OR leads.manager = auth.jwt() ->> 'email'
--           OR leads.handler IS NULL
--           OR leads.manager IS NULL
--         )
--       )
--     )
--   ); 