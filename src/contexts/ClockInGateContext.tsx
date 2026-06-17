import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { supabase } from '../lib/supabase';
import {
  fetchClockInGateProfile,
  fetchIsEmployeeClockedIn,
  isClockInGateOpen,
  resolveClockInGateStatus,
  type ClockInGateStatus,
} from '../lib/employeeClockInGate';
import {
  clearClockInGateCache,
  readClockInGateCache,
  writeClockInGateCache,
} from '../lib/clockInGateCache';
import { setClockInGateBlocksDataAccess } from '../lib/clockInGateFetchPolicy';
import { useAuthContext } from './AuthContext';
import {
  ClockInGateContext,
  type ClockInGateContextValue,
} from './clockInGateContextValue';

function readCachedGateState(userId: string | undefined) {
  if (!userId) {
    return { status: 'loading' as ClockInGateStatus, employeeId: null };
  }
  const cached = readClockInGateCache(userId);
  if (!cached) {
    return { status: 'loading' as ClockInGateStatus, employeeId: null };
  }
  return { status: cached.status, employeeId: cached.employeeId };
}

export function ClockInGateProvider({ children }: { children: React.ReactNode }) {
  const { user, supabaseSessionReady } = useAuthContext();
  const userId = user?.id;
  const [status, setStatus] = useState<ClockInGateStatus>(
    () => readCachedGateState(userId).status,
  );
  const [employeeId, setEmployeeId] = useState<number | null>(
    () => readCachedGateState(userId).employeeId,
  );
  const refreshInFlightRef = useRef<Promise<void> | null>(null);

  useLayoutEffect(() => {
    if (!userId) {
      setClockInGateBlocksDataAccess(false);
      return;
    }
    const cached = readClockInGateCache(userId);
    if (cached) {
      setClockInGateBlocksDataAccess(
        cached.status === 'blocked' || cached.status === 'no_employee',
      );
    }
  }, [userId]);

  const refreshClockInGate = useCallback(async () => {
    if (!user?.id || !supabaseSessionReady) {
      setStatus('loading');
      setEmployeeId(null);
      setClockInGateBlocksDataAccess(false);
      return;
    }

    if (refreshInFlightRef.current) {
      await refreshInFlightRef.current;
      return;
    }

    const run = (async () => {
      setStatus((prev) => (prev === 'loading' ? 'loading' : prev));
      try {
        const profile = await fetchClockInGateProfile(user.id);
        setEmployeeId(profile.employeeId);

        if (profile.isExternalUser) {
          setStatus('exempt');
          setClockInGateBlocksDataAccess(false);
          writeClockInGateCache(user.id, 'exempt', profile.employeeId);
          return;
        }

        if (profile.employeeId == null) {
          setStatus('no_employee');
          setClockInGateBlocksDataAccess(true);
          writeClockInGateCache(user.id, 'no_employee', null);
          return;
        }

        setClockInGateBlocksDataAccess(true);
        const isClockedIn = await fetchIsEmployeeClockedIn(profile.employeeId);
        const nextStatus = resolveClockInGateStatus(profile, isClockedIn);
        setStatus(nextStatus);
        setClockInGateBlocksDataAccess(nextStatus === 'blocked');
        writeClockInGateCache(user.id, nextStatus, profile.employeeId);
      } catch (error) {
        console.error('Clock-in gate refresh failed:', error);
        setStatus('blocked');
        setClockInGateBlocksDataAccess(true);
        writeClockInGateCache(user.id, 'blocked', null);
      }
    })();

    refreshInFlightRef.current = run;
    try {
      await run;
    } finally {
      refreshInFlightRef.current = null;
    }
  }, [user?.id, supabaseSessionReady]);

  useEffect(() => {
    void refreshClockInGate();
  }, [refreshClockInGate]);

  useEffect(() => {
    if (!user?.id || !supabaseSessionReady || employeeId == null) return;

    const channel = supabase
      .channel(`clockin_gate_${employeeId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'employee_clock_in',
          filter: `employee_id=eq.${employeeId}`,
        },
        () => {
          void refreshClockInGate();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user?.id, supabaseSessionReady, employeeId, refreshClockInGate]);

  useEffect(() => {
    if (!user?.id) {
      setClockInGateBlocksDataAccess(false);
      clearClockInGateCache();
    }
  }, [user?.id]);

  const value = useMemo<ClockInGateContextValue>(() => ({
    status,
    employeeId,
    isGateOpen: isClockInGateOpen(status),
    refreshClockInGate,
  }), [status, employeeId, refreshClockInGate]);

  return (
    <ClockInGateContext.Provider value={value}>
      {children}
    </ClockInGateContext.Provider>
  );
}
