import React from 'react';
import { useClockInPresenceHeartbeat } from '../hooks/useClockInPresenceHeartbeat';
import { useOptionalClockInGate } from '../hooks/useClockInGate';

/** Pings the server while the user is clocked in and using the app. */
const ClockInPresenceHeartbeat: React.FC = () => {
  const gate = useOptionalClockInGate();
  const employeeId = gate?.employeeId ?? null;
  const enabled = Boolean(gate?.isGateOpen && employeeId != null && gate.status !== 'exempt');

  useClockInPresenceHeartbeat({ employeeId, enabled });

  return null;
};

export default ClockInPresenceHeartbeat;
