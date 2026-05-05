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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const isRetryableGraphError = (err: any) => {
  const status = Number(err?.statusCode ?? err?.status ?? NaN);
  if ([429, 500, 502, 503, 504].includes(status)) return true;
  const code = String(err?.code || err?.name || '').toLowerCase();
  if (code.includes('throttl') || code.includes('timeout') || code.includes('tempor')) return true;
  const msg = String(err?.message || '').toLowerCase();
  if (msg.includes('throttl') || msg.includes('timeout') || msg.includes('tempor')) return true;
  return false;
};

async function graphGetWithRetry<T>(fn: () => Promise<T>, opts?: { label?: string }) {
  const attempts = 4;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err: any) {
      if (i === attempts - 1 || !isRetryableGraphError(err)) throw err;
      const delay = 350 * Math.pow(2, i) + Math.floor(Math.random() * 200);
      console.log(`DEBUG: Graph retry ${i + 1}/${attempts} ${opts?.label || ''}`, err?.statusCode, err?.message);
      await sleep(delay);
    }
  }
  // unreachable
  return await fn();
}

const toBase64Url = (data: Uint8Array): string => {
  let binary = '';
  for (let i = 0; i < data.byteLength; i++) binary += String.fromCharCode(data[i]);
  const b64 = btoa(binary);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const encodeShareUrl = (url: string): string => {
  // Graph expects: u!{base64url(url)}
  const bytes = new TextEncoder().encode(url);
  return `u!${toBase64Url(bytes)}`;
};

const tryListFilesFromFolderUrl = async (folderUrlRaw: string) => {
  const folderUrl = String(folderUrlRaw || '').trim();
  if (!folderUrl) return null;

  try {
    const shareId = encodeShareUrl(folderUrl);
    const driveItem = await graphGetWithRetry(
      () => graphClient.api(`/shares/${shareId}/driveItem`).get(),
      { label: 'shares driveItem' },
    );

    const itemId = driveItem?.id;
    const parentDriveId = driveItem?.parentReference?.driveId;

    if (!itemId || !parentDriveId) {
      console.log('DEBUG: Could not resolve folderUrl to driveItem id/driveId');
      // Not a definitive "empty" result; allow fallback logic.
      return null;
    }

    const children = await graphGetWithRetry(
      () => graphClient.api(`/drives/${parentDriveId}/items/${itemId}/children`).get(),
      { label: 'shares children' },
    );
    const files = (children.value || [])
      .filter((item: any) => item.file)
      .map((item: any) => ({
        id: item.id,
        name: item.name,
        webUrl: item.webUrl,
        downloadUrl: item['@microsoft.graph.downloadUrl'] || item.webUrl,
        lastModifiedDateTime: item.lastModifiedDateTime,
        size: item.size || 0,
        file: {
          mimeType: item.file?.mimeType || 'application/octet-stream',
        },
      }));

    return files;
  } catch (error) {
    console.log('DEBUG: Failed resolving folderUrl via shares endpoint:', error?.statusCode, error?.message);
    return null;
  }
};

const mapDriveChildrenToFiles = (children: any) => {
  return (children?.value || [])
    .filter((item: any) => item.file)
    .map((item: any) => ({
      id: item.id,
      name: item.name,
      webUrl: item.webUrl,
      downloadUrl: item['@microsoft.graph.downloadUrl'] || item.webUrl,
      lastModifiedDateTime: item.lastModifiedDateTime,
      size: item.size || 0,
      file: {
        mimeType: item.file?.mimeType || 'application/octet-stream',
      },
    }));
};

const trySearchFolderByLeadNumber = async (leadNumber: string) => {
  const q = String(leadNumber || '').trim();
  if (!q) return null;

  // Search across the drive for anything matching the lead number.
  // We then pick a folder whose name contains the digits.
  try {
    console.log(`DEBUG: Searching drive for lead number: ${q}`);
    const results = await graphGetWithRetry(
      () => graphClient.api(`/users/${targetUserId}/drive/root/search(q='${q}')`).get(),
      { label: 'search leadNumber' },
    );
    const items = (results?.value || []).filter((it: any) => it?.folder);

    // Prefer folders containing the number and/or starting with "Lead_"
    const normalized = q.replace(/\s+/g, '');
    const best =
      items.find((it: any) => String(it?.name || '').includes(`Lead_${normalized}`)) ||
      items.find((it: any) => String(it?.name || '').includes(normalized)) ||
      items[0] ||
      null;

    if (!best?.id) return [];

    const driveId = best?.parentReference?.driveId;
    if (!driveId) return [];

    console.log(`DEBUG: Found folder via search:`, { name: best.name, id: best.id, driveId });
    const children = await graphGetWithRetry(
      () => graphClient.api(`/drives/${driveId}/items/${best.id}/children`).get(),
      { label: 'search children' },
    );
    return mapDriveChildrenToFiles(children);
  } catch (error) {
    console.log(`DEBUG: Search-by-lead-number failed:`, error?.statusCode, error?.message);
    // Not a definitive "no results"; signal failure so caller can decide.
    return null;
  }
};

const getOneDriveFiles = async (leadNumber: string) => {
  const folderName = `Lead_${leadNumber.replace(/ /g, '_')}`;
  
  console.log(`DEBUG: Looking for lead folder: ${folderName}`);
  console.log(`DEBUG: targetUserId: ${targetUserId}`);
  
  // First, let's see what's in the root directory
  try {
    const rootContents = await graphGetWithRetry(
      () => graphClient.api(`/users/${targetUserId}/drive/root/children`).get(),
      { label: 'root children' },
    );
    console.log(`DEBUG: Root directory contents:`, rootContents.value?.map((item: any) => item.name));
  } catch (error) {
    console.log(`DEBUG: Error accessing root directory:`, error);
  }
  
  // Try multiple possible paths
  const possiblePaths = [
    `/Documents/Leads/${folderName}`,
    `/Leads/${folderName}`,
    `/${folderName}`
  ];
  
  for (const path of possiblePaths) {
    console.log(`DEBUG: Trying path: ${path}`);
    try {
      const folderContents = await graphGetWithRetry(
        () => graphClient.api(`/users/${targetUserId}/drive/root:${path}/children`).get(),
        { label: `path children ${path}` },
      );

      console.log(`DEBUG: Found folder at path: ${path}`);
      
      const files = mapDriveChildrenToFiles(folderContents);

      return files;
    } catch (error) {
      console.log(`DEBUG: Path ${path} not found:`, error.statusCode, error.message);
      if (error.statusCode !== 404 && error.code !== "itemNotFound") {
        throw error;
      }
    }
  }
  
  // Let's also try to search for the folder by name
  try {
    console.log(`DEBUG: Searching for folder by name: ${folderName}`);
    const searchResults = await graphClient
      .api(`/users/${targetUserId}/drive/root/search(q='${folderName}')`)
      .get();
    console.log(`DEBUG: Search results:`, searchResults.value?.map((item: any) => ({ name: item.name, path: item.parentReference?.path })));
  } catch (error) {
    console.log(`DEBUG: Search error:`, error);
  }

  // Last resort: search by the lead number only (folders may have different naming)
  const searchByNumber = await trySearchFolderByLeadNumber(leadNumber);
  if (searchByNumber !== null) return searchByNumber;

  // Search failed (Graph error / throttling). Do NOT claim "folder not found".
  throw new Error('Temporary error while searching OneDrive. Please retry.');

};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  let leadNumber = ''; // Initialize leadNumber in outer scope
  
  try {
    const body = await req.json();
    const { leadNumber: bodyLeadNumber, query, searchType, folderId, folderUrl } = body;
    leadNumber = bodyLeadNumber; // Assign to outer scope variable

    if (searchType === 'general') {
      // General folder search for Documents page
      if (typeof query !== 'string') {
        return new Response(JSON.stringify({ 
          success: false,
          error: 'Query parameter must be a string' 
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400
        });
      }

      // List all items in the Documents directory and filter for folders
      const documentsContents = await graphClient
        .api(`/users/${targetUserId}/drive/root:/Documents:/children`)
        .get();

      // Filter results to only include folders
      let folders = (documentsContents.value || [])
        .filter((item: any) => item.folder);
      
      // If query is provided, filter by query; otherwise return all folders
      if (query.trim()) {
        folders = folders.filter((item: any) => item.name.toLowerCase().includes(query.toLowerCase()));
      }
      
      folders = folders.map((item: any) => ({
          id: item.id,
          name: item.name,
          webUrl: item.webUrl,
          lastModifiedDateTime: item.lastModifiedDateTime,
          size: item.size,
          folder: {
            childCount: item.folder.childCount || 0
          }
        }));

      return new Response(JSON.stringify({ 
        success: true,
        folders: folders,
        query: query,
        count: folders.length
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      });

    } else if (searchType === 'folderContents') {
      // Get folder contents for Documents page
      if (!folderId) {
        return new Response(JSON.stringify({ 
          success: false,
          error: 'folderId is required for folder contents search' 
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400
        });
      }

      // Get folder contents
      const folderContents = await graphClient
        .api(`/users/${targetUserId}/drive/items/${folderId}/children`)
        .get();

      // Filter to only include files (not subfolders) and format them
      const documents = (folderContents.value || [])
        .filter((item: any) => item.file) // Only files, not folders
        .map((item: any) => ({
          id: item.id,
          name: item.name,
          webUrl: item.webUrl,
          downloadUrl: item['@microsoft.graph.downloadUrl'] || item.webUrl,
          lastModifiedDateTime: item.lastModifiedDateTime,
          size: item.size || 0,
          file: {
            mimeType: item.file.mimeType || 'application/octet-stream'
          }
        }));

      return new Response(JSON.stringify({ 
        success: true,
        documents: documents,
        count: documents.length,
        folderId: folderId
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      });

    } else {
      // Lead-specific search for ExpertTab
      if (!bodyLeadNumber) {
        return new Response(JSON.stringify({ error: 'leadNumber is required' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400
        });
      }

      // If a folderUrl is provided (stored in lead), use it as the source of truth.
      if (folderUrl) {
        const filesFromUrl = await tryListFilesFromFolderUrl(folderUrl);
        if (filesFromUrl !== null) {
          return new Response(
            JSON.stringify({
              success: true,
              files: filesFromUrl,
              count: filesFromUrl.length,
              source: 'folderUrl',
            }),
            {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              status: 200,
            },
          );
        }

        // If we had an explicit folderUrl but couldn't resolve it, do NOT fall back to guessing.
        // That guess is what makes things "randomly" fail even when the real link is correct.
        return new Response(
          JSON.stringify({
            success: false,
            retryable: true,
            error: 'Temporary error resolving OneDrive folder link. Please retry.',
            source: 'folderUrl',
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
        );
      }

      // Get files from OneDrive for specific lead (in /Leads/ path)
      const files = await getOneDriveFiles(bodyLeadNumber);

      return new Response(JSON.stringify({ 
        success: true,
        files: files,
        count: files.length
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      });
    }

  } catch (error) {
    console.error('Error listing OneDrive files:', error);
    
    // If it's a folder not found error, return success: false with the error message
    if (error.message && error.message.includes('not found')) {
      return new Response(JSON.stringify({ 
        success: false,
        error: error.message,
        retryable: false,
        details: `Tried paths: /Documents/Leads/Lead_${leadNumber}, /Leads/Lead_${leadNumber}, /Lead_${leadNumber}`,
        leadNumber: leadNumber,
        files: []
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 // Return 200 so Supabase passes the response body
      });
    }

    if (error.message && error.message.toLowerCase().includes('temporary error')) {
      return new Response(
        JSON.stringify({
          success: false,
          retryable: true,
          error: error.message,
          leadNumber,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
      );
    }
    
    return new Response(JSON.stringify({ 
      success: false,
      retryable: true,
      error: error.message || 'Internal server error' 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500
    });
  }
}); 