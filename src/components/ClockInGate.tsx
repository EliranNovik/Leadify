import React from 'react';
import ClockInPresenceHeartbeat from './ClockInPresenceHeartbeat';
import NineHourOvertimeMonitor from './NineHourOvertimeMonitor';
import WorkdayEndMonitor from './WorkdayEndMonitor';
import LeadAllocationReminderMonitor from './LeadAllocationReminderMonitor';

/*
 * ---------------------------------------------------------------------------
 * FORCED CLOCK-IN GATE — TEMPORARILY DISABLED
 * ---------------------------------------------------------------------------
 * Staff can enter the CRM without clocking in. Clock-in / clock-out remains
 * optional via the Dashboard ClockInBox (and related modals).
 *
 * Full previous blocking implementation is preserved at:
 *   src/components/ClockInGate.forced.bak.tsx
 * Restore by copying that file back over this one.
 * ---------------------------------------------------------------------------
 */

type ClockInGateProps = {
  children: React.ReactNode;
};

/**
 * Pass-through: always render the protected app. Optional monitors still run
 * when the user is actually clocked in (they check gate status themselves).
 */
const ClockInGate: React.FC<ClockInGateProps> = ({ children }) => (
  <>
    {children}
    <ClockInPresenceHeartbeat />
    <NineHourOvertimeMonitor />
    <WorkdayEndMonitor />
    <LeadAllocationReminderMonitor />
  </>
);

export default ClockInGate;
