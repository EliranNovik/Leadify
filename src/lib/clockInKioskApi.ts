import { buildApiUrl, getFrontendBaseUrl } from './api';

export const ENTRY_KIOSK_DEFAULT_LOCATION_ID = 1;

/**
 * Phone-facing QR links must always open the public production site —
 * never localhost — even if the kiosk tablet itself is running locally.
 */
export function toPublicClockInQrUrl(qrUrl: string): string {
  try {
    const parsed = new URL(qrUrl, 'https://rainmakerqueen.org');
    const token = (parsed.searchParams.get('token') || '').trim();
    const locationId = (parsed.searchParams.get('locationId') || String(ENTRY_KIOSK_DEFAULT_LOCATION_ID)).trim();
    if (!token) return `${getFrontendBaseUrl()}/clock-in/entry`;
    const params = new URLSearchParams({
      locationId,
      token,
    });
    return `${getFrontendBaseUrl()}/clock-in/entry?${params.toString()}`;
  } catch {
    return qrUrl;
  }
}

export type ClockInKioskCurrentResponse = {
  success: boolean;
  token?: string;
  locationId?: number;
  expiresAt?: string;
  rotateInMs?: number;
  qrUrl?: string;
  error?: string;
};

export type ClockInKioskValidateResponse = {
  success: boolean;
  valid?: boolean;
  locationId?: number;
  error?: string;
};

export type ClockInKioskRecentEvent = {
  id: string;
  locationId: number;
  employeeName: string;
  photoUrl?: string | null;
  at: string;
};

export type ClockInKioskRecentEventResponse = {
  success: boolean;
  event?: ClockInKioskRecentEvent | null;
  error?: string;
};

export async function fetchClockInKioskCurrent(
  locationId: number = ENTRY_KIOSK_DEFAULT_LOCATION_ID,
): Promise<ClockInKioskCurrentResponse> {
  const url = buildApiUrl(`/api/clock-in-kiosk/current?locationId=${encodeURIComponent(String(locationId))}`);
  const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
  const body = (await res.json().catch(() => ({}))) as ClockInKioskCurrentResponse;
  if (!res.ok) {
    return {
      success: false,
      error: body.error || `Failed to load QR (${res.status})`,
    };
  }
  return body;
}

export async function validateClockInKioskToken(
  token: string,
  locationId: number,
): Promise<ClockInKioskValidateResponse> {
  const url = buildApiUrl('/api/clock-in-kiosk/validate');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ token, locationId }),
  });
  const body = (await res.json().catch(() => ({}))) as ClockInKioskValidateResponse;
  if (!res.ok) {
    return {
      success: false,
      valid: false,
      error: body.error || `QR validation failed (${res.status})`,
    };
  }
  return body;
}

export async function announceClockInKioskSuccess(
  locationId: number,
  employeeName: string,
  photoUrl?: string | null,
): Promise<{ success: boolean; error?: string }> {
  const payload = JSON.stringify({
    locationId,
    employeeName,
    photoUrl: photoUrl || null,
  });
  const urls = [buildApiUrl('/api/clock-in-kiosk/announce')];

  // In DEV, also announce to production so a local tablet that dual-polls can see it
  // when the QR still points at the production host.
  if (import.meta.env.DEV) {
    urls.push('https://leadify-crm-backend.onrender.com/api/clock-in-kiosk/announce');
  }

  let anyOk = false;
  let lastError: string | undefined;

  await Promise.all(
    urls.map(async (url) => {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: payload,
        });
        const body = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
        if (!res.ok) {
          lastError = body.error || `Announce failed (${res.status})`;
          return;
        }
        anyOk = true;
      } catch (err) {
        lastError = err instanceof Error ? err.message : 'Announce failed';
      }
    }),
  );

  if (!anyOk) {
    return { success: false, error: lastError || 'Announce failed' };
  }
  return { success: true };
}

export async function fetchClockInKioskRecentEvent(
  locationId: number = ENTRY_KIOSK_DEFAULT_LOCATION_ID,
): Promise<ClockInKioskRecentEventResponse> {
  const query = `locationId=${encodeURIComponent(String(locationId))}`;
  const urls = [buildApiUrl(`/api/clock-in-kiosk/recent-event?${query}`)];

  // Local tablet often polls localhost while the phone (scanning a prod QR)
  // announces on the production backend. Always also check production in DEV.
  if (import.meta.env.DEV) {
    urls.push(`https://leadify-crm-backend.onrender.com/api/clock-in-kiosk/recent-event?${query}`);
  }

  let latest: ClockInKioskRecentEvent | null = null;
  let anyOk = false;
  let lastError: string | undefined;

  await Promise.all(
    urls.map(async (url) => {
      try {
        const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
        const body = (await res.json().catch(() => ({}))) as ClockInKioskRecentEventResponse;
        if (!res.ok) {
          lastError = body.error || `Failed to load recent event (${res.status})`;
          return;
        }
        anyOk = true;
        const event = body.event ?? null;
        if (!event?.id) return;
        if (!latest || String(event.at) > String(latest.at)) {
          latest = event;
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : 'Recent event fetch failed';
      }
    }),
  );

  if (!anyOk) {
    return { success: false, error: lastError || 'Failed to load recent event' };
  }
  return { success: true, event: latest };
}

export function buildClockInEntryPath(locationId: number, token: string): string {
  const params = new URLSearchParams({
    locationId: String(locationId),
    token,
  });
  return `/clock-in/entry?${params.toString()}`;
}
