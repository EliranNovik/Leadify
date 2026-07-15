import React from 'react';
import { createPortal } from 'react-dom';
import { ClipboardDocumentCheckIcon, XMarkIcon } from '@heroicons/react/24/outline';
import HrApprovalsPanel from './hr/HrApprovalsPanel';

interface ManualClockInApprovalModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpdated?: () => void;
}

/**
 * Full-screen approvals modal (manual clock-ins, WFH, and leave).
 * Body delegates to {@link HrApprovalsPanel} so Dashboard and HR hub share one queue.
 */
const ManualClockInApprovalModal: React.FC<ManualClockInApprovalModalProps> = ({
  isOpen,
  onClose,
  onUpdated,
}) => {
  if (!isOpen || typeof window === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex flex-col bg-[#ececec]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="hr-approvals-modal-title"
    >
      <div className="flex items-start justify-between gap-4 px-5 py-4 shrink-0 bg-white border-b border-gray-200">
        <div>
          <h2
            id="hr-approvals-modal-title"
            className="text-xl font-bold flex items-center gap-2 text-gray-900"
          >
            <ClipboardDocumentCheckIcon className="w-6 h-6 text-emerald-700" />
            HR Approvals
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Manual clock-ins, home access, and leave requests
          </p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm btn-circle" onClick={onClose}>
          <XMarkIcon className="w-5 h-5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-5">
        <div className="max-w-5xl mx-auto">
          <HrApprovalsPanel
            embedded
            onUpdated={() => {
              onUpdated?.();
            }}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default ManualClockInApprovalModal;
