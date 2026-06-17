import { useCallback, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import {
  coerceEmployeeWorksFromHome,
  fetchEmployeeWorksFromHome,
} from '../lib/clockInLocations';
import { fetchPendingHomeWfhApproval } from '../lib/employeeClockInApproval';

const POLL_INTERVAL_MS = 4000;

type RealtimeRowPayload = {
  new?: Record<string, unknown> | null;
  old?: Record<string, unknown> | null;
};

export type HomeWfhApprovalSnapshot = {
  worksFromHome: boolean;
  pendingApproval: boolean;
};

export async function fetchHomeWfhApprovalSnapshot(
  employeeId: number,
): Promise<HomeWfhApprovalSnapshot> {
  const [worksFromHome, pendingApproval] = await Promise.all([
    fetchEmployeeWorksFromHome(employeeId),
    fetchPendingHomeWfhApproval(employeeId),
  ]);
  return { worksFromHome, pendingApproval };
}

/** True once admin granted home access (even if the placeholder row is not deleted yet). */
export function isHomeWfhAccessGranted(snapshot: HomeWfhApprovalSnapshot): boolean {
  return snapshot.worksFromHome;
}

type UseHomeWfhApprovalAutoClockInOptions = {
  employeeId: number;
  enabled: boolean;
  onApprovalGranted: (snapshot: HomeWfhApprovalSnapshot) => void | Promise<void>;
};

/**
 * Live + polling watcher while the employee waits for home/WFH approval on the clock-in gate.
 * Realtime uses table-wide postgres_changes with client-side row matching (filtered
 * subscriptions are unreliable in this project).
 */
export function useHomeWfhApprovalAutoClockIn({
  employeeId,
  enabled,
  onApprovalGranted,
}: UseHomeWfhApprovalAutoClockInOptions): void {
  const onApprovalGrantedRef = useRef(onApprovalGranted);
  onApprovalGrantedRef.current = onApprovalGranted;

  const checkApproval = useCallback(async () => {
    if (!enabled) return;

    try {
      const snapshot = await fetchHomeWfhApprovalSnapshot(employeeId);
      if (!isHomeWfhAccessGranted(snapshot)) return;
      await onApprovalGrantedRef.current(snapshot);
    } catch (error) {
      console.error('[useHomeWfhApprovalAutoClockIn] check failed:', error);
    }
  }, [employeeId, enabled]);

  useEffect(() => {
    if (!enabled) return;

    void checkApproval();

    const intervalId = window.setInterval(() => {
      void checkApproval();
    }, POLL_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [enabled, checkApproval]);

  useEffect(() => {
    if (!enabled) return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleCheck = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        void checkApproval();
      }, 250);
    };

    const matchesEmployeeClockIn = (payload: RealtimeRowPayload) => {
      const rowEmployeeId = payload.new?.employee_id ?? payload.old?.employee_id;
      return Number(rowEmployeeId) === employeeId;
    };

    const matchesEmployeeProfile = (payload: RealtimeRowPayload) => {
      if (Number(payload.new?.id) !== employeeId) return false;
      return coerceEmployeeWorksFromHome(payload.new?.works_from_home);
    };

    const channel = supabase
      .channel(`wfh-approval-live-${employeeId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'employee_clock_in' },
        (payload: RealtimeRowPayload) => {
          if (matchesEmployeeClockIn(payload)) scheduleCheck();
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'tenants_employee' },
        (payload: RealtimeRowPayload) => {
          if (matchesEmployeeProfile(payload)) scheduleCheck();
        },
      )
      .subscribe();

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      void supabase.removeChannel(channel);
    };
  }, [employeeId, enabled, checkApproval]);
}
