import React from 'react';
import NineHourOvertimeModal from './NineHourOvertimeModal';
import { useNineHourOvertimeAutomation } from '../hooks/useNineHourOvertimeAutomation';
import { useOptionalClockInGate } from '../hooks/useClockInGate';

const NineHourOvertimeMonitor: React.FC = () => {
  const gate = useOptionalClockInGate();
  const employeeId = gate?.employeeId ?? null;
  const enabled = Boolean(
    gate?.isGateOpen &&
    employeeId != null &&
    gate.status !== 'exempt' &&
    !gate.adminBypassActive,
  );

  const { isOpen, todayTotalMs, dismissReminder } = useNineHourOvertimeAutomation({
    employeeId,
    enabled,
  });

  return (
    <NineHourOvertimeModal
      isOpen={isOpen}
      todayTotalMs={todayTotalMs}
      onClose={dismissReminder}
    />
  );
};

export default NineHourOvertimeMonitor;
