import { supabase } from './supabase';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export interface GraphSubscription {
  id: string;
  resource: string;
  changeType: string;
  clientState: string;
  notificationUrl: string;
  expirationDateTime: string;
  includeResourceData: boolean;
}

export interface SubscriptionResponse {
  success: boolean;
  subscription?: GraphSubscription;
  error?: string;
  message?: string;
}

// Create a new Graph subscription
export async function createGraphSubscription(): Promise<SubscriptionResponse> {
  try {
    const { data, error } = await supabase.functions.invoke('graph-subscription-manager', {
      body: { action: 'create' }
    });

    if (error) {
      console.error('Error creating subscription:', error);
      return {
        success: false,
        error: error.message || 'Failed to create subscription'
      };
    }

    return data as SubscriptionResponse;
  } catch (error) {
    console.error('Error calling subscription manager:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

// List all Graph subscriptions
export async function listGraphSubscriptions(): Promise<SubscriptionResponse> {
  try {
    const { data, error } = await supabase.functions.invoke('graph-subscription-manager', {
      body: { action: 'list' }
    });

    if (error) {
      console.error('Error listing subscriptions:', error);
      return {
        success: false,
        error: error.message || 'Failed to list subscriptions'
      };
    }

    return data as SubscriptionResponse;
  } catch (error) {
    console.error('Error calling subscription manager:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

// Renew an existing Graph subscription
export async function renewGraphSubscription(): Promise<SubscriptionResponse> {
  try {
    const { data, error } = await supabase.functions.invoke('graph-subscription-manager', {
      body: { action: 'renew' }
    });

    if (error) {
      console.error('Error renewing subscription:', error);
      return {
        success: false,
        error: error.message || 'Failed to renew subscription'
      };
    }

    return data as SubscriptionResponse;
  } catch (error) {
    console.error('Error calling subscription manager:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

// Delete a Graph subscription
export async function deleteGraphSubscription(): Promise<SubscriptionResponse> {
  try {
    const { data, error } = await supabase.functions.invoke('graph-subscription-manager', {
      body: { action: 'delete' }
    });

    if (error) {
      console.error('Error deleting subscription:', error);
      return {
        success: false,
        error: error.message || 'Failed to delete subscription'
      };
    }

    return data as SubscriptionResponse;
  } catch (error) {
    console.error('Error calling subscription manager:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

// Check subscription status
export async function getSubscriptionStatus(): Promise<SubscriptionResponse> {
  try {
    const { data, error } = await supabase.functions.invoke('graph-subscription-manager', {
      body: { action: 'status' }
    });

    if (error) {
      console.error('Error getting subscription status:', error);
      return {
        success: false,
        error: error.message || 'Failed to get subscription status'
      };
    }

    return data as SubscriptionResponse;
  } catch (error) {
    console.error('Error calling subscription manager:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

// Auto-renew subscription (creates if doesn't exist, renews if expiring soon)
export async function autoRenewSubscription(): Promise<SubscriptionResponse> {
  try {
    const { data, error } = await supabase.functions.invoke('graph-subscription-manager', {
      body: { action: 'auto-renew' }
    });

    if (error) {
      console.error('Error auto-renewing subscription:', error);
      return {
        success: false,
        error: error.message || 'Failed to auto-renew subscription'
      };
    }

    return data as SubscriptionResponse;
  } catch (error) {
    console.error('Error calling subscription manager:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

// Check if subscription is expiring soon (within 10 minutes)
export function isSubscriptionExpiringSoon(subscription: GraphSubscription): boolean {
  const expirationDate = new Date(subscription.expirationDateTime);
  const now = new Date();
  const timeUntilExpiry = expirationDate.getTime() - now.getTime();
  return timeUntilExpiry < 10 * 60 * 1000; // 10 minutes
}

// Get time until subscription expires (in minutes)
export function getTimeUntilExpiry(subscription: GraphSubscription): number {
  const expirationDate = new Date(subscription.expirationDateTime);
  const now = new Date();
  const timeUntilExpiry = expirationDate.getTime() - now.getTime();
  return Math.round(timeUntilExpiry / (1000 * 60)); // Convert to minutes
}

// Format subscription status for display
export function formatSubscriptionStatus(subscription: GraphSubscription): {
  status: 'active' | 'expiring' | 'expired';
  message: string;
  timeUntilExpiry: number;
} {
  const timeUntilExpiry = getTimeUntilExpiry(subscription);
  
  if (timeUntilExpiry <= 0) {
    return {
      status: 'expired',
      message: 'Subscription has expired',
      timeUntilExpiry: 0
    };
  } else if (timeUntilExpiry < 10) {
    return {
      status: 'expiring',
      message: `Subscription expires in ${timeUntilExpiry} minutes`,
      timeUntilExpiry
    };
  } else {
    return {
      status: 'active',
      message: `Subscription active for ${timeUntilExpiry} minutes`,
      timeUntilExpiry
    };
  }
}
