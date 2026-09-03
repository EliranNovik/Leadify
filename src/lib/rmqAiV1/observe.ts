import { supabase } from '../supabase';
import { peekLeadResolution } from '../rmqAiLeadResolver';
import { getRmqAiCurrentLead } from '../rmqAiChatContext';
import { getCurrentAiTrace } from './trace';
import { currentRmqAiVersions } from './versions';
import {
  MEETING_TOOLS,
  WRITE_TOOLS,
  type AiAnswerEvidence,
  type AiFeedbackReason,
  type AiQualityEventName,
  type FailureOrigin,
} from './types';

export function detectPossibleUserCorrection(text: string): boolean {
  return /\b(no,?\s+that'?s not right|that'?s wrong|actually\b|not\s+\w+.+\bis the|correction:|you'?re wrong)\b/i.test(
    text,
  );
}

export function classifyAnswerability(input: {
  toolErrors: string[];
  selectedTools: string[];
  userMessage: string;
  resolverStatus?: string;
}): 'answer' | 'clarify' | 'retrieve_more' | 'cannot_verify' {
  if (input.resolverStatus === 'ambiguous') return 'clarify';
  if (input.toolErrors.length > 0 && /meeting|contract|status|unsigned/i.test(input.userMessage)) {
    return 'cannot_verify';
  }
  if (
    /policy|procedure|sop|rule|how do we (normally )?(request|order)|archive (contact|procedure)/i.test(
      input.userMessage,
    ) &&
    !input.selectedTools.includes('search_firm_knowledge')
  ) {
    return 'retrieve_more';
  }
  return 'answer';
}

export function detectQualityEvents(input: {
  userMessage: string;
  selectedTools: string[];
  toolErrors: string[];
  toolResults?: Array<{ name: string; content: string }>;
  finalContent: string;
  totalMs?: number;
}): AiQualityEventName[] {
  const events: AiQualityEventName[] = [];
  const resolution = peekLeadResolution();
  const open = getRmqAiCurrentLead();
  if (
    resolution?.status === 'resolved' &&
    open?.lead_number &&
    resolution.lead.leadNumber &&
    String(open.lead_number) !== String(resolution.lead.leadNumber)
  ) {
    events.push('resolver_mismatch');
  }
  if (/\bnext meeting|when is (the |this )?meeting\b/i.test(input.userMessage)) {
    const usedMeeting = input.selectedTools.some((name) => MEETING_TOOLS.has(name));
    if (!usedMeeting) events.push('answer_without_required_tool');
  }
  if (/\bportal(?:\s+link|\s+password|\s+access)?\b|access code|פורטל/i.test(input.userMessage)) {
    const usedPortal = input.selectedTools.some(
      (name) => name === 'get_client_portal_access' || name === 'setup_client_portal' || name === 'get_lead_case_file',
    );
    if (!usedPortal) events.push('answer_without_required_tool');
  }
  if (
    WRITE_TOOLS.has(input.selectedTools[0] || '') &&
    /\bwhat('s| is) happening|status|update me\b/i.test(input.userMessage)
  ) {
    events.push('write_without_clear_target');
  }
  if (
    /\b(who is|who'?s)\b.+\b(handler|expert|manager|closer|scheduler)\b/i.test(input.userMessage) &&
    input.selectedTools.includes('web_search')
  ) {
    events.push('unexpected_tool');
  }
  if (input.toolErrors.length > 0) events.push('tool_error');
  if ((input.totalMs || 0) > 8000) events.push('high_latency');
  if (!String(input.finalContent || '').trim()) events.push('empty_result');

  const meetingResults = (input.toolResults || []).filter((row) => MEETING_TOOLS.has(row.name));
  if (meetingResults.length >= 2) {
    const hasMeetings = meetingResults.some((row) => /meeting|date|11:|10:/i.test(row.content));
    const empty = meetingResults.some((row) => /no meetings|none found/i.test(row.content));
    if (hasMeetings && empty) events.push('conflicting_tool_results');
  }
  return events;
}

export async function persistQualityEvents(
  events: AiQualityEventName[],
  extra?: { conversationId?: string | null; messageId?: string | null },
) {
  if (events.length === 0) return;
  const user = (await supabase.auth.getUser()).data.user;
  const trace = getCurrentAiTrace();
  const rows = events.map((event_name) => ({
    user_id: user?.id || null,
    ai_trace_id: trace?.aiTraceId || null,
    conversation_id: extra?.conversationId || null,
    message_id: extra?.messageId || null,
    event_name,
    versions: currentRmqAiVersions(),
  }));
  await supabase.from('ai_quality_events').insert(rows);
}

export async function persistFeedback(input: {
  conversationId?: string | null;
  messageId: string;
  rating: 'up' | 'down';
  reason?: AiFeedbackReason;
  correction?: string;
  failureOrigin?: FailureOrigin;
}) {
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) return;
  const trace = getCurrentAiTrace();
  await supabase.from('ai_feedback').insert({
    user_id: user.id,
    conversation_id: input.conversationId || null,
    message_id: input.messageId,
    rating: input.rating,
    reason: input.reason || null,
    correction: input.correction || null,
    failure_origin: input.failureOrigin || null,
    ai_trace_id: trace?.aiTraceId || null,
    versions: currentRmqAiVersions(),
  });
}

export async function persistAnswerEvidence(evidence: AiAnswerEvidence) {
  const user = (await supabase.auth.getUser()).data.user;
  const trace = getCurrentAiTrace();
  await supabase.from('ai_answer_evidence').insert({
    user_id: user?.id || null,
    ai_trace_id: trace?.aiTraceId || null,
    answer_message_id: evidence.answerMessageId,
    claims: evidence.claims,
  });
}

export function evidenceFromTools(
  answerMessageId: string,
  toolResults: Array<{ name: string; content: string }>,
  finalContent: string,
): AiAnswerEvidence {
  const claims = toolResults.slice(0, 6).map((row) => {
    if (row.name === 'web_search') {
      let sourceUrls: string[] = [];
      try {
        const parsed = JSON.parse(row.content) as { sources?: Array<{ url?: string }> };
        sourceUrls = (parsed.sources || []).map((src) => String(src.url || '')).filter(Boolean);
      } catch {
        sourceUrls = [];
      }
      return {
        claim: finalContent.slice(0, 180) || 'web research',
        evidence: {
          type: 'web_research' as const,
          sourceUrls,
          fetchedAt: new Date().toISOString(),
        },
      };
    }
    return {
      claim: finalContent.slice(0, 180) || row.name,
      evidence: {
        type: 'current_crm_fact' as const,
        tool: row.name,
        fetchedAt: new Date().toISOString(),
      },
    };
  });
  if (claims.length === 0 && finalContent) {
    claims.push({ claim: finalContent.slice(0, 180), evidence: { type: 'model_inference' } });
  }
  return { answerMessageId, claims };
}

export function inferFailureOrigin(reason?: AiFeedbackReason, events: AiQualityEventName[] = []): FailureOrigin {
  if (reason === 'wrong_client' || events.includes('resolver_mismatch')) return 'resolver';
  if (reason === 'wrong_tool' || events.includes('answer_without_required_tool')) return 'tool_routing';
  if (events.includes('tool_error')) return 'crm_query';
  if (reason === 'wrong_data') return 'unknown';
  return 'model';
}

export async function persistIncident(input: {
  title: string;
  severity: 'major' | 'critical';
  details: Record<string, unknown>;
}) {
  const user = (await supabase.auth.getUser()).data.user;
  const trace = getCurrentAiTrace();
  await supabase.from('ai_incidents').insert({
    user_id: user?.id || null,
    ai_trace_id: trace?.aiTraceId || null,
    title: input.title,
    severity: input.severity,
    details: { ...input.details, versions: currentRmqAiVersions(), trace },
  });
}
