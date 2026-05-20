import { stripLegacyBankFromNotes } from './bankAccounts';

/** First line legacy create prepends when saving (e.g. "2026-05 Proforma"). */
const LEGACY_PREPENDED_NAME_LINE = /^\d{4}-\d+\s+Proforma\s*$/i;

/**
 * User-facing notes for public proforma UI — strips embedded bank JSON and
 * legacy auto-prepended proforma name line.
 */
export function getLegacyNotesPrefix(rawNotes: string | null | undefined): string | null {
  const text = stripLegacyBankFromNotes(rawNotes).trim();
  if (!text) return null;
  const firstLine = text.split('\n')[0]?.trim() ?? '';
  return LEGACY_PREPENDED_NAME_LINE.test(firstLine) ? firstLine : null;
}

export function getPublicProformaDisplayNotes(
  rawNotes: string | null | undefined,
): string {
  let text = stripLegacyBankFromNotes(rawNotes).trim();
  if (!text) return '';

  const prefix = getLegacyNotesPrefix(rawNotes);
  if (prefix) {
    text = text.split('\n').slice(1).join('\n').trim();
  }

  return text;
}
