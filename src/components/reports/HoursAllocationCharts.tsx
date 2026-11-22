import React, { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatAllocationCostNis, formatAllocationWorkedDuration } from '../../lib/employeeLeadReporting';
import type { DepartmentHourTotal } from '../../lib/employeeDepartmentTotals';

type EmployeeHourTotal = {
  employeeId: number;
  employeeName: string;
  photoUrl: string | null;
  workedMs: number;
  costNis: number;
};

function compactNis(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    const millions = value / 1_000_000;
    return `${millions >= 10 ? Math.round(millions) : Math.round(millions * 10) / 10}m`;
  }
  if (abs >= 1000) return `${Math.round(value / 1000)}k`;
  return String(Math.round(value));
}

function compactHours(ms: number): string {
  const hours = ms / 3_600_000;
  if (hours >= 10) return `${Math.round(hours)}h`;
  return `${Math.round(hours * 10) / 10}h`;
}

function shortLabel(value: string, max = 16): string {
  const text = value.trim() || '—';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function twoLineLabel(value: string): [string, string] {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return [words[0] || '—', ''];
  let splitAt = 1;
  let bestGap = Number.POSITIVE_INFINITY;
  for (let index = 1; index < words.length; index += 1) {
    const gap = Math.abs(words.slice(0, index).join(' ').length - words.slice(index).join(' ').length);
    if (gap < bestGap) {
      bestGap = gap;
      splitAt = index;
    }
  }
  return [words.slice(0, splitAt).join(' '), words.slice(splitAt).join(' ')];
}

function TwoLineTick({ x = 0, y = 0, payload }: { x?: number; y?: number; payload?: { value?: string } }) {
  const [first, second] = twoLineLabel(String(payload?.value || ''));
  return (
    <text x={x} y={y} textAnchor="end" fill="#374151" fontSize={11}>
      <tspan x={x} dy={second ? -6 : 4}>
        {first}
      </tspan>
      {second ? (
        <tspan x={x} dy={13}>
          {second}
        </tspan>
      ) : null}
    </text>
  );
}

function ChartCard({
  title,
  subtitle,
  height,
  children,
}: {
  title: string;
  subtitle: string;
  height: number;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
      <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p>
      <div className="mt-3" style={{ height }}>
        {children}
      </div>
    </section>
  );
}

function RankedBarChart({
  rows,
  dataKey,
  fill,
  tickFormatter,
  tooltipFormatter,
  wrapLabels = false,
}: {
  rows: Array<{ name: string; fullName: string; costNis: number; workedMs: number }>;
  dataKey: 'costNis' | 'workedMs';
  fill: string;
  tickFormatter: (value: number) => string;
  tooltipFormatter: (value: number) => string;
  wrapLabels?: boolean;
}) {
  if (rows.length === 0) {
    return <p className="px-2 py-16 text-center text-sm text-gray-500">Nothing reported in this view.</p>;
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
        <CartesianGrid stroke="#f3f4f6" horizontal={false} />
        <XAxis type="number" tickFormatter={tickFormatter} tick={{ fontSize: 11, fill: '#6b7280' }} />
        <YAxis
          type="category"
          dataKey="name"
          width={wrapLabels ? 148 : 124}
          tick={wrapLabels ? TwoLineTick : { fontSize: 11, fill: '#374151' }}
          interval={0}
        />
        <Tooltip
          formatter={(value) => [tooltipFormatter(Number(value) || 0), dataKey === 'costNis' ? 'Cost' : 'Time']}
          labelFormatter={(_, payload) => String(payload?.[0]?.payload?.fullName || '')}
          contentStyle={{ borderRadius: 12, border: '1px solid #e5e7eb', fontSize: 12 }}
        />
        <Bar dataKey={dataKey} fill={fill} radius={[0, 4, 4, 0]} maxBarSize={18} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export default function HoursAllocationCharts({
  departments,
  employees,
}: {
  departments: DepartmentHourTotal[];
  employees: EmployeeHourTotal[];
}) {
  const model = useMemo(() => {
    const departmentCost = departments
      .filter((item) => item.costNis > 0)
      .sort((a, b) => b.costNis - a.costNis)
      .map((item) => ({ name: item.name, fullName: item.name, costNis: item.costNis, workedMs: item.workedMs }));
    const departmentTime = departments
      .filter((item) => item.workedMs > 0)
      .sort((a, b) => b.workedMs - a.workedMs)
      .map((item) => ({ name: item.name, fullName: item.name, costNis: item.costNis, workedMs: item.workedMs }));
    const employeeCost = [...employees]
      .filter((item) => item.costNis > 0)
      .sort((a, b) => b.costNis - a.costNis)
      .slice(0, 12)
      .map((item) => ({
        name: shortLabel(item.employeeName),
        fullName: item.employeeName,
        costNis: item.costNis,
        workedMs: item.workedMs,
      }));
    const employeeTime = [...employees]
      .filter((item) => item.workedMs > 0)
      .sort((a, b) => b.workedMs - a.workedMs)
      .slice(0, 12)
      .map((item) => ({
        name: shortLabel(item.employeeName),
        fullName: item.employeeName,
        costNis: item.costNis,
        workedMs: item.workedMs,
      }));
    return { departmentCost, departmentTime, employeeCost, employeeTime };
  }, [departments, employees]);

  const heightFor = (count: number, wrapped = false) => Math.max(220, count * (wrapped ? 48 : 32) + 24);

  return (
    <div className="grid grid-cols-1 gap-6 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-100 xl:grid-cols-2">
      <ChartCard title="Departments by cost" subtitle="Highest reported cost across all areas" height={heightFor(model.departmentCost.length, true)}>
        <RankedBarChart
          rows={model.departmentCost}
          dataKey="costNis"
          fill="#7c3aed"
          tickFormatter={compactNis}
          tooltipFormatter={(value) => formatAllocationCostNis(value)}
          wrapLabels
        />
      </ChartCard>
      <ChartCard title="Departments by time" subtitle="Most time reported across all areas" height={heightFor(model.departmentTime.length, true)}>
        <RankedBarChart
          rows={model.departmentTime}
          dataKey="workedMs"
          fill="#0284c7"
          tickFormatter={compactHours}
          tooltipFormatter={(value) => formatAllocationWorkedDuration(value)}
          wrapLabels
        />
      </ChartCard>
      <ChartCard title="Employees by cost" subtitle="Highest reported cost" height={heightFor(model.employeeCost.length)}>
        <RankedBarChart
          rows={model.employeeCost}
          dataKey="costNis"
          fill="#059669"
          tickFormatter={compactNis}
          tooltipFormatter={(value) => formatAllocationCostNis(value)}
        />
      </ChartCard>
      <ChartCard title="Employees by time" subtitle="Most time reported" height={heightFor(model.employeeTime.length)}>
        <RankedBarChart
          rows={model.employeeTime}
          dataKey="workedMs"
          fill="#d97706"
          tickFormatter={compactHours}
          tooltipFormatter={(value) => formatAllocationWorkedDuration(value)}
        />
      </ChartCard>
    </div>
  );
}
