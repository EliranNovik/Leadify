export type ConversationStaffActor = {
  authUserId?: string | null;
  userRowId?: string | null;
  employeeId?: number | null;
  displayName?: string | null;
};

function pushKey(keys: string[], prefix: string, value: unknown) {
  const text = String(value || '').trim().toLowerCase();
  if (text) keys.push(`${prefix}:${text}`);
}

export function staffSenderKeys(actor: ConversationStaffActor): string[] {
  const keys: string[] = [];
  pushKey(keys, 'id', actor.authUserId);
  pushKey(keys, 'id', actor.userRowId);
  if (actor.employeeId != null && Number.isFinite(Number(actor.employeeId))) {
    pushKey(keys, 'id', actor.employeeId);
  }
  const name = String(actor.displayName || '').trim().toLowerCase();
  if (name) {
    keys.push(`name:${name}`);
    const first = name.split(/\s+/).filter(Boolean)[0];
    if (first) keys.push(`name:${first}`);
  }
  return [...new Set(keys)];
}

export function messageSenderKeys(senderId?: unknown, senderName?: unknown): string[] {
  const keys: string[] = [];
  pushKey(keys, 'id', senderId);
  const name = String(senderName || '').trim().toLowerCase();
  if (name) {
    keys.push(`name:${name}`);
    const first = name.split(/\s+/).filter(Boolean)[0];
    if (first) keys.push(`name:${first}`);
  }
  return [...new Set(keys)];
}

export function outgoingWhatsAppIsFromStaff(
  row: { direction?: string | null; sender_id?: unknown; sender_name?: unknown },
  actor: ConversationStaffActor,
): boolean {
  if (String(row?.direction || '').toLowerCase() !== 'out') return false;
  const mine = new Set(staffSenderKeys(actor));
  return messageSenderKeys(row.sender_id, row.sender_name).some((key) => mine.has(key));
}
