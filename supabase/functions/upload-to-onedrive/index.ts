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
    const folderName = formData.get('folderName') as string;
    const folderId = formData.get('folderId') as string;
    const isEmailAttachment = formData.get('isEmailAttachment') as string === 'true';
    const isGeneralDocument = formData.get('isGeneralDocument') as string === 'true';
    const isExistingFolder = formData.get('isExistingFolder') as string === 'true';

    if (!file) throw new Error('Missing file in request.');
    
    // Log file details for debugging
    console.log('📤 Upload request received:', {
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      isEmailAttachment,
      isGeneralDocument,
      isExistingFolder,
      folderName,
      folderId
    });

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

    } else if (isGeneralDocument) {
      // Logic for general document uploads to Documents folder
      if (!folderName) throw new Error('Missing folderName for general document upload.');

      // Sanitize folder name to be safe for OneDrive
      const sanitizedFolderName = folderName.replace(/[<>:"/\\|?*]/g, '_').trim();
      if (!sanitizedFolderName) throw new Error('Invalid folder name.');

      // 1. Find or create the folder in the Documents root
      let driveItem;
      try {
        driveItem = await graphClient
          .api(`/users/${targetUserId}/drive/root:/Documents/${sanitizedFolderName}`)
          .get();
      } catch (error) {
        if (error.statusCode === 404) {
          // Create the folder if it doesn't exist
          driveItem = await graphClient
            .api(`/users/${targetUserId}/drive/root:/Documents:/children`)
            .post({
              name: sanitizedFolderName,
              folder: {},
              '@microsoft.graph.conflictBehavior': 'rename',
            });
        } else {
          throw error;
        }
      }

      if (!driveItem || !driveItem.id) {
        throw new Error('Could not create or find the folder.');
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
      const fileSize = fileBuffer.byteLength;
      
      // Use resumable upload for files larger than 4MB
      let uploadResult;
      if (fileSize > 4 * 1024 * 1024) {
        // For large files, use resumable upload session
        console.log(`Using resumable upload for large file: ${file.name} (${(fileSize / (1024 * 1024)).toFixed(2)}MB)`);
        
        const fileName = file.name;
        const uploadUrl = `/users/${targetUserId}/drive/items/${uploadFolderId}:/${fileName}:/createUploadSession`;
        
        const uploadSession = await graphClient.api(uploadUrl).post({
          item: {
            '@microsoft.graph.conflictBehavior': 'rename',
            name: fileName
          }
        });
        
        if (!uploadSession || !uploadSession.uploadUrl) {
          throw new Error('Failed to create upload session');
        }
        
        // Upload file in chunks to the upload URL
        const chunkSize = 320 * 1024; // 320KB chunks (Microsoft's recommended size)
        let offset = 0;
        
        while (offset < fileSize) {
          const chunk = fileBuffer.slice(offset, Math.min(offset + chunkSize, fileSize));
          const chunkResponse = await fetch(uploadSession.uploadUrl, {
            method: 'PUT',
            headers: {
              'Content-Length': chunk.byteLength.toString(),
              'Content-Range': `bytes ${offset}-${offset + chunk.byteLength - 1}/${fileSize}`
            },
            body: chunk
          });
          
          if (!chunkResponse.ok && chunkResponse.status !== 201 && chunkResponse.status !== 200) {
            const errorText = await chunkResponse.text();
            throw new Error(`Failed to upload chunk: ${chunkResponse.status} ${errorText}`);
          }
          
          offset += chunk.byteLength;
          console.log(`Uploaded ${Math.round((offset / fileSize) * 100)}% of ${file.name}`);
          
          // If upload is complete, break
          if (chunkResponse.status === 200 || chunkResponse.status === 201) {
            uploadResult = await chunkResponse.json();
            break;
          }
        }
        
        if (!uploadResult) {
          throw new Error('Upload session completed but no result received');
        }
      } else {
        // For smaller files, use simple upload
        const uploadUrl = `/users/${targetUserId}/drive/items/${uploadFolderId}:/${file.name}:/content`;
        uploadResult = await graphClient.api(uploadUrl).put(fileBuffer);
      }

      responseData = {
        success: true,
        message: 'File uploaded successfully!',
        folderUrl: shareableLink,
        folderId: uploadFolderId,
        fileName: file.name,
        folderName: sanitizedFolderName,
      };

    } else if (isExistingFolder) {
      // Logic for uploading to existing folder
      if (!folderId) throw new Error('Missing folderId for existing folder upload.');

      uploadFolderId = folderId;

      // Upload the file to the existing folder
      const fileBuffer = await file.arrayBuffer();
      const fileSize = fileBuffer.byteLength;
      
      // Use resumable upload for files larger than 4MB
      let uploadResult;
      if (fileSize > 4 * 1024 * 1024) {
        // For large files, use resumable upload session
        console.log(`Using resumable upload for large file: ${file.name} (${(fileSize / (1024 * 1024)).toFixed(2)}MB)`);
        
        const fileName = file.name;
        const uploadUrl = `/users/${targetUserId}/drive/items/${uploadFolderId}:/${fileName}:/createUploadSession`;
        
        const uploadSession = await graphClient.api(uploadUrl).post({
          item: {
            '@microsoft.graph.conflictBehavior': 'rename',
            name: fileName
          }
        });
        
        if (!uploadSession || !uploadSession.uploadUrl) {
          throw new Error('Failed to create upload session');
        }
        
        // Upload file in chunks to the upload URL
        const chunkSize = 320 * 1024; // 320KB chunks
        let offset = 0;
        
        while (offset < fileSize) {
          const chunk = fileBuffer.slice(offset, Math.min(offset + chunkSize, fileSize));
          const chunkResponse = await fetch(uploadSession.uploadUrl, {
            method: 'PUT',
            headers: {
              'Content-Length': chunk.byteLength.toString(),
              'Content-Range': `bytes ${offset}-${offset + chunk.byteLength - 1}/${fileSize}`
            },
            body: chunk
          });
          
          if (!chunkResponse.ok && chunkResponse.status !== 201 && chunkResponse.status !== 200) {
            const errorText = await chunkResponse.text();
            throw new Error(`Failed to upload chunk: ${chunkResponse.status} ${errorText}`);
          }
          
          offset += chunk.byteLength;
          console.log(`Uploaded ${Math.round((offset / fileSize) * 100)}% of ${file.name}`);
          
          // If upload is complete, break
          if (chunkResponse.status === 200 || chunkResponse.status === 201) {
            uploadResult = await chunkResponse.json();
            break;
          }
        }
        
        if (!uploadResult) {
          throw new Error('Upload session completed but no result received');
        }
      } else {
        // For smaller files, use simple upload
        const uploadUrl = `/users/${targetUserId}/drive/items/${uploadFolderId}:/${file.name}:/content`;
        uploadResult = await graphClient.api(uploadUrl).put(fileBuffer);
      }

      responseData = {
        success: true,
        message: 'File uploaded successfully to existing folder!',
        folderId: uploadFolderId,
        fileName: file.name,
      };

    } else {
      // Existing logic for lead document uploads
      if (!leadNumber) throw new Error('Missing leadNumber for document upload.');

      const folderName = `Lead_${leadNumber.replace(/ /g, '_')}`;

      // 1. First ensure the "Documents/Leads" folder structure exists
      let leadsFolder;
      try {
        leadsFolder = await graphClient
          .api(`/users/${targetUserId}/drive/root:/Documents/Leads`)
          .get();
      } catch (error) {
        if (error.statusCode === 404) {
          // Create the Documents/Leads folder structure if it doesn't exist
          // First create Documents folder if needed
          let documentsFolder;
          try {
            documentsFolder = await graphClient
              .api(`/users/${targetUserId}/drive/root:/Documents`)
              .get();
          } catch (docError) {
            if (docError.statusCode === 404) {
              documentsFolder = await graphClient
                .api(`/users/${targetUserId}/drive/root:/children`)
                .post({
                  name: 'Documents',
                  folder: {},
                  '@microsoft.graph.conflictBehavior': 'rename'
                });
            }
          }
          
          // Then create Leads folder inside Documents
          leadsFolder = await graphClient
            .api(`/users/${targetUserId}/drive/root:/Documents/children`)
            .post({
              name: 'Leads',
              folder: {},
              '@microsoft.graph.conflictBehavior': 'rename',
            });
        } else {
          throw error;
        }
      }

      // 2. Find or create the folder for the lead in /Documents/Leads/ path
      let driveItem;
      try {
        driveItem = await graphClient
          .api(`/users/${targetUserId}/drive/root:/Documents/Leads/${folderName}`)
          .get();
      } catch (error) {
        if (error.statusCode === 404) {
          driveItem = await graphClient
            .api(`/users/${targetUserId}/drive/root:/Documents/Leads:/children`)
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
