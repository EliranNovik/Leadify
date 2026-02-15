import React, { useState, useCallback } from 'react';
import { useMailboxReconnect } from '../contexts/MailboxReconnectContext';
import { getMailboxLoginUrl } from '../lib/mailboxApi';
import { useLocation } from 'react-router-dom';
import { XMarkIcon, EnvelopeIcon } from '@heroicons/react/24/outline';
import { useAuthContext } from '../contexts/AuthContext';
import toast from 'react-hot-toast';

const MailboxReconnectModal: React.FC = () => {
  const { isModalOpen, hideReconnectModal, errorMessage } = useMailboxReconnect();
  const location = useLocation();
  const { user } = useAuthContext();
  const [isConnecting, setIsConnecting] = useState(false);

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
        // Close modal when popup opens
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

  if (!isModalOpen) return null;

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-md w-full mx-4 p-6 relative">
        {/* Close button */}
        <button
          onClick={hideReconnectModal}
          className="absolute top-4 right-4 btn btn-sm btn-circle btn-ghost"
          aria-label="Close"
        >
          <XMarkIcon className="w-5 h-5" />
        </button>

        {/* Icon */}
        <div className="flex justify-center mb-4">
          <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/20 flex items-center justify-center">
            <EnvelopeIcon className="w-8 h-8 text-red-600 dark:text-red-400" />
          </div>
        </div>

        {/* Title */}
        <h2 className="text-2xl font-bold text-center mb-2 text-gray-900 dark:text-white">
          Mailbox Connection Expired
        </h2>

        {/* Message */}
        <p className="text-gray-600 dark:text-gray-300 text-center mb-6">
          {errorMessage || 'Your mailbox connection has expired. Please reconnect to continue sending and receiving emails.'}
        </p>

        {/* Action buttons */}
        <div className="flex gap-3">
          <button
            onClick={hideReconnectModal}
            className="btn btn-outline flex-1"
            disabled={isConnecting}
          >
            Cancel
          </button>
          <button
            onClick={handleReconnect}
            className="btn btn-primary flex-1"
            disabled={isConnecting}
          >
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
  );
};

export default MailboxReconnectModal;
