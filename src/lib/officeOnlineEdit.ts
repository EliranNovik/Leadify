/**
 * Editing a Word or Excel file from the document viewer.
 *
 * The file is staged in the signed-in person's own OneDrive, opened in the real Word or Excel for
 * the web, and the bytes are copied back into the CRM's storage afterwards. The staging copy is
 * deleted once it is back, so OneDrive never becomes a second home for case documents.
 *
 * The editor opens in its own tab rather than inside the viewer: Office for the web refuses to be
 * framed by anything outside Microsoft's own domains whenever the document is editable, and the
 * `allowEdit` option that used to get round that was dropped from Graph v1.0. An embedded frame
 * can therefore only ever be a reader, which is what the preview already is.
 *
 * Needs the delegated `Files.ReadWrite` scope (see officeEditRequest in src/msalConfig.ts).
 */

const GRAPH = 'https://graph.microsoft.com/v1.0';

/** The folder every staged file goes into, so a leftover copy is obvious and easy to clear out. */
export const OFFICE_EDIT_FOLDER = 'RMQ CRM edits';

/**
 * Only the XML formats. Word and Excel for the web cannot edit the 1997 formats (.doc, .xls)
 * without converting them first, which would change the file people filed.
 */
const EDITABLE_EXTENSIONS = ['docx', 'xlsx', 'pptx'];

export function officeEditableExtension(fileName: string): string | null {
  const ext = String(fileName || '').split('.').pop()?.toLowerCase() || '';
  return EDITABLE_EXTENSIONS.includes(ext) ? ext : null;
}

export function isOfficeEditableFile(fileName: string): boolean {
  return officeEditableExtension(fileName) !== null;
}

/** OneDrive rejects these outright, and a stray slash would silently nest the file. */
export function sanitiseOneDriveName(fileName: string): string {
  const cleaned = String(fileName || '')
    .replace(/[\\/:*?"<>|#%]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');
  return cleaned || 'document';
}

/** Each edit gets its own file, so two people editing two documents never collide. */
export function officeEditStagingPath(sessionId: string, fileName: string): string {
  return `${OFFICE_EDIT_FOLDER}/${sessionId}/${sanitiseOneDriveName(fileName)}`;
}

/** Graph wants the path colon-wrapped, with each segment encoded but the slashes intact. */
export function encodeDrivePath(path: string): string {
  return path
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

/** Anything larger goes up in chunks instead of one request. */
export const SIMPLE_UPLOAD_LIMIT_BYTES = 4 * 1024 * 1024;

/** Upload sessions want chunks that are a multiple of 320 KiB; this is 5 MiB worth of them. */
export const UPLOAD_CHUNK_BYTES = 16 * 320 * 1024;

export type UploadChunk = { start: number; end: number };

/** Byte ranges for an upload session, inclusive of `end` the way Content-Range is. */
export function planUploadChunks(size: number, chunkSize = UPLOAD_CHUNK_BYTES): UploadChunk[] {
  if (!Number.isFinite(size) || size <= 0) return [];
  const step = Math.max(1, Math.floor(chunkSize));
  const chunks: UploadChunk[] = [];
  for (let start = 0; start < size; start += step) {
    chunks.push({ start, end: Math.min(start + step, size) - 1 });
  }
  return chunks;
}

/**
 * Graph sends no cache headers on item metadata, which lets a browser decide for itself how long
 * to reuse it — long enough to insist a file being edited has never changed.
 */
const NO_STORE: RequestCache = 'no-store';

/**
 * Whether two files hold exactly the same bytes.
 *
 * This is how a real edit is told from an untouched copy. Timestamps cannot do it: Office for the
 * web decides for itself when to write back, so the one on the staged file says more about the
 * editor's mood than about whether anybody typed.
 */
export async function blobsAreIdentical(a: Blob, b: Blob): Promise<boolean> {
  if (a.size !== b.size) return false;
  const [left, right] = await Promise.all([a.arrayBuffer(), b.arrayBuffer()]);
  const one = new Uint8Array(left);
  const two = new Uint8Array(right);
  for (let i = 0; i < one.length; i += 1) {
    if (one[i] !== two[i]) return false;
  }
  return true;
}

async function graphError(response: Response, fallback: string): Promise<Error> {
  let detail = '';
  try {
    const body = await response.json();
    detail = String(body?.error?.message || '').trim();
  } catch {
    detail = '';
  }
  const message = detail || `${fallback} (HTTP ${response.status})`;
  const error = new Error(message);
  (error as Error & { status?: number }).status = response.status;
  return error;
}

export type OfficeEditSession = {
  /** The staged OneDrive item, which is what gets edited and then read back. */
  itemId: string;
  /** The staged document in Word or Excel for the web, opened for editing. */
  editUrl: string;
  stagingPath: string;
  /** What OneDrive reported before anyone typed, so a real change can be spotted. */
  lastModified: string;
};

type StagedItem = { id: string; webUrl: string; lastModified: string };

function readStagedItem(item: unknown): StagedItem {
  const record = (item || {}) as Record<string, unknown>;
  return {
    id: String(record.id || ''),
    webUrl: String(record.webUrl || ''),
    lastModified: String(record.lastModifiedDateTime || ''),
  };
}

async function uploadSmall(
  accessToken: string,
  stagingPath: string,
  blob: Blob,
): Promise<StagedItem> {
  const response = await fetch(
    `${GRAPH}/me/drive/root:/${encodeDrivePath(stagingPath)}:/content`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': blob.type || 'application/octet-stream',
      },
      body: blob,
    },
  );
  if (!response.ok) throw await graphError(response, 'Could not open this file for editing');
  return readStagedItem(await response.json());
}

async function uploadLarge(
  accessToken: string,
  stagingPath: string,
  blob: Blob,
): Promise<StagedItem> {
  const sessionResponse = await fetch(
    `${GRAPH}/me/drive/root:/${encodeDrivePath(stagingPath)}:/createUploadSession`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }),
    },
  );
  if (!sessionResponse.ok) {
    throw await graphError(sessionResponse, 'Could not open this file for editing');
  }
  const { uploadUrl } = await sessionResponse.json();
  if (!uploadUrl) throw new Error('Could not open this file for editing');

  let item: { id?: string; webUrl?: string } | null = null;
  for (const chunk of planUploadChunks(blob.size)) {
    // The upload URL is pre-authorised, so it must not carry the Graph token.
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Length': String(chunk.end - chunk.start + 1),
        'Content-Range': `bytes ${chunk.start}-${chunk.end}/${blob.size}`,
      },
      body: blob.slice(chunk.start, chunk.end + 1),
    });
    if (!response.ok) throw await graphError(response, 'Could not upload this file for editing');
    // Only the last chunk answers with the finished item.
    if (response.status === 200 || response.status === 201) {
      item = await response.json().catch(() => null);
    }
  }

  if (!item?.id) throw new Error('Could not open this file for editing');
  return readStagedItem(item);
}

/** Copy the file into OneDrive and bring back everything needed to edit it. */
export async function startOfficeEditSession(
  accessToken: string,
  params: { fileName: string; blob: Blob; sessionId?: string },
): Promise<OfficeEditSession> {
  const sessionId = params.sessionId || crypto.randomUUID();
  const stagingPath = officeEditStagingPath(sessionId, params.fileName);
  const uploaded =
    params.blob.size > SIMPLE_UPLOAD_LIMIT_BYTES
      ? await uploadLarge(accessToken, stagingPath, params.blob)
      : await uploadSmall(accessToken, stagingPath, params.blob);

  const editUrl = officeEditWebUrl(uploaded.webUrl);
  if (!editUrl) throw new Error('OneDrive did not say where to edit this file');
  return {
    itemId: uploaded.id,
    editUrl,
    stagingPath,
    lastModified: uploaded.lastModified,
  };
}

/** Whether the editor has saved anything into the staging copy yet, and how big it now is. */
export async function fetchOfficeEditState(
  accessToken: string,
  itemId: string,
): Promise<{ lastModified: string; size: number }> {
  const response = await fetch(
    `${GRAPH}/me/drive/items/${encodeURIComponent(itemId)}?$select=id,size,lastModifiedDateTime`,
    { headers: { Authorization: `Bearer ${accessToken}` }, cache: NO_STORE },
  );
  if (!response.ok) throw await graphError(response, 'Could not check the editing copy');
  const item = await response.json();
  return {
    lastModified: String(item?.lastModifiedDateTime || ''),
    size: Number(item?.size || 0),
  };
}

/**
 * The edited file as Word or Excel last saved it.
 *
 * Read through the pre-authorised download URL rather than `/content`: that one redirects to a
 * storage host which rejects requests still carrying an Authorization header. The URL is not
 * `$select`-ed for, because asking for it alongside other fields does not always return it.
 */
export async function downloadOfficeEditResult(
  accessToken: string,
  itemId: string,
): Promise<Blob> {
  const metaResponse = await fetch(`${GRAPH}/me/drive/items/${encodeURIComponent(itemId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: NO_STORE,
  });
  if (!metaResponse.ok) throw await graphError(metaResponse, 'Could not read your changes back');
  const meta = await metaResponse.json();
  const downloadUrl = officeEditDownloadUrl(meta);
  if (!downloadUrl) {
    throw new Error('OneDrive did not offer a download link for your changes');
  }

  const fileResponse = await fetch(downloadUrl, { cache: NO_STORE });
  if (!fileResponse.ok) {
    throw new Error(`Could not read your changes back (HTTP ${fileResponse.status})`);
  }
  return fileResponse.blob();
}

/** The download link, under either of the two names Graph has used for it. */
export function officeEditDownloadUrl(item: unknown): string {
  const record = (item || {}) as Record<string, unknown>;
  return String(
    record['@microsoft.graph.downloadUrl'] || record['@content.downloadUrl'] || '',
  ).trim();
}

/**
 * The staged file in Word or Excel for the web, opened for editing.
 *
 * OneDrive hands back a `webUrl` ending in `action=default`, which leaves the choice of reader or
 * editor to the tenant, so the action is pinned to editing.
 */
export function officeEditWebUrl(webUrl: string): string {
  const url = String(webUrl || '').trim();
  if (!url) return '';
  if (/[?&]action=/.test(url)) return url.replace(/([?&]action=)[^&]*/, '$1edit');
  return url.includes('?') ? `${url}&action=edit` : `${url}?action=edit`;
}

/** Remove the staging copy. Best effort: a leftover file is untidy, not harmful. */
export async function endOfficeEditSession(accessToken: string, itemId: string): Promise<void> {
  try {
    await fetch(`${GRAPH}/me/drive/items/${encodeURIComponent(itemId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (err) {
    console.warn('Could not clean up the OneDrive editing copy:', err);
  }
}
