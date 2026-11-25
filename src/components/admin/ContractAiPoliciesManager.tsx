import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EllipsisVerticalIcon, PencilSquareIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import {
  contractAiCategoryLabel,
  type ContractAiCategory,
  type ContractAiDirective,
} from '../../lib/contractAiDirectives';

const CATEGORIES: ContractAiCategory[] = ['policy', 'rule', 'behavior'];

const CATEGORY_HELP: Record<ContractAiCategory, string> = {
  policy: '',
  rule: 'Hard limits the AI must follow while reviewing or editing a contract.',
  behavior: 'How the AI should write. Tone, numbering, and the shape of new clauses.',
};

type Draft = {
  id: string | null;
  title: string;
  line: string;
  body: string;
  is_active: boolean;
};

const emptyDraft = (): Draft => ({
  id: null,
  title: '',
  line: '',
  body: '',
  is_active: true,
});

function formatAddedWhen(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function personName(user: {
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  tenants_employee?:
    | { display_name?: string | null; official_name?: string | null }
    | { display_name?: string | null; official_name?: string | null }[]
    | null;
}): string {
  const employee = Array.isArray(user.tenants_employee) ? user.tenants_employee[0] : user.tenants_employee;
  return (
    employee?.display_name?.trim() ||
    employee?.official_name?.trim() ||
    user.full_name?.trim() ||
    [user.first_name, user.last_name].filter(Boolean).join(' ').trim() ||
    ''
  );
}

function slugFromTitle(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return base || `policy_${Date.now()}`;
}

const ContractAiPoliciesManager: React.FC = () => {
  const [category, setCategory] = useState<ContractAiCategory>('policy');
  const [rows, setRows] = useState<ContractAiDirective[]>([]);
  const [loading, setLoading] = useState(true);
  const [missingTable, setMissingTable] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [authorNames, setAuthorNames] = useState<Record<string, string>>({});
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const closeOnClickAway = (event: PointerEvent) => {
      const target = event.target;
      listRef.current?.querySelectorAll('details[open]').forEach((menu) => {
        if (target instanceof Node && menu.contains(target)) return;
        menu.removeAttribute('open');
      });
    };
    document.addEventListener('pointerdown', closeOnClickAway);
    return () => document.removeEventListener('pointerdown', closeOnClickAway);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const columns = 'id, category, title, line, body, sort_order, is_active, created_by, created_at';
    let { data, error } = await supabase
      .from('contract_ai_directives')
      .select(columns)
      .order('sort_order', { ascending: true })
      .order('title', { ascending: true });
    if (error && /created_by/i.test(error.message)) {
      const fallback = await supabase
        .from('contract_ai_directives')
        .select('id, category, title, line, body, sort_order, is_active, created_at')
        .order('sort_order', { ascending: true })
        .order('title', { ascending: true });
      data = fallback.data;
      error = fallback.error;
    }
    if (error) {
      setRows([]);
      setAuthorNames({});
      setMissingTable(/contract_ai_directives|schema cache|does not exist/i.test(error.message));
      if (!/contract_ai_directives|schema cache|does not exist/i.test(error.message)) {
        toast.error(error.message);
      }
      setLoading(false);
      return;
    }
    const nextRows = (data || []) as ContractAiDirective[];
    setMissingTable(false);
    setRows(nextRows);
    const authorIds = [...new Set(nextRows.map((row) => row.created_by).filter((id): id is string => Boolean(id)))];
    if (authorIds.length === 0) {
      setAuthorNames({});
      setLoading(false);
      return;
    }
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('auth_id, full_name, first_name, last_name, tenants_employee!employee_id(display_name, official_name)')
      .in('auth_id', authorIds);
    if (usersError) {
      setAuthorNames({});
    } else {
      const names: Record<string, string> = {};
      for (const user of users || []) {
        const authId = typeof user.auth_id === 'string' ? user.auth_id : '';
        const name = personName(user);
        if (authId && name) names[authId] = name;
      }
      setAuthorNames(names);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(
    () => rows.filter((row) => row.category === category),
    [rows, category],
  );

  const save = async () => {
    if (!draft) return;
    const title = draft.title.trim();
    const body = draft.body.trim();
    if (!title || !body) {
      toast.error('Add a title and the text the AI should follow.');
      return;
    }
    setSaving(true);
    const payload = {
      title,
      line: draft.line.trim() || null,
      body,
      is_active: draft.is_active,
      category,
      updated_at: new Date().toISOString(),
    };
    let id = draft.id;
    if (!id) {
      const base = slugFromTitle(title);
      id = rows.some((row) => row.id === base) ? `${base}_${Date.now().toString(36)}` : base;
    }
    let result = draft.id
      ? await supabase.from('contract_ai_directives').update(payload).eq('id', draft.id)
      : await (async () => {
          const { data: authData } = await supabase.auth.getUser();
          const inserted = await supabase.from('contract_ai_directives').insert({
            ...payload,
            id,
            sort_order: visible.length + 1,
            created_by: authData.user?.id ?? null,
          });
          if (inserted.error && /created_by/i.test(inserted.error.message)) {
            return supabase.from('contract_ai_directives').insert({
              ...payload,
              id,
              sort_order: visible.length + 1,
            });
          }
          return inserted;
        })();
    setSaving(false);
    if (result.error) {
      toast.error(result.error.message);
      return;
    }
    toast.success(draft.id ? 'Saved' : 'Added');
    setDraft(null);
    await load();
  };

  const remove = async (row: ContractAiDirective) => {
    if (!window.confirm(`Remove “${row.title}”? The contract AI will stop using it.`)) return;
    const { error } = await supabase.from('contract_ai_directives').delete().eq('id', row.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Removed');
    await load();
  };

  const toggleActive = async (row: ContractAiDirective) => {
    const { error } = await supabase
      .from('contract_ai_directives')
      .update({ is_active: !row.is_active, updated_at: new Date().toISOString() })
      .eq('id', row.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    await load();
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Contract AI</h2>
        <p className="mt-1 text-sm text-gray-500">
          Text the contract checker and the contract AI follow. Changes apply on the next check or AI message.
        </p>
      </div>

      <div className="inline-flex rounded-full bg-white p-1 shadow-sm">
        {CATEGORIES.map((item) => {
          const selected = category === item;
          return (
            <button
              key={item}
              type="button"
              onClick={() => {
                setCategory(item);
                setDraft(null);
              }}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
                selected ? 'bg-[#3b28c7] text-white shadow-sm' : 'text-gray-500 hover:text-gray-900'
              }`}
              aria-pressed={selected}
            >
              {contractAiCategoryLabel(item)}
            </button>
          );
        })}
      </div>

      {CATEGORY_HELP[category] ? <p className="text-sm text-gray-600">{CATEGORY_HELP[category]}</p> : null}

      {missingTable ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Run <span className="font-mono">sql/2026-11-25_contract_ai_directives.sql</span> in the Supabase SQL editor, then reload this page.
        </div>
      ) : null}

      <div className="flex justify-end">
        <button
          type="button"
          className="btn btn-sm gap-1 rounded-full border-0 bg-[#3b28c7] text-white hover:bg-[#3224b0]"
          onClick={() => setDraft(emptyDraft())}
          disabled={missingTable}
        >
          <PlusIcon className="h-5 w-5" />
          Add
        </button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        {draft ? (
          <div className="space-y-3 border-b border-gray-200 p-4">
            <label className="block text-sm font-medium text-gray-700">
              Title
              <input
                className="input input-bordered mt-1 w-full"
                value={draft.title}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                placeholder={category === 'policy' ? 'No refunds' : 'Short name'}
              />
            </label>
            {category === 'policy' ? (
              <label className="block text-sm font-medium text-gray-700">
                Short line shown when it is missing
                <input
                  className="input input-bordered mt-1 w-full"
                  value={draft.line}
                  onChange={(event) => setDraft({ ...draft, line: event.target.value })}
                  placeholder="Fees are not refunded, subject to applicable law."
                />
              </label>
            ) : null}
            <label className="block text-sm font-medium text-gray-700">
              Text the AI must follow
              <textarea
                className="textarea textarea-bordered mt-1 min-h-32 w-full"
                value={draft.body}
                onChange={(event) => setDraft({ ...draft, body: event.target.value })}
                placeholder="Write the policy, rule, or behavior in plain language."
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                className="toggle toggle-success toggle-sm"
                checked={draft.is_active}
                aria-label={draft.is_active ? 'Turn off' : 'Turn on'}
                onChange={(event) => setDraft({ ...draft, is_active: event.target.checked })}
              />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setDraft(null)} disabled={saving}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-sm rounded-full border-0 bg-[#3b28c7] text-white hover:bg-[#3224b0]"
                onClick={() => void save()}
                disabled={saving}
              >
                {saving ? 'Saving' : 'Save'}
              </button>
            </div>
          </div>
        ) : null}

        {loading ? (
          <div className="flex justify-center py-10">
            <span className="loading loading-spinner loading-md text-gray-400" />
          </div>
        ) : visible.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-gray-500">
            Nothing in {contractAiCategoryLabel(category)} yet.
          </p>
        ) : (
          <ul ref={listRef}>
            {visible.map((row, index) => (
              <li key={row.id} className={index > 0 || draft ? 'border-t border-gray-200' : ''}>
                <div className="p-4">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-gray-900">{row.title}</p>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-gray-700">{row.body}</p>
                    </div>
                    <details className="dropdown dropdown-end shrink-0">
                      <summary className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 [&::-webkit-details-marker]:hidden">
                        <EllipsisVerticalIcon className="h-6 w-6" />
                      </summary>
                      <ul
                        className="dropdown-content z-20 w-40 overflow-hidden rounded-xl border border-gray-300 py-1 shadow-lg"
                        style={{ backgroundColor: '#ececec' }}
                      >
                        <li>
                          <button
                            type="button"
                            className="flex w-full items-center gap-2 bg-[#ececec] px-3 py-2 text-left text-sm text-gray-800 hover:bg-[#e2e2e2]"
                            onClick={(event) => {
                              event.currentTarget.closest('details')?.removeAttribute('open');
                              setDraft({
                                id: row.id,
                                title: row.title,
                                line: row.line || '',
                                body: row.body,
                                is_active: row.is_active,
                              });
                            }}
                          >
                            <PencilSquareIcon className="h-4 w-4" />
                            Edit
                          </button>
                        </li>
                        <li>
                          <button
                            type="button"
                            className="flex w-full items-center gap-2 bg-[#ececec] px-3 py-2 text-left text-sm text-red-600 hover:bg-[#e2e2e2]"
                            onClick={(event) => {
                              event.currentTarget.closest('details')?.removeAttribute('open');
                              void remove(row);
                            }}
                          >
                            <TrashIcon className="h-4 w-4" />
                            Delete
                          </button>
                        </li>
                      </ul>
                    </details>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <p className="min-w-0 text-xs text-gray-400">
                      {row.created_by && authorNames[row.created_by]
                        ? `Added by ${authorNames[row.created_by]}`
                        : 'Added'}
                      {formatAddedWhen(row.created_at) ? ` · ${formatAddedWhen(row.created_at)}` : ''}
                    </p>
                    <label className="flex shrink-0 items-center">
                      <input
                        type="checkbox"
                        className="toggle toggle-success toggle-sm"
                        checked={row.is_active}
                        aria-label={row.is_active ? 'Turn off' : 'Turn on'}
                        onChange={() => void toggleActive(row)}
                      />
                    </label>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default ContractAiPoliciesManager;
