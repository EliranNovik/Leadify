import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BanknotesIcon,
  ClipboardDocumentListIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  InboxStackIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';
import {
  buildLeadManagementDetailPath,
  collectCategoriesFromRows,
  fetchLeadsManagementReport,
  formatAllocationCostNis,
  formatAllocationWorkedDuration,
  leadMatchesSearchQuery,
  type LeadManagementLeadRow,
} from '../lib/leadsManagementReport';
import {
  getSalaryEmployeeInitials,
  salaryAvatarGradientStyle,
} from '../lib/employeeSalaries';
import { supabase } from '../lib/supabase';
import {
  confirmBudgetRequestReview,
  LeadBudgetRequestReviewModal,
  LeadBudgetRequestsHistoryModal,
  latestPendingReason,
  type LeadBudgetRequestReviewResult,
} from '../components/LeadBudgetRequestsHistoryModal';
import type { LeadBudgetExtensionRequest } from '../lib/leadBudgetExtensionRequests';
import {
  fetchEmployeeRolesOnLead,
  getLeadRoleIcon,
  type LeadEmployeeRole,
} from '../lib/leadEmployeeRoles';

function BudgetBar({
  utilizationPercent,
  exceedsCap,
  requestCount,
  onOpenRequests,
}: {
  utilizationPercent: number;
  exceedsCap: boolean;
  requestCount: number;
  onOpenRequests: () => void;
}) {
  const width = Math.min(100, Math.max(0, utilizationPercent));
  return (
    <button
      type="button"
      className="min-w-[8rem] text-left"
      onClick={(e) => {
        e.stopPropagation();
        onOpenRequests();
      }}
      title="View budget requests"
    >
      <div className="mb-1 flex items-center justify-between gap-2 text-xs">
        <span className={exceedsCap ? 'font-semibold text-amber-700' : 'text-gray-500'}>
          {utilizationPercent.toFixed(utilizationPercent % 1 === 0 ? 0 : 1)}% of max
        </span>
        {requestCount > 0 ? (
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold leading-none text-white">
            {requestCount}
          </span>
        ) : null}
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-gray-100">
        <div
          className={`h-full rounded-full transition-all ${
            exceedsCap ? 'bg-amber-500' : width >= 85 ? 'bg-amber-400' : 'bg-emerald-500'
          }`}
          style={{ width: `${width}%` }}
        />
      </div>
    </button>
  );
}

function EmployeeStack({
  employees,
  onEmployeeClick,
}: {
  employees: LeadManagementLeadRow['employees'];
  onEmployeeClick: (employee: LeadManagementLeadRow['employees'][number]) => void;
}) {
  if (employees.length === 0) return <span className="text-sm text-gray-400">—</span>;
  const shown = employees.slice(0, 4);
  const rest = employees.length - shown.length;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex -space-x-2">
        {shown.map((emp) =>
          emp.photoUrl ? (
            <button
              key={emp.employeeId}
              type="button"
              title={`${emp.employeeName} — view roles`}
              className="relative h-8 w-8 overflow-hidden rounded-full transition hover:z-10 hover:ring-2 hover:ring-primary/40"
              onClick={(e) => {
                e.stopPropagation();
                onEmployeeClick(emp);
              }}
            >
              <img src={emp.photoUrl} alt="" className="h-full w-full object-cover" />
            </button>
          ) : (
            <button
              key={emp.employeeId}
              type="button"
              title={`${emp.employeeName} — view roles`}
              className="relative flex h-8 w-8 items-center justify-center rounded-full text-[10px] font-bold text-white transition hover:z-10 hover:ring-2 hover:ring-primary/40"
              style={salaryAvatarGradientStyle(emp.employeeId, emp.employeeName)}
              onClick={(e) => {
                e.stopPropagation();
                onEmployeeClick(emp);
              }}
            >
              {getSalaryEmployeeInitials(emp.employeeName)}
            </button>
          ),
        )}
        {rest > 0 ? (
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 text-[10px] font-semibold text-gray-600">
            +{rest}
          </span>
        ) : null}
      </div>
      <p className="max-w-[14rem] truncate text-xs text-gray-500">
        {employees.map((e) => e.employeeName).join(', ')}
      </p>
    </div>
  );
}

const LeadsManagementReportPage: React.FC = () => {
  const navigate = useNavigate();
  const [isSuperUser, setIsSuperUser] = useState(false);
  const [permissionsLoaded, setPermissionsLoaded] = useState(false);
  const [leadSearch, setLeadSearch] = useState('');
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [category, setCategory] = useState('');
  const [overBudgetOnly, setOverBudgetOnly] = useState(false);
  const [pendingRequestsOnly, setPendingRequestsOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<LeadManagementLeadRow[]>([]);
  const [historyRow, setHistoryRow] = useState<LeadManagementLeadRow | null>(null);
  const [reasonPreview, setReasonPreview] = useState<{
    reason: string;
    employeeName?: string;
    leadLabel?: string;
  } | null>(null);
  const [reviewRequest, setReviewRequest] = useState<LeadBudgetExtensionRequest | null>(null);
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [employeeRoleModal, setEmployeeRoleModal] = useState<{
    employee: LeadManagementLeadRow['employees'][number];
    lead: LeadManagementLeadRow;
    roles: LeadEmployeeRole[];
    loading: boolean;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user?.id) {
          if (!cancelled) {
            setIsSuperUser(false);
            setPermissionsLoaded(true);
          }
          return;
        }

        let { data: userData } = await supabase
          .from('users')
          .select('is_superuser')
          .eq('auth_id', user.id)
          .maybeSingle();

        if (!userData) {
          const { data: userByEmail } = await supabase
            .from('users')
            .select('is_superuser')
            .eq('email', user.email || '')
            .maybeSingle();
          userData = userByEmail;
        }

        const isSuper =
          userData?.is_superuser === true ||
          userData?.is_superuser === 'true' ||
          userData?.is_superuser === 1;

        if (!cancelled) {
          setIsSuperUser(Boolean(isSuper));
          setPermissionsLoaded(true);
          if (!isSuper) {
            toast.error('Access denied. This report is only available to superusers.');
            navigate('/reports');
          }
        }
      } catch (error) {
        console.error('[LeadsManagementReport] permission check failed:', error);
        if (!cancelled) {
          setIsSuperUser(false);
          setPermissionsLoaded(true);
          toast.error('Access denied. This report is only available to superusers.');
          navigate('/reports');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const load = useCallback(async () => {
    if (!isSuperUser) return;
    setLoading(true);
    try {
      const data = await fetchLeadsManagementReport({
        employeeSearch: employeeSearch.trim() || undefined,
      });
      setRows(data);
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Failed to load leads management report');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [employeeSearch, isSuperUser]);

  useEffect(() => {
    if (!permissionsLoaded || !isSuperUser) return;
    void load();
  }, [load, permissionsLoaded, isSuperUser]);

  const handleEmployeeClick = useCallback(
    async (
      employee: LeadManagementLeadRow['employees'][number],
      lead: LeadManagementLeadRow,
    ) => {
      setEmployeeRoleModal({ employee, lead, roles: [], loading: true });
      try {
        const roles = await fetchEmployeeRolesOnLead({
          employeeId: employee.employeeId,
          employeeName: employee.employeeName,
          leadType: lead.leadType,
          newLeadId: lead.newLeadId,
          legacyLeadId: lead.legacyLeadId,
          leadNumber: lead.leadNumber,
        });
        setEmployeeRoleModal({ employee, lead, roles, loading: false });
      } catch (error) {
        console.error(error);
        toast.error(error instanceof Error ? error.message : 'Failed to load employee roles');
        setEmployeeRoleModal({ employee, lead, roles: [], loading: false });
      }
    },
    [],
  );

  const handleReviewConfirm = useCallback(
    async (result: LeadBudgetRequestReviewResult) => {
      if (!reviewRequest) return;
      setReviewSubmitting(true);
      try {
        await confirmBudgetRequestReview({
          requestId: reviewRequest.id,
          decision: result.decision,
          reviewNote: result.reviewNote,
          approvedExtraCostNis: result.approvedExtraCostNis,
        });
        setReviewRequest(null);
        await load();
      } catch (error) {
        console.error(error);
        toast.error(error instanceof Error ? error.message : 'Failed to review request');
      } finally {
        setReviewSubmitting(false);
      }
    },
    [reviewRequest, load],
  );

  const categories = useMemo(() => collectCategoriesFromRows(rows), [rows]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      if (category && (row.mainCategory || '') !== category) return false;
      if (!leadMatchesSearchQuery(row, leadSearch)) return false;
      if (overBudgetOnly && !row.exceedsCap) return false;
      if (pendingRequestsOnly && row.pendingRequestCount <= 0) return false;
      return true;
    });
  }, [rows, category, leadSearch, overBudgetOnly, pendingRequestsOnly]);

  const totals = useMemo(() => {
    const scoped = rows.filter((row) => {
      if (category && (row.mainCategory || '') !== category) return false;
      if (!leadMatchesSearchQuery(row, leadSearch)) return false;
      return true;
    });
    const workedMs = filteredRows.reduce((sum, row) => sum + row.workedMs, 0);
    const costNis = Math.round(filteredRows.reduce((sum, row) => sum + row.costNis, 0) * 100) / 100;
    const overBudget = scoped.filter((row) => row.exceedsCap).length;
    const pendingRequests = scoped.reduce((sum, row) => sum + row.pendingRequestCount, 0);
    return { leadCount: filteredRows.length, workedMs, costNis, overBudget, pendingRequests };
  }, [filteredRows, rows, category, leadSearch]);

  if (!permissionsLoaded || !isSuperUser) {
    return (
      <div className="flex min-h-[calc(100dvh-3.5rem)] items-center justify-center bg-[#ececec]">
        <span className="loading loading-spinner loading-lg text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-[#ececec]">
      <div className="w-full px-4 py-6 md:px-8 md:py-8">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <button
              type="button"
              className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-800"
              onClick={() => navigate('/reports')}
            >
              <ArrowLeftIcon className="h-4 w-4" />
              Reports
            </button>
            <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
              <ClipboardDocumentListIcon className="h-7 w-7 text-primary" />
              Leads management
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              All leads with allocation data — time, cost, and budget utilization.
            </p>
          </div>
          <button
            type="button"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-gray-200 transition-colors hover:bg-gray-50"
            onClick={() => navigate('/reports/employee-lead-allocations')}
          >
            <ClipboardDocumentListIcon className="h-5 w-5 text-primary" />
            Lead allocations
            <ArrowRightIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-5 grid grid-cols-1 items-end gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-100 sm:grid-cols-3">
          <label className="block min-w-0">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-500">
              Lead / name
            </span>
            <div className="flex h-10 min-h-10 w-full items-center gap-2 rounded-lg border border-base-content/20 bg-base-100 px-3 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-base-content/20">
              <MagnifyingGlassIcon className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
              <input
                type="search"
                className="h-full min-w-0 grow bg-transparent text-sm outline-none placeholder:text-gray-400"
                placeholder="Lead #, client, or contact…"
                value={leadSearch}
                onChange={(e) => setLeadSearch(e.target.value)}
              />
            </div>
          </label>
          <label className="block min-w-0">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-500">
              Main category
            </span>
            <select
              className="select select-bordered select-sm h-10 min-h-10 w-full"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">All main categories</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </label>
          <label className="block min-w-0">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-500">
              Employee
            </span>
            <div className="flex h-10 min-h-10 w-full items-center gap-2 rounded-lg border border-base-content/20 bg-base-100 px-3 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-base-content/20">
              <MagnifyingGlassIcon className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
              <input
                type="search"
                className="h-full min-w-0 grow bg-transparent text-sm outline-none placeholder:text-gray-400"
                placeholder="Search employee…"
                value={employeeSearch}
                onChange={(e) => setEmployeeSearch(e.target.value)}
              />
            </div>
          </label>
        </div>

        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <div className="rounded-2xl bg-white px-4 py-4 shadow-sm ring-1 ring-gray-100 md:px-5 md:py-5">
            <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-gray-500 md:text-base">
              <ClipboardDocumentListIcon className="h-5 w-5 shrink-0 md:h-6 md:w-6" /> Leads
            </p>
            <p className="mt-2 text-2xl font-bold text-gray-900 md:text-3xl">{totals.leadCount}</p>
          </div>
          <div className="rounded-2xl bg-white px-4 py-4 shadow-sm ring-1 ring-gray-100 md:px-5 md:py-5">
            <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-gray-500 md:text-base">
              <ClockIcon className="h-5 w-5 shrink-0 md:h-6 md:w-6" /> Time
            </p>
            <p className="mt-2 text-2xl font-bold text-gray-900 md:text-3xl">
              {formatAllocationWorkedDuration(totals.workedMs)}
            </p>
          </div>
          <div className="rounded-2xl bg-white px-4 py-4 shadow-sm ring-1 ring-gray-100 md:px-5 md:py-5">
            <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-gray-500 md:text-base">
              <BanknotesIcon className="h-5 w-5 shrink-0 md:h-6 md:w-6" /> Cost
            </p>
            <p className="mt-2 text-2xl font-bold text-gray-900 md:text-3xl">
              {formatAllocationCostNis(totals.costNis)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOverBudgetOnly((prev) => !prev)}
            aria-pressed={overBudgetOnly}
            className={`rounded-2xl px-4 py-4 text-left shadow-sm ring-1 transition-colors md:px-5 md:py-5 ${
              overBudgetOnly
                ? 'bg-amber-50 ring-amber-300'
                : 'bg-white ring-gray-100 hover:bg-amber-50/60 hover:ring-amber-200'
            }`}
          >
            <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-gray-500 md:text-base">
              <ExclamationTriangleIcon className="h-5 w-5 shrink-0 md:h-6 md:w-6" />
              Over budget{overBudgetOnly ? ' · on' : ''}
            </p>
            <p
              className={`mt-2 text-2xl font-bold md:text-3xl ${
                totals.overBudget > 0 ? 'text-amber-700' : 'text-emerald-700'
              }`}
            >
              {totals.overBudget}
            </p>
          </button>
          <button
            type="button"
            onClick={() => setPendingRequestsOnly((prev) => !prev)}
            aria-pressed={pendingRequestsOnly}
            className={`rounded-2xl px-4 py-4 text-left shadow-sm ring-1 transition-colors md:px-5 md:py-5 ${
              pendingRequestsOnly
                ? 'bg-red-50 ring-red-300'
                : 'bg-white ring-gray-100 hover:bg-red-50/60 hover:ring-red-200'
            }`}
          >
            <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-gray-500 md:text-base">
              <InboxStackIcon className="h-5 w-5 shrink-0 md:h-6 md:w-6" />
              Requests{pendingRequestsOnly ? ' · on' : ''}
            </p>
            <p
              className={`mt-2 text-2xl font-bold md:text-3xl ${
                totals.pendingRequests > 0 ? 'text-red-600' : 'text-gray-900'
              }`}
            >
              {totals.pendingRequests}
            </p>
          </button>
        </div>

        <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-100">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-500">
              <span className="loading loading-spinner loading-md text-primary" />
              Loading…
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="px-6 py-16 text-center text-sm text-gray-500">
              No leads with allocation data match these filters.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr className="border-b border-gray-100 text-xs uppercase tracking-wider text-gray-500">
                    <th>Lead</th>
                    <th>Main / subcategory</th>
                    <th>Employees</th>
                    <th className="text-right">Time</th>
                    <th className="text-right">Cost</th>
                    <th className="text-right">Max</th>
                    <th>Budget</th>
                    <th>Request reason</th>
                    <th className="text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => {
                    const pending = row.budgetRequests.filter((r) => r.status === 'pending');
                    const pendingReason = latestPendingReason(row.budgetRequests);
                    return (
                      <tr
                        key={row.key}
                        className="cursor-pointer hover:bg-gray-50/90"
                        onClick={() => navigate(buildLeadManagementDetailPath(row))}
                      >
                        <td>
                          <div className="min-w-[12rem]">
                            <p className="font-semibold text-gray-900">{row.clientName}</p>
                            <p className="text-xs text-gray-500">#{row.leadNumber}</p>
                          </div>
                        </td>
                        <td className="text-sm text-gray-600">
                          {row.mainCategory || row.subcategory ? (
                            <div className="min-w-[10rem]">
                              <p className="font-medium text-gray-900">
                                {row.mainCategory || '—'}
                              </p>
                              <p className="text-xs text-gray-500">{row.subcategory || '—'}</p>
                            </div>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>
                          <EmployeeStack
                            employees={row.employees}
                            onEmployeeClick={(emp) => void handleEmployeeClick(emp, row)}
                          />
                        </td>
                        <td className="text-right text-sm font-medium text-gray-900">
                          {formatAllocationWorkedDuration(row.workedMs)}
                        </td>
                        <td className="text-right text-sm font-semibold text-gray-900">
                          {formatAllocationCostNis(row.costNis)}
                        </td>
                        <td className="text-right text-sm text-gray-500">
                          {formatAllocationCostNis(row.maxAllowedCostNis)}
                          {row.approvedExtensionCostNis > 0 ? (
                            <p className="text-[10px] text-emerald-600">
                              +{formatAllocationCostNis(row.approvedExtensionCostNis)} ext
                            </p>
                          ) : null}
                        </td>
                        <td>
                          <BudgetBar
                            utilizationPercent={row.utilizationPercent}
                            exceedsCap={row.exceedsCap}
                            requestCount={row.requestCount}
                            onOpenRequests={() => setHistoryRow(row)}
                          />
                        </td>
                        <td className="max-w-[11rem]" onClick={(e) => e.stopPropagation()}>
                          {pendingReason ? (
                            <button
                              type="button"
                              className="block w-full truncate text-left text-sm text-gray-700 underline decoration-gray-300 underline-offset-2 hover:text-gray-900 hover:decoration-gray-500"
                              title="View full reason"
                              onClick={() => {
                                const pendingReq = pending[0];
                                setReasonPreview({
                                  reason: pendingReason,
                                  employeeName: pendingReq?.employeeName,
                                  leadLabel: `${row.clientName} · #${row.leadNumber}`,
                                });
                              }}
                            >
                              {pendingReason}
                            </button>
                          ) : (
                            <span className="text-sm text-gray-400">—</span>
                          )}
                        </td>
                        <td className="text-right" onClick={(e) => e.stopPropagation()}>
                          {pending.length > 0 ? (
                            <button
                              type="button"
                              className="inline-flex items-center gap-1.5 rounded-full bg-red-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-red-600"
                              onClick={() => setReviewRequest(pending[0])}
                            >
                              {pending.length === 1
                                ? 'Received request'
                                : `${pending.length} received requests`}
                            </button>
                          ) : (
                            <span className="text-sm text-gray-400">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>


      </div>

      <LeadBudgetRequestsHistoryModal
        open={Boolean(historyRow)}
        leadLabel={
          historyRow ? `${historyRow.clientName} · #${historyRow.leadNumber}` : ''
        }
        requests={historyRow?.budgetRequests || []}
        onClose={() => setHistoryRow(null)}
      />
      {reasonPreview ? (
        <div className="modal modal-open z-[135]">
          <div className="modal-box max-w-md">
            <h3 className="text-lg font-bold text-gray-900">Request reason</h3>
            {reasonPreview.leadLabel || reasonPreview.employeeName ? (
              <p className="mt-1 text-sm text-gray-500">
                {[reasonPreview.employeeName, reasonPreview.leadLabel]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            ) : null}
            <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-gray-800">
              {reasonPreview.reason}
            </p>
            <div className="mt-6 flex justify-end">
              <button
                type="button"
                className="inline-flex items-center rounded-full bg-gray-900 px-5 py-2 text-sm font-semibold text-white hover:bg-gray-800"
                onClick={() => setReasonPreview(null)}
              >
                Close
              </button>
            </div>
          </div>
          <div className="modal-backdrop bg-black/40" onClick={() => setReasonPreview(null)} />
        </div>
      ) : null}
      <LeadBudgetRequestReviewModal
        open={Boolean(reviewRequest)}
        request={reviewRequest}
        submitting={reviewSubmitting}
        onClose={() => setReviewRequest(null)}
        onConfirm={handleReviewConfirm}
      />
      {employeeRoleModal ? (
        <div className="modal modal-open z-[135]">
          <div className="modal-box max-w-sm">
            <div className="flex items-center gap-3">
              {employeeRoleModal.employee.photoUrl ? (
                <img
                  src={employeeRoleModal.employee.photoUrl}
                  alt=""
                  className="h-12 w-12 rounded-full object-cover"
                />
              ) : (
                <span
                  className="flex h-12 w-12 items-center justify-center rounded-full text-sm font-bold text-white"
                  style={salaryAvatarGradientStyle(
                    employeeRoleModal.employee.employeeId,
                    employeeRoleModal.employee.employeeName,
                  )}
                >
                  {getSalaryEmployeeInitials(employeeRoleModal.employee.employeeName)}
                </span>
              )}
              <div className="min-w-0">
                <h3 className="truncate text-lg font-bold text-gray-900">
                  {employeeRoleModal.employee.employeeName}
                </h3>
                <p className="truncate text-sm text-gray-500">
                  {employeeRoleModal.lead.clientName} · #{employeeRoleModal.lead.leadNumber}
                </p>
              </div>
            </div>

            <div className="mt-5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                Role on this lead
              </p>
              {employeeRoleModal.loading ? (
                <div className="mt-3 flex items-center gap-2 text-sm text-gray-500">
                  <span className="loading loading-spinner loading-sm" />
                  Loading…
                </div>
              ) : employeeRoleModal.roles.length > 0 ? (
                <ul className="mt-3 flex flex-wrap gap-2">
                  {employeeRoleModal.roles.map((role) => {
                    const RoleIcon = getLeadRoleIcon(role.id);
                    return (
                      <li
                        key={role.id}
                        className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-sm font-semibold text-primary"
                      >
                        <RoleIcon className="h-4 w-4 shrink-0 text-primary/80" />
                        {role.title}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-gray-500">
                  No assigned role on this lead (time was allocated without a Roles-tab
                  assignment).
                </p>
              )}
            </div>

            {employeeRoleModal.employee.departmentName ? (
              <p className="mt-4 text-xs text-gray-500">
                Department: {employeeRoleModal.employee.departmentName}
              </p>
            ) : null}

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                className="inline-flex items-center rounded-full bg-gray-900 px-5 py-2 text-sm font-semibold text-white hover:bg-gray-800"
                onClick={() => setEmployeeRoleModal(null)}
              >
                Close
              </button>
            </div>
          </div>
          <div
            className="modal-backdrop bg-black/40"
            onClick={() => setEmployeeRoleModal(null)}
          />
        </div>
      ) : null}
    </div>
  );
};

export default LeadsManagementReportPage;
