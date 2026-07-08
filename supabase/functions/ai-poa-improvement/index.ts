import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import {
  createThinkingSseResponse,
  streamOpenAiJsonCompletion,
} from '../_shared/aiStreamJson.ts';

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

const MAX_SUMMARY_CHARS = 2800;
const MAX_POA_FULL_FOR_PLACEMENT = 12000;
const MAX_POA_EXCERPT_CHARS = 4500;

const PLACEMENT_RULES = `PLACEMENT RULES (critical):
- Read the full POA structure before editing. Place new clauses in the logically correct section (scope of authority, powers, declarations, limitations, place/date, signature block).
- Prefer editKind "insert_after" with an exact "find" anchor copied from the POA (a full sentence or line, including {{field}} tokens when present).
- Use "replace" only to revise existing wording in place.
- Use "append" ONLY when the user explicitly asks to add at the end, or the content clearly belongs after the final paragraph/signature block.
- NEVER dump unrelated new paragraphs at the document end when they belong earlier.
- If multiple additions are needed in different sections, use editKind "full" and return the complete revised POA with everything in the right order.`;

const FORMATTING_RULES = `Keep ** __ ++ == markers and {{field}} tokens unchanged unless editing that text.`;

function truncateText(text: string, maxLen: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen)}\n…[truncated]`;
}

function poaTextForPlacementPrompt(poaText: string): string {
  const trimmed = poaText.trim();
  if (!trimmed) return '(empty)';
  if (trimmed.length <= MAX_POA_FULL_FOR_PLACEMENT) return trimmed;
  return poaExcerptForPrompt(trimmed);
}

function poaExcerptForPrompt(poaText: string): string {
  const trimmed = poaText.trim();
  if (trimmed.length <= MAX_POA_EXCERPT_CHARS) return trimmed;
  const head = Math.floor(MAX_POA_EXCERPT_CHARS * 0.55);
  const tail = MAX_POA_EXCERPT_CHARS - head - 40;
  return `${trimmed.slice(0, head)}\n…[middle omitted for speed]…\n${trimmed.slice(-tail)}`;
}

function isLikelySmallEdit(userMessage: string, poaText: string): boolean {
  if (!poaText.trim()) return false;
  const msg = userMessage.trim();
  if (
    /rewrite|entire|whole|full document|improve all|reformat|what else|what can|add what|needed|missing|please add|make sure|place it|כל המסמך|לשכתב|שכתב מחדש|הוסף|שפר|מה עוד/i.test(
      msg,
    )
  ) {
    return false;
  }
  if (
    /after (the |this )?(sentence|paragraph|line|clause)|replace .+ with|insert after/i.test(msg) &&
    msg.length < 220
  ) {
    return true;
  }
  return false;
}

function isPureQuestionOnly(userMessage: string): boolean {
  const msg = userMessage.trim();
  if (/add|change|insert|improve|update|fix|place|needed|missing|הוסף|שפר|עדכן|תקן/i.test(msg)) {
    return false;
  }
  return /^(what does|what is the meaning|explain|why does|how does|הסבר|מה פירוש)/i.test(msg);
}

function buildInitialPrompt(
  contextLines: string[],
  currentPoaText: string,
  summariesBlock: string,
): string {
  const isDraft = !currentPoaText.trim();
  const task = isDraft
    ? `Draft a complete power of attorney (POA) document body using the meeting summaries and context below.
Use professional legal tone appropriate for citizenship/immigration services.
Include sensible {{field}} placeholders (e.g. {{name}}, {{id_passport}}, {{signature}}, {{date}}, {{note}}).`
    : `Improve the following POA using meeting summaries. Integrate every addition into the correct section of the document — do NOT append unrelated clauses at the end.
Preserve language and placeholders. Reorder or expand existing paragraphs when needed so the POA reads as one coherent document.`;

  return `${task}

${FORMATTING_RULES}

${PLACEMENT_RULES}

Return JSON: { "thinking": "2-4 short plain lines (no bullet symbols) describing what you are reviewing and will change", "improvedPoaText": "...", "changeSummary": "3-5 bullet lines with • prefix" }

${contextLines.length ? `${contextLines.join('\n')}\n\n` : ''}Current POA:
${isDraft ? '(Empty — draft from summaries.)' : currentPoaText.trim()}

Meeting summaries:
${summariesBlock}`;
}

type ChatTurn = { role: string; content: string };

function formatChatHistory(history: ChatTurn[] | undefined): string {
  if (!history?.length) return '(none)';
  return history
    .slice(-4)
    .map((m) => `${m.role === 'user' ? 'Staff' : 'AI'}: ${m.content.trim()}`)
    .join('\n');
}

function buildFastEditPrompt(
  contextLines: string[],
  poaText: string,
  userMessage: string,
): string {
  const placementDoc = poaTextForPlacementPrompt(poaText);
  const docTruncated = poaText.trim().length > MAX_POA_FULL_FOR_PLACEMENT;

  return `Apply a SMALL targeted edit to the POA. Do NOT return the full document unless multiple sections must change.

Staff request: ${userMessage.trim()}

${contextLines.length ? `${contextLines.join(' · ')}\n\n` : ''}${docTruncated ? 'POA (excerpt — copy find anchors from visible text only):' : 'Full POA (scan structure and pick the correct anchor):'}
${placementDoc}

${FORMATTING_RULES}

${PLACEMENT_RULES}

Return JSON only:
{
  "thinking": "2-3 short plain lines (no bullet symbols): which section you chose and why",
  "intent": "action",
  "editKind": "insert_after" | "replace" | "prepend" | "append" | "full",
  "text": "only the new or replacement text (not the whole POA)",
  "find": "required for insert_after/replace — exact substring copied from the POA above",
  "changeSummary": "one short line",
  "improvedPoaText": "only if editKind is full, else empty string"
}

Default to insert_after with a precise find anchor. Use full when the edit touches more than one section.`;
}

function buildChatPrompt(
  contextLines: string[],
  currentPoaText: string,
  summariesBlock: string,
  userMessage: string,
  chatHistory: ChatTurn[] | undefined,
  fastEdit: boolean,
): string {
  if (fastEdit) {
    return buildFastEditPrompt(contextLines, currentPoaText, userMessage);
  }

  return `The staff member is editing this POA in the review panel. Apply their request NOW — update the document.

${FORMATTING_RULES}

${PLACEMENT_RULES}

Use meeting summaries to decide what to add or improve when the request is open-ended (e.g. "what else can be added", "add what is needed").

Return JSON — always use intent "action":
{
  "thinking": "2-4 short plain lines (no bullet symbols) on your plan",
  "intent": "action",
  "editKind": "full" | "insert_after" | "replace" | "prepend" | "append",
  "text": "patch text when editKind is not full",
  "find": "exact POA substring when using insert_after or replace",
  "improvedPoaText": "complete revised POA when editKind is full, else empty string",
  "changeSummary": "3-6 bullet lines with • prefix"
}

Rules:
- Broad requests → editKind "full" + improvedPoaText (integrate into correct sections).
- One specific insertion → insert_after with find + text.
- Only return intent "question" with an answer if the message is purely explanatory (e.g. "what does clause 2 mean?") and requires zero document changes.

${contextLines.length ? `${contextLines.join('\n')}\n\n` : ''}Chat:
${formatChatHistory(chatHistory)}

Request: ${userMessage.trim()}

POA:
${currentPoaText.trim() || '(empty)'}

Summaries:
${summariesBlock}`;
}

type PoaParsed = {
  intent?: string;
  answer?: string;
  improvedPoaText?: string;
  changeSummary?: string;
  editKind?: string;
  text?: string;
  find?: string;
};

function buildPoaResult(
  parsed: PoaParsed,
  isChat: boolean,
  options?: { fastEdit?: boolean; userMessage?: string },
): Record<string, unknown> {
  const fastEdit = options?.fastEdit === true;
  const userMessage = options?.userMessage?.trim() || '';

  if (isChat) {
    const patchText = typeof parsed.text === 'string' ? parsed.text.trim() : '';
    const improvedPoaText = parsed.improvedPoaText?.trim() || '';
    const hasEditPayload = Boolean(patchText || improvedPoaText);

    if (
      !fastEdit &&
      !hasEditPayload &&
      parsed.intent === 'question' &&
      userMessage &&
      isPureQuestionOnly(userMessage)
    ) {
      const answer =
        typeof parsed.answer === 'string' && parsed.answer.trim()
          ? parsed.answer.trim()
          : 'I can suggest improvements — try asking what else could be added or clarified.';
      return { intent: 'question', answer };
    }

    const editKind = parsed.editKind || (improvedPoaText ? 'full' : patchText ? 'insert_after' : 'full');
    const changeSummary =
      typeof parsed.changeSummary === 'string' && parsed.changeSummary.trim()
        ? parsed.changeSummary.trim()
        : 'POA updated based on your request.';

    if (editKind !== 'full' && patchText) {
      return {
        intent: 'action',
        editKind,
        text: patchText,
        find: typeof parsed.find === 'string' ? parsed.find.trim() : '',
        changeSummary,
        improvedPoaText: '',
      };
    }

    if (!improvedPoaText && patchText) {
      return {
        intent: 'action',
        editKind: editKind === 'full' ? 'insert_after' : editKind,
        text: patchText,
        find: typeof parsed.find === 'string' ? parsed.find.trim() : '',
        changeSummary,
        improvedPoaText: '',
      };
    }

    if (!improvedPoaText) {
      throw new Error('AI returned an empty POA');
    }

    return {
      intent: 'action',
      editKind: 'full',
      improvedPoaText,
      changeSummary,
    };
  }

  const improvedPoaText = parsed.improvedPoaText?.trim();
  if (!improvedPoaText) {
    throw new Error('AI returned an empty POA');
  }

  const changeSummary =
    typeof parsed.changeSummary === 'string' && parsed.changeSummary.trim()
      ? parsed.changeSummary.trim()
      : 'POA wording was improved based on meeting summaries.';

  return { intent: 'action', improvedPoaText, changeSummary };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const {
      currentPoaText,
      meetingSummaries,
      clientName,
      documentName,
      documentDescription,
      language,
      direction,
      userRemarks,
      chatHistory,
      preferFastEdit,
      streamThinking,
    } = await req.json();

    if (currentPoaText != null && typeof currentPoaText !== 'string') {
      throw new Error('Current POA text must be a string');
    }

    if (!OPENAI_API_KEY) {
      throw new Error('OpenAI API key not configured');
    }

    const contextLines = [
      clientName ? `Client: ${clientName}` : '',
      documentName ? `POA: ${documentName}` : '',
      language ? `Lang: ${language}` : '',
      direction ? `Dir: ${direction}` : '',
      documentDescription ? `About: ${truncateText(documentDescription, 200)}` : '',
    ].filter(Boolean);

    const summariesBlock = truncateText(
      meetingSummaries && typeof meetingSummaries === 'string' && meetingSummaries.trim()
        ? meetingSummaries.trim()
        : '(No meeting summaries.)',
      MAX_SUMMARY_CHARS,
    );

    const poaText = typeof currentPoaText === 'string' ? currentPoaText : '';
    const isChat = typeof userRemarks === 'string' && userRemarks.trim().length > 0;
    const fastEdit =
      isChat &&
      (preferFastEdit === true || isLikelySmallEdit(userRemarks, poaText));

    const prompt = isChat
      ? buildChatPrompt(
          contextLines,
          poaText,
          summariesBlock,
          userRemarks,
          Array.isArray(chatHistory) ? chatHistory : undefined,
          fastEdit,
        )
      : buildInitialPrompt(contextLines, poaText, summariesBlock);

    const systemContent = fastEdit
      ? 'Return minimal POA patches as JSON. Put "thinking" first. Default to insert_after with an exact find anchor from the POA. Use append only for true end-of-document additions. Use full when multiple sections change.'
      : isChat
        ? 'POA edit assistant. JSON only. Staff wants document changes — default to intent action with improvedPoaText or a patch. Only use question for pure explanations with no edits.'
        : 'Draft/improve POA. JSON only. Put "thinking" first. Integrate all content in correct sections — never dump new clauses at the end unless appropriate.';

    const maxTokens = fastEdit ? 900 : isChat ? 3800 : 3200;

    const openaiBody = {
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemContent },
        { role: 'user', content: prompt },
      ],
      max_tokens: maxTokens,
      temperature: fastEdit ? 0.2 : isChat ? 0.3 : 0.35,
    };

    const parseAndBuild = (raw: string) => {
      let parsed: PoaParsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error('AI returned invalid JSON');
      }
      return buildPoaResult(parsed, isChat, {
        fastEdit,
        userMessage: isChat ? userRemarks : undefined,
      });
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
        const result = parseAndBuild(raw);
        emit('done', result);
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
    if (!raw) {
      throw new Error('AI returned an empty response');
    }

    const result = parseAndBuild(raw);
    return new Response(JSON.stringify(result), {
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
