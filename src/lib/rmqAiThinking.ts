export const THINKING_PREFIX = 'THINKING:';
export const THINKING_PLACEHOLDER = 'AI is thinking...';
export const LOOKUP_PLACEHOLDER = 'Looking up CRM data...';

export function isThinkingContent(content: unknown): boolean {
  const text = String(content || '');
  return (
    text === THINKING_PLACEHOLDER ||
    text === LOOKUP_PLACEHOLDER ||
    text.startsWith(THINKING_PREFIX)
  );
}

export function thinkingContent(label: string): string {
  return `${THINKING_PREFIX}${label}`;
}

export function thinkingLabelFromContent(content: unknown): string {
  const text = String(content || '');
  if (text.startsWith(THINKING_PREFIX)) return text.slice(THINKING_PREFIX.length).trim() || 'Thinking';
  if (text === LOOKUP_PLACEHOLDER) return 'Checking CRM';
  return 'Thinking';
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
  if (/\bmy day\b|what should i do|work queue/.test(t)) {
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
