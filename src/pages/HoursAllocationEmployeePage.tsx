import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { FaWhatsapp } from 'react-icons/fa';
import { ChatBubbleLeftRightIcon, ClockIcon, EnvelopeIcon, FunnelIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import RMQMessagesPage from './RMQMessagesPage';
import ReportLoadingScreen from '../components/reports/ReportLoadingScreen';
import { fetchClockedInEmployeeIds } from '../lib/employeeClockInStatus';
import {
  agreementDepartmentOptions,
  combinedGermanAustrian,
  displayAgreementDepartment,
  mergedEmployeeDepartmentName,
} from '../lib/employeeDepartmentTotals';
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
import { prefetchEmployeePhotos, resolveEmployeePhotoUrl, toEmployeeAvatarSrc } from '../lib/employeePhotoUrl';
import { getEmployeeRoleDisplayName } from '../lib/employeeRoles';
import { fetchAverageGrossSalaryLastMonths, getSalaryEmployeeInitials, salaryAvatarGradientStyle, washedEmployeeCardStyle } from '../lib/employeeSalaries';
import { peekLeadsManagementSuperUser, rememberLeadsManagementSuperUser } from '../lib/leadsManagementReport';
import {
  buildCategoryNameToDataMap,
  canonicalizeScoreboardDepartment,
  fetchCategoriesWithDepartments,
  resolveCategoryAndDepartment,
} from '../lib/resolveCategoryDepartment';
import { fetchAgreementScoreboardDepartments } from '../lib/scoreboardDepartments';
import { supabase } from '../lib/supabase';
import { fetchClockInRecordsForAllocationMs } from '../lib/workingHoursExport';
import { effortById, WORK_AREAS, type WorkAreaId } from '../lib/workAreaEfforts';
import HoursAllocationNav from '../components/reports/HoursAllocationNav';

type DateMode = 'day' | 'period' | 'all';

type HoursLine = {
  key: string;
  area: WorkAreaId;
  workDate: string;
  title: string;
  subtitle: string;
  category: string;
  leadCategory: string | null;
  percent: number;
  workedMs: number;
  costNis: number | null;
  scoreboardDepartments: string[];
  forDepartments: string[];
  clientPath: string | null;
  otherWork: boolean;
};

type AgreementCatalog = {
  targets: { id: number; name: string }[];
  categories: any[];
  nameMap: Map<string, any>;
  allDepartments: { id: number; name: string }[];
};

const AREA_ORDER: WorkAreaId[] = ['handling', 'marketing', 'sales', 'finances', 'development'];

function categoryParts(row: { category?: unknown; misc_category?: any } | null) {
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

function leadAgreementDepartment(row: { category?: unknown; misc_category?: any } | null, catalog: AgreementCatalog): string {
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
      { departmentId: id, departmentName: raw, mainCategoryId: null, mainCategoryName: null },
      catalog.targets,
    );
    const name = displayAgreementDepartment(resolved.departmentName || raw, catalog.targets);
    if (name) names.add(name);
  }
  return [...names];
}

async function fetchRowsInChunks<T>(
  ids: Array<string | number>,
  load: (chunk: Array<string | number>) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let index = 0; index < ids.length; index += 80) {
    const { data, error } = await load(ids.slice(index, index + 80));
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
  }
  return rows;
}

function formatDayLabel(workDate: string): string {
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(
    new Date(`${workDate.slice(0, 10)}T12:00:00`),
  );
}

function shiftIsoDate(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(y, (m || 1) - 1, (d || 1) + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dateButtonClass(active: boolean): string {
  return active
    ? 'inline-flex h-10 items-center rounded-[14px] bg-primary px-3.5 text-sm font-semibold text-white shadow-sm'
    : 'inline-flex h-10 items-center rounded-[14px] bg-white px-3.5 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-gray-200 transition-colors hover:bg-gray-50';
}

function LinesTable({ lines, area }: { lines: HoursLine[]; area: WorkAreaId }) {
  const navigate = useNavigate();
  const sorted = lines.slice().sort((a, b) => b.workDate.localeCompare(a.workDate) || a.title.localeCompare(b.title));
  return (
    <div className="overflow-x-auto">
      <table className="table table-fixed w-full">
        <colgroup>
          {['14%', '16%', '22%', '20%', '10%', '9%', '9%'].map((width, index) => (
            <col key={`${width}-${index}`} style={{ width }} />
          ))}
        </colgroup>
        <thead>
          <tr className="text-xs uppercase tracking-wide text-gray-400">
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
              <td className="whitespace-nowrap text-gray-400">{formatDayLabel(line.workDate)}</td>
              <td className={`truncate font-medium ${line.clientPath ? 'text-primary' : 'text-gray-900'}`}>{line.title}</td>
              <td className="truncate text-gray-700">{line.subtitle}</td>
              <td className="truncate text-gray-700">{area === 'handling' ? line.leadCategory || '—' : line.category}</td>
              <td className="text-right tabular-nums text-gray-400">{formatAllocationPercent(line.percent)}%</td>
              <td className="text-right tabular-nums">{formatAllocationWorkedDuration(line.workedMs)}</td>
              <td className="text-right tabular-nums">{line.costNis != null ? formatAllocationCostNis(line.costNis) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HoursAllocationEmployeePage() {
  const navigate = useNavigate();
  const { employeeId: employeeIdParam } = useParams();
  const [searchParams] = useSearchParams();
  const employeeId = Number(employeeIdParam);
  const knownSuperUser = peekLeadsManagementSuperUser();
  const [isSuperUser, setIsSuperUser] = useState(knownSuperUser === true);
  const [permissionsLoaded, setPermissionsLoaded] = useState(knownSuperUser != null);
  const [dateMode, setDateMode] = useState<DateMode>(() => {
    const range = searchParams.get('range');
    return range === 'day' || range === 'period' || range === 'all' ? range : 'period';
  });
  const [dateToolsOpen, setDateToolsOpen] = useState(false);
  const [workDate, setWorkDate] = useState(() => searchParams.get('date') || getJerusalemTodayIsoDate());
  const [rangeFrom, setRangeFrom] = useState(() => searchParams.get('from') || shiftIsoDate(getJerusalemTodayIsoDate(), -29));
  const [rangeTo, setRangeTo] = useState(() => searchParams.get('to') || getJerusalemTodayIsoDate());
  const initialDepartment = searchParams.get('department') || '';
  const [departmentName, setDepartmentName] = useState(() => (/^\d+$/.test(initialDepartment) ? '' : initialDepartment));
  const [areaFilter, setAreaFilter] = useState<WorkAreaId | ''>('');
  const [query, setQuery] = useState('');
  const [agreementCatalog, setAgreementCatalog] = useState<AgreementCatalog | null>(null);
  const [lines, setLines] = useState<HoursLine[]>([]);
  const [profile, setProfile] = useState<{
    name: string;
    photoUrl: string | null;
    departmentName: string | null;
    roleName: string | null;
    isAdmin: boolean;
    email: string | null;
    whatsappNumber: string | null;
    chatUserId: string | null;
  } | null>(null);
  const [rmqOpen, setRmqOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [clockedIn, setClockedIn] = useState(false);
  const loadRequestRef = useRef(0);

  useEffect(() => {
    if (!Number.isFinite(employeeId) || employeeId <= 0) {
      navigate('/reports/employee-lead-allocations', { replace: true });
    }
  }, [employeeId, navigate]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user?.id) {
          if (!cancelled) {
            setIsSuperUser(false);
            setPermissionsLoaded(true);
          }
          return;
        }
        let { data: userData } = await supabase.from('users').select('is_superuser').eq('auth_id', user.id).maybeSingle();
        if (!userData && user.email) {
          const { data: userByEmail } = await supabase.from('users').select('is_superuser').eq('email', user.email).maybeSingle();
          userData = userByEmail;
        }
        const isSuper = userData?.is_superuser === true || userData?.is_superuser === 'true' || userData?.is_superuser === 1;
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
        console.error('[HoursAllocationEmployee] permission check failed:', error);
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
          allDepartments: (all.data || []).map((row) => ({ id: Number(row.id), name: String(row.name || '').trim() })),
        });
      })
      .catch((error) => console.error('[HoursAllocationEmployee] departments failed:', error));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!Number.isFinite(employeeId) || employeeId <= 0) return;
    setRmqOpen(false);
    let cancelled = false;
    void Promise.all([
      supabase
        .from('tenants_employee')
        .select('id, display_name, photo_url, bonuses_role, mobile, employee_mobile, tenant_departement!department_id(name)')
        .eq('id', employeeId)
        .maybeSingle(),
      supabase.from('users').select('id, email, is_superuser').eq('employee_id', employeeId).limit(5),
    ]).then(([employeeResult, userResult]) => {
      if (cancelled || employeeResult.error || !employeeResult.data) return;
      const data = employeeResult.data;
      const deptRaw = data.tenant_departement as { name?: string | null } | { name?: string | null }[] | null;
      const dept = Array.isArray(deptRaw) ? deptRaw[0] : deptRaw;
      const photoUrl = resolveEmployeePhotoUrl(data.photo_url);
      const roleName = getEmployeeRoleDisplayName(data.bonuses_role);
      const users = userResult.data || [];
      const contact = users.find((row) => String(row.email || '').trim()) || users[0];
      const isAdmin = users.some((row) => {
        const flag = row.is_superuser as boolean | string | number | null;
        return flag === true || flag === 'true' || flag === 1;
      });
      const whatsappNumber = String(data.employee_mobile || data.mobile || '').trim() || null;
      if (photoUrl) prefetchEmployeePhotos([photoUrl], 96);
      setProfile((current) => ({
        name: String(data.display_name || '').trim() || current?.name || `Employee #${employeeId}`,
        photoUrl: photoUrl || current?.photoUrl || null,
        departmentName: String(dept?.name || '').trim() || current?.departmentName || null,
        roleName: roleName || current?.roleName || null,
        isAdmin,
        email: String(contact?.email || '').trim() || current?.email || null,
        whatsappNumber: whatsappNumber || current?.whatsappNumber || null,
        chatUserId: contact?.id ? String(contact.id) : current?.chatUserId || null,
      }));
    });
    return () => {
      cancelled = true;
    };
  }, [employeeId]);

  useEffect(() => {
    let cancelled = false;
    void fetchClockedInEmployeeIds()
      .then((ids) => {
        if (!cancelled) setClockedIn(ids.has(employeeId));
      })
      .catch((error) => console.error('[HoursAllocationEmployee] clock-in status failed:', error));
    return () => {
      cancelled = true;
    };
  }, [employeeId]);

  const dateRange = useMemo(() => {
    if (dateMode === 'all') return { fromDate: null as string | null, toDate: null as string | null };
    if (dateMode === 'period') {
      const from = rangeFrom <= rangeTo ? rangeFrom : rangeTo;
      const to = rangeFrom <= rangeTo ? rangeTo : rangeFrom;
      return { fromDate: from, toDate: to };
    }
    return { fromDate: workDate, toDate: workDate };
  }, [dateMode, rangeFrom, rangeTo, workDate]);

  const load = useCallback(async () => {
    if (!isSuperUser || !Number.isFinite(employeeId) || employeeId <= 0) return;
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    try {
      const [handlingRows, effortRows] = await Promise.all([
        fetchAllocationReport({ fromDate: dateRange.fromDate, toDate: dateRange.toDate }),
        fetchEffortAllocationReport({ fromDate: dateRange.fromDate, toDate: dateRange.toDate }).catch((error) => {
          if (!isMissingEffortAllocationsTable(error)) throw error;
          return [];
        }),
      ]);
      const mineHandling = handlingRows.filter((row) => row.employee_id === employeeId);
      const mineEffort = effortRows.filter((row) => row.employeeId === employeeId);
      const dates = [
        ...mineHandling.map((row) => String(row.work_date || '').slice(0, 10)),
        ...mineEffort.map((row) => row.workDate),
      ].filter(Boolean).sort();
      let clockFrom = dateRange.fromDate || dates[0] || getJerusalemTodayIsoDate();
      let clockTo = dateRange.toDate || dates[dates.length - 1] || getJerusalemTodayIsoDate();
      if (clockFrom > clockTo) {
        const swap = clockFrom;
        clockFrom = clockTo;
        clockTo = swap;
      }
      const [clockRecords, salaryMap] = await Promise.all([
        fetchClockInRecordsForAllocationMs(clockFrom, clockTo),
        fetchAverageGrossSalaryLastMonths([employeeId], 6),
      ]);
      if (requestId !== loadRequestRef.current) return;
      const clockMs = buildAllocationClockInMsByEmployeeDate(clockRecords);
      const rate = salaryToHourlyRateNis(salaryMap.get(employeeId));

      const newIds = Array.from(new Set(mineHandling.map((row) => row.new_lead_id).filter((id): id is string => Boolean(id))));
      const legacyIds = Array.from(new Set(mineHandling.map((row) => row.legacy_lead_id).filter((id): id is number => id != null)));
      const categorySelect = 'id, category, misc_category!category_id ( id, name, misc_maincategory!parent_id ( id, name ) )';
      const legacyCategorySelect = 'id, category, misc_category!leads_lead_category_id_fkey ( id, name, misc_maincategory!parent_id ( id, name ) )';
      const [newLeads, legacyLeads] = await Promise.all([
        newIds.length ? fetchRowsInChunks(newIds, (chunk) => supabase.from('leads').select(categorySelect).in('id', chunk as string[])) : Promise.resolve([]),
        legacyIds.length
          ? fetchRowsInChunks(legacyIds, (chunk) => supabase.from('leads_lead').select(legacyCategorySelect).in('id', chunk as number[]))
          : Promise.resolve([]),
      ]);
      if (requestId !== loadRequestRef.current) return;
      const newMeta = new Map(
        (newLeads as Array<{ id: string }>).map((row) => [
          String(row.id),
          { department: agreementCatalog ? leadAgreementDepartment(row, agreementCatalog) : null, category: categoryParts(row).label },
        ]),
      );
      const legacyMeta = new Map(
        (legacyLeads as Array<{ id: number }>).map((row) => [
          Number(row.id),
          { department: agreementCatalog ? leadAgreementDepartment(row, agreementCatalog) : null, category: categoryParts(row).label },
        ]),
      );
      const departmentLabel = (id: number) => {
        const raw = agreementCatalog?.allDepartments.find((item) => item.id === id)?.name || '';
        if (!raw) return `Department #${id}`;
        return mergedEmployeeDepartmentName(raw, agreementCatalog?.targets || []);
      };

      const fromRows = mineHandling[0]
        ? {
            name: mineHandling[0].employee_name,
            photoUrl: resolveEmployeePhotoUrl(mineHandling[0].employee_photo_url),
            departmentName: mineHandling[0].department_name,
          }
        : mineEffort[0]
          ? {
              name: mineEffort[0].employeeName,
              photoUrl: resolveEmployeePhotoUrl(mineEffort[0].employeePhotoUrl),
              departmentName: mineEffort[0].departmentName,
            }
          : null;
      if (fromRows) {
        setProfile((current) => ({
          name: fromRows.name || current?.name || `Employee #${employeeId}`,
          photoUrl: current?.photoUrl || fromRows.photoUrl || null,
          departmentName: fromRows.departmentName || current?.departmentName || null,
          roleName: current?.roleName || null,
          isAdmin: current?.isAdmin === true,
          email: current?.email || null,
          whatsappNumber: current?.whatsappNumber || null,
          chatUserId: current?.chatUserId || null,
        }));
      }
      const next: HoursLine[] = [
        ...mineHandling.map((row) => {
          const dayMs = clockMs.get(allocationEmployeeDateKey(row.employee_id, row.work_date)) ?? 0;
          const workedMs = allocationPercentToWorkedMs(dayMs, row.percent);
          const meta = row.is_other_work
            ? null
            : row.new_lead_id
              ? newMeta.get(row.new_lead_id)
              : row.legacy_lead_id != null
                ? legacyMeta.get(row.legacy_lead_id)
                : null;
          return {
            key: `handling-${row.allocation_id}-${row.work_date}-${row.is_other_work ? 'other' : row.lead_number}-${row.percent}`,
            area: 'handling' as const,
            workDate: String(row.work_date || '').slice(0, 10),
            title: row.is_other_work ? 'Other work' : `#${row.lead_number}`,
            subtitle: row.is_other_work ? 'Not on a lead' : row.client_name,
            category: row.is_other_work ? 'Other work' : 'Lead',
            leadCategory: meta?.category || null,
            percent: row.percent,
            workedMs,
            costNis: workedMsAtHourlyRateToCostNis(workedMs, rate),
            scoreboardDepartments: meta?.department ? [meta.department] : [],
            forDepartments: [],
            clientPath: buildClientRouteFromAllocationRow(row),
            otherWork: Boolean(row.is_other_work),
          };
        }),
        ...mineEffort.map((row) => {
          const effort = effortById(row.effortId);
          const dayMs = clockMs.get(allocationEmployeeDateKey(row.employeeId, row.workDate)) ?? 0;
          const workedMs = allocationPercentToWorkedMs(dayMs, row.percent);
          const forDepartments =
            row.targetDepartmentIds.length > 0
              ? row.targetDepartmentIds.map(departmentLabel).map((name) => name.trim()).filter(Boolean)
              : ['General'];
          const targets = forDepartments.join(', ') || 'General';
          return {
            key: `${row.area}-${row.allocationId}-${row.effortId}-${row.workDate}-${targets}`,
            area: row.area,
            workDate: row.workDate,
            title: effort?.name ?? row.effortId,
            subtitle: targets,
            category: effort?.category ?? '—',
            leadCategory: null,
            percent: row.percent,
            workedMs,
            costNis: workedMsAtHourlyRateToCostNis(workedMs, rate),
            scoreboardDepartments: agreementCatalog ? effortAgreementDepartments(row.targetDepartmentIds, agreementCatalog) : [],
            forDepartments: forDepartments.length > 0 ? forDepartments : ['General'],
            clientPath: null,
            otherWork: false,
          };
        }),
      ];
      setLines(next);
    } catch (error) {
      console.error('[HoursAllocationEmployee] load failed:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to load hours');
      if (requestId === loadRequestRef.current) setLines([]);
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }, [agreementCatalog, dateRange.fromDate, dateRange.toDate, employeeId, isSuperUser]);

  useEffect(() => {
    if (!permissionsLoaded || !isSuperUser) return;
    void load();
  }, [isSuperUser, load, permissionsLoaded]);

  const forDepartmentOptions = useMemo(() => {
    const targets = agreementCatalog?.targets || [];
    const names: string[] = [];
    const push = (name: string) => {
      const trimmed = name.trim();
      if (!trimmed || trimmed === 'No department') return;
      if (names.some((item) => item.toLowerCase() === trimmed.toLowerCase())) return;
      names.push(trimmed);
    };
    for (const name of agreementDepartmentOptions(targets)) push(name);
    for (const dept of agreementCatalog?.allDepartments || []) {
      push(mergedEmployeeDepartmentName(dept.name, targets));
    }
    const generalIndex = names.findIndex((name) => name.toLowerCase() === 'general');
    if (generalIndex >= 0) {
      names.push(names.splice(generalIndex, 1)[0]);
    } else {
      names.push('General');
    }
    return names;
  }, [agreementCatalog]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return lines.filter((line) => {
      if (areaFilter && line.area !== areaFilter) return false;
      if (departmentName) {
        const matches =
          line.area === 'handling'
            ? line.scoreboardDepartments.includes(departmentName)
            : line.forDepartments.includes(departmentName);
        if (!matches) return false;
      }
      if (!q) return true;
      return (
        line.title.toLowerCase().includes(q) ||
        line.subtitle.toLowerCase().includes(q) ||
        line.category.toLowerCase().includes(q) ||
        (line.leadCategory || '').toLowerCase().includes(q)
      );
    });
  }, [areaFilter, departmentName, lines, query]);

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

  const totalMs = filtered.reduce((sum, line) => sum + line.workedMs, 0);
  const totalCost = filtered.reduce((sum, line) => sum + (line.costNis || 0), 0);
  const displayName = profile?.name || 'Employee hours';
  const avatarSrc = toEmployeeAvatarSrc(profile?.photoUrl, 96);

  if (!permissionsLoaded || !isSuperUser) {
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
          dateQuery={dateQuery}
          back={{ to: `/reports/employee-lead-allocations?${dateQuery}`, label: 'Hours allocation' }}
        />
        <div className="hours-nav-page min-w-0 flex-1 space-y-5 px-4 py-6 md:px-8 md:py-8">
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4"
          style={washedEmployeeCardStyle(employeeId, displayName)}
        >
          <div>
            <div className="flex items-center gap-3">
              <span className="relative h-20 w-20 shrink-0">
                {avatarSrc ? (
                  <img
                    src={avatarSrc}
                    alt=""
                    width={80}
                    height={80}
                    decoding="async"
                    fetchPriority="high"
                    className="h-20 w-20 rounded-full object-cover"
                  />
                ) : profile ? (
                  <span
                    className="flex h-20 w-20 items-center justify-center rounded-full text-xl font-bold text-white"
                    style={salaryAvatarGradientStyle(employeeId, displayName)}
                  >
                    {getSalaryEmployeeInitials(displayName)}
                  </span>
                ) : (
                  <span className="block h-20 w-20 rounded-full bg-white/50" />
                )}
                {clockedIn ? (
                  <span className="absolute -right-0.5 -top-0.5 h-5 w-5 rounded-full border-2 border-white bg-emerald-500" title="Clocked in" />
                ) : null}
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-bold text-gray-900">{displayName}</h1>
                  {profile?.isAdmin ? (
                    <span className="rounded-full bg-gray-900 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
                      Admin
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-sm text-gray-500">
                  {[profile?.departmentName, profile?.roleName].filter(Boolean).join(' | ') || 'All areas'}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1 text-black">
                  {(() => {
                    const whatsappDigits = (profile?.whatsappNumber || '').replace(/\D/g, '');
                    const email = profile?.email?.trim() || '';
                    const chatUserId = profile?.chatUserId || '';
                    const iconBtn = 'group inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-sm font-medium text-gray-500 transition hover:bg-white hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:shadow-none';
                    return (
                      <>
                        <button
                          type="button"
                          className={iconBtn}
                          title={whatsappDigits ? 'WhatsApp' : 'No WhatsApp number'}
                          aria-label="WhatsApp"
                          disabled={!whatsappDigits}
                          onClick={() => window.open(`https://wa.me/${whatsappDigits}`, '_blank', 'noopener,noreferrer')}
                        >
                          <FaWhatsapp className="h-6 w-6 text-black transition group-hover:text-[#25D366] group-disabled:group-hover:text-black" aria-hidden />
                          WhatsApp
                        </button>
                        <span className="text-gray-300" aria-hidden>|</span>
                        <button
                          type="button"
                          className={iconBtn}
                          title={chatUserId ? 'RMQ message' : 'No RMQ account linked'}
                          aria-label="RMQ message"
                          disabled={!chatUserId}
                          onClick={() => setRmqOpen(true)}
                        >
                          <ChatBubbleLeftRightIcon className="h-6 w-6 text-black transition group-hover:text-[#4829CC] group-disabled:group-hover:text-black" aria-hidden />
                          RMQ
                        </button>
                        <span className="text-gray-300" aria-hidden>|</span>
                        <button
                          type="button"
                          className={iconBtn}
                          title={email ? `Email ${email}` : 'No email'}
                          aria-label="Email"
                          disabled={!email}
                          onClick={() => window.open(`mailto:${email}`, '_blank')}
                        >
                          <EnvelopeIcon className="h-6 w-6 text-black transition group-hover:text-[#0078D4] group-disabled:group-hover:text-black" aria-hidden />
                          Email
                        </button>
                      </>
                    );
                  })()}
                </div>
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
          </div>
        </div>

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
                      <input type="date" aria-label="From" className="input h-10 min-h-10 rounded-[14px] border-0 bg-white px-3 ring-1 ring-gray-200" value={rangeFrom} onChange={(event) => setRangeFrom(event.target.value)} />
                    </label>
                    <label className="block">
                      <input type="date" aria-label="To" className="input h-10 min-h-10 rounded-[14px] border-0 bg-white px-3 ring-1 ring-gray-200" value={rangeTo} max={getJerusalemTodayIsoDate()} onChange={(event) => setRangeTo(event.target.value)} />
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
              <button type="button" className={dateButtonClass(dateMode === 'period')} onClick={() => setDateMode('period')}>Period</button>
              <button type="button" className={dateButtonClass(dateMode === 'all')} onClick={() => setDateMode('all')}>Show all</button>
              {dateMode !== 'day' ? (
                <button type="button" className={dateButtonClass(false)} onClick={() => setDateMode('day')}>Day</button>
              ) : null}
            </div>
            ) : null}
          </div>
          <label className="block min-w-[10rem] flex-1">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-500">Area</span>
            <select className="select select-bordered select-sm h-10 min-h-10 w-full bg-white" value={areaFilter} onChange={(event) => setAreaFilter(event.target.value as WorkAreaId | '')}>
              <option value="">All areas</option>
              {AREA_ORDER.map((id) => (
                <option key={id} value={id}>{WORK_AREAS.find((area) => area.id === id)?.label || id}</option>
              ))}
            </select>
          </label>
          <label className="block min-w-[10rem] flex-1">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-500">Department</span>
            <select className="select select-bordered select-sm h-10 min-h-10 w-full bg-white" value={departmentName} onChange={(event) => setDepartmentName(event.target.value)}>
              <option value="">All departments</option>
              {(areaFilter === 'handling'
                ? agreementDepartmentOptions(agreementCatalog?.targets || [])
                : forDepartmentOptions
              ).map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </label>
          <label className="block min-w-[12rem] flex-1">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-500">Search</span>
            <div className="flex h-10 min-h-10 items-center gap-2 rounded-[14px] bg-white px-3 ring-1 ring-gray-200 focus-within:ring-2 focus-within:ring-primary/15">
              <MagnifyingGlassIcon className="h-4 w-4 shrink-0 text-black" aria-hidden />
              <input
                type="search"
                className="h-full min-w-0 grow bg-transparent text-sm outline-none placeholder:text-gray-400"
                placeholder="Lead, client, effort…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          </label>
        </div>

        {loading ? (
          <ReportLoadingScreen title="Loading hours" subtitle="Gathering reported time…" icon={ClockIcon} />
        ) : filtered.length === 0 ? (
          <p className="rounded-2xl bg-white px-5 py-10 text-center text-sm text-gray-500 shadow-sm ring-1 ring-gray-100">
            No hours match these filters.
          </p>
        ) : (
          AREA_ORDER.map((area) => {
            const areaLines = filtered.filter((line) => line.area === area);
            if (areaLines.length === 0) return null;
            const label = WORK_AREAS.find((item) => item.id === area)?.label || area;
            const leads = areaLines.filter((line) => !line.otherWork);
            const other = areaLines.filter((line) => line.otherWork);
            const areaMs = areaLines.reduce((sum, line) => sum + line.workedMs, 0);
            const areaCost = areaLines.reduce((sum, line) => sum + (line.costNis || 0), 0);
            return (
              <section key={area} className="space-y-3">
                <div className="flex items-baseline justify-between gap-3 px-1">
                  <h2 className="text-lg font-semibold text-gray-900">{label}</h2>
                  <p className="text-sm tabular-nums text-gray-500">
                    {formatAllocationWorkedDuration(areaMs)}
                    <span className="mx-2 text-gray-300">|</span>
                    {formatAllocationCostNis(areaCost)}
                  </p>
                </div>
                {leads.length > 0 ? (
                  <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-100">
                    {other.length > 0 ? (
                      <div className="border-b border-gray-100 px-5 py-3">
                        <h3 className="text-sm font-semibold text-gray-900">Leads</h3>
                      </div>
                    ) : null}
                    <LinesTable lines={leads} area={area} />
                  </div>
                ) : null}
                {other.length > 0 ? (
                  <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-100">
                    <div className="border-b border-gray-100 px-5 py-3">
                      <h3 className="text-sm font-semibold text-gray-900">Other work</h3>
                    </div>
                    <LinesTable lines={other} area={area} />
                  </div>
                ) : null}
              </section>
            );
          })
        )}
        </div>
      </div>
      <RMQMessagesPage
        isOpen={rmqOpen}
        initialUserId={profile?.chatUserId || undefined}
        onClose={() => setRmqOpen(false)}
      />
    </div>
  );
}

export default HoursAllocationEmployeePage;
