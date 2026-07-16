import React, { useCallback, useEffect, useRef, useState } from 'react';
import { fetchPdfBytes, loadPdfJsLib } from '../lib/loadPdfJs';
import { CASE_DOCUMENTS_STORAGE_BUCKET } from '../lib/caseDocumentsStorage';
import { supabase } from '../lib/supabase';

export type RegionHighlight = {
  /** Left edge, 0–1 of media width */
  x: number;
  /** Top edge, 0–1 of media height */
  y: number;
  /** Width, 0–1 of media width */
  w: number;
  /** Height, 0–1 of media height */
  h: number;
  /** 1-based PDF page; omit for images */
  page?: number;
};

export type HighlightMarker = {
  id: string;
  highlight: RegionHighlight;
  label: number;
  createdBy: string;
  canDelete?: boolean;
};

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

export function parseRegionHighlight(raw: unknown): RegionHighlight | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const x = Number(o.x);
  const y = Number(o.y);
  const w = Number(o.w);
  const h = Number(o.h);
  if (![x, y, w, h].every((n) => Number.isFinite(n))) return null;
  if (w <= 0 || h <= 0) return null;
  const pageRaw = o.page;
  const page =
    pageRaw == null || pageRaw === ''
      ? undefined
      : Number.isFinite(Number(pageRaw))
        ? Math.max(1, Math.floor(Number(pageRaw)))
        : undefined;
  return {
    x: clamp01(x),
    y: clamp01(y),
    w: clamp01(w),
    h: clamp01(h),
    ...(page != null ? { page } : {}),
  };
}

function normFromEvent(
  clientX: number,
  clientY: number,
  el: HTMLElement,
): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return { x: 0, y: 0 };
  return {
    x: clamp01((clientX - r.left) / r.width),
    y: clamp01((clientY - r.top) / r.height),
  };
}

function rectFromPoints(
  a: { x: number; y: number },
  b: { x: number; y: number },
  page?: number,
): RegionHighlight {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const w = Math.abs(a.x - b.x);
  const h = Math.abs(a.y - b.y);
  return page != null ? { x, y, w, h, page } : { x, y, w, h };
}

function HighlightBoxes({
  markers,
  draft,
  focusedId,
  page,
  onSelect,
  onDelete,
}: {
  markers: HighlightMarker[];
  draft: RegionHighlight | null;
  focusedId: string | null;
  page?: number;
  onSelect: (id: string) => void;
  onDelete?: (id: string) => void;
}) {
  const list = markers.filter((m) => {
    if (page == null) return m.highlight.page == null || m.highlight.page === 1;
    return (m.highlight.page ?? 1) === page;
  });
  const showDraft =
    draft &&
    (page == null
      ? draft.page == null || draft.page === 1
      : (draft.page ?? 1) === page);

  return (
    <>
      {list.map((m) => {
        const { x, y, w, h } = m.highlight;
        const focused = focusedId === m.id;
        const who = (m.createdBy || '').trim() || 'Unknown';
        return (
          <div
            key={m.id}
            id={`doc-highlight-${m.id}`}
            className={`pointer-events-auto absolute z-[2] rounded-[2px] border transition ${
              focused
                ? 'border-amber-400/70 bg-amber-200/20'
                : 'border-amber-400/35 bg-amber-200/10 hover:border-amber-400/55 hover:bg-amber-200/15'
            }`}
            style={{
              left: `${x * 100}%`,
              top: `${y * 100}%`,
              width: `${w * 100}%`,
              height: `${h * 100}%`,
            }}
          >
            <button
              type="button"
              className="absolute inset-0 cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                onSelect(m.id);
              }}
              title={`${who} · section ${m.label}`}
              aria-label={`Highlighted by ${who}, section ${m.label}`}
            />
            <div className="pointer-events-none absolute -top-5 left-0 z-[3] flex max-w-[min(100%,16rem)] items-center gap-1">
              <span
                className={`flex h-4 shrink-0 items-center justify-center rounded px-1 text-[9px] font-semibold ${
                  focused ? 'bg-amber-500/85 text-white' : 'bg-amber-500/55 text-white/95'
                }`}
              >
                {m.label}
              </span>
              <span className="truncate rounded bg-slate-900/75 px-1.5 py-0.5 text-[9px] font-medium text-white shadow-sm">
                {who}
              </span>
              {m.canDelete && onDelete ? (
                <button
                  type="button"
                  className="pointer-events-auto flex h-4 w-4 shrink-0 items-center justify-center rounded bg-slate-900/75 text-white/90 hover:bg-red-600"
                  title="Delete highlight"
                  aria-label={`Delete highlight by ${who}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(m.id);
                  }}
                >
                  <svg viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3" aria-hidden>
                    <path
                      fillRule="evenodd"
                      d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.033 2.5.097V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.347A40.5 40.5 0 0110 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
      {showDraft ? (
        <div
          className="pointer-events-none absolute z-[3] rounded-[2px] border border-dashed border-sky-400/50 bg-sky-300/10"
          style={{
            left: `${draft!.x * 100}%`,
            top: `${draft!.y * 100}%`,
            width: `${draft!.w * 100}%`,
            height: `${draft!.h * 100}%`,
          }}
        />
      ) : null}
    </>
  );
}

function useDrawOnSurface({
  enabled,
  page,
  onDraftChange,
}: {
  enabled: boolean;
  page?: number;
  onDraftChange: (h: RegionHighlight | null) => void;
}) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const [drawing, setDrawing] = useState<RegionHighlight | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!enabled || !surfaceRef.current) return;
      if (e.button !== 0) return;
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      const p = normFromEvent(e.clientX, e.clientY, surfaceRef.current);
      startRef.current = p;
      const next = rectFromPoints(p, p, page);
      setDrawing(next);
    },
    [enabled, page],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!enabled || !surfaceRef.current || !startRef.current) return;
      const p = normFromEvent(e.clientX, e.clientY, surfaceRef.current);
      setDrawing(rectFromPoints(startRef.current, p, page));
    },
    [enabled, page],
  );

  const finish = useCallback(
    (e: React.PointerEvent) => {
      if (!enabled || !surfaceRef.current || !startRef.current) return;
      const p = normFromEvent(e.clientX, e.clientY, surfaceRef.current);
      const next = rectFromPoints(startRef.current, p, page);
      startRef.current = null;
      setDrawing(null);
      if (next.w < 0.012 || next.h < 0.012) return;
      onDraftChange(next);
    },
    [enabled, onDraftChange, page],
  );

  return {
    surfaceRef,
    drawing,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finish,
      onPointerCancel: () => {
        startRef.current = null;
        setDrawing(null);
      },
    },
  };
}

function ImageAnnotatable({
  src,
  alt,
  highlights,
  draft,
  focusedId,
  drawEnabled,
  onDraftChange,
  onSelectHighlight,
  onDeleteHighlight,
  onError,
}: {
  src: string;
  alt: string;
  highlights: HighlightMarker[];
  draft: RegionHighlight | null;
  focusedId: string | null;
  drawEnabled: boolean;
  onDraftChange: (h: RegionHighlight | null) => void;
  onSelectHighlight: (id: string) => void;
  onDeleteHighlight?: (id: string) => void;
  onError?: () => void;
}) {
  const { surfaceRef, drawing, handlers } = useDrawOnSurface({
    enabled: drawEnabled,
    onDraftChange,
  });
  const activeDraft = drawing || draft;

  return (
    <div
      ref={surfaceRef}
      className={`relative inline-block max-h-full max-w-full ${
        drawEnabled ? 'cursor-crosshair touch-none' : ''
      }`}
      {...(drawEnabled ? handlers : {})}
    >
      <img
        src={src}
        alt={alt}
        className="pointer-events-none max-h-[min(100%,calc(100vh-8rem))] max-w-full object-contain select-none"
        draggable={false}
        onError={onError}
      />
      <div className="pointer-events-none absolute inset-0">
        <div className={`absolute inset-0 ${drawEnabled ? '' : 'pointer-events-auto'}`}>
          <HighlightBoxes
            markers={highlights}
            draft={activeDraft}
            focusedId={focusedId}
            onSelect={(id) => {
              if (!drawEnabled) onSelectHighlight(id);
            }}
            onDelete={drawEnabled ? undefined : onDeleteHighlight}
          />
        </div>
      </div>
    </div>
  );
}

function PdfAnnotatable({
  src,
  storagePath,
  highlights,
  draft,
  focusedId,
  drawEnabled,
  onDraftChange,
  onSelectHighlight,
  onDeleteHighlight,
  onError,
}: {
  src: string;
  storagePath?: string | null;
  highlights: HighlightMarker[];
  draft: RegionHighlight | null;
  focusedId: string | null;
  drawEnabled: boolean;
  onDraftChange: (h: RegionHighlight | null) => void;
  onSelectHighlight: (id: string) => void;
  onDeleteHighlight?: (id: string) => void;
  onError?: () => void;
}) {
  const [pages, setPages] = useState<{ pageNumber: number; url: string; width: number; height: number }[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      setFailed(false);
      setPages([]);
      try {
        const pdfjsLib = await loadPdfJsLib();

        let data: Uint8Array | null = null;
        const path = (storagePath || '').trim();
        if (path) {
          const { data: blob, error } = await supabase.storage
            .from(CASE_DOCUMENTS_STORAGE_BUCKET)
            .download(path);
          if (!error && blob) {
            data = new Uint8Array(await blob.arrayBuffer());
          } else if (error) {
            console.warn('storage.download for PDF highlights:', error.message);
          }
        }
        if (!data) {
          data = await fetchPdfBytes(src);
        }

        const doc = await pdfjsLib.getDocument({ data }).promise;
        const rendered: { pageNumber: number; url: string; width: number; height: number }[] = [];
        const maxPages = Math.min(doc.numPages, 40);

        for (let i = 1; i <= maxPages; i++) {
          if (cancelled) break;
          const page = await doc.getPage(i);
          const viewport = page.getViewport({ scale: 1.25 });
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.floor(viewport.width));
          canvas.height = Math.max(1, Math.floor(viewport.height));
          const ctx = canvas.getContext('2d');
          if (!ctx) continue;
          await page.render({ canvasContext: ctx, viewport }).promise;
          rendered.push({
            pageNumber: i,
            url: canvas.toDataURL('image/jpeg', 0.88),
            width: canvas.width,
            height: canvas.height,
          });
        }

        if (!cancelled) {
          if (!rendered.length) throw new Error('No PDF pages rendered');
          setPages(rendered);
          setLoading(false);
        }
      } catch (e) {
        console.error('PDF annotate render:', e);
        if (!cancelled) {
          setFailed(true);
          setLoading(false);
          onErrorRef.current?.();
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [src, storagePath]);

  if (loading) {
    return (
      <div className="flex min-h-full flex-1 flex-col items-center justify-center bg-neutral-900 py-16 text-neutral-200">
        <span className="loading loading-spinner loading-lg" />
        <p className="mt-3 text-sm opacity-80">Preparing pages for highlights…</p>
      </div>
    );
  }

  if (failed || pages.length === 0) {
    return (
      <div className="flex min-h-full w-full flex-1 flex-col bg-neutral-900">
        <div className="shrink-0 bg-amber-400/90 px-3 py-2 text-center text-xs font-medium text-amber-950">
          Couldn’t prepare PDF pages for highlights — showing standard preview instead.
        </div>
        <iframe src={src} className="min-h-0 w-full flex-1 border-0 bg-neutral-900" title="PDF preview" />
      </div>
    );
  }

  return (
    <div className="min-h-full w-full bg-neutral-900 px-2 pb-0 pt-4 md:px-4">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 pb-4">
        {pages.map((p) => (
          <PdfPageSurface
            key={p.pageNumber}
            pageNumber={p.pageNumber}
            src={p.url}
            width={p.width}
            height={p.height}
            highlights={highlights}
            draft={draft}
            focusedId={focusedId}
            drawEnabled={drawEnabled}
            onDraftChange={onDraftChange}
            onSelectHighlight={onSelectHighlight}
            onDeleteHighlight={onDeleteHighlight}
          />
        ))}
      </div>
    </div>
  );
}

function PdfPageSurface({
  pageNumber,
  src,
  width,
  height,
  highlights,
  draft,
  focusedId,
  drawEnabled,
  onDraftChange,
  onSelectHighlight,
  onDeleteHighlight,
}: {
  pageNumber: number;
  src: string;
  width: number;
  height: number;
  highlights: HighlightMarker[];
  draft: RegionHighlight | null;
  focusedId: string | null;
  drawEnabled: boolean;
  onDraftChange: (h: RegionHighlight | null) => void;
  onSelectHighlight: (id: string) => void;
  onDeleteHighlight?: (id: string) => void;
}) {
  const { surfaceRef, drawing, handlers } = useDrawOnSurface({
    enabled: drawEnabled,
    page: pageNumber,
    onDraftChange,
  });
  const activeDraft = drawing || draft;

  return (
    <div className="relative mx-auto w-full overflow-hidden rounded-lg bg-white shadow-lg">
      <div className="border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-medium text-slate-500">
        Page {pageNumber}
      </div>
      <div
        ref={surfaceRef}
        className={`relative w-full ${drawEnabled ? 'cursor-crosshair touch-none' : ''}`}
        style={{ aspectRatio: `${width} / ${height}` }}
        {...(drawEnabled ? handlers : {})}
      >
        <img src={src} alt={`Page ${pageNumber}`} className="pointer-events-none absolute inset-0 h-full w-full select-none" draggable={false} />
        <div className={`absolute inset-0 ${drawEnabled ? 'pointer-events-none' : 'pointer-events-auto'}`}>
          <HighlightBoxes
            markers={highlights}
            draft={activeDraft}
            focusedId={focusedId}
            page={pageNumber}
            onSelect={(id) => {
              if (!drawEnabled) onSelectHighlight(id);
            }}
            onDelete={drawEnabled ? undefined : onDeleteHighlight}
          />
        </div>
      </div>
    </div>
  );
}

type DocumentAnnotatableViewProps = {
  mode: 'image' | 'pdf';
  src: string;
  storagePath?: string | null;
  alt?: string;
  highlights: HighlightMarker[];
  draft: RegionHighlight | null;
  focusedId: string | null;
  drawEnabled: boolean;
  onDraftChange: (h: RegionHighlight | null) => void;
  onSelectHighlight: (id: string) => void;
  onDeleteHighlight?: (id: string) => void;
  onImageError?: () => void;
  onPdfError?: () => void;
};

export function DocumentAnnotatableView({
  mode,
  src,
  storagePath,
  alt = 'Document',
  highlights,
  draft,
  focusedId,
  drawEnabled,
  onDraftChange,
  onSelectHighlight,
  onDeleteHighlight,
  onImageError,
  onPdfError,
}: DocumentAnnotatableViewProps) {
  if (mode === 'image') {
    return (
      <ImageAnnotatable
        src={src}
        alt={alt}
        highlights={highlights}
        draft={draft}
        focusedId={focusedId}
        drawEnabled={drawEnabled}
        onDraftChange={onDraftChange}
        onSelectHighlight={onSelectHighlight}
        onDeleteHighlight={onDeleteHighlight}
        onError={onImageError}
      />
    );
  }

  return (
    <PdfAnnotatable
      src={src}
      storagePath={storagePath}
      highlights={highlights}
      draft={draft}
      focusedId={focusedId}
      drawEnabled={drawEnabled}
      onDraftChange={onDraftChange}
      onSelectHighlight={onSelectHighlight}
      onDeleteHighlight={onDeleteHighlight}
      onError={onPdfError}
    />
  );
}
