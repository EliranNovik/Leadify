import React, { useEffect, useRef, useState } from 'react';
import { DocumentFileGlyph } from '../lib/documentFileGlyphs';
import { renderPdfFirstPageThumbnail } from '../lib/pdfFirstPageThumbnail';

type Props = {
  name: string;
  url: string;
  fileType: string;
  storagePath?: string | null;
  isActive?: boolean;
};

function isImageType(fileType: string, name: string, url: string): boolean {
  return (
    fileType.includes('image/') ||
    !!name.match(/\.(jpg|jpeg|png|gif|webp|bmp|heic|heif)$/i) ||
    !!url.match(/\.(jpg|jpeg|png|gif|webp|bmp|heic|heif)(\?|$)/i)
  );
}

function isPdfType(fileType: string, name: string, url: string): boolean {
  return (
    fileType.includes('pdf') ||
    !!name.match(/\.pdf$/i) ||
    !!url.match(/\.pdf(\?|$)/i)
  );
}

function PdfGlyphFallback({ fileType, name }: { fileType: string; name: string }) {
  return (
    <div className="flex h-full w-full flex-col bg-white px-2.5 pb-2 pt-3">
      <div className="mb-2 h-1.5 w-2/3 rounded-full bg-red-500/80" />
      <div className="space-y-1.5">
        <div className="h-1 w-full rounded-full bg-slate-200" />
        <div className="h-1 w-[92%] rounded-full bg-slate-200" />
        <div className="h-1 w-[85%] rounded-full bg-slate-200" />
        <div className="h-1 w-full rounded-full bg-slate-200" />
        <div className="h-1 w-[70%] rounded-full bg-slate-200" />
      </div>
      <div className="mt-auto flex items-center justify-between pt-2">
        <span className="text-[9px] font-bold uppercase tracking-wide text-red-600">PDF</span>
        <div className="origin-center scale-[0.28]">
          <DocumentFileGlyph fileType={fileType} fileName={name} />
        </div>
      </div>
    </div>
  );
}

/**
 * Sidebar thumbnail: real image preview, or PDF page-1 render (pdf.js).
 */
const DocumentSidebarThumb: React.FC<Props> = ({
  name,
  url,
  fileType,
  storagePath,
  isActive = false,
}) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [thumbSrc, setThumbSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);

  const image = isImageType(fileType, name, url);
  const pdf = isPdfType(fileType, name, url);
  const httpUrl = url.startsWith('http://') || url.startsWith('https://') ? url : null;

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { root: null, rootMargin: '120px', threshold: 0.01 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !pdf || failed) return;
    if (!httpUrl && !(storagePath || '').trim()) {
      setFailed(true);
      return;
    }

    let cancelled = false;
    setLoading(true);
    void renderPdfFirstPageThumbnail({
      url: httpUrl || '',
      storagePath,
      targetWidth: 180,
    }).then((dataUrl) => {
      if (cancelled) return;
      if (dataUrl) {
        setThumbSrc(dataUrl);
        setFailed(false);
      } else {
        setFailed(true);
      }
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [visible, pdf, httpUrl, storagePath, failed]);

  return (
    <div
      ref={rootRef}
      className={`relative aspect-[3/4] w-full overflow-hidden rounded-lg border bg-base-300 ${
        isActive ? 'border-primary/30' : 'border-base-300/80'
      }`}
    >
      {image && httpUrl && !failed ? (
        <img
          src={httpUrl}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          draggable={false}
          onError={() => setFailed(true)}
        />
      ) : pdf && thumbSrc ? (
        <img
          src={thumbSrc}
          alt=""
          className="h-full w-full object-cover object-top bg-white"
          draggable={false}
        />
      ) : pdf && loading ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-white">
          <span className="loading loading-spinner loading-sm text-base-content/40" />
          <span className="text-[9px] font-semibold uppercase tracking-wide text-red-600/80">
            PDF
          </span>
        </div>
      ) : pdf ? (
        <PdfGlyphFallback fileType={fileType} name={name} />
      ) : image && failed ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-b from-base-100 to-base-300 px-2">
          <div className="flex origin-center scale-[0.55] items-center justify-center">
            <DocumentFileGlyph fileType={fileType} fileName={name} />
          </div>
        </div>
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-b from-base-100 to-base-300 px-2">
          <div className="flex origin-center scale-[0.55] items-center justify-center">
            <DocumentFileGlyph fileType={fileType} fileName={name} />
          </div>
        </div>
      )}
    </div>
  );
};

export default DocumentSidebarThumb;
