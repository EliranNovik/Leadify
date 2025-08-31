import { Lead } from '../lib/supabase';

export interface Client extends Lead {
  category?: string;
  mobile?: string;
  location?: string;
  potential_metrics?: any; // JSON or PotentialMetric[]
  desired_location?: string;
  section_eligibility?: string;
  eligibility_status?: string;
  eligibility_status_timestamp?: string;
  expert_notes?: any; // JSON or Note[]
  handler_notes?: any; // JSON or Note[]
  teams_meeting_url?: string;
  emails?: any[];
  proposal_text?: string;
  proposal_total?: number;
  proposal_currency?: string;
  case_manager?: string;
  special_notes_last_edited_by?: string;
  special_notes_last_edited_at?: string;
  general_notes_last_edited_by?: string;
  general_notes_last_edited_at?: string;
  tags_last_edited_by?: string;
  tags_last_edited_at?: string;
  anchor_last_edited_by?: string;
  anchor_last_edited_at?: string;
  facts_last_edited_by?: string;
  facts_last_edited_at?: string;
  last_stage_changed_by?: string;
  last_stage_changed_at?: string;
  updated_at?: string;
  client_country?: string;
  // Legacy lead support
  lead_type?: 'legacy' | 'new';
  handler?: string;
  // Legacy lead role fields
  meeting_scheduler_id?: string;
  meeting_manager_id?: string;
  meeting_lawyer_id?: string;
  expert_id?: string;
  closer_id?: string;
  case_handler_id?: string;
}

export interface ClientTabProps {
  client: Client;
  onClientUpdate?: () => Promise<void>;
} 