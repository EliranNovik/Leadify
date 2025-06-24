import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Types for our database tables
export interface Lead {
  id: string;
  lead_number: string;
  name: string;
  email?: string;
  phone?: string;
  mobile?: string;
  additional_contacts?: any[];
  source: string;
  language: string;
  topic: string;
  facts: string;
  special_notes: string;
  tags?: string;
  anchor?: string;
  probability?: number;
  general_notes?: string;
  scheduler?: string;
  manager?: string;
  helper?: string;
  expert?: string;
  closer?: string;
  created_at: string;
  status: 'new' | 'in_progress' | 'qualified' | 'not_qualified';
  stage: 'created' | 'scheduler_assigned' | 'meeting_scheduled' | 'meeting_paid' | 'unactivated' | 'communication_started' | 'another_meeting' | 'revised_offer' | 'offer_sent' | 'waiting_for_mtng_sum' | 'client_signed' | 'client_declined' | 'lead_summary' | 'meeting_rescheduled' | 'meeting_ended' | 'Mtng sum+Agreement sent' | 'Client signed agreement' | 'payment_request_sent' | 'finances_and_payments_plan';
  teams_meeting_url?: string;
  meeting_date?: string;
  meeting_time?: string;
  meeting_manager?: string;
  meeting_location?: string;
  meeting_brief?: string;
  meeting_currency?: string;
  meeting_amount?: number;
  follow_up_date?: string;
  onedrive_folder_link?: string;
  manual_interactions?: any[];
  number_of_applicants_meeting?: number;
  potential_applicants_meeting?: number;
  proposal_total?: number;
  proposal_currency?: string;
  proposal_text?: string;
  balance?: number;
  balance_currency?: string;
  next_followup?: string;
  category?: string;
  date_signed?: string;
}

export interface Meeting {
  id: number;
  created_at: string;
  meeting_date: string;
  meeting_time: string;
  meeting_manager: string;
  meeting_location: string;
  meeting_brief: string;
  meeting_currency: string;
  meeting_amount: number;
  status: 'scheduled' | 'completed' | 'canceled';
  lead_id: string; // Foreign key to leads table
}

// Helper function to search leads
export async function searchLeads(query: string) {
  if (!query.trim()) return [];

  const searchQuery = query.trim();

  // Build a dynamic 'or' filter
  const orFilters = [
    `name.ilike.%${searchQuery}%`,
    `email.ilike.%${searchQuery}%`,
    `phone.ilike.%${searchQuery}%`,
    `mobile.ilike.%${searchQuery}%`,
    `lead_number.ilike.%${searchQuery}%` // for 'L12' finding 'L123' or '123' finding 'L123'
  ];

  // If the query is purely numeric, add a specific check for 'L' + number for better accuracy
  if (/^\d+$/.test(searchQuery)) {
    orFilters.push(`lead_number.eq.L${searchQuery}`);
  }

  const { data, error } = await supabase
    .from('leads')
    .select()
    .or(orFilters.join(','))
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) {
    console.error('Error searching leads:', error);
    throw error;
  }

  return data || [];
} 