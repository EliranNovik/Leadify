import { currentRmqAiVersions, type RmqAiVersionStamp } from './versions';

export type AiTurnTrace = {
  aiTraceId: string;
  startedAt: string;
  versions: RmqAiVersionStamp;
  conversationId?: string | null;
  userMessage?: string;
  pageType?: string;
  activeLeadNumber?: string;
  selectedTools: string[];
  toolErrors: string[];
  resolverStatus?: string;
  resolvedLeadNumber?: string;
  modelFirstTokenMs?: number;
  toolSelectionMs?: number;
  toolExecutionMs?: number;
  finalModelMs?: number;
  totalMs?: number;
  answerability?: string;
};

let currentTrace: AiTurnTrace | null = null;

export function newAiTraceId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `trace-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function beginAiTrace(partial: Partial<AiTurnTrace> = {}): AiTurnTrace {
  currentTrace = {
    aiTraceId: newAiTraceId(),
    startedAt: new Date().toISOString(),
    versions: currentRmqAiVersions(),
    selectedTools: [],
    toolErrors: [],
    ...partial,
  };
  return currentTrace;
}

export function getCurrentAiTrace(): AiTurnTrace | null {
  return currentTrace;
}

export function patchAiTrace(patch: Partial<AiTurnTrace>) {
  if (!currentTrace) return;
  currentTrace = { ...currentTrace, ...patch };
}

export function recordTraceTool(name: string, error?: string) {
  if (!currentTrace) return;
  currentTrace.selectedTools = [...currentTrace.selectedTools, name];
  if (error) currentTrace.toolErrors = [...currentTrace.toolErrors, `${name}: ${error}`];
}

export function finishAiTrace(patch: Partial<AiTurnTrace> = {}): AiTurnTrace | null {
  if (!currentTrace) return null;
  const started = Date.parse(currentTrace.startedAt);
  currentTrace = {
    ...currentTrace,
    ...patch,
    totalMs: Number.isFinite(started) ? Date.now() - started : currentTrace.totalMs,
  };
  return currentTrace;
}
