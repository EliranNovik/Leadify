export type ChatSummary = {
  summary: string;
  leadNumbers: string[];
  people: string[];
  topics: string[];
  userGoal?: string;
  decisions?: string[];
  unresolved?: string[];
};

export type PastChatHit = {
  date: string;
  title: string;
  summary: ChatSummary | string;
  matchingSnippet: string;
  conversationId: string;
  leadNumber?: string;
  matchReason?: 'lead' | 'title' | 'summary' | 'message';
};

export type EvidenceType =
  | 'current_crm_fact'
  | 'historical_chat'
  | 'firm_policy'
  | 'web_research'
  | 'user_preference'
  | 'model_inference';

export type AiClaimEvidence =
  | { type: 'current_crm_fact'; tool: string; recordIds?: string[]; fetchedAt: string }
  | { type: 'historical_chat'; conversationId: string }
  | { type: 'firm_policy'; knowledgeChunkId: string; documentVersion: string }
  | { type: 'web_research'; sourceUrls?: string[]; fetchedAt: string }
  | { type: 'user_preference'; memoryId?: string }
  | { type: 'model_inference' };

export type AiAnswerEvidence = {
  answerMessageId: string;
  claims: Array<{ claim: string; evidence: AiClaimEvidence }>;
};

export type Answerability = 'answer' | 'clarify' | 'retrieve_more' | 'cannot_verify';

export type FailureOrigin =
  | 'model'
  | 'tool_routing'
  | 'resolver'
  | 'crm_query'
  | 'crm_source_data'
  | 'knowledge'
  | 'memory'
  | 'ui'
  | 'unknown';

export type AiFeedbackReason =
  | 'wrong_data'
  | 'wrong_client'
  | 'wrong_tool'
  | 'bad_draft'
  | 'too_long'
  | 'too_short'
  | 'other';

export type AiQualityEventName =
  | 'unexpected_tool'
  | 'resolver_mismatch'
  | 'conflicting_tool_results'
  | 'answer_without_required_tool'
  | 'write_without_clear_target'
  | 'tool_error'
  | 'high_latency'
  | 'empty_result'
  | 'user_correction'
  | 'possible_user_correction';

export type AiEvalSeverity = 'cosmetic' | 'minor' | 'major' | 'critical';

export type DataSensitivity = 'normal' | 'internal' | 'confidential' | 'highly_sensitive';

export type MemoryPolicy = 'allowed' | 'blocked' | 'explicit_only';

export type UserMemoryCategory = 'tone' | 'language' | 'format' | 'workflow' | 'preference';

export type MemoryDurability = 'permanent' | 'long_term' | 'temporary';

export type RmqAiRolePackId = 'sales' | 'caseHandler' | 'manager' | 'finance' | 'scheduler' | 'expert';

export type WriteRiskLevel = 0 | 1 | 2 | 3 | 4 | 5;

export type RecommendationOutcome = 'accepted' | 'dismissed' | 'ignored' | 'edited_then_accepted';

export const MEETING_TOOLS = new Set(['list_client_meetings', 'list_calendar_day', 'list_meetings']);
export const WRITE_TOOLS = new Set([
  'create_lead',
  'create_meeting',
  'set_follow_up',
  'log_manual_note',
  'setup_client_portal',
]);
export const FINANCE_TOOLS = new Set(['list_expenses', 'get_firm_financials']);
export const HIGHLY_SENSITIVE_TOOLS = new Set<string>();
