-- Run if 2026-09-02_rmq_ai_v1.sql was already applied without these policies.
-- Lets logged-in users write firm-lesson candidates from chat.

DO $$ BEGIN
  CREATE POLICY ai_firm_lessons_read ON ai_firm_lesson_candidates FOR SELECT USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY ai_firm_lessons_insert ON ai_firm_lesson_candidates FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY ai_firm_lessons_update ON ai_firm_lesson_candidates FOR UPDATE USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
