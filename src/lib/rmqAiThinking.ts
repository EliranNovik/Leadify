export const THINKING_PREFIX = 'THINKING:';
export const THINKING_PLACEHOLDER = 'AI is thinking...';
export const LOOKUP_PLACEHOLDER = 'Looking up CRM data...';
/**
 * Splits the label from its optional detail line inside a thinking message.
 *
 * The thinking state lives in the message's own `content` string, so a second field has to be
 * encoded into it. U+001F (unit separator) is used because it cannot occur in a label or in a
 * domain, which means `isThinkingContent` and the prefix checks keep working untouched.
 */
const THINKING_DETAIL_SEPARATOR = '\u001F';

export function isThinkingContent(content: unknown): boolean {
  const text = String(content || '');
  return (
    text === THINKING_PLACEHOLDER ||
    text === LOOKUP_PLACEHOLDER ||
    text.startsWith(THINKING_PREFIX)
  );
}

export function thinkingContent(label: string, detail?: string): string {
  const trimmed = String(detail || '').trim();
  return trimmed
    ? `${THINKING_PREFIX}${label}${THINKING_DETAIL_SEPARATOR}${trimmed}`
    : `${THINKING_PREFIX}${label}`;
}

export function thinkingLabelFromContent(content: unknown): string {
  const text = String(content || '');
  if (text.startsWith(THINKING_PREFIX)) {
    const body = text.slice(THINKING_PREFIX.length).split(THINKING_DETAIL_SEPARATOR)[0];
    return body.trim() || 'Thinking';
  }
  if (text === LOOKUP_PLACEHOLDER) return 'Checking CRM';
  return 'Thinking';
}

/** The sites or query shown under the label while a step runs. Empty for steps that have none. */
export function thinkingDetailFromContent(content: unknown): string {
  const text = String(content || '');
  if (!text.startsWith(THINKING_PREFIX)) return '';
  return (text.split(THINKING_DETAIL_SEPARATOR)[1] || '').trim();
}

function parseToolArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(raw || '{}'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function thinkingPlanForAsk(text: string): string[] {
  const t = String(text || '').toLowerCase();

  if (/follow[-\s]?up/.test(t) && /draft|write|email|whatsapp|message|rephrase/.test(t)) {
    return ['Checking CRM', 'Checking last interaction', 'Drafting the follow-up'];
  }
  if (/follow[-\s]?up/.test(t) || /set a follow/.test(t)) {
    return ['Checking CRM', 'Checking last interaction', 'Creating the follow-up'];
  }
  if (
    /\blead summary\b/.test(t) ||
    /\bgeneral summary\b/.test(t) ||
    /\bcase summary\b/.test(t) ||
    /create a summary/.test(t) ||
    (/\boverview\b/.test(t) && /\b(lead|client|case)\b/.test(t)) ||
    /summar(?:y|ise|ize).{0,40}\b(lead|client|case)\b/.test(t) ||
    /\bwhat (?:is|'s|was) (?:this|the) (?:lead|case) about\b/.test(t) ||
    /\bwhat (?:is|'s) this about\b/.test(t)
  ) {
    return ['Opening the case file', 'Reviewing meetings', 'Writing the summary'];
  }
  if (
    (/\b(this|the|open|current)\s+(lead|client|case|one|file)\b/.test(t) ||
      /\bin this lead\b/.test(t)) &&
    /\b(next|done next|should be done|next step|what now)\b/.test(t)
  ) {
    return ['Opening the case file', 'Checking stage and follow-up', 'Deciding the next step'];
  }
  if (/\bmy day\b|work queue/.test(t) || (/\bwhat should i do\b/.test(t) && !/\b(this|the)\s+(lead|client|case)\b/.test(t))) {
    return ["Checking today's meetings", 'Checking follow-ups', 'Building your day'];
  }
  if (/\bprep\b/.test(t) && /meeting/.test(t)) {
    return ['Checking the case', 'Checking last interaction', 'Preparing the briefing'];
  }
  if (/wrap up|after the meeting|meeting summary/.test(t)) {
    return ['Reading the meeting', 'Checking the case file', 'Writing the summary'];
  }
  if (/no-?show/.test(t)) {
    return ['Checking the meeting', 'Checking last interaction', 'Drafting the no-show note'];
  }
  if (/price offer|offer email|signature|unsigned/.test(t) && /draft|write|email|chase/.test(t)) {
    return ['Checking the case file', 'Checking last interaction', 'Drafting the email'];
  }
  if (/signed|closed deal|who closed|contracts closed/.test(t)) {
    return ['Checking closed deals', 'Adding up values'];
  }
  if (/office|address|adress|where are we|ramat gan/.test(t)) {
    return ['Checking firm knowledge'];
  }
  if (/missed|unread/.test(t) && /whatsapp|email|call|interaction/.test(t)) {
    return ['Checking WhatsApp', 'Checking emails', 'Checking missed calls'];
  }
  if (/payment|paid today|went through|collected/.test(t)) {
    return ['Checking payments'];
  }
  if (/expense/.test(t)) {
    return ['Checking expenses'];
  }
  if (/calendar|meetings today|who has meetings|my meetings/.test(t)) {
    return ['Opening the calendar', 'Loading meetings'];
  }
  if (/not\s+clocked|not\s+available|unavailable/.test(t)) {
    return ['Checking who is out'];
  }
  if (/available|clocked|in the office|who is in/.test(t)) {
    return ['Checking who is in'];
  }
  if (/create (a )?lead|new lead/.test(t)) {
    return ['Creating the lead'];
  }
  if (/schedul|create (a )?meeting|book a meeting/.test(t)) {
    return ['Checking the calendar', 'Scheduling the meeting'];
  }
  if (/past chat|what we said|earlier/.test(t)) {
    return ['Searching past chats'];
  }
  if (/where is|how do i open|take me to/.test(t)) {
    return ['Looking up the page'];
  }
  if (/profit|p&l|income|how are we doing|burn/.test(t)) {
    return ['Checking firm finances'];
  }
  if (/stale|hasn.?t answered|chase list/.test(t)) {
    return ['Finding quiet leads'];
  }
  if (/log (this )?(call|note)|save this note/.test(t)) {
    return ['Saving the note'];
  }
  if (/excel|spreadsheet|export/.test(t)) {
    return ['Gathering the rows', 'Building the spreadsheet'];
  }
  if (/portal|access code|פורטל/.test(t)) {
    return ['Checking portal access'];
  }
  if (
    /archive|staatsarchiv|meldekarte|melderegister|apostille|§\s*15|stag\b|bva\b|ma35|citizenship law|exchange rate|eur (to|rate)|current (law|requirement)/i.test(
      t,
    )
  ) {
    return ['Checking the case file', 'Searching the web'];
  }

  return ['Reading your request', 'Checking CRM', 'Thinking'];
}

export function labelForTool(name: string, argsRaw?: unknown): string {
  const args = parseToolArgs(argsRaw);
  const intent = String(args.intent || '').toLowerCase();

  switch (name) {
    case 'get_lead_case_file':
      return 'Checking the case file';
    case 'list_calendar_day':
    case 'list_meetings':
      return 'Loading the calendar';
    case 'list_client_meetings':
      return 'Checking meetings';
    case 'list_signed_contracts':
      return 'Checking signed deals';
    case 'list_paid_payments':
      return 'Checking payments';
    case 'list_missed_client_comms':
      return 'Checking missed messages';
    case 'list_employee_presence':
      return 'Checking who is in';
    case 'create_excel_sheet':
      return 'Building the spreadsheet';
    case 'find_app_page':
      return 'Finding the page';
    case 'query_crm':
      return 'Querying the CRM';
    case 'list_expenses':
      return 'Checking expenses';
    case 'get_firm_financials':
      return 'Checking firm finances';
    case 'list_my_sales_day':
      return 'Building your day';
    case 'draft_client_message':
      if (intent === 'follow_up') return 'Drafting the follow-up';
      if (intent === 'no_show') return 'Drafting the no-show note';
      if (intent === 'price_offer') return 'Drafting the offer';
      if (intent === 'signature_chase') return 'Drafting the signature chase';
      if (intent === 'portal_access') return 'Drafting portal access';
      if (intent === 'after_meeting') return 'Drafting the after-meeting note';
      if (intent === 'confirm_meeting') return 'Drafting the confirmation';
      if (intent === 'first_contact') return 'Drafting first contact';
      return 'Drafting the message';
    case 'prep_meeting':
      return 'Preparing the briefing';
    case 'wrap_up_meeting':
      return 'Writing the meeting wrap-up';
    case 'set_follow_up':
      return 'Saving the follow-up';
    case 'log_manual_note':
      return 'Saving the note';
    case 'get_client_portal_access':
      return 'Checking portal access';
    case 'setup_client_portal':
      return 'Setting up the client portal';
    case 'list_stale_sales_leads':
      return 'Finding quiet leads';
    case 'create_lead':
      return 'Creating the lead';
    case 'create_meeting':
      return 'Scheduling the meeting';
    case 'search_my_past_chats':
      return 'Searching past chats';
    case 'get_past_chat':
      return 'Opening a past chat';
    case 'search_firm_knowledge':
      return 'Checking firm knowledge';
    case 'web_search':
      return 'Searching the web';
    default:
      return 'Checking CRM';
  }
}

/** How many sites to name before collapsing the rest into a "+N more". */
const DETAIL_DOMAIN_LIMIT = 3;
/** Joins sites in a detail line. The indicator splits on this to give each site its own icon. */
export const THINKING_SITE_SEPARATOR = ' · ';

function hostFromUrl(raw: string): string {
  const cleaned = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .split('?')[0]
    .replace(/:\d+$/, '');
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(cleaned) ? cleaned : '';
}

/**
 * Formats sites for a detail line, newest first so a live search shows what it just reached rather
 * than what it started with.
 */
function joinDomains(domains: string[]): string {
  const unique = [...new Set(domains.filter(Boolean))];
  if (unique.length === 0) return '';
  const shown = unique.slice(0, DETAIL_DOMAIN_LIMIT).join(THINKING_SITE_SEPARATOR);
  const hidden = unique.length - DETAIL_DOMAIN_LIMIT;
  return hidden > 0 ? `${shown}${THINKING_SITE_SEPARATOR}+${hidden} more` : shown;
}

/** The sites in a detail line, in display order. Empty for details that are not a site list. */
export function sitesFromThinkingDetail(detail: string): string[] {
  return String(detail || '')
    .split(THINKING_SITE_SEPARATOR)
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * The step shown while a web search streams pages back.
 *
 * `domains` arrives newest-first from the caller, which accumulates it across progress events. The
 * label counts distinct sites so it always agrees with the list rendered beneath it.
 */
export function liveWebSearchThinking(
  domains: string[],
  phase: 'searching' | 'reading',
): { label: string; detail: string } {
  const unique = [...new Set(domains.filter(Boolean))];
  if (unique.length === 0) return { label: 'Searching the web', detail: '' };
  if (phase === 'searching') return { label: 'Searching the web', detail: joinDomains(unique) };
  return {
    label: unique.length === 1 ? 'Reading 1 site' : `Reading ${unique.length} sites`,
    detail: joinDomains(unique),
  };
}

/**
 * The line shown under a step's label the moment it starts, before any live progress arrives.
 *
 * Only web search has one: it is the slowest tool by far, and the only one where the user cannot
 * otherwise tell whether anything is happening. The sites come from the model's own
 * `requested_domains` when it narrowed the search; otherwise this is empty and the streamed pages
 * fill it in a moment later. The query is deliberately not used as a stand-in — the point of the
 * line is to name pages, and a restated question reads like the search is stuck.
 */
export function detailForTool(name: string, argsRaw?: unknown): string {
  if (name !== 'web_search') return '';
  const args = parseToolArgs(argsRaw);
  const requested = Array.isArray(args.requested_domains)
    ? args.requested_domains
    : Array.isArray(args.allowed_domains)
      ? args.allowed_domains
      : [];
  return joinDomains(requested.map((item) => hostFromUrl(String(item || ''))));
}

/**
 * The step to show once a tool has returned but the model is still composing its answer.
 *
 * For web search this is where the real pages finally become known, so the indicator switches from
 * the sites it was aiming at to the ones it actually found. Returns null for tools that have
 * nothing worth reporting, leaving the existing label in place.
 */
export function resultThinkingForTool(
  name: string,
  result: unknown,
): { label: string; detail: string } | null {
  if (name !== 'web_search') return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(String(result || '{}')) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || parsed.error) return null;
  const sources = Array.isArray(parsed.sources) ? parsed.sources : [];
  const domains = sources
    .map((row) => {
      if (!row || typeof row !== 'object') return '';
      const src = row as Record<string, unknown>;
      return hostFromUrl(String(src.domain || '')) || hostFromUrl(String(src.url || ''));
    })
    .filter(Boolean);
  if (domains.length === 0) return null;
  // Counts distinct sites, not returned rows, so the number always matches the list underneath it.
  const unique = new Set(domains).size;
  return {
    label: unique === 1 ? 'Reading 1 site' : `Reading ${unique} sites`,
    detail: joinDomains(domains),
  };
}
