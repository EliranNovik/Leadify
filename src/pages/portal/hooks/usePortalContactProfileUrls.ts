import { useEffect, useState } from 'react';
import { portalGetContactProfileSignedUrls } from '../../../lib/portalApi';

export function usePortalContactProfileUrls(paths: Array<string | null | undefined>) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const key = paths.filter((p): p is string => Boolean(p?.trim())).sort().join('|');

  useEffect(() => {
    const list = key ? key.split('|') : [];
    if (!list.length) {
      setUrls({});
      return;
    }
    void portalGetContactProfileSignedUrls(list)
      .then(setUrls)
      .catch((e) => console.error('contact profile urls', e));
  }, [key]);

  return urls;
}
