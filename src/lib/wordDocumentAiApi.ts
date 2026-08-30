import { supabase } from './supabase';
import { consumeWordDocumentAiReviewSse } from './aiReviewStreaming';
import { aiTextToTiptapDoc, tiptapJsonToAiText } from './contractImprovementApi';

export type WordDocumentAiChatResult =
  | { intent: 'action'; improvedDocumentText: string; changeSummary: string }
  | { intent: 'question'; answer: string };

export type WordDocumentAiInput = {
  currentDocumentText: string;
  userRemarks?: string | null;
  clientName?: string | null;
  leadNumber?: string | null;
  language?: string | null;
  category?: string | null;
  chatHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Full CRM case file (same pack as pipeline AI follow-up). */
  caseContext?: string | null;
  purpose?: 'document' | 'email_followup' | 'meeting_brief';
};

function toWordDocumentAiBody(input: WordDocumentAiInput): Record<string, unknown> {
  return {
    currentDocumentText: input.currentDocumentText,
    userRemarks: input.userRemarks ?? '',
    clientName: input.clientName ?? '',
    leadNumber: input.leadNumber ?? '',
    language: input.language ?? '',
    category: input.category ?? '',
    chatHistory: input.chatHistory ?? [],
    caseContext: input.caseContext ?? '',
    purpose: input.purpose ?? 'document',
  };
}

function normalizeResult(data: Record<string, unknown>): WordDocumentAiChatResult {
  if (data?.intent === 'question') {
    const answer =
      typeof data.answer === 'string' && data.answer.trim()
        ? data.answer.trim()
        : 'No answer returned.';
    return { intent: 'question', answer };
  }

  const improved =
    (typeof data.improvedDocumentText === 'string' && data.improvedDocumentText.trim()) ||
    (typeof data.improvedContractText === 'string' && data.improvedContractText.trim()) ||
    '';
  if (!improved) {
    throw new Error('AI returned an invalid document');
  }

  const changeSummary =
    typeof data.changeSummary === 'string' && data.changeSummary.trim()
      ? data.changeSummary.trim()
      : 'Document updated based on your request.';

  return { intent: 'action', improvedDocumentText: improved, changeSummary };
}

async function invokeWordDocumentAi(
  input: WordDocumentAiInput,
  onThinking?: (text: string) => void,
): Promise<WordDocumentAiChatResult> {
  if (onThinking) {
    try {
      const data = await consumeWordDocumentAiReviewSse<Record<string, unknown>>(
        toWordDocumentAiBody(input),
        onThinking,
      );
      if (data?.error) throw new Error(String(data.error));
      return normalizeResult(data);
    } catch (streamErr) {
      onThinking('Applying your changes…');
      console.warn('Word document AI streaming unavailable, falling back:', streamErr);
    }
  }

  const { data, error } = await supabase.functions.invoke('ai-word-document', {
    body: toWordDocumentAiBody(input),
  });

  if (error) throw new Error(error.message || 'Failed to update document with AI');
  if (data?.error) throw new Error(String(data.error));
  return normalizeResult(data as Record<string, unknown>);
}

export async function sendWordDocumentAiChatMessage(
  input: WordDocumentAiInput & { userRemarks: string },
  onThinking?: (text: string) => void,
): Promise<WordDocumentAiChatResult> {
  return invokeWordDocumentAi(input, onThinking);
}

export { aiTextToTiptapDoc, tiptapJsonToAiText };
