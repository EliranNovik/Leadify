import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDownIcon, FunnelIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { supabase } from '../../lib/supabase';
import { dateRangeToIsoBounds } from '../../lib/employeeClockInFormat';
import {
  allocationPercentToWorkedMs,
  buildAllocationDayWorkedMs,
  buildClientRouteFromAllocationRow,
  fetchLeadCategoriesByIdentity,
  formatAllocationWorkedDuration,
  getJerusalemTodayIsoDate,
  LEAD_ALLOCATION_REPORTING_START_DATE,
} from '../../lib/employeeLeadReporting';
import { fetchLeadBudgetSnapshots, type LeadBudgetSnapshot } from '../../lib/leadsManagementReport';
import {
  buildCategoryNameToDataMap,
  canonicalizeScoreboardDepartment,
  fetchCategoriesWithDepartments,
  resolveCategoryAndDepartment,
} from '../../lib/resolveCategoryDepartment';
import { fetchAgreementScoreboardDepartments } from '../../lib/scoreboardDepartments';
import { combinedGermanAustrian, displayAgreementDepartment } from '../../lib/employeeDepartmentTotals';
import { effortById, type WorkAreaId } from '../../lib/workAreaEfforts';
import {
  compareNullableNumbers,
  ReportSortableTh,
  toggleReportSort,
  type ReportSortDir,
} from '../reports/ReportSortableTh';

type AreaFilter = '' | WorkAreaId;

type LeadRef = {
  leadType: 'new' | 'legacy' | null;
  newLeadId: string | null;
  legacyLeadId: number | null;
  leadNumber: string;
};

type AllocLine = {
  key: string;
  workDate: string;
  area: WorkAreaId;
  title: string;
  subtitle: string;
  percent: number;
  workedMs: number;
  clientPath: string | null;
  isLead: boolean;
  isOtherWork: boolean;
  leadKey: string | null;
  departments: string[];
  category: string | null;
  effortCategory: string | null;
  subEffortIds: number[];
  leadRef: LeadRef | null;
};

type BudgetFilter = '' | 'near' | 'mid' | 'under50' | 'over';

type AgreementCatalog = {
  targets: { id: number; name: string }[];
  categories: any[];
  nameMap: Map<string, any>;
};

const AREAS: { id: WorkAreaId; label: string; color: string }[] = [
  { id: 'handling', label: 'Handling', color: '#7c3aed' },
  { id: 'marketing', label: 'Marketing', color: '#0284c7' },
  { id: 'sales', label: 'Sales', color: '#059669' },
  { id: 'finances', label: 'Finances', color: '#d97706' },
  { id: 'development', label: 'Development', color: '#4f46e5' },
];

const AREA_BY_ID = new Map(AREAS.map((area) => [area.id, area]));

type DateMode = 'period' | 'all' | 'today';

function shiftIsoDate(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(y, (m || 1) - 1, (d || 1) + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function defaultRange(): { from: string; to: string } {
  const to = getJerusalemTodayIsoDate();
  return { from: shiftIsoDate(to, -29), to };
}

function dateButtonClass(active: boolean): string {
  return active
    ? 'inline-flex h-10 items-center rounded-[14px] bg-primary px-3.5 text-sm font-semibold text-white shadow-sm'
    : 'inline-flex h-10 items-center rounded-[14px] bg-white px-3.5 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-gray-200 transition-colors hover:bg-gray-50';
}

function formatDay(workDate: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date(`${workDate.slice(0, 10)}T12:00:00`));
}

function parseIds(value: unknown, single: unknown): number[] {
  if (Array.isArray(value)) {
    const ids = [...new Set(value.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
    if (ids.length > 0) return ids;
  }
  const one = Number(single);
  return Number.isFinite(one) && one > 0 ? [one] : [];
}

function leadStorageKey(ref: LeadRef): string | null {
  if (ref.leadType === 'legacy' && ref.legacyLeadId != null) return `legacy:${ref.legacyLeadId}`;
  if (ref.newLeadId) return `new:${ref.newLeadId}`;
  const number = ref.leadNumber.trim();
  return number && number !== '—' ? `number:${number}` : null;
}

function categoryLabel(category: { main: string | null; sub: string | null } | undefined): string | null {
  if (!category) return null;
  if (category.main && category.sub) return `${category.main} / ${category.sub}`;
  return category.sub || category.main || null;
}

function agreementDepartmentName(
  category: { main: string | null; sub: string | null } | undefined,
  catalog: AgreementCatalog | null,
): string | null {
  if (!catalog || !category || (!category.main && !category.sub)) return null;
  const combined = combinedGermanAustrian(catalog.targets);
  const lookup =
    category.main && category.sub ? `${category.main} > ${category.sub}` : category.sub || category.main || '';
  if (!lookup) return null;
  const resolved = canonicalizeScoreboardDepartment(
    resolveCategoryAndDepartment(lookup, null, null, catalog.categories, catalog.nameMap),
    catalog.targets,
  );
  const name = displayAgreementDepartment(resolved.departmentName, catalog.targets);
  if (!name || resolved.departmentName === 'Other') return combined;
  return name;
}

const BUDGET_STYLES: Record<
  Exclude<BudgetFilter, ''>,
  { label: string; text: string; bar: string; active: string }
> = {
  near: { label: '80–100%', text: 'text-orange-600', bar: '#ea580c', active: 'bg-orange-50 ring-orange-200' },
  mid: { label: '50–80%', text: 'text-amber-600', bar: '#d97706', active: 'bg-amber-50 ring-amber-200' },
  under50: { label: 'Under 50%', text: 'text-emerald-600', bar: '#059669', active: 'bg-emerald-50 ring-emerald-200' },
  over: { label: 'Over budget', text: 'text-rose-700', bar: '#e11d48', active: 'bg-rose-50 ring-rose-200' },
};

function budgetBand(snapshot: LeadBudgetSnapshot | undefined): Exclude<BudgetFilter, ''> | null {
  if (!snapshot) return null;
  if (snapshot.exceedsCap) return 'over';
  if (!snapshot.hasCap) return null;
  if (snapshot.utilizationPercent < 50) return 'under50';
  if (snapshot.utilizationPercent < 80) return 'mid';
  return 'near';
}

function budgetNote(snapshot: LeadBudgetSnapshot | undefined): { label: string; band: Exclude<BudgetFilter, ''> } | null {
  const band = budgetBand(snapshot);
  if (!band || !snapshot) return null;
  if (band === 'over') return { label: 'Over budget', band };
  return { label: `${Math.round(snapshot.utilizationPercent)}% of budget`, band };
}

function matchesBudget(snapshot: LeadBudgetSnapshot | undefined, filter: BudgetFilter): boolean {
  if (!filter) return true;
  if (!snapshot) return false;
  if (filter === 'over') return snapshot.exceedsCap;
  if (!snapshot.hasCap || snapshot.exceedsCap) return false;
  if (filter === 'under50') return snapshot.utilizationPercent < 50;
  if (filter === 'mid') return snapshot.utilizationPercent >= 50 && snapshot.utilizationPercent < 80;
  return snapshot.utilizationPercent >= 80;
}

function sortAllocLines(lines: AllocLine[], key: string | null, dir: ReportSortDir): AllocLine[] {
  if (key !== 'share' && key !== 'time') return lines;
  return lines.slice().sort((a, b) => {
    const cmp = compareNullableNumbers(
      key === 'share' ? a.percent : a.workedMs,
      key === 'share' ? b.percent : b.workedMs,
      dir,
    );
    return cmp || b.workDate.localeCompare(a.workDate);
  });
}

function ShareBar({ percent, color }: { percent: number; color: string }) {
  const width = Math.max(0, Math.min(100, percent));
  return (
    <div className="flex min-w-[8.5rem] items-center gap-2">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
        <div className="h-full rounded-full" style={{ width: `${width}%`, backgroundColor: color }} />
      </div>
      <span className="w-10 text-right text-sm font-medium tabular-nums text-gray-500">
        {Math.round(percent)}%
      </span>
    </div>
  );
}

async function loadOwnAllocations(employeeId: number, from: string | null, to: string | null) {
  const run = (withExtras: boolean) => {
    let query = supabase
      .from('employee_daily_lead_allocations')
      .select(
        `
        id,
        work_date,
        other_work_percent,
        employee_daily_lead_allocation_items (
          lead_type,
          new_lead_id,
          legacy_lead_id,
          lead_number,
          client_name,
          percent${withExtras ? ',\n          sub_effort_ids' : ''}
        ),
        employee_daily_effort_allocation_items (
          area,
          effort_id,
          percent,
          department_id${withExtras ? ',\n          department_ids' : ''}
        )
      `,
      )
      .eq('employee_id', employeeId)
      .order('work_date', { ascending: false });
    if (from) query = query.gte('work_date', from);
    if (to) query = query.lte('work_date', to);
    return query;
  };

  let result = await run(true);
  if (result.error && /sub_effort_ids|department_ids/i.test(result.error.message || '')) {
    result = await run(false);
  }
  if (result.error) throw result.error;
  return result.data || [];
}

async function loadOwnClockMs(employeeId: number, from: string, to: string): Promise<Map<string, number>> {
  const { start, end } = dateRangeToIsoBounds(from, to);
  const records: Array<{
    employee_id: number;
    clock_in_time: string;
    clock_out_time: string | null;
    notes: string | null;
    manually: boolean | null;
    approved: boolean | null;
    declined: boolean | null;
  }> = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from('employee_clock_in')
      .select('employee_id, clock_in_time, clock_out_time, notes, manually, approved, declined')
      .eq('employee_id', employeeId)
      .gte('clock_in_time', start)
      .lte('clock_in_time', end)
      .order('clock_in_time', { ascending: true })
      .range(offset, offset + 999);
    if (error) throw error;
    records.push(...((data || []) as typeof records));
    if (!data || data.length < 1000) break;
  }

  const byDate = new Map<string, typeof records>();
  for (const record of records) {
    const date = getJerusalemTodayIsoDate(new Date(record.clock_in_time));
    const list = byDate.get(date) || [];
    list.push(record);
    byDate.set(date, list);
  }
  const totals = new Map<string, number>();
  for (const [date, rows] of byDate) {
    totals.set(
      date,
      buildAllocationDayWorkedMs(
        rows.map((row) => ({
          ...row,
          manually: row.manually === true,
          approved: row.approved === true,
          declined: row.declined === true,
        })),
        employeeId,
      ),
    );
  }
  return totals;
}

const AllocatedHoursTab: React.FC<{ employeeId: number }> = ({ employeeId }) => {
  const [dateMode, setDateMode] = useState<DateMode>('period');
  const [dateToolsOpen, setDateToolsOpen] = useState(false);
  const [rangeFrom, setRangeFrom] = useState(() => defaultRange().from);
  const [rangeTo, setRangeTo] = useState(() => defaultRange().to);
  const [area, setArea] = useState<AreaFilter>('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<AllocLine[]>([]);
  const [leadsExpanded, setLeadsExpanded] = useState(false);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<ReportSortDir>('desc');
  const [otherSortKey, setOtherSortKey] = useState<string | null>(null);
  const [otherSortDir, setOtherSortDir] = useState<ReportSortDir>('desc');
  const [department, setDepartment] = useState('');
  const [category, setCategory] = useState('');
  const [budgetFilter, setBudgetFilter] = useState<BudgetFilter>('');
  const [budgetByLead, setBudgetByLead] = useState<Map<string, LeadBudgetSnapshot>>(new Map());
  const [budgetLoading, setBudgetLoading] = useState(false);
  const [subEffortNames, setSubEffortNames] = useState<Map<number, string>>(() => new Map());

  useEffect(() => {
    let cancelled = false;
    const from = dateMode === 'all' ? LEAD_ALLOCATION_REPORTING_START_DATE : rangeFrom;
    const to = dateMode === 'all' ? getJerusalemTodayIsoDate() : rangeTo || getJerusalemTodayIsoDate();

    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const [allocations, clockMs, departments, targets, categories] = await Promise.all([
          loadOwnAllocations(employeeId, dateMode === 'all' ? null : from, dateMode === 'all' ? null : to),
          loadOwnClockMs(employeeId, from, to),
          supabase.from('tenant_departement').select('id, name'),
          fetchAgreementScoreboardDepartments(),
          fetchCategoriesWithDepartments(supabase),
        ]);
        if (cancelled) return;
        const departmentName = new Map<number, string>();
        for (const row of departments.data || []) {
          if (row.id != null) departmentName.set(Number(row.id), String(row.name || '').trim());
        }
        const catalog: AgreementCatalog = {
          targets,
          categories,
          nameMap: buildCategoryNameToDataMap(categories),
        };
        const identities: Array<{ lead_type: 'new' | 'legacy'; new_lead_id?: string | null; legacy_lead_id?: number | null }> = [];
        const seenIdentity = new Set<string>();
        for (const alloc of allocations) {
          const items = Array.isArray(alloc.employee_daily_lead_allocation_items)
            ? alloc.employee_daily_lead_allocation_items
            : [];
          for (const item of items as any[]) {
            const legacyId = item.legacy_lead_id != null ? Number(item.legacy_lead_id) : null;
            const newId = item.new_lead_id ? String(item.new_lead_id) : null;
            const leadType: 'new' | 'legacy' | null =
              item.lead_type === 'legacy' || (legacyId != null && item.lead_type !== 'new')
                ? 'legacy'
                : newId
                  ? 'new'
                  : null;
            if (!leadType) continue;
            const identityKey = leadType === 'legacy' ? `legacy:${legacyId}` : `new:${newId}`;
            if (seenIdentity.has(identityKey)) continue;
            seenIdentity.add(identityKey);
            identities.push(
              leadType === 'legacy'
                ? { lead_type: 'legacy', legacy_lead_id: legacyId }
                : { lead_type: 'new', new_lead_id: newId },
            );
          }
        }
        const categoryByKey = await fetchLeadCategoriesByIdentity(identities);
        if (cancelled) return;

        const next: AllocLine[] = [];
        for (const alloc of allocations) {
          const workDate = String(alloc.work_date || '').slice(0, 10);
          const dayMs = clockMs.get(workDate) || 0;
          const other = Number(alloc.other_work_percent || 0);
          if (other > 0) {
            next.push({
              key: `${alloc.id}-other`,
              workDate,
              area: 'handling',
              title: 'Other work',
              subtitle: 'Not on a lead',
              percent: other,
              workedMs: allocationPercentToWorkedMs(dayMs, other),
              clientPath: null,
              isLead: false,
              isOtherWork: true,
              leadKey: null,
              departments: [],
              category: null,
              effortCategory: null,
              subEffortIds: [],
              leadRef: null,
            });
          }
          const items = Array.isArray(alloc.employee_daily_lead_allocation_items)
            ? alloc.employee_daily_lead_allocation_items
            : [];
          items.forEach((item: any, index: number) => {
            const percent = Number(item.percent || 0);
            if (percent <= 0) return;
            const leadNumber = String(item.lead_number || '').trim();
            const legacyId = item.legacy_lead_id != null ? Number(item.legacy_lead_id) : null;
            const newId = item.new_lead_id ? String(item.new_lead_id) : null;
            const leadType: LeadRef['leadType'] =
              item.lead_type === 'legacy' || (legacyId != null && item.lead_type !== 'new')
                ? 'legacy'
                : newId
                  ? 'new'
                  : null;
            const leadRef: LeadRef = {
              leadType,
              newLeadId: newId,
              legacyLeadId: legacyId,
              leadNumber,
            };
            const leadKey = leadStorageKey(leadRef);
            const category = leadKey ? categoryByKey.get(leadKey) : undefined;
            const department = agreementDepartmentName(category, catalog);
            next.push({
              key: `${alloc.id}-lead-${index}`,
              workDate,
              area: 'handling',
              title: leadNumber ? `#${leadNumber}` : 'Lead',
              subtitle: String(item.client_name || '').trim() || 'Client',
              percent,
              workedMs: allocationPercentToWorkedMs(dayMs, percent),
              clientPath: buildClientRouteFromAllocationRow({
                lead_type: item.lead_type,
                lead_number: leadNumber,
                legacy_lead_id: item.legacy_lead_id ?? null,
              }),
              isLead: true,
              isOtherWork: false,
              leadKey,
              departments: department ? [department] : [],
              category: categoryLabel(category),
              effortCategory: null,
              subEffortIds: parseIds(item.sub_effort_ids, null),
              leadRef,
            });
          });
          const efforts = Array.isArray(alloc.employee_daily_effort_allocation_items)
            ? alloc.employee_daily_effort_allocation_items
            : [];
          efforts.forEach((item: any, index: number) => {
            const percent = Number(item.percent || 0);
            if (percent <= 0) return;
            const areaId = String(item.area || '') as WorkAreaId;
            if (!AREA_BY_ID.has(areaId) || areaId === 'handling') return;
            const effort = effortById(String(item.effort_id || ''));
            const forNames = parseIds(item.department_ids, item.department_id)
              .map((id) => departmentName.get(id))
              .filter((name): name is string => Boolean(name))
              .map((name) => displayAgreementDepartment(name, catalog.targets) || name);
            const departments = forNames.length > 0 ? [...new Set(forNames)] : ['General'];
            next.push({
              key: `${alloc.id}-effort-${index}`,
              workDate,
              area: areaId,
              title: effort?.name || 'Effort',
              subtitle: '',
              percent,
              workedMs: allocationPercentToWorkedMs(dayMs, percent),
              clientPath: null,
              isLead: false,
              isOtherWork: false,
              leadKey: null,
              departments,
              category: null,
              effortCategory: effort?.category || null,
              subEffortIds: [],
              leadRef: null,
            });
          });
        }
        next.sort((a, b) => b.workDate.localeCompare(a.workDate) || b.percent - a.percent);
        setLines(next);
      } catch (loadError) {
        if (!cancelled) {
          setLines([]);
          setError(loadError instanceof Error ? loadError.message : 'Could not load allocated hours');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [employeeId, dateMode, rangeFrom, rangeTo]);

  const leadRefs = useMemo(() => {
    const byKey = new Map<string, LeadRef>();
    for (const line of lines) {
      if (line.leadKey && line.leadRef && !byKey.has(line.leadKey)) byKey.set(line.leadKey, line.leadRef);
    }
    return [...byKey.entries()];
  }, [lines]);

  useEffect(() => {
    const refs = leadRefs.map(([, ref]) => ({
      leadType: ref.leadType,
      newLeadId: ref.newLeadId,
      legacyLeadId: ref.legacyLeadId,
      leadNumber: ref.leadNumber,
    }));
    if (refs.length === 0) {
      setBudgetByLead(new Map());
      setBudgetLoading(false);
      return;
    }
    let cancelled = false;
    setBudgetLoading(true);
    fetchLeadBudgetSnapshots(refs)
      .then((snapshots) => {
        if (!cancelled) setBudgetByLead(snapshots);
      })
      .catch(() => {
        if (!cancelled) setBudgetByLead(new Map());
      })
      .finally(() => {
        if (!cancelled) setBudgetLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [leadRefs]);

  const departmentOptions = useMemo(() => {
    const names = new Set<string>();
    for (const line of lines) {
      for (const name of line.departments) {
        if (name) names.add(name);
      }
    }
    return [...names].sort((a, b) => {
      if (a === 'General') return 1;
      if (b === 'General') return -1;
      return a.localeCompare(b);
    });
  }, [lines]);

  const categoryOptions = useMemo(() => {
    const names = new Set<string>();
    for (const line of lines) {
      if (line.category) names.add(line.category);
      if (line.effortCategory) names.add(line.effortCategory);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [lines]);

  const scoped = useMemo(() => {
    const q = query.trim().toLowerCase();
    return lines.filter((line) => {
      if (area && line.area !== area) return false;
      if (department && !line.departments.includes(department)) return false;
      if (category && line.category !== category && line.effortCategory !== category) return false;
      if (!q) return true;
      const areaLabel = AREA_BY_ID.get(line.area)?.label || '';
      return (
        line.title.toLowerCase().includes(q) ||
        line.subtitle.toLowerCase().includes(q) ||
        line.category?.toLowerCase().includes(q) ||
        line.effortCategory?.toLowerCase().includes(q) ||
        line.subEffortIds.some((id) => (subEffortNames.get(id) || '').toLowerCase().includes(q)) ||
        line.departments.some((name) => name.toLowerCase().includes(q)) ||
        areaLabel.toLowerCase().includes(q)
      );
    });
  }, [lines, area, query, department, category, subEffortNames]);

  const budgetCounts = useMemo(() => {
    const counts: Record<Exclude<BudgetFilter, ''>, number> = { near: 0, mid: 0, under50: 0, over: 0 };
    const seen = new Set<string>();
    for (const line of scoped) {
      if (!line.leadKey || seen.has(line.leadKey)) continue;
      seen.add(line.leadKey);
      const snapshot = budgetByLead.get(line.leadKey);
      if (matchesBudget(snapshot, 'near')) counts.near += 1;
      if (matchesBudget(snapshot, 'mid')) counts.mid += 1;
      if (matchesBudget(snapshot, 'under50')) counts.under50 += 1;
      if (matchesBudget(snapshot, 'over')) counts.over += 1;
    }
    return counts;
  }, [scoped, budgetByLead]);

  const filtered = useMemo(
    () =>
      scoped.filter((line) => {
        if (!budgetFilter) return true;
        if (!line.isLead || !line.leadKey) return false;
        return matchesBudget(budgetByLead.get(line.leadKey), budgetFilter);
      }),
    [scoped, budgetByLead, budgetFilter],
  );
  const activityLines = filtered.filter((line) => !line.isOtherWork);
  const otherLines = filtered.filter((line) => line.isOtherWork);
  const sortedActivityLines = useMemo(
    () => sortAllocLines(activityLines, sortKey, sortDir),
    [activityLines, sortKey, sortDir],
  );
  const sortedOtherLines = useMemo(
    () => sortAllocLines(otherLines, otherSortKey, otherSortDir),
    [otherLines, otherSortKey, otherSortDir],
  );

  const subEffortIdKey = useMemo(
    () => [...new Set(lines.flatMap((line) => line.subEffortIds))].sort((a, b) => a - b).join(','),
    [lines],
  );

  useEffect(() => {
    const ids = subEffortIdKey ? subEffortIdKey.split(',').map(Number).filter((id) => id > 0) : [];
    if (ids.length === 0) {
      setSubEffortNames(new Map());
      return;
    }
    let cancelled = false;
    const load = async () => {
      const names = new Map<number, string>();
      for (let index = 0; index < ids.length; index += 80) {
        const chunk = ids.slice(index, index + 80);
        const { data, error: namesError } = await supabase.from('sub_efforts').select('id, name').in('id', chunk);
        if (namesError) throw namesError;
        for (const row of data || []) {
          names.set(Number(row.id), String(row.name || '').trim() || `Sub effort #${row.id}`);
        }
      }
      if (!cancelled) setSubEffortNames(names);
    };
    void load().catch(() => {
      if (!cancelled) setSubEffortNames(new Map());
    });
    return () => {
      cancelled = true;
    };
  }, [subEffortIdKey]);

  const totalMs = filtered.reduce((sum, line) => sum + line.workedMs, 0);
  const areaTotals = AREAS.map((item) => ({
    ...item,
    workedMs: filtered.filter((line) => line.area === item.id).reduce((sum, line) => sum + line.workedMs, 0),
  })).filter((item) => item.workedMs > 0);

  const leadTotals = useMemo(() => {
    const byLead = new Map<string, { title: string; subtitle: string; workedMs: number; path: string | null; leadKey: string | null }>();
    for (const line of filtered) {
      if (!line.isLead) continue;
      const key = line.leadKey || `${line.title}|${line.subtitle}`;
      const current = byLead.get(key) || {
        title: line.title,
        subtitle: line.subtitle,
        workedMs: 0,
        path: line.clientPath,
        leadKey: line.leadKey,
      };
      current.workedMs += line.workedMs;
      byLead.set(key, current);
    }
    return [...byLead.values()].sort((a, b) => b.workedMs - a.workedMs);
  }, [filtered]);
  const visibleLeads = leadsExpanded ? leadTotals : leadTotals.slice(0, 10);
  const hiddenLeadCount = Math.max(0, leadTotals.length - 10);

  useEffect(() => {
    setLeadsExpanded(false);
  }, [area, query, dateMode, rangeFrom, rangeTo, department, category, budgetFilter]);
  const leadTotalMs = filtered.filter((line) => line.isLead).reduce((sum, line) => sum + line.workedMs, 0);
  const dayCount = new Set(filtered.map((line) => line.workDate)).size;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Allocated hours</h2>
        <p className="mt-1 text-sm text-gray-500">Your reported time across handling, marketing, sales, finances, and development.</p>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <span className="block text-xs font-semibold uppercase tracking-wider text-gray-500">Date</span>
          <div className="flex items-end gap-2">
            {dateMode === 'today' ? (
              <input
                type="date"
                aria-label="Today"
                className="report-date-input input h-10 min-h-10 rounded-[14px] border-0 bg-white px-3 ring-1 ring-gray-200"
                value={rangeFrom}
                max={getJerusalemTodayIsoDate()}
                onChange={(event) => {
                  setRangeFrom(event.target.value);
                  setRangeTo(event.target.value);
                }}
              />
            ) : dateMode === 'period' ? (
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  aria-label="From"
                  className="report-date-input input h-10 min-h-10 rounded-[14px] border-0 bg-white px-3 ring-1 ring-gray-200"
                  value={rangeFrom}
                  onChange={(event) => setRangeFrom(event.target.value)}
                />
                <input
                  type="date"
                  aria-label="To"
                  className="report-date-input input h-10 min-h-10 rounded-[14px] border-0 bg-white px-3 ring-1 ring-gray-200"
                  value={rangeTo}
                  onChange={(event) => setRangeTo(event.target.value)}
                />
              </div>
            ) : (
              <div className="flex h-10 min-w-[11rem] items-center rounded-[14px] bg-white px-3 text-sm text-gray-600 ring-1 ring-gray-200">
                All reporting
              </div>
            )}
            <button
              type="button"
              aria-expanded={dateToolsOpen}
              aria-label={dateToolsOpen ? 'Hide date filters' : 'Show date filters'}
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full shadow-sm ring-1 ring-gray-200 ${
                dateToolsOpen ? 'bg-primary text-white' : 'bg-white text-gray-700 hover:bg-gray-50'
              }`}
              onClick={() => setDateToolsOpen((open) => !open)}
            >
              <FunnelIcon className="h-5 w-5" aria-hidden />
            </button>
          </div>
          {dateToolsOpen ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={dateButtonClass(dateMode === 'period')}
                onClick={() => {
                  const range = defaultRange();
                  setDateMode('period');
                  setRangeFrom(range.from);
                  setRangeTo(range.to);
                }}
              >
                Period
              </button>
              <button
                type="button"
                className={dateButtonClass(dateMode === 'all')}
                onClick={() => {
                  setDateMode('all');
                  setRangeFrom('');
                  setRangeTo('');
                }}
              >
                Show all
              </button>
              <button
                type="button"
                className={dateButtonClass(dateMode === 'today')}
                onClick={() => {
                  const today = getJerusalemTodayIsoDate();
                  setDateMode('today');
                  setRangeFrom(today);
                  setRangeTo(today);
                }}
              >
                Today
              </button>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={dateButtonClass(area === '')}
            onClick={() => setArea('')}
          >
            All areas
          </button>
          {AREAS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={dateButtonClass(area === item.id)}
              onClick={() => setArea(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <label className="block min-w-[12rem] flex-1">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-500">Search</span>
            <span className="flex h-10 min-h-10 items-center gap-2 rounded-[14px] bg-white px-3 ring-1 ring-gray-200">
              <MagnifyingGlassIcon className="h-4 w-4 shrink-0 text-black" aria-hidden />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Lead, client, or effort…"
                className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-gray-400"
              />
            </span>
          </label>
          <label className="block min-w-[12rem] flex-1">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-500">Department</span>
            <span className="relative block">
              <select
                className="report-select select h-10 min-h-10 w-full appearance-none rounded-[14px] border-0 bg-white pr-9 ring-1 ring-gray-200"
                value={department}
                onChange={(event) => setDepartment(event.target.value)}
              >
                <option value="">All departments</option>
                {departmentOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              <ChevronDownIcon className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" aria-hidden />
            </span>
          </label>
          <label className="block min-w-[12rem] flex-1">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-500">Category</span>
            <span className="relative block">
              <select
                className="report-select select h-10 min-h-10 w-full appearance-none rounded-[14px] border-0 bg-white pr-9 ring-1 ring-gray-200"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              >
                <option value="">All categories</option>
                {categoryOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              <ChevronDownIcon className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" aria-hidden />
            </span>
          </label>
          {department || category || budgetFilter ? (
            <button
              type="button"
              className="mb-2 text-sm font-medium text-gray-500 hover:text-gray-800"
              onClick={() => {
                setDepartment('');
                setCategory('');
                setBudgetFilter('');
              }}
            >
              Clear
            </button>
          ) : null}
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">Lead budget</p>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {(Object.keys(BUDGET_STYLES) as Array<Exclude<BudgetFilter, ''>>).map((id) => {
            const style = BUDGET_STYLES[id];
            const active = budgetFilter === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setBudgetFilter((current) => (current === id ? '' : id))}
                className={`rounded-2xl px-4 py-4 text-left shadow-sm ring-1 transition-colors ${
                  active ? style.active : 'bg-white ring-gray-100 hover:ring-gray-200'
                }`}
              >
                <p className={`text-base font-semibold uppercase tracking-wider ${style.text}`}>{style.label}</p>
                <p className={`mt-1 text-3xl font-bold tabular-nums ${style.text}`}>
                  {budgetLoading ? '…' : budgetCounts[id]}
                </p>
                <p className="text-base text-gray-400">leads</p>
              </button>
            );
          })}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <span className="loading loading-spinner loading-md text-primary" />
        </div>
      ) : error ? (
        <p className="rounded-2xl bg-white px-5 py-8 text-sm text-rose-700 shadow-sm">{error}</p>
      ) : filtered.length === 0 ? (
        <p className="rounded-2xl bg-white px-5 py-12 text-center text-sm text-gray-500 shadow-sm">
          No allocated time matches these filters.
        </p>
      ) : (
        <>
          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-100">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Time in view</p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-gray-900">
                  {formatAllocationWorkedDuration(totalMs)}
                </p>
              </div>
              <p className="text-sm text-gray-500">
                {dayCount} {dayCount === 1 ? 'day' : 'days'} · {filtered.length} {filtered.length === 1 ? 'line' : 'lines'}
              </p>
            </div>
            {totalMs > 0 ? (
              <>
                <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-gray-100">
                  {areaTotals.map((item) => (
                    <div
                      key={item.id}
                      title={`${item.label} · ${formatAllocationWorkedDuration(item.workedMs)}`}
                      style={{ width: `${(item.workedMs / totalMs) * 100}%`, backgroundColor: item.color }}
                    />
                  ))}
                </div>
                <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
                  {areaTotals.map((item) => (
                    <li key={item.id} className="flex items-center gap-2 text-sm text-gray-700">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                      <span className="font-medium">{item.label}</span>
                      <span className="tabular-nums text-gray-500">
                        {formatAllocationWorkedDuration(item.workedMs)} · {Math.round((item.workedMs / totalMs) * 100)}%
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>

          {leadTotals.length > 0 && leadTotalMs > 0 ? (
            <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-100">
              <h3 className="text-sm font-semibold text-gray-900">Time on leads</h3>
              <p className="mt-0.5 text-xs text-gray-500">Share of your lead time in this view</p>
              <ul className="mt-3 grid grid-cols-1 gap-x-8 gap-y-3 lg:grid-cols-2">
                {visibleLeads.map((lead) => {
                  const share = (lead.workedMs / leadTotalMs) * 100;
                  const snapshot = lead.leadKey ? budgetByLead.get(lead.leadKey) : undefined;
                  const note = budgetNote(snapshot);
                  const tone = note ? BUDGET_STYLES[note.band].text : 'text-gray-900';
                  const bar = note ? BUDGET_STYLES[note.band].bar : '#9ca3af';
                  const body = (
                    <>
                      <div className="flex items-baseline justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-gray-900">{lead.title}</p>
                          <p className="truncate text-xs text-gray-500">{lead.subtitle}</p>
                          {note?.band === 'over' ? (
                            <p className={`truncate text-xs font-medium ${tone}`}>Over budget</p>
                          ) : null}
                        </div>
                        <p className={`shrink-0 text-sm font-semibold tabular-nums ${tone}`}>
                          {formatAllocationWorkedDuration(lead.workedMs)}
                        </p>
                      </div>
                      <div className="mt-1.5">
                        <ShareBar percent={share} color={bar} />
                      </div>
                    </>
                  );
                  return (
                    <li key={`${lead.title}-${lead.subtitle}`}>
                      {lead.path ? (
                        <Link to={lead.path} className="block rounded-xl px-2 py-1.5 hover:bg-gray-50">
                          {body}
                        </Link>
                      ) : (
                        <div className="px-2 py-1.5">{body}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
              {hiddenLeadCount > 0 ? (
                <button
                  type="button"
                  onClick={() => setLeadsExpanded((open) => !open)}
                  className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
                >
                  {leadsExpanded ? 'Show less' : `Show ${hiddenLeadCount} more`}
                  <ChevronDownIcon className={`h-4 w-4 transition-transform ${leadsExpanded ? 'rotate-180' : ''}`} />
                </button>
              ) : null}
            </section>
          ) : null}

          {activityLines.length > 0 ? (
          <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-100">
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr className="border-b border-gray-100 text-xs uppercase tracking-wider text-gray-500">
                    <th>Date</th>
                    <th>Area</th>
                    <th>Details</th>
                    <th>For</th>
                    <th>Category</th>
                    <th>Sub efforts</th>
                    <ReportSortableTh
                      label="Day share"
                      sortKey="share"
                      activeKey={sortKey}
                      direction={sortDir}
                      align="left"
                      onSort={(key) => {
                        const next = toggleReportSort(sortKey, sortDir, key);
                        setSortKey(next.key);
                        setSortDir(next.dir);
                      }}
                    />
                    <ReportSortableTh
                      label="Time"
                      sortKey="time"
                      activeKey={sortKey}
                      direction={sortDir}
                      onSort={(key) => {
                        const next = toggleReportSort(sortKey, sortDir, key);
                        setSortKey(next.key);
                        setSortDir(next.dir);
                      }}
                    />
                  </tr>
                </thead>
                <tbody>
                  {sortedActivityLines.map((line) => {
                    const areaMeta = AREA_BY_ID.get(line.area);
                    const note = line.leadKey ? budgetNote(budgetByLead.get(line.leadKey)) : null;
                    const subEfforts = line.subEffortIds
                      .map((id) => subEffortNames.get(id) || `Sub effort #${id}`)
                      .join(', ');
                    const details = (
                      <div className="min-w-0">
                        <p className="truncate font-medium text-gray-900">{line.title}</p>
                        {line.subtitle ? <p className="truncate text-xs text-gray-500">{line.subtitle}</p> : null}
                        {note?.band === 'over' ? (
                          <p className={`truncate text-xs font-medium ${BUDGET_STYLES[note.band].text}`}>Over budget</p>
                        ) : null}
                      </div>
                    );
                    return (
                      <tr key={line.key} className="hover:bg-gray-50/80">
                        <td className="whitespace-nowrap text-gray-400">{formatDay(line.workDate)}</td>
                        <td>
                          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-800">
                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: areaMeta?.color }} />
                            {areaMeta?.label}
                          </span>
                        </td>
                        <td>
                          {line.clientPath ? (
                            <Link to={line.clientPath} className="block hover:text-primary">
                              {details}
                            </Link>
                          ) : (
                            details
                          )}
                        </td>
                        <td className="max-w-[12rem] truncate text-gray-700" title={line.departments.join(', ')}>
                          {line.departments.length > 0 ? line.departments.join(', ') : '—'}
                        </td>
                        <td className="max-w-[12rem] truncate text-gray-700">
                          {line.isLead ? line.category || '—' : line.effortCategory || '—'}
                        </td>
                        <td className="max-w-[14rem] text-gray-700" title={subEfforts || undefined}>
                          {line.isLead ? subEfforts || '—' : '—'}
                        </td>
                        <td>
                          <ShareBar
                            percent={line.percent}
                            color={note ? BUDGET_STYLES[note.band].bar : areaMeta?.color || '#6b7280'}
                          />
                        </td>
                        <td className="text-right font-medium tabular-nums text-gray-900">
                          {line.workedMs > 0 ? formatAllocationWorkedDuration(line.workedMs) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
          ) : null}

          {otherLines.length > 0 ? (
            <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-100">
              <h3 className="border-b border-gray-100 px-4 py-3 text-sm font-semibold text-gray-900">Other work</h3>
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr className="border-b border-gray-100 text-xs uppercase tracking-wider text-gray-500">
                      <th>Date</th>
                      <th>Details</th>
                      <ReportSortableTh
                        label="Day share"
                        sortKey="share"
                        activeKey={otherSortKey}
                        direction={otherSortDir}
                        align="left"
                        onSort={(key) => {
                          const next = toggleReportSort(otherSortKey, otherSortDir, key);
                          setOtherSortKey(next.key);
                          setOtherSortDir(next.dir);
                        }}
                      />
                      <ReportSortableTh
                        label="Time"
                        sortKey="time"
                        activeKey={otherSortKey}
                        direction={otherSortDir}
                        onSort={(key) => {
                          const next = toggleReportSort(otherSortKey, otherSortDir, key);
                          setOtherSortKey(next.key);
                          setOtherSortDir(next.dir);
                        }}
                      />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedOtherLines.map((line) => (
                      <tr key={line.key} className="hover:bg-gray-50/80">
                        <td className="whitespace-nowrap text-gray-400">{formatDay(line.workDate)}</td>
                        <td>
                          <p className="font-medium text-gray-900">{line.title}</p>
                          <p className="text-xs text-gray-500">{line.subtitle}</p>
                        </td>
                        <td>
                          <ShareBar percent={line.percent} color="#7c3aed" />
                        </td>
                        <td className="text-right font-medium tabular-nums text-gray-900">
                          {line.workedMs > 0 ? formatAllocationWorkedDuration(line.workedMs) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
};

export default AllocatedHoursTab;
