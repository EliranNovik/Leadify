import React, { createContext, useContext, useState, ReactNode } from 'react';

interface MailboxReconnectContextType {
  showReconnectModal: (message?: string) => void;
  hideReconnectModal: () => void;
  isModalOpen: boolean;
  errorMessage: string | null;
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

  const showReconnectModal = (message?: string) => {
    setErrorMessage(message || null);
    setIsModalOpen(true);
  };

  const hideReconnectModal = () => {
    setIsModalOpen(false);
    setErrorMessage(null);
  };

  return (
    <MailboxReconnectContext.Provider
      value={{
        showReconnectModal,
        hideReconnectModal,
        isModalOpen,
        errorMessage,
      }}
    >
      {children}
    </MailboxReconnectContext.Provider>
  );
};
