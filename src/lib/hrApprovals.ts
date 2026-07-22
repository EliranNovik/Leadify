import { fetchPendingManualClockInCount } from './employeeClockInApproval';
import { fetchPendingUnavailabilityCount } from './employeeUnavailabilityApproval';
import { fetchPendingWfhPeriodApprovalCount } from './employeeWfhPeriodRequests';

/** Combined pending count for Header badge / ClockInBox (clock + WFH periods + leave). */
export async function fetchCombinedPendingHrApprovalCount(): Promise<number> {
  const [clock, leave, wfhPeriods] = await Promise.all([
    fetchPendingManualClockInCount(),
    fetchPendingUnavailabilityCount().catch(() => 0),
    fetchPendingWfhPeriodApprovalCount().catch(() => 0),
  ]);
  return clock + leave + wfhPeriods;
}
