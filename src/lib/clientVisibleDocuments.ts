import { supabase } from './supabase';

/**
 * What the client sees of a case in the portal's Documents tab.
 *
 * Everything is viewable until someone says otherwise, so this only ever writes the exception:
 * `client_visible = false` on a case document or on one of the drive's case folders. The portal
 * reads the flag in `portal_get_documents` (sql/2026-10-28_client_visible_documents.sql), where a
 * hidden folder also hides everything filed under it — so hiding a folder is enough, and the
 * files inside it keep their own flag for when the folder is shown again.
 */

export async function setCaseDocumentsClientVisible(
  documentIds: string[],
  visible: boolean,
): Promise<void> {
  if (documentIds.length === 0) return;
  const { error } = await supabase
    .from('lead_case_documents')
    .update({ client_visible: visible })
    .in('id', documentIds);
  if (error) throw clientVisibilityError(error);
}

export async function setDocumentFolderClientVisible(
  folderId: string,
  visible: boolean,
): Promise<void> {
  const { error } = await supabase
    .from('document_folders')
    .update({ client_visible: visible })
    .eq('id', folderId);
  if (error) throw clientVisibilityError(error);
}

/** The column arrives with a migration, so say which one rather than echoing Postgres. */
function clientVisibilityError(error: { message?: string }): Error {
  const message = String(error?.message || 'Could not change what the client sees');
  if (/client_visible/i.test(message)) {
    return new Error(
      'Client visibility is not set up yet. Run sql/2026-10-28_client_visible_documents.sql, then try again.',
    );
  }
  return new Error(message);
}
