import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Initialize Supabase
const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

// Webhook client state for tamper detection
const WEBHOOK_CLIENT_STATE = Deno.env.get('GRAPH_WEBHOOK_CLIENT_STATE') || 'leadify-crm-webhook-secret'

interface GraphNotification {
  subscriptionId: string;
  changeType: string;
  resource: string;
  resourceData?: { id?: string };
  encryptedContent?: any;
  clientState?: string;
}

interface GraphBody {
  value: GraphNotification[];
}

// Extract client ID from meeting subject using [#<clientId>] pattern
function extractClientId(subject: string): string | null {
  const match = subject.match(/\[#([^\]]+)\]/);
  return match ? match[1] : null;
}

// Get client ID from attendee emails (fallback method)
async function getClientIdFromAttendees(attendeeEmails: string[]): Promise<string | null> {
  if (!attendeeEmails.length) return null;
  
  try {
    const { data, error } = await supabase
      .from('leads')
      .select('id, email')
      .in('email', attendeeEmails)
      .limit(1)
      .single();
    
    if (error || !data) return null;
    return data.id;
  } catch (error) {
    console.error('Error getting client ID from attendees:', error);
    return null;
  }
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

// Process transcript notification
async function processTranscriptNotification(meetingId: string): Promise<boolean> {
  try {
    console.log('Processing transcript notification for meeting:', meetingId);
    
    const accessToken = await getServiceToken();
    if (!accessToken) {
      console.error('Failed to get access token for transcript processing');
      return false;
    }

    // Call the meeting summary function to process the transcript
    const { data, error } = await supabase.functions.invoke('meeting-summary', {
      body: {
        meetingId: meetingId,
        clientId: '0', // Default client ID, will be resolved in meeting-summary
        autoFetchTranscript: true
      }
    });

    if (error) {
      console.error('Error calling meeting-summary function:', error);
      return false;
    }

    console.log('Successfully processed transcript for meeting:', meetingId);
    return true;
  } catch (error) {
    console.error('Error processing transcript notification:', error);
    return false;
  }
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    
    // Handle validation requests from Microsoft Graph
    if (body.validationToken) {
      return new Response(body.validationToken, {
        headers: { ...corsHeaders, 'Content-Type': 'text/plain' },
        status: 200
      });
    }

    // Process webhook notifications
    if (body.value && Array.isArray(body.value)) {
      for (const notification of body.value) {
        await processNotification(notification);
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });

  } catch (error) {
    console.error('Error processing webhook:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500
    });
  }
});
