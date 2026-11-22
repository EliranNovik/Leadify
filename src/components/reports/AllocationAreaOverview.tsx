import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  allocationEmployeeDateKey,
  allocationPercentToWorkedMs,
  formatAllocationCostNis,
  formatAllocationWorkedDuration,
  salaryToHourlyRateNis,
  workedMsAtHourlyRateToCostNis,
  type AllocationReportRow,
  type EffortAllocationReportRow,
} from '../../lib/employeeLeadReporting';
import { effortById, WORK_AREAS, type WorkAreaId, type WorkEffort } from '../../lib/workAreaEfforts';

const AREA_ORDER: WorkAreaId[] = ['handling', 'marketing', 'sales', 'finances', 'development'];

const AREA_COLOR: Record<WorkAreaId, string> = {
  handling: '#7c3aed',
  marketing: '#0284c7',
  sales: '#059669',
  finances: '#d97706',
  development: '#4f46e5',
};

function effortName(effortId: string, extraEfforts: WorkEffort[]): string {
  return effortById(effortId)?.name || extraEfforts.find((effort) => effort.id === effortId)?.name || effortId;
}

function weekStart(iso: string): string {
  const date = new Date(`${iso}T12:00:00Z`);
  const day = date.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  date.setUTCDate(date.getUTCDate() - diff);
  return date.toISOString().slice(0, 10);
}

function sliceCost(
  employeeId: number,
  workDate: string,
  percent: number,
  clockInMsByEmployeeDate: Map<string, number>,
  salaryByEmployee: Map<number, number>,
): { workedMs: number; costNis: number } {
  const dayMs =
    clockInMsByEmployeeDate.get(allocationEmployeeDateKey(employeeId, workDate.slice(0, 10))) ?? 0;
  const workedMs = allocationPercentToWorkedMs(dayMs, percent);
  const gross = salaryByEmployee.get(employeeId);
  const cost = workedMsAtHourlyRateToCostNis(
    workedMs,
    gross != null ? salaryToHourlyRateNis(gross) : null,
  );
  return { workedMs, costNis: cost ?? 0 };
}

const AllocationAreaOverview: React.FC<{
  handlingRows: AllocationReportRow[];
  effortRows: EffortAllocationReportRow[];
  clockInMsByEmployeeDate: Map<string, number>;
  salaryByEmployee: Map<number, number>;
  customEfforts: WorkEffort[];
  hint?: string;
  areaPath?: (id: WorkAreaId) => string;
}> = ({ handlingRows, effortRows, clockInMsByEmployeeDate, salaryByEmployee, customEfforts, hint, areaPath }) => {
  const model = useMemo(() => {
    const areas = new Map<WorkAreaId, { workedMs: number; costNis: number }>();
    for (const id of AREA_ORDER) areas.set(id, { workedMs: 0, costNis: 0 });
    const byBucket = new Map<string, Record<WorkAreaId, number>>();
    const efforts = new Map<string, { area: WorkAreaId; name: string; workedMs: number; costNis: number }>();

    const add = (area: WorkAreaId, date: string, workedMs: number, costNis: number) => {
      const bucket = areas.get(area)!;
      bucket.workedMs += workedMs;
      bucket.costNis += costNis;
      const point = byBucket.get(date) || {
        handling: 0,
        marketing: 0,
        sales: 0,
        finances: 0,
        development: 0,
      };
      point[area] += workedMs;
      byBucket.set(date, point);
    };

    for (const row of handlingRows) {
      const slice = sliceCost(
        row.employee_id,
        row.work_date,
        row.percent,
        clockInMsByEmployeeDate,
        salaryByEmployee,
      );
      add('handling', String(row.work_date).slice(0, 10), slice.workedMs, slice.costNis);
    }

    for (const row of effortRows) {
      const slice = sliceCost(
        row.employeeId,
        row.workDate,
        row.percent,
        clockInMsByEmployeeDate,
        salaryByEmployee,
      );
      add(row.area, row.workDate.slice(0, 10), slice.workedMs, slice.costNis);
      const name = effortName(row.effortId, customEfforts);
      const key = `${row.area}:${name}`;
      const current = efforts.get(key) || { area: row.area, name, workedMs: 0, costNis: 0 };
      current.workedMs += slice.workedMs;
      current.costNis += slice.costNis;
      efforts.set(key, current);
    }

    const areaRows = AREA_ORDER.map((id) => {
      const value = areas.get(id)!;
      const label = WORK_AREAS.find((area) => area.id === id)?.label || id;
      return {
        id,
        label,
        workedMs: value.workedMs,
        costNis: Math.round(value.costNis * 100) / 100,
        hours: Math.round((value.workedMs / 3600000) * 10) / 10,
      };
    });
    const totalMs = areaRows.reduce((sum, row) => sum + row.workedMs, 0);
    const totalCost = Math.round(areaRows.reduce((sum, row) => sum + row.costNis, 0) * 100) / 100;
    const dates = [...byBucket.keys()].filter(Boolean).sort();
    const weekly = dates.length > 14;
    const trendMap = new Map<string, Record<WorkAreaId, number>>();
    for (const date of dates) {
      const key = weekly ? weekStart(date) : date;
      const source = byBucket.get(date)!;
      const point = trendMap.get(key) || {
        handling: 0,
        marketing: 0,
        sales: 0,
        finances: 0,
        development: 0,
      };
      for (const id of AREA_ORDER) point[id] += source[id];
      trendMap.set(key, point);
    }
    const trend = [...trendMap.entries()].map(([date, point]) => ({
      date: date.slice(5),
      ...Object.fromEntries(AREA_ORDER.map((id) => [id, Math.round((point[id] / 3600000) * 10) / 10])),
    }));
    const topEfforts = [...efforts.values()]
      .filter((item) => item.workedMs > 0)
      .sort((a, b) => b.workedMs - a.workedMs)
      .slice(0, 6);

    return { areaRows, totalMs, totalCost, trend, weekly, topEfforts };
  }, [clockInMsByEmployeeDate, customEfforts, effortRows, handlingRows, salaryByEmployee]);

  if (model.totalMs <= 0 && model.totalCost <= 0) return null;

  return (
    <section className="space-y-4">
      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-100 md:p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Where the time went</h2>
            <p className="mt-0.5 text-xs text-gray-500">
              Handling, marketing, sales, finances, and development for the current filters.
              {model.weekly ? ' Days are grouped by week.' : ''}
              {hint ? ` ${hint}` : ''}
            </p>
          </div>
          <p className="text-sm text-gray-600">
            <span className="font-semibold text-gray-900">{formatAllocationWorkedDuration(model.totalMs)}</span>
            <span className="mx-2 text-gray-300">·</span>
            <span className="font-semibold text-gray-900">{formatAllocationCostNis(model.totalCost)}</span>
          </p>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {model.areaRows.map((area) => {
            const share = model.totalMs > 0 ? Math.round((area.workedMs / model.totalMs) * 100) : 0;
            const body = (
              <>
                <p className="flex items-center gap-1.5 text-xs font-semibold text-gray-700">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: AREA_COLOR[area.id] }} />
                  {area.label}
                </p>
                <p className="mt-1 text-sm font-bold text-gray-900">
                  {formatAllocationWorkedDuration(area.workedMs)}
                </p>
                <p className="text-[11px] text-gray-500">
                  {share}% · {formatAllocationCostNis(area.costNis)}
                </p>
              </>
            );
            const className = 'rounded-xl bg-gray-50 px-3 py-2.5 transition hover:bg-gray-100';
            return areaPath ? (
              <Link key={area.id} to={areaPath(area.id)} className={className}>
                {body}
              </Link>
            ) : (
              <div key={area.id} className="rounded-xl bg-gray-50 px-3 py-2.5">
                {body}
              </div>
            );
          })}
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-5">
          <div className="h-64 xl:col-span-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={model.trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#f3f4f6" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#6b7280' }} />
                <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} width={32} unit="h" />
                <Tooltip
                  formatter={(value, name) => {
                    const id = String(name) as WorkAreaId;
                    const label = WORK_AREAS.find((area) => area.id === id)?.label || String(name);
                    return [`${Number(value) || 0} h`, label];
                  }}
                  contentStyle={{ borderRadius: 12, border: '1px solid #e5e7eb', fontSize: 12 }}
                />
                {AREA_ORDER.map((id) => (
                  <Bar key={id} dataKey={id} stackId="time" fill={AREA_COLOR[id]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="xl:col-span-2">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
              Marketing, sales, finances, development
            </p>
            {model.topEfforts.length === 0 ? (
              <p className="text-sm text-gray-500">No time allocated outside handling for these filters.</p>
            ) : (
              <ul className="space-y-2">
                {model.topEfforts.map((effort) => {
                  const areaLabel = WORK_AREAS.find((area) => area.id === effort.area)?.label || effort.area;
                  return (
                    <li key={`${effort.area}-${effort.name}`} className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-gray-900">{effort.name}</p>
                        <p className="text-[11px] text-gray-500">{areaLabel}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-semibold tabular-nums text-gray-900">
                          {formatAllocationWorkedDuration(effort.workedMs)}
                        </p>
                        <p className="text-[11px] tabular-nums text-gray-500">
                          {formatAllocationCostNis(effort.costNis)}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};

export default AllocationAreaOverview;
