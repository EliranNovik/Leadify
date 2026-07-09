import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import { PlusIcon, TrashIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { supabase } from '../../lib/supabase';
import {
  buildSubEffortAdminItems,
  caseDocCategoryLabel,
  fetchSubEffortMiscCategoryLinksForAdmin,
  fetchSubEffortsForAdmin,
  fetchMiscCategoryIdsForSubEffort,
  miscCategoryDisplayLabel,
  normalizeMiscCategoryIds,
  normalizeSubEffortName,
  subEffortNameKey,
  subEffortPayload,
  syncSubEffortMiscCategoryLinksForAdmin,
  type MiscCategoryOption,
  type SubCategoryEffortRow,
  type SubEffortAdminItem,
  type SubEffortDbRow,
} from '../../lib/subEffortsAdmin';

type DraftSubCategory = {
  id?: number;
  name: string;
  description: string;
  sort_order: number;
  percentage: number;
};

type ListFilter = 'all' | 'linked' | 'unlinked';

const emptySubCategory = (sortOrder: number): DraftSubCategory => ({
  name: '',
  description: '',
  sort_order: sortOrder,
  percentage: 0,
});

const SubEffortsManager: React.FC = () => {
  const [items, setItems] = useState<SubEffortAdminItem[]>([]);
  const [subCategoriesByEffortId, setSubCategoriesByEffortId] = useState<Record<number, SubCategoryEffortRow[]>>(
    {},
  );
  const [miscCategories, setMiscCategories] = useState<MiscCategoryOption[]>([]);
  const [caseDocCategories, setCaseDocCategories] = useState<{ id: string; label: string }[]>([]);
  const [loading, setLoading] = useState(false);

  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<SubEffortAdminItem | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [draftSortOrder, setDraftSortOrder] = useState(0);
  const [draftPercentage, setDraftPercentage] = useState(0);
  const [draftActive, setDraftActive] = useState(true);
  const [draftDefaultClientVisible, setDraftDefaultClientVisible] = useState(true);
  const [draftCaseDocCategoryId, setDraftCaseDocCategoryId] = useState('');
  const [draftLinkedCategoryIds, setDraftLinkedCategoryIds] = useState<number[]>([]);
  const [draftSubCategories, setDraftSubCategories] = useState<DraftSubCategory[]>([]);
  const [categorySearch, setCategorySearch] = useState('');
  const [listFilter, setListFilter] = useState<ListFilter>('all');
  const [saving, setSaving] = useState(false);

  const title = editingItem ? 'Edit sub effort' : 'Add sub effort';

  const itemsWithSubCategoryCounts = useMemo(
    () =>
      items.map((item) => ({
        ...item,
        subCategoryCount: subCategoriesByEffortId[item.id]?.length ?? 0,
      })),
    [items, subCategoriesByEffortId],
  );

  const listStats = useMemo(() => {
    const linked = itemsWithSubCategoryCounts.filter((item) => item.linkedCategoryIds.length > 0).length;
    return {
      total: itemsWithSubCategoryCounts.length,
      linked,
      unlinked: itemsWithSubCategoryCounts.length - linked,
    };
  }, [itemsWithSubCategoryCounts]);

  const visibleItems = useMemo(() => {
    if (listFilter === 'linked') {
      return itemsWithSubCategoryCounts.filter((item) => item.linkedCategoryIds.length > 0);
    }
    if (listFilter === 'unlinked') {
      return itemsWithSubCategoryCounts.filter((item) => item.linkedCategoryIds.length === 0);
    }
    return itemsWithSubCategoryCounts;
  }, [itemsWithSubCategoryCounts, listFilter]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const effortRows = await fetchSubEffortsForAdmin(supabase);
      const hasEmbeddedLinks = effortRows.some((row) => Array.isArray(row.linked_misc_category_ids));

      let linkRows: Awaited<ReturnType<typeof fetchSubEffortMiscCategoryLinksForAdmin>> = [];
      try {
        linkRows = await fetchSubEffortMiscCategoryLinksForAdmin(supabase);
      } catch (linkError: any) {
        console.warn('Failed to load sub_effort_misc_categories:', linkError);
        if (!hasEmbeddedLinks) {
          toast.error(
            String(
              linkError?.message ||
                'Could not load case type links. Run sql/2026-07-09_sub_effort_misc_categories_junction.sql and sql/2026-07-09_admin_list_sub_efforts.sql.',
            ),
          );
        }
      }

      const [subCatRes, miscRes, caseDocRes] = await Promise.all([
        supabase
          .from('sub_category_efforts')
          .select('id, sub_effort_id, name, description, sort_order, percentage')
          .order('sort_order', { ascending: true }),
        supabase
          .from('misc_category')
          .select('id, name, parent_id, misc_maincategory!parent_id(id, name)')
          .order('name', { ascending: true }),
        supabase
          .from('case_document_classifications')
          .select('id, label')
          .eq('is_active', true)
          .order('sort_order', { ascending: true }),
      ]);

      if (miscRes.error) throw miscRes.error;
      if (caseDocRes.error) throw caseDocRes.error;

      const caseDocById = new Map(
        ((caseDocRes.data ?? []) as { id: string; label: string }[]).map((row) => [row.id, row.label]),
      );

      const rowsWithCaseDoc = effortRows.map((row) => {
        const classificationId = row.case_document_classification_id ?? null;
        const label = classificationId ? caseDocById.get(classificationId) : undefined;
        return {
          ...row,
          case_document_classification: label ? { id: classificationId!, label } : null,
        } satisfies SubEffortDbRow;
      });

      setItems(buildSubEffortAdminItems(rowsWithCaseDoc, linkRows));

      if (subCatRes.error) {
        console.warn('sub_category_efforts:', subCatRes.error);
        setSubCategoriesByEffortId({});
      } else {
        const subCatMap: Record<number, SubCategoryEffortRow[]> = {};
        for (const row of (subCatRes.data ?? []) as SubCategoryEffortRow[]) {
          const bucket = subCatMap[row.sub_effort_id] ?? [];
          bucket.push(row);
          subCatMap[row.sub_effort_id] = bucket;
        }
        setSubCategoriesByEffortId(subCatMap);
      }

      setMiscCategories(
        ((miscRes.data ?? []) as any[]).map((row) => {
          const main = Array.isArray(row.misc_maincategory)
            ? row.misc_maincategory[0]
            : row.misc_maincategory;
          return {
            id: Number(row.id),
            name: String(row.name ?? ''),
            parent_id: row.parent_id != null ? Number(row.parent_id) : null,
            mainCategoryName: main?.name ? String(main.name) : null,
          } satisfies MiscCategoryOption;
        }),
      );

      setCaseDocCategories(
        ((caseDocRes.data ?? []) as any[]).map((r) => ({ id: r.id, label: r.label })),
      );
    } catch (e: any) {
      console.error('Failed to load sub efforts admin data:', e);
      toast.error(String(e?.message || 'Failed to load sub efforts'));
      setItems([]);
      setSubCategoriesByEffortId({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const filteredMiscCategories = useMemo(() => {
    const q = categorySearch.trim().toLowerCase();
    if (!q) return miscCategories;
    return miscCategories.filter((c) => miscCategoryDisplayLabel(c).toLowerCase().includes(q));
  }, [miscCategories, categorySearch]);

  const openAdd = () => {
    setEditingItem(null);
    setDraftName('');
    setDraftDescription('');
    setDraftSortOrder(items.length);
    setDraftPercentage(0);
    setDraftActive(true);
    setDraftDefaultClientVisible(true);
    setDraftCaseDocCategoryId('');
    setDraftLinkedCategoryIds([]);
    setDraftSubCategories([emptySubCategory(0)]);
    setCategorySearch('');
    setIsDrawerOpen(true);
  };

  const openEdit = (item: SubEffortAdminItem) => {
    const subCats = subCategoriesByEffortId[item.id] ?? [];
    setEditingItem(item);
    setDraftName(item.name);
    setDraftDescription(item.description ?? '');
    setDraftSortOrder(item.sort_order);
    setDraftPercentage(item.percentage);
    setDraftActive(item.active);
    setDraftDefaultClientVisible(item.default_client_visible);
    setDraftCaseDocCategoryId(item.case_document_classification_id ?? '');
    setDraftLinkedCategoryIds(normalizeMiscCategoryIds(item.linkedCategoryIds));
    setDraftSubCategories(
      subCats.length > 0
        ? subCats.map((s) => ({
            id: s.id,
            name: s.name ?? '',
            description: s.description ?? '',
            sort_order: Number(s.sort_order ?? 0),
            percentage: Number(s.percentage ?? 0),
          }))
        : [emptySubCategory(0)],
    );
    setCategorySearch('');
    setIsDrawerOpen(true);

    void (async () => {
      try {
        const linkedIds = await fetchMiscCategoryIdsForSubEffort(supabase, item.id);
        setDraftLinkedCategoryIds(linkedIds);
      } catch (e: any) {
        console.warn('Failed to refresh case type links for drawer:', e);
        toast.error(String(e?.message || 'Could not load saved case type links for this row'));
      }
    })();
  };

  const closeDrawer = () => {
    if (saving) return;
    setIsDrawerOpen(false);
    setEditingItem(null);
  };

  const toggleLinkedCategory = (categoryId: number) => {
    const id = Number(categoryId);
    setDraftLinkedCategoryIds((prev) => {
      const normalized = normalizeMiscCategoryIds(prev);
      return normalized.includes(id)
        ? normalized.filter((value) => value !== id)
        : [...normalized, id];
    });
  };

  const selectAllFilteredCategories = () => {
    setDraftLinkedCategoryIds((prev) =>
      normalizeMiscCategoryIds([...prev, ...filteredMiscCategories.map((c) => c.id)]),
    );
  };

  const clearAllCategories = () => setDraftLinkedCategoryIds([]);

  const normalizedDraftLinkedCategoryIds = useMemo(
    () => normalizeMiscCategoryIds(draftLinkedCategoryIds),
    [draftLinkedCategoryIds],
  );

  const syncSubCategories = async (subEffortId: number, drafts: DraftSubCategory[]) => {
    const cleaned = drafts
      .map((d, index) => ({
        ...d,
        name: d.name.trim(),
        description: d.description.trim(),
        sort_order: Number.isFinite(d.sort_order) ? d.sort_order : index,
        percentage: Math.min(100, Math.max(0, Number(d.percentage) || 0)),
      }))
      .filter((d) => d.name.length > 0);

    const existing = subCategoriesByEffortId[subEffortId] ?? [];
    const existingIds = new Set(existing.map((r) => r.id));
    const keptIds = new Set(cleaned.filter((d) => d.id).map((d) => d.id!));

    for (const id of existingIds) {
      if (!keptIds.has(id)) {
        const { error } = await supabase.from('sub_category_efforts').delete().eq('id', id);
        if (error) throw error;
      }
    }

    for (const draft of cleaned) {
      const row = {
        sub_effort_id: subEffortId,
        name: draft.name,
        description: draft.description || null,
        sort_order: draft.sort_order,
        percentage: draft.percentage,
      };
      if (draft.id) {
        const { error } = await supabase.from('sub_category_efforts').update(row).eq('id', draft.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('sub_category_efforts').insert(row);
        if (error) throw error;
      }
    }
  };

  const handleSave = async () => {
    const name = normalizeSubEffortName(draftName);
    if (!name) {
      toast.error('Name is required');
      return;
    }

    const payload = subEffortPayload({
      name,
      description: draftDescription.trim() || null,
      sort_order: draftSortOrder,
      percentage: Math.min(100, Math.max(0, Number(draftPercentage) || 0)),
      active: draftActive,
      default_client_visible: draftDefaultClientVisible,
      case_document_classification_id: draftCaseDocCategoryId.trim() || null,
    });

    const nameKey = subEffortNameKey(name);
    if (
      editingItem &&
      nameKey !== subEffortNameKey(editingItem.name) &&
      items.some((item) => item.id !== editingItem.id && subEffortNameKey(item.name) === nameKey)
    ) {
      toast.error('Another sub effort row already uses this name');
      return;
    }

    setSaving(true);
    try {
      let subEffortId = editingItem?.id;

      if (editingItem) {
        const { error } = await supabase.from('sub_efforts').update(payload).eq('id', editingItem.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from('sub_efforts').insert(payload).select('id').single();
        if (error) throw error;
        subEffortId = Number(data.id);
      }

      if (!subEffortId) throw new Error('Missing sub effort id');

      const categoryIdsToSave = normalizeMiscCategoryIds(draftLinkedCategoryIds);
      const savedCategoryIds = await syncSubEffortMiscCategoryLinksForAdmin(
        supabase,
        subEffortId,
        categoryIdsToSave,
      );
      await supabase
        .from('sub_efforts')
        .update({ misc_category_id: null })
        .eq('id', subEffortId)
        .then(({ error }) => {
          if (error && !String(error.message).includes('misc_category_id')) {
            throw error;
          }
        });

      let subCategoryError: string | null = null;
      try {
        await syncSubCategories(subEffortId, draftSubCategories);
      } catch (subCatErr: any) {
        subCategoryError = String(subCatErr?.message || 'Failed to save sub-category efforts');
        console.error('Sub-category save failed:', subCatErr);
      }

      setItems((prev) =>
        prev.map((item) =>
          Number(item.id) === Number(subEffortId)
            ? {
                ...item,
                name: payload.name,
                description: payload.description,
                sort_order: payload.sort_order,
                percentage: Number(payload.percentage),
                active: payload.active,
                default_client_visible: payload.default_client_visible,
                case_document_classification_id: payload.case_document_classification_id,
                linkedCategoryIds: savedCategoryIds,
              }
            : item,
        ),
      );

      toast.success(
        editingItem
          ? `Sub effort updated (${savedCategoryIds.length} case type${savedCategoryIds.length === 1 ? '' : 's'} linked)`
          : `Sub effort added (${savedCategoryIds.length} case type${savedCategoryIds.length === 1 ? '' : 's'} linked)`,
      );
      if (subCategoryError) {
        toast.error(`Case types were saved, but sub-category steps failed: ${subCategoryError}`);
      }
      closeDrawer();
      await fetchAll();
    } catch (e: any) {
      console.error('Failed to save sub effort:', e);
      const msg = String(e?.message || '');
      const code = String(e?.code || '');
      if (code === '23505' && msg.includes('sub_effort_misc_categories')) {
        toast.error('One or more case type links already exist for this sub effort');
      } else if (msg.toLowerCase().includes('duplicate') || msg.toLowerCase().includes('unique')) {
        toast.error('Sub effort name already exists');
      } else if (msg.toLowerCase().includes('row-level security') || msg.toLowerCase().includes('rls')) {
        toast.error('Permission denied (RLS). Apply the sub_efforts admin policies SQL.');
      } else if (msg.toLowerCase().includes('case type links')) {
        toast.error(msg);
      } else if (msg.includes('sub_effort_misc_categories')) {
        toast.error(
          'Case type link table missing. Run sql/2026-07-09_sub_effort_misc_categories_junction.sql and sql/2026-07-09_admin_list_sub_efforts.sql in Supabase.',
        );
      } else {
        toast.error(msg || 'Failed to save sub effort');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (item: SubEffortAdminItem, nextActive: boolean) => {
    setItems((prev) => prev.map((r) => (r.id === item.id ? { ...r, active: nextActive } : r)));
    try {
      const { error } = await supabase.from('sub_efforts').update({ active: nextActive }).eq('id', item.id);
      if (error) throw error;
      toast.success(nextActive ? 'Enabled' : 'Disabled');
    } catch (e: any) {
      toast.error(String(e?.message || 'Failed to update'));
      await fetchAll();
    }
  };

  return (
    <div className="w-full">
      <div className="glass-card border border-white/60 px-5 py-4 mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Sub efforts</h2>
          <p className="text-sm text-gray-500 mt-1">
            Loaded {listStats.total} sub efforts ({listStats.unlinked} without case types, {listStats.linked}{' '}
            with links).
          </p>
        </div>
        <button type="button" className="btn btn-primary btn-sm gap-2" onClick={openAdd}>
          <PlusIcon className="w-4 h-4" />
          Add
        </button>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <button
          type="button"
          className={`btn btn-sm ${listFilter === 'all' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setListFilter('all')}
        >
          All ({listStats.total})
        </button>
        <button
          type="button"
          className={`btn btn-sm ${listFilter === 'unlinked' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setListFilter('unlinked')}
        >
          No case type ({listStats.unlinked})
        </button>
        <button
          type="button"
          className={`btn btn-sm ${listFilter === 'linked' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setListFilter('linked')}
        >
          Has case type ({listStats.linked})
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <span className="loading loading-spinner loading-lg text-gray-400" />
        </div>
      ) : visibleItems.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white/60 py-16 text-center text-sm text-gray-500">
          {listFilter === 'all' ? 'No sub efforts found' : 'No sub efforts match this filter'}
        </div>
      ) : (
        <div className="overflow-x-auto w-full py-2">
          <table className="table w-full text-sm [&_tbody_td]:py-5 [&_tbody_td]:align-middle">
            <thead>
              <tr>
                <th className="text-left font-medium text-gray-500">ID</th>
                <th className="text-left font-medium text-gray-500">Order</th>
                <th className="text-left font-medium text-gray-500">Name</th>
                <th className="text-left font-medium text-gray-500 min-w-[12rem]">Description</th>
                <th className="text-left font-medium text-gray-500">%</th>
                <th className="text-left font-medium text-gray-500">Case types</th>
                <th className="text-left font-medium text-gray-500">Sub-categories</th>
                <th className="text-left font-medium text-gray-500">Docs category</th>
                <th className="text-left font-medium text-gray-500">Active</th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.map((item) => (
                <tr
                  key={item.id}
                  className="cursor-pointer"
                  onClick={() => openEdit(item)}
                  title="Click to edit"
                >
                  <td className="text-gray-400 text-xs tabular-nums">#{item.id}</td>
                  <td className="text-gray-600 tabular-nums">{item.sort_order}</td>
                  <td>
                    <div className="font-semibold text-gray-900">{item.name}</div>
                  </td>
                  <td className="text-gray-500 text-xs max-w-xs">
                    {item.description ? (
                      <span className="line-clamp-2 break-words [overflow-wrap:anywhere]" title={item.description}>
                        {item.description}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="text-gray-600 tabular-nums">{item.percentage}%</td>
                  <td>
                    <span
                      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
                        item.linkedCategoryIds.length > 0
                          ? 'bg-indigo-50 text-indigo-700'
                          : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {item.linkedCategoryIds.length} / {miscCategories.length}
                    </span>
                  </td>
                  <td className="text-gray-600 text-sm tabular-nums">{item.subCategoryCount}</td>
                  <td className="text-gray-500 text-xs">{caseDocCategoryLabel(item) || '—'}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-3">
                      <span
                        className={`badge badge-lg border-none px-4 py-3 text-sm font-medium ${
                          item.active ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-400'
                        }`}
                      >
                        {item.active ? 'Active' : 'Inactive'}
                      </span>
                      <input
                        type="checkbox"
                        className="toggle toggle-sm toggle-success"
                        checked={item.active}
                        onChange={(e) => void handleToggleActive(item, e.target.checked)}
                        aria-label="Toggle active"
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isDrawerOpen && (
        <div className="fixed inset-0 z-[1000]" role="dialog" aria-modal="true" aria-label={title}>
          <div className="absolute inset-0 bg-black/40" onClick={closeDrawer} />

          <div className="absolute right-0 top-0 flex h-full w-full max-w-[640px] flex-col bg-base-100 shadow-2xl border-l border-base-200">
            <div className="flex shrink-0 items-center justify-between border-b border-base-200 px-5 py-4">
              <div>
                <div className="text-lg font-semibold text-gray-900">{title}</div>
                <div className="mt-0.5 text-xs text-gray-500">Template + case type links + sub-categories</div>
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

            <div className="min-h-0 flex-1 overflow-y-auto p-5 space-y-6">
              <section className="space-y-4">
                <h3 className="text-sm font-semibold text-gray-900">Sub effort</h3>
                <label className="form-control w-full">
                  <div className="label py-0">
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

                <label className="form-control w-full">
                  <div className="label py-0">
                    <span className="label-text">Description</span>
                  </div>
                  <textarea
                    className="textarea textarea-bordered w-full min-h-[88px]"
                    value={draftDescription}
                    onChange={(e) => setDraftDescription(e.target.value)}
                    placeholder="Optional longer explanation for handlers"
                    rows={3}
                  />
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <label className="form-control w-full">
                    <div className="label py-0">
                      <span className="label-text">Order</span>
                    </div>
                    <input
                      type="number"
                      className="input input-bordered w-full"
                      value={draftSortOrder}
                      onChange={(e) => setDraftSortOrder(Number(e.target.value) || 0)}
                    />
                  </label>
                  <label className="form-control w-full">
                    <div className="label py-0">
                      <span className="label-text">Percentage</span>
                    </div>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={0.01}
                      className="input input-bordered w-full"
                      value={draftPercentage}
                      onChange={(e) => setDraftPercentage(Number(e.target.value) || 0)}
                    />
                  </label>
                </div>

                <label className="form-control w-full">
                  <div className="label py-0">
                    <span className="label-text">Case documents category</span>
                  </div>
                  <select
                    className="select select-bordered w-full"
                    value={draftCaseDocCategoryId}
                    onChange={(e) => setDraftCaseDocCategoryId(e.target.value)}
                  >
                    <option value="">No category</option>
                    {caseDocCategories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="flex items-center justify-between rounded-xl border border-base-200 px-4 py-3">
                  <div>
                    <div className="text-sm font-medium text-gray-900">Default client visibility</div>
                    <div className="text-xs text-gray-500">
                      New lead sub efforts start visible to the client when enabled
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    className="toggle toggle-primary"
                    checked={draftDefaultClientVisible}
                    onChange={(e) => setDraftDefaultClientVisible(e.target.checked)}
                    aria-label="Default client visibility"
                  />
                </div>

                <div className="flex items-center justify-between rounded-xl border border-base-200 px-4 py-3">
                  <div>
                    <div className="text-sm font-medium text-gray-900">Active</div>
                    <div className="text-xs text-gray-500">Shown in workflow dropdown when enabled</div>
                  </div>
                  <input
                    type="checkbox"
                    className="toggle toggle-success"
                    checked={draftActive}
                    onChange={(e) => setDraftActive(e.target.checked)}
                    aria-label="Active"
                  />
                </div>
              </section>

              <section className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">Case types (misc categories)</h3>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {normalizedDraftLinkedCategoryIds.length} of {miscCategories.length} linked
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      onClick={selectAllFilteredCategories}
                    >
                      Select shown
                    </button>
                    <button type="button" className="btn btn-ghost btn-xs" onClick={clearAllCategories}>
                      Clear all
                    </button>
                  </div>
                </div>
                <input
                  type="search"
                  className="input input-bordered input-sm w-full"
                  placeholder="Search case types…"
                  value={categorySearch}
                  onChange={(e) => setCategorySearch(e.target.value)}
                />
                <div className="max-h-52 overflow-y-auto rounded-xl border border-base-200 divide-y divide-base-200">
                  {filteredMiscCategories.length === 0 ? (
                    <div className="px-3 py-4 text-sm text-gray-500">No case types match your search</div>
                  ) : (
                    filteredMiscCategories.map((cat) => (
                      <label
                        key={cat.id}
                        className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-base-200/50"
                      >
                        <input
                          type="checkbox"
                          className="checkbox checkbox-sm checkbox-primary"
                          checked={normalizedDraftLinkedCategoryIds.includes(Number(cat.id))}
                          onChange={() => toggleLinkedCategory(cat.id)}
                        />
                        <span className="text-sm text-gray-800">{miscCategoryDisplayLabel(cat)}</span>
                      </label>
                    ))
                  )}
                </div>
              </section>

              <section className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">Sub-category efforts</h3>
                    <p className="text-xs text-gray-500 mt-0.5">Breakdown steps under this sub effort</p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs gap-1"
                    onClick={() =>
                      setDraftSubCategories((prev) => [...prev, emptySubCategory(prev.length)])
                    }
                  >
                    <PlusIcon className="w-4 h-4" />
                    Add row
                  </button>
                </div>

                <div className="space-y-3">
                  {draftSubCategories.map((row, index) => (
                    <div
                      key={row.id ?? `new-${index}`}
                      className="space-y-2 rounded-xl border border-base-200 p-3"
                    >
                      <input
                        type="text"
                        className="input input-bordered input-sm w-full"
                        placeholder="Name"
                        value={row.name}
                        onChange={(e) =>
                          setDraftSubCategories((prev) =>
                            prev.map((r, i) => (i === index ? { ...r, name: e.target.value } : r)),
                          )
                        }
                      />
                      <textarea
                        className="textarea textarea-bordered textarea-sm w-full min-h-[72px]"
                        placeholder="Description (optional longer text)"
                        value={row.description}
                        onChange={(e) =>
                          setDraftSubCategories((prev) =>
                            prev.map((r, i) => (i === index ? { ...r, description: e.target.value } : r)),
                          )
                        }
                      />
                      <div className="grid grid-cols-[1fr_1fr_auto] gap-3 items-end">
                        <label className="form-control w-full">
                          <div className="label py-0">
                            <span className="label-text text-xs">Step order</span>
                          </div>
                          <input
                            type="number"
                            className="input input-bordered input-sm w-full"
                            placeholder="0 = first"
                            value={row.sort_order}
                            onChange={(e) =>
                              setDraftSubCategories((prev) =>
                                prev.map((r, i) =>
                                  i === index ? { ...r, sort_order: Number(e.target.value) || 0 } : r,
                                ),
                              )
                            }
                          />
                        </label>
                        <label className="form-control w-full">
                          <div className="label py-0">
                            <span className="label-text text-xs">Weight %</span>
                          </div>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step={0.01}
                            className="input input-bordered input-sm w-full"
                            placeholder="0–100"
                            value={row.percentage}
                            onChange={(e) =>
                              setDraftSubCategories((prev) =>
                                prev.map((r, i) =>
                                  i === index ? { ...r, percentage: Number(e.target.value) || 0 } : r,
                                ),
                              )
                            }
                          />
                        </label>
                        <button
                          type="button"
                          className="btn btn-ghost btn-square btn-sm text-error"
                          onClick={() =>
                            setDraftSubCategories((prev) =>
                              prev.length <= 1 ? [emptySubCategory(0)] : prev.filter((_, i) => i !== index),
                            )
                          }
                          aria-label="Remove sub-category row"
                        >
                          <TrashIcon className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-base-200 px-5 py-4">
              <button type="button" className="btn btn-ghost" onClick={closeDrawer} disabled={saving}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void handleSave()} disabled={saving}>
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
