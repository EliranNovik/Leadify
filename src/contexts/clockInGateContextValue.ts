import { createContext } from 'react';
import type { ClockInGateStatus } from '../lib/employeeClockInGate';

export type ClockInGateContextValue = {
  status: ClockInGateStatus;
  employeeId: number | null;
  isGateOpen: boolean;
  adminBypassActive: boolean;
  refreshClockInGate: () => Promise<void>;
};

export const ClockInGateContext = createContext<ClockInGateContextValue | null>(null);
