import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { XMarkIcon, ChevronDownIcon } from '@heroicons/react/24/outline';

interface Source {
  id: number;
  name: string;
}

interface ExternSourcesMultiSelectProps {
  value: unknown;
  onChange: (value: number[]) => void;
  record?: { id?: string; [key: string]: unknown } | null;
  readOnly?: boolean;
}

const ExternSourcesMultiSelect: React.FC<ExternSourcesMultiSelectProps> = ({
  value,
  onChange,
  readOnly = false,
}) => {
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<number[]>(() => {
    if (value == null) return [];
    const arr = Array.isArray(value) ? value : [];
    return arr.map((id) => Number(id)).filter((n) => !Number.isNaN(n));
  });
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchSources = async () => {
      try {
        const { data, error } = await supabase
          .from('misc_leadsource')
          .select('id, name')
          .order('name', { ascending: true });
        if (error) throw error;
        setSources((data as Source[]) || []);
      } catch (err) {
        console.error('Error fetching lead sources:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchSources();
  }, []);

  useEffect(() => {
    if (value == null) {
      setSelectedIds([]);
      return;
    }
    const arr = Array.isArray(value) ? value : [];
    setSelectedIds(arr.map((id: unknown) => Number(id)).filter((n) => !Number.isNaN(n)));
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
    const next = selectedIds.includes(id)
      ? selectedIds.filter((x) => x !== id)
      : [...selectedIds, id];
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

  const selectedSources = sources.filter((s) => selectedIds.includes(s.id));

  if (loading) {
    return <div className="text-sm text-base-content/70">Loading sources...</div>;
  }

  return (
    <div className="space-y-2" ref={containerRef}>
      <div className="relative">
        {open && (
          <div className="absolute bottom-full left-0 right-0 mb-1 border border-base-300 rounded-lg bg-base-100 shadow-lg max-h-48 overflow-y-auto z-10">
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
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-base-200 flex items-center gap-2 ${isSelected ? 'bg-primary/15 text-primary' : ''}`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        toggle(source.id);
                      }}
                    >
                      <span className={`flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center ${isSelected ? 'bg-primary border-primary' : 'border-base-300'}`}>
                        {isSelected && <span className="text-white text-xs">✓</span>}
                      </span>
                      {source.name}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          </div>
        )}
        <input
          type="text"
          className="input input-bordered w-full pr-10"
          placeholder="Type to filter sources..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onFocus={() => setOpen(true)}
          onMouseDown={() => setOpen(true)}
          readOnly={readOnly}
          disabled={readOnly}
          style={{ color: '#111827', WebkitTextFillColor: '#111827' }}
        />
        <button
          type="button"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-base-content/50 hover:text-base-content"
          onMouseDown={(e) => {
            e.preventDefault();
            setOpen((o) => !o);
          }}
          tabIndex={-1}
          aria-label="Toggle dropdown"
        >
          <ChevronDownIcon className={`w-5 h-5 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {selectedSources.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedSources.map((source) => (
            <span
              key={source.id}
              className="badge badge-lg gap-1 bg-primary/20 text-primary border border-primary/30"
            >
              {source.name}
              {!readOnly && (
                <button
                  type="button"
                  className="rounded-full hover:bg-primary/30 p-0.5"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    remove(source.id);
                  }}
                  aria-label={`Remove ${source.name}`}
                >
                  <XMarkIcon className="w-3.5 h-3.5" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {selectedIds.length > 0 && !readOnly && (
        <button type="button" className="btn btn-ghost btn-xs gap-1" onClick={clearAll}>
          <XMarkIcon className="w-3.5 h-3.5" />
          Clear all
        </button>
      )}

      {sources.length === 0 && <p className="text-sm text-base-content/60">No sources found.</p>}
    </div>
  );
};

export default ExternSourcesMultiSelect;
