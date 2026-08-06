import { fetchPdfBytes, loadPdfJsLib } from './loadPdfJs';
import { supabase } from './supabase';
import { CASE_DOCUMENTS_STORAGE_BUCKET } from './caseDocumentsStorage';

const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();

const MAX_CONCURRENT = 2;
let active = 0;
const waitQueue: Array<() => void> = [];

async function withConcurrencyLimit<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => waitQueue.push(resolve));
  }
  active += 1;
  try {
    return await fn();
  } finally {
    active -= 1;
    const next = waitQueue.shift();
    if (next) next();
  }
}

async function loadPdfBytes(params: {
  url: string;
  storagePath?: string | null;
}): Promise<Uint8Array> {
  const path = (params.storagePath || '').trim();
  if (path) {
    const { data: blob, error } = await supabase.storage
      .from(CASE_DOCUMENTS_STORAGE_BUCKET)
      .download(path);
    if (!error && blob) {
      return new Uint8Array(await blob.arrayBuffer());
    }
  }
  return fetchPdfBytes(params.url);
}

/**
 * Render page 1 of a PDF to a JPEG data URL for sidebar thumbnails.
 * Results are cached by URL / storage path.
 */
export async function renderPdfFirstPageThumbnail(params: {
  url: string;
  storagePath?: string | null;
  /** Target width in CSS pixels (default ~180 for sidebar cards). */
  targetWidth?: number;
}): Promise<string | null> {
  const url = (params.url || '').trim();
  const path = (params.storagePath || '').trim();
  if (!url && !path) return null;

  const cacheKey = path ? `path:${path}` : `url:${url}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const existing = inflight.get(cacheKey);
  if (existing) return existing;

  const promise = withConcurrencyLimit(async () => {
    try {
      const pdfjsLib = await loadPdfJsLib();
      const data = await loadPdfBytes({ url, storagePath: path || null });
      const doc = await pdfjsLib.getDocument({ data }).promise;
      if (!doc.numPages || doc.numPages < 1) return null;

      const page = await doc.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const targetWidth = Math.max(96, Math.min(320, params.targetWidth ?? 180));
      const scale = targetWidth / Math.max(1, base.width);
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      await page.render({ canvasContext: ctx, viewport }).promise;
      const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
      cache.set(cacheKey, dataUrl);
      return dataUrl;
    } catch (err) {
      console.warn('[pdfFirstPageThumbnail] failed:', err);
      return null;
    } finally {
      inflight.delete(cacheKey);
    }
  });

  inflight.set(cacheKey, promise);
  return promise;
}
