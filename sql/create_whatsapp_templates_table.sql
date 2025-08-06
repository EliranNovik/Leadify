-- Create whatsapp_templates table
CREATE TABLE IF NOT EXISTS whatsapp_templates (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    firm_id UUID,
    number_id UUID, -- FK to whatsapp_numbers (nullable for now)
    title VARCHAR(255) NOT NULL UNIQUE,
    name360 VARCHAR(255) NOT NULL,
    languages TEXT[],
    category VARCHAR(255),
    params VARCHAR(255),
    content TEXT,
    is_active BOOLEAN DEFAULT true NOT NULL,
    order_value INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id),
    updated_by UUID REFERENCES auth.users(id)
);

-- Add RLS policies
ALTER TABLE whatsapp_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view whatsapp_templates" ON whatsapp_templates FOR SELECT USING (true);
CREATE POLICY "Authenticated users can insert whatsapp_templates" ON whatsapp_templates FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can update whatsapp_templates" ON whatsapp_templates FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can delete whatsapp_templates" ON whatsapp_templates FOR DELETE USING (auth.uid() IS NOT NULL);

-- Indexes
CREATE INDEX idx_whatsapp_templates_title ON whatsapp_templates(title);
CREATE INDEX idx_whatsapp_templates_name360 ON whatsapp_templates(name360);
CREATE INDEX idx_whatsapp_templates_category ON whatsapp_templates(category);
CREATE INDEX idx_whatsapp_templates_is_active ON whatsapp_templates(is_active);
CREATE INDEX idx_whatsapp_templates_firm_id ON whatsapp_templates(firm_id);

-- Sample data from screenshots (content left blank, params as shown, languages as NULL for most)
INSERT INTO whatsapp_templates (title, name360, category, is_active) VALUES
('1case_closed_israel_germancitizenship', '1case_closed_israel_germancitizenship', NULL, TRUE),
('2case_closed_usclients_citizenship_recommendation', '2case_closed_usclients_citizenship_recommendation', NULL, TRUE),
('3application_submitted_with_payment', '3application_submitted_with_payment', NULL, TRUE),
('5application_submitted_no_payment', '5application_submitted_no_payment', NULL, TRUE),
('are_you_available_now', 'are_you_available_now', NULL, TRUE),
('Are you joining', 'are_you_joining', NULL, TRUE),
('ask_for_recommendation', 'ask_for_recommendation', NULL, TRUE),
('Attempt to call', 'attempt_to_call', NULL, TRUE),
('bulk_en', 'bulk_en', NULL, TRUE),
('bulk_HE', 'bulk', NULL, TRUE),
('bulk_usimmigr', 'bulk_usimmigr', NULL, TRUE),
('Can not help', 'cannothelp', NULL, TRUE),
('Cannot take cases', 'cannot_take_cases', NULL, TRUE),
('Children of German citizens', 'children_ofgerman_citizens', NULL, TRUE),
('docs_resend', 'docs_resend', NULL, TRUE),
('Email request', 'email_request', NULL, TRUE),
('Express check', 'express_check', 'other/Undefined', TRUE),
('followup_2', 'followup_2', NULL, TRUE),
('follow_up_en', 'follow_up_en', NULL, TRUE),
('IDF', 'idf', NULL, TRUE),
('Israeli pcc', 'israeli_pcc', 'Small without meetin/Doc. Acquisitions', TRUE),
('Meeting scheduling', 'meeting_scheduling', NULL, TRUE),
('More info request', 'more_info_request', NULL, TRUE),
('Not clear if eligible Austria', 'not_clear_if_eligible_austria', NULL, TRUE),
('Not clear if eligible Germany', 'not_clear_if_eligible_germany', NULL, TRUE),
('Not Clear if eligible Poland', 'not_clear_if_eligible_poland', 'Poland/Poland', TRUE),
('Not eligible Austria', 'not_eligible_austria', NULL, TRUE),
('Not eligible Germany', 'not_eligible_germany', NULL, TRUE),
('Not eligible Poland', 'not_eligible_poland', 'Poland/Poland', TRUE),
('Options to meet after talk', 'options_to_meet_after_talk', NULL, TRUE),
('Paid general', 'paid_general', NULL, TRUE),
('personal_follow_up', 'personal_follow_up', NULL, TRUE),
('please_reply_to_refresh', 'please_reply_to_refresh', NULL, TRUE),
('Portugal meeting scheduling', 'portugal_meeting_scheduling', NULL, FALSE),
('Portugal which countries', 'portugal_which_countries', NULL, TRUE),
('Reactivating past approach', 'reactivating_past_approach', 'other/Undefined', TRUE),
('recommendation', 'recommendation', NULL, TRUE),
('Referral Austria camps', 'referral_austria_camps', 'Austria/Labor Camps or DPC', TRUE),
('Referral Bulgaria', 'referral_bulgaria', 'Other Citizenships/Bulgaria', TRUE),
('Referral Canada', 'referral_canada', 'other/Canada', TRUE),
('Referral citiz investment', 'referral_citiz_investment', 'Other Citizenships/Other Citizenships', TRUE),
('Referral Damages Miryam', 'referral_damages_miryam', 'Damages/Traffic accidents', TRUE),
('Referral debt Nechama', 'referral_debt_nechama', 'other/Bankruptcy', TRUE),
('Referral Eric', 'referral_eric', NULL, TRUE),
('Referral France', 'referral_france', 'Poland/Poland', TRUE),
('Referral IP', 'referral_ip', 'other/Intellectual Propert', TRUE),
('Referral Labour Law', 'referral_labour_law', 'Commer/Civil/Adm/Fam/Labor law', TRUE),
('Referral Poland', 'referral_poland', 'Other Citizenships/France', TRUE),
('Referral Romania', 'referral_romania', 'Other Citizenships/Romania', TRUE),
('Referral Transportation Moti', 'referral_transportation_moti', 'other/Transportation law', TRUE),
('Referral UK', 'referral_uk', 'Other Citizenships/UK', TRUE),
('referral_US', 'referral_us', NULL, TRUE),
('Reminder meeting Germany Austria', 'reminder_meeting_au_de', NULL, TRUE),
('Reminder of a meeting', 'reminder_of_a_meeting', NULL, TRUE),
('Rescheduling', 'rescheduling', NULL, TRUE),
('Taken care of', 'taken_care_of', 'other/Undefined', FALSE),
('when_convenient_for_you_to_discuss', 'when_convenient_for_you_to_discuss', NULL, TRUE);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_whatsapp_templates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_whatsapp_templates_updated_at
    BEFORE UPDATE ON whatsapp_templates
    FOR EACH ROW
    EXECUTE FUNCTION update_whatsapp_templates_updated_at(); 