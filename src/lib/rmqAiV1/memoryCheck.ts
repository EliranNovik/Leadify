/** Whether a saved preference was sent on later chats, and whether a reply followed it. */

export const MEMORY_PROMPT_SLOTS = 24;

export function isTaskDump(fact: string): boolean {
  const text = fact.replace(/\s+/g, ' ').trim();
  if (!text) return true;
  return /call\s+get_|get_lead_case_file|query\s*=\s*L\d|create a summary of this lead|prep me for the meeting|start with case about/i.test(
    text,
  );
}

function isErrorReply(text: string): boolean {
  return /error occurred|no credits remaining|could not finish a reply|please try again/i.test(text);
}

function isClientDraft(text: string): boolean {
  return /CASE ABOUT|Subject\s*:|Best regards|בברכה|שלום|follow-up/i.test(text) || text.length > 320;
}

export type MemoryUseStatus = 'used' | 'missed' | 'not_sent' | 'not_checked' | 'waiting';

export type MemoryUseReview = {
  status: MemoryUseStatus;
  note: string;
};

function isDraftAsk(text: string): boolean {
  return /\b(draft|write|reply|email|e-mail|whatsapp|follow[- ]?up|ניסוח|תכתוב|תשובה)\b/i.test(text);
}

function hasMoney(text: string): boolean {
  if (/\b(won'?t|will not|do not|don't|not)\s+mention\b/i.test(text)) return false;
  return /[₪$€£]\s?\d|\b\d{2,}(?:[.,]\d+)?\s?(?:nis|ils|usd|eur|gbp|₪)\b|\b(?:total|price|balance|fee)\b\s*[:\-]?\s*\d/i.test(
    text,
  );
}

function hebrewCount(text: string): number {
  return (text.match(/[\u0590-\u05FF]/g) || []).length;
}

/** used, missed, or skip when this reply does not test the preference. */
export function verdictForReply(fact: string, userText: string, answer: string): 'used' | 'missed' | 'skip' {
  const cleanFact = fact.toLowerCase();
  const reply = answer.replace(/\s+/g, ' ').trim();
  if (isTaskDump(fact) || isErrorReply(reply) || reply.length < 20) return 'skip';
  const drafting = isDraftAsk(userText) || isClientDraft(reply);

  if (/do not mention|don't mention|dont mention|never mention/.test(cleanFact) && /amount|price|balance|total|fee|nis/.test(cleanFact)) {
    if (!drafting) return 'skip';
    return hasMoney(reply) ? 'missed' : 'used';
  }
  if (/not interested/.test(cleanFact) && /don'?t|do not|dont|never|stop/.test(cleanFact)) {
    if (!isClientDraft(reply)) return 'skip';
    return /not interested|לא מעוניין|לא מעוניינ/i.test(reply) ? 'missed' : 'used';
  }
  if (/best regards|בברכה/.test(cleanFact) && /don'?t|do not|dont|stop|never/.test(cleanFact)) {
    if (!isClientDraft(reply)) return 'skip';
    return /best regards|בברכה/i.test(reply) ? 'missed' : 'used';
  }
  if (/\benglish\b/.test(cleanFact) && !/hebrew|עברית/.test(cleanFact)) {
    if (!isClientDraft(reply)) return 'skip';
    const hebrew = hebrewCount(reply);
    const latin = (reply.match(/[A-Za-z]/g) || []).length;
    if (hebrew > 20 && hebrew > latin) return 'missed';
    if (latin > 40 && latin >= hebrew) return 'used';
    return 'skip';
  }
  if (/hebrew|עברית/.test(cleanFact) && !/\benglish\b/.test(cleanFact)) {
    if (!drafting) return 'skip';
    const hebrew = hebrewCount(reply);
    const latin = (reply.match(/[A-Za-z]/g) || []).length;
    if (hebrew >= 15) return 'used';
    if (latin > 100 && hebrew < 8) return 'missed';
    return 'skip';
  }
  if (/short concise/.test(cleanFact)) {
    if (!isClientDraft(reply)) return 'skip';
    if (reply.length > 1600) return 'missed';
    if (reply.length < 700) return 'used';
    return 'skip';
  }
  if (/whatsapp/.test(cleanFact) && /prefer/.test(cleanFact)) {
    if (!drafting) return 'skip';
    if (/\bwhatsapp\b/i.test(reply)) return 'used';
    if (/\bsubject\s*:/i.test(reply) && !/\bwhatsapp\b/i.test(reply)) return 'missed';
    return 'skip';
  }
  return 'skip';
}

export function formatPreferencesForPrompt(facts: string[]): string {
  const kept = facts.map((fact) => fact.trim()).filter((fact) => fact && !isTaskDump(fact)).slice(0, MEMORY_PROMPT_SLOTS);
  if (kept.length === 0) return '';
  const rules: string[] = [];
  for (const fact of kept) {
    const lower = fact.toLowerCase();
    if (!rules.some((rule) => rule.startsWith('LANGUAGE:')) && /\benglish\b/.test(lower) && !/hebrew|עברית/.test(lower)) {
      rules.push('LANGUAGE: Write client emails, follow-ups, and case summaries in English unless this message explicitly asks for another language.');
    } else if (!rules.some((rule) => rule.startsWith('LANGUAGE:')) && /hebrew|עברית/.test(lower) && !/\benglish\b/.test(lower)) {
      rules.push('LANGUAGE: Write client emails, follow-ups, and case summaries in Hebrew unless this message explicitly asks for another language.');
    }
    if (!rules.some((rule) => rule.startsWith('INTEREST:')) && /not interested/.test(lower) && /don'?t|do not|dont|never|stop/.test(lower)) {
      rules.push('INTEREST: Do not tell the client they are not interested, even if they said so.');
    }
    if (!rules.some((rule) => rule.startsWith('CLOSE:')) && /best regards|בברכה/.test(lower) && /don'?t|do not|dont|stop|never/.test(lower)) {
      rules.push('CLOSE: Do not end with Best regards or בברכה.');
    }
    if (!rules.some((rule) => rule.startsWith('MONEY:')) && /don'?t mention|do not mention|dont mention|never mention/.test(lower) && /amount|price|balance|fee|nis/.test(lower)) {
      rules.push('MONEY: Do not mention prices, totals, balances, or fees in client drafts.');
    }
  }
  return [
    'SAVED PREFERENCES FOR THIS EMPLOYEE. Follow every one on drafts, summaries, and client replies. A CRM record does not cancel them.',
    ...rules,
    ...kept.map((fact, index) => `${index + 1}. ${fact}`),
  ].join('\n');
}

function styleFact(fact: string): boolean {
  return /hebrew|עברית|english|short concise|whatsapp|do not mention|don't mention|dont mention|never mention|not interested|best regards|בברכה/i.test(
    fact,
  );
}

function snippet(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= 140) return clean;
  return `${clean.slice(0, 140).trim()}…`;
}

export function reviewMemoryUse(
  memories: Array<{ id: string; userId: string; fact: string; at: string | null }>,
  chats: Array<{ userId: string; at: string | null; userText: string; answer: string }>,
): Record<string, MemoryUseReview> {
  const sent = new Set<string>();
  const byUser = new Map<string, Array<{ id: string; at: string }>>();
  for (const memory of memories) {
    if (isTaskDump(memory.fact)) continue;
    const list = byUser.get(memory.userId) || [];
    list.push({ id: memory.id, at: memory.at || '' });
    byUser.set(memory.userId, list);
  }
  for (const list of byUser.values()) {
    list.sort((a, b) => (a.at < b.at ? 1 : -1));
    for (const row of list.slice(0, MEMORY_PROMPT_SLOTS)) sent.add(row.id);
  }

  const reviews: Record<string, MemoryUseReview> = {};
  for (const memory of memories) {
    if (isTaskDump(memory.fact)) {
      reviews[memory.id] = {
        status: 'not_sent',
        note: 'Not sent. This is a one-off task, not a lasting preference.',
      };
      continue;
    }
    if (!sent.has(memory.id)) {
      reviews[memory.id] = {
        status: 'not_sent',
        note: `Not sent. Only the ${MEMORY_PROMPT_SLOTS} newest preferences for this person go into the chat.`,
      };
      continue;
    }
    const later = chats.filter((chat) => {
      if (chat.userId !== memory.userId || !chat.answer || isErrorReply(chat.answer)) return false;
      if (!memory.at || !chat.at) return true;
      return chat.at >= memory.at;
    });
    let missed: string | null = null;
    let used: string | null = null;
    let unchecked = false;
    for (const chat of later) {
      const verdict = verdictForReply(memory.fact, chat.userText, chat.answer);
      if (verdict === 'missed' && !missed) missed = snippet(chat.answer);
      if (verdict === 'used' && !used) used = snippet(chat.answer);
      if (verdict === 'skip' && isDraftAsk(chat.userText) && styleFact(memory.fact)) unchecked = true;
    }
    if (missed) {
      reviews[memory.id] = { status: 'missed', note: `A later reply ignored it. “${missed}”` };
    } else if (used) {
      reviews[memory.id] = { status: 'used', note: `A later reply followed it. “${used}”` };
    } else if (later.length === 0) {
      reviews[memory.id] = { status: 'waiting', note: 'No later chat to test this yet.' };
    } else if (unchecked) {
      reviews[memory.id] = { status: 'not_checked', note: 'A later draft did not show that this was applied.' };
    } else {
      reviews[memory.id] = { status: 'waiting', note: 'Later chats were not a draft this preference would change.' };
    }
  }
  return reviews;
}
