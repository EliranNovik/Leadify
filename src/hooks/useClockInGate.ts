import { useContext } from 'react';
import { ClockInGateContext } from '../contexts/clockInGateContextValue';

export function useClockInGate() {
  const ctx = useContext(ClockInGateContext);
  if (!ctx) {
    throw new Error('useClockInGate must be used within ClockInGateProvider');
  }
  return ctx;
}

export function useOptionalClockInGate() {
  return useContext(ClockInGateContext);
}
