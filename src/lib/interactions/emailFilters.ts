/**
 * Email address matching helpers for the interactions / emails Supabase queries.
 * Kept out of InteractionsTab.tsx to shrink the component.
 */

export const normalizeEmailForFilter = (value?: string | null) =>
  value ? value.trim().toLowerCase() : '';

export const sanitizeEmailForFilter = (value: string) =>
  value.replace(/[^a-z0-9@._+!~-]/g, '');

export const collectClientEmails = (client: any): string[] => {
  const emails: string[] = [];
  const pushEmail = (val?: string | null) => {
    const normalized = normalizeEmailForFilter(val);
    if (normalized) {
      emails.push(normalized);
    }
  };

  pushEmail(client?.email);

  const extraEmails = (client as any)?.emails;
  if (Array.isArray(extraEmails)) {
    extraEmails.forEach((entry: any) => {
      if (typeof entry === 'string') {
        pushEmail(entry);
      } else if (entry && typeof entry === 'object') {
        if (typeof entry.email === 'string') {
          pushEmail(entry.email);
        }
        if (typeof entry.value === 'string') {
          pushEmail(entry.value);
        }
        if (typeof entry.address === 'string') {
          pushEmail(entry.address);
        }
      }
    });
  }

  return Array.from(new Set(emails));
};

export const buildEmailFilterClauses = (params: {
  clientId?: string | null;
  legacyId?: number | null;
  emails: string[];
}) => {
  const clauses: string[] = [];

  if (params.legacyId !== undefined && params.legacyId !== null && !Number.isNaN(params.legacyId)) {
    clauses.push(`legacy_id.eq.${params.legacyId}`);
  }

  if (params.clientId) {
    clauses.push(`client_id.eq.${params.clientId}`);
  }

  params.emails.forEach((email) => {
    const sanitized = sanitizeEmailForFilter(email);
    if (sanitized) {
      clauses.push(`sender_email.ilike.${sanitized}`);
      clauses.push(`recipient_list.ilike.%${sanitized}%`);
    }
  });

  return clauses;
};

/**
 * Same lead-scope OR filter as InteractionsTab timeline and email modal.
 * Ensures rows tied to the lead via client_id/legacy_id are included together with sender/recipient address matches
 * (e.g. meeting invites sent from a mailbox before client_id was set).
 */
export function applyLeadEmailsOrFilterToQuery(
  emailQuery: { or: (filter: string) => any; eq: (column: string, value: unknown) => any },
  options: {
    isLegacyLead: boolean;
    legacyId: number | null;
    clientId: string | number | null | undefined;
    emailFilters: string[];
  }
): any {
  const { isLegacyLead, legacyId, clientId, emailFilters } = options;

  if (isLegacyLead && legacyId !== null) {
    if (emailFilters.length > 1) {
      const emailOnlyFilters = emailFilters.filter((f) => !f.startsWith('legacy_id.eq.'));
      if (emailOnlyFilters.length > 0) {
        return emailQuery.or(`legacy_id.eq.${legacyId},${emailOnlyFilters.join(',')}`);
      }
      return emailQuery.eq('legacy_id', legacyId);
    }
    return emailQuery.eq('legacy_id', legacyId);
  }

  if (!isLegacyLead && clientId) {
    if (emailFilters.length > 1) {
      const emailOnlyFilters = emailFilters.filter((f) => !f.startsWith('client_id.eq.'));
      if (emailOnlyFilters.length > 0) {
        return emailQuery.or(`client_id.eq.${clientId},${emailOnlyFilters.join(',')}`);
      }
      return emailQuery.eq('client_id', clientId);
    }
    return emailQuery.eq('client_id', clientId);
  }

  if (emailFilters.length > 0) {
    return emailQuery.or(emailFilters.join(','));
  }

  return emailQuery;
}

/**
 * Stable id for UI + hydration: Graph message id when present, otherwise DB row id (string).
 * Meeting/calendar rows are often saved before message_id exists; timeline already uses this fallback.
 */
export function stableEmailRowId(row: { message_id?: string | null; id?: string | number | null }): string {
  const mid = row.message_id;
  if (mid != null && String(mid).trim() !== '') {
    return String(mid);
  }
  if (row.id != null && String(row.id).trim() !== '') {
    return String(row.id);
  }
  return '';
}
