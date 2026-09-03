export type StreamedToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

export type StreamedChatMessage = {
  role: 'assistant';
  content: string;
  tool_calls?: StreamedToolCall[];
};

type ToolAcc = { id: string; name: string; arguments: string };

function applyToolDelta(tools: ToolAcc[], raw: unknown) {
  if (!Array.isArray(raw)) return;
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as {
      index?: number;
      id?: string;
      function?: { name?: string; arguments?: string };
    };
    const idx = Number.isFinite(row.index) ? Number(row.index) : tools.length;
    if (!tools[idx]) tools[idx] = { id: '', name: '', arguments: '' };
    if (row.id) tools[idx].id = String(row.id);
    if (row.function?.name) tools[idx].name += String(row.function.name);
    if (row.function?.arguments) tools[idx].arguments += String(row.function.arguments);
  }
}

function toMessage(content: string, tools: ToolAcc[]): StreamedChatMessage {
  const toolCalls = tools
    .filter((row) => row.id && row.name)
    .map((row) => ({
      id: row.id,
      type: 'function' as const,
      function: { name: row.name, arguments: row.arguments || '{}' },
    }));
  return {
    role: 'assistant',
    content,
    ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
  };
}

async function readSseStream(
  body: ReadableStream<Uint8Array>,
  onDelta: (text: string) => void,
): Promise<StreamedChatMessage> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  const tools: ToolAcc[] = [];

  const consumeBlock = (block: string) => {
    for (const line of block.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let parsed: {
        choices?: Array<{ delta?: { content?: string | null; tool_calls?: unknown } }>;
        error?: { message?: string };
      };
      try {
        parsed = JSON.parse(payload);
      } catch {
        return;
      }
      if (parsed.error?.message) throw new Error(parsed.error.message);
      const delta = parsed.choices?.[0]?.delta;
      if (!delta) continue;
      if (typeof delta.content === 'string' && delta.content) {
        content += delta.content;
        onDelta(content);
      }
      if (delta.tool_calls) applyToolDelta(tools, delta.tool_calls);
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() || '';
    for (const part of parts) consumeBlock(part);
  }
  if (buffer.trim()) consumeBlock(buffer);
  return toMessage(content, tools);
}

export async function streamRmqAiChat(input: {
  messages: unknown[];
  images?: unknown[];
  tools?: unknown[];
  aiTraceId?: string;
  onDelta?: (text: string) => void;
}): Promise<StreamedChatMessage> {
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      'x-supabase-edge-function-streaming': 'true',
    },
    body: JSON.stringify({
      messages: input.messages,
      images: input.images || [],
      tools: input.tools,
      aiTraceId: input.aiTraceId,
      stream: true,
    }),
  });

  const contentType = response.headers.get('content-type') || '';
  const isStream = contentType.includes('text/event-stream');

  if (!isStream) {
    const data = (await response.json().catch(() => ({}))) as StreamedChatMessage & { error?: string };
    if (!response.ok) {
      throw new Error(data.error || `Request failed with status ${response.status}`);
    }
    if (typeof data.content === 'string' && data.content && input.onDelta) {
      input.onDelta(data.content);
    }
    return {
      role: 'assistant',
      content: typeof data.content === 'string' ? data.content : '',
      ...(Array.isArray(data.tool_calls) && data.tool_calls.length ? { tool_calls: data.tool_calls } : {}),
    };
  }

  if (!response.ok || !response.body) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `Request failed with status ${response.status}`);
  }

  return readSseStream(response.body, input.onDelta || (() => undefined));
}
