import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import { fetchActiveClockInRecord } from '../lib/employeeClockOut';
import { clockOutAndSignOut } from '../lib/employeeClockInOvertime';
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

  useEffect(() => {
    if (!employeeId) {
      workdayEndOptInRef.current = false;
      return;
    }

    workdayEndOptInRef.current = hasContinuedWorkdayEndToday();
    if (workdayEndOptInRef.current) return;

    void (async () => {
      const optedIn = await fetchWorkdayEndOptInFromDb(employeeId);
      if (optedIn) {
        workdayEndOptInRef.current = true;
        await markContinuedWorkdayEndToday(employeeId);
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
      console.error('Workday-end auto logout failed:', error);
      const message = error instanceof Error ? error.message : 'Failed to clock out';
      toast.error(message);
      autoLogoutInFlightRef.current = false;
      setPhase('idle');
    }
  }, [employeeId]);

  const evaluateThreshold = useCallback(async () => {
    if (!enabled || !employeeId || phaseRef.current !== 'idle') return;
    if (!isPastJerusalemWorkdayEnd()) return;
    if (workdayEndOptInRef.current || hasContinuedWorkdayEndToday()) return;

    try {
      const active = await fetchActiveClockInRecord(employeeId);
      if (!active) return;

      promptEndsAtRef.current = Date.now() + OVERTIME_PROMPT_MS;
      setPromptSecondsLeft(Math.ceil(OVERTIME_PROMPT_MS / 1000));
      setPhase('prompt');
    } catch (error) {
      console.error('Workday-end check failed:', error);
    }
  }, [enabled, employeeId]);

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

  const continueWorking = useCallback(() => {
    workdayEndOptInRef.current = true;
    void markContinuedWorkdayEndToday(employeeId);
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
    continueWorking,
    clockOutNow,
  };
}
