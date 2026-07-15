import React from 'react';
import {
  BanknotesIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  UsersIcon,
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

type LeadEmployeeCostModalProps = {
  open: boolean;
  onClose: () => void;
  loading: boolean;
  summary: LeadEmployeeCostSummary | null;
  /** When opened from the warning badge, emphasize the overrun. */
  mode?: 'overview' | 'warning';
  /** Cost amounts are only shown to superusers. */
  isSuperuser?: boolean;
};

function EmployeeAvatar({
  employeeId,
  employeeName,
  photoUrl,
}: {
  employeeId: number;
  employeeName: string;
  photoUrl: string | null;
}) {
  const [failed, setFailed] = React.useState(false);
  const url = photoUrl?.trim() || '';
  const showImage = Boolean(url) && !failed;

  React.useEffect(() => {
    setFailed(false);
  }, [url]);

  if (showImage) {
    return (
      <img
        src={url}
        alt=""
        className="h-9 w-9 shrink-0 rounded-full object-cover ring-2 ring-white"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <span
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ring-2 ring-white"
      style={salaryAvatarGradientStyle(employeeId, employeeName)}
      aria-hidden
    >
      {getSalaryEmployeeInitials(employeeName)}
    </span>
  );
}

export default function LeadEmployeeCostModal({
  open,
  onClose,
  loading,
  summary,
  mode = 'overview',
  isSuperuser = false,
}: LeadEmployeeCostModalProps) {
  if (!open) return null;

  const exceeds = summary?.exceedsCap === true;
  const showCosts = isSuperuser === true;
  const title =
    mode === 'warning' || exceeds
      ? showCosts
        ? 'Employee cost overrun'
        : 'Lead time overrun'
      : showCosts
        ? 'Employee cost on this case'
        : 'Time on this case';

  return (
    <div className="modal modal-open z-[120]">
      <div className="modal-box flex max-h-[85vh] max-w-3xl flex-col overflow-hidden p-0">
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-6 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {exceeds ? (
                <ExclamationTriangleIcon className="h-6 w-6 shrink-0 text-amber-600" />
              ) : showCosts ? (
                <BanknotesIcon className="h-6 w-6 shrink-0 text-emerald-600" />
              ) : (
                <ClockIcon className="h-6 w-6 shrink-0 text-emerald-600" />
              )}
              <h3 className="text-lg font-bold text-gray-900">{title}</h3>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-circle"
            onClick={onClose}
            aria-label="Close"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-gray-500">
              <span className="loading loading-spinner loading-md text-primary" />
              Loading…
            </div>
          ) : !summary || summary.employees.length === 0 ? (
            <div className="rounded-2xl bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">
              No employee time has been allocated to this lead yet.
            </div>
          ) : (
            <>
              <div
                className={`grid grid-cols-1 gap-3 ${
                  showCosts ? 'sm:grid-cols-3' : 'sm:grid-cols-2'
                }`}
              >
                <div className="rounded-2xl bg-gray-50 px-4 py-3 ring-1 ring-gray-100">
                  <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500">
                    <UsersIcon className="h-3.5 w-3.5" />
                    Employees
                  </p>
                  <p className="mt-1 text-xl font-bold text-gray-900">{summary.employees.length}</p>
                </div>
                <div className="rounded-2xl bg-gray-50 px-4 py-3 ring-1 ring-gray-100">
                  <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500">
                    <ClockIcon className="h-3.5 w-3.5" />
                    Time worked
                  </p>
                  <p className="mt-1 text-xl font-bold text-gray-900">
                    {formatAllocationWorkedDuration(summary.totalWorkedMs)}
                  </p>
                </div>
                {showCosts ? (
                  <div
                    className={`rounded-2xl px-4 py-3 ${
                      exceeds ? 'bg-amber-50' : 'bg-emerald-50'
                    }`}
                  >
                    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500">
                      <BanknotesIcon className="h-3.5 w-3.5" />
                      Total cost
                    </p>
                    <p
                      className={`mt-1 text-xl font-bold ${
                        exceeds ? 'text-amber-800' : 'text-emerald-800'
                      }`}
                    >
                      {formatAllocationCostNis(summary.totalCostNis)}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-500">
                      Max {formatAllocationCostNis(summary.maxAllowedCostNis)}
                    </p>
                  </div>
                ) : null}
              </div>

              {showCosts && exceeds ? (
                <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  Employee case handling cost exceeds the allowed{' '}
                  <span className="font-semibold">14% of 87%</span> of lead value (
                  {formatAllocationCostNis(summary.leadTotalValueNis)}).
                </div>
              ) : null}

              <div className="overflow-x-auto rounded-2xl border border-gray-100">
                <table className="table table-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-xs uppercase tracking-wider text-gray-500">
                      <th className="bg-transparent">Employee</th>
                      <th className="bg-transparent">Department</th>
                      <th className="bg-transparent text-right">Time</th>
                      {showCosts ? (
                        <>
                          <th className="bg-transparent text-right">Rate</th>
                          <th className="bg-transparent text-right">Cost</th>
                        </>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {summary.employees.map((row) => (
                      <tr key={row.employeeId} className="hover:bg-gray-50/80">
                        <td>
                          <div className="flex items-center gap-3">
                            <EmployeeAvatar
                              employeeId={row.employeeId}
                              employeeName={row.employeeName}
                              photoUrl={row.photoUrl}
                            />
                            <span className="font-medium text-gray-900">{row.employeeName}</span>
                          </div>
                        </td>
                        <td className="text-sm text-gray-500">
                          {row.departmentName || '—'}
                        </td>
                        <td className="text-right text-sm font-medium text-gray-900">
                          {formatAllocationWorkedDuration(row.workedMs)}
                        </td>
                        {showCosts ? (
                          <>
                            <td className="text-right text-sm text-gray-500">
                              {row.hourRateNis != null
                                ? `${formatAllocationCostNis(row.hourRateNis)}/h`
                                : '—'}
                            </td>
                            <td className="text-right text-sm font-semibold text-gray-900">
                              {formatAllocationCostNis(row.costNis)}
                            </td>
                          </>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-gray-200 bg-gray-50/60">
                      <td colSpan={2} className="text-sm font-semibold text-gray-700">
                        Total
                      </td>
                      <td className="text-right text-sm font-semibold text-gray-900">
                        {formatAllocationWorkedDuration(summary.totalWorkedMs)}
                      </td>
                      {showCosts ? (
                        <>
                          <td />
                          <td className="text-right text-sm font-bold text-gray-900">
                            {formatAllocationCostNis(summary.totalCostNis)}
                          </td>
                        </>
                      ) : null}
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </div>

        <div className="border-t border-gray-200 px-6 py-4">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
      <button
        type="button"
        className="modal-backdrop bg-black/40"
        aria-label="Close"
        onClick={onClose}
      />
    </div>
  );
}
