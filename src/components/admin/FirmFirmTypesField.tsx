import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { XMarkIcon, ChevronDownIcon } from '@heroicons/react/24/outline';
import FirmTypeBadge from '../FirmTypeBadge';

type Props = {
  value: string[] | null | undefined;
  onChange: (value: string[]) => void;
  readOnly?: boolean;
};

type FirmType = { id: string; label: string; code: string | null };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeTypeIds(v: typeof value): string[] {
  if (v == null) return [];
  const arr = Array.isArray(v) ? v : [];
  return arr.map((id) => String(id).trim()).filter((id) => UUID_RE.test(id));
}

/**
 * Searchable multi-select for firm_types (firm ↔ firm_firm_type junction).
 */
const FirmFirmTypesField: React.FC<Props> = ({ value, onChange, readOnly }) => {
  const [types, setTypes] = useState<FirmType[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>(() => normalizeTypeIds(value));
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    const loadTypes = async () => {
      const { data, error } = await supabase
        .from('firm_types')
        .select('id, label, code')
        .order('sort_order', { ascending: true })
        .order('label', { ascending: true });
      if (cancelled) return;
      if (!error && data) {
        setTypes(
          (data as { id: string; label: string | null; code: string | null }[])
            .filter((r) => r.id && UUID_RE.test(r.id))
            .map((r) => ({
              id: r.id,
              label: r.label?.trim() || r.code || 'Unnamed type',
              code: r.code,
            }))
        );
      }
      setLoading(false);
    };

    void loadTypes();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setSelectedIds(normalizeTypeIds(value));
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
  const filteredTypes = filterLower
    ? types.filter(
        (t) =>
          t.label.toLowerCase().includes(filterLower) ||
          (t.code?.toLowerCase().includes(filterLower) ?? false)
      )
    : types;

  const toggle = (id: string) => {
    if (readOnly) return;
    const next = selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id];
    setSelectedIds(next);
    onChange(next);
  };

  const remove = (id: string) => {
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

  const selectedTypes = selectedIds.map((id) => {
    const found = types.find((t) => t.id === id);
    return found ?? { id, label: `Type ${id.slice(0, 8)}…`, code: null };
  });

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-base-content/70">
        <span className="loading loading-spinner loading-sm" />
        Loading firm types…
      </div>
    );
  }

  return (
    <div className="space-y-2" ref={containerRef}>
      <p className="text-xs text-base-content/60">
        Search and add one or more types. The first selected type is stored as the firm&apos;s primary type.
      </p>

      <div className="relative">
        <input
          type="text"
          className="input input-bordered w-full pr-10 text-gray-900 placeholder:text-gray-400"
          placeholder="Type to search firm types…"
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
            {filteredTypes.length === 0 ? (
              <div className="px-3 py-4 text-sm text-base-content/60">No types match.</div>
            ) : (
              <ul className="py-1">
                {filteredTypes.map((typeRow) => {
                  const isSelected = selectedIds.includes(typeRow.id);
                  return (
                    <li key={typeRow.id}>
                      <button
                        type="button"
                        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-base-200 ${
                          isSelected ? 'bg-primary/15 text-primary' : ''
                        }`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          toggle(typeRow.id);
                        }}
                      >
                        <span
                          className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border ${
                            isSelected ? 'border-primary bg-primary' : 'border-base-300'
                          }`}
                        >
                          {isSelected && <span className="text-[10px] text-white">✓</span>}
                        </span>
                        <span className="truncate">{typeRow.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>

      {selectedTypes.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedTypes.map((typeRow, idx) => (
            <span key={typeRow.id} className="inline-flex items-center gap-1">
              {idx === 0 && (
                <span className="text-[10px] font-semibold uppercase text-base-content/45">Primary</span>
              )}
              <FirmTypeBadge label={typeRow.label} typeId={typeRow.id} size="sm" />
              {!readOnly && (
                <button
                  type="button"
                  className="rounded-full p-0.5 text-base-content/50 hover:bg-base-200 hover:text-base-content"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    remove(typeRow.id);
                  }}
                  aria-label={`Remove ${typeRow.label}`}
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

      {types.length === 0 && <p className="text-sm text-base-content/60">No firm types found.</p>}
    </div>
  );
};

export default FirmFirmTypesField;
