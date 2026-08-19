import { buildBackendApiUrl, buildBackendApiUrlObject } from './backendApiBase';

export const PRICE_OFFERS_CHANGED_EVENT = 'lead:price-offers-changed';

export type LeadPriceOfferRow = {
  id: string | number;
  body: string;
  senderName: string;
  senderEmail?: string | null;
  sentAt: string;
  total?: number | null;
  currency?: string | null;
};

export function notifyPriceOffersChanged(leadId?: string | number | null) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(PRICE_OFFERS_CHANGED_EVENT, { detail: { leadId: leadId ?? null } }),
  );
}

function leadScope(client: { id?: string | number | null; lead_type?: string | null }): {
  clientId?: string;
  legacyId?: number;
} {
  if (client?.id == null || String(client.id).trim() === '') return {};
  const isLegacy = client.lead_type === 'legacy' || String(client.id).startsWith('legacy_');
  if (isLegacy) {
    const numeric = Number.parseInt(String(client.id).replace(/^legacy_/, ''), 10);
    return Number.isFinite(numeric) ? { legacyId: numeric } : {};
  }
  return { clientId: String(client.id) };
}

async function parseJson(response: Response) {
  const text = await response.text();
  let payload: any = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  if (!response.ok || (payload && typeof payload === 'object' && payload.success === false)) {
    throw new Error(
      (payload && typeof payload === 'object' && payload.error) ||
        response.statusText ||
        'Request failed',
    );
  }
  return payload;
}

export async function fetchLeadPriceOffers(client: {
  id?: string | number | null;
  lead_type?: string | null;
}): Promise<LeadPriceOfferRow[]> {
  const scope = leadScope(client);
  if (!scope.clientId && scope.legacyId == null) return [];

  const url = buildBackendApiUrlObject('/api/price-offers');
  if (scope.clientId) url.searchParams.set('clientId', scope.clientId);
  if (scope.legacyId != null) url.searchParams.set('legacyId', String(scope.legacyId));

  const payload = await parseJson(await fetch(url.toString()));
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  return rows.map((row: Record<string, unknown>) => ({
    id: (row.id as string | number) ?? '',
    body: String(row.body || ''),
    senderName: String(row.sender_name || row.senderName || '---'),
    senderEmail: (row.sender_email as string) || null,
    sentAt: String(row.sent_at || row.sentAt || new Date().toISOString()),
    total: typeof row.total === 'number' ? row.total : row.total != null ? Number(row.total) : null,
    currency: row.currency != null ? String(row.currency) : null,
  }));
}

export async function saveLeadPriceOffer(
  client: { id?: string | number | null; lead_type?: string | null },
  offer: {
    body: string;
    senderName?: string;
    senderEmail?: string | null;
    sentAt?: string;
    total?: number | null;
    currency?: string | null;
    emailMessageId?: string | null;
  },
): Promise<{ id: number | null }> {
  const scope = leadScope(client);
  const response = await fetch(buildBackendApiUrl('/api/price-offers'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId: scope.clientId ?? null,
      legacyId: scope.legacyId ?? null,
      body: offer.body,
      senderName: offer.senderName ?? null,
      senderEmail: offer.senderEmail ?? null,
      sentAt: offer.sentAt ?? new Date().toISOString(),
      total: offer.total ?? null,
      currency: offer.currency ?? null,
      emailMessageId: offer.emailMessageId ?? null,
    }),
  });
  const payload = await parseJson(response);
  notifyPriceOffersChanged(client.id);
  const id = payload?.data?.id;
  return { id: typeof id === 'number' ? id : id != null ? Number(id) : null };
}

/** @deprecated Use fetchLeadPriceOffers */
export async function fetchLeadPriceOfferVersions(
  client: { id?: string | number | null; lead_type?: string | null },
): Promise<LeadPriceOfferRow[]> {
  return fetchLeadPriceOffers(client);
}

/** @deprecated Use saveLeadPriceOffer */
export async function appendLeadPriceOfferVersion(
  client: { id?: string | number | null; lead_type?: string | null },
  version: { body: string; senderName?: string; sentAt?: string; total?: number | null; currency?: string | null; id?: string },
): Promise<LeadPriceOfferRow[]> {
  await saveLeadPriceOffer(client, {
    body: version.body,
    senderName: version.senderName,
    sentAt: version.sentAt,
    total: version.total,
    currency: version.currency,
    emailMessageId: version.id ?? null,
  });
  return fetchLeadPriceOffers(client);
}
