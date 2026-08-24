import { supabase } from './supabase';
import type { Lead } from './supabase';
import { getStageName } from './stageUtils';

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
