import { buildBackendApiUrl } from './backendApiBase';
import { supabase } from './supabase';

export type KioskDevice = {
  id: string;
  slug: string;
  name: string;
  location_id: number;
  status: 'active' | 'revoked';
  last_seen_at: string | null;
  paired_at: string | null;
  activeSession?: {
    id: string;
    resourceType: string;
    status: string;
    expiresAt: string;
  } | null;
};

export type KioskDisplaySession = {
  id: string;
  kiosk_device_id: string;
  resource_type: 'digital_contract' | 'poa' | 'payment';
  resource_id: string;
  status: string;
  allowed_actions: string[];
  expires_at: string;
  created_at: string;
};

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('You must be signed in');
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

export async function pairKioskDevice(input: {
  code: string;
  name: string;
  locationId?: number;
  slug?: string;
}): Promise<{ success: boolean; device?: KioskDevice; deviceToken?: string; error?: string }> {
  const res = await fetch(buildBackendApiUrl('/api/kiosk/pair'), {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(input),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { success: false, error: body.error || `Failed (${res.status})` };
  return body;
}

export async function listKioskDevices(
  locationId?: number,
): Promise<{ success: boolean; devices?: KioskDevice[]; error?: string }> {
  const qs = locationId != null ? `?locationId=${encodeURIComponent(String(locationId))}` : '';
  const res = await fetch(buildBackendApiUrl(`/api/kiosk/devices${qs}`), {
    method: 'GET',
    headers: await authHeaders(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { success: false, error: body.error || `Failed (${res.status})` };
  return body;
}

export async function updateKioskDevice(
  id: string,
  patch: { name?: string; status?: 'active' | 'revoked' },
) {
  const res = await fetch(buildBackendApiUrl(`/api/kiosk/devices/${id}`), {
    method: 'PATCH',
    headers: await authHeaders(),
    body: JSON.stringify(patch),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { success: false, error: body.error || `Failed (${res.status})` };
  return body;
}

export async function createKioskDisplaySession(input: {
  kioskDeviceId: string;
  resourceType: 'digital_contract' | 'poa' | 'payment';
  resourceId?: string;
  resourceToken?: string;
}): Promise<{ success: boolean; session?: KioskDisplaySession; error?: string }> {
  const res = await fetch(buildBackendApiUrl('/api/kiosk/display-sessions'), {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(input),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { success: false, error: body.error || `Failed (${res.status})` };
  return body;
}

export async function cancelKioskDisplaySession(sessionId: string) {
  const res = await fetch(buildBackendApiUrl(`/api/kiosk/display-sessions/${sessionId}`), {
    method: 'DELETE',
    headers: await authHeaders(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { success: false, error: body.error || `Failed (${res.status})` };
  return body;
}
