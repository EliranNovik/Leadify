import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import {
  DocumentTextIcon,
  PlusIcon,
  ClipboardDocumentIcon,
  ArrowTopRightOnSquareIcon,
  TrashIcon,
  XMarkIcon,
  ChevronDownIcon,
} from '@heroicons/react/24/outline';
import {
  buildPoaUrl,
  cancelPoa,
  createPoa,
  deletePoa,
  fetchPoaTypes,
  listPoasForContact,
  markPoaSent,
  type PoaListItem,
  type PoaTypeRow,
} from '../../lib/poaApi';
import {
  createPoaFromTemplate,
  listActivePoaTemplates,
  fetchPoaCategories,
  fetchPoaLanguages,
  type PoaTemplateRow,
  type PoaLookupOption,
  type PoaLanguageOption,
} from '../../lib/poaTemplatesApi';
import { buildTemplatePrefill } from '../../lib/poaTemplateFields';
import { POA_STATUS_LABELS, buildPoaPrefill } from '../../lib/poaTypes';

interface ContactInfo {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  address?: string | null;
  id_passport?: string | null;
}

interface Props {
  contactId: number;
  contact: ContactInfo;
  newLeadId?: string | null;
  legacyLeadId?: number | null;
  createdBy?: string | null;
}

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-500 border-none',
  sent: 'bg-sky-50 text-sky-600 border-none',
  viewed: 'bg-amber-50 text-amber-600 border-none',
  signed: 'bg-violet-50 text-violet-600 border-none',
  cancelled: 'bg-rose-50 text-rose-500 border-none',
};

const ContactPoaSection: React.FC<Props> = ({
  contactId,
  contact,
  newLeadId,
  legacyLeadId,
  createdBy,
}) => {
  const [poas, setPoas] = useState<PoaListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [types, setTypes] = useState<PoaTypeRow[]>([]);
  const [templates, setTemplates] = useState<PoaTemplateRow[]>([]);
  const [categories, setCategories] = useState<PoaLookupOption[]>([]);
  const [languages, setLanguages] = useState<PoaLanguageOption[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<number | ''>('');
  const [languageFilter, setLanguageFilter] = useState<string>('');
  // Combined picker value: "type:<id>" for built-ins, "tpl:<uuid>" for templates.
  const [selectedValue, setSelectedValue] = useState<string>('');
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Built-in POA types we no longer offer in the picker.
  const HIDDEN_TYPE_KEYS = ['standard_hebrew'];

  /** Apply the category/language filters to the available built-ins + templates. */
  const computeAvailable = useCallback(
    (cat: number | '', lang: string) => {
      const iso = lang ? (languages.find((l) => l.id === lang)?.iso_code || '').toLowerCase() : '';
      const ft = types
        .filter((t) => !HIDDEN_TYPE_KEYS.includes(t.key))
        .filter((t) => {
          // Built-in types have no category, so a category filter hides them.
          if (cat !== '') return false;
          if (iso && (t.language || '').toLowerCase() !== iso) return false;
          return true;
        });
      const ftpl = templates.filter((t) => {
        if (cat !== '' && t.category_id !== cat) return false;
        if (lang && t.language_id !== lang) return false;
        return true;
      });
      return { ft, ftpl };
    },
    [types, templates, languages],
  );

  const reload = useCallback(async () => {
    if (!contactId) return;
    setLoading(true);
    try {
      const rows = await listPoasForContact(contactId);
      setPoas(rows);
    } catch (err) {
      console.error('[POA] load failed', err);
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const openModal = useCallback(async () => {
    setShowModal(true);
    if (types.length === 0 && templates.length === 0) {
      try {
        const [typeRows, tplRows, catRows, langRows] = await Promise.all([
          fetchPoaTypes().catch(() => [] as PoaTypeRow[]),
          listActivePoaTemplates().catch(() => [] as PoaTemplateRow[]),
          fetchPoaCategories().catch(() => [] as PoaLookupOption[]),
          fetchPoaLanguages().catch(() => [] as PoaLanguageOption[]),
        ]);
        setTypes(typeRows);
        setTemplates(tplRows);
        setCategories(catRows);
        setLanguages(langRows);
        const firstType = typeRows.find((t) => !HIDDEN_TYPE_KEYS.includes(t.key));
        if (firstType) setSelectedValue(`type:${firstType.id}`);
        else if (tplRows.length > 0) setSelectedValue(`tpl:${tplRows[0].id}`);
      } catch (err) {
        toast.error('Could not load POA options');
        console.error(err);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [types.length, templates.length]);

  const copyLink = useCallback(async (poa: PoaListItem) => {
    const url = buildPoaUrl(poa.secure_token);
    try {
      await navigator.clipboard.writeText(url);
      toast.success('POA link copied');
      if (poa.status === 'pending') {
        await markPoaSent(poa.id).catch(() => undefined);
        void reload();
      }
    } catch {
      window.prompt('Copy this POA link:', url);
    }
  }, [reload]);

  const handleCreate = useCallback(async () => {
    if (!selectedValue) {
      toast.error('Please choose a POA');
      return;
    }
    setCreating(true);
    try {
      let result: { id: string; secureToken: string };
      if (selectedValue.startsWith('tpl:')) {
        const tplId = selectedValue.slice(4);
        const tpl = templates.find((t) => t.id === tplId);
        result = await createPoaFromTemplate({
          contactId,
          templateId: tplId,
          newLeadId: newLeadId ?? null,
          legacyLeadId: legacyLeadId ?? null,
          prefill: tpl ? buildTemplatePrefill(tpl.fields, contact) : {},
          createdBy: createdBy ?? null,
        });
      } else {
        const typeId = Number(selectedValue.slice(5));
        const type = types.find((t) => t.id === typeId);
        result = await createPoa({
          contactId,
          poaTypeId: typeId,
          newLeadId: newLeadId ?? null,
          legacyLeadId: legacyLeadId ?? null,
          prefill: type ? buildPoaPrefill(type.key, contact) : {},
          createdBy: createdBy ?? null,
        });
      }

      const url = buildPoaUrl(result.secureToken);
      try {
        await navigator.clipboard.writeText(url);
        toast.success('POA created — link copied to clipboard');
        await markPoaSent(result.id).catch(() => undefined);
      } catch {
        toast.success('POA created');
        window.prompt('Copy this POA link:', url);
      }

      setShowModal(false);
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create POA');
    } finally {
      setCreating(false);
    }
  }, [selectedValue, types, templates, contactId, newLeadId, legacyLeadId, contact, createdBy, reload]);

  const handleRemove = useCallback(async (poa: PoaListItem) => {
    if (poa.status === 'signed') {
      if (!window.confirm('Cancel this signed POA? It will no longer be accessible via its link.')) return;
      try {
        await cancelPoa(poa.id);
        toast.success('POA cancelled');
        await reload();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not cancel POA');
      }
      return;
    }
    if (!window.confirm('Delete this POA? This cannot be undone.')) return;
    try {
      await deletePoa(poa.id);
      toast.success('POA deleted');
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete POA');
    }
  }, [reload]);

  return (
    <div className="flex items-start justify-between py-3">
      <label className="text-sm font-medium text-gray-500 uppercase tracking-wide pt-1">
        POA
      </label>
      <div className="flex-1 ml-4 flex flex-col gap-2 items-end">
        {loading && poas.length === 0 ? (
          <span className="text-xs text-gray-400">Loading…</span>
        ) : poas.length === 0 ? (
          <span className="text-xs text-gray-400">No POAs yet</span>
        ) : (
          <div className="w-full flex flex-col divide-y divide-gray-100">
            {(expanded ? poas : poas.slice(0, 1)).map((poa) => (
              <div key={poa.id} className="flex flex-col gap-2 py-2.5 first:pt-0">
                <div className="flex items-center justify-end gap-2">
                  <span className="mr-auto text-sm font-medium text-gray-700 truncate">
                    {poa.type_name}
                  </span>
                  <span className={`badge badge-sm ${STATUS_BADGE[poa.status] || 'badge-ghost'}`}>
                    {POA_STATUS_LABELS[poa.status] || poa.status}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5 justify-end">
                  <button
                    type="button"
                    className="btn btn-outline btn-primary btn-xs gap-1"
                    onClick={() => copyLink(poa)}
                    disabled={poa.status === 'cancelled'}
                  >
                    <ClipboardDocumentIcon className="w-3.5 h-3.5" />
                    Copy link
                  </button>
                  <a
                    className={`btn btn-outline btn-primary btn-xs gap-1 ${
                      poa.status === 'cancelled' ? 'btn-disabled' : ''
                    }`}
                    href={buildPoaUrl(poa.secure_token)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" />
                    {poa.status === 'signed' ? 'View' : 'Open'}
                  </a>
                  <button
                    type="button"
                    className="btn btn-outline btn-error btn-xs gap-1"
                    onClick={() => handleRemove(poa)}
                  >
                    <TrashIcon className="w-3.5 h-3.5" />
                    {poa.status === 'signed' ? 'Cancel' : 'Delete'}
                  </button>
                </div>
              </div>
            ))}
            {poas.length > 1 && (
              <button
                type="button"
                className="btn btn-ghost btn-xs gap-1 self-end text-gray-500 hover:text-gray-700"
                onClick={() => setExpanded((v) => !v)}
              >
                <ChevronDownIcon
                  className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`}
                />
                {expanded ? 'Show less' : `Show ${poas.length - 1} more`}
              </button>
            )}
          </div>
        )}

        <button
          type="button"
          className="btn btn-outline btn-primary btn-sm gap-1.5"
          onClick={openModal}
        >
          <PlusIcon className="w-4 h-4" />
          Add POA
        </button>
      </div>

      {showModal &&
        createPortal(
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
              <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
                <div className="flex items-center gap-2">
                  <DocumentTextIcon className="h-5 w-5 text-indigo-600" />
                  <h3 className="text-base font-semibold text-gray-900">Create Power of Attorney</h3>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm btn-circle"
                  onClick={() => setShowModal(false)}
                >
                  <XMarkIcon className="h-5 w-5" />
                </button>
              </div>

              <div className="px-5 py-5">
                <p className="mb-3 text-sm text-gray-500">
                  For <span className="font-medium text-gray-700">{contact.name || 'this contact'}</span>. A
                  public link will be generated for the client to fill out and sign.
                </p>
                <div className="mb-3 grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-500">Category</label>
                    <select
                      className="select select-bordered select-sm w-full"
                      value={categoryFilter}
                      onChange={(e) => {
                        const v = e.target.value ? Number(e.target.value) : '';
                        setCategoryFilter(v);
                        const { ft, ftpl } = computeAvailable(v, languageFilter);
                        setSelectedValue(
                          ft[0] ? `type:${ft[0].id}` : ftpl[0] ? `tpl:${ftpl[0].id}` : '',
                        );
                      }}
                    >
                      <option value="">All categories</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-500">Language</label>
                    <select
                      className="select select-bordered select-sm w-full"
                      value={languageFilter}
                      onChange={(e) => {
                        const v = e.target.value;
                        setLanguageFilter(v);
                        const { ft, ftpl } = computeAvailable(categoryFilter, v);
                        setSelectedValue(
                          ft[0] ? `type:${ft[0].id}` : ftpl[0] ? `tpl:${ftpl[0].id}` : '',
                        );
                      }}
                    >
                      <option value="">All languages</option>
                      {languages.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <label className="mb-1 block text-sm font-medium text-gray-700">POA type</label>
                {(() => {
                  const { ft, ftpl } = computeAvailable(categoryFilter, languageFilter);
                  const noOptions = ft.length === 0 && ftpl.length === 0;
                  return (
                    <select
                      className="select select-bordered w-full"
                      value={selectedValue}
                      onChange={(e) => setSelectedValue(e.target.value)}
                    >
                      {types.length === 0 && templates.length === 0 && (
                        <option value="">Loading options…</option>
                      )}
                      {!noOptions ? (
                        <>
                          {ft.length > 0 && (
                            <optgroup label="Built-in POAs">
                              {ft.map((t) => (
                                <option key={t.id} value={`type:${t.id}`}>
                                  {t.name}
                                </option>
                              ))}
                            </optgroup>
                          )}
                          {ftpl.length > 0 && (
                            <optgroup label="Templates">
                              {ftpl.map((t) => (
                                <option key={t.id} value={`tpl:${t.id}`}>
                                  {t.name}
                                </option>
                              ))}
                            </optgroup>
                          )}
                        </>
                      ) : (
                        <option value="">No POAs match these filters</option>
                      )}
                    </select>
                  );
                })()}
                {(() => {
                  if (selectedValue.startsWith('tpl:')) {
                    const t = templates.find((x) => x.id === selectedValue.slice(4));
                    return t?.description ? (
                      <p className="mt-2 text-xs text-gray-500">{t.description}</p>
                    ) : null;
                  }
                  const t = types.find((x) => `type:${x.id}` === selectedValue);
                  return t?.description ? (
                    <p className="mt-2 text-xs text-gray-500">{t.description}</p>
                  ) : null;
                })()}
              </div>

              <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-4">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowModal(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm gap-1.5"
                  onClick={handleCreate}
                  disabled={creating || !selectedValue}
                >
                  {creating ? (
                    <>
                      <span className="loading loading-spinner loading-xs" />
                      Creating…
                    </>
                  ) : (
                    <>
                      <PlusIcon className="h-4 w-4" />
                      Create &amp; copy link
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
};

export default ContactPoaSection;
