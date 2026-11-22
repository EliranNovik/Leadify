import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { formatAllocationCostNis, formatAllocationWorkedDuration } from '../../lib/employeeLeadReporting';
import { departmentIconSrc, type DepartmentHourTotal } from '../../lib/employeeDepartmentTotals';
import { GradientSummaryCard, REPORT_SUMMARY_GRADIENTS } from './GradientSummaryCard';

function DepartmentCard({ department, index }: { department: DepartmentHourTotal; index: number }) {
  return (
    <GradientSummaryCard
      label={department.name}
      labelClassName="text-lg font-semibold"
      value={formatAllocationWorkedDuration(department.workedMs)}
      hint={formatAllocationCostNis(department.costNis)}
      hintBeside
      imageSrc={departmentIconSrc(department.name)}
      variant="white"
      gradientClassName={REPORT_SUMMARY_GRADIENTS[index % REPORT_SUMMARY_GRADIENTS.length]}
    />
  );
}

export default function DepartmentHourTotals({
  totals,
  carousel = false,
}: {
  totals: DepartmentHourTotal[];
  carousel?: boolean;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  useEffect(() => {
    if (!carousel) return;
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
  }, [carousel, totals.length]);

  if (totals.length === 0) return null;

  if (!carousel) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {totals.map((department, index) => (
          <DepartmentCard key={department.name} department={department} index={index} />
        ))}
      </div>
    );
  }

  const showArrows = canScrollLeft || canScrollRight;
  const scrollByCard = (direction: -1 | 1) => {
    const el = scrollerRef.current;
    if (!el) return;
    const card = el.querySelector('[data-department-card]');
    const distance = card ? card.getBoundingClientRect().width + 12 : Math.round(el.clientWidth * 0.8);
    el.scrollBy({ left: direction * distance, behavior: 'smooth' });
  };

  return (
    <div className="flex items-center gap-2">
      {showArrows ? (
        <button
          type="button"
          aria-label="Previous departments"
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
        {totals.map((department, index) => (
          <div key={department.name} data-department-card className="w-[28rem] shrink-0 snap-start">
            <DepartmentCard department={department} index={index} />
          </div>
        ))}
      </div>
      {showArrows ? (
        <button
          type="button"
          aria-label="Next departments"
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
