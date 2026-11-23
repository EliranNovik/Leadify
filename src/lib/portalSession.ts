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

const STAFF_SESSION_PARAM = 'staff_session';
const SESSION_TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A CRM employee opened this tab. Store their portal session and drop the token from the address bar. */
export function consumeStaffPortalSession(leadRef?: string | null): void {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  const token = params.get(STAFF_SESSION_PARAM)?.trim() || '';
  if (!token) return;
  if (SESSION_TOKEN_RE.test(token)) {
    setPortalSession(token, leadRef || getPortalLeadRef() || '');
  }
  params.delete(STAFF_SESSION_PARAM);
  const query = params.toString();
  const next = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
  window.history.replaceState(null, '', next);
}
