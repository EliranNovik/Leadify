import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import { subscribeClockInOptIn } from '../lib/clockInOptInCrossTab';
import { fetchActiveClockInRecord } from '../lib/employeeClockOut';
import { clockOutAndSignOut, getTodayDateKey } from '../lib/employeeClockInOvertime';
import {
  fetchWorkdayEndOptInFromDb,
  hasContinuedWorkdayEndToday,
  isPastJerusalemWorkdayEnd,
  markContinuedWorkdayEndToday,
  OVERTIME_FINAL_COUNTDOWN_MS,
  OVERTIME_PROMPT_MS,
  WORKDAY_END_POLL_MS,
} from '../lib/employeeClockInWorkdayEnd';

export type WorkdayEndPhase = 'idle' | 'prompt' | 'final_countdown' | 'processing';

type UseWorkdayEndAutomationOptions = {
  employeeId: number | null;
  enabled: boolean;
};

const OPT_IN_RECHECK_MS = 2_000;

export function useWorkdayEndAutomation({
  employeeId,
  enabled,
}: UseWorkdayEndAutomationOptions) {
  const [phase, setPhase] = useState<WorkdayEndPhase>('idle');
  const [promptSecondsLeft, setPromptSecondsLeft] = useState(
    Math.ceil(OVERTIME_PROMPT_MS / 1000),
  );
  const [countdownSecondsLeft, setCountdownSecondsLeft] = useState(
    Math.ceil(OVERTIME_FINAL_COUNTDOWN_MS / 1000),
  );

  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const promptEndsAtRef = useRef<number | null>(null);
  const countdownEndsAtRef = useRef<number | null>(null);
  const autoLogoutInFlightRef = useRef(false);
  const workdayEndOptInRef = useRef(false);

  const applyWorkdayEndOptIn = useCallback(() => {
    workdayEndOptInRef.current = true;
    promptEndsAtRef.current = null;
    countdownEndsAtRef.current = null;
    autoLogoutInFlightRef.current = false;
    setPhase('idle');
  }, []);

  const hasWorkdayEndOptIn = useCallback(async (): Promise<boolean> => {
    if (workdayEndOptInRef.current || hasContinuedWorkdayEndToday()) {
      workdayEndOptInRef.current = true;
      return true;
    }
    if (!employeeId) return false;
    const optedIn = await fetchWorkdayEndOptInFromDb(employeeId);
    if (optedIn) {
      workdayEndOptInRef.current = true;
      await markContinuedWorkdayEndToday(employeeId);
    }
    return optedIn;
  }, [employeeId]);

  useEffect(() => {
    if (!employeeId) {
      workdayEndOptInRef.current = false;
      return;
    }

    workdayEndOptInRef.current = hasContinuedWorkdayEndToday();
    if (workdayEndOptInRef.current) return;

    void (async () => {
      if (await fetchWorkdayEndOptInFromDb(employeeId)) {
        applyWorkdayEndOptIn();
      }
    })();
  }, [employeeId, applyWorkdayEndOptIn]);

  useEffect(() => {
    if (!employeeId) return undefined;

    return subscribeClockInOptIn((message) => {
      if (message.kind !== 'workday_end' || message.dateKey !== getTodayDateKey()) return;
      applyWorkdayEndOptIn();
    });
  }, [employeeId, applyWorkdayEndOptIn]);

  useEffect(() => {
    if (!employeeId || phase === 'idle') return undefined;

    const recheck = () => {
      void (async () => {
        if (await hasWorkdayEndOptIn()) {
          applyWorkdayEndOptIn();
        }
      })();
    };

    recheck();
    const interval = window.setInterval(recheck, OPT_IN_RECHECK_MS);
    return () => window.clearInterval(interval);
  }, [employeeId, phase, hasWorkdayEndOptIn, applyWorkdayEndOptIn]);

  const runAutoLogout = useCallback(async () => {
    if (!employeeId || autoLogoutInFlightRef.current) return;

    if (await hasWorkdayEndOptIn()) {
      applyWorkdayEndOptIn();
      return;
    }

    autoLogoutInFlightRef.current = true;
    setPhase('processing');
    try {
      if (await hasWorkdayEndOptIn()) {
        applyWorkdayEndOptIn();
        autoLogoutInFlightRef.current = false;
        return;
      }
      await clockOutAndSignOut(employeeId);
      window.location.href = '/login';
    } catch (error) {
      console.error('Workday-end auto logout failed:', error);
      const message = error instanceof Error ? error.message : 'Failed to clock out';
      toast.error(message);
      autoLogoutInFlightRef.current = false;
      setPhase('idle');
    }
  }, [employeeId, hasWorkdayEndOptIn, applyWorkdayEndOptIn]);

  const evaluateThreshold = useCallback(async () => {
    if (!enabled || !employeeId || phaseRef.current !== 'idle') return;
    if (!isPastJerusalemWorkdayEnd()) return;
    if (await hasWorkdayEndOptIn()) return;

    try {
      const active = await fetchActiveClockInRecord(employeeId);
      if (!active) return;

      promptEndsAtRef.current = Date.now() + OVERTIME_PROMPT_MS;
      setPromptSecondsLeft(Math.ceil(OVERTIME_PROMPT_MS / 1000));
      setPhase('prompt');
    } catch (error) {
      console.error('Workday-end check failed:', error);
    }
  }, [enabled, employeeId, hasWorkdayEndOptIn]);

  useEffect(() => {
    if (!enabled || !employeeId) return undefined;

    void evaluateThreshold();
    const interval = window.setInterval(() => {
      void evaluateThreshold();
    }, WORKDAY_END_POLL_MS);

    return () => window.clearInterval(interval);
  }, [enabled, employeeId, evaluateThreshold]);

  useEffect(() => {
    if (phase !== 'prompt') return undefined;

    const tick = async () => {
      if (await hasWorkdayEndOptIn()) {
        applyWorkdayEndOptIn();
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
  }, [phase, hasWorkdayEndOptIn, applyWorkdayEndOptIn]);

  useEffect(() => {
    if (phase !== 'final_countdown') return undefined;

    const tick = async () => {
      if (await hasWorkdayEndOptIn()) {
        applyWorkdayEndOptIn();
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
  }, [phase, runAutoLogout, hasWorkdayEndOptIn, applyWorkdayEndOptIn]);

  const continueWorking = useCallback(() => {
    applyWorkdayEndOptIn();
    void markContinuedWorkdayEndToday(employeeId);
  }, [employeeId, applyWorkdayEndOptIn]);

  const clockOutNow = useCallback(() => {
    void runAutoLogout();
  }, [runAutoLogout]);

  const isOpen = phase === 'prompt' || phase === 'final_countdown' || phase === 'processing';

  return {
    isOpen,
    phase,
    promptSecondsLeft,
    countdownSecondsLeft,
    continueWorking,
    clockOutNow,
  };
}
