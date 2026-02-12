-- ============================================================================
-- CREATE HISTORY TRIGGERS AND FUNCTIONS
-- This script creates triggers that automatically save full row snapshots
-- to history tables whenever changes occur in the original tables.
--
-- The triggers will:
-- 1. Capture the full row data (all columns)
-- 2. Get the employee ID from the current session context
-- 3. Insert into the appropriate history table with change_type
-- ============================================================================

-- ============================================================================
-- HELPER FUNCTION: Get current employee ID from auth session
-- ============================================================================
-- This function:
-- 1. Gets the current authenticated user ID (auth.uid()) - this is auth.users.id
-- 2. Looks up the user in the users table WHERE auth_id = auth.uid() to get employee_id
-- 3. Returns the employee_id (which matches tenants_employee.id)
CREATE OR REPLACE FUNCTION get_current_employee_id()
RETURNS BIGINT AS $$
DECLARE
    auth_user_id UUID;
    emp_id BIGINT;
BEGIN
    -- Try to get the current authenticated user ID from Supabase auth
    -- Method 1: Try auth.uid() first (standard Supabase function)
    BEGIN
        auth_user_id := auth.uid();
    EXCEPTION
        WHEN OTHERS THEN
            auth_user_id := NULL;
    END;
    
    -- Method 2: If auth.uid() didn't work, try getting from JWT claim
    IF auth_user_id IS NULL THEN
        BEGIN
            auth_user_id := current_setting('request.jwt.claim.sub', TRUE)::UUID;
        EXCEPTION
            WHEN OTHERS THEN
                auth_user_id := NULL;
        END;
    END IF;
    
    -- If still no authenticated user, return NULL
    IF auth_user_id IS NULL THEN
        RETURN NULL;
    END IF;
    
    -- Look up the employee_id from the users table
    -- The users table has auth_id column that matches auth.users.id
    SELECT employee_id INTO emp_id
    FROM users
    WHERE auth_id = auth_user_id;
    
    -- Return the employee_id (will be NULL if user not found or employee_id is NULL)
    RETURN emp_id;
EXCEPTION
    WHEN OTHERS THEN
        -- If any error occurs (e.g., users table doesn't exist, column doesn't exist), return NULL
        -- This ensures history is still saved even if employee lookup fails
        RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- FUNCTION: Track history for payment_plans
-- ============================================================================
CREATE OR REPLACE FUNCTION track_payment_plans_history()
RETURNS TRIGGER AS $$
DECLARE
    change_type_val TEXT;
    emp_id BIGINT;
BEGIN
    -- Determine change type
    IF TG_OP = 'DELETE' THEN
        change_type_val := 'delete';
    ELSIF TG_OP = 'INSERT' THEN
        change_type_val := 'insert';
    ELSIF TG_OP = 'UPDATE' THEN
        change_type_val := 'update';
    END IF;
    
    -- Get current employee ID
    emp_id := get_current_employee_id();
    
    -- Insert into history table
    IF TG_OP = 'DELETE' THEN
        INSERT INTO history_payment_plans (
            original_id, changed_by, changed_at, change_type,
            id, lead_ids, due_percent, due_date, value, value_vat,
            client_name, payment_order, proforma, notes, cdate, udate,
            paid, paid_at, paid_by, contract_id, percent, currency_id,
            updated_by, created_by, creator_id, firm_id, due_by_id, "order",
            cancel_date, client_id, value_base, vat_value_base, date,
            currency, lead_id, legacy_id, updated_at, ready_to_pay, ready_to_pay_by
        ) VALUES (
            OLD.id, emp_id, NOW(), change_type_val,
            OLD.id, OLD.lead_ids, OLD.due_percent, OLD.due_date, OLD.value, OLD.value_vat,
            OLD.client_name, OLD.payment_order, OLD.proforma, OLD.notes, OLD.cdate, OLD.udate,
            OLD.paid, OLD.paid_at, OLD.paid_by, OLD.contract_id, OLD.percent, OLD.currency_id,
            OLD.updated_by, OLD.created_by, OLD.creator_id, OLD.firm_id, OLD.due_by_id, OLD."order",
            OLD.cancel_date, OLD.client_id, OLD.value_base, OLD.vat_value_base, OLD.date,
            OLD.currency, OLD.lead_id, OLD.legacy_id, OLD.updated_at, OLD.ready_to_pay, OLD.ready_to_pay_by
        );
        RETURN OLD;
    ELSE
        INSERT INTO history_payment_plans (
            original_id, changed_by, changed_at, change_type,
            id, lead_ids, due_percent, due_date, value, value_vat,
            client_name, payment_order, proforma, notes, cdate, udate,
            paid, paid_at, paid_by, contract_id, percent, currency_id,
            updated_by, created_by, creator_id, firm_id, due_by_id, "order",
            cancel_date, client_id, value_base, vat_value_base, date,
            currency, lead_id, legacy_id, updated_at, ready_to_pay, ready_to_pay_by
        ) VALUES (
            NEW.id, emp_id, NOW(), change_type_val,
            NEW.id, NEW.lead_ids, NEW.due_percent, NEW.due_date, NEW.value, NEW.value_vat,
            NEW.client_name, NEW.payment_order, NEW.proforma, NEW.notes, NEW.cdate, NEW.udate,
            NEW.paid, NEW.paid_at, NEW.paid_by, NEW.contract_id, NEW.percent, NEW.currency_id,
            NEW.updated_by, NEW.created_by, NEW.creator_id, NEW.firm_id, NEW.due_by_id, NEW."order",
            NEW.cancel_date, NEW.client_id, NEW.value_base, NEW.vat_value_base, NEW.date,
            NEW.currency, NEW.lead_id, NEW.legacy_id, NEW.updated_at, NEW.ready_to_pay, NEW.ready_to_pay_by
        );
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION: Track history for finances_paymentplanrow
-- ============================================================================
CREATE OR REPLACE FUNCTION track_finances_paymentplanrow_history()
RETURNS TRIGGER AS $$
DECLARE
    change_type_val TEXT;
    emp_id BIGINT;
BEGIN
    -- Determine change type
    IF TG_OP = 'DELETE' THEN
        change_type_val := 'delete';
    ELSIF TG_OP = 'INSERT' THEN
        change_type_val := 'insert';
    ELSIF TG_OP = 'UPDATE' THEN
        change_type_val := 'update';
    END IF;
    
    -- Get current employee ID
    emp_id := get_current_employee_id();
    
    -- Insert into history table
    IF TG_OP = 'DELETE' THEN
        INSERT INTO history_finances_paymentplanrow (
            original_id, changed_by, changed_at, change_type,
            id, cdate, udate, date, actual_date, value, creator_id, firm_id,
            lead_id, notes, value_base, due_by_id, due_date, "order",
            vat_value, vat_value_base, cancel_date, client_id, uid, currency_id,
            due_percent, ready_to_pay, ready_to_pay_by
        ) VALUES (
            OLD.id, emp_id, NOW(), change_type_val,
            OLD.id, OLD.cdate, OLD.udate, OLD.date, OLD.actual_date, OLD.value, OLD.creator_id, OLD.firm_id,
            OLD.lead_id, OLD.notes, OLD.value_base, OLD.due_by_id, OLD.due_date, OLD."order",
            OLD.vat_value, OLD.vat_value_base, OLD.cancel_date, OLD.client_id, OLD.uid, OLD.currency_id,
            OLD.due_percent, OLD.ready_to_pay, OLD.ready_to_pay_by
        );
        RETURN OLD;
    ELSE
        INSERT INTO history_finances_paymentplanrow (
            original_id, changed_by, changed_at, change_type,
            id, cdate, udate, date, actual_date, value, creator_id, firm_id,
            lead_id, notes, value_base, due_by_id, due_date, "order",
            vat_value, vat_value_base, cancel_date, client_id, uid, currency_id,
            due_percent, ready_to_pay, ready_to_pay_by
        ) VALUES (
            NEW.id, emp_id, NOW(), change_type_val,
            NEW.id, NEW.cdate, NEW.udate, NEW.date, NEW.actual_date, NEW.value, NEW.creator_id, NEW.firm_id,
            NEW.lead_id, NEW.notes, NEW.value_base, NEW.due_by_id, NEW.due_date, NEW."order",
            NEW.vat_value, NEW.vat_value_base, NEW.cancel_date, NEW.client_id, NEW.uid, NEW.currency_id,
            NEW.due_percent, NEW.ready_to_pay, NEW.ready_to_pay_by
        );
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION: Track history for leads
-- ============================================================================
CREATE OR REPLACE FUNCTION track_leads_history()
RETURNS TRIGGER AS $$
DECLARE
    change_type_val TEXT;
    emp_id BIGINT;
BEGIN
    -- Determine change type
    IF TG_OP = 'DELETE' THEN
        change_type_val := 'delete';
    ELSIF TG_OP = 'INSERT' THEN
        change_type_val := 'insert';
    ELSIF TG_OP = 'UPDATE' THEN
        change_type_val := 'update';
    END IF;
    
    -- Get current employee ID
    emp_id := get_current_employee_id();
    
    -- Insert into history table (using row_to_json for large tables to avoid listing all columns)
    IF TG_OP = 'DELETE' THEN
        INSERT INTO history_leads (
            original_id, changed_by, changed_at, change_type,
            id, lead_number, name, email, phone, source, language, topic, facts,
            special_notes, created_at, status, tags, anchor, probability, general_notes,
            scheduler, manager, helper, expert, closer, mobile, additional_contacts,
            potential_metrics, desired_location, section_eligibility, eligibility_status,
            eligibility_status_timestamp, expert_notes, handler_notes, teams_meeting_url,
            meeting_date, meeting_time, meeting_manager, meeting_location, meeting_brief,
            meeting_currency, meeting_amount, onedrive_folder_link, manual_interactions,
            stage, meeting_scheduling_notes, next_followup, followup, potential_applicants,
            potential_applicants_meeting, proposal_total, proposal_currency, meeting_total,
            meeting_total_currency, meeting_payment_form, special_notes_meeting,
            number_of_applicants_meeting, balance, balance_currency, proposal_text,
            date_signed, created_by, category, comments, label, highlighted_by,
            collection_label, collection_comments, handler, payment_plan,
            special_notes_last_edited_by, special_notes_last_edited_at,
            general_notes_last_edited_by, general_notes_last_edited_at,
            tags_last_edited_by, tags_last_edited_at, anchor_last_edited_by,
            anchor_last_edited_at, facts_last_edited_by, facts_last_edited_at,
            communication_started_by, communication_started_at, unactivated_by,
            unactivated_at, last_stage_changed_by, last_stage_changed_at, potential_value,
            stage_changed_by, stage_changed_at, created_by_full_name, client_country,
            handler_stage, lawyer, expert_eligibility_assessed, expert_eligibility_date,
            expert_eligibility_assessed_by, documents_uploaded_date, documents_uploaded_by,
            payment_due_date, auto_email_meeting_summary, language_preference,
            unactivation_reason, idss, cdate, udate, meeting_datetime, meeting_location_old,
            meeting_url, creator_id, currency_id, case_handler_id, language_id,
            meeting_lawyer_id, meeting_manager_id, meeting_scheduler_id,
            meeting_total_currency_id, source_id, stage_date, auto, source_external_id,
            marketing_data, category_id, ball, meeting_collection_id, meeting_paid,
            proposal, priority, followup_log, meeting_complexity, meeting_car_no,
            meeting_probability, meeting_confirmation, meeting_location_id, meeting_id,
            deactivate_notes, vat, legal_potential, revenue_potential, financial_ability,
            seriousness, exclusive_handler_id, eligibile, anchor_full_name, total_base,
            bonus_paid, autocall, eligibility_date, anchor_id, manual_id, master_id,
            closer_id, expert_id, reason_id, latest_interaction, sales_roles_locked,
            docs_url, vat_value, vat_value_base, management_notes, kind, dependent,
            potential_total, potential_total_base, expert_notes_last_edited_by,
            expert_notes_last_edited_at, handler_notes_last_edited_by,
            handler_notes_last_edited_at, section_eligibility_last_edited_by,
            section_eligibility_last_edited_at, eligibility_status_last_edited_by,
            eligibility_status_last_edited_at, expert_comments, pipeline_comments,
            expert_label, pipeline_label, expert_page_comments, expert_page_label,
            expert_page_highlighted_by, subcontractor_fee, eligible, country_id,
            category_last_edited_by, category_last_edited_at, file_id, meeting_confirmed,
            meeting_confirmation_by, whatsapp_profile_picture_url, conected, ai_summary,
            source_url
        ) VALUES (
            OLD.id, emp_id, NOW(), change_type_val,
            OLD.id, OLD.lead_number, OLD.name, OLD.email, OLD.phone, OLD.source, OLD.language, OLD.topic, OLD.facts,
            OLD.special_notes, OLD.created_at, OLD.status, OLD.tags, OLD.anchor, OLD.probability, OLD.general_notes,
            OLD.scheduler, OLD.manager, OLD.helper, OLD.expert, OLD.closer, OLD.mobile, OLD.additional_contacts,
            OLD.potential_metrics, OLD.desired_location, OLD.section_eligibility, OLD.eligibility_status,
            OLD.eligibility_status_timestamp, OLD.expert_notes, OLD.handler_notes, OLD.teams_meeting_url,
            OLD.meeting_date, OLD.meeting_time, OLD.meeting_manager, OLD.meeting_location, OLD.meeting_brief,
            OLD.meeting_currency, OLD.meeting_amount, OLD.onedrive_folder_link, OLD.manual_interactions,
            OLD.stage, OLD.meeting_scheduling_notes, OLD.next_followup, OLD.followup, OLD.potential_applicants,
            OLD.potential_applicants_meeting, OLD.proposal_total, OLD.proposal_currency, OLD.meeting_total,
            OLD.meeting_total_currency, OLD.meeting_payment_form, OLD.special_notes_meeting,
            OLD.number_of_applicants_meeting, OLD.balance, OLD.balance_currency, OLD.proposal_text,
            OLD.date_signed, OLD.created_by, OLD.category, OLD.comments, OLD.label, OLD.highlighted_by,
            OLD.collection_label, OLD.collection_comments, OLD.handler, OLD.payment_plan,
            OLD.special_notes_last_edited_by, OLD.special_notes_last_edited_at,
            OLD.general_notes_last_edited_by, OLD.general_notes_last_edited_at,
            OLD.tags_last_edited_by, OLD.tags_last_edited_at, OLD.anchor_last_edited_by,
            OLD.anchor_last_edited_at, OLD.facts_last_edited_by, OLD.facts_last_edited_at,
            OLD.communication_started_by, OLD.communication_started_at, OLD.unactivated_by,
            OLD.unactivated_at, OLD.last_stage_changed_by, OLD.last_stage_changed_at, OLD.potential_value,
            OLD.stage_changed_by, OLD.stage_changed_at, OLD.created_by_full_name, OLD.client_country,
            OLD.handler_stage, OLD.lawyer, OLD.expert_eligibility_assessed, OLD.expert_eligibility_date,
            OLD.expert_eligibility_assessed_by, OLD.documents_uploaded_date, OLD.documents_uploaded_by,
            OLD.payment_due_date, OLD.auto_email_meeting_summary, OLD.language_preference,
            OLD.unactivation_reason, OLD.idss, OLD.cdate, OLD.udate, OLD.meeting_datetime, OLD.meeting_location_old,
            OLD.meeting_url, OLD.creator_id, OLD.currency_id, OLD.case_handler_id, OLD.language_id,
            OLD.meeting_lawyer_id, OLD.meeting_manager_id, OLD.meeting_scheduler_id,
            OLD.meeting_total_currency_id, OLD.source_id, OLD.stage_date, OLD.auto, OLD.source_external_id,
            OLD.marketing_data, OLD.category_id, OLD.ball, OLD.meeting_collection_id, OLD.meeting_paid,
            OLD.proposal, OLD.priority, OLD.followup_log, OLD.meeting_complexity, OLD.meeting_car_no,
            OLD.meeting_probability, OLD.meeting_confirmation, OLD.meeting_location_id, OLD.meeting_id,
            OLD.deactivate_notes, OLD.vat, OLD.legal_potential, OLD.revenue_potential, OLD.financial_ability,
            OLD.seriousness, OLD.exclusive_handler_id, OLD.eligibile, OLD.anchor_full_name, OLD.total_base,
            OLD.bonus_paid, OLD.autocall, OLD.eligibility_date, OLD.anchor_id, OLD.manual_id, OLD.master_id,
            OLD.closer_id, OLD.expert_id, OLD.reason_id, OLD.latest_interaction, OLD.sales_roles_locked,
            OLD.docs_url, OLD.vat_value, OLD.vat_value_base, OLD.management_notes, OLD.kind, OLD.dependent,
            OLD.potential_total, OLD.potential_total_base, OLD.expert_notes_last_edited_by,
            OLD.expert_notes_last_edited_at, OLD.handler_notes_last_edited_by,
            OLD.handler_notes_last_edited_at, OLD.section_eligibility_last_edited_by,
            OLD.section_eligibility_last_edited_at, OLD.eligibility_status_last_edited_by,
            OLD.eligibility_status_last_edited_at, OLD.expert_comments, OLD.pipeline_comments,
            OLD.expert_label, OLD.pipeline_label, OLD.expert_page_comments, OLD.expert_page_label,
            OLD.expert_page_highlighted_by, OLD.subcontractor_fee, OLD.eligible, OLD.country_id,
            OLD.category_last_edited_by, OLD.category_last_edited_at, OLD.file_id, OLD.meeting_confirmed,
            OLD.meeting_confirmation_by, OLD.whatsapp_profile_picture_url, OLD.conected, OLD.ai_summary,
            OLD.source_url
        );
        RETURN OLD;
    ELSE
        INSERT INTO history_leads (
            original_id, changed_by, changed_at, change_type,
            id, lead_number, name, email, phone, source, language, topic, facts,
            special_notes, created_at, status, tags, anchor, probability, general_notes,
            scheduler, manager, helper, expert, closer, mobile, additional_contacts,
            potential_metrics, desired_location, section_eligibility, eligibility_status,
            eligibility_status_timestamp, expert_notes, handler_notes, teams_meeting_url,
            meeting_date, meeting_time, meeting_manager, meeting_location, meeting_brief,
            meeting_currency, meeting_amount, onedrive_folder_link, manual_interactions,
            stage, meeting_scheduling_notes, next_followup, followup, potential_applicants,
            potential_applicants_meeting, proposal_total, proposal_currency, meeting_total,
            meeting_total_currency, meeting_payment_form, special_notes_meeting,
            number_of_applicants_meeting, balance, balance_currency, proposal_text,
            date_signed, created_by, category, comments, label, highlighted_by,
            collection_label, collection_comments, handler, payment_plan,
            special_notes_last_edited_by, special_notes_last_edited_at,
            general_notes_last_edited_by, general_notes_last_edited_at,
            tags_last_edited_by, tags_last_edited_at, anchor_last_edited_by,
            anchor_last_edited_at, facts_last_edited_by, facts_last_edited_at,
            communication_started_by, communication_started_at, unactivated_by,
            unactivated_at, last_stage_changed_by, last_stage_changed_at, potential_value,
            stage_changed_by, stage_changed_at, created_by_full_name, client_country,
            handler_stage, lawyer, expert_eligibility_assessed, expert_eligibility_date,
            expert_eligibility_assessed_by, documents_uploaded_date, documents_uploaded_by,
            payment_due_date, auto_email_meeting_summary, language_preference,
            unactivation_reason, idss, cdate, udate, meeting_datetime, meeting_location_old,
            meeting_url, creator_id, currency_id, case_handler_id, language_id,
            meeting_lawyer_id, meeting_manager_id, meeting_scheduler_id,
            meeting_total_currency_id, source_id, stage_date, auto, source_external_id,
            marketing_data, category_id, ball, meeting_collection_id, meeting_paid,
            proposal, priority, followup_log, meeting_complexity, meeting_car_no,
            meeting_probability, meeting_confirmation, meeting_location_id, meeting_id,
            deactivate_notes, vat, legal_potential, revenue_potential, financial_ability,
            seriousness, exclusive_handler_id, eligibile, anchor_full_name, total_base,
            bonus_paid, autocall, eligibility_date, anchor_id, manual_id, master_id,
            closer_id, expert_id, reason_id, latest_interaction, sales_roles_locked,
            docs_url, vat_value, vat_value_base, management_notes, kind, dependent,
            potential_total, potential_total_base, expert_notes_last_edited_by,
            expert_notes_last_edited_at, handler_notes_last_edited_by,
            handler_notes_last_edited_at, section_eligibility_last_edited_by,
            section_eligibility_last_edited_at, eligibility_status_last_edited_by,
            eligibility_status_last_edited_at, expert_comments, pipeline_comments,
            expert_label, pipeline_label, expert_page_comments, expert_page_label,
            expert_page_highlighted_by, subcontractor_fee, eligible, country_id,
            category_last_edited_by, category_last_edited_at, file_id, meeting_confirmed,
            meeting_confirmation_by, whatsapp_profile_picture_url, conected, ai_summary,
            source_url
        ) VALUES (
            NEW.id, emp_id, NOW(), change_type_val,
            NEW.id, NEW.lead_number, NEW.name, NEW.email, NEW.phone, NEW.source, NEW.language, NEW.topic, NEW.facts,
            NEW.special_notes, NEW.created_at, NEW.status, NEW.tags, NEW.anchor, NEW.probability, NEW.general_notes,
            NEW.scheduler, NEW.manager, NEW.helper, NEW.expert, NEW.closer, NEW.mobile, NEW.additional_contacts,
            NEW.potential_metrics, NEW.desired_location, NEW.section_eligibility, NEW.eligibility_status,
            NEW.eligibility_status_timestamp, NEW.expert_notes, NEW.handler_notes, NEW.teams_meeting_url,
            NEW.meeting_date, NEW.meeting_time, NEW.meeting_manager, NEW.meeting_location, NEW.meeting_brief,
            NEW.meeting_currency, NEW.meeting_amount, NEW.onedrive_folder_link, NEW.manual_interactions,
            NEW.stage, NEW.meeting_scheduling_notes, NEW.next_followup, NEW.followup, NEW.potential_applicants,
            NEW.potential_applicants_meeting, NEW.proposal_total, NEW.proposal_currency, NEW.meeting_total,
            NEW.meeting_total_currency, NEW.meeting_payment_form, NEW.special_notes_meeting,
            NEW.number_of_applicants_meeting, NEW.balance, NEW.balance_currency, NEW.proposal_text,
            NEW.date_signed, NEW.created_by, NEW.category, NEW.comments, NEW.label, NEW.highlighted_by,
            NEW.collection_label, NEW.collection_comments, NEW.handler, NEW.payment_plan,
            NEW.special_notes_last_edited_by, NEW.special_notes_last_edited_at,
            NEW.general_notes_last_edited_by, NEW.general_notes_last_edited_at,
            NEW.tags_last_edited_by, NEW.tags_last_edited_at, NEW.anchor_last_edited_by,
            NEW.anchor_last_edited_at, NEW.facts_last_edited_by, NEW.facts_last_edited_at,
            NEW.communication_started_by, NEW.communication_started_at, NEW.unactivated_by,
            NEW.unactivated_at, NEW.last_stage_changed_by, NEW.last_stage_changed_at, NEW.potential_value,
            NEW.stage_changed_by, NEW.stage_changed_at, NEW.created_by_full_name, NEW.client_country,
            NEW.handler_stage, NEW.lawyer, NEW.expert_eligibility_assessed, NEW.expert_eligibility_date,
            NEW.expert_eligibility_assessed_by, NEW.documents_uploaded_date, NEW.documents_uploaded_by,
            NEW.payment_due_date, NEW.auto_email_meeting_summary, NEW.language_preference,
            NEW.unactivation_reason, NEW.idss, NEW.cdate, NEW.udate, NEW.meeting_datetime, NEW.meeting_location_old,
            NEW.meeting_url, NEW.creator_id, NEW.currency_id, NEW.case_handler_id, NEW.language_id,
            NEW.meeting_lawyer_id, NEW.meeting_manager_id, NEW.meeting_scheduler_id,
            NEW.meeting_total_currency_id, NEW.source_id, NEW.stage_date, NEW.auto, NEW.source_external_id,
            NEW.marketing_data, NEW.category_id, NEW.ball, NEW.meeting_collection_id, NEW.meeting_paid,
            NEW.proposal, NEW.priority, NEW.followup_log, NEW.meeting_complexity, NEW.meeting_car_no,
            NEW.meeting_probability, NEW.meeting_confirmation, NEW.meeting_location_id, NEW.meeting_id,
            NEW.deactivate_notes, NEW.vat, NEW.legal_potential, NEW.revenue_potential, NEW.financial_ability,
            NEW.seriousness, NEW.exclusive_handler_id, NEW.eligibile, NEW.anchor_full_name, NEW.total_base,
            NEW.bonus_paid, NEW.autocall, NEW.eligibility_date, NEW.anchor_id, NEW.manual_id, NEW.master_id,
            NEW.closer_id, NEW.expert_id, NEW.reason_id, NEW.latest_interaction, NEW.sales_roles_locked,
            NEW.docs_url, NEW.vat_value, NEW.vat_value_base, NEW.management_notes, NEW.kind, NEW.dependent,
            NEW.potential_total, NEW.potential_total_base, NEW.expert_notes_last_edited_by,
            NEW.expert_notes_last_edited_at, NEW.handler_notes_last_edited_by,
            NEW.handler_notes_last_edited_at, NEW.section_eligibility_last_edited_by,
            NEW.section_eligibility_last_edited_at, NEW.eligibility_status_last_edited_by,
            NEW.eligibility_status_last_edited_at, NEW.expert_comments, NEW.pipeline_comments,
            NEW.expert_label, NEW.pipeline_label, NEW.expert_page_comments, NEW.expert_page_label,
            NEW.expert_page_highlighted_by, NEW.subcontractor_fee, NEW.eligible, NEW.country_id,
            NEW.category_last_edited_by, NEW.category_last_edited_at, NEW.file_id, NEW.meeting_confirmed,
            NEW.meeting_confirmation_by, NEW.whatsapp_profile_picture_url, NEW.conected, NEW.ai_summary,
            NEW.source_url
        );
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION: Track history for leads_lead (legacy leads)
-- ============================================================================
-- Note: This table has many TEXT columns, so we'll use a similar approach
-- For brevity, I'll create a function that uses dynamic SQL or list all columns
-- Since leads_lead has many columns, we'll list them all
CREATE OR REPLACE FUNCTION track_leads_lead_history()
RETURNS TRIGGER AS $$
DECLARE
    change_type_val TEXT;
    emp_id BIGINT;
BEGIN
    -- Determine change type
    IF TG_OP = 'DELETE' THEN
        change_type_val := 'delete';
    ELSIF TG_OP = 'INSERT' THEN
        change_type_val := 'insert';
    ELSIF TG_OP = 'UPDATE' THEN
        change_type_val := 'update';
    END IF;
    
    -- Get current employee ID
    emp_id := get_current_employee_id();
    
    -- Insert into history table
    IF TG_OP = 'DELETE' THEN
        INSERT INTO history_leads_lead (
            original_id, changed_by, changed_at, change_type,
            id, cdate, udate, name, topic, mobile, phone, email, special_notes, notes,
            meeting_datetime, meeting_location_old, meeting_url, meeting_total, meeting_fop,
            probability, total, meeting_brief, next_followup, file_id, first_payment,
            creator_id, currency_id, case_handler_id, firm_id, language_id, meeting_lawyer_id,
            meeting_manager_id, meeting_scheduler_id, meeting_total_currency_id, source_id,
            stage, stage_date, status, description, auto, source_external_id, source_url,
            marketing_data, category, ball, additional_emails, additional_phones,
            meeting_collection_id, meeting_paid, proposal, priority, meeting_date, meeting_time,
            followup_log, initial_probability, meeting_complexity, meeting_car_no, meeting_probability,
            proposed_solution, meeting_confirmation, meeting_location_id, meeting_id,
            meeting_scheduling_notes, deactivate_notes, old_reason, vat, legal_potential,
            revenue_potential, desired_location, financial_ability, seriousness, external_notes,
            exclusive_handler_id, eligibile, anchor_full_name, total_base, bonus_paid, autocall,
            eligibilty_date, no_of_applicants, anchor_id, manual_id, master_id, closer_id,
            expert_id, potential_applicants, reason_id, latest_interaction, expert_examination,
            expert_opinion, sales_roles_locked, expiry_date, docs_url, vat_value, vat_value_base,
            handler_expert_opinion, management_notes, kind, dependent, potential_total,
            potential_total_base, category_id, lead_number, expert_eligibility_assessed,
            expert_eligibility_date, expert_eligibility_assessed_by, special_notes_last_edited_by,
            special_notes_last_edited_at, notes_last_edited_by, notes_last_edited_at,
            description_last_edited_by, description_last_edited_at, anchor_full_name_last_edited_by,
            anchor_full_name_last_edited_at, category_last_edited_by, category_last_edited_at,
            expert_notes_last_edited_by, expert_notes_last_edited_at, handler_notes_last_edited_by,
            handler_notes_last_edited_at, section_eligibility_last_edited_by,
            section_eligibility_last_edited_at, eligibility_status_last_edited_by,
            eligibility_status_last_edited_at, documents_uploaded_by, documents_uploaded_date,
            expert_notes, handler_notes, onedrive_folder_link, section_eligibility, eligibility_status,
            eligibility_status_timestamp, stage_changed_by, stage_changed_at, unactivated_by,
            unactivated_at, unactivation_reason, comments, label, expert_comments, pipeline_comments,
            expert_label, pipeline_label, expert_page_comments, expert_page_label,
            expert_page_highlighted_by, collection_label, collection_comments, subcontractor_fee,
            meeting_confirmed, meeting_confirmation_by, ai_summary
        ) VALUES (
            OLD.id, emp_id, NOW(), change_type_val,
            OLD.id, OLD.cdate, OLD.udate, OLD.name, OLD.topic, OLD.mobile, OLD.phone, OLD.email, OLD.special_notes, OLD.notes,
            OLD.meeting_datetime, OLD.meeting_location_old, OLD.meeting_url, OLD.meeting_total, OLD.meeting_fop,
            OLD.probability, OLD.total, OLD.meeting_brief, OLD.next_followup, OLD.file_id, OLD.first_payment,
            OLD.creator_id, OLD.currency_id, OLD.case_handler_id, OLD.firm_id, OLD.language_id, OLD.meeting_lawyer_id,
            OLD.meeting_manager_id, OLD.meeting_scheduler_id, OLD.meeting_total_currency_id, OLD.source_id,
            OLD.stage, OLD.stage_date, OLD.status, OLD.description, OLD.auto, OLD.source_external_id, OLD.source_url,
            OLD.marketing_data, OLD.category, OLD.ball, OLD.additional_emails, OLD.additional_phones,
            OLD.meeting_collection_id, OLD.meeting_paid, OLD.proposal, OLD.priority, OLD.meeting_date, OLD.meeting_time,
            OLD.followup_log, OLD.initial_probability, OLD.meeting_complexity, OLD.meeting_car_no, OLD.meeting_probability,
            OLD.proposed_solution, OLD.meeting_confirmation, OLD.meeting_location_id, OLD.meeting_id,
            OLD.meeting_scheduling_notes, OLD.deactivate_notes, OLD.old_reason, OLD.vat, OLD.legal_potential,
            OLD.revenue_potential, OLD.desired_location, OLD.financial_ability, OLD.seriousness, OLD.external_notes,
            OLD.exclusive_handler_id, OLD.eligibile, OLD.anchor_full_name, OLD.total_base, OLD.bonus_paid, OLD.autocall,
            OLD.eligibilty_date, OLD.no_of_applicants, OLD.anchor_id, OLD.manual_id, OLD.master_id, OLD.closer_id,
            OLD.expert_id, OLD.potential_applicants, (CASE WHEN OLD.reason_id IS NULL THEN NULL ELSE OLD.reason_id::BIGINT END), OLD.latest_interaction, OLD.expert_examination,
            OLD.expert_opinion, OLD.sales_roles_locked, OLD.expiry_date, OLD.docs_url, OLD.vat_value, OLD.vat_value_base,
            OLD.handler_expert_opinion, OLD.management_notes, OLD.kind, OLD.dependent, OLD.potential_total,
            OLD.potential_total_base, OLD.category_id, OLD.lead_number, OLD.expert_eligibility_assessed,
            OLD.expert_eligibility_date, OLD.expert_eligibility_assessed_by, OLD.special_notes_last_edited_by,
            OLD.special_notes_last_edited_at, OLD.notes_last_edited_by, OLD.notes_last_edited_at,
            OLD.description_last_edited_by, OLD.description_last_edited_at, OLD.anchor_full_name_last_edited_by,
            OLD.anchor_full_name_last_edited_at, OLD.category_last_edited_by, OLD.category_last_edited_at,
            OLD.expert_notes_last_edited_by, OLD.expert_notes_last_edited_at, OLD.handler_notes_last_edited_by,
            OLD.handler_notes_last_edited_at, OLD.section_eligibility_last_edited_by,
            OLD.section_eligibility_last_edited_at, OLD.eligibility_status_last_edited_by,
            OLD.eligibility_status_last_edited_at, OLD.documents_uploaded_by, OLD.documents_uploaded_date,
            OLD.expert_notes, OLD.handler_notes, OLD.onedrive_folder_link, OLD.section_eligibility, OLD.eligibility_status,
            OLD.eligibility_status_timestamp, OLD.stage_changed_by, OLD.stage_changed_at, OLD.unactivated_by,
            OLD.unactivated_at, OLD.unactivation_reason, OLD.comments, OLD.label, OLD.expert_comments, OLD.pipeline_comments,
            OLD.expert_label, OLD.pipeline_label, OLD.expert_page_comments, OLD.expert_page_label,
            OLD.expert_page_highlighted_by, OLD.collection_label, OLD.collection_comments, OLD.subcontractor_fee,
            OLD.meeting_confirmed, OLD.meeting_confirmation_by, OLD.ai_summary
        );
        RETURN OLD;
    ELSE
        -- For INSERT and UPDATE, use NEW
        INSERT INTO history_leads_lead (
            original_id, changed_by, changed_at, change_type,
            id, cdate, udate, name, topic, mobile, phone, email, special_notes, notes,
            meeting_datetime, meeting_location_old, meeting_url, meeting_total, meeting_fop,
            probability, total, meeting_brief, next_followup, file_id, first_payment,
            creator_id, currency_id, case_handler_id, firm_id, language_id, meeting_lawyer_id,
            meeting_manager_id, meeting_scheduler_id, meeting_total_currency_id, source_id,
            stage, stage_date, status, description, auto, source_external_id, source_url,
            marketing_data, category, ball, additional_emails, additional_phones,
            meeting_collection_id, meeting_paid, proposal, priority, meeting_date, meeting_time,
            followup_log, initial_probability, meeting_complexity, meeting_car_no, meeting_probability,
            proposed_solution, meeting_confirmation, meeting_location_id, meeting_id,
            meeting_scheduling_notes, deactivate_notes, old_reason, vat, legal_potential,
            revenue_potential, desired_location, financial_ability, seriousness, external_notes,
            exclusive_handler_id, eligibile, anchor_full_name, total_base, bonus_paid, autocall,
            eligibilty_date, no_of_applicants, anchor_id, manual_id, master_id, closer_id,
            expert_id, potential_applicants, reason_id, latest_interaction, expert_examination,
            expert_opinion, sales_roles_locked, expiry_date, docs_url, vat_value, vat_value_base,
            handler_expert_opinion, management_notes, kind, dependent, potential_total,
            potential_total_base, category_id, lead_number, expert_eligibility_assessed,
            expert_eligibility_date, expert_eligibility_assessed_by, special_notes_last_edited_by,
            special_notes_last_edited_at, notes_last_edited_by, notes_last_edited_at,
            description_last_edited_by, description_last_edited_at, anchor_full_name_last_edited_by,
            anchor_full_name_last_edited_at, category_last_edited_by, category_last_edited_at,
            expert_notes_last_edited_by, expert_notes_last_edited_at, handler_notes_last_edited_by,
            handler_notes_last_edited_at, section_eligibility_last_edited_by,
            section_eligibility_last_edited_at, eligibility_status_last_edited_by,
            eligibility_status_last_edited_at, documents_uploaded_by, documents_uploaded_date,
            expert_notes, handler_notes, onedrive_folder_link, section_eligibility, eligibility_status,
            eligibility_status_timestamp, stage_changed_by, stage_changed_at, unactivated_by,
            unactivated_at, unactivation_reason, comments, label, expert_comments, pipeline_comments,
            expert_label, pipeline_label, expert_page_comments, expert_page_label,
            expert_page_highlighted_by, collection_label, collection_comments, subcontractor_fee,
            meeting_confirmed, meeting_confirmation_by, ai_summary
        ) VALUES (
            NEW.id, emp_id, NOW(), change_type_val,
            NEW.id, NEW.cdate, NEW.udate, NEW.name, NEW.topic, NEW.mobile, NEW.phone, NEW.email, NEW.special_notes, NEW.notes,
            NEW.meeting_datetime, NEW.meeting_location_old, NEW.meeting_url, NEW.meeting_total, NEW.meeting_fop,
            NEW.probability, NEW.total, NEW.meeting_brief, NEW.next_followup, NEW.file_id, NEW.first_payment,
            NEW.creator_id, NEW.currency_id, NEW.case_handler_id, NEW.firm_id, NEW.language_id, NEW.meeting_lawyer_id,
            NEW.meeting_manager_id, NEW.meeting_scheduler_id, NEW.meeting_total_currency_id, NEW.source_id,
            NEW.stage, NEW.stage_date, NEW.status, NEW.description, NEW.auto, NEW.source_external_id, NEW.source_url,
            NEW.marketing_data, NEW.category, NEW.ball, NEW.additional_emails, NEW.additional_phones,
            NEW.meeting_collection_id, NEW.meeting_paid, NEW.proposal, NEW.priority, NEW.meeting_date, NEW.meeting_time,
            NEW.followup_log, NEW.initial_probability, NEW.meeting_complexity, NEW.meeting_car_no, NEW.meeting_probability,
            NEW.proposed_solution, NEW.meeting_confirmation, NEW.meeting_location_id, NEW.meeting_id,
            NEW.meeting_scheduling_notes, NEW.deactivate_notes, NEW.old_reason, NEW.vat, NEW.legal_potential,
            NEW.revenue_potential, NEW.desired_location, NEW.financial_ability, NEW.seriousness, NEW.external_notes,
            NEW.exclusive_handler_id, NEW.eligibile, NEW.anchor_full_name, NEW.total_base, NEW.bonus_paid, NEW.autocall,
            NEW.eligibilty_date, NEW.no_of_applicants, NEW.anchor_id, NEW.manual_id, NEW.master_id, NEW.closer_id,
            NEW.expert_id, NEW.potential_applicants, (CASE WHEN NEW.reason_id IS NULL THEN NULL ELSE NEW.reason_id::BIGINT END), NEW.latest_interaction, NEW.expert_examination,
            NEW.expert_opinion, NEW.sales_roles_locked, NEW.expiry_date, NEW.docs_url, NEW.vat_value, NEW.vat_value_base,
            NEW.handler_expert_opinion, NEW.management_notes, NEW.kind, NEW.dependent, NEW.potential_total,
            NEW.potential_total_base, NEW.category_id, NEW.lead_number, NEW.expert_eligibility_assessed,
            NEW.expert_eligibility_date, NEW.expert_eligibility_assessed_by, NEW.special_notes_last_edited_by,
            NEW.special_notes_last_edited_at, NEW.notes_last_edited_by, NEW.notes_last_edited_at,
            NEW.description_last_edited_by, NEW.description_last_edited_at, NEW.anchor_full_name_last_edited_by,
            NEW.anchor_full_name_last_edited_at, NEW.category_last_edited_by, NEW.category_last_edited_at,
            NEW.expert_notes_last_edited_by, NEW.expert_notes_last_edited_at, NEW.handler_notes_last_edited_by,
            NEW.handler_notes_last_edited_at, NEW.section_eligibility_last_edited_by,
            NEW.section_eligibility_last_edited_at, NEW.eligibility_status_last_edited_by,
            NEW.eligibility_status_last_edited_at, NEW.documents_uploaded_by, NEW.documents_uploaded_date,
            NEW.expert_notes, NEW.handler_notes, NEW.onedrive_folder_link, NEW.section_eligibility, NEW.eligibility_status,
            NEW.eligibility_status_timestamp, NEW.stage_changed_by, NEW.stage_changed_at, NEW.unactivated_by,
            NEW.unactivated_at, NEW.unactivation_reason, NEW.comments, NEW.label, NEW.expert_comments, NEW.pipeline_comments,
            NEW.expert_label, NEW.pipeline_label, NEW.expert_page_comments, NEW.expert_page_label,
            NEW.expert_page_highlighted_by, NEW.collection_label, NEW.collection_comments, NEW.subcontractor_fee,
            NEW.meeting_confirmed, NEW.meeting_confirmation_by, NEW.ai_summary
        );
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION: Track history for meetings
-- ============================================================================
CREATE OR REPLACE FUNCTION track_meetings_history()
RETURNS TRIGGER AS $$
DECLARE
    change_type_val TEXT;
    emp_id BIGINT;
BEGIN
    -- Determine change type
    IF TG_OP = 'DELETE' THEN
        change_type_val := 'delete';
    ELSIF TG_OP = 'INSERT' THEN
        change_type_val := 'insert';
    ELSIF TG_OP = 'UPDATE' THEN
        change_type_val := 'update';
    END IF;
    
    -- Get current employee ID
    emp_id := get_current_employee_id();
    
    -- Insert into history table
    IF TG_OP = 'DELETE' THEN
        INSERT INTO history_meetings (
            original_id, changed_by, changed_at, change_type,
            id, client_id, meeting_date, meeting_time, meeting_location, meeting_manager,
            meeting_currency, meeting_amount, meeting_brief, scheduler, helper, expert,
            teams_meeting_url, last_edited_timestamp, last_edited_by, created_at, status,
            lawyer, teams_id, meeting_subject, started_at, ended_at, transcript_url,
            legacy_lead_id, attendance_probability, complexity, car_number, calendar_type,
            extern1, extern2
        ) VALUES (
            OLD.id, emp_id, NOW(), change_type_val,
            OLD.id, OLD.client_id, OLD.meeting_date, OLD.meeting_time, OLD.meeting_location, OLD.meeting_manager,
            OLD.meeting_currency, OLD.meeting_amount, OLD.meeting_brief, OLD.scheduler, OLD.helper, OLD.expert,
            OLD.teams_meeting_url, OLD.last_edited_timestamp, OLD.last_edited_by, OLD.created_at, OLD.status,
            OLD.lawyer, OLD.teams_id, OLD.meeting_subject, OLD.started_at, OLD.ended_at, OLD.transcript_url,
            OLD.legacy_lead_id, OLD.attendance_probability, OLD.complexity, OLD.car_number, OLD.calendar_type,
            OLD.extern1, OLD.extern2
        );
        RETURN OLD;
    ELSE
        INSERT INTO history_meetings (
            original_id, changed_by, changed_at, change_type,
            id, client_id, meeting_date, meeting_time, meeting_location, meeting_manager,
            meeting_currency, meeting_amount, meeting_brief, scheduler, helper, expert,
            teams_meeting_url, last_edited_timestamp, last_edited_by, created_at, status,
            lawyer, teams_id, meeting_subject, started_at, ended_at, transcript_url,
            legacy_lead_id, attendance_probability, complexity, car_number, calendar_type,
            extern1, extern2
        ) VALUES (
            NEW.id, emp_id, NOW(), change_type_val,
            NEW.id, NEW.client_id, NEW.meeting_date, NEW.meeting_time, NEW.meeting_location, NEW.meeting_manager,
            NEW.meeting_currency, NEW.meeting_amount, NEW.meeting_brief, NEW.scheduler, NEW.helper, NEW.expert,
            NEW.teams_meeting_url, NEW.last_edited_timestamp, NEW.last_edited_by, NEW.created_at, NEW.status,
            NEW.lawyer, NEW.teams_id, NEW.meeting_subject, NEW.started_at, NEW.ended_at, NEW.transcript_url,
            NEW.legacy_lead_id, NEW.attendance_probability, NEW.complexity, NEW.car_number, NEW.calendar_type,
            NEW.extern1, NEW.extern2
        );
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- CREATE TRIGGERS
-- ============================================================================

-- Drop existing triggers if they exist
DROP TRIGGER IF EXISTS trigger_history_payment_plans ON payment_plans;
DROP TRIGGER IF EXISTS trigger_history_finances_paymentplanrow ON finances_paymentplanrow;
DROP TRIGGER IF EXISTS trigger_history_leads ON leads;
DROP TRIGGER IF EXISTS trigger_history_leads_lead ON leads_lead;
DROP TRIGGER IF EXISTS trigger_history_meetings ON meetings;

-- Create triggers for payment_plans
CREATE TRIGGER trigger_history_payment_plans
    AFTER INSERT OR UPDATE OR DELETE ON payment_plans
    FOR EACH ROW
    EXECUTE FUNCTION track_payment_plans_history();

-- Create triggers for finances_paymentplanrow
CREATE TRIGGER trigger_history_finances_paymentplanrow
    AFTER INSERT OR UPDATE OR DELETE ON finances_paymentplanrow
    FOR EACH ROW
    EXECUTE FUNCTION track_finances_paymentplanrow_history();

-- Create triggers for leads
CREATE TRIGGER trigger_history_leads
    AFTER INSERT OR UPDATE OR DELETE ON leads
    FOR EACH ROW
    EXECUTE FUNCTION track_leads_history();

-- Create triggers for leads_lead
CREATE TRIGGER trigger_history_leads_lead
    AFTER INSERT OR UPDATE OR DELETE ON leads_lead
    FOR EACH ROW
    EXECUTE FUNCTION track_leads_lead_history();

-- Create triggers for meetings
CREATE TRIGGER trigger_history_meetings
    AFTER INSERT OR UPDATE OR DELETE ON meetings
    FOR EACH ROW
    EXECUTE FUNCTION track_meetings_history();

-- ============================================================================
-- SUMMARY
-- ============================================================================
-- Created trigger functions and triggers for all 5 tables:
-- 1. payment_plans -> history_payment_plans
-- 2. finances_paymentplanrow -> history_finances_paymentplanrow
-- 3. leads -> history_leads
-- 4. leads_lead -> history_leads_lead
-- 5. meetings -> history_meetings
--
-- EMPLOYEE ID CAPTURE:
-- The get_current_employee_id() function automatically:
-- 1. Gets the current authenticated user ID using auth.uid() or JWT claim
-- 2. Looks up the user in the users table WHERE auth_id = auth.uid() to get employee_id
-- 3. Returns the employee_id (which matches tenants_employee.id)
--
-- This means:
-- - No need to set session variables in your application
-- - Works automatically for all authenticated users
-- - Returns NULL if user is not authenticated or employee_id is not set
--
-- The triggers will automatically:
-- - Save full row snapshots on INSERT, UPDATE, and DELETE
-- - Record the employee ID who made the change (from users.employee_id)
-- - Record the timestamp
-- - Record the change type (insert/update/delete)
--
-- REQUIREMENTS:
-- - Users must be authenticated (auth.uid() must return a valid UUID)
-- - The users table must have:
--   * auth_id column (UUID) that matches auth.users.id
--   * employee_id column (BIGINT) that matches tenants_employee.id
-- - The employee_id in users table must match an id in tenants_employee table
-- ============================================================================
