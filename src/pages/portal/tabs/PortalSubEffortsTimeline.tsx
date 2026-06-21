import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeftIcon, ChevronRightIcon, DocumentIcon } from '@heroicons/react/24/outline';
import {
  DocumentPreviewModal,
  type DocumentPreviewItem,
} from '../../../components/DocumentModal';
import { portalGetDocumentSignedUrls } from '../../../lib/portalApi';

type SubEffortRow = {
  id: number;
  sub_effort_id: number;
  sub_effort_name: string;
  active: boolean;
  client_notes: string | null;
  document_url: unknown;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
};

type DocItem = {
  url?: string;
  path?: string;
  name?: string;
  mimeType?: string;
};

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

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

type Props = {
  rows: SubEffortRow[];
};

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

function StageImageCarousel({
  images,
  loading,
  onOpenPreview,
}: {
  images: ResolvedDoc[];
  loading: boolean;
  onOpenPreview: (doc: ResolvedDoc) => void;
}) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
  }, [images.map((img) => img.raw).join('|')]);

  if (!images.length) return null;

  const current = images[index];
  const label = current.name || current.raw.split('/').pop() || 'Image';
  const canPreview = !!current.url;
  const waiting = loading && !canPreview && !/^https?:\/\//i.test(current.raw);

  const goPrev = () => setIndex((i) => (i - 1 + images.length) % images.length);
  const goNext = () => setIndex((i) => (i + 1) % images.length);

  return (
    <div className="relative">
      <div className="flex items-center justify-center min-h-[120px]">
        {canPreview ? (
          <button
            type="button"
            onClick={() => onOpenPreview(current)}
            className="block max-w-[16rem] cursor-pointer sm:max-w-xs md:max-w-sm"
            aria-label={`View ${label}`}
          >
            <img
              src={current.url}
              alt={label}
              className="mx-auto h-auto max-h-40 w-full rounded-lg object-contain sm:max-h-48 md:max-h-56"
              loading="lazy"
            />
          </button>
        ) : waiting ? (
          <span className="text-sm text-gray-500">Loading preview…</span>
        ) : (
          <DocumentIcon className="w-10 h-10 text-gray-400" />
        )}
      </div>

      {images.length > 1 && (
        <>
          <button
            type="button"
            onClick={goPrev}
            className="absolute left-0 top-1/2 -translate-y-1/2 btn btn-circle btn-sm bg-white/90 shadow-md border-0"
            aria-label="Previous image"
          >
            <ChevronLeftIcon className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={goNext}
            className="absolute right-0 top-1/2 -translate-y-1/2 btn btn-circle btn-sm bg-white/90 shadow-md border-0"
            aria-label="Next image"
          >
            <ChevronRightIcon className="w-4 h-4" />
          </button>
          <div className="mt-3 flex items-center justify-center gap-2">
            {images.map((img, i) => (
              <button
                key={img.raw}
                type="button"
                onClick={() => setIndex(i)}
                className={`h-2 rounded-full transition-all ${
                  i === index ? 'w-5 bg-primary' : 'w-2 bg-base-300 hover:bg-base-content/30'
                }`}
                aria-label={`Show image ${i + 1}`}
              />
            ))}
          </div>
        </>
      )}

      <p className="mt-2 text-center text-xs text-gray-500 truncate">{label}</p>
      {images.length > 1 ? (
        <p className="text-center text-[10px] text-gray-400">
          {index + 1} of {images.length}
        </p>
      ) : null}
    </div>
  );
}

const PortalSubEffortsTimeline: React.FC<Props> = ({ rows }) => {
  const [selectedId, setSelectedId] = useState<number | null>(rows[0]?.id ?? null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [urlsLoading, setUrlsLoading] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewItems, setPreviewItems] = useState<DocumentPreviewItem[]>([]);
  const [previewInitialIndex, setPreviewInitialIndex] = useState(0);

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

  const imageDocs = useMemo(() => docs.filter((d) => d.isImage), [docs]);
  const otherDocs = useMemo(() => docs.filter((d) => !d.isImage), [docs]);

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
    return <p className="text-gray-500">No case stages to display yet.</p>;
  }

  const hasDocs = docs.length > 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-6 min-h-[320px]">
      <div className={`space-y-2 ${mobileDetailOpen ? 'hidden md:block' : ''}`}>
        {rows.map((row) => (
          <button
            key={row.id}
            type="button"
            onClick={() => handleSelectRow(row.id)}
            className={`w-full text-left rounded-[18px] bg-white px-4 py-3.5 flex items-center justify-between gap-2 transition-colors shadow-sm hover:bg-base-200/40 ${
              selected?.id === row.id ? 'shadow-md' : ''
            }`}
          >
            <div className="min-w-0">
              <p className="truncate text-base font-semibold text-gray-900 md:text-lg">{row.sub_effort_name}</p>
            </div>
            <ChevronRightIcon className="w-4 h-4 shrink-0 text-gray-400" />
          </button>
        ))}
      </div>

      {selected && (
        <div
          className={`rounded-[18px] bg-white shadow-sm p-4 md:p-6 ${
            mobileDetailOpen ? '' : 'hidden md:block'
          }`}
        >
          <button
            type="button"
            onClick={handleMobileBack}
            className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary md:hidden"
          >
            <ChevronLeftIcon className="h-4 w-4" />
            Back to stages
          </button>
          <h3 className="text-lg font-semibold text-gray-900">{selected.sub_effort_name}</h3>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-500">Updated by</p>
              <p className="mt-1 text-sm text-gray-800">{selected.updated_by?.trim() || '—'}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-500">Updated at</p>
              <p className="mt-1 text-sm text-gray-800">{formatDateTime(selected.updated_at)}</p>
            </div>
          </div>

          {selected.client_notes ? (
            <div className="mt-4">
              <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">Notes</p>
              <p className="text-sm text-gray-800 whitespace-pre-wrap">{selected.client_notes}</p>
            </div>
          ) : (
            <p className="mt-4 text-sm text-gray-400">No notes for this stage.</p>
          )}

          {hasDocs && (
            <div className="mt-6 space-y-5">
              <p className="text-xs uppercase tracking-wide text-gray-500">Documents</p>

              {imageDocs.length > 0 && (
                <StageImageCarousel
                  images={imageDocs}
                  loading={urlsLoading}
                  onOpenPreview={openDocPreview}
                />
              )}

              {otherDocs.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  {otherDocs.map((doc, idx) => {
                    const canPreview = !!doc.url;
                    const label = doc.name || doc.raw.split('/').pop() || 'Document';
                    const waiting = urlsLoading && !canPreview && !/^https?:\/\//i.test(doc.raw);

                    return (
                      <button
                        key={`${doc.raw}-${idx}`}
                        type="button"
                        disabled={waiting || !canPreview}
                        onClick={() => openDocPreview(doc)}
                        className={`rounded-xl border border-gray-200 bg-white text-left transition overflow-hidden ${
                          canPreview && !waiting ? 'cursor-pointer hover:bg-gray-50' : 'cursor-default'
                        }`}
                      >
                        {doc.isPdf ? (
                          <div className="relative h-40 bg-white sm:h-44">
                            {canPreview ? (
                              <iframe
                                src={doc.url}
                                title={label}
                                className="w-full h-full border-0 pointer-events-none"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-xs text-gray-500">
                                {waiting ? 'Loading preview…' : 'Open PDF'}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="p-4 flex items-center gap-2 min-w-0">
                            <DocumentIcon className="w-5 h-5 shrink-0 text-gray-400" />
                            <span className="text-sm text-primary truncate">{label}</span>
                          </div>
                        )}
                        {doc.isPdf && (
                          <div className="px-3 py-2 border-t border-gray-200">
                            <p className="text-xs text-gray-600 truncate">{label}</p>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
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
    </div>
  );
};

export default PortalSubEffortsTimeline;
