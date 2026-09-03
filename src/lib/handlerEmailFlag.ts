import type { SupabaseClient } from '@supabase/supabase-js';
import { leadRoutePath } from './leadNavigation';
import {
  FLAG_TYPE_HANDLER_EMAIL,
  conversationFlagKey,
  interactionRowToConversationFlag,
  type ConversationChannel,
  type ConversationFlagTarget,
} from './userContentFlags';

export { FLAG_TYPE_HANDLER_EMAIL };

const EMAIL_FLAG_CHANNELS: ConversationChannel[] = ['email', 'manual', 'legacy_interaction'];

export type HandlerEmailFlagTarget = ConversationFlagTarget;

type FlagRow = {
  conversation_channel: string;
  external_id: string;
  created_at: string;
  new_lead_id: string | null;
  legacy_lead_id: number | null;
};

function isEmailFlagChannel(channel: string): channel is ConversationChannel {
  return (EMAIL_FLAG_CHANNELS as string[]).includes(channel);
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * For each handler pipeline row, the newest email/manual interaction flagged with type 5.
 * Badge is coloured only when this map has an entry for the row.
 */
export async function fetchHandlerEmailFlag5Targets(
  supabase: SupabaseClient,
  rows: Array<{ id: string; isNewLead: boolean }>,
): Promise<Map<string, HandlerEmailFlagTarget>> {
  const result = new Map<string, HandlerEmailFlagTarget>();
  if (rows.length === 0) return result;

  const newIdToRowId = new Map<string, string>();
  const legacyIdToRowId = new Map<number, string>();
  for (const row of rows) {
    if (row.isNewLead) {
      newIdToRowId.set(row.id, row.id);
    } else {
      const n = Number(String(row.id).replace(/^legacy_/, ''));
      if (Number.isFinite(n)) legacyIdToRowId.set(n, row.id);
    }
  }

  const newest = new Map<string, { target: HandlerEmailFlagTarget; createdAt: string }>();
  const consider = (
    rowId: string,
    channel: ConversationChannel,
    externalId: string,
    createdAt: string,
  ) => {
    const ext = String(externalId || '').trim();
    if (!rowId || !ext) return;
    const prev = newest.get(rowId);
    if (!prev || createdAt > prev.createdAt) {
      newest.set(rowId, {
        target: { conversation_channel: channel, external_id: ext },
        createdAt,
      });
    }
  };

  const flags: FlagRow[] = [];
  const PAGE = 1000;

  const pullPages = async (apply: (q: any) => any) => {
    let from = 0;
    for (;;) {
      const { data, error } = await apply(
        supabase
          .from('user_content_flags')
          .select('conversation_channel, external_id, created_at, new_lead_id, legacy_lead_id')
          .eq('flag_kind', 'conversation')
          .eq('flag_type', FLAG_TYPE_HANDLER_EMAIL)
          .in('conversation_channel', EMAIL_FLAG_CHANNELS)
          .range(from, from + PAGE - 1),
      );
      if (error) {
        console.warn('handlerEmailFlag: load flags failed', error);
        break;
      }
      const batch = (data || []) as FlagRow[];
      flags.push(...batch);
      if (batch.length < PAGE) break;
      from += PAGE;
    }
  };

  for (const chunk of chunkArray([...newIdToRowId.keys()], 80)) {
    await pullPages((q) => q.in('new_lead_id', chunk));
  }
  for (const chunk of chunkArray([...legacyIdToRowId.keys()], 80)) {
    await pullPages((q) => q.in('legacy_lead_id', chunk));
  }
  await pullPages((q) => q.is('new_lead_id', null).is('legacy_lead_id', null));

  const unmatched: FlagRow[] = [];
  for (const flag of flags) {
    if (!isEmailFlagChannel(flag.conversation_channel)) continue;
    const ext = String(flag.external_id || '').trim();
    if (!ext) continue;
    let matched = false;
    if (flag.new_lead_id) {
      const rowId = newIdToRowId.get(String(flag.new_lead_id));
      if (rowId) {
        consider(rowId, flag.conversation_channel, ext, flag.created_at);
        matched = true;
      }
    }
    if (flag.legacy_lead_id != null) {
      const rowId = legacyIdToRowId.get(Number(flag.legacy_lead_id));
      if (rowId) {
        consider(rowId, flag.conversation_channel, ext, flag.created_at);
        matched = true;
      }
    }
    if (!matched) unmatched.push(flag);
  }

  if (unmatched.length > 0) {
    const emailFlags = unmatched.filter((f) => f.conversation_channel === 'email');
    const manualFlags = unmatched.filter((f) => f.conversation_channel === 'manual');
    const legacyFlags = unmatched.filter((f) => f.conversation_channel === 'legacy_interaction');

    const applyEmailHits = (flag: FlagRow, hits: Array<{ client_id?: string | null; legacy_id?: number | null }>) => {
      for (const hit of hits) {
        if (hit.client_id) {
          const rowId = newIdToRowId.get(String(hit.client_id));
          if (rowId) consider(rowId, 'email', flag.external_id, flag.created_at);
        }
        if (hit.legacy_id != null) {
          const rowId = legacyIdToRowId.get(Number(hit.legacy_id));
          if (rowId) consider(rowId, 'email', flag.external_id, flag.created_at);
        }
      }
    };

    for (const flag of emailFlags) {
      const ext = String(flag.external_id).trim();
      const { data: byMessage, error: msgErr } = await supabase
        .from('emails')
        .select('client_id, legacy_id')
        .eq('message_id', ext)
        .limit(5);
      if (msgErr) console.warn('handlerEmailFlag: email message_id resolve failed', msgErr);
      applyEmailHits(flag, byMessage || []);

      if (/^\d+$/.test(ext)) {
        const { data: byId, error: idErr } = await supabase
          .from('emails')
          .select('client_id, legacy_id')
          .eq('id', ext)
          .limit(5);
        if (idErr) console.warn('handlerEmailFlag: email id resolve failed', idErr);
        applyEmailHits(flag, byId || []);
      }
    }

    const manualIds = [...new Set(manualFlags.map((f) => String(f.external_id).trim()).filter(Boolean))];
    for (const chunk of chunkArray(manualIds, 200)) {
      const { data, error } = await supabase
        .from('lead_manual_interactions')
        .select('lead_id, id')
        .in('id', chunk);
      if (error) {
        console.warn('handlerEmailFlag: manual resolve failed', error);
        continue;
      }
      const byId = new Map((data || []).map((row: { lead_id: string; id: string }) => [String(row.id), String(row.lead_id)]));
      for (const flag of manualFlags) {
        const leadId = byId.get(String(flag.external_id).trim());
        if (!leadId) continue;
        const rowId = newIdToRowId.get(leadId);
        if (rowId) consider(rowId, 'manual', flag.external_id, flag.created_at);
      }
    }

    const legacyIds = [
      ...new Set(
        legacyFlags
          .map((f) => Number(String(f.external_id).replace(/^legacy_/, '')))
          .filter((n) => Number.isFinite(n)),
      ),
    ];
    for (const chunk of chunkArray(legacyIds, 200)) {
      const { data, error } = await supabase
        .from('leads_leadinteractions')
        .select('lead_id, id, kind')
        .in('id', chunk);
      if (error) {
        console.warn('handlerEmailFlag: legacy interaction resolve failed', error);
        continue;
      }
      const byId = new Map(
        (data || []).map((row: { lead_id: number; id: number; kind?: string | null }) => [
          Number(row.id),
          { leadId: Number(row.lead_id), kind: String(row.kind || '') },
        ]),
      );
      for (const flag of legacyFlags) {
        const id = Number(String(flag.external_id).replace(/^legacy_/, ''));
        const hit = byId.get(id);
        if (!hit) continue;
        if (hit.kind && hit.kind !== 'e' && hit.kind !== 'email' && hit.kind !== 'email_manual') continue;
        const rowId = legacyIdToRowId.get(hit.leadId);
        if (rowId) consider(rowId, 'legacy_interaction', flag.external_id, flag.created_at);
      }
    }
  }

  newest.forEach((value, rowId) => {
    result.set(rowId, value.target);
  });
  return result;
}

export const HANDLER_EMAIL_COMPOSE_STORAGE_KEY = 'openEmailCompose';
export const HANDLER_SCROLL_FLAGGED_EMAIL_KEY = 'rmqScrollToFlaggedEmail';

export function markScrollToFlaggedEmail(flag: HandlerEmailFlagTarget): void {
  try {
    sessionStorage.setItem(HANDLER_SCROLL_FLAGGED_EMAIL_KEY, JSON.stringify(flag));
  } catch {
    /* ignore */
  }
}

export function consumeScrollToFlaggedEmail(): HandlerEmailFlagTarget | null {
  try {
    const raw = sessionStorage.getItem(HANDLER_SCROLL_FLAGGED_EMAIL_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(HANDLER_SCROLL_FLAGGED_EMAIL_KEY);
    const parsed = JSON.parse(raw) as HandlerEmailFlagTarget;
    if (!parsed?.conversation_channel || !parsed?.external_id) return null;
    return parsed;
  } catch {
    return null;
  }
}

function idVariants(raw: string | number | null | undefined): string[] {
  const s = String(raw ?? '').trim();
  if (!s) return [];
  const out = new Set<string>([s]);
  out.add(s.replace(/^legacy_/, ''));
  out.add(s.replace(/^manual_/, ''));
  if (/^\d+$/.test(s)) out.add(`manual_${s}`);
  return [...out];
}

/** Find the timeline row for a pipeline flagged-email jump. */
export function findInteractionIndexForEmailFlag(
  rows: Array<{
    id?: unknown;
    kind?: string;
    editable?: boolean;
    message_id?: unknown;
    call_log?: { id?: string | number | null } | null;
  }>,
  flag: HandlerEmailFlagTarget,
  isLegacyLead: boolean,
): number {
  const want = String(flag.external_id || '').trim();
  if (!want) return -1;
  const wantKey = conversationFlagKey(flag);
  const wantIds = new Set(idVariants(want));

  for (let i = 0; i < rows.length; i++) {
    const target = interactionRowToConversationFlag(rows[i], isLegacyLead);
    if (target && conversationFlagKey(target) === wantKey) return i;
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const target = interactionRowToConversationFlag(row, isLegacyLead);
    const candidates = [
      target?.external_id,
      row.id,
      row.message_id,
    ];
    const hit = candidates.some((value) => idVariants(value).some((id) => wantIds.has(id)));
    if (!hit) continue;
    const kind = String(row.kind || '');
    const emailLike =
      kind === 'email' ||
      kind === 'email_manual' ||
      target?.conversation_channel === 'email' ||
      target?.conversation_channel === 'manual' ||
      target?.conversation_channel === 'legacy_interaction' ||
      Boolean(row.editable);
    if (emailLike) return i;
  }

  return -1;
}

export function buildHandlerInteractionsEmailPath(
  navId: string,
  flag: HandlerEmailFlagTarget | null,
): string {
  const params = new URLSearchParams();
  params.set('tab', 'interactions');
  if (flag) {
    params.set('flagChannel', flag.conversation_channel);
    params.set('flagId', flag.external_id);
  } else {
    params.set('compose', 'email');
  }
  return leadRoutePath(navId, `?${params.toString()}`);
}

export function markOpenEmailCompose(): void {
  try {
    sessionStorage.setItem(HANDLER_EMAIL_COMPOSE_STORAGE_KEY, 'true');
  } catch {
    /* ignore quota / private mode */
  }
}

export function peekOpenEmailCompose(): boolean {
  try {
    return sessionStorage.getItem(HANDLER_EMAIL_COMPOSE_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function consumeOpenEmailCompose(): boolean {
  try {
    if (sessionStorage.getItem(HANDLER_EMAIL_COMPOSE_STORAGE_KEY) !== 'true') return false;
    sessionStorage.removeItem(HANDLER_EMAIL_COMPOSE_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
