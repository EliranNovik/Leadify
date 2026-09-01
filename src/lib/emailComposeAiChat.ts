import {
  applyCrmDocumentLinksToEmailDraft,
  fetchLeadCaseFileForAi,
  formatRequiredDocumentLinksBlock,
  parseFollowupDocumentLinks,
} from './leadFollowupAiApi';
import { sendWordDocumentAiChatMessage } from './wordDocumentAiApi';

export type EmailComposeAiChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  kind?: 'answer' | 'change';
};

export function stripAiEmailSignature(text: string): string {
  const normalized = text.replace(/\r\n/g, '\n').trimEnd();
  const lines = normalized.split('\n');
  const closeRe =
    /^(best regards|kind regards|warm regards|with regards|with best regards|regards|sincerely|yours sincerely|yours truly|thanks|thank you|בברכה רבה|בברכה|בכבוד רב)\s*[,.]?\s*$/i;
  let closeIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (closeRe.test(lines[i].trim())) closeIdx = i;
  }
  if (closeIdx >= 0) return lines.slice(0, closeIdx + 1).join('\n').trim();
  return normalized
    .replace(/\n+(?:\[your name\]|\[your position\]|decker,?\s*pex[\s\S]*)$/i, '')
    .trim();
}

export function splitAiEmailDraft(text: string): { subject?: string; body: string } {
  const trimmed = stripAiEmailSignature(
    text.replace(/\[\[\/?[A-Z]+(?::[^\]]+)?\]\]/g, '').replace(/\r\n/g, '\n').trim(),
  );
  const subjectMatch = trimmed.match(/^Subject:\s*(.+?)\n(?:\s*\n)?([\s\S]*)$/i);
  if (subjectMatch) {
    return {
      subject: subjectMatch[1].trim() || undefined,
      body: stripAiEmailSignature(subjectMatch[2]),
    };
  }
  return { body: trimmed };
}

export function resolveLeadIdForComposeAi(contact: {
  id?: string | number | null;
  client_uuid?: string | null;
  lead_type?: string | null;
} | null | undefined): { leadId: string; isLegacy: boolean } | null {
  if (!contact) return null;
  const raw = String(contact.client_uuid || contact.id || '').trim();
  if (!raw) return null;
  const isLegacy = contact.lead_type === 'legacy' || raw.toLowerCase().startsWith('legacy_');
  return { leadId: raw.replace(/^legacy_/i, ''), isLegacy };
}

export async function runEmailComposeAiChat(params: {
  remarks: string;
  subject: string;
  body: string;
  clientName?: string | null;
  leadNumber?: string | null;
  language?: string | null;
  category?: string | null;
  leadId?: string | null;
  isLegacy?: boolean;
  chatHistory: EmailComposeAiChatMessage[];
  onThinking?: (text: string) => void;
}): Promise<{
  intent: 'action' | 'question';
  body?: string;
  subject?: string;
  summary: string;
}> {
  const remarks = params.remarks.trim();
  let caseContext = '';
  if (params.leadId) {
    params.onThinking?.('Opening the case file…');
    caseContext = await fetchLeadCaseFileForAi({
      leadId: params.leadId,
      isLegacy: params.isLegacy,
    }).catch(() => '');
  }
  let links = parseFollowupDocumentLinks(caseContext);
  if (params.leadId && !links.contractSigningUrl && !links.poaUrl && !links.invoiceUrl) {
    const fresh = await fetchLeadCaseFileForAi({
      leadId: params.leadId,
      isLegacy: params.isLegacy,
    }).catch(() => '');
    if (fresh) {
      caseContext = fresh;
      links = parseFollowupDocumentLinks(fresh);
    }
  }
  const requiredLinks = formatRequiredDocumentLinksBlock(links);
  params.onThinking?.('Reading the case and your request…');
  const currentDocumentText = `Subject: ${params.subject || `(email for ${params.clientName || 'the client'})`}\n\n${
    params.body.trim() || '(empty email — draft one for this client)'
  }`;
  const userRemarks = [
    remarks,
    requiredLinks,
    caseContext
      ? `[BACKGROUND CASE FILE — use these facts. Copy REQUIRED LINKS exactly when needed. Do not dump this file into the email. Never use example.com.]\n${caseContext}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  const result = await sendWordDocumentAiChatMessage(
    {
      currentDocumentText,
      userRemarks,
      clientName: params.clientName,
      leadNumber: params.leadNumber,
      language: params.language,
      category: params.category,
      chatHistory: params.chatHistory.map((m) => ({
        role: m.role,
        content: m.role === 'assistant' && m.kind === 'change' ? 'Updated the email draft.' : m.content,
      })),
      caseContext: [requiredLinks, caseContext].filter(Boolean).join('\n\n'),
      purpose: 'email_followup',
    },
    params.onThinking,
  );
  if (result.intent === 'action') {
    const parsed = splitAiEmailDraft(
      applyCrmDocumentLinksToEmailDraft(result.improvedDocumentText, links, remarks),
    );
    return {
      intent: 'action',
      subject: parsed.subject,
      body: parsed.body,
      summary: result.changeSummary || 'Done — I updated the email.',
    };
  }
  return { intent: 'question', summary: result.answer };
}
