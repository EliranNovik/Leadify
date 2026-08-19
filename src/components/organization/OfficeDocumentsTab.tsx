import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  ChevronLeftIcon,
  DocumentTextIcon,
  EllipsisVerticalIcon,
  EyeIcon,
  FolderIcon,
  FolderPlusIcon,
  FunnelIcon,
  MagnifyingGlassIcon,
  PencilSquareIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';
import { DocumentFileGlyph } from '../../lib/documentFileGlyphs';
import {
  createOfficeDocumentFolder,
  createOfficeDocumentSignedUrl,
  deleteOfficeDocument,
  deleteOfficeDocumentFolder,
  fetchOfficeDocumentFolders,
  fetchOfficeDocuments,
  moveOfficeDocument,
  normalizeOfficeDocumentType,
  OFFICE_DOCUMENTS_BUCKET,
  renameOfficeDocument,
  renameOfficeDocumentFolder,
  uploadOfficeDocument,
  type OfficeDocument,
  type OfficeDocumentFolder,
} from '../../lib/officeDocuments';
import DocumentViewerModal, { type DocumentViewerItem } from '../DocumentViewerModal';

function formatUploadedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || Number.isNaN(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function uniqueDocumentTypes(files: OfficeDocument[]): string[] {
  const seen = new Set<string>();
  const types: string[] = [];
  for (const file of files) {
    const label = file.document_type?.trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    types.push(label);
  }
  return types.sort((a, b) => a.localeCompare(b));
}

function DocumentTypeCombobox({
  value,
  onChange,
  suggestions,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  suggestions: string[];
  placeholder: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const matches = useMemo(() => {
    const query = value.trim().toLowerCase();
    if (!query) return suggestions;
    return suggestions.filter((name) => name.toLowerCase().includes(query));
  }, [suggestions, value]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  return (
    <div ref={wrapRef} className="relative w-full">
      <input
        type="text"
        className="input input-bordered w-full h-10 min-h-10 rounded-full text-sm"
        placeholder={placeholder}
        value={value}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
      />
      {open && matches.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full max-h-48 overflow-y-auto rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
          {matches.map((name) => (
            <li key={name}>
              <button
                type="button"
                className="w-full text-left px-3.5 py-2 text-sm text-gray-800 hover:bg-gray-50"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(name);
                  setOpen(false);
                }}
              >
                {name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const OfficeDocumentsTab: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<OfficeDocument[]>([]);
  const [filesLoading, setFilesLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deletingFileId, setDeletingFileId] = useState<number | null>(null);
  const [selectedFile, setSelectedFile] = useState<OfficeDocument | null>(null);
  const [uploadDocumentType, setUploadDocumentType] = useState('');
  const [fileTypeFilter, setFileTypeFilter] = useState('all');
  const [fileSearch, setFileSearch] = useState('');
  const [pendingUploadFile, setPendingUploadFile] = useState<File | null>(null);
  const [renamingFile, setRenamingFile] = useState<OfficeDocument | null>(null);
  const [renameName, setRenameName] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);
  const [folders, setFolders] = useState<OfficeDocumentFolder[]>([]);
  const [foldersLoading, setFoldersLoading] = useState(true);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [folderModalOpen, setFolderModalOpen] = useState(false);
  const [folderModalMode, setFolderModalMode] = useState<'create' | 'edit'>('create');
  const [folderTitleDraft, setFolderTitleDraft] = useState('');
  const [folderSaving, setFolderSaving] = useState(false);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [folderMenuId, setFolderMenuId] = useState<string | null>(null);
  const [moveMenuFileId, setMoveMenuFileId] = useState<number | null>(null);
  const [dragFileId, setDragFileId] = useState<number | null>(null);
  const [dropTargetFolderId, setDropTargetFolderId] = useState<string | null>(null);

  const loadFiles = useCallback(async () => {
    setFilesLoading(true);
    try {
      setFiles(await fetchOfficeDocuments());
    } catch (error) {
      console.error('OfficeDocumentsTab files:', error);
      toast.error('Failed to load office documents');
    } finally {
      setFilesLoading(false);
    }
  }, []);

  const loadFolders = useCallback(async () => {
    setFoldersLoading(true);
    try {
      setFolders(await fetchOfficeDocumentFolders());
    } catch (error) {
      console.error('OfficeDocumentsTab folders:', error);
      toast.error('Failed to load folders');
    } finally {
      setFoldersLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  useEffect(() => {
    void loadFolders();
  }, [loadFolders]);

  useEffect(() => {
    if (!folderMenuId && moveMenuFileId == null) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-office-doc-menu]')) return;
      setFolderMenuId(null);
      setMoveMenuFileId(null);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [folderMenuId, moveMenuFileId]);

  const savedDocumentTypes = useMemo(() => uniqueDocumentTypes(files), [files]);
  const hasUntypedFiles = useMemo(
    () => files.some((file) => !file.document_type?.trim()),
    [files],
  );
  const activeFolder = useMemo(
    () => (activeFolderId ? folders.find((folder) => folder.id === activeFolderId) ?? null : null),
    [activeFolderId, folders],
  );

  useEffect(() => {
    if (activeFolderId && folders.length > 0 && !folders.some((folder) => folder.id === activeFolderId)) {
      setActiveFolderId(null);
    }
  }, [activeFolderId, folders]);

  const visibleFolders = useMemo(() => {
    if (activeFolderId) return [];
    const query = fileSearch.trim().toLowerCase();
    if (!query) return folders;
    return folders.filter((folder) => folder.title.toLowerCase().includes(query));
  }, [activeFolderId, folders, fileSearch]);

  const filteredFiles = useMemo(() => {
    const query = fileSearch.trim().toLowerCase();
    return files.filter((file) => {
      if (activeFolderId) {
        if (file.folder_id !== activeFolderId) return false;
      } else if (!query) {
        if (file.folder_id) return false;
      }
      if (fileTypeFilter === '__none__') {
        if (file.document_type?.trim()) return false;
      } else if (fileTypeFilter !== 'all') {
        if (file.document_type?.trim().toLowerCase() !== fileTypeFilter.toLowerCase()) return false;
      }
      if (query && !file.file_name.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [files, fileTypeFilter, fileSearch, activeFolderId]);

  const viewerDocuments = useMemo<DocumentViewerItem[]>(
    () =>
      files.map((file) => ({
        id: String(file.id),
        name: file.file_name,
        url: file.storage_path,
        fileType: file.mime_type || undefined,
        lastModified: file.created_at,
        storagePath: file.storage_path,
      })),
    [files],
  );

  const viewerIndex = selectedFile
    ? Math.max(0, files.findIndex((file) => file.id === selectedFile.id))
    : 0;

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setPendingUploadFile(file);
  };

  const handleCancelPendingUpload = () => {
    if (uploading) return;
    setPendingUploadFile(null);
  };

  const handleConfirmUpload = async () => {
    if (!pendingUploadFile) return;
    const documentType = normalizeOfficeDocumentType(uploadDocumentType);
    if (!documentType) {
      toast.error('Add a document type before uploading');
      return;
    }
    setUploading(true);
    try {
      const uploaded = await uploadOfficeDocument({
        file: pendingUploadFile,
        documentType,
        folderId: activeFolderId,
      });
      setFiles((prev) => [uploaded, ...prev]);
      setUploadDocumentType(documentType);
      setPendingUploadFile(null);
      toast.success('File uploaded');
    } catch (error: any) {
      console.error('OfficeDocumentsTab upload:', error);
      toast.error(error?.message || 'Failed to upload file');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteFile = async (file: OfficeDocument) => {
    if (!window.confirm(`Remove ${file.file_name}?`)) return;
    setDeletingFileId(file.id);
    try {
      await deleteOfficeDocument(file);
      setFiles((prev) => prev.filter((f) => f.id !== file.id));
      if (selectedFile?.id === file.id) setSelectedFile(null);
    } catch (error) {
      console.error('OfficeDocumentsTab delete file:', error);
      toast.error('Failed to remove file');
    } finally {
      setDeletingFileId(null);
    }
  };

  const handleDownloadFile = async (file: OfficeDocument) => {
    try {
      const url = await createOfficeDocumentSignedUrl(file.storage_path);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.file_name;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error: any) {
      console.error('OfficeDocumentsTab download:', error);
      toast.error(error?.message || 'Failed to download file');
    }
  };

  const applyUpdatedFile = (updated: OfficeDocument) => {
    setFiles((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
    setSelectedFile((current) => (current?.id === updated.id ? updated : current));
  };

  const handleOpenRename = (file: OfficeDocument) => {
    setRenamingFile(file);
    setRenameName(file.file_name);
  };

  const handleSaveRename = async () => {
    if (!renamingFile) return;
    if (!renameName.trim()) {
      toast.error('File name is required');
      return;
    }
    setIsRenaming(true);
    try {
      const updated = await renameOfficeDocument(renamingFile.id, renameName);
      applyUpdatedFile(updated);
      setRenamingFile(null);
      toast.success('File name updated');
    } catch (error: any) {
      console.error('OfficeDocumentsTab rename:', error);
      toast.error(error?.message || 'Failed to rename file');
    } finally {
      setIsRenaming(false);
    }
  };

  const handleMoveFile = async (file: OfficeDocument, folderId: string | null) => {
    if ((file.folder_id ?? null) === folderId) {
      setMoveMenuFileId(null);
      return;
    }
    try {
      const updated = await moveOfficeDocument(file.id, folderId);
      applyUpdatedFile(updated);
      setMoveMenuFileId(null);
      toast.success(folderId ? 'Moved to folder' : 'Moved to Unfiled');
    } catch (error: any) {
      console.error('OfficeDocumentsTab move:', error);
      toast.error(error?.message || 'Failed to move file');
    }
  };

  const openCreateFolderModal = () => {
    setFolderModalMode('create');
    setEditingFolderId(null);
    setFolderTitleDraft('');
    setFolderModalOpen(true);
    setFolderMenuId(null);
  };

  const openEditFolderModal = (folder: OfficeDocumentFolder) => {
    setFolderModalMode('edit');
    setEditingFolderId(folder.id);
    setFolderTitleDraft(folder.title);
    setFolderModalOpen(true);
    setFolderMenuId(null);
  };

  const handleSaveFolder = async () => {
    const title = folderTitleDraft.trim();
    if (!title) {
      toast.error('Folder title is required');
      return;
    }
    setFolderSaving(true);
    try {
      if (folderModalMode === 'create') {
        const created = await createOfficeDocumentFolder(title);
        setFolders((prev) => [...prev, created]);
        toast.success('Folder created');
      } else if (editingFolderId) {
        const updated = await renameOfficeDocumentFolder(editingFolderId, title);
        setFolders((prev) => prev.map((folder) => (folder.id === updated.id ? updated : folder)));
        toast.success('Folder renamed');
      }
      setFolderModalOpen(false);
    } catch (error: any) {
      console.error('OfficeDocumentsTab folder save:', error);
      toast.error(error?.message || 'Failed to save folder');
    } finally {
      setFolderSaving(false);
    }
  };

  const handleDeleteFolder = async (folder: OfficeDocumentFolder) => {
    if (!window.confirm(`Delete folder “${folder.title}”? Documents inside will move to Unfiled.`)) {
      return;
    }
    setFolderMenuId(null);
    try {
      await deleteOfficeDocumentFolder(folder.id);
      setFolders((prev) => prev.filter((item) => item.id !== folder.id));
      setFiles((prev) =>
        prev.map((file) => (file.folder_id === folder.id ? { ...file, folder_id: null } : file)),
      );
      if (activeFolderId === folder.id) setActiveFolderId(null);
      toast.success('Folder deleted');
    } catch (error: any) {
      console.error('OfficeDocumentsTab folder delete:', error);
      toast.error(error?.message || 'Failed to delete folder');
    }
  };

  return (
    <div className="rounded-[18px] bg-white p-6 md:p-8 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between mb-5">
        {activeFolder ? (
          <div className="flex min-w-0 items-center gap-2.5">
            <button
              type="button"
              className="btn btn-ghost btn-sm btn-square h-10 w-10 shrink-0"
              onClick={() => setActiveFolderId(null)}
              title="Back"
            >
              <ChevronLeftIcon className="h-6 w-6" />
            </button>
            <div className="flex h-11 w-11 md:h-12 md:w-12 items-center justify-center rounded-full bg-amber-50 text-amber-600 shrink-0">
              <FolderIcon className="w-7 h-7 md:w-8 md:h-8" />
            </div>
            <div className="min-w-0">
              <h2 className="text-xl md:text-2xl font-bold text-gray-800 truncate">{activeFolder.title}</h2>
              <p className="text-sm text-gray-500">Files in this folder</p>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm btn-square shrink-0"
              onClick={() => openEditFolderModal(activeFolder)}
              title="Rename folder"
            >
              <PencilSquareIcon className="h-5 w-5" />
            </button>
          </div>
        ) : (
          <div>
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 md:w-12 md:h-12 rounded-full bg-gray-50 border border-gray-100 shadow-sm flex items-center justify-center shrink-0">
                <DocumentTextIcon className="w-7 h-7 md:w-8 md:h-8 text-gray-800" />
              </div>
              <h2 className="text-xl md:text-2xl font-bold text-gray-800">Office documents</h2>
            </div>
            <p className="text-sm text-gray-500 mt-1.5 pl-14 md:pl-[3.75rem]">
              Company files such as lease agreements and vehicle leases. Superusers only.
            </p>
          </div>
        )}
        <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-end gap-2 sm:gap-3 w-full lg:w-auto">
          {(files.length > 0 || folders.length > 0) && (
            <>
              <label className="flex flex-col gap-1 min-w-[12rem] flex-1 sm:flex-none">
                <span className="text-xs font-medium text-gray-500 pl-1">Search by file name</span>
                <div className="relative">
                  <MagnifyingGlassIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    className="input input-bordered w-full sm:w-56 pl-9 h-10 min-h-10 rounded-full text-sm"
                    placeholder="Search files..."
                    value={fileSearch}
                    onChange={(e) => setFileSearch(e.target.value)}
                  />
                </div>
              </label>
              <label className="flex flex-col gap-1 min-w-[10rem]">
                <span className="text-xs font-medium text-gray-500 pl-1 inline-flex items-center gap-1">
                  <FunnelIcon className="w-3.5 h-3.5" />
                  Filter by type
                </span>
                <select
                  className="select select-bordered h-10 min-h-10 rounded-full text-sm w-full sm:w-48"
                  value={fileTypeFilter}
                  onChange={(e) => setFileTypeFilter(e.target.value)}
                >
                  <option value="all">All types</option>
                  {savedDocumentTypes.map((typeName) => (
                    <option key={typeName} value={typeName}>
                      {typeName}
                    </option>
                  ))}
                  {hasUntypedFiles && <option value="__none__">No type</option>}
                </select>
              </label>
            </>
          )}
          {!activeFolderId && (
            <button
              type="button"
              className="btn btn-ghost btn-sm rounded-full gap-1.5 h-10 min-h-10"
              onClick={openCreateFolderModal}
            >
              <FolderPlusIcon className="w-5 h-5" />
              New folder
            </button>
          )}
          <button
            type="button"
            className="btn btn-sm rounded-full gap-2 border-0 bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-emerald-600/50 h-10 min-h-10"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? <span className="loading loading-spinner loading-sm" /> : <ArrowUpTrayIcon className="w-4 h-4" />}
            Upload file
          </button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.doc,.docx,.xls,.xlsx,.txt,.csv,application/pdf,image/*"
            onChange={(e) => void handleFileChange(e)}
          />
        </div>
      </div>

      {filesLoading ? (
        <div className="flex justify-center py-14">
          <span className="loading loading-spinner loading-md text-primary" />
        </div>
      ) : files.length === 0 && folders.length === 0 ? (
        <div className="rounded-2xl bg-gray-50 py-12 text-center text-gray-400">
          <DocumentTextIcon className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>No office documents yet.</p>
          <p className="text-sm mt-1">Upload a lease, vehicle agreement, or create a folder.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {!activeFolderId && (
            <div className="space-y-2">
              {foldersLoading ? (
                <div className="flex items-center gap-2 py-2 text-xs text-gray-400">
                  <span className="loading loading-spinner loading-xs" />
                  Loading folders…
                </div>
              ) : null}
              {visibleFolders.map((folder) => {
                const count = files.filter((file) => file.folder_id === folder.id).length;
                const isDropTarget = dropTargetFolderId === folder.id;
                const menuOpen = folderMenuId === folder.id;
                return (
                  <div
                    key={folder.id}
                    className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 transition ${
                      isDropTarget ? 'bg-primary/5 ring-1 ring-primary/30' : 'bg-gray-50/60 hover:bg-gray-50'
                    }`}
                    onDragEnter={(e) => {
                      e.preventDefault();
                      if (dragFileId != null) setDropTargetFolderId(folder.id);
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      setDropTargetFolderId(folder.id);
                    }}
                    onDragLeave={() => {
                      setDropTargetFolderId((prev) => (prev === folder.id ? null : prev));
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDropTargetFolderId(null);
                      const raw = e.dataTransfer.getData('application/x-office-file') || String(dragFileId ?? '');
                      const fileId = Number(raw);
                      const file = files.find((item) => item.id === fileId);
                      if (file) void handleMoveFile(file, folder.id);
                      setDragFileId(null);
                    }}
                  >
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      onClick={() => {
                        setActiveFolderId(folder.id);
                        setFolderMenuId(null);
                        setMoveMenuFileId(null);
                      }}
                    >
                      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                        <FolderIcon className="h-7 w-7" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="truncate block text-base font-semibold text-gray-800">{folder.title}</span>
                        <span className="mt-0.5 block text-sm text-gray-500">
                          {formatUploadedAt(folder.created_at)}
                        </span>
                      </span>
                    </button>
                    <div className="relative flex shrink-0 items-center gap-2" data-office-doc-menu>
                      <span className="badge badge-sm tabular-nums border-0 bg-gray-600 font-medium text-white">
                        {count}
                      </span>
                      <button
                        type="button"
                        className={`inline-flex h-10 w-10 items-center justify-center rounded-full transition-colors ${
                          menuOpen
                            ? 'bg-gray-900 text-white shadow-sm'
                            : 'text-gray-500 hover:bg-white hover:text-gray-800'
                        }`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setMoveMenuFileId(null);
                          setFolderMenuId((prev) => (prev === folder.id ? null : folder.id));
                        }}
                        title="Folder options"
                      >
                        <EllipsisVerticalIcon className="h-5 w-5" />
                      </button>
                      {menuOpen ? (
                        <div
                          role="menu"
                          className="absolute right-0 top-full z-30 mt-2 w-44 overflow-hidden rounded-2xl border border-gray-200/80 bg-white p-1.5 shadow-lg"
                        >
                          <button
                            type="button"
                            className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm font-medium text-gray-700 hover:bg-gray-100"
                            onClick={() => openEditFolderModal(folder)}
                          >
                            <PencilSquareIcon className="h-4 w-4 shrink-0 text-gray-400" />
                            Rename
                          </button>
                          <button
                            type="button"
                            className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm font-medium text-red-600 hover:bg-red-50"
                            onClick={() => void handleDeleteFolder(folder)}
                          >
                            <TrashIcon className="h-4 w-4 shrink-0" />
                            Delete
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {filteredFiles.length === 0 ? (
            <div className="rounded-2xl bg-gray-50 py-12 text-center text-gray-400">
              <DocumentTextIcon className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>
                {fileSearch.trim() || fileTypeFilter !== 'all'
                  ? 'No files match this search.'
                  : activeFolder
                    ? 'This folder is empty.'
                    : folders.length > 0
                      ? 'No unfiled files. Open a folder or upload a document.'
                      : 'No office documents yet.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table w-full text-base">
                <thead>
                  <tr className="text-sm uppercase tracking-wider text-gray-500">
                    <th className="bg-transparent font-semibold min-w-[16rem]">File</th>
                    <th className="bg-transparent font-semibold w-40">Type</th>
                    <th className="bg-transparent font-semibold w-40">Uploaded</th>
                    <th className="bg-transparent font-semibold text-right w-44">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredFiles.map((file) => (
                    <tr
                      key={file.id}
                      className={`hover:bg-base-200 ${dragFileId === file.id ? 'opacity-60' : ''}`}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('application/x-office-file', String(file.id));
                        e.dataTransfer.effectAllowed = 'move';
                        setDragFileId(file.id);
                        setMoveMenuFileId(null);
                      }}
                      onDragEnd={() => {
                        setDragFileId(null);
                        setDropTargetFolderId(null);
                      }}
                    >
                      <td className="font-medium text-gray-900">
                        <div className="flex items-center gap-3 min-w-0">
                          <DocumentFileGlyph
                            fileName={file.file_name}
                            fileType={file.mime_type || ''}
                            className="h-9 w-9 shrink-0"
                          />
                          <div className="min-w-0 flex-1">
                            <span className="block break-words" title={file.file_name}>
                              {file.file_name}
                            </span>
                            {file.size_bytes != null && (
                              <span className="text-xs text-gray-400">{formatBytes(file.size_bytes)}</span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="text-sm text-gray-700">{file.document_type?.trim() || '—'}</td>
                      <td className="text-gray-600 whitespace-nowrap text-sm">
                        {formatUploadedAt(file.created_at)}
                      </td>
                      <td className="text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1" data-office-doc-menu>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm btn-circle"
                            title="View"
                            onClick={() => setSelectedFile(file)}
                          >
                            <EyeIcon className="w-5 h-5" />
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm btn-circle"
                            title="Edit file name"
                            onClick={() => handleOpenRename(file)}
                          >
                            <PencilSquareIcon className="w-5 h-5" />
                          </button>
                          {(folders.length > 0 || file.folder_id) && (
                            <div className="relative">
                              <button
                                type="button"
                                className={`btn btn-ghost btn-sm btn-circle ${
                                  moveMenuFileId === file.id ? 'bg-gray-900 text-white' : ''
                                }`}
                                title="Move to folder"
                                onClick={() =>
                                  setMoveMenuFileId((prev) => (prev === file.id ? null : file.id))
                                }
                              >
                                <FolderIcon className="w-5 h-5" />
                              </button>
                              {moveMenuFileId === file.id && (
                                <div
                                  role="menu"
                                  className="absolute right-0 top-full z-30 mt-2 w-52 overflow-hidden rounded-2xl border border-gray-200/80 bg-white py-1 shadow-lg"
                                >
                                  <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                                    Move to
                                  </div>
                                  {file.folder_id ? (
                                    <button
                                      type="button"
                                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50"
                                      onClick={() => void handleMoveFile(file, null)}
                                    >
                                      <DocumentTextIcon className="h-4 w-4 text-gray-400" />
                                      Unfiled
                                    </button>
                                  ) : null}
                                  {folders
                                    .filter((folder) => folder.id !== (file.folder_id ?? null))
                                    .map((folder) => (
                                      <button
                                        key={folder.id}
                                        type="button"
                                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50"
                                        onClick={() => void handleMoveFile(file, folder.id)}
                                      >
                                        <FolderIcon className="h-4 w-4 shrink-0 text-amber-500" />
                                        <span className="min-w-0 truncate">{folder.title}</span>
                                      </button>
                                    ))}
                                </div>
                              )}
                            </div>
                          )}
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm btn-circle"
                            title="Download"
                            onClick={() => void handleDownloadFile(file)}
                          >
                            <ArrowDownTrayIcon className="w-5 h-5" />
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm btn-circle text-error"
                            title="Remove"
                            disabled={deletingFileId === file.id}
                            onClick={() => void handleDeleteFile(file)}
                          >
                            {deletingFileId === file.id ? (
                              <span className="loading loading-spinner loading-xs" />
                            ) : (
                              <TrashIcon className="w-5 h-5" />
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {pendingUploadFile && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div
            className="fixed inset-0 bg-black bg-opacity-50"
            onClick={handleCancelPendingUpload}
          />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6">
            <h3 className="text-lg font-semibold mb-1">Upload file</h3>
            <p className="text-sm text-gray-500 mb-4 break-words">{pendingUploadFile.name}</p>
            <label className="flex flex-col gap-1.5 mb-5">
              <span className="text-sm font-medium text-gray-700">Document type</span>
              <DocumentTypeCombobox
                value={uploadDocumentType}
                onChange={setUploadDocumentType}
                suggestions={savedDocumentTypes}
                placeholder="Type a name or pick a saved one"
              />
              <span className="text-xs text-gray-400">Required. Saved types appear below as you type.</span>
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={handleCancelPendingUpload}
                disabled={uploading}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleConfirmUpload()}
                disabled={uploading || !uploadDocumentType.trim()}
              >
                {uploading ? (
                  <>
                    <span className="loading loading-spinner loading-sm" />
                    Uploading...
                  </>
                ) : (
                  'Upload'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {folderModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div
            className="fixed inset-0 bg-black bg-opacity-50"
            onClick={() => {
              if (!folderSaving) setFolderModalOpen(false);
            }}
          />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6">
            <h3 className="text-lg font-semibold mb-4">
              {folderModalMode === 'create' ? 'New folder' : 'Rename folder'}
            </h3>
            <input
              type="text"
              className="input input-bordered w-full mb-4"
              placeholder="Folder name"
              value={folderTitleDraft}
              onChange={(e) => setFolderTitleDraft(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleSaveFolder();
                }
              }}
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setFolderModalOpen(false)}
                disabled={folderSaving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleSaveFolder()}
                disabled={folderSaving || !folderTitleDraft.trim()}
              >
                {folderSaving ? (
                  <>
                    <span className="loading loading-spinner loading-sm" />
                    Saving...
                  </>
                ) : folderModalMode === 'create' ? (
                  'Create'
                ) : (
                  'Save'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {renamingFile && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div
            className="fixed inset-0 bg-black bg-opacity-50"
            onClick={() => {
              if (!isRenaming) setRenamingFile(null);
            }}
          />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6">
            <h3 className="text-lg font-semibold mb-4">Edit file name</h3>
            <input
              type="text"
              className="input input-bordered w-full mb-4"
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleSaveRename();
                }
              }}
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setRenamingFile(null)}
                disabled={isRenaming}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleSaveRename()}
                disabled={isRenaming || !renameName.trim()}
              >
                {isRenaming ? (
                  <>
                    <span className="loading loading-spinner loading-sm" />
                    Saving...
                  </>
                ) : (
                  'Save'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedFile && (
        <DocumentViewerModal
          isOpen
          onClose={() => setSelectedFile(null)}
          documents={viewerDocuments}
          initialIndex={viewerIndex}
          bucketName={OFFICE_DOCUMENTS_BUCKET}
          onRename={async (doc, newName) => {
            const id = Number(doc.id);
            if (!Number.isFinite(id)) return;
            const updated = await renameOfficeDocument(id, newName);
            applyUpdatedFile(updated);
          }}
        />
      )}
    </div>
  );
};

export default OfficeDocumentsTab;
