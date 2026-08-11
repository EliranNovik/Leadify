import React, { useEffect, useRef, useState } from 'react';
import { CheckIcon, FunnelIcon } from '@heroicons/react/24/outline';
import type { EmailSidepanelListMode } from '../../lib/interactions/emailFilters';

const OPTIONS: Array<{ value: EmailSidepanelListMode; label: string; hint: string }> = [
  { value: 'newest', label: 'Newest email', hint: 'Most recent conversations first' },
  { value: 'oldest', label: 'Latest emails', hint: 'From oldest to newest' },
  { value: 'unreplied', label: 'Not replied', hint: 'Inbox emails waiting for a reply' },
];

type Props = {
  value: EmailSidepanelListMode;
  onChange: (mode: EmailSidepanelListMode) => void;
};

export function EmailSidepanelListMenu({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const isActive = value !== 'newest';

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="relative shrink-0" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={`inline-flex h-9 w-9 items-center justify-center rounded-full border transition ${
          open || isActive
            ? 'border-[#4218CC] bg-[#4218CC]/10 text-[#4218CC]'
            : 'border-gray-300 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700'
        }`}
        aria-label="Filter emails"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Filter emails"
      >
        <FunnelIcon className="h-4 w-4" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-40 mt-1.5 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
        >
          {OPTIONS.map((option) => {
            const selected = value === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={`flex w-full items-start gap-2 px-3 py-2.5 text-left transition ${
                  selected ? 'bg-[#4218CC]/8' : 'hover:bg-slate-50'
                }`}
              >
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                  {selected ? <CheckIcon className="h-4 w-4 text-[#4218CC]" /> : null}
                </span>
                <span className="min-w-0">
                  <span
                    className={`block text-sm font-semibold ${
                      selected ? 'text-[#4218CC]' : 'text-slate-800'
                    }`}
                  >
                    {option.label}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">
                    {option.hint}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
