-- Lets chat write pending firm-memory rows. Run once in the SQL editor.

DO $$ BEGIN
  CREATE POLICY ai_firm_memory_insert ON ai_firm_memory FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY ai_firm_memory_update ON ai_firm_memory FOR UPDATE USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
