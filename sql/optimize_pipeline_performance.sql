-- Optimize Pipeline Performance with Indexes
-- This script adds indexes to improve query performance for the pipeline page

-- Indexes for the 'leads' table (new leads)
CREATE INDEX IF NOT EXISTS idx_leads_closer ON public.leads(closer);
CREATE INDEX IF NOT EXISTS idx_leads_scheduler ON public.leads(scheduler);
CREATE INDEX IF NOT EXISTS idx_leads_expert ON public.leads(expert);
CREATE INDEX IF NOT EXISTS idx_leads_manager ON public.leads(manager);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON public.leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_stage ON public.leads(stage);
CREATE INDEX IF NOT EXISTS idx_leads_balance_currency ON public.leads(balance_currency);

-- Indexes for the 'leads_lead' table (legacy leads)
CREATE INDEX IF NOT EXISTS idx_leads_lead_closer_id ON public.leads_lead(closer_id);
CREATE INDEX IF NOT EXISTS idx_leads_lead_meeting_scheduler_id ON public.leads_lead(meeting_scheduler_id);
CREATE INDEX IF NOT EXISTS idx_leads_lead_cdate ON public.leads_lead(cdate DESC);
CREATE INDEX IF NOT EXISTS idx_leads_lead_stage ON public.leads_lead(stage);
CREATE INDEX IF NOT EXISTS idx_leads_lead_currency_id ON public.leads_lead(currency_id);

-- Composite indexes for better performance on filtered queries
CREATE INDEX IF NOT EXISTS idx_leads_closer_created_at ON public.leads(closer, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_scheduler_created_at ON public.leads(scheduler, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_lead_closer_id_cdate ON public.leads_lead(closer_id, cdate DESC);
CREATE INDEX IF NOT EXISTS idx_leads_lead_scheduler_id_cdate ON public.leads_lead(meeting_scheduler_id, cdate DESC);

-- Index for accounting_currencies (should already exist but adding for completeness)
CREATE INDEX IF NOT EXISTS idx_accounting_currencies_id ON public.accounting_currencies(id);

-- Verify indexes were created
SELECT 
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes 
WHERE tablename IN ('leads', 'leads_lead', 'accounting_currencies')
ORDER BY tablename, indexname;
