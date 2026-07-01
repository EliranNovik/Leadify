import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownTrayIcon,
  CheckCircleIcon,
  DocumentArrowUpIcon,
  EyeIcon,
  PaperClipIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import {
  DocumentPreviewModal,
  type DocumentPreviewItem,
} from '../../../components/DocumentModal';
import { DocumentFileGlyph, inferDocumentFileKind } from '../../../lib/documentFileGlyphs';
import {
  portalUploadDocument,
  type PortalDocumentClassification,
  type PortalDocumentRow,
} from '../../../lib/portalApi';
import {
  getPortalTabHeaderCoverImage,
  PortalCard,
  PortalLoading,
  PortalTabFrame,
} from '../components/portalTheme';
import { usePortalTabData } from '../context/PortalTabDataContext';

type UploadedFile = {
  name: string;
  status: 'uploading' | 'success' | 'error';
  progress: number;
  error?: string;
};

type PortalDocumentTabKey = 'sequence' | 'expert' | 'legal_claims' | 'contract';

type PortalDocumentTab = {
  key: PortalDocumentTabKey;
  id: string;
  label: string;
};

const PORTAL_DOCUMENT_TAB_DEFS: ReadonlyArray<{
  key: PortalDocumentTabKey;
  label: string;
  slugs: readonly string[];
  labelMatches: readonly string[];
}> = [
  {
    key: 'sequence',
    label: 'Sequence of Events',
    slugs: ['sequence_of_events', 'sequence-of-events'],
    labelMatches: ['sequence of events'],
  },
  {
    key: 'expert',
    label: 'Expert',
    slugs: ['expert'],
    labelMatches: ['expert'],
  },
  {
    key: 'legal_claims',
    label: 'Legal claims',
    slugs: ['legal_claims', 'legal-claims'],
    labelMatches: ['legal claims'],
  },
  {
    key: 'contract',
    label: 'Contract',
    slugs: ['contract'],
    labelMatches: ['contract'],
  },
];

function resolvePortalDocumentTabs(classifications: PortalDocumentClassification[]): PortalDocumentTab[] {
  return PORTAL_DOCUMENT_TAB_DEFS.map((def) => {
    const match = classifications.find((c) => {
      const slug = c.slug.toLowerCase();
      const label = c.label.toLowerCase();
      return def.slugs.includes(slug) || def.labelMatches.some((m) => label.includes(m));
    });
    return {
      key: def.key,
      id: match?.id ?? def.key,
      label: match?.label ?? def.label,
    };
  });
}

function documentMatchesPortalTab(doc: PortalDocumentRow, tab: PortalDocumentTab): boolean {
  const def = PORTAL_DOCUMENT_TAB_DEFS.find((d) => d.key === tab.key);
  if (!def) return false;

  if (tab.id !== tab.key && doc.classification_id === tab.id) return true;

  const slug = (doc.classification_slug ?? '').toLowerCase();
  const label = (doc.classification_label ?? '').toLowerCase();
  if (def.slugs.some((s) => slug === s)) return true;
  if (def.labelMatches.some((m) => label.includes(m))) return true;

  const hasCategoryMeta = Boolean(
    doc.classification_id || doc.classification_slug || doc.classification_label,
  );
  if (tab.key === 'sequence' && !hasCategoryMeta) return true;

  return false;
}

function inferPortalDocumentMimeType(doc: PortalDocumentRow): string {
  const mime = doc.mime_type?.trim();
  if (mime) return mime;
  const ext = doc.file_name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'doc') return 'application/msword';
  if (ext === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  return 'application/octet-stream';
}

function PortalDocumentPreview({
  url,
  fileName,
  mimeType,
  onOpen,
}: {
  url: string | null;
  fileName: string;
  mimeType: string;
  onOpen?: () => void;
}) {
  const [broken, setBroken] = useState(false);
  const kind = inferDocumentFileKind(mimeType, fileName);
  const frameClass =
    'relative h-24 w-28 shrink-0 overflow-hidden rounded-xl border border-base-200 bg-base-100 sm:h-28 sm:w-36 md:h-32 md:w-40';

  useEffect(() => {
    setBroken(false);
  }, [url, fileName, mimeType]);

  const openProps = onOpen
    ? {
        type: 'button' as const,
        onClick: (e: React.MouseEvent) => {
          e.stopPropagation();
          onOpen();
        },
      }
    : url
      ? {
          href: url,
          target: '_blank',
          rel: 'noopener noreferrer',
        }
      : {};

  const Wrapper = onOpen ? 'button' : url ? 'a' : 'div';

  const fallback = (
    <div className={`${frameClass} flex items-center justify-center`}>
      <DocumentFileGlyph fileType={mimeType} fileName={fileName} className="h-10 w-10 opacity-60" />
    </div>
  );

  if (!url) return fallback;

  if (kind === 'image' && !broken) {
    return (
      <Wrapper
        {...openProps}
        className={`${frameClass} block ${onOpen ? 'cursor-pointer transition-shadow hover:shadow-md' : ''}`}
        aria-label={`Preview ${fileName}`}
      >
        <img
          src={url}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          onError={() => setBroken(true)}
        />
      </Wrapper>
    );
  }

  if (kind === 'pdf') {
    return (
      <Wrapper
        {...openProps}
        className={`${frameClass} block bg-white ${onOpen ? 'cursor-pointer transition-shadow hover:shadow-md' : ''}`}
        aria-label={`Preview ${fileName}`}
      >
        <iframe
          src={`${url}#toolbar=0&navpanes=0&view=FitH`}
          title={fileName}
          className="pointer-events-none h-full w-full scale-[1.02] border-0 bg-white"
        />
      </Wrapper>
    );
  }

  return (
    <Wrapper
      {...openProps}
      className={`${frameClass} flex flex-col items-center justify-center gap-1 p-2 transition-colors ${
        onOpen ? 'cursor-pointer hover:bg-base-200/60 hover:shadow-md' : 'hover:bg-base-200/60'
      }`}
      aria-label={`Open ${fileName}`}
    >
      <DocumentFileGlyph fileType={mimeType} fileName={fileName} className="h-10 w-10" />
      <span className="text-[10px] font-semibold uppercase tracking-wide text-base-content/45">Preview</span>
    </Wrapper>
  );
}

const PortalDocumentsTab: React.FC = () => {
  const { data, initialLoading, refresh } = usePortalTabData();
  const classifications = data?.documents?.classifications ?? [];
  const documents = data?.documents?.documents ?? [];
  const signedUrls = data?.documentSignedUrls ?? {};
  const [activeTabKey, setActiveTabKey] = useState<PortalDocumentTabKey>('sequence');
  const loading = initialLoading && !data;
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewItems, setPreviewItems] = useState<DocumentPreviewItem[]>([]);
  const [previewInitialIndex, setPreviewInitialIndex] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reloadDocuments = useCallback(
    async (opts?: { selectSequenceCategory?: boolean }) => {
      if (opts?.selectSequenceCategory) {
        setActiveTabKey('sequence');
      }
      try {
        await refresh('documents');
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to load documents');
      }
    },
    [refresh],
  );

  const documentTabs = useMemo(() => resolvePortalDocumentTabs(classifications), [classifications]);

  const documentsInActiveCategory = useMemo(() => {
    const tab = documentTabs.find((t) => t.key === activeTabKey) ?? documentTabs[0];
    if (!tab) return documents;
    return documents.filter((doc) => documentMatchesPortalTab(doc, tab));
  }, [documents, documentTabs, activeTabKey]);

  const countDocumentsForTab = useCallback(
    (tab: PortalDocumentTab) => documents.filter((doc) => documentMatchesPortalTab(doc, tab)).length,
    [documents],
  );

  const uploadFiles = async (files: File[]) => {
    if (!files.length) return;

    setIsUploading(true);
    const batch = files.map((file) => ({
      name: file.name,
      status: 'uploading' as const,
      progress: 5,
    }));
    setUploadedFiles((prev) => [...prev, ...batch]);

    const progressIntervals = new Map<string, ReturnType<typeof setInterval>>();

    const startProgressSimulation = (fileName: string, fileSize: number) => {
      const initialProgress = 5;
      let currentProgress = initialProgress;
      const targetProgress = 90;
      const progressRange = targetProgress - initialProgress;
      const startTime = Date.now();
      const estimatedDuration = Math.max(2000, Math.min(10000, fileSize / 1024));
      const updateInterval = 100;

      const interval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const progressRatio = Math.min(elapsed / estimatedDuration, 0.95);
        const easedProgress = 1 - Math.pow(1 - progressRatio, 3);
        currentProgress = Math.min(
          Math.floor(initialProgress + easedProgress * progressRange),
          targetProgress,
        );

        if (currentProgress >= targetProgress) {
          clearInterval(interval);
          progressIntervals.delete(fileName);
        }

        setUploadedFiles((prev) =>
          prev.map((f) =>
            f.name === fileName && f.status === 'uploading' ? { ...f, progress: currentProgress } : f,
          ),
        );
      }, updateInterval);

      progressIntervals.set(fileName, interval);
    };

    const stopProgressSimulation = (fileName: string) => {
      const interval = progressIntervals.get(fileName);
      if (interval) {
        clearInterval(interval);
        progressIntervals.delete(fileName);
      }
    };

    for (const file of files) {
      startProgressSimulation(file.name, file.size);
      try {
        await portalUploadDocument(file);
        stopProgressSimulation(file.name);
        setUploadedFiles((prev) =>
          prev.map((f) =>
            f.name === file.name ? { ...f, status: 'success', progress: 100 } : f,
          ),
        );
        await reloadDocuments({ selectSequenceCategory: true });
      } catch (err) {
        stopProgressSimulation(file.name);
        const errorMessage = err instanceof Error ? err.message : 'Upload failed';
        setUploadedFiles((prev) =>
          prev.map((f) =>
            f.name === file.name
              ? { ...f, status: 'error', error: errorMessage, progress: 0 }
              : f,
          ),
        );
        toast.error(`${file.name}: ${errorMessage}`);
      }
    }

    progressIntervals.forEach((interval) => clearInterval(interval));
    progressIntervals.clear();
    setIsUploading(false);

    setTimeout(() => {
      setUploadedFiles((prev) => prev.filter((f) => f.status !== 'success'));
    }, 3000);
  };

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    await uploadFiles(Array.from(files));
    e.target.value = '';
  };

  const handleFileDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (isUploading) return;
    const files = Array.from(e.dataTransfer.files ?? []);
    if (!files.length) return;
    await uploadFiles(files);
  };

  const resolveDownloadUrl = (doc: PortalDocumentRow): string | null => {
    if (doc.storage_path && signedUrls[doc.storage_path]) {
      return signedUrls[doc.storage_path];
    }
    const direct = doc.download_url?.trim();
    return direct || null;
  };

  const openDocumentPreview = useCallback(
    (doc: PortalDocumentRow) => {
      const items: DocumentPreviewItem[] = [];
      let index = 0;

      for (const row of documentsInActiveCategory) {
        const url = resolveDownloadUrl(row);
        if (!url) continue;
        if (row.id === doc.id) index = items.length;
        items.push({
          id: row.id,
          name: row.file_name,
          downloadUrl: url,
          fileType: inferPortalDocumentMimeType(row),
          lastModified: row.created_at,
        });
      }

      if (!items.some((item) => item.id === doc.id)) return;

      setPreviewItems(items);
      setPreviewInitialIndex(index);
      setPreviewOpen(true);
    },
    [documentsInActiveCategory, signedUrls],
  );

  if (loading) return <PortalLoading />;

  return (
    <PortalTabFrame
      title="Documents"
      subtitle="Download shared files or upload documents for our team."
      headerCoverImage={getPortalTabHeaderCoverImage('documents')}
    >
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        multiple
        disabled={isUploading}
        onChange={handleFileInput}
      />

      <p className="text-xs text-base-content/65">
        Uploads are added to <span className="font-medium text-base-content/90">Sequence of Events</span>.
      </p>

      <div
        className={`rounded-lg border-2 border-dashed p-6 text-center transition-colors duration-200 sm:p-8 ${
          isUploading
            ? 'border-primary bg-gray-50'
            : 'border-gray-300 bg-gray-50 hover:border-primary hover:bg-blue-50'
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onDrop={handleFileDrop}
      >
        <DocumentArrowUpIcon className="mx-auto mb-4 h-12 w-12 text-gray-400" />
        <div className="mb-4 text-base text-gray-600">
          {isUploading
            ? 'Processing files...'
            : 'Drag and drop files here, or click to select files'}
        </div>
        <button
          type="button"
          className={`btn btn-outline btn-primary ${isUploading ? 'btn-disabled' : ''}`}
          disabled={isUploading}
          onClick={() => fileInputRef.current?.click()}
        >
          <PaperClipIcon className="h-5 w-5" />
          Upload Files
        </button>
      </div>

      {uploadedFiles.length > 0 ? (
        <div className="space-y-2">
          {uploadedFiles.map((file, index) => (
            <div
              key={`${file.name}-${index}`}
              className="flex min-w-0 items-center justify-between gap-2 rounded-lg bg-gray-50 p-3"
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <PaperClipIcon className="h-5 w-5 shrink-0 text-primary" />
                <span className="min-w-0 truncate text-base font-medium text-gray-900">{file.name}</span>
              </div>
              <div className="flex items-center gap-2">
                {file.status === 'uploading' ? (
                  <div className="flex items-center gap-2">
                    <div
                      className="radial-progress text-xs"
                      style={
                        {
                          '--value': file.progress || 0,
                          '--size': '2.5rem',
                          color: '#1e3a8a',
                        } as React.CSSProperties
                      }
                    >
                      <span className="text-xs font-semibold">{Math.round(file.progress || 0)}%</span>
                    </div>
                    <div className="text-xs font-medium text-gray-500">Uploading...</div>
                  </div>
                ) : null}
                {file.status === 'success' ? (
                  <div className="flex items-center gap-2">
                    <CheckCircleIcon className="h-6 w-6 text-green-500" />
                    <span className="text-xs font-medium text-green-600">Complete</span>
                  </div>
                ) : null}
                {file.status === 'error' ? (
                  <div className="tooltip tooltip-error" data-tip={file.error}>
                    <div className="flex items-center gap-2">
                      <XCircleIcon className="h-6 w-6 text-red-500" />
                      <span className="text-xs font-medium text-red-600">Failed</span>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <nav
        className="flex w-full min-w-0 touch-pan-x flex-nowrap items-stretch gap-2 overflow-x-auto border-b border-base-200 pb-2 [-webkit-overflow-scrolling:touch]"
        aria-label="Document categories"
      >
        {documentTabs.map((category) => {
          const count = countDocumentsForTab(category);
          const active = activeTabKey === category.key;
          return (
            <button
              key={category.key}
              type="button"
              onClick={() => setActiveTabKey(category.key)}
              className={`btn btn-sm inline-flex h-auto min-h-0 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border-0 px-3 py-2.5 text-sm font-bold shadow-none ${
                active
                  ? 'btn-primary text-white'
                  : 'bg-base-200/90 text-base-content hover:bg-base-300/80'
              }`}
            >
              <span className="max-w-[12rem] truncate sm:max-w-[14rem]">{category.label}</span>
              <span
                className={
                  active
                    ? 'inline-flex min-w-[22px] items-center justify-center rounded-full bg-white px-2 py-0.5 text-xs font-semibold tabular-nums text-blue-900'
                    : 'text-xs font-semibold tabular-nums text-base-content/70'
                }
              >
                {count}
              </span>
            </button>
          );
        })}
      </nav>

      {documents.length === 0 ? (
        <PortalCard>
          <p className="text-sm text-base-content/45">No documents yet. Upload files using the area above.</p>
        </PortalCard>
      ) : documentsInActiveCategory.length === 0 ? (
        <PortalCard>
          <p className="text-sm text-base-content/45">No documents in this category.</p>
        </PortalCard>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {documentsInActiveCategory.map((doc) => {
            const url = resolveDownloadUrl(doc);
            const mimeType = inferPortalDocumentMimeType(doc);
            return (
              <PortalCard key={doc.id} className="p-0">
                <div
                  className={`flex items-stretch justify-between gap-4 p-4 md:p-6 ${
                    url ? 'cursor-pointer transition-shadow hover:shadow-md' : ''
                  }`}
                  onClick={url ? () => openDocumentPreview(doc) : undefined}
                  onKeyDown={
                    url
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            openDocumentPreview(doc);
                          }
                        }
                      : undefined
                  }
                  role={url ? 'button' : undefined}
                  tabIndex={url ? 0 : undefined}
                >
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <DocumentFileGlyph
                    fileType={mimeType}
                    fileName={doc.file_name}
                    className="h-8 w-8 shrink-0 sm:h-9 sm:w-9"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="break-words font-semibold leading-snug text-base-content/90 [overflow-wrap:anywhere]">
                      {doc.file_name}
                    </p>
                    <p className="mt-1 text-xs text-base-content/45">
                      {new Date(doc.created_at).toLocaleDateString()}
                      {doc.file_size ? ` · ${(doc.file_size / 1024).toFixed(0)} KB` : ''}
                      {doc.uploaded_by ? ` · ${doc.uploaded_by}` : ''}
                    </p>
                    {url ? (
                      <div className="mt-2 flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            openDocumentPreview(doc);
                          }}
                        >
                          <EyeIcon className="h-4 w-4" />
                          View
                        </button>
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ArrowDownTrayIcon className="h-4 w-4" />
                          Download
                        </a>
                      </div>
                    ) : null}
                  </div>
                </div>
                <PortalDocumentPreview
                  url={url}
                  fileName={doc.file_name}
                  mimeType={mimeType}
                  onOpen={url ? () => openDocumentPreview(doc) : undefined}
                />
                </div>
              </PortalCard>
            );
          })}
        </div>
      )}
      <DocumentPreviewModal
        isOpen={previewOpen}
        onClose={() => {
          setPreviewOpen(false);
          setPreviewItems([]);
        }}
        documents={previewItems}
        initialIndex={previewInitialIndex}
      />
    </PortalTabFrame>
  );
};

export default PortalDocumentsTab;
