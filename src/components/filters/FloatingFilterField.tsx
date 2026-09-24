import React, { useEffect, useRef } from 'react';

/** Softer placeholders so hints stay secondary to typed values */
export const FILTER_INPUT_BORDERED_CLASS =
  'input input-bordered w-full h-11 min-h-[44px] placeholder:!text-gray-300 dark:placeholder:!text-base-content/25';

/** Floating label: sits inside as placeholder, lifts to the top border when focused / has value. */
export function FloatingFilterLabel({ label, floated }: { label: string; floated: boolean }) {
  return (
    <span
      aria-hidden
      className={
        floated
          ? 'pointer-events-none absolute left-2.5 top-0 z-[1] max-w-[calc(100%-1.25rem)] -translate-y-1/2 truncate bg-white px-1 text-xs font-medium text-base-content/65 transition-[color,font-size,transform,top] duration-200 ease-out dark:bg-base-100'
          : 'pointer-events-none absolute left-3 top-1/2 z-[1] max-w-[calc(100%-1.5rem)] -translate-y-1/2 truncate text-sm font-medium text-gray-500 transition-[color,font-size,transform,top] duration-200 ease-out dark:text-base-content/45'
      }
    >
      {label}
    </span>
  );
}

export function FloatingFilterField({
  label,
  floated,
  className = '',
  children,
}: {
  label: string;
  floated: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`relative pt-2 ${className}`}>
      <div className="relative">
        {children}
        <FloatingFilterLabel label={label} floated={floated} />
      </div>
    </div>
  );
}

export const FILTER_DROPDOWN_CLASS =
  'absolute z-50 mt-1 max-h-60 min-w-[16rem] w-max max-w-[22rem] overflow-y-auto overscroll-contain rounded-md border border-gray-300 bg-white py-1 shadow-lg whitespace-nowrap';

/** Wider than the filter input; traps wheel so the page does not scroll at the list end. */
export function FilterDropdown({
  children,
  align = 'start',
}: {
  children: React.ReactNode;
  align?: 'start' | 'end';
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.stopPropagation();
      const { scrollTop, scrollHeight, clientHeight } = el;
      const canScroll = scrollHeight > clientHeight + 1;
      if (!canScroll) {
        event.preventDefault();
        return;
      }
      const atTop = scrollTop <= 0 && event.deltaY < 0;
      const atBottom = scrollTop + clientHeight >= scrollHeight - 1 && event.deltaY > 0;
      if (atTop || atBottom) event.preventDefault();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <div
      ref={ref}
      className={`${FILTER_DROPDOWN_CLASS} ${align === 'end' ? 'right-0 left-auto' : 'left-0'}`}
    >
      {children}
    </div>
  );
}

export function FilterSelectionMeta({
  count,
  onClearAll,
}: {
  count: number;
  onClearAll?: () => void;
}) {
  if (count <= 0) return null;
  return (
    <div className="mt-1.5 flex items-center justify-end gap-2">
      <span className="text-xs font-medium text-purple-600">{count} selected</span>
      {onClearAll && (
        <button
          type="button"
          className="text-xs font-semibold text-base-content/55 hover:text-error underline-offset-2 hover:underline"
          onClick={(e) => {
            e.preventDefault();
            onClearAll();
          }}
        >
          Unselect all
        </button>
      )}
    </div>
  );
}
