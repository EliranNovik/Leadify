import { getRmqAiCurrentLead } from './rmqAiChatContext';
import { peekLeadResolution, resetLeadResolution, type LeadResolutionResult } from './rmqAiLeadResolver';

export type RmqAiRoutingLog = {
  pageType?: string;
  activeLead?: string;
  userMessage?: string;
  availableTools?: string[];
  selectedTool?: string;
  resolution?: {
    requested?: string;
    status?: string;
    resolvedLead?: string;
    entityType?: string;
  };
  toolDurationMs?: number;
};

let turnMeta: { userMessage?: string; availableTools?: string[]; pageType?: string } = {};

export function beginRmqAiTurn(meta: { userMessage?: string; availableTools?: string[]; pageType?: string }) {
  turnMeta = { ...meta };
  resetLeadResolution();
}

function resolutionSnapshot(result: LeadResolutionResult | null) {
  if (!result) return undefined;
  if (result.status === 'resolved') {
    return {
      requested: turnMeta.userMessage ? 'turn' : 'activeEntity',
      status: result.status,
      resolvedLead: result.lead.leadNumber,
      entityType: result.lead.entityType,
    };
  }
  return {
    requested: turnMeta.userMessage ? 'turn' : 'activeEntity',
    status: result.status,
    resolvedLead: result.status === 'not_found' ? result.query : result.matches.map((row) => row.leadNumber).join(', '),
  };
}

export function logRmqAiToolRouting(selectedTool: string, toolDurationMs: number) {
  const open = getRmqAiCurrentLead();
  const entry: RmqAiRoutingLog = {
    pageType: turnMeta.pageType,
    activeLead: open?.lead_number ? String(open.lead_number) : undefined,
    userMessage: turnMeta.userMessage,
    availableTools: turnMeta.availableTools,
    selectedTool,
    resolution: resolutionSnapshot(peekLeadResolution()),
    toolDurationMs,
  };
  console.info('[rmq-ai-routing]', entry);
}
