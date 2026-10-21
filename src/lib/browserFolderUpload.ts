/**
 * Reading dropped or browsed folders in the browser.
 *
 * Two different APIs are needed. A folder picked through an input needs `webkitdirectory`, after
 * which every File carries `webkitRelativePath`. A dropped folder is invisible to
 * `dataTransfer.files`, so the drop has to go through `dataTransfer.items` and
 * `webkitGetAsEntry()` instead.
 *
 * No Supabase or DOM globals here on purpose: the entry shapes are declared structurally so the
 * walk can be unit tested.
 */

/** One file plus the folder names above it, outermost first. */
export type FolderUploadEntry = {
  file: File;
  segments: string[];
};

/** Minimal shape of a FileSystemEntry, enough for the recursive walk. */
export type FileSystemEntryLike = {
  name: string;
  isFile?: boolean;
  isDirectory?: boolean;
  file?: (onFile: (file: File) => void, onError?: (error: unknown) => void) => void;
  createReader?: () => {
    readEntries: (
      onEntries: (entries: FileSystemEntryLike[]) => void,
      onError?: (error: unknown) => void,
    ) => void;
  };
};

/** What a drop handler must capture before it yields to the event loop. */
export type DroppedItem = {
  entry: FileSystemEntryLike | null;
  file: File | null;
};

export const MAX_FOLDER_UPLOAD_FILES = 300;
export const MAX_FOLDER_UPLOAD_DEPTH = 10;

const IGNORED_NAMES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini', '.localized']);
const IGNORED_FOLDERS = new Set(['__macosx', '.git', 'node_modules']);

export function isIgnoredUploadName(name: string): boolean {
  const lower = name.trim().toLowerCase();
  if (!lower) return true;
  if (IGNORED_NAMES.has(lower)) return true;
  // AppleDouble sidecars that macOS writes next to the real file.
  return lower.startsWith('._');
}

export function isIgnoredUploadFolder(name: string): boolean {
  return IGNORED_FOLDERS.has(name.trim().toLowerCase());
}

/**
 * Grabs the entries out of a drop event. MUST be called before the first `await` in the drop
 * handler: the browser empties `DataTransfer` as soon as the handler yields.
 */
export function readDroppedItems(dataTransfer: {
  items?: ArrayLike<DataTransferItem> | null;
  files?: ArrayLike<File> | null;
}): DroppedItem[] {
  const items = dataTransfer.items ? Array.from(dataTransfer.items) : [];
  if (items.length > 0) {
    return items.map((item) => {
      const anyItem = item as DataTransferItem & {
        webkitGetAsEntry?: () => FileSystemEntryLike | null;
      };
      return {
        entry: typeof anyItem.webkitGetAsEntry === 'function' ? anyItem.webkitGetAsEntry() : null,
        file: typeof item.getAsFile === 'function' ? item.getAsFile() : null,
      };
    });
  }
  // Older browsers, and drops that carry plain files only.
  const files = dataTransfer.files ? Array.from(dataTransfer.files) : [];
  return files.map((file) => ({ entry: null, file }));
}

function entryFile(entry: FileSystemEntryLike): Promise<File | null> {
  return new Promise((resolve) => {
    if (typeof entry.file !== 'function') {
      resolve(null);
      return;
    }
    entry.file(
      (file) => resolve(file),
      () => resolve(null),
    );
  });
}

/** readEntries hands back at most ~100 children per call, so it is called until it returns none. */
function readAllChildren(entry: FileSystemEntryLike): Promise<FileSystemEntryLike[]> {
  return new Promise((resolve) => {
    if (typeof entry.createReader !== 'function') {
      resolve([]);
      return;
    }
    const reader = entry.createReader();
    const all: FileSystemEntryLike[] = [];

    const readBatch = () => {
      reader.readEntries(
        (batch) => {
          if (!batch || batch.length === 0) {
            resolve(all);
            return;
          }
          all.push(...batch);
          readBatch();
        },
        () => resolve(all),
      );
    };

    readBatch();
  });
}

/**
 * Walks dropped entries into a flat list of files, each carrying the folder names above it.
 * Stops once `MAX_FOLDER_UPLOAD_FILES` files have been collected.
 */
export async function expandDroppedItems(items: DroppedItem[]): Promise<FolderUploadEntry[]> {
  const collected: FolderUploadEntry[] = [];

  const walk = async (entry: FileSystemEntryLike, segments: string[]): Promise<void> => {
    if (collected.length >= MAX_FOLDER_UPLOAD_FILES) return;

    if (entry.isDirectory) {
      if (isIgnoredUploadFolder(entry.name)) return;
      if (segments.length >= MAX_FOLDER_UPLOAD_DEPTH) return;
      const children = await readAllChildren(entry);
      for (const child of children) {
        await walk(child, [...segments, entry.name]);
      }
      return;
    }

    if (!entry.isFile) return;
    if (isIgnoredUploadName(entry.name)) return;
    const file = await entryFile(entry);
    if (file) collected.push({ file, segments });
  };

  for (const item of items) {
    if (collected.length >= MAX_FOLDER_UPLOAD_FILES) break;

    if (item.entry) {
      await walk(item.entry, []);
      continue;
    }
    if (item.file && !isIgnoredUploadName(item.file.name)) {
      collected.push({ file: item.file, segments: [] });
    }
  }

  return collected;
}

/**
 * Files from an input carrying `webkitdirectory`. The last part of `webkitRelativePath` is the
 * file itself, so only the parts before it are folders.
 */
export function entriesFromDirectoryInput(files: ArrayLike<File>): FolderUploadEntry[] {
  return Array.from(files)
    .filter((file) => !isIgnoredUploadName(file.name))
    .map((file) => {
      const relative = String(
        (file as File & { webkitRelativePath?: string }).webkitRelativePath || '',
      );
      const parts = relative.split('/').filter(Boolean);
      const segments = parts.slice(0, -1);
      return { file, segments };
    })
    .filter((entry) => !entry.segments.some(isIgnoredUploadFolder));
}

export type FolderUploadPlan = {
  entries: FolderUploadEntry[];
  /** Distinct folder paths to create, parents before children. */
  folderPaths: string[][];
  /** How many files were left out because the batch hit the cap. */
  droppedForLimit: number;
};

/**
 * Normalises what the browser gave us into something the uploader can act on: folder names are
 * trimmed, depth is capped, and anything past the file cap is reported rather than silently lost.
 */
export function planFolderUpload(entries: FolderUploadEntry[]): FolderUploadPlan {
  const kept: FolderUploadEntry[] = [];
  let droppedForLimit = 0;

  for (const entry of entries) {
    if (kept.length >= MAX_FOLDER_UPLOAD_FILES) {
      droppedForLimit += 1;
      continue;
    }
    const segments = entry.segments
      .map((segment) => segment.replace(/[/\\]+/g, ' ').replace(/\s+/g, ' ').trim())
      .filter((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
      .slice(0, MAX_FOLDER_UPLOAD_DEPTH);
    kept.push({ file: entry.file, segments });
  }

  const seen = new Set<string>();
  const folderPaths: string[][] = [];
  for (const entry of kept) {
    for (let depth = 1; depth <= entry.segments.length; depth += 1) {
      const prefix = entry.segments.slice(0, depth);
      const key = prefix.join('/').toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      folderPaths.push(prefix);
    }
  }
  folderPaths.sort((a, b) => a.length - b.length);

  return { entries: kept, folderPaths, droppedForLimit };
}

/** True when a drop or pick contained at least one folder. */
export function planHasFolders(plan: FolderUploadPlan): boolean {
  return plan.folderPaths.length > 0;
}
