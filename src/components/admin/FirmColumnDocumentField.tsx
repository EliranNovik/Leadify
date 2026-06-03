import React, { useState } from 'react';
import { toast } from 'react-hot-toast';
import { DocumentArrowUpIcon, TrashIcon } from '@heroicons/react/24/outline';
import {
  fileNameFromStoragePath,
  openFirmColumnDocument,
  removeFirmColumnDocument,
  uploadFirmColumnDocument,
  type FirmDocumentColumn,
} from '../../lib/firmColumnDocuments';
import FirmColumnDocumentCell from './FirmColumnDocumentCell';

type CustomFieldProps = {
  value: any;
  onChange: (value: any) => void;
  record?: { id?: string } | null;
  readOnly?: boolean;
};

type FirmColumnDocumentFieldProps = CustomFieldProps & {
  column: FirmDocumentColumn;
  label: string;
};

function FirmColumnDocumentField({
  value,
  onChange,
  record,
  readOnly,
  column,
  label,
}: FirmColumnDocumentFieldProps) {
  const firmId = record?.id != null ? String(record.id) : '';
  const storagePath = typeof value === 'string' ? value.trim() : '';
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const handleUpload = async () => {
    if (!pendingFile || !firmId) return;
    setUploading(true);
    try {
      const path = await uploadFirmColumnDocument(firmId, column, pendingFile);
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
    if (!firmId || !storagePath) return;
    if (!window.confirm(`Remove ${label.toLowerCase()} document?`)) return;
    setRemoving(true);
    try {
      await removeFirmColumnDocument(firmId, column);
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

  if (!firmId) {
    return (
      <p className="text-sm text-base-content/60 rounded-lg border border-dashed border-base-300 bg-base-200/30 px-3 py-4">
        Save this firm first, then upload {label.toLowerCase()} here.
      </p>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-base-300 bg-base-200/20 p-4">
      <p className="text-sm font-medium text-base-content">{label}</p>

      {storagePath ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-base-100 border border-base-300/60 px-3 py-2">
          <FirmColumnDocumentCell storagePath={storagePath} column={column} linkLabel={label} />
          {!readOnly && (
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                onClick={() => void openFirmColumnDocument(column, storagePath)}
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
        <p className="text-sm text-base-content/50">No {label.toLowerCase()} file uploaded.</p>
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
            {storagePath ? 'Replace' : 'Upload'}
          </button>
        </div>
      )}
    </div>
  );
}

export function FirmContract1Field(props: CustomFieldProps) {
  return <FirmColumnDocumentField {...props} column="contract" label="Contract" />;
}

export function FirmContract2Field(props: CustomFieldProps) {
  return <FirmColumnDocumentField {...props} column="contract_2" label="Contract 2" />;
}

export function FirmInvoicesField(props: CustomFieldProps) {
  return <FirmColumnDocumentField {...props} column="invoices" label="Invoices" />;
}

export function FirmOtherDocsField(props: CustomFieldProps) {
  return <FirmColumnDocumentField {...props} column="other_docs" label="Other documents" />;
}

export default FirmColumnDocumentField;
