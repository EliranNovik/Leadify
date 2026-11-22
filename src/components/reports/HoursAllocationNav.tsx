import React, { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  ArrowLeftIcon,
  BanknotesIcon,
  BriefcaseIcon,
  ChevronDownIcon,
  CodeBracketIcon,
  MegaphoneIcon,
  PresentationChartLineIcon,
  Squares2X2Icon,
} from '@heroicons/react/24/outline';
import { buildEmployeeDepartmentTotals } from '../../lib/employeeDepartmentTotals';
import { fetchAgreementScoreboardDepartments } from '../../lib/scoreboardDepartments';
import { supabase } from '../../lib/supabase';
import type { WorkAreaId } from '../../lib/workAreaEfforts';

const AREAS: { id: WorkAreaId; label: string; icon: typeof BriefcaseIcon }[] = [
  { id: 'handling', label: 'Handling', icon: BriefcaseIcon },
  { id: 'marketing', label: 'Marketing', icon: MegaphoneIcon },
  { id: 'sales', label: 'Sales', icon: PresentationChartLineIcon },
  { id: 'finances', label: 'Finances', icon: BanknotesIcon },
  { id: 'development', label: 'Development', icon: CodeBracketIcon },
];

const DASHBOARD_PATH = '/reports/employee-lead-allocations';

let departmentNamesPromise: Promise<string[]> | null = null;

function loadDepartmentNames(): Promise<string[]> {
  if (!departmentNamesPromise) {
    departmentNamesPromise = Promise.all([
      fetchAgreementScoreboardDepartments(),
      supabase.from('tenant_departement').select('id, name').order('id'),
    ])
      .then(([targets, all]) => {
        const departments = (all.data || []).map((row) => ({
          id: Number(row.id),
          name: String(row.name || '').trim(),
        }));
        return buildEmployeeDepartmentTotals([], departments, targets).map((item) => item.name);
      })
      .catch((error) => {
        departmentNamesPromise = null;
        throw error;
      });
  }
  return departmentNamesPromise;
}

function NavIcon({ icon: Icon }: { icon: typeof BriefcaseIcon }) {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-gray-200">
      <Icon className="h-5 w-5" aria-hidden />
    </span>
  );
}

function areaHref(area: WorkAreaId, dateQuery: string, department?: string): string {
  const params = new URLSearchParams(dateQuery);
  if (department) params.set('department', department);
  else params.delete('department');
  const query = params.toString();
  return `/reports/hours-allocation/${area}${query ? `?${query}` : ''}`;
}

export default function HoursAllocationNav({
  activeArea = null,
  activeDepartment = '',
  dateQuery = '',
  back = null,
}: {
  activeArea?: WorkAreaId | null;
  activeDepartment?: string;
  dateQuery?: string;
  back?: { to: string; label: string } | null;
}) {
  const location = useLocation();
  const onDashboard = location.pathname === DASHBOARD_PATH;
  const [departments, setDepartments] = useState<string[]>([]);
  const [openAreas, setOpenAreas] = useState<Set<WorkAreaId>>(() => new Set(activeArea ? [activeArea] : []));

  useEffect(() => {
    let cancelled = false;
    void loadDepartmentNames()
      .then((names) => {
        if (!cancelled) setDepartments(names);
      })
      .catch((error) => console.error('[HoursAllocationNav] departments failed:', error));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!activeArea) return;
    setOpenAreas((current) => {
      if (current.has(activeArea)) return current;
      const next = new Set(current);
      next.add(activeArea);
      return next;
    });
  }, [activeArea]);

  const toggleArea = (area: WorkAreaId) => {
    setOpenAreas((current) => {
      const next = new Set(current);
      if (next.has(area)) next.delete(area);
      else next.add(area);
      return next;
    });
  };

  return (
    <aside className="flex w-full shrink-0 flex-col self-stretch bg-[#ececec] md:w-56">
      <nav
        className="sticky top-14 max-h-[calc(100dvh-3.5rem)] flex-1 overflow-y-auto p-3 scrollbar-hide"
        aria-label="Hours allocation"
      >
        <NavLink
          to={back?.to || '/reports'}
          className="mb-2 flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold text-gray-700 transition-colors duration-200 hover:bg-gray-50"
        >
          <NavIcon icon={ArrowLeftIcon} />
          <span className="truncate">{back?.label || 'Back'}</span>
        </NavLink>
        <NavLink
          to={DASHBOARD_PATH}
          className={`mb-1 flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors duration-200 ${
            onDashboard ? 'bg-gray-100 text-gray-900' : 'text-gray-700 hover:bg-gray-50'
          }`}
        >
          <NavIcon icon={Squares2X2Icon} />
          Dashboard
        </NavLink>
        <ul className="flex flex-col gap-0.5">
          {AREAS.map((area) => {
            const open = openAreas.has(area.id);
            const areaActive = activeArea === area.id && !activeDepartment;
            const AreaIcon = area.icon;
            return (
              <li key={area.id}>
                <div className={`flex items-center rounded-xl transition-colors duration-200 ${areaActive ? 'bg-gray-100' : 'hover:bg-gray-50'}`}>
                  <NavLink
                    to={areaHref(area.id, dateQuery)}
                    className={`flex w-[9.5rem] shrink-0 items-center gap-2.5 py-2.5 pl-3 text-sm font-medium ${
                      areaActive ? 'text-gray-900' : 'text-gray-700'
                    }`}
                  >
                    <NavIcon icon={AreaIcon} />
                    <span className="truncate">{area.label}</span>
                  </NavLink>
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-label={`${open ? 'Hide' : 'Show'} ${area.label} departments`}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-black/5 hover:text-gray-800"
                    onClick={() => toggleArea(area.id)}
                  >
                    <ChevronDownIcon className={`h-4 w-4 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
                  </button>
                </div>
                <div
                  className={`grid transition-[grid-template-rows] duration-300 ease-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
                >
                  <div className="overflow-hidden">
                    <ul className="space-y-0.5 px-2 pb-1 pt-0.5">
                      {departments.map((name) => {
                        const selected = activeArea === area.id && activeDepartment === name;
                        return (
                          <li key={name}>
                            <NavLink
                              to={areaHref(area.id, dateQuery, name)}
                              className={`block truncate rounded-lg px-3 py-1.5 text-sm transition-colors duration-200 ${
                                selected ? 'bg-gray-100 font-medium text-gray-900' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800'
                              }`}
                              title={name}
                            >
                              {name}
                            </NavLink>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
