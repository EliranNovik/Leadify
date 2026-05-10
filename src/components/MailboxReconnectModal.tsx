import React, { useState, useCallback } from 'react';
import { useMailboxReconnect } from '../contexts/MailboxReconnectContext';
import { getMailboxLoginUrl, runMailboxCatchUpSync } from '../lib/mailboxApi';
import { useLocation } from 'react-router-dom';
import { XMarkIcon, EnvelopeIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import { useAuthContext } from '../contexts/AuthContext';
import toast from 'react-hot-toast';

const DISMISS_KEY_PREFIX = 'mailbox_oos_dismiss_until_v1_';

const MailboxReconnectModal: React.FC = () => {
  const {
    isModalOpen,
    hideReconnectModal,
    errorMessage,
    isSyncPromptOpen,
    hideSyncPrompt,
    syncPromptMessage,
  } = useMailboxReconnect();
  const location = useLocation();
  const { user } = useAuthContext();
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const handleReconnect = useCallback(async () => {
    if (!user?.id) {
      toast.error('Please sign in to reconnect your mailbox.');
      return;
    }

    try {
      setIsConnecting(true);
      const redirectTo = `${window.location.origin}${location.pathname}${location.search}`;
      const url = await getMailboxLoginUrl(user.id, redirectTo);
      const popup = window.open(url, '_blank', 'width=640,height=780');
      if (!popup) {
        window.location.href = url;
      } else {
        hideReconnectModal();
        toast.success('Please complete the connection in the popup window.');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to initiate mailbox connection';
      toast.error(message);
      console.error('Mailbox reconnect error:', error);
    } finally {
      setIsConnecting(false);
    }
  }, [user?.id, location.pathname, location.search, hideReconnectModal]);

  const handleSyncNow = useCallback(async () => {
    if (!user?.id) {
      toast.error('Please sign in to sync your mailbox.');
      return;
    }
    try {
      setIsSyncing(true);
      await runMailboxCatchUpSync(user.id);
      hideSyncPrompt();
      toast.success('Mailbox sync started. Email may take a minute to appear.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sync failed';
      toast.error(message);
    } finally {
      setIsSyncing(false);
    }
  }, [user?.id, hideSyncPrompt]);

  const handleRemindLater = useCallback(() => {
    if (user?.id) {
      try {
        localStorage.setItem(DISMISS_KEY_PREFIX + user.id, String(Date.now() + 4 * 60 * 60 * 1000));
      } catch {
        /* ignore */
      }
    }
    hideSyncPrompt();
  }, [user?.id, hideSyncPrompt]);

  if (!isModalOpen && !isSyncPromptOpen) return null;

  return (
    <>
      {isModalOpen ? (
        <div className="fixed inset-0 z-[10010] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-md w-full mx-4 p-6 relative">
            <button
              onClick={hideReconnectModal}
              className="absolute top-4 right-4 btn btn-sm btn-circle btn-ghost"
              aria-label="Close"
            >
              <XMarkIcon className="w-5 h-5" />
            </button>

            <div className="flex justify-center mb-4">
              <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/20 flex items-center justify-center">
                <EnvelopeIcon className="w-8 h-8 text-red-600 dark:text-red-400" />
              </div>
            </div>

            <h2 className="text-2xl font-bold text-center mb-2 text-gray-900 dark:text-white">
              Mailbox Connection Expired
            </h2>

            <p className="text-gray-600 dark:text-gray-300 text-center mb-6">
              {errorMessage ||
                'Your mailbox connection has expired. Please reconnect to continue sending and receiving emails.'}
            </p>

            <div className="flex gap-3">
              <button onClick={hideReconnectModal} className="btn btn-outline flex-1" disabled={isConnecting}>
                Cancel
              </button>
              <button onClick={handleReconnect} className="btn btn-primary flex-1" disabled={isConnecting}>
                {isConnecting ? (
                  <>
                    <span className="loading loading-spinner loading-sm"></span>
                    Connecting...
                  </>
                ) : (
                  <>
                    <EnvelopeIcon className="w-5 h-5" />
                    Reconnect Mailbox
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isSyncPromptOpen ? (
        <div className="fixed inset-0 z-[10010] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-md w-full mx-4 p-6 relative">
            <button
              onClick={handleRemindLater}
              className="absolute top-4 right-4 btn btn-sm btn-circle btn-ghost"
              aria-label="Close"
            >
              <XMarkIcon className="w-5 h-5" />
            </button>

            <div className="flex justify-center mb-4">
              <div className="w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-900/20 flex items-center justify-center">
                <ArrowPathIcon className="w-8 h-8 text-amber-700 dark:text-amber-300" />
              </div>
            </div>

            <h2 className="text-2xl font-bold text-center mb-2 text-gray-900 dark:text-white">
              Mailbox may be out of sync
            </h2>

            <p className="text-gray-600 dark:text-gray-300 text-center mb-6">
              {syncPromptMessage ||
                'Your CRM mailbox sync is behind or the email webhook needs refreshing. Sync now to pull the latest mail from Microsoft.'}
            </p>

            <div className="flex flex-col sm:flex-row gap-3">
              <button type="button" onClick={handleRemindLater} className="btn btn-outline flex-1" disabled={isSyncing}>
                Remind me later
              </button>
              <button type="button" onClick={handleSyncNow} className="btn btn-primary flex-1" disabled={isSyncing}>
                {isSyncing ? (
                  <>
                    <span className="loading loading-spinner loading-sm"></span>
                    Syncing…
                  </>
                ) : (
                  <>
                    <ArrowPathIcon className="w-5 h-5" />
                    Sync mailbox now
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
};

export default MailboxReconnectModal;
