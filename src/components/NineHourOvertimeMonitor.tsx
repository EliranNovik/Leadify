import React from 'react';
import NineHourOvertimeModal from './NineHourOvertimeModal';
import { useNineHourOvertimeAutomation } from '../hooks/useNineHourOvertimeAutomation';
import { useOptionalClockInGate } from '../hooks/useClockInGate';

const NineHourOvertimeMonitor: React.FC = () => {
  const gate = useOptionalClockInGate();
  const employeeId = gate?.employeeId ?? null;
  const enabled = Boolean(gate?.isGateOpen && employeeId != null && gate.status !== 'exempt');

  const {
    isOpen,
    phase,
    promptSecondsLeft,
    countdownSecondsLeft,
    todayTotalMs,
    continueOvertime,
    clockOutNow,
  } = useNineHourOvertimeAutomation({ employeeId, enabled });

  return (
    <NineHourOvertimeModal
      isOpen={isOpen}
      phase={phase}
      promptSecondsLeft={promptSecondsLeft}
      countdownSecondsLeft={countdownSecondsLeft}
      todayTotalMs={todayTotalMs}
      onContinueOvertime={continueOvertime}
      onClockOutNow={clockOutNow}
    />
  );
};

export default NineHourOvertimeMonitor;
