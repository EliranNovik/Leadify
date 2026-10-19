/** Matching a loaded lead against the key in a /clients/... route. */

export type LeadRouteMatchClient = {
  id?: string | number | null;
  lead_number?: string | null;
  lead_type?: string | null;
};

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
    return bareId !== '' && bareId === key;
  }

  const leadNumber = String(client.lead_number ?? '').trim();
  return (leadNumber !== '' && leadNumber === key) || (id !== '' && id === key);
}
