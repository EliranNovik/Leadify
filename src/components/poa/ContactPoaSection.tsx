import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  DocumentTextIcon,
  PlusIcon,
  ClipboardDocumentIcon,
  ArrowTopRightOnSquareIcon,
  ComputerDesktopIcon,
  TrashIcon,
  XMarkIcon,
  ChevronDownIcon,
  EllipsisHorizontalIcon,
  PencilSquareIcon,
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
import DisplayOnKioskModal from '../kiosk/DisplayOnKioskModal';

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
  /** Compact document rows for contact cards (default: legacy label+buttons layout). */
  variant?: 'default' | 'compact';
  /** Hide the inline Add POA button (parent documents header can trigger openCreate). */
  hideAddButton?: boolean;
  /** Register openCreate so the parent “+ Add” menu can open the create modal. */
  onRegisterActions?: (actions: { openCreate: () => void } | null) => void;
}

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-sky-50 text-sky-700',
  sent: 'bg-sky-50 text-sky-700',
  viewed: 'bg-amber-50 text-amber-700',
  signed: 'bg-violet-50 text-violet-700',
  cancelled: 'bg-rose-50 text-rose-600',
  draft: 'bg-amber-50 text-amber-700',
  expired: 'bg-gray-100 text-gray-500',
};

const statusBadgeClass = (status: string) =>
  `inline-flex items-center h-6 px-2.5 rounded-full text-xs font-semibold ${
    STATUS_BADGE[status] || 'bg-gray-100 text-gray-600'
  }`;

const ContactPoaSection: React.FC<Props> = ({
  contactId,
  contact,
  newLeadId,
  legacyLeadId,
  createdBy,
  variant = 'default',
  hideAddButton = false,
  onRegisterActions,
}) => {
  const navigate = useNavigate();
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
  const [kioskPoa, setKioskPoa] = useState<PoaListItem | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const isCompact = variant === 'compact';

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

  useEffect(() => {
    if (!onRegisterActions) return;
    onRegisterActions({ openCreate: () => void openModal() });
    return () => onRegisterActions(null);
  }, [onRegisterActions, openModal]);

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

  const openPoaEditor = useCallback(
    (secureToken: string) => {
      navigate(`/poa/edit/${encodeURIComponent(secureToken)}`);
    },
    [navigate],
  );

  const viewPoa = useCallback(
    (poa: PoaListItem) => {
      if (poa.status === 'cancelled') return;
      if (poa.template_id) {
        openPoaEditor(poa.secure_token);
      } else {
        window.open(buildPoaUrl(poa.secure_token), '_blank', 'noopener,noreferrer');
      }
    },
    [openPoaEditor],
  );

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

      if (selectedValue.startsWith('tpl:')) {
        openPoaEditor(result.secureToken);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create POA');
    } finally {
      setCreating(false);
    }
  }, [selectedValue, types, templates, contactId, newLeadId, legacyLeadId, contact, createdBy, reload, openPoaEditor]);

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

  const visiblePoas = expanded ? poas : poas.slice(0, 2);
  const hiddenCount = Math.max(0, poas.length - 2);

  const createModal = showModal &&
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
                  Create POA
                </>
              )}
            </button>
          </div>
        </div>
      </div>,
      document.body,
    );

  const kioskModal = kioskPoa ? (
    <DisplayOnKioskModal
      open
      onClose={() => setKioskPoa(null)}
      resource={{
        resourceType: 'poa',
        resourceId: String(kioskPoa.id),
        resourceToken: kioskPoa.secure_token,
      }}
      title="Display POA on kiosk"
    />
  ) : null;

  if (isCompact) {
    return (
      <div className="w-full">
        {loading && poas.length === 0 ? (
          <p className="text-xs text-gray-400 px-1 py-2">Loading documents…</p>
        ) : poas.length === 0 ? null : (
          <div className="w-full">
            {visiblePoas.map((poa) => (
              <div
                key={poa.id}
                role="button"
                tabIndex={poa.status === 'cancelled' ? -1 : 0}
                className={`grid grid-cols-[40px_minmax(0,1fr)_auto] gap-3 items-center p-3 bg-white rounded-[10px] mt-2 first:mt-0 transition-colors ${
                  poa.status === 'cancelled'
                    ? 'opacity-60 cursor-default'
                    : 'cursor-pointer hover:bg-gray-50/80'
                }`}
                onClick={() => {
                  if (poa.status !== 'cancelled') viewPoa(poa);
                }}
                onKeyDown={(e) => {
                  if (poa.status === 'cancelled') return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    viewPoa(poa);
                  }
                }}
              >
                <div className="h-10 w-10 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center shrink-0">
                  <PencilSquareIcon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-900 truncate">{poa.type_name}</div>
                  <div className="mt-0.5 text-sm text-gray-500">POA</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={statusBadgeClass(poa.status)}>
                    {POA_STATUS_LABELS[poa.status] || poa.status}
                  </span>
                  <div className="relative" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs btn-square h-9 w-9 min-h-9 text-gray-500"
                      aria-label="More actions"
                      onClick={() => setOpenMenuId((id) => (id === poa.id ? null : poa.id))}
                    >
                      <EllipsisHorizontalIcon className="h-5 w-5" />
                    </button>
                    {openMenuId === poa.id && (
                      <>
                        <button
                          type="button"
                          className="fixed inset-0 z-40 cursor-default"
                          aria-label="Close menu"
                          onClick={() => setOpenMenuId(null)}
                        />
                        <div className="absolute right-0 top-full mt-1 z-50 min-w-[180px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                          <button
                            type="button"
                            className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                            disabled={poa.status === 'cancelled'}
                            onClick={() => {
                              setOpenMenuId(null);
                              void copyLink(poa);
                            }}
                          >
                            Copy link
                          </button>
                          <button
                            type="button"
                            className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                            disabled={poa.status === 'cancelled'}
                            onClick={() => {
                              setOpenMenuId(null);
                              setKioskPoa(poa);
                            }}
                          >
                            Open kiosk
                          </button>
                          <button
                            type="button"
                            className="w-full px-3 py-2 text-left text-sm text-rose-600 hover:bg-rose-50"
                            onClick={() => {
                              setOpenMenuId(null);
                              void handleRemove(poa);
                            }}
                          >
                            {poa.status === 'signed' ? 'Cancel' : 'Delete'}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {hiddenCount > 0 && (
              <button
                type="button"
                className="mt-2 flex w-full items-center justify-between px-1 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-700"
                onClick={() => setExpanded((v) => !v)}
              >
                <span>{expanded ? 'Show less' : `Show ${hiddenCount} more`}</span>
                <ChevronDownIcon
                  className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`}
                />
              </button>
            )}
          </div>
        )}

        {!hideAddButton && (
          <button
            type="button"
            className="btn btn-ghost btn-xs mt-2 gap-1 text-gray-600"
            onClick={openModal}
          >
            <PlusIcon className="w-3.5 h-3.5" />
            Add POA
          </button>
        )}

        {createModal}
        {kioskModal}
      </div>
    );
  }

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
                  <span className={statusBadgeClass(poa.status)}>
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
                  <button
                    type="button"
                    className="btn btn-outline btn-primary btn-xs gap-1"
                    disabled={poa.status === 'cancelled'}
                    onClick={() => setKioskPoa(poa)}
                  >
                    <ComputerDesktopIcon className="w-3.5 h-3.5" />
                    Kiosk
                  </button>
                  {poa.template_id ? (
                    <button
                      type="button"
                      className={`btn btn-outline btn-primary btn-xs gap-1 ${
                        poa.status === 'cancelled' ? 'btn-disabled' : ''
                      }`}
                      disabled={poa.status === 'cancelled'}
                      onClick={() => openPoaEditor(poa.secure_token)}
                    >
                      <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" />
                      {poa.status === 'signed' ? 'View' : 'Open'}
                    </button>
                  ) : (
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
                  )}
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

        {!hideAddButton && (
          <button
            type="button"
            className="btn btn-outline btn-primary btn-sm gap-1.5"
            onClick={openModal}
          >
            <PlusIcon className="w-4 h-4" />
            Add POA
          </button>
        )}
      </div>

      {createModal}
      {kioskModal}
    </div>
  );
};

export default ContactPoaSection;
