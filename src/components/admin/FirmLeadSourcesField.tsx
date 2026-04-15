import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { XMarkIcon, ChevronDownIcon } from '@heroicons/react/24/outline';

type Props = {
  value: number[] | string[] | null | undefined;
  onChange: (value: number[]) => void;
  readOnly?: boolean;
};

type Source = { id: number; name: string; active?: boolean | null };

/** JS safe integer max; allow bigint-style numeric IDs coming from DB. */
const MAX_SAFE_INT = Number.MAX_SAFE_INTEGER;

/**
 * Searchable multi-select for misc_leadsource (firm ↔ sources_firms).
 * Input filters the list; pick rows from the dropdown; selected items show as chips.
 */
const FirmLeadSourcesField: React.FC<Props> = ({ value, onChange, readOnly }) => {
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<number[]>(() => normalizeIds(value));
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const refreshTimerRef = useRef<number | null>(null);

  function normalizeIds(v: typeof value): number[] {
    if (v == null) return [];
    const arr = Array.isArray(v) ? v : [];
    return arr
      .map((id) => (typeof id === 'string' ? parseInt(id, 10) : Number(id)))
      .filter(
        (n) => Number.isFinite(n) && n >= 1 && n <= MAX_SAFE_INT && n === Math.floor(n)
      );
  }

  useEffect(() => {
    let cancelled = false;

    const loadSources = async () => {
      const { data, error } = await supabase
        .from('misc_leadsource')
        .select('id, name, active')
        .order('name');
      if (cancelled) return;
      if (!error && data) {
        const rows = (data as { id: number | string; name: string; active?: boolean | null }[])
          .map((r) => ({
            id: typeof r.id === 'string' ? parseInt(r.id, 10) : Number(r.id),
            name: r.name,
            active: r.active ?? null,
          }))
          .filter(
            (r) =>
              Number.isFinite(r.id) &&
              r.id >= 1 &&
              r.id <= MAX_SAFE_INT &&
              r.id === Math.floor(r.id)
          );
        setSources(rows);
      }
      setLoading(false);
    };

    void loadSources();

    // Live subscription so newly added/edited/deactivated sources show immediately
    const scheduleRefresh = () => {
      if (typeof window === 'undefined') return;
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = window.setTimeout(() => {
        void loadSources();
      }, 250);
    };

    const channel = supabase
      .channel('firm-lead-sources:realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'misc_leadsource' }, scheduleRefresh)
      .subscribe();

    return () => {
      cancelled = true;
      if (refreshTimerRef.current && typeof window !== 'undefined') {
        window.clearTimeout(refreshTimerRef.current);
      }
      void supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    setSelectedIds(normalizeIds(value));
  }, [value]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filterLower = filter.trim().toLowerCase();
  const filteredSources = filterLower
    ? sources.filter((s) => s.name.toLowerCase().includes(filterLower))
    : sources;

  const toggle = (id: number) => {
    if (readOnly) return;
    const next = selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id];
    setSelectedIds(next);
    onChange(next);
  };

  const remove = (id: number) => {
    if (readOnly) return;
    const next = selectedIds.filter((x) => x !== id);
    setSelectedIds(next);
    onChange(next);
  };

  const clearAll = () => {
    if (readOnly) return;
    setSelectedIds([]);
    onChange([]);
  };

  const selectedSources = selectedIds.map((id) => {
    const found = sources.find((s) => s.id === id);
    return found ?? { id, name: `Source #${id}` };
  });

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-base-content/70">
        <span className="loading loading-spinner loading-sm" />
        Loading sources…
      </div>
    );
  }

  return (
    <div className="space-y-2" ref={containerRef}>
      <p className="text-xs text-base-content/60">
        Search and add sources. These links identify this provider in marketing reports.
      </p>

      <div className="relative">
        <input
          type="text"
          className="input input-bordered w-full pr-10 text-gray-900 placeholder:text-gray-400"
          placeholder="Type to search sources…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
          }}
          readOnly={readOnly}
          disabled={readOnly}
          autoComplete="off"
          style={{ WebkitTextFillColor: '#111827' }}
        />
        <button
          type="button"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-base-content/50 hover:text-base-content"
          onMouseDown={(e) => {
            e.preventDefault();
            if (!readOnly) setOpen((o) => !o);
          }}
          tabIndex={-1}
          aria-label={open ? 'Close list' : 'Open list'}
        >
          <ChevronDownIcon className={`h-5 w-5 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>

        {open && !readOnly && (
          <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-52 overflow-y-auto rounded-lg border border-base-300 bg-base-100 shadow-lg">
            {filteredSources.length === 0 ? (
              <div className="px-3 py-4 text-sm text-base-content/60">No sources match.</div>
            ) : (
              <ul className="py-1">
                {filteredSources.map((source) => {
                  const isSelected = selectedIds.includes(source.id);
                  return (
                    <li key={source.id}>
                      <button
                        type="button"
                        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-base-200 ${
                          isSelected ? 'bg-primary/15 text-primary' : ''
                        }`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          toggle(source.id);
                        }}
                      >
                        <span
                          className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border ${
                            isSelected ? 'border-primary bg-primary' : 'border-base-300'
                          }`}
                        >
                          {isSelected && <span className="text-[10px] text-white">✓</span>}
                        </span>
                        <span className="truncate">{source.name}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>

      {selectedSources.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedSources.map((source) => (
            <span
              key={source.id}
              className="badge badge-lg gap-1 border border-primary/30 bg-primary/20 text-primary"
            >
              <span className="max-w-[14rem] truncate">{source.name}</span>
              {!readOnly && (
                <button
                  type="button"
                  className="rounded-full p-0.5 hover:bg-primary/30"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    remove(source.id);
                  }}
                  aria-label={`Remove ${source.name}`}
                >
                  <XMarkIcon className="h-3.5 w-3.5" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {selectedIds.length > 0 && !readOnly && (
        <button type="button" className="btn btn-ghost btn-xs gap-1" onClick={clearAll}>
          <XMarkIcon className="h-3.5 w-3.5" />
          Clear all
        </button>
      )}

      {sources.length === 0 && <p className="text-sm text-base-content/60">No active sources found.</p>}
    </div>
  );
};

export default FirmLeadSourcesField;
