const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|avif|bmp|svg)(\?|#|$)/i;

/**
 * Whether a stored employee photo field is safe to use as an <img src>.
 * Rejects profile-page URLs (e.g. /en/advocate-…/) that browsers then abort/ORB-block.
 */
export function isUsableEmployeePhotoUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return false;

  if (trimmed.startsWith('data:image/')) return true;

  const isHttp = /^https?:\/\//i.test(trimmed);
  const isRootRelative = trimmed.startsWith('/');
  if (!isHttp && !isRootRelative) return false;

  try {
    const parsed = new URL(trimmed, 'https://placeholder.local');
    const path = parsed.pathname;

    if (path.endsWith('/')) return false;
    if (/\/en\//i.test(path)) return false;
    if (/advocate-[a-z0-9-]+$/i.test(path)) return false;

    if (IMAGE_EXT_RE.test(path) || IMAGE_EXT_RE.test(trimmed)) return true;

    // Supabase public storage paths are valid even when extension parsing is odd
    if (path.includes('/storage/v1/object/')) return true;

    return false;
  } catch {
    return false;
  }
}

/** Prefer photo_url, then photo; return null when neither is a usable image URL. */
export function resolveEmployeePhotoUrl(
  photoUrl?: string | null,
  photoFallback?: string | null,
): string | null {
  const primary = typeof photoUrl === 'string' ? photoUrl.trim() : '';
  if (primary && isUsableEmployeePhotoUrl(primary)) return primary;

  const secondary = typeof photoFallback === 'string' ? photoFallback.trim() : '';
  if (secondary && isUsableEmployeePhotoUrl(secondary)) return secondary;

  return null;
}

/** Look up a saved employee photo by work email first, then display name. */
export function lookupEmployeePhotoFromMap(
  photoMap: Map<string, string> | undefined,
  displayName: string,
  senderEmail?: string | null,
): string | null {
  if (!photoMap || photoMap.size === 0) return null;
  const em = senderEmail?.trim().toLowerCase();
  if (em && photoMap.has(em)) {
    const url = photoMap.get(em);
    if (url) return url;
  }
  if (displayName?.trim()) {
    const t = displayName.trim();
    if (photoMap.has(t)) return photoMap.get(t) || null;
    const lower = t.toLowerCase();
    for (const [name, url] of photoMap) {
      if (name.includes('@')) continue;
      if (name.trim().toLowerCase() === lower) return url;
    }
  }
  return null;
}
