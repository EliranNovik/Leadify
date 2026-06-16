import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDaysIcon, ChevronDownIcon } from '@heroicons/react/24/outline';

export interface YearWheelPickerProps {
  value: number;
  onChange: (year: number) => void;
  disabled?: boolean;
  label?: string;
  labelClassName?: string;
  minYear?: number;
  maxYear?: number;
}

export function buildAllYearOptions(minYear = 2000, maxYear = new Date().getFullYear() + 1): number[] {
  const years: number[] = [];
  for (let y = maxYear; y >= minYear; y -= 1) {
    years.push(y);
  }
  return years;
}

const YearWheelPicker: React.FC<YearWheelPickerProps> = ({
  value,
  onChange,
  disabled = false,
  label,
  labelClassName = 'label-text text-sm text-gray-600 mb-1.5 font-medium',
  minYear = 2000,
  maxYear = new Date().getFullYear() + 1,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const years = useMemo(
    () => buildAllYearOptions(minYear, maxYear),
    [minYear, maxYear],
  );

  const clampedValue = useMemo(() => {
    if (years.includes(value)) return value;
    if (value < minYear) return minYear;
    if (value > maxYear) return maxYear;
    return years[0] ?? value;
  }, [value, years, minYear, maxYear]);

  const scrollSelectedIntoView = useCallback(() => {
    requestAnimationFrame(() => {
      const idx = years.indexOf(clampedValue);
      if (scrollRef.current && idx >= 0) {
        const el = scrollRef.current.children[idx] as HTMLElement | undefined;
        el?.scrollIntoView({ block: 'center' });
      }
    });
  }, [years, clampedValue]);

  useEffect(() => {
    if (isOpen) scrollSelectedIntoView();
  }, [isOpen, scrollSelectedIntoView, clampedValue]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const wheelItemClass = (selected: boolean) =>
    `w-full rounded-lg px-3 py-2.5 text-center text-sm font-medium tabular-nums transition-all ${
      selected
        ? 'bg-primary text-primary-content shadow-sm scale-[1.02]'
        : 'text-base-content/70 hover:bg-base-200/80 hover:text-base-content'
    }`;

  return (
    <div className="relative w-full" ref={containerRef}>
      {label ? <span className={labelClassName}>{label}</span> : null}
      <button
        type="button"
        disabled={disabled}
        className="input input-bordered flex h-12 min-h-12 w-full cursor-pointer items-center justify-between gap-2 text-left text-base"
        onClick={() => !disabled && setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        <div className="flex min-w-0 items-center gap-2">
          <CalendarDaysIcon className="h-5 w-5 shrink-0 text-primary" aria-hidden />
          <span className="font-semibold tabular-nums">{clampedValue}</span>
        </div>
        <ChevronDownIcon
          className={`h-4 w-4 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>
      {isOpen && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-2xl border border-base-300/80 bg-base-100 shadow-xl dark:border-base-content/10">
          <div className="px-3 pb-3 pt-3">
            <div
              ref={scrollRef}
              role="listbox"
              aria-label={label ?? 'Year'}
              className="year-wheel-scroll h-52 w-full overflow-y-auto overscroll-contain px-1 py-2"
            >
              {years.map((year) => (
                <button
                  key={year}
                  type="button"
                  role="option"
                  aria-selected={year === clampedValue}
                  disabled={disabled}
                  className={wheelItemClass(year === clampedValue)}
                  onClick={() => {
                    onChange(year);
                    setIsOpen(false);
                  }}
                >
                  {year}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      <style>{`
        .year-wheel-scroll::-webkit-scrollbar {
          width: 5px;
        }
        .year-wheel-scroll::-webkit-scrollbar-thumb {
          background: color-mix(in oklab, var(--color-base-content) 25%, transparent);
          border-radius: 999px;
        }
      `}</style>
    </div>
  );
};

export default YearWheelPicker;
