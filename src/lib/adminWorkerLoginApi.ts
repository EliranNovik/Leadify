import { buildBackendApiUrl } from './backendApiBase';
import { supabase } from './supabase';

export type WorkerLoginTokenResponse = {
  success: boolean;
  email: string;
  token_hash: string;
  auth_id: string;
  user_id: string;
  employee_id: number | null;
  switch_grant?: string;
  error?: string;
};

async function parseJsonResponse(response: Response): Promise<WorkerLoginTokenResponse> {
  const text = await response.text();
  if (!text.trim()) {
    throw new Error(
      response.ok
        ? 'Worker sign-in service returned an empty response.'
        : `Worker sign-in service unavailable (${response.status}). Ensure the backend or admin-impersonate-worker edge function is deployed.`,
    );
  }

  try {
    return JSON.parse(text) as WorkerLoginTokenResponse;
  } catch {
    throw new Error('Worker sign-in service returned invalid JSON.');
  }
}

async function requestWorkerLoginTokenViaEdgeFunction(
  targetUserId: string,
): Promise<WorkerLoginTokenResponse> {
  const { data, error } = await supabase.functions.invoke('admin-impersonate-worker', {
    body: { targetUserId },
  });

  if (error) {
    throw new Error(error.message || 'Edge function call failed');
  }

  const payload = data as WorkerLoginTokenResponse | null;
  if (!payload?.success) {
    throw new Error(payload?.error || 'Failed to prepare worker sign-in');
  }

  return payload;
}

async function requestWorkerLoginTokenViaBackend(
  accessToken: string,
  targetUserId: string,
): Promise<WorkerLoginTokenResponse> {
  const response = await fetch(buildBackendApiUrl('/api/admin/impersonate-worker'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ targetUserId }),
  });

  const payload = await parseJsonResponse(response);
  if (!response.ok || !payload.success) {
    throw new Error(payload.error || `Failed to prepare worker sign-in (${response.status})`);
  }
  return payload;
}

export async function requestWorkerLoginToken(
  accessToken: string,
  targetUserId: string,
): Promise<WorkerLoginTokenResponse> {
  try {
    return await requestWorkerLoginTokenViaEdgeFunction(targetUserId);
  } catch (edgeError) {
    console.warn('Admin impersonation edge function failed, trying backend:', edgeError);
    return requestWorkerLoginTokenViaBackend(accessToken, targetUserId);
  }
}

export async function requestWorkerSwitchToken(
  adminAuthUserId: string,
  switchGrant: string | null,
  sessionAuthUserId: string,
  targetUserId: string,
): Promise<WorkerLoginTokenResponse> {
  const { data, error } = await supabase.functions.invoke('admin-switch-worker', {
    body: {
      adminAuthUserId,
      switchGrant: switchGrant || undefined,
      sessionAuthUserId,
      targetUserId,
    },
  });

  if (error) {
    throw new Error(error.message || 'Failed to switch worker');
  }

  const payload = data as WorkerLoginTokenResponse | null;
  if (!payload?.success) {
    throw new Error(payload?.error || 'Failed to switch worker');
  }

  return payload;
}

export async function signInWithWorkerLoginToken(
  email: string,
  tokenHash: string,
): Promise<{ authUserId: string }> {
  const attempts = [
    () => supabase.auth.verifyOtp({ email, token_hash: tokenHash, type: 'email' as const }),
    () => supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'email' as const }),
    () => supabase.auth.verifyOtp({ email, token: tokenHash, type: 'magiclink' as const }),
    () => supabase.auth.verifyOtp({ email, token: tokenHash, type: 'email' as const }),
  ];

  let lastError: Error | null = null;
  for (const attempt of attempts) {
    const { data, error } = await attempt();
    if (!error && data.session?.user?.id) {
      return { authUserId: data.session.user.id };
    }
    lastError = error ?? lastError;
  }

  throw lastError || new Error('Worker sign-in failed');
}
