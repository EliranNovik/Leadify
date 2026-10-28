import { useEffect, useState } from 'react';

/**
 * Showing the HEIC photos iPhones produce.
 *
 * No browser but Safari can decode HEIC, so an `<img>` pointed at one shows nothing at all. The
 * bytes are decoded here into a JPEG the browser can draw, by `heic2any` (libheif compiled to
 * WebAssembly), which is imported only when such a file is actually opened — it is over a megabyte
 * and most people never open one.
 */

const HEIC_EXTENSION = /\.(heic|heif)$/i;

export function isHeicFile(name: string, mimeType?: string | null): boolean {
  const mime = String(mimeType || '').toLowerCase();
  if (mime.includes('heic') || mime.includes('heif')) return true;
  return HEIC_EXTENSION.test(String(name || '').trim());
}

/** Decoded files, so paging back to a photo does not decode it a second time. */
const decoded = new Map<string, string>();
/** Decodes already running, so two thumbnails of one file share the work. */
const inFlight = new Map<string, Promise<string>>();
const MAX_CACHED = 8;

function remember(key: string, objectUrl: string) {
  decoded.set(key, objectUrl);
  while (decoded.size > MAX_CACHED) {
    const oldest = decoded.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    const stale = decoded.get(oldest);
    decoded.delete(oldest);
    if (stale) URL.revokeObjectURL(stale);
  }
}

/**
 * A URL for the picture inside a HEIC file, which can be shown anywhere an image can.
 *
 * `cacheKey` is what the result is remembered under — a storage path rather than a signed URL,
 * which changes every time it is signed and would make the cache useless.
 */
export async function heicObjectUrl(source: string, cacheKey?: string): Promise<string> {
  const key = (cacheKey || source).trim();
  const ready = decoded.get(key);
  if (ready) return ready;
  const running = inFlight.get(key);
  if (running) return running;

  const work = (async () => {
    const response = await fetch(source);
    if (!response.ok) throw new Error(`Could not read the file (${response.status})`);
    const blob = await response.blob();
    const { default: heic2any } = await import('heic2any');
    const converted = await heic2any({ blob, toType: 'image/jpeg', quality: 0.92 });
    // It answers with one blob, or several for a file holding a burst of photos.
    const first = Array.isArray(converted) ? converted[0] : converted;
    const objectUrl = URL.createObjectURL(first as Blob);
    remember(key, objectUrl);
    return objectUrl;
  })();

  inFlight.set(key, work);
  try {
    return await work;
  } finally {
    inFlight.delete(key);
  }
}

export type HeicPreview = {
  /** The shown-able URL, once there is one. */
  url: string | null;
  loading: boolean;
  error: string | null;
};

/**
 * The decoded picture for a HEIC file, or nothing at all for every other kind of file — pass null
 * as the source and this does no work.
 */
export function useHeicPreview(source: string | null, cacheKey?: string | null): HeicPreview {
  const key = (cacheKey || source || '').trim();
  const [state, setState] = useState<HeicPreview>(() => ({
    url: key ? decoded.get(key) ?? null : null,
    loading: false,
    error: null,
  }));

  useEffect(() => {
    if (!source) {
      setState({ url: null, loading: false, error: null });
      return;
    }
    const ready = key ? decoded.get(key) : null;
    if (ready) {
      setState({ url: ready, loading: false, error: null });
      return;
    }

    let cancelled = false;
    setState({ url: null, loading: true, error: null });
    heicObjectUrl(source, key || undefined)
      .then((url) => {
        if (!cancelled) setState({ url, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          url: null,
          loading: false,
          error: err instanceof Error ? err.message : 'Could not read this photo',
        });
      });

    return () => {
      cancelled = true;
    };
  }, [source, key]);

  return state;
}
