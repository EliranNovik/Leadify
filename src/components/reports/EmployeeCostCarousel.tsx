import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import {
  formatAllocationCostNis,
  formatAllocationWorkedDuration,
  type LeadManagementLeadRow,
} from '../../lib/leadsManagementReport';
import {
  getSalaryEmployeeInitials,
  salaryAvatarGradientStyle,
} from '../../lib/employeeSalaries';
import { fetchClockedInEmployeeIds } from '../../lib/employeeClockInStatus';
import { supabase } from '../../lib/supabase';

type EmployeeTotal = {
  employeeId: number;
  employeeName: string;
  photoUrl: string | null;
  departmentName: string | null;
  missingSalary: boolean;
  workedMs: number;
  costNis: number;
  leadCount: number;
  lastWorkDate: string | null;
};

function formatReportStamp(isoDate: string): string {
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(
    new Date(`${isoDate.slice(0, 10)}T12:00:00`),
  );
}

function totalsFromRows(rows: LeadManagementLeadRow[]): EmployeeTotal[] {
  const byId = new Map<number, EmployeeTotal>();
  for (const row of rows) {
    for (const employee of row.employees) {
      const current = byId.get(employee.employeeId) || {
        employeeId: employee.employeeId,
        employeeName: employee.employeeName,
        photoUrl: employee.photoUrl,
        departmentName: employee.departmentName,
        missingSalary: employee.missingSalary,
        workedMs: 0,
        costNis: 0,
        leadCount: 0,
        lastWorkDate: null,
      };
      current.workedMs += employee.workedMs;
      current.costNis += employee.costNis;
      current.leadCount += 1;
      if (employee.lastWorkDate && (!current.lastWorkDate || employee.lastWorkDate > current.lastWorkDate)) {
        current.lastWorkDate = employee.lastWorkDate;
      }
      if (!current.photoUrl && employee.photoUrl) current.photoUrl = employee.photoUrl;
      if (!current.departmentName && employee.departmentName) current.departmentName = employee.departmentName;
      if (employee.missingSalary) current.missingSalary = true;
      byId.set(employee.employeeId, current);
    }
  }
  return [...byId.values()].sort(
    (a, b) => b.costNis - a.costNis || b.workedMs - a.workedMs || a.employeeName.localeCompare(b.employeeName),
  );
}

const EmployeeCostCarousel: React.FC<{
  rows: LeadManagementLeadRow[];
  onOpen: (employeeId: number) => void;
}> = ({ rows, onOpen }) => {
  const employees = useMemo(() => totalsFromRows(rows), [rows]);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [clockedInIds, setClockedInIds] = useState<Set<number>>(() => new Set());

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const update = () => {
      setCanScrollLeft(el.scrollLeft > 4);
      setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, [employees.length]);

  useEffect(() => {
    let cancelled = false;
    const reload = () => {
      void fetchClockedInEmployeeIds()
        .then((ids) => {
          if (!cancelled) setClockedInIds(ids);
        })
        .catch((error) => {
          console.error('[EmployeeCostCarousel] clock-in status failed:', error);
        });
    };
    reload();
    const channel = supabase
      .channel('employee-cost-carousel-clock')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'employee_clock_in' },
        () => reload(),
      )
      .subscribe();
    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, []);

  const scrollByCard = (direction: -1 | 1) => {
    const el = scrollerRef.current;
    if (!el) return;
    const card = el.querySelector('button');
    const distance = card ? card.getBoundingClientRect().width + 12 : Math.round(el.clientWidth * 0.8);
    el.scrollBy({ left: direction * distance, behavior: 'smooth' });
  };

  if (employees.length === 0) return null;
  const showArrows = canScrollLeft || canScrollRight;

  return (
    <section className="mb-5">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-gray-900">Employee totals</h2>
        <p className="text-xs text-gray-500">Highest cost first · this view</p>
      </div>
      <div className="flex items-center gap-2">
        {showArrows ? (
          <button
            type="button"
            aria-label="Previous employees"
            disabled={!canScrollLeft}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-gray-700 shadow-md ring-1 ring-black/10 hover:bg-gray-50 disabled:opacity-40"
            onClick={() => scrollByCard(-1)}
          >
            <ChevronLeftIcon className="h-5 w-5" aria-hidden />
          </button>
        ) : null}
        <div
          ref={scrollerRef}
          className="flex min-w-0 flex-1 snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth pb-1 scrollbar-hide"
        >
          {employees.map((employee) => (
            <button
              key={employee.employeeId}
              type="button"
              className="relative flex w-64 shrink-0 snap-start flex-col rounded-2xl bg-white p-3 pr-14 text-left shadow-sm ring-1 ring-gray-100 transition hover:bg-gray-100"
              onClick={() => onOpen(employee.employeeId)}
            >
              {employee.lastWorkDate ? (
                <span
                  className="absolute right-2 top-2 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-gray-600"
                  title={`Last reported ${employee.lastWorkDate}`}
                >
                  {formatReportStamp(employee.lastWorkDate)}
                </span>
              ) : null}
              <span className="flex items-start gap-3">
                <span className="relative h-11 w-11 shrink-0">
                  {employee.photoUrl ? (
                    <img
                      src={employee.photoUrl}
                      alt=""
                      className="h-11 w-11 rounded-full object-cover"
                    />
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
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-semibold text-gray-900">{employee.employeeName}</span>
                    {employee.missingSalary ? (
                      <span className="shrink-0 rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">
                        No salary
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-gray-500">
                    {employee.departmentName || 'No department'}
                    {' · '}
                    {employee.leadCount} {employee.leadCount === 1 ? 'lead' : 'leads'}
                  </span>
                </span>
              </span>
              <span className="mt-2 flex items-baseline gap-2">
                <span className="text-base font-bold tabular-nums text-gray-900">
                  {formatAllocationWorkedDuration(employee.workedMs)}
                </span>
                <span className="font-medium text-gray-300">|</span>
                <span className="text-sm font-medium tabular-nums text-gray-500">
                  {formatAllocationCostNis(employee.costNis)}
                </span>
              </span>
            </button>
          ))}
        </div>
        {showArrows ? (
          <button
            type="button"
            aria-label="Next employees"
            disabled={!canScrollRight}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-gray-700 shadow-md ring-1 ring-black/10 hover:bg-gray-50 disabled:opacity-40"
            onClick={() => scrollByCard(1)}
          >
            <ChevronRightIcon className="h-5 w-5" aria-hidden />
          </button>
        ) : null}
      </div>
    </section>
  );
};

export default EmployeeCostCarousel;
