const SESSION_KEY = 'client_portal_session_token';
const LEAD_REF_KEY = 'client_portal_lead_ref';

export function getPortalSessionToken(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

export function getPortalLeadRef(): string | null {
  try {
    return sessionStorage.getItem(LEAD_REF_KEY);
  } catch {
    return null;
  }
}

export function setPortalSession(sessionToken: string, leadRef: string): void {
  sessionStorage.setItem(SESSION_KEY, sessionToken);
  sessionStorage.setItem(LEAD_REF_KEY, leadRef);
}

export function clearPortalSession(): void {
  sessionStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(LEAD_REF_KEY);
}
