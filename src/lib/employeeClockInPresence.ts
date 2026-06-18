import { supabase } from './supabase';

/** How often the client pings while clocked in and the app is open. */
export const PRESENCE_HEARTBEAT_MS = 30_000;

/** Server treats presence older than this as "user left the browser". */
export const PRESENCE_STALE_MS = 90_000;

export async function sendClockInPresenceHeartbeat(employeeId: number): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase.from('employee_clock_in_presence').upsert(
    {
      employee_id: employeeId,
      last_seen_at: now,
      updated_at: now,
    },
    { onConflict: 'employee_id' },
  );

  if (error) {
    console.error('Clock-in presence heartbeat failed:', error);
  }
}
