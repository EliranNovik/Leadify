/** SessionStorage helpers for client lead cache (Clients page fast path). */

export function getClientStorageKey(client: any, leadNumber?: string): string | undefined {
  if (leadNumber) return leadNumber;
  const isLegacy = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');
  if (isLegacy) {
    return client?.id?.toString().replace('legacy_', '') || client?.id?.toString();
  }
  return client?.lead_number || client?.manual_id || client?.id?.toString();
}

export function buildClientRoute(manualId?: string | null, leadNumberValue?: string | null): string {
  const manualString = manualId != null ? String(manualId).trim() : '';
  const leadString = leadNumberValue != null ? String(leadNumberValue).trim() : '';

  if (manualString !== '' && leadString !== '' && manualString !== leadString) {
    const query = leadString !== '' ? `?lead=${encodeURIComponent(leadString)}` : '';
    return `/clients/${encodeURIComponent(manualString)}` + query;
  }

  if (leadString !== '') {
    return `/clients/${encodeURIComponent(leadString)}`;
  }

  if (manualString !== '') {
    return `/clients/${encodeURIComponent(manualString)}`;
  }

  return '/clients';
}

export function persistClientToSessionStorage(client: any, leadNumber?: string): void {
  try {
    const keyToUse = getClientStorageKey(client, leadNumber);
    if (!keyToUse) return;
    sessionStorage.setItem(`clientsPage_clientData_${keyToUse}`, JSON.stringify(client));
    const route = buildClientRoute((client as any)?.manual_id, client?.lead_number);
    if (route && route !== '/clients') {
      sessionStorage.setItem('clientsPage_lastLeadRoute', route);
    }
  } catch {
    /* ignore quota / private mode */
  }
}
