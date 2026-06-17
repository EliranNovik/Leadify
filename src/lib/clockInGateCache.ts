import type { ClockInGateStatus } from './employeeClockInGate';

const CACHE_KEY = 'clock_in_gate_v1';

type ClockInGateCacheEntry = {
  userId: string;
  status: ClockInGateStatus;
  employeeId: number | null;
};

function isResolvedStatus(status: ClockInGateStatus): status is Exclude<ClockInGateStatus, 'loading'> {
  return status !== 'loading';
}

export function readClockInGateCache(userId: string): ClockInGateCacheEntry | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ClockInGateCacheEntry;
    if (parsed.userId !== userId || !isResolvedStatus(parsed.status)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeClockInGateCache(
  userId: string,
  status: ClockInGateStatus,
  employeeId: number | null,
): void {
  if (typeof window === 'undefined' || !isResolvedStatus(status)) return;
  try {
    const entry: ClockInGateCacheEntry = { userId, status, employeeId };
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    // ignore quota / private mode
  }
}

export function clearClockInGateCache(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(CACHE_KEY);
  } catch {
    // ignore
  }
}
