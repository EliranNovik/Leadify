import { supabase } from './supabase';

export type AiSuggestionRequestType = 'improve' | 'suggest';

export type AiSuggestionHistoryItem = {
  id?: string | number;
  direction: 'in' | 'out';
  message: string;
  sent_at: string;
  sender_name?: string;
};

export type AiSuggestionResult = {
  success: boolean;
  suggestion: string;
  code?: string;
  error?: string;
};

function asResult(payload: unknown): AiSuggestionResult {
  const result = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  if (result.success && typeof result.suggestion === 'string') {
    return {
      success: true,
      suggestion: result.suggestion.trim(),
      code: typeof result.code === 'string' ? result.code : undefined,
    };
  }
  return {
    success: false,
    suggestion: '',
    code: typeof result.code === 'string' ? result.code : undefined,
    error: typeof result.error === 'string' ? result.error : 'Failed to get AI suggestions',
  };
}

export async function fetchAiMessageSuggestion(params: {
  currentMessage: string;
  conversationHistory: AiSuggestionHistoryItem[];
  clientName?: string;
  requestType: AiSuggestionRequestType;
}): Promise<AiSuggestionResult> {
  const { data, error } = await supabase.functions.invoke('whatsapp-ai-suggestions', {
    body: {
      currentMessage: params.currentMessage,
      conversationHistory: params.conversationHistory,
      clientName: params.clientName,
      requestType: params.requestType,
    },
  });

  if (error) {
    let payload: unknown = data;
    const context = (error as { context?: Response }).context;
    if (!payload && context && typeof context.json === 'function') {
      payload = await context.json().catch(() => null);
    }
    const parsed = asResult(payload);
    if (parsed.code === 'OPENAI_QUOTA') return parsed;
    const message = parsed.error || error.message || 'Request failed with status 401';
    throw new Error(message);
  }

  const parsed = asResult(data);
  if (!parsed.success && parsed.code === 'OPENAI_QUOTA') return parsed;
  if (!parsed.success) throw new Error(parsed.error || 'Failed to get AI suggestions');
  return parsed;
}
