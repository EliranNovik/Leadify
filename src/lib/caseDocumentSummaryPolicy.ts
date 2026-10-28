import { supabase } from './supabase';

/**
 * When a case document gets an AI summary, and who asked for it.
 *
 * Two things decide it. The backend switch `AUTO_SUMMARIZE` (a secret on the
 * `case-document-summarize` function, false by default) says whether uploading a file is reason
 * enough to read it — every one of those is an OpenAI call whether the summary is ever opened or
 * not. And for a large upload, even with the switch on, the summaries wait rather than firing a few
 * hundred calls at once.
 *
 * A summary somebody asks for — the drawer's Generate button, the drive, RMQ AI — always runs.
 */

/** Above this many files in one go the summaries are left for later. */
export const BULK_SUMMARY_FILE_LIMIT = 25;

export const BULK_SUMMARY_SKIPPED_NOTE =
  'Skipped automatically because this arrived in a large upload. Generate it whenever you need it.';

export const AUTO_SUMMARY_OFF_NOTE =
  'Automatic summaries are turned off. Generate one whenever you need it.';

/** Asked once per page load: the switch is a deployment setting, not something that moves. */
let autoSummarizeAnswer: Promise<boolean> | null = null;

/**
 * Whether uploads are summarised on their own.
 *
 * Read from the function that would do the work, so there is one switch rather than one per app.
 * Anything unexpected — the function missing, offline, an old deployment — reads as off: leaving
 * the expensive thing unasked for is the safe way to be wrong.
 */
export async function autoCaseSummariesEnabled(): Promise<boolean> {
  if (!autoSummarizeAnswer) {
    autoSummarizeAnswer = (async () => {
      try {
        const { data, error } = await supabase.functions.invoke('case-document-summarize', {
          body: { probe: true },
        });
        if (error) return false;
        return (data as { autoSummarize?: boolean } | null)?.autoSummarize === true;
      } catch {
        return false;
      }
    })();
  }
  return autoSummarizeAnswer;
}

/** What a new case document row says about its summary, given the size of the batch it came in. */
export function caseDocumentSummaryFields(summarise: boolean): {
  ai_summary_status: 'pending' | 'skipped';
  ai_summary_error: string | null;
} {
  return summarise
    ? { ai_summary_status: 'pending', ai_summary_error: null }
    : { ai_summary_status: 'skipped', ai_summary_error: BULK_SUMMARY_SKIPPED_NOTE };
}

/**
 * The same, for a row being inserted now: it takes the backend switch into account, so with
 * automatic summaries off a new file is filed as skipped rather than marked for work nobody will
 * do and left spinning.
 */
export async function newCaseDocumentSummaryFields(fileCount = 1): Promise<{
  ai_summary_status: 'pending' | 'skipped';
  ai_summary_error: string | null;
}> {
  if (!(await autoCaseSummariesEnabled())) {
    return { ai_summary_status: 'skipped', ai_summary_error: AUTO_SUMMARY_OFF_NOTE };
  }
  return caseDocumentSummaryFields(fileCount <= BULK_SUMMARY_FILE_LIMIT);
}

/** Summarise a freshly uploaded document, if uploads are allowed to summarise themselves. */
export async function requestAutomaticCaseDocumentSummary(documentId: string): Promise<void> {
  if (!documentId) return;
  if (!(await autoCaseSummariesEnabled())) return;
  try {
    const { error } = await supabase.functions.invoke('case-document-summarize', {
      body: { documentId },
    });
    if (error) console.warn('case-document-summarize:', error.message);
  } catch (err) {
    console.warn('case-document-summarize:', err);
  }
}

/**
 * Summarise a document because someone asked to see what it says. This runs whatever the
 * `AUTO_SUMMARIZE` switch says, and the summary is stored on the document itself, so the next
 * person to ask — in the case drawer, the drive, or RMQ AI — is handed the same one.
 */
export async function requestManualCaseDocumentSummary(
  documentId: string,
  opts?: { force?: boolean },
): Promise<{ ok: boolean; error?: string }> {
  if (!documentId) return { ok: false, error: 'No document' };
  try {
    const { error } = await supabase.functions.invoke('case-document-summarize', {
      body: { documentId, manual: true, ...(opts?.force ? { force: true } : {}) },
    });
    if (error) {
      console.warn('case-document-summarize:', error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (err) {
    console.warn('case-document-summarize:', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Could not summarise' };
  }
}
