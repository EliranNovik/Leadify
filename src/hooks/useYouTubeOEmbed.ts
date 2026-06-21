import { useEffect, useState } from 'react';
import type { YouTubeOEmbed } from '../lib/clockInGateVideoCatalog';

const cache = new Map<string, YouTubeOEmbed | null>();

async function fetchOEmbed(youtubeId: string): Promise<YouTubeOEmbed | null> {
  if (cache.has(youtubeId)) return cache.get(youtubeId) ?? null;

  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${youtubeId}`)}&format=json`,
    );
    if (!res.ok) {
      cache.set(youtubeId, null);
      return null;
    }
    const data = (await res.json()) as YouTubeOEmbed;
    cache.set(youtubeId, data);
    return data;
  } catch {
    cache.set(youtubeId, null);
    return null;
  }
}

export function useYouTubeOEmbed(youtubeId: string): {
  meta: YouTubeOEmbed | null;
  loading: boolean;
} {
  const [meta, setMeta] = useState<YouTubeOEmbed | null>(() => cache.get(youtubeId) ?? null);
  const [loading, setLoading] = useState(() => !cache.has(youtubeId));

  useEffect(() => {
    let cancelled = false;
    if (cache.has(youtubeId)) {
      setMeta(cache.get(youtubeId) ?? null);
      setLoading(false);
      return;
    }

    setLoading(true);
    fetchOEmbed(youtubeId).then((data) => {
      if (!cancelled) {
        setMeta(data);
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [youtubeId]);

  return { meta, loading };
}
