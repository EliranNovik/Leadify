import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { fetchActiveClockInRecord } from '../lib/employeeClockOut';
import {
  DEFAULT_MIN_HOURS,
  fetchEmployeeMinHours,
  fetchTodayHours,
  hasDismissedNineHourReminderToday,
  isPastJerusalemWorkdayEnd,
  markNineHourReminderDismissedToday,
  overtimeReminderThresholdMs,
  OVERTIME_POLL_MS,
} from '../lib/employeeClockInOvertime';

export type NineHourOvertimePhase = 'idle' | 'prompt';

type UseNineHourOvertimeAutomationOptions = {
  employeeId: number | null;
  enabled: boolean;
};

export function useNineHourOvertimeAutomation({
  employeeId,
  enabled,
}: UseNineHourOvertimeAutomationOptions) {
  const [phase, setPhase] = useState<NineHourOvertimePhase>('idle');
  const [todayTotalMs, setTodayTotalMs] = useState(0);

  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const dismissedRef = useRef(false);
  /**
   * The employee's base hours, loaded once per employee rather than on every poll.
   *
   * Seeded with the company default so the very first check has a sensible threshold instead of
   * treating the employee as having none.
   */
  const minHoursRef = useRef(DEFAULT_MIN_HOURS);

  useEffect(() => {
    dismissedRef.current = hasDismissedNineHourReminderToday();
    if (dismissedRef.current) setPhase('idle');
  }, [employeeId]);

  useEffect(() => {
    if (!employeeId) return;
    let cancelled = false;
    void fetchEmployeeMinHours(employeeId).then((hours) => {
      if (!cancelled) minHoursRef.current = hours;
    });
    return () => {
      cancelled = true;
    };
  }, [employeeId]);

  const evaluateThreshold = useCallback(async () => {
    if (!enabled || !employeeId) return;
    if (isPastJerusalemWorkdayEnd()) return;
    if (dismissedRef.current || hasDismissedNineHourReminderToday()) {
      dismissedRef.current = true;
      setPhase('idle');
      return;
    }

    try {
      const active = await fetchActiveClockInRecord(employeeId);
      if (!active) {
        setPhase('idle');
        return;
      }

      const { elapsedMs, preAddedMs } = await fetchTodayHours(employeeId);
      setTodayTotalMs(elapsedMs);
      /*
       * An hour before the day's allowance runs out, which is when the backend sends the matching
       * WhatsApp reminder. Hours the employee pre-added extend the allowance, so the popup no longer
       * fires the moment they clock in on top of an approved extra block.
       */
      if (elapsedMs < overtimeReminderThresholdMs(minHoursRef.current, preAddedMs)) {
        if (phaseRef.current === 'prompt') setPhase('idle');
        return;
      }

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

  const dismissReminder = useCallback(() => {
    dismissedRef.current = true;
    markNineHourReminderDismissedToday();
    setPhase('idle');
  }, []);

  return {
    isOpen: phase === 'prompt',
    phase,
    todayTotalMs,
    dismissReminder,
  };
}
