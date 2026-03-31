import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { TagIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';

type LeadTagsModalProps = {
  isOpen: boolean;
  onClose: () => void;
  leadId: string | number;
  /** Legacy leads use numeric lead_id; new leads use uuid newlead_id. */
  isLegacyLead: boolean;
  /** Optional initial tags from parent join (string, array, etc.). */
  initialTags?: unknown;
  readOnly?: boolean;
  onSaved?: (nextTags: string[]) => void | Promise<void>;
};

type LeadTagRow = { id: number; name: string; order?: number | null };
type LeadTagJoinRow = { misc_leadtag?: { name?: string | null } | { name?: string | null }[] | null };

const normalizeTagsValue = (value: unknown): string[] => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((v) => String(v || '').trim()).filter(Boolean);
  }
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
};

export default function LeadTagsModal({
  isOpen,
  onClose,
  leadId,
  isLegacyLead,
  initialTags,
  readOnly = false,
  onSaved,
}: LeadTagsModalProps) {
  const [allTags, setAllTags] = useState<LeadTagRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>(() => normalizeTagsValue(initialTags));

  const fetchCurrentLeadTags = async (): Promise<string[]> => {
    try {
      if (isLegacyLead) {
        const legacyId =
          typeof leadId === 'string' ? parseInt(String(leadId).replace(/^legacy_/, ''), 10) : Number(leadId);
        if (!legacyId || Number.isNaN(legacyId)) return [];
        const { data, error } = await supabase
          .from('leads_lead_tags')
          .select('misc_leadtag(name)')
          .eq('lead_id', legacyId);
        if (error) throw error;
        const rows = (data || []) as LeadTagJoinRow[];
        return rows
          .map((r) => {
            const rel = r.misc_leadtag as any;
            if (Array.isArray(rel)) return rel[0]?.name ?? null;
            return rel?.name ?? null;
          })
          .filter(Boolean) as string[];
      }

      const newId = String(leadId);
      // Different environments use either `newlead_id` or `new_lead_id`. Try both.
      const tryCols = ['newlead_id', 'new_lead_id'] as const;
      for (const col of tryCols) {
        const { data, error } = await supabase.from('leads_lead_tags').select('misc_leadtag(name)').eq(col, newId);
        if (!error) {
          const rows = (data || []) as LeadTagJoinRow[];
          return rows
            .map((r) => {
              const rel = r.misc_leadtag as any;
              if (Array.isArray(rel)) return rel[0]?.name ?? null;
              return rel?.name ?? null;
            })
            .filter(Boolean) as string[];
        }
      }
      return [];
    } catch {
      return [];
    }
  };

  // Reset modal state when opened / lead changes. Prefer live junction-table fetch (old InfoTab behavior).
  useEffect(() => {
    if (!isOpen) return;
    setSearch('');
    let cancelled = false;
    void (async () => {
      const fromDb = await fetchCurrentLeadTags();
      if (cancelled) return;
      if (fromDb.length > 0) setSelected(fromDb);
      else setSelected(normalizeTagsValue(initialTags));
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, leadId, initialTags]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const { data, error } = await supabase
          .from('misc_leadtag')
          .select('id, name, order')
          .eq('active', true)
          .order('order', { ascending: true });
        if (!cancelled) {
          if (error) throw error;
          setAllTags((data || []) as LeadTagRow[]);
        }
      } catch {
        if (!cancelled) setAllTags([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const visibleTags = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return allTags;
    return allTags.filter((t) => String(t.name || '').toLowerCase().includes(term));
  }, [allTags, search]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const toggle = (tagName: string) => {
    setSelected((prev) => (prev.includes(tagName) ? prev.filter((t) => t !== tagName) : [...prev, tagName]));
  };

  const save = async () => {
    if (readOnly) return;
    const normalized = Array.from(new Set(selected.map((t) => t.trim()).filter(Boolean)));
    setSaving(true);
    try {
      const tagIds = normalized
        .map((name) => allTags.find((t) => t.name === name)?.id)
        .filter((id): id is number => typeof id === 'number');

      if (isLegacyLead) {
        const legacyId = typeof leadId === 'string' ? parseInt(String(leadId).replace(/^legacy_/, ''), 10) : Number(leadId);
        if (!legacyId || Number.isNaN(legacyId)) throw new Error('Invalid legacy lead id');
        const { error: delErr } = await supabase.from('leads_lead_tags').delete().eq('lead_id', legacyId);
        if (delErr) throw delErr;
        if (tagIds.length > 0) {
          const { error: insErr } = await supabase
            .from('leads_lead_tags')
            .insert(tagIds.map((id) => ({ lead_id: legacyId, leadtag_id: id })));
          if (insErr) throw insErr;
        }
      } else {
        const newId = String(leadId);
        // Different environments use either `newlead_id` or `new_lead_id`. Try both.
        let deleted = false;
        for (const col of ['newlead_id', 'new_lead_id'] as const) {
          const { error: delErr } = await supabase.from('leads_lead_tags').delete().eq(col, newId);
          if (!delErr) {
            deleted = true;
            break;
          }
        }
        if (!deleted) throw new Error('Failed to delete existing tag rows');
        if (tagIds.length > 0) {
          let inserted = false;
          for (const col of ['newlead_id', 'new_lead_id'] as const) {
            const payload = tagIds.map((id) => ({ [col]: newId, leadtag_id: id })) as any[];
            const { error: insErr } = await supabase.from('leads_lead_tags').insert(payload);
            if (!insErr) {
              inserted = true;
              break;
            }
          }
          if (!inserted) throw new Error('Failed to insert tag rows');
        }
      }

      setSelected(normalized);
      // Re-fetch from DB to ensure UI matches junction table (and to confirm persistence).
      const next = await fetchCurrentLeadTags();
      const finalNext = next.length > 0 || normalized.length === 0 ? next : normalized;
      setSelected(finalNext);
      await onSaved?.(finalNext);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <div
        className="relative z-[1001] flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl border border-base-300 bg-base-100 shadow-2xl dark:border-gray-600 dark:bg-gray-900"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lead-tags-modal-title"
      >
        <div className="flex items-center justify-between gap-3 border-b border-base-300 px-4 py-3 sm:px-5 sm:py-4 dark:border-gray-600">
          <div className="flex min-w-0 items-center gap-2">
            <TagIcon className="h-6 w-6 shrink-0 text-purple-600" />
            <h2 id="lead-tags-modal-title" className="truncate text-lg font-semibold">
              Tags
            </h2>
          </div>
          <button type="button" className="btn btn-circle btn-ghost btn-sm" onClick={onClose} aria-label="Close">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="space-y-3">
            {selected.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {selected.map((name) => (
                  <span
                    key={name}
                    className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-sm font-medium text-primary"
                  >
                    {name}
                    {!readOnly && (
                      <button
                        type="button"
                        className="ml-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full text-base-content/50 hover:bg-base-200 hover:text-base-content dark:hover:bg-gray-800"
                        onClick={() => toggle(name)}
                        aria-label={`Remove tag ${name}`}
                        title="Remove"
                      >
                        <XMarkIcon className="h-4 w-4" />
                      </button>
                    )}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-base-content/70">No tags yet.</p>
            )}

            {!readOnly && (
              <>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  placeholder="Search tags…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <div className="max-h-56 overflow-y-auto rounded-xl border border-base-300 bg-base-100 p-2 dark:border-gray-700 dark:bg-gray-900">
                  {loading ? (
                    <div className="flex items-center gap-2 px-2 py-2 text-sm text-base-content/60">
                      <span className="loading loading-spinner loading-sm" />
                      Loading tags…
                    </div>
                  ) : visibleTags.length === 0 ? (
                    <div className="px-2 py-2 text-sm text-base-content/60">No tags found</div>
                  ) : (
                    <div className="space-y-1">
                      {visibleTags.map((t) => {
                        const checked = selectedSet.has(t.name);
                        return (
                          <label
                            key={t.id}
                            className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-base-200 dark:hover:bg-gray-800 ${
                              checked ? 'opacity-70' : ''
                            }`}
                          >
                            <input
                              type="checkbox"
                              className="checkbox checkbox-sm checkbox-primary"
                              checked={checked}
                              onChange={() => toggle(t.name)}
                            />
                            <span className="text-sm">{t.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {!readOnly && (
          <div className="flex items-center justify-end gap-2 border-t border-base-300 px-4 py-3 dark:border-gray-600">
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void save()} disabled={saving}>
              {saving ? <span className="loading loading-spinner loading-sm" /> : 'Save'}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

