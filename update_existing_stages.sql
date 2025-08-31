-- Update existing stage mappings safely
-- This script will update existing records and insert new ones without conflicts

-- First, let's see what's currently in the table
SELECT 'Current lead_stages table content:' as info;
SELECT id, name FROM public.lead_stages ORDER BY id;

-- Update/Insert stage mappings with conflict handling
INSERT INTO public.lead_stages (id, name) VALUES
-- Common stage IDs found in the application
('created', 'Created'),
('scheduler_assigned', 'Scheduler Assigned'),
('meeting_scheduled', 'Meeting Scheduled'),
('meeting_paid', 'Meeting Paid'),
('communication_started', 'Communication Started'),
('waiting_for_mtng_sum', 'Waiting for Meeting Summary'),
('Mtng sum+Agreement sent', 'Meeting Summary & Agreement Sent'),
('Client signed agreement', 'Client Signed Agreement'),
('payment_request_sent', 'Payment Request Sent'),
('finances_and_payments_plan', 'Finances & Payments Plan'),
('revised_offer', 'Revised Offer'),
('client_declined', 'Client Declined'),
('unactivated', 'Unactivated'),
('handler_assigned', 'Handler Assigned'),

-- Numeric stage IDs (like "110")
('110', 'Stage 110'),
('111', 'Stage 111'),
('112', 'Stage 112'),
('113', 'Stage 113'),
('114', 'Stage 114'),
('115', 'Stage 115'),

-- Add more stage mappings as needed
('stage_1', 'Initial Contact'),
('stage_2', 'Qualification'),
('stage_3', 'Proposal'),
('stage_4', 'Negotiation'),
('stage_5', 'Closed Won'),
('stage_6', 'Closed Lost')

ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name;

-- Enable RLS (Row Level Security) on the lead_stages table
ALTER TABLE public.lead_stages ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (to avoid conflicts)
DROP POLICY IF EXISTS "Allow authenticated users to read lead_stages" ON public.lead_stages;
DROP POLICY IF EXISTS "Allow authenticated users to insert lead_stages" ON public.lead_stages;
DROP POLICY IF EXISTS "Allow authenticated users to update lead_stages" ON public.lead_stages;
DROP POLICY IF EXISTS "Allow authenticated users to delete lead_stages" ON public.lead_stages;

-- Create policy to allow authenticated users to read stage data
CREATE POLICY "Allow authenticated users to read lead_stages" ON public.lead_stages
    FOR SELECT
    TO authenticated
    USING (true);

-- Create policy to allow authenticated users to insert stage data
CREATE POLICY "Allow authenticated users to insert lead_stages" ON public.lead_stages
    FOR INSERT
    TO authenticated
    WITH CHECK (true);

-- Create policy to allow authenticated users to update stage data
CREATE POLICY "Allow authenticated users to update lead_stages" ON public.lead_stages
    FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- Create policy to allow authenticated users to delete stage data
CREATE POLICY "Allow authenticated users to delete lead_stages" ON public.lead_stages
    FOR DELETE
    TO authenticated
    USING (true);

-- Grant necessary permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_stages TO authenticated;
GRANT USAGE ON SEQUENCE lead_stages_id_seq TO authenticated;

-- Show the final result
SELECT 'Updated lead_stages table content:' as info;
SELECT id, name FROM public.lead_stages ORDER BY id;
