import { useEffect, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuthContext } from '../contexts/AuthContext';
import { useMailboxReconnect } from '../contexts/MailboxReconnectContext';
import { getMailboxStatus, runMailboxCatchUpSync } from '../lib/mailboxApi';

const DISMISS_KEY_PREFIX = 'mailbox_oos_dismiss_until_v1_';
const CATCHUP_KEY_PREFIX = 'mailbox_session_catchup_v1_';
const RECONNECT_PROMPT_KEY_PREFIX = 'mailbox_reconnect_prompted_v1_';
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

function cleanMsalQuery() {
  const params = new URLSearchParams(window.location.search);
  params.delete('msal');
  params.delete('mailbox');
  params.delete('expected');
  params.delete('mailbox_error');
  const next = params.toString();
  const url = `${window.location.pathname}${next ? `?${next}` : ''}${window.location.hash || ''}`;
  window.history.replaceState({}, '', url);
}

/**
 * Polls mailbox status and prompts the user to sync when the backend reports `needsMailboxSync`.
 * Also prompts reconnect when the mailbox token is missing or marked needs_reconnect.
 */
const MailboxHealthMonitor = () => {
  const { user } = useAuthContext();
  const { showSyncPrompt, showReconnectModal, clearMailboxConnectPending, markMailboxConnectPending } =
    useMailboxReconnect();
  const location = useLocation();
  const userId = user?.id ?? null;
  const catchupAttemptedRef = useRef<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const msal = params.get('msal');
    if (!msal) return;

    if (msal === 'success') {
      const mailbox = params.get('mailbox');
      toast.success(mailbox ? `Mailbox ${mailbox} connected` : 'Mailbox connected');
      cleanMsalQuery();
      clearMailboxConnectPending();
      if (userId) {
        try {
          sessionStorage.removeItem(RECONNECT_PROMPT_KEY_PREFIX + userId);
        } catch {
          /* ignore */
        }
        void runMailboxCatchUpSync(userId).catch((e) => {
          console.warn('Post-mailbox-connect: subscription or sync failed', e);
        });
      }
      return;
    }

    if (msal === 'mismatch') {
      const expected = params.get('expected') || 'your CRM email';
      toast.error(`That Microsoft account does not match ${expected}. Sign in as that mailbox.`);
      cleanMsalQuery();
      showReconnectModal(`Sign in to Outlook as ${expected} so this CRM user syncs the right mailbox.`);
      return;
    }

    if (msal === 'mailbox_needed' || msal === 'error') {
      cleanMsalQuery();
      showReconnectModal(
        'Connect your Outlook mailbox so emails sync automatically. Use the same Microsoft account as your CRM email.',
      );
    }
  }, [location.search, userId, showReconnectModal, clearMailboxConnectPending]);

  const evaluate = useCallback(async () => {
    if (!userId) return;
    if (location.pathname === '/login') return;
    if (new URLSearchParams(location.search).get('msal')) return;

    let status: Record<string, unknown>;
    try {
      status = (await getMailboxStatus(userId)) as Record<string, unknown>;
    } catch {
      return;
    }

    const needsReconnect = Boolean(status.needsReconnect) || !status.connected;
    if (!needsReconnect) {
      clearMailboxConnectPending();
    } else {
      try {
        if (sessionStorage.getItem(RECONNECT_PROMPT_KEY_PREFIX + userId)) {
          markMailboxConnectPending();
          return;
        }
        sessionStorage.setItem(RECONNECT_PROMPT_KEY_PREFIX + userId, '1');
      } catch {
        /* ignore */
      }
      const mailbox = typeof status.mailbox === 'string' ? status.mailbox : '';
      showReconnectModal(
        status.connected === false && mailbox
          ? 'Your mailbox connection needs to be renewed. Reconnect so email sync can continue.'
          : 'Connect your Outlook mailbox so emails sync automatically. Use the same Microsoft account as your CRM email.',
      );
      return;
    }

    if (!status.needsMailboxSync) return;

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
      if (!status.connected || status.needsReconnect || !status.needsMailboxSync) return;
    }

    try {
      sessionStorage.setItem(LAST_PROMPT_KEY_PREFIX + userId, String(Date.now()));
    } catch {
      /* ignore */
    }
    showSyncPrompt(buildOutOfSyncMessage(status));
  }, [userId, location.pathname, showSyncPrompt, showReconnectModal, clearMailboxConnectPending, markMailboxConnectPending]);

  useEffect(() => {
    catchupAttemptedRef.current = null;
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    void evaluate();
    const t = window.setInterval(() => void evaluate(), POLL_MS);
    const onResume = () => {
      if (document.visibilityState === 'hidden') return;
      void evaluate();
    };
    window.addEventListener('focus', onResume);
    document.addEventListener('visibilitychange', onResume);
    return () => {
      window.clearInterval(t);
      window.removeEventListener('focus', onResume);
      document.removeEventListener('visibilitychange', onResume);
    };
  }, [userId, evaluate]);

  return null;
};

export default MailboxHealthMonitor;
