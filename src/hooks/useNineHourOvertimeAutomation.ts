import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import { fetchActiveClockInRecord } from '../lib/employeeClockOut';
import {
  clockOutAndSignOut,
  fetchOvertimeOptInFromDb,
  fetchTodayClockedMs,
  hasContinuedOvertimeToday,
  markContinuedOvertimeToday,
  NINE_HOURS_MS,
  OVERTIME_FINAL_COUNTDOWN_MS,
  OVERTIME_POLL_MS,
  OVERTIME_PROMPT_MS,
} from '../lib/employeeClockInOvertime';

export type NineHourOvertimePhase = 'idle' | 'prompt' | 'final_countdown' | 'processing';

type UseNineHourOvertimeAutomationOptions = {
  employeeId: number | null;
  enabled: boolean;
};

export function useNineHourOvertimeAutomation({
  employeeId,
  enabled,
}: UseNineHourOvertimeAutomationOptions) {
  const [phase, setPhase] = useState<NineHourOvertimePhase>('idle');
  const [promptSecondsLeft, setPromptSecondsLeft] = useState(
    Math.ceil(OVERTIME_PROMPT_MS / 1000),
  );
  const [countdownSecondsLeft, setCountdownSecondsLeft] = useState(
    Math.ceil(OVERTIME_FINAL_COUNTDOWN_MS / 1000),
  );
  const [todayTotalMs, setTodayTotalMs] = useState(0);

  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const promptEndsAtRef = useRef<number | null>(null);
  const countdownEndsAtRef = useRef<number | null>(null);
  const autoLogoutInFlightRef = useRef(false);
  const overtimeOptInRef = useRef(false);

  useEffect(() => {
    if (!employeeId) {
      overtimeOptInRef.current = false;
      return;
    }

    overtimeOptInRef.current = hasContinuedOvertimeToday();
    if (overtimeOptInRef.current) return;

    void (async () => {
      const optedIn = await fetchOvertimeOptInFromDb(employeeId);
      if (optedIn) {
        overtimeOptInRef.current = true;
        await markContinuedOvertimeToday(employeeId);
      }
    })();
  }, [employeeId]);

  const runAutoLogout = useCallback(async () => {
    if (!employeeId || autoLogoutInFlightRef.current) return;
    autoLogoutInFlightRef.current = true;
    setPhase('processing');
    try {
      await clockOutAndSignOut(employeeId);
      window.location.href = '/login';
    } catch (error) {
      console.error('Nine-hour overtime auto logout failed:', error);
      const message = error instanceof Error ? error.message : 'Failed to clock out';
      toast.error(message);
      autoLogoutInFlightRef.current = false;
      setPhase('idle');
    }
  }, [employeeId]);

  const evaluateThreshold = useCallback(async () => {
    if (!enabled || !employeeId || phaseRef.current !== 'idle') return;
    if (overtimeOptInRef.current || hasContinuedOvertimeToday()) return;

    try {
      const active = await fetchActiveClockInRecord(employeeId);
      if (!active) return;

      const totalMs = await fetchTodayClockedMs(employeeId);
      setTodayTotalMs(totalMs);
      if (totalMs < NINE_HOURS_MS) return;

      promptEndsAtRef.current = Date.now() + OVERTIME_PROMPT_MS;
      setPromptSecondsLeft(Math.ceil(OVERTIME_PROMPT_MS / 1000));
      setPhase('prompt');
    } catch (error) {
      console.error('Nine-hour overtime check failed:', error);
    }
  }, [enabled, employeeId]);

  useEffect(() => {
    if (!enabled || !employeeId) return undefined;

    void evaluateThreshold();
    const interval = window.setInterval(() => {
      void evaluateThreshold();
    }, OVERTIME_POLL_MS);

    const channel = supabase
      .channel(`nine_hour_overtime_${employeeId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'employee_clock_in',
          filter: `employee_id=eq.${employeeId}`,
        },
        () => {
          void evaluateThreshold();
        },
      )
      .subscribe();

    return () => {
      window.clearInterval(interval);
      void supabase.removeChannel(channel);
    };
  }, [enabled, employeeId, evaluateThreshold]);

  useEffect(() => {
    if (phase !== 'prompt') return undefined;

    const tick = () => {
      const endsAt = promptEndsAtRef.current;
      if (!endsAt) return;
      const remainingMs = endsAt - Date.now();
      if (remainingMs <= 0) {
        countdownEndsAtRef.current = Date.now() + OVERTIME_FINAL_COUNTDOWN_MS;
        setCountdownSecondsLeft(Math.ceil(OVERTIME_FINAL_COUNTDOWN_MS / 1000));
        setPhase('final_countdown');
        return;
      }
      setPromptSecondsLeft(Math.ceil(remainingMs / 1000));
    };

    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'final_countdown') return undefined;

    const tick = () => {
      const endsAt = countdownEndsAtRef.current;
      if (!endsAt) return;
      const remainingMs = endsAt - Date.now();
      if (remainingMs <= 0) {
        void runAutoLogout();
        return;
      }
      setCountdownSecondsLeft(Math.ceil(remainingMs / 1000));
    };

    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [phase, runAutoLogout]);

  const continueOvertime = useCallback(() => {
    overtimeOptInRef.current = true;
    void markContinuedOvertimeToday(employeeId);
    promptEndsAtRef.current = null;
    countdownEndsAtRef.current = null;
    setPhase('idle');
  }, [employeeId]);

  const clockOutNow = useCallback(() => {
    void runAutoLogout();
  }, [runAutoLogout]);

  const isOpen = phase === 'prompt' || phase === 'final_countdown' || phase === 'processing';

  return {
    isOpen,
    phase,
    promptSecondsLeft,
    countdownSecondsLeft,
    todayTotalMs,
    continueOvertime,
    clockOutNow,
  };
}
