import React, { useState } from 'react';
import { toast } from 'react-hot-toast';
import { DocumentArrowUpIcon, TrashIcon } from '@heroicons/react/24/outline';
import {
  openOfficeExpenseDocument,
  removeOfficeExpenseDocument,
  uploadOfficeExpenseDocument,
  type OfficeExpenseDocColumn,
} from '../../lib/officeExpenseDocuments';
import OfficeExpenseDocumentCell from './OfficeExpenseDocumentCell';

type CustomFieldProps = {
  value: unknown;
  onChange: (value: unknown) => void;
  record?: { id?: string } | null;
  readOnly?: boolean;
};

type OfficeExpenseDocumentFieldProps = CustomFieldProps & {
  column: OfficeExpenseDocColumn;
  label: string;
};

const OfficeExpenseDocumentField: React.FC<OfficeExpenseDocumentFieldProps> = ({
  value,
  onChange,
  record,
  readOnly,
  column,
  label,
}) => {
  const expenseRowId = record?.id != null ? String(record.id) : '';
  const storagePath = typeof value === 'string' ? value.trim() : '';
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const handleUpload = async () => {
    if (!pendingFile || !expenseRowId) return;
    setUploading(true);
    try {
      const path = await uploadOfficeExpenseDocument(expenseRowId, column, pendingFile);
      onChange(path);
      toast.success(`${label} uploaded`);
      setPendingFile(null);
    } catch (err: unknown) {
      console.error(err);
      const message = err instanceof Error ? err.message : 'Upload failed';
      toast.error(message);
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = async () => {
    if (!expenseRowId || !storagePath) return;
    if (!window.confirm(`Remove ${label.toLowerCase()}?`)) return;
    setRemoving(true);
    try {
      await removeOfficeExpenseDocument(expenseRowId, column);
      onChange(null);
      toast.success(`${label} removed`);
    } catch (err: unknown) {
      console.error(err);
      const message = err instanceof Error ? err.message : 'Remove failed';
      toast.error(message);
    } finally {
      setRemoving(false);
    }
  };

  if (!expenseRowId) {
    return (
      <p className="text-sm text-base-content/60 rounded-lg border border-dashed border-base-300 bg-base-200/30 px-3 py-4">
        Save this entry first, then upload {label.toLowerCase()} here.
      </p>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-base-300 bg-base-200/20 p-4">
      <p className="text-sm font-medium text-base-content">{label}</p>

      {storagePath ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-base-100 border border-base-300/60 px-3 py-2">
          <OfficeExpenseDocumentCell storagePath={storagePath} column={column} linkLabel={label} />
          {!readOnly && (
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                onClick={() => void openOfficeExpenseDocument(column, storagePath)}
              >
                View
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-xs text-error"
                disabled={removing}
                onClick={() => void handleRemove()}
              >
                {removing ? (
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

export const OfficeExpenseInvoiceField: React.FC<CustomFieldProps> = props => (
  <OfficeExpenseDocumentField {...props} column="invoice" label="Invoice" />
);

export const OfficeExpensePaymentConfirmationField: React.FC<CustomFieldProps> = props => (
  <OfficeExpenseDocumentField {...props} column="payment_confirmation" label="Payment confirmation" />
);

export const OfficeExpenseTaxReceiptField: React.FC<CustomFieldProps> = props => (
  <OfficeExpenseDocumentField {...props} column="tax_receipt" label="Tax receipt" />
);

export default OfficeExpenseDocumentField;
