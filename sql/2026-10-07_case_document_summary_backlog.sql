-- Clears the backlog of case documents stuck on ai_summary_status = 'pending'.
--
-- The summarize edge function marks a row 'pending' before it downloads and base64-encodes the file.
-- When the worker is then killed by Supabase (HTTP 546 WORKER_RESOURCE_LIMIT, which happens on large
-- files) the catch block never runs, so the row keeps that 'pending' and the documents tray shows
-- "Summarizing…" for it forever, polling every few seconds.
--
-- The function now refuses oversized files up front, but rows that were already stranded need
-- clearing by hand. Run the SELECTs first to see what the UPDATEs will touch.

-- 1. What is stuck, and how big is it?
select
  count(*) filter (where file_size > 5 * 1024 * 1024)                      as oversized,
  count(*) filter (where file_size <= 5 * 1024 * 1024 or file_size is null) as other,
  min(created_at)                                                          as oldest,
  pg_size_pretty(max(file_size))                                           as largest
from public.lead_case_documents
where ai_summary_status = 'pending';

-- 2. Oversized rows can never succeed, so give them the same answer the function now gives.
--    5 MB is the ceiling the function enforces: every band below it summarises, and nothing at or
--    above it ever has (largest success 4.94 MB).
update public.lead_case_documents
set
  ai_summary = null,
  ai_summary_status = 'skipped',
  ai_summary_error =
    'This file is too large for an automatic AI summary ('
    || round((file_size / 1048576.0)::numeric, 1)::text || ' MB; limit 5.0 MB).',
  ai_summary_at = now()
where ai_summary_status = 'pending'
  and file_size > 5 * 1024 * 1024;

-- 3. The rest were left pending by an attempt that never reported back — a killed worker, or an
--    invocation that never arrived, since every caller fires it off without awaiting the result.
--    Marking them failed is what puts the "generate again" button in front of someone, instead of a
--    spinner. Only rows older than a day are touched, so anything genuinely in flight is left alone.
update public.lead_case_documents
set
  ai_summary_status = 'failed',
  ai_summary_error = 'The summary did not finish. You can try generating it again.',
  ai_summary_at = now()
where ai_summary_status = 'pending'
  and created_at < now() - interval '1 day';

-- 4. Confirm nothing stale is left.
select ai_summary_status, count(*)
from public.lead_case_documents
group by ai_summary_status
order by count(*) desc;
