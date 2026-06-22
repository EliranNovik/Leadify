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
  pending: 'badge-ghost',
  sent: 'badge-info',
  viewed: 'badge-warning',
  signed: 'bg-purple-600 text-white border-none',
  cancelled: 'badge-error',
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
  const [selectedTypeId, setSelectedTypeId] = useState<number | ''>('');
  const [creating, setCreating] = useState(false);

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
    if (types.length === 0) {
      try {
        const rows = await fetchPoaTypes();
        setTypes(rows);
        if (rows.length > 0) setSelectedTypeId(rows[0].id);
      } catch (err) {
        toast.error('Could not load POA types');
        console.error(err);
      }
    }
  }, [types.length]);

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
    if (!selectedTypeId) {
      toast.error('Please choose a POA type');
      return;
    }
    const type = types.find((t) => t.id === selectedTypeId);
    setCreating(true);
    try {
      const result = await createPoa({
        contactId,
        poaTypeId: Number(selectedTypeId),
        newLeadId: newLeadId ?? null,
        legacyLeadId: legacyLeadId ?? null,
        prefill: type ? buildPoaPrefill(type.key, contact) : {},
        createdBy: createdBy ?? null,
      });

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
  }, [selectedTypeId, types, contactId, newLeadId, legacyLeadId, contact, createdBy, reload]);

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
        Power of Attorney
      </label>
      <div className="flex-1 ml-4 flex flex-col gap-2 items-end">
        {loading && poas.length === 0 ? (
          <span className="text-xs text-gray-400">Loading…</span>
        ) : poas.length === 0 ? (
          <span className="text-xs text-gray-400">No POAs yet</span>
        ) : (
          <div className="w-full flex flex-col gap-2">
            {poas.map((poa) => (
              <div
                key={poa.id}
                className="flex flex-col gap-2 rounded-lg border border-gray-100 bg-gray-50/60 p-2.5"
              >
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
                <label className="mb-1 block text-sm font-medium text-gray-700">POA type</label>
                <select
                  className="select select-bordered w-full"
                  value={selectedTypeId}
                  onChange={(e) => setSelectedTypeId(e.target.value ? Number(e.target.value) : '')}
                >
                  {types.length === 0 && <option value="">Loading types…</option>}
                  {types.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                {(() => {
                  const t = types.find((x) => x.id === selectedTypeId);
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
                  disabled={creating || !selectedTypeId}
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
