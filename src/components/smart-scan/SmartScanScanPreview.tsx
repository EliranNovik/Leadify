import { useEffect, useRef, useState } from 'react';
import { DocumentIcon } from '@heroicons/react/24/outline';
import { loadPdfJsLib } from '../../lib/loadPdfJs';
import type { ScanPageRange } from '../../lib/smartScan/smartScanFormat';

type PageImage = { pageNumber: number; url: string };

type Props = {
  src?: string;
  filename?: string;
  ranges: ScanPageRange[];
  activeId: string | null;
  onActiveChange: (id: string) => void;
};

function documentIdForPage(pageNumber: number, ranges: ScanPageRange[]): string | null {
  const match = ranges.find((range) => pageNumber >= range.start && pageNumber <= range.end);
  return match?.id || ranges[0]?.id || null;
}

export function SmartScanScanPreview({ src, filename, ranges, activeId, onActiveChange }: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lockRef = useRef(false);
  const activeRef = useRef(activeId);
  const onActiveChangeRef = useRef(onActiveChange);
  const [pages, setPages] = useState<PageImage[]>([]);
  const [loading, setLoading] = useState(Boolean(src));
  const [failed, setFailed] = useState(false);
  activeRef.current = activeId;
  onActiveChangeRef.current = onActiveChange;

  useEffect(() => {
    if (!src) {
      setPages([]);
      setLoading(false);
      setFailed(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setFailed(false);
      setPages([]);
      try {
        const pdfjsLib = await loadPdfJsLib();
        const response = await fetch(src, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Failed to fetch scan PDF (${response.status})`);
        const data = new Uint8Array(await response.arrayBuffer());
        const doc = await pdfjsLib.getDocument({ data }).promise;
        const rendered: PageImage[] = [];
        const maxPages = Math.min(doc.numPages, 80);
        for (let i = 1; i <= maxPages; i += 1) {
          if (cancelled) break;
          const page = await doc.getPage(i);
          const viewport = page.getViewport({ scale: 1.2 });
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.floor(viewport.width));
          canvas.height = Math.max(1, Math.floor(viewport.height));
          const ctx = canvas.getContext('2d');
          if (!ctx) continue;
          await page.render({ canvasContext: ctx, viewport }).promise;
          rendered.push({ pageNumber: i, url: canvas.toDataURL('image/jpeg', 0.86) });
        }
        if (!cancelled) {
          if (!rendered.length) throw new Error('No PDF pages rendered');
          setPages(rendered);
          setLoading(false);
        }
      } catch (error) {
        console.error('Smart Scan full preview:', error);
        if (!cancelled) {
          setFailed(true);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [src]);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !pages.length) return;
    const nodes = [...root.querySelectorAll<HTMLElement>('[data-scan-page]')];
    if (!nodes.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (lockRef.current) return;
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        const pageNumber = Number(visible[0]?.target.getAttribute('data-scan-page') || 0);
        if (!pageNumber) return;
        const nextId = documentIdForPage(pageNumber, ranges);
        if (nextId && nextId !== activeRef.current) onActiveChangeRef.current(nextId);
      },
      { root, threshold: [0.35, 0.55, 0.75] },
    );
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [pages, ranges]);

  useEffect(() => {
    if (!activeId || !pages.length) return;
    const range = ranges.find((row) => row.id === activeId);
    if (!range) return;
    const root = scrollRef.current;
    const target = root?.querySelector<HTMLElement>(`[data-scan-page="${range.start}"]`);
    if (!root || !target) return;
    const current = root.querySelectorAll<HTMLElement>('[data-scan-page]');
    const visible = [...current].find((node) => {
      const rect = node.getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      return rect.top >= rootRect.top - 24 && rect.top < rootRect.bottom * 0.55;
    });
    const visiblePage = Number(visible?.getAttribute('data-scan-page') || 0);
    if (visiblePage >= range.start && visiblePage <= range.end) return;
    lockRef.current = true;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.setTimeout(() => {
      lockRef.current = false;
    }, 700);
  }, [activeId, pages, ranges]);

  if (!src) {
    return (
      <div className="flex h-full min-h-[18rem] flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-4 py-10 text-center">
        <DocumentIcon className="mb-3 h-12 w-12 text-gray-300" />
        <p className="text-sm font-medium text-gray-700">Full scan preview</p>
        <p className="mt-1 max-w-xs text-xs text-gray-400">The original file is still downloading from Scan Center.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full min-h-[18rem] flex-col items-center justify-center rounded-2xl border border-gray-200 bg-gray-50">
        <span className="loading loading-spinner loading-lg text-gray-400" />
        <p className="mt-3 text-sm text-gray-500">Loading full scan…</p>
      </div>
    );
  }

  if (failed || pages.length === 0) {
    return (
      <div className="h-full min-h-0 overflow-hidden rounded-2xl border border-gray-200 bg-white">
        <iframe title={filename || 'Scan preview'} src={src} className="h-full min-h-[24rem] w-full border-0" />
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="h-full min-h-0 space-y-4 overflow-y-auto rounded-2xl border border-gray-200 bg-gray-100 p-3">
      {pages.map((page) => {
        const ownerId = documentIdForPage(page.pageNumber, ranges);
        const active = ownerId === activeId;
        return (
          <figure
            key={page.pageNumber}
            data-scan-page={page.pageNumber}
            className={`overflow-hidden rounded-xl bg-white shadow-sm ring-2 transition ${
              active ? 'ring-sky-400' : 'ring-transparent'
            }`}
          >
            <img src={page.url} alt={`Page ${page.pageNumber}`} className="w-full" />
            <figcaption className="px-3 py-1.5 text-xs font-medium text-gray-500">Page {page.pageNumber}</figcaption>
          </figure>
        );
      })}
    </div>
  );
}
