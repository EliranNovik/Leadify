import { supabase } from './supabase';
import type { Lead } from './supabase';
import { getStageName } from './stageUtils';
import { getFrontendBaseUrl } from './api';
import { buildPoaUrl } from './poaApi';

export type LeadFollowupVerdict = 'high' | 'medium' | 'low' | 'not_worth';

export type LeadFollowupStats = {
  lastContactChannel?: string | null;
  lastContactAt?: string | null;
  inboundCount?: number;
  outboundCount?: number;
  daysSinceContact?: number | null;
  stage?: string | number | null;
  proposal?: string | number | null;
  proposalCurrency?: string | number | null;
  balance?: string | number | null;
  balanceCurrency?: string | number | null;
  potentialValue?: string | number | null;
  expertExam?: string | number | null;
  unpaidPlanRows?: number;
  paidPlanRows?: number;
  nextDue?: string | null;
  meetingCount?: number;
  lastMeetingDate?: string | null;
  lastMeetingTime?: string | null;
  lastMeetingStatus?: string | null;
  nextMeetingDate?: string | null;
  nextMeetingTime?: string | null;
  nextMeetingStatus?: string | null;
  lastMessagePreview?: string | null;
  highlights?: string[];
};

export type LeadFollowupResult = {
  success: boolean;
  cached?: boolean;
  generatedAt?: string | null;
  leadName?: string | number | null;
  leadNumber?: string | number | null;
  isLegacy?: boolean;
  verdict: LeadFollowupVerdict;
  score: number;
  headline: string;
  summary: string;
  caseHighlights: string[];
  why: string[];
  nextAction: string;
  risks: string[];
  stats: LeadFollowupStats;
  error?: string;
};

function withStageNames(text: string): string {
  if (!text) return text;
  return text.replace(/\bstage(?:\s+id)?\s*:?\s*(\d{1,3})\b/gi, (_match, id: string) => getStageName(id));
}

export function resolveLeadFollowupId(lead: Lead): { leadId: string; isLegacy: boolean } | null {
  const anyLead = lead as Record<string, unknown>;
  const isLegacy =
    anyLead.lead_type === 'legacy' || String(anyLead.id ?? '').startsWith('legacy_');
  if (isLegacy) {
    const raw = String(anyLead.id ?? '').replace(/^legacy_/i, '');
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n)) return null;
    return { leadId: `legacy_${n}`, isLegacy: true };
  }
  const id = String(anyLead.id ?? '').trim();
  if (!id) return null;
  return { leadId: id, isLegacy: false };
}

export async function fetchLeadFollowupVerdict(lead: Lead): Promise<LeadFollowupResult> {
  const ref = resolveLeadFollowupId(lead);
  if (!ref) {
    return {
      success: false,
      verdict: 'medium',
      score: 0,
      headline: '',
      summary: '',
      caseHighlights: [],
      why: [],
      nextAction: '',
      risks: [],
      stats: {},
      error: 'Could not identify this lead',
    };
  }

  const { data, error } = await supabase.functions.invoke('ai-lead-followup', {
    body: { leadId: ref.leadId, isLegacy: ref.isLegacy },
  });

  if (error) {
    let message = error.message || 'AI follow-up failed';
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try {
        const body = await ctx.json();
        if (body?.error) message = String(body.error);
      } catch {
        /* keep generic message */
      }
    }
    return {
      success: false,
      verdict: 'medium',
      score: 0,
      headline: '',
      summary: '',
      caseHighlights: [],
      why: [],
      nextAction: '',
      risks: [],
      stats: {},
      error: message,
    };
  }

  if (data?.error) {
    return {
      success: false,
      verdict: 'medium',
      score: 0,
      headline: '',
      summary: '',
      caseHighlights: [],
      why: [],
      nextAction: '',
      risks: [],
      stats: {},
      error: String(data.error),
    };
  }

  const verdictRaw = String(data?.verdict || 'medium').toLowerCase();
  const verdict: LeadFollowupVerdict = ['high', 'medium', 'low', 'not_worth'].includes(verdictRaw)
    ? (verdictRaw as LeadFollowupVerdict)
    : 'medium';

  return {
    success: true,
    cached: data?.cached === true,
    generatedAt: data?.generatedAt ? String(data.generatedAt) : null,
    leadName: data?.leadName,
    leadNumber: data?.leadNumber,
    isLegacy: data?.isLegacy,
    verdict,
    score: Number(data?.score) || 0,
    headline: withStageNames(String(data?.headline || '')),
    summary: withStageNames(String(data?.summary || '')),
    caseHighlights: (() => {
      const fromTop = Array.isArray(data?.caseHighlights) ? data.caseHighlights : null;
      const fromStats =
        data?.stats && typeof data.stats === 'object' && Array.isArray((data.stats as { highlights?: unknown }).highlights)
          ? (data.stats as { highlights: unknown[] }).highlights
          : null;
      const raw = fromTop || fromStats || [];
      return raw.map((item: unknown) => withStageNames(String(item))).filter(Boolean);
    })(),
    why: Array.isArray(data?.why) ? data.why.map((item: unknown) => withStageNames(String(item))) : [],
    nextAction: withStageNames(String(data?.nextAction || '')),
    risks: Array.isArray(data?.risks) ? data.risks.map((item: unknown) => withStageNames(String(item))) : [],
    stats: data?.stats && typeof data.stats === 'object' ? data.stats : {},
  };
}

const BEST_FOLLOWUP_CAP = 40;
const CACHE_SCORE_CHUNK = 250;

export type LeadFollowupCachedScore = {
  score: number;
  verdict: LeadFollowupVerdict | null;
};

export function followupCacheIdForLead(lead: Lead): string | null {
  return resolveLeadFollowupId(lead)?.leadId ?? null;
}

export async function fetchLeadFollowupCacheScores(
  leads: Lead[],
): Promise<Map<string, LeadFollowupCachedScore>> {
  const map = new Map<string, LeadFollowupCachedScore>();
  const ids = Array.from(
    new Set(leads.map(followupCacheIdForLead).filter((id): id is string => Boolean(id))),
  );
  if (ids.length === 0) return map;

  for (let i = 0; i < ids.length; i += CACHE_SCORE_CHUNK) {
    const chunk = ids.slice(i, i + CACHE_SCORE_CHUNK);
    const { data, error } = await supabase
      .from('lead_followup_ai_cache')
      .select('lead_id, score, verdict')
      .in('lead_id', chunk);
    if (error) {
      console.warn('[leadFollowup] cache scores', error.message);
      break;
    }
    for (const row of data || []) {
      const id = String((row as { lead_id?: string }).lead_id || '');
      if (!id) continue;
      const verdictRaw = String((row as { verdict?: string }).verdict || '').toLowerCase();
      const verdict: LeadFollowupVerdict | null = ['high', 'medium', 'low', 'not_worth'].includes(
        verdictRaw,
      )
        ? (verdictRaw as LeadFollowupVerdict)
        : null;
      map.set(id, {
        score: Number((row as { score?: number }).score) || 0,
        verdict,
      });
    }
  }

  return map;
}

/** Saved AI score when present; otherwise the cheap search-result ranking. */
export function followupRankScore(
  lead: Lead,
  cache: Map<string, LeadFollowupCachedScore>,
): number {
  const id = followupCacheIdForLead(lead);
  if (id) {
    const cached = cache.get(id);
    if (cached) return cached.score;
  }
  return heuristicFollowupScore(lead);
}

/** Cached AI reviews stay above unscored leads, then highest score first. */
export function followupSortKey(
  lead: Lead,
  cache: Map<string, LeadFollowupCachedScore>,
): number {
  const id = followupCacheIdForLead(lead);
  if (id && cache.has(id)) {
    return 1000 + (cache.get(id)?.score ?? 0);
  }
  return heuristicFollowupScore(lead);
}

function numberish(value: unknown): number {
  const n = Number(String(value ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** Cheap ranking from fields already on the search result — not the AI verdict. */
export function heuristicFollowupScore(lead: Lead): number {
  const row = lead as Record<string, unknown>;
  let score = 40;

  const exam = String(row.expert_examination || '').toLowerCase();
  if (exam.includes('not feasible')) score -= 35;
  else if (exam.includes('feasible')) score += 14;

  const proposal = numberish(row.proposal_total);
  if (proposal > 0) score += Math.min(22, Math.round(Math.log10(proposal + 1) * 8));

  const stage = String(row.stage ?? '');
  if (['40', '45', '50', '60', '70', 'offer_sent', 'communication_started'].some((s) => stage.includes(s))) {
    score += 10;
  }

  const isLegacyInactive =
    row.lead_type === 'legacy' && (Number(row.status) === 10 || row.status === '10');
  const isNewInactive = row.lead_type === 'new' && row.unactivated_at != null;
  if (isLegacyInactive || isNewInactive) score -= 45;

  const followUp = String(row.follow_up_date || row.next_followup || '');
  const followMs = Date.parse(followUp);
  if (Number.isFinite(followMs) && followMs < Date.now()) score += 8;

  const createdMs = Date.parse(String(row.created_at || ''));
  if (Number.isFinite(createdMs)) {
    const days = (Date.now() - createdMs) / 86400000;
    if (days > 21) score += 6;
  }

  if (String(row.facts || row.special_notes || '').trim().length > 40) score += 4;

  return score;
}

export function pickBestFollowupLead(leads: Lead[]): Lead | null {
  const slice = leads.slice(0, BEST_FOLLOWUP_CAP);
  if (!slice.length) return null;
  return slice.reduce((best, lead) =>
    heuristicFollowupScore(lead) > heuristicFollowupScore(best) ? lead : best,
  );
}

export type FollowupDocumentLinks = {
  contractSigningUrl: string | null;
  poaUrl: string | null;
  invoiceUrl: string | null;
};

function firstHttpsAfterLabel(caseFile: string, label: string, preferUnsigned: boolean): string | null {
  const lines = caseFile.split('\n').filter((line) => line.includes(`${label}=`));
  const parsed = lines
    .map((line) => {
      const signed = /^\s*-\s*(SIGNED|PAID)\b/i.test(line);
      const match = line.match(new RegExp(`${label}=(https://[^\\s|]+)`, 'i'));
      const url = (match?.[1] || '').replace(/[.,;]+$/, '');
      return { signed, url };
    })
    .filter((row) => row.url && !/\bexample\.(com|org|net)\b/i.test(row.url));
  if (preferUnsigned) {
    const unsigned = parsed.find((row) => !row.signed);
    if (unsigned) return unsigned.url;
  }
  return parsed[0]?.url || null;
}

export function parseFollowupDocumentLinks(caseFile: string): FollowupDocumentLinks {
  return {
    contractSigningUrl: firstHttpsAfterLabel(caseFile, 'signing_link', true),
    poaUrl: firstHttpsAfterLabel(caseFile, 'poa_link', true),
    invoiceUrl: firstHttpsAfterLabel(caseFile, 'invoice_link', true),
  };
}

export function formatRequiredDocumentLinksBlock(links: FollowupDocumentLinks): string {
  const lines: string[] = [];
  if (links.contractSigningUrl) lines.push(`- contract_signing: ${links.contractSigningUrl}`);
  if (links.poaUrl) lines.push(`- poa: ${links.poaUrl}`);
  if (links.invoiceUrl) lines.push(`- invoice: ${links.invoiceUrl}`);
  if (!lines.length) return '';
  return `REQUIRED LINKS — copy the exact https URL onto its own line when the staff asks for that document. Never invent a URL. Never use example.com.\n${lines.join('\n')}`;
}

const REAL_CONTRACT_URL_RE = /https?:\/\/[^\s]*\/(?:public-contract|public-legacy-contract)\/[^\s<>)"']+/i;
const REAL_POA_URL_RE = /https?:\/\/[^\s]*\/poa\/[^\s<>)"']+/i;
const REAL_INVOICE_URL_RE = /https?:\/\/[^\s]*\/public-proforma(?:-legacy)?\/[^\s<>)"']+/i;

function insertUrlBeforeSignoff(draft: string, url: string): string {
  const closeRe =
    /^(best regards|kind regards|warm regards|with regards|regards|sincerely|yours sincerely|yours truly|thanks|thank you|בברכה|בכבוד רב)\s*,?\s*$/im;
  const match = draft.match(closeRe);
  if (match && match.index != null) {
    return `${draft.slice(0, match.index).trimEnd()}\n\n${url}\n\n${draft.slice(match.index)}`;
  }
  return `${draft.trimEnd()}\n\n${url}\n`;
}

export function applyCrmDocumentLinksToEmailDraft(
  draft: string,
  links: FollowupDocumentLinks,
  userRequest: string,
): string {
  if (!draft.trim()) return draft;
  const request = userRequest.toLowerCase();
  const wantsContract = /contract|agreement|sign(?:ing)?|digital\s+link|signing\s+link|חוזה|הסכם/.test(request);
  const wantsPoa = /\bpoa\b|power of attorney|vollmacht|ייפוי\s*כוח/.test(request);
  const wantsInvoice = /proforma|invoice|payment\s+(?:link|request|reminder)|חשבונית/.test(request);

  let next = draft;
  for (const item of [
    { url: links.contractSigningUrl, wants: wantsContract, hasReal: REAL_CONTRACT_URL_RE },
    { url: links.poaUrl, wants: wantsPoa, hasReal: REAL_POA_URL_RE },
    { url: links.invoiceUrl, wants: wantsInvoice, hasReal: REAL_INVOICE_URL_RE },
  ]) {
    if (!item.url || !item.wants) continue;
    const fakeRe =
      /https?:\/\/(?:www\.)?(?:example\.(?:com|org|net)|placeholder\.[^\s/]+|your[-.]?(?:company|link|url|site)[^\s/]*)[^\s<>)"']*/gi;
    next = next.replace(fakeRe, item.url);
    if (!item.hasReal.test(next)) {
      next = insertUrlBeforeSignoff(next, item.url);
    }
  }

  return next;
}

function overlayLocalDocumentBlocks(edgeCaseFile: string, localCaseFile: string): string {
  const hasRealLink =
    /signing_link=https:\/\//i.test(edgeCaseFile) ||
    /poa_link=https:\/\//i.test(edgeCaseFile) ||
    /invoice_link=https:\/\//i.test(edgeCaseFile);
  if (hasRealLink) return edgeCaseFile;
  const take = (heading: string) => {
    const re = new RegExp(
      `(${heading}[\\s\\S]*?)(?=\\n(?:CONTRACTS |POWER OF ATTORNEY|PROFORMA INVOICES|Payments:|Meetings \\(dates)|$)`,
    );
    return localCaseFile.match(re)?.[1]?.trim() || '';
  };
  const blocks = [
    take('CONTRACTS '),
    take('POWER OF ATTORNEY'),
    take('PROFORMA INVOICES'),
  ].filter(Boolean);
  if (!blocks.length) return edgeCaseFile;
  return `${edgeCaseFile.trim()}\n\n${blocks.join('\n\n')}`;
}

/** Full CRM case file used by pipeline follow-up AI — no extra OpenAI call. */
export async function fetchLeadCaseFileForAi(params: {
  leadId: string;
  isLegacy?: boolean;
}): Promise<string> {
  const leadId = String(params.leadId || '').trim();
  const isLegacy = params.isLegacy === true || leadId.startsWith('legacy_');
  const localPromise = assembleLeadCaseFileFromDb(leadId, isLegacy);
  try {
    const { data, error } = await supabase.functions.invoke('ai-lead-followup', {
      body: { leadId, isLegacy, caseFileOnly: true },
    });
    if (!error && !data?.error) {
      const text = typeof data?.caseFile === 'string' ? data.caseFile.trim() : '';
      if (text) {
        const hasRealLink =
          /signing_link=https:\/\//i.test(text) ||
          /poa_link=https:\/\//i.test(text) ||
          /invoice_link=https:\/\//i.test(text);
        if (hasRealLink) return text;
        try {
          return overlayLocalDocumentBlocks(text, await localPromise);
        } catch {
          return text;
        }
      }
    }
  } catch (error) {
    console.warn('[leadFollowup] caseFileOnly unavailable, loading CRM tables locally', error);
  }
  return localPromise;
}

function clipCaseText(raw: unknown, max = 400): string {
  const text = String(raw ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function pickCaseField(row: Record<string, unknown> | null, keys: string[]): string {
  if (!row) return '';
  for (const key of keys) {
    const value = row[key];
    if (value != null && String(value).trim() !== '') return String(value);
  }
  return '';
}

function parseProformaName(raw: unknown): string {
  if (raw == null || raw === '') return '';
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (parsed && typeof parsed === 'object' && 'proformaName' in parsed) {
      return String((parsed as { proformaName?: unknown }).proformaName || '').trim();
    }
  } catch {
    /* ignore */
  }
  return '';
}

function poaTypeLabel(row: Record<string, unknown>): string {
  const nested = row.poa_types as { name?: unknown; key?: unknown } | { name?: unknown; key?: unknown }[] | null;
  const type = Array.isArray(nested) ? nested[0] : nested;
  return String(type?.name || type?.key || '').trim();
}

async function mintTablePublicToken(
  table: 'payment_plans' | 'proformainvoice',
  id: unknown,
  existing: unknown,
): Promise<string> {
  const token = String(existing || '').trim();
  if (token) return token;
  if (id == null || id === '') return '';
  const next = crypto.randomUUID();
  const { error } = await supabase.from(table).update({ public_token: next }).eq('id', id);
  return error ? '' : next;
}

async function assembleLeadCaseFileFromDb(leadId: string, isLegacy: boolean): Promise<string> {
  const rawId = leadId.replace(/^legacy_/i, '');
  const leadQuery = isLegacy
    ? supabase.from('leads_lead').select('*').eq('id', rawId).maybeSingle()
    : supabase.from('leads').select('*').eq('id', rawId).maybeSingle();

  const waQuery = isLegacy
    ? supabase.from('whatsapp_messages').select('direction, message, sent_at').eq('legacy_id', rawId).order('sent_at', { ascending: false }).limit(16)
    : supabase.from('whatsapp_messages').select('direction, message, sent_at').eq('lead_id', rawId).order('sent_at', { ascending: false }).limit(16);

  const emailQuery = isLegacy
    ? supabase.from('emails').select('direction, subject, body_preview, body_html, sent_at').eq('legacy_id', rawId).order('sent_at', { ascending: false }).limit(8)
    : supabase.from('emails').select('direction, subject, body_preview, body_html, sent_at').eq('client_id', rawId).order('sent_at', { ascending: false }).limit(8);

  const callQuery = isLegacy
    ? supabase.from('call_logs').select('cdate, time, direction, duration, source, destination').eq('lead_id', rawId).order('cdate', { ascending: false }).limit(8)
    : supabase.from('call_logs').select('cdate, time, direction, duration, source, destination').eq('client_id', rawId).order('cdate', { ascending: false }).limit(8);

  const meetingQuery = isLegacy
    ? supabase.from('meetings').select('meeting_date, meeting_time, status, meeting_brief, expert_notes, meeting_summary_notes, meeting_location').eq('legacy_lead_id', rawId).order('meeting_date', { ascending: false }).limit(8)
    : supabase.from('meetings').select('meeting_date, meeting_time, status, meeting_brief, expert_notes, meeting_summary_notes, meeting_location').eq('client_id', rawId).order('meeting_date', { ascending: false }).limit(8);

  const paymentQuery = isLegacy
    ? supabase.from('finances_paymentplanrow').select('value, due_date, cancel_date, actual_date').eq('lead_id', rawId).is('cancel_date', null).order('due_date', { ascending: true }).limit(8)
    : supabase.from('payment_plans').select('id, value, due_date, paid, paid_at, cancel_date, public_token, proforma').eq('lead_id', rawId).is('cancel_date', null).order('due_date', { ascending: true }).limit(12);

  const manualQuery = isLegacy
    ? supabase.from('leads_leadinteractions').select('kind, direction, cdate, content, description').eq('lead_id', rawId).order('cdate', { ascending: false }).limit(12)
    : supabase.from('lead_manual_interactions').select('kind, direction, raw_date, content, observation').eq('lead_id', rawId).order('raw_date', { ascending: false }).limit(12);

  const contractQuery = isLegacy
    ? supabase.from('contracts').select('id, status, signed_at, public_token, total_amount').eq('legacy_id', rawId).order('created_at', { ascending: false }).limit(8)
    : supabase.from('contracts').select('id, status, signed_at, public_token, total_amount').eq('client_id', rawId).order('created_at', { ascending: false }).limit(8);

  const legacyContactContractQuery = isLegacy
    ? supabase.from('lead_leadcontact').select('id, public_token, signed_contract_html, contract_html, main').eq('lead_id', rawId).limit(8)
    : Promise.resolve({ data: [] as Record<string, unknown>[] });

  const poaQuery = isLegacy
    ? supabase
        .from('poa_documents')
        .select('id, secure_token, status, signed_at, signer_name, language, poa_types(name, key)')
        .eq('legacy_lead_id', rawId)
        .neq('status', 'cancelled')
        .order('created_at', { ascending: false })
        .limit(8)
    : supabase
        .from('poa_documents')
        .select('id, secure_token, status, signed_at, signer_name, language, poa_types(name, key)')
        .eq('new_lead_id', rawId)
        .neq('status', 'cancelled')
        .order('created_at', { ascending: false })
        .limit(8);

  const legacyProformaQuery = isLegacy
    ? supabase
        .from('proformainvoice')
        .select('id, total, total_base, cdate, public_token, notes, cxd_date')
        .eq('lead_id', rawId)
        .is('cxd_date', null)
        .order('cdate', { ascending: false })
        .limit(8)
    : Promise.resolve({ data: [] as Record<string, unknown>[] });

  const [
    leadRes,
    waRes,
    emailRes,
    callRes,
    meetingRes,
    paymentRes,
    manualRes,
    contractRes,
    legacyContactContractRes,
    poaRes,
    legacyProformaRes,
  ] = await Promise.all([
    leadQuery,
    waQuery,
    emailQuery,
    callQuery,
    meetingQuery,
    paymentQuery,
    manualQuery,
    contractQuery,
    legacyContactContractQuery,
    poaQuery,
    legacyProformaQuery,
  ]);

  let poaRows = (poaRes.data || []) as Record<string, unknown>[];
  if (poaRes.error) {
    const fallback = isLegacy
      ? await supabase
          .from('poa_documents')
          .select('id, secure_token, status, signed_at, signer_name, language')
          .eq('legacy_lead_id', rawId)
          .neq('status', 'cancelled')
          .order('created_at', { ascending: false })
          .limit(8)
      : await supabase
          .from('poa_documents')
          .select('id, secure_token, status, signed_at, signer_name, language')
          .eq('new_lead_id', rawId)
          .neq('status', 'cancelled')
          .order('created_at', { ascending: false })
          .limit(8);
    poaRows = (fallback.data || []) as Record<string, unknown>[];
  }

  const lead = (leadRes.data || null) as Record<string, unknown> | null;
  if (!lead) throw new Error('Lead not found');

  const sourceId = pickCaseField(lead, ['source_id']);
  const [sourceRes, stageRes] = await Promise.all([
    sourceId
      ? supabase.from('misc_leadsource').select('id, name').eq('id', sourceId).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from('lead_stages').select('id, name'),
  ]);

  const stageId = pickCaseField(lead, ['stage']);
  const stageRow = (stageRes.data || []).find((row: { id?: unknown }) => String(row.id) === String(stageId));
  const stageName = (stageRow as { name?: string } | undefined)?.name || getStageName(stageId) || stageId;
  const sourceName =
    (sourceRes.data as { name?: string } | null)?.name || pickCaseField(lead, ['source']) || '';

  const facts = [
    pickCaseField(lead, ['facts', 'description']),
    pickCaseField(lead, ['special_notes']),
    pickCaseField(lead, ['general_notes', 'notes']),
    pickCaseField(lead, ['meeting_scheduling_notes']),
  ]
    .map((item) => clipCaseText(item, 1800))
    .filter(Boolean)
    .join('\n\n') || '(none on file)';

  const meetings = (meetingRes.data || []).map((row: Record<string, unknown>) => {
    const header = [row.meeting_date, row.status].filter(Boolean).join(' · ');
    const body = [row.meeting_summary_notes, row.meeting_brief, row.expert_notes]
      .map((item) => clipCaseText(item, 900))
      .filter(Boolean)
      .join('\n');
    return body ? `${header}\n${body}` : `${header}: (no notes)`;
  });

  const whatsapp = (waRes.data || [])
    .map((row: Record<string, unknown>) => `${row.direction || '?'} ${String(row.sent_at || '').slice(0, 16)}: ${clipCaseText(row.message, 400)}`)
    .filter((line: string) => !line.endsWith(': '));

  const emails = (emailRes.data || []).map((row: Record<string, unknown>) => {
    const preview = clipCaseText(row.body_html, 700) || clipCaseText(row.body_preview, 700);
    return `${row.direction || '?'} ${String(row.sent_at || '').slice(0, 16)} ${clipCaseText(row.subject, 120)}: ${preview}`;
  });

  const calls = (callRes.data || []).map((row: Record<string, unknown>) =>
    `${row.direction || '?'} ${row.cdate || ''} ${String(row.time || '').slice(0, 5)} ${clipCaseText(`${row.source || ''} → ${row.destination || ''} ${row.duration || ''}`, 160)}`,
  );

  const manuals = (manualRes.data || []).map((row: Record<string, unknown>) =>
    `${row.direction || row.kind || 'note'} ${row.raw_date || row.cdate || ''}: ${clipCaseText(row.content || row.description || row.observation, 400)}`,
  );

  const payments = paymentRes.data || [];
  const unpaid = payments.filter((row: Record<string, unknown>) => (isLegacy ? !row.actual_date : row.paid !== true)).length;

  const contractLines: string[] = [];
  for (const row of contractRes.data || []) {
    const signed = Boolean(row.signed_at) || String(row.status || '').toLowerCase() === 'signed';
    let token = String(row.public_token || '').trim();
    if (!token && row.id) {
      token = crypto.randomUUID();
      await supabase.from('contracts').update({ public_token: token }).eq('id', row.id);
    }
    const link = token ? `${getFrontendBaseUrl()}/public-contract/${row.id}/${token}` : '';
    contractLines.push(
      `- ${signed ? 'SIGNED' : 'NOT SIGNED'} | status=${row.status || (signed ? 'signed' : 'draft')}${
        row.signed_at ? ` | signed_at=${row.signed_at}` : ''
      }${row.total_amount != null ? ` | amount=${row.total_amount}` : ''} | signing_link=${link || '(none)'}`,
    );
  }
  for (const row of legacyContactContractRes.data || []) {
    if (!row.contract_html && !row.signed_contract_html && !row.public_token) continue;
    const signed = Boolean(row.signed_contract_html);
    let token = String(row.public_token || '');
    if (!token) {
      token = crypto.randomUUID();
      await supabase.from('lead_leadcontact').update({ public_token: token }).eq('id', row.id);
    }
    const link = `${getFrontendBaseUrl()}/public-legacy-contract/${row.id}/${token}`;
    contractLines.push(
      `- ${signed ? 'SIGNED' : 'NOT SIGNED'} | status=${signed ? 'signed' : 'draft'} | source=legacy_contact | signing_link=${link}`,
    );
  }

  const poaLines: string[] = [];
  for (const rec of poaRows) {
    const token = String(rec.secure_token || '').trim();
    if (!token) continue;
    const signed = Boolean(rec.signed_at) || String(rec.status || '').toLowerCase() === 'signed';
    const typeName = poaTypeLabel(rec);
    poaLines.push(
      `- ${signed ? 'SIGNED' : 'NOT SIGNED'} | status=${rec.status || (signed ? 'signed' : 'pending')}${
        typeName ? ` | type=${typeName}` : ''
      }${rec.signer_name ? ` | signer=${rec.signer_name}` : ''}${
        rec.signed_at ? ` | signed_at=${rec.signed_at}` : ''
      } | poa_link=${buildPoaUrl(token)}`,
    );
  }

  const proformaLines: string[] = [];
  if (!isLegacy) {
    for (const row of payments as Record<string, unknown>[]) {
      const name = parseProformaName(row.proforma);
      const hasDoc = Boolean(name) || (row.proforma != null && String(row.proforma).trim() !== '');
      if (!hasDoc) continue;
      const token = await mintTablePublicToken('payment_plans', row.id, row.public_token);
      const link = token ? `${getFrontendBaseUrl()}/public-proforma/${row.id}/${token}` : '(none)';
      const paid = row.paid === true;
      proformaLines.push(
        `- ${paid ? 'PAID' : 'UNPAID'} | source=new | name=${name || 'Proforma'}${
          row.value != null ? ` | amount=${row.value}` : ''
        }${row.due_date ? ` | due=${row.due_date}` : ''} | invoice_link=${link}`,
      );
    }
  }
  for (const row of legacyProformaRes.data || []) {
    const rec = row as Record<string, unknown>;
    const token = await mintTablePublicToken('proformainvoice', rec.id, rec.public_token);
    const link = token ? `${getFrontendBaseUrl()}/public-proforma-legacy/${rec.id}/${token}` : '(none)';
    const amount = rec.total ?? rec.total_base;
    proformaLines.push(
      `- OPEN | source=legacy | date=${rec.cdate || ''}${
        amount != null ? ` | amount=${amount}` : ''
      } | invoice_link=${link}`,
    );
  }

  const crmFields = {
    name: pickCaseField(lead, ['name']),
    leadNumber: pickCaseField(lead, ['lead_number', 'id']),
    isLegacy,
    stage: stageName,
    topic: pickCaseField(lead, ['topic']),
    category: pickCaseField(lead, ['category']),
    source: sourceName,
    language: pickCaseField(lead, ['language']),
    country: pickCaseField(lead, ['client_country', 'country']),
    expertExamination: pickCaseField(lead, ['expert_examination']),
    proposal: pickCaseField(lead, ['proposal_total', 'proposal']),
    balance: pickCaseField(lead, ['balance', 'total_base', 'total']),
    eligible: pickCaseField(lead, ['eligible', 'eligibile']),
    applicants: pickCaseField(lead, ['no_of_applicants', 'number_of_applicants', 'number_of_applicants_meeting']),
    followUpDate: pickCaseField(lead, ['follow_up_date', 'next_followup']),
    createdAt: pickCaseField(lead, ['created_at', 'cdate']),
  };

  return `CASE FILE — facts and notes:
${facts}

MEETING SUMMARIES (newest first):
${meetings.join('\n---\n') || '(no meeting notes)'}

WHATSAPP (newest first):
${whatsapp.join('\n') || '(none)'}

EMAIL (newest first):
${emails.join('\n') || '(none)'}

CALLS:
${calls.join('\n') || '(none)'}

MANUAL NOTES:
${manuals.join('\n') || '(none)'}

CRM fields:
${JSON.stringify(crmFields)}

CONTRACTS (use signing_link in the email when asking them to sign; never invent a URL):
${contractLines.join('\n') || '(no contract on file)'}

POWER OF ATTORNEY / POA (use poa_link in the email when sending a digital POA; never invent a URL):
${poaLines.join('\n') || '(no POA on file)'}

PROFORMA INVOICES (use invoice_link in the email when sending a proforma / invoice; never invent a URL):
${proformaLines.join('\n') || '(no proforma on file)'}

Payments:
${JSON.stringify({ unpaid, paid: payments.length - unpaid, rowCount: payments.length })}`;
}
