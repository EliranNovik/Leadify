const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

export function extractPartialThinking(buffer: string): string {
  const match = buffer.match(/"thinking"\s*:\s*"((?:[^"\\]|\\.)*)/);
  if (!match?.[1]) return '';
  try {
    return JSON.parse(`"${match[1]}"`);
  } catch {
    return match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
}

export async function streamOpenAiJsonCompletion(
  apiKey: string,
  body: Record<string, unknown>,
  onThinking: (text: string) => void,
): Promise<string> {
  const openaiRes = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ...body, stream: true }),
  });

  if (!openaiRes.ok) {
    const err = await openaiRes.json().catch(() => ({}));
    throw new Error(err.error?.message || openaiRes.statusText);
  }

  if (!openaiRes.body) {
    throw new Error('AI stream unavailable');
  }

  const reader = openaiRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let sseBuffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    sseBuffer += decoder.decode(value, { stream: true });

    const lines = sseBuffer.split('\n');
    sseBuffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const parsed = JSON.parse(payload);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta) {
          buffer += delta;
          const thinking = extractPartialThinking(buffer);
          if (thinking) onThinking(thinking);
        }
      } catch {
        // ignore malformed SSE chunks
      }
    }
  }

  if (!buffer.trim()) {
    throw new Error('AI returned an empty response');
  }

  return buffer.trim();
}

export function createThinkingSseResponse(
  corsHeaders: Record<string, string>,
  run: (emit: (event: string, data: unknown) => void) => Promise<void>,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };
      try {
        await run(emit);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        emit('error', { error: message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
