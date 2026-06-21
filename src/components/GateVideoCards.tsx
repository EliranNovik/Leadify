import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { PlayIcon, XMarkIcon } from '@heroicons/react/24/solid';
import {
  CLOCK_IN_GATE_VIDEOS,
  channelAvatarFromAuthorUrl,
  youtubeEmbedUrl,
  youtubeThumbnailUrl,
  type GateVideo,
} from '../lib/clockInGateVideoCatalog';
import { useYouTubeOEmbed } from '../hooks/useYouTubeOEmbed';

export const GATE_VIDEO_CARD_WIDTH_PX = 280;

export function YouTubeLogoIcon({ className = 'h-6 w-6 shrink-0' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#FF0000"
        d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2 31.5 31.5 0 0 0 0 12a31.5 31.5 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1A31.5 31.5 0 0 0 24 12a31.5 31.5 0 0 0-.5-5.8z"
      />
      <path fill="#FFFFFF" d="M9.75 15.02l6.19-3.52-6.19-3.52v7.04z" />
    </svg>
  );
}

export function GateVideoModal({
  video,
  onClose,
}: {
  video: GateVideo;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[310] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-[min(36rem,calc(100vw-2rem))] overflow-hidden rounded-2xl bg-black shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Video player"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-end bg-[rgba(20,20,20,0.95)] px-3 py-2 text-white">
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost btn-circle btn-sm text-white hover:bg-white/10"
            aria-label="Close video"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
        <div className="relative aspect-video w-full bg-black">
          <iframe
            key={`${video.youtubeId}-${video.startSeconds ?? 0}`}
            src={youtubeEmbedUrl(video)}
            title="YouTube video"
            className="absolute inset-0 h-full w-full border-0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function GateVideoCard({
  video,
  onPlay,
  theme = 'dark',
  className = '',
  style,
}: {
  video: GateVideo;
  onPlay: (video: GateVideo) => void;
  theme?: 'dark' | 'light';
  className?: string;
  style?: React.CSSProperties;
}) {
  const { meta, loading } = useYouTubeOEmbed(video.youtubeId);
  const channelAvatar = meta ? channelAvatarFromAuthorUrl(meta.author_url) : '';
  const thumbHeight = Math.round(GATE_VIDEO_CARD_WIDTH_PX * (9 / 16));
  const isLight = theme === 'light';

  return (
    <article
      className={`flex shrink-0 snap-start flex-col ${className}`}
      style={style ?? { width: `${GATE_VIDEO_CARD_WIDTH_PX}px` }}
    >
      <button
        type="button"
        onClick={() => onPlay(video)}
        className={`group relative w-full overflow-hidden rounded-xl text-left focus:outline-none focus-visible:ring-2 ${
          isLight ? 'focus-visible:ring-primary/40' : 'focus-visible:ring-[#d4af37]/60'
        }`}
        style={{ height: `${thumbHeight}px` }}
        aria-label={meta?.title ?? 'Play video'}
      >
        <img
          src={youtubeThumbnailUrl(video.youtubeId)}
          alt=""
          className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
        />
        <span className="absolute inset-0 bg-black/20 transition-colors group-hover:bg-black/30" />
        <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-red-600/95 text-white shadow-lg">
            <PlayIcon className="ml-0.5 h-4 w-4" aria-hidden />
          </span>
        </span>
      </button>

      <div className="mt-2.5 flex gap-2.5">
        {channelAvatar ? (
          <img
            src={channelAvatar}
            alt=""
            className={`h-9 w-9 shrink-0 rounded-full object-cover ring-1 ${
              isLight ? 'bg-base-200 ring-base-300' : 'bg-white/10 ring-white/15'
            }`}
            loading="lazy"
          />
        ) : (
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold ring-1 ${
              isLight
                ? 'bg-base-200 text-base-content/60 ring-base-300'
                : 'bg-white/10 text-white/70 ring-white/15'
            }`}
          >
            {meta?.author_name?.charAt(0) ?? '?'}
          </span>
        )}
        <div className="min-w-0 flex-1">
          {loading ? (
            <>
              <div
                className={`mb-1.5 h-3.5 w-full animate-pulse rounded ${
                  isLight ? 'bg-base-200' : 'bg-white/10'
                }`}
              />
              <div
                className={`h-3 w-2/3 animate-pulse rounded ${isLight ? 'bg-base-200' : 'bg-white/10'}`}
              />
            </>
          ) : (
            <>
              <p
                className={`line-clamp-2 text-[13px] font-medium leading-snug ${
                  isLight ? 'text-black' : 'text-white/90'
                }`}
              >
                {meta?.title ?? 'Video'}
              </p>
              <p className={`mt-0.5 truncate text-xs ${isLight ? 'text-black/70' : 'text-white/50'}`}>
                {meta?.author_name ?? ''}
              </p>
            </>
          )}
        </div>
      </div>
    </article>
  );
}

export function GateVideoStripRow({
  theme,
  onPlay,
  className = '',
  paddingClassName = 'px-4 sm:px-6 lg:px-8',
}: {
  theme: 'dark' | 'light';
  onPlay: (video: GateVideo) => void;
  className?: string;
  paddingClassName?: string;
}) {
  return (
    <div
      className={`scrollbar-hide w-full min-w-0 overflow-x-auto overscroll-x-contain ${className}`}
      style={{ WebkitOverflowScrolling: 'touch' }}
    >
      <div className={`flex w-max min-w-full gap-4 snap-x snap-mandatory ${paddingClassName}`}>
        {CLOCK_IN_GATE_VIDEOS.map((video) => (
          <GateVideoCard
            key={`${video.youtubeId}-${video.startSeconds ?? 0}`}
            video={video}
            onPlay={onPlay}
            theme={theme}
          />
        ))}
      </div>
    </div>
  );
}

export function GateVideoVerticalList({
  theme,
  onPlay,
  maxVisible = 3,
  className = '',
}: {
  theme: 'dark' | 'light';
  onPlay: (video: GateVideo) => void;
  maxVisible?: number;
  className?: string;
}) {
  const thumbHeight = Math.round(GATE_VIDEO_CARD_WIDTH_PX * (9 / 16));
  const metaHeight = 56;
  const gap = 16;
  const listHeight = (thumbHeight + metaHeight) * maxVisible + gap * (maxVisible - 1);

  return (
    <div
      className={`scrollbar-hide flex flex-col gap-4 overflow-y-auto overscroll-contain ${className}`}
      style={{ maxHeight: `${listHeight}px` }}
    >
      {CLOCK_IN_GATE_VIDEOS.map((video) => (
        <GateVideoCard
          key={`${video.youtubeId}-${video.startSeconds ?? 0}`}
          video={video}
          onPlay={onPlay}
          theme={theme}
          className="w-full shrink-0 snap-start"
          style={{ width: '100%' }}
        />
      ))}
    </div>
  );
}

export function GateVideoMobileIconLauncher({
  theme,
  onPlay,
}: {
  theme: 'dark' | 'light';
  onPlay: (video: GateVideo) => void;
}) {
  const [open, setOpen] = useState(false);
  const isLight = theme === 'light';

  return (
    <div className="w-full min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex h-11 w-11 items-center justify-center rounded-xl border transition-colors ${
          isLight
            ? 'border-base-200 bg-base-50 hover:bg-base-100'
            : 'border-white/15 bg-white/10 hover:bg-white/15'
        }`}
        aria-expanded={open}
        aria-label="YouTube videos"
      >
        <YouTubeLogoIcon />
      </button>

      {open ? (
        <div className="mt-3">
          <GateVideoStripRow theme={theme} onPlay={onPlay} paddingClassName="px-0" />
        </div>
      ) : null}
    </div>
  );
}

export function useGateVideoPlayer() {
  const [activeVideo, setActiveVideo] = useState<GateVideo | null>(null);
  return { activeVideo, setActiveVideo, clearActiveVideo: () => setActiveVideo(null) };
}
