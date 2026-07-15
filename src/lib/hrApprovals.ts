import { fetchPendingManualClockInCount } from './employeeClockInApproval';
import { fetchPendingUnavailabilityCount } from './employeeUnavailabilityApproval';

/** Combined pending count for Header badge / ClockInBox (clock + leave). */
export async function fetchCombinedPendingHrApprovalCount(): Promise<number> {
  const [clock, leave] = await Promise.all([
    fetchPendingManualClockInCount(),
    fetchPendingUnavailabilityCount().catch(() => 0),
  ]);
  return clock + leave;
}
