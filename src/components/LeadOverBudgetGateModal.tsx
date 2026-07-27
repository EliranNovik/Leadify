import React, { useMemo, useState } from 'react';
import {
  ChevronDownIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import {
  formatAllocationCostNis,
  formatAllocationWorkedDuration,
  type LeadEmployeeCostSummary,
} from '../lib/leadEmployeeCost';
import {
  getSalaryEmployeeInitials,
  salaryAvatarGradientStyle,
} from '../lib/employeeSalaries';

type Props = {
  open: boolean;
  summary: LeadEmployeeCostSummary | null;
  isSuperuser?: boolean;
  onRequestManagement: () => void;
  onSkip: () => void;
};

const LeadOverBudgetGateModal: React.FC<Props> = ({
  open,
  summary,
  isSuperuser = false,
  onRequestManagement,
  onSkip,
}) => {
  const [employeesExpanded, setEmployeesExpanded] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  React.useEffect(() => {
    if (!open) {
      setEmployeesExpanded(false);
      setInfoOpen(false);
    }
  }, [open]);

  if (!open || !summary) return null;

  const utilWidth = Math.min(100, Math.max(0, summary.utilizationPercent));
  const employees = summary.employees || [];

  return (
    <>
      <div className="modal modal-open z-[130]">
        <div className="modal-box relative max-w-md">
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-circle absolute right-3 top-3 text-gray-400 hover:text-gray-700"
            aria-label="Why this policy exists"
            onClick={() => setInfoOpen(true)}
          >
            <InformationCircleIcon className="h-5 w-5" />
          </button>

          <div className="mb-4 flex items-start gap-3 pr-8">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
              <ExclamationTriangleIcon className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900">Lead budget maxed out</h3>
              <p className="mt-1 text-sm text-gray-600">
                This lead is over budget and needs more funds before additional employee time
                should be spent.
              </p>
            </div>
          </div>

          <div className="mb-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                  Time spent
                </p>
                <p className="mt-0.5 text-lg font-bold text-gray-900">
                  {formatAllocationWorkedDuration(summary.totalWorkedMs)}
                </p>
              </div>
              <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">
                Maxed out
              </span>
            </div>

            <div className="mb-1 flex items-center justify-between text-xs text-gray-500">
              <span>Budget</span>
              <span className="font-semibold text-gray-700">
                {utilWidth.toFixed(utilWidth % 1 === 0 ? 0 : 1)}%
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full rounded-full bg-amber-500 transition-all"
                style={{ width: `${utilWidth}%` }}
              />
            </div>

            {isSuperuser ? (
              <p className="mt-3 text-sm font-semibold text-gray-900">
                {formatAllocationCostNis(summary.totalCostNis)}
                <span className="font-medium text-gray-500">
                  {' '}
                  / {formatAllocationCostNis(summary.maxAllowedCostNis)}
                </span>
              </p>
            ) : null}
          </div>

          {employees.length > 0 ? (
            <div className="mb-5">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 rounded-lg py-1.5 text-left text-sm font-medium text-gray-700 hover:text-gray-900"
                onClick={() => setEmployeesExpanded((prev) => !prev)}
                aria-expanded={employeesExpanded}
              >
                <span>
                  {employeesExpanded ? 'Less' : 'More'} · {employees.length} employee
                  {employees.length === 1 ? '' : 's'}
                </span>
                <ChevronDownIcon
                  className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${
                    employeesExpanded ? 'rotate-180' : ''
                  }`}
                />
              </button>
              {employeesExpanded ? (
                <ul className="mt-2 max-h-48 space-y-2 overflow-y-auto">
                  {employees.map((emp) => (
                    <li
                      key={emp.employeeId}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        {emp.photoUrl ? (
                          <img
                            src={emp.photoUrl}
                            alt=""
                            className="h-8 w-8 shrink-0 rounded-full object-cover"
                          />
                        ) : (
                          <span
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                            style={salaryAvatarGradientStyle(emp.employeeId, emp.employeeName)}
                          >
                            {getSalaryEmployeeInitials(emp.employeeName)}
                          </span>
                        )}
                        <div className="min-w-0">
                          <p className="truncate font-medium text-gray-900">{emp.employeeName}</p>
                          {emp.departmentName ? (
                            <p className="truncate text-xs text-gray-500">{emp.departmentName}</p>
                          ) : null}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="font-semibold text-gray-900">
                          {formatAllocationWorkedDuration(emp.workedMs)}
                        </p>
                        {isSuperuser ? (
                          <p className="text-xs text-gray-500">
                            {formatAllocationCostNis(emp.costNis)}
                          </p>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-col gap-2 sm:flex-row-reverse sm:items-center">
            <button
              type="button"
              className="btn flex-1 rounded-full border-0 bg-amber-500 px-6 text-white hover:bg-amber-600"
              onClick={onRequestManagement}
            >
              Management request
            </button>
            <button type="button" className="btn btn-ghost flex-1 rounded-full" onClick={onSkip}>
              Skip
            </button>
          </div>
        </div>
        <div className="modal-backdrop bg-black/50" onClick={onSkip} />
      </div>

      {infoOpen ? (
        <div className="modal modal-open z-[145]">
          <div className="modal-box relative max-w-lg">
            <button
              type="button"
              className="btn btn-ghost btn-sm btn-circle absolute right-3 top-3"
              aria-label="Close"
              onClick={() => setInfoOpen(false)}
            >
              <XMarkIcon className="h-5 w-5" />
            </button>
            <h3 className="pr-8 text-lg font-bold text-gray-900">Why this limit exists</h3>
            <div className="mt-3 space-y-3 text-sm leading-relaxed text-gray-600">
              <p>
                This is a management decision: every lead has a budget for employee time that
                must stay in proportion to the value of the case.
              </p>
              <p>
                Time spent on a lead is tracked and compared against that budget. When the limit
                is reached, further work should not continue automatically — the case needs a
                review so we do not invest more staff time than the lead can support.
              </p>
              <p>
                If more time is still required, use <span className="font-medium text-gray-800">Management request</span> to ask for an extension. Management can approve extra
                capacity without changing the lead’s commercial value. Skip opens the lead for
                now; the notice will appear again if the budget is still exceeded later.
              </p>
            </div>
            <div className="mt-6 flex justify-end">
              <button
                type="button"
                className="btn rounded-full border-0 bg-gray-900 px-6 text-white hover:bg-gray-800"
                onClick={() => setInfoOpen(false)}
              >
                Got it
              </button>
            </div>
          </div>
          <div className="modal-backdrop bg-black/40" onClick={() => setInfoOpen(false)} />
        </div>
      ) : null}
    </>
  );
};

type RequestModalProps = {
  open: boolean;
  summary: LeadEmployeeCostSummary | null;
  isSuperuser?: boolean;
  submitting?: boolean;
  onClose: () => void;
  onSubmit: (params: { requestedExtraMs: number; reason: string }) => void;
};

const HOUR_MS = 60 * 60 * 1000;
const MIN_HOURS = 0.25;
const MAX_HOURS = 40;

export const LeadBudgetExtensionRequestModal: React.FC<RequestModalProps> = ({
  open,
  summary,
  isSuperuser = false,
  submitting = false,
  onClose,
  onSubmit,
}) => {
  const [hours, setHours] = useState(1);
  const [reason, setReason] = useState('');

  const estimatedCost = useMemo(() => {
    if (!isSuperuser) return null;
    if (!summary || summary.totalWorkedMs <= 0 || summary.totalCostNis <= 0) return null;
    const ratePerMs = summary.totalCostNis / summary.totalWorkedMs;
    return Math.round(ratePerMs * hours * HOUR_MS * 100) / 100;
  }, [summary, hours, isSuperuser]);

  if (!open) return null;

  return (
    <div className="modal modal-open z-[140]">
      <div className="modal-box max-w-md">
        <h3 className="text-lg font-bold text-gray-900">Request more time</h3>
        <p className="mt-1 text-sm text-gray-600">
          Ask management for additional employee time on this lead. If approved, the budget max
          increases without changing the lead value.
        </p>

        <label className="mt-5 block">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-medium text-gray-700">Extra time</span>
            <span className="font-semibold text-gray-900">
              {hours % 1 === 0 ? hours : hours.toFixed(2)}h
              {isSuperuser && estimatedCost != null ? (
                <span className="ml-2 text-xs font-normal text-gray-500">
                  ≈ {formatAllocationCostNis(estimatedCost)}
                </span>
              ) : null}
            </span>
          </div>
          <input
            type="range"
            min={MIN_HOURS}
            max={MAX_HOURS}
            step={0.25}
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            className="range range-warning range-sm"
          />
          <div className="mt-1 flex justify-between text-[10px] text-gray-400">
            <span>{MIN_HOURS}h</span>
            <span>{MAX_HOURS}h</span>
          </div>
        </label>

        <label className="mt-4 block">
          <span className="mb-1.5 block text-sm font-medium text-gray-700">Reason</span>
          <textarea
            className="textarea textarea-bordered w-full text-sm"
            rows={3}
            placeholder="Why is more time needed?"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse">
          <button
            type="button"
            className="btn flex-1 rounded-full border-0 bg-amber-500 text-white hover:bg-amber-600"
            disabled={submitting || !reason.trim()}
            onClick={() =>
              onSubmit({
                requestedExtraMs: Math.round(hours * HOUR_MS),
                reason: reason.trim(),
              })
            }
          >
            {submitting ? (
              <span className="loading loading-spinner loading-sm" />
            ) : (
              'Send request'
            )}
          </button>
          <button
            type="button"
            className="btn btn-ghost flex-1 rounded-full"
            disabled={submitting}
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </div>
      <div className="modal-backdrop bg-black/40" onClick={submitting ? undefined : onClose} />
    </div>
  );
};

export default LeadOverBudgetGateModal;
