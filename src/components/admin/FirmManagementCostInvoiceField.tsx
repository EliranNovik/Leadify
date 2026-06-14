import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { DocumentArrowUpIcon, TrashIcon } from '@heroicons/react/24/outline';
import {
  fetchInvoicesForCostLine,
  openFirmInvoiceDocument,
  removeFirmInvoice,
  toBillingMonthStart,
  uploadInvoiceForFirmMonth,
  type FirmInvoiceDoc,
} from '../../lib/firmManagementCosts';
import { fileNameFromStoragePath } from '../../lib/firmManagementCostDocuments';
import FirmInvoiceDocumentsCell from './FirmInvoiceDocumentsCell';

function firmInvoiceLabel(inv: FirmInvoiceDoc): string {
  return inv.file_name?.trim() || fileNameFromStoragePath(inv.storage_path) || 'Invoice';
}

type FirmManagementCostInvoiceFieldProps = {
  value?: unknown;
  onChange?: (value: unknown) => void;
  record?: Record<string, unknown> | null;
  readOnly?: boolean;
  onInvoiceChanged?: () => void;
};

const FirmManagementCostInvoiceField: React.FC<FirmManagementCostInvoiceFieldProps> = ({
  record,
  readOnly,
  onInvoiceChanged,
}) => {
  const firmId = record?.firm_id != null ? String(record.firm_id) : '';
  const costId = record?.id != null ? String(record.id) : '';
  const billingMonth = record?.billing_month;
  const lineReady = Boolean(firmId && toBillingMonthStart(billingMonth));

  const [invoices, setInvoices] = useState<FirmInvoiceDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const reload = useCallback(async () => {
    if (!lineReady) {
      setInvoices([]);
      return;
    }
    setLoading(true);
    try {
      const rows = await fetchInvoicesForCostLine(costId, firmId, billingMonth);
      setInvoices(rows);
    } catch (err) {
      console.error(err);
      setInvoices([]);
    } finally {
      setLoading(false);
    }
  }, [costId, firmId, billingMonth, lineReady]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleUpload = async () => {
    if (!pendingFile || !lineReady) return;
    setUploading(true);
    try {
      await uploadInvoiceForFirmMonth(firmId, billingMonth, pendingFile, costId || null);
      toast.success('Invoice uploaded');
      setPendingFile(null);
      await reload();
      onInvoiceChanged?.();
    } catch (err: unknown) {
      console.error(err);
      const message = err instanceof Error ? err.message : 'Upload failed';
      toast.error(message);
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = async (inv: FirmInvoiceDoc) => {
    const label = firmInvoiceLabel(inv);
    if (!window.confirm(`Remove invoice "${label}"?`)) return;
    setRemovingId(inv.id);
    try {
      await removeFirmInvoice(inv);
      toast.success('Invoice removed');
      await reload();
      onInvoiceChanged?.();
    } catch (err: unknown) {
      console.error(err);
      const message = err instanceof Error ? err.message : 'Remove failed';
      toast.error(message);
    } finally {
      setRemovingId(null);
    }
  };

  if (!lineReady) {
    return (
      <p className="text-sm text-base-content/60 rounded-lg border border-dashed border-base-300 bg-base-200/30 px-3 py-4">
        Select <span className="font-medium">Firm</span> and <span className="font-medium">Month &amp; Year</span>{' '}
        above before uploading an invoice.
      </p>
    );
  }

  const withFiles = invoices.filter(inv => inv.storage_path?.trim());

  return (
    <div className="space-y-3 rounded-lg border border-base-300 bg-base-200/20 p-4">
      <p className="text-sm font-medium text-base-content">Invoice document</p>

      {loading ? (
        <span className="loading loading-spinner loading-sm text-primary" />
      ) : withFiles.length > 0 ? (
        <div className="space-y-2">
          {withFiles.map(inv => (
            <div
              key={inv.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-base-100 border border-base-300/60 px-3 py-2"
            >
              <FirmInvoiceDocumentsCell invoices={[inv]} />
              {!readOnly && (
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    onClick={() => void openFirmInvoiceDocument(inv)}
                  >
                    View
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs text-error"
                    disabled={removingId === inv.id}
                    onClick={() => void handleRemove(inv)}
                  >
                    {removingId === inv.id ? (
                      <span className="loading loading-spinner loading-xs" />
                    ) : (
                      <>
                        <TrashIcon className="h-4 w-4" />
                        Remove
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-base-content/50">No invoice file for this expense line.</p>
      )}

      {!readOnly && (
        <div className="flex flex-col sm:flex-row sm:items-end gap-2 pt-1">
          <input
            type="file"
            className="file-input file-input-bordered file-input-sm w-full flex-1"
            accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx"
            disabled={uploading}
            onChange={e => setPendingFile(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            className="btn btn-primary btn-sm gap-1 shrink-0"
            disabled={!pendingFile || uploading}
            onClick={() => void handleUpload()}
          >
            {uploading ? (
              <span className="loading loading-spinner loading-xs" />
            ) : (
              <DocumentArrowUpIcon className="h-4 w-4" />
            )}
            Upload
          </button>
        </div>
      )}
    </div>
  );
};

export default FirmManagementCostInvoiceField;
