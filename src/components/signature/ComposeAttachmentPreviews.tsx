import React, { useEffect, useMemo, useState } from 'react';
import { PaperClipIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { loadPdfJsLib } from '../../lib/loadPdfJs';

export type EncodedComposeAttachment = {
  name: string;
  contentType?: string;
  contentBytes: string;
};

export type ComposeAttachmentSource = File | EncodedComposeAttachment;

type ComposeAttachmentPreviewsProps = {
  files: ComposeAttachmentSource[];
  onRemove: (index: number) => void;
  className?: string;
};

function encodedToFile(att: EncodedComposeAttachment): File {
  const binary = atob(att.contentBytes);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], att.name, {
    type: att.contentType || 'application/octet-stream',
  });
}

function toFile(item: ComposeAttachmentSource): File {
  return item instanceof File ? item : encodedToFile(item);
}

function isImageFile(file: File): boolean {
  return (
    file.type.startsWith('image/') ||
    /\.(jpe?g|png|gif|webp|bmp|heic|heif)$/i.test(file.name)
  );
}

function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

const ComposeAttachmentCard: React.FC<{
  file: File;
  onRemove: () => void;
}> = ({ file, onRemove }) => {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [pdfThumb, setPdfThumb] = useState<string | null>(null);
  const [pdfFailed, setPdfFailed] = useState(false);
  const image = isImageFile(file);
  const pdf = isPdfFile(file);

  useEffect(() => {
    if (!image) return;
    const url = URL.createObjectURL(file);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file, image]);

  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;
    void (async () => {
      try {
        const pdfjsLib = await loadPdfJsLib();
        const data = new Uint8Array(await file.arrayBuffer());
        const doc = await pdfjsLib.getDocument({ data }).promise;
        if (!doc.numPages || cancelled) return;
        const page = await doc.getPage(1);
        const base = page.getViewport({ scale: 1 });
        const scale = 220 / Math.max(1, base.width);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          if (!cancelled) setPdfFailed(true);
          return;
        }
        await page.render({ canvasContext: ctx, viewport }).promise;
        if (cancelled) return;
        setPdfThumb(canvas.toDataURL('image/jpeg', 0.82));
      } catch {
        if (!cancelled) setPdfFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdf, file]);

  return (
    <div className="relative w-32 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="relative aspect-[3/4] w-full bg-slate-100">
        {image && objectUrl ? (
          <img src={objectUrl} alt={file.name} className="h-full w-full object-contain bg-white" />
        ) : pdf && pdfThumb ? (
          <img
            src={pdfThumb}
            alt={file.name}
            className="h-full w-full bg-white object-contain object-top"
          />
        ) : pdf && !pdfFailed ? (
          <div className="flex h-full w-full items-center justify-center bg-white">
            <span className="loading loading-spinner loading-sm text-slate-400" />
          </div>
        ) : pdf ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-white px-2">
            <span className="text-[10px] font-bold uppercase tracking-wide text-red-600">PDF</span>
            <span className="line-clamp-3 text-center text-[11px] text-slate-600">{file.name}</span>
          </div>
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-2">
            <PaperClipIcon className="h-7 w-7 text-slate-400" />
            <span className="line-clamp-3 text-center text-[11px] text-slate-600">{file.name}</span>
          </div>
        )}
        <button
          type="button"
          onClick={onRemove}
          className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
          title="Remove attachment"
          aria-label={`Remove ${file.name}`}
        >
          <XMarkIcon className="h-4 w-4" />
        </button>
        {pdf && (
          <span className="absolute left-1.5 top-1.5 rounded bg-red-600 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
            PDF
          </span>
        )}
      </div>
      <p className="truncate px-2 py-1.5 text-[11px] text-slate-600" title={file.name}>
        {file.name}
      </p>
    </div>
  );
};

export const ComposeAttachmentPreviews: React.FC<ComposeAttachmentPreviewsProps> = ({
  files,
  onRemove,
  className = 'px-4 pb-3',
}) => {
  const resolved = useMemo(() => files.map(toFile), [files]);
  if (!files.length) return null;
  return (
    <div className={`flex flex-wrap gap-3 ${className}`}>
      {resolved.map((file, index) => (
        <ComposeAttachmentCard
          key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
          file={file}
          onRemove={() => onRemove(index)}
        />
      ))}
    </div>
  );
};

export default ComposeAttachmentPreviews;
