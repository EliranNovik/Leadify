import { buildBackendApiUrl } from './backendApiBase';

export const KIOSK_DEVICE_TOKEN_KEY = 'kiosk_device_token';

export type KioskStateResponse = {
  success: boolean;
  mode: 'attendance' | 'document' | 'locked';
  sessionId?: string;
  resourceType?: 'digital_contract' | 'poa' | 'payment';
  expiresAt?: string;
  device?: { id: string; name: string; slug: string };
  error?: string;
};

export type KioskSessionAccess = {
  sessionId: string;
  resourceType: 'digital_contract' | 'poa' | 'payment';
  resourceId: string;
  resourceToken: string;
  allowedActions: string[];
  expiresAt: string;
};

export function getStoredKioskDeviceToken(): string | null {
  try {
    return localStorage.getItem(KIOSK_DEVICE_TOKEN_KEY);
  } catch {
    return null;
  }
}

/** Require consecutive auth failures before unpairing (avoids blip → pairing screen). */
let consecutiveAuthFailures = 0;
const AUTH_FAILURES_BEFORE_CLEAR = 3;

function noteAuthFailure(clearImmediately = false) {
  consecutiveAuthFailures += 1;
  if (clearImmediately || consecutiveAuthFailures >= AUTH_FAILURES_BEFORE_CLEAR) {
    clearStoredKioskDeviceToken();
    consecutiveAuthFailures = 0;
  }
}

function noteAuthSuccess() {
  consecutiveAuthFailures = 0;
}

export function setStoredKioskDeviceToken(token: string) {
  localStorage.setItem(KIOSK_DEVICE_TOKEN_KEY, token);
  consecutiveAuthFailures = 0;
}

export function clearStoredKioskDeviceToken() {
  localStorage.removeItem(KIOSK_DEVICE_TOKEN_KEY);
}

function deviceHeaders(): HeadersInit {
  const token = getStoredKioskDeviceToken();
  return token
    ? {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Kiosk-Device-Token': token,
      }
    : { Accept: 'application/json', 'Content-Type': 'application/json' };
}

export async function requestKioskPairingCode(
  locationId = 1,
): Promise<{ success: boolean; code?: string; expiresAt?: string; error?: string }> {
  const res = await fetch(buildBackendApiUrl('/api/kiosk/pairing-codes'), {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ locationId }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { success: false, error: body.error || `Failed (${res.status})` };
  return body;
}

export async function claimKioskPairingCode(
  code: string,
): Promise<{
  success: boolean;
  status?: 'pending' | 'paired' | 'expired' | 'claimed';
  deviceToken?: string;
  error?: string;
}> {
  const res = await fetch(buildBackendApiUrl('/api/kiosk/pairing-codes/claim'), {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { success: false, error: body.error || `Failed (${res.status})` };
  return body;
}

export async function fetchKioskState(): Promise<KioskStateResponse> {
  const res = await fetch(buildBackendApiUrl('/api/kiosk/state'), {
    method: 'GET',
    headers: deviceHeaders(),
  });
  const body = (await res.json().catch(() => ({}))) as KioskStateResponse;
  if (!res.ok) {
    if (res.status === 401) noteAuthFailure(true);
    return { success: false, mode: 'locked', error: body.error || `Failed (${res.status})` };
  }
  noteAuthSuccess();
  return body;
}

export async function kioskHeartbeat(): Promise<KioskStateResponse> {
  try {
    const res = await fetch(buildBackendApiUrl('/api/kiosk/heartbeat'), {
      method: 'POST',
      headers: deviceHeaders(),
      body: '{}',
    });
    const body = (await res.json().catch(() => ({}))) as KioskStateResponse;
    if (!res.ok) {
      // Heartbeat 401s are often transient under load — don't unpair on a single failure.
      if (res.status === 401) noteAuthFailure(false);
      return { success: false, mode: 'locked', error: body.error || `Failed (${res.status})` };
    }
    noteAuthSuccess();
    return body;
  } catch (err) {
    console.warn('[kioskHeartbeat] network error:', err);
    return { success: false, mode: 'locked', error: 'Network error' };
  }
}

export async function fetchKioskSessionAccess(
  sessionId: string,
): Promise<{ success: boolean; access?: KioskSessionAccess; error?: string }> {
  const res = await fetch(buildBackendApiUrl(`/api/kiosk/display-sessions/${sessionId}/access`), {
    method: 'GET',
    headers: deviceHeaders(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { success: false, error: body.error || `Failed (${res.status})` };
  return body;
}

export async function completeKioskSession(sessionId: string) {
  const res = await fetch(buildBackendApiUrl(`/api/kiosk/display-sessions/${sessionId}/complete`), {
    method: 'POST',
    headers: deviceHeaders(),
    body: '{}',
  });
  return res.json().catch(() => ({ success: false }));
}

export async function cancelKioskSessionFromDevice(sessionId: string) {
  const res = await fetch(buildBackendApiUrl(`/api/kiosk/display-sessions/${sessionId}/cancel`), {
    method: 'POST',
    headers: deviceHeaders(),
    body: '{}',
  });
  return res.json().catch(() => ({ success: false }));
}
