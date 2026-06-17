import React from 'react';
import { createPortal } from 'react-dom';
import { ClockIcon, XMarkIcon } from '@heroicons/react/24/outline';

type SignOutClockOutModalProps = {
  isOpen: boolean;
  clockInTime: string;
  isProcessing?: boolean;
  onClockOutAndSignOut: () => void;
  onSignOutOnly: () => void;
  onCancel: () => void;
};

function formatClockInLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

const SignOutClockOutModal: React.FC<SignOutClockOutModalProps> = ({
  isOpen,
  clockInTime,
  isProcessing = false,
  onClockOutAndSignOut,
  onSignOutOnly,
  onCancel,
}) => {
  if (!isOpen) return null;

  const clockInLabel = formatClockInLabel(clockInTime);

  return createPortal(
    <div
      className="fixed inset-0 z-[10060] flex items-center justify-center p-4"
      role="presentation"
    >
      <div
        className="fixed inset-0 bg-black/50"
        onClick={isProcessing ? undefined : onCancel}
        aria-hidden="true"
      />
      <div
        className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl p-6 md:p-7"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sign-out-clock-out-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="absolute top-4 right-4 btn btn-ghost btn-sm btn-circle"
          onClick={onCancel}
          disabled={isProcessing}
          aria-label="Close"
        >
          <XMarkIcon className="w-5 h-5" />
        </button>

        <div className="flex items-start gap-3 pr-8 mb-4">
          <div className="w-11 h-11 rounded-full bg-gradient-to-br from-purple-600 to-indigo-500 flex items-center justify-center shrink-0">
            <ClockIcon className="w-6 h-6 text-white" aria-hidden />
          </div>
          <div>
            <h2 id="sign-out-clock-out-title" className="text-lg font-semibold text-gray-900">
              Still clocked in
            </h2>
            <p className="mt-1 text-sm text-gray-600 leading-relaxed">
              {clockInLabel
                ? `You clocked in at ${clockInLabel}. Would you like to clock out before signing out?`
                : 'You are still clocked in. Would you like to clock out before signing out?'}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          <button
            type="button"
            className="btn btn-primary w-full"
            onClick={onClockOutAndSignOut}
            disabled={isProcessing}
          >
            {isProcessing ? (
              <span className="loading loading-spinner loading-sm" />
            ) : (
              'Clock out & sign out'
            )}
          </button>
          <button
            type="button"
            className="btn btn-outline w-full"
            onClick={onSignOutOnly}
            disabled={isProcessing}
          >
            Sign out without clocking out
          </button>
          <button
            type="button"
            className="btn btn-ghost w-full text-gray-600"
            onClick={onCancel}
            disabled={isProcessing}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default SignOutClockOutModal;
