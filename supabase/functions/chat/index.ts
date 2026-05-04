import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

type ChatPart = { type: string; text?: string; image_url?: { url: string } };

type NormalizedMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ChatPart[];
  tool_calls?: unknown;
  tool_call_id?: string;
};

function normalizeMessageForOpenAI(msg: {
  role: string;
  content: string | ChatPart[] | unknown;
  tool_calls?: unknown;
  tool_call_id?: string;
}): NormalizedMessage | null {
  if (msg.role === 'tool') {
    return {
      role: 'tool',
      content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content ?? ''),
      tool_call_id: msg.tool_call_id,
    };
  }
  if (msg.role !== 'system' && msg.role !== 'user' && msg.role !== 'assistant') {
    return null;
  }
  const content = msg.content;
  if (Array.isArray(content)) {
    return { role: msg.role, content: content as ChatPart[] };
  }
  if (typeof content === 'string') {
    return { role: msg.role, content };
  }
  return { role: msg.role, content: JSON.stringify(content ?? '') };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!OPENAI_API_KEY) {
    return new Response(JSON.stringify({ error: 'Server misconfigured: missing OPENAI_API_KEY' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json();
    const rawMessages = body.messages as unknown[];
    const images = (body.images as { name?: string; data?: string }[] | undefined) ?? [];

    if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
      return new Response(JSON.stringify({ error: 'Missing messages' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const normalized: NormalizedMessage[] = [];
    for (const m of rawMessages) {
      if (!m || typeof m !== 'object') continue;
      const n = normalizeMessageForOpenAI(m as Parameters<typeof normalizeMessageForOpenAI>[0]);
      if (n) normalized.push(n);
    }

    if (normalized.length === 0) {
      return new Response(JSON.stringify({ error: 'No valid messages' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // If client sent images separately and last user message has no images yet, append (gpt-4o vision)
    if (images.length > 0) {
      let lastUserIdx = -1;
      for (let i = normalized.length - 1; i >= 0; i--) {
        if (normalized[i].role === 'user') {
          lastUserIdx = i;
          break;
        }
      }
      if (lastUserIdx >= 0) {
        const last = normalized[lastUserIdx];
        const existingParts = Array.isArray(last.content) ? (last.content as ChatPart[]) : null;
        const hasImageInContent =
          existingParts?.some((p) => p.type === 'image_url' && p.image_url?.url) ?? false;
        if (!hasImageInContent) {
          const parts: ChatPart[] = [];
          if (typeof last.content === 'string' && last.content.trim()) {
            parts.push({ type: 'text', text: last.content });
          } else if (existingParts) {
            parts.push(...existingParts);
          }
          for (const img of images) {
            const url = img?.data;
            if (typeof url === 'string' && url.startsWith('data:')) {
              parts.push({ type: 'image_url', image_url: { url } });
            }
          }
          if (parts.length > 0) {
            normalized[lastUserIdx] = { role: 'user', content: parts };
          }
        }
      }
    }

    const hasSystem = normalized.some((msg) => msg.role === 'system');
    const systemMessage = {
      role: 'system' as const,
      content:
        'You are a helpful AI assistant embedded in Leadify CRM. Be concise, professional, and accurate. When the user shares images, analyze them when relevant.',
    };
    const openaiMessages = hasSystem ? normalized : [systemMessage, ...normalized];

    const openaiRes = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: openaiMessages,
        max_tokens: 4096,
        temperature: 0.7,
      }),
    });

    const data = await openaiRes.json();
    if (!openaiRes.ok) {
      const errMsg = data?.error?.message || `OpenAI request failed (${openaiRes.status})`;
      return new Response(JSON.stringify({ error: errMsg }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      return new Response(JSON.stringify({ error: 'Empty response from model' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ role: 'assistant', content }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('chat edge function error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
