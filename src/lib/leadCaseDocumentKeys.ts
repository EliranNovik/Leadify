/** Variants of a lead number that may appear on `lead_case_documents.lead_number`. */

export function addLeadNumberVariants(keys: Set<string>, raw: string | undefined | null) {
  const value = String(raw || '').trim();
  if (!value) return;
  keys.add(value);
  const stripped = value.replace(/^[LC]/i, '');
  if (stripped) {
    keys.add(stripped);
    keys.add(`L${stripped}`);
    keys.add(`C${stripped}`);
  }
}

/**
 * Expand display / storage aliases for case-document lookups.
 * Master leads are often stored as `123` but shown as `123/1` / `L123/1` / `C123/1`.
 * Does not cross into other sub-lead suffixes (`123/2`, `123/3`, …).
 */
export function expandLeadCaseDocumentLeadNumbers(
  ...raws: Array<string | undefined | null>
): string[] {
  const keys = new Set<string>();
  for (const raw of raws) {
    addLeadNumberVariants(keys, raw);
    const value = String(raw || '').trim();
    if (!value) continue;
    const stripped = value.replace(/^[LC]/i, '');
    if (/\/1$/.test(stripped)) {
      addLeadNumberVariants(keys, stripped.replace(/\/1$/, ''));
    } else if (stripped && !stripped.includes('/')) {
      addLeadNumberVariants(keys, `${stripped}/1`);
    }
  }
  return [...keys];
}
