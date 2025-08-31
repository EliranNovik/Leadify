import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Initialize Supabase
const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

// Graph API configuration
const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0';
// Webhook configuration
const WEBHOOK_URL = Deno.env.get('GRAPH_WEBHOOK_URL') || 'https://2ceff3172057.ngrok-free.app';
const WEBHOOK_CLIENT_STATE = Deno.env.get('GRAPH_WEBHOOK_CLIENT_STATE') || 'leadify-crm-webhook-secret';

interface GraphSubscription {
  id: string;
  resource: string;
  changeType: string;
  clientState: string;
  notificationUrl: string;
  expirationDateTime: string;
  includeResourceData: boolean;
}

interface SubscriptionResponse {
  success: boolean;
  subscription?: GraphSubscription;
  error?: string;
  message?: string;
}

// Get access token using client credentials
async function getServiceToken(): Promise<string | null> {
  try {
    const clientId = Deno.env.get('AZURE_CLIENT_ID');
    const clientSecret = Deno.env.get('AZURE_CLIENT_SECRET');
    const tenantId = Deno.env.get('AZURE_TENANT_ID');

    if (!clientId || !clientSecret || !tenantId) {
      console.error('Missing Azure AD configuration');
      return null;
    }

    const tokenResponse = await fetch(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          scope: 'https://graph.microsoft.com/.default',
          grant_type: 'client_credentials',
        }),
      }
    );

    if (!tokenResponse.ok) {
      console.error('Failed to get access token:', tokenResponse.status);
      return null;
    }

    const tokenData = await tokenResponse.json();
    return tokenData.access_token;
  } catch (error) {
    console.error('Error getting service token:', error);
    return null;
  }
}

// Create multiple subscriptions for comprehensive coverage
async function createComprehensiveSubscriptions(accessToken: string): Promise<GraphSubscription[]> {
  const subscriptions = [];
  const expirationDate = new Date();
  expirationDate.setMinutes(expirationDate.getMinutes() + 45); // 45 minutes from now

  // Subscription 1: Online meetings
  const onlineMeetingSubscription = {
    changeType: 'created',
    notificationUrl: WEBHOOK_URL,
    resource: 'communications/onlineMeetings',
    expirationDateTime: expirationDate.toISOString(),
    clientState: WEBHOOK_CLIENT_STATE,
    includeResourceData: false
  };

  // Subscription 2: Call records (for transcripts)
  const callRecordSubscription = {
    changeType: 'created',
    notificationUrl: WEBHOOK_URL,
    resource: 'communications/callRecords',
    expirationDateTime: expirationDate.toISOString(),
    clientState: WEBHOOK_CLIENT_STATE,
    includeResourceData: false
  };

  // Subscription 3: Events (for calendar events)
  const eventSubscription = {
    changeType: 'created',
    notificationUrl: WEBHOOK_URL,
    resource: 'me/events',
    expirationDateTime: expirationDate.toISOString(),
    clientState: WEBHOOK_CLIENT_STATE,
    includeResourceData: false
  };

  const subscriptionData = [onlineMeetingSubscription, callRecordSubscription, eventSubscription];

  for (const data of subscriptionData) {
    try {
      const response = await fetch(`${GRAPH_API_BASE}/subscriptions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Failed to create subscription for ${data.resource}:`, response.status, errorText);
        continue;
      }

      const subscription = await response.json();
      
      subscriptions.push(subscription);
    } catch (error) {
      console.error(`Error creating subscription for ${data.resource}:`, error);
    }
  }

  return subscriptions;
}

// List existing subscriptions
async function listSubscriptions(accessToken: string): Promise<GraphSubscription[]> {
  try {
    const response = await fetch(`${GRAPH_API_BASE}/subscriptions`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      console.error('Failed to list subscriptions:', response.status);
      return [];
    }

    const data = await response.json();
    return data.value || [];
  } catch (error) {
    console.error('Error listing subscriptions:', error);
    return [];
  }
}

// Renew a subscription
async function renewSubscription(accessToken: string, subscriptionId: string): Promise<boolean> {
  try {
    const expirationDate = new Date();
    expirationDate.setMinutes(expirationDate.getMinutes() + 45); // 45 minutes from now

    const updateData = {
      expirationDateTime: expirationDate.toISOString()
    };

    const response = await fetch(`${GRAPH_API_BASE}/subscriptions/${subscriptionId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(updateData)
    });

    if (!response.ok) {
      console.error('Failed to renew subscription:', response.status);
      return false;
    }

    
    return true;
  } catch (error) {
    console.error('Error renewing subscription:', error);
    return false;
  }
}

// Delete a subscription
async function deleteSubscription(accessToken: string, subscriptionId: string): Promise<boolean> {
  try {
    const response = await fetch(`${GRAPH_API_BASE}/subscriptions/${subscriptionId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      console.error('Failed to delete subscription:', response.status);
      return false;
    }

    
    return true;
  } catch (error) {
    console.error('Error deleting subscription:', error);
    return false;
  }
}

// Find transcript subscription
function findTranscriptSubscription(subscriptions: GraphSubscription[]): GraphSubscription | null {
  return subscriptions.find(sub => 
    sub.resource === 'communications/onlineMeetings/getAllTranscripts' &&
    sub.notificationUrl === WEBHOOK_URL
  ) || null;
}

// Check if subscription is expiring soon (within 10 minutes)
function isSubscriptionExpiringSoon(subscription: GraphSubscription): boolean {
  const expirationDate = new Date(subscription.expirationDateTime);
  const now = new Date();
  const timeUntilExpiry = expirationDate.getTime() - now.getTime();
  return timeUntilExpiry < 10 * 60 * 1000; // 10 minutes
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { action, ...params } = await req.json();


    // Get access token
    const accessToken = await getServiceToken();
    if (!accessToken) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Failed to get Azure access token. Check AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, and AZURE_TENANT_ID.' 
        } as SubscriptionResponse),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 401 
        }
      );
    }

    let response: SubscriptionResponse;

    switch (action) {
      case 'test-token':
        // Test token generation
        response = {
          success: true,
          message: 'Azure token generated successfully',
          subscription: {
            id: 'test',
            resource: 'test',
            changeType: 'test',
            clientState: 'test',
            notificationUrl: 'test',
            expirationDateTime: 'test',
            includeResourceData: false
          }
        };
        break;

      case 'create':
        // Create a new subscription
        const newSubscription = await createComprehensiveSubscriptions(accessToken);
        if (newSubscription.length > 0) {
          response = {
            success: true,
            subscription: newSubscription[0], // Return the first one for simplicity
            message: 'Comprehensive subscriptions created successfully'
          };
        } else {
          response = {
            success: false,
            error: 'Failed to create comprehensive subscriptions'
          };
        }
        break;

      case 'list':
        // List all subscriptions
        const subscriptions = await listSubscriptions(accessToken);
        const transcriptSubscription = findTranscriptSubscription(subscriptions);
        
        response = {
          success: true,
          subscription: transcriptSubscription || undefined,
          message: `Found ${subscriptions.length} subscriptions, ${transcriptSubscription ? '1' : '0'} transcript subscription`
        };
        break;

      case 'renew':
        // Renew existing subscription
        const existingSubscriptions = await listSubscriptions(accessToken);
        const existingSubscription = findTranscriptSubscription(existingSubscriptions);
        
        if (!existingSubscription) {
          response = {
            success: false,
            error: 'No transcript subscription found to renew'
          };
        } else {
          const renewed = await renewSubscription(accessToken, existingSubscription.id);
          if (renewed) {
            response = {
              success: true,
              subscription: existingSubscription,
              message: 'Subscription renewed successfully'
            };
          } else {
            response = {
              success: false,
              error: 'Failed to renew subscription'
            };
          }
        }
        break;

      case 'delete':
        // Delete subscription
        const subsToDelete = await listSubscriptions(accessToken);
        const subToDelete = findTranscriptSubscription(subsToDelete);
        
        if (!subToDelete) {
          response = {
            success: false,
            error: 'No transcript subscription found to delete'
          };
        } else {
          const deleted = await deleteSubscription(accessToken, subToDelete.id);
          if (deleted) {
            response = {
              success: true,
              message: 'Subscription deleted successfully'
            };
          } else {
            response = {
              success: false,
              error: 'Failed to delete subscription'
            };
          }
        }
        break;

      case 'status':
        // Check subscription status
        const allSubscriptions = await listSubscriptions(accessToken);
        const transcriptSub = findTranscriptSubscription(allSubscriptions);
        
        if (!transcriptSub) {
          response = {
            success: false,
            error: 'No transcript subscription found'
          };
        } else {
          const expiringSoon = isSubscriptionExpiringSoon(transcriptSub);
          response = {
            success: true,
            subscription: transcriptSub,
            message: expiringSoon ? 'Subscription expiring soon' : 'Subscription active'
          };
        }
        break;

      case 'auto-renew':
        // Automatically renew if expiring soon
        const currentSubscriptions = await listSubscriptions(accessToken);
        const currentSubscription = findTranscriptSubscription(currentSubscriptions);
        
        if (!currentSubscription) {
          // Create new subscription if none exists
          const newSub = await createComprehensiveSubscriptions(accessToken);
          if (newSub.length > 0) {
            response = {
              success: true,
              subscription: newSub[0], // Return the first one for simplicity
              message: 'Created new comprehensive subscriptions'
            };
          } else {
            response = {
              success: false,
              error: 'Failed to create new comprehensive subscriptions'
            };
          }
        } else if (isSubscriptionExpiringSoon(currentSubscription)) {
          // Renew if expiring soon
          const renewed = await renewSubscription(accessToken, currentSubscription.id);
          if (renewed) {
            response = {
              success: true,
              subscription: currentSubscription,
              message: 'Subscription renewed'
            };
          } else {
            response = {
              success: false,
              error: 'Failed to renew subscription'
            };
          }
        } else {
          // Subscription is fine
          response = {
            success: true,
            subscription: currentSubscription,
            message: 'Subscription is active'
          };
        }
        break;

      default:
        response = {
          success: false,
          error: 'Invalid action. Use: create, list, renew, delete, status, or auto-renew'
        };
    }

    return new Response(
      JSON.stringify(response),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: response.success ? 200 : 400 
      }
    );

  } catch (error) {
    console.error('Error in subscription manager:', error);
    
    const response: SubscriptionResponse = {
      success: false,
      error: error.message || 'Internal server error'
    };

    return new Response(
      JSON.stringify(response),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    );
  }
})
