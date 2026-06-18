import React from 'react';
import WorkdayEndModal from './WorkdayEndModal';
import { useWorkdayEndAutomation } from '../hooks/useWorkdayEndAutomation';
import { useOptionalClockInGate } from '../hooks/useClockInGate';

const WorkdayEndMonitor: React.FC = () => {
  const gate = useOptionalClockInGate();
  const employeeId = gate?.employeeId ?? null;
  const enabled = Boolean(gate?.isGateOpen && employeeId != null && gate.status !== 'exempt');

  const {
    isOpen,
    phase,
    promptSecondsLeft,
    countdownSecondsLeft,
    continueWorking,
    clockOutNow,
  } = useWorkdayEndAutomation({ employeeId, enabled });

  return (
    <WorkdayEndModal
      isOpen={isOpen}
      phase={phase}
      promptSecondsLeft={promptSecondsLeft}
      countdownSecondsLeft={countdownSecondsLeft}
      onContinueWorking={continueWorking}
      onClockOutNow={clockOutNow}
    />
  );
};

export default WorkdayEndMonitor;
