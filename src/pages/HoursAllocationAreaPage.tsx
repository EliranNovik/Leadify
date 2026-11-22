import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { ChevronLeftIcon, ChevronRightIcon, ClockIcon, FunnelIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import DepartmentHourTotals from '../components/reports/DepartmentHourTotals';
import HoursAllocationNav from '../components/reports/HoursAllocationNav';
import ReportLoadingScreen from '../components/reports/ReportLoadingScreen';
import {
  agreementDepartmentOptions,
  buildForDepartmentTotals,
  combinedGermanAustrian,
  displayAgreementDepartment,
  forDepartmentFilterOptions,
} from '../lib/employeeDepartmentTotals';
import { fetchClockedInEmployeeIds } from '../lib/employeeClockInStatus';
import {
  buildCategoryNameToDataMap,
  canonicalizeScoreboardDepartment,
  fetchCategoriesWithDepartments,
  resolveCategoryAndDepartment,
} from '../lib/resolveCategoryDepartment';
import { fetchAgreementScoreboardDepartments } from '../lib/scoreboardDepartments';
import {
  allocationEmployeeDateKey,
  allocationPercentToWorkedMs,
  buildAllocationClockInMsByEmployeeDate,
  buildClientRouteFromAllocationRow,
  fetchAllocationReport,
  fetchEffortAllocationReport,
  formatAllocationCostNis,
  formatAllocationPercent,
  formatAllocationWorkedDuration,
  getJerusalemTodayIsoDate,
  isMissingEffortAllocationsTable,
  salaryToHourlyRateNis,
  workedMsAtHourlyRateToCostNis,
} from '../lib/employeeLeadReporting';
import { fetchAverageGrossSalaryLastMonths, getSalaryEmployeeInitials, salaryAvatarGradientStyle, washedEmployeeCardStyle } from '../lib/employeeSalaries';
import {
  peekLeadsManagementSuperUser,
  rememberLeadsManagementSuperUser,
} from '../lib/leadsManagementReport';
import { supabase } from '../lib/supabase';
import { fetchClockInRecordsForAllocationMs } from '../lib/workingHoursExport';
import {
  effortById,
  effortsForArea,
  isEffortArea,
  WORK_AREAS,
  type EffortAreaId,
  type WorkAreaId,
} from '../lib/workAreaEfforts';

type DateMode = 'day' | 'period' | 'all';

type HoursLine = {
  key: string;
  employeeId: number;
  employeeName: string;
  photoUrl: string | null;
  departmentName: string | null;
  workDate: string;
  title: string;
  effortId: string | null;
  subtitle: string;
  category: string;
  percent: number;
  workedMs: number;
  costNis: number | null;
  missingSalary: boolean;
  /** Agreement signed department, same columns as the dashboard. */
  scoreboardDepartments: string[];
  /** Names shown in the For column. Empty targets are General. */
  forDepartments: string[];
  leadCategory: string | null;
  clientPath: string | null;
};

type AgreementCatalog = {
  targets: { id: number; name: string }[];
  categories: any[];
  nameMap: Map<string, any>;
  allDepartments: { id: number; name: string }[];
};

function categoryParts(row: {
  category?: unknown;
  misc_category?: any;
} | null): { lookup: string; label: string | null } {
  const categoryJoin = Array.isArray(row?.misc_category) ? row?.misc_category[0] : row?.misc_category;
  const subcategory = categoryJoin?.name ? String(categoryJoin.name).trim() : '';
  const mainRel = categoryJoin?.misc_maincategory;
  const mainName = Array.isArray(mainRel) ? mainRel[0]?.name : mainRel?.name;
  const main = mainName ? String(mainName).trim() : '';
  const fallback = row?.category != null ? String(row.category).trim() : '';
  const lookup = main && subcategory ? `${main} > ${subcategory}` : subcategory || main || fallback;
  const label = main && subcategory ? `${main} / ${subcategory}` : subcategory || main || fallback || null;
  return { lookup, label };
}

function leadAgreementDepartment(row: { category?: unknown; misc_category?: any } | null, catalog: AgreementCatalog): string | null {
  const combined = combinedGermanAustrian(catalog.targets);
  const { lookup } = categoryParts(row);
  if (!lookup) return combined;
  const resolved = canonicalizeScoreboardDepartment(
    resolveCategoryAndDepartment(lookup, null, null, catalog.categories, catalog.nameMap),
    catalog.targets,
  );
  const name = displayAgreementDepartment(resolved.departmentName, catalog.targets);
  if (!name || resolved.departmentName === 'Other') return combined;
  return name;
}

function effortAgreementDepartments(ids: number[], catalog: AgreementCatalog): string[] {
  const names = new Set<string>();
  for (const id of ids) {
    const raw = catalog.allDepartments.find((dept) => dept.id === id)?.name || '';
    const resolved = canonicalizeScoreboardDepartment(
      {
        departmentId: id,
        departmentName: raw,
        mainCategoryId: null,
        mainCategoryName: null,
      },
      catalog.targets,
    );
    const name = displayAgreementDepartment(resolved.departmentName || raw, catalog.targets);
    if (name) names.add(name);
  }
  return [...names];
}

async function fetchRowsInChunks<T>(ids: Array<string | number>, load: (chunk: Array<string | number>) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let index = 0; index < ids.length; index += 80) {
    const chunk = ids.slice(index, index + 80);
    const { data, error } = await load(chunk);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
  }
  return rows;
}

function formatDayLabel(workDate: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date(`${workDate.slice(0, 10)}T12:00:00`));
}

function shiftIsoDate(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(y, (m || 1) - 1, (d || 1) + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isWorkArea(value: string | undefined): value is WorkAreaId {
  return WORK_AREAS.some((area) => area.id === value);
}

function isOtherWork(line: HoursLine): boolean {
  return line.category === 'Other work';
}

function EmployeeColumnAvatar({
  employeeId,
  employeeName,
  photoUrl,
  clockedIn,
  size = 'sm',
}: {
  employeeId: number;
  employeeName: string;
  photoUrl: string | null;
  clockedIn: boolean;
  size?: 'sm' | 'lg';
}) {
  const [failed, setFailed] = useState(false);
  const src = photoUrl?.trim() || '';
  const showImage = Boolean(src) && !failed;
  const dim = size === 'lg' ? 'h-20 w-20 text-xl' : 'h-8 w-8 text-[11px]';
  return (
    <span className={`relative shrink-0 ${size === 'lg' ? 'h-20 w-20' : 'h-8 w-8'}`}>
      {showImage ? (
        <img
          src={src}
          alt=""
          className={`${dim} rounded-full object-cover`}
          onError={() => setFailed(true)}
        />
      ) : (
        <span
          className={`flex ${dim} items-center justify-center rounded-full font-bold text-white`}
          style={salaryAvatarGradientStyle(employeeId, employeeName)}
        >
          {getSalaryEmployeeInitials(employeeName)}
        </span>
      )}
      {clockedIn ? (
        <span
          className={`absolute -right-0.5 -top-0.5 rounded-full border-2 border-white bg-emerald-500 ${size === 'lg' ? 'h-5 w-5' : 'h-2.5 w-2.5'}`}
          title="Clocked in"
        />
      ) : null}
    </span>
  );
}

function HoursLinesTable({
  lines,
  area,
  employeePage,
  filterQuery,
  clockedInIds,
}: {
  lines: HoursLine[];
  area: WorkAreaId;
  employeePage: boolean;
  filterQuery: string;
  clockedInIds: Set<number>;
}) {
  const navigate = useNavigate();
  const sorted = lines
    .slice()
    .sort((a, b) => b.workDate.localeCompare(a.workDate) || a.employeeName.localeCompare(b.employeeName));
  const showCategory = true;
  const columnWidths = employeePage
    ? showCategory
      ? ['14%', '14%', '20%', '22%', '10%', '10%', '10%']
      : ['16%', '18%', '28%', '12%', '12%', '14%']
    : showCategory
      ? ['18%', '11%', '13%', '16%', '16%', '8%', '9%', '9%']
      : ['20%', '12%', '14%', '22%', '10%', '11%', '11%'];
  return (
    <div className="overflow-x-auto">
      <table className="table table-fixed w-full">
        <colgroup>
          {columnWidths.map((width, index) => (
            <col key={`${width}-${index}`} style={{ width }} />
          ))}
        </colgroup>
        <thead>
          <tr className="text-xs uppercase tracking-wide text-gray-400">
            {employeePage ? null : <th>Employee</th>}
            <th>Date</th>
            <th>{area === 'handling' ? 'Lead' : 'Effort'}</th>
            <th>{area === 'handling' ? 'Client' : 'For'}</th>
            <th>Category</th>
            <th className="text-right">Share</th>
            <th className="text-right">Time</th>
            <th className="text-right">Cost</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((line) => (
            <tr
              key={line.key}
              className={line.clientPath ? 'cursor-pointer hover:bg-gray-50' : undefined}
              onClick={() => {
                if (line.clientPath) navigate(line.clientPath);
              }}
            >
              {employeePage ? null : (
                <td>
                  <Link
                    to={`/reports/hours-allocation/${area}/employees/${line.employeeId}?${filterQuery}`}
                    className="inline-flex items-center gap-2.5 font-medium text-gray-900 hover:underline"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <EmployeeColumnAvatar
                      employeeId={line.employeeId}
                      employeeName={line.employeeName}
                      photoUrl={line.photoUrl}
                      clockedIn={clockedInIds.has(line.employeeId)}
                    />
                    {line.employeeName}
                  </Link>
                </td>
              )}
              <td className="whitespace-nowrap text-gray-400">{formatDayLabel(line.workDate)}</td>
              <td className={`truncate font-medium ${line.clientPath ? 'text-primary' : 'text-gray-900'}`}>{line.title}</td>
              <td className="truncate text-gray-700">{line.subtitle}</td>
              <td className="truncate text-gray-700">
                {area === 'handling' ? line.leadCategory || '—' : line.category}
              </td>
              <td className="text-right tabular-nums text-gray-400">{formatAllocationPercent(line.percent)}%</td>
              <td className="text-right tabular-nums">{formatAllocationWorkedDuration(line.workedMs)}</td>
              <td className="text-right tabular-nums">
                {line.costNis != null ? formatAllocationCostNis(line.costNis) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function dateButtonClass(active: boolean): string {
  return active
    ? 'inline-flex h-10 items-center rounded-[14px] bg-primary px-3.5 text-sm font-semibold text-white shadow-sm'
    : 'inline-flex h-10 items-center rounded-[14px] bg-white px-3.5 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-gray-200 transition-colors hover:bg-gray-50';
}

function HoursAllocationAreaPage() {
  const navigate = useNavigate();
  const { area: areaParam, employeeId: employeeIdParam } = useParams();
  const [searchParams] = useSearchParams();
  const area = isWorkArea(areaParam) ? areaParam : null;
  const employeeId = Number(employeeIdParam);
  const employeePage = Number.isFinite(employeeId) && employeeId > 0;
  const areaLabel = WORK_AREAS.find((item) => item.id === area)?.label ?? 'Hours';

  const knownSuperUser = peekLeadsManagementSuperUser();
  const [isSuperUser, setIsSuperUser] = useState(knownSuperUser === true);
  const [permissionsLoaded, setPermissionsLoaded] = useState(knownSuperUser != null);
  const [dateMode, setDateMode] = useState<DateMode>(() => {
    const range = searchParams.get('range');
    return range === 'day' || range === 'period' || range === 'all' ? range : 'period';
  });
  const [dateToolsOpen, setDateToolsOpen] = useState(false);
  const [workDate, setWorkDate] = useState(() => searchParams.get('date') || getJerusalemTodayIsoDate());
  const [rangeFrom, setRangeFrom] = useState(
    () => searchParams.get('from') || shiftIsoDate(getJerusalemTodayIsoDate(), -29),
  );
  const [rangeTo, setRangeTo] = useState(() => searchParams.get('to') || getJerusalemTodayIsoDate());
  const initialDepartment = searchParams.get('department') || '';
  const [departmentName, setDepartmentName] = useState(() => (/^\d+$/.test(initialDepartment) ? '' : initialDepartment));
  const [agreementCatalog, setAgreementCatalog] = useState<AgreementCatalog | null>(null);
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [debouncedEmployeeSearch, setDebouncedEmployeeSearch] = useState('');
  const [category, setCategory] = useState('');
  const [effortId, setEffortId] = useState('');
  const [query, setQuery] = useState('');
  const [lines, setLines] = useState<HoursLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [clockedInIds, setClockedInIds] = useState<Set<number>>(() => new Set());
  const employeeScrollerRef = useRef<HTMLDivElement>(null);
  const loadRequestRef = useRef(0);
  const [canScrollEmployeesLeft, setCanScrollEmployeesLeft] = useState(false);
  const [canScrollEmployeesRight, setCanScrollEmployeesRight] = useState(false);

  useEffect(() => {
    if (areaParam && !area) navigate('/reports/employee-lead-allocations', { replace: true });
  }, [area, areaParam, navigate]);

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
        console.error('[HoursAllocationArea] permission check failed:', error);
        if (!cancelled) {
          setIsSuperUser(false);
          setPermissionsLoaded(true);
          navigate('/reports');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedEmployeeSearch(employeeSearch.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [employeeSearch]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetchAgreementScoreboardDepartments(),
      fetchCategoriesWithDepartments(supabase),
      supabase.from('tenant_departement').select('id, name').order('id'),
    ])
      .then(([targets, categories, all]) => {
        if (cancelled) return;
        if (all.error) throw all.error;
        setAgreementCatalog({
          targets,
          categories,
          nameMap: buildCategoryNameToDataMap(categories),
          allDepartments: (all.data || []).map((row) => ({
            id: Number(row.id),
            name: String(row.name || '').trim(),
          })),
        });
      })
      .catch((error) => console.error('[HoursAllocationArea] agreement departments failed:', error));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const reload = () => {
      void fetchClockedInEmployeeIds()
        .then((ids) => {
          if (!cancelled) setClockedInIds(ids);
        })
        .catch((error) => console.error('[HoursAllocationArea] clock-in status failed:', error));
    };
    reload();
    const channel = supabase
      .channel(`hours-allocation-clock-${area || 'none'}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'employee_clock_in' }, () => reload())
      .subscribe();
    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [area]);

  const dateRange = useMemo(() => {
    const today = getJerusalemTodayIsoDate();
    if (dateMode === 'all') return { fromDate: null as string | null, toDate: today };
    if (dateMode === 'period') {
      const from = rangeFrom <= rangeTo ? rangeFrom : rangeTo;
      const to = rangeFrom <= rangeTo ? rangeTo : rangeFrom;
      return { fromDate: from, toDate: to };
    }
    return { fromDate: workDate, toDate: workDate };
  }, [dateMode, rangeFrom, rangeTo, workDate]);

  const load = useCallback(async () => {
    if (!isSuperUser || !area) return;
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    try {
      const clockMsFor = async (dates: string[]) => {
        const sorted = dates.filter(Boolean).sort();
        let clockFrom = dateRange.fromDate || sorted[0] || dateRange.toDate || getJerusalemTodayIsoDate();
        let clockTo = dateRange.toDate || sorted[sorted.length - 1] || getJerusalemTodayIsoDate();
        if (clockFrom > clockTo) {
          const swap = clockFrom;
          clockFrom = clockTo;
          clockTo = swap;
        }
        const records = await fetchClockInRecordsForAllocationMs(clockFrom, clockTo);
        return buildAllocationClockInMsByEmployeeDate(records);
      };

      if (area === 'handling') {
        const rows = await fetchAllocationReport({
          fromDate: dateRange.fromDate,
          toDate: dateRange.toDate,
          employeeSearch: employeePage ? undefined : debouncedEmployeeSearch || undefined,
        });
        const clockMs = await clockMsFor(rows.map((row) => row.work_date));
        const salaryMap = await fetchAverageGrossSalaryLastMonths(
          Array.from(new Set(rows.map((row) => row.employee_id))),
          6,
        );
        const newIds = Array.from(new Set(rows.map((row) => row.new_lead_id).filter((id): id is string => Boolean(id))));
        const legacyIds = Array.from(
          new Set(rows.map((row) => row.legacy_lead_id).filter((id): id is number => id != null)),
        );
        const categorySelect = `
          id, category,
          misc_category!category_id ( id, name, misc_maincategory!parent_id ( id, name ) )
        `;
        const legacyCategorySelect = `
          id, category,
          misc_category!leads_lead_category_id_fkey ( id, name, misc_maincategory!parent_id ( id, name ) )
        `;
        const [newLeads, legacyLeads] = await Promise.all([
          newIds.length
            ? fetchRowsInChunks(newIds, (chunk) => supabase.from('leads').select(categorySelect).in('id', chunk as string[]))
            : Promise.resolve([]),
          legacyIds.length
            ? fetchRowsInChunks(legacyIds, (chunk) =>
                supabase.from('leads_lead').select(legacyCategorySelect).in('id', chunk as number[]),
              )
            : Promise.resolve([]),
        ]);
        if (requestId !== loadRequestRef.current) return;
        const newMeta = new Map(
          (newLeads as Array<{ id: string }>).map((row) => [
            String(row.id),
            {
              department: agreementCatalog ? leadAgreementDepartment(row, agreementCatalog) : null,
              category: categoryParts(row).label,
            },
          ]),
        );
        const legacyMeta = new Map(
          (legacyLeads as Array<{ id: number }>).map((row) => [
            Number(row.id),
            {
              department: agreementCatalog ? leadAgreementDepartment(row, agreementCatalog) : null,
              category: categoryParts(row).label,
            },
          ]),
        );
        setLines(
          rows.map((row) => {
            const dayMs = clockMs.get(allocationEmployeeDateKey(row.employee_id, row.work_date)) ?? 0;
            const workedMs = allocationPercentToWorkedMs(dayMs, row.percent);
            const gross = salaryMap.get(row.employee_id);
            const rate = gross != null ? salaryToHourlyRateNis(gross) : null;
            const meta = row.is_other_work
              ? null
              : row.new_lead_id
                ? newMeta.get(row.new_lead_id)
                : row.legacy_lead_id != null
                  ? legacyMeta.get(row.legacy_lead_id)
                  : null;
            return {
              key: `${row.allocation_id}-${row.work_date}-${row.is_other_work ? 'other' : row.lead_number}-${row.percent}`,
              employeeId: row.employee_id,
              employeeName: row.employee_name,
              photoUrl: row.employee_photo_url,
              departmentName: row.department_name,
              workDate: row.work_date,
              title: row.is_other_work ? 'Other work' : `#${row.lead_number}`,
              effortId: null,
              subtitle: row.is_other_work ? 'Not on a lead' : row.client_name,
              category: row.is_other_work ? 'Other work' : 'Lead',
              percent: row.percent,
              workedMs,
              costNis: workedMsAtHourlyRateToCostNis(workedMs, rate),
              missingSalary: !(rate != null && rate > 0),
              scoreboardDepartments: meta?.department ? [meta.department] : [],
              forDepartments: [],
              leadCategory: meta?.category || null,
              clientPath: buildClientRouteFromAllocationRow(row),
            };
          }),
        );
        return;
      }

      const rows = (
        await fetchEffortAllocationReport({
          fromDate: dateRange.fromDate,
          toDate: dateRange.toDate,
          employeeSearch: employeePage ? undefined : debouncedEmployeeSearch || undefined,
        })
      ).filter((row) => row.area === area);
      const clockMs = await clockMsFor(rows.map((row) => row.workDate));
      const salaryMap = await fetchAverageGrossSalaryLastMonths(
        Array.from(new Set(rows.map((row) => row.employeeId))),
        6,
      );
      if (requestId !== loadRequestRef.current) return;
      const departmentLabel = (id: number) =>
        agreementCatalog?.allDepartments.find((item) => item.id === id)?.name || `Department #${id}`;
      setLines(
        rows.map((row) => {
          const effort = effortById(row.effortId);
          const dayMs = clockMs.get(allocationEmployeeDateKey(row.employeeId, row.workDate)) ?? 0;
          const workedMs = allocationPercentToWorkedMs(dayMs, row.percent);
          const gross = salaryMap.get(row.employeeId);
          const rate = gross != null ? salaryToHourlyRateNis(gross) : null;
          const forDepartments =
            row.targetDepartmentIds.length > 0
              ? row.targetDepartmentIds.map(departmentLabel).map((name) => name.trim()).filter(Boolean)
              : ['General'];
          const targets = forDepartments.join(', ') || 'General';
          return {
            key: `${row.allocationId}-${row.effortId}-${row.workDate}-${targets}`,
            employeeId: row.employeeId,
            employeeName: row.employeeName,
            photoUrl: row.employeePhotoUrl,
            departmentName: row.departmentName,
            workDate: row.workDate,
            title: effort?.name ?? row.effortId,
            effortId: row.effortId,
            subtitle: targets,
            category: effort?.category ?? '—',
            percent: row.percent,
            workedMs,
            costNis: workedMsAtHourlyRateToCostNis(workedMs, rate),
            missingSalary: !(rate != null && rate > 0),
            scoreboardDepartments: agreementCatalog
              ? effortAgreementDepartments(row.targetDepartmentIds, agreementCatalog)
              : [],
            forDepartments: forDepartments.length > 0 ? forDepartments : ['General'],
            leadCategory: null,
            clientPath: null,
          };
        }),
      );
    } catch (error) {
      console.error('[HoursAllocationArea] load failed:', error);
      if (!isMissingEffortAllocationsTable(error)) {
        toast.error(error instanceof Error ? error.message : 'Failed to load hours');
      }
      if (requestId === loadRequestRef.current) setLines([]);
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }, [agreementCatalog, area, dateRange, debouncedEmployeeSearch, employeePage, isSuperUser]);

  useEffect(() => {
    if (!permissionsLoaded || !isSuperUser) return;
    void load();
  }, [isSuperUser, load, permissionsLoaded]);

  const categories = useMemo(() => {
    const names = new Set<string>();
    for (const line of lines) if (line.category) names.add(line.category);
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [lines]);

  const effortOptions = useMemo(() => {
    if (!area || !isEffortArea(area)) return [];
    return effortsForArea(area as EffortAreaId).filter((effort) => !category || effort.category === category);
  }, [area, category]);

  const forDepartmentOptions = useMemo(
    () => forDepartmentFilterOptions(agreementCatalog?.allDepartments || []),
    [agreementCatalog],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return lines.filter((line) => {
      if (employeePage && line.employeeId !== employeeId) return false;
      if (departmentName) {
        const matches =
          area === 'handling'
            ? line.scoreboardDepartments.includes(departmentName)
            : line.forDepartments.includes(departmentName);
        if (!matches) return false;
      }
      if (category && line.category !== category) return false;
      if (effortId && line.effortId !== effortId) return false;
      if (!q) return true;
      return (
        line.title.toLowerCase().includes(q) ||
        line.subtitle.toLowerCase().includes(q) ||
        line.employeeName.toLowerCase().includes(q) ||
        line.category.toLowerCase().includes(q)
      );
    });
  }, [area, category, departmentName, effortId, employeeId, employeePage, lines, query]);

  const leadLines = filtered.filter((line) => !isOtherWork(line));
  const otherWorkLines = filtered.filter(isOtherWork);

  const employees = useMemo(() => {
    const byId = new Map<
      number,
      {
        employeeId: number;
        employeeName: string;
        photoUrl: string | null;
        departmentName: string | null;
        workedMs: number;
        costNis: number;
        missingSalary: boolean;
        lastWorkDate: string | null;
      }
    >();
    for (const line of filtered) {
      const current = byId.get(line.employeeId) || {
        employeeId: line.employeeId,
        employeeName: line.employeeName,
        photoUrl: line.photoUrl,
        departmentName: line.departmentName,
        workedMs: 0,
        costNis: 0,
        missingSalary: false,
        lastWorkDate: null,
      };
      current.workedMs += line.workedMs;
      current.costNis += line.costNis || 0;
      if (line.missingSalary) current.missingSalary = true;
      if (!current.lastWorkDate || line.workDate > current.lastWorkDate) current.lastWorkDate = line.workDate;
      byId.set(line.employeeId, current);
    }
    return [...byId.values()].sort(
      (a, b) => b.workedMs - a.workedMs || a.employeeName.localeCompare(b.employeeName),
    );
  }, [filtered]);

  useEffect(() => {
    const el = employeeScrollerRef.current;
    if (!el) return;
    const update = () => {
      setCanScrollEmployeesLeft(el.scrollLeft > 4);
      setCanScrollEmployeesRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      el.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [employees.length, employeePage]);

  const scrollEmployees = (direction: -1 | 1) => {
    const el = employeeScrollerRef.current;
    if (!el) return;
    const card = el.querySelector('a');
    const distance = card ? card.getBoundingClientRect().width + 12 : Math.round(el.clientWidth * 0.8);
    el.scrollBy({ left: direction * distance, behavior: 'smooth' });
  };

  const profile = employees[0];
  const totalMs = filtered.reduce((sum, line) => sum + line.workedMs, 0);
  const totalCost = filtered.reduce((sum, line) => sum + (line.costNis || 0), 0);
  const otherWorkMs = otherWorkLines.reduce((sum, line) => sum + line.workedMs, 0);
  const otherWorkCost = otherWorkLines.reduce((sum, line) => sum + (line.costNis || 0), 0);
  const clientSpend = new Map<string, number>();
  for (const line of leadLines) {
    const name = line.subtitle.trim();
    if (!name || name === 'Not on a lead') continue;
    clientSpend.set(name, (clientSpend.get(name) || 0) + (line.costNis || 0));
  }
  const highestClient = [...clientSpend.entries()].reduce<{ name: string; costNis: number } | null>(
    (best, [name, costNis]) => (!best || costNis > best.costNis ? { name, costNis } : best),
    null,
  );
  const departmentTotals = (() => {
    if (!area || employeePage) return [];
    if (area === 'handling') {
      const combined = combinedGermanAustrian(agreementCatalog?.targets || []);
      const byName = new Map<string, { workedMs: number; costNis: number }>();
      for (const line of leadLines) {
        const names = (line.scoreboardDepartments.length > 0 ? line.scoreboardDepartments : [combined]).map((name) =>
          name === 'Other' ? combined : name,
        );
        for (const name of names) {
          const current = byName.get(name) || { workedMs: 0, costNis: 0 };
          current.workedMs += line.workedMs;
          current.costNis += line.costNis || 0;
          byName.set(name, current);
        }
      }
      const order = agreementDepartmentOptions(agreementCatalog?.targets || []);
      return [...byName.entries()]
        .sort((a, b) => {
          const ai = order.indexOf(a[0]);
          const bi = order.indexOf(b[0]);
          if (ai === -1 && bi === -1) return b[1].workedMs - a[1].workedMs;
          if (ai === -1) return 1;
          if (bi === -1) return -1;
          return ai - bi;
        })
        .map(([name, totals]) => ({ name, ...totals }));
    }

    return buildForDepartmentTotals(
      filtered.map((line) => ({
        forDepartments: line.forDepartments,
        workedMs: line.workedMs,
        costNis: line.costNis,
      })),
      agreementCatalog?.allDepartments || [],
    );
  })();
  useEffect(() => {
    const next = searchParams.get('department') || '';
    setDepartmentName(/^\d+$/.test(next) ? '' : next);
  }, [searchParams]);

  const dateQuery = useMemo(() => {
    const params = new URLSearchParams();
    params.set('range', dateMode);
    if (dateMode === 'day') params.set('date', workDate);
    if (dateMode === 'period') {
      params.set('from', rangeFrom);
      params.set('to', rangeTo);
    }
    return params.toString();
  }, [dateMode, rangeFrom, rangeTo, workDate]);

  const filterQuery = useMemo(() => {
    const params = new URLSearchParams();
    params.set('range', dateMode);
    if (dateMode === 'day') params.set('date', workDate);
    if (dateMode === 'period') {
      params.set('from', rangeFrom);
      params.set('to', rangeTo);
    }
    if (departmentName) params.set('department', departmentName);
    return params.toString();
  }, [dateMode, departmentName, rangeFrom, rangeTo, workDate]);

  if (!permissionsLoaded || !isSuperUser || !area) {
    return (
      <div className="flex min-h-[calc(100dvh-3.5rem)] items-center justify-center bg-[#ececec]">
        <ReportLoadingScreen title="Hours allocation" subtitle="Opening the report…" icon={ClockIcon} />
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-[#ececec]">
      <div className="flex min-h-[calc(100dvh-3.5rem)] w-full items-stretch">
        <HoursAllocationNav
          activeArea={area}
          activeDepartment={departmentName}
          dateQuery={dateQuery}
          back={
            employeePage
              ? { to: `/reports/hours-allocation/${area}?${filterQuery}`, label: areaLabel }
              : { to: `/reports/employee-lead-allocations?${dateQuery}`, label: 'Hours allocation' }
          }
        />
        <div className="hours-nav-page min-w-0 flex-1 space-y-5 px-4 py-6 md:px-8 md:py-8">
        <div
          className={`flex flex-wrap justify-between gap-3 ${
            employeePage ? 'items-center rounded-2xl p-4' : 'items-start'
          }`}
          style={
            employeePage
              ? washedEmployeeCardStyle(profile?.employeeId || employeeId, profile?.employeeName || 'Employee hours')
              : undefined
          }
        >
          <div>
            <div className="flex items-center gap-3">
              {employeePage && profile ? (
                <EmployeeColumnAvatar
                  employeeId={profile.employeeId}
                  employeeName={profile.employeeName}
                  photoUrl={profile.photoUrl}
                  clockedIn={clockedInIds.has(profile.employeeId)}
                  size="lg"
                />
              ) : null}
              <div>
                <h1 className="text-2xl font-bold text-gray-900">
                  {employeePage ? profile?.employeeName || 'Employee hours' : `${areaLabel} hours`}
                </h1>
                {employeePage && profile?.departmentName ? (
                  <p className="mt-0.5 text-sm text-gray-500">{profile.departmentName}</p>
                ) : null}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            {(
              [
                ['Time', formatAllocationWorkedDuration(totalMs)],
                ['Cost', formatAllocationCostNis(totalCost)],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <p className="mb-1 px-1 text-xs font-semibold uppercase tracking-wider text-gray-500">{label}</p>
                <div className="min-w-[7.5rem] rounded-2xl bg-white px-4 py-2.5 shadow-sm ring-1 ring-gray-100">
                  <p className="text-lg font-bold tabular-nums text-gray-900">{value}</p>
                </div>
              </div>
            ))}
            {employeePage ? (
              <>
                <div>
                  <p className="mb-1 px-1 text-xs font-semibold uppercase tracking-wider text-gray-500">Highest client</p>
                  <div className="min-w-[7.5rem] rounded-2xl bg-white px-4 py-2.5 shadow-sm ring-1 ring-gray-100">
                    <p className="max-w-[12rem] truncate text-lg font-bold text-gray-900">{highestClient?.name || '—'}</p>
                    <p className="text-xs tabular-nums text-gray-500">
                      {highestClient ? formatAllocationCostNis(highestClient.costNis) : ''}
                    </p>
                  </div>
                </div>
                <div>
                  <p className="mb-1 px-1 text-xs font-semibold uppercase tracking-wider text-gray-500">Other work</p>
                  <div className="min-w-[7.5rem] rounded-2xl bg-white px-4 py-2.5 shadow-sm ring-1 ring-gray-100">
                    <p className="text-lg font-bold tabular-nums text-gray-900">{formatAllocationWorkedDuration(otherWorkMs)}</p>
                    <p className="text-xs tabular-nums text-gray-500">{formatAllocationCostNis(otherWorkCost)}</p>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>

        <DepartmentHourTotals totals={departmentTotals} carousel />

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-2">
            <span className="block text-xs font-semibold uppercase tracking-wider text-gray-500">Date</span>
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                {dateMode === 'day' ? (
                  <input
                    type="date"
                    className="input h-10 min-h-10 rounded-[14px] border-0 bg-white px-3 ring-1 ring-gray-200"
                    value={workDate}
                    max={getJerusalemTodayIsoDate()}
                    onChange={(event) => setWorkDate(event.target.value)}
                  />
                ) : dateMode === 'period' ? (
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="block">
                      <input
                        type="date"
                        aria-label="From"
                        className="input h-10 min-h-10 rounded-[14px] border-0 bg-white px-3 ring-1 ring-gray-200"
                        value={rangeFrom}
                        onChange={(event) => setRangeFrom(event.target.value)}
                      />
                    </label>
                    <label className="block">
                      <input
                        type="date"
                        aria-label="To"
                        className="input h-10 min-h-10 rounded-[14px] border-0 bg-white px-3 ring-1 ring-gray-200"
                        value={rangeTo}
                        max={getJerusalemTodayIsoDate()}
                        onChange={(event) => setRangeTo(event.target.value)}
                      />
                    </label>
                  </div>
                ) : (
                  <div className="flex h-10 min-w-[11rem] items-center rounded-[14px] bg-white px-3 text-sm text-gray-600 ring-1 ring-gray-200">
                    All reporting
                  </div>
                )}
              </div>
              <button
                type="button"
                aria-expanded={dateToolsOpen}
                aria-label={dateToolsOpen ? 'Hide date filters' : 'Show date filters'}
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full shadow-sm ring-1 ring-gray-200 transition-colors ${
                  dateToolsOpen ? 'bg-primary text-white' : 'bg-white text-gray-700 hover:bg-gray-50'
                }`}
                onClick={() => setDateToolsOpen((open) => !open)}
              >
                <FunnelIcon className="h-5 w-5" aria-hidden />
              </button>
            </div>
            {dateToolsOpen ? (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={dateButtonClass(dateMode === 'period')} onClick={() => setDateMode('period')}>
                Period
              </button>
              <button type="button" className={dateButtonClass(dateMode === 'all')} onClick={() => setDateMode('all')}>
                Show all
              </button>
              {dateMode !== 'day' ? (
                <button type="button" className={dateButtonClass(false)} onClick={() => setDateMode('day')}>
                  Day
                </button>
              ) : null}
            </div>
            ) : null}
          </div>
          <label className="block min-w-[10rem] flex-1">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-500">Department</span>
            <select
              className="select select-bordered select-sm h-10 min-h-10 w-full bg-white"
              value={departmentName}
              onChange={(event) => setDepartmentName(event.target.value)}
            >
              <option value="">All departments</option>
              {(area === 'handling'
                ? agreementDepartmentOptions(agreementCatalog?.targets || [])
                : forDepartmentOptions
              ).map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          {area !== 'handling' ? (
            <>
              <label className="block min-w-[10rem] flex-1">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-500">Category</span>
                <select
                  className="select select-bordered select-sm h-10 min-h-10 w-full bg-white"
                  value={category}
                  onChange={(event) => {
                    setCategory(event.target.value);
                    setEffortId('');
                  }}
                >
                  <option value="">All categories</option>
                  {categories.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block min-w-[10rem] flex-1">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-500">Effort</span>
                <select
                  className="select select-bordered select-sm h-10 min-h-10 w-full bg-white"
                  value={effortId}
                  onChange={(event) => setEffortId(event.target.value)}
                >
                  <option value="">All efforts</option>
                  {effortOptions.map((effort) => (
                    <option key={effort.id} value={effort.id}>
                      {effort.name}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : null}
          {employeePage ? null : (
            <label className="block min-w-[12rem] flex-1">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-500">Employee</span>
              <div className="flex h-10 min-h-10 items-center gap-2 rounded-[14px] bg-white px-3 ring-1 ring-gray-200 focus-within:ring-2 focus-within:ring-primary/15">
                <MagnifyingGlassIcon className="h-4 w-4 shrink-0 text-black" aria-hidden />
                <input
                  type="search"
                  className="h-full min-w-0 grow bg-transparent text-sm outline-none placeholder:text-gray-400"
                  placeholder="Name…"
                  value={employeeSearch}
                  onChange={(event) => setEmployeeSearch(event.target.value)}
                />
              </div>
            </label>
          )}
          <label className="block min-w-[12rem] flex-1">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-500">
              {area === 'handling' ? 'Lead' : 'Search'}
            </span>
            <div className="flex h-10 min-h-10 items-center gap-2 rounded-[14px] bg-white px-3 ring-1 ring-gray-200 focus-within:ring-2 focus-within:ring-primary/15">
              <MagnifyingGlassIcon className="h-4 w-4 shrink-0 text-black" aria-hidden />
              <input
                type="search"
                className="h-full min-w-0 grow bg-transparent text-sm outline-none placeholder:text-gray-400"
                placeholder={area === 'handling' ? 'Lead # or client…' : 'Effort or department…'}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          </label>
        </div>

        {employeePage ? null : employees.length > 0 ? (
          <div className="flex items-center gap-2">
            {canScrollEmployeesLeft || canScrollEmployeesRight ? (
              <button
                type="button"
                aria-label="Previous employees"
                disabled={!canScrollEmployeesLeft}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-gray-700 shadow-md ring-1 ring-black/10 hover:bg-gray-50 disabled:opacity-40"
                onClick={() => scrollEmployees(-1)}
              >
                <ChevronLeftIcon className="h-5 w-5" aria-hidden />
              </button>
            ) : null}
          <div
            ref={employeeScrollerRef}
            className="flex min-w-0 flex-1 snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth pb-1 scrollbar-hide"
          >
            {employees.map((employee) => (
              <Link
                key={employee.employeeId}
                to={`/reports/hours-allocation/${area}/employees/${employee.employeeId}?${filterQuery}`}
                className="relative flex w-64 shrink-0 snap-start flex-col rounded-2xl p-3 text-left ring-1 ring-black/5 transition hover:brightness-95"
                style={washedEmployeeCardStyle(employee.employeeId, employee.employeeName)}
              >
                {employee.lastWorkDate ? (
                  <span className="absolute right-2 top-2 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">
                    {formatDayLabel(employee.lastWorkDate)}
                  </span>
                ) : null}
                <span className="flex min-w-0 items-center gap-3 pr-12">
                  <span className="relative h-11 w-11 shrink-0">
                    {employee.photoUrl ? (
                      <img src={employee.photoUrl} alt="" className="h-11 w-11 rounded-full object-cover" />
                    ) : (
                      <span
                        className="flex h-11 w-11 items-center justify-center rounded-full text-sm font-bold text-white"
                        style={salaryAvatarGradientStyle(employee.employeeId, employee.employeeName)}
                      >
                        {getSalaryEmployeeInitials(employee.employeeName)}
                      </span>
                    )}
                    {clockedInIds.has(employee.employeeId) ? (
                      <span
                        className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-500"
                        title="Clocked in"
                      />
                    ) : null}
                  </span>
                  <span className="block truncate text-sm font-semibold text-gray-900">{employee.employeeName}</span>
                </span>
                <span className="mt-2 flex items-baseline gap-2 text-left text-sm">
                  <span className="font-bold tabular-nums text-gray-900">{formatAllocationWorkedDuration(employee.workedMs)}</span>
                  <span className="font-medium text-gray-300">|</span>
                  <span className="font-medium tabular-nums text-gray-500">{formatAllocationCostNis(employee.costNis)}</span>
                </span>
              </Link>
            ))}
          </div>
            {canScrollEmployeesLeft || canScrollEmployeesRight ? (
              <button
                type="button"
                aria-label="Next employees"
                disabled={!canScrollEmployeesRight}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-gray-700 shadow-md ring-1 ring-black/10 hover:bg-gray-50 disabled:opacity-40"
                onClick={() => scrollEmployees(1)}
              >
                <ChevronRightIcon className="h-5 w-5" aria-hidden />
              </button>
            ) : null}
          </div>
        ) : null}

        {loading ? (
          <ReportLoadingScreen title="Loading hours" subtitle="Gathering reported time…" icon={ClockIcon} />
        ) : filtered.length === 0 ? (
          <p className="rounded-2xl bg-white px-5 py-10 text-center text-sm text-gray-500 shadow-sm ring-1 ring-gray-100">
            No hours match these filters.
          </p>
        ) : (
          <>
            {leadLines.length > 0 ? (
              <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-100">
                {otherWorkLines.length > 0 ? (
                  <div className="border-b border-gray-100 px-5 py-3">
                    <h2 className="text-sm font-semibold text-gray-900">Leads</h2>
                  </div>
                ) : null}
                <HoursLinesTable
                  lines={leadLines}
                  area={area}
                  employeePage={employeePage}
                  filterQuery={filterQuery}
                  clockedInIds={clockedInIds}
                />
              </section>
            ) : null}
            {otherWorkLines.length > 0 ? (
              <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-100">
                <div className="border-b border-gray-100 px-5 py-3">
                  <h2 className="text-sm font-semibold text-gray-900">Other work</h2>
                  <p className="text-xs text-gray-500">
                    {formatAllocationWorkedDuration(otherWorkLines.reduce((sum, line) => sum + line.workedMs, 0))}
                  </p>
                </div>
                <HoursLinesTable
                  lines={otherWorkLines}
                  area={area}
                  employeePage={employeePage}
                  filterQuery={filterQuery}
                  clockedInIds={clockedInIds}
                />
              </section>
            ) : null}
          </>
        )}
        </div>
      </div>
    </div>
  );
}

export default HoursAllocationAreaPage;
