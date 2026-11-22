import React from 'react';

export type AllocationAreaNavItem = {
  id: string;
  label: string;
  total: string;
  hasTime: boolean;
};

type AllocationAreaSidebarProps = {
  items: AllocationAreaNavItem[];
  activeId: string;
  dayTotal: string;
  overAllocated?: boolean;
  onSelect: (id: string) => void;
  className?: string;
};

const AllocationAreaSidebar: React.FC<AllocationAreaSidebarProps> = ({
  items,
  activeId,
  dayTotal,
  overAllocated = false,
  onSelect,
  className = '',
}) => (
  <nav
    aria-label="Allocation areas"
    className={`w-full flex-col rounded-[18px] bg-white p-2 shadow-sm ${className}`}
  >
    <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
      Areas
    </p>
    <ul className="flex flex-col gap-0.5">
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <li key={item.id}>
            <button
              type="button"
              aria-current={active ? 'true' : undefined}
              className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
              onClick={() => onSelect(item.id)}
            >
              <span className="min-w-0 truncate">{item.label}</span>
              <span
                className={`shrink-0 text-xs font-semibold tabular-nums ${
                  item.hasTime ? 'text-emerald-700' : 'text-gray-400'
                }`}
              >
                {item.total}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
    <div className="mt-1 flex items-center justify-between gap-2 border-t border-gray-100 px-3 py-2.5">
      <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Day total</span>
      <span
        className={`text-sm font-semibold tabular-nums ${
          overAllocated ? 'text-rose-600' : 'text-gray-800'
        }`}
      >
        {dayTotal}
      </span>
    </div>
  </nav>
);

export default AllocationAreaSidebar;
