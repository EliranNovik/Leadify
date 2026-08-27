/** Client lead URL — same rules as CalendarPage.buildClientRoute. */
export function buildCalendarClientRoute(lead: {
  lead_type?: string | null;
  lead_number?: string | null;
  manual_id?: string | number | null;
  id?: string | number | null;
} | null | undefined): string {
  if (!lead) return '/clients';

  // For new leads
  if (lead.lead_type === 'new' && lead.lead_number) {
    const isSubLead = lead.lead_number.includes('/');
    if (isSubLead) {
      // Sublead: use manual_id first if available, otherwise use base lead_number
      // For new leads subleads, prefer manual_id over lead_number for the path
      const manualId = lead.manual_id || null;
      if (manualId) {
        // Sublead with manual_id: use query parameter format like /clients/2104625?lead=L210764%2F3
        return `/clients/${encodeURIComponent(String(manualId))}?lead=${encodeURIComponent(lead.lead_number)}`;
      }
      // Sublead without manual_id: extract base from lead_number
      const baseLeadNumber = lead.lead_number.split('/')[0];
      return `/clients/${encodeURIComponent(baseLeadNumber)}?lead=${encodeURIComponent(lead.lead_number)}`;
    }
    // Regular new lead: use manual_id if available, otherwise use lead_number
    const identifier = lead.manual_id || lead.lead_number || '';
    return `/clients/${encodeURIComponent(String(identifier))}`;
  }

  // For legacy leads
  if (lead.lead_type === 'legacy' || lead.id?.toString().startsWith('legacy_')) {
    const legacyId = lead.id?.toString().replace('legacy_', '') || lead.id;
    const isSubLead = Boolean(lead.lead_number && lead.lead_number.includes('/'));

    if (isSubLead) {
      // Legacy sublead: use numeric ID in path, formatted lead_number in query
      return `/clients/${encodeURIComponent(String(legacyId))}?lead=${encodeURIComponent(String(lead.lead_number))}`;
    }
    // Legacy master lead: use numeric ID
    return `/clients/${encodeURIComponent(String(legacyId))}`;
  }

  // Fallback: check if lead_number contains '/' (sublead pattern)
  if (lead.lead_number) {
    const isSubLead = lead.lead_number.includes('/');
    if (isSubLead) {
      const baseLeadNumber = lead.lead_number.split('/')[0];
      return `/clients/${encodeURIComponent(baseLeadNumber)}?lead=${encodeURIComponent(lead.lead_number)}`;
    }
    return `/clients/${encodeURIComponent(lead.lead_number)}`;
  }

  return '/clients';
}

/** Open a stored lead share using CalendarPage routing, including older identifier-only rows. */
export function resolveLeadShareClientRoute(params: {
  leadNumber?: string | null;
  leadRouteId?: string | null;
}): string {
  const stored = String(params.leadRouteId ?? '').trim();
  if (stored.startsWith('/clients')) return stored;

  const leadNumber = String(params.leadNumber ?? '').trim() || stored;
  if (!leadNumber && !stored) return '/clients';

  const looksNew =
    leadNumber.startsWith('L') ||
    leadNumber.startsWith('C') ||
    stored.startsWith('L') ||
    stored.startsWith('C');
  const storedIsNumeric = /^\d+$/.test(stored);
  const manualId =
    stored && stored !== leadNumber && !stored.includes('/')
      ? stored
      : storedIsNumeric && looksNew
        ? stored
        : null;

  if (looksNew) {
    return buildCalendarClientRoute({
      lead_type: 'new',
      lead_number: leadNumber,
      manual_id: manualId,
    });
  }

  if (storedIsNumeric) {
    return buildCalendarClientRoute({
      lead_type: 'legacy',
      id: stored,
      lead_number: leadNumber,
    });
  }

  return buildCalendarClientRoute({
    lead_number: leadNumber || stored,
    manual_id: manualId,
    id: stored || undefined,
  });
}
