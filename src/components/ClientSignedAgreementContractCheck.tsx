import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { DocumentArrowUpIcon } from '@heroicons/react/24/outline';
import { CASE_DOCUMENTS_STORAGE_BUCKET } from '../lib/caseDocumentsStorage';
import { fetchStageActorInfo } from '../lib/leadStageManager';
import {
  fetchContractDocuments,
  uploadContractCaseDocument,
  type CaseCategoryDocument,
} from '../lib/sequenceOfEventsDocuments';
import DocumentSidebarThumb from './DocumentSidebarThumb';
import { DocumentPreviewModal } from './DocumentModal';

type Props = {
  open: boolean;
  leadNumber: string;
  clientId?: string | null;
  onReadyChange: (ready: boolean) => void;
  onMissingChange: (missing: boolean) => void;
};

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.heic,.heif,.doc,.docx';

const ClientSignedAgreementContractCheck: React.FC<Props> = ({
  open,
  leadNumber,
  clientId,
  onReadyChange,
  onMissingChange,
}) => {
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [docs, setDocs] = useState<CaseCategoryDocument[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const loadDocs = useCallback(async () => {
    const lead = leadNumber.trim();
    if (!lead) {
      setDocs([]);
      setError('Add a lead number to upload the physical contract.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchContractDocuments(lead, clientId);
      setDocs(rows);
    } catch (err) {
      console.error('Failed to load contract documents:', err);
      setDocs([]);
      setError(err instanceof Error ? err.message : 'Failed to load contract documents.');
    } finally {
      setLoading(false);
    }
  }, [leadNumber, clientId]);

  useEffect(() => {
    if (!open) return;
    setConfirmed(false);
    setIsDragOver(false);
    setPreviewIndex(null);
    void loadDocs();
  }, [open, loadDocs]);

  useEffect(() => {
    const missing = docs.length === 0;
    onMissingChange(missing);
    onReadyChange(!uploading && !loading && (missing || confirmed));
  }, [docs.length, confirmed, uploading, loading, onReadyChange, onMissingChange]);

  const handleFile = async (file: File | undefined) => {
    if (!file || uploading) return;
    const lead = leadNumber.trim();
    if (!lead) {
      toast.error('Add a lead number to upload the physical contract.');
      return;
    }
    setUploading(true);
    try {
      const actor = await fetchStageActorInfo();
      await uploadContractCaseDocument({
        leadNumber: lead,
        file,
        uploadedBy: actor.fullName?.trim() || 'Unknown',
      });
      toast.success('Physical contract uploaded.');
      setConfirmed(false);
      await loadDocs();
    } catch (err) {
      console.error('Physical contract upload failed:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to upload the physical contract.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const hasDocs = docs.length > 0;
  const previewDocs = docs.map((d) => ({
    id: d.id,
    name: d.name,
    downloadUrl: d.url,
    fileType: d.fileType,
    lastModified: d.lastModified,
    storagePath: d.storagePath,
  }));

  return (
    <div className="flex flex-col gap-3">
      {loading ? (
        <p className="text-sm text-base-content/60">Checking contract documents…</p>
      ) : error && !hasDocs ? (
        <p className="text-sm text-error">{error}</p>
      ) : !hasDocs ? (
        <div>
          <label htmlFor={fileInputId} className="block font-semibold mb-1">
            Physical contract
          </label>
          <p className="mb-2 text-sm font-medium text-amber-700">
            The physical contract is missing.
          </p>
          <p className="mb-2 text-sm text-base-content/65">Upload it here.</p>
          <input
            id={fileInputId}
            ref={fileInputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            disabled={uploading || !leadNumber.trim()}
            onChange={(e) => void handleFile(e.target.files?.[0])}
          />
          <button
            type="button"
            disabled={uploading || !leadNumber.trim()}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!uploading && leadNumber.trim()) setIsDragOver(true);
            }}
            onDragEnter={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!uploading && leadNumber.trim()) setIsDragOver(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDragOver(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDragOver(false);
              void handleFile(e.dataTransfer.files?.[0]);
            }}
            className={`w-full rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors duration-200 ${
              uploading
                ? 'border-primary bg-gray-50'
                : isDragOver
                  ? 'border-primary bg-purple-50'
                  : 'border-gray-300 bg-gray-50 hover:border-primary hover:bg-purple-50'
            } ${uploading || !leadNumber.trim() ? 'pointer-events-none opacity-50' : ''}`}
          >
            <DocumentArrowUpIcon className="pointer-events-none mx-auto mb-3 h-10 w-10 text-gray-400" />
            <div className="pointer-events-none text-sm text-gray-600">
              {uploading ? 'Uploading…' : 'Drag and drop the contract here, or click to upload'}
            </div>
          </button>
        </div>
      ) : (
        <div>
          <div className="mb-1 font-semibold">Physical contract</div>
          <p className="mb-3 text-sm text-base-content/65">
            Please confirm this is the actual signed contract of the client before continuing.
          </p>
          <div className="flex flex-col gap-2">
            {docs.map((doc, index) => (
              <button
                key={doc.id}
                type="button"
                className="flex w-full items-stretch gap-3 rounded-xl bg-gray-100 p-2 text-left transition-colors hover:bg-gray-200/80"
                onClick={() => setPreviewIndex(index)}
              >
                <div className="w-16 shrink-0 overflow-hidden rounded-lg bg-white">
                  <DocumentSidebarThumb
                    name={doc.name}
                    url={doc.url}
                    fileType={doc.fileType}
                    storagePath={doc.storagePath}
                    bucketName={CASE_DOCUMENTS_STORAGE_BUCKET}
                  />
                </div>
                <div className="min-w-0 flex-1 py-1">
                  <div className="truncate text-sm font-medium text-base-content">{doc.name}</div>
                  <div className="mt-0.5 text-xs text-base-content/50">Tap to preview</div>
                </div>
              </button>
            ))}
          </div>
          <label className="mt-3 flex cursor-pointer items-start gap-2.5 text-sm text-base-content/80">
            <input
              type="checkbox"
              className="checkbox checkbox-sm mt-0.5 rounded-md"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            <span>I confirm this is the actual signed contract of the client.</span>
          </label>
        </div>
      )}

      <DocumentPreviewModal
        isOpen={previewIndex !== null && previewDocs.length > 0}
        onClose={() => setPreviewIndex(null)}
        documents={previewDocs}
        initialIndex={previewIndex ?? 0}
      />
    </div>
  );
};

export default ClientSignedAgreementContractCheck;
