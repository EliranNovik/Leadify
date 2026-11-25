-- Lets the RMQ AI control page replace the text of a knowledge file.
-- Run in the Supabase SQL editor. Safe to run more than once.

DROP POLICY IF EXISTS ai_knowledge_chunks_update ON public.ai_knowledge_chunks;
CREATE POLICY ai_knowledge_chunks_update
ON public.ai_knowledge_chunks
FOR UPDATE
TO authenticated
USING (auth.uid() IS NOT NULL)
WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS ai_knowledge_chunks_delete ON public.ai_knowledge_chunks;
CREATE POLICY ai_knowledge_chunks_delete
ON public.ai_knowledge_chunks
FOR DELETE
TO authenticated
USING (auth.uid() IS NOT NULL);
