/**
 * Firm rule for every client legal-fee agreement.
 * A principle counts only when the checker quotes a passage that is really in the draft.
 */

export const FEE_AGREEMENT_PRINCIPLES = [
  {
    id: 'no_refunds',
    title: 'No refunds',
    line: 'Fees are not refunded, subject to applicable law.',
    summary:
      'No refunds will be issued under any circumstances, subject to applicable law. The client enters the engagement understanding and accepting this.',
  },
  {
    id: 'time_and_expertise',
    title: 'Time and expertise',
    line: 'The client pays for time and expertise, not for a specific outcome.',
    summary:
      'The firm sells its time and expertise. Legal fees are paid for these professional services, not for letters, court judgments, visas, or any other specific outcome.',
  },
  {
    id: 'fixed_fee_viability',
    title: 'Fixed fees and economic viability',
    line: 'The fixed fee is an estimate of hours, and the firm cannot work at a loss.',
    summary:
      'The fixed fee is the firm’s estimate of the hours required, based on professional experience. The client is still paying for time and expertise. The firm must remain economically viable and cannot operate at a loss. If the hours invested make the effective hourly rate unsustainable, the parties will discuss it.',
  },
  {
    id: 'budget_reliance',
    title: 'Financial and budgetary reliance',
    line: 'After signing and payment, the firm relies on the full agreed fee.',
    summary:
      'The firm bases its budget on the agreed legal fees. After the agreement is signed and payment is made, the firm relies on the full agreed amount and plans its expenses accordingly. By signing, the client confirms they understand and accept this.',
  },
] as const;

export type FeeAgreementPrincipleId = (typeof FEE_AGREEMENT_PRINCIPLES)[number]['id'];

export type FeeAgreementQuote = {
  id: string;
  excerpt: string;
};

export type FeeAgreementItem = {
  id: string;
  title: string;
  summary: string;
  present: boolean;
  /** A real passage is in the contract, but it does not state the principle fully. */
  partial: boolean;
  /** Exact passage from the contract, only when partial. */
  excerpt: string;
  /** One sentence on why a partial passage falls short. */
  note: string;
};

export type FeeAgreementProof = {
  ok: boolean;
  items: FeeAgreementItem[];
};

const MIN_EXCERPT_LENGTH = 16;

export function feeAgreementInstruction(): string {
  const lines = FEE_AGREEMENT_PRINCIPLES.map(
    (principle, index) => `${index + 1}. ${principle.title}: ${principle.summary}`,
  );
  return `FIRM FEE-AGREEMENT RULE (mandatory for this client fee agreement):
Every legal fee agreement must state all four principles clearly and explicitly, in the contract's own language. Equivalent wording counts. A heading alone does not count.
On every review, say which principles are already explicit and which are missing.
If the lawyer asks you to add the missing principles, insert them as explicit clauses and do not remove or weaken existing terms.
${lines.join('\n')}`;
}

export function feeAgreementInsertPrompt(missing: FeeAgreementItem[]): string {
  const lines = missing.map((principle) => `- ${principle.title}: ${principle.summary}`);
  return `Add the missing firm fee-agreement principles as explicit numbered clauses in this contract's current language. Do not remove or weaken existing terms.
Continue the contract's existing clause numbers. Each new principle is its own paragraph, with a blank line before and after it. Never put two clauses in the same paragraph.
Write each clause as a bold number and short title, then the sentence:
[[B]]17. No refunds.[[/B]] No refunds will be issued under any circumstances, subject to applicable law. The client enters the engagement understanding and accepting this.
Missing principles:
${lines.join('\n')}`;
}

function stripContractMarkers(text: string): string {
  return text
    .replace(/\[\[\/?(?:B|I|U|S)\]\]/g, '')
    .replace(/\[\[FS:[^\]]+\]\]/g, '')
    .replace(/\[\[\/FS\]\]/g, '')
    .replace(/\[\[FF:[^\]]+\]\]/g, '')
    .replace(/\[\[\/FF\]\]/g, '');
}

/** Marker-free text for the lawyer. [[B]] is only an instruction to bold. */
export function displayContractExcerpt(text: string): string {
  return stripContractMarkers(text).replace(/\s+/g, ' ').trim();
}

export function normalizeContractPlainText(text: string): string {
  return stripContractMarkers(text)
    .replace(/\u00a0/g, ' ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** True only when the excerpt is a real passage copied from the contract, not a paraphrase. */
export function excerptAppearsInContract(contractText: string, excerpt: string): boolean {
  const needle = normalizeContractPlainText(excerpt);
  if (needle.length < MIN_EXCERPT_LENGTH) return false;
  if (needle.includes('...') || needle.includes('…')) return false;
  const haystack = normalizeContractPlainText(contractText);
  return haystack.includes(needle);
}

function oneSentence(text: string): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= 220) return cleaned;
  return `${cleaned.slice(0, 217).trim()}…`;
}

export function proveFeeAgreementQuotes(
  contractText: string,
  quotes: Array<{ id?: string; excerpt?: string; status?: string; note?: string }>,
  policies: Array<{ id: string; title: string; summary: string }> = FEE_AGREEMENT_PRINCIPLES,
): FeeAgreementProof {
  const byId = new Map<string, { excerpt: string; status: string; note: string }>();
  for (const quote of quotes) {
    const id = String(quote?.id || '');
    if (byId.has(id)) continue;
    byId.set(id, {
      excerpt: String(quote?.excerpt || ''),
      status: String(quote?.status || '').trim().toLowerCase(),
      note: oneSentence(String(quote?.note || '')),
    });
  }
  const items: FeeAgreementItem[] = policies.map((principle) => {
    const row = byId.get(principle.id);
    const excerpt = row?.excerpt || '';
    const verified = excerptAppearsInContract(contractText, excerpt);
    const status = row?.status || '';
    // Older checkers omit status. A verified excerpt from those still counts as present.
    const present = verified && status !== 'partial' && status !== 'missing';
    const partial = !present && verified && status === 'partial';
    return {
      id: principle.id,
      title: principle.title,
      summary: principle.summary,
      present,
      partial,
      excerpt: partial ? excerpt.trim() : '',
      note: partial ? row?.note || '' : '',
    };
  });
  return { ok: items.every((item) => item.present), items };
}
