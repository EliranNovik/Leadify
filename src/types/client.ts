import { Lead } from '../lib/supabase';
import type { ProbabilitySlidersValues } from '../components/client-tabs/ProbabilitySlidersModal';

export interface Client extends Lead {
  category?: string;
  mobile?: string;
  location?: string;
  potential_metrics?: any; // JSON or PotentialMetric[]
  desired_location?: string;
  section_eligibility?: string;
  section_eligibility_last_edited_by?: string;
  section_eligibility_last_edited_at?: string;
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
  file_id?: string | null;
  // Legacy lead role fields
  meeting_scheduler_id?: string;
  meeting_manager_id?: string;
  meeting_lawyer_id?: string;
  expert_id?: string;
  closer_id?: string;
  case_handler_id?: string;
  /** Collection manager (employee id); same as DB `meeting_collection_id` */
  meeting_collection_id?: string | number | null;
  /** Marketing officer (employee id) */
  marketing_officer_id?: string | number | null;
  retainer_handler_id?: string | number | null;
  user_internal_id?: string | number | null;
  // Follow-up from join (follow_ups for current user) – when parent loads with join, InfoTab uses this
  next_followup?: string | null;
  follow_up_date?: string | null;
  follow_up_id?: number | null;
}

export interface ClientInteractionsCache {
  leadId: string | number;
  interactions: any[];
  emails?: any[];
  count: number;
  fetchedAt: string;
}

export interface ClientTabProps {
  client: Client;
  onClientUpdate?: () => Promise<void>;
  interactionsCache?: ClientInteractionsCache | null;
  onInteractionsCacheUpdate?: (cache: ClientInteractionsCache) => void;
  onInteractionCountUpdate?: (count: number) => void;
  /** When Interactions tab computes flagged timeline rows, parent can show count in header (e.g. ClientHeader). */
  onFlaggedConversationCountUpdate?: (count: number) => void;
  allEmployees?: any[]; // Employees loaded in parent component
  /** When true, all edit/save/action buttons are hidden and non-functional (e.g. external user modal) */
  readOnly?: boolean;
  /** Switch client detail tab (e.g. interactions, expert) — used from Info tab for flag flows */
  onSwitchClientTab?: (tabId: string) => void;
  /** Flagged timeline count from Interactions (same as header); used to skip 90% probability gate */
  flaggedConversationCount?: number;
  /** After 90%+ gate → conversation path: parent stores pending values, switches tab, header shows reminder */
  onProbabilityConversationPending?: (values: ProbabilitySlidersValues) => void;
}