import React from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';

interface ExpertOpinionModalProps {
  isOpen: boolean;
  onClose: () => void;
  leadName: string;
  opinionText: string;
}

const ExpertOpinionModal: React.FC<ExpertOpinionModalProps> = ({
  isOpen,
  onClose,
  leadName,
  opinionText,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Expert Opinion</h3>
            <p className="text-sm text-gray-500">{leadName}</p>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-circle"
            onClick={onClose}
            aria-label="Close expert opinion modal"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
          <div className="whitespace-pre-wrap break-words text-sm text-gray-900">
            {opinionText || '---'}
          </div>
        </div>

        <div className="flex justify-end border-t border-gray-200 px-5 py-3">
          <button type="button" className="btn btn-primary btn-sm" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default ExpertOpinionModal;
