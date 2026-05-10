import React, { createContext, useContext, useState, ReactNode } from 'react';

interface MailboxReconnectContextType {
  showReconnectModal: (message?: string) => void;
  hideReconnectModal: () => void;
  isModalOpen: boolean;
  errorMessage: string | null;
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
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSyncPromptOpen, setIsSyncPromptOpen] = useState(false);
  const [syncPromptMessage, setSyncPromptMessage] = useState<string | null>(null);

  const showReconnectModal = (message?: string) => {
    setErrorMessage(message || null);
    setIsModalOpen(true);
  };

  const hideReconnectModal = () => {
    setIsModalOpen(false);
    setErrorMessage(null);
  };

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
