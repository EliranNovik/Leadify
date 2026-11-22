import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { formatAllocationCostNis, formatAllocationWorkedDuration } from '../../lib/employeeLeadReporting';
import { getSalaryEmployeeInitials, salaryAvatarGradientStyle, washedEmployeeCardStyle } from '../../lib/employeeSalaries';

export type HoursEmployeeCard = {
  employeeId: number;
  employeeName: string;
  photoUrl: string | null;
  departmentName: string | null;
  workedMs: number;
  costNis: number;
  lastWorkDate: string | null;
};

function formatStamp(isoDate: string): string {
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(
    new Date(`${isoDate.slice(0, 10)}T12:00:00`),
  );
}

export default function HoursEmployeeCarousel({
  employees,
  clockedInIds,
  to,
}: {
  employees: HoursEmployeeCard[];
  clockedInIds: Set<number>;
  to: (employeeId: number) => string;
}) {
  const ordered = useMemo(
    () => [...employees].sort((a, b) => b.costNis - a.costNis || b.workedMs - a.workedMs || a.employeeName.localeCompare(b.employeeName)),
    [employees],
  );
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

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
  }, [ordered.length]);

  if (ordered.length === 0) return null;

  const showArrows = canScrollLeft || canScrollRight;
  const scrollByCard = (direction: -1 | 1) => {
    const el = scrollerRef.current;
    if (!el) return;
    const card = el.querySelector('a');
    const distance = card ? card.getBoundingClientRect().width + 12 : Math.round(el.clientWidth * 0.8);
    el.scrollBy({ left: direction * distance, behavior: 'smooth' });
  };

  return (
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
        {ordered.map((employee) => (
          <Link
            key={employee.employeeId}
            to={to(employee.employeeId)}
            className="relative flex w-64 shrink-0 snap-start flex-col rounded-2xl p-3 text-left shadow-sm ring-1 ring-black/5 transition hover:brightness-95"
            style={washedEmployeeCardStyle(employee.employeeId, employee.employeeName)}
          >
            {employee.lastWorkDate ? (
              <span className="absolute right-2 top-2 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">
                {formatStamp(employee.lastWorkDate)}
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
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-gray-900">{employee.employeeName}</span>
                <span className="block truncate text-xs text-gray-500">{employee.departmentName || 'No department'}</span>
              </span>
            </span>
            <span className="mt-2 flex items-baseline gap-2 text-left text-sm">
              <span className="font-bold tabular-nums text-gray-900">{formatAllocationWorkedDuration(employee.workedMs)}</span>
              <span className="font-medium text-gray-300">|</span>
              <span className="font-medium tabular-nums text-gray-500">{formatAllocationCostNis(employee.costNis)}</span>
            </span>
          </Link>
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
  );
}
