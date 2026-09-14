import { resolveEmployeePhotoUrl } from './employeePhotoUrl';

export const AI_AGENT_EMAIL = 'hello@lawoffice.org.il';
export const AI_AGENT_DISPLAY_NAME = 'AI Agent';
export const AI_AGENT_EMPLOYEE_ID = 177;

export function extractEmailAddresses(value?: string | null): string[] {
  return String(value || '')
    .split(/[,;]/)
    .map((part) => {
      const angle = part.match(/<([^>]+)>/);
      return (angle ? angle[1] : part).trim().toLowerCase();
    })
    .filter((email) => email.includes('@'));
}

export function isAiAgentEmail(value?: string | null): boolean {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === AI_AGENT_EMAIL) return true;
  return extractEmailAddresses(value).includes(AI_AGENT_EMAIL);
}

export function isAiAgentEmployeeId(id?: unknown): boolean {
  return id != null && Number(id) === AI_AGENT_EMPLOYEE_ID;
}

export function mailboxPartyLabel(emailOrName?: string | null, fallback?: string | null): string {
  if (isAiAgentEmail(emailOrName)) return AI_AGENT_DISPLAY_NAME;
  const text = String(emailOrName || '').trim();
  if (text) return text;
  return String(fallback || '').trim();
}

export function formatRecipientListLabels(list?: string | null): string {
  const parts = String(list || '')
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => (isAiAgentEmail(part) ? AI_AGENT_DISPLAY_NAME : part));
  return parts.join(', ');
}

export function applyAiAgentEmailNameAliases(map: Map<string, string>): Map<string, string> {
  map.set(AI_AGENT_EMAIL, AI_AGENT_DISPLAY_NAME);
  return map;
}

export function applyAiAgentPhotoAliases(
  photoMap: Map<string, string>,
  employees?: Array<{ id?: unknown; photo_url?: string | null; photo?: string | null }>,
  photoByEmployeeId?: Map<number, string>,
): Map<string, string> {
  let url =
    photoByEmployeeId?.get(AI_AGENT_EMPLOYEE_ID) ||
    photoMap.get(AI_AGENT_EMAIL) ||
    photoMap.get(AI_AGENT_DISPLAY_NAME) ||
    null;

  if (!url && employees?.length) {
    const emp = employees.find((row) => Number(row.id) === AI_AGENT_EMPLOYEE_ID);
    url = emp ? resolveEmployeePhotoUrl(emp.photo_url, emp.photo) : null;
  }

  if (url) {
    photoMap.set(AI_AGENT_DISPLAY_NAME, url);
    photoMap.set(AI_AGENT_EMAIL, url);
  }
  return photoMap;
}

export function resolveAiAgentEmployeeIdForSender(
  senderName?: string | null,
  lookedUpId?: unknown,
): number | null {
  const looked =
    lookedUpId != null && Number.isFinite(Number(lookedUpId)) ? Number(lookedUpId) : null;
  if (isAiAgentEmail(senderName) || looked === AI_AGENT_EMPLOYEE_ID) return AI_AGENT_EMPLOYEE_ID;
  return looked;
}

export function resolveAiAgentSenderLabel(
  senderName?: string | null,
  lookedUpId?: unknown,
): string {
  if (
    isAiAgentEmail(senderName) ||
    resolveAiAgentEmployeeIdForSender(senderName, lookedUpId) === AI_AGENT_EMPLOYEE_ID
  ) {
    return AI_AGENT_DISPLAY_NAME;
  }
  return String(senderName || '').trim();
}
