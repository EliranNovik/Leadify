import JSZip from 'jszip';

export type ZipDownloadFile = {
  /** Remote URL (signed URL, public URL, etc.) */
  url: string;
  /** Preferred filename inside the zip */
  name: string;
};

function sanitizeFileName(name: string): string {
  const cleaned = String(name || 'document')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'document';
}

function sanitizeZipBaseName(name: string): string {
  const cleaned = String(name || 'documents')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return cleaned || 'documents';
}

/** Ensure unique names inside the zip (file.pdf, file (1).pdf, …). */
function uniqueZipEntryName(desired: string, used: Set<string>): string {
  const base = sanitizeFileName(desired);
  if (!used.has(base.toLowerCase())) {
    used.add(base.toLowerCase());
    return base;
  }
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : '';
  let i = 1;
  while (true) {
    const candidate = `${stem} (${i})${ext}`;
    if (!used.has(candidate.toLowerCase())) {
      used.add(candidate.toLowerCase());
      return candidate;
    }
    i += 1;
  }
}

function triggerBlobDownload(blob: Blob, fileName: string) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = fileName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(objectUrl);
}

/**
 * Fetch each file and download a single .zip. Returns counts for toast messaging.
 */
export async function downloadFilesAsZip(params: {
  files: ZipDownloadFile[];
  zipFileName: string;
  onProgress?: (done: number, total: number) => void;
}): Promise<{ successCount: number; errorCount: number }> {
  const files = (params.files || []).filter((f) => f?.url && String(f.url).trim());
  if (files.length === 0) {
    return { successCount: 0, errorCount: 0 };
  }

  const zip = new JSZip();
  const usedNames = new Set<string>();
  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    try {
      const response = await fetch(file.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const entryName = uniqueZipEntryName(file.name || `document-${i + 1}`, usedNames);
      zip.file(entryName, blob);
      successCount += 1;
    } catch (err) {
      console.error('[downloadFilesAsZip] failed for', file.name, err);
      errorCount += 1;
    }
    params.onProgress?.(i + 1, files.length);
  }

  if (successCount === 0) {
    return { successCount: 0, errorCount };
  }

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const base = sanitizeZipBaseName(params.zipFileName.replace(/\.zip$/i, ''));
  triggerBlobDownload(zipBlob, `${base}.zip`);
  return { successCount, errorCount };
}
