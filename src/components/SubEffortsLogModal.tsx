import React, { useMemo, useRef, useState } from 'react';
import {
  ArrowPathIcon,
  ArrowUpTrayIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  EyeIcon,
  PlusIcon,
  LockClosedIcon,
  PencilSquareIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import { CLIENT_HEADER_ONEDRIVE_SUBFOLDER } from '../lib/leadOneDrivePaths';

type LeadSubEffortRow = any;

const SUB_EFFORTS_DOCS_BUCKET = 'lead-sub-efforts-documents';

type CaseDocPick = {
  id: string;
  file_name: string;
  storage_path: string;
  mime_type: string | null;
  created_at: string;
  signedUrl?: string;
};

function formatDateTime(value: any): string {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

function asArray(value: any): any[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return [value];
}

type DocItem = {
  url?: string;
  path?: string;
  name?: string;
  mimeType?: string;
};

function normalizeDocItems(documentUrl: any): DocItem[] {
  if (!documentUrl) return [];

  // Common cases: string URL/path, array, or JSON object with { urls: [...] } / { files: [...] } / { documents: [...] }.
  if (typeof documentUrl === 'string') {
    const s = documentUrl.trim();
    if (!s) return [];
    if (/^https?:\/\//i.test(s)) return [{ url: s }];
    return [{ path: s }];
  }
  if (Array.isArray(documentUrl)) {
    const out: DocItem[] = [];
    for (const u of documentUrl) {
      out.push(...normalizeDocItems(u));
    }
    return out;
  }
  if (typeof documentUrl === 'object') {
    const candidates = [
      ...(asArray((documentUrl as any).urls) ?? []),
      ...(asArray((documentUrl as any).files) ?? []),
      ...(asArray((documentUrl as any).documents) ?? []),
    ];
    // If this object itself looks like a doc record, keep it.
    if (
      (documentUrl as any).path ||
      (documentUrl as any).url ||
      (documentUrl as any).publicUrl ||
      (documentUrl as any).signedUrl
    ) {
      const path = typeof (documentUrl as any).path === 'string' ? (documentUrl as any).path.trim() : undefined;
      const url =
        typeof (documentUrl as any).url === 'string'
          ? (documentUrl as any).url.trim()
          : typeof (documentUrl as any).publicUrl === 'string'
            ? (documentUrl as any).publicUrl.trim()
            : typeof (documentUrl as any).signedUrl === 'string'
              ? (documentUrl as any).signedUrl.trim()
              : undefined;
      const name = typeof (documentUrl as any).name === 'string' ? (documentUrl as any).name : undefined;
      const mimeType =
        typeof (documentUrl as any).mimeType === 'string'
          ? (documentUrl as any).mimeType
          : typeof (documentUrl as any).contentType === 'string'
            ? (documentUrl as any).contentType
            : undefined;
      const item: DocItem = {};
      if (url) item.url = url;
      if (path) item.path = path;
      if (name) item.name = name;
      if (mimeType) item.mimeType = mimeType;
      return [item].filter((i) => i.url || i.path);
    }
    const out: DocItem[] = [];
    for (const c of candidates) out.push(...normalizeDocItems(c));
    return out;
  }

  return [];
}

function isImageUrl(url: string): boolean {
  const raw = String(url || '').trim();
  if (!raw) return false;
  // Signed URLs include query params; evaluate only the path part.
  const withoutQuery = raw.split('?')[0].split('#')[0].toLowerCase();
  return (
    withoutQuery.endsWith('.png') ||
    withoutQuery.endsWith('.jpg') ||
    withoutQuery.endsWith('.jpeg') ||
    withoutQuery.endsWith('.gif') ||
    withoutQuery.endsWith('.webp')
  );
}

function isPdfUrl(url: string): boolean {
  const raw = String(url || '').trim();
  if (!raw) return false;
  const withoutQuery = raw.split('?')[0].split('#')[0].toLowerCase();
  return withoutQuery.endsWith('.pdf');
}

function isImageMime(mime: string | null | undefined): boolean {
  const m = String(mime || '').toLowerCase();
  return m.startsWith('image/');
}

function inferMimeFromName(name: string): string {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  return 'application/octet-stream';
}

function guessPathList(documentUrl: any): string[] {
  return normalizeDocItems(documentUrl)
    .map((d) => (typeof d.path === 'string' ? d.path.trim() : ''))
    .filter(Boolean);
}

function containsHebrew(text: string): boolean {
  // Hebrew block: \u0590-\u05FF
  return /[\u0590-\u05FF]/.test(text);
}

function VisibilityPill({ internal }: { internal: boolean }) {
  const isInternal = internal === true;
  const Icon = isInternal ? LockClosedIcon : EyeIcon;
  const label = isInternal ? 'Internal' : 'Viewable by client';
  const cls = isInternal
    ? 'bg-amber-50 text-amber-900 border-amber-200'
    : 'bg-sky-50 text-sky-900 border-sky-200';
  return (
    <div className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${cls}`}>
      <Icon className="w-4 h-4" />
      <span>{label}</span>
    </div>
  );
}

function EmployeeChip({
  label,
  name,
  employee,
  timestamp,
}: {
  label: string;
  name: string;
  employee?: any;
  timestamp?: any;
}) {
  const displayName = (employee?.display_name || name || '—') as string;
  const photoUrl = (employee?.photo_url as string | null | undefined) ?? null;
  const photo = (employee?.photo as string | null | undefined) ?? null;
  const src = photoUrl || photo || null;
  const initials = displayName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((s: string) => s[0]?.toUpperCase())
    .join('');

  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 whitespace-nowrap">
        {label}
      </div>
      <div className="flex items-center gap-2 min-w-0">
        <div className="avatar">
          <div className="w-7 h-7 rounded-full bg-base-200 overflow-hidden flex items-center justify-center">
            {src ? (
              <img src={src} alt={displayName} className="w-full h-full object-cover" />
            ) : (
              <span className="text-[11px] font-semibold text-gray-600">{initials || '—'}</span>
            )}
          </div>
        </div>
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{displayName}</div>
          {timestamp ? (
            <div className="text-xs opacity-70 truncate">{formatDateTime(timestamp)}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

async function loadPdfJs(): Promise<any> {
  let pdfjsLib: any =
    (window as any).pdfjsLib || (window as any).pdfjs || (window as any).pdfjsDist || (window as any).pdfjsDist?.default;

  if (!pdfjsLib) {
    const existingScript = document.querySelector('script[data-pdfjs]');
    if (!existingScript) {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
      script.setAttribute('data-pdfjs', 'true');
      document.head.appendChild(script);
      await new Promise<void>((resolve, reject) => {
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Failed to load PDF.js'));
      });
    } else {
      // Wait a tick to allow the script to populate window globals.
      await new Promise((r) => setTimeout(r, 50));
    }
    pdfjsLib =
      (window as any).pdfjsLib || (window as any).pdfjs || (window as any).pdfjsDist || (window as any).pdfjsDist?.default;
  }

  if (!pdfjsLib) {
    throw new Error('PDF.js library not available');
  }

  if (pdfjsLib.GlobalWorkerOptions) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsLib.version
      ? `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.js`
      : 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  }

  return pdfjsLib;
}

function PdfCanvasPreview({
  url,
  title,
}: {
  url: string;
  title: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    const el = containerRef.current;
    if (!el) return;
    if (!url) return;

    void (async () => {
      setIsLoading(true);
      setErrorMsg(null);
      try {
        const pdfjsLib = await loadPdfJs();
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Failed to fetch PDF (${res.status})`);
        const arrayBuffer = await res.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

        // Clear existing canvases
        el.innerHTML = '';

        const maxPages = Math.min(pdf.numPages || 1, 10);
        for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
          if (cancelled) return;
          const page = await pdf.getPage(pageNum);
          const viewport1 = page.getViewport({ scale: 1 });
          const containerWidth = el.clientWidth || 600;
          const scale = Math.max(0.5, Math.min(3, (containerWidth - 8) / viewport1.width));
          const viewport = page.getViewport({ scale });

          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          if (!ctx) continue;
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.width = '100%';
          canvas.style.height = 'auto';
          canvas.style.display = 'block';
          canvas.style.borderRadius = '12px';
          canvas.style.background = 'white';

          const wrap = document.createElement('div');
          wrap.style.padding = '4px';
          wrap.appendChild(canvas);
          el.appendChild(wrap);

          await page.render({ canvasContext: ctx, viewport }).promise;
        }
      } catch (e: any) {
        console.error('PDF preview failed:', e);
        setErrorMsg(e?.message || 'PDF preview failed');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [url]);

  return (
    <div className="relative h-full w-full">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-black/70 to-transparent z-[2]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 px-3 py-2 text-xs text-white truncate z-[3]">
        PDF document preview{title ? ` · ${title}` : ''}
      </div>

      <div className="h-full w-full overflow-y-auto overflow-x-hidden pt-10 pb-10">
        <div ref={containerRef} className="w-full" />
        {isLoading ? (
          <div className="absolute inset-0 flex items-center justify-center text-xs opacity-70">
            Generating preview…
          </div>
        ) : null}
        {errorMsg ? (
          <div className="absolute inset-0 flex items-center justify-center text-xs opacity-70 px-3 text-center">
            {errorMsg}
          </div>
        ) : null}
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-black/70 to-transparent z-[2]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 px-3 py-2 text-xs text-white truncate z-[3]">
        {title || 'PDF document'}
      </div>
    </div>
  );
}

export function SubEffortsLogModal({
  open,
  onClose,
  rows,
  leadNumber,
  caseDocumentsSubfolder = CLIENT_HEADER_ONEDRIVE_SUBFOLDER,
  initialSelectedRowId,
  onRefresh,
}: {
  open: boolean;
  onClose: () => void;
  rows: LeadSubEffortRow[];
  leadNumber?: string | null;
  caseDocumentsSubfolder?: string | null;
  initialSelectedRowId?: string | number | null;
  onRefresh?: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | number | null>(initialSelectedRowId ?? null);
  const [mobileStep, setMobileStep] = useState<'list' | 'details'>('list');
  const [isUploading, setIsUploading] = useState(false);
  const [signedUrls, setSignedUrls] = useState<Map<string, string>>(() => new Map());
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDraggingDocs, setIsDraggingDocs] = useState(false);
  const [isNotesModalOpen, setIsNotesModalOpen] = useState(false);
  const [notesKind, setNotesKind] = useState<'internal' | 'client'>('internal');
  const [notesDraft, setNotesDraft] = useState('');
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const [isTogglingInternal, setIsTogglingInternal] = useState(false);
  const [isAttachModalOpen, setIsAttachModalOpen] = useState(false);
  const [caseDocs, setCaseDocs] = useState<CaseDocPick[]>([]);
  const [caseDocsLoading, setCaseDocsLoading] = useState(false);
  const [selectedCaseDocIds, setSelectedCaseDocIds] = useState<Set<string>>(() => new Set());
  const [isAttaching, setIsAttaching] = useState(false);
  const selectedRow = useMemo(() => {
    if (!rows?.length) return null;
    if (selectedId == null) return rows[0] ?? null;
    return rows.find((r: any) => String(r?.id) === String(selectedId)) ?? rows[0] ?? null;
  }, [rows, selectedId]);

  // Keep selection in sync when opened with a specific row
  React.useEffect(() => {
    if (!open) return;
    setMobileStep('list');
    if (initialSelectedRowId != null) setSelectedId(initialSelectedRowId);
    else if (rows?.[0]?.id != null) setSelectedId(rows[0].id);
  }, [open, initialSelectedRowId, rows]);

  // Resolve storage paths (private bucket) to signed URLs for previews.
  React.useEffect(() => {
    if (!open) return;
    if (!selectedRow) return;
    const paths = guessPathList(selectedRow?.document_url);
    if (!paths.length) return;
    let cancelled = false;
    void (async () => {
      try {
        const missing = paths.filter((p) => !signedUrls.has(p));
        if (!missing.length) return;
        // Prefer bulk API (faster), but fall back for older/limited environments.
        const storageBucket: any = supabase.storage.from(SUB_EFFORTS_DOCS_BUCKET) as any;
        let data: any[] = [];
        if (typeof storageBucket.createSignedUrls === 'function') {
          const res = await storageBucket.createSignedUrls(missing, 60 * 60);
          if (res?.error) throw res.error;
          data = res?.data ?? [];
        } else {
          const results = await Promise.all(
            missing.map(async (p) => {
              const res = await storageBucket.createSignedUrl(p, 60 * 60);
              if (res?.error) throw res.error;
              return { path: p, signedUrl: res?.data?.signedUrl };
            })
          );
          data = results;
        }
        if (cancelled) return;
        setSignedUrls((prev) => {
          const next = new Map(prev);
          for (const item of data ?? []) {
            if (item?.path && item?.signedUrl) next.set(item.path, item.signedUrl);
          }
          return next;
        });
      } catch (e) {
        console.error('Error creating signed URLs for sub effort documents:', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, selectedRow?.document_url, selectedRow?.id, signedUrls]);

  if (!open) return null;

  const toggleInternal = async () => {
    if (!selectedRow?.id) return;
    if (isTogglingInternal) return;
    setIsTogglingInternal(true);
    try {
      const nextVal = !(selectedRow?.internal === true);
      const { error } = await supabase
        .from('lead_sub_efforts')
        .update({ internal: nextVal })
        .eq('id', selectedRow.id);
      if (error) throw error;
      toast.success(nextVal ? 'Marked as Internal' : 'Marked as viewable by client');
      onRefresh?.();
    } catch (e: any) {
      console.error('Error toggling internal:', e);
      toast.error(`Failed to update: ${e?.message || 'Unknown error'}`);
    } finally {
      setIsTogglingInternal(false);
    }
  };

  const openNotesEditor = (kind: 'internal' | 'client') => {
    setNotesKind(kind);
    const current =
      kind === 'internal' ? (selectedRow?.internal_notes ?? '') : (selectedRow?.client_notes ?? '');
    setNotesDraft(String(current ?? ''));
    setIsNotesModalOpen(true);
  };

  const saveNotes = async () => {
    if (!selectedRow?.id) return;
    if (isSavingNotes) return;
    setIsSavingNotes(true);
    try {
      const patch: any = notesKind === 'internal'
        ? { internal_notes: notesDraft }
        : { client_notes: notesDraft };
      const { error } = await supabase
        .from('lead_sub_efforts')
        .update(patch)
        .eq('id', selectedRow.id);
      if (error) throw error;
      toast.success('Notes saved');
      setIsNotesModalOpen(false);
      onRefresh?.();
    } catch (e: any) {
      console.error('Error saving sub effort notes:', e);
      toast.error(`Failed to save notes: ${e?.message || 'Unknown error'}`);
    } finally {
      setIsSavingNotes(false);
    }
  };

  const handleUploadFiles = async (files: FileList | null) => {
    if (!selectedRow?.id) return;
    if (!files || files.length === 0) return;
    if (isUploading) return;

    setIsUploading(true);
    try {
      const id = selectedRow.id;
      const leadKey = selectedRow?.new_lead_id || selectedRow?.legacy_lead_id || 'unknown-lead';
      const uploadedPaths: string[] = [];

      for (const file of Array.from(files)) {
        const safeName = file.name.replace(/[^\w.\-()+\s]/g, '_');
        // Storage object path is *inside* the bucket (do not prefix bucket name).
        const path = `sub-efforts/${String(leadKey)}/${String(id)}/${Date.now()}_${safeName}`;
        const { error } = await supabase.storage.from(SUB_EFFORTS_DOCS_BUCKET).upload(path, file, {
          upsert: false,
          contentType: file.type || undefined,
        });
        if (error) throw error;
        uploadedPaths.push(path);
      }

      // Merge into existing document_url (store paths; modal will sign them for display)
      const existingItems = normalizeDocItems(selectedRow?.document_url);
      const existingKeySet = new Set(existingItems.map((d) => d.path || d.url).filter(Boolean) as string[]);
      const addedItems: DocItem[] = Array.from(files).map((file, idx) => ({
        path: uploadedPaths[idx],
        name: file.name,
        mimeType: file.type || undefined,
      }));
      const mergedItems = [
        ...existingItems,
        ...addedItems.filter((d) => {
          const k = d.path || d.url;
          return k ? !existingKeySet.has(k) : false;
        }),
      ];
      const nextDocumentUrl = mergedItems;

      const { error: updateError } = await supabase
        .from('lead_sub_efforts')
        .update({ document_url: nextDocumentUrl })
        .eq('id', selectedRow.id);
      if (updateError) throw updateError;

      toast.success('Documents uploaded');
      onRefresh?.();
    } catch (e: any) {
      console.error('Error uploading sub effort documents:', e);
      toast.error(`Upload failed: ${e?.message || 'Unknown error'}`);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const openAttachFromCaseDocs = async () => {
    if (!leadNumber?.trim()) {
      toast.error('Lead number is missing, cannot load case documents.');
      return;
    }
    setIsAttachModalOpen(true);
    setSelectedCaseDocIds(new Set());
    setCaseDocsLoading(true);
    try {
      const sub = caseDocumentsSubfolder?.trim() ? caseDocumentsSubfolder.trim() : null;
      let q = supabase
        .from('lead_case_documents')
        .select('id, file_name, storage_path, mime_type, created_at')
        .eq('lead_number', leadNumber.trim())
        .not('storage_path', 'is', null)
        .order('created_at', { ascending: false })
        .limit(100);
      if (sub) q = q.eq('onedrive_subfolder', sub);
      else q = q.is('onedrive_subfolder', null);

      const { data, error } = await q;
      if (error) throw error;
      const base = ((data as any[]) || []).map((r) => ({
        id: String(r.id),
        file_name: String(r.file_name || ''),
        storage_path: String(r.storage_path || ''),
        mime_type: typeof r.mime_type === 'string' ? (r.mime_type as string) : null,
        created_at: String(r.created_at || new Date().toISOString()),
      })) as CaseDocPick[];

      // Sign URLs for preview/open (images + docs)
      const storage = supabase.storage.from(SUB_EFFORTS_DOCS_BUCKET) as any;
      const signSeconds = 60 * 60;

      const withUrls: CaseDocPick[] = await Promise.all(
        base.map(async (d) => {
          if (!d.storage_path) return d;
          try {
            const { data: signed } = await storage.createSignedUrl(d.storage_path, signSeconds);
            const u = signed?.signedUrl ? String(signed.signedUrl) : '';
            return u ? { ...d, signedUrl: u } : d;
          } catch {
            return d;
          }
        }),
      );

      setCaseDocs(withUrls);
    } catch (e: any) {
      console.error('openAttachFromCaseDocs:', e);
      toast.error(String(e?.message || 'Failed to load case documents'));
      setCaseDocs([]);
    } finally {
      setCaseDocsLoading(false);
    }
  };

  const attachSelectedCaseDocs = async () => {
    if (!selectedRow?.id) return;
    if (isAttaching) return;
    const ids = [...selectedCaseDocIds];
    if (ids.length === 0) {
      toast.error('Select at least one file to attach.');
      return;
    }
    setIsAttaching(true);
    try {
      const existingItems = normalizeDocItems(selectedRow?.document_url);
      const existingKeySet = new Set(existingItems.map((d) => (d.path || d.url || '').trim()).filter(Boolean));

      const picked = caseDocs.filter((d) => selectedCaseDocIds.has(d.id));
      const addedItems: DocItem[] = picked
        .filter((d) => d.storage_path?.trim())
        .map((d) => ({
          path: d.storage_path.trim(),
          name: d.file_name || undefined,
          mimeType: d.mime_type || inferMimeFromName(d.file_name),
        }))
        .filter((d) => d.path && !existingKeySet.has(String(d.path)));

      const merged = [...existingItems, ...addedItems];

      const { error } = await supabase
        .from('lead_sub_efforts')
        .update({ document_url: merged })
        .eq('id', selectedRow.id);
      if (error) throw error;

      toast.success('Attached to sub effort');
      setIsAttachModalOpen(false);
      onRefresh?.();
    } catch (e: any) {
      console.error('attachSelectedCaseDocs:', e);
      toast.error(String(e?.message || 'Failed to attach'));
    } finally {
      setIsAttaching(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="absolute inset-0 bg-base-100 p-0 overflow-hidden rounded-none">
        <div className="flex items-center justify-between px-4 py-4 border-b border-base-200">
          <div className="min-w-0 flex items-center gap-3">
            {mobileStep === 'details' ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm md:hidden"
                onClick={() => setMobileStep('list')}
                aria-label="Back to list"
                title="Back"
              >
                <ChevronLeftIcon className="w-5 h-5" />
              </button>
            ) : null}
            <div className="min-w-0">
              <div className="text-base font-semibold">Sub efforts</div>
              <div className="text-xs opacity-70 truncate">
                {rows?.length ? `${rows.length} row${rows.length === 1 ? '' : 's'}` : 'No rows'}
              </div>
            </div>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] lg:grid-cols-[300px_1fr] h-[calc(100vh-65px)]">
          <div
            className={[
              'border-b md:border-b-0 md:border-r border-base-200 overflow-auto',
              mobileStep === 'details' ? 'hidden md:block' : 'block',
            ].join(' ')}
          >
            <div className="p-4">
              {rows?.length ? (
                <div className="flex flex-col gap-2">
                  {rows.map((r: any) => {
                    const name = r?.sub_efforts?.name ?? '—';
                    const who = r?.tenants_employee?.display_name ?? r?.created_by ?? '—';
                    const when = r?.created_at ? new Date(r.created_at).toLocaleString() : '—';
                    const isSelected = selectedRow?.id != null && String(selectedRow.id) === String(r?.id);
                    return (
                      <button
                        key={r?.id ?? `${name}-${when}`}
                        type="button"
                        className={`w-full text-left px-4 py-3 rounded-2xl border border-base-200/80 hover:bg-base-200/60 hover:border-base-300 ${
                          isSelected ? 'bg-base-200' : ''
                        }`}
                        onClick={() => {
                          setSelectedId(r?.id ?? null);
                          setMobileStep('details');
                        }}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="text-[15px] font-semibold truncate leading-snug">{name}</div>
                            <div className="mt-1 text-[13px] opacity-70 truncate">
                              by <span className="font-medium">{String(who)}</span> · {when}
                            </div>
                          </div>
                          <ChevronRightIcon className="h-5 w-5 opacity-50 md:hidden" aria-hidden />
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="text-sm opacity-70">No sub efforts yet.</div>
              )}
            </div>
          </div>

          <div
            className={[
              'overflow-auto',
              mobileStep === 'details' ? 'block' : 'hidden md:block',
            ].join(' ')}
          >
            <div className="p-5">
              {selectedRow ? (
                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-base font-semibold truncate">
                        {selectedRow?.sub_efforts?.name ?? 'Sub effort'}
                      </div>
                      <div className="mt-1 flex items-center gap-2 min-w-0">
                        <div className="avatar">
                          <div className="w-8 h-8 rounded-full bg-base-200 overflow-hidden flex items-center justify-center">
                            {(() => {
                              const emp = selectedRow?.tenants_employee;
                              const src = (emp?.photo_url as string | null | undefined) ?? (emp?.photo as string | null | undefined) ?? null;
                              const name = String(emp?.display_name ?? selectedRow?.created_by ?? '—');
                              const initials = name
                                .split(' ')
                                .filter(Boolean)
                                .slice(0, 2)
                                .map((s: string) => s[0]?.toUpperCase())
                                .join('');
                              if (src) return <img src={src} alt={name} className="w-full h-full object-cover" />;
                              return <span className="text-[11px] font-semibold text-gray-600">{initials || '—'}</span>;
                            })()}
                          </div>
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm opacity-80 truncate">
                            by{' '}
                            <span className="font-medium">
                              {String(selectedRow?.tenants_employee?.display_name ?? selectedRow?.created_by ?? '—')}
                            </span>
                          </div>
                          <div className="text-xs opacity-70 truncate">{formatDateTime(selectedRow?.created_at)}</div>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <VisibilityPill internal={selectedRow?.internal === true} />
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs btn-circle"
                        onClick={() => void toggleInternal()}
                        disabled={isTogglingInternal}
                        aria-label="Toggle internal/viewable"
                        title="Toggle internal/viewable"
                      >
                        {isTogglingInternal ? (
                          <span className="loading loading-spinner loading-xs" />
                        ) : (
                          <ArrowPathIcon className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
                    <div>
                      <div className="flex items-center justify-between gap-3 mb-2">
                        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                          Internal notes
                        </div>
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs btn-circle"
                          onClick={() => openNotesEditor('internal')}
                          aria-label="Edit internal notes"
                          title="Edit internal notes"
                        >
                          <PencilSquareIcon className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="rounded-2xl border border-base-200 bg-gray-50/60 px-4 py-3">
                        {selectedRow?.internal_notes ? (
                          <div className="text-sm whitespace-pre-wrap break-words min-h-[42px]">
                            {selectedRow?.internal_notes}
                          </div>
                        ) : (
                          <div className="text-sm text-gray-500">No internal notes.</div>
                        )}
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between gap-3 mb-2">
                        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                          Client notes
                        </div>
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs btn-circle"
                          onClick={() => openNotesEditor('client')}
                          aria-label="Edit client notes"
                          title="Edit client notes"
                        >
                          <PencilSquareIcon className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="rounded-2xl border border-base-200 bg-gray-50/60 px-4 py-3">
                        {selectedRow?.client_notes ? (
                          <div className="text-sm whitespace-pre-wrap break-words min-h-[42px]">
                            {selectedRow?.client_notes}
                          </div>
                        ) : (
                          <div className="text-sm text-gray-500">No client notes.</div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-base-200 bg-base-100 p-4">
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <div className="text-xs font-semibold uppercase tracking-wide opacity-70">
                        Documents
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs btn-circle"
                          onClick={() => void openAttachFromCaseDocs()}
                          disabled={!selectedRow?.id}
                          aria-label="Attach from case documents"
                          title="Attach from case documents"
                        >
                          <PlusIcon className="w-5 h-5" aria-hidden />
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs btn-circle"
                          disabled={isUploading || !selectedRow?.id}
                          onClick={() => fileInputRef.current?.click()}
                          aria-label="Upload documents"
                          title="Upload documents"
                        >
                          {isUploading ? (
                            <span className="loading loading-spinner loading-sm" />
                          ) : (
                            <ArrowUpTrayIcon className="w-5 h-5" aria-hidden />
                          )}
                        </button>
                      </div>
                    </div>
                    {(() => {
                      const items = normalizeDocItems(selectedRow?.document_url);
                      const hasAnyDocs = items.length > 0;
                      const resolved = items
                        .map((d) => {
                          const raw = (d.url || d.path || '').trim();
                          if (!raw) return null;
                          const isHttp = !!d.url && /^https?:\/\//i.test(d.url);
                          const url = d.url
                            ? d.url
                            : d.path
                              ? (signedUrls.get(d.path) ?? '')
                              : '';
                          const name = d.name || (d.path ? d.path.split('/').slice(-1)[0] : undefined);
                          const mimeType = d.mimeType;
                          const isImage =
                            (typeof mimeType === 'string' && mimeType.startsWith('image/')) ||
                            (url ? isImageUrl(url) : false) ||
                            (name ? isImageUrl(name) : false);
                          const isPdf =
                            mimeType === 'application/pdf' ||
                            (url ? isPdfUrl(url) : false) ||
                            (name ? isPdfUrl(name) : false);
                          return { raw, url, name, mimeType, isImage, isPdf, isHttp, path: d.path };
                        })
                        .filter(Boolean) as Array<{
                        raw: string;
                        url: string;
                        name?: string;
                        mimeType?: string;
                        isImage: boolean;
                        isPdf: boolean;
                        isHttp: boolean;
                        path?: string;
                      }>;

                      const hasAny = items.length > 0;
                      const hasReady = resolved.some((d) => d.url);

                      if (!hasAny) {
                        return (
                          <div className="space-y-3">
                            <div
                              className={`rounded-2xl border border-dashed px-4 py-6 text-center transition ${
                                isDraggingDocs
                                  ? 'border-primary bg-primary/5'
                                  : 'border-base-300 bg-gray-50/50 hover:bg-gray-50'
                              }`}
                              onDragEnter={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setIsDraggingDocs(true);
                              }}
                              onDragOver={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setIsDraggingDocs(true);
                              }}
                              onDragLeave={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setIsDraggingDocs(false);
                              }}
                              onDrop={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setIsDraggingDocs(false);
                                void handleUploadFiles(e.dataTransfer?.files ?? null);
                              }}
                              role="button"
                              tabIndex={0}
                              onClick={() => fileInputRef.current?.click()}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
                              }}
                            >
                              <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-base-200">
                                <ArrowUpTrayIcon className="h-5 w-5 opacity-70" />
                              </div>
                              <div className="text-sm font-semibold">
                                Drag & drop documents here
                              </div>
                              <div className="text-xs opacity-70 mt-1">
                                or click to upload
                              </div>
                            </div>
                            <div className="text-sm opacity-70">No documents uploaded.</div>
                          </div>
                        );
                      }

                      if (!hasReady) {
                        return <div className="text-sm opacity-70">Loading documents preview…</div>;
                      }

                      return (
                        <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 snap-x snap-mandatory sm:grid sm:overflow-visible sm:pb-0 sm:mx-0 sm:px-0 sm:snap-none sm:grid-cols-2 xl:grid-cols-3 sm:gap-3">
                          {resolved.map((doc, idx) => {
                            const href = doc.url || doc.raw;
                            const canPreview = !!doc.url;
                            return (
                              <a
                                key={`${doc.raw}-${idx}`}
                                href={href}
                                target="_blank"
                                rel="noreferrer"
                                className="snap-start shrink-0 w-[78vw] max-w-[340px] sm:w-auto rounded-xl border border-base-200 bg-base-100 hover:bg-base-200/40 transition overflow-hidden"
                              >
                                {doc.isImage ? (
                                  <div className="h-44 sm:h-52 md:h-56 bg-black/5 flex items-center justify-center">
                                    {canPreview ? (
                                      <img
                                        src={doc.url}
                                        alt="Document"
                                        className="w-full h-full object-cover"
                                        loading="lazy"
                                        onError={(e) => {
                                          // If image fails to load, fall back to generic card.
                                          (e.currentTarget as any).style.display = 'none';
                                        }}
                                      />
                                    ) : (
                                      <div className="text-xs opacity-70">Generating preview…</div>
                                    )}
                                  </div>
                                ) : doc.isPdf ? (
                                  <div className="h-44 sm:h-52 md:h-56 bg-base-200 relative">
                                    {canPreview ? (
                                      <PdfCanvasPreview url={doc.url} title={doc.name || 'PDF document'} />
                                    ) : (
                                      <div className="w-full h-full flex items-center justify-center text-xs opacity-70">
                                        Generating preview…
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <div className="p-3">
                                    <div className="text-sm font-semibold truncate">Open document</div>
                                    <div className="text-xs opacity-70 truncate">{doc.name || doc.raw}</div>
                                  </div>
                                )}
                              </a>
                            );
                          })}
                        </div>
                      );
                    })()}
                    <input
                      ref={fileInputRef}
                      type="file"
                      className="hidden"
                      multiple
                      onChange={(e) => void handleUploadFiles(e.target.files)}
                    />
                  </div>
                </div>
              ) : (
                <div className="text-sm opacity-70">Select a row to view details.</div>
              )}
            </div>
          </div>
        </div>

        {/* Removed: floating expand/summary side control to declutter mobile modal */}
      </div>

      {isNotesModalOpen ? (
        <div className="modal modal-open">
          <div className="modal-box max-w-2xl">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold">
                {notesKind === 'internal' ? 'Edit internal notes' : 'Edit client notes'}
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setIsNotesModalOpen(false)}>
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="mt-4">
              <textarea
                className={`textarea textarea-bordered w-full min-h-[200px] ${
                  containsHebrew(notesDraft) ? 'text-right' : ''
                }`}
                dir="auto"
                placeholder={notesKind === 'internal' ? 'Write internal notes…' : 'Write client notes…'}
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
              />
              <div className="mt-2 text-xs opacity-60">
                Hebrew/RTL is supported automatically.
              </div>
            </div>

            <div className="modal-action">
              <button type="button" className="btn" onClick={() => setIsNotesModalOpen(false)} disabled={isSavingNotes}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void saveNotes()} disabled={isSavingNotes}>
                {isSavingNotes ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
          <div className="modal-backdrop" onClick={() => setIsNotesModalOpen(false)} />
        </div>
      ) : null}

      {isAttachModalOpen ? (
        <div className="modal modal-open">
          <div className="modal-box w-full max-w-4xl">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold">Attach from case documents</div>
                <div className="text-xs opacity-70">Select files to show in this sub effort row.</div>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => (isAttaching ? null : setIsAttachModalOpen(false))}
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="mt-4">
              {caseDocsLoading ? (
                <div className="flex items-center justify-center py-10">
                  <span className="loading loading-spinner loading-md" />
                  <span className="ml-3 text-sm opacity-70">Loading…</span>
                </div>
              ) : caseDocs.length === 0 ? (
                <div className="text-sm opacity-70">No case documents found.</div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {caseDocs.map((d) => {
                    const checked = selectedCaseDocIds.has(d.id);
                    const mime = d.mime_type || inferMimeFromName(d.file_name);
                    const isImg = isImageMime(mime);
                    return (
                      <button
                        key={d.id}
                        type="button"
                        className={`text-left rounded-xl border p-3 transition ${
                          checked ? 'border-primary bg-primary/5' : 'border-base-200 hover:bg-base-200/40'
                        }`}
                        onClick={() => {
                          setSelectedCaseDocIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(d.id)) next.delete(d.id);
                            else next.add(d.id);
                            return next;
                          });
                        }}
                      >
                        <div className="flex items-start gap-3">
                          <div
                            className="h-14 w-14 shrink-0 rounded-lg bg-base-200 overflow-hidden flex items-center justify-center cursor-pointer"
                            title="Open file"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              const url = String(d.signedUrl || '').trim();
                              if (!url) {
                                toast.error('No preview link is available for this file yet.');
                                return;
                              }
                              window.open(url, '_blank', 'noopener,noreferrer');
                            }}
                          >
                            {isImg && d.signedUrl ? (
                              <img src={d.signedUrl} alt="" className="h-full w-full object-cover" />
                            ) : (
                              <span className="text-[10px] opacity-70">{isImg ? 'IMG' : 'DOC'}</span>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div
                              className="text-sm font-semibold truncate hover:underline"
                              title="Open file"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                const url = String(d.signedUrl || '').trim();
                                if (!url) {
                                  toast.error('No preview link is available for this file yet.');
                                  return;
                                }
                                window.open(url, '_blank', 'noopener,noreferrer');
                              }}
                            >
                              {d.file_name}
                            </div>
                            <div className="text-xs opacity-70 tabular-nums">{formatDateTime(d.created_at)}</div>
                          </div>
                          <input type="checkbox" className="checkbox checkbox-sm mt-1" checked={checked} readOnly />
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setIsAttachModalOpen(false)}
                disabled={isAttaching}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void attachSelectedCaseDocs()}
                disabled={isAttaching}
              >
                {isAttaching ? <span className="loading loading-spinner loading-sm" /> : 'Attach'}
              </button>
            </div>
          </div>
          <div className="modal-backdrop" onClick={() => (isAttaching ? null : setIsAttachModalOpen(false))} />
        </div>
      ) : null}
    </div>
  );
}

