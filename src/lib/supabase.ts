import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

// Configure Supabase client with proper session management
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Enable auto refresh tokens for better UX
    autoRefreshToken: true,
    // Persist session in localStorage
    persistSession: true,
    // Detect session in URL (for magic links, etc.)
    detectSessionInUrl: true,
    // Flow type for authentication
    flowType: 'pkce',
    // Disable debug mode to reduce console noise
    debug: false,
  },
  // Global headers
  global: {
    headers: {
      'X-Client-Info': 'leadify-crm',
    },
  },
});

// Expose supabase client globally for debugging (remove in production)
if (typeof window !== 'undefined') {
  (window as any).supabase = supabase;
}

// Session manager for handling session expiration and refresh
export const sessionManager = {
  async getSession() {
    try {
      const { data: { session }, error } = await supabase.auth.getSession();
      if (error) throw error;
      
      // Check if session is expired
      if (session && this.isSessionExpired(session)) {
        console.log('🕐 Session expired, attempting refresh...');
        const refreshedSession = await this.refreshSession();
        if (refreshedSession) {
          console.log('✅ Session refreshed successfully');
          return refreshedSession;
        } else {
          console.log('❌ Session refresh failed, signing out...');
          await supabase.auth.signOut();
          return null;
        }
      }
      
      return session;
    } catch (error) {
      console.error('Error getting session:', error);
      return null;
    }
  },

  isSessionExpired(session: any): boolean {
    if (!session?.expires_at) return true;
    
    try {
      const expiresAt = typeof session.expires_at === 'number' 
        ? session.expires_at * 1000 
        : new Date(session.expires_at).getTime();
      return Date.now() >= expiresAt;
    } catch (e) {
      // Could not parse JWT token for expiration check
      return true;
    }
  },

  hasRefreshToken(session: any): boolean {
    return !!(session?.refresh_token);
  },

  getTimeUntilExpiry(session: any): number | null {
    if (!session?.expires_at) return null;
    
    try {
      const expiresAt = typeof session.expires_at === 'number' 
        ? session.expires_at * 1000 
        : new Date(session.expires_at).getTime();
      return Math.max(0, expiresAt - Date.now());
    } catch (e) {
      // Could not determine session expiration, treating as expired
      return 0;
    }
  },

  async refreshSession() {
    try {
      const { data: { session }, error } = await supabase.auth.refreshSession();
      if (error) throw error;
      return session;
    } catch (error) {
      return null;
    }
  }
};

// Auto-refresh session when it's about to expire
let refreshTimeout: NodeJS.Timeout | null = null;

const scheduleRefresh = async () => {
  const session = await sessionManager.getSession();
  if (!session) return;

  const timeUntilExpiry = sessionManager.getTimeUntilExpiry(session);
  if (!timeUntilExpiry || timeUntilExpiry <= 0) return;

  // Refresh 5 minutes before expiry
  const refreshDelay = Math.max(0, timeUntilExpiry - 5 * 60 * 1000);
  
  if (refreshTimeout) clearTimeout(refreshTimeout);
  
  refreshTimeout = setTimeout(async () => {
    const refreshedSession = await sessionManager.refreshSession();
    if (refreshedSession) {
      // Session refreshed successfully
      scheduleRefresh(); // Schedule next refresh
    } else {
      // Session expired and refresh failed, redirecting to login
    }
  }, refreshDelay);
};

// Set up session monitoring
supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_IN' && session) {
    scheduleRefresh();
  } else if (event === 'SIGNED_OUT') {
    if (refreshTimeout) {
      clearTimeout(refreshTimeout);
      refreshTimeout = null;
    }
  }
});

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

export async function createPaymentLink({ 
  paymentPlanId, 
  clientId, 
  value, 
  valueVat, 
  currency, 
  order, 
  clientName, 
  leadNumber 
}: {
  paymentPlanId: string;
  clientId: string;
  value: number;
  valueVat: number;
  currency: string;
  order: string;
  clientName: string;
  leadNumber: string;
}) {
  // Generate secure token
  const secureToken = `payment_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  // Set expiration date (30 days from now)
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);
  // Create payment link in database
  const { data: paymentLink, error } = await supabase
    .from('payment_links')
    .insert({
      payment_plan_id: paymentPlanId,
      client_id: clientId,
      secure_token: secureToken,
      amount: value,
      vat_amount: valueVat,
      total_amount: value + valueVat,
      currency: currency || '₪',
      description: `${order} - ${clientName} (#${leadNumber})`,
      status: 'pending',
      expires_at: expiresAt.toISOString()
    })
    .select()
    .single();
  if (error) throw error;
  // Generate the payment URL
  const paymentUrl = `${window.location.origin}/payment/${secureToken}`;
  return paymentUrl;
} 