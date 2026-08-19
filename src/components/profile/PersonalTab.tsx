import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  ChatBubbleLeftRightIcon,
  ChevronLeftIcon,
  DocumentTextIcon,
  EllipsisVerticalIcon,
  EyeIcon,
  FolderIcon,
  FolderPlusIcon,
  FunnelIcon,
  MagnifyingGlassIcon,
  PencilSquareIcon,
  PlusIcon,
  StarIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { StarIcon as StarIconSolid } from '@heroicons/react/24/solid';
import { toast } from 'react-hot-toast';
import { DocumentFileGlyph } from '../../lib/documentFileGlyphs';
import {
  createEmployeePersonalFileSignedUrl,
  createEmployeePersonalFolder,
  createEmployeePersonalNote,
  deleteEmployeePersonalFile,
  deleteEmployeePersonalFolder,
  deleteEmployeePersonalNote,
  EMPLOYEE_PERSONAL_FILES_BUCKET,
  fetchEmployeePersonalFiles,
  fetchEmployeePersonalFolders,
  fetchEmployeePersonalNotes,
  moveEmployeePersonalFile,
  normalizePersonalDocumentType,
  renameEmployeePersonalFile,
  renameEmployeePersonalFolder,
  updateEmployeePersonalNote,
  uploadEmployeePersonalFile,
  type EmployeePersonalFile,
  type EmployeePersonalFolder,
  type EmployeePersonalNote,
} from '../../lib/employeePersonalSpace';
import {
  fetchUserHighlightLeads,
  getCurrentUserId,
  removeHighlightById,
  saveHighlightComment,
  type HighlightLead,
} from '../../lib/highlightsUtils';
import { getStageColour, getStageName } from '../../lib/stageUtils';
import DocumentViewerModal, { type DocumentViewerItem } from '../DocumentViewerModal';

interface PersonalTabProps {
  employeeId: number;
}

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

function leadCategoryLabel(lead: HighlightLead): string {
  if (typeof lead.category === 'string' && lead.category.includes('(')) {
    return lead.category;
  }
  if (lead.misc_category) {
    const categoryObj = Array.isArray(lead.misc_category) ? lead.misc_category[0] : lead.misc_category;
    const categoryName = (categoryObj as { name?: string })?.name;
    const mainCategory = (categoryObj as { misc_maincategory?: { name?: string } | Array<{ name?: string }> })
      ?.misc_maincategory;
    const mainName = Array.isArray(mainCategory) ? mainCategory[0]?.name : mainCategory?.name;
    if (categoryName) {
      return mainName ? `${categoryName} (${mainName})` : categoryName;
    }
  }
  return lead.category || '—';
}

function uniqueDocumentTypes(files: EmployeePersonalFile[]): string[] {
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

function SectionTitle({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 md:w-12 md:h-12 rounded-full bg-gray-50 border border-gray-100 shadow-sm flex items-center justify-center shrink-0">
          {icon}
        </div>
        <h2 className="text-xl md:text-2xl font-bold text-gray-800">{title}</h2>
      </div>
      <p className="text-sm text-gray-500 mt-1.5 pl-14 md:pl-[3.75rem]">{subtitle}</p>
    </div>
  );
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

function getContrastingTextColor(hexColor?: string | null) {
  if (!hexColor) return '#111827';
  let sanitized = hexColor.trim();
  if (sanitized.startsWith('#')) sanitized = sanitized.slice(1);
  if (sanitized.length === 3) {
    sanitized = sanitized.split('').map((char) => char + char).join('');
  }
  if (!/^[0-9a-fA-F]{6}$/.test(sanitized)) return '#111827';
  const r = parseInt(sanitized.slice(0, 2), 16) / 255;
  const g = parseInt(sanitized.slice(2, 4), 16) / 255;
  const b = parseInt(sanitized.slice(4, 6), 16) / 255;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.6 ? '#111827' : '#ffffff';
}

const PersonalTab: React.FC<PersonalTabProps> = ({ employeeId }) => {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const skipNoteSaveRef = useRef(false);
  const noteSaveTimerRef = useRef<number | null>(null);
  const noteDraftRef = useRef<{ id: number; title: string; body: string } | null>(null);
  const lastSavedNoteRef = useRef<{ id: number; title: string; body: string } | null>(null);
  const selectedNoteIdRef = useRef<number | null>(null);

  const [userId, setUserId] = useState<string | null>(null);
  const [highlightLeads, setHighlightLeads] = useState<HighlightLead[]>([]);
  const [highlightsLoading, setHighlightsLoading] = useState(true);
  const [highlightSearch, setHighlightSearch] = useState('');
  const [commentModalOpen, setCommentModalOpen] = useState(false);
  const [selectedHighlightId, setSelectedHighlightId] = useState<number | null>(null);
  const [commentText, setCommentText] = useState('');
  const [isSavingComment, setIsSavingComment] = useState(false);

  const [notes, setNotes] = useState<EmployeePersonalNote[]>([]);
  const [notesLoading, setNotesLoading] = useState(true);
  const [selectedNoteId, setSelectedNoteId] = useState<number | null>(null);
  const [noteTitle, setNoteTitle] = useState('');
  const [noteBody, setNoteBody] = useState('');
  const [noteSaveState, setNoteSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [creatingNote, setCreatingNote] = useState(false);
  const [deletingNoteId, setDeletingNoteId] = useState<number | null>(null);

  const [files, setFiles] = useState<EmployeePersonalFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deletingFileId, setDeletingFileId] = useState<number | null>(null);
  const [selectedFile, setSelectedFile] = useState<EmployeePersonalFile | null>(null);
  const [uploadDocumentType, setUploadDocumentType] = useState('');
  const [fileTypeFilter, setFileTypeFilter] = useState('all');
  const [fileSearch, setFileSearch] = useState('');
  const [pendingUploadFile, setPendingUploadFile] = useState<File | null>(null);
  const [renamingFile, setRenamingFile] = useState<EmployeePersonalFile | null>(null);
  const [renameName, setRenameName] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);
  const [folders, setFolders] = useState<EmployeePersonalFolder[]>([]);
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

  const loadHighlights = useCallback(async (id: string) => {
    setHighlightsLoading(true);
    try {
      const { leads } = await fetchUserHighlightLeads(id);
      setHighlightLeads(leads);
    } catch (error) {
      console.error('PersonalTab highlights:', error);
      toast.error('Failed to load highlighted leads');
    } finally {
      setHighlightsLoading(false);
    }
  }, []);

  const loadNotes = useCallback(async () => {
    setNotesLoading(true);
    try {
      const rows = await fetchEmployeePersonalNotes(employeeId);
      setNotes(rows);
      setSelectedNoteId((current) => {
        if (current && rows.some((n) => n.id === current)) return current;
        return rows[0]?.id ?? null;
      });
    } catch (error) {
      console.error('PersonalTab notes:', error);
      toast.error('Failed to load notes');
    } finally {
      setNotesLoading(false);
    }
  }, [employeeId]);

  const loadFiles = useCallback(async () => {
    setFilesLoading(true);
    try {
      setFiles(await fetchEmployeePersonalFiles(employeeId));
    } catch (error) {
      console.error('PersonalTab files:', error);
      toast.error('Failed to load personal files');
    } finally {
      setFilesLoading(false);
    }
  }, [employeeId]);

  const loadFolders = useCallback(async () => {
    setFoldersLoading(true);
    try {
      setFolders(await fetchEmployeePersonalFolders(employeeId));
    } catch (error) {
      console.error('PersonalTab folders:', error);
      toast.error('Failed to load folders');
    } finally {
      setFoldersLoading(false);
    }
  }, [employeeId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const id = await getCurrentUserId();
      if (cancelled) return;
      setUserId(id);
      if (id) await loadHighlights(id);
      else setHighlightsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadHighlights]);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

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
      if (target?.closest('[data-personal-menu]')) return;
      setFolderMenuId(null);
      setMoveMenuFileId(null);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [folderMenuId, moveMenuFileId]);

  useEffect(() => {
    const refresh = () => {
      if (userId) void loadHighlights(userId);
    };
    window.addEventListener('highlights:added', refresh);
    window.addEventListener('highlights:removed', refresh);
    return () => {
      window.removeEventListener('highlights:added', refresh);
      window.removeEventListener('highlights:removed', refresh);
    };
  }, [userId, loadHighlights]);

  const selectedNote = useMemo(
    () => notes.find((n) => n.id === selectedNoteId) ?? null,
    [notes, selectedNoteId],
  );

  const persistNote = useCallback(
    async (id: number, title: string, body: string) => {
      const last = lastSavedNoteRef.current;
      if (last && last.id === id && last.title === title && last.body === body) {
        return;
      }
      if (selectedNoteIdRef.current === id) setNoteSaveState('saving');
      try {
        const updated = await updateEmployeePersonalNote(id, { title, body });
        lastSavedNoteRef.current = { id: updated.id, title: updated.title, body: updated.body };
        setNotes((prev) =>
          [updated, ...prev.filter((n) => n.id !== updated.id)].sort(
            (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
          ),
        );
        if (selectedNoteIdRef.current === id) setNoteSaveState('saved');
      } catch (error) {
        console.error('PersonalTab note save:', error);
        toast.error('Failed to save note');
        if (selectedNoteIdRef.current === id) setNoteSaveState('idle');
      }
    },
    [],
  );

  useEffect(() => {
    if (noteSaveTimerRef.current) {
      window.clearTimeout(noteSaveTimerRef.current);
      noteSaveTimerRef.current = null;
    }
    const previous = noteDraftRef.current;
    if (previous && previous.id !== selectedNote?.id) {
      void persistNote(previous.id, previous.title, previous.body);
    }

    skipNoteSaveRef.current = true;
    selectedNoteIdRef.current = selectedNote?.id ?? null;
    setNoteTitle(selectedNote?.title ?? '');
    setNoteBody(selectedNote?.body ?? '');
    setNoteSaveState('idle');
    const snapshot = selectedNote
      ? { id: selectedNote.id, title: selectedNote.title, body: selectedNote.body }
      : null;
    noteDraftRef.current = snapshot;
    lastSavedNoteRef.current = snapshot;
  }, [selectedNoteId, selectedNote?.id, persistNote]);

  const scheduleNoteSave = useCallback(
    (title: string, body: string) => {
      if (!selectedNoteId || skipNoteSaveRef.current) return;
      noteDraftRef.current = { id: selectedNoteId, title, body };
      if (noteSaveTimerRef.current) window.clearTimeout(noteSaveTimerRef.current);
      noteSaveTimerRef.current = window.setTimeout(() => {
        const draft = noteDraftRef.current;
        if (!draft) return;
        void persistNote(draft.id, draft.title, draft.body);
      }, 700);
    },
    [persistNote, selectedNoteId],
  );

  useEffect(() => {
    return () => {
      if (noteSaveTimerRef.current) {
        window.clearTimeout(noteSaveTimerRef.current);
        noteSaveTimerRef.current = null;
      }
      const draft = noteDraftRef.current;
      if (draft) {
        void persistNote(draft.id, draft.title, draft.body);
      }
    };
  }, [persistNote]);

  const filteredHighlights = useMemo(() => {
    const query = highlightSearch.trim().toLowerCase();
    if (!query) return highlightLeads;
    return highlightLeads.filter((lead) =>
      [lead.name, lead.lead_number, lead.display_lead_number, lead.topic, lead.comment]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)),
    );
  }, [highlightLeads, highlightSearch]);

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

  const handleRemoveHighlight = async (highlightId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    await removeHighlightById(highlightId);
  };

  const handleOpenComment = (highlightId: number, currentComment: string | null, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedHighlightId(highlightId);
    setCommentText(currentComment || '');
    setCommentModalOpen(true);
  };

  const handleSaveComment = async () => {
    if (selectedHighlightId == null) return;
    setIsSavingComment(true);
    try {
      const ok = await saveHighlightComment(selectedHighlightId, commentText);
      if (!ok) return;
      setCommentModalOpen(false);
      setSelectedHighlightId(null);
      setCommentText('');
    } finally {
      setIsSavingComment(false);
    }
  };

  const handleCreateNote = async () => {
    setCreatingNote(true);
    try {
      const created = await createEmployeePersonalNote(employeeId, { title: 'Untitled' });
      setNotes((prev) => [created, ...prev]);
      setSelectedNoteId(created.id);
    } catch (error) {
      console.error('PersonalTab create note:', error);
      toast.error('Failed to create note');
    } finally {
      setCreatingNote(false);
    }
  };

  const handleDeleteNote = async (noteId: number) => {
    if (!window.confirm('Delete this note? This cannot be undone.')) return;
    setDeletingNoteId(noteId);
    try {
      await deleteEmployeePersonalNote(noteId);
      setNotes((prev) => {
        const next = prev.filter((n) => n.id !== noteId);
        if (selectedNoteId === noteId) {
          setSelectedNoteId(next[0]?.id ?? null);
        }
        return next;
      });
    } catch (error) {
      console.error('PersonalTab delete note:', error);
      toast.error('Failed to delete note');
    } finally {
      setDeletingNoteId(null);
    }
  };

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
    const documentType = normalizePersonalDocumentType(uploadDocumentType);
    if (!documentType) {
      toast.error('Add a document type before uploading');
      return;
    }
    setUploading(true);
    try {
      const uploaded = await uploadEmployeePersonalFile({
        employeeId,
        file: pendingUploadFile,
        documentType,
        folderId: activeFolderId,
      });
      setFiles((prev) => [uploaded, ...prev]);
      setUploadDocumentType(documentType);
      setPendingUploadFile(null);
      toast.success('File uploaded');
    } catch (error: any) {
      console.error('PersonalTab upload:', error);
      toast.error(error?.message || 'Failed to upload file');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteFile = async (file: EmployeePersonalFile) => {
    if (!window.confirm(`Remove ${file.file_name}?`)) return;
    setDeletingFileId(file.id);
    try {
      await deleteEmployeePersonalFile(file);
      setFiles((prev) => prev.filter((f) => f.id !== file.id));
      if (selectedFile?.id === file.id) setSelectedFile(null);
    } catch (error) {
      console.error('PersonalTab delete file:', error);
      toast.error('Failed to remove file');
    } finally {
      setDeletingFileId(null);
    }
  };

  const handleDownloadFile = async (file: EmployeePersonalFile) => {
    try {
      const url = await createEmployeePersonalFileSignedUrl(file.storage_path);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.file_name;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error: any) {
      console.error('PersonalTab download:', error);
      toast.error(error?.message || 'Failed to download file');
    }
  };

  const applyRenamedFile = (updated: EmployeePersonalFile) => {
    setFiles((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
    setSelectedFile((current) => (current?.id === updated.id ? updated : current));
  };

  const handleOpenRename = (file: EmployeePersonalFile) => {
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
      const updated = await renameEmployeePersonalFile(renamingFile.id, renameName);
      applyRenamedFile(updated);
      setRenamingFile(null);
      toast.success('File name updated');
    } catch (error: any) {
      console.error('PersonalTab rename:', error);
      toast.error(error?.message || 'Failed to rename file');
    } finally {
      setIsRenaming(false);
    }
  };

  const handleMoveFile = async (file: EmployeePersonalFile, folderId: string | null) => {
    if ((file.folder_id ?? null) === folderId) {
      setMoveMenuFileId(null);
      return;
    }
    try {
      const updated = await moveEmployeePersonalFile(file.id, folderId);
      applyRenamedFile(updated);
      setMoveMenuFileId(null);
      toast.success(folderId ? 'Moved to folder' : 'Moved to Unfiled');
    } catch (error: any) {
      console.error('PersonalTab move:', error);
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

  const openEditFolderModal = (folder: EmployeePersonalFolder) => {
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
        const created = await createEmployeePersonalFolder(employeeId, title);
        setFolders((prev) => [...prev, created]);
        toast.success('Folder created');
      } else if (editingFolderId) {
        const updated = await renameEmployeePersonalFolder(editingFolderId, title);
        setFolders((prev) => prev.map((folder) => (folder.id === updated.id ? updated : folder)));
        toast.success('Folder renamed');
      }
      setFolderModalOpen(false);
    } catch (error: any) {
      console.error('PersonalTab folder save:', error);
      toast.error(error?.message || 'Failed to save folder');
    } finally {
      setFolderSaving(false);
    }
  };

  const handleDeleteFolder = async (folder: EmployeePersonalFolder) => {
    if (!window.confirm(`Delete folder “${folder.title}”? Documents inside will move to Unfiled.`)) {
      return;
    }
    setFolderMenuId(null);
    try {
      await deleteEmployeePersonalFolder(folder.id);
      setFolders((prev) => prev.filter((item) => item.id !== folder.id));
      setFiles((prev) =>
        prev.map((file) => (file.folder_id === folder.id ? { ...file, folder_id: null } : file)),
      );
      if (activeFolderId === folder.id) setActiveFolderId(null);
      toast.success('Folder deleted');
    } catch (error: any) {
      console.error('PersonalTab folder delete:', error);
      toast.error(error?.message || 'Failed to delete folder');
    }
  };

  const renderStageBadge = (stage: string | number | null | undefined) => {
    if (!stage && stage !== 0) return null;
    const stageStr = String(stage);
    const stageName = getStageName(stageStr);
    const stageColour = getStageColour(stageStr);
    const backgroundColor = stageColour || '#3f28cd';
    const textColor = stageColour ? getContrastingTextColor(stageColour) : '#ffffff';
    return (
      <span
        className="badge text-xs px-2.5 py-1 max-w-[10rem] truncate"
        style={{ backgroundColor, borderColor: backgroundColor, color: textColor }}
        title={stageName}
      >
        {stageName}
      </span>
    );
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
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
            <SectionTitle
              icon={<DocumentTextIcon className="w-7 h-7 md:w-8 md:h-8 text-gray-800" />}
              title="Personal files"
              subtitle="Private documents, separate from HR contracts and IDs."
            />
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
            <p>No personal files yet.</p>
            <p className="text-sm mt-1">Upload a document or create a folder for your private workspace.</p>
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
                        const raw = e.dataTransfer.getData('application/x-personal-file') || String(dragFileId ?? '');
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
                      <div className="relative flex shrink-0 items-center gap-2" data-personal-menu>
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
                        : 'No personal files yet.'}
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
                      e.dataTransfer.setData('application/x-personal-file', String(file.id));
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
                    <td className="text-sm text-gray-700">
                      {file.document_type?.trim() || '—'}
                    </td>
                    <td className="text-gray-600 whitespace-nowrap text-sm">
                      {formatUploadedAt(file.created_at)}
                    </td>
                    <td className="text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1" data-personal-menu>
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
      </div>

      <div className="rounded-[18px] bg-white p-6 md:p-8 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-5">
          <SectionTitle
            icon={<StarIconSolid className="w-7 h-7 md:w-8 md:h-8" style={{ color: '#3E28CD' }} />}
            title="Highlighted leads"
            subtitle="The same starred leads as the header panel. Open a client or remove a highlight here."
          />
          <div className="relative w-full sm:max-w-xs">
            <MagnifyingGlassIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              className="input input-bordered w-full pl-9 h-10 min-h-10 rounded-full text-sm"
              placeholder="Search highlights..."
              value={highlightSearch}
              onChange={(e) => setHighlightSearch(e.target.value)}
            />
          </div>
        </div>

        {highlightsLoading ? (
          <div className="flex justify-center py-14">
            <span className="loading loading-spinner loading-md text-primary" />
          </div>
        ) : filteredHighlights.length === 0 ? (
          <div className="rounded-2xl bg-gray-50 py-12 text-center text-gray-400">
            <StarIcon className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium text-gray-500">
              {highlightSearch.trim() ? 'No highlights match your search' : 'No highlighted leads yet'}
            </p>
            <p className="text-sm mt-1">
              {highlightSearch.trim()
                ? 'Try a different search term'
                : 'Star a lead from the client page or header search to see it here'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table w-full text-base">
              <thead>
                <tr className="text-sm uppercase tracking-wider text-gray-500">
                  <th className="bg-transparent font-semibold">Client</th>
                  <th className="bg-transparent font-semibold">Lead #</th>
                  <th className="bg-transparent font-semibold">Stage</th>
                  <th className="bg-transparent font-semibold">Category</th>
                  <th className="bg-transparent font-semibold">Topic</th>
                  <th className="bg-transparent font-semibold">Comment</th>
                  <th className="bg-transparent font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredHighlights.map((lead) => {
                  const highlightId = lead.highlightId;
                  return (
                    <tr
                      key={`${lead.lead_type}-${lead.id}`}
                      className="hover:bg-base-200 cursor-pointer"
                      onClick={() => navigate(`/clients/${lead.lead_number || lead.id}`)}
                    >
                      <td className="font-semibold text-gray-900 whitespace-nowrap">
                        {lead.name || 'Untitled lead'}
                      </td>
                      <td className="font-mono text-sm text-gray-500 whitespace-nowrap">
                        #{lead.display_lead_number || lead.lead_number || lead.id}
                      </td>
                      <td className="whitespace-nowrap">{renderStageBadge(lead.stage) || '—'}</td>
                      <td className="text-sm text-gray-700 max-w-[12rem] truncate" title={leadCategoryLabel(lead)}>
                        {leadCategoryLabel(lead)}
                      </td>
                      <td className="text-sm text-gray-700 max-w-[14rem] truncate" title={lead.topic || ''}>
                        {lead.topic || '—'}
                      </td>
                      <td className="text-sm text-gray-600 max-w-[16rem] truncate" title={lead.comment || ''}>
                        {lead.comment?.trim() || '—'}
                      </td>
                      <td className="text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        {highlightId != null && (
                          <div className="inline-flex items-center gap-0.5">
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm btn-circle"
                              title={lead.comment ? 'Edit comment' : 'Add comment'}
                              onClick={(e) => handleOpenComment(highlightId, lead.comment || null, e)}
                            >
                              <ChatBubbleLeftRightIcon className="w-5 h-5" />
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm btn-circle"
                              title="Remove from highlights"
                              onClick={(e) => void handleRemoveHighlight(highlightId, e)}
                            >
                              <StarIconSolid className="w-5 h-5 text-amber-400" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-[18px] bg-white p-6 md:p-8 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-5">
          <SectionTitle
            icon={<PencilSquareIcon className="w-7 h-7 md:w-8 md:h-8 text-gray-800" />}
            title="Notes"
            subtitle="Private to you — not attached to a lead."
          />
          <button
            type="button"
            className="btn btn-sm rounded-full gap-2 border-0 bg-primary text-white hover:bg-primary/90 h-10 min-h-10"
            onClick={() => void handleCreateNote()}
            disabled={creatingNote}
          >
            {creatingNote ? <span className="loading loading-spinner loading-xs" /> : <PlusIcon className="w-4 h-4" />}
            New note
          </button>
        </div>

        {notesLoading ? (
          <div className="flex justify-center py-14">
            <span className="loading loading-spinner loading-md text-primary" />
          </div>
        ) : notes.length === 0 ? (
          <div className="rounded-2xl bg-gray-50 py-12 text-center text-gray-400">
            <PencilSquareIcon className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>No notes yet.</p>
            <p className="text-sm mt-1">Create a note to keep private reminders or drafts.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-[16rem_minmax(0,1fr)] gap-4 md:gap-6">
            <ul className="border border-gray-100 rounded-2xl overflow-hidden divide-y divide-gray-100 max-h-[28rem] overflow-y-auto">
              {notes.map((note) => (
                <li key={note.id}>
                  <button
                    type="button"
                    className={`w-full text-left px-4 py-3 transition-colors ${
                      note.id === selectedNoteId ? 'bg-primary/10' : 'hover:bg-gray-50'
                    }`}
                    onClick={() => setSelectedNoteId(note.id)}
                  >
                    <p className="font-medium text-gray-900 truncate">
                      {note.title.trim() || 'Untitled'}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">{formatUploadedAt(note.updated_at)}</p>
                  </button>
                </li>
              ))}
            </ul>
            <div className="min-w-0">
              <div className="flex items-center justify-between gap-3 mb-2">
                <span className="text-xs text-gray-400">
                  {noteSaveState === 'saving'
                    ? 'Saving…'
                    : noteSaveState === 'saved'
                      ? 'Saved'
                      : 'Autosaves as you type'}
                </span>
                {selectedNoteId != null && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs text-error gap-1"
                    disabled={deletingNoteId === selectedNoteId}
                    onClick={() => void handleDeleteNote(selectedNoteId)}
                  >
                    {deletingNoteId === selectedNoteId ? (
                      <span className="loading loading-spinner loading-xs" />
                    ) : (
                      <TrashIcon className="w-4 h-4" />
                    )}
                    Delete
                  </button>
                )}
              </div>
              <input
                type="text"
                className="input input-bordered w-full mb-3 font-semibold"
                placeholder="Note title"
                value={noteTitle}
                onChange={(e) => {
                  skipNoteSaveRef.current = false;
                  setNoteTitle(e.target.value);
                  scheduleNoteSave(e.target.value, noteBody);
                }}
                onBlur={() => {
                  if (!selectedNoteId || skipNoteSaveRef.current) return;
                  if (noteSaveTimerRef.current) window.clearTimeout(noteSaveTimerRef.current);
                  void persistNote(selectedNoteId, noteTitle, noteBody);
                }}
              />
              <textarea
                className="textarea textarea-bordered w-full min-h-[16rem] text-sm leading-relaxed"
                placeholder="Write a private note…"
                value={noteBody}
                onChange={(e) => {
                  skipNoteSaveRef.current = false;
                  setNoteBody(e.target.value);
                  scheduleNoteSave(noteTitle, e.target.value);
                }}
                onBlur={() => {
                  if (!selectedNoteId || skipNoteSaveRef.current) return;
                  if (noteSaveTimerRef.current) window.clearTimeout(noteSaveTimerRef.current);
                  void persistNote(selectedNoteId, noteTitle, noteBody);
                }}
              />
            </div>
          </div>
        )}
      </div>

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

      {commentModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div
            className="fixed inset-0 bg-black bg-opacity-50"
            onClick={() => {
              setCommentModalOpen(false);
              setSelectedHighlightId(null);
              setCommentText('');
            }}
          />
          <div className="relative bg-white rounded-lg shadow-xl w-full max-w-md mx-4 p-6">
            <h3 className="text-lg font-semibold mb-4">Add Comment</h3>
            <textarea
              className="textarea textarea-bordered w-full h-32 mb-4"
              placeholder="Enter your comment..."
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setCommentModalOpen(false);
                  setSelectedHighlightId(null);
                  setCommentText('');
                }}
                disabled={isSavingComment}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleSaveComment()}
                disabled={isSavingComment}
              >
                {isSavingComment ? (
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
          bucketName={EMPLOYEE_PERSONAL_FILES_BUCKET}
          onRename={async (doc, newName) => {
            const id = Number(doc.id);
            if (!Number.isFinite(id)) return;
            const updated = await renameEmployeePersonalFile(id, newName);
            applyRenamedFile(updated);
          }}
        />
      )}
    </div>
  );
};

export default PersonalTab;
