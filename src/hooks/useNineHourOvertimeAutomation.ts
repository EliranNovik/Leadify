import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import { subscribeClockInOptIn } from '../lib/clockInOptInCrossTab';
import { fetchActiveClockInRecord } from '../lib/employeeClockOut';
import {
  clockOutKeepSession,
  fetchOvertimeOptInFromDb,
  fetchTodayClockedMs,
  getTodayDateKey,
  hasContinuedOvertimeToday,
  isPastJerusalemWorkdayEnd,
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

const OPT_IN_RECHECK_MS = 2_000;

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

  const applyOvertimeOptIn = useCallback(() => {
    overtimeOptInRef.current = true;
    promptEndsAtRef.current = null;
    countdownEndsAtRef.current = null;
    autoLogoutInFlightRef.current = false;
    setPhase('idle');
  }, []);

  const hasOvertimeOptIn = useCallback(async (): Promise<boolean> => {
    if (overtimeOptInRef.current || hasContinuedOvertimeToday()) {
      overtimeOptInRef.current = true;
      return true;
    }
    if (!employeeId) return false;
    const optedIn = await fetchOvertimeOptInFromDb(employeeId);
    if (optedIn) {
      overtimeOptInRef.current = true;
      await markContinuedOvertimeToday(employeeId);
    }
    return optedIn;
  }, [employeeId]);

  useEffect(() => {
    if (!employeeId) {
      overtimeOptInRef.current = false;
      return;
    }

    overtimeOptInRef.current = hasContinuedOvertimeToday();
    if (overtimeOptInRef.current) return;

    void (async () => {
      if (await fetchOvertimeOptInFromDb(employeeId)) {
        applyOvertimeOptIn();
      }
    })();
  }, [employeeId, applyOvertimeOptIn]);

  useEffect(() => {
    if (!employeeId) return undefined;

    return subscribeClockInOptIn((message) => {
      if (message.kind !== 'overtime' || message.dateKey !== getTodayDateKey()) return;
      applyOvertimeOptIn();
    });
  }, [employeeId, applyOvertimeOptIn]);

  useEffect(() => {
    if (!employeeId || phase === 'idle') return undefined;

    const recheck = () => {
      void (async () => {
        if (await hasOvertimeOptIn()) {
          applyOvertimeOptIn();
        }
      })();
    };

    recheck();
    const interval = window.setInterval(recheck, OPT_IN_RECHECK_MS);
    return () => window.clearInterval(interval);
  }, [employeeId, phase, hasOvertimeOptIn, applyOvertimeOptIn]);

  const runAutoLogout = useCallback(async () => {
    if (!employeeId || autoLogoutInFlightRef.current) return;

    if (await hasOvertimeOptIn()) {
      applyOvertimeOptIn();
      return;
    }

    autoLogoutInFlightRef.current = true;
    setPhase('processing');
    try {
      if (await hasOvertimeOptIn()) {
        applyOvertimeOptIn();
        autoLogoutInFlightRef.current = false;
        return;
      }
      await clockOutKeepSession(employeeId);
      // Stay signed in — clock-in gate will block until they clock in again.
      window.location.href = '/';
    } catch (error) {
      console.error('Nine-hour overtime auto logout failed:', error);
      const message = error instanceof Error ? error.message : 'Failed to clock out';
      toast.error(message);
      autoLogoutInFlightRef.current = false;
      setPhase('idle');
    }
  }, [employeeId, hasOvertimeOptIn, applyOvertimeOptIn]);

  const evaluateThreshold = useCallback(async () => {
    if (!enabled || !employeeId || phaseRef.current !== 'idle') return;
    if (isPastJerusalemWorkdayEnd()) return;
    if (await hasOvertimeOptIn()) return;

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
  }, [enabled, employeeId, hasOvertimeOptIn]);

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

    const tick = async () => {
      if (await hasOvertimeOptIn()) {
        applyOvertimeOptIn();
        return;
      }

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

    void tick();
    const interval = window.setInterval(() => {
      void tick();
    }, 1000);
    return () => window.clearInterval(interval);
  }, [phase, hasOvertimeOptIn, applyOvertimeOptIn]);

  useEffect(() => {
    if (phase !== 'final_countdown') return undefined;

    const tick = async () => {
      if (await hasOvertimeOptIn()) {
        applyOvertimeOptIn();
        return;
      }

      const endsAt = countdownEndsAtRef.current;
      if (!endsAt) return;
      const remainingMs = endsAt - Date.now();
      if (remainingMs <= 0) {
        void runAutoLogout();
        return;
      }
      setCountdownSecondsLeft(Math.ceil(remainingMs / 1000));
    };

    void tick();
    const interval = window.setInterval(() => {
      void tick();
    }, 1000);
    return () => window.clearInterval(interval);
  }, [phase, runAutoLogout, hasOvertimeOptIn, applyOvertimeOptIn]);

  const continueOvertime = useCallback(() => {
    applyOvertimeOptIn();
    void (async () => {
      let persisted = await markContinuedOvertimeToday(employeeId);
      if (!persisted && employeeId != null) {
        persisted = await markContinuedOvertimeToday(employeeId);
      }
      if (!persisted && employeeId != null) {
        toast.error('Could not save overtime choice to the server. Retrying…');
        persisted = await markContinuedOvertimeToday(employeeId);
      }
      if (!persisted && employeeId != null) {
        toast.error(
          'Overtime choice saved on this device only. Stay on this browser until end of day.',
        );
      }
    })();
  }, [employeeId, applyOvertimeOptIn]);

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
