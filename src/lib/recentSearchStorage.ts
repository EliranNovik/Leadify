/**
 * Storage for recently viewed leads (Header search preview). Optional recent-search helpers remain for other use.
 * Uses sessionStorage - persists for the browser session only.
 */

const RECENT_SEARCHES_KEY = 'header_recent_searches_v1';
const RECENT_LEADS_KEY = 'header_recent_leads_v1';
const MAX_RECENT = 5;

export interface RecentLead {
  id: string;       // route id (lead_number or legacy id)
  name: string;
  lead_number: string;
}

export function getRecentSearches(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = sessionStorage.getItem(RECENT_SEARCHES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

export function addRecentSearch(query: string): void {
  if (typeof window === 'undefined' || !query?.trim()) return;
  const trimmed = query.trim();
  const current = getRecentSearches().filter(q => q !== trimmed);
  current.unshift(trimmed);
  sessionStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(current.slice(0, MAX_RECENT)));
}

export function getRecentLeads(): RecentLead[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = sessionStorage.getItem(RECENT_LEADS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

export function addRecentLead(lead: RecentLead): void {
  if (typeof window === 'undefined' || !lead?.id) return;
  const current = getRecentLeads().filter(l => l.id !== lead.id);
  current.unshift(lead);
  sessionStorage.setItem(RECENT_LEADS_KEY, JSON.stringify(current.slice(0, MAX_RECENT)));
}
