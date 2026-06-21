import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import {
  buildPortalSearchIndex,
  searchPortal,
  type PortalSearchAction,
  type PortalSearchData,
  type PortalSearchResult,
  type PortalSearchTab,
} from '../lib/portalSearch';

type Props = {
  data: PortalSearchData;
  onNavigate: (tab: PortalSearchTab) => void;
  onRequestMeeting: () => void;
};

function runAction(
  action: PortalSearchAction,
  onNavigate: (tab: PortalSearchTab) => void,
  onRequestMeeting: () => void,
) {
  if (action.type === 'navigate') {
    onNavigate(action.tab);
    return;
  }
  if (action.type === 'request-meeting') {
    onRequestMeeting();
    return;
  }
  if (action.type === 'external') {
    window.open(action.href, '_blank', 'noopener,noreferrer');
  }
}

const PortalBannerSearch: React.FC<Props> = ({ data, onNavigate, onRequestMeeting }) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const index = useMemo(() => buildPortalSearchIndex(data), [data]);
  const results = useMemo(() => searchPortal(index, query), [index, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const selectResult = (result: PortalSearchResult) => {
    runAction(result.action, onNavigate, onRequestMeeting);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (!open || results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      selectResult(results[activeIndex]);
    }
  };

  return (
    <div ref={rootRef} className="relative w-full">
      <label className="sr-only" htmlFor="portal-banner-search">
        Search portal pages and case information
      </label>
      <div className="relative flex h-11 w-full items-center gap-2.5 rounded-full border border-white/30 bg-white/95 pl-3.5 pr-4 shadow-lg backdrop-blur-sm focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/20 md:h-12 md:pl-4">
        <MagnifyingGlassIcon className="h-5 w-5 shrink-0 text-neutral-500" aria-hidden />
        <input
          ref={inputRef}
          id="portal-banner-search"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search..."
          className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-base-content placeholder:text-base-content/45 focus:outline-none focus:ring-0"
          autoComplete="off"
          role="combobox"
          aria-expanded={open && results.length > 0}
          aria-controls="portal-banner-search-results"
          aria-activedescendant={open && results[activeIndex] ? `portal-search-${results[activeIndex].id}` : undefined}
        />
      </div>

      {open && results.length > 0 ? (
        <ul
          id="portal-banner-search-results"
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-30 max-h-[min(20rem,50vh)] overflow-y-auto rounded-2xl border border-base-200 bg-white py-2 shadow-xl"
        >
          {results.map((result, idx) => (
            <li key={result.id} role="option" aria-selected={idx === activeIndex}>
              <button
                id={`portal-search-${result.id}`}
                type="button"
                className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors ${
                  idx === activeIndex ? 'bg-primary/8' : 'hover:bg-base-200/60'
                }`}
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={() => selectResult(result)}
              >
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-base-content/90">{result.title}</p>
                  {result.subtitle ? (
                    <p className="mt-0.5 truncate text-sm text-base-content/50">{result.subtitle}</p>
                  ) : null}
                </div>
                <span className="shrink-0 rounded-full bg-base-200 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-base-content/45">
                  {result.category}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {open && query.trim().length >= 2 && results.length === 0 ? (
        <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-30 rounded-2xl border border-base-200 bg-white px-4 py-4 text-sm text-base-content/50 shadow-xl">
          No matches. Try &quot;payments&quot;, &quot;meetings&quot;, or a contact name.
        </div>
      ) : null}
    </div>
  );
};

export default PortalBannerSearch;
