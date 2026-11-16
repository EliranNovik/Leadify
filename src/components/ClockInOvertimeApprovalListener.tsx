import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import { fetchCurrentEmployeeContext } from '../lib/employeeLeadReporting';
import { toDateInputValue } from '../lib/employeeClockInFormat';
import {
  CLOCK_IN_OVERTIME_RESOLVED_EVENT,
  fetchRecentOvertimeApprovalRequests,
  type OvertimeApprovalRequestRow,
  type OvertimeApprovalRequestStatus,
} from '../lib/employeeClockInOvertimeWhatsApp';

const SEEN_STORAGE_KEY = 'clock-in-overtime-request-status';
const FRESH_MS = 12 * 60 * 60 * 1000;

function readSeen(): Record<string, OvertimeApprovalRequestStatus> {
  try {
    const parsed = JSON.parse(localStorage.getItem(SEEN_STORAGE_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeSeen(seen: Record<string, OvertimeApprovalRequestStatus>) {
  try {
    const entries = Object.entries(seen).slice(-80);
    localStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Private browsing can block storage. The next poll will toast at most once more.
  }
}

/** The working-hours day those clock-in rows belong to, as YYYY-MM-DD. */
async function dateKeyForClockIns(clockInIds: number[]): Promise<string | null> {
  if (clockInIds.length === 0) return null;
  const { data, error } = await supabase
    .from('employee_clock_in')
    .select('clock_in_time')
    .in('id', clockInIds)
    .order('clock_in_time', { ascending: true })
    .limit(1);
  if (error || !data?.[0]?.clock_in_time) return null;
  const parsed = new Date(data[0].clock_in_time);
  if (Number.isNaN(parsed.getTime())) return null;
  return toDateInputValue(parsed);
}

function notifyResolved(
  status: OvertimeApprovalRequestStatus,
  dateKey: string | null,
  openRow: (dateKey: string | null) => void,
) {
  const approved = status === 'approved';
  if (!approved && status !== 'declined') return;

  const message = approved
    ? 'Michael Decker approved your extra hours.'
    : 'Michael Decker did not approve the extra hours. The entry was declined.';

  toast.custom((t) => (
    <div
      className={`pointer-events-auto flex max-w-md items-center gap-3 rounded-lg px-4 py-3 text-white shadow-lg ${approved ? 'bg-emerald-600' : 'bg-red-600'}`}
    >
      <span className="text-sm leading-snug">{message}</span>
      <button
        type="button"
        className="shrink-0 rounded-full bg-white/20 px-3 py-1 text-sm font-semibold hover:bg-white/30"
        onClick={() => {
          toast.dismiss(t.id);
          openRow(dateKey);
        }}
      >
        Show the row
      </button>
    </div>
  ), { duration: 15000 });

  window.dispatchEvent(new CustomEvent(CLOCK_IN_OVERTIME_RESOLVED_EVENT));
}

async function applyRows(
  rows: OvertimeApprovalRequestRow[],
  openRow: (dateKey: string | null) => void,
) {
  const seen = readSeen();
  let changed = false;

  for (const row of rows) {
    const key = String(row.id);
    const previous = seen[key];
    if (row.status === 'pending') {
      if (previous !== 'pending') {
        seen[key] = 'pending';
        changed = true;
      }
      continue;
    }

    if (previous === row.status) continue;

    const stamp = new Date(row.resolved_at || row.created_at).getTime();
    const fresh = Number.isFinite(stamp) && Date.now() - stamp < FRESH_MS;
    if (previous === 'pending' || (previous == null && fresh)) {
      const dateKey = await dateKeyForClockIns(row.clock_in_ids);
      notifyResolved(row.status, dateKey, openRow);
    }
    seen[key] = row.status;
    changed = true;
  }

  if (changed) writeSeen(seen);
}

/**
 * Watches overtime requests for the signed-in employee after the drawer has closed.
 * Michael's Yes/No reply updates the rows on the server; this surfaces the toast.
 */
export default function ClockInOvertimeApprovalListener() {
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    let employeeId: number | null = null;
    let timer: number | null = null;

    const openRow = (dateKey: string | null) => {
      const params = new URLSearchParams({ tab: 'working-hours' });
      if (dateKey) {
        params.set('hoursDate', dateKey);
        params.set('hoursAt', String(Date.now()));
      }
      navigate(`/my-profile?${params.toString()}`);
    };

    const tick = async () => {
      if (employeeId == null) return;
      const rows = await fetchRecentOvertimeApprovalRequests(employeeId);
      if (!cancelled) await applyRows(rows, openRow);
    };

    void fetchCurrentEmployeeContext().then((ctx) => {
      if (cancelled || ctx?.employeeId == null) return;
      employeeId = Number(ctx.employeeId);
      void tick();
      timer = window.setInterval(() => {
        void tick();
      }, 10000);
    });

    const channel = supabase
      .channel('clock-in-overtime-approval')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'employee_clock_in_overtime_requests' },
        () => {
          void tick();
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      if (timer != null) window.clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [navigate]);

  return null;
}
