import { supabase } from '../supabase';
import {
  FINANCE_TOOLS,
  HIGHLY_SENSITIVE_TOOLS,
  WRITE_TOOLS,
  type DataSensitivity,
  type RmqAiRolePackId,
} from './types';

export type RolePack = {
  id: RmqAiRolePackId;
  label: string;
  suggestedActions: string[];
  relevantMetrics: string[];
  allowedTools?: string[] | null;
  deniedTools: string[];
  maxSensitivity: DataSensitivity;
};

const SENSITIVITY_RANK: Record<DataSensitivity, number> = {
  normal: 0,
  internal: 1,
  confidential: 2,
  highly_sensitive: 3,
};

export const ROLE_PACKS: Record<RmqAiRolePackId, RolePack> = {
  sales: {
    id: 'sales',
    label: 'Sales',
    suggestedActions: ['lead status', 'last contact', 'next meeting', 'contract status', 'suggested follow-up'],
    relevantMetrics: ['unsigned contracts', 'follow-ups due', 'meetings today'],
    deniedTools: [],
    maxSensitivity: 'confidential',
  },
  caseHandler: {
    id: 'caseHandler',
    label: 'Case handler',
    suggestedActions: ['missing documents', 'application stage', 'recent correspondence', 'deadline', 'next required action'],
    relevantMetrics: ['open cases', 'overdue documents'],
    deniedTools: ['get_firm_financials'],
    maxSensitivity: 'highly_sensitive',
  },
  manager: {
    id: 'manager',
    label: 'Manager',
    suggestedActions: ['team bottlenecks', 'overdue follow-ups', 'unsigned contracts', 'conversion', 'workload'],
    relevantMetrics: ['conversion', 'unsigned', 'workload'],
    deniedTools: [],
    maxSensitivity: 'highly_sensitive',
  },
  finance: {
    id: 'finance',
    label: 'Finance',
    suggestedActions: ['expenses', 'income', 'outstanding invoices'],
    relevantMetrics: ['P&L', 'expenses by category'],
    deniedTools: [],
    maxSensitivity: 'confidential',
  },
  scheduler: {
    id: 'scheduler',
    label: 'Scheduler',
    suggestedActions: ['calendar day', 'client next meeting', 'presence'],
    relevantMetrics: ['meetings today', 'no-shows'],
    deniedTools: ['get_firm_financials', 'list_expenses'],
    maxSensitivity: 'confidential',
  },
  expert: {
    id: 'expert',
    label: 'Expert',
    suggestedActions: ['eligibility', 'expert opinion', 'case file'],
    relevantMetrics: ['eligibility pending'],
    deniedTools: ['get_firm_financials'],
    maxSensitivity: 'highly_sensitive',
  },
};

export function toolSensitivity(toolName: string): DataSensitivity {
  if (FINANCE_TOOLS.has(toolName)) return 'confidential';
  if (HIGHLY_SENSITIVE_TOOLS.has(toolName)) return 'highly_sensitive';
  if (WRITE_TOOLS.has(toolName)) return 'internal';
  return 'internal';
}

export function filterToolsForRole<T extends { function?: { name?: string } }>(
  tools: T[],
  role: RmqAiRolePackId,
): T[] {
  const pack = ROLE_PACKS[role] || ROLE_PACKS.sales;
  return tools.filter((tool) => {
    const name = tool.function?.name || '';
    if (!name) return true;
    if (pack.deniedTools.includes(name)) return false;
    if (pack.allowedTools && !pack.allowedTools.includes(name)) return false;
    return SENSITIVITY_RANK[toolSensitivity(name)] <= SENSITIVITY_RANK[pack.maxSensitivity];
  });
}

export async function resolveRmqAiRolePack(): Promise<RmqAiRolePackId> {
  const { data: session } = await supabase.auth.getUser();
  const email = session.user?.email || '';
  const authId = session.user?.id;
  let role = '';
  if (authId) {
    const { data } = await supabase.from('users').select('role').eq('auth_id', authId).maybeSingle();
    role = String(data?.role || '').toLowerCase();
  }
  if (role.includes('admin') || role.includes('manager')) return 'manager';
  if (role.includes('finance') || role.includes('account')) return 'finance';
  if (role.includes('schedul')) return 'scheduler';
  if (role.includes('expert')) return 'expert';
  if (role.includes('handler') || role.includes('case')) return 'caseHandler';
  if (/finance|account/i.test(email)) return 'finance';
  return 'sales';
}
