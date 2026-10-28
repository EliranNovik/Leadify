import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronRightIcon,
  FolderIcon,
  FolderPlusIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import {
  childFolders,
  createDocumentFolder,
  deleteDocumentFolder,
  folderTrail,
  listDocumentFolders,
  moveCaseDocumentsToFolder,
  renameDocumentFolder,
  type DocumentFolder,
  type DocumentFolderScope,
} from '../lib/documentFolders';
import { fetchStageActorInfo } from '../lib/leadStageManager';

/**
 * The folder view of the documents drive and the case documents drawer, for the modals that show
 * the same files.
 *
 * One nested tree per lead and category (`public.document_folders`), which a file joins through
 * `lead_case_documents.folder_id` — storage paths are untouched. Every screen reading the same
 * scope therefore shows the same folders, so a folder made in the drive is the folder a sub-effort
 * files into.
 *
 * `'__root__'` is the drop target standing for the top of the category, which has no folder row of
 * its own.
 */

export const FOLDER_DROP_ROOT = '__root__';

export type FolderDropTarget = string | typeof FOLDER_DROP_ROOT | null;

export type DocumentFolderTree = {
  folders: DocumentFolder[];
  /** False while the scope is unknown, or when `document_folders` is not installed. */
  ready: boolean;
  loading: boolean;
  busy: boolean;
  activeFolderId: string | null;
  setActiveFolderId: (folderId: string | null) => void;
  /** Root-first chain down to the open folder, for the breadcrumb. */
  trail: DocumentFolder[];
  /** The folders shown at the level now open. */
  visibleFolders: DocumentFolder[];
  /** A folder id, or null when it belongs to a tree this screen is not showing. */
  folderIdOf: (folderId: string | null | undefined) => string | null;
  reload: () => Promise<DocumentFolder[]>;
  createFolder: (title: string) => Promise<boolean>;
  renameFolder: (folder: DocumentFolder, title: string) => Promise<boolean>;
  /** Asks first, naming how many files move back to the top. */
  deleteFolder: (folder: DocumentFolder, filesInside: number) => Promise<boolean>;
  /** Files a case document, by its `lead_case_documents` id. */
  moveDocuments: (caseDocumentIds: string[], folderId: string | null) => Promise<boolean>;
};

function isMissingFolderTable(error: { code?: string } | null | undefined): boolean {
  const code = String(error?.code || '');
  return code === '42P01' || code === '42703' || code === 'PGRST205';
}

/**
 * Loads a scope's folders and holds where in them the screen is.
 *
 * Pass `scope: null` while the lead or category is still being resolved: the tree then reports
 * itself not ready and the folder UI stays hidden rather than flashing an empty root.
 */
export function useDocumentFolderTree(
  scope: DocumentFolderScope | null,
  options?: { enabled?: boolean },
): DocumentFolderTree {
  const enabled = options?.enabled !== false;
  const [folders, setFolders] = useState<DocumentFolder[]>([]);
  const [available, setAvailable] = useState(true);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);

  // The scope is rebuilt on every render by its callers, so its contents decide when to reload.
  const scopeSignature = scope
    ? [scope.scopeType, scope.scopeKey, scope.classificationId ?? '', scope.area ?? ''].join('|')
    : '';

  const reload = useCallback(async (): Promise<DocumentFolder[]> => {
    if (!scope || !enabled) {
      setFolders([]);
      return [];
    }
    setLoading(true);
    try {
      const rows = await listDocumentFolders(scope);
      setFolders(rows);
      return rows;
    } catch (error: any) {
      if (isMissingFolderTable(error)) {
        console.warn('document_folders is not installed yet; folders are hidden.');
        setAvailable(false);
      } else {
        console.warn('document_folders fetch:', error?.message || error);
      }
      setFolders([]);
      return [];
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeSignature, enabled]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** Another lead or category is another tree, so the way into it starts at the top. */
  useEffect(() => {
    setActiveFolderId(null);
  }, [scopeSignature]);

  const ready = Boolean(scope) && enabled && available;

  const trail = useMemo(() => folderTrail(folders, activeFolderId), [folders, activeFolderId]);

  const visibleFolders = useMemo(
    () => (ready ? childFolders(folders, activeFolderId) : []),
    [ready, folders, activeFolderId],
  );

  /** The folder the open one was deleted from, so the screen is never left inside nothing. */
  useEffect(() => {
    if (!activeFolderId || folders.length === 0) return;
    if (!folders.some((folder) => folder.id === activeFolderId)) setActiveFolderId(null);
  }, [activeFolderId, folders]);

  const knownIds = useMemo(() => new Set(folders.map((folder) => folder.id)), [folders]);

  const folderIdOf = useCallback(
    (folderId: string | null | undefined): string | null => {
      const id = folderId ?? null;
      return id && knownIds.has(id) ? id : null;
    },
    [knownIds],
  );

  const createFolder = useCallback(
    async (title: string): Promise<boolean> => {
      if (!scope) return false;
      setBusy(true);
      try {
        const actor = await fetchStageActorInfo();
        await createDocumentFolder({
          scope,
          title,
          parentId: activeFolderId,
          createdBy: actor.fullName,
          createdByEmployeeId: actor.employeeId ?? null,
        });
        await reload();
        return true;
      } catch (error: any) {
        toast.error(
          error?.code === '23505'
            ? 'A folder with that name is already here'
            : String(error?.message || 'Could not create the folder'),
        );
        return false;
      } finally {
        setBusy(false);
      }
    },
    [scope, activeFolderId, reload],
  );

  const renameFolder = useCallback(
    async (folder: DocumentFolder, title: string): Promise<boolean> => {
      setBusy(true);
      try {
        await renameDocumentFolder(folder.id, title);
        await reload();
        return true;
      } catch (error: any) {
        toast.error(
          error?.code === '23505'
            ? 'A folder with that name is already here'
            : String(error?.message || 'Could not rename the folder'),
        );
        return false;
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  const deleteFolder = useCallback(
    async (folder: DocumentFolder, filesInside: number): Promise<boolean> => {
      const message = filesInside
        ? `Delete "${folder.title}"? The ${filesInside} file${filesInside === 1 ? '' : 's'} inside move back to the top.`
        : `Delete "${folder.title}"?`;
      if (!window.confirm(message)) return false;
      setBusy(true);
      try {
        await deleteDocumentFolder(folder.id);
        if (activeFolderId === folder.id) setActiveFolderId(folder.parent_id ?? null);
        await reload();
        toast.success('Folder deleted');
        return true;
      } catch (error: any) {
        toast.error(String(error?.message || 'Could not delete the folder'));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [activeFolderId, reload],
  );

  const moveDocuments = useCallback(
    async (caseDocumentIds: string[], folderId: string | null): Promise<boolean> => {
      const ids = caseDocumentIds.filter(Boolean);
      if (ids.length === 0) return false;
      try {
        await moveCaseDocumentsToFolder(ids, folderId);
        return true;
      } catch (error: any) {
        toast.error(String(error?.message || 'Could not move the file'));
        return false;
      }
    },
    [],
  );

  return {
    folders,
    ready,
    loading,
    busy,
    activeFolderId,
    setActiveFolderId,
    trail,
    visibleFolders,
    folderIdOf,
    reload,
    createFolder,
    renameFolder,
    deleteFolder,
    moveDocuments,
  };
}

/**
 * How many files each folder holds, counting everything in the folders below it: a folder row
 * saying "empty" while a folder inside it is full would read as a mistake.
 */
export function countDocumentsByFolder(
  folders: DocumentFolder[],
  documentFolderIds: Array<string | null>,
): Map<string, number> {
  const counts = new Map<string, number>();
  const parentOf = new Map(folders.map((folder) => [folder.id, folder.parent_id ?? null]));
  for (const id of documentFolderIds) {
    let cursor = id;
    let guard = 0;
    while (cursor && guard < 32) {
      counts.set(cursor, (counts.get(cursor) || 0) + 1);
      cursor = parentOf.get(cursor) ?? null;
      guard += 1;
    }
  }
  return counts;
}

/** Where in the tree the screen is, and the way back up. Dropping a file on a crumb unfiles it. */
export function DocumentFolderBreadcrumb({
  tree,
  onCreateFolder,
  dropTarget,
  onDropTargetChange,
  onDropToRoot,
  dragging,
  rootLabel = 'All files',
}: {
  tree: DocumentFolderTree;
  onCreateFolder?: () => void;
  dropTarget?: FolderDropTarget;
  onDropTargetChange?: (target: FolderDropTarget) => void;
  onDropToRoot?: () => void;
  /** True while a file is being dragged, which is what makes the crumbs drop targets. */
  dragging?: boolean;
  rootLabel?: string;
}) {
  if (!tree.ready) return null;
  const rootIsTarget = dropTarget === FOLDER_DROP_ROOT;
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
      <nav className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-sm" aria-label="Folder path">
        <button
          type="button"
          className={`inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium transition-colors ${
            tree.activeFolderId ? 'text-base-content/70 hover:bg-base-200/70' : 'text-base-content'
          } ${rootIsTarget ? 'bg-primary/10 text-primary' : ''}`}
          onClick={() => tree.setActiveFolderId(null)}
          onDragOver={(event) => {
            if (!dragging) return;
            event.preventDefault();
            onDropTargetChange?.(FOLDER_DROP_ROOT);
          }}
          onDragLeave={() => onDropTargetChange?.(null)}
          onDrop={(event) => {
            if (!dragging) return;
            event.preventDefault();
            onDropTargetChange?.(null);
            onDropToRoot?.();
          }}
        >
          <FolderIcon className="h-4 w-4 shrink-0" aria-hidden />
          {rootLabel}
        </button>
        {tree.trail.map((folder, index) => (
          <span key={folder.id} className="inline-flex min-w-0 items-center gap-1">
            <ChevronRightIcon className="h-3.5 w-3.5 shrink-0 text-base-content/40" aria-hidden />
            <button
              type="button"
              className={`max-w-[10rem] truncate rounded-md px-2 py-1 font-medium transition-colors ${
                index === tree.trail.length - 1
                  ? 'text-base-content'
                  : 'text-base-content/70 hover:bg-base-200/70'
              }`}
              onClick={() => tree.setActiveFolderId(folder.id)}
            >
              {folder.title}
            </button>
          </span>
        ))}
      </nav>
      {onCreateFolder ? (
        <button
          type="button"
          className="btn btn-ghost btn-sm h-auto min-h-0 gap-1 border-0 bg-transparent px-2 py-1 font-medium text-primary shadow-none hover:bg-primary/10"
          onClick={onCreateFolder}
          disabled={tree.busy}
          title="Create a folder here"
        >
          <FolderPlusIcon className="h-5 w-5 shrink-0" aria-hidden />
          New folder
        </button>
      ) : null}
    </div>
  );
}

export type FolderDialogState = { mode: 'create' | 'rename'; folder: DocumentFolder | null } | null;

/** Naming a new folder, or renaming one. Kept here so both modals ask for it the same way. */
export function DocumentFolderDialog({
  state,
  tree,
  onClose,
  onSaved,
}: {
  state: FolderDialogState;
  tree: DocumentFolderTree;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [name, setName] = useState('');

  useEffect(() => {
    setName(state?.mode === 'rename' ? state.folder?.title ?? '' : '');
  }, [state]);

  if (!state) return null;

  const save = async () => {
    const title = name.trim();
    if (!title) {
      toast.error('Folder name is required');
      return;
    }
    const done =
      state.mode === 'create'
        ? await tree.createFolder(title)
        : state.folder
          ? await tree.renameFolder(state.folder, title)
          : false;
    if (!done) return;
    onSaved?.();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={() => (tree.busy ? undefined : onClose())} />
      <div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h3 className="mb-1 text-lg font-semibold">
          {state.mode === 'create' ? 'New folder' : 'Rename folder'}
        </h3>
        <p className="mb-4 text-sm text-base-content/60">
          {state.mode === 'create'
            ? tree.trail.length > 0
              ? `Inside ${tree.trail.map((folder) => folder.title).join(' / ')}`
              : 'At the top of this category'
            : 'Files inside keep their place.'}
        </p>
        <input
          type="text"
          className="input input-bordered w-full"
          placeholder="Folder name"
          value={name}
          autoFocus
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void save();
            }
          }}
        />
        <div className="mt-5 flex items-center justify-end gap-2">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={tree.busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm gap-2"
            onClick={() => void save()}
            disabled={tree.busy || !name.trim()}
          >
            {tree.busy ? <span className="loading loading-spinner loading-xs" /> : null}
            {state.mode === 'create' ? 'Create' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
