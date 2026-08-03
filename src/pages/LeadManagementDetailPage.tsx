import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import {
  ArrowLeftIcon,
  BanknotesIcon,
  ClockIcon,
  ScaleIcon,
  UserGroupIcon,
  WalletIcon,
} from '@heroicons/react/24/outline';
import {
  buildLeadClientRoute,
  fetchLeadManagementDetail,
  formatAllocationCostNis,
  formatAllocationWorkedDuration,
  type LeadManagementDetail,
} from '../lib/leadsManagementReport';
import {
  fetchRolesByEmployeeOnLead,
  getLeadRoleIcon,
  type LeadEmployeeRole,
} from '../lib/leadEmployeeRoles';
import {
  clearLeadCostMaxOverride,
  updateLeadTotalValueNis,
  upsertLeadCostMaxOverride,
} from '../lib/leadEmployeeCostMaxOverride';
import {
  EditLeadValueModal,
  EditMaxAllowedModal,
  LeadValuePaymentPlanBlockedModal,
  SummaryEditButton,
} from '../components/LeadManagementBudgetEditModals';
import LeadRemainingTimeBar from '../components/LeadRemainingTimeBar';
import type { LeadEmployeeCostSummary } from '../lib/leadEmployeeCost';
import {
  getSalaryEmployeeInitials,
  salaryAvatarGradientStyle,
} from '../lib/employeeSalaries';
import type { LeadReportingType } from '../lib/employeeLeadReporting';
import { supabase } from '../lib/supabase';

function AllTimeBudgetPanel({
  summary,
  remainingCostNis,
}: {
  summary: LeadEmployeeCostSummary;
  remainingCostNis: number;
}) {
  const exceedsCap = summary.exceedsCap;
  const utilizationPercent = summary.utilizationPercent;
  return (
    <div className="w-full max-w-md">
      <div className="mb-1.5 flex items-center justify-between gap-2 text-sm">
        <span className={exceedsCap ? 'font-semibold text-amber-700' : 'text-gray-600'}>
          {utilizationPercent.toFixed(utilizationPercent % 1 === 0 ? 0 : 1)}% of max budget
        </span>
        {exceedsCap ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
            Over budget
          </span>
        ) : (
          <span className="text-xs text-gray-500">
            <span className="font-medium text-gray-800">
              {formatAllocationCostNis(remainingCostNis)}
            </span>{' '}
            left to spend
          </span>
        )}
      </div>
      <LeadRemainingTimeBar
        summary={summary}
        align="start"
        fullWidth
        className="!self-stretch"
      />
    </div>
  );
}

function EmployeeAvatar({
  employeeId,
  employeeName,
  photoUrl,
}: {
  employeeId: number;
  employeeName: string;
  photoUrl: string | null;
}) {
  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt=""
        className="h-8 w-8 rounded-full object-cover"
      />
    );
  }
  return (
    <span
      className="flex h-8 w-8 items-center justify-center rounded-full text-[10px] font-bold text-white"
      style={salaryAvatarGradientStyle(employeeId, employeeName)}
    >
      {getSalaryEmployeeInitials(employeeName)}
    </span>
  );
}

const LeadManagementDetailPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [isSuperUser, setIsSuperUser] = useState(false);
  const [permissionsLoaded, setPermissionsLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<LeadManagementDetail | null>(null);
  const [rolesByEmployeeId, setRolesByEmployeeId] = useState<Map<number, LeadEmployeeRole[]>>(
    () => new Map(),
  );
  const [leadValueModal, setLeadValueModal] = useState<'edit' | 'blocked' | null>(null);
  const [maxAllowedModalOpen, setMaxAllowedModalOpen] = useState(false);
  const [budgetEditSubmitting, setBudgetEditSubmitting] = useState(false);

  const query = useMemo(() => {
    const type = (searchParams.get('type') || '') as LeadReportingType | 'number' | '';
    const id = searchParams.get('id') || '';
    const leadNumber = searchParams.get('lead') || '';
    return { type, id, leadNumber };
  }, [searchParams]);

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
        console.error('[LeadManagementDetail] permission check failed:', error);
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
      const params: {
        leadType?: LeadReportingType | null;
        newLeadId?: string | null;
        legacyLeadId?: number | null;
        leadNumber?: string | null;
      } = {};

      if (query.type === 'legacy' && query.id) {
        params.leadType = 'legacy';
        params.legacyLeadId = Number(query.id);
        params.leadNumber = query.leadNumber || null;
      } else if (query.type === 'new' && query.id) {
        params.leadType = 'new';
        params.newLeadId = query.id;
        params.leadNumber = query.leadNumber || null;
      } else if (query.type === 'number' && query.id) {
        params.leadNumber = query.id;
      } else if (query.leadNumber) {
        params.leadNumber = query.leadNumber;
      } else if (query.id) {
        params.leadNumber = query.id;
      }

      const data = await fetchLeadManagementDetail(params);
      setDetail(data);
      if (!data) {
        setRolesByEmployeeId(new Map());
        toast.error('Lead report not found');
        return;
      }

      try {
        const rolesMap = await fetchRolesByEmployeeOnLead({
          leadType: data.lead.leadType,
          newLeadId: data.lead.newLeadId,
          legacyLeadId: data.lead.legacyLeadId,
          leadNumber: data.lead.leadNumber,
          employees: data.lead.employees.map((emp) => ({
            employeeId: emp.employeeId,
            employeeName: emp.employeeName,
          })),
        });
        setRolesByEmployeeId(rolesMap);
      } catch (rolesError) {
        console.error(rolesError);
        setRolesByEmployeeId(new Map());
        toast.error(
          rolesError instanceof Error ? rolesError.message : 'Failed to load employee roles',
        );
      }
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Failed to load lead report');
      setDetail(null);
      setRolesByEmployeeId(new Map());
    } finally {
      setLoading(false);
    }
  }, [query, isSuperUser]);

  useEffect(() => {
    if (!permissionsLoaded || !isSuperUser) return;
    void load();
  }, [load, permissionsLoaded, isSuperUser]);

  const handleSaveLeadValue = useCallback(
    async (valueNis: number) => {
      if (!detail) return;
      setBudgetEditSubmitting(true);
      try {
        await updateLeadTotalValueNis({
          leadType: detail.lead.leadType,
          newLeadId: detail.lead.newLeadId,
          legacyLeadId: detail.lead.legacyLeadId,
          newValueNis: valueNis,
        });
        toast.success('Lead value updated');
        setLeadValueModal(null);
        await load();
      } catch (error) {
        console.error(error);
        const message = error instanceof Error ? error.message : 'Failed to update lead value';
        if (/payment plan/i.test(message)) {
          setLeadValueModal('blocked');
        } else {
          toast.error(message);
        }
      } finally {
        setBudgetEditSubmitting(false);
      }
    },
    [detail, load],
  );

  const handleSaveMaxAllowed = useCallback(
    async (maxAllowedCostNis: number) => {
      if (!detail) return;
      setBudgetEditSubmitting(true);
      try {
        await upsertLeadCostMaxOverride({
          leadType: detail.lead.leadType,
          newLeadId: detail.lead.newLeadId,
          legacyLeadId: detail.lead.legacyLeadId,
          leadNumber: detail.lead.leadNumber,
          maxAllowedCostNis,
        });
        toast.success('Max allowed updated');
        setMaxAllowedModalOpen(false);
        await load();
      } catch (error) {
        console.error(error);
        toast.error(error instanceof Error ? error.message : 'Failed to update max allowed');
      } finally {
        setBudgetEditSubmitting(false);
      }
    },
    [detail, load],
  );

  const handleResetMaxAllowed = useCallback(async () => {
    if (!detail) return;
    setBudgetEditSubmitting(true);
    try {
      await clearLeadCostMaxOverride({
        leadType: detail.lead.leadType,
        newLeadId: detail.lead.newLeadId,
        legacyLeadId: detail.lead.legacyLeadId,
        leadNumber: detail.lead.leadNumber,
      });
      toast.success('Restored calculated max');
      setMaxAllowedModalOpen(false);
      await load();
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Failed to reset max allowed');
    } finally {
      setBudgetEditSubmitting(false);
    }
  }, [detail, load]);

  const clientRoute = detail
    ? buildLeadClientRoute({
        leadType: detail.lead.leadType,
        legacyLeadId: detail.lead.legacyLeadId,
        leadNumber: detail.lead.leadNumber,
      })
    : null;

  const remainingBudget = useMemo(() => {
    if (!detail) return { remainingCostNis: 0, remainingWorkedMs: null as number | null };
    const remainingCostNis = Math.max(
      0,
      Math.round((detail.lead.maxAllowedCostNis - detail.lead.costNis) * 100) / 100,
    );
    const hoursWorked = detail.lead.workedMs / (60 * 60 * 1000);
    let hourRateNis: number | null = null;
    if (hoursWorked > 0.001 && detail.lead.costNis > 0) {
      hourRateNis = detail.lead.costNis / hoursWorked;
    } else {
      const rates = detail.lead.employees
        .map((e) => e.hourRateNis)
        .filter((r): r is number => r != null && r > 0);
      if (rates.length > 0) {
        hourRateNis = rates.reduce((sum, r) => sum + r, 0) / rates.length;
      }
    }
    const remainingWorkedMs =
      hourRateNis != null && hourRateNis > 0
        ? Math.round((remainingCostNis / hourRateNis) * 60 * 60 * 1000)
        : null;
    return { remainingCostNis, remainingWorkedMs };
  }, [detail]);

  const leadCostSummary = useMemo((): LeadEmployeeCostSummary | null => {
    if (!detail) return null;
    return {
      employees: detail.lead.employees.map((e) => ({
        employeeId: e.employeeId,
        employeeName: e.employeeName,
        photoUrl: e.photoUrl,
        departmentName: e.departmentName,
        workedMs: e.workedMs,
        costNis: e.costNis,
        hourRateNis: e.hourRateNis,
      })),
      totalWorkedMs: detail.lead.workedMs,
      totalCostNis: detail.lead.costNis,
      baseMaxAllowedCostNis: detail.lead.baseMaxAllowedCostNis,
      approvedExtensionCostNis: detail.lead.approvedExtensionCostNis,
      maxOverrideNis: detail.lead.maxOverrideNis,
      maxAllowedCostNis: detail.lead.maxAllowedCostNis,
      leadTotalValueNis: detail.lead.leadTotalValueNis,
      exceedsCap: detail.lead.exceedsCap,
      utilizationPercent: detail.lead.utilizationPercent,
      usedRoleHourlyFallback: false,
    };
  }, [detail]);

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
        <button
          type="button"
          className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-800"
          onClick={() => navigate('/reports/leads-management')}
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Leads management
        </button>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-24 text-sm text-gray-500">
            <span className="loading loading-spinner loading-md text-primary" />
            Loading…
          </div>
        ) : !detail ? (
          <div className="rounded-2xl bg-white px-6 py-16 text-center text-sm text-gray-500 shadow-sm">
            No report found for this lead.
          </div>
        ) : (
          <>
            <div className="mb-5 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-100 md:p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                    All-time lead report
                  </p>
                  <h1 className="mt-1 text-2xl font-bold text-gray-900">{detail.lead.clientName}</h1>
                  <p className="mt-1 text-sm text-gray-500">
                    #{detail.lead.leadNumber}
                    {detail.lead.category ? ` · ${detail.lead.category}` : ''}
                  </p>
                  {clientRoute ? (
                    <Link
                      to={clientRoute}
                      className="mt-2 inline-block text-sm font-medium text-primary hover:underline"
                    >
                      Open client →
                    </Link>
                  ) : null}
                </div>
                {leadCostSummary ? (
                  <AllTimeBudgetPanel
                    summary={leadCostSummary}
                    remainingCostNis={remainingBudget.remainingCostNis}
                  />
                ) : null}
              </div>

              <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <div className="rounded-xl bg-gray-50 px-4 py-4 md:px-5 md:py-5">
                  <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-gray-500 md:text-base">
                    <ClockIcon className="h-5 w-5 shrink-0 md:h-6 md:w-6" /> Time
                  </p>
                  <p className="mt-2 text-2xl font-bold text-gray-900 md:text-3xl">
                    {formatAllocationWorkedDuration(detail.lead.workedMs)}
                  </p>
                </div>
                <div className="rounded-xl bg-gray-50 px-4 py-4 md:px-5 md:py-5">
                  <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-gray-500 md:text-base">
                    <BanknotesIcon className="h-5 w-5 shrink-0 md:h-6 md:w-6" /> Cost
                  </p>
                  <p className="mt-2 text-2xl font-bold text-gray-900 md:text-3xl">
                    {formatAllocationCostNis(detail.lead.costNis)}
                  </p>
                </div>
                <div className="rounded-xl bg-gray-50 px-4 py-4 md:px-5 md:py-5">
                  <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-gray-500 md:text-base">
                    <ScaleIcon className="h-5 w-5 shrink-0 md:h-6 md:w-6" /> Max allowed
                    <SummaryEditButton
                      label="Edit max allowed"
                      onClick={() => setMaxAllowedModalOpen(true)}
                    />
                  </p>
                  <p className="mt-2 text-2xl font-bold text-gray-900 md:text-3xl">
                    {formatAllocationCostNis(detail.lead.maxAllowedCostNis)}
                  </p>
                  {detail.lead.maxOverrideNis != null ? (
                    <p className="mt-1 text-xs font-medium text-primary">Custom override</p>
                  ) : detail.lead.approvedExtensionCostNis > 0 ? (
                    <p className="mt-1 text-xs text-gray-500">
                      Includes {formatAllocationCostNis(detail.lead.approvedExtensionCostNis)}{' '}
                      extensions
                    </p>
                  ) : null}
                </div>
                <div className="rounded-xl bg-gray-50 px-4 py-4 md:px-5 md:py-5">
                  <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-gray-500 md:text-base">
                    <WalletIcon className="h-5 w-5 shrink-0 md:h-6 md:w-6" /> Lead value
                    <SummaryEditButton
                      label="Edit lead value"
                      onClick={() =>
                        setLeadValueModal(detail.lead.hasPaymentPlan ? 'blocked' : 'edit')
                      }
                    />
                  </p>
                  <p className="mt-2 text-2xl font-bold text-gray-900 md:text-3xl">
                    {formatAllocationCostNis(detail.lead.leadTotalValueNis)}
                  </p>
                </div>
              </div>
            </div>

            <div className="mb-5 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-100">
              <div className="border-b border-gray-100 px-5 py-4">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                  <UserGroupIcon className="h-4 w-4 text-primary" />
                  Employees (all time)
                </h2>
              </div>
              {detail.lead.employees.length === 0 ? (
                <p className="px-5 py-8 text-sm text-gray-500">No employee time allocated yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="table w-full table-fixed">
                    <colgroup>
                      <col className="w-[22%]" />
                      <col className="w-[22%]" />
                      <col className="w-[20%]" />
                      <col className="w-[12%]" />
                      <col className="w-[12%]" />
                      <col className="w-[12%]" />
                    </colgroup>
                    <thead>
                      <tr className="text-xs uppercase tracking-wider text-gray-500">
                        <th>Employee</th>
                        <th>Lead role</th>
                        <th>Department</th>
                        <th className="text-right">Time</th>
                        <th className="text-right">Cost</th>
                        <th className="text-right">Cost / hour</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.lead.employees.map((emp) => {
                        const roles = rolesByEmployeeId.get(emp.employeeId) || [];
                        return (
                          <tr key={emp.employeeId}>
                            <td>
                              <div className="flex items-center gap-2.5">
                                <EmployeeAvatar
                                  employeeId={emp.employeeId}
                                  employeeName={emp.employeeName}
                                  photoUrl={emp.photoUrl}
                                />
                                <span className="font-medium text-gray-900">{emp.employeeName}</span>
                              </div>
                            </td>
                            <td>
                              {roles.length > 0 ? (
                                <div className="flex flex-wrap gap-1">
                                  {roles.map((role) => {
                                    const RoleIcon = getLeadRoleIcon(role.id);
                                    return (
                                      <span
                                        key={role.id}
                                        className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
                                      >
                                        <RoleIcon className="h-3.5 w-3.5 shrink-0 text-primary/80" />
                                        {role.title}
                                      </span>
                                    );
                                  })}
                                </div>
                              ) : (
                                <span className="text-sm text-gray-400">—</span>
                              )}
                            </td>
                            <td className="text-sm text-gray-500">{emp.departmentName || '—'}</td>
                            <td className="text-right text-sm font-medium">
                              {formatAllocationWorkedDuration(emp.workedMs)}
                            </td>
                            <td className="text-right text-sm font-semibold">
                              {formatAllocationCostNis(emp.costNis)}
                            </td>
                            <td className="text-right text-sm text-gray-700">
                              {emp.hourRateNis != null
                                ? `${formatAllocationCostNis(emp.hourRateNis)}/h`
                                : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-100">
              <div className="border-b border-gray-100 px-5 py-4">
                <h2 className="text-sm font-semibold text-gray-900">Daily breakdown</h2>
                <p className="mt-0.5 text-xs text-gray-500">All allocation days for this lead</p>
              </div>
              {detail.days.length === 0 ? (
                <p className="px-5 py-8 text-sm text-gray-500">No daily allocations recorded.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="table w-full table-fixed">
                    <colgroup>
                      <col className="w-[22%]" />
                      <col className="w-[22%]" />
                      <col className="w-[20%]" />
                      <col className="w-[12%]" />
                      <col className="w-[12%]" />
                      <col className="w-[12%]" />
                    </colgroup>
                    <thead>
                      <tr className="text-xs uppercase tracking-wider text-gray-500">
                        <th>Date</th>
                        <th>Employee</th>
                        <th>Department</th>
                        <th className="text-right">Time</th>
                        <th className="text-right">Cost</th>
                        <th className="text-right">Cost / hour</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.days.flatMap((day) =>
                        day.employees.map((emp) => (
                          <tr key={`${day.workDate}-${emp.employeeId}`}>
                            <td className="whitespace-nowrap text-sm font-medium text-gray-900">
                              {day.workDate}
                            </td>
                            <td>
                              <div className="flex items-center gap-2.5">
                                <EmployeeAvatar
                                  employeeId={emp.employeeId}
                                  employeeName={emp.employeeName}
                                  photoUrl={emp.photoUrl}
                                />
                                <span className="font-medium text-gray-900">{emp.employeeName}</span>
                              </div>
                            </td>
                            <td className="text-sm text-gray-500">{emp.departmentName || '—'}</td>
                            <td className="text-right text-sm font-medium">
                              {formatAllocationWorkedDuration(emp.workedMs)}
                            </td>
                            <td className="text-right text-sm font-semibold">
                              {formatAllocationCostNis(emp.costNis)}
                            </td>
                            <td className="text-right text-sm text-gray-700">
                              {emp.hourRateNis != null
                                ? `${formatAllocationCostNis(emp.hourRateNis)}/h`
                                : '—'}
                            </td>
                          </tr>
                        )),
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <p className="mt-4 text-xs text-gray-500">
              Max employee cost = 14% of 87% of lead value
              {detail.lead.maxOverrideNis != null ? ' (unless a custom max override is set).' : '.'}
            </p>

            <LeadValuePaymentPlanBlockedModal
              open={leadValueModal === 'blocked'}
              onClose={() => setLeadValueModal(null)}
            />
            <EditLeadValueModal
              open={leadValueModal === 'edit'}
              currentValueNis={detail.lead.leadTotalValueNis}
              submitting={budgetEditSubmitting}
              onClose={() => setLeadValueModal(null)}
              onSave={handleSaveLeadValue}
            />
            <EditMaxAllowedModal
              open={maxAllowedModalOpen}
              currentMaxNis={detail.lead.maxAllowedCostNis}
              baseMaxNis={detail.lead.baseMaxAllowedCostNis}
              approvedExtensionCostNis={detail.lead.approvedExtensionCostNis}
              leadTotalValueNis={detail.lead.leadTotalValueNis}
              costNis={detail.lead.costNis}
              hasOverride={detail.lead.maxOverrideNis != null}
              submitting={budgetEditSubmitting}
              onClose={() => setMaxAllowedModalOpen(false)}
              onSave={handleSaveMaxAllowed}
              onResetToCalculated={handleResetMaxAllowed}
            />
          </>
        )}
      </div>
    </div>
  );
};

export default LeadManagementDetailPage;
