/**
 * When a newly uploaded case document gets an AI summary straight away, and when it waits.
 *
 * Every row inserted as 'pending' enqueues one call to the case-document-summarize function, so a
 * dropped folder of a few hundred scans would fire a few hundred of them at once. Shared by the
 * case drawer and the drive so a file uploaded from either place is treated the same.
 */

/** Above this many files in one go the summaries are left for later. */
export const BULK_SUMMARY_FILE_LIMIT = 25;

export const BULK_SUMMARY_SKIPPED_NOTE =
  'Skipped automatically because this arrived in a large upload. Generate it whenever you need it.';

/** What a new case document row says about its summary, given the size of the batch it came in. */
export function caseDocumentSummaryFields(summarise: boolean): {
  ai_summary_status: 'pending' | 'skipped';
  ai_summary_error: string | null;
} {
  return summarise
    ? { ai_summary_status: 'pending', ai_summary_error: null }
    : { ai_summary_status: 'skipped', ai_summary_error: BULK_SUMMARY_SKIPPED_NOTE };
}
