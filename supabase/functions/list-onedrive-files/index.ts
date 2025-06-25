import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { Client } from 'https://esm.sh/@microsoft/microsoft-graph-client@3.0.7';
import { type AuthenticationProvider } from 'https://esm.sh/@microsoft/microsoft-graph-client@3.0.7';
import 'https://deno.land/x/dotenv/load.ts';

const tenantId = Deno.env.get('MSAL_TENANT_ID');
const clientId = Deno.env.get('MSAL_CLIENT_ID');
const clientSecret = Deno.env.get('CLIENT_SECRET');
const targetUserId = Deno.env.get('USER_ID');

if (!tenantId || !clientId || !clientSecret || !targetUserId) {
  throw new Error('Missing one or more required environment variables.');
}

const getAccessToken = async (): Promise<string> => {
  const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: clientId,
    scope: 'https://graph.microsoft.com/.default',
    client_secret: clientSecret,
    grant_type: 'client_credentials',
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorData = await response.text();
    throw new Error(`Failed to get access token: ${response.status} ${errorData}`);
  }

  const data = await response.json();
  return data.access_token;
};

const customAuthProvider: AuthenticationProvider = {
  getAccessToken: async () => {
    return await getAccessToken();
  },
};

const graphClient = Client.initWithMiddleware({ authProvider: customAuthProvider });

serve(async (req) => {
  console.log('Function called with method:', req.method);
  
  // CORS preflight
  if (req.method === 'OPTIONS') {
    console.log('Handling CORS preflight');
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    console.log('Parsing request body...');
    const body = await req.json();
    console.log('Request body:', body);
    
    const { leadNumber } = body;

    if (!leadNumber) {
      console.error('Missing leadNumber parameter');
      throw new Error('Missing leadNumber parameter.');
    }

    console.log('Processing lead number:', leadNumber);

    const folderName = `Lead_${leadNumber.replace(/ /g, '_')}`;
    const folderPath = `/Leads/${folderName}`;
    console.log('Looking for folder:', folderPath);

    // Get the folder and its contents
    const folderItems = await graphClient
      .api(`/users/${targetUserId}/drive/root:${folderPath}:/children`)
      .get();

    if (!folderItems || !folderItems.value) {
      return new Response(JSON.stringify({ 
        success: true, 
        files: [],
        message: 'No files found in folder'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Filter out folders and only return files
    const files = folderItems.value
      .filter((item: any) => !item.folder) // Only files, not folders
      .map((file: any) => ({
        id: file.id,
        name: file.name,
        size: file.size,
        lastModified: file.lastModifiedDateTime,
        downloadUrl: file['@microsoft.graph.downloadUrl'],
        webUrl: file.webUrl,
        fileType: file.file?.mimeType || 'application/octet-stream'
      }));

    return new Response(JSON.stringify({
      success: true,
      files: files,
      message: `Found ${files.length} files`
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Function Error:', error.message);
    console.error('Full error:', error);
    return new Response(JSON.stringify({ 
      error: error.message,
      details: error.toString()
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
}); 