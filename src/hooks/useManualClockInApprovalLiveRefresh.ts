import { useRealtimeRefresh } from './useRealtimeRefresh';

type UseManualClockInApprovalLiveRefreshOptions = {
  enabled?: boolean;
  onChange: () => void | Promise<void>;
  /** Unique suffix so multiple subscribers on one page do not clash. */
  channelSuffix?: string;
  /** Debounce window for bursts of DB changes. Defaults to 400ms. */
  debounceMs?: number;
};

/**
 * Live refresh for manual clock-in / WFH approval queues.
 * Listens table-wide on employee_clock_in (client-side only — no server filter).
 */
export function useManualClockInApprovalLiveRefresh({
  enabled = true,
  onChange,
  channelSuffix = 'default',
  debounceMs = 400,
}: UseManualClockInApprovalLiveRefreshOptions): void {
  useRealtimeRefresh({
    channelName: `manual-clock-in-approval-live-${channelSuffix}`,
    enabled,
    tables: [
      { table: 'employee_clock_in', event: '*' },
      { table: 'employee_unavailability_reasons', event: '*' },
      { table: 'employee_wfh_period_requests', event: '*' },
    ],
    onChange,
    debounceMs,
    refreshOnFocus: true,
  });
}
