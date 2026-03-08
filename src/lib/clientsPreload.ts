/**
 * Preload client data before navigating to the Clients page.
 * Used with useBlocker so we stay on the current screen until data is ready (no white screen).
 */

import { fetchLeadById, fetchLatestLead, type CombinedLead } from './legacyLeadsApi';

const PERSISTED_KEY_PREFIX = 'clientsPage_clientData_';

function getLeadIdFromPathname(pathname: string): string | null {
  const match = pathname.match(/^\/clients\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Try to get client data for the given pathname so we can show it as soon as we navigate.
 * - For /clients: resolve last route from sessionStorage or fetch latest lead.
 * - For /clients/:id: try persisted cache, then fetchLeadById when id is numeric or legacy-N.
 * Returns the lead if we got it quickly; null otherwise (navigation will proceed and Clients will load).
 */
export async function preloadClientForRoute(pathname: string): Promise<CombinedLead | null> {
  const path = pathname.replace(/\/$/, '');
  if (path === '/clients' || path === '/clients/') {
    const lastRoute = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('clientsPage_lastLeadRoute') : null;
    if (lastRoute && lastRoute !== '/clients' && lastRoute.startsWith('/clients/')) {
      const id = getLeadIdFromPathname(lastRoute);
      if (id) return preloadClientForRoute(lastRoute);
    }
    return fetchLatestLead();
  }

  const leadId = getLeadIdFromPathname(pathname);
  if (!leadId) return null;

  try {
    const key = `${PERSISTED_KEY_PREFIX}${leadId}`;
    const raw = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(key) : null;
    if (raw) {
      const parsed = JSON.parse(raw) as CombinedLead;
      return parsed;
    }
  } catch {
    // ignore parse errors
  }

  const isLegacySegment = /^legacy-\d+$/i.test(leadId);
  const numericId = isLegacySegment ? parseInt(leadId.replace(/^legacy-/i, ''), 10) : leadId;
  if (isLegacySegment && !Number.isNaN(numericId)) {
    return fetchLeadById(numericId, 'legacy');
  }
  if (/^\d+$/.test(leadId)) {
    return fetchLeadById(leadId);
  }
  return fetchLeadById(leadId);
}
