import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import {
  PlusIcon,
  ArrowLeftIcon,
  DocumentTextIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import {
  listPoaTemplates,
  createPoaTemplate,
  updatePoaTemplate,
  fetchPoaCategories,
  fetchPoaLanguages,
  type PoaTemplateRow,
  type PoaLookupOption,
  type PoaLanguageOption,
} from '../../lib/poaTemplatesApi';
import {
  POA_FIELD_CATALOG,
  POA_FIELD_TYPE_LABELS,
  poaToken,
  extractPoaBodyKeys,
  type PoaTemplateField,
  type PoaFieldType,
  type PoaPrefillSource,
} from '../../lib/poaTemplateFields';

const RTL_ISO = new Set(['he', 'ar', 'fa', 'ur']);

const FONT_FAMILIES = [
  'Arial',
  'Helvetica',
  'Georgia',
  'Times New Roman',
  'Courier New',
  'Verdana',
  'Tahoma',
  'Trebuchet MS',
];
const FONT_SIZES = ['12px', '13px', '14px', '15px', '16px', '18px', '20px', '24px'];
const DEFAULT_FONT_FAMILY = 'Arial';
const DEFAULT_FONT_SIZE = '15px';

const PREFILL_OPTIONS: { value: PoaPrefillSource; label: string }[] = [
  { value: '', label: 'No prefill (signer fills in)' },
  { value: 'name', label: 'Contact name' },
  { value: 'id_passport', label: 'Contact ID / passport' },
  { value: 'address', label: 'Contact address' },
  { value: 'email', label: 'Contact email' },
  { value: 'phone', label: 'Contact phone' },
];

const FIELD_TYPE_OPTIONS = Object.keys(POA_FIELD_TYPE_LABELS) as PoaFieldType[];

interface FormState {
  id: string | null;
  name: string;
  description: string;
  category_id: number | null;
  language_id: string | null;
  direction: 'ltr' | 'rtl';
  body: string;
  fields: PoaTemplateField[];
  font_family: string;
  font_size: string;
  is_active: boolean;
  sort_order: number;
}

const emptyForm: FormState = {
  id: null,
  name: '',
  description: '',
  category_id: null,
  language_id: null,
  direction: 'ltr',
  body: '',
  fields: [],
  font_family: DEFAULT_FONT_FAMILY,
  font_size: DEFAULT_FONT_SIZE,
  is_active: true,
  sort_order: 0,
};

const PoaTemplatesManager: React.FC = () => {
  const [templates, setTemplates] = useState<PoaTemplateRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [categories, setCategories] = useState<PoaLookupOption[]>([]);
  const [languages, setLanguages] = useState<PoaLanguageOption[]>([]);

  const [mode, setMode] = useState<'list' | 'edit'>('list');
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);

  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listPoaTemplates();
      setTemplates(rows);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    void fetchPoaCategories().then(setCategories).catch(() => undefined);
    void fetchPoaLanguages().then(setLanguages).catch(() => undefined);
  }, [reload]);

  const categoryName = useCallback(
    (id: number | null) => categories.find((c) => c.id === id)?.name || '—',
    [categories],
  );
  const languageName = useCallback(
    (id: string | null) => languages.find((l) => l.id === id)?.name || '—',
    [languages],
  );

  const startNew = () => {
    setForm(emptyForm);
    setMode('edit');
  };

  const startEdit = (row: PoaTemplateRow) => {
    setForm({
      id: row.id,
      name: row.name,
      description: row.description || '',
      category_id: row.category_id,
      language_id: row.language_id,
      direction: (row.direction === 'rtl' ? 'rtl' : 'ltr'),
      body: row.body || '',
      fields: Array.isArray(row.fields) ? row.fields : [],
      font_family: row.font_family || DEFAULT_FONT_FAMILY,
      font_size: row.font_size || DEFAULT_FONT_SIZE,
      is_active: row.is_active,
      sort_order: row.sort_order || 0,
    });
    setMode('edit');
  };

  const toggleActive = async (row: PoaTemplateRow, next: boolean) => {
    setTemplates((prev) => prev.map((t) => (t.id === row.id ? { ...t, is_active: next } : t)));
    try {
      await updatePoaTemplate(row.id, { is_active: next });
    } catch (err) {
      setTemplates((prev) => prev.map((t) => (t.id === row.id ? { ...t, is_active: !next } : t)));
      toast.error(err instanceof Error ? err.message : 'Could not update status');
    }
  };

  // --- Edit form helpers -----------------------------------------------------

  const insertToken = useCallback((key: string) => {
    const token = poaToken(key);
    const el = bodyRef.current;
    setForm((prev) => {
      const body = prev.body;
      let next: string;
      if (el && typeof el.selectionStart === 'number') {
        const start = el.selectionStart;
        const end = el.selectionEnd ?? start;
        next = body.slice(0, start) + token + body.slice(end);
        // restore caret after the inserted token on next tick
        requestAnimationFrame(() => {
          el.focus();
          const pos = start + token.length;
          el.setSelectionRange(pos, pos);
        });
      } else {
        next = body + (body && !body.endsWith('\n') ? ' ' : '') + token;
      }
      return { ...prev, body: next };
    });
  }, []);

  const addCatalogField = useCallback(
    (catalogKey: string) => {
      const item = POA_FIELD_CATALOG.find((c) => c.key === catalogKey);
      if (!item) return;
      setForm((prev) => {
        const exists = prev.fields.some((f) => f.key === item.key);
        const fields = exists
          ? prev.fields
          : [
              ...prev.fields,
              {
                key: item.key,
                label: item.label,
                type: item.type,
                required: item.type === 'signature',
                prefill: item.prefill,
              } as PoaTemplateField,
            ];
        return { ...prev, fields };
      });
      insertToken(item.key);
    },
    [insertToken],
  );

  const updateField = (key: string, patch: Partial<PoaTemplateField>) => {
    setForm((prev) => ({
      ...prev,
      fields: prev.fields.map((f) => (f.key === key ? { ...f, ...patch } : f)),
    }));
  };

  const removeField = (key: string) => {
    setForm((prev) => ({ ...prev, fields: prev.fields.filter((f) => f.key !== key) }));
  };

  const onLanguageChange = (idStr: string) => {
    const id = idStr || null;
    const lang = languages.find((l) => l.id === id);
    const dir = lang && RTL_ISO.has((lang.iso_code || '').toLowerCase()) ? 'rtl' : 'ltr';
    setForm((prev) => ({ ...prev, language_id: id, direction: dir }));
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error('Please enter a template name');
      return;
    }
    // Ensure every {{token}} in the body has a field definition.
    const bodyKeys = extractPoaBodyKeys(form.body);
    const fieldsByKey = new Map(form.fields.map((f) => [f.key, f]));
    for (const key of bodyKeys) {
      if (!fieldsByKey.has(key)) {
        const item = POA_FIELD_CATALOG.find((c) => c.key === key);
        fieldsByKey.set(key, {
          key,
          label: item?.label || key,
          type: item?.type || 'text',
          required: item?.type === 'signature',
          prefill: item?.prefill || '',
        });
      }
    }
    const fields = Array.from(fieldsByKey.values());

    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      category_id: form.category_id,
      language_id: form.language_id,
      direction: form.direction,
      body: form.body,
      fields,
      font_family: form.font_family,
      font_size: form.font_size,
      is_active: form.is_active,
      sort_order: form.sort_order,
    };

    setSaving(true);
    try {
      if (form.id) {
        await updatePoaTemplate(form.id, payload);
        toast.success('Template updated');
      } else {
        await createPoaTemplate(payload);
        toast.success('Template created');
      }
      setMode('list');
      setForm(emptyForm);
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save template');
    } finally {
      setSaving(false);
    }
  };

  const usedKeys = useMemo(() => new Set(form.fields.map((f) => f.key)), [form.fields]);

  // --- Render ----------------------------------------------------------------

  if (mode === 'edit') {
    return (
      <div className="w-full">
        <div className="flex items-center justify-between mb-6">
          <button type="button" className="btn btn-ghost btn-sm gap-2" onClick={() => setMode('list')}>
            <ArrowLeftIcon className="h-4 w-4" />
            Back
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm gap-2"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? <span className="loading loading-spinner loading-xs" /> : <PlusIcon className="h-4 w-4" />}
            {form.id ? 'Save changes' : 'Create template'}
          </button>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Main column */}
          <div className="lg:col-span-2 space-y-5">
            <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              <h3 className="mb-4 flex items-center gap-2 text-base font-semibold text-gray-900">
                <DocumentTextIcon className="h-5 w-5 text-indigo-600" />
                Template details
              </h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="form-control">
                  <span className="label-text mb-1 text-sm font-medium text-gray-700">Name</span>
                  <input
                    className="input input-bordered w-full"
                    value={form.name}
                    onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                    placeholder="e.g. German citizenship POA"
                  />
                </label>
                <label className="form-control">
                  <span className="label-text mb-1 text-sm font-medium text-gray-700">Sort order</span>
                  <input
                    type="number"
                    className="input input-bordered w-full"
                    value={form.sort_order}
                    onChange={(e) => setForm((p) => ({ ...p, sort_order: Number(e.target.value) || 0 }))}
                  />
                </label>
                <label className="form-control">
                  <span className="label-text mb-1 text-sm font-medium text-gray-700">Category</span>
                  <select
                    className="select select-bordered w-full"
                    value={form.category_id ?? ''}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, category_id: e.target.value ? Number(e.target.value) : null }))
                    }
                  >
                    <option value="">— None —</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="form-control">
                  <span className="label-text mb-1 text-sm font-medium text-gray-700">Language</span>
                  <select
                    className="select select-bordered w-full"
                    value={form.language_id ?? ''}
                    onChange={(e) => onLanguageChange(e.target.value)}
                  >
                    <option value="">— None —</option>
                    {languages.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="form-control">
                  <span className="label-text mb-1 text-sm font-medium text-gray-700">Direction</span>
                  <select
                    className="select select-bordered w-full"
                    value={form.direction}
                    onChange={(e) => setForm((p) => ({ ...p, direction: e.target.value as 'ltr' | 'rtl' }))}
                  >
                    <option value="ltr">Left to right (LTR)</option>
                    <option value="rtl">Right to left (RTL)</option>
                  </select>
                </label>
                <label className="form-control flex-row items-center gap-3 pt-7">
                  <input
                    type="checkbox"
                    className="toggle toggle-success"
                    checked={form.is_active}
                    onChange={(e) => setForm((p) => ({ ...p, is_active: e.target.checked }))}
                  />
                  <span className="text-sm font-medium text-gray-700">Active</span>
                </label>
                <label className="form-control sm:col-span-2">
                  <span className="label-text mb-1 text-sm font-medium text-gray-700">Description (internal)</span>
                  <input
                    className="input input-bordered w-full"
                    value={form.description}
                    onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                    placeholder="Optional note shown to staff"
                  />
                </label>
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-base font-semibold text-gray-900">Document text</h3>
                <div className="flex items-center gap-2">
                  <select
                    className="select select-bordered select-sm w-40"
                    value={form.font_family}
                    onChange={(e) => setForm((p) => ({ ...p, font_family: e.target.value }))}
                    title="Font family"
                    style={{ fontFamily: form.font_family }}
                  >
                    {FONT_FAMILIES.map((f) => (
                      <option key={f} value={f} style={{ fontFamily: f }}>
                        {f}
                      </option>
                    ))}
                  </select>
                  <select
                    className="select select-bordered select-sm w-24"
                    value={form.font_size}
                    onChange={(e) => setForm((p) => ({ ...p, font_size: e.target.value }))}
                    title="Font size"
                  >
                    {FONT_SIZES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <textarea
                ref={bodyRef}
                className="textarea textarea-bordered min-h-[760px] w-full leading-relaxed"
                style={{ fontFamily: form.font_family, fontSize: form.font_size }}
                dir={form.direction}
                value={form.body}
                onChange={(e) => setForm((p) => ({ ...p, body: e.target.value }))}
                placeholder={'Write the POA text here.\n\nClick a field on the right to drop it into the text, e.g.\n\nI, {{contact_name}}, holder of ID/passport {{id_passport}}, hereby authorize…\n\nPlace & date: {{place_date}}\nSignature: {{signature}}'}
              />
            </div>
          </div>

          {/* Side column: field palette + configured fields */}
          <div className="space-y-5">
            <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <h3 className="mb-4 text-base font-semibold text-gray-900">Insert a field</h3>
              <div className="flex flex-wrap gap-2.5">
                {POA_FIELD_CATALOG.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => addCatalogField(item.key)}
                    className={`btn btn-sm ${usedKeys.has(item.key) ? 'btn-primary' : 'btn-outline'} gap-1.5`}
                    title={item.hint || item.label}
                  >
                    <PlusIcon className="h-4 w-4" />
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-2 shadow-sm">
                <h3 className="text-sm font-semibold text-gray-900">Fields in this template</h3>
                <span className="flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-indigo-50 px-1.5 text-xs font-bold text-indigo-600">
                  {form.fields.length}
                </span>
              </div>
              {form.fields.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-gray-300 bg-white/70 px-4 py-8 text-center text-sm text-gray-400">
                  No fields yet. Insert some from above.
                </div>
              ) : (
                <div className="space-y-3">
                  {form.fields.map((f) => (
                    <div
                      key={f.key}
                      className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
                    >
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <code className="rounded-md bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-700">
                          {poaToken(f.key)}
                        </code>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm btn-circle text-gray-400 hover:bg-red-50 hover:text-error"
                          onClick={() => removeField(f.key)}
                          title="Remove field"
                        >
                          <XMarkIcon className="h-6 w-6" />
                        </button>
                      </div>
                      <input
                        className="input input-bordered input-sm mb-3 w-full"
                        value={f.label}
                        onChange={(e) => updateField(f.key, { label: e.target.value })}
                        placeholder="Field label"
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          className="select select-bordered select-sm"
                          value={f.type}
                          onChange={(e) => updateField(f.key, { type: e.target.value as PoaFieldType })}
                        >
                          {FIELD_TYPE_OPTIONS.map((t) => (
                            <option key={t} value={t}>
                              {POA_FIELD_TYPE_LABELS[t]}
                            </option>
                          ))}
                        </select>
                        {f.type !== 'signature' && (
                          <select
                            className="select select-bordered select-sm"
                            value={f.prefill}
                            onChange={(e) => updateField(f.key, { prefill: e.target.value as PoaPrefillSource })}
                          >
                            {PREFILL_OPTIONS.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        )}
                        <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs font-medium text-gray-600">
                          Required
                          <input
                            type="checkbox"
                            className="toggle toggle-sm toggle-success"
                            checked={f.required}
                            onChange={(e) => updateField(f.key, { required: e.target.checked })}
                          />
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // List mode
  return (
    <div className="w-full">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">POA Templates</h2>
          <p className="text-sm text-gray-500">
            Compose reusable Power of Attorney documents from text and fields.
          </p>
        </div>
        <button type="button" className="btn btn-primary gap-2" onClick={startNew}>
          <PlusIcon className="h-5 w-5" />
          New template
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <span className="loading loading-spinner loading-lg text-gray-400" />
        </div>
      ) : templates.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white/60 py-16 text-center">
          <DocumentTextIcon className="mx-auto mb-3 h-10 w-10 text-gray-300" />
          <p className="text-gray-500">No POA templates yet.</p>
          <button type="button" className="btn btn-primary btn-sm mt-4 gap-2" onClick={startNew}>
            <PlusIcon className="h-4 w-4" />
            Create your first template
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm [&_tbody_td]:py-6 [&_tbody_td]:align-middle">
            <thead>
              <tr>
                <th className="text-left font-medium text-gray-500">Name</th>
                <th className="text-left font-medium text-gray-500">Category</th>
                <th className="text-left font-medium text-gray-500">Language</th>
                <th className="text-left font-medium text-gray-500">Fields</th>
                <th className="text-left font-medium text-gray-500">Status</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr
                  key={t.id}
                  onClick={() => startEdit(t)}
                  className="cursor-pointer"
                >
                  <td>
                    <div className="font-semibold text-gray-900">{t.name}</div>
                    {t.description && <div className="text-xs text-gray-400">{t.description}</div>}
                  </td>
                  <td className="text-gray-700">{categoryName(t.category_id)}</td>
                  <td className="text-gray-700">{languageName(t.language_id)}</td>
                  <td className="text-gray-700">{Array.isArray(t.fields) ? t.fields.length : 0}</td>
                  <td>
                    <div className="flex items-center gap-3">
                      <span
                        className={`badge badge-lg border-none px-4 py-3 text-sm font-medium ${
                          t.is_active ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-400'
                        }`}
                      >
                        {t.is_active ? 'Active' : 'Inactive'}
                      </span>
                      <input
                        type="checkbox"
                        className="toggle toggle-success toggle-sm"
                        checked={t.is_active}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          e.stopPropagation();
                          void toggleActive(t, e.target.checked);
                        }}
                        title={t.is_active ? 'Deactivate' : 'Activate'}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default PoaTemplatesManager;
