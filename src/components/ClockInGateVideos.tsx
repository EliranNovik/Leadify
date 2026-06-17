import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PlayCircleIcon } from '@heroicons/react/24/outline';
import { PlayIcon, XMarkIcon } from '@heroicons/react/24/solid';

type GateVideo = {
  youtubeId: string;
  startSeconds?: number;
};

const CLOCK_IN_GATE_VIDEOS: GateVideo[] = [
  { youtubeId: 'gk-xogIIUt0' },
  { youtubeId: 'P7NFe4S67cc' },
  { youtubeId: 'ky729akiOwM' },
  { youtubeId: 'tZ4ch9rGt_4' },
  { youtubeId: '1_zNTeTRG6o' },
];

const VISIBLE_THUMBNAIL_COUNT = 3;
const THUMBNAIL_GAP_PX = 8;
const MOBILE_THUMB_WIDTH_PX = 144;

function youtubeThumbnailUrl(youtubeId: string): string {
  return `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg`;
}

function youtubeEmbedUrl(video: GateVideo): string {
  const params = new URLSearchParams({ autoplay: '1', rel: '0' });
  if (video.startSeconds != null && video.startSeconds > 0) {
    params.set('start', String(video.startSeconds));
  }
  return `https://www.youtube-nocookie.com/embed/${video.youtubeId}?${params.toString()}`;
}

function VideoThumbnailButton({
  video,
  onPlay,
  className = '',
  style,
}: {
  video: GateVideo;
  onPlay: (video: GateVideo) => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <button
      type="button"
      onClick={() => onPlay(video)}
      className={`group relative shrink-0 overflow-hidden rounded-xl text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#d4af37]/60 ${className}`}
      style={style}
      aria-label="Play video"
    >
      <img
        src={youtubeThumbnailUrl(video.youtubeId)}
        alt=""
        className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
      />
      <span className="absolute inset-0 bg-black/25 transition-colors group-hover:bg-black/35" />
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-red-600/95 text-white shadow-lg transition-transform group-hover:scale-105">
          <PlayIcon className="h-4 w-4 ml-0.5" aria-hidden />
        </span>
      </span>
    </button>
  );
}

function VerticalVideoScroll({ onPlay }: { onPlay: (video: GateVideo) => void }) {
  const measureRef = useRef<HTMLDivElement>(null);
  const [itemHeight, setItemHeight] = useState(() =>
    Math.round(288 * (9 / 16)),
  );

  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return;

    const compute = () => {
      const width = el.getBoundingClientRect().width;
      if (width <= 0) return;
      setItemHeight(Math.round(width * (9 / 16)));
    };

    compute();
    const observer = new ResizeObserver(compute);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const listHeight =
    itemHeight * VISIBLE_THUMBNAIL_COUNT + THUMBNAIL_GAP_PX * (VISIBLE_THUMBNAIL_COUNT - 1);

  return (
    <div ref={measureRef} className="w-full min-w-0">
      <div
        className="flex flex-col gap-2 overflow-y-auto overscroll-contain"
        style={{ height: `${listHeight}px` }}
      >
        {CLOCK_IN_GATE_VIDEOS.map((video) => (
          <VideoThumbnailButton
            key={`${video.youtubeId}-${video.startSeconds ?? 0}`}
            video={video}
            onPlay={onPlay}
            className="w-full"
            style={{ height: `${itemHeight}px` }}
          />
        ))}
      </div>
    </div>
  );
}

function HorizontalVideoStrip({ onPlay }: { onPlay: (video: GateVideo) => void }) {
  const thumbHeight = Math.round(MOBILE_THUMB_WIDTH_PX * (9 / 16));

  return (
    <div
      className="flex gap-2 overflow-x-auto overscroll-x-contain snap-x snap-mandatory pb-1 -mx-0.5 px-0.5"
      style={{ WebkitOverflowScrolling: 'touch' }}
    >
      {CLOCK_IN_GATE_VIDEOS.map((video) => (
        <VideoThumbnailButton
          key={`${video.youtubeId}-${video.startSeconds ?? 0}`}
          video={video}
          onPlay={onPlay}
          className="snap-start"
          style={{ width: `${MOBILE_THUMB_WIDTH_PX}px`, height: `${thumbHeight}px` }}
        />
      ))}
    </div>
  );
}

type ClockInGateVideosProps = {
  placement?: 'mobile' | 'desktop' | 'both';
};

const ClockInGateVideos: React.FC<ClockInGateVideosProps> = ({ placement = 'both' }) => {
  const [activeVideo, setActiveVideo] = useState<GateVideo | null>(null);
  const showMobile = placement === 'mobile' || placement === 'both';
  const showDesktop = placement === 'desktop' || placement === 'both';

  useEffect(() => {
    if (!activeVideo) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveVideo(null);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [activeVideo]);

  if (CLOCK_IN_GATE_VIDEOS.length === 0) return null;

  const modal = activeVideo
    ? createPortal(
        <div
          className="fixed inset-0 z-[310] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          role="presentation"
          onClick={() => setActiveVideo(null)}
        >
          <div
            className="relative w-full max-w-[min(36rem,calc(100vw-2rem))] rounded-2xl overflow-hidden bg-black shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-label="Video player"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-end gap-3 px-3 py-2 bg-[rgba(20,20,20,0.95)] text-white">
              <button
                type="button"
                onClick={() => setActiveVideo(null)}
                className="btn btn-ghost btn-circle btn-sm text-white hover:bg-white/10"
                aria-label="Close video"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            <div className="relative w-full aspect-video bg-black">
              <iframe
                key={`${activeVideo.youtubeId}-${activeVideo.startSeconds ?? 0}`}
                src={youtubeEmbedUrl(activeVideo)}
                title="YouTube video"
                className="absolute inset-0 h-full w-full border-0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            </div>
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      {showMobile && (
        <div
          className="pointer-events-auto w-full rounded-2xl bg-[rgba(20,20,20,0.45)] backdrop-blur-[14px] shadow-[0_12px_40px_rgba(0,0,0,0.35)] text-white p-3"
          data-sheet-no-drag
        >
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold leading-snug">
            <PlayCircleIcon className="h-5 w-5 shrink-0 text-[#d4af37]" aria-hidden />
            Watch videos
          </p>
          <HorizontalVideoStrip onPlay={setActiveVideo} />
        </div>
      )}

      {showDesktop && (
        <div
          className="pointer-events-auto w-full max-w-xs rounded-2xl bg-[rgba(20,20,20,0.45)] backdrop-blur-[14px] shadow-[0_12px_40px_rgba(0,0,0,0.35)] text-white p-4 overflow-hidden"
          data-sheet-no-drag
        >
          <p className="mb-3 text-base font-semibold leading-snug">While you are waiting...</p>
          <VerticalVideoScroll onPlay={setActiveVideo} />
        </div>
      )}

      {modal}
    </>
  );
};

export default ClockInGateVideos;
