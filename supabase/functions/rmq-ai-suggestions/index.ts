import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

interface HistoryItem {
  id: number;
  sender_name: string;
  content: string;
  sent_at: string;
  is_own: boolean;
}

interface RMQAIRequest {
  currentMessage?: string;
  conversationHistory: HistoryItem[];
  requestType: 'improve' | 'suggest';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { currentMessage, conversationHistory, requestType }: RMQAIRequest = await req.json();

    if (!conversationHistory || !Array.isArray(conversationHistory)) {
      throw new Error('Conversation history is required');
    }

    if (!OPENAI_API_KEY) {
      throw new Error('OpenAI API key not configured');
    }

    const conversationContext = conversationHistory
      .slice(-12)
      .map((msg) => {
        const who = msg.is_own ? 'You' : msg.sender_name || 'Colleague';
        const t = new Date(msg.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return `[${t}] ${who}: ${msg.content || ''}`;
      })
      .join('\n');

    let systemPrompt: string;
    let userPrompt: string;

    if (requestType === 'improve' && currentMessage?.trim()) {
      systemPrompt = `You are an assistant for internal team chat in a CRM (legal / immigration services). Improve the draft message: professional, concise, collaborative. Keep the same intent. Return ONLY the improved text, no quotes or explanation.`;

      userPrompt = `Draft to improve:\n"${currentMessage.trim()}"\n\nRecent thread:\n${conversationContext}\n\nReturn ONLY the improved message text.`;
    } else if (requestType === 'suggest') {
      systemPrompt = `You are an assistant for internal team chat in a CRM. Suggest ONE short follow-up message a colleague could send next: actionable, professional, friendly. Return ONLY the suggestion text.`;

      userPrompt = `Recent thread:\n${conversationContext}\n\nReturn ONE suggested next message only.`;
    } else {
      throw new Error('Invalid request');
    }

    const response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 500,
        temperature: 0.6,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const status = response.status;
      const message = `OpenAI API error: ${status} ${(errorData as { error?: { message?: string } }).error?.message || response.statusText}`;
      return new Response(
        JSON.stringify({
          success: false,
          error: message,
          code: status === 429 ? 'OPENAI_QUOTA' : 'OPENAI_ERROR',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status }
      );
    }

    const data = await response.json();
    const aiResponse = data.choices[0].message.content as string;

    return new Response(JSON.stringify({ success: true, suggestion: aiResponse, requestType }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('rmq-ai-suggestions:', error);
    const msg = (error as Error)?.message || 'Unknown error';
    const isQuota = msg.includes('429') || /quota/i.test(msg);
    return new Response(
      JSON.stringify({
        success: false,
        error: msg,
        code: isQuota ? 'OPENAI_QUOTA' : 'UNKNOWN_ERROR',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: isQuota ? 429 : 500 }
    );
  }
});
