/** Matching a loaded lead against the key in a /clients/... route. */

export type LeadRouteMatchClient = {
  id?: string | number | null;
  lead_number?: string | null;
  lead_type?: string | null;
  manual_id?: string | number | null;
};

/**
 * The lead a /clients URL is asking for.
 *
 * `/clients/210456/2` is a legacy sublead (master 210456, second row), not lead 210456.
 * A bare path segment stays that segment, so `/clients/210456` is still the master
 * and `/clients/{row id}?lead=210456/2` stays the row id in the path.
 */
export function clientRouteLeadKey(parts: {
  leadNumber?: string | null;
  subleadSuffix?: string | null;
  requestedLeadNumber?: string | null;
  pathLeadNumber?: string | null;
}): string {
  const lead = String(parts.leadNumber ?? '').trim();
  const suffix = String(parts.subleadSuffix ?? '').trim();
  const requested = String(parts.requestedLeadNumber ?? '').trim();
  const fromPath = String(parts.pathLeadNumber ?? '').trim();

  if (lead && !lead.includes('/') && /^\d+$/.test(suffix)) {
    const index = parseInt(suffix, 10);
    if (index >= 2) return `${lead}/${index}`;
  }
  if (lead) return lead;
  if (requested) return requested;
  return fromPath;
}

/**
 * True when the lead already in hand is the one the route is asking for.
 *
 * Legacy rows are addressed by their bare numeric id (the route drops the `legacy_` prefix the
 * client object carries), new rows by their lead number or their uuid. Anything we cannot line up
 * is a miss, so the caller fetches rather than showing the wrong lead.
 */
export function clientMatchesLeadRouteKey(
  client: LeadRouteMatchClient | null | undefined,
  routeKey: string | number | null | undefined,
): boolean {
  const key = String(routeKey ?? '').trim();
  if (!client || !key) return false;

  const id = String(client.id ?? '').trim();
  const isLegacy = client.lead_type === 'legacy' || id.startsWith('legacy_');

  if (isLegacy) {
    const bareId = id.replace(/^legacy_/, '');
    if (bareId !== '' && bareId === key) return true;
    // Sublead routes use master/suffix. That number is the display lead_number, not the row id.
    const leadNumber = String(client.lead_number ?? '').trim();
    return leadNumber !== '' && leadNumber === key;
  }

  const leadNumber = String(client.lead_number ?? '').trim();
  const manualId = String(client.manual_id ?? '').trim();
  return (
    (leadNumber !== '' && leadNumber === key) ||
    (id !== '' && id === key) ||
    (manualId !== '' && manualId === key)
  );
}
