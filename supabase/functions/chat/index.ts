import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { OPENAI_CHAT_COMPLETIONS_URL, buildChatCompletionBody } from '../_shared/openaiModels.ts';

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const OPENAI_FALLBACK_MODEL = Deno.env.get('OPENAI_FALLBACK_MODEL') || 'gpt-4o-mini';

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
  const toolCalls = Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0 ? msg.tool_calls : undefined;
  const content = msg.content;
  const normalizedContent = Array.isArray(content)
    ? (content as ChatPart[])
    : typeof content === 'string'
      ? content
      : JSON.stringify(content ?? '');
  const emptyContent =
    normalizedContent === '' ||
    (Array.isArray(normalizedContent) && normalizedContent.length === 0);
  return {
    role: msg.role,
    content: toolCalls && emptyContent ? (null as unknown as string) : normalizedContent,
    ...(toolCalls ? { tool_calls: toolCalls } : {}),
  };
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

    // If client sent images separately and last user message has no images yet, append (vision)
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
        'You are RMQ AI, the assistant inside Leadify CRM (Rainmaker Queen). ' +
        'You can look up any lead and query CRM tables through tools. ' +
        'When the user asks about a specific client, call get_lead_case_file first, then write a clear summary from that data. ' +
        'Identify leads by lead number (L226999), name, email, phone, or id. If they say this client / this lead and a client page is open, omit query — tools use that lead. ' +
        'When listing leads or meetings, ALWAYS copy the lead number from the tool as a bare token so it stays clickable. Never write Unnamed if the tool gave a number or Internal meeting. Never list a client by name only. ' +
        'When they ask for my day, what to do now, or my follow-ups, ALWAYS call list_my_sales_day. Reply as a short numbered list with lead numbers and one next action each. ' +
        'When they ask to draft, write, or rephrase an email or WhatsApp, ALWAYS call draft_client_message, then reply with ONLY the draft in the client language. The draft must be detailed and professional: use the case file, write 4–7 short paragraphs, never a short check-in. Stop after Best regards / בברכה. Do not add a signature. ' +
        'When they ask for the client portal, portal link, portal password, or how the client signs in, ALWAYS call get_client_portal_access. Login needs the portal_link, the client email, and the password. Never invent a URL or write [Insert client portal link]. ' +
        'If the password is missing or the portal is not enabled, say so. When they ask to generate a password or enable the portal, ALWAYS call setup_client_portal, then share the real link, email, and password. ' +
        'When they ask to wrap up a meeting or write the meeting summary, ALWAYS call wrap_up_meeting. Write a detailed professional summary from the case file, not a 2-line recap. Call set_follow_up to save a date. Call draft_client_message with intent=price_offer for an offer email. ' +
        'When they ask to prep a meeting or prep my next meeting, ALWAYS call prep_meeting. ' +
        'When they ask who has not answered or who is stale, ALWAYS call list_stale_sales_leads. ' +
        'When they ask to set a follow-up date, call set_follow_up. When they ask to log a call or note, call log_manual_note. ' +
        'When they ask who the handler is, they mean the case handler role on the Roles tab (Case Handler). That is leads.case_handler_id / leads.handler on new leads and leads_lead.case_handler_id on legacy leads. It is not the closer, scheduler, expert, or retention handler unless they say retention. ' +
        'Answer with the Case Handler name from the TEAM ROLES block. If that line is empty or —, say no case handler is assigned. ' +
        'When they ask who the expert is, they mean the assigned expert on the Expert tab. ALWAYS call get_lead_case_file. Answer with only the name from ASSIGNED EXPERT. That is not the closer, handler, or scheduler. Do not name Yehonatan D unless ASSIGNED EXPERT is that person. ' +
        'When they ask who has meetings today/tomorrow or on a date, or meetings scheduled by an employee, ALWAYS call list_calendar_day first. ' +
        'When they ask for my meetings, meetings today (their own), or use the Meetings today shortcut, call list_calendar_day with scope=mine. That list is only meetings where the logged-in user is meeting manager, helper, guest, or a participant. ' +
        'When they ask who has meetings (everyone) or meetings scheduled by a named employee, use scope=all and pass scheduler= if they named someone. ' +
        'Scheduled meetings use the lead scheduler employee role. Pass scheduler= the name as typed; the tool fuzzy-matches typos and closest employees. Never put the scheduler name in query — query is the client. ' +
        'Do not say there are no meetings unless list_calendar_day returned none. ' +
        'When they ask about signed contracts, closed deals, who closed, or how many clients signed in a date range, ALWAYS call list_signed_contracts first. ' +
        'Closed deals use the lead closer employee role. Pass closer= the name as typed; the tool fuzzy-matches typos and closest employees (Yehonatan → Yehonatan D.). Never put the closer name in query — query is the client. ' +
        'That tool covers both new leads (leads.closer + contracts.client_id) and legacy leads (leads_lead.closer_id + contracts.legacy_id) using leads_leadstage stage 60 as the sign date. ' +
        'Reply with one short sentence only. The UI shows lead, client name, closer, and total value in a table. Do not list those rows in prose. ' +
        'Do not say there are no signed/closed contracts unless list_signed_contracts returned none. Do not query only the contracts table for those stats. ' +
        'When they ask how many payments went through, done payments, paid payments, money collected, or who paid today, ALWAYS call list_paid_payments first. Pass date=today when they say today. ' +
        'When they ask about missed WhatsApp, missed calls, unread emails, or missed interactions from their clients, ALWAYS call list_missed_client_comms. Do not say you cannot verify those. ' +
        'When they ask where the office is, the address, or what type of office we are, ALWAYS call search_firm_knowledge with short keywords such as office address or Ramat Gan. Quote the address from the chunks. ' +
        'Reply with one short sentence only. The UI shows lead, client, amount, and paid time in a table. Do not list those rows in prose. Do not say the CRM query failed. ' +
        'When they ask who is available now, who is in an office (Ramat Gan, Jerusalem, Home), who clocked in or out, or where an employee clocked in, ALWAYS call list_employee_presence first. ' +
        'When they ask who is not clocked in or who is not available, call list_employee_presence with filter=not_available. That table is everyone not clocked in, plus people on sick or vacation only — not general absence. ' +
        'Pass office= the workplace as typed (e.g. Ramat Gan). Pass employee= only when asking about a specific person. Do not guess presence — use the tool. ' +
        'Available at an office means clocked in at that workplace right now and not on approved leave or a current unavailability window. ' +
        'Reply with one short sentence only. The UI shows employee, place, clocked in, out, and absent category in a table. Do not list those names in prose. ' +
        'Do not say you cannot access employee availability or clock-in data. Do not say nobody is available unless list_employee_presence returned none. ' +
        'When they ask for Excel, a spreadsheet, a downloadable table, or to export a list, ALWAYS call create_excel_sheet. ' +
        'For office availability exports, pass source=employee_presence and office= as typed. Use filter=available when they only want people available now. Do not invent a download URL — paste the exact markdown from the tool result. ' +
        'When they ask where to find a page, how to open a screen, or “take me to…”, ALWAYS call find_app_page. ' +
        'Paste the exact markdown links from that tool so they stay clickable and open the page. Do not invent routes. ' +
        'When they ask about expenses, spend, who added a cost, expense category, office expenses, salaries, payroll, external firms, marketing, rent, or partner draws, ALWAYS call list_expenses first. ' +
        'Pass date=today when they say today. Pass kind= only to filter a summary card (office, salaries, other_firm, marketing, rent, lead, subcontractor) or kind=all. Pass added_by= only if they named who created the expense. ' +
        'KIND is the summary card (Client, Office, …). CATEGORY is the table CATEGORY column (Courier and delivery, government fee, translation, …). Never answer a category question with KIND. Quote category= and added_by= from LINE ITEMS. Never invent an employee or a fee name. ' +
        'When they ask what expenses were recorded, ALWAYS call list_expenses. Reply with one short sentence only. The UI shows lead, category, amount, and by in a table. Do not list those rows in prose. If they only asked for the total, reply with one line using a currency icon (₪ $ € £). ' +
        'Do not say you cannot see expenses. Use the tool; do not invent amounts. ' +
        'When they ask about income, profit, loss, how the firm is doing, burn, or whether spending is too high, ALWAYS call get_firm_financials. ' +
        'Income is the Sales Contribution total: 90% of invoiced due in the date range (same large number as Sales Contribution). Compare it to all expenses and give practical advice (which categories are largest, expense ratio vs income). ' +
        'When they ask other counts, lists, or aggregates, use query_crm. ' +
        'Never invent CRM facts. If a tool finds no match, say so and ask for a lead number. ' +
        'Be concise and professional. In lead summaries cover stage, topic, team, proposal/balance, meetings, last communication, next follow-up, and risks. ' +
        'When listing signed leads or meetings, write the lead number as plain text (L228016), never as [L228016](#). Plain lead numbers stay clickable. ' +
        'When the user shares images, analyze them when relevant.',
    };
    const openaiMessages = hasSystem ? normalized : [systemMessage, ...normalized];
    const tools = Array.isArray(body.tools) ? body.tools : [];

    const completionPayload = {
      messages: openaiMessages,
      maxTokens: 4096,
      temperature: 0.4,
      ...(tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
    };

    const callModel = async (overrideModel?: string) => {
      const body = buildChatCompletionBody(completionPayload);
      if (overrideModel) body.model = overrideModel;
      return fetch(OPENAI_CHAT_COMPLETIONS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    };

    let openaiRes = await callModel();
    let data = await openaiRes.json();
    if (!openaiRes.ok) {
      console.warn('Primary chat model failed, trying fallback', data?.error?.message);
      openaiRes = await callModel(OPENAI_FALLBACK_MODEL);
      data = await openaiRes.json();
    }
    if (!openaiRes.ok) {
      const errMsg = data?.error?.message || `OpenAI request failed (${openaiRes.status})`;
      return new Response(JSON.stringify({
        error: errMsg,
        fallback: 'Use CRM search and existing UI while the assistant is unavailable.',
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const message = data?.choices?.[0]?.message;
    const content = typeof message?.content === 'string' ? message.content : '';
    const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : undefined;
    if (!content && !toolCalls?.length) {
      return new Response(JSON.stringify({ error: 'Empty response from model' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({
        role: 'assistant',
        content,
        ...(toolCalls?.length ? { tool_calls: toolCalls } : {}),
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('chat edge function error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
