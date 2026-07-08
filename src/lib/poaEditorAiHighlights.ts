import type { Editor } from '@tiptap/react';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { AiBodyHighlight } from './aiChangeReview';

function buildPlainTextIndex(doc: ProseMirrorNode): { plain: string; posAt: (index: number) => number } {
  let plain = '';
  const indices: number[] = [];

  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    for (let i = 0; i < node.text.length; i += 1) {
      indices.push(pos + i);
      plain += node.text[i];
    }
  });

  return {
    plain,
    posAt: (index: number) => indices[index] ?? -1,
  };
}

function findPlainTextRange(
  doc: ProseMirrorNode,
  search: string,
  skipRanges: Array<{ from: number; to: number }>,
): { from: number; to: number } | null {
  const needle = search.trim();
  if (!needle) return null;

  const { plain, posAt } = buildPlainTextIndex(doc);
  let fromIndex = 0;

  while (fromIndex <= plain.length - needle.length) {
    const idx = plain.indexOf(needle, fromIndex);
    if (idx < 0) return null;

    const from = posAt(idx);
    const to = posAt(idx + needle.length - 1) + 1;
    if (from < 0 || to <= from) {
      fromIndex = idx + 1;
      continue;
    }

    const overlaps = skipRanges.some((range) => from < range.to && to > range.from);
    if (!overlaps) {
      return { from, to };
    }
    fromIndex = idx + 1;
  }

  return null;
}

function rangesOverlap(a: { from: number; to: number }, b: { from: number; to: number }): boolean {
  return a.from < b.to && a.to > b.from;
}

/** Apply ephemeral AI change marks in the TipTap editor (not persisted to stored POA body). */
export function applyAiHighlightsToPoaEditor(editor: Editor, highlights: AiBodyHighlight[]): void {
  if (!highlights.length || editor.isDestroyed) return;

  const sorted = [...highlights].sort((a, b) => b.text.length - a.text.length);
  const applied: Array<{ from: number; to: number }> = [];
  const { tr } = editor.state;

  for (const highlight of sorted) {
    const markName = highlight.kind === 'added' ? 'poaAiAdded' : 'poaAiChanged';
    const markType = editor.schema.marks[markName];
    if (!markType) continue;

    const range = findPlainTextRange(tr.doc, highlight.text, applied);
    if (!range) continue;

    tr.addMark(range.from, range.to, markType.create());
    applied.push(range);
  }

  if (!tr.steps.length) return;
  tr.setMeta('poaAiHighlight', true);
  editor.view.dispatch(tr);
}

export function clearAiHighlightsFromPoaEditor(editor: Editor): void {
  if (editor.isDestroyed) return;

  const { poaAiAdded, poaAiChanged } = editor.schema.marks;
  if (!poaAiAdded && !poaAiChanged) return;

  const { tr } = editor.state;
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    for (const mark of node.marks) {
      if (mark.type.name === 'poaAiAdded' || mark.type.name === 'poaAiChanged') {
        tr.removeMark(pos, pos + node.text.length, mark.type);
      }
    }
  });

  if (tr.steps.length) {
    tr.setMeta('poaAiHighlight', true);
    editor.view.dispatch(tr);
  }
}
