import * as XLSX from 'xlsx';

export const RMQ_EXCEL_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export type RmqAiChatFile = {
  id: string;
  filename: string;
  url: string;
  mimeType: string;
};

export type ExcelSheetInput = {
  name?: string;
  columns?: string[];
  rows?: unknown;
};

const fileRegistry = new Map<string, RmqAiChatFile>();
let pendingFiles: RmqAiChatFile[] = [];

const MAX_SHEETS = 8;
const MAX_ROWS = 2000;
const MAX_COLS = 40;
const MAX_CELL = 500;

export function rememberRmqAiFile(file: RmqAiChatFile): void {
  fileRegistry.set(file.id, file);
  pendingFiles.push(file);
}

export function takeRmqAiToolFiles(): RmqAiChatFile[] {
  const files = pendingFiles;
  pendingFiles = [];
  return files;
}

export function resolveRmqExcelFile(idOrHref: string): RmqAiChatFile | null {
  const raw = String(idOrHref || '').trim();
  const id = raw.replace(/^rmq-excel:\/\//i, '').split(/[?#]/)[0];
  if (!id) return null;
  return fileRegistry.get(id) || null;
}

export function isRmqExcelHref(href: string): boolean {
  return /^rmq-excel:\/\//i.test(String(href || '').trim());
}

export function safeExcelFilename(name: string): string {
  const base = String(name || '')
    .replace(/\.xlsx$/i, '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return `${base || 'RMQ_export'}.xlsx`;
}

function safeSheetName(name: string, index: number): string {
  const cleaned = String(name || '')
    .replace(/[\\/?*[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 31);
  return cleaned || `Sheet${index + 1}`;
}

function clipCell(value: unknown): string | number {
  if (value == null) return '';
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text.length <= MAX_CELL ? text : `${text.slice(0, MAX_CELL)}…`;
}

function normalizeSheetRecords(
  columns: string[] | undefined,
  rows: unknown,
): { headers: string[]; records: Record<string, string | number>[] } {
  const list = Array.isArray(rows) ? rows.slice(0, MAX_ROWS) : [];
  if (!list.length) {
    const headers = (columns || ['Value']).slice(0, MAX_COLS);
    return { headers, records: [] };
  }

  if (list.every((row) => row && typeof row === 'object' && !Array.isArray(row))) {
    const objects = list as Record<string, unknown>[];
    const headers = (
      columns?.length ? columns : Array.from(new Set(objects.flatMap((row) => Object.keys(row))))
    ).slice(0, MAX_COLS);
    return {
      headers,
      records: objects.map((row) => {
        const record: Record<string, string | number> = {};
        for (const header of headers) record[header] = clipCell(row[header]);
        return record;
      }),
    };
  }

  const matrix = list.map((row) => (Array.isArray(row) ? row : [row]));
  const headers = (
    columns?.length ? columns : matrix[0]?.map((cell, index) => String(cell ?? `Column ${index + 1}`))
  )
    .map((header) => String(header || '').trim() || 'Column')
    .slice(0, MAX_COLS);
  const body = columns?.length ? matrix : matrix.slice(1);
  return {
    headers,
    records: body.map((row) => {
      const record: Record<string, string | number> = {};
      headers.forEach((header, index) => {
        record[header] = clipCell(row[index]);
      });
      return record;
    }),
  };
}

function autosizeSheet(ws: XLSX.WorkSheet, headers: string[], rowCount: number): void {
  ws['!cols'] = headers.map((header) => {
    const width = Math.min(42, Math.max(10, header.length + 2));
    return { wch: width };
  });
  if (rowCount >= 0) {
    ws['!autofilter'] = {
      ref: XLSX.utils.encode_range({
        s: { r: 0, c: 0 },
        e: { r: rowCount, c: Math.max(0, headers.length - 1) },
      }),
    };
  }
}

export function buildExcelWorkbook(sheets: ExcelSheetInput[]): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const usedNames = new Set<string>();
  const input = sheets.slice(0, MAX_SHEETS);
  const list = input.length ? input : [{ name: 'Sheet1', rows: [] }];

  list.forEach((sheet, index) => {
    const { headers, records } = normalizeSheetRecords(sheet.columns, sheet.rows);
    const ws = records.length
      ? XLSX.utils.json_to_sheet(records, { header: headers })
      : XLSX.utils.aoa_to_sheet([headers]);
    autosizeSheet(ws, headers, records.length);
    let name = safeSheetName(sheet.name || 'Sheet1', index);
    if (usedNames.has(name)) name = safeSheetName(`${name} ${index + 1}`, index);
    usedNames.add(name);
    XLSX.utils.book_append_sheet(wb, ws, name);
  });

  return wb;
}

export function workbookToExcelBlob(wb: XLSX.WorkBook): Blob {
  const bytes = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  return new Blob([bytes], { type: RMQ_EXCEL_MIME });
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${RMQ_EXCEL_MIME};base64,${btoa(binary)}`;
}

export async function createRmqExcelFile(
  sheets: ExcelSheetInput[],
  filename: string,
): Promise<RmqAiChatFile> {
  const wb = buildExcelWorkbook(sheets);
  const blob = workbookToExcelBlob(wb);
  const url = await blobToDataUrl(blob);
  const file: RmqAiChatFile = {
    id: crypto.randomUUID(),
    filename: safeExcelFilename(filename),
    url,
    mimeType: RMQ_EXCEL_MIME,
  };
  rememberRmqAiFile(file);
  return file;
}

export function triggerBrowserDownload(file: Pick<RmqAiChatFile, 'filename' | 'url'>): void {
  const link = document.createElement('a');
  link.href = file.url;
  link.download = file.filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}
