import type { Lead } from './supabase';

export const LEAD_CLIENT_TABS = [
  { id: 'info', label: 'Info' },
  { id: 'roles', label: 'Roles' },
  { id: 'contact', label: 'Contact' },
  { id: 'marketing', label: 'Marketing' },
  { id: 'expert', label: 'Expert' },
  { id: 'meeting', label: 'Meeting' },
  { id: 'price', label: 'Offer' },
  { id: 'interactions', label: 'Interactions' },
  { id: 'finances', label: 'Finances' },
] as const;

export type LeadClientTabId = (typeof LEAD_CLIENT_TABS)[number]['id'];

function appendTabToPath(path: string, tabId: string): string {
  const qIndex = path.indexOf('?');
  if (qIndex === -1) {
    return `${path}?tab=${encodeURIComponent(tabId)}`;
  }
  const base = path.slice(0, qIndex);
  const params = new URLSearchParams(path.slice(qIndex + 1));
  params.set('tab', tabId);
  return `${base}?${params.toString()}`;
}

/** Client page path for a search result lead (matches LeadSearchPage navigation). */
export function buildLeadClientPath(lead: Lead, tabId?: LeadClientTabId): string | null {
  const anyLead = lead as Record<string, unknown>;
  const leadNumber = String(
    anyLead.display_lead_number || anyLead.lead_number || anyLead.id || '',
  ).trim();
  const manualId =
    anyLead.manual_id != null && String(anyLead.manual_id).trim() !== ''
      ? String(anyLead.manual_id).trim()
      : null;
  const leadType = anyLead.lead_type as 'new' | 'legacy' | undefined;
  const leadId = anyLead.id != null ? String(anyLead.id) : null;

  if (!leadNumber && !leadId) return null;

  let path = '';

  if (leadType === 'legacy') {
    const identifier = leadId || '';
    if (!identifier) return null;
    path = `/clients/${encodeURIComponent(identifier)}`;
  } else {
    const isSubLead = leadNumber.includes('/');
    if (isSubLead && manualId) {
      path = `/clients/${encodeURIComponent(manualId)}?lead=${encodeURIComponent(leadNumber)}`;
    } else if (isSubLead && !manualId) {
      const baseNumber = leadNumber.split('/')[0];
      path = `/clients/${encodeURIComponent(baseNumber)}?lead=${encodeURIComponent(leadNumber)}`;
    } else {
      const identifier = manualId || leadNumber || leadId || '';
      path = `/clients/${encodeURIComponent(identifier)}`;
    }
  }

  return tabId ? appendTabToPath(path, tabId) : path;
}

export function buildLeadClientAbsoluteUrl(lead: Lead, tabId?: LeadClientTabId): string | null {
  const path = buildLeadClientPath(lead, tabId);
  if (!path || typeof window === 'undefined') return path;
  return `${window.location.origin}${path}`;
}

export function getLeadHighlightMeta(lead: Lead): {
  isLegacy: boolean;
  highlightId: string | number;
  leadNumber: string;
} {
  const anyLead = lead as Record<string, unknown>;
  const isLegacy = anyLead.lead_type === 'legacy';
  const leadNumber = String(
    anyLead.display_lead_number || anyLead.lead_number || anyLead.id || '',
  );
  if (isLegacy) {
    const raw = String(anyLead.id ?? '').replace(/^legacy_/, '');
    const numeric = parseInt(raw, 10);
    return {
      isLegacy: true,
      highlightId: Number.isFinite(numeric) ? numeric : raw,
      leadNumber,
    };
  }
  return {
    isLegacy: false,
    highlightId: String(anyLead.id ?? ''),
    leadNumber,
  };
}
