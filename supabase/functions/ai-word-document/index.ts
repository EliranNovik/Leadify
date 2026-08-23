import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import {
  createThinkingSseResponse,
  streamOpenAiJsonCompletion,
} from '../_shared/aiStreamJson.ts';

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

const FORMATTING_RULES = `FORMATTING RULES (strict):
- The document uses special inline markers for styling. You MUST preserve them exactly:
  [[B]]...[[/B]] = bold, [[I]]...[[/I]] = italic, [[U]]...[[/U]] = underline, [[S]]...[[/S]] = strikethrough
  [[FS:16px]]...[[/FS]] = font size, [[FF:Arial]]...[[/FF]] = font family
- If you improve words inside a marked region, keep the same opening/closing markers around the updated text.
- Do NOT use markdown or HTML (no **, <b>, etc.).
- Separate paragraphs with a blank line.
- Use "- " for bullets and "1. " for numbered lists when lists are requested.`;

type ChatTurn = { role: string; content: string };

function formatChatHistory(history: ChatTurn[] | undefined): string {
  if (!history?.length) return '(No prior chat messages.)';
  return history
    .slice(-8)
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.trim()}`)
    .join('\n\n');
}

function buildCreatePrompt(contextLines: string[], userMessage: string): string {
  return `Write a professional Word document for a citizenship/immigration law office.

The user described what they want. Produce a complete, well-structured document they can edit further.
Preserve the requested language (Hebrew stays Hebrew, English stays English). If none is specified, match the user's message.

${FORMATTING_RULES}

Return JSON with exactly these keys (put "thinking" first):
{
  "thinking": "2-4 short plain lines on your plan",
  "intent": "action",
  "answer": "",
  "improvedDocumentText": "the full document text with markers",
  "changeSummary": "3–6 bullet lines (• prefix) describing what you wrote"
}

${contextLines.length ? `${contextLines.join('\n')}\n\n` : ''}User request:
${userMessage.trim()}`;
}

function buildChatPrompt(
  contextLines: string[],
  currentDocumentText: string,
  userMessage: string,
  chatHistory: ChatTurn[] | undefined,
): string {
  return `The user is writing a freeform Word document in a CRM editor.

First decide the intent:
- "question" — asking for advice or ideas WITHOUT asking you to edit the document now.
- "action" — an explicit request to write, rewrite, add, remove, or fix document text now.

Rules:
- If the current document is empty and they describe what they want, treat it as "action" and write the full document.
- If the message is ambiguous, prefer "question" unless they clearly want the text changed.
- For "question": answer concisely (3–8 bullet lines with "• " prefix when listing ideas). Do NOT rewrite the document.
- For "action": apply the requested edits or write the requested document. Do not invent case-specific legal/financial facts that are not in the draft or user message.
- Preserve the document's primary language.

${FORMATTING_RULES}

Return JSON with exactly these keys (put "thinking" first):
{
  "thinking": "2-4 short plain lines on your plan",
  "intent": "question" | "action",
  "answer": "required when intent is question",
  "improvedDocumentText": "required when intent is action — full revised document",
  "changeSummary": "required when intent is action — 3–6 bullet lines (• prefix)"
}

When intent is "question", set improvedDocumentText and changeSummary to empty strings.
When intent is "action", set answer to empty string.

${contextLines.length ? `${contextLines.join('\n')}\n\n` : ''}Recent chat:
${formatChatHistory(chatHistory)}

User message:
${userMessage.trim()}

Current document text:
${currentDocumentText.trim() || '(empty)'}
`;
}

type Parsed = {
  intent?: string;
  answer?: string;
  improvedDocumentText?: string;
  improvedContractText?: string;
  changeSummary?: string;
};

function buildResult(parsed: Parsed): Record<string, unknown> {
  const intent = parsed.intent === 'question' ? 'question' : 'action';
  if (intent === 'question') {
    const answer =
      typeof parsed.answer === 'string' && parsed.answer.trim()
        ? parsed.answer.trim()
        : 'I can draft or revise this document — tell me what you want written.';
    return { intent: 'question', answer };
  }

  const improvedDocumentText = (
    parsed.improvedDocumentText ||
    parsed.improvedContractText ||
    ''
  ).trim();
  if (!improvedDocumentText) {
    throw new Error('AI returned an empty document');
  }
  const changeSummary =
    typeof parsed.changeSummary === 'string' && parsed.changeSummary.trim()
      ? parsed.changeSummary.trim()
      : 'Document updated based on your request.';

  return { intent: 'action', improvedDocumentText, changeSummary };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const {
      currentDocumentText,
      userRemarks,
      clientName,
      leadNumber,
      language,
      category,
      chatHistory,
      streamThinking,
    } = await req.json();

    if (!OPENAI_API_KEY) {
      throw new Error('OpenAI API key not configured');
    }

    const remarks = typeof userRemarks === 'string' ? userRemarks.trim() : '';
    if (!remarks) {
      throw new Error('Describe the document you want to create or change');
    }

    const contextLines = [
      clientName ? `Client: ${clientName}` : '',
      leadNumber ? `Lead: ${leadNumber}` : '',
      language ? `Language: ${language}` : '',
      category ? `Category: ${category}` : '',
    ].filter(Boolean);

    const currentText =
      typeof currentDocumentText === 'string' ? currentDocumentText : '';
    const isEmptyDraft = !currentText.trim();

    const prompt = isEmptyDraft
      ? buildCreatePrompt(contextLines, remarks)
      : buildChatPrompt(
          contextLines,
          currentText,
          remarks,
          Array.isArray(chatHistory) ? chatHistory : undefined,
        );

    const openaiBody = {
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You help staff write Word documents in a citizenship/immigration law CRM. Put "thinking" first in JSON. For questions, answer only. For actions, return improvedDocumentText with [[B]]/[[I]]/[[U]] markers preserved. Respond with valid JSON only.',
        },
        { role: 'user', content: prompt },
      ],
      max_tokens: 4500,
      temperature: 0.35,
    };

    const parseAndBuild = (raw: string) => {
      let parsed: Parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error('AI returned invalid JSON');
      }
      return buildResult(parsed);
    };

    if (streamThinking === true) {
      return createThinkingSseResponse(corsHeaders, async (emit) => {
        let lastThinking = '';
        const raw = await streamOpenAiJsonCompletion(OPENAI_API_KEY, openaiBody, (text) => {
          if (text && text !== lastThinking) {
            lastThinking = text;
            emit('thinking', { text });
          }
        });
        emit('done', parseAndBuild(raw));
      });
    }

    const openaiRes = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(openaiBody),
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
    const raw = (data.choices?.[0]?.message?.content || '').trim();
    if (!raw) throw new Error('AI returned an empty response');

    return new Response(JSON.stringify(parseAndBuild(raw)), {
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
