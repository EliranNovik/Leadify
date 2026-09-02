import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { OPENAI_CHAT_COMPLETIONS_URL, buildChatCompletionBody } from '../_shared/openaiModels.ts';

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { draft, clientName, leadNumber, meetingDate, meetingLocation } = await req.json();

    if (!draft || typeof draft !== 'string' || !draft.trim()) {
      throw new Error('Draft summary text is required');
    }

    if (!OPENAI_API_KEY) {
      throw new Error('OpenAI API key not configured');
    }

    const contextLines = [
      clientName ? `Client: ${clientName}` : '',
      leadNumber ? `Lead: ${leadNumber}` : '',
      meetingDate ? `Meeting date: ${meetingDate}` : '',
      meetingLocation ? `Location: ${meetingLocation}` : '',
    ].filter(Boolean);

    const prompt = `Improve the following meeting summary notes for a citizenship/immigration law CRM.

Requirements:
- Keep the same language as the draft (Hebrew stays Hebrew, English stays English)
- Preserve every factual detail from the draft; do not invent new facts
- Make the text clearer, better organized, and professional
- Expand into a detailed meeting summary with several short paragraphs (what was discussed, case status, next step)
- Use plain text with short paragraphs
- No markdown, no bullet symbols unless the draft already used a list style
- End with next steps when the draft mentions follow-ups or a next action is implied

${contextLines.length ? `${contextLines.join('\n')}\n` : ''}
Draft:
${draft.trim()}`;

    const openaiRes = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildChatCompletionBody({
        messages: [
          {
            role: 'system',
            content:
              'You polish meeting summary notes for legal CRM users. Output only the improved summary text.',
          },
          { role: 'user', content: prompt },
        ],
        maxTokens: 1600,
        temperature: 0.35,
      })),
    });

    if (!openaiRes.ok) {
      const err = await openaiRes.json().catch(() => ({}));
      const errorMessage = err.error?.message || openaiRes.statusText;
      if (openaiRes.status === 429) {
        return new Response(
          JSON.stringify({
            error: 'AI rate limit reached. Please try again shortly.',
            code: 'RATE_LIMIT',
          }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      throw new Error(errorMessage);
    }

    const data = await openaiRes.json();
    const summary = (data.choices?.[0]?.message?.content || '').trim();
    if (!summary) {
      throw new Error('AI returned an empty summary');
    }

    return new Response(JSON.stringify({ summary }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
