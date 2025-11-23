import React from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import WhatsAppPage from '../pages/WhatsAppPage';

interface WhatsAppModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedContact?: {
    contact: any;
    leadId: string | number;
    leadType: 'legacy' | 'new';
  } | null;
}

const WhatsAppModal: React.FC<WhatsAppModalProps> = ({ isOpen, onClose, selectedContact }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] bg-white">
      {/* Custom close button overlay */}
      <div className="absolute top-4 right-4 z-[10000]">
        <button
          onClick={onClose}
          className="btn btn-circle btn-ghost bg-white/80 backdrop-blur-sm hover:bg-white text-gray-700 hover:text-gray-900 shadow-lg"
        >
          <XMarkIcon className="w-6 h-6" />
        </button>
      </div>
      
      {/* WhatsApp Page */}
      <WhatsAppPage selectedContact={selectedContact} />
    </div>
  );
};

export default WhatsAppModal;
