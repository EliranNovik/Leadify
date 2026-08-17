import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import { DocumentPlusIcon, DocumentTextIcon, XMarkIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import type { DocumentViewerItem } from '../DocumentViewerModal';
import { ensureFinanceExpenseRegistry, type FinanceExpenseEntryRow } from '../../lib/financeExpenseCreate';
import {
  FINANCE_EXPENSE_DOC_MAX_FILES,
  FINANCE_EXPENSE_DOCUMENT_TYPE_LABEL,
  fetchFinanceExpenseDocumentsForEntries,
  signFinanceExpenseDocuments,
  uploadFinanceExpenseDocuments,
  validateFinanceExpenseDocumentFile,
  type FinanceExpenseDocumentRow,
  type FinanceExpenseDocumentType,
} from '../../lib/financeExpenseDocuments';

type Props = {
  open: boolean;
  row: FinanceExpenseEntryRow | null;
  onClose: () => void;
  onOpenDocument: (docs: DocumentViewerItem[], index: number) => void;
  onChanged?: () => void;
};

const DOC_TYPES: FinanceExpenseDocumentType[] = ['invoice', 'receipt', 'other'];

type PendingDoc = {
  localId: string;
  file: File;
  documentType: FinanceExpenseDocumentType;
};

function toViewerItems(
  signed: Array<FinanceExpenseDocumentRow & { signedUrl: string }>,
): DocumentViewerItem[] {
  return signed.map((doc) => ({
    id: String(doc.id),
    name: doc.file_name,
    url: doc.signedUrl,
    fileType: doc.mime_type || undefined,
    lastModified: doc.created_at,
    storagePath: doc.storage_path,
  }));
}

const ExpenseDocumentsDrawer: React.FC<Props> = ({ open, row, onClose, onOpenDocument, onChanged }) => {
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [docs, setDocs] = useState<DocumentViewerItem[]>([]);
  const [sourceDocs, setSourceDocs] = useState<FinanceExpenseDocumentRow[]>([]);
  const [pendingDocs, setPendingDocs] = useState<PendingDoc[]>([]);
  const [entryId, setEntryId] = useState<number | null>(null);

  useEffect(() => {
    if (!open || !row) {
      setDocs([]);
      setSourceDocs([]);
      setPendingDocs([]);
      setEntryId(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const initialId = row.id > 0 ? row.id : null;
    setEntryId(initialId);
    setPendingDocs([]);
    const source = row.documents || [];
    setSourceDocs(source);
    if (!source.length) {
      setDocs([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    void (async () => {
      const signed = await signFinanceExpenseDocuments(source);
      if (cancelled) return;
      if (signed.length < source.length) {
        toast.error('Some files could not be opened');
      }
      setDocs(toViewerItems(signed));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, row]);

  const reloadDocs = async (id: number) => {
    const map = await fetchFinanceExpenseDocumentsForEntries([id]);
    const source = map.get(id) || [];
    setSourceDocs(source);
    const signed = await signFinanceExpenseDocuments(source);
    setDocs(toViewerItems(signed));
  };

  const addFiles = (fileList: FileList | File[]) => {
    const incoming = Array.from(fileList);
    setPendingDocs((prev) => {
      const next = [...prev];
      for (const file of incoming) {
        if (sourceDocs.length + next.length >= FINANCE_EXPENSE_DOC_MAX_FILES) {
          toast.error(`You can attach up to ${FINANCE_EXPENSE_DOC_MAX_FILES} files`);
          break;
        }
        const errMsg = validateFinanceExpenseDocumentFile(file);
        if (errMsg) {
          toast.error(errMsg);
          continue;
        }
        const isDup = next.some((d) => d.file.name === file.name && d.file.size === file.size);
        if (isDup) continue;
        next.push({
          localId: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 7)}`,
          file,
          documentType: file.name.toLowerCase().includes('receipt') ? 'receipt' : 'invoice',
        });
      }
      return next;
    });
  };

  const handleUpload = async () => {
    if (!row || !pendingDocs.length) return;
    setUploading(true);
    try {
      let id = entryId;
      if (!id || id <= 0) {
        id = await ensureFinanceExpenseRegistry(row);
        setEntryId(id);
      }
      const uploaded = await uploadFinanceExpenseDocuments(
        id,
        pendingDocs.map((d) => ({ file: d.file, documentType: d.documentType })),
      );
      if (uploaded === 0) {
        toast.error('Could not upload documents');
        return;
      }
      if (uploaded < pendingDocs.length) {
        toast.error('Some files failed to upload');
      } else {
        toast.success(uploaded === 1 ? 'Document added' : `${uploaded} documents added`);
      }
      setPendingDocs([]);
      await reloadDocs(id);
      onChanged?.();
    } catch (err: any) {
      console.error('[ExpenseDocumentsDrawer] upload:', err);
      toast.error(err?.message || 'Failed to add documents');
    } finally {
      setUploading(false);
    }
  };

  if (!open || !row) return null;

  const subtitle = [row.vendor_label, row.lead_number, row.category_label].filter(Boolean).join(' · ');
  const remainingSlots = Math.max(0, FINANCE_EXPENSE_DOC_MAX_FILES - sourceDocs.length - pendingDocs.length);

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-[100]">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col overflow-hidden bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-6 py-5">
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-slate-900">Documents</h2>
            {subtitle ? <p className="mt-0.5 truncate text-sm text-slate-500">{subtitle}</p> : null}
          </div>
          <button type="button" className="btn btn-ghost btn-sm btn-circle" onClick={onClose} aria-label="Close">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="flex justify-center py-12">
              <span className="loading loading-spinner loading-md text-blue-600" />
            </div>
          ) : docs.length === 0 ? (
            <p className="pb-4 text-center text-sm text-slate-500">No documents yet. Add a file below.</p>
          ) : (
            <ul className="space-y-2">
              {docs.map((doc, index) => {
                const source = sourceDocs.find((d) => String(d.id) === doc.id);
                const typeLabel = source
                  ? FINANCE_EXPENSE_DOCUMENT_TYPE_LABEL[source.document_type]
                  : null;
                return (
                  <li key={doc.id}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 text-left hover:border-blue-300 hover:bg-blue-50/50"
                      onClick={() => onOpenDocument(docs, index)}
                    >
                      <DocumentTextIcon className="h-6 w-6 shrink-0 text-blue-600" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-slate-900">{doc.name}</p>
                        {typeLabel ? <p className="text-xs text-slate-500">{typeLabel}</p> : null}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="mt-5">
            <label className="label py-1">
              <span className="label-text font-medium text-slate-700">Add documents</span>
            </label>
            <label
              className={`flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center ${
                remainingSlots > 0 && !uploading
                  ? 'cursor-pointer hover:border-blue-400 hover:bg-blue-50/40'
                  : 'cursor-not-allowed opacity-60'
              }`}
              onDragOver={(e) => {
                e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (remainingSlots > 0 && !uploading && e.dataTransfer.files?.length) {
                  addFiles(e.dataTransfer.files);
                }
              }}
            >
              <DocumentPlusIcon className="h-8 w-8 text-slate-400" />
              <span className="text-sm font-medium text-slate-700">Drop PDF or image files here</span>
              <span className="text-xs text-slate-500">
                or click to browse · up to {FINANCE_EXPENSE_DOC_MAX_FILES} files
              </span>
              <input
                type="file"
                className="hidden"
                multiple
                disabled={remainingSlots <= 0 || uploading}
                accept="application/pdf,image/*,.doc,.docx,.xls,.xlsx"
                onChange={(e) => {
                  if (e.target.files?.length) addFiles(e.target.files);
                  e.target.value = '';
                }}
              />
            </label>
            {pendingDocs.length > 0 ? (
              <ul className="mt-2 space-y-2">
                {pendingDocs.map((doc) => (
                  <li
                    key={doc.localId}
                    className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800">{doc.file.name}</p>
                      <p className="text-xs text-slate-500">{Math.round(doc.file.size / 1024)} KB</p>
                    </div>
                    <select
                      className="select select-bordered select-xs w-28"
                      value={doc.documentType}
                      disabled={uploading}
                      onChange={(e) => {
                        const nextType = e.target.value as FinanceExpenseDocumentType;
                        setPendingDocs((prev) =>
                          prev.map((d) => (d.localId === doc.localId ? { ...d, documentType: nextType } : d)),
                        );
                      }}
                    >
                      {DOC_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {FINANCE_EXPENSE_DOCUMENT_TYPE_LABEL[t]}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs btn-circle"
                      aria-label="Remove file"
                      disabled={uploading}
                      onClick={() => setPendingDocs((prev) => prev.filter((d) => d.localId !== doc.localId))}
                    >
                      <XMarkIcon className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>

        {pendingDocs.length > 0 ? (
          <div className="border-t border-slate-200 px-6 py-4">
            <button
              type="button"
              className="btn btn-primary w-full"
              onClick={() => void handleUpload()}
              disabled={uploading}
            >
              {uploading ? (
                <span className="loading loading-spinner loading-sm" />
              ) : (
                `Upload ${pendingDocs.length} file${pendingDocs.length === 1 ? '' : 's'}`
              )}
            </button>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
};

export default ExpenseDocumentsDrawer;
