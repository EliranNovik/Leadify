import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { useAuthContext } from './AuthContext';

const PENDING_KEY_PREFIX = 'mailbox_connect_pending_v1_';

interface MailboxReconnectContextType {
  showReconnectModal: (message?: string) => void;
  hideReconnectModal: () => void;
  isModalOpen: boolean;
  errorMessage: string | null;
  mailboxConnectPending: boolean;
  markMailboxConnectPending: () => void;
  clearMailboxConnectPending: () => void;
  /** Out-of-sync prompt: stale last sync or expired webhook subscription (backend flags). */
  showSyncPrompt: (message?: string) => void;
  hideSyncPrompt: () => void;
  isSyncPromptOpen: boolean;
  syncPromptMessage: string | null;
}

const MailboxReconnectContext = createContext<MailboxReconnectContextType | undefined>(undefined);

export const useMailboxReconnect = () => {
  const context = useContext(MailboxReconnectContext);
  if (!context) {
    throw new Error('useMailboxReconnect must be used within a MailboxReconnectProvider');
  }
  return context;
};

interface MailboxReconnectProviderProps {
  children: ReactNode;
}

export const MailboxReconnectProvider: React.FC<MailboxReconnectProviderProps> = ({ children }) => {
  const { user } = useAuthContext();
  const userId = user?.id ?? null;
  const pendingKey = userId ? PENDING_KEY_PREFIX + userId : null;

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [mailboxConnectPending, setMailboxConnectPending] = useState(false);
  const [isSyncPromptOpen, setIsSyncPromptOpen] = useState(false);
  const [syncPromptMessage, setSyncPromptMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!pendingKey) {
      setMailboxConnectPending(false);
      return;
    }
    try {
      setMailboxConnectPending(sessionStorage.getItem(pendingKey) === '1');
    } catch {
      setMailboxConnectPending(false);
    }
  }, [pendingKey]);

  const markPending = useCallback(() => {
    setMailboxConnectPending(true);
    if (!pendingKey) return;
    try {
      sessionStorage.setItem(pendingKey, '1');
    } catch {
      /* ignore */
    }
  }, [pendingKey]);

  const showReconnectModal = useCallback((message?: string) => {
    if (message) setErrorMessage(message);
    markPending();
    setIsModalOpen(true);
  }, [markPending]);

  const hideReconnectModal = useCallback(() => {
    setIsModalOpen(false);
  }, []);

  const clearMailboxConnectPending = useCallback(() => {
    setMailboxConnectPending(false);
    setIsModalOpen(false);
    setErrorMessage(null);
    if (!pendingKey) return;
    try {
      sessionStorage.removeItem(pendingKey);
    } catch {
      /* ignore */
    }
  }, [pendingKey]);

  const showSyncPrompt = (message?: string) => {
    setSyncPromptMessage(message || null);
    setIsSyncPromptOpen(true);
  };

  const hideSyncPrompt = () => {
    setIsSyncPromptOpen(false);
    setSyncPromptMessage(null);
  };

  return (
    <MailboxReconnectContext.Provider
      value={{
        showReconnectModal,
        hideReconnectModal,
        isModalOpen,
        errorMessage,
        mailboxConnectPending,
        markMailboxConnectPending: markPending,
        clearMailboxConnectPending,
        showSyncPrompt,
        hideSyncPrompt,
        isSyncPromptOpen,
        syncPromptMessage,
      }}
    >
      {children}
    </MailboxReconnectContext.Provider>
  );
};
