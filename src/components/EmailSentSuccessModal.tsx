import React from 'react';
import { createPortal } from 'react-dom';
import { EnvelopeIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { CheckCircleIcon } from '@heroicons/react/24/solid';

type EmailSentSuccessModalProps = {
  open: boolean;
  onClose: () => void;
  recipient?: string | null;
};

const EmailSentSuccessModal: React.FC<EmailSentSuccessModalProps> = ({
  open,
  onClose,
  recipient,
}) => {
  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[10060] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="email-sent-success-title"
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-end">
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-circle"
            onClick={onClose}
            aria-label="Close"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
        <div className="flex flex-col items-center px-2 pb-2 text-center">
          <div className="relative mb-4">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
              <EnvelopeIcon className="h-8 w-8" aria-hidden />
            </span>
            <CheckCircleIcon
              className="absolute -bottom-0.5 -right-0.5 h-7 w-7 rounded-full bg-white text-emerald-500"
              aria-hidden
            />
          </div>
          <h3 id="email-sent-success-title" className="text-xl font-semibold text-gray-900">
            Email sent
          </h3>
          <p className="mt-1.5 text-sm leading-relaxed text-gray-500">
            {recipient?.trim()
              ? `Your message was sent successfully to ${recipient.trim()}.`
              : 'Your message was sent successfully.'}
          </p>
          <button
            type="button"
            className="btn btn-primary mt-6 w-full rounded-full"
            onClick={onClose}
          >
            OK
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default EmailSentSuccessModal;
