export type GateVideo = {
  youtubeId: string;
  startSeconds?: number;
};

export const CLOCK_IN_GATE_VIDEOS: GateVideo[] = [
  { youtubeId: 'gk-xogIIUt0' },
  { youtubeId: 'P7NFe4S67cc' },
  { youtubeId: 'ky729akiOwM' },
  { youtubeId: 'tZ4ch9rGt_4' },
  { youtubeId: '1_zNTeTRG6o' },
];

/** Rainmaker Lawyer YouTube channel (from gate video oEmbed). */
export const YOUTUBE_GATE_CHANNEL_URL = 'https://www.youtube.com/@Michael.Decker';
export const YOUTUBE_GATE_CHANNEL_SUBSCRIBE_URL = `${YOUTUBE_GATE_CHANNEL_URL}?sub_confirmation=1`;

export function youtubeThumbnailUrl(youtubeId: string): string {
  return `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg`;
}

export function youtubeEmbedUrl(video: GateVideo): string {
  const params = new URLSearchParams({ autoplay: '1', rel: '0' });
  if (video.startSeconds != null && video.startSeconds > 0) {
    params.set('start', String(video.startSeconds));
  }
  return `https://www.youtube-nocookie.com/embed/${video.youtubeId}?${params.toString()}`;
}

export function youtubeWatchUrl(video: GateVideo): string {
  const url = `https://www.youtube.com/watch?v=${video.youtubeId}`;
  if (video.startSeconds != null && video.startSeconds > 0) {
    return `${url}&t=${video.startSeconds}`;
  }
  return url;
}

export type YouTubeOEmbed = {
  title: string;
  author_name: string;
  author_url: string;
  thumbnail_url: string;
};

export function channelAvatarFromAuthorUrl(authorUrl: string): string {
  try {
    const path = new URL(authorUrl).pathname.replace(/^\//, '');
    if (path) return `https://unavatar.io/youtube/${path}`;
  } catch {
    // ignore
  }
  return '';
}
