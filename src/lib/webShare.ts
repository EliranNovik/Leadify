import toast from 'react-hot-toast';

/**
 * Native Web Share is only reliable on phones/tablets.
 * Desktop Chrome/Edge on Windows also expose `navigator.share`, and Microsoft Word
 * is a share target — choosing it (or having Word as the default) opens Word's
 * Insert Hyperlink dialog instead of sharing the link.
 */
export function canUseNativeWebShare(): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') {
    return false;
  }
  const ua = navigator.userAgent || '';
  if (/Android|iPhone|iPod/i.test(ua)) return true;
  if (/iPad/i.test(ua)) return true;
  // iPadOS 13+ reports as Macintosh with touch
  if (/Macintosh/i.test(ua) && (navigator.maxTouchPoints || 0) > 1) return true;
  return false;
}

export async function shareOrCopyUrl(options: {
  url: string;
  title?: string;
  text?: string;
  copiedMessage?: string;
}): Promise<'shared' | 'copied' | 'cancelled'> {
  const { url, title, text, copiedMessage = 'Link copied to clipboard' } = options;

  if (canUseNativeWebShare()) {
    try {
      await navigator.share({ title, text, url });
      return 'shared';
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        return 'cancelled';
      }
    }
  }

  try {
    await navigator.clipboard.writeText(url);
    toast.success(copiedMessage);
    return 'copied';
  } catch (err) {
    console.error('Failed to copy link:', err);
    toast.error('Failed to copy link');
    throw err;
  }
}
