import { useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import { fetchCurrentEmployeeContext } from '../lib/employeeLeadReporting';
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

function notifyResolved(status: OvertimeApprovalRequestStatus) {
  if (status === 'approved') {
    toast.success('Michael Decker approved your extra hours.');
  } else if (status === 'declined') {
    toast.error('Michael Decker did not approve the extra hours. The entry was declined.');
  } else {
    return;
  }
  window.dispatchEvent(new CustomEvent(CLOCK_IN_OVERTIME_RESOLVED_EVENT));
}

function applyRows(rows: OvertimeApprovalRequestRow[]) {
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
      notifyResolved(row.status);
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
  useEffect(() => {
    let cancelled = false;
    let employeeId: number | null = null;
    let timer: number | null = null;

    const tick = async () => {
      if (employeeId == null) return;
      const rows = await fetchRecentOvertimeApprovalRequests(employeeId);
      if (!cancelled) applyRows(rows);
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
  }, []);

  return null;
}
