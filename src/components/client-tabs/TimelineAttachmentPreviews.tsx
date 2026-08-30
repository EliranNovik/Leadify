import React, { useState } from 'react';
import { PaperClipIcon } from '@heroicons/react/24/outline';

export type TimelinePreviewKind = 'image' | 'video' | 'pdf' | 'audio' | 'file';

export type TimelinePreviewItem = {
  key: string;
  name: string;
  previewUrl?: string | null;
  kind: TimelinePreviewKind;
  meta?: string;
  onClick?: () => void;
};

function TimelinePreviewThumb({ item }: { item: TimelinePreviewItem }) {
  const [broken, setBroken] = useState(false);
  const showImage = item.kind === 'image' && !!item.previewUrl && !broken;
  const showVideo = item.kind === 'video' && !!item.previewUrl && !broken;

  if (showImage) {
    return (
      <img
        src={item.previewUrl || undefined}
        alt={item.name}
        className="h-full w-full object-cover"
        onError={() => setBroken(true)}
      />
    );
  }

  if (showVideo) {
    return (
      <video
        src={item.previewUrl || undefined}
        className="h-full w-full object-cover"
        muted
        preload="metadata"
        onError={() => setBroken(true)}
      />
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 px-2">
      <PaperClipIcon className="h-6 w-6 text-slate-400" />
      {item.kind === 'pdf' && (
        <span className="text-[9px] font-bold uppercase tracking-wide text-red-600">PDF</span>
      )}
      {item.kind === 'audio' && (
        <span className="text-[9px] font-bold uppercase tracking-wide text-slate-500">Audio</span>
      )}
    </div>
  );
}

export function TimelineAttachmentPreviews({ items }: { items: TimelinePreviewItem[] }) {
  if (!items.length) return null;

  const stopCardClick = (e: React.SyntheticEvent) => {
    e.stopPropagation();
  };

  return (
    <div
      className="mt-3 flex flex-wrap gap-2"
      onClick={stopCardClick}
      onMouseDown={stopCardClick}
      onPointerDown={stopCardClick}
    >
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          title={`Open ${item.name}`}
          onMouseDown={stopCardClick}
          onPointerDown={stopCardClick}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            item.onClick?.();
          }}
          className="w-[7.5rem] cursor-pointer overflow-hidden rounded-xl border border-base-200 bg-base-100 text-left shadow-sm transition hover:border-slate-300 hover:shadow"
        >
          <div className="aspect-[4/3] bg-slate-50">
            <TimelinePreviewThumb item={item} />
          </div>
          <div className="px-2 py-1.5">
            <p className="truncate text-[11px] font-medium text-slate-700">{item.name}</p>
            {item.meta ? <p className="truncate text-[10px] text-slate-400">{item.meta}</p> : null}
          </div>
        </button>
      ))}
    </div>
  );
}
