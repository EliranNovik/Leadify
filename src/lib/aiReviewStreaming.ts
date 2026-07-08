import { supabase } from './supabase';

export function formatAiThinkingDisplay(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/^\s*[•\-*]\s*/, ''))
    .join('\n')
    .trim();
}

type SseEvent = { event: string; data: string };

function parseSseBuffer(buffer: string): { events: SseEvent[]; rest: string } {
  const chunks = buffer.split('\n\n');
  const rest = chunks.pop() || '';
  const events: SseEvent[] = [];

  for (const chunk of chunks) {
    if (!chunk.trim()) continue;
    let event = 'message';
    const dataLines: string[] = [];
    for (const line of chunk.split('\n')) {
      if (line.startsWith('event: ')) event = line.slice(7).trim();
      if (line.startsWith('data: ')) dataLines.push(line.slice(6));
    }
    if (dataLines.length) {
      events.push({ event, data: dataLines.join('\n') });
    }
  }

  return { events, rest };
}

async function consumeAiReviewSse<T>(
  functionName: string,
  body: Record<string, unknown>,
  onThinking?: (text: string) => void,
): Promise<T> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
  const baseUrl = import.meta.env.VITE_SUPABASE_URL as string;

  const response = await fetch(`${baseUrl}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${accessToken || anonKey}`,
    },
    body: JSON.stringify({ ...body, streamThinking: true }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `AI request failed (${response.status})`);
  }

  if (!response.body) {
    throw new Error('AI stream unavailable');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: T | null = null;
  let streamError: string | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let parsed = parseSseBuffer(buffer);
    buffer = parsed.rest;

    for (const evt of parsed.events) {
      if (evt.event === 'thinking' && onThinking) {
        try {
          const payload = JSON.parse(evt.data) as { text?: string };
          if (payload.text) onThinking(formatAiThinkingDisplay(payload.text));
        } catch {
          // ignore malformed thinking events
        }
      } else if (evt.event === 'done') {
        result = JSON.parse(evt.data) as T;
      } else if (evt.event === 'error') {
        try {
          const payload = JSON.parse(evt.data) as { error?: string };
          streamError = payload.error || 'AI request failed';
        } catch {
          streamError = 'AI request failed';
        }
      }
    }
  }

  if (streamError) throw new Error(streamError);
  if (!result) throw new Error('AI returned an empty response');
  return result;
}

export async function consumePoaAiReviewSse<T>(
  body: Record<string, unknown>,
  onThinking?: (text: string) => void,
): Promise<T> {
  return consumeAiReviewSse<T>('ai-poa-improvement', body, onThinking);
}

export async function consumeContractAiReviewSse<T>(
  body: Record<string, unknown>,
  onThinking?: (text: string) => void,
): Promise<T> {
  return consumeAiReviewSse<T>('ai-contract-improvement', body, onThinking);
}
