import React, { useEffect, useMemo, useCallback, useState } from 'react';
import {
  ChevronLeftIcon,
  DocumentIcon,
  EyeIcon,
  ArrowDownTrayIcon,
  QuestionMarkCircleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { CheckCircleIcon as CheckCircleSolidIcon } from '@heroicons/react/24/solid';
import {
  DocumentPreviewModal,
  type DocumentPreviewItem,
} from '../../../components/DocumentModal';
import { portalGetDocumentSignedUrls } from '../../../lib/portalApi';
import type { PortalSubEffortRow } from '../../../lib/portalSubEfforts';

type Props = {
  rows: PortalSubEffortRow[];
  emptyMessage?: string;
};

type DocItem = {
  url?: string;
  path?: string;
  name?: string;
  mimeType?: string;
};

function asArray(value: unknown): unknown[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return [value];
}

function normalizeDocItems(documentUrl: unknown): DocItem[] {
  if (!documentUrl) return [];

  if (typeof documentUrl === 'string') {
    const s = documentUrl.trim();
    if (!s) return [];
    if (/^https?:\/\//i.test(s)) return [{ url: s }];
    return [{ path: s }];
  }
  if (Array.isArray(documentUrl)) {
    return documentUrl.flatMap((u) => normalizeDocItems(u));
  }
  if (typeof documentUrl === 'object' && documentUrl !== null) {
    const o = documentUrl as Record<string, unknown>;
    const candidates = [
      ...asArray(o.urls),
      ...asArray(o.files),
      ...asArray(o.documents),
    ];
    if (o.path || o.url || o.publicUrl || o.signedUrl) {
      const item: DocItem = {};
      if (typeof o.path === 'string') item.path = o.path.trim();
      if (typeof o.url === 'string') item.url = o.url.trim();
      else if (typeof o.publicUrl === 'string') item.url = o.publicUrl.trim();
      else if (typeof o.signedUrl === 'string') item.url = o.signedUrl.trim();
      if (typeof o.name === 'string') item.name = o.name;
      if (typeof o.mimeType === 'string') item.mimeType = o.mimeType;
      else if (typeof o.contentType === 'string') item.mimeType = o.contentType;
      return [item, ...candidates.flatMap((u) => normalizeDocItems(u))];
    }
    return candidates.flatMap((u) => normalizeDocItems(u));
  }

  return [];
}

function isImageUrl(url: string): boolean {
  const withoutQuery = url.split('?')[0].split('#')[0].toLowerCase();
  return (
    withoutQuery.endsWith('.png') ||
    withoutQuery.endsWith('.jpg') ||
    withoutQuery.endsWith('.jpeg') ||
    withoutQuery.endsWith('.gif') ||
    withoutQuery.endsWith('.webp')
  );
}

function isPdfUrl(url: string): boolean {
  const withoutQuery = url.split('?')[0].split('#')[0].toLowerCase();
  return withoutQuery.endsWith('.pdf');
}

function resolveDocItems(
  documentUrl: unknown,
  signedUrls: Record<string, string>,
): Array<{
  raw: string;
  url: string;
  name?: string;
  isImage: boolean;
  isPdf: boolean;
}> {
  return normalizeDocItems(documentUrl)
    .map((d) => {
      const raw = (d.url || d.path || '').trim();
      if (!raw) return null;
      const url = d.url
        ? d.url
        : d.path
          ? (signedUrls[d.path] ?? '')
          : '';
      const name = d.name || (d.path ? d.path.split('/').slice(-1)[0] : undefined);
      const mimeType = d.mimeType;
      const isImage =
        (typeof mimeType === 'string' && mimeType.startsWith('image/')) ||
        (url ? isImageUrl(url) : false) ||
        (name ? isImageUrl(name) : false) ||
        (raw ? isImageUrl(raw) : false);
      const isPdf =
        mimeType === 'application/pdf' ||
        (url ? isPdfUrl(url) : false) ||
        (name ? isPdfUrl(name) : false) ||
        (raw ? isPdfUrl(raw) : false);
      return { raw, url, name, isImage, isPdf };
    })
    .filter(Boolean) as Array<{
    raw: string;
    url: string;
    name?: string;
    isImage: boolean;
    isPdf: boolean;
  }>;
}

function guessStoragePaths(documentUrl: unknown): string[] {
  return normalizeDocItems(documentUrl)
    .map((d) => (typeof d.path === 'string' ? d.path.trim() : ''))
    .filter(Boolean);
}

type ResolvedDoc = {
  raw: string;
  url: string;
  name?: string;
  isImage: boolean;
  isPdf: boolean;
};

function guessFileType(doc: ResolvedDoc): string {
  const name = (doc.name || doc.raw || '').toLowerCase();
  if (doc.isPdf || name.endsWith('.pdf')) return 'application/pdf';
  if (doc.isImage || isImageUrl(name) || isImageUrl(doc.raw)) {
    if (name.endsWith('.png')) return 'image/png';
    if (name.endsWith('.gif')) return 'image/gif';
    if (name.endsWith('.webp')) return 'image/webp';
    return 'image/jpeg';
  }
  return 'application/octet-stream';
}

function docsToPreviewItems(docs: ResolvedDoc[]): DocumentPreviewItem[] {
  return docs
    .filter((d) => !!d.url)
    .map((d, i) => ({
      id: d.raw || String(i),
      name: d.name || d.raw.split('/').pop() || 'Document',
      downloadUrl: d.url,
      fileType: guessFileType(d),
    }));
}

function formatFileTypeLabel(doc: ResolvedDoc): string {
  const name = (doc.name || doc.raw || '').toLowerCase();
  if (doc.isPdf || name.endsWith('.pdf')) return 'PDF document';
  if (doc.isImage) {
    const ext = name.split('.').pop()?.toUpperCase();
    return ext ? `${ext} image` : 'Image';
  }
  const ext = name.split('.').pop();
  return ext ? ext.toUpperCase() : 'Document';
}

type StageProgress = 'completed' | 'in_progress' | 'pending';

function findCurrentStageId(rows: PortalSubEffortRow[]): number | null {
  const current = rows.find((row) => row.active !== false);
  return current?.id ?? null;
}

function getPortalStageProgress(row: PortalSubEffortRow, currentStageId: number | null): StageProgress {
  if (row.active === false) return 'completed';
  if (currentStageId != null && row.id === currentStageId) return 'in_progress';
  return 'pending';
}

function StageProgressIcon({ progress }: { progress: StageProgress }) {
  if (progress === 'completed') {
    return <CheckCircleSolidIcon className="h-[22px] w-[22px] shrink-0 text-emerald-500" aria-hidden />;
  }
  if (progress === 'in_progress') {
    return (
      <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center" aria-hidden>
        <span className="h-3.5 w-3.5 rounded-full bg-blue-600 shadow-[0_0_0_5px_rgba(37,99,235,0.15)]" />
      </span>
    );
  }
  return (
    <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center" aria-hidden>
      <span className="h-3.5 w-3.5 rounded-full border-2 border-slate-300 bg-white" />
    </span>
  );
}

function StageProgressBadge({ progress }: { progress: StageProgress }) {
  if (progress === 'completed') {
    return (
      <span className="inline-flex w-fit shrink-0 items-center rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-medium leading-tight text-emerald-700">
        Done
      </span>
    );
  }
  if (progress === 'in_progress') {
    return (
      <span className="inline-flex w-fit shrink-0 items-center rounded-md bg-blue-50 px-2.5 py-1 text-xs font-medium leading-tight text-blue-700">
        Current
      </span>
    );
  }
  return (
    <span className="inline-flex w-fit shrink-0 items-center rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium leading-tight text-slate-500">
      Pending
    </span>
  );
}

function StageStepNumber({ step, progress }: { step: number; progress: StageProgress }) {
  const badgeClass =
    progress === 'completed'
      ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80'
      : progress === 'in_progress'
        ? 'bg-blue-600 text-white shadow-[0_0_0_3px_rgba(37,99,235,0.12)]'
        : 'bg-slate-100 text-slate-500 ring-1 ring-slate-200';

  return (
    <span
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold tabular-nums ${badgeClass}`}
      aria-hidden
    >
      {step}
    </span>
  );
}

function PortalStageTimelineItem({
  row,
  stepNumber,
  isSelected,
  isLast,
  progress,
  onSelect,
  onOpenDescription,
}: {
  row: PortalSubEffortRow;
  stepNumber: number;
  isSelected: boolean;
  isLast: boolean;
  progress: StageProgress;
  onSelect: () => void;
  onOpenDescription: () => void;
}) {
  const isPending = progress === 'pending' && !isSelected;
  const hasDescription = !!row.sub_effort_description?.trim();

  return (
    <div className={isLast ? '' : 'pb-1'}>
      <div className="relative flex items-start gap-2.5">
        <div className="mt-0.5 shrink-0">
          <StageStepNumber step={stepNumber} progress={progress} />
        </div>
        <div className="flex flex-col items-center pt-1">
          <StageProgressIcon progress={progress} />
          {!isLast ? (
            <div
              className={[
                'mt-2 min-h-[20px] w-px flex-1',
                progress === 'completed'
                  ? 'bg-gradient-to-b from-emerald-300 to-slate-200'
                  : 'bg-gradient-to-b from-slate-200 to-transparent',
              ].join(' ')}
              aria-hidden
            />
          ) : null}
        </div>
        <div className="group mb-1 flex min-w-0 flex-1 items-start gap-1">
          <button
            type="button"
            onClick={onSelect}
            className={[
              'min-w-0 flex-1 rounded-2xl text-left transition-all duration-200',
              isSelected
                ? "relative border border-blue-100 bg-blue-50/70 px-3 py-2.5 shadow-sm before:absolute before:left-0 before:top-2.5 before:bottom-2.5 before:w-1 before:rounded-full before:bg-blue-600 before:content-['']"
                : isPending
                  ? 'px-3 py-2.5 opacity-80 hover:bg-gray-50/80'
                  : 'px-3 py-2.5 hover:bg-gray-50/80',
            ].join(' ')}
          >
            <div className="min-w-0">
              <p
                className={[
                  'line-clamp-2 break-words font-semibold leading-snug text-gray-900 [overflow-wrap:anywhere]',
                  isSelected ? 'text-[15px]' : isPending ? 'text-[14px] text-gray-600' : 'text-[15px]',
                ].join(' ')}
                title={row.sub_effort_name}
              >
                {row.sub_effort_name}
              </p>
              <div className="mt-1.5">
                <StageProgressBadge progress={progress} />
              </div>
            </div>
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenDescription();
            }}
            className={`btn btn-ghost btn-xs btn-square mt-2 h-8 w-8 shrink-0 rounded-full ${
              hasDescription ? 'text-primary hover:bg-blue-50' : 'text-gray-300'
            }`}
            title={hasDescription ? 'What is this stage?' : 'No description available'}
            aria-label={hasDescription ? `About ${row.sub_effort_name}` : `No description for ${row.sub_effort_name}`}
          >
            <QuestionMarkCircleIcon className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
}

const PortalSubEffortsTimeline: React.FC<Props> = ({ rows, emptyMessage }) => {
  const currentStageId = useMemo(() => findCurrentStageId(rows), [rows]);
  const defaultSelectedId = useMemo(
    () => currentStageId ?? rows[0]?.id ?? null,
    [currentStageId, rows],
  );
  const [selectedId, setSelectedId] = useState<number | null>(defaultSelectedId);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [urlsLoading, setUrlsLoading] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewItems, setPreviewItems] = useState<DocumentPreviewItem[]>([]);
  const [previewInitialIndex, setPreviewInitialIndex] = useState(0);
  const [descriptionRow, setDescriptionRow] = useState<PortalSubEffortRow | null>(null);

  const selected = useMemo(
    () => rows.find((r) => r.id === selectedId) ?? rows[0] ?? null,
    [rows, selectedId],
  );

  const handleSelectRow = (id: number) => {
    setSelectedId(id);
    setMobileDetailOpen(true);
  };

  const handleMobileBack = () => {
    setMobileDetailOpen(false);
  };

  const paths = useMemo(() => (selected ? guessStoragePaths(selected.document_url) : []), [selected]);

  const docs = useMemo(
    () => (selected ? resolveDocItems(selected.document_url, signedUrls) : []),
    [selected, signedUrls],
  );

  const hasDocs = docs.length > 0;
  const docsReady = docs.some((d) => d.url);

  const openDocPreview = useCallback(
    (doc: ResolvedDoc) => {
      if (!doc.url) return;
      const items = docsToPreviewItems(docs);
      const docId = doc.raw || doc.url;
      const idx = items.findIndex((item) => item.id === docId);
      setPreviewItems(items);
      setPreviewInitialIndex(idx >= 0 ? idx : 0);
      setPreviewOpen(true);
    },
    [docs],
  );

  useEffect(() => {
    setSelectedId(defaultSelectedId);
    setMobileDetailOpen(false);
  }, [defaultSelectedId, rows]);

  useEffect(() => {
    if (!paths.length) {
      setUrlsLoading(false);
      return;
    }
    void (async () => {
      setUrlsLoading(true);
      try {
        const urls = await portalGetDocumentSignedUrls(paths);
        setSignedUrls((prev) => ({ ...prev, ...urls }));
      } catch (e) {
        console.error('Failed to load document URLs', e);
      } finally {
        setUrlsLoading(false);
      }
    })();
  }, [paths.join('|')]);

  if (!rows.length) {
    return (
      <p className="text-gray-500">
        {emptyMessage ?? 'No case stages to display yet.'}
      </p>
    );
  }

  const selectedProgress = selected ? getPortalStageProgress(selected, currentStageId) : 'pending';

  return (
    <div className="grid min-h-[320px] grid-cols-1 gap-4 md:grid-cols-[minmax(280px,340px)_1fr] lg:grid-cols-[minmax(300px,360px)_1fr]">
      <div
        className={`rounded-[18px] border border-gray-200 bg-white/85 p-4 shadow-[0_8px_24px_rgba(15,23,42,0.04)] md:p-5 ${
          mobileDetailOpen ? 'hidden md:block' : ''
        }`}
      >
        <div className="mb-3 px-0.5">
          <span className="text-base font-semibold text-gray-800 md:text-lg">Workflow</span>
        </div>
        <div>
          {rows.map((row, index) => (
            <PortalStageTimelineItem
              key={row.id}
              row={row}
              stepNumber={index + 1}
              isSelected={selected?.id === row.id}
              isLast={index === rows.length - 1}
              progress={getPortalStageProgress(row, currentStageId)}
              onSelect={() => handleSelectRow(row.id)}
              onOpenDescription={() => setDescriptionRow(row)}
            />
          ))}
        </div>
      </div>

      {selected && (
        <div className={`min-h-0 space-y-4 ${mobileDetailOpen ? '' : 'hidden md:block'}`}>
          <button
            type="button"
            onClick={handleMobileBack}
            className="mb-1 inline-flex items-center gap-1.5 text-sm font-semibold text-primary md:hidden"
          >
            <ChevronLeftIcon className="h-4 w-4" />
            Back to stages
          </button>

          <div className="rounded-[18px] bg-white px-5 py-4 shadow-sm">
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-start gap-2">
                <h2
                  className="min-w-0 max-w-full text-2xl font-bold leading-tight tracking-tight text-gray-900 line-clamp-2 break-words [overflow-wrap:anywhere] md:text-[28px]"
                  title={selected.sub_effort_name}
                >
                  {selected.sub_effort_name}
                </h2>
                <button
                  type="button"
                  onClick={() => setDescriptionRow(selected)}
                  className="btn btn-ghost btn-xs btn-square h-9 w-9 shrink-0 rounded-full text-primary hover:bg-blue-50"
                  title="What is this stage?"
                  aria-label={`About ${selected.sub_effort_name}`}
                >
                  <QuestionMarkCircleIcon className="h-5 w-5" />
                </button>
                <StageProgressBadge progress={selectedProgress} />
              </div>
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center gap-2 px-0.5">
              <EyeIcon className="h-4 w-4 text-gray-400" />
              <span className="text-sm font-semibold text-gray-700">Notes from our team</span>
            </div>
            <div className="rounded-[18px] bg-white px-5 py-4 shadow-sm">
              {selected.client_notes ? (
                <p className="text-sm leading-relaxed whitespace-pre-wrap break-words text-gray-800">
                  {selected.client_notes}
                </p>
              ) : (
                <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/60 px-4 py-3 text-sm text-gray-400">
                  No notes for this stage yet.
                </div>
              )}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center gap-2 px-0.5">
              <DocumentIcon className="h-4 w-4 text-gray-400" />
              <span className="text-sm font-semibold text-gray-700">Documents</span>
            </div>
            <div className="rounded-[18px] bg-white px-5 py-4 shadow-sm">
              {!hasDocs ? (
                <div className="flex min-h-[160px] flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50/50 px-5 py-10 text-center text-sm text-gray-400">
                  No documents uploaded for this stage yet.
                </div>
              ) : urlsLoading && !docsReady ? (
                <div className="flex items-center gap-3 py-6 text-sm text-gray-500">
                  <span className="loading loading-spinner loading-sm" />
                  Loading documents…
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {docs.map((doc, idx) => {
                    const label = doc.name || doc.raw.split('/').pop() || 'Document';
                    const href = doc.url || doc.raw;
                    const canPreview = !!doc.url;
                    const typeLabel = formatFileTypeLabel(doc);

                    return (
                      <div
                        key={`${doc.raw}-${idx}`}
                        className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center"
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <button
                            type="button"
                            disabled={!canPreview}
                            onClick={() => openDocPreview(doc)}
                            className={`flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gray-100 ${
                              canPreview ? 'cursor-pointer hover:ring-2 hover:ring-primary/20' : 'cursor-default'
                            }`}
                            aria-label={canPreview ? `Preview ${label}` : undefined}
                          >
                            {doc.isImage && canPreview ? (
                              <img
                                src={doc.url}
                                alt=""
                                className="h-full w-full object-cover"
                                loading="lazy"
                              />
                            ) : doc.isPdf ? (
                              <DocumentIcon className="h-7 w-7 text-red-500/80" />
                            ) : (
                              <DocumentIcon className="h-7 w-7 text-slate-400" />
                            )}
                          </button>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-gray-900">{label}</div>
                            <div className="mt-0.5 text-xs text-gray-500">{typeLabel}</div>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5 sm:pl-2">
                          {canPreview ? (
                            <button
                              type="button"
                              onClick={() => openDocPreview(doc)}
                              className="btn btn-ghost btn-xs h-8 rounded-full px-3"
                            >
                              Preview
                            </button>
                          ) : null}
                          {canPreview ? (
                            <a
                              href={href}
                              target="_blank"
                              rel="noreferrer"
                              download={label}
                              className="btn btn-ghost btn-xs h-8 gap-1 rounded-full px-3"
                            >
                              <ArrowDownTrayIcon className="h-3.5 w-3.5" />
                              Download
                            </a>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
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

      {descriptionRow ? (
        <div className="modal modal-open z-[300]">
          <div className="modal-box max-w-lg">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-lg font-bold text-gray-900">{descriptionRow.sub_effort_name}</h3>
                <p className="mt-1 text-xs text-gray-500">About this stage</p>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-square"
                onClick={() => setDescriptionRow(null)}
                aria-label="Close"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-4 rounded-xl bg-gray-50 px-4 py-3 text-sm leading-relaxed text-gray-700 whitespace-pre-wrap">
              {descriptionRow.sub_effort_description?.trim() || 'No description is available for this stage yet.'}
            </div>
            <div className="modal-action mt-4">
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setDescriptionRow(null)}>
                Close
              </button>
            </div>
          </div>
          <button
            type="button"
            className="modal-backdrop"
            aria-label="Close description"
            onClick={() => setDescriptionRow(null)}
          />
        </div>
      ) : null}
    </div>
  );
};

export default PortalSubEffortsTimeline;
