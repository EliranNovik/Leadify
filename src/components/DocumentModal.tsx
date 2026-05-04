import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  XMarkIcon, 
  EyeIcon, 
  ArrowDownTrayIcon, 
  DocumentIcon,
  PhotoIcon,
  DocumentTextIcon,
  ArchiveBoxIcon,
  ExclamationTriangleIcon,
  DocumentArrowUpIcon,
  PaperClipIcon,
  CheckCircleIcon,
  XCircleIcon,
  FilmIcon,
  MusicalNoteIcon,
  TableCellsIcon,
  PresentationChartBarIcon,
  CodeBracketIcon,
  EllipsisVerticalIcon,
} from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';
import { createPortal } from 'react-dom';
import { toast } from 'react-hot-toast';

interface Document {
  id: string;
  name: string;
  size: number;
  lastModified: string;
  downloadUrl: string;
  webUrl: string;
  fileType: string;
  caseClassificationId?: string | null;
  caseClassificationLabel?: string | null;
  /** Resolved from `lead_case_documents.uploaded_by` + `users` / employee photo. */
  uploadedByName?: string | null;
  uploadedByPhotoUrl?: string | null;
}

interface CaseClassificationRow {
  id: string;
  slug: string;
  label: string;
  sort_order?: number;
}

interface DocumentModalProps {
  isOpen: boolean;
  onClose: () => void;
  leadNumber: string;
  clientName: string;
  onDocumentCountChange?: (count: number) => void;
  /** When set, list/upload uses this subfolder under the lead’s OneDrive folder (expert tab omits this). */
  onedriveSubFolder?: string | null;
  modalTitle?: string;
  /** Shown under the lead line (e.g. OneDrive path hint). */
  folderPathHint?: string | null;
  /** When true, uploads use the active category tab; mapping is stored in `lead_case_documents`. */
  requireCaseDocumentClassification?: boolean;
}

type DocumentRowActionMenuProps = {
  doc: Document;
  isDownloading: boolean;
  onPreview: (d: Document) => void;
  onDownload: (d: Document) => void;
};

function DocumentRowActionMenu({ doc, isDownloading, onPreview, onDownload }: DocumentRowActionMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onPointerDown = (e: PointerEvent) => {
      const el = rootRef.current;
      if (!el || el.contains(e.target as Node)) return;
      close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className="relative shrink-0 self-center"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-base-300/70 bg-base-100 text-base-content shadow-sm transition-colors hover:border-primary/40 hover:bg-base-200/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        aria-label={`Actions for ${doc.name}`}
        title="Actions"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((o) => !o)}
      >
        <EllipsisVerticalIcon className="h-6 w-6" aria-hidden />
      </button>
      {open ? (
        <ul
          className="menu absolute right-0 top-full z-[1100] mt-1.5 min-w-[10.5rem] rounded-box border border-base-300 bg-base-100 p-2 shadow-lg"
          role="menu"
        >
          <li>
            <button
              type="button"
              className="flex w-full items-center gap-2 text-sm"
              role="menuitem"
              onClick={(e) => {
                e.preventDefault();
                setOpen(false);
                onPreview(doc);
              }}
            >
              <EyeIcon className="h-4 w-4 shrink-0" />
              View
            </button>
          </li>
          <li>
            <button
              type="button"
              className="flex w-full items-center gap-2 text-sm"
              role="menuitem"
              disabled={isDownloading}
              onClick={(e) => {
                e.preventDefault();
                setOpen(false);
                void onDownload(doc);
              }}
            >
              {isDownloading ? (
                <span className="loading loading-spinner loading-xs" />
              ) : (
                <ArrowDownTrayIcon className="h-4 w-4 shrink-0" />
              )}
              Download
            </button>
          </li>
        </ul>
      ) : null}
    </div>
  );
}

interface UploadedFile {
  name: string;
  status: 'uploading' | 'success' | 'error';
  progress?: number;
  error?: string;
}

type DocumentFileKind =
  | 'pdf'
  | 'word'
  | 'excel'
  | 'powerpoint'
  | 'image'
  | 'video'
  | 'audio'
  | 'archive'
  | 'text'
  | 'code'
  | 'generic';

function inferDocumentFileKind(fileType: string, fileName: string): DocumentFileKind {
  const mime = (fileType || '').toLowerCase();
  const lowerName = fileName.toLowerCase();
  const ext = lowerName.includes('.') ? lowerName.slice(lowerName.lastIndexOf('.')) : '';

  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.includes('pdf') || ext === '.pdf') return 'pdf';
  if (
    mime.includes('wordprocessingml') ||
    mime.includes('msword') ||
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ['.doc', '.docx', '.docm', '.odt'].includes(ext)
  ) {
    return 'word';
  }
  if (
    mime.includes('spreadsheetml') ||
    mime.includes('ms-excel') ||
    mime.includes('csv') ||
    ['.xls', '.xlsx', '.xlsm', '.csv', '.ods'].includes(ext)
  ) {
    return 'excel';
  }
  if (
    mime.includes('presentationml') ||
    mime.includes('powerpoint') ||
    ['.ppt', '.pptx', '.pptm', '.odp'].includes(ext)
  ) {
    return 'powerpoint';
  }
  if (
    mime.includes('zip') ||
    mime.includes('rar') ||
    mime.includes('x-7z') ||
    mime.includes('compressed') ||
    ['.zip', '.rar', '.7z', '.tar', '.gz', '.tgz'].includes(ext)
  ) {
    return 'archive';
  }
  if (mime.startsWith('text/') || ['.txt', '.md', '.rtf', '.log'].includes(ext)) return 'text';
  if (
    [
      '.js',
      '.ts',
      '.tsx',
      '.jsx',
      '.json',
      '.html',
      '.htm',
      '.css',
      '.xml',
      '.py',
      '.java',
      '.c',
      '.cpp',
      '.go',
      '.rb',
      '.php',
      '.sql',
      '.yml',
      '.yaml',
    ].includes(ext)
  ) {
    return 'code';
  }
  if (mime.includes('json')) return 'code';
  return 'generic';
}

function employeePhotoFromUserRow(row: {
  tenants_employee?: { photo_url?: string | null } | { photo_url?: string | null }[] | null;
}): string | null {
  const emp = row.tenants_employee;
  const e = Array.isArray(emp) ? emp[0] : emp;
  const url = e?.photo_url;
  return typeof url === 'string' && url.trim() ? url.trim() : null;
}

function displayNameFromUserRow(row: {
  full_name?: string | null;
  email?: string | null;
}): string {
  const fn = row.full_name?.trim();
  if (fn) return fn;
  const em = row.email?.trim();
  if (em) return em;
  return 'Unknown';
}

/** Map `lead_case_documents.uploaded_by` text → display name + photo (matches full_name or email). */
async function resolveUploaderDisplayByKey(
  keys: string[],
): Promise<Map<string, { name: string; photoUrl: string | null }>> {
  const out = new Map<string, { name: string; photoUrl: string | null }>();
  const unique = [...new Set(keys.map((k) => k.trim()).filter(Boolean))];
  if (unique.length === 0) return out;

  const userSelect = 'full_name, email, tenants_employee!users_employee_id_fkey(photo_url)';

  const { data: byFullName, error: errName } = await supabase
    .from('users')
    .select(userSelect)
    .in('full_name', unique);
  if (errName) console.warn('resolveUploaderDisplayByName:', errName);

  for (const row of (byFullName || []) as {
    full_name?: string | null;
    email?: string | null;
    tenants_employee?: { photo_url?: string | null } | { photo_url?: string | null }[] | null;
  }[]) {
    const fn = row.full_name?.trim();
    if (fn && unique.includes(fn)) {
      out.set(fn, { name: displayNameFromUserRow(row), photoUrl: employeePhotoFromUserRow(row) });
    }
  }

  const needEmail = unique.filter((k) => !out.has(k));
  if (needEmail.length === 0) return out;

  const { data: byEmail, error: errEmail } = await supabase
    .from('users')
    .select(userSelect)
    .in('email', needEmail);
  if (errEmail) console.warn('resolveUploaderDisplayByEmail:', errEmail);

  for (const row of (byEmail || []) as {
    full_name?: string | null;
    email?: string | null;
    tenants_employee?: { photo_url?: string | null } | { photo_url?: string | null }[] | null;
  }[]) {
    const em = row.email?.trim();
    if (!em) continue;
    for (const key of needEmail) {
      if (key === em) {
        out.set(key, { name: displayNameFromUserRow(row), photoUrl: employeePhotoFromUserRow(row) });
      }
    }
  }

  for (const k of unique) {
    if (!out.has(k)) {
      out.set(k, { name: k, photoUrl: null });
    }
  }
  return out;
}

function DocumentUploaderAttribution({ doc }: { doc: Document }) {
  const name = doc.uploadedByName?.trim();
  if (!name) return null;
  const initial = name.charAt(0).toUpperCase();
  return (
    <span className="inline-flex max-w-full min-w-0 shrink-0 items-center gap-1.5 text-sm text-base-content/65">
      {doc.uploadedByPhotoUrl ? (
        <img
          src={doc.uploadedByPhotoUrl}
          alt=""
          className="h-7 w-7 shrink-0 rounded-full object-cover outline-none sm:h-8 sm:w-8"
          loading="lazy"
        />
      ) : (
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-base-300/90 text-[10px] font-semibold text-base-content/85 outline-none sm:h-8 sm:w-8 sm:text-xs"
          aria-hidden
        >
          {initial}
        </span>
      )}
      <span className="min-w-0 truncate sm:max-w-[14rem]">
        by <span className="font-semibold text-base-content/90">{name}</span>
      </span>
    </span>
  );
}

function DocumentFileGlyph({ fileType, fileName }: { fileType: string; fileName: string }) {
  const kind = inferDocumentFileKind(fileType, fileName);
  const cn = 'h-11 w-11 shrink-0 sm:h-12 sm:w-12';

  switch (kind) {
    case 'pdf':
      return <DocumentTextIcon className={`${cn} text-red-600 dark:text-red-400`} aria-hidden />;
    case 'word':
      return <DocumentIcon className={`${cn} text-blue-700 dark:text-blue-400`} aria-hidden />;
    case 'excel':
      return <TableCellsIcon className={`${cn} text-emerald-700 dark:text-emerald-400`} aria-hidden />;
    case 'powerpoint':
      return <PresentationChartBarIcon className={`${cn} text-orange-600 dark:text-orange-400`} aria-hidden />;
    case 'image':
      return <PhotoIcon className={`${cn} text-violet-600 dark:text-violet-400`} aria-hidden />;
    case 'video':
      return <FilmIcon className={`${cn} text-fuchsia-700 dark:text-fuchsia-400`} aria-hidden />;
    case 'audio':
      return <MusicalNoteIcon className={`${cn} text-indigo-600 dark:text-indigo-400`} aria-hidden />;
    case 'archive':
      return <ArchiveBoxIcon className={`${cn} text-amber-800 dark:text-amber-500`} aria-hidden />;
    case 'text':
      return <DocumentTextIcon className={`${cn} text-slate-600 dark:text-slate-400`} aria-hidden />;
    case 'code':
      return <CodeBracketIcon className={`${cn} text-cyan-700 dark:text-cyan-400`} aria-hidden />;
    default:
      return <DocumentIcon className={`${cn} text-gray-500 dark:text-gray-400`} aria-hidden />;
  }
}

const DocumentModal: React.FC<DocumentModalProps> = ({
  isOpen,
  onClose,
  leadNumber,
  clientName,
  onDocumentCountChange,
  onedriveSubFolder = null,
  modalTitle,
  folderPathHint = null,
  requireCaseDocumentClassification = false,
}) => {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewDocument, setPreviewDocument] = useState<Document | null>(null);
  const [downloading, setDownloading] = useState<string[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [classifications, setClassifications] = useState<CaseClassificationRow[]>([]);
  const [classificationsLoading, setClassificationsLoading] = useState(false);
  const [classificationsError, setClassificationsError] = useState<string | null>(null);
  /** Which category tab is selected when browsing the document list (case documents only). */
  const [activeBrowseCategoryId, setActiveBrowseCategoryId] = useState<string | 'uncategorized' | null>(null);
  const lastBrowseLeadRef = useRef<string | null>(null);
  /** Avoid re-running browse sync when `classifications` is only a new array instance with the same ids. */
  const lastClassificationIdsKeyRef = useRef<string>('');

  // Fetch documents when modal opens
  useEffect(() => {
    if (isOpen && leadNumber) {
      fetchDocuments();
    }
  }, [isOpen, leadNumber, onedriveSubFolder, requireCaseDocumentClassification]);

  useEffect(() => {
    if (!isOpen || !requireCaseDocumentClassification) {
      return;
    }
    let cancelled = false;
    setClassificationsLoading(true);
    setClassificationsError(null);
    void (async () => {
      const { data, error: qErr } = await supabase
        .from('case_document_classifications')
        .select('id, slug, label, sort_order')
        .eq('is_active', true)
        .order('sort_order', { ascending: true });
      if (cancelled) return;
      setClassificationsLoading(false);
      if (qErr) {
        console.error('case_document_classifications:', qErr);
        setClassificationsError(qErr.message);
        setClassifications([]);
        return;
      }
      setClassifications((data as CaseClassificationRow[]) || []);
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, requireCaseDocumentClassification]);

  useEffect(() => {
    if (!requireCaseDocumentClassification) return;
    if (classifications.length === 0) return;

    const idsKey = [...classifications.map((c) => c.id)].sort().join('|');

    if (lastBrowseLeadRef.current !== leadNumber) {
      lastBrowseLeadRef.current = leadNumber;
      lastClassificationIdsKeyRef.current = idsKey;
      setActiveBrowseCategoryId(classifications[0].id);
      return;
    }

    if (lastClassificationIdsKeyRef.current === idsKey) {
      return;
    }
    lastClassificationIdsKeyRef.current = idsKey;

    setActiveBrowseCategoryId((prev) => {
      if (prev === 'uncategorized') return prev;
      if (prev && classifications.some((c) => c.id === prev)) return prev;
      return classifications[0].id;
    });
  }, [leadNumber, classifications, requireCaseDocumentClassification]);

  useEffect(() => {
    // Only update count when modal is open and documents have been loaded
    // This prevents resetting the count to 0 when modal is closed or during initial state
    if (onDocumentCountChange && isOpen && !loading) {
      onDocumentCountChange(documents.length);
    }
  }, [documents, onDocumentCountChange, loading, isOpen]);

  const documentsInActiveCategory = useMemo(() => {
    if (!requireCaseDocumentClassification || activeBrowseCategoryId === null) {
      return documents;
    }
    if (activeBrowseCategoryId === 'uncategorized') {
      return documents.filter((d) => !d.caseClassificationId);
    }
    return documents.filter((d) => d.caseClassificationId === activeBrowseCategoryId);
  }, [documents, requireCaseDocumentClassification, activeBrowseCategoryId]);

  const caseUploadBlocked = useMemo(
    () =>
      requireCaseDocumentClassification &&
      (classificationsLoading || !!classificationsError || classifications.length === 0),
    [
      requireCaseDocumentClassification,
      classificationsLoading,
      classificationsError,
      classifications.length,
    ],
  );

  /** Active tab’s classification for uploads (not available on Uncategorized). */
  const uploadClassificationId = useMemo(() => {
    if (
      !requireCaseDocumentClassification ||
      !activeBrowseCategoryId ||
      activeBrowseCategoryId === 'uncategorized'
    ) {
      return null;
    }
    return activeBrowseCategoryId;
  }, [requireCaseDocumentClassification, activeBrowseCategoryId]);

  const fetchDocuments = async () => {
    setLoading(true);
    setError(null);
    try {
      console.log('Fetching documents for lead:', leadNumber);
      const listBody: { leadNumber: string; subFolder?: string } = { leadNumber };
      if (onedriveSubFolder?.trim()) listBody.subFolder = onedriveSubFolder.trim();

      const { data, error } = await supabase.functions.invoke('list-lead-documents', {
        body: listBody,
      });

      console.log('Function response:', { data, error });

      if (error) {
        console.error('Supabase function error:', error);
        setError(`Function error: ${error.message}`);
        return;
      }

      if (data && data.success) {
        console.log('Documents fetched successfully:', data.files);

        let mappedDocuments: Document[] = (data.files || []).map((item: any) => ({
          id: item.id,
          name: item.name,
          size: item.size ?? 0,
          lastModified: item.lastModifiedDateTime || item.lastModified || new Date().toISOString(),
          downloadUrl: item.downloadUrl || item['@microsoft.graph.downloadUrl'] || item.webUrl,
          webUrl: item.webUrl,
          fileType: item.file?.mimeType || item.fileType || 'application/octet-stream',
        }));

        if (requireCaseDocumentClassification && leadNumber && onedriveSubFolder?.trim()) {
          const subTrim = onedriveSubFolder.trim();
          const { data: mapRows, error: mapErr } = await supabase
            .from('lead_case_documents')
            .select('onedrive_item_id, classification_id, uploaded_by')
            .eq('lead_number', leadNumber)
            .eq('onedrive_subfolder', subTrim);

          if (mapErr) {
            console.warn('lead_case_documents merge skipped:', mapErr);
          } else {
            type MapRow = {
              onedrive_item_id: string;
              classification_id: string;
              uploaded_by: string | null;
            };
            const rows = (mapRows as MapRow[]) || [];
            const itemToMeta = new Map<string, { classificationId: string; uploadedBy: string | null }>();
            for (const r of rows) {
              itemToMeta.set(r.onedrive_item_id, {
                classificationId: r.classification_id,
                uploadedBy: r.uploaded_by?.trim() || null,
              });
            }
            const uploaderKeys = [...new Set(rows.map((r) => r.uploaded_by?.trim()).filter(Boolean))] as string[];
            const uploaderMap = await resolveUploaderDisplayByKey(uploaderKeys);

            const { data: catRows } = await supabase.from('case_document_classifications').select('id, label');
            const idToLabel = new Map<string, string>(
              (catRows || []).map((c: { id: string; label: string }) => [c.id, c.label]),
            );
            mappedDocuments = mappedDocuments.map((d) => {
              const meta = itemToMeta.get(d.id);
              const cid = meta?.classificationId;
              const rawUploader = meta?.uploadedBy ?? null;
              const resolved = rawUploader ? uploaderMap.get(rawUploader) : undefined;
              return {
                ...d,
                caseClassificationId: cid ?? null,
                caseClassificationLabel: cid ? idToLabel.get(cid) ?? null : null,
                uploadedByName: resolved?.name ?? rawUploader,
                uploadedByPhotoUrl: resolved?.photoUrl ?? null,
              };
            });
          }
        }

        setDocuments(mappedDocuments);
      } else if (data && !data.success) {
        console.error('Function returned error:', data);
        // Handle specific 404 case (folder not found)
        if (data.error && data.error.includes('not found')) {
          setError(`No documents found for lead ${leadNumber}. Documents may not have been uploaded yet.`);
        } else {
          setError(data.error || 'Failed to fetch documents');
        }
      } else {
        console.error('Unexpected response format:', data);
        setError('Unexpected response format from server');
      }
    } catch (err) {
      console.error('Error fetching documents:', err);
      setError(`Failed to fetch documents: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async (document: Document) => {
    if (downloading.includes(document.id)) return;
    
    setDownloading(prev => [...prev, document.id]);
    try {
      const response = await fetch(document.downloadUrl);
      if (!response.ok) throw new Error('Download failed');
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = window.document.createElement('a');
      link.href = url;
      link.download = document.name;
      window.document.body.appendChild(link);
      link.click();
      window.document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download error:', err);
      alert('Download failed. Please try again.');
    } finally {
      setDownloading(prev => prev.filter(id => id !== document.id));
    }
  };

  const handleDownloadAll = async () => {
    const toDownload = requireCaseDocumentClassification ? documentsInActiveCategory : documents;
    if (toDownload.length === 0) return;

    setDownloading(prev => [...prev, 'all']);
    try {
      for (const doc of toDownload) {
        await handleDownload(doc);
        // Small delay between downloads to avoid overwhelming the browser
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } catch (err) {
      console.error('Bulk download error:', err);
    } finally {
      setDownloading(prev => prev.filter(id => id !== 'all'));
    }
  };

  const handlePreview = (document: Document) => {
    setPreviewDocument(document);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Helper function to get current user's full name
  const getCurrentUserName = async (): Promise<string> => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) return 'Unknown';
      
      const { data: userData, error } = await supabase
        .from('users')
        .select('full_name')
        .eq('auth_id', user.id)
        .single();
      
      if (error || !userData?.full_name) {
        return user?.email || 'Unknown';
      }
      
      return userData.full_name;
    } catch (error) {
      console.error('Error getting user name:', error);
      return 'Unknown';
    }
  };

  // Handle file drop
  const handleFileDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (requireCaseDocumentClassification && !uploadClassificationId) {
      toast.error('Select a document category below to upload.');
      return;
    }
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      await uploadFiles(Array.from(files));
    }
  };

  // Handle file input change
  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (requireCaseDocumentClassification && !uploadClassificationId) {
      toast.error('Select a document category below to upload.');
      e.target.value = '';
      return;
    }
    const files = e.target.files;
    if (files) {
      await uploadFiles(Array.from(files));
    }
  };

  // The main upload function
  const uploadFiles = async (files: File[]) => {
    const classificationIdForBatch = uploadClassificationId;
    if (requireCaseDocumentClassification && !classificationIdForBatch) {
      toast.error('Select a document category below to upload.');
      return;
    }
    setIsUploading(true);
    const newUploads = files.map(file => ({ name: file.name, status: 'uploading' as const, progress: 5 }));
    setUploadedFiles(prev => [...prev, ...newUploads]);

    const progressIntervals: Map<string, NodeJS.Timeout> = new Map();

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
          Math.floor(initialProgress + (easedProgress * progressRange)), 
          targetProgress
        );
        
        if (currentProgress >= targetProgress) {
          clearInterval(interval);
          progressIntervals.delete(fileName);
        }
        
        setUploadedFiles(prev => prev.map(f => 
          f.name === fileName && f.status === 'uploading'
            ? { ...f, progress: currentProgress }
            : f
        ));
      }, updateInterval);
      
      progressIntervals.set(fileName, interval);
      return interval;
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
        const formData = new FormData();
        formData.append('file', file);
        formData.append('leadNumber', leadNumber);
        if (onedriveSubFolder?.trim()) {
          formData.append('subFolder', onedriveSubFolder.trim());
        }

        const { data, error } = await supabase.functions.invoke('upload-to-onedrive', {
          body: formData,
        });

        stopProgressSimulation(file.name);

        if (error) throw new Error(error.message);
        if (!data || !data.success) {
          throw new Error(data.error || 'Upload function returned an error.');
        }

        if (requireCaseDocumentClassification && classificationIdForBatch && onedriveSubFolder?.trim()) {
          const fileId = data.fileId as string | undefined;
          if (!fileId) {
            toast.error('Upload succeeded but file id was missing. Redeploy upload-to-onedrive and try again.');
          } else {
            const uploadedBy = await getCurrentUserName();
            const subTrim = onedriveSubFolder.trim();
            const { error: mapErr } = await supabase.from('lead_case_documents').upsert(
              {
                lead_number: leadNumber,
                onedrive_subfolder: subTrim,
                onedrive_item_id: fileId,
                file_name: file.name,
                classification_id: classificationIdForBatch,
                uploaded_by: uploadedBy,
              },
              { onConflict: 'lead_number,onedrive_item_id' },
            );
            if (mapErr) {
              console.error('lead_case_documents upsert:', mapErr);
              toast.error(`Saved to OneDrive but classification was not saved: ${mapErr.message}`);
            }
          }
        }

        setUploadedFiles(prev => prev.map(f => 
          f.name === file.name 
            ? { ...f, status: 'success' as const, progress: 100 } 
            : f
        ));
        
        // Refresh documents list after successful upload
        await fetchDocuments();

      } catch (err) {
        stopProgressSimulation(file.name);
        const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred';
        setUploadedFiles(prev => prev.map(f => 
          f.name === file.name 
            ? { ...f, status: 'error' as const, error: errorMessage, progress: 0 } 
            : f
        ));
        console.error(`Error uploading ${file.name}:`, err);
      }
    }
    
    progressIntervals.forEach((interval) => clearInterval(interval));
    progressIntervals.clear();
    setIsUploading(false);
    
    // Clear uploaded files after a delay
    setTimeout(() => {
      setUploadedFiles([]);
    }, 3000);
  };

  if (typeof window === 'undefined') return null;

  return createPortal(
    <div className={`fixed inset-0 z-[1000] flex items-end justify-end bg-black bg-opacity-40 transition-opacity duration-300 ${isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`} style={{ top: 0, left: 0 }}>
      <div
        className={`fixed right-0 top-0 flex h-full max-h-full w-full min-w-0 max-w-2xl min-h-[350px] flex-col overflow-hidden rounded-l-2xl bg-white p-10 shadow-2xl transition-transform duration-500 ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
        style={{ boxShadow: '0 0 40px 0 rgba(0,0,0,0.2)' }}
      >
        {/* Modal Header */}
        <div className="mb-6 flex min-w-0 shrink-0 items-center justify-between gap-3">
          <div className="min-w-0 flex-1 pr-2">
            <h2 className="text-2xl font-bold mb-1">{modalTitle ?? 'Documents'}</h2>
            <p className="text-base-content/70 text-sm">Lead: {clientName} ({leadNumber})</p>
            {folderPathHint ? (
              <p className="text-base-content/60 mt-1 text-xs">{folderPathHint}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <button
              className="btn btn-primary btn-sm"
              onClick={handleDownloadAll}
              disabled={
                loading ||
                (requireCaseDocumentClassification ? documentsInActiveCategory.length === 0 : documents.length === 0)
              }
            >
              <ArrowDownTrayIcon className="w-5 h-5 mr-1" />
              Download All
            </button>
            <button className="btn btn-ghost btn-circle" onClick={onClose}>
              <XMarkIcon className="w-6 h-6" />
            </button>
          </div>
        </div>
        {/* Modal body: vertical scroll only; horizontal overflow clipped (tab row scrolls inside its own strip). */}
        <div className="min-h-0 w-full min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain [-webkit-overflow-scrolling:touch]">
          {requireCaseDocumentClassification && classificationsError ? (
            <p className="mb-4 text-sm text-error">{classificationsError}</p>
          ) : null}

          {requireCaseDocumentClassification &&
          activeBrowseCategoryId === 'uncategorized' &&
          !caseUploadBlocked ? (
            <p className="mb-4 text-xs text-base-content/60">
              Select a document category below to upload new files.
            </p>
          ) : null}

          {/* Case docs: upload when a real category tab is active. Expert: always. */}
          {(() => {
            const showUploadZone = !requireCaseDocumentClassification || !!uploadClassificationId;
            if (!showUploadZone) return null;
            const uploadLabel = uploadClassificationId
              ? classifications.find((c) => c.id === uploadClassificationId)?.label
              : undefined;
            return (
              <>
                {requireCaseDocumentClassification && uploadLabel ? (
                  <p className="mb-2 text-xs text-base-content/65">
                    Uploads are added to <span className="font-medium text-base-content/90">{uploadLabel}</span>.
                  </p>
                ) : null}
                <div
                  className={`mb-6 max-w-full min-w-0 rounded-lg border-2 border-dashed p-6 text-center transition-colors duration-200 sm:p-8 ${
                    isUploading
                      ? 'border-primary bg-gray-50'
                      : 'border-gray-300 bg-gray-50 hover:border-primary hover:bg-purple-50'
                  } ${caseUploadBlocked ? 'pointer-events-none opacity-50' : ''}`}
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
                      : caseUploadBlocked
                        ? 'Unable to upload while classifications are loading.'
                        : 'Drag and drop files here, or click to select files'}
                  </div>
                  <input
                    type="file"
                    className="hidden"
                    id="file-upload-modal"
                    multiple
                    onChange={handleFileInput}
                    disabled={isUploading || caseUploadBlocked}
                  />
                  <label
                    htmlFor="file-upload-modal"
                    className={`btn btn-outline btn-primary ${isUploading || caseUploadBlocked ? 'btn-disabled' : ''}`}
                  >
                    <PaperClipIcon className="h-5 w-5" />
                    Choose Files
                  </label>
                </div>
              </>
            );
          })()}

          {/* Uploaded Files List */}
          {uploadedFiles.length > 0 && (
            <div className="space-y-2 mb-6">
              {uploadedFiles.map((file, index) => (
                <div key={index} className="flex min-w-0 items-center justify-between gap-2 rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <PaperClipIcon className="w-5 h-5 shrink-0 text-primary" />
                    <span className="min-w-0 truncate text-base font-medium text-gray-900">{file.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {file.status === 'uploading' && (
                      <div className="flex items-center gap-2">
                        <div className="radial-progress text-xs" style={{ "--value": file.progress || 0, "--size": "2.5rem", color: '#3b28c7' } as any}>
                          <span className="text-xs font-semibold">{Math.round(file.progress || 0)}%</span>
                        </div>
                        <div className="text-xs text-gray-500 font-medium">Uploading...</div>
                      </div>
                    )}
                    {file.status === 'success' && (
                      <div className="flex items-center gap-2">
                        <CheckCircleIcon className="w-6 h-6 text-green-500" />
                        <span className="text-xs text-green-600 font-medium">Complete</span>
                      </div>
                    )}
                    {file.status === 'error' && (
                      <div className="tooltip tooltip-error" data-tip={file.error}>
                        <div className="flex items-center gap-2">
                          <XCircleIcon className="w-6 h-6 text-red-500" />
                          <span className="text-xs text-red-600 font-medium">Failed</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Documents List */}
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="loading loading-spinner loading-lg"></div>
              <span className="ml-3">Loading documents...</span>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center py-12 text-error">
              <ExclamationTriangleIcon className="w-8 h-8 mr-3" />
              <span>{error}</span>
            </div>
          ) : documents.length === 0 && !requireCaseDocumentClassification ? (
            <div className="text-center py-12 text-base-content/70">
              <DocumentIcon className="w-16 h-16 mx-auto mb-4 opacity-50" />
              <p>No documents found for this lead.</p>
            </div>
          ) : (
            <>
              {requireCaseDocumentClassification && classifications.length > 0 ? (
                <div className="mb-4 flex w-full min-w-0 max-w-full flex-col gap-4">
                  <nav
                    className="flex w-full min-w-0 max-w-full touch-pan-x flex-nowrap items-stretch gap-2 overflow-x-auto overflow-y-hidden overscroll-x-contain border-b border-base-200 pb-2 [-webkit-overflow-scrolling:touch]"
                    aria-label="Document categories"
                  >
                    {classifications.map((c) => {
                      const count = documents.filter((d) => d.caseClassificationId === c.id).length;
                      const active = activeBrowseCategoryId === c.id;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setActiveBrowseCategoryId(c.id);
                          }}
                          className={`btn btn-sm inline-flex h-auto min-h-0 shrink-0 touch-manipulation select-none items-center gap-2 whitespace-nowrap rounded-lg border-0 px-3 py-2.5 text-sm font-normal shadow-none ${
                            active
                              ? 'btn-primary text-white'
                              : 'bg-base-200/90 text-base-content hover:bg-base-300/80'
                          }`}
                        >
                          <span className="max-w-[12rem] truncate sm:max-w-[14rem]">{c.label}</span>
                          <span className={`tabular-nums text-sm ${active ? 'opacity-90' : 'opacity-70'}`}>
                            {count}
                          </span>
                        </button>
                      );
                    })}
                    {(() => {
                      const uncCount = documents.filter((d) => !d.caseClassificationId).length;
                      const active = activeBrowseCategoryId === 'uncategorized';
                      return (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setActiveBrowseCategoryId('uncategorized');
                          }}
                          className={`btn btn-sm inline-flex h-auto min-h-0 shrink-0 touch-manipulation select-none items-center gap-2 whitespace-nowrap rounded-lg border-0 px-3 py-2.5 text-sm font-normal shadow-none ${
                            active
                              ? 'btn-primary text-white'
                              : 'bg-base-200/90 text-base-content hover:bg-base-300/80'
                          }`}
                        >
                          <span>Uncategorized</span>
                          <span className={`tabular-nums text-sm ${active ? 'opacity-90' : 'opacity-70'}`}>
                            {uncCount}
                          </span>
                        </button>
                      );
                    })()}
                  </nav>
                  <div className="min-w-0 w-full">
                    {documents.length === 0 ? (
                      <div className="py-12 text-center text-base-content/70">
                        <DocumentIcon className="mx-auto mb-4 h-16 w-16 opacity-50" />
                        <p>No documents found for this lead.</p>
                      </div>
                    ) : documentsInActiveCategory.length === 0 ? (
                      <div className="py-10 text-center text-base-content/70">
                        <p>No documents in this category.</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {documentsInActiveCategory.map((doc) => {
                          const isDownloading = downloading.includes(doc.id);

                          return (
                            <div
                              key={doc.id}
                              className="flex min-w-0 max-w-full items-center justify-between gap-3 rounded-lg bg-gray-50 p-5 transition-colors hover:bg-gray-100/90 dark:bg-gray-800/45 dark:hover:bg-gray-800/70"
                            >
                              <div className="flex min-w-0 flex-1 items-center gap-4">
                                <span className="shrink-0">
                                  <DocumentFileGlyph fileType={doc.fileType} fileName={doc.name} />
                                </span>
                                <div className="min-w-0 flex-1 overflow-hidden">
                                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                                    <p className="min-w-0 break-words text-base font-semibold leading-snug text-base-content [overflow-wrap:anywhere]">
                                      {doc.name}
                                    </p>
                                    <DocumentUploaderAttribution doc={doc} />
                                  </div>
                                  <p className="mt-1 text-sm text-base-content/70">{formatDate(doc.lastModified)}</p>
                                </div>
                              </div>

                              <DocumentRowActionMenu
                                doc={doc}
                                isDownloading={isDownloading}
                                onPreview={handlePreview}
                                onDownload={handleDownload}
                              />
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <>
                  {documents.length === 0 ? (
                    <div className="py-12 text-center text-base-content/70">
                      <DocumentIcon className="mx-auto mb-4 h-16 w-16 opacity-50" />
                      <p>No documents found for this lead.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {documents.map((doc) => {
                        const isDownloading = downloading.includes(doc.id);

                        return (
                          <div
                            key={doc.id}
                            className="flex min-w-0 max-w-full items-center justify-between gap-3 rounded-lg bg-gray-50 p-5 transition-colors hover:bg-gray-100/90 dark:bg-gray-800/45 dark:hover:bg-gray-800/70"
                          >
                            <div className="flex min-w-0 flex-1 items-center gap-4">
                              <span className="shrink-0">
                                <DocumentFileGlyph fileType={doc.fileType} fileName={doc.name} />
                              </span>
                              <div className="min-w-0 flex-1 overflow-hidden">
                                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                                  <p className="min-w-0 break-words text-base font-semibold leading-snug text-base-content [overflow-wrap:anywhere]">
                                    {doc.name}
                                  </p>
                                  <DocumentUploaderAttribution doc={doc} />
                                </div>
                                <p className="mt-1 text-sm text-base-content/70">{formatDate(doc.lastModified)}</p>
                              </div>
                            </div>

                            <DocumentRowActionMenu
                              doc={doc}
                              isDownloading={isDownloading}
                              onPreview={handlePreview}
                              onDownload={handleDownload}
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* Preview Modal */}
      {previewDocument && (
        <div className="fixed inset-0 z-60 flex items-center justify-center">
          <div className="absolute inset-0 bg-black bg-opacity-75" onClick={() => setPreviewDocument(null)} />
          <div className="relative bg-base-100 rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-base-300">
              <h3 className="text-lg font-semibold">{previewDocument.name}</h3>
              <button
                onClick={() => setPreviewDocument(null)}
                className="btn btn-ghost btn-circle"
              >
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>
            <div className="p-4 h-[calc(90vh-120px)] overflow-auto">
              {previewDocument.fileType.includes('image/') ? (
                <img
                  src={previewDocument.downloadUrl}
                  alt={previewDocument.name}
                  className="max-w-full h-auto mx-auto"
                />
              ) : previewDocument.fileType.includes('pdf') ? (
                <iframe
                  src={previewDocument.downloadUrl}
                  className="w-full h-full border-0"
                  title={previewDocument.name}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-base-content/70">
                  <DocumentIcon className="w-16 h-16 mr-4" />
                  <p>Preview not available for this file type.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>,
    window.document.body
  );
};

export default DocumentModal; 