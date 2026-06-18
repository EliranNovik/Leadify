import React from 'react';
import { createPortal } from 'react-dom';
import { ClockIcon, ExclamationTriangleIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { formatCountdownSeconds } from '../lib/employeeClockInOvertime';
import { formatWorkdayEndTimeLabel } from '../lib/employeeClockInWorkdayEnd';
import type { WorkdayEndPhase } from '../hooks/useWorkdayEndAutomation';

interface WorkdayEndModalProps {
  isOpen: boolean;
  phase: WorkdayEndPhase;
  promptSecondsLeft: number;
  countdownSecondsLeft: number;
  onContinueWorking: () => void;
  onClockOutNow: () => void;
}

const WorkdayEndModal: React.FC<WorkdayEndModalProps> = ({
  isOpen,
  phase,
  promptSecondsLeft,
  countdownSecondsLeft,
  onContinueWorking,
  onClockOutNow,
}) => {
  if (!isOpen || typeof window === 'undefined') return null;

  const isFinalCountdown = phase === 'final_countdown';
  const isProcessing = phase === 'processing';
  const workdayEndLabel = formatWorkdayEndTimeLabel();

  return createPortal(
    <div className="fixed inset-0 z-[10071] flex items-center justify-center bg-black/55 p-4">
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="workday-end-title"
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-base-200">
          <div className="flex items-start gap-3 min-w-0">
            <span
              className={`inline-flex items-center justify-center w-10 h-10 rounded-full shrink-0 ${
                isFinalCountdown ? 'bg-red-100 text-red-700' : 'bg-indigo-100 text-indigo-700'
              }`}
            >
              {isFinalCountdown ? (
                <ExclamationTriangleIcon className="w-5 h-5" />
              ) : (
                <ClockIcon className="w-5 h-5" />
              )}
            </span>
            <div className="min-w-0">
              <h3 id="workday-end-title" className="text-lg font-semibold text-gray-900">
                {isFinalCountdown ? 'Clocking out soon' : `${workdayEndLabel} reached`}
              </h3>
              <p className="text-sm text-gray-600 mt-0.5">End of standard workday</p>
            </div>
          </div>
          {!isFinalCountdown && !isProcessing && (
            <button
              type="button"
              className="btn btn-ghost btn-sm btn-circle shrink-0"
              onClick={onContinueWorking}
              aria-label="Continue working"
            >
              <XMarkIcon className="w-5 h-5" />
            </button>
          )}
        </div>

        <div className="px-5 py-4 space-y-4">
          {isProcessing ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <span className="loading loading-spinner loading-lg text-primary" />
              <p className="text-sm text-gray-600">Clocking you out and signing you out…</p>
            </div>
          ) : isFinalCountdown ? (
            <>
              <p className="text-sm text-gray-700 leading-relaxed">
                No response received. You will be clocked out and signed out automatically.
              </p>
              <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-center">
                <p className="text-xs font-semibold uppercase tracking-wide text-red-700">
                  Auto clock-out in
                </p>
                <p className="text-3xl font-bold text-red-700 tabular-nums mt-1">
                  {formatCountdownSeconds(countdownSecondsLeft)}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-primary w-full"
                onClick={onContinueWorking}
              >
                Continue working
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-gray-700 leading-relaxed">
                It is {workdayEndLabel}. Do you wish to continue working?
              </p>
              <div className="rounded-xl bg-indigo-50 border border-indigo-200 px-4 py-3 text-center">
                <p className="text-xs font-semibold uppercase tracking-wide text-indigo-800">
                  Respond within
                </p>
                <p className="text-3xl font-bold text-indigo-900 tabular-nums mt-1">
                  {formatCountdownSeconds(promptSecondsLeft)}
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  type="button"
                  className="btn btn-primary flex-1"
                  onClick={onContinueWorking}
                >
                  Continue working
                </button>
                <button
                  type="button"
                  className="btn btn-outline flex-1"
                  onClick={onClockOutNow}
                >
                  Clock out now
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default WorkdayEndModal;
