export type AiPatchEdit = {
  editKind?: 'append' | 'prepend' | 'insert_after' | 'replace' | 'full';
  text?: string;
  find?: string;
};

export type AiBodyHighlight = {
  text: string;
  kind: 'added' | 'changed';
};

const MAX_SNIPPET_CHARS = 700;

function normalize(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

/** Plain text for diff/search — strips inline POA markers, keeps {{field}} tokens as text. */
export function poaBodyToPlainText(body: string): string {
  return normalize(body)
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\+\+([^+]+)\+\+/g, '$1')
    .replace(/==([^=]+)==/g, '$1');
}

function snippet(text: string, max = MAX_SNIPPET_CHARS): string {
  const trimmed = normalize(text).trim();
  if (!trimmed) return '';
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
}

/** Extract the changed middle region between two texts. */
function describeRegionDiff(before: string, after: string): string | null {
  const b = normalize(before);
  const a = normalize(after);
  if (b === a) return null;

  if (!b.trim()) {
    return `Added:\n${snippet(a, 1200)}`;
  }
  if (!a.trim()) {
    return `Removed:\n${snippet(b, 1200)}`;
  }

  let start = 0;
  const minLen = Math.min(b.length, a.length);
  while (start < minLen && b[start] === a[start]) start += 1;

  let endB = b.length;
  let endA = a.length;
  while (endB > start && endA > start && b[endB - 1] === a[endA - 1]) {
    endB -= 1;
    endA -= 1;
  }

  const removed = b.slice(start, endB).trim();
  const added = a.slice(start, endA).trim();
  const parts: string[] = [];
  if (removed) parts.push(`Removed:\n${snippet(removed)}`);
  if (added) parts.push(`Added:\n${snippet(added)}`);
  return parts.length ? parts.join('\n\n') : null;
}

function describePatch(patch: AiPatchEdit): string | null {
  const text = patch.text?.trim();
  if (!text || patch.editKind === 'full') return null;

  const find = patch.find?.trim();
  const added = snippet(text);

  switch (patch.editKind) {
    case 'prepend':
      return `Added at beginning:\n${added}`;
    case 'replace':
      return find
        ? `Removed:\n${snippet(find)}\n\nAdded:\n${added}`
        : `Added:\n${added}`;
    case 'insert_after':
      return find
        ? `Inserted after:\n${snippet(find, 240)}\n\nAdded:\n${added}`
        : `Added:\n${added}`;
    case 'append':
    default:
      return `Added:\n${added}`;
  }
}

/** Build AI review message showing actual text changes plus optional summary bullets. */
export function formatAiChangeReviewContent(
  before: string,
  after: string,
  options?: { summary?: string; patch?: AiPatchEdit },
): string {
  const parts: string[] = [];
  const regionDetail = describeRegionDiff(before, after);
  const patchDetail = options?.patch ? describePatch(options.patch) : null;

  if (regionDetail) {
    parts.push(regionDetail);
  } else if (patchDetail) {
    parts.push(patchDetail);
  }

  const summary = options?.summary?.trim();
  if (summary) {
    if (parts.length) parts.push('');
    parts.push(summary);
  }

  return parts.join('\n') || summary || 'Document was updated.';
}

function highlightSnippets(plainText: string): string[] {
  const trimmed = plainText.trim();
  if (!trimmed) return [];

  const chunks =
    trimmed.length > 320
      ? trimmed.split(/\n\n+/).map((part) => part.trim()).filter(Boolean)
      : [trimmed];

  if (chunks.length > 1) return chunks;
  return [trimmed];
}

/** Plain-text regions to highlight in the staff editor after an AI edit. */
export function extractAiBodyHighlights(
  before: string,
  after: string,
  patch?: AiPatchEdit,
): AiBodyHighlight[] {
  const highlights: AiBodyHighlight[] = [];
  const b = poaBodyToPlainText(before);
  const a = poaBodyToPlainText(after);
  if (a === b) return highlights;

  if (!b.trim()) {
    for (const text of highlightSnippets(a)) {
      highlights.push({ text, kind: 'added' });
    }
    return highlights;
  }

  if (patch?.text?.trim() && patch.editKind && patch.editKind !== 'full') {
    const plain = poaBodyToPlainText(patch.text);
    for (const text of highlightSnippets(plain)) {
      highlights.push({
        text,
        kind: patch.editKind === 'replace' ? 'changed' : 'added',
      });
    }
    return highlights;
  }

  let start = 0;
  const minLen = Math.min(b.length, a.length);
  while (start < minLen && b[start] === a[start]) start += 1;

  let endB = b.length;
  let endA = a.length;
  while (endB > start && endA > start && b[endB - 1] === a[endA - 1]) {
    endB -= 1;
    endA -= 1;
  }

  const removed = b.slice(start, endB).trim();
  const added = a.slice(start, endA).trim();
  if (!added) return highlights;

  const kind: AiBodyHighlight['kind'] = removed ? 'changed' : 'added';
  for (const text of highlightSnippets(added)) {
    highlights.push({ text, kind });
  }
  return highlights;
}
