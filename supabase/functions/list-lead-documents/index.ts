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

// Token acquisition (client credentials)
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

// Helper: ensure the specific lead folder exists, and return its drive item
// Priority:
// 1) Try `/Leads/Lead_<number>`  (current correct path)
// 2) Fallback to `/Documents/Leads/Lead_<number>` if it already exists
// 3) If still not found, create `/Leads` and then `/Leads/Lead_<number>`
const ensureLeadFolder = async (leadNumber: string) => {
  const normalizedLeadNumber = leadNumber.replace(/ /g, '_');

  // Primary folder name uses the lead number as-is
  const primaryFolderName = `Lead_${normalizedLeadNumber}`;

  // Alternate folder name swaps L/C prefix when applicable, to handle legacy renames
  let alternateFolderName: string | null = null;
  if (normalizedLeadNumber.startsWith('L') || normalizedLeadNumber.startsWith('C')) {
    const altPrefix = normalizedLeadNumber[0] === 'L' ? 'C' : 'L';
    alternateFolderName = `Lead_${altPrefix}${normalizedLeadNumber.slice(1)}`;
  }

  // Helper to try a given folder name under `/Leads` and return if found
  const tryLeadsRootFolder = async (folderName: string) => {
    try {
      const leadFolder = await graphClient
        .api(`/users/${targetUserId}/drive/root:/Leads/${folderName}`)
        .get();

      if (leadFolder && leadFolder.id) {
        return leadFolder;
      }
    } catch (error) {
      // @ts-ignore - Graph error shape
      if (error.statusCode !== 404) {
        throw error;
      }
    }
    return null;
  };

  // 1) Try to find `/Leads/Lead_<number>` directly (primary, then alternate L/C prefix)
  let leadFolder = await tryLeadsRootFolder(primaryFolderName);
  if (!leadFolder && alternateFolderName) {
    leadFolder = await tryLeadsRootFolder(alternateFolderName);
  }
  if (leadFolder) return leadFolder;

  // Helper to try a given folder name under `/Documents/Leads`
  const tryDocumentsLeadsFolder = async (folderName: string) => {
    try {
      const legacyLeadFolder = await graphClient
        .api(`/users/${targetUserId}/drive/root:/Documents/Leads/${folderName}`)
        .get();
      if (legacyLeadFolder && legacyLeadFolder.id) {
        return legacyLeadFolder;
      }
    } catch (error) {
      // @ts-ignore
      if (error.statusCode !== 404) {
        throw error;
      }
    }
    return null;
  };

  // 2) Fallback: check if an older `/Documents/Leads/Lead_<number>` exists (primary, then alternate)
  let legacyLeadFolder = await tryDocumentsLeadsFolder(primaryFolderName);
  if (!legacyLeadFolder && alternateFolderName) {
    legacyLeadFolder = await tryDocumentsLeadsFolder(alternateFolderName);
  }
  if (legacyLeadFolder) return legacyLeadFolder;

  // 3) Create `/Leads` (if needed) and then `/Leads/Lead_<number>`
  let leadsRoot: any;
  try {
    leadsRoot = await graphClient
      .api(`/users/${targetUserId}/drive/root:/Leads`)
      .get();
  } catch (error) {
    // @ts-ignore
    if (error.statusCode === 404) {
      // Create `/Leads` at root
      leadsRoot = await graphClient
        .api(`/users/${targetUserId}/drive/root:/children`)
        .post({
          name: 'Leads',
          folder: {},
          '@microsoft.graph.conflictBehavior': 'rename',
        });
    } else {
      throw error;
    }
  }

  // Use a different variable name here so we don't conflict with the earlier `leadFolder`
  let createdLeadFolder: any;
  try {
    createdLeadFolder = await graphClient
      .api(`/users/${targetUserId}/drive/root:/Leads:/children`)
      .post({
        name: primaryFolderName,
        folder: {},
        '@microsoft.graph.conflictBehavior': 'rename',
      });
  } catch (error) {
    throw error;
  }

  if (!createdLeadFolder || !createdLeadFolder.id) {
    throw new Error('Could not create or find the lead-specific folder.');
  }

  return createdLeadFolder;
};

serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  let leadNumber = '';

  try {
    const body = await req.json().catch(() => ({}));
    leadNumber = (body.leadNumber || body.lead_number || '').toString().trim();

    if (!leadNumber) {
      return new Response(
        JSON.stringify({ success: false, error: 'leadNumber is required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 },
      );
    }

    console.log('📁 list-lead-documents: Resolving folder for lead', leadNumber);

    // Ensure folder exists and get drive item
    const leadFolder = await ensureLeadFolder(leadNumber);
    const folderId = leadFolder.id as string;

    // Create or reuse a shareable link for the folder (organization scope)
    let shareableLink = '';
    try {
      const permission = await graphClient
        .api(`/users/${targetUserId}/drive/items/${folderId}/createLink`)
        .post({
          type: 'view',
          scope: 'organization',
        });

      if (permission?.link?.webUrl) {
        shareableLink = permission.link.webUrl;
      }
    } catch (err) {
      console.log('list-lead-documents: createLink failed, continuing without folderUrl', err);
    }

    // List files in the lead folder
    const folderContents = await graphClient
      .api(`/users/${targetUserId}/drive/items/${folderId}/children`)
      .get();

    const files = (folderContents.value || [])
      .filter((item: any) => item.file) // only files
      .map((item: any) => ({
        id: item.id,
        name: item.name,
        webUrl: item.webUrl,
        downloadUrl: item['@microsoft.graph.downloadUrl'] || item.webUrl,
        lastModifiedDateTime: item.lastModifiedDateTime,
        size: item.size || 0,
        file: {
          mimeType: item.file.mimeType || 'application/octet-stream',
        },
      }));

    return new Response(
      JSON.stringify({
        success: true,
        leadNumber,
        folderId,
        folderUrl: shareableLink || leadFolder.webUrl || null,
        count: files.length,
        files,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
    );
  } catch (error: any) {
    console.error('Error in list-lead-documents:', error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error?.message || 'Internal server error',
        leadNumber,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 },
    );
  }
});


