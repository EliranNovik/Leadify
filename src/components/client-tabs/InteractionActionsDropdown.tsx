import React, { useEffect, useRef, useState } from 'react';
import { EllipsisVerticalIcon } from '@heroicons/react/24/outline';

export type InteractionActionMenuItem = {
  key: string;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
};

type Props = {
  items: InteractionActionMenuItem[];
  className?: string;
  ariaLabel?: string;
};

export function InteractionActionsDropdown({
  items,
  className = '',
  ariaLabel = 'Message actions',
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (items.length === 0) return null;

  return (
    <div ref={rootRef} className={`relative shrink-0 ${className}`}>
      <button
        type="button"
        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((prev) => !prev);
        }}
      >
        <EllipsisVerticalIcon className="h-5 w-5" />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-40 mt-1 w-48 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium hover:bg-slate-50 ${
                item.danger ? 'text-red-600 hover:bg-red-50' : 'text-slate-700'
              }`}
              onClick={(event) => {
                event.stopPropagation();
                setOpen(false);
                item.onClick();
              }}
            >
              <span className={`inline-flex h-4 w-4 shrink-0 items-center justify-center ${item.danger ? '' : 'text-slate-500'}`}>
                {item.icon}
              </span>
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
