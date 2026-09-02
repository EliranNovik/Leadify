-- Lets the control page update or delete knowledge files. Run once.

DO $$ BEGIN
  CREATE POLICY ai_knowledge_files_update ON ai_knowledge_files
    FOR UPDATE USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY ai_knowledge_files_delete ON ai_knowledge_files
    FOR DELETE USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
