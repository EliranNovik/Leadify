import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { PlusIcon, XMarkIcon } from '@heroicons/react/24/outline';

type SubEffortRow = {
  id: number;
  name: string;
  active?: boolean | null;
  case_document_classification_id?: string | null;
  // Supabase nested selects can return object OR array depending on relationship cardinality.
  case_document_classification?: { id: string; label: string } | { id: string; label: string }[] | null;
  created_at?: string | null;
  updated_at?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
};

function categoryLabelFromRow(row: SubEffortRow): string | null {
  const v = row.case_document_classification;
  if (!v) return null;
  if (Array.isArray(v)) return v[0]?.label?.trim() || null;
  return v.label?.trim() || null;
}

const normalizeName = (value: string) => value.trim().replace(/\s+/g, ' ');

const SubEffortsManager: React.FC = () => {
  const [rows, setRows] = useState<SubEffortRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [caseDocCategories, setCaseDocCategories] = useState<{ id: string; label: string }[]>([]);

  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<SubEffortRow | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftCategoryId, setDraftCategoryId] = useState<string>('');
  const [saving, setSaving] = useState(false);

  const title = useMemo(() => (editingRow ? 'Edit sub effort' : 'Add sub effort'), [editingRow]);

  const fetchRows = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('sub_efforts')
        .select(
          'id, name, active, case_document_classification_id, created_at, created_by, updated_at, updated_by, case_document_classification:case_document_classifications(id, label)',
        )
        .order('name', { ascending: true });
      if (error) throw error;
      setRows(((data || []) as unknown) as SubEffortRow[]);
    } catch (e: any) {
      console.error('Failed to fetch sub_efforts:', e);
      toast.error(String(e?.message || 'Failed to load sub efforts'));
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchRows();
  }, []);

  useEffect(() => {
    void (async () => {
      const { data, error } = await supabase
        .from('case_document_classifications')
        .select('id, label')
        .eq('is_active', true)
        .order('sort_order', { ascending: true });
      if (error) {
        console.error('case_document_classifications:', error);
        setCaseDocCategories([]);
        return;
      }
      setCaseDocCategories(((data as any[]) || []).map((r) => ({ id: r.id, label: r.label })));
    })();
  }, []);

  const openAdd = () => {
    setEditingRow(null);
    setDraftName('');
    setDraftCategoryId('');
    // default new rows to active
    setIsDrawerOpen(true);
  };

  const openEdit = (row: SubEffortRow) => {
    setEditingRow(row);
    setDraftName(row.name || '');
    setDraftCategoryId(row.case_document_classification_id || '');
    setIsDrawerOpen(true);
  };

  const closeDrawer = () => {
    if (saving) return;
    setIsDrawerOpen(false);
    setEditingRow(null);
    setDraftName('');
    setDraftCategoryId('');
  };

  const draftActive = useMemo(() => {
    if (editingRow) return (editingRow.active ?? true) === true;
    return true;
  }, [editingRow]);

  const handleSave = async () => {
    const name = normalizeName(draftName);
    if (!name) {
      toast.error('Name is required');
      return;
    }

    const case_document_classification_id = draftCategoryId.trim() || null;
    setSaving(true);
    try {
      if (editingRow) {
        const { error } = await supabase
          .from('sub_efforts')
          .update({ name, active: draftActive, case_document_classification_id })
          .eq('id', editingRow.id)
          .select('id')
          .maybeSingle();
        if (error) throw error;
        toast.success('Sub effort updated');
      } else {
        const { error } = await supabase
          .from('sub_efforts')
          .insert({ name, active: draftActive, case_document_classification_id })
          .select('id')
          .maybeSingle();
        if (error) throw error;
        toast.success('Sub effort added');
      }
      closeDrawer();
      await fetchRows();
    } catch (e: any) {
      console.error('Failed to save sub effort:', e);
      const msg = String(e?.message || '');
      if (msg.toLowerCase().includes('duplicate') || msg.toLowerCase().includes('unique')) {
        toast.error('Sub effort name already exists');
      } else if (msg.toLowerCase().includes('row-level security') || msg.toLowerCase().includes('rls')) {
        toast.error('Permission denied (RLS). Apply the sub_efforts admin policies SQL.');
      } else {
        toast.error(msg || 'Failed to save sub effort');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (row: SubEffortRow, nextActive: boolean) => {
    // prevent drawer open when toggling
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, active: nextActive } : r)));
    try {
      const { error } = await supabase
        .from('sub_efforts')
        .update({ active: nextActive })
        .eq('id', row.id)
        .select('id')
        .maybeSingle();
      if (error) throw error;
      toast.success(nextActive ? 'Enabled' : 'Disabled');
    } catch (e: any) {
      console.error('Failed to toggle sub effort active:', e);
      toast.error(String(e?.message || 'Failed to update'));
      // rollback
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, active: row.active ?? true } : r)));
    }
  };

  return (
    <div className="w-full">
      <div className="glass-card border border-white/60 px-5 py-4 mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Sub efforts</h2>
          
        </div>
        <button type="button" className="btn btn-primary btn-sm gap-2" onClick={openAdd}>
          <PlusIcon className="w-4 h-4" />
          Add
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-3">
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <span className="loading loading-spinner loading-md text-gray-400" />
          </div>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center text-sm text-gray-500">No sub efforts found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table w-full">
              <thead>
                <tr>
                  <th className="text-gray-500">Name</th>
                  <th className="text-gray-500">Case documents category</th>
                  <th className="text-gray-500">Active</th>
                  <th className="text-gray-500">Updated</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className="cursor-pointer"
                    onClick={() => openEdit(r)}
                    title="Click to edit"
                  >
                    <td className="font-medium text-gray-900">{r.name}</td>
                    <td className="text-gray-500 text-xs">
                      {categoryLabelFromRow(r) || '—'}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="toggle toggle-sm toggle-success"
                        checked={(r.active ?? true) === true}
                        onChange={(e) => handleToggleActive(r, e.target.checked)}
                        aria-label="Toggle active"
                      />
                    </td>
                    <td className="text-gray-500 text-xs tabular-nums whitespace-nowrap">
                      {r.updated_at ? new Date(r.updated_at).toLocaleString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {isDrawerOpen && (
        <div className="fixed inset-0 z-[1000]" role="dialog" aria-modal="true" aria-label={title}>
          <div className="absolute inset-0 bg-black/40" onClick={closeDrawer} />

          <div className="absolute right-0 top-0 h-full w-full max-w-[560px] bg-base-100 shadow-2xl border-l border-base-200 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-base-200">
              <div>
                <div className="text-lg font-semibold text-gray-900">{title}</div>
                <div className="text-xs text-gray-500 mt-0.5">Saved into `sub_efforts`</div>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-circle btn-sm"
                onClick={closeDrawer}
                aria-label="Close"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5">
              <label className="form-control w-full">
                <div className="label">
                  <span className="label-text">Name</span>
                </div>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  placeholder="e.g. Application submitted"
                  autoFocus
                />
              </label>

              <label className="form-control w-full mt-4">
                <div className="label">
                  <span className="label-text">Case documents category</span>
                </div>
                <select
                  className="select select-bordered w-full"
                  value={draftCategoryId}
                  onChange={(e) => setDraftCategoryId(e.target.value)}
                >
                  <option value="">No category (won’t show in Case Documents tabs)</option>
                  {caseDocCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="mt-5 flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-gray-900">Active</div>
                  <div className="text-xs text-gray-500 mt-0.5">Controls whether it shows in the dropdown</div>
                </div>
                <input
                  type="checkbox"
                  className="toggle toggle-success"
                  checked={draftActive}
                  onChange={(e) => {
                    const next = e.target.checked;
                    setEditingRow((prev) => (prev ? { ...prev, active: next } : { id: -1, name: draftName, active: next }));
                  }}
                  aria-label="Active"
                />
              </div>
            </div>

            <div className="px-5 pb-5 flex items-center justify-end gap-2">
              <button type="button" className="btn btn-ghost" onClick={closeDrawer} disabled={saving}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? <span className="loading loading-spinner loading-sm" /> : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SubEffortsManager;

