import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { supabase } from '../_shared/supabase-client.ts';

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

function formatTimeline(interactions: any[]): string {
  return interactions
    .map((i) => {
      const who = i.direction === 'in' ? 'Client' : 'Employee';
      return `${i.date} ${i.time} - ${who} (${i.employee}) via ${i.kind}: ${i.content || ''}${i.observation ? ' | ' + i.observation : ''}`;
    })
    .join('\n');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { messages } = await req.json();
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      throw new Error('No messages provided');
    }
    // Only use the latest 10 messages for the summary
    const latestMessages = messages.slice(-10);
    // Format the timeline for the prompt
    const timelineText = latestMessages
      .map((m) => {
        const who = m.direction === 'in' ? (m.from || 'Client') : (m.from || 'You');
        const to = m.to ? ` → ${m.to}` : '';
        const type = m.type ? m.type.charAt(0).toUpperCase() + m.type.slice(1) : '';
        const subj = m.subject ? ` | Subject: ${m.subject}` : '';
        return `[${type}] ${m.date} - ${who}${to}: ${m.content}${subj}`;
      })
      .join('\n');
    const prompt = `You are a professional legal CRM assistant. Based ONLY on the latest messages below, write a short, precise summary of the current situation and the most important next actions. Focus on what the user should do next. Be concise and actionable.\n\nTimeline:\n${timelineText}`;

    const body = {
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'You are an expert CRM assistant.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 512,
      temperature: 0.4,
    };

    const openaiRes = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!openaiRes.ok) {
      const err = await openaiRes.json().catch(() => ({}));
      throw new Error(`${openaiRes.status} ${err.error?.message || openaiRes.statusText}`);
    }
    const data = await openaiRes.json();
    const text = data.choices?.[0]?.message?.content || '';

    // Try to split summary and action items if possible
    let summary = text;
    let actionItems = '';
    const split = text.split(/Action Items:|Follow-up Actions:|Next Steps:/i);
    if (split.length > 1) {
      summary = split[0].trim();
      actionItems = split.slice(1).join('\n').trim();
    }

    return new Response(
      JSON.stringify({ summary, actionItems }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message || 'Unknown error' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}); 