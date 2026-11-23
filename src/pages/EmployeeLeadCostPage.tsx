import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { ArrowLeftIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import {
  ReportSortableTh,
  compareNullableNumbers,
  toggleReportSort,
  type ReportSortDir,
} from '../components/reports/ReportSortableTh';
import {
  buildLeadManagementDetailPath,
  fetchLeadsManagementReport,
  peekLeadsManagementReport,
  peekLeadsManagementSuperUser,
  rememberLeadsManagementSuperUser,
  subscribeLeadsManagementReport,
  formatAllocationCostNis,
  formatAllocationWorkedDuration,
  type LeadManagementEmployeeSlice,
  type LeadManagementLeadRow,
} from '../lib/leadsManagementReport';
import {
  getSalaryEmployeeInitials,
  salaryAvatarGradientStyle,
} from '../lib/employeeSalaries';
import { fetchClockedInEmployeeIds } from '../lib/employeeClockInStatus';
import { supabase } from '../lib/supabase';

function BudgetBar({
  utilizationPercent,
  exceedsCap,
  requestCount,
}: {
  utilizationPercent: number;
  exceedsCap: boolean;
  requestCount: number;
}) {
  const width = Math.min(100, Math.max(0, utilizationPercent));
  return (
    <div className="min-w-[8rem] text-left">
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
          className={`h-full rounded-full ${
            exceedsCap ? 'bg-amber-500' : width >= 85 ? 'bg-amber-400' : 'bg-emerald-500'
          }`}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

type EmployeeLeadLine = {
  row: LeadManagementLeadRow;
  slice: LeadManagementEmployeeSlice;
};

const EmployeeLeadCostPage: React.FC = () => {
  const navigate = useNavigate();
  const { employeeId: employeeIdParam } = useParams();
  const employeeId = Number(employeeIdParam);
  const knownSuperUser = peekLeadsManagementSuperUser();
  const cachedLines = (peekLeadsManagementReport() ?? []).flatMap((row) => {
    const slice = row.employees.find((employee) => employee.employeeId === employeeId);
    return slice ? [{ row, slice }] : [];
  });
  const [isSuperUser, setIsSuperUser] = useState(knownSuperUser === true);
  const [permissionsLoaded, setPermissionsLoaded] = useState(knownSuperUser != null);
  const [loading, setLoading] = useState(cachedLines.length === 0 && peekLeadsManagementReport() == null);
  const [lines, setLines] = useState<EmployeeLeadLine[]>(cachedLines);
  const [sortKey, setSortKey] = useState<'time' | 'hour' | 'leadCost'>('leadCost');
  const [sortDir, setSortDir] = useState<ReportSortDir>('desc');
  const [leadSearch, setLeadSearch] = useState('');
  const [category, setCategory] = useState('');
  const [subcategory, setSubcategory] = useState('');
  const [budgetFilter, setBudgetFilter] = useState<'all' | 'over' | 'within' | 'nocap'>('all');
  const [clockedIn, setClockedIn] = useState(false);

  useEffect(() => {
    if (!Number.isFinite(employeeId) || employeeId <= 0) return;
    let cancelled = false;
    void fetchClockedInEmployeeIds()
      .then((ids) => {
        if (!cancelled) setClockedIn(ids.has(employeeId));
      })
      .catch((error) => console.error('[EmployeeLeadCost] clock-in status failed:', error));
    return () => {
      cancelled = true;
    };
  }, [employeeId]);

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
        rememberLeadsManagementSuperUser(Boolean(isSuper));
        if (!cancelled) {
          setIsSuperUser(Boolean(isSuper));
          setPermissionsLoaded(true);
          if (!isSuper) {
            toast.error('Access denied. This report is only available to superusers.');
            navigate('/reports');
          }
        }
      } catch (error) {
        console.error('[EmployeeLeadCost] permission check failed:', error);
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
    if (!isSuperUser || !Number.isFinite(employeeId)) return;
    const cached = peekLeadsManagementReport();
    if (cached) {
      setLines(
        cached.flatMap((row) => {
          const slice = row.employees.find((employee) => employee.employeeId === employeeId);
          return slice ? [{ row, slice }] : [];
        }),
      );
      setLoading(false);
    } else {
      setLoading(true);
    }
    try {
      const rows = await fetchLeadsManagementReport();
      setLines(
        rows.flatMap((row) => {
          const slice = row.employees.find((employee) => employee.employeeId === employeeId);
          return slice ? [{ row, slice }] : [];
        }),
      );
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Failed to load employee leads');
      setLines([]);
    } finally {
      setLoading(false);
    }
  }, [employeeId, isSuperUser]);

  useEffect(() => {
    if (!permissionsLoaded || !isSuperUser) return;
    void load();
  }, [isSuperUser, load, permissionsLoaded]);

  useEffect(() => {
    if (!permissionsLoaded || !isSuperUser || !Number.isFinite(employeeId)) return;
    return subscribeLeadsManagementReport((rows) => {
      setLines(
        rows.flatMap((row) => {
          const slice = row.employees.find((employee) => employee.employeeId === employeeId);
          return slice ? [{ row, slice }] : [];
        }),
      );
    });
  }, [employeeId, isSuperUser, permissionsLoaded]);

  const profile = lines[0]?.slice;
  const categories = useMemo(() => {
    const names = new Set<string>();
    for (const line of lines) {
      if (line.row.mainCategory) names.add(line.row.mainCategory);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [lines]);

  const subcategories = useMemo(() => {
    const names = new Set<string>();
    for (const line of lines) {
      if (category && (line.row.mainCategory || '') !== category) continue;
      if (line.row.subcategory) names.add(line.row.subcategory);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [category, lines]);

  useEffect(() => {
    if (subcategory && !subcategories.includes(subcategory)) setSubcategory('');
  }, [subcategory, subcategories]);

  const filteredLines = useMemo(() => {
    const query = leadSearch.trim().toLowerCase();
    return lines.filter((line) => {
      if (category && (line.row.mainCategory || '') !== category) return false;
      if (subcategory && (line.row.subcategory || '') !== subcategory) return false;
      if (budgetFilter === 'over' && !(line.row.maxAllowedCostNis > 0 && line.row.exceedsCap)) return false;
      if (budgetFilter === 'within' && !(line.row.maxAllowedCostNis > 0 && !line.row.exceedsCap)) return false;
      if (budgetFilter === 'nocap' && line.row.maxAllowedCostNis > 0) return false;
      if (!query) return true;
      const haystack = `${line.row.clientName} ${line.row.leadNumber}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [budgetFilter, category, leadSearch, lines, subcategory]);

  const totals = useMemo(() => {
    const workedMs = filteredLines.reduce((sum, line) => sum + line.slice.workedMs, 0);
    const costNis = Math.round(filteredLines.reduce((sum, line) => sum + line.slice.costNis, 0) * 100) / 100;
    return { workedMs, costNis, leadCount: filteredLines.length };
  }, [filteredLines]);

  const sortedLines = useMemo(() => {
    return [...filteredLines].sort((a, b) => {
      if (sortKey === 'time') return compareNullableNumbers(a.slice.workedMs, b.slice.workedMs, sortDir);
      if (sortKey === 'hour') return compareNullableNumbers(a.slice.hourRateNis, b.slice.hourRateNis, sortDir);
      return compareNullableNumbers(a.row.costNis, b.row.costNis, sortDir);
    });
  }, [filteredLines, sortDir, sortKey]);

  const handleSort = useCallback(
    (key: string) => {
      const next = toggleReportSort(sortKey, sortDir, key);
      setSortKey(next.key as 'time' | 'hour' | 'leadCost');
      setSortDir(next.dir);
    },
    [sortDir, sortKey],
  );

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

        <div className="mb-4 grid grid-cols-1 items-end gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <label className="block min-w-0">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-500">
              Lead
            </span>
            <div className="flex h-10 items-center gap-2 rounded-lg border border-base-content/20 bg-base-100 px-3">
              <MagnifyingGlassIcon className="h-4 w-4 shrink-0 text-black" aria-hidden />
              <input
                type="search"
                className="h-full min-w-0 grow bg-transparent text-sm outline-none placeholder:text-gray-400"
                placeholder="Client or lead #"
                value={leadSearch}
                onChange={(event) => setLeadSearch(event.target.value)}
              />
            </div>
          </label>
          <label className="block min-w-0">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-500">
              Category
            </span>
            <select
              className="select select-bordered select-sm h-10 min-h-10 w-full"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option value="">All categories</option>
              {categories.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="block min-w-0">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-500">
              Subcategory
            </span>
            <select
              className="select select-bordered select-sm h-10 min-h-10 w-full"
              value={subcategory}
              onChange={(event) => setSubcategory(event.target.value)}
            >
              <option value="">All subcategories</option>
              {subcategories.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="block min-w-0">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-500">
              Budget
            </span>
            <select
              className="select select-bordered select-sm h-10 min-h-10 w-full"
              value={budgetFilter}
              onChange={(event) => setBudgetFilter(event.target.value as 'all' | 'over' | 'within' | 'nocap')}
            >
              <option value="all">Any budget</option>
              <option value="over">Over budget</option>
              <option value="within">Within budget</option>
              <option value="nocap">No cap</option>
            </select>
          </label>
        </div>

        <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-100">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-500">
              <span className="loading loading-spinner loading-md text-primary" />
              Loading…
            </div>
          ) : lines.length === 0 ? (
            <div className="px-6 py-16 text-center text-sm text-gray-500">
              No allocated leads for this employee.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th colSpan={2} className="text-left">
                      <div className="flex min-w-[16rem] items-center gap-3 py-1">
                        <span className="relative h-12 w-12 shrink-0">
                          {profile?.photoUrl ? (
                            <img src={profile.photoUrl} alt="" className="h-12 w-12 rounded-full object-cover" />
                          ) : (
                            <span
                              className="flex h-12 w-12 items-center justify-center rounded-full text-base font-bold text-white"
                              style={salaryAvatarGradientStyle(employeeId, profile?.employeeName || 'Employee')}
                            >
                              {getSalaryEmployeeInitials(profile?.employeeName || 'Employee')}
                            </span>
                          )}
                          {clockedIn ? (
                            <span className="absolute -right-0.5 -top-0.5 h-3.5 w-3.5 rounded-full border-2 border-white bg-emerald-500" title="Clocked in" />
                          ) : null}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-lg font-bold normal-case tracking-normal text-gray-900">
                            {profile?.employeeName || `Employee #${employeeIdParam}`}
                          </p>
                          <p className="text-sm font-normal normal-case tracking-normal text-gray-500">
                            {profile?.departmentName || 'No department'}
                            {profile?.missingSalary ? ' · No salary on file' : ''}
                          </p>
                        </div>
                      </div>
                    </th>
                    <th className="text-left align-bottom">
                      <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Time</p>
                      <p className="text-lg font-bold normal-case tracking-normal tabular-nums text-gray-900">
                        {formatAllocationWorkedDuration(totals.workedMs)}
                      </p>
                    </th>
                    <th className="text-left align-bottom">
                      <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Per hour</p>
                      <p className="text-lg font-bold normal-case tracking-normal tabular-nums text-gray-900">
                        {profile?.hourRateNis != null ? `${formatAllocationCostNis(profile.hourRateNis)}/h` : '—'}
                      </p>
                    </th>
                    <th className="text-left align-bottom">
                      <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Cost</p>
                      <p className="text-lg font-bold normal-case tracking-normal tabular-nums text-gray-900">
                        {formatAllocationCostNis(totals.costNis)}
                      </p>
                    </th>
                    <th className="text-left align-bottom">
                      <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Leads</p>
                      <p className="text-lg font-bold normal-case tracking-normal tabular-nums text-gray-900">
                        {totals.leadCount}
                      </p>
                    </th>
                  </tr>
                  <tr className="border-b border-gray-100 text-xs uppercase tracking-wider text-gray-500">
                    <th className="text-left">Lead</th>
                    <th className="text-left">Category</th>
                    <ReportSortableTh
                      label="Time"
                      sortKey="time"
                      activeKey={sortKey}
                      direction={sortDir}
                      onSort={handleSort}
                      align="left"
                    />
                    <ReportSortableTh
                      label="Cost / hour"
                      sortKey="hour"
                      activeKey={sortKey}
                      direction={sortDir}
                      onSort={handleSort}
                      align="left"
                    />
                    <ReportSortableTh
                      label="Lead cost"
                      sortKey="leadCost"
                      activeKey={sortKey}
                      direction={sortDir}
                      onSort={handleSort}
                      align="left"
                    />
                    <th className="text-left">Budget</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedLines.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-sm text-gray-500">
                        No leads match these filters.
                      </td>
                    </tr>
                  ) : null}
                  {sortedLines.map(({ row, slice }) => (
                    <tr
                      key={row.key}
                      className="cursor-pointer hover:bg-gray-50/90"
                      onClick={() => navigate(buildLeadManagementDetailPath(row))}
                    >
                      <td>
                        <p className="font-semibold text-gray-900">{row.clientName}</p>
                        <p className="text-xs text-gray-500">#{row.leadNumber}</p>
                      </td>
                      <td className="text-sm text-gray-600">
                        <p className="font-medium text-gray-900">{row.mainCategory || '—'}</p>
                        <p className="text-xs text-gray-500">{row.subcategory || '—'}</p>
                      </td>
                      <td className="tabular-nums text-gray-700">
                        {formatAllocationWorkedDuration(slice.workedMs)}
                      </td>
                      <td className="font-medium tabular-nums text-gray-900">
                        {slice.hourRateNis != null ? `${formatAllocationCostNis(slice.hourRateNis)}/h` : '—'}
                      </td>
                      <td className="tabular-nums text-gray-600">{formatAllocationCostNis(row.costNis)}</td>
                      <td>
                        <BudgetBar
                          utilizationPercent={row.utilizationPercent}
                          exceedsCap={row.exceedsCap}
                          requestCount={row.requestCount}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default EmployeeLeadCostPage;
