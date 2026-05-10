import { useEffect, useRef, useCallback } from 'react';
import { useAuthContext } from '../contexts/AuthContext';
import { useMailboxReconnect } from '../contexts/MailboxReconnectContext';
import { getMailboxStatus, runMailboxCatchUpSync } from '../lib/mailboxApi';

const DISMISS_KEY_PREFIX = 'mailbox_oos_dismiss_until_v1_';
const CATCHUP_KEY_PREFIX = 'mailbox_session_catchup_v1_';
const DISMISS_MS = 4 * 60 * 60 * 1000;
const POLL_MS = 12 * 60 * 1000;
const PROMPT_THROTTLE_MS = 30 * 60 * 1000;
const LAST_PROMPT_KEY_PREFIX = 'mailbox_last_oos_prompt_v1_';

function readDismissUntil(userId: string): number {
  try {
    const raw = localStorage.getItem(DISMISS_KEY_PREFIX + userId);
    if (!raw) return 0;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function buildOutOfSyncMessage(status: Record<string, unknown>): string {
  const parts: string[] = [];
  if (status.syncStale) {
    parts.push('Your mailbox has not synced with the server recently.');
  }
  if (status.subscriptionMissingOrExpired && status.webhookConfigured) {
    parts.push('The email webhook subscription is missing or expired.');
  }
  if (parts.length === 0) {
    return 'Your mailbox may be out of sync with Microsoft.';
  }
  return parts.join(' ') + ' Sync now to refresh email in the CRM.';
}

/**
 * Polls mailbox status and prompts the user to sync when the backend reports `needsMailboxSync`.
 * Runs a one-time background catch-up per session when stale, then shows the modal if still stale.
 */
const MailboxHealthMonitor = () => {
  const { user } = useAuthContext();
  const { showSyncPrompt } = useMailboxReconnect();
  const userId = user?.id ?? null;
  const catchupAttemptedRef = useRef<string | null>(null);

  const evaluate = useCallback(async () => {
    if (!userId) return;
    let status: Record<string, unknown>;
    try {
      status = (await getMailboxStatus(userId)) as Record<string, unknown>;
    } catch {
      return;
    }
    if (!status.connected || !status.needsMailboxSync) return;

    const dismissUntil = readDismissUntil(userId);
    if (dismissUntil > Date.now()) return;

    try {
      const last = sessionStorage.getItem(LAST_PROMPT_KEY_PREFIX + userId);
      if (last && Date.now() - parseInt(last, 10) < PROMPT_THROTTLE_MS) return;
    } catch {
      /* ignore */
    }

    const catchupKey = CATCHUP_KEY_PREFIX + userId;
    if (catchupAttemptedRef.current !== userId && !sessionStorage.getItem(catchupKey)) {
      catchupAttemptedRef.current = userId;
      sessionStorage.setItem(catchupKey, '1');
      try {
        await runMailboxCatchUpSync(userId);
      } catch {
        // Fall through — modal still helps user retry manually
      }
      try {
        status = (await getMailboxStatus(userId)) as Record<string, unknown>;
      } catch {
        return;
      }
      if (!status.connected || !status.needsMailboxSync) return;
    }

    try {
      sessionStorage.setItem(LAST_PROMPT_KEY_PREFIX + userId, String(Date.now()));
    } catch {
      /* ignore */
    }
    showSyncPrompt(buildOutOfSyncMessage(status));
  }, [userId, showSyncPrompt]);

  useEffect(() => {
    catchupAttemptedRef.current = null;
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    void evaluate();
    const t = window.setInterval(() => void evaluate(), POLL_MS);
    return () => window.clearInterval(t);
  }, [userId, evaluate]);

  return null;
};

export default MailboxHealthMonitor;
