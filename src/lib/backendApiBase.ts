/**
 * In local dev, prefer the Vite `/api` proxy (same-origin) even when VITE_BACKEND_URL
 * points at localhost:3001 — direct cross-origin calls fail CORS in the browser.
 */
export function shouldUseViteApiProxy(): boolean {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false;
  const host = window.location.hostname;
  if (host.includes('ngrok')) return false;

  const backend = (import.meta.env.VITE_BACKEND_URL as string | undefined)?.replace(/\/+$/, '');
  if (!backend) return true;

  try {
    const { hostname } = new URL(backend);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  } catch {
    return false;
  }
}

export function getBackendOrigin(): string {
  if (shouldUseViteApiProxy()) return '';
  const backend = (import.meta.env.VITE_BACKEND_URL as string | undefined)?.replace(/\/+$/, '');
  return backend || 'http://localhost:3001';
}

export function buildBackendApiUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const origin = getBackendOrigin();
  return origin ? `${origin}${normalized}` : normalized;
}

export function buildBackendApiUrlObject(path: string): URL {
  const url = buildBackendApiUrl(path);
  if (url.startsWith('/')) {
    return new URL(url, window.location.origin);
  }
  return new URL(url);
}
