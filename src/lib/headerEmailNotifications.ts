import { supabase } from './supabase';

/** Shared blocked senders for Header email badge / office-inbox polls. */
export const HEADER_BLOCKED_SENDER_EMAILS = new Set([
  'wordpress@german-and-austrian-citizenship.lawoffice.org.il',
  'wordpress@insolvency-law.com',
  'wordpress@citizenship-for-children.usa-immigration.lawyer',
  'lawoffic@israel160.jetserver.net',
  'list@wordfence.com',
  'wordpress@usa-immigration.lawyer',
  'wordpress@heritage-based-european-citizenship.lawoffice.org.il',
  'wordpress@heritage-based-european-citizenship-heb.lawoffice.org.il',
  'no-reply@lawzana.com',
  'support@lawfirms1.com',
  'no-reply@zoom.us',
  'info@israel-properties.com',
  'notifications@invoice4u.co.il',
  'isetbeforeyou@yahoo.com',
  'no-reply@support.microsoft.com',
  'ivy@pipe.hnssd.com',
  'no-reply@mail.instagram.com',
  'no_reply@email.apple.com',
  'noreplay@maskyoo.co.il',
  'email@german-and-austrian-citizenship.lawoffice.org.il',
  'noreply@mobilepunch.com',
  'notification@facebookmail.com',
  'news@events.imhbusiness.com',
  'artalegal@googlegroups.com',
  'alljobs@alljob.co.il',
  'info@crocoblock.com',
]);

export const HEADER_BLOCKED_EMAIL_DOMAINS = ['lawoffice.org.il'];

export function isHeaderEmailBlocked(email: string): boolean {
  const normalizedEmail = email.toLowerCase().trim();
  if (!normalizedEmail) return true;

  if (HEADER_BLOCKED_SENDER_EMAILS.has(normalizedEmail)) {
    return true;
  }

  const emailDomain = normalizedEmail.split('@')[1];
  if (
    emailDomain &&
    HEADER_BLOCKED_EMAIL_DOMAINS.some(
      (domain) => emailDomain === domain || emailDomain.endsWith(`.${domain}`),
    )
  ) {
    return true;
  }

  return false;
}

export type HeaderUnreadEmailRow = {
  id: number | string;
  client_id: string | null;
  legacy_id: number | null;
  sender_email: string | null;
};

export type HeaderOfficeInboxEmailRow = {
  id: number | string;
  sender_name: string | null;
  sender_email: string | null;
  subject: string | null;
  body_preview: string | null;
  sent_at: string;
  recipient_list: string | null;
};

type RpcError = { code?: string; message?: string } | null;

const CIRCUIT_COOLDOWN_MS = 5 * 60 * 1000;
const BADGE_CIRCUIT_KEY = 'headerEmailBadgeCircuitUntil';
const OFFICE_CIRCUIT_KEY = 'headerEmailOfficeCircuitUntil';

let badgeInflight: Promise<{ data: HeaderUnreadEmailRow[]; error: RpcError }> | null = null;
let officeInflight: Promise<{ data: HeaderOfficeInboxEmailRow[]; error: RpcError }> | null = null;
let lastBadgeTimeoutLogAt = 0;
let lastOfficeTimeoutLogAt = 0;

function readCircuit(key: string): number {
  try {
    const raw = sessionStorage.getItem(key);
    const n = raw ? parseInt(raw, 10) : 0;
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function openCircuit(kind: 'badge' | 'office') {
  const until = Date.now() + CIRCUIT_COOLDOWN_MS;
  const key = kind === 'badge' ? BADGE_CIRCUIT_KEY : OFFICE_CIRCUIT_KEY;
  try {
    sessionStorage.setItem(key, String(until));
  } catch {
    /* ignore */
  }
}

function clearCircuit(kind: 'badge' | 'office') {
  const key = kind === 'badge' ? BADGE_CIRCUIT_KEY : OFFICE_CIRCUIT_KEY;
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function isTimeoutError(error: RpcError): boolean {
  if (!error) return false;
  const code = String(error.code || '');
  const message = String(error.message || '').toLowerCase();
  return code === '57014' || message.includes('statement timeout') || message.includes('canceling statement');
}

function isMissingRpcError(error: RpcError): boolean {
  if (!error) return false;
  const code = String(error.code || '');
  const message = String(error.message || '').toLowerCase();
  return (
    code === 'PGRST202' ||
    code === '42883' ||
    message.includes('could not find the function') ||
    message.includes('does not exist')
  );
}

function asRowArray<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function logTimeoutOnce(kind: 'badge' | 'office', error: RpcError) {
  const now = Date.now();
  if (kind === 'badge') {
    if (now - lastBadgeTimeoutLogAt < CIRCUIT_COOLDOWN_MS) return;
    lastBadgeTimeoutLogAt = now;
    console.warn('Email unread badge temporarily disabled (DB timeout). Retrying in ~5 min.', error);
    return;
  }
  if (now - lastOfficeTimeoutLogAt < CIRCUIT_COOLDOWN_MS) return;
  lastOfficeTimeoutLogAt = now;
  console.warn('Office inbox email poll temporarily disabled (DB timeout). Retrying in ~5 min.', error);
}

/** Prefer RPC (sent_at-first). Single-flight + sessionStorage circuit-breaker. */
export async function fetchHeaderUnreadEmailsForBadge(options?: {
  days?: number;
  limit?: number;
}): Promise<{ data: HeaderUnreadEmailRow[]; error: RpcError }> {
  if (Date.now() < readCircuit(BADGE_CIRCUIT_KEY)) {
    return { data: [], error: null };
  }

  if (badgeInflight) return badgeInflight;

  const days = options?.days ?? 2;
  const limit = options?.limit ?? 80;

  badgeInflight = (async () => {
    try {
      const { data: rpcData, error: rpcError } = await supabase.rpc('header_unread_emails_for_badge', {
        p_days: days,
        p_limit: limit,
      });

      if (!rpcError) {
        clearCircuit('badge');
        return { data: asRowArray<HeaderUnreadEmailRow>(rpcData), error: null };
      }

      if (isTimeoutError(rpcError)) {
        openCircuit('badge');
        logTimeoutOnce('badge', rpcError);
        return { data: [], error: null };
      }

      if (!isMissingRpcError(rpcError)) {
        return { data: [], error: rpcError };
      }

      // RPC missing: sent_at-first direct query (no recipient ilike)
      const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from('emails')
        .select('id, client_id, legacy_id, sender_email')
        .eq('direction', 'incoming')
        .eq('is_read', false)
        .gte('sent_at', sinceIso)
        .order('sent_at', { ascending: false })
        .limit(limit);

      if (isTimeoutError(error)) {
        openCircuit('badge');
        logTimeoutOnce('badge', error);
        return { data: [], error: null };
      }

      return { data: (data as HeaderUnreadEmailRow[]) || [], error };
    } finally {
      badgeInflight = null;
    }
  })();

  return badgeInflight;
}

/** Prefer RPC; single-flight + circuit-breaker. No heavy fallback on timeout. */
export async function fetchHeaderOfficeInboxUnreadEmails(options?: {
  days?: number;
  limit?: number;
  scanLimit?: number;
}): Promise<{ data: HeaderOfficeInboxEmailRow[]; error: RpcError }> {
  if (Date.now() < readCircuit(OFFICE_CIRCUIT_KEY)) {
    return { data: [], error: null };
  }

  if (officeInflight) return officeInflight;

  const days = options?.days ?? 2;
  const limit = options?.limit ?? 40;

  officeInflight = (async () => {
    try {
      const { data: rpcData, error: rpcError } = await supabase.rpc('header_office_inbox_unread_emails', {
        p_days: days,
        p_limit: limit,
        p_scan_limit: options?.scanLimit ?? 400,
      });

      if (!rpcError) {
        clearCircuit('office');
        return { data: asRowArray<HeaderOfficeInboxEmailRow>(rpcData), error: null };
      }

      if (isTimeoutError(rpcError)) {
        openCircuit('office');
        logTimeoutOnce('office', rpcError);
        return { data: [], error: null };
      }

      if (!isMissingRpcError(rpcError)) {
        return { data: [], error: rpcError };
      }

      const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from('emails')
        .select('id, sender_name, sender_email, subject, body_preview, sent_at, recipient_list')
        .eq('direction', 'incoming')
        .eq('is_read', false)
        .gte('sent_at', sinceIso)
        .order('sent_at', { ascending: false })
        .limit(Math.min(limit * 8, 400));

      if (isTimeoutError(error)) {
        openCircuit('office');
        logTimeoutOnce('office', error);
        return { data: [], error: null };
      }

      if (error) {
        return { data: [], error };
      }

      const officeInbox = ((data as HeaderOfficeInboxEmailRow[]) || []).filter((email) =>
        (email.recipient_list || '').toLowerCase().includes('office@lawoffice.org.il'),
      );

      return { data: officeInbox.slice(0, limit), error: null };
    } finally {
      officeInflight = null;
    }
  })();

  return officeInflight;
}
