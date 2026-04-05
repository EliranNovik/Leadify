import React, { useEffect, useState } from 'react';
import { XMarkIcon, MagnifyingGlassIcon, FlagIcon } from '@heroicons/react/24/outline';
import type { FlagTypeRow } from '../lib/userContentFlags';

export type LeadPick = {
  id: string | number;
  lead_number: string | number | null;
  name: string | null;
  email?: string | null;
  isLegacy: boolean;
};

type Props = {
  open: boolean;
  onClose: () => void;
  messagePreview: string;
  flagTypes: FlagTypeRow[];
  searchLeads: (query: string) => Promise<LeadPick[]>;
  isSearching?: boolean;
  onSubmit: (lead: LeadPick, flagTypeId: number) => Promise<void>;
};

const RmqMessageFlagLeadModal: React.FC<Props> = ({
  open,
  onClose,
  messagePreview,
  flagTypes,
  searchLeads,
  isSearching = false,
  onSubmit,
}) => {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<LeadPick[]>([]);
  const [selected, setSelected] = useState<LeadPick | null>(null);
  const [flagTypeId, setFlagTypeId] = useState<number>(() => flagTypes[0]?.id ?? 1);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setQ('');
      setResults([]);
      setSelected(null);
      setFlagTypeId(flagTypes[0]?.id ?? 1);
      return;
    }
    setFlagTypeId(flagTypes[0]?.id ?? 1);
  }, [open, flagTypes]);

  useEffect(() => {
    if (!open || q.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      void searchLeads(q.trim()).then(setResults);
    }, 300);
    return () => clearTimeout(t);
  }, [q, open, searchLeads]);

  if (!open) return null;

  const handleSubmit = async () => {
    if (!selected || !flagTypeId) return;
    setSubmitting(true);
    try {
      await onSubmit(selected, flagTypeId);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/50 p-4">
      <div className="bg-base-100 rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col border border-base-300">
        <div className="p-4 border-b border-base-300 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-base-content flex items-center gap-2">
              <FlagIcon className="h-6 w-6 text-amber-600 shrink-0" />
              Flag message to lead
            </h3>
            {messagePreview ? (
              <p className="text-sm text-base-content/70 mt-1 line-clamp-3">{messagePreview}</p>
            ) : null}
          </div>
          <button type="button" className="btn btn-ghost btn-sm btn-circle shrink-0" onClick={onClose} aria-label="Close">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto flex-1 min-h-0">
          <div>
            <label className="label py-0 pb-1">
              <span className="label-text text-sm font-medium">Flag type</span>
            </label>
            <select
              className="select select-bordered select-sm w-full"
              value={flagTypeId}
              onChange={e => setFlagTypeId(Number(e.target.value))}
            >
              {flagTypes.map(ft => (
                <option key={ft.id} value={ft.id}>
                  {ft.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label py-0 pb-1">
              <span className="label-text text-sm font-medium">Find lead</span>
            </label>
            <div className="relative">
              <MagnifyingGlassIcon className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-base-content/40" />
              <input
                type="search"
                className="input input-bordered input-sm w-full pl-10"
                placeholder="Name, email, lead #…"
                value={q}
                onChange={e => setQ(e.target.value)}
              />
            </div>
            {isSearching && <p className="text-xs text-base-content/50 mt-1">Searching…</p>}
          </div>

          <ul className="rounded-lg border border-base-300 divide-y divide-base-200 max-h-48 overflow-y-auto">
            {results.length === 0 && q.trim().length >= 2 && !isSearching ? (
              <li className="p-3 text-sm text-base-content/60 text-center">No leads found</li>
            ) : null}
            {results.map(lead => {
              const key = `${lead.isLegacy ? 'L' : 'N'}-${lead.id}`;
              const sel =
                selected &&
                selected.isLegacy === lead.isLegacy &&
                String(selected.id) === String(lead.id);
              return (
                <li key={key}>
                  <button
                    type="button"
                    className={`w-full text-left px-3 py-2.5 text-sm hover:bg-base-200 transition-colors ${
                      sel ? 'bg-[#EDE9F8] dark:bg-[#3E28CD]/20' : ''
                    }`}
                    onClick={() => setSelected(lead)}
                  >
                    <span className="font-medium text-base-content">
                      #{lead.lead_number ?? '—'} · {lead.name ?? '—'}
                    </span>
                    {lead.email ? <span className="block text-xs text-base-content/55 truncate">{lead.email}</span> : null}
                    <span className="text-[10px] uppercase text-base-content/40">{lead.isLegacy ? 'Legacy' : 'New'}</span>
                  </button>
                </li>
              );
            })}
          </ul>

          {selected ? (
            <p className="text-xs text-base-content/70">
              Selected: <strong>#{selected.lead_number}</strong> {selected.name}
            </p>
          ) : null}
        </div>

        <div className="p-4 border-t border-base-300 flex gap-2 justify-end">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!selected || submitting || flagTypes.length === 0}
            onClick={() => void handleSubmit()}
          >
            {submitting ? <span className="loading loading-spinner loading-xs" /> : 'Flag to lead'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default RmqMessageFlagLeadModal;
