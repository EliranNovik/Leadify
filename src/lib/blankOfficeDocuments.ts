/**
 * Blank Word and Excel files, made in the browser.
 *
 * Creating a document in the drive means putting a real, valid, empty file into storage first;
 * everything after that — opening the editor, saving back — is the same path an uploaded document
 * takes. The heavy writers are imported only when someone actually creates something.
 */

export type BlankOfficeKind = 'word' | 'excel';

type BlankOfficeSpec = {
  extension: 'docx' | 'xlsx';
  mimeType: string;
  /** What the editor is called, for buttons and messages. */
  appName: string;
  defaultName: string;
};

const SPECS: Record<BlankOfficeKind, BlankOfficeSpec> = {
  word: {
    extension: 'docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    appName: 'Word',
    defaultName: 'New document',
  },
  excel: {
    extension: 'xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    appName: 'Excel',
    defaultName: 'New spreadsheet',
  },
};

export function blankOfficeSpec(kind: BlankOfficeKind): BlankOfficeSpec {
  return SPECS[kind];
}

/**
 * The name to store the file under: the right extension, and nothing in it that a storage path
 * or OneDrive would reject.
 */
export function blankOfficeFileName(kind: BlankOfficeKind, requested: string): string {
  const spec = SPECS[kind];
  const cleaned = String(requested || '')
    .replace(/[\\/:*?"<>|#%]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  // Typing the extension as well should not end up doubling it. Taken off before the leading
  // dots, so a name of nothing but an extension falls back rather than becoming "xlsx.xlsx".
  const base = cleaned
    .replace(new RegExp(`\\.${spec.extension}$`, 'i'), '')
    .replace(/^\.+/, '')
    .trim();
  return `${base || spec.defaultName}.${spec.extension}`;
}

async function blankWordBlob(): Promise<Blob> {
  const { Document, Packer, Paragraph } = await import('docx');
  // One empty paragraph: a document with no body at all is what Word calls corrupt.
  const document = new Document({ sections: [{ children: [new Paragraph('')] }] });
  return Packer.toBlob(document);
}

async function blankExcelBlob(): Promise<Blob> {
  const XLSX = await import('xlsx-js-style');
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['']]), 'Sheet1');
  const bytes = XLSX.write(book, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  return new Blob([bytes], { type: SPECS.excel.mimeType });
}

/** An empty document ready to be uploaded like any other file. */
export async function createBlankOfficeFile(
  kind: BlankOfficeKind,
  fileName: string,
): Promise<File> {
  const spec = SPECS[kind];
  const blob = kind === 'word' ? await blankWordBlob() : await blankExcelBlob();
  return new File([blob], blankOfficeFileName(kind, fileName), { type: spec.mimeType });
}
