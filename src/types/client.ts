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
}

export interface ClientTabProps {
  client: Client;
  onClientUpdate?: () => Promise<void>;
} 