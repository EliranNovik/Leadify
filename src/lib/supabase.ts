import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

// Configure Supabase client with proper session management for multi-tab support
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Enable auto refresh tokens - Supabase handles this automatically
    autoRefreshToken: true,
    // Persist session in localStorage (shared across tabs)
    persistSession: true,
    // Detect session in URL (for magic links, etc.)
    detectSessionInUrl: true,
    // Flow type for authentication
    flowType: 'pkce',
    // Storage key for session - use default to ensure consistency
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
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

// Sync session across tabs - Supabase handles this automatically via localStorage
// No additional listeners needed - Supabase's built-in session management handles multi-tab scenarios

// Expose supabase client globally for debugging (remove in production)
if (typeof window !== 'undefined') {
  (window as any).supabase = supabase;
}

// Global flag to prevent multiple simultaneous redirects (per-tab)
let isRedirecting = false;

// Storage key for cross-tab coordination
const REDIRECTING_KEY = 'supabase_auth_redirecting';
const REDIRECTING_TIMEOUT = 2000; // 2 seconds

// Function to handle session expiration and redirect
export const handleSessionExpiration = async () => {
  // Check if another tab is already redirecting
  if (typeof window !== 'undefined') {
    const redirectingUntil = localStorage.getItem(REDIRECTING_KEY);
    if (redirectingUntil) {
      const until = parseInt(redirectingUntil, 10);
      if (Date.now() < until) {
        // Another tab is redirecting, wait for it
        console.log('Another tab is handling redirect, waiting...');
        return;
      } else {
        // Stale flag, clear it
        localStorage.removeItem(REDIRECTING_KEY);
      }
    }
    
    // Set flag in localStorage to coordinate across tabs
    const redirectUntil = Date.now() + REDIRECTING_TIMEOUT;
    localStorage.setItem(REDIRECTING_KEY, redirectUntil.toString());
  }
  
  if (isRedirecting) return; // Prevent multiple redirects in same tab
  isRedirecting = true;
  
  try {
    console.log('Session expired - signing out and redirecting to login');
    // Clear auth state immediately
    await supabase.auth.signOut();
    // Clear any cached session data
    if (typeof window !== 'undefined') {
      // Clear Supabase session storage
      Object.keys(localStorage).forEach(key => {
        if (key.includes('supabase.auth.token')) {
          localStorage.removeItem(key);
        }
      });
      // Clear redirecting flag
      localStorage.removeItem(REDIRECTING_KEY);
      // Force redirect to login
      window.location.href = '/login';
    }
  } catch (error) {
    console.error('Error during session expiration handling:', error);
    // Even if signOut fails, still redirect
    if (typeof window !== 'undefined') {
      localStorage.removeItem(REDIRECTING_KEY);
      window.location.href = '/login';
    }
  }
};

// Helper function to check if an error is an authentication error
export const isAuthError = (error: any): boolean => {
  if (!error) return false;
  
  // Check for Supabase auth errors
  if (error.message) {
    const errorMsg = error.message.toLowerCase();
    if (
      errorMsg.includes('jwt') ||
      errorMsg.includes('token') ||
      errorMsg.includes('expired') ||
      errorMsg.includes('unauthorized') ||
      errorMsg.includes('authentication') ||
      errorMsg.includes('session')
    ) {
      return true;
    }
  }
  
  // Check for HTTP status codes
  if (error.status === 401 || error.status === 403) {
    return true;
  }
  
  // Check for Supabase error codes
  if (error.code === 'PGRST301' || error.code === 'PGRST116') {
    return true;
  }
  
  return false;
};

// Wrapper function for Supabase queries that automatically handles auth errors
export const safeSupabaseQuery = async <T>(
  queryFn: () => Promise<{ data: T | null; error: any }>
): Promise<{ data: T | null; error: any }> => {
  try {
    const result = await queryFn();
    
    // Check if the error is an authentication error
    if (result.error && isAuthError(result.error)) {
      console.error('Authentication error detected in query:', result.error);
      // Handle session expiration immediately
      await handleSessionExpiration();
      return { data: null, error: result.error };
    }
    
    return result;
  } catch (error: any) {
    // Check if the caught error is an authentication error
    if (isAuthError(error)) {
      console.error('Authentication error caught in query:', error);
      await handleSessionExpiration();
      return { data: null, error };
    }
    // Re-throw non-auth errors
    throw error;
  }
};

// Simplified session manager - let Supabase handle auto-refresh
export const sessionManager = {
  async getSession() {
    try {
      // Simply get the session - Supabase handles refresh automatically
      const { data: { session }, error } = await supabase.auth.getSession();
      if (error) {
        console.error('Error getting session:', error);
        // If it's an auth error, handle expiration
        if (isAuthError(error)) {
          await handleSessionExpiration();
        }
        return null;
      }
      return session;
    } catch (error) {
      console.error('Error getting session:', error);
      // If it's an auth error, handle expiration
      if (isAuthError(error)) {
        await handleSessionExpiration();
      }
      return null;
    }
  },

  isSessionExpired(session: any): boolean {
    if (!session?.expires_at) return false; // If no expiration, assume valid
    
    try {
      const expiresAt = typeof session.expires_at === 'number' 
        ? session.expires_at * 1000 
        : new Date(session.expires_at).getTime();
      
      // Only consider expired if past expiration time (no buffer)
      return Date.now() >= expiresAt;
    } catch (e) {
      // If we can't parse, assume valid (let Supabase handle it)
      return false;
    }
  },
  
  // Check session and handle expiration immediately
  async checkAndHandleExpiration(): Promise<boolean> {
    try {
      // Check if another tab is redirecting (with small delay to avoid race conditions)
      if (typeof window !== 'undefined') {
        const redirectingUntil = localStorage.getItem(REDIRECTING_KEY);
        if (redirectingUntil) {
          const until = parseInt(redirectingUntil, 10);
          if (Date.now() < until) {
            // Another tab is redirecting, wait a bit but not too long (max 500ms)
            await new Promise(resolve => setTimeout(resolve, Math.min(500, until - Date.now())));
            // Re-check after delay
            const { data: { session } } = await supabase.auth.getSession();
            if (!session || !session.user) {
              return true; // Session is invalid, let the other tab handle redirect
            }
            // Session exists, continue with check
          } else {
            // Stale flag, clear it
            localStorage.removeItem(REDIRECTING_KEY);
          }
        }
      }
      
      const session = await this.getSession();
      if (!session) {
        await handleSessionExpiration();
        return true; // Session expired
      }
      if (this.isSessionExpired(session)) {
        await handleSessionExpiration();
        return true; // Session expired
      }
      return false; // Session valid
    } catch (e) {
      console.error('Error in checkAndHandleExpiration:', e);
      // Only redirect if it's an auth error
      if (isAuthError(e)) {
        await handleSessionExpiration();
        return true;
      }
      return false; // Non-auth error, don't redirect
    }
  }
};

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