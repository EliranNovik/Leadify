import React, { useCallback, useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import {
  DocumentPlusIcon,
  DocumentTextIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import DocumentViewerModal, { type DocumentViewerItem } from '../DocumentViewerModal';
import {
  clearPaymentPlanTaxInvoiceSent,
  markPaymentPlanTaxInvoiceSent,
  taxInvoiceDateKeyFromSentAt,
  taxInvoiceSentAtFromDateKey,
  taxInvoiceTodayDateKey,
  type PaymentPlanTaxInvoiceState,
} from '../../lib/markPaymentPlanTaxInvoiceSent';
import {
  PAYMENT_PLAN_TAX_INVOICE_DOCUMENTS_BUCKET,
  TAX_INVOICE_DOC_MAX_FILES,
  deletePaymentPlanTaxInvoiceDocument,
  fetchEmployeeProfiles,
  fetchPaymentPlanTaxInvoiceDocuments,
  fetchPaymentPlanTaxInvoiceState,
  signPaymentPlanTaxInvoiceDocuments,
  taxInvoiceWriteTarget,
  uploadPaymentPlanTaxInvoiceDocuments,
  validateTaxInvoiceDocumentFile,
  type EmployeeProfile,
  type PaymentPlanTaxInvoiceDocumentRow,
  type TaxInvoiceDocumentTarget,
} from '../../lib/paymentPlanTaxInvoiceDocuments';

type Props = {
  open: boolean;
  /** Which payment row this is about. Null closes the drawer. */
  target: TaxInvoiceDocumentTarget | null;
  /** Lead / client line under the heading, so the drawer says what it is about. */
  subtitle?: string;
  onClose: () => void;
  /** Called after a successful save or clear, so the host can patch its own row in place. */
  onSaved?: (state: PaymentPlanTaxInvoiceState) => void;
};

type PendingDoc = {
  localId: string;
  file: File;
};

type SignedDoc = PaymentPlanTaxInvoiceDocumentRow & {
  signedUrl: string;
  /** Resolved from `uploaded_by_employee_id` when the drawer loads. */
  uploaderName?: string;
};

function formatFileSize(bytes: number | null): string {
  if (!bytes) return '';
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const EmployeeAvatar: React.FC<{ profile: EmployeeProfile }> = ({ profile }) =>
  profile.photoUrl ? (
    <img src={profile.photoUrl} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
  ) : (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[10px] font-bold text-blue-700">
      {profile.name
        .split(' ')
        .map((word) => word[0])
        .join('')
        .toUpperCase()
        .slice(0, 2) || '?'}
    </div>
  );

function toViewerItems(docs: SignedDoc[]): DocumentViewerItem[] {
  return docs.map((doc) => ({
    id: String(doc.id),
    name: doc.file_name,
    url: doc.signedUrl,
    fileType: doc.mime_type || undefined,
    lastModified: doc.created_at,
    storagePath: doc.storage_path,
    storageBucket: PAYMENT_PLAN_TAX_INVOICE_DOCUMENTS_BUCKET,
  }));
}

/**
 * The manual "tax invoice sent" record: when it went out, who said so, and the invoice files.
 *
 * Reads its own state when opened rather than taking it from the host, so the client's Finances tab
 * and the collection report cannot show different things for the same payment row.
 */
const TaxInvoiceSentDrawer: React.FC<Props> = ({ open, target, subtitle, onClose, onSaved }) => {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [state, setState] = useState<PaymentPlanTaxInvoiceState | null>(null);
  const [dateKey, setDateKey] = useState('');
  const [sentBy, setSentBy] = useState<EmployeeProfile | null>(null);
  const [docs, setDocs] = useState<SignedDoc[]>([]);
  const [pendingDocs, setPendingDocs] = useState<PendingDoc[]>([]);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  const planId = target?.paymentPlanId ?? null;
  const isLegacy = target?.isLegacy ?? false;

  const loadDocs = useCallback(async (loadTarget: TaxInvoiceDocumentTarget) => {
    const rows = await fetchPaymentPlanTaxInvoiceDocuments(loadTarget);
    const signed = await signPaymentPlanTaxInvoiceDocuments(rows);
    if (signed.length < rows.length) {
      toast.error('Some files could not be opened');
    }
    return signed;
  }, []);

  useEffect(() => {
    if (!open || planId == null) {
      setState(null);
      setDateKey('');
      setSentBy(null);
      setDocs([]);
      setPendingDocs([]);
      setViewerIndex(null);
      setLoading(false);
      return;
    }
    const loadTarget: TaxInvoiceDocumentTarget = { paymentPlanId: planId, isLegacy };
    let cancelled = false;
    setLoading(true);
    setPendingDocs([]);
    void (async () => {
      const [saved, signed] = await Promise.all([
        fetchPaymentPlanTaxInvoiceState(loadTarget),
        loadDocs(loadTarget),
      ]);
      if (cancelled) return;
      // Every id asked about at once, so naming the recorder and the uploaders costs one query.
      const profiles = await fetchEmployeeProfiles([
        ...(saved.sentByEmployeeId != null ? [saved.sentByEmployeeId] : []),
        ...signed
          .map((doc) => doc.uploaded_by_employee_id)
          .filter((id): id is number => id != null),
      ]);
      if (cancelled) return;
      setState(saved);
      setDateKey(
        saved.sentAt ? taxInvoiceDateKeyFromSentAt(saved.sentAt) : taxInvoiceTodayDateKey(),
      );
      setSentBy(saved.sentByEmployeeId != null ? profiles.get(saved.sentByEmployeeId) ?? null : null);
      setDocs(
        signed.map((doc) => ({
          ...doc,
          uploaderName:
            doc.uploaded_by_employee_id != null
              ? profiles.get(doc.uploaded_by_employee_id)?.name.trim() || ''
              : '',
        })),
      );
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, planId, isLegacy, loadDocs]);

  const addFiles = (fileList: FileList | File[]) => {
    const incoming = Array.from(fileList);
    setPendingDocs((prev) => {
      const next = [...prev];
      for (const file of incoming) {
        if (docs.length + next.length >= TAX_INVOICE_DOC_MAX_FILES) {
          toast.error(`You can attach up to ${TAX_INVOICE_DOC_MAX_FILES} files`);
          break;
        }
        const errMsg = validateTaxInvoiceDocumentFile(file);
        if (errMsg) {
          toast.error(errMsg);
          continue;
        }
        const isDup = next.some((d) => d.file.name === file.name && d.file.size === file.size);
        if (isDup) continue;
        next.push({
          localId: `${file.name}-${file.size}-${file.lastModified}-${Math.random()
            .toString(36)
            .slice(2, 7)}`,
          file,
        });
      }
      return next;
    });
  };

  /**
   * Saves the date and uploads the queued files together, because a file attached to a row that was
   * never marked sent would be invisible everywhere.
   */
  const handleSave = async () => {
    if (planId == null) return;
    if (!dateKey) {
      toast.error('Pick the date the tax invoice was sent');
      return;
    }
    const writeTarget: TaxInvoiceDocumentTarget = { paymentPlanId: planId, isLegacy };
    setSaving(true);
    try {
      const result = await markPaymentPlanTaxInvoiceSent({
        ...taxInvoiceWriteTarget(writeTarget),
        sentAt: taxInvoiceSentAtFromDateKey(dateKey),
      });
      if (!result.ok) {
        toast.error(`Could not save the tax invoice date: ${result.error ?? 'unknown error'}`);
        return;
      }

      if (pendingDocs.length) {
        setUploading(true);
        const uploaded = await uploadPaymentPlanTaxInvoiceDocuments(
          writeTarget,
          pendingDocs.map((d) => d.file),
        );
        setUploading(false);
        if (uploaded < pendingDocs.length) {
          toast.error('Some files failed to upload');
        }
        setPendingDocs([]);
        setDocs(await loadDocs(writeTarget));
      }

      setState({ sent: result.sent, sentAt: result.sentAt, sentByEmployeeId: result.sentByEmployeeId });
      onSaved?.({
        sent: result.sent,
        sentAt: result.sentAt,
        sentByEmployeeId: result.sentByEmployeeId,
      });
      toast.success('Tax invoice marked as sent');
      onClose();
    } finally {
      setSaving(false);
      setUploading(false);
    }
  };

  /** Drops the mark but keeps the files, which are evidence either way. */
  const handleClear = async () => {
    if (planId == null) return;
    setSaving(true);
    try {
      const result = await clearPaymentPlanTaxInvoiceSent(
        taxInvoiceWriteTarget({ paymentPlanId: planId, isLegacy }),
      );
      if (!result.ok) {
        toast.error(`Could not remove the tax invoice mark: ${result.error ?? 'unknown error'}`);
        return;
      }
      const cleared = { sent: false, sentAt: null, sentByEmployeeId: null };
      setState(cleared);
      onSaved?.(cleared);
      toast.success('Tax invoice mark removed');
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteDoc = async (doc: SignedDoc) => {
    if (planId == null) return;
    const removed = await deletePaymentPlanTaxInvoiceDocument(doc);
    if (!removed) return;
    setDocs((prev) => prev.filter((d) => d.id !== doc.id));
    toast.success('File removed');
  };

  if (!open || planId == null) return null;

  const busy = saving || uploading;
  const remainingSlots = Math.max(0, TAX_INVOICE_DOC_MAX_FILES - docs.length - pendingDocs.length);
  const viewerItems = toViewerItems(docs);

  return ReactDOM.createPortal(
    <>
      <div className="fixed inset-0 z-[100]">
        <div className="absolute inset-0 bg-black/30" onClick={() => !busy && onClose()} />
        <div className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col overflow-hidden bg-white shadow-2xl">
          <div className="flex items-start justify-between gap-3 px-6 py-5">
            <div className="min-w-0">
              <h2 className="text-xl font-bold text-slate-900">Tax invoice sent</h2>
              {subtitle ? (
                <p className="mt-0.5 truncate text-sm text-slate-500">{subtitle}</p>
              ) : null}
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm btn-circle"
              onClick={onClose}
              disabled={busy}
              aria-label="Close"
            >
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>

          {loading ? (
            <div className="flex flex-1 items-center justify-center">
              <span className="loading loading-spinner loading-md text-blue-600" />
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <label className="form-control">
                <span className="label-text mb-1 font-medium text-slate-700">Date sent</span>
                <input
                  type="date"
                  className="input input-bordered w-full"
                  value={dateKey}
                  max={taxInvoiceTodayDateKey()}
                  onChange={(e) => setDateKey(e.target.value)}
                  disabled={busy}
                />
              </label>

              {/* Nothing to attribute until the mark exists. */}
              {state?.sent ? (
                <div className="mt-3 flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm">
                  {sentBy ? <EmployeeAvatar profile={sentBy} /> : null}
                  <span className="min-w-0">
                    <span className="text-slate-500">Marked by</span>{' '}
                    <span className="font-medium text-slate-800">
                      {sentBy?.name.trim() || 'Unknown employee'}
                    </span>
                  </span>
                </div>
              ) : null}

              <div className="mt-5">
                <span className="label-text font-medium text-slate-700">Invoice files</span>
                {docs.length === 0 ? (
                  <p className="py-3 text-sm text-slate-500">
                    No files yet. Drop the invoice below to keep a copy on the payment.
                  </p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {docs.map((doc, index) => {
                      const uploader = doc.uploaderName;
                      const meta = [
                        formatFileSize(doc.file_size),
                        new Date(doc.created_at).toLocaleDateString(),
                        uploader,
                      ]
                        .filter(Boolean)
                        .join(' \u00b7 ');
                      return (
                        <li key={doc.id} className="flex items-center gap-1">
                          <button
                            type="button"
                            className="flex min-w-0 flex-1 items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 text-left hover:border-blue-300 hover:bg-blue-50/50"
                            onClick={() => setViewerIndex(index)}
                          >
                            <DocumentTextIcon className="h-6 w-6 shrink-0 text-blue-600" />
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-medium text-slate-900">{doc.file_name}</p>
                              {meta ? <p className="truncate text-xs text-slate-500">{meta}</p> : null}
                            </div>
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm btn-circle text-error"
                            aria-label={`Remove ${doc.file_name}`}
                            disabled={busy}
                            onClick={() => void handleDeleteDoc(doc)}
                          >
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}

                <label
                  className={`mt-3 flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center ${
                    remainingSlots > 0 && !busy
                      ? 'cursor-pointer hover:border-blue-400 hover:bg-blue-50/40'
                      : 'cursor-not-allowed opacity-60'
                  }`}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (remainingSlots > 0 && !busy && e.dataTransfer.files?.length) {
                      addFiles(e.dataTransfer.files);
                    }
                  }}
                >
                  <DocumentPlusIcon className="h-8 w-8 text-slate-400" />
                  <span className="text-sm font-medium text-slate-700">
                    Drop PDF or image files here
                  </span>
                  <span className="text-xs text-slate-500">
                    or click to browse · up to {TAX_INVOICE_DOC_MAX_FILES} files
                  </span>
                  <input
                    type="file"
                    className="hidden"
                    multiple
                    disabled={remainingSlots <= 0 || busy}
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
                          <p className="truncate text-sm font-medium text-slate-800">
                            {doc.file.name}
                          </p>
                          <p className="text-xs text-slate-500">{formatFileSize(doc.file.size)}</p>
                        </div>
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs btn-circle"
                          aria-label="Remove file"
                          disabled={busy}
                          onClick={() =>
                            setPendingDocs((prev) => prev.filter((d) => d.localId !== doc.localId))
                          }
                        >
                          <XMarkIcon className="h-4 w-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-2 px-6 py-4">
            {/* Only an existing mark can be taken back. */}
            {state?.sent ? (
              <button
                type="button"
                className="btn btn-ghost text-error"
                onClick={() => void handleClear()}
                disabled={busy}
              >
                Not sent
              </button>
            ) : (
              <span />
            )}
            <span className="flex gap-2">
              <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary rounded-full px-8"
                onClick={() => void handleSave()}
                disabled={busy || loading}
              >
                {busy ? (
                  <span className="loading loading-spinner loading-sm" />
                ) : pendingDocs.length ? (
                  `Save & upload ${pendingDocs.length}`
                ) : (
                  'Save'
                )}
              </button>
            </span>
          </div>
        </div>
      </div>

      <DocumentViewerModal
        isOpen={viewerIndex !== null && viewerItems.length > 0}
        onClose={() => setViewerIndex(null)}
        documents={viewerItems}
        initialIndex={viewerIndex ?? 0}
        bucketName={PAYMENT_PLAN_TAX_INVOICE_DOCUMENTS_BUCKET}
      />
    </>,
    document.body,
  );
};

export default TaxInvoiceSentDrawer;
