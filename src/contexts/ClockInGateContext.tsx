import React, {
  useCallback,
  useEffect,
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
import { setClockInGateBlocksDataAccess } from '../lib/clockInGateFetchPolicy';
import { useAuthContext } from './AuthContext';
import {
  ClockInGateContext,
  type ClockInGateContextValue,
} from './clockInGateContextValue';

export function ClockInGateProvider({ children }: { children: React.ReactNode }) {
  const { user, supabaseSessionReady } = useAuthContext();
  const [status, setStatus] = useState<ClockInGateStatus>('loading');
  const [employeeId, setEmployeeId] = useState<number | null>(null);
  const refreshInFlightRef = useRef<Promise<void> | null>(null);

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
      setStatus('loading');
      try {
        const profile = await fetchClockInGateProfile(user.id);
        setEmployeeId(profile.employeeId);

        if (profile.isExternalUser) {
          setStatus('exempt');
          setClockInGateBlocksDataAccess(false);
          return;
        }

        if (profile.employeeId == null) {
          setStatus('no_employee');
          setClockInGateBlocksDataAccess(true);
          return;
        }

        setClockInGateBlocksDataAccess(true);
        const isClockedIn = await fetchIsEmployeeClockedIn(profile.employeeId);
        const nextStatus = resolveClockInGateStatus(profile, isClockedIn);
        setStatus(nextStatus);
        setClockInGateBlocksDataAccess(nextStatus === 'blocked');
      } catch (error) {
        console.error('Clock-in gate refresh failed:', error);
        setStatus('blocked');
        setClockInGateBlocksDataAccess(true);
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
