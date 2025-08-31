import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface GraphWebhookRequest {
  validationToken?: string;
  clientState?: string;
  value?: Array<{
    subscriptionId: string;
    subscriptionExpirationDateTime: string;
    changeType: string;
    resource: string;
    resourceData: {
      '@odata.type': string;
      '@odata.id': string;
      id: string;
    };
  }>;
}

interface GraphWebhookResponse {
  success: boolean;
  message?: string;
  validationToken?: string;
  error?: string;
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
