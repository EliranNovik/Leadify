import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  DocumentIcon,
  EyeIcon,
  PlusIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { DocumentPreviewModal, type DocumentPreviewItem } from '../DocumentModal';
import {
  assignLeadCaseDocumentType,
  fetchLeadCaseDocumentTypes,
  fetchLeadCaseDocumentsForGrid,
  fetchLeadContactsForDocuments,
  indexLeadCaseDocumentsByContactAndType,
  resolveLeadActiveDocumentTypes,
  resolveLeadNumberFromClient,
  uploadLeadCaseDocumentForContact,
  type LeadCaseContactRow,
  type LeadCaseDocumentRow,
  type LeadCaseDocumentType,
} from '../../lib/leadCaseDocumentsApi';
import type { ClientTabProps } from '../../types/client';

type UploadTarget = {
  contactId: number;
  documentTypeId: string;
  documentTypeName: string;
};

const DocumentsTab: React.FC<ClientTabProps> = ({ client }) => {
  const [contacts, setContacts] = useState<LeadCaseContactRow[]>([]);
  const [catalogTypes, setCatalogTypes] = useState<LeadCaseDocumentType[]>([]);
  const [activeDocumentTypes, setActiveDocumentTypes] = useState<LeadCaseDocumentType[]>([]);
  const [documents, setDocuments] = useState<LeadCaseDocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingType, setAddingType] = useState(false);
  const [typeToAdd, setTypeToAdd] = useState('');
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewItems, setPreviewItems] = useState<DocumentPreviewItem[]>([]);
  const [previewIndex, setPreviewIndex] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadTargetRef = useRef<UploadTarget | null>(null);

  const leadNumber = useMemo(() => resolveLeadNumberFromClient(client), [client]);

  const docIndex = useMemo(
    () => indexLeadCaseDocumentsByContactAndType(documents),
    [documents],
  );

  const availableTypesToAdd = useMemo(
    () => catalogTypes.filter((t) => !activeDocumentTypes.some((a) => a.id === t.id)),
    [catalogTypes, activeDocumentTypes],
  );

  const load = useCallback(async () => {
    if (!client?.id) {
      setContacts([]);
      setCatalogTypes([]);
      setActiveDocumentTypes([]);
      setDocuments([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [catalog, contactRows] = await Promise.all([
        fetchLeadCaseDocumentTypes(),
        fetchLeadContactsForDocuments(client),
      ]);
      setCatalogTypes(catalog);
      setContacts(contactRows);

      const active = await resolveLeadActiveDocumentTypes(leadNumber, catalog);
      setActiveDocumentTypes(active);

      const docs = await fetchLeadCaseDocumentsForGrid(leadNumber, catalog);
      setDocuments(docs);
    } catch (e) {
      console.error('DocumentsTab load:', e);
      toast.error(e instanceof Error ? e.message : 'Failed to load documents');
    } finally {
      setLoading(false);
    }
  }, [client, leadNumber]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleAddDocumentType = async () => {
    const typeId = typeToAdd.trim();
    if (!typeId) {
      toast.error('Choose a document type');
      return;
    }

    setAddingType(true);
    try {
      await assignLeadCaseDocumentType(leadNumber, typeId);
      const added = catalogTypes.find((t) => t.id === typeId);
      if (added) {
        setActiveDocumentTypes((prev) =>
          prev.some((t) => t.id === typeId) ? prev : [...prev, added],
        );
      } else {
        const active = await resolveLeadActiveDocumentTypes(leadNumber, catalogTypes);
        setActiveDocumentTypes(active);
      }
      setTypeToAdd('');
      toast.success('Document type added');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to add document type');
    } finally {
      setAddingType(false);
    }
  };

  const openPreview = (doc: LeadCaseDocumentRow) => {
    if (!doc.signed_url) {
      toast.error('Preview unavailable');
      return;
    }
    setPreviewItems([
      {
        id: doc.id,
        name: doc.file_name,
        downloadUrl: doc.signed_url,
        fileType: doc.mime_type ?? undefined,
        lastModified: doc.created_at,
      },
    ]);
    setPreviewIndex(0);
    setPreviewOpen(true);
  };

  const triggerUpload = (target: UploadTarget) => {
    uploadTargetRef.current = target;
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const target = uploadTargetRef.current;
    uploadTargetRef.current = null;
    if (!file || !target) return;

    const key = `${target.contactId}:${target.documentTypeId}`;
    setUploadingKey(key);
    try {
      const row = await uploadLeadCaseDocumentForContact({
        leadNumber,
        contactId: target.contactId,
        documentTypeId: target.documentTypeId,
        file,
      });
      setDocuments((prev) => [row, ...prev.filter((d) => d.id !== row.id)]);
      if (!activeDocumentTypes.some((t) => t.id === target.documentTypeId)) {
        const added = catalogTypes.find((t) => t.id === target.documentTypeId);
        if (added) setActiveDocumentTypes((prev) => [...prev, added]);
      }
      toast.success(`${target.documentTypeName} uploaded`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploadingKey(null);
    }
  };

  const renderDocumentCell = (contact: LeadCaseContactRow, docType: LeadCaseDocumentType) => {
    const key = `${contact.id}:${docType.id}`;
    const doc = docIndex.get(key);
    const isUploading = uploadingKey === key;

    if (doc) {
      return (
        <td key={key} className="text-center align-middle">
          <div className="flex flex-col items-center gap-1 py-1">
            <button
              type="button"
              className="btn btn-ghost btn-xs max-w-[140px] gap-1 truncate"
              title={doc.file_name}
              onClick={() => openPreview(doc)}
            >
              <DocumentIcon className="h-4 w-4 shrink-0 text-primary" />
              <span className="truncate text-xs">{doc.file_name}</span>
            </button>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="btn btn-ghost btn-xs btn-square h-7 w-7"
                title="Preview"
                onClick={() => openPreview(doc)}
              >
                <EyeIcon className="h-4 w-4" />
              </button>
              {doc.signed_url ? (
                <a
                  href={doc.signed_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-ghost btn-xs btn-square h-7 w-7"
                  title="Download"
                >
                  <ArrowDownTrayIcon className="h-4 w-4" />
                </a>
              ) : null}
              <button
                type="button"
                className="btn btn-ghost btn-xs btn-square h-7 w-7 text-green-600"
                title={`Replace ${docType.name}`}
                disabled={isUploading || contact.id <= 0}
                onClick={() =>
                  triggerUpload({
                    contactId: contact.id,
                    documentTypeId: docType.id,
                    documentTypeName: docType.name,
                  })
                }
              >
                {isUploading ? (
                  <span className="loading loading-spinner loading-xs" />
                ) : (
                  <ArrowUpTrayIcon className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
        </td>
      );
    }

    return (
      <td key={key} className="text-center align-middle">
        <button
          type="button"
          className="btn btn-ghost btn-xs text-green-600 hover:bg-green-600 hover:text-white"
          disabled={isUploading || contact.id <= 0}
          title={contact.id <= 0 ? 'Add contacts in the Contact tab first' : `Upload ${docType.name}`}
          onClick={() =>
            triggerUpload({
              contactId: contact.id,
              documentTypeId: docType.id,
              documentTypeName: docType.name,
            })
          }
        >
          {isUploading ? <span className="loading loading-spinner loading-xs" /> : <PlusIcon className="h-4 w-4" />}
        </button>
      </td>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-base-content/60">
        <span className="loading loading-spinner loading-md text-primary" />
        Loading documents…
      </div>
    );
  }

  const totalCols = 2 + activeDocumentTypes.length;

  return (
    <div className="space-y-4 p-1">
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={(e) => void handleFileSelected(e)}
      />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-base-content">Documents by contact</h2>
          <p className="text-sm text-base-content/60">
            Add the document types this lead needs, then upload per contact. Portal uploads appear here too.
          </p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void load()}>
          Refresh
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-base-200 bg-base-100/60 p-3">
        <label className="form-control min-w-[200px] flex-1 sm:max-w-xs">
          <span className="label-text mb-1 text-xs font-medium text-base-content/70">Document type</span>
          <select
            className="select select-bordered select-sm w-full"
            value={typeToAdd}
            onChange={(e) => setTypeToAdd(e.target.value)}
            disabled={addingType || availableTypesToAdd.length === 0}
          >
            <option value="">
              {availableTypesToAdd.length === 0 ? 'All types added' : 'Select type…'}
            </option>
            {availableTypesToAdd.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn btn-primary btn-sm gap-1"
          disabled={addingType || !typeToAdd}
          onClick={() => void handleAddDocumentType()}
        >
          {addingType ? <span className="loading loading-spinner loading-xs" /> : <PlusIcon className="h-4 w-4" />}
          Add
        </button>
      </div>

      <div className="w-full overflow-x-auto rounded-xl border border-base-200 bg-white shadow-sm">
        <table className="table w-full">
          <thead>
            <tr>
              <th className="whitespace-nowrap">Contact name</th>
              <th className="whitespace-nowrap">Relationship</th>
              {activeDocumentTypes.map((docType) => (
                <th key={docType.id} className="whitespace-nowrap text-center">
                  {docType.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {contacts.length === 0 ? (
              <tr>
                <td colSpan={Math.max(totalCols, 2)} className="py-16 text-center text-gray-500">
                  <UserGroupIcon className="mx-auto mb-4 h-16 w-16 text-gray-300" />
                  <p className="mb-1 text-lg font-medium">No contacts found</p>
                  <p className="text-sm text-gray-400">Add applicants in the Contact tab first</p>
                </td>
              </tr>
            ) : activeDocumentTypes.length === 0 ? (
              <tr>
                <td colSpan={2} className="py-16 text-center text-gray-500">
                  <DocumentIcon className="mx-auto mb-4 h-16 w-16 text-gray-300" />
                  <p className="mb-1 text-lg font-medium">No document types yet</p>
                  <p className="text-sm text-gray-400">
                    Use Add above to choose which documents this lead needs
                  </p>
                </td>
              </tr>
            ) : (
              contacts.map((contact) => (
                <tr key={contact.id} className="hover:bg-base-200/30">
                  <td className="whitespace-nowrap font-medium">{contact.name}</td>
                  <td className="whitespace-nowrap text-sm text-base-content/70">{contact.relationship}</td>
                  {activeDocumentTypes.map((docType) => renderDocumentCell(contact, docType))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <DocumentPreviewModal
        isOpen={previewOpen}
        onClose={() => setPreviewOpen(false)}
        documents={previewItems}
        initialIndex={previewIndex}
      />
    </div>
  );
};

export default DocumentsTab;
