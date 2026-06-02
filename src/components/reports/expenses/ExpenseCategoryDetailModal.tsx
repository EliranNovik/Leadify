import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { XMarkIcon } from '@heroicons/react/24/outline';

type ExpenseCategoryDetailModalProps = {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
};

const ExpenseCategoryDetailModal: React.FC<ExpenseCategoryDetailModalProps> = ({
  open,
  onClose,
  children,
}) => {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[20000] flex flex-col bg-base-100" role="dialog" aria-modal="true">
      <div className="flex shrink-0 justify-end border-b border-base-300 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-6">
        <button
          type="button"
          className="btn btn-ghost btn-sm gap-2 sm:btn-md"
          onClick={onClose}
          aria-label="Close"
        >
          <XMarkIcon className="h-5 w-5" />
          Close
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-6">
        {children}
      </div>
    </div>,
    document.body,
  );
};

export default ExpenseCategoryDetailModal;
