-- Comprehensive stage mappings for lead_stages table
-- This includes all possible stage IDs that might be used in the system

-- First, clear existing data (optional - remove if you want to keep existing data)
-- DELETE FROM public.lead_stages;

-- Insert comprehensive stage mappings
INSERT INTO public.lead_stages (id, name) VALUES
-- Standard CRM stages
('created', 'Created'),
('new', 'New Lead'),
('qualified', 'Qualified'),
('proposal', 'Proposal'),
('negotiation', 'Negotiation'),
('closed_won', 'Closed Won'),
('closed_lost', 'Closed Lost'),

-- Application-specific stages
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

-- Numeric stage IDs (common in legacy systems)
('100', 'Stage 100'),
('101', 'Stage 101'),
('102', 'Stage 102'),
('103', 'Stage 103'),
('104', 'Stage 104'),
('105', 'Stage 105'),
('106', 'Stage 106'),
('107', 'Stage 107'),
('108', 'Stage 108'),
('109', 'Stage 109'),
('110', 'Stage 110'),
('111', 'Stage 111'),
('112', 'Stage 112'),
('113', 'Stage 113'),
('114', 'Stage 114'),
('115', 'Stage 115'),
('116', 'Stage 116'),
('117', 'Stage 117'),
('118', 'Stage 118'),
('119', 'Stage 119'),
('120', 'Stage 120'),

-- German citizenship specific stages
('german_citizenship_initial', 'German Citizenship - Initial'),
('german_citizenship_documents', 'German Citizenship - Documents'),
('german_citizenship_submitted', 'German Citizenship - Submitted'),
('german_citizenship_approved', 'German Citizenship - Approved'),
('german_citizenship_rejected', 'German Citizenship - Rejected'),

-- Austrian citizenship specific stages
('austrian_citizenship_initial', 'Austrian Citizenship - Initial'),
('austrian_citizenship_documents', 'Austrian Citizenship - Documents'),
('austrian_citizenship_submitted', 'Austrian Citizenship - Submitted'),
('austrian_citizenship_approved', 'Austrian Citizenship - Approved'),
('austrian_citizenship_rejected', 'Austrian Citizenship - Rejected'),

-- Payment stages
('payment_pending', 'Payment Pending'),
('payment_received', 'Payment Received'),
('payment_overdue', 'Payment Overdue'),
('payment_cancelled', 'Payment Cancelled'),

-- Document stages
('documents_requested', 'Documents Requested'),
('documents_received', 'Documents Received'),
('documents_reviewed', 'Documents Reviewed'),
('documents_approved', 'Documents Approved'),
('documents_rejected', 'Documents Rejected'),

-- Follow-up stages
('follow_up_scheduled', 'Follow-up Scheduled'),
('follow_up_completed', 'Follow-up Completed'),
('follow_up_overdue', 'Follow-up Overdue'),

-- Status stages
('active', 'Active'),
('inactive', 'Inactive'),
('pending', 'Pending'),
('completed', 'Completed'),
('cancelled', 'Cancelled'),
('on_hold', 'On Hold'),

-- Legacy system stages (if any)
('legacy_stage_1', 'Legacy Stage 1'),
('legacy_stage_2', 'Legacy Stage 2'),
('legacy_stage_3', 'Legacy Stage 3'),

-- Custom stages (add more as needed)
('custom_stage_1', 'Custom Stage 1'),
('custom_stage_2', 'Custom Stage 2'),
('custom_stage_3', 'Custom Stage 3')

ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name;

-- Enable RLS if not already enabled
ALTER TABLE public.lead_stages ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (to avoid conflicts)
DROP POLICY IF EXISTS "Allow authenticated users to read lead_stages" ON public.lead_stages;
DROP POLICY IF EXISTS "Allow authenticated users to insert lead_stages" ON public.lead_stages;
DROP POLICY IF EXISTS "Allow authenticated users to update lead_stages" ON public.lead_stages;
DROP POLICY IF EXISTS "Allow authenticated users to delete lead_stages" ON public.lead_stages;

-- Create comprehensive policies
CREATE POLICY "Allow authenticated users to read lead_stages" ON public.lead_stages
    FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Allow authenticated users to insert lead_stages" ON public.lead_stages
    FOR INSERT
    TO authenticated
    WITH CHECK (true);

CREATE POLICY "Allow authenticated users to update lead_stages" ON public.lead_stages
    FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Allow authenticated users to delete lead_stages" ON public.lead_stages
    FOR DELETE
    TO authenticated
    USING (true);

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_stages TO authenticated;
GRANT USAGE ON SEQUENCE lead_stages_id_seq TO authenticated;

-- Verify the data was inserted
SELECT COUNT(*) as total_stages FROM public.lead_stages;
SELECT id, name FROM public.lead_stages ORDER BY id LIMIT 10;
