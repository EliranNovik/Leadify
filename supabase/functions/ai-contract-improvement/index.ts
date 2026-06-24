import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

const FORMATTING_RULES = `FORMATTING RULES (strict):
- The contract uses special inline markers for styling. You MUST preserve them exactly:
  [[B]]...[[/B]] = bold, [[I]]...[[/I]] = italic, [[U]]...[[/U]] = underline, [[S]]...[[/S]] = strikethrough
  [[FS:16px]]...[[/FS]] = font size, [[FF:Arial]]...[[/FF]] = font family
- If you improve words inside a marked region, keep the same opening/closing markers around the updated text.
- Do NOT remove, add, or change these markers except to wrap the same styled span after wording changes.
- Do NOT use markdown or HTML (no **, <b>, etc.).
- Do NOT add or remove paragraph breaks unless clearly needed for the requested change.
- Only change or add plain words inside markers; never change styling structure.`;

function buildInitialPrompt(
  contextLines: string[],
  currentContractText: string,
  summariesBlock: string,
): string {
  return `Improve the following contract text using the meeting summaries for this lead.

Make the contract more professional, clear, organized, and aligned with what was discussed in the meetings.
You may add relevant missing points that are clearly supported by the meeting summaries.
Do not invent legal, financial, payment, deadline, or service details that are not present in the contract or meeting summaries.
Keep placeholder tokens such as {{client_name}}, {{signature}}, {{date}}, and payment placeholders exactly as they appear when present.
Preserve the same primary language as the contract (Hebrew stays Hebrew, English stays English).

${FORMATTING_RULES}

Return a JSON object with exactly two keys:
1. "improvedContractText" — the full improved contract text (with all [[B]]/[[I]]/etc. markers preserved).
2. "changeSummary" — a concise plain-text explanation for the lawyer reviewing the draft: what you changed and why (3–8 short bullet lines using "• " prefix; mention meeting-summary sources when relevant; no markdown fences).

${contextLines.length ? `${contextLines.join('\n')}\n\n` : ''}Current contract text:
${currentContractText.trim()}

Meeting summaries:
${summariesBlock}`;
}

type ChatTurn = { role: string; content: string };

function formatChatHistory(history: ChatTurn[] | undefined): string {
  if (!history?.length) return '(No prior chat messages.)';
  return history
    .slice(-8)
    .map((m) => `${m.role === 'user' ? 'Lawyer' : 'Assistant'}: ${m.content.trim()}`)
    .join('\n\n');
}

function buildChatPrompt(
  contextLines: string[],
  currentContractText: string,
  summariesBlock: string,
  userMessage: string,
  chatHistory: ChatTurn[] | undefined,
): string {
  return `The lawyer sent a message about the contract draft in the AI review chat.

First decide the intent:
- "question" — asking for advice, ideas, suggestions, review, or clarification WITHOUT asking you to edit the contract now.
  Examples: "what else can be improved?", "what should we add?", "is clause 5 clear enough?", "any risks here?", "what do you think?"
- "action" — an explicit request to change, edit, add, remove, rewrite, or fix specific contract text now.
  Examples: "add a confidentiality clause", "make payment terms clearer", "remove section 3", "soften the cancellation wording"

Rules:
- If the message is ambiguous, prefer "question" unless they clearly want the contract modified immediately.
- For "question": answer concisely and helpfully (3–8 bullet lines with "• " prefix when listing ideas). Do NOT rewrite the contract.
- For "action": apply ONLY the requested edits. Keep placeholders ({{client_name}}, {{signature}}, {{date}}, etc.) exactly as they appear.
- Do not invent legal, financial, payment, deadline, or service details beyond the contract, meeting summaries, or user message.
- Preserve the contract's primary language (Hebrew stays Hebrew, English stays English).

${FORMATTING_RULES}

Return JSON with exactly these keys:
{
  "intent": "question" | "action",
  "answer": "required when intent is question — plain-text reply for the lawyer",
  "improvedContractText": "required when intent is action — full revised contract with all markers preserved",
  "changeSummary": "required when intent is action — 3–6 bullet lines (• prefix) explaining what changed"
}

When intent is "question", set improvedContractText and changeSummary to empty strings.
When intent is "action", set answer to empty string.

${contextLines.length ? `${contextLines.join('\n')}\n\n` : ''}Recent chat:
${formatChatHistory(chatHistory)}

Lawyer message:
${userMessage.trim()}

Current contract text:
${currentContractText.trim()}

Meeting summaries (context):
${summariesBlock}`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const {
      currentContractText,
      meetingSummaries,
      clientName,
      leadNumber,
      userRemarks,
      chatHistory,
    } = await req.json();

    if (!currentContractText || typeof currentContractText !== 'string' || !currentContractText.trim()) {
      throw new Error('Current contract text is required');
    }

    if (!OPENAI_API_KEY) {
      throw new Error('OpenAI API key not configured');
    }

    const contextLines = [
      clientName ? `Client: ${clientName}` : '',
      leadNumber ? `Lead: ${leadNumber}` : '',
    ].filter(Boolean);

    const summariesBlock =
      meetingSummaries && typeof meetingSummaries === 'string' && meetingSummaries.trim()
        ? meetingSummaries.trim()
        : '(No meeting summaries available for this lead.)';

    const isChat =
      typeof userRemarks === 'string' && userRemarks.trim().length > 0;

    const prompt = isChat
      ? buildChatPrompt(
          contextLines,
          currentContractText,
          summariesBlock,
          userRemarks,
          Array.isArray(chatHistory) ? chatHistory : undefined,
        )
      : buildInitialPrompt(contextLines, currentContractText, summariesBlock);

    const systemContent = isChat
      ? 'You assist lawyers reviewing contract drafts in a citizenship/immigration law CRM. Classify each message as question or action. For questions, answer only. For actions, return improvedContractText with all [[B]], [[I]], [[U]], [[S]], [[FS:...]], and [[FF:...]] markers preserved. Respond with valid JSON only.'
      : 'You improve legal service contracts for a citizenship/immigration law CRM. Preserve all [[B]], [[I]], [[U]], [[S]], [[FS:...]], and [[FF:...]] markers in improvedContractText. Respond with valid JSON only.';

    const openaiRes = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemContent },
          { role: 'user', content: prompt },
        ],
        max_tokens: isChat ? 3500 : 4500,
        temperature: isChat ? 0.3 : 0.35,
      }),
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
    if (!raw) {
      throw new Error('AI returned an empty response');
    }

    let parsed: {
      intent?: string;
      answer?: string;
      improvedContractText?: string;
      changeSummary?: string;
    };
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('AI returned invalid JSON');
    }

    if (isChat) {
      const intent = parsed.intent === 'action' ? 'action' : 'question';
      if (intent === 'question') {
        const answer =
          typeof parsed.answer === 'string' && parsed.answer.trim()
            ? parsed.answer.trim()
            : 'I can suggest improvements — try asking what else could be added or clarified.';
        return new Response(JSON.stringify({ intent: 'question', answer }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const improvedContractText = parsed.improvedContractText?.trim();
      if (!improvedContractText) {
        throw new Error('AI returned an empty contract');
      }
      const changeSummary =
        typeof parsed.changeSummary === 'string' && parsed.changeSummary.trim()
          ? parsed.changeSummary.trim()
          : 'Contract updated based on your request.';

      return new Response(JSON.stringify({
        intent: 'action',
        improvedContractText,
        changeSummary,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const improvedContractText = parsed.improvedContractText?.trim();
    if (!improvedContractText) {
      throw new Error('AI returned an empty contract');
    }

    const changeSummary =
      typeof parsed.changeSummary === 'string' && parsed.changeSummary.trim()
        ? parsed.changeSummary.trim()
        : 'Contract wording was improved based on meeting summaries.';

    return new Response(JSON.stringify({ intent: 'action', improvedContractText, changeSummary }), {
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
