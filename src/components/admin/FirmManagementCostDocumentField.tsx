import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { DocumentArrowUpIcon, TrashIcon } from '@heroicons/react/24/outline';
import { toBillingMonthStart } from '../../lib/firmManagementCosts';
import {
  fetchDocumentsForCostLine,
  openFirmManagementCostDocument,
  removeFirmManagementCostDocument,
  uploadFirmManagementCostDocument,
  type FirmManagementCostDocColumn,
  type FirmManagementCostDocument,
} from '../../lib/firmManagementCostDocuments';
import { FirmManagementCostDocumentsCell } from './FirmManagementCostDocumentCell';

type CustomFieldProps = {
  value: unknown;
  onChange: (value: unknown) => void;
  record?: { id?: string; firm_id?: string; billing_month?: unknown } | null;
  readOnly?: boolean;
};

type FirmManagementCostDocumentFieldProps = CustomFieldProps & {
  column: FirmManagementCostDocColumn;
  label: string;
  onDocumentsChanged?: () => void;
};

const FirmManagementCostDocumentField: React.FC<FirmManagementCostDocumentFieldProps> = ({
  record,
  readOnly,
  column,
  label,
  onDocumentsChanged,
}) => {
  const firmId = record?.firm_id != null ? String(record.firm_id) : '';
  const costId = record?.id != null ? String(record.id) : '';
  const billingMonth = record?.billing_month;
  const lineReady = Boolean(firmId && toBillingMonthStart(billingMonth));

  const [documents, setDocuments] = useState<FirmManagementCostDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const reload = useCallback(async () => {
    if (!lineReady) {
      setDocuments([]);
      return;
    }
    setLoading(true);
    try {
      const rows = await fetchDocumentsForCostLine(costId, column, firmId, billingMonth);
      setDocuments(rows);
    } catch (err) {
      console.error(err);
      setDocuments([]);
    } finally {
      setLoading(false);
    }
  }, [costId, firmId, billingMonth, column, lineReady]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleUpload = async () => {
    if (!pendingFile || !lineReady) return;
    setUploading(true);
    try {
      await uploadFirmManagementCostDocument(
        firmId,
        billingMonth,
        column,
        pendingFile,
        costId || null,
      );
      toast.success(`${label} uploaded`);
      setPendingFile(null);
      await reload();
      onDocumentsChanged?.();
    } catch (err: unknown) {
      console.error(err);
      const message = err instanceof Error ? err.message : 'Upload failed';
      toast.error(message);
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = async (doc: FirmManagementCostDocument) => {
    const docLabel = doc.file_name?.trim() || label;
    if (!window.confirm(`Remove ${docLabel}?`)) return;
    setRemovingId(doc.id);
    try {
      await removeFirmManagementCostDocument(doc);
      toast.success(`${label} removed`);
      await reload();
      onDocumentsChanged?.();
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
        above before uploading {label.toLowerCase()}.
      </p>
    );
  }

  const withFiles = documents.filter(doc => doc.storage_path?.trim());

  return (
    <div className="space-y-3 rounded-lg border border-base-300 bg-base-200/20 p-4">
      <p className="text-sm font-medium text-base-content">{label}</p>

      {loading ? (
        <span className="loading loading-spinner loading-sm text-primary" />
      ) : withFiles.length > 0 ? (
        <div className="space-y-2">
          {withFiles.map(doc => (
            <div
              key={doc.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-base-100 border border-base-300/60 px-3 py-2"
            >
              <FirmManagementCostDocumentsCell documents={[doc]} column={column} linkLabel={label} />
              {!readOnly && (
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    onClick={() => void openFirmManagementCostDocument(column, doc.storage_path)}
                  >
                    View
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs text-error"
                    disabled={removingId === doc.id}
                    onClick={() => void handleRemove(doc)}
                  >
                    {removingId === doc.id ? (
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
        <p className="text-sm text-base-content/50">No {label.toLowerCase()} uploaded.</p>
      )}

      {!readOnly && (
        <div className="flex flex-col sm:flex-row sm:items-end gap-2 pt-1">
          <input
            type="file"
            className="file-input file-input-bordered file-input-sm w-full flex-1"
            accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx"
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

export const FirmManagementCostPaymentConfirmationField: React.FC<CustomFieldProps> = props => (
  <FirmManagementCostDocumentField {...props} column="payment_confirmation" label="Payment confirmation" />
);

export const FirmManagementCostTaxReceiptField: React.FC<CustomFieldProps> = props => (
  <FirmManagementCostDocumentField {...props} column="tax_receipt" label="Tax receipt" />
);

export default FirmManagementCostDocumentField;
