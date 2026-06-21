import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

const BUCKET = 'client-portal-contact-profiles';
const SIGNED_SECONDS = 60 * 60;

export function useContactProfileImageUrls(paths: Array<string | null | undefined>) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const key = paths.filter((p): p is string => Boolean(p?.trim())).sort().join('|');

  useEffect(() => {
    const list = key ? key.split('|') : [];
    if (!list.length) {
      setUrls({});
      return;
    }

    let cancelled = false;

    void (async () => {
      const entries = await Promise.all(
        list.map(async (path) => {
          const { data, error } = await supabase.storage
            .from(BUCKET)
            .createSignedUrl(path, SIGNED_SECONDS);
          return { path, url: !error && data?.signedUrl ? data.signedUrl : '' };
        }),
      );

      if (cancelled) return;

      const next: Record<string, string> = {};
      for (const entry of entries) {
        if (entry.url) next[entry.path] = entry.url;
      }
      setUrls(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [key]);

  return urls;
}
