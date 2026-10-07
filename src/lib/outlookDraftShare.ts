/**
 * Creates an Outlook draft that already carries a file, then hands back the link that opens it.
 *
 * A draft is the only way to put an attachment in front of someone before they send: `mailto:` can
 * prefill the subject and body but cannot carry a file.
 */

const GRAPH = 'https://graph.microsoft.com/v1.0';

/**
 * Graph rejects `contentBytes` attachments over 3 MB, so anything larger has to go through an upload
 * session. Scans routinely cross this line, which is why both paths exist.
 */
const SIMPLE_ATTACHMENT_LIMIT_BYTES = 3 * 1024 * 1024;

/** Upload session slices must be a multiple of 320 KiB, except the final one. */
const UPLOAD_SLICE_BYTES = 320 * 1024 * 10;

export type OutlookDraftFile = {
  name: string;
  contentType: string;
  bytes: ArrayBuffer;
};

export type OutlookDraft = {
  id: string;
  /** Opens the draft in Outlook on the web. */
  webLink: string;
};

/** btoa() on a whole scan would blow the argument limit, so the string is built in slices. */
function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(binary);
}

async function graphError(response: Response, fallback: string): Promise<Error> {
  let detail = '';
  try {
    const body = await response.json();
    detail = String(body?.error?.message ?? '').trim();
  } catch {
    // keep the generic message
  }
  return new Error(detail || `${fallback} (${response.status})`);
}

async function attachSmallFile(accessToken: string, messageId: string, file: OutlookDraftFile): Promise<void> {
  const response = await fetch(`${GRAPH}/me/messages/${encodeURIComponent(messageId)}/attachments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: file.name,
      contentType: file.contentType,
      contentBytes: toBase64(new Uint8Array(file.bytes)),
    }),
  });
  if (!response.ok) throw await graphError(response, 'Could not attach the document');
}

async function attachLargeFile(accessToken: string, messageId: string, file: OutlookDraftFile): Promise<void> {
  const size = file.bytes.byteLength;
  const sessionResponse = await fetch(
    `${GRAPH}/me/messages/${encodeURIComponent(messageId)}/attachments/createUploadSession`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        AttachmentItem: {
          attachmentType: 'file',
          name: file.name,
          size,
          contentType: file.contentType,
        },
      }),
    },
  );
  if (!sessionResponse.ok) throw await graphError(sessionResponse, 'Could not start the attachment upload');

  const session = await sessionResponse.json();
  const uploadUrl = String(session?.uploadUrl ?? '').trim();
  if (!uploadUrl) throw new Error('Outlook did not return an upload URL for the attachment');

  const view = new Uint8Array(file.bytes);
  for (let start = 0; start < size; start += UPLOAD_SLICE_BYTES) {
    const end = Math.min(start + UPLOAD_SLICE_BYTES, size);
    // The upload URL is pre-authorised, so it must not carry the bearer token.
    const sliceResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Range': `bytes ${start}-${end - 1}/${size}`,
      },
      body: view.subarray(start, end),
    });
    if (!sliceResponse.ok) throw await graphError(sliceResponse, 'Uploading the document failed');
  }
}

export async function createOutlookDraftWithAttachment(input: {
  accessToken: string;
  subject: string;
  bodyHtml: string;
  file: OutlookDraftFile;
}): Promise<OutlookDraft> {
  const draftResponse = await fetch(`${GRAPH}/me/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      subject: input.subject,
      body: { contentType: 'HTML', content: input.bodyHtml },
    }),
  });
  if (!draftResponse.ok) throw await graphError(draftResponse, 'Could not create the Outlook draft');

  const draft = await draftResponse.json();
  const id = String(draft?.id ?? '').trim();
  const webLink = String(draft?.webLink ?? '').trim();
  if (!id) throw new Error('Outlook did not return the new draft');

  if (input.file.bytes.byteLength <= SIMPLE_ATTACHMENT_LIMIT_BYTES) {
    await attachSmallFile(input.accessToken, id, input.file);
  } else {
    await attachLargeFile(input.accessToken, id, input.file);
  }

  return { id, webLink };
}

export const outlookDraftInternals = {
  SIMPLE_ATTACHMENT_LIMIT_BYTES,
  UPLOAD_SLICE_BYTES,
  toBase64,
};
