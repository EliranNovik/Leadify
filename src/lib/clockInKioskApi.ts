import { buildApiUrl } from './api';

export const ENTRY_KIOSK_DEFAULT_LOCATION_ID = 1;

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
): Promise<{ success: boolean; error?: string }> {
  const url = buildApiUrl('/api/clock-in-kiosk/announce');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ locationId, employeeName }),
  });
  const body = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
  if (!res.ok) {
    return { success: false, error: body.error || `Announce failed (${res.status})` };
  }
  return { success: true };
}

export async function fetchClockInKioskRecentEvent(
  locationId: number = ENTRY_KIOSK_DEFAULT_LOCATION_ID,
): Promise<ClockInKioskRecentEventResponse> {
  const url = buildApiUrl(
    `/api/clock-in-kiosk/recent-event?locationId=${encodeURIComponent(String(locationId))}`,
  );
  const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
  const body = (await res.json().catch(() => ({}))) as ClockInKioskRecentEventResponse;
  if (!res.ok) {
    return {
      success: false,
      error: body.error || `Failed to load recent event (${res.status})`,
    };
  }
  return body;
}

export function buildClockInEntryPath(locationId: number, token: string): string {
  const params = new URLSearchParams({
    locationId: String(locationId),
    token,
  });
  return `/clock-in/entry?${params.toString()}`;
}
