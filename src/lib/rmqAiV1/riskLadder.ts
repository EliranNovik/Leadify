import { WRITE_TOOLS, type WriteRiskLevel } from './types';

export function writeRiskForTool(toolName: string): WriteRiskLevel {
  if (toolName === 'draft_client_message') return 1;
  if (WRITE_TOOLS.has(toolName)) return 2;
  if (toolName === 'create_lead' || toolName === 'create_meeting') return 2;
  return 0;
}

export function requiresWriteConfirmation(level: WriteRiskLevel): boolean {
  return level >= 3;
}

export const WRITE_RISK_LABELS: Record<WriteRiskLevel, string> = {
  0: 'Read CRM data',
  1: 'Generate / draft',
  2: 'Create reversible internal records',
  3: 'External communication',
  4: 'Important CRM changes',
  5: 'Destructive / legally significant',
};
