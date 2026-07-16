/**
 * Load PDF.js the same way payroll/salary PDF parsing does (CDN + worker).
 * Vite + pdfjs-dist ESM worker setup is unreliable in this app; CDN matches existing usage.
 */
export async function loadPdfJsLib(): Promise<any> {
  const w = window as any;
  let pdfjsLib: any = w.pdfjsLib || w.pdfjs;
  if (pdfjsLib?.getDocument) {
    ensureWorker(pdfjsLib);
    return pdfjsLib;
  }

  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector('script[data-pdfjs]') as HTMLScriptElement | null;
    if (existing) {
      const tryResolve = () => {
        const lib = w.pdfjsLib || w.pdfjs;
        if (lib?.getDocument) {
          ensureWorker(lib);
          resolve();
          return true;
        }
        return false;
      };
      if (tryResolve()) return;
      existing.addEventListener('load', () => {
        if (!tryResolve()) reject(new Error('PDF.js loaded but getDocument is missing'));
      });
      existing.addEventListener('error', () => reject(new Error('Failed to load PDF.js')));
      // Script may already be loaded without firing again
      window.setTimeout(() => {
        if (!tryResolve()) reject(new Error('PDF.js script present but not ready'));
      }, 4000);
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
    script.async = true;
    script.setAttribute('data-pdfjs', 'true');
    script.onload = () => {
      const lib = w.pdfjsLib || w.pdfjs;
      if (!lib?.getDocument) {
        reject(new Error('PDF.js loaded but getDocument is missing'));
        return;
      }
      ensureWorker(lib);
      resolve();
    };
    script.onerror = () => reject(new Error('Failed to load PDF.js from CDN'));
    document.head.appendChild(script);
  });

  pdfjsLib = w.pdfjsLib || w.pdfjs;
  if (!pdfjsLib?.getDocument) throw new Error('PDF.js library not available');
  return pdfjsLib;
}

function ensureWorker(pdfjsLib: any) {
  const version = String(pdfjsLib.version || '3.11.174');
  const workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${version}/build/pdf.worker.min.js`;
  if (!pdfjsLib.GlobalWorkerOptions) {
    pdfjsLib.GlobalWorkerOptions = { workerSrc };
  } else {
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
  }
}

export async function fetchPdfBytes(src: string): Promise<Uint8Array> {
  // Prefer a plain ArrayBuffer fetch; fall back to blob if needed.
  try {
    const res = await fetch(src, { mode: 'cors', credentials: 'omit', cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed to fetch PDF (${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
  } catch (first) {
    // Some browsers/CDN combos fail on arrayBuffer after opaque issues — retry once.
    const res = await fetch(src, { mode: 'cors', credentials: 'omit' });
    if (!res.ok) throw first instanceof Error ? first : new Error('Failed to fetch PDF');
    const blob = await res.blob();
    return new Uint8Array(await blob.arrayBuffer());
  }
}
