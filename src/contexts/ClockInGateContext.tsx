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
import { readAdminClockInBypass } from '../lib/adminClockInBypass';
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
  const [adminBypassActive, setAdminBypassActive] = useState(false);
  const refreshInFlightRef = useRef<Promise<void> | null>(null);
  const refreshQueuedRef = useRef(false);

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
      setAdminBypassActive(false);
      setClockInGateBlocksDataAccess(false);
      return;
    }

    // Coalesce concurrent calls, but always run one trailing refresh so a
    // clock-out that lands mid-flight is not skipped with a stale result.
    if (refreshInFlightRef.current) {
      refreshQueuedRef.current = true;
      await refreshInFlightRef.current;
      if (!refreshQueuedRef.current) return;
      refreshQueuedRef.current = false;
    }

    const run = (async () => {
      setStatus((prev) => (prev === 'loading' ? 'loading' : prev));
      try {
        const profile = await fetchClockInGateProfile(user.id);
        const bypass = readAdminClockInBypass(user.id);
        if (bypass) {
          const effectiveEmployeeId = bypass.targetEmployeeId ?? profile.employeeId;
          setEmployeeId(effectiveEmployeeId);
          setAdminBypassActive(true);
          setStatus('allowed');
          setClockInGateBlocksDataAccess(false);
          writeClockInGateCache(user.id, 'allowed', effectiveEmployeeId);
          return;
        }

        setAdminBypassActive(false);
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

        const isClockedIn = await fetchIsEmployeeClockedIn(profile.employeeId);
        const nextStatus = resolveClockInGateStatus(profile, isClockedIn);
        setStatus(nextStatus);
        setClockInGateBlocksDataAccess(nextStatus === 'blocked');
        writeClockInGateCache(user.id, nextStatus, profile.employeeId);
      } catch (error) {
        console.error('Clock-in gate refresh failed:', error);
        setAdminBypassActive(false);
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

    if (refreshQueuedRef.current) {
      refreshQueuedRef.current = false;
      await refreshClockInGate();
    }
  }, [user?.id, supabaseSessionReady]);

  useEffect(() => {
    void refreshClockInGate();
  }, [refreshClockInGate]);

  useEffect(() => {
    if (!user?.id || !supabaseSessionReady || employeeId == null) return;

    const matchesEmployeeClockIn = (payload: {
      new?: Record<string, unknown> | null;
      old?: Record<string, unknown> | null;
    }) => {
      const rowEmployeeId = payload.new?.employee_id ?? payload.old?.employee_id;
      return Number(rowEmployeeId) === employeeId;
    };

    const channel = supabase
      .channel(`clockin_gate_${employeeId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'employee_clock_in' },
        (payload) => {
          if (matchesEmployeeClockIn(payload)) {
            void refreshClockInGate();
          }
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'tenants_employee' },
        (payload) => {
          if (Number(payload.new?.id) === employeeId) {
            void refreshClockInGate();
          }
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
      setAdminBypassActive(false);
      clearClockInGateCache();
    }
  }, [user?.id]);

  useEffect(() => {
    const onBypassChanged = () => {
      void refreshClockInGate();
    };
    window.addEventListener('admin-profile-bypass-changed', onBypassChanged);
    return () => window.removeEventListener('admin-profile-bypass-changed', onBypassChanged);
  }, [refreshClockInGate]);

  const value = useMemo<ClockInGateContextValue>(() => ({
    status,
    employeeId,
    isGateOpen: isClockInGateOpen(status),
    adminBypassActive,
    refreshClockInGate,
  }), [status, employeeId, adminBypassActive, refreshClockInGate]);

  return (
    <ClockInGateContext.Provider value={value}>
      {children}
    </ClockInGateContext.Provider>
  );
}
