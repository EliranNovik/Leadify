import React, { useEffect, useRef, useState } from 'react';
import { MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline';

type Props = {
  value: string;
  onChange: (query: string) => void;
  loading?: boolean;
  className?: string;
};

const CalendarLeadFilterSearch: React.FC<Props> = ({ value, onChange, loading = false, className = '' }) => {
  const [isOpen, setIsOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const hasFilter = value.trim().length > 0;

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isOpen]);

  const handleClose = () => {
    setIsOpen(false);
  };

  const handleClear = () => {
    onChange('');
    inputRef.current?.focus();
  };

  return (
    <div ref={wrapRef} className={`relative flex items-center ${className}`}>
      {isOpen ? (
        <div className="flex items-center gap-1">
          <label className="relative flex items-center">
            <MagnifyingGlassIcon
              className="pointer-events-none absolute left-3 h-4 w-4 text-base-content/45"
              aria-hidden
            />
            <input
              ref={inputRef}
              type="search"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder="Search all leads & clients…"
              className="input input-bordered input-sm h-10 w-44 rounded-full bg-white pl-9 pr-9 sm:w-56 md:w-64"
              aria-label="Search all calendar leads and clients"
            />
            {loading ? (
              <span className="absolute right-2 inline-flex h-6 w-6 items-center justify-center">
                <span className="loading loading-spinner loading-xs text-primary" />
              </span>
            ) : hasFilter ? (
              <button
                type="button"
                className="absolute right-2 inline-flex h-6 w-6 items-center justify-center rounded-full text-base-content/45 hover:bg-base-200/70"
                aria-label="Clear filter"
                onClick={handleClear}
              >
                <XMarkIcon className="h-4 w-4" />
              </button>
            ) : null}
          </label>
          <button
            type="button"
            className="btn btn-circle btn-ghost btn-sm border-0 shadow-none hover:bg-gray-100/80"
            aria-label="Close search"
            onClick={handleClose}
          >
            <XMarkIcon className="h-5 w-5" style={{ color: '#3b28c7' }} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          className={`btn btn-circle btn-ghost border-0 shadow-none btn-md md:btn-lg hover:bg-gray-100/80 ${
            hasFilter ? 'bg-[#4418C4]/15' : ''
          }`}
          title={hasFilter ? `Search active: ${value.trim()}` : 'Search all leads and clients'}
          aria-label="Search all leads and clients"
          aria-pressed={hasFilter}
          onClick={(e) => {
            e.stopPropagation();
            setIsOpen(true);
          }}
        >
          <MagnifyingGlassIcon className="h-5 w-5 md:h-6 md:w-6" style={{ color: '#3b28c7' }} />
        </button>
      )}
    </div>
  );
};

export default CalendarLeadFilterSearch;
