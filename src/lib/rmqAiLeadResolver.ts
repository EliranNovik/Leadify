import { searchLeads, type CombinedLead } from './legacyLeadsApi';
import {
  currentLeadAsToolArgs,
  getRmqAiCurrentLead,
  isThisClientQuery,
  isOpenClientRoleQuestion,
  normalizeLeadNumberToken,
  queryMatchesOpenLead,
} from './rmqAiChatContext';

export type ResolvedLead = {
  entityType: 'lead' | 'sublead' | 'legacy_lead';
  leadId: string;
  leadNumber: string;
  displayName: string;
  isLegacy: boolean;
  legacyLeadId?: string;
  clientId?: string;
  masterLeadId?: string;
  masterLeadNumber?: string;
};

export type LeadResolutionMatch = {
  leadId: string;
  leadNumber: string;
  displayName: string;
};

export type LeadResolutionResult =
  | { status: 'resolved'; lead: ResolvedLead }
  | { status: 'ambiguous'; matches: LeadResolutionMatch[] }
  | { status: 'not_found'; query?: string };

export type LeadResolveArgs = {
  query?: string;
  lead_id?: string;
  is_legacy?: boolean;
};

let lastResolution: LeadResolutionResult | null = null;

export function rememberLeadResolution(result: LeadResolutionResult | null) {
  lastResolution = result;
}

export function resetLeadResolution() {
  lastResolution = null;
}

export function peekLeadResolution(): LeadResolutionResult | null {
  return lastResolution;
}

function tokenOf(value: unknown): string {
  return normalizeLeadNumberToken(value);
}

function toResolved(row: CombinedLead): ResolvedLead {
  const isLegacy = row.lead_type === 'legacy';
  const rawId = String(row.id || '').replace(/^legacy_/i, '');
  const leadNumber = String(row.lead_number || row.manual_id || '').trim() || rawId;
  const hasSlash = leadNumber.includes('/');
  return {
    entityType: hasSlash ? 'sublead' : isLegacy ? 'legacy_lead' : 'lead',
    leadId: isLegacy ? `legacy_${rawId}` : String(row.id),
    leadNumber,
    displayName: String(row.name || '').trim() || leadNumber,
    isLegacy,
    legacyLeadId: isLegacy ? rawId : undefined,
    clientId: isLegacy ? undefined : String(row.id),
    masterLeadId: row.master_id != null ? String(row.master_id) : undefined,
    masterLeadNumber: hasSlash ? leadNumber.split('/')[0] : undefined,
  };
}

function toMatch(row: CombinedLead): LeadResolutionMatch {
  const lead = toResolved(row);
  return {
    leadId: lead.leadId,
    leadNumber: lead.leadNumber,
    displayName: lead.displayName,
  };
}

function isExactTokenMatch(row: CombinedLead, query: string): boolean {
  const token = tokenOf(query);
  if (!token) return false;
  return (
    tokenOf(row.lead_number) === token ||
    tokenOf(row.manual_id) === token ||
    tokenOf(row.id) === token ||
    String(row.id) === query ||
    String(row.lead_number || '').trim() === query.trim()
  );
}

function fromOpenLead(id: string, isLegacyHint?: boolean): ResolvedLead {
  const open = getRmqAiCurrentLead();
  const rawId = id.replace(/^legacy_/i, '');
  const isLegacy = isLegacyHint === true || id.startsWith('legacy_') || open?.lead_type === 'legacy';
  const leadNumber = String(open?.lead_number || '').trim() || rawId;
  const hasSlash = leadNumber.includes('/');
  return {
    entityType: hasSlash ? 'sublead' : isLegacy ? 'legacy_lead' : 'lead',
    leadId: isLegacy && !id.startsWith('legacy_') ? `legacy_${rawId}` : id,
    leadNumber,
    displayName: String(open?.name || '').trim() || leadNumber,
    isLegacy,
    legacyLeadId: isLegacy ? rawId : undefined,
    clientId: isLegacy ? undefined : id,
    masterLeadNumber: hasSlash ? leadNumber.split('/')[0] : undefined,
  };
}

export function formatLeadResolutionForModel(result: LeadResolutionResult): string {
  if (result.status === 'resolved') {
    return `${result.lead.leadNumber} ${result.lead.displayName}`.trim();
  }
  if (result.status === 'not_found') {
    return result.query
      ? `No lead found for "${result.query}". Do not invent a client.`
      : 'No lead found. Do not invent a client.';
  }
  const lines = result.matches.map((row) => `- ${row.leadNumber} ${row.displayName}`.trim());
  return `Multiple leads match. Ask which one they mean. Do not pick silently.\n${lines.join('\n')}`;
}

export async function resolveCrmLead(args: LeadResolveArgs): Promise<LeadResolutionResult> {
  const fallback = currentLeadAsToolArgs();
  const rawQuery = String(args.query || '').trim();
  const useOpen =
    !rawQuery || isThisClientQuery(rawQuery) || queryMatchesOpenLead(rawQuery, fallback) || isOpenClientRoleQuestion(rawQuery, fallback);
  const explicitId = String(args.lead_id || (useOpen ? fallback.lead_id : '') || '').trim();

  if (explicitId && useOpen) {
    const result: LeadResolutionResult = {
      status: 'resolved',
      lead: fromOpenLead(explicitId, args.is_legacy ?? fallback.is_legacy),
    };
    rememberLeadResolution(result);
    return result;
  }

  const query = useOpen ? String(fallback.query || getRmqAiCurrentLead()?.lead_number || '').trim() : rawQuery;
  if (!query) {
    const result: LeadResolutionResult = { status: 'not_found' };
    rememberLeadResolution(result);
    return result;
  }

  const matches = await searchLeads(query, { limit: 8, timeoutMs: 4000 });
  if (!matches.length) {
    if (useOpen && fallback.lead_id) {
      const result: LeadResolutionResult = {
        status: 'resolved',
        lead: fromOpenLead(String(fallback.lead_id), fallback.is_legacy),
      };
      rememberLeadResolution(result);
      return result;
    }
    const result: LeadResolutionResult = { status: 'not_found', query };
    rememberLeadResolution(result);
    return result;
  }

  const exact = matches.filter((row) => isExactTokenMatch(row, query));
  if (exact.length === 1) {
    const result: LeadResolutionResult = { status: 'resolved', lead: toResolved(exact[0]) };
    rememberLeadResolution(result);
    return result;
  }
  if (exact.length > 1) {
    const token = tokenOf(query);
    if (token.includes('/')) {
      const sub = exact.find((row) => String(row.lead_number || '').includes('/'));
      if (sub) {
        const result: LeadResolutionResult = { status: 'resolved', lead: toResolved(sub) };
        rememberLeadResolution(result);
        return result;
      }
    }
    const result: LeadResolutionResult = { status: 'ambiguous', matches: exact.slice(0, 5).map(toMatch) };
    rememberLeadResolution(result);
    return result;
  }

  const queryToken = tokenOf(query);
  if (queryToken.includes('/')) {
    const slashRow = matches.find((row) => tokenOf(row.lead_number) === queryToken);
    if (slashRow) {
      const result: LeadResolutionResult = { status: 'resolved', lead: toResolved(slashRow) };
      rememberLeadResolution(result);
      return result;
    }
  }

  if (matches.length === 1) {
    const result: LeadResolutionResult = { status: 'resolved', lead: toResolved(matches[0]) };
    rememberLeadResolution(result);
    return result;
  }

  const result: LeadResolutionResult = { status: 'ambiguous', matches: matches.slice(0, 5).map(toMatch) };
  rememberLeadResolution(result);
  return result;
}

export async function requireResolvedLead(args: LeadResolveArgs): Promise<ResolvedLead> {
  const result = await resolveCrmLead(args);
  if (result.status !== 'resolved') {
    throw new Error(formatLeadResolutionForModel(result));
  }
  return result.lead;
}
