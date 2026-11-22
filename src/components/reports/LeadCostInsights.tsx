import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  buildLeadManagementDetailPath,
  formatAllocationCostNis,
  formatAllocationWorkedDuration,
  type LeadManagementLeadRow,
} from '../../lib/leadsManagementReport';
import {
  getSalaryEmployeeInitials,
  salaryAvatarGradientStyle,
} from '../../lib/employeeSalaries';
import { fetchAgreementScoreboardDepartments } from '../../lib/scoreboardDepartments';
import {
  buildCategoryNameToDataMap,
  canonicalizeScoreboardDepartment,
  fetchCategoriesWithDepartments,
  resolveCategoryAndDepartment,
} from '../../lib/resolveCategoryDepartment';
import { supabase } from '../../lib/supabase';

const HEALTH_COLORS = {
  over: '#e11d48',
  near: '#d97706',
  within: '#059669',
  nocap: '#94a3b8',
} as const;

function compactNis(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    const millions = value / 1_000_000;
    return `${millions >= 10 ? Math.round(millions) : Math.round(millions * 10) / 10}m`;
  }
  if (abs >= 1000) return `${Math.round(value / 1000)}k`;
  return String(Math.round(value));
}

type ScoreboardCatalog = {
  targets: { id: number; name: string }[];
  categories: any[];
  nameMap: Map<string, any>;
};

function categoryLookupValue(row: LeadManagementLeadRow): string {
  if (row.mainCategory && row.subcategory) return `${row.mainCategory} > ${row.subcategory}`;
  return row.subcategory || row.mainCategory || row.category || '';
}

function isSingleGermanOrAustrian(name: string): boolean {
  const text = name.toLowerCase();
  const german = /german/.test(text);
  const austrian = /austria/.test(text);
  return (german || austrian) && !(german && austrian);
}

function combinedGermanAustrian(
  targets: { id: number; name: string }[],
): { name: string; order: number } {
  const index = targets.findIndex(
    (dept) => /austria/i.test(dept.name) && /german/i.test(dept.name) && !/sales/i.test(dept.name),
  );
  const fallback = targets.findIndex((dept) => /austria/i.test(dept.name) && /german/i.test(dept.name));
  const order = index >= 0 ? index : fallback;
  return {
    name: order >= 0 ? targets[order].name : 'Austria and Germany',
    order: order >= 0 ? order : 0,
  };
}

function departmentForLead(
  row: LeadManagementLeadRow,
  catalog: ScoreboardCatalog | null,
): { name: string; order: number } {
  const leadText = `${row.mainCategory || ''} ${row.subcategory || ''}`;
  if (!catalog) {
    if (/austria|german/i.test(leadText)) return { name: 'Austria and Germany', order: 0 };
    return { name: row.mainCategory || 'Other', order: 1000 };
  }
  const resolved = canonicalizeScoreboardDepartment(
    resolveCategoryAndDepartment(categoryLookupValue(row), null, null, catalog.categories, catalog.nameMap),
    catalog.targets,
  );
  const name =
    resolved.departmentName && resolved.departmentName !== '—' ? resolved.departmentName : 'Other';
  if (isSingleGermanOrAustrian(name) || isSingleGermanOrAustrian(leadText)) {
    return combinedGermanAustrian(catalog.targets);
  }
  const order = catalog.targets.findIndex((dept) => dept.name === name);
  return { name, order: order >= 0 ? order : 1000 };
}

function shortLabel(value: string, max = 18): string {
  const text = value.trim() || '—';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function ChartCard({
  title,
  subtitle,
  chartClassName = 'h-64',
  children,
}: {
  title: string;
  subtitle: string;
  chartClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-100">
      <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
      <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p>
      <div className={`mt-3 ${chartClassName}`}>{children}</div>
    </section>
  );
}

function HighestCostLeadTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: {
    fullName?: string;
    leadNumber?: string;
    cost?: number;
    reporters?: Array<{ employeeId: number; employeeName: string; photoUrl: string | null }>;
  } }>;
}) {
  const lead = payload?.[0]?.payload;
  if (!active || !lead) return null;
  return (
    <div className="min-w-[12rem] rounded-xl bg-white px-3 py-2.5 shadow-lg ring-1 ring-gray-200">
      <p className="text-sm font-semibold text-gray-900">{lead.fullName}</p>
      <p className="text-xs text-gray-500">
        #{lead.leadNumber} · {formatAllocationCostNis(lead.cost)}
      </p>
      <ul className="mt-2 space-y-1.5">
        {(lead.reporters || []).map((employee) => (
          <li key={employee.employeeId} className="flex items-center gap-2">
            {employee.photoUrl ? (
              <img src={employee.photoUrl} alt="" className="h-7 w-7 rounded-full object-cover" />
            ) : (
              <span
                className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold text-white"
                style={salaryAvatarGradientStyle(employee.employeeId, employee.employeeName)}
              >
                {getSalaryEmployeeInitials(employee.employeeName)}
              </span>
            )}
            <span className="text-sm text-gray-800">{employee.employeeName}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const LeadCostInsights: React.FC<{ rows: LeadManagementLeadRow[] }> = ({ rows }) => {
  const navigate = useNavigate();
  const [catalog, setCatalog] = useState<ScoreboardCatalog | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetchAgreementScoreboardDepartments(),
      fetchCategoriesWithDepartments(supabase),
    ])
      .then(([targets, categories]) => {
        if (cancelled) return;
        setCatalog({
          targets,
          categories,
          nameMap: buildCategoryNameToDataMap(categories),
        });
      })
      .catch((error) => {
        console.error('[LeadCostInsights] scoreboard departments failed:', error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const model = useMemo(() => {
    let spend = 0;
    let allowed = 0;
    let overrun = 0;
    let utilSum = 0;
    let utilCount = 0;
    const health = { over: 0, near: 0, within: 0, nocap: 0 };
    const byDepartment = new Map<string, { cost: number; max: number; order: number }>();

    for (const row of rows) {
      spend += row.costNis;
      const max = row.maxAllowedCostNis > 0 ? row.maxAllowedCostNis : 0;
      if (max > 0) {
        allowed += max;
        utilSum += row.utilizationPercent;
        utilCount += 1;
        if (row.exceedsCap) {
          health.over += 1;
          overrun += Math.max(0, row.costNis - max);
        } else if (row.utilizationPercent >= 80) {
          health.near += 1;
        } else {
          health.within += 1;
        }
      } else {
        health.nocap += 1;
      }
      const dept = departmentForLead(row, catalog);
      const bucket = byDepartment.get(dept.name) || { cost: 0, max: 0, order: dept.order };
      bucket.cost += row.costNis;
      bucket.max += max;
      bucket.order = Math.min(bucket.order, dept.order);
      byDepartment.set(dept.name, bucket);
    }

    const departments = [...byDepartment.entries()]
      .map(([name, value]) => ({
        name,
        cost: Math.round(value.cost),
        max: Math.round(value.max),
        order: value.order,
      }))
      .filter((item) => item.cost > 0 || item.max > 0)
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

    const topLeads = [...rows]
      .sort((a, b) => b.costNis - a.costNis)
      .slice(0, 8)
      .map((row) => ({
        name: shortLabel(row.clientName, 22),
        fullName: row.clientName,
        leadNumber: row.leadNumber,
        cost: Math.round(row.costNis),
        path: buildLeadManagementDetailPath(row),
        reporters: [...row.employees]
          .filter((employee) => employee.workedMs > 0 || employee.costNis > 0)
          .sort((a, b) => b.costNis - a.costNis || b.workedMs - a.workedMs)
          .map((employee) => ({
            employeeId: employee.employeeId,
            employeeName: employee.employeeName,
            photoUrl: employee.photoUrl,
          })),
      }));

    const healthData = [
      { name: 'Over budget', value: health.over, fill: HEALTH_COLORS.over },
      { name: 'Near cap', value: health.near, fill: HEALTH_COLORS.near },
      { name: 'Within budget', value: health.within, fill: HEALTH_COLORS.within },
      { name: 'No cap', value: health.nocap, fill: HEALTH_COLORS.nocap },
    ].filter((item) => item.value > 0);

    return {
      spend: Math.round(spend * 100) / 100,
      allowed: Math.round(allowed * 100) / 100,
      overrun: Math.round(overrun * 100) / 100,
      headroom: Math.round(Math.max(0, allowed - spend) * 100) / 100,
      avgUtil: utilCount > 0 ? Math.round((utilSum / utilCount) * 10) / 10 : null,
      workedMs: rows.reduce((sum, row) => sum + row.workedMs, 0),
      healthData,
      departments,
      topLeads,
    };
  }, [catalog, rows]);

  if (rows.length === 0) return null;

  return (
    <section className="mb-5 space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div>
          <p className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wider text-gray-500">Spend in view</p>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-gray-100">
            <p className="text-lg font-bold text-gray-900">{formatAllocationCostNis(model.spend)}</p>
            <p className="text-xs text-gray-500">{formatAllocationWorkedDuration(model.workedMs)}</p>
          </div>
        </div>
        <div>
          <p className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wider text-gray-500">Allowed</p>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-gray-100">
            <p className="text-lg font-bold text-gray-900">{formatAllocationCostNis(model.allowed)}</p>
            <p className="text-xs text-gray-500">
              {model.avgUtil != null ? `${model.avgUtil}% average use` : 'No capped leads'}
            </p>
          </div>
        </div>
        <div>
          <p className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wider text-gray-500">Overrun</p>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 rounded-2xl bg-rose-100 px-4 py-3 shadow-sm">
            <p className="text-lg font-bold text-rose-700">{formatAllocationCostNis(model.overrun)}</p>
            <p className="text-xs text-rose-600/80">Cost above the cap</p>
          </div>
        </div>
        <div>
          <p className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wider text-gray-500">Room left</p>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 rounded-2xl bg-emerald-100 px-4 py-3 shadow-sm">
            <p className="text-lg font-bold text-emerald-700">{formatAllocationCostNis(model.headroom)}</p>
            <p className="text-xs text-emerald-700/80">On leads that still have a cap</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">Budget health</h2>
          <p className="mt-0.5 text-xs text-gray-500">Leads in the current filters</p>
          <div className="mt-3 h-56">
            {model.healthData.length === 0 ? (
              <p className="px-2 py-16 text-center text-sm text-gray-500">No leads in this view.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={model.healthData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={52}
                    outerRadius={78}
                    paddingAngle={2}
                  >
                    {model.healthData.map((entry) => (
                      <Cell key={entry.name} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value, name) => [value ?? 0, String(name)]}
                    contentStyle={{ borderRadius: 12, border: '1px solid #e5e7eb', fontSize: 12 }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1">
            {model.healthData.map((entry) => (
              <span key={entry.name} className="inline-flex items-center gap-1.5 text-[11px] text-gray-600">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.fill }} />
                {entry.name} {entry.value}
              </span>
            ))}
          </div>
        </section>

        <ChartCard
          title="Cost by department"
          subtitle="Agreement signed departments"
          chartClassName={model.departments.length > 6 ? 'h-80' : 'h-64'}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={model.departments}
              layout="vertical"
              margin={{ top: 4, right: 8, left: 4, bottom: 0 }}
            >
              <CartesianGrid stroke="#f3f4f6" horizontal={false} />
              <XAxis type="number" tickFormatter={compactNis} tick={{ fontSize: 11, fill: '#6b7280' }} />
              <YAxis
                type="category"
                dataKey="name"
                width={132}
                tick={{ fontSize: 11, fill: '#374151' }}
              />
              <Tooltip
                formatter={(value, name) => [
                  formatAllocationCostNis(Number(value) || 0),
                  name === 'cost' ? 'Spend' : 'Allowed',
                ]}
                contentStyle={{ borderRadius: 12, border: '1px solid #e5e7eb', fontSize: 12 }}
              />
              <Bar dataKey="cost" fill="#7c3aed" radius={[0, 4, 4, 0]} />
              <Bar dataKey="max" fill="#ddd6fe" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Highest cost leads" subtitle="Top leads in this view">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={model.topLeads}
              layout="vertical"
              margin={{ top: 4, right: 8, left: 8, bottom: 0 }}
            >
              <CartesianGrid stroke="#f3f4f6" horizontal={false} />
              <XAxis type="number" tickFormatter={compactNis} tick={{ fontSize: 11, fill: '#6b7280' }} />
              <YAxis
                type="category"
                dataKey="name"
                width={108}
                tick={(tick) => {
                  const lead = model.topLeads.find((item) => item.name === tick.payload?.value);
                  return (
                    <text
                      x={tick.x}
                      y={tick.y}
                      dy={4}
                      textAnchor="end"
                      fill="#374151"
                      fontSize={11}
                      style={{ cursor: lead?.path ? 'pointer' : 'default' }}
                      onClick={() => {
                        if (lead?.path) navigate(lead.path);
                      }}
                    >
                      {tick.payload?.value}
                    </text>
                  );
                }}
              />
              <Tooltip
                content={<HighestCostLeadTooltip />}
                cursor={{ fill: 'rgba(15, 118, 110, 0.08)' }}
                wrapperStyle={{ zIndex: 30, outline: 'none' }}
              />
              <Bar
                dataKey="cost"
                fill="#0f766e"
                radius={[0, 4, 4, 0]}
                className="cursor-pointer"
                onClick={(bar) => {
                  const path = bar?.path || bar?.payload?.path;
                  if (path) navigate(path);
                }}
              />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </section>
  );
};

export default LeadCostInsights;
