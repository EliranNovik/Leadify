import { useEffect } from 'react';
import {
  PRESENCE_HEARTBEAT_MS,
  sendClockInPresenceHeartbeat,
} from '../lib/employeeClockInPresence';

type UseClockInPresenceHeartbeatOptions = {
  employeeId: number | null;
  enabled: boolean;
};

export function useClockInPresenceHeartbeat({
  employeeId,
  enabled,
}: UseClockInPresenceHeartbeatOptions): void {
  useEffect(() => {
    if (!enabled || employeeId == null) return undefined;

    const ping = () => {
      void sendClockInPresenceHeartbeat(employeeId);
    };

    ping();

    const interval = window.setInterval(ping, PRESENCE_HEARTBEAT_MS);

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        ping();
      }
    };

    window.addEventListener('focus', ping);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', ping);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [employeeId, enabled]);
}
