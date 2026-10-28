import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowDownTrayIcon,
  CheckCircleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DocumentArrowUpIcon,
  EyeIcon,
  ListBulletIcon,
  PaperClipIcon,
  Squares2X2Icon,
  XCircleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { FolderIcon as FolderSolidIcon } from '@heroicons/react/24/solid';
import toast from 'react-hot-toast';
import {
  DocumentPreviewModal,
  type DocumentPreviewItem,
} from '../../../components/DocumentModal';
import DocumentSidebarThumb from '../../../components/DocumentSidebarThumb';
import { DocumentFileGlyph } from '../../../lib/documentFileGlyphs';
import {
  portalGetLeadCaseDocumentTypes,
  portalUploadDocument,
  type PortalDocumentClassification,
  type PortalDocumentFolder,
  type PortalDocumentRow,
  type PortalLeadCaseDocumentType,
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

function folderMatchesPortalTab(folder: PortalDocumentFolder, tab: PortalDocumentTab): boolean {
  const def = PORTAL_DOCUMENT_TAB_DEFS.find((d) => d.key === tab.key);
  if (!def) return false;

  if (tab.id !== tab.key && folder.classification_id === tab.id) return true;

  const slug = (folder.classification_slug ?? '').toLowerCase();
  const label = (folder.classification_label ?? '').toLowerCase();
  if (def.slugs.some((s) => slug === s)) return true;
  if (def.labelMatches.some((m) => label.includes(m))) return true;
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

/**
 * The upload area and the table sit in a centred column on a wide screen: a row stretched the
 * whole width of the page is hard to read across. The boxes keep the full width — they fill it.
 */
const DOCUMENTS_COLUMN = 'mx-auto w-full md:max-w-5xl';

/**
 * Storage hands a PDF or a Word file back with its own content type, which the browser then
 * shows (or refuses to show) in a new tab instead of saving. Asking Storage for the file by
 * name makes it answer with an attachment, so the link downloads whatever the file is.
 */
function asDownloadUrl(url: string, fileName: string): string {
  if (!url.includes('/storage/v1/')) return url;
  if (/[?&]download=/.test(url)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}download=${encodeURIComponent(fileName)}`;
}

const PortalDocumentsTab: React.FC<{ sessionContactId?: number | null }> = ({ sessionContactId = null }) => {
  const { data, initialLoading, refresh } = usePortalTabData();
  const classifications = data?.documents?.classifications ?? [];
  const documents = data?.documents?.documents ?? [];
  const folders = data?.documents?.folders ?? [];
  const signedUrls = data?.documentSignedUrls ?? {};
  const portalContacts = data?.contacts?.contacts ?? [];
  const [documentTypes, setDocumentTypes] = useState<PortalLeadCaseDocumentType[]>([]);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [modalContactId, setModalContactId] = useState<number | ''>('');
  const [modalDocumentTypeId, setModalDocumentTypeId] = useState<string>('');
  const [activeTabKey, setActiveTabKey] = useState<PortalDocumentTabKey>('sequence');
  /** The folders walked into, root first, so a folder inside a folder can be stepped back out of. */
  const [folderTrail, setFolderTrail] = useState<PortalDocumentFolder[]>([]);
  /**
   * A table needs width to be worth reading, so a phone opens on the boxes instead. Whichever
   * one is then chosen stays chosen — turning the phone sideways does not undo it.
   */
  const [view, setView] = useState<'table' | 'grid'>(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches
      ? 'grid'
      : 'table',
  );
  const loading = initialLoading && !data;
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewItems, setPreviewItems] = useState<DocumentPreviewItem[]>([]);
  const [previewInitialIndex, setPreviewInitialIndex] = useState(0);
  /** The file being looked at by hovering its icon, placed where the icon is. */
  const [peek, setPeek] = useState<{ doc: PortalDocumentRow; top: number; left: number } | null>(
    null,
  );
  const peekTimer = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const types = await portalGetLeadCaseDocumentTypes();
        if (!cancelled) setDocumentTypes(types);
      } catch (e) {
        console.warn('portal document types:', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const defaultContactId = useMemo((): number | '' => {
    if (sessionContactId != null) return sessionContactId;
    const main = portalContacts.find((c) => c.is_main);
    if (main?.id != null) return main.id;
    if (portalContacts[0]?.id != null) return portalContacts[0].id;
    return '';
  }, [portalContacts, sessionContactId]);

  const defaultDocumentTypeId = useMemo(
    () => (documentTypes[0]?.id ? documentTypes[0].id : ''),
    [documentTypes],
  );

  const openUploadModal = useCallback(
    (files: File[]) => {
      if (!files.length || isUploading) return;
      setPendingFiles(files);
      setModalContactId(defaultContactId);
      setModalDocumentTypeId(defaultDocumentTypeId);
      setUploadModalOpen(true);
    },
    [defaultContactId, defaultDocumentTypeId, isUploading],
  );

  const closeUploadModal = useCallback(() => {
    if (isUploading) return;
    setUploadModalOpen(false);
    setPendingFiles([]);
  }, [isUploading]);

  // Contact is required; document type is optional when the catalog is empty
  // (uploads must never be blocked on CRM “documents needed” setup).
  const modalCanSubmit =
    uploadModalOpen &&
    pendingFiles.length > 0 &&
    modalContactId !== '' &&
    (documentTypes.length === 0 || !!modalDocumentTypeId) &&
    !isUploading;

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

  const activeTab = useMemo(
    () => documentTabs.find((t) => t.key === activeTabKey) ?? documentTabs[0] ?? null,
    [documentTabs, activeTabKey],
  );

  const documentsInActiveCategory = useMemo(() => {
    if (!activeTab) return documents;
    return documents.filter((doc) => documentMatchesPortalTab(doc, activeTab));
  }, [documents, activeTab]);

  const foldersInActiveCategory = useMemo(() => {
    if (!activeTab) return [] as PortalDocumentFolder[];
    return folders.filter((folder) => folderMatchesPortalTab(folder, activeTab));
  }, [folders, activeTab]);

  const activeFolder = folderTrail.length > 0 ? folderTrail[folderTrail.length - 1] : null;
  const activeFolderId = activeFolder?.id ?? null;

  /** The folders of the open level: the case's own at the top, a folder's children inside one. */
  const foldersAtThisLevel = useMemo(
    () =>
      foldersInActiveCategory.filter((folder) => (folder.parent_id ?? null) === activeFolderId),
    [foldersInActiveCategory, activeFolderId],
  );

  /**
   * The files of the open level. At the top that is everything not filed away — including a file
   * whose folder is not in this category, which would otherwise be in the case yet nowhere in it.
   */
  const visibleDocuments = useMemo(() => {
    if (activeFolderId) {
      return documentsInActiveCategory.filter((doc) => doc.folder_id === activeFolderId);
    }
    const known = new Set(foldersInActiveCategory.map((folder) => folder.id));
    return documentsInActiveCategory.filter((doc) => !doc.folder_id || !known.has(doc.folder_id));
  }, [documentsInActiveCategory, foldersInActiveCategory, activeFolderId]);

  const countDocumentsForTab = useCallback(
    (tab: PortalDocumentTab) => documents.filter((doc) => documentMatchesPortalTab(doc, tab)).length,
    [documents],
  );

  /** What a folder holds, counting its subfolders: the number on a closed folder means all of it. */
  const countDocumentsInFolder = useCallback(
    (folderId: string) => {
      const ids = new Set([folderId]);
      let frontier = [folderId];
      while (frontier.length > 0) {
        const next = foldersInActiveCategory
          .filter((folder) => folder.parent_id && frontier.includes(folder.parent_id))
          .map((folder) => folder.id)
          .filter((id) => !ids.has(id));
        next.forEach((id) => ids.add(id));
        frontier = next;
      }
      return documentsInActiveCategory.filter((doc) => doc.folder_id && ids.has(doc.folder_id))
        .length;
    },
    [documentsInActiveCategory, foldersInActiveCategory],
  );

  useEffect(() => {
    setFolderTrail([]);
  }, [activeTabKey]);

  // A folder that is no longer there — renamed away, hidden, deleted — is stepped back out of.
  useEffect(() => {
    setFolderTrail((trail) => {
      const kept: PortalDocumentFolder[] = [];
      for (const folder of trail) {
        const current = foldersInActiveCategory.find((item) => item.id === folder.id);
        if (!current) break;
        kept.push(current);
      }
      return kept.length === trail.length ? trail : kept;
    });
  }, [foldersInActiveCategory]);

  const uploadFiles = async (
    files: File[],
    opts: { contactId: number; documentTypeId?: string },
  ) => {
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
        await portalUploadDocument(file, opts);
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
    setUploadModalOpen(false);
    setPendingFiles([]);

    setTimeout(() => {
      setUploadedFiles((prev) => prev.filter((f) => f.status !== 'success'));
    }, 3000);
  };

  const handleConfirmUpload = async () => {
    if (!modalCanSubmit) {
      toast.error(
        documentTypes.length === 0
          ? 'Please choose a contact'
          : 'Please choose a contact and document type',
      );
      return;
    }
    await uploadFiles(pendingFiles, {
      contactId: Number(modalContactId),
      documentTypeId: modalDocumentTypeId || undefined,
    });
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    openUploadModal(Array.from(files));
    e.target.value = '';
  };

  const handleFileDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (isUploading) return;
    const files = Array.from(e.dataTransfer.files ?? []);
    if (!files.length) return;
    openUploadModal(files);
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

      for (const row of visibleDocuments) {
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
    [visibleDocuments, signedUrls],
  );

  const closePeek = useCallback(() => {
    if (peekTimer.current != null) {
      window.clearTimeout(peekTimer.current);
      peekTimer.current = null;
    }
    setPeek(null);
  }, []);

  useEffect(() => closePeek, [closePeek]);

  /**
   * Resting on a file's icon shows the file, so two documents named alike can be told apart
   * without opening either. It waits a moment first: the mouse crosses icons on its way elsewhere.
   */
  const documentPeekProps = (doc: PortalDocumentRow) => ({
    onMouseEnter: (event: React.MouseEvent<HTMLElement>) => {
      const element = event.currentTarget;
      if (peekTimer.current != null) window.clearTimeout(peekTimer.current);
      peekTimer.current = window.setTimeout(() => {
        const rect = element.getBoundingClientRect();
        setPeek({
          doc,
          // Below the icon and inside the window, whichever edge it is near.
          top: Math.min(rect.bottom + 6, window.innerHeight - 300),
          left: Math.min(Math.max(rect.left + 24, 8), window.innerWidth - 304),
        });
      }, 400);
    },
    onMouseLeave: closePeek,
  });

  const canSelectFiles = !isUploading;
  /** An empty list stands where its list would: in the column with the table, full width with the boxes. */
  const emptyStateColumn = view === 'table' ? DOCUMENTS_COLUMN : '';

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

      <div
        className={`${DOCUMENTS_COLUMN} rounded-lg border-2 border-dashed p-6 text-center transition-colors duration-200 sm:p-8 ${
          isUploading
            ? 'border-primary bg-gray-50'
            : canSelectFiles
              ? 'border-gray-300 bg-gray-50 hover:border-primary hover:bg-blue-50'
              : 'border-gray-200 bg-gray-50/80 opacity-70'
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onDrop={canSelectFiles ? handleFileDrop : undefined}
      >
        <DocumentArrowUpIcon className="mx-auto mb-4 h-12 w-12 text-gray-400" />
        <div className="mb-4 text-base text-gray-600">
          {isUploading
            ? 'Processing files...'
            : 'Drag and drop files here, or click to select files'}
        </div>
        <button
          type="button"
          className={`btn btn-outline btn-primary ${!canSelectFiles ? 'btn-disabled' : ''}`}
          disabled={!canSelectFiles}
          onClick={() => fileInputRef.current?.click()}
        >
          <PaperClipIcon className="h-5 w-5" />
          Upload Files
        </button>
      </div>

      {uploadedFiles.length > 0 ? (
        <div className={`${DOCUMENTS_COLUMN} space-y-2`}>
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

      <div className="flex w-full min-w-0 items-center gap-2 border-b border-base-200 pb-2">
        <nav
          className="flex min-w-0 flex-1 touch-pan-x flex-nowrap items-stretch gap-2 overflow-x-auto [-webkit-overflow-scrolling:touch]"
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
        <div className="flex shrink-0 items-center gap-1 rounded-full bg-base-200 p-1">
          {([
            { id: 'table' as const, label: 'Table view', icon: ListBulletIcon },
            { id: 'grid' as const, label: 'Box view', icon: Squares2X2Icon },
          ]).map((option) => (
            <button
              key={option.id}
              type="button"
              className={`btn btn-sm rounded-full border-none transition-colors ${
                view === option.id
                  ? 'bg-white text-base-content shadow-sm hover:bg-white dark:bg-base-100'
                  : 'bg-transparent text-base-content/50 hover:bg-base-300'
              }`}
              title={option.label}
              aria-label={option.label}
              aria-pressed={view === option.id}
              onClick={() => setView(option.id)}
            >
              <option.icon className="h-5 w-5" />
            </button>
          ))}
        </div>
      </div>

      {/* Where in the case you are standing, and the way back up out of it. */}
      {folderTrail.length > 0 ? (
        <nav className="flex min-w-0 flex-wrap items-center gap-1 text-sm" aria-label="Folder path">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 font-semibold text-primary"
            onClick={() => setFolderTrail([])}
          >
            <ChevronLeftIcon className="h-4 w-4" />
            {activeTab?.label ?? 'Documents'}
          </button>
          {folderTrail.map((folder, index) => (
            <span key={folder.id} className="flex min-w-0 items-center gap-1">
              <ChevronRightIcon className="h-4 w-4 shrink-0 text-base-content/35" />
              {index === folderTrail.length - 1 ? (
                <span className="min-w-0 truncate font-semibold text-base-content/85">
                  {folder.title}
                </span>
              ) : (
                <button
                  type="button"
                  className="min-w-0 truncate font-semibold text-primary"
                  onClick={() => setFolderTrail((trail) => trail.slice(0, index + 1))}
                >
                  {folder.title}
                </button>
              )}
            </span>
          ))}
        </nav>
      ) : null}

      {documents.length === 0 && folders.length === 0 ? (
        <PortalCard className={emptyStateColumn}>
          <p className="text-sm text-base-content/45">No documents yet. Upload files using the area above.</p>
        </PortalCard>
      ) : documentsInActiveCategory.length === 0 && foldersInActiveCategory.length === 0 ? (
        <PortalCard className={emptyStateColumn}>
          <p className="text-sm text-base-content/45">No documents in this category.</p>
        </PortalCard>
      ) : foldersAtThisLevel.length === 0 && visibleDocuments.length === 0 ? (
        <PortalCard className={emptyStateColumn}>
          <p className="text-sm text-base-content/45">
            {activeFolder ? 'This folder is empty.' : 'No documents in this category.'}
          </p>
        </PortalCard>
      ) : view === 'grid' ? (
        /* The drive's cards: folders of this level first, then its files with a look at each. */
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
          {foldersAtThisLevel.map((folder) => {
            const count = countDocumentsInFolder(folder.id);
            return (
              <button
                key={`folder-card-${folder.id}`}
                type="button"
                className="flex select-none items-center gap-3 rounded-xl border border-base-200 bg-base-100 px-3 py-4 text-left transition-shadow hover:shadow-md"
                onClick={() => setFolderTrail((trail) => [...trail, folder])}
              >
                <FolderSolidIcon className="h-7 w-7 shrink-0 text-slate-500" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-base-content">
                    {folder.title}
                  </span>
                  <span className="block truncate text-xs text-base-content/50">
                    {count} {count === 1 ? 'file' : 'files'}
                  </span>
                </span>
              </button>
            );
          })}

          {visibleDocuments.map((doc) => {
            const url = resolveDownloadUrl(doc);
            const mimeType = inferPortalDocumentMimeType(doc);
            return (
              <div
                key={`doc-card-${doc.id}`}
                className={`flex select-none flex-col gap-3 rounded-xl border border-base-200 bg-base-100 p-3 transition-shadow hover:shadow-md ${
                  url ? 'cursor-pointer' : ''
                }`}
                onClick={url ? () => openDocumentPreview(doc) : undefined}
              >
                <div className="flex items-center gap-2">
                  <span className="shrink-0" {...documentPeekProps(doc)}>
                    <DocumentFileGlyph
                      fileType={mimeType}
                      fileName={doc.file_name}
                      className="h-6 w-6"
                    />
                  </span>
                  <span
                    className="min-w-0 flex-1 truncate text-left text-sm font-medium text-base-content"
                    title={doc.file_name}
                  >
                    {doc.file_name}
                  </span>
                  {url ? (
                    <a
                      href={asDownloadUrl(url, doc.file_name)}
                      download={doc.file_name}
                      rel="noopener noreferrer"
                      className="btn btn-ghost btn-sm btn-square shrink-0 text-primary"
                      title="Download"
                      aria-label={`Download ${doc.file_name}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ArrowDownTrayIcon className="h-5 w-5" />
                    </a>
                  ) : (
                    /* Kept in place so every card reads the same, and plainly out of use. */
                    <span
                      className="btn btn-ghost btn-sm btn-square btn-disabled shrink-0"
                      title="This file is not available to download"
                      aria-hidden="true"
                    >
                      <ArrowDownTrayIcon className="h-5 w-5" />
                    </span>
                  )}
                </div>
                {/* The thumb is portrait, so a landscape frame crops it to its top. */}
                <span className="relative block aspect-[4/3] w-full overflow-hidden rounded-lg bg-base-200/60">
                  <span className="absolute inset-x-0 top-0 block">
                    <DocumentSidebarThumb
                      name={doc.file_name}
                      url={url ?? ''}
                      fileType={mimeType}
                    />
                  </span>
                </span>
                <div className="flex items-center justify-between gap-2 text-xs text-base-content/50">
                  <span className="truncate">
                    {doc.classification_label || doc.document_type_name || activeTab?.label || ''}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {new Date(doc.created_at).toLocaleDateString()}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* The same list the case team works in: folders first, then the files of this level. */
        <PortalCard className={`${DOCUMENTS_COLUMN} overflow-hidden`} padding="p-0">
          <div className="overflow-x-auto">
            <table className="table w-full">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-base-content/45">
                  <th className="w-[60%] font-semibold">Name</th>
                  <th className="hidden font-semibold sm:table-cell">Size</th>
                  <th className="font-semibold">Date</th>
                  <th className="text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {foldersAtThisLevel.map((folder) => {
                  const count = countDocumentsInFolder(folder.id);
                  return (
                    <tr
                      key={`folder-${folder.id}`}
                      className="cursor-pointer border-base-200 hover:bg-base-200/40"
                      onClick={() => setFolderTrail((trail) => [...trail, folder])}
                    >
                      <td className="max-w-[22rem]">
                        <span className="flex min-w-0 items-center gap-3">
                          <FolderSolidIcon className="h-6 w-6 shrink-0 text-slate-500" />
                          <span className="min-w-0">
                            <span className="block truncate font-semibold text-base-content/90">
                              {folder.title}
                            </span>
                            {folder.sub_effort_name || folder.note ? (
                              <span className="block truncate text-xs text-base-content/45">
                                {[folder.sub_effort_name, folder.note].filter(Boolean).join(' · ')}
                              </span>
                            ) : null}
                          </span>
                        </span>
                      </td>
                      <td className="hidden text-sm text-base-content/60 sm:table-cell">
                        {count} {count === 1 ? 'file' : 'files'}
                      </td>
                      <td className="whitespace-nowrap text-sm tabular-nums text-base-content/60">
                        {folder.created_at
                          ? new Date(folder.created_at).toLocaleDateString()
                          : '—'}
                      </td>
                      <td className="whitespace-nowrap text-right text-sm font-medium text-primary">
                        Open
                      </td>
                    </tr>
                  );
                })}

                {visibleDocuments.map((doc) => {
                  const url = resolveDownloadUrl(doc);
                  const mimeType = inferPortalDocumentMimeType(doc);
                  const meta = [doc.contact_name, doc.document_type_name, doc.sub_effort_name]
                    .filter(Boolean)
                    .join(' · ');
                  return (
                    <tr
                      key={doc.id}
                      className={`border-base-200 ${
                        url ? 'cursor-pointer hover:bg-base-200/40' : ''
                      }`}
                      onClick={url ? () => openDocumentPreview(doc) : undefined}
                    >
                      <td className="max-w-[22rem]">
                        <span className="flex min-w-0 items-center gap-3">
                          <span className="shrink-0" {...documentPeekProps(doc)}>
                            <DocumentFileGlyph
                              fileType={mimeType}
                              fileName={doc.file_name}
                              className="h-6 w-6"
                            />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-base-content/90">
                              {doc.file_name}
                            </span>
                            {meta ? (
                              <span className="block truncate text-xs text-base-content/45">
                                {meta}
                              </span>
                            ) : null}
                          </span>
                        </span>
                      </td>
                      <td className="hidden whitespace-nowrap text-sm tabular-nums text-base-content/60 sm:table-cell">
                        {doc.file_size ? `${(doc.file_size / 1024).toFixed(0)} KB` : '—'}
                      </td>
                      <td className="whitespace-nowrap text-sm tabular-nums text-base-content/60">
                        {new Date(doc.created_at).toLocaleDateString()}
                      </td>
                      <td className="whitespace-nowrap text-right">
                        {url ? (
                          <span className="inline-flex items-center justify-end gap-1">
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm btn-square text-primary"
                              title="View"
                              aria-label={`View ${doc.file_name}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                openDocumentPreview(doc);
                              }}
                            >
                              <EyeIcon className="h-5 w-5" />
                            </button>
                            <a
                              href={asDownloadUrl(url, doc.file_name)}
                              download={doc.file_name}
                              rel="noopener noreferrer"
                              className="btn btn-ghost btn-sm btn-square text-primary"
                              title="Download"
                              aria-label={`Download ${doc.file_name}`}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <ArrowDownTrayIcon className="h-5 w-5" />
                            </a>
                          </span>
                        ) : (
                          <span className="text-sm text-base-content/35">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </PortalCard>
      )}
      {/* Follows the mouse rather than the layout, so it is drawn at the window's level. */}
      {peek
        ? createPortal(
            <div
              className="pointer-events-none fixed z-[280] w-72 overflow-hidden rounded-xl border border-base-300 bg-base-100 p-3 shadow-2xl"
              style={{ top: peek.top, left: peek.left }}
            >
              <p className="mb-2 truncate text-xs font-semibold uppercase tracking-wide text-base-content/40">
                {peek.doc.file_name}
              </p>
              <DocumentSidebarThumb
                name={peek.doc.file_name}
                url={resolveDownloadUrl(peek.doc) ?? ''}
                fileType={inferPortalDocumentMimeType(peek.doc)}
              />
              <p className="mt-2 flex items-center justify-between gap-2 text-xs text-base-content/50">
                <span className="truncate">
                  {peek.doc.document_type_name || peek.doc.classification_label || '—'}
                </span>
                <span className="shrink-0 tabular-nums">
                  {peek.doc.file_size ? `${(peek.doc.file_size / 1024).toFixed(0)} KB` : ''}
                </span>
              </p>
            </div>,
            document.body,
          )
        : null}

      <DocumentPreviewModal
        isOpen={previewOpen}
        onClose={() => {
          setPreviewOpen(false);
          setPreviewItems([]);
        }}
        documents={previewItems}
        initialIndex={previewInitialIndex}
      />

      {uploadModalOpen ? (
        <div className="modal modal-open z-[300]">
          <div className="modal-box max-w-lg">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-lg font-bold text-gray-900">Upload documents</h3>
                <p className="mt-1 text-sm text-base-content/60">
                  Choose who the documents belong to and what type they are.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-square"
                onClick={closeUploadModal}
                disabled={isUploading}
                aria-label="Close"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            {pendingFiles.length > 0 ? (
              <div className="mt-4 max-h-36 space-y-2 overflow-y-auto rounded-xl bg-gray-50 px-3 py-2">
                {pendingFiles.map((file, index) => (
                  <div key={`${file.name}-${file.size}-${index}`} className="flex items-center gap-2 text-sm">
                    <PaperClipIcon className="h-4 w-4 shrink-0 text-primary" />
                    <span className="min-w-0 truncate font-medium text-gray-800">{file.name}</span>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="mt-4 grid gap-3">
              <label className="form-control w-full">
                <span className="label-text mb-1 text-sm font-medium text-base-content/80">Contact</span>
                <select
                  className="select select-bordered w-full"
                  value={modalContactId === '' ? '' : String(modalContactId)}
                  onChange={(e) => setModalContactId(e.target.value ? Number(e.target.value) : '')}
                  disabled={isUploading}
                >
                  <option value="">Select contact…</option>
                  {portalContacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.is_main ? ' (main)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-control w-full">
                <span className="label-text mb-1 text-sm font-medium text-base-content/80">
                  Document type{documentTypes.length === 0 ? ' (optional)' : ''}
                </span>
                <select
                  className="select select-bordered w-full"
                  value={modalDocumentTypeId}
                  onChange={(e) => setModalDocumentTypeId(e.target.value)}
                  disabled={isUploading || documentTypes.length === 0}
                >
                  <option value="">
                    {documentTypes.length === 0 ? 'No type required' : 'Select type…'}
                  </option>
                  {documentTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="modal-action mt-6">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={closeUploadModal}
                disabled={isUploading}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary gap-2"
                onClick={() => void handleConfirmUpload()}
                disabled={!modalCanSubmit}
              >
                {isUploading ? (
                  <>
                    <span className="loading loading-spinner loading-sm" />
                    Uploading…
                  </>
                ) : (
                  <>
                    <DocumentArrowUpIcon className="h-4 w-4" />
                    Upload
                  </>
                )}
              </button>
            </div>
          </div>
          <button
            type="button"
            className="modal-backdrop"
            aria-label="Close upload dialog"
            onClick={closeUploadModal}
            disabled={isUploading}
          />
        </div>
      ) : null}
    </PortalTabFrame>
  );
};

export default PortalDocumentsTab;
