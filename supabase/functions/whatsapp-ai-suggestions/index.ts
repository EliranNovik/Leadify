import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

interface WhatsAppMessage {
  id: number;
  direction: 'in' | 'out';
  message: string;
  sent_at: string;
  sender_name: string;
}

interface AIRequest {
  currentMessage?: string;
  conversationHistory: WhatsAppMessage[];
  clientName?: string;
  requestType: 'improve' | 'suggest';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { currentMessage, conversationHistory, clientName, requestType }: AIRequest = await req.json();

    if (!conversationHistory || !Array.isArray(conversationHistory)) {
      throw new Error('Conversation history is required');
    }

    if (!OPENAI_API_KEY) {
      throw new Error('OpenAI API key not configured');
    }

    // Build conversation context
    const conversationContext = conversationHistory
      .slice(-10) // Last 10 messages for context
      .map(msg => {
        const sender = msg.direction === 'in' ? (clientName || 'Client') : 'You';
        const timestamp = new Date(msg.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return `[${timestamp}] ${sender}: ${msg.message}`;
      })
      .join('\n');

    let systemPrompt: string;
    let userPrompt: string;

    if (requestType === 'improve' && currentMessage) {
      systemPrompt = `You are a professional WhatsApp messaging assistant for a legal firm. Your role is to improve and polish messages while maintaining their original intent and tone. 

Guidelines:
- Keep the message professional but friendly
- Maintain the original meaning and intent
- Use proper grammar and spelling
- Make it clear and concise
- Keep it appropriate for WhatsApp communication
- Don't change the core message, just improve the delivery
- Return ONLY the improved message text, no explanations or extra text`;

      userPrompt = `Please improve this WhatsApp message for a legal firm client conversation:

Current message: "${currentMessage}"

Conversation context:
${conversationContext}

Return ONLY the improved message text. Do not include any explanations, numbering, or extra text.`;

    } else if (requestType === 'suggest') {
      systemPrompt = `You are a professional WhatsApp messaging assistant for a legal firm. Your role is to suggest appropriate follow-up messages based on the conversation context.

Guidelines:
- Keep messages professional but friendly
- Be contextually appropriate
- Consider the conversation flow
- Use proper grammar and spelling
- Make suggestions actionable and helpful
- Keep messages concise and clear
- Return ONLY one message suggestion, no explanations or extra text`;

      userPrompt = `Based on this WhatsApp conversation with a legal firm client, suggest ONE appropriate follow-up message:

Conversation context:
${conversationContext}

Client name: ${clientName || 'Client'}

Return ONLY one message suggestion that would be appropriate as the next message from the legal firm. Do not include any explanations, numbering, or extra text.`;

    } else {
      throw new Error('Invalid request type or missing current message for improve request');
    }

    const response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: 500,
        temperature: 0.7
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const status = response.status;
      const message = `OpenAI API error: ${status} ${errorData.error?.message || response.statusText}`;
      // Return a structured error with appropriate status (e.g., 429 quota exceeded)
      return new Response(JSON.stringify({
        success: false,
        error: message,
        code: status === 429 ? 'OPENAI_QUOTA' : 'OPENAI_ERROR'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status
      });
    }

    const data = await response.json();
    const aiResponse = data.choices[0].message.content;

    return new Response(JSON.stringify({
      success: true,
      suggestion: aiResponse,
      requestType
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in whatsapp-ai-suggestions function:', error);
    const msg = (error as Error)?.message || 'Unknown error';
    const isQuota = msg.includes('429') || /quota/i.test(msg);
    return new Response(JSON.stringify({
      success: false,
      error: msg,
      code: isQuota ? 'OPENAI_QUOTA' : 'UNKNOWN_ERROR'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: isQuota ? 429 : 500,
    });
  }
});
