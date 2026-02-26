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

// Storage key for cross-tab coordination
const REDIRECTING_KEY = 'supabase_auth_redirecting';
const REDIRECTING_TIMEOUT = 1000; // 1 second

// Function to handle session expiration and redirect
export const handleSessionExpiration = async () => {
  if (typeof window === 'undefined') return;
  
  // Check if another tab is already redirecting
  const redirectingUntil = localStorage.getItem(REDIRECTING_KEY);
  if (redirectingUntil) {
    const until = parseInt(redirectingUntil, 10);
    if (Date.now() < until) {
      // Another tab is redirecting, don't do anything
      console.log('Another tab is handling redirect');
      return;
    } else {
      // Stale flag, clear it
      localStorage.removeItem(REDIRECTING_KEY);
    }
  }
  
  // Set flag in localStorage to coordinate across tabs
  const redirectUntil = Date.now() + REDIRECTING_TIMEOUT;
  localStorage.setItem(REDIRECTING_KEY, redirectUntil.toString());
  
  try {
    console.log('Session expired - signing out and redirecting to login');
    // Clear auth state immediately
    await supabase.auth.signOut();
    
    // Clear any cached session data
    Object.keys(localStorage).forEach(key => {
      if (key.includes('supabase.auth.token')) {
        localStorage.removeItem(key);
      }
    });
    
    // Clear redirecting flag
    localStorage.removeItem(REDIRECTING_KEY);
    
    // Only redirect if we're not already on login page
    if (window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
  } catch (error) {
    console.error('Error during session expiration handling:', error);
    // Even if signOut fails, still redirect
    localStorage.removeItem(REDIRECTING_KEY);
    if (window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
  }
};

// Helper function to check if an error is an authentication error
// IMPORTANT: This should NOT return true for network errors
export const isAuthError = (error: any): boolean => {
  if (!error) return false;
  
  // First check if it's a network error - these are NOT auth errors
  if (isNetworkError(error)) {
    return false;
  }
  
  // Check for Supabase auth errors
  if (error.message) {
    const errorMsg = error.message.toLowerCase();
    // Exclude network-related messages that might contain "token" or "session"
    if (
      !errorMsg.includes('network') &&
      !errorMsg.includes('timeout') &&
      !errorMsg.includes('fetch') &&
      !errorMsg.includes('connection') &&
      (
        errorMsg.includes('jwt') ||
        errorMsg.includes('token expired') ||
        errorMsg.includes('token invalid') ||
        errorMsg.includes('unauthorized') ||
        errorMsg.includes('authentication failed') ||
        errorMsg.includes('session expired') ||
        errorMsg.includes('invalid session')
      )
    ) {
      return true;
    }
  }
  
  // Check for HTTP status codes (but not network errors with status 0)
  if (error.status === 401 || error.status === 403) {
    // Double-check it's not a network error
    if (error.status !== 0) {
      return true;
    }
  }
  
  // Check for Supabase error codes
  if (error.code === 'PGRST301' || error.code === 'PGRST116') {
    return true;
  }
  
  return false;
};

// Wrapper function for Supabase queries that automatically handles auth errors
// LESS AGGRESSIVE - only redirects on confirmed auth failures, not network errors
export const safeSupabaseQuery = async <T>(
  queryFn: () => Promise<{ data: T | null; error: any }>,
  retryCount = 0
): Promise<{ data: T | null; error: any }> => {
  const MAX_RETRIES = 2;
  
  try {
    const result = await queryFn();
    
    // Check if the error is an authentication error
    if (result.error) {
      // If it's a network error, retry before treating as auth failure
      if (isNetworkError(result.error) && retryCount < MAX_RETRIES) {
        console.warn(`Network error in query, retrying (${retryCount + 1}/${MAX_RETRIES}):`, result.error);
        await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
        return safeSupabaseQuery(queryFn, retryCount + 1);
      }
      
      // Only handle expiration for confirmed auth errors (not network errors)
      if (isAuthError(result.error) && !isNetworkError(result.error)) {
        console.error('Authentication error detected in query:', result.error);
        // Don't immediately redirect - let the component handle it
        // This prevents false positives from transient errors
        return { data: null, error: result.error };
      }
      
      // Network errors - return error but don't redirect
      return result;
    }
    
    return result;
  } catch (error: any) {
    // If it's a network error, retry before treating as auth failure
    if (isNetworkError(error) && retryCount < MAX_RETRIES) {
      console.warn(`Network error in query catch, retrying (${retryCount + 1}/${MAX_RETRIES}):`, error);
      await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
      return safeSupabaseQuery(queryFn, retryCount + 1);
    }
    
    // Check if the caught error is an authentication error
    if (isAuthError(error) && !isNetworkError(error)) {
      console.error('Authentication error caught in query:', error);
      // Don't immediately redirect - let the component handle it
      return { data: null, error };
    }
    
    // Re-throw non-auth errors
    throw error;
  }
};

// Helper to check if error is a network/transient error (not a real auth failure)
const isNetworkError = (error: any): boolean => {
  if (!error) return false;
  const errorMsg = String(error.message || error).toLowerCase();
  return (
    errorMsg.includes('network') ||
    errorMsg.includes('timeout') ||
    errorMsg.includes('fetch') ||
    errorMsg.includes('connection') ||
    errorMsg.includes('failed to fetch') ||
    error.status === 0 || // Network error status
    error.code === 'ECONNABORTED' ||
    error.code === 'ETIMEDOUT'
  );
};

// Simplified session manager - let Supabase handle auto-refresh
export const sessionManager = {
  async getSession(retryCount = 0): Promise<any> {
    const MAX_RETRIES = 2;
    
    try {
      // Simply get the session - Supabase handles refresh automatically
      const { data: { session }, error } = await supabase.auth.getSession();
      
      if (error) {
        // If it's a network error, retry before giving up
        if (isNetworkError(error) && retryCount < MAX_RETRIES) {
          console.warn(`Network error getting session, retrying (${retryCount + 1}/${MAX_RETRIES}):`, error);
          await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1))); // Exponential backoff
          return this.getSession(retryCount + 1);
        }
        
        console.error('Error getting session:', error);
        
        // Only handle expiration for confirmed auth errors (not network errors)
        // Don't immediately redirect - let the caller decide
        if (isAuthError(error) && !isNetworkError(error)) {
          // This is a real auth error, but don't redirect here - let checkAndHandleExpiration decide
          return null;
        }
        
        // For network errors, return null but don't treat as auth failure
        return null;
      }
      
      return session;
    } catch (error) {
      // If it's a network error, retry before giving up
      if (isNetworkError(error) && retryCount < MAX_RETRIES) {
        console.warn(`Network error in getSession catch, retrying (${retryCount + 1}/${MAX_RETRIES}):`, error);
        await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
        return this.getSession(retryCount + 1);
      }
      
      console.error('Error getting session:', error);
      
      // Only treat as auth error if it's confirmed (not network error)
      if (isAuthError(error) && !isNetworkError(error)) {
        return null;
      }
      
      // Network errors - return null but don't treat as auth failure
      return null;
    }
  },

  isSessionExpired(session: any): boolean {
    // Trust Supabase's auto-refresh mechanism
    // Don't manually check expiration - Supabase handles this
    // Only return true if session is explicitly null/undefined
    if (!session || !session.user) {
      return true;
    }
    
    // If Supabase says the session exists, trust it
    // Supabase will automatically refresh tokens before they expire
    // Manual expiration checks can cause false positives
    return false;
  },
  
  // Check session and handle expiration - LESS AGGRESSIVE
  async checkAndHandleExpiration(): Promise<boolean> {
    try {
      // Check if another tab is redirecting
      if (typeof window !== 'undefined') {
        const redirectingUntil = localStorage.getItem(REDIRECTING_KEY);
        if (redirectingUntil) {
          const until = parseInt(redirectingUntil, 10);
          if (Date.now() < until) {
            // Another tab is redirecting, don't do anything
            return false; // Don't treat as expired - another tab is handling it
          } else {
            // Stale flag, clear it
            localStorage.removeItem(REDIRECTING_KEY);
          }
        }
      }
      
      // Get session with retry logic for network errors
      const session = await this.getSession();
      
      // If no session, check if there's a stored session in localStorage
      // This helps with mobile browsers that might have cleared session but still have tokens
      if (!session && typeof window !== 'undefined') {
        try {
          // Check if there are any Supabase auth tokens in localStorage
          let hasStoredTokens = false;
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && (key.includes('supabase.auth.token') || (key.includes('sb-') && key.includes('-auth-token')))) {
              hasStoredTokens = true;
              break;
            }
          }
          
          // If we have stored tokens but no session, try to refresh
          // This helps with mobile persistence issues
          if (hasStoredTokens) {
            console.log('Found stored tokens but no session, attempting to refresh...');
            // Give Supabase a chance to restore the session
            // Don't immediately redirect - let Supabase's auto-refresh handle it
            return false; // Don't treat as expired yet
          }
        } catch (e) {
          // localStorage access failed (might be private mode or disabled)
          console.warn('Could not check localStorage for tokens:', e);
        }
      }
      
      // If we have a session, it's valid (Supabase handles expiration)
      if (session?.user) {
        return false; // Session is valid
      }
      
      // No session and no stored tokens - only then consider expired
      // But don't immediately redirect - let AuthContext handle it more gracefully
      return true; // Session expired, but let caller decide what to do
    } catch (e) {
      console.error('Error in checkAndHandleExpiration:', e);
      
      // For network errors, don't treat as expired
      if (isNetworkError(e)) {
        return false; // Network error, don't treat as expired
      }
      
      // Only redirect if it's a confirmed auth error and we're not on login page
      if (isAuthError(e) && !isNetworkError(e) && typeof window !== 'undefined' && window.location.pathname !== '/login') {
        // Real auth error - but still let caller decide
        return true;
      }
      
      return false; // Non-auth error, don't treat as expired
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