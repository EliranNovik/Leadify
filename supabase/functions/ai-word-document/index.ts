import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import {
  createThinkingSseResponse,
  streamOpenAiJsonCompletion,
} from '../_shared/aiStreamJson.ts';
import { OPENAI_CHAT_COMPLETIONS_URL, buildChatCompletionBody } from '../_shared/openaiModels.ts';

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');

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

function buildEmailFollowupPrompt(
  contextLines: string[],
  caseContext: string,
  currentDocumentText: string,
  userMessage: string,
  chatHistory: ChatTurn[] | undefined,
): string {
  return `The user is writing an EMAIL in a citizenship/immigration CRM (not a Word document).

A CRM CASE FILE is available as background. Use those facts. The staff member does not need to ask you to use it.

THIS TURN'S ONLY TASK is the latest staff request below. Prior chat and the current draft are context. If they now ask for a meeting invite, reminder, or different email, REPLACE the draft — do not repeat the previous follow-up or the previous changeSummary.

First decide the intent:
- "question" — asking about the case or for advice WITHOUT asking you to rewrite the email now.
- "action" — write, rewrite, or edit the email. Treat "write a follow up", "meeting invite", "draft an email" as action.

Rules:
- Honor the latest staff request even if it differs from the current draft.
- Ground the email in THIS client's case file (name, topic, facts, last messages, meetings, contracts, POA, invoices, eligibility, payments). Analyze those facts first. Do not write a generic template and do not invent facts.
- Follow-up / draft emails must be detailed and professional — 4–7 short paragraphs — never a one-line “just following up”. Include why you are writing, what was last discussed, relevant unsigned docs or payments if on file, and a clear next step.
- CONTRACTS: the case file lists whether each contract is SIGNED or NOT SIGNED, plus signing_link. If the staff asks to send/follow up on the contract, agreement, or signature, paste the exact signing_link https URL on its own line. Never invent a link. Never use example.com or any placeholder URL. If SIGNED, do not ask them to sign again.
- POA: the case file lists whether each power of attorney is SIGNED or NOT SIGNED, plus poa_link. If the staff asks to send a POA, power of attorney, Vollmacht, or digital signing form, paste the exact poa_link https URL on its own line. Never invent a link. If SIGNED, do not ask them to sign again.
- PROFORMAS: the case file lists invoice_link for new (payment_plans) and legacy (proformainvoice) proformas. If the staff asks to send a proforma, invoice, payment request, or reminder, paste the exact invoice_link https URL on its own line. Never invent a link.
- If REQUIRED LINKS lists contract_signing / poa / invoice, those URLs are the only ones allowed. Copy them character-for-character.
- Preserve the client's language when known (Hebrew stays Hebrew, English stays English).
- Do NOT use [[B]] markers, markdown, or HTML.
- End the email at the sign-off only (e.g. "Best regards,"). Do NOT add a name, title, firm, email, phone, or any signature block.
- Body layout is required: greeting on its own line, a blank line, several short paragraphs separated by blank lines, a blank line, then the sign-off on its own line. Never write the whole email as one paragraph.
- Example body:
Dear Anna,

Thank you for taking the time to speak with us about your German citizenship case. I wanted to follow up on the points we covered and make sure the next steps are clear.

During the meeting we discussed the documents still needed on your side and the signing process for the agreement. The case file shows the agreement is not signed yet, so please complete it when you can so we can move forward.

If anything from the meeting is still unclear, or if you would like us to send the next set of forms, reply to this email and we will take care of it.

Best regards,
- changeSummary must describe THIS turn only — never copy a previous summary.
- When intent is "action", put the entire email in improvedDocumentText using this exact format:
Subject: <one-line subject>

<body as plain text ending at Best regards, with no signature after it>

Return JSON with exactly these keys (put "thinking" first):
{
  "thinking": "2-4 short plain lines on your plan",
  "intent": "question" | "action",
  "answer": "required when intent is question",
  "improvedDocumentText": "required when intent is action — full email with Subject: line",
  "changeSummary": "required when intent is action — 3–6 bullet lines (• prefix) for THIS request only"
}

When intent is "question", set improvedDocumentText and changeSummary to empty strings.
When intent is "action", set answer to empty string.

${contextLines.length ? `${contextLines.join('\n')}\n\n` : ''}LATEST STAFF REQUEST:
${userMessage.trim()}

Current email draft:
${currentDocumentText.trim() || '(empty email — draft one for this client)'}

Recent chat (do not copy old summaries):
${formatChatHistory(chatHistory)}

${
    caseContext.trim()
      ? `REQUIRED LINKS AND CASE FILE FROM CRM (copy required https URLs exactly; do not dump the rest into the email; never use example.com):\n${caseContext.trim()}`
      : 'CASE FILE FROM CRM: (not loaded)'
  }
`;
}

function buildMeetingBriefPrompt(
  contextLines: string[],
  caseContext: string,
  currentDocumentText: string,
  userMessage: string,
  chatHistory: ChatTurn[] | undefined,
): string {
  return `The user is writing a MEETING BRIEF / MEETING SUMMARY in a citizenship/immigration CRM (not an email or Word document).

A CRM CASE FILE is available as background. Use those facts. The staff member does not need to ask you to use it.

THIS TURN'S ONLY TASK is the latest staff request below. Prior chat and the current brief are context. If they now ask for a different summary, REPLACE the draft — do not repeat the previous changeSummary.

First decide the intent:
- "question" — asking about the case or for advice WITHOUT asking you to rewrite the brief now.
- "action" — write, rewrite, or edit the meeting brief/summary. Treat "summarize", "write a brief", "improve this", or "AI summary" as action.

Rules:
- Honor the latest staff request even if it differs from the current brief.
- Write a detailed professional meeting note a staff member would keep after the call — 4 to 8 short paragraphs, then a “Next:” line.
- Analyze the case file: who they are, what they want, what was said, eligibility/documents/money that was discussed or is on file, and the next step. Do not write a 2-line recap. Do not inventory every CRM field.
- Do NOT list Client Name, Lead Number, Category, Language, Stage, Status, Recent Interactions, Contracts, POA, Financials, or Next Steps as labeled sections.
- Do NOT paste URLs, contract links, or POA links unless the staff explicitly asked for them.
- Keep staff-written notes that are already in the current brief unless they ask you to replace them. You may tighten wording and add missing context from the case file.
- Write the meeting brief and any chat answer in the Language listed below. Hebrew means Hebrew only. English means English only. Do not mix languages.
- Plain text only. No markdown, no **bold**, no headings, no HTML, no [[B]] markers, no bullet symbols.
- Do not write an email. No Subject: line, no Best regards, no signature.
- changeSummary must be ONE short sentence for THIS turn only — never paste the brief into changeSummary.
- When intent is "action", put the entire meeting brief in improvedDocumentText as plain text.

Good example:
"Markus is not ready to move forward on Portugal Family. He said he will call later. No new family facts were added beyond what we already have on file.

He understands the process at a high level but is still comparing options and did not commit to a timeline. The meeting stayed on interest and next contact, not document collection.

The contract is still unsigned. A few POAs are already signed. Proposal is ₪10,000 with unpaid invoices still open, which we mentioned only as context.

Next: wait for him to confirm interest, then follow up on the contract and balance."

Return JSON with exactly these keys (put "thinking" first):
{
  "thinking": "2-4 short plain lines on your plan",
  "intent": "question" | "action",
  "answer": "required when intent is question",
  "improvedDocumentText": "required when intent is action — full meeting brief as plain text",
  "changeSummary": "required when intent is action — 3–6 bullet lines (• prefix) for THIS request only"
}

When intent is "question", set improvedDocumentText and changeSummary to empty strings.
When intent is "action", set answer to empty string.

${contextLines.length ? `${contextLines.join('\n')}\n\n` : ''}LATEST STAFF REQUEST:
${userMessage.trim()}

Current meeting brief:
${currentDocumentText.trim() || '(empty brief — write a meeting summary from the case file)'}

Recent chat (do not copy old summaries):
${formatChatHistory(chatHistory)}

${
    caseContext.trim()
      ? `CASE FILE FROM CRM (use these facts; do not dump the raw file into the brief):\n${caseContext.trim()}`
      : 'CASE FILE FROM CRM: (not loaded)'
  }
`;
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
      caseContext,
      purpose,
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
    const caseText = typeof caseContext === 'string' ? caseContext : '';
    const isEmailFollowup = purpose === 'email_followup';
    const isMeetingBrief = purpose === 'meeting_brief';
    const isEmptyDraft = !currentText.trim();

    const prompt = isMeetingBrief
      ? buildMeetingBriefPrompt(
          contextLines,
          caseText,
          currentText,
          remarks,
          Array.isArray(chatHistory) ? chatHistory : undefined,
        )
      : isEmailFollowup
        ? buildEmailFollowupPrompt(
            contextLines,
            caseText,
            currentText,
            remarks,
            Array.isArray(chatHistory) ? chatHistory : undefined,
          )
        : isEmptyDraft
          ? buildCreatePrompt(contextLines, remarks)
          : buildChatPrompt(
              contextLines,
              currentText,
              remarks,
              Array.isArray(chatHistory) ? chatHistory : undefined,
            );

    const openaiBody = buildChatCompletionBody({
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: isMeetingBrief
            ? 'You help staff write meeting briefs in a citizenship/immigration law CRM. Honor the LATEST staff request. Write a detailed professional meeting summary (4–8 short paragraphs) from the case file and staff notes — not a 2-line recap. Use the requested Language only (Hebrew or English). No markdown, labels, URLs, or section headings. Never invent case facts. changeSummary is one short sentence in that same language. Put "thinking" first in JSON. For questions, answer only. Respond with valid JSON only.'
            : isEmailFollowup
              ? 'You help staff write emails in a citizenship/immigration law CRM. Honor the LATEST staff request; do not repeat a previous email or changeSummary. Analyze the CRM case file and write a detailed professional email (4–7 short paragraphs), never a short check-in. Never invent case facts. Put "thinking" first in JSON. For questions, answer only. For actions, return improvedDocumentText as Subject: ... then a blank line then the plain-text body ending at Best regards, — never include a signature. No HTML or [[B]] markers. Respond with valid JSON only.'
              : 'You help staff write Word documents in a citizenship/immigration law CRM. Put "thinking" first in JSON. For questions, answer only. For actions, return improvedDocumentText with [[B]]/[[I]]/[[U]] markers preserved. Respond with valid JSON only.',
        },
        { role: 'user', content: prompt },
      ],
      maxTokens: isEmailFollowup || isMeetingBrief ? 3500 : 4500,
      temperature: 0.35,
    });

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

    const openaiRes = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
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
