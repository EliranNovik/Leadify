import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline';
import type { CombinedLead } from '../../lib/legacyLeadsApi';
import { useLeadContactSearch } from '../../hooks/useLeadContactSearch';
import LeadContactSearchResults from '../search/LeadContactSearchResults';

type Props = {
  onSelectLead: (lead: CombinedLead) => void;
  className?: string;
};

const CalendarMeetingSearch: React.FC<Props> = ({ onSelectLead, className = '' }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);

  const { results, loading } = useLeadContactSearch(query, { enabled: isOpen });

  const close = useCallback(() => {
    setIsOpen(false);
    setQuery('');
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const input = wrapRef.current?.querySelector('input');
    input?.focus();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) {
        close();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [close, isOpen]);

  const handleSelect = (lead: CombinedLead) => {
    onSelectLead(lead);
    close();
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
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Lead, contact, phone, email…"
              className="input input-bordered input-sm h-10 w-52 rounded-full bg-white pl-9 pr-9 sm:w-72 md:w-80"
              aria-label="Search calendar leads and contacts"
            />
            {query ? (
              <button
                type="button"
                className="absolute right-2 inline-flex h-6 w-6 items-center justify-center rounded-full text-base-content/45 hover:bg-base-200/70"
                aria-label="Clear search"
                onClick={() => setQuery('')}
              >
                <XMarkIcon className="h-4 w-4" />
              </button>
            ) : null}
          </label>
          <button
            type="button"
            className="btn btn-circle btn-ghost btn-sm border-0 shadow-none hover:bg-gray-100/80"
            aria-label="Close search"
            onClick={close}
          >
            <XMarkIcon className="h-5 w-5" style={{ color: '#3b28c7' }} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="btn btn-circle btn-ghost border-0 shadow-none btn-md md:btn-lg hover:bg-gray-100/80"
          title="Search leads and contacts"
          aria-label="Search leads and contacts"
          onClick={(e) => {
            e.stopPropagation();
            setIsOpen(true);
          }}
        >
          <MagnifyingGlassIcon className="h-5 w-5 md:h-6 md:w-6" style={{ color: '#3b28c7' }} />
        </button>
      )}

      {isOpen && (loading || results.length > 0 || query.trim().length >= 2) ? (
        <div className="absolute right-0 top-[calc(100%+8px)] z-[120] max-h-[min(24rem,60vh)] w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl bg-white shadow-2xl sm:w-96">
          <LeadContactSearchResults
            results={results}
            loading={loading}
            query={query}
            onSelect={handleSelect}
          />
        </div>
      ) : null}
    </div>
  );
};

export default CalendarMeetingSearch;

export { combinedLeadToRouteLead, meetingMatchesCombinedLead } from '../../lib/leadContactSearchUi';
