import { useEffect, useMemo, useState } from 'react';
import { portalGetContactProfileSignedUrls } from '../../../lib/portalApi';

const profileUrlMemoryCache = new Map<string, string>();

export function seedPortalContactProfileUrls(urls: Record<string, string>): void {
  for (const [path, url] of Object.entries(urls)) {
    if (path && url) profileUrlMemoryCache.set(path, url);
  }
}

function urlsForPaths(paths: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const path of paths) {
    const cached = profileUrlMemoryCache.get(path);
    if (cached) out[path] = cached;
  }
  return out;
}

export function usePortalContactProfileUrls(paths: Array<string | null | undefined>) {
  const listKey = paths
    .filter((p): p is string => Boolean(p?.trim()))
    .sort()
    .join('|');

  const list = useMemo(
    () => (listKey ? listKey.split('|') : []),
    [listKey],
  );

  const [urls, setUrls] = useState<Record<string, string>>(() => urlsForPaths(list));

  useEffect(() => {
    if (!list.length) {
      setUrls({});
      return;
    }

    const cached = urlsForPaths(list);
    const missing = list.filter((path) => !profileUrlMemoryCache.has(path));

    if (!missing.length) {
      setUrls(cached);
      return;
    }

    void portalGetContactProfileSignedUrls(missing)
      .then((fetched) => {
        seedPortalContactProfileUrls(fetched);
        setUrls({ ...cached, ...fetched });
      })
      .catch((e) => console.error('contact profile urls', e));
  }, [listKey, list]);

  return urls;
}
