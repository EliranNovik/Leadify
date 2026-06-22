export type ClockInOptInKind = 'overtime' | 'workday_end';

const BROADCAST_CHANNEL_NAME = 'clock-in-opt-in-v1';

type ClockInOptInMessage = {
  kind: ClockInOptInKind;
  dateKey: string;
  employeeId: number | null;
};

let broadcastChannel: BroadcastChannel | null = null;

function getBroadcastChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
    return null;
  }
  if (!broadcastChannel) {
    broadcastChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
  }
  return broadcastChannel;
}

/** Notify all tabs that the user opted to continue working (overtime or past workday end). */
export function broadcastClockInOptIn(
  kind: ClockInOptInKind,
  dateKey: string,
  employeeId: number | null | undefined,
): void {
  const message: ClockInOptInMessage = {
    kind,
    dateKey,
    employeeId: employeeId ?? null,
  };

  try {
    getBroadcastChannel()?.postMessage(message);
  } catch {
    // ignore unsupported / closed channel
  }
}

export function subscribeClockInOptIn(
  onOptIn: (message: ClockInOptInMessage) => void,
): () => void {
  if (typeof window === 'undefined') return () => {};

  const channel = getBroadcastChannel();
  const onChannelMessage = (event: MessageEvent<ClockInOptInMessage>) => {
    const data = event.data;
    if (!data?.kind || !data?.dateKey) return;
    onOptIn(data);
  };

  const onStorage = (event: StorageEvent) => {
    if (!event.key || event.newValue !== '1') return;

    if (event.key.startsWith('clock_in_overtime_continue_')) {
      onOptIn({
        kind: 'overtime',
        dateKey: event.key.replace('clock_in_overtime_continue_', ''),
        employeeId: null,
      });
      return;
    }

    if (event.key.startsWith('clock_in_workday_end_continue_')) {
      onOptIn({
        kind: 'workday_end',
        dateKey: event.key.replace('clock_in_workday_end_continue_', ''),
        employeeId: null,
      });
    }
  };

  channel?.addEventListener('message', onChannelMessage);
  window.addEventListener('storage', onStorage);

  return () => {
    channel?.removeEventListener('message', onChannelMessage);
    window.removeEventListener('storage', onStorage);
  };
}

export function readClockInOptInFlag(storageKey: string): boolean {
  try {
    if (localStorage.getItem(storageKey) === '1') return true;
    // Legacy: same-tab sessionStorage before cross-tab fix
    if (sessionStorage.getItem(storageKey) === '1') return true;
  } catch {
    // ignore quota / private mode
  }
  return false;
}

export function writeClockInOptInFlag(storageKey: string): void {
  try {
    localStorage.setItem(storageKey, '1');
    sessionStorage.setItem(storageKey, '1');
  } catch {
    // ignore quota errors
  }
}
