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

// Manually implement token acquisition
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

// Create a custom authentication provider
const customAuthProvider: AuthenticationProvider = {
  getAccessToken: async () => {
    return await getAccessToken();
  },
};

const graphClient = Client.initWithMiddleware({ authProvider: customAuthProvider });

serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const leadNumber = formData.get('leadNumber') as string;
    const isEmailAttachment = formData.get('isEmailAttachment') as string === 'true';

    if (!file) throw new Error('Missing file in request.');

    let uploadFolderId: string;
    let responseData: object;

    if (isEmailAttachment) {
      // Logic for email attachments: upload to a temp folder, then use the ID
      // This uses a simpler, more robust method for files under 4MB.
      const uploadUrl = `/users/${targetUserId}/drive/root:/Email_Attachments/${file.name}:/content`;
      
      const uploadedFile = await graphClient.api(uploadUrl).put(file.stream());

      if (!uploadedFile || !uploadedFile.id) {
        throw new Error('Could not get ID from uploaded attachment.');
      }

      responseData = {
        success: true,
        message: 'Attachment prepared successfully!',
        attachmentId: uploadedFile.id,
      };

    } else {
      // Existing logic for lead document uploads
      if (!leadNumber) throw new Error('Missing leadNumber for document upload.');

      const folderName = `Lead_${leadNumber.replace(/ /g, '_')}`;

      // 1. Find or create the folder for the lead
      // The folder is created inside a general "Leads" directory for organization.
      let driveItem;
      try {
        driveItem = await graphClient
          .api(`/users/${targetUserId}/drive/root:/Leads/${folderName}`)
          .get();
      } catch (error) {
        if (error.statusCode === 404) {
          driveItem = await graphClient
            .api(`/users/${targetUserId}/drive/root:/Leads:/children`)
            .post({
              name: folderName,
              folder: {},
              '@microsoft.graph.conflictBehavior': 'rename',
            });
        } else {
          throw error;
        }
      }

      if (!driveItem || !driveItem.id) {
        throw new Error('Could not create or find the lead-specific folder.');
      }
      uploadFolderId = driveItem.id;
      
      // 2. Create a shareable link for the folder with organization scope
      const permission = await graphClient
        .api(`/users/${targetUserId}/drive/items/${uploadFolderId}/createLink`)
        .post({
          type: 'view',
          scope: 'organization',
        });

      if (!permission || !permission.link || !permission.link.webUrl) {
        throw new Error('Could not create a shareable link for the folder.');
      }
      
      const shareableLink = permission.link.webUrl;

      // 3. Upload the file to that folder
      const fileBuffer = await file.arrayBuffer();
      const uploadUrl = `/users/${targetUserId}/drive/items/${uploadFolderId}:/${file.name}:/content`;
      
      await graphClient.api(uploadUrl).put(fileBuffer);

      responseData = {
        success: true,
        message: 'File uploaded successfully!',
        folderUrl: shareableLink, // Return the shareable link
      };
    }

    return new Response(JSON.stringify(responseData), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Function Error:', error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
