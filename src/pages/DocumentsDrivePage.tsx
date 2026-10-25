import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  ArchiveBoxArrowDownIcon,
  ArrowDownTrayIcon,
  ArrowLeftIcon,
  ArrowUpTrayIcon,
  BriefcaseIcon,
  BuildingOffice2Icon,
  CalendarDaysIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  EllipsisVerticalIcon,
  EyeIcon,
  FolderArrowDownIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  IdentificationIcon,
  ListBulletIcon,
  LockClosedIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  ShieldCheckIcon,
  Squares2X2Icon,
  TrashIcon,
  UserIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import {
  FolderIcon as FolderSolidIcon,
  FolderOpenIcon as FolderOpenSolidIcon,
} from '@heroicons/react/24/solid';
import { supabase } from '../lib/supabase';
import { DocumentFileGlyph, ExcelLogoIcon, WordLogoIcon } from '../lib/documentFileGlyphs';
import DocumentSidebarThumb from '../components/DocumentSidebarThumb';
import DocumentsDriveCreateModal, {
  type DriveCreateContext,
  type DriveCreateMode,
} from '../components/DocumentsDriveCreateModal';
import { isOfficeEditableFile } from '../lib/officeOnlineEdit';
import type { DriveCreatedFile } from '../lib/documentDriveUpload';
import DocumentViewerModal, { type DocumentViewerItem } from '../components/DocumentViewerModal';
import { DocumentUploaderCell } from '../components/caseDocumentsModalUi';
import { resolveUploaderDisplayByKey, type UploaderDisplay } from '../lib/uploaderDisplay';
import { useAdminRole } from '../hooks/useAdminRole';
import { downloadFilesAsZip } from '../lib/downloadDocumentsZip';
import {
  expandDroppedItems,
  readDroppedItems,
  type FolderUploadEntry,
} from '../lib/browserFolderUpload';
import { fetchOfficeSpaces, OFFICE_ADMIN_SPACE, type OfficeSpace } from '../lib/officeSpaces';
import {
  deleteOfficeDocumentFolder,
  fetchOfficeDocumentFolders,
  moveOfficeDocumentsToFolder,
} from '../lib/officeDocuments';
import {
  deleteEmployeePersonalFolder,
  fetchEmployeePersonalFolders,
  moveEmployeePersonalFilesToFolder,
} from '../lib/employeePersonalSpace';
import { spaceFolderDepth, spaceFolderPath, type SpaceFolderNode } from '../lib/spaceFolders';
import {
  createDocumentIndexSignedUrl,
  createDocumentIndexSignedUrls,
  deleteDocumentIndexRow,
  DOCUMENT_INDEX_SOURCES,
  DOCUMENT_SOURCE_LABELS,
  fetchDocumentIndex,
  fetchDocumentIndexCases,
  fetchDocumentIndexCategories,
  fetchDocumentIndexCounts,
  fetchDocumentsInFolder,
  hasDocumentIndexFilters,
  isMovableDocument,
  stableRowKey,
  type DocumentIndexCase,
  type DocumentIndexFilters,
  type DocumentIndexRow,
  type DocumentIndexSort,
  type DocumentIndexSource,
} from '../lib/documentIndex';
import {
  childFolders,
  deleteDocumentFolder,
  listDocumentFolders,
  listFolderChildrenAcrossScopes,
  moveCaseDocumentsToFolder,
  type DocumentFolder,
  type DocumentFolderScope,
  type DocumentFolderScopeType,
} from '../lib/documentFolders';
import {
  addFolderGrant,
  describeGrantSubject,
  DOCUMENT_ACCESS_ROLES,
  fetchDepartmentOptions,
  fetchFolderGrants,
  removeFolderGrant,
  setFolderGrantCanEdit,
  type DepartmentOption,
  type DocumentFolderGrant,
} from '../lib/documentFolderAccess';
import { fetchActiveStaffEmployees, type ActiveStaffEmployee } from '../lib/employeeSalaries';
import { fetchStageActorInfo } from '../lib/leadStageManager';

/**
 * Every document in the system in one table: case documents, internal meeting files, office
 * documents, HR files and personal files. The view behind it is security_invoker, so people only
 * ever see rows they already had access to.
 */

/** Pastel fills rather than solid ones, so a page full of badges stays calm but still reads. */
const SOURCE_BADGE: Record<DocumentIndexSource, string> = {
  lead: 'bg-violet-100 text-violet-700',
  staff_meeting: 'bg-sky-100 text-sky-700',
  office: 'bg-amber-100 text-amber-700',
  personal: 'bg-slate-200 text-slate-600',
  hr: 'bg-rose-100 text-rose-700',
};

const SOURCE_ICON: Record<DocumentIndexSource | 'all', typeof FolderIcon> = {
  all: FolderIcon,
  lead: BriefcaseIcon,
  staff_meeting: CalendarDaysIcon,
  office: BuildingOffice2Icon,
  personal: UserIcon,
  hr: IdentificationIcon,
};

function formatModified(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Office and HR rows store an auth user id rather than a name, which is not worth showing raw. */
function uploaderKeyOf(row: DocumentIndexRow): string | null {
  const raw = (row.uploaded_by || '').trim();
  if (!raw) return null;
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw);
  return isUuid ? null : raw;
}

type RowAction = {
  id: string;
  label: string;
  /** A Heroicon or any of the brand file logos, which take the same className. */
  icon: React.ComponentType<{ className?: string }>;
  onSelect: () => void;
  /** Marks an action that destroys something, so the menu can colour it as a warning. */
  danger?: boolean;
};

const ROW_MENU_WIDTH = 248;
const ROW_MENU_ITEM_HEIGHT = 48;

/**
 * The table body is the page's scroll container, so a plain dropdown would be clipped on the
 * last rows. This one renders to the body and flips above the button when space runs out.
 */
const RowActionsMenu: React.FC<{
  actions: RowAction[];
  disabled?: boolean;
  /** Replaces the three-dot trigger, e.g. a folder name that opens the same menu. */
  trigger?: React.ReactNode;
  triggerClassName?: string;
  ariaLabel?: string;
  align?: 'start' | 'end';
}> = ({ actions, disabled, trigger, triggerClassName, ariaLabel, align = 'end' }) => {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  const close = useCallback(() => setPosition(null), []);

  const open = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const height = actions.length * ROW_MENU_ITEM_HEIGHT + 16;
    const flipUp = rect.bottom + height > window.innerHeight - 8;
    const anchored = align === 'start' ? rect.left : rect.right - ROW_MENU_WIDTH;
    setPosition({
      top: flipUp ? Math.max(8, rect.top - height - 4) : rect.bottom + 4,
      left: Math.max(8, Math.min(anchored, window.innerWidth - ROW_MENU_WIDTH - 8)),
    });
  };

  useEffect(() => {
    if (!position) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [position, close]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={
          triggerClassName ||
          'btn btn-ghost btn-sm btn-circle text-base-content/50 hover:bg-base-200 hover:text-base-content'
        }
        aria-label={ariaLabel || 'More actions'}
        aria-haspopup="menu"
        aria-expanded={!!position}
        disabled={disabled}
        onClick={() => (position ? close() : open())}
      >
        {trigger || <EllipsisVerticalIcon className="h-5 w-5" />}
      </button>
      {position &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            className="fixed z-[80] overflow-hidden rounded-xl border border-base-300 bg-base-200 py-2 shadow-2xl"
            style={{ top: position.top, left: position.left, width: ROW_MENU_WIDTH }}
          >
            {actions.map((action) => (
              <button
                key={action.id}
                type="button"
                role="menuitem"
                className={`group flex w-full items-center gap-3 px-4 py-3 text-left text-base transition-colors ${
                  action.danger
                    ? 'text-error hover:bg-error/10'
                    : 'text-base-content/70 hover:bg-base-300 hover:text-base-content'
                }`}
                onClick={() => {
                  close();
                  action.onSelect();
                }}
              >
                <action.icon
                  className={`h-6 w-6 shrink-0 ${
                    action.danger ? 'text-error' : 'text-base-content/60 group-hover:text-base-content'
                  }`}
                />
                <span className="truncate">{action.label}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
};

/**
 * Reloading while scrolled past the first page re-fetches that page, so appending has to be
 * idempotent or the same row would be rendered twice under one key.
 */
function appendUnique<T>(previous: T[], next: T[], keyOf: (item: T) => string): T[] {
  const seen = new Set(previous.map(keyOf));
  const added = next.filter((item) => !seen.has(keyOf(item)));
  return added.length > 0 ? [...previous, ...added] : previous;
}

/** One click picks a row out; the action bar then works on whatever is picked. */
type DriveSelection = { kind: 'doc'; key: string } | { kind: 'folder'; id: string } | null;

type DriveDeleteTarget =
  | { kind: 'doc'; row: DocumentIndexRow }
  | { kind: 'folder'; folder: DocumentFolder }
  | null;

type DriveEmptyState = {
  icon: typeof FolderIcon;
  title: string;
  hint: string;
  actionLabel?: string;
  onAction?: () => void;
};

const DriveEmptyPlaceholder: React.FC<DriveEmptyState> = ({
  icon: Icon,
  title,
  hint,
  actionLabel,
  onAction,
}) => (
  <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
    <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-base-200">
      <Icon className="h-9 w-9 text-slate-400" />
    </span>
    <p className="mt-4 text-base font-medium text-base-content/70">{title}</p>
    <p className="mt-1 max-w-sm text-sm text-base-content/50">{hint}</p>
    {actionLabel && onAction && (
      <button
        type="button"
        className="btn btn-sm mt-5 gap-1 rounded-full border-base-300 bg-white text-base-content/70 hover:bg-base-200 dark:bg-base-100"
        onClick={onAction}
      >
        <ArrowUpTrayIcon className="h-4 w-4" />
        {actionLabel}
      </button>
    )}
  </div>
);

/** A folder of a department space or of someone's own space, as those two tables report it. */
type SpaceFolderRow = SpaceFolderNode & { created_at: string; sort_order: number };

/**
 * Department spaces and personal spaces keep their folders in their own tables, while the drive
 * renders every folder through the case-tree shape — so one is adapted into the other rather than
 * teaching the rows, breadcrumbs and drop targets about three kinds of folder. The tree the folder
 * came from is passed in, since that is where its depth and path come from.
 */
function spaceFolderAsDocumentFolder(
  folder: SpaceFolderRow,
  scopeType: DocumentFolderScopeType,
  scopeKey: string,
  tree: SpaceFolderRow[],
): DocumentFolder {
  return {
    id: folder.id,
    parent_id: folder.parent_id,
    scope_type: scopeType,
    scope_key: scopeKey,
    classification_id: null,
    area: null,
    title: folder.title,
    note: null,
    path: spaceFolderPath(tree, folder.id),
    depth: spaceFolderDepth(tree, folder.id),
    sort_order: folder.sort_order,
    created_by: null,
    created_at: folder.created_at,
  };
}

/**
 * The line under a folder's name on a card: a case folder says which case it belongs to, while a
 * space folder says where in the space it sits. The scope key itself ('dept-12', an employee id)
 * is of no use to anyone reading it.
 */
function folderSubtitle(folder: DocumentFolder): string {
  if (folder.scope_type === 'lead') return folder.scope_key;
  return (folder.path || '').split(' / ').slice(0, -1).join(' / ');
}

function scopeOf(row: DocumentIndexRow): DocumentFolderScope | null {
  if (row.source !== 'lead' || !row.scope_key) return null;
  return {
    scopeType: 'lead',
    scopeKey: row.scope_key,
    classificationId: row.classification_id,
    area: row.area,
  };
}

const DocumentsDrivePage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAdmin, isSuperUser } = useAdminRole();

  // /drive?case=L123 opens that case straight away, which is how the case documents drawer
  // hands over to the drive.
  const requestedCase = useMemo(
    () => new URLSearchParams(location.search).get('case')?.trim() || null,
    [location.search],
  );
  /** Where the drawer was opened from, so the lead page is one click away again. */
  const returnTo = useMemo(() => {
    const raw = new URLSearchParams(location.search).get('from')?.trim() || '';
    // In-app paths only, never an absolute URL and never back to this page.
    if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/drive')) return null;
    return raw;
  }, [location.search]);

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [categoryOptions, setCategoryOptions] = useState<string[]>([]);
  const [source, setSource] = useState<DocumentIndexSource | 'all'>(requestedCase ? 'lead' : 'all');
  const [view, setView] = useState<'table' | 'grid'>('table');
  const [sort, setSort] = useState<DocumentIndexSort>('created_at');
  const [ascending, setAscending] = useState(false);
  const [page, setPage] = useState(0);

  const [rows, setRows] = useState<DocumentIndexRow[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<DocumentIndexSource, number> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploaders, setUploaders] = useState<Map<string, UploaderDisplay>>(new Map());

  const [officeSpaces, setOfficeSpaces] = useState<OfficeSpace[]>([]);
  const [officeOpen, setOfficeOpen] = useState(false);
  const [officeSpaceKey, setOfficeSpaceKey] = useState<string | null>(null);

  const [caseKey, setCaseKey] = useState<string | null>(requestedCase);
  const [caseRows, setCaseRows] = useState<DocumentIndexCase[]>([]);
  const [folderTrail, setFolderTrail] = useState<DocumentFolder[]>([]);
  const [folders, setFolders] = useState<DocumentFolder[]>([]);
  /** Why the folder list is empty, when it is empty because the read failed. */
  const [foldersError, setFoldersError] = useState<string | null>(null);
  const [createMode, setCreateMode] = useState<DriveCreateMode | null>(null);
  const [droppedEntries, setDroppedEntries] = useState<FolderUploadEntry[] | null>(null);
  const [fileDragOver, setFileDragOver] = useState(false);
  const [createdNonce, setCreatedNonce] = useState(0);
  const [viewerDocs, setViewerDocs] = useState<DocumentViewerItem[] | null>(null);
  /** Set only for a document created a moment ago, which opens straight into its editor. */
  const [viewerAutoEdit, setViewerAutoEdit] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [moveRow, setMoveRow] = useState<DocumentIndexRow | null>(null);
  const [accessRow, setAccessRow] = useState<DocumentIndexRow | null>(null);
  /** What the delete confirmation is asking about — superusers only. */
  const [deleteTarget, setDeleteTarget] = useState<DriveDeleteTarget>(null);
  const [deleting, setDeleting] = useState(false);
  /** Who is signed in, which is whose folders the My space section browses. */
  const [employeeId, setEmployeeId] = useState<number | null>(null);
  const [selection, setSelection] = useState<DriveSelection>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dropFolderId, setDropFolderId] = useState<string | null>(null);
  const [landedFolderId, setLandedFolderId] = useState<string | null>(null);

  const reloadToken = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(0);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  // Cases browse like a drive: cases, then their folders, then the files. A search here narrows
  // the list of cases rather than flattening everything, so you still land on a case folder.
  // Every other section is a flat list.
  const inCasesTree = source === 'lead';
  const showCaseList = inCasesTree && !caseKey;
  const activeFolder = folderTrail.length > 0 ? folderTrail[folderTrail.length - 1] : null;

  // Office is split per department, and the sidebar sub-item narrows the list to one space.
  const activeOfficeSpace =
    source === 'office' && officeSpaceKey
      ? officeSpaces.find((space) => space.scopeKey === officeSpaceKey) ?? null
      : null;
  /** Every section but meetings browses into folders, since meetings store none. */
  const inPersonalSpace = source === 'personal';
  const showFolderRows = (inCasesTree && !!caseKey) || !!activeOfficeSpace || inPersonalSpace;
  /** The open folder, when it is one of a department space's own folders. */
  const activeOfficeFolder = activeFolder?.scope_type === 'office' ? activeFolder : null;
  /** The open folder, when it is one in the signed-in employee's own space. */
  const activePersonalFolder = activeFolder?.scope_type === 'employee' ? activeFolder : null;
  /** The open folder, when it belongs to a case tree. */
  const activeCaseFolder = activeFolder?.scope_type === 'lead' ? activeFolder : null;
  const scopeKey: string | string[] | null = inCasesTree
    ? caseKey
    : activeOfficeSpace?.matchScopeKeys ?? null;

  const filters = useMemo<DocumentIndexFilters>(
    () => ({
      search,
      category: category || null,
      createdFrom: dateFrom || null,
      createdTo: dateTo || null,
    }),
    [search, category, dateFrom, dateTo],
  );
  const filtersActive = hasDocumentIndexFilters(filters);
  const narrowed = !!category || !!dateFrom || !!dateTo;

  const load = useCallback(async () => {
    const token = ++reloadToken.current;
    setLoading(true);
    setError(null);
    try {
      // Page 0 is a fresh list; later pages are appended as the rows scroll into view.
      const append = page > 0;

      if (showCaseList) {
        const cases = await fetchDocumentIndexCases({ ...filters, page });
        if (token !== reloadToken.current) return;
        setCaseRows((prev) =>
          append ? appendUnique(prev, cases.rows, (item) => item.lead_number) : cases.rows,
        );
        setRows([]);
        setTotal(cases.total);
        if (!append) setUploaders(new Map());
        return;
      }
      if (!append) setCaseRows([]);

      const { rows: nextRows, total: nextTotal } = await fetchDocumentIndex({
        ...filters,
        sources: source === 'all' ? undefined : [source],
        scopeKey,
        // Narrowing inside a case looks through the whole case, not just the open folder.
        folder: activeFolder
          ? { id: activeFolder.id }
          : (inCasesTree || !!activeOfficeSpace || inPersonalSpace) && !filtersActive
            ? 'root'
            : 'any',
        sort,
        ascending,
        page,
      });
      if (token !== reloadToken.current) return;
      setRows((prev) => (append ? appendUnique(prev, nextRows, stableRowKey) : nextRows));
      setTotal(nextTotal);

      const keys = [...new Set(nextRows.map(uploaderKeyOf).filter((key): key is string => !!key))];
      if (keys.length > 0) {
        const resolved = await resolveUploaderDisplayByKey(keys);
        if (token === reloadToken.current) {
          setUploaders((prev) => (append ? new Map([...prev, ...resolved]) : resolved));
        }
      } else if (!append) {
        setUploaders(new Map());
      }
    } catch (err: any) {
      if (token !== reloadToken.current) return;
      const message = String(err?.message || err || 'Could not load documents');
      setError(
        /document_index/i.test(message)
          ? 'The documents view is missing. Run sql/2026-10-21_document_index_view.sql, then reload.'
          : message,
      );
      setRows([]);
      setCaseRows([]);
      setTotal(0);
    } finally {
      if (token === reloadToken.current) setLoading(false);
    }
  }, [
    filters,
    filtersActive,
    source,
    showCaseList,
    inCasesTree,
    scopeKey,
    activeFolder,
    sort,
    ascending,
    page,
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * After a change, start the list again from the first page: re-fetching only the page you are
   * scrolled to would leave the pages above it showing what used to be there.
   */
  const reload = useCallback(() => {
    if (page === 0) {
      void load();
      return;
    }
    setPage(0);
  }, [page, load]);

  // Searching, or leaving the Cases section, drops you back out of any case and folder.
  useEffect(() => {
    if (!inCasesTree) {
      setCaseKey(null);
      setFolderTrail([]);
    }
  }, [inCasesTree]);

  useEffect(() => {
    void fetchStageActorInfo()
      .then((actor) => setEmployeeId(actor.employeeId))
      .catch(() => setEmployeeId(null));
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchOfficeSpaces()
      .then((spaces) => {
        if (!cancelled) setOfficeSpaces(spaces);
      })
      .catch(() => {
        if (!cancelled) setOfficeSpaces([OFFICE_ADMIN_SPACE]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (source !== 'office') setOfficeSpaceKey(null);
  }, [source]);

  // Arriving from another case's drawer while the page is already open.
  useEffect(() => {
    if (!requestedCase) return;
    setSource('lead');
    setCaseKey(requestedCase);
    setFolderTrail([]);
    setPage(0);
  }, [requestedCase]);

  /** More rows arrive as the list nears its end, so a big store never loads in one go. */
  const handleListScroll = (event: React.UIEvent<HTMLDivElement>) => {
    if (loading) return;
    const shown = showCaseList ? caseRows.length : rows.length;
    if (shown === 0 || shown >= total) return;
    const el = event.currentTarget;
    if (el.scrollTop + el.clientHeight < el.scrollHeight - 320) return;
    setPage((prev) => prev + 1);
  };

  useEffect(() => {
    if (!showFolderRows) {
      setFolders([]);
      return;
    }
    let cancelled = false;

    const loadFolders = async (): Promise<DocumentFolder[]> => {
      // These two stores keep a whole space's folders in one small table, so the tree is read in
      // one go and the open folder's children picked out of it.
      if (activeOfficeSpace) {
        const rows = await fetchOfficeDocumentFolders(activeOfficeSpace.departmentId);
        const tree = rows.map((row) =>
          spaceFolderAsDocumentFolder(row, 'office', activeOfficeSpace.scopeKey, rows),
        );
        return childFolders(tree, activeFolder?.id ?? null);
      }
      if (inPersonalSpace) {
        if (employeeId == null) return [];
        const rows = await fetchEmployeePersonalFolders(employeeId);
        const tree = rows.map((row) =>
          spaceFolderAsDocumentFolder(row, 'employee', String(employeeId), rows),
        );
        return childFolders(tree, activeFolder?.id ?? null);
      }
      if (!caseKey) return [];
      return listFolderChildrenAcrossScopes(activeFolder?.id ?? null, { scopeKey: caseKey });
    };

    loadFolders()
      .then((next) => {
        if (cancelled) return;
        setFolders(next);
        setFoldersError(null);
      })
      .catch((err: any) => {
        // An empty folder list is indistinguishable from the folders having been deleted, so the
        // reason is kept and shown rather than swallowed.
        if (cancelled) return;
        setFolders([]);
        setFoldersError(String(err?.message || err || 'Folders could not be loaded'));
      });
    return () => {
      cancelled = true;
    };
  }, [showFolderRows, activeOfficeSpace, inPersonalSpace, employeeId, caseKey, activeFolder, createdNonce]);

  // A folder is only open while you are standing where it lives, so moving to another section,
  // case or department space closes it.
  useEffect(() => {
    setFolderTrail((trail) => (trail.length === 0 ? trail : []));
  }, [source, officeSpaceKey, caseKey]);

  useEffect(() => {
    let cancelled = false;
    fetchDocumentIndexCounts(filters)
      .then((next) => {
        if (!cancelled) setCounts(next);
      })
      .catch(() => {
        if (!cancelled) setCounts(null);
      });
    return () => {
      cancelled = true;
    };
  }, [filters]);

  // The categories on offer follow the section you are in, so the list stays short and relevant.
  useEffect(() => {
    let cancelled = false;
    fetchDocumentIndexCategories({
      sources: source === 'all' ? undefined : [source],
      scopeKey,
    })
      .then((next) => {
        if (cancelled) return;
        setCategoryOptions(next);
        // A category from the section you just left would only match nothing here.
        setCategory((prev) => (prev && !next.includes(prev) ? '' : prev));
      })
      .catch(() => {
        if (!cancelled) setCategoryOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [source, scopeKey]);

  const toggleSort = (column: DocumentIndexSort) => {
    if (sort === column) {
      setAscending((prev) => !prev);
    } else {
      setSort(column);
      setAscending(column === 'file_name' || column === 'scope_label');
    }
    setPage(0);
  };

  const openPreview = async (row: DocumentIndexRow) => {
    const key = stableRowKey(row);
    setBusyKey(key);
    try {
      const url = await createDocumentIndexSignedUrl(row);
      setViewerDocs([
        {
          id: key,
          name: row.file_name,
          url,
          fileType: row.mime_type || '',
          lastModified: row.created_at,
          storagePath: row.storage_path,
          storageBucket: row.storage_bucket,
        },
      ]);
    } catch (err: any) {
      toast.error(err?.message || 'Could not open this file');
    } finally {
      setBusyKey(null);
    }
  };

  /** Show a just-created document in the viewer, already on its way into Word or Excel. */
  const openCreatedForEditing = async (made: DriveCreatedFile) => {
    try {
      const { data, error } = await supabase.storage
        .from(made.bucket)
        .createSignedUrl(made.storagePath, 3600);
      if (error || !data?.signedUrl) throw error || new Error('Could not open the new document');
      setViewerAutoEdit(true);
      setViewerDocs([
        {
          id: made.storagePath,
          name: made.fileName,
          url: data.signedUrl,
          fileType: made.mimeType,
          lastModified: new Date().toISOString(),
          storagePath: made.storagePath,
          storageBucket: made.bucket,
        },
      ]);
    } catch (err: any) {
      toast.error(err?.message || 'Created, but could not open it — find it in the list');
    }
  };

  const download = async (row: DocumentIndexRow) => {
    const key = stableRowKey(row);
    setBusyKey(key);
    try {
      const url = await createDocumentIndexSignedUrl(row);
      const link = document.createElement('a');
      link.href = url;
      link.download = row.file_name;
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err: any) {
      toast.error(err?.message || 'Could not download this file');
    } finally {
      setBusyKey(null);
    }
  };

  /** Shared by the folder menu's zip and viewer entries. */
  const folderContents = async (folder: DocumentFolder) => {
    const docs = await fetchDocumentsInFolder(folder.id);
    if (docs.length === 0) {
      toast.error('This folder has no files yet');
      return null;
    }
    const urls = await createDocumentIndexSignedUrls(docs);
    return { docs, urls };
  };

  const openFolderInViewer = async (folder: DocumentFolder) => {
    setBusyKey(folder.id);
    try {
      const contents = await folderContents(folder);
      if (!contents) return;
      setViewerDocs(
        contents.docs
          .filter((doc) => contents.urls.has(doc.storage_path))
          .map((doc) => ({
            id: stableRowKey(doc),
            name: doc.file_name,
            url: contents.urls.get(doc.storage_path) as string,
            fileType: doc.mime_type || '',
            lastModified: doc.created_at,
            storagePath: doc.storage_path,
            storageBucket: doc.storage_bucket,
          })),
      );
    } catch (err: any) {
      toast.error(err?.message || 'Could not open this folder');
    } finally {
      setBusyKey(null);
    }
  };

  const downloadFolderZip = async (folder: DocumentFolder) => {
    setBusyKey(folder.id);
    const progress = toast.loading(`Preparing ${folder.title}.zip…`);
    try {
      const contents = await folderContents(folder);
      if (!contents) return;
      const { successCount, errorCount } = await downloadFilesAsZip({
        files: contents.docs
          .filter((doc) => contents.urls.has(doc.storage_path))
          .map((doc) => ({ name: doc.file_name, url: contents.urls.get(doc.storage_path) as string })),
        zipFileName: `${folder.title || 'folder'}.zip`,
        onProgress: (done, totalFiles) =>
          toast.loading(`Zipping ${done} of ${totalFiles}…`, { id: progress }),
      });
      if (successCount === 0) {
        toast.error('None of the files could be downloaded', { id: progress });
      } else {
        toast.success(
          errorCount > 0
            ? `Downloaded ${successCount} files, ${errorCount} failed`
            : `Downloaded ${successCount} files`,
          { id: progress },
        );
      }
    } catch (err: any) {
      toast.error(err?.message || 'Could not build the zip', { id: progress });
    } finally {
      setBusyKey(null);
    }
  };

  /** Standing in a case, a department space or a folder means the destination is already known. */
  const createContext: DriveCreateContext = {
    leadNumber: activeCaseFolder?.scope_key ?? caseKey,
    classificationId: activeCaseFolder?.classification_id ?? null,
    area: activeCaseFolder?.area ?? null,
    folderId: activeCaseFolder?.id ?? null,
    officeSpaceKey: activeOfficeSpace?.scopeKey ?? null,
    officeFolderId: activeOfficeFolder?.id ?? null,
    personalFolderId: activePersonalFolder?.id ?? null,
    section: source === 'all' || source === 'hr' ? 'lead' : source,
  };

  const createActions: RowAction[] = [
    {
      id: 'upload-files',
      label: 'Upload files',
      icon: ArrowUpTrayIcon,
      onSelect: () => setCreateMode('files'),
    },
    {
      id: 'upload-folder',
      label: 'Upload folder',
      icon: FolderArrowDownIcon,
      onSelect: () => setCreateMode('folder'),
    },
    {
      id: 'new-folder',
      label: 'New folder',
      icon: FolderPlusIcon,
      onSelect: () => setCreateMode('new-folder'),
    },
    {
      id: 'new-word',
      label: 'Word document',
      icon: WordLogoIcon,
      onSelect: () => setCreateMode('new-word'),
    },
    {
      id: 'new-excel',
      label: 'Excel sheet',
      icon: ExcelLogoIcon,
      onSelect: () => setCreateMode('new-excel'),
    },
  ];

  const openCase = (leadNumber: string) => {
    setCaseKey(leadNumber);
    setFolderTrail([]);
    setPage(0);
    // A search that found this case has done its job; keeping it would then filter the case down
    // to the files whose names happen to repeat the search, which reads as an empty case.
    setSearchInput('');
    setSearch('');
  };

  const openFolder = (folder: DocumentFolder) => {
    setFolderTrail((trail) => [...trail, folder]);
    // The folder was picked out to open it, not to act on it, and what the action bar offers has
    // to follow what is on screen.
    setSelection(null);
    setPage(0);
  };

  /**
   * Deleting is kept to superusers, and always goes through the confirmation. Folders only ever
   * take the folder itself with them — the files inside are put back where they were filed from.
   */
  const confirmDelete = async () => {
    if (!deleteTarget || !isSuperUser) return;
    setDeleting(true);
    try {
      if (deleteTarget.kind === 'doc') {
        await deleteDocumentIndexRow(deleteTarget.row);
        toast.success(`Deleted “${deleteTarget.row.file_name}”`);
      } else {
        const folder = deleteTarget.folder;
        if (folder.scope_type === 'office') {
          await deleteOfficeDocumentFolder(folder.id);
        } else if (folder.scope_type === 'employee') {
          await deleteEmployeePersonalFolder(folder.id);
        } else {
          await deleteDocumentFolder(folder.id);
        }
        // Standing inside the folder that just went, step back out of it.
        setFolderTrail((trail) => {
          const at = trail.findIndex((item) => item.id === folder.id);
          return at === -1 ? trail : trail.slice(0, at);
        });
        toast.success(`Deleted folder “${folder.title}”`);
      }
      setSelection(null);
      setDeleteTarget(null);
      setCreatedNonce((nonce) => nonce + 1);
      reload();
    } catch (err: any) {
      toast.error(err?.message || 'Could not delete this');
    } finally {
      setDeleting(false);
    }
  };

  const emptyState: DriveEmptyState = useMemo(() => {
    if (search) {
      return {
        icon: MagnifyingGlassIcon,
        title: `Nothing matches “${search}”`,
        hint: 'Try one word from the file name, or a case number on its own.',
      };
    }
    if (narrowed) {
      return {
        icon: MagnifyingGlassIcon,
        title: 'Nothing matches these filters',
        hint: 'Widen the dates, or pick another category.',
        actionLabel: 'Clear filters',
        onAction: () => {
          setCategory('');
          setDateFrom('');
          setDateTo('');
          setPage(0);
        },
      };
    }
    if (activeFolder) {
      return {
        icon: FolderOpenSolidIcon,
        title: 'This folder is empty',
        hint: `Nothing has been filed in “${activeFolder.title}” yet.`,
        actionLabel: 'Upload files here',
        onAction: () => setCreateMode('files'),
      };
    }
    if (caseKey) {
      return {
        icon: FolderOpenSolidIcon,
        title: 'No documents in this case yet',
        hint: `Upload a file or create a folder to start filing ${caseKey}.`,
        actionLabel: 'Upload files here',
        onAction: () => setCreateMode('files'),
      };
    }
    return {
      icon: FolderOpenSolidIcon,
      title: 'No documents yet',
      hint: 'Files uploaded anywhere in the CRM show up here.',
    };
  }, [search, narrowed, activeFolder, caseKey]);

  /** Dragging a row onto a folder files it there, the same move the dialog makes. */
  const dropOnFolder = async (folder: DocumentFolder) => {
    const row = rows.find((item) => stableRowKey(item) === dragKey);
    setDropFolderId(null);
    setDragKey(null);
    if (!row) return;
    // A folder only takes files from its own store, so the move goes through that store's own
    // helper and nothing can be filed across two spaces.
    const expectedSource: DocumentIndexSource =
      folder.scope_type === 'office' ? 'office' : folder.scope_type === 'employee' ? 'personal' : 'lead';
    if (row.source !== expectedSource || (expectedSource === 'lead' && !isMovableDocument(row))) {
      toast.error(
        expectedSource === 'lead'
          ? 'Only case documents can be filed into folders'
          : 'Only files from this space can be filed into its folders',
      );
      return;
    }
    if (row.folder_id === folder.id) return;
    try {
      if (folder.scope_type === 'office') {
        await moveOfficeDocumentsToFolder([row.row_id], folder.id);
      } else if (folder.scope_type === 'employee') {
        await moveEmployeePersonalFilesToFolder([row.row_id], folder.id);
      } else {
        await moveCaseDocumentsToFolder([row.row_id], folder.id);
      }
      setLandedFolderId(folder.id);
      toast.success(`Moved to “${folder.title}”`);
      reload();
    } catch (err: any) {
      toast.error(err?.message || 'Could not move this file');
    }
  };

  /**
   * The whole list takes a drop from the desktop: the files are read here and the upload dialog
   * opens on them, with the destination already resolved the way the New button resolves it.
   */
  const listFileDropProps = {
    onDragOver: (event: React.DragEvent) => {
      // A row being dragged inside the table carries no files, and must not raise the overlay.
      if (!event.dataTransfer.types.includes('Files')) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      setFileDragOver(true);
    },
    onDragLeave: (event: React.DragEvent) => {
      const next = event.relatedTarget as Node | null;
      if (next && event.currentTarget.contains(next)) return;
      setFileDragOver(false);
    },
    onDrop: (event: React.DragEvent) => {
      if (!event.dataTransfer.types.includes('Files')) return;
      event.preventDefault();
      setFileDragOver(false);
      // The items must be read before any await or the browser discards them.
      const items = readDroppedItems(event.dataTransfer);
      void (async () => {
        const entries = await expandDroppedItems(items);
        if (entries.length === 0) return;
        setDroppedEntries(entries);
        // A dropped folder arrives as its files, each carrying the folders it sat in, so whether
        // this was a folder or a loose pile of files is read off those.
        const droppedAFolder = entries.some((entry) => entry.segments.length > 0);
        setCreateMode(droppedAFolder ? 'folder' : 'files');
      })();
    },
  };

  const folderDropProps = (folder: DocumentFolder) => ({
    onDragOver: (event: React.DragEvent) => {
      if (!dragKey) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      setDropFolderId(folder.id);
    },
    onDragLeave: () => setDropFolderId((prev) => (prev === folder.id ? null : prev)),
    onDrop: (event: React.DragEvent) => {
      event.preventDefault();
      void dropOnFolder(folder);
    },
    onAnimationEnd: () => setLandedFolderId((prev) => (prev === folder.id ? null : prev)),
  });

  const folderActions = (folder: DocumentFolder): RowAction[] => {
    const actions: RowAction[] = [
      {
        id: 'open',
        label: 'Open folder',
        icon: FolderOpenIcon,
        onSelect: () => openFolder(folder),
      },
      {
        id: 'view-all',
        label: 'View all files',
        icon: EyeIcon,
        onSelect: () => void openFolderInViewer(folder),
      },
      {
        id: 'zip',
        label: 'Download as zip',
        icon: ArchiveBoxArrowDownIcon,
        onSelect: () => void downloadFolderZip(folder),
      },
    ];
    if (isSuperUser) {
      actions.push({
        id: 'delete-folder',
        label: 'Delete folder',
        icon: TrashIcon,
        danger: true,
        onSelect: () => setDeleteTarget({ kind: 'folder', folder }),
      });
    }
    return actions;
  };

  const rowActions = (row: DocumentIndexRow): RowAction[] => {
    const actions: RowAction[] = [
      { id: 'preview', label: 'Preview', icon: EyeIcon, onSelect: () => void openPreview(row) },
      { id: 'download', label: 'Download', icon: ArrowDownTrayIcon, onSelect: () => void download(row) },
    ];
    if (row.source === 'lead' && row.scope_key) {
      actions.push({
        id: 'open-case',
        label: `Open case ${row.scope_key}`,
        icon: BriefcaseIcon,
        onSelect: () => navigate(`/clients/${row.scope_key}`),
      });
    }
    if (isMovableDocument(row)) {
      actions.push({
        id: 'move',
        label: 'Move to folder',
        icon: FolderArrowDownIcon,
        onSelect: () => setMoveRow(row),
      });
    }
    if (isAdmin && isMovableDocument(row) && row.folder_id) {
      actions.push({
        id: 'access',
        label: 'Manage access',
        icon: ShieldCheckIcon,
        onSelect: () => setAccessRow(row),
      });
    }
    if (isSuperUser) {
      actions.push({
        id: 'delete',
        label: 'Delete document',
        icon: TrashIcon,
        danger: true,
        onSelect: () => setDeleteTarget({ kind: 'doc', row }),
      });
    }
    return actions;
  };

  const selectedDoc =
    selection?.kind === 'doc' ? rows.find((row) => stableRowKey(row) === selection.key) ?? null : null;
  const selectedFolder =
    selection?.kind === 'folder' ? folders.find((folder) => folder.id === selection.id) ?? null : null;

  // Navigating or reloading replaces the rows, and a selection that no longer exists has to go.
  useEffect(() => {
    if (!selection) return;
    if (!selectedDoc && !selectedFolder) setSelection(null);
  }, [selection, selectedDoc, selectedFolder]);

  const selectionActions: RowAction[] = selectedDoc
    ? rowActions(selectedDoc)
    : selectedFolder
      ? folderActions(selectedFolder)
      : [];
  const selectionLabel = selectedDoc?.file_name || selectedFolder?.title || '';

  const loadingMore = loading && page > 0;

  const chips = useMemo(
    () => [
      { value: 'all' as const, label: 'All documents', count: counts ? Object.values(counts).reduce((a, b) => a + b, 0) : null },
      ...DOCUMENT_INDEX_SOURCES.map((item) => ({
        value: item,
        label: DOCUMENT_SOURCE_LABELS[item],
        count: counts ? counts[item] : null,
      })),
    ],
    [counts],
  );

  const sortIndicator = (column: DocumentIndexSort) =>
    sort === column ? <span className="ml-1 text-xs">{ascending ? '▲' : '▼'}</span> : null;

  const activeChip = chips.find((chip) => chip.value === source) ?? chips[0];

  type Crumb = { id: string; label: string; onNavigate: () => void; actions: RowAction[] };

  const crumbs: Crumb[] = [
    {
      id: 'section',
      label: activeChip.label,
      onNavigate: () => {
        setCaseKey(null);
        setFolderTrail([]);
        setOfficeSpaceKey(null);
        setPage(0);
      },
      actions: createActions,
    },
    ...(activeOfficeSpace
      ? [
          {
            id: `office-${activeOfficeSpace.scopeKey}`,
            label: activeOfficeSpace.label,
            onNavigate: () => setPage(0),
            actions: createActions,
          },
        ]
      : []),
    ...(caseKey
      ? [
          {
            id: `case-${caseKey}`,
            label: caseKey,
            onNavigate: () => {
              setFolderTrail([]);
              setPage(0);
            },
            actions: [
              ...createActions,
              {
                id: 'open-case',
                label: `Open case ${caseKey}`,
                icon: BriefcaseIcon,
                onSelect: () => navigate(`/clients/${caseKey}`),
              },
            ],
          },
        ]
      : []),
    ...folderTrail.map((folder, index) => ({
      id: folder.id,
      label: folder.title,
      onNavigate: () => {
        setFolderTrail((trail) => trail.slice(0, index + 1));
        setPage(0);
      },
      actions: [...createActions, ...folderActions(folder).filter((a) => a.id !== 'open')],
    })),
  ];

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-gray-100 dark:bg-base-300">
      <div className="flex shrink-0 flex-wrap items-center gap-3 px-2 py-3 md:px-4 md:py-4">
        {/* Width matches the side panel plus its gutter, so the search lines up with the table. */}
        {/* Without the back button the width matches the side panel, so the search lines up. */}
        <div
          className={`flex shrink-0 items-center gap-1.5 px-4 ${
            returnTo ? 'gap-3' : 'md:w-[14.75rem] lg:w-[15.75rem]'
          }`}
        >
          {returnTo ? (
            <button
              type="button"
              className="btn btn-sm shrink-0 gap-1 rounded-full border border-base-300 bg-white pl-2 pr-3 font-medium text-base-content/70 shadow-sm hover:bg-base-200 dark:bg-base-100"
              onClick={() => navigate(returnTo)}
              title={requestedCase ? `Back to lead ${requestedCase}` : 'Back to the lead'}
            >
              <ArrowLeftIcon className="h-5 w-5 shrink-0" aria-hidden />
              <span className="max-w-[9rem] truncate">{requestedCase || 'Back'}</span>
            </button>
          ) : null}
          <span className="text-2xl font-semibold tracking-tight text-primary">RMQ</span>
          <span className="text-2xl font-normal tracking-tight text-base-content/70">Drive</span>
        </div>
        <label className="input flex h-11 flex-1 items-center gap-2 rounded-full border-none bg-base-200/70 md:max-w-2xl">
          <MagnifyingGlassIcon className="h-5 w-5 text-base-content/40" />
          <input
            type="search"
            className="grow bg-transparent"
            placeholder="Search in Documents"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </label>
        <RowActionsMenu
          actions={createActions}
          align="end"
          ariaLabel="Create or upload"
          triggerClassName="btn h-11 shrink-0 gap-2 rounded-2xl border border-base-300 bg-white pl-3 pr-4 text-base font-medium text-base-content shadow-sm hover:bg-base-200 dark:bg-base-100"
          trigger={
            <>
              <PlusIcon className="h-7 w-7" />
              New
            </>
          }
        />
        <div className="flex min-w-0 shrink-0 items-center gap-2">
          <select
            className="select h-11 min-h-0 w-[11rem] rounded-2xl border-none bg-transparent text-sm font-medium text-base-content/70 shadow-none transition-colors hover:bg-base-200/70 focus:outline-none"
            value={category}
            aria-label="Filter by category"
            onChange={(e) => {
              setCategory(e.target.value);
              setPage(0);
            }}
          >
            <option value="">All categories</option>
            {categoryOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>

          <div className="flex h-11 shrink-0 items-center gap-1.5 rounded-2xl px-3 transition-colors hover:bg-base-200/70">
            <CalendarDaysIcon className="h-5 w-5 shrink-0 text-base-content/40" />
            <input
              type="date"
              className="w-[7.5rem] bg-transparent text-sm text-base-content/70 focus:outline-none"
              value={dateFrom}
              max={dateTo || undefined}
              aria-label="From date"
              onChange={(e) => {
                setDateFrom(e.target.value);
                setPage(0);
              }}
            />
            <span className="shrink-0 text-base-content/30">–</span>
            <input
              type="date"
              className="w-[7.5rem] bg-transparent text-sm text-base-content/70 focus:outline-none"
              value={dateTo}
              min={dateFrom || undefined}
              aria-label="To date"
              onChange={(e) => {
                setDateTo(e.target.value);
                setPage(0);
              }}
            />
          </div>

          {narrowed && (
            <button
              type="button"
              className="btn btn-ghost btn-circle shrink-0 text-base-content/60 hover:bg-base-200"
              title="Clear filters"
              aria-label="Clear filters"
              onClick={() => {
                setCategory('');
                setDateFrom('');
                setDateTo('');
                setPage(0);
              }}
            >
              <XMarkIcon className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 items-stretch px-2 pb-3 md:px-4 md:pb-4">
        <aside className="hidden w-56 shrink-0 flex-col gap-1 overflow-y-auto pr-3 md:flex lg:w-60">
          {chips.map((chip) => {
            const Icon = SOURCE_ICON[chip.value];
            const active = source === chip.value;
            // Office holds one space per department, so it opens up rather than just filtering.
            const expandable = chip.value === 'office' && officeSpaces.length > 1;
            return (
              <React.Fragment key={chip.value}>
                <div
                  className={`group flex items-center gap-1 rounded-full pr-3 transition-colors hover:bg-base-300 ${
                    active && !activeOfficeSpace ? 'bg-primary/10' : ''
                  }`}
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-full px-4 py-2.5 text-left text-sm"
                    onClick={() => {
                      // Office is only a container for its spaces, so it opens rather than filters.
                      if (expandable) {
                        setOfficeOpen((prev) => !prev);
                        return;
                      }
                      setSource(chip.value);
                      setOfficeSpaceKey(null);
                      setPage(0);
                    }}
                  >
                    <Icon className="h-6 w-6 shrink-0 text-base-content" />
                    <span
                      className={`flex-1 truncate text-base-content/50 group-hover:text-base-content ${
                        active ? 'font-semibold' : ''
                      }`}
                    >
                      {chip.label}
                    </span>
                  </button>
                  {expandable && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs btn-circle shrink-0 text-base-content/50 hover:bg-base-300 hover:text-base-content"
                      aria-label={officeOpen ? 'Hide office spaces' : 'Show office spaces'}
                      aria-expanded={officeOpen}
                      onClick={() => setOfficeOpen((prev) => !prev)}
                    >
                      <ChevronRightIcon
                        className={`h-4 w-4 transition-transform ${officeOpen ? 'rotate-90' : ''}`}
                      />
                    </button>
                  )}
                  {chip.count != null && (
                    <span
                      className={`badge badge-sm shrink-0 border-none tabular-nums ${
                        active ? 'bg-primary/15 text-primary' : 'bg-base-300/80 text-base-content/50'
                      }`}
                    >
                      {chip.count.toLocaleString()}
                    </span>
                  )}
                </div>
                {expandable &&
                  officeOpen &&
                  officeSpaces.map((space) => {
                    const spaceActive = activeOfficeSpace?.scopeKey === space.scopeKey;
                    return (
                      <button
                        key={space.scopeKey}
                        type="button"
                        className={`group flex items-center gap-2 rounded-full py-2 pl-11 pr-4 text-left text-sm transition-colors hover:bg-base-300 ${
                          spaceActive ? 'bg-primary/10' : ''
                        }`}
                        onClick={() => {
                          setSource('office');
                          setOfficeSpaceKey(space.scopeKey);
                          setPage(0);
                        }}
                      >
                        <FolderSolidIcon
                          className={`h-5 w-5 shrink-0 ${
                            spaceActive ? 'text-primary' : 'text-slate-500'
                          }`}
                        />
                        <span
                          className={`flex-1 truncate text-base-content/50 group-hover:text-base-content ${
                            spaceActive ? 'font-semibold' : ''
                          }`}
                        >
                          {space.label}
                        </span>
                      </button>
                    );
                  })}
              </React.Fragment>
            );
          })}
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="mb-3 flex shrink-0 gap-2 overflow-x-auto pb-1 md:hidden">
            {chips.map((chip) => (
              <button
                key={chip.value}
                type="button"
                className={`btn btn-sm shrink-0 rounded-full ${
                  source === chip.value ? 'btn-primary' : 'btn-ghost bg-base-100'
                }`}
                onClick={() => {
                  setSource(chip.value);
                  setPage(0);
                }}
              >
                {chip.label}
                {chip.count != null && (
                  <span className="ml-1 opacity-60 tabular-nums">{chip.count.toLocaleString()}</span>
                )}
              </button>
            ))}
          </div>

          {error && (
            <div className="alert alert-error mb-3 shrink-0">
              <span>{error}</span>
            </div>
          )}

          {foldersError && showFolderRows && (
            <div className="alert alert-warning mb-3 shrink-0">
              <span>Folders could not be loaded, so none are listed: {foldersError}</span>
            </div>
          )}

          {/* Only the rows scroll: the card title and the pager stay put. */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-base-200 bg-white shadow-sm dark:border-base-content/10 dark:bg-base-100">
            {/* A fixed height, so the selection bar appearing cannot push the rows down. */}
            <div className="flex h-[4.5rem] shrink-0 items-center gap-3 px-5">
              <nav className="flex min-w-0 items-center gap-1 text-lg font-semibold">
                {crumbs.length === 1 ? (
                  <h1 className="truncate text-base-content">{activeChip.label}</h1>
                ) : (
                  crumbs.map((crumb, index) => {
                    const last = index === crumbs.length - 1;
                    return (
                      <React.Fragment key={crumb.id}>
                        {index > 0 && (
                          <ChevronRightIcon className="h-4 w-4 shrink-0 text-base-content/30" />
                        )}
                        {last ? (
                          // The level you are in carries its own menu: view, zip, upload, folder.
                          <RowActionsMenu
                            actions={crumb.actions}
                            ariaLabel={`${crumb.label} actions`}
                            triggerClassName="flex min-w-0 items-center gap-1 rounded-lg px-2 py-1 transition-colors hover:bg-base-200"
                            trigger={
                              <>
                                <span className="truncate text-base-content">{crumb.label}</span>
                                <ChevronDownIcon className="h-4 w-4 shrink-0 text-base-content/40" />
                              </>
                            }
                          />
                        ) : (
                          <button
                            type="button"
                            className="max-w-[12rem] shrink-0 truncate rounded-lg px-2 py-1 text-base-content/50 transition-colors hover:bg-base-200 hover:text-base-content"
                            onClick={crumb.onNavigate}
                          >
                            {crumb.label}
                          </button>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </nav>
              {selectionActions.length > 0 && (
                <div
                  className="flex min-w-0 items-center gap-1 overflow-x-auto rounded-full bg-base-200 px-2 py-1"
                  title={selectionLabel}
                >
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm btn-circle text-base-content/60 hover:bg-base-300 hover:text-base-content"
                    aria-label="Clear selection"
                    onClick={() => setSelection(null)}
                  >
                    <XMarkIcon className="h-5 w-5" />
                  </button>
                  <span className="hidden shrink-0 px-1 text-sm text-base-content/70 sm:inline">
                    1 selected
                  </span>
                  <span className="mx-1 h-5 w-px shrink-0 bg-base-300" />
                  {selectionActions
                    .filter((action) => !action.danger)
                    .map((action) => (
                      <button
                        key={action.id}
                        type="button"
                        className="btn btn-ghost btn-sm btn-circle text-base-content/60 hover:bg-base-300 hover:text-base-content"
                        title={action.label}
                        aria-label={action.label}
                        onClick={() => action.onSelect()}
                      >
                        <action.icon className="h-5 w-5" />
                      </button>
                    ))}
                  {/* Spelled out rather than left as a bare icon: a document and the folder it
                      sits in both delete through a trash can, and one click apart they are
                      impossible to tell from each other. */}
                  {selectionActions
                    .filter((action) => action.danger)
                    .map((action) => (
                      <button
                        key={action.id}
                        type="button"
                        className="btn btn-ghost btn-sm gap-1 whitespace-nowrap text-error hover:bg-error/10"
                        title={action.label}
                        onClick={() => action.onSelect()}
                      >
                        <action.icon className="h-5 w-5" />
                        <span className="hidden sm:inline">{action.label}</span>
                      </button>
                    ))}
                  <RowActionsMenu
                    actions={selectionActions}
                    align="start"
                    ariaLabel="Selection actions"
                  />
                </div>
              )}
              <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
                <span className="hidden text-sm tabular-nums text-base-content/50 lg:inline">
                  {total > 0 ? `${total.toLocaleString()} files` : ''}
                </span>
                <RowActionsMenu
                  actions={createActions}
                  ariaLabel="Add files or folders"
                  triggerClassName="btn btn-sm gap-1 rounded-full border-base-300 bg-white text-base-content/70 hover:bg-base-200 dark:bg-base-100"
                  trigger={
                    <>
                      <PlusIcon className="h-5 w-5" />
                      <span className="hidden sm:inline">Add</span>
                      <ChevronDownIcon className="h-4 w-4 opacity-60" />
                    </>
                  }
                />
                <div className="flex shrink-0 items-center gap-1 rounded-full bg-base-200 p-1">
                  {([
                    { id: 'table' as const, label: 'Table view', icon: ListBulletIcon },
                    { id: 'grid' as const, label: 'Grid view', icon: Squares2X2Icon },
                  ]).map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={`btn btn-sm rounded-full border-none transition-colors ${
                        view === option.id
                          ? 'bg-white text-base-content shadow-sm hover:bg-white dark:bg-base-100'
                          : 'bg-transparent text-base-content/50 hover:bg-base-300'
                      }`}
                      title={option.label}
                      aria-label={option.label}
                      aria-pressed={view === option.id}
                      onClick={() => setView(option.id)}
                    >
                      <option.icon className="h-5 w-5" />
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="relative flex min-h-0 flex-1 flex-col" {...listFileDropProps}>
            {fileDragOver && (
              <div className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary bg-primary/10 backdrop-blur-[1px]">
                <div className="flex flex-col items-center rounded-2xl bg-white px-10 py-6 shadow-xl dark:bg-base-100">
                  <ArrowUpTrayIcon className="h-10 w-10 text-primary" />
                  <p className="mt-3 text-base font-semibold text-base-content">
                    Drop to upload here
                  </p>
                  <p className="mt-1 max-w-xs truncate text-sm text-base-content/60">
                    {crumbs.map((crumb) => crumb.label).join(' › ')}
                  </p>
                </div>
              </div>
            )}
            {view === 'grid' ? (
              <div className="min-h-0 flex-1 overflow-auto px-4 pb-4" onScroll={handleListScroll}>
                {loading && rows.length === 0 ? (
                  <div className="py-16 text-center text-base-content/50">
                    <span className="loading loading-spinner loading-md" />
                  </div>
                ) : rows.length === 0 && folders.length === 0 && caseRows.length === 0 && !error ? (
                  <DriveEmptyPlaceholder {...emptyState} />
                ) : (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
                    {caseRows.map((item) => (
                      <button
                        key={`case-card-${item.lead_number}`}
                        type="button"
                        className="flex items-center gap-3 rounded-xl bg-base-200 px-3 py-4 text-left transition-colors hover:bg-base-300"
                        onClick={() => openCase(item.lead_number)}
                      >
                        <FolderSolidIcon className="h-7 w-7 shrink-0 text-primary" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-base-content">
                            {item.lead_number}
                          </span>
                          <span className="block truncate text-xs text-base-content/50">
                            {item.file_count.toLocaleString()} files
                          </span>
                        </span>
                      </button>
                    ))}
                    {folders.map((folder) => (
                      <button
                        key={`folder-card-${folder.id}`}
                        type="button"
                        className={`flex select-none items-center gap-3 rounded-xl px-3 py-4 text-left transition-colors ${
                          selectedFolder?.id === folder.id
                            ? 'bg-primary/15'
                            : 'bg-base-200 hover:bg-base-300'
                        }`}
                        onClick={() => setSelection({ kind: 'folder', id: folder.id })}
                        onDoubleClick={() => openFolder(folder)}
                      >
                        <FolderSolidIcon className="h-7 w-7 shrink-0 text-slate-500" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-base-content">
                            {folder.title}
                          </span>
                          <span className="block truncate text-xs text-base-content/50">
                            {folderSubtitle(folder)}
                          </span>
                        </span>
                      </button>
                    ))}
                    {rows.map((row) => {
                      const key = stableRowKey(row);
                      const uploaderKey = uploaderKeyOf(row);
                      const uploader = uploaderKey ? uploaders.get(uploaderKey) : undefined;
                      return (
                        <div
                          key={key}
                          className={`flex cursor-pointer select-none flex-col gap-3 rounded-xl p-3 transition-colors ${
                            selection?.kind === 'doc' && selection.key === key
                              ? 'bg-primary/15'
                              : 'bg-base-200 hover:bg-base-300'
                          }`}
                          onClick={() => setSelection({ kind: 'doc', key })}
                          onDoubleClick={() => void openPreview(row)}
                        >
                          <div className="flex items-center gap-2">
                            <DocumentFileGlyph
                              fileType={row.mime_type || ''}
                              fileName={row.file_name}
                              className="h-6 w-6 shrink-0"
                            />
                            <span
                              className="min-w-0 flex-1 truncate text-left text-sm font-medium text-base-content"
                              title={row.file_name}
                            >
                              {row.file_name}
                            </span>
                            <span onClick={(event) => event.stopPropagation()}>
                              <RowActionsMenu actions={rowActions(row)} />
                            </span>
                          </div>
                          {/* The thumb is portrait, so a landscape frame crops it to fill. */}
                          <span className="relative block aspect-[4/3] w-full overflow-hidden rounded-lg bg-base-300/70">
                            <span className="absolute inset-x-0 top-0 block">
                              <DocumentSidebarThumb
                                name={row.file_name}
                                url={row.storage_path}
                                fileType={row.mime_type || ''}
                                storagePath={row.storage_path}
                                bucketName={row.storage_bucket}
                              />
                            </span>
                          </span>
                          <div className="flex items-center justify-between gap-2 text-xs text-base-content/50">
                            <span className="truncate">
                              {uploader?.name || uploaderKey || row.scope_label}
                            </span>
                            <span className="shrink-0 tabular-nums">
                              {formatModified(row.created_at)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {loadingMore && (
                  <div className="py-6 text-center">
                    <span className="loading loading-spinner loading-sm text-base-content/40" />
                  </div>
                )}
              </div>
            ) : (
            <div className="min-h-0 flex-1 overflow-auto" onScroll={handleListScroll}>
              <table className="table table-pin-rows">
                <thead>
                  <tr className="border-b border-base-300 bg-white text-base-content/60 dark:bg-base-100">
                    <th className="cursor-pointer select-none font-medium" onClick={() => toggleSort('file_name')}>
                      Name{sortIndicator('file_name')}
                    </th>
                    <th
                      className="hidden cursor-pointer select-none font-medium md:table-cell"
                      onClick={() => toggleSort('scope_label')}
                    >
                      Location{sortIndicator('scope_label')}
                    </th>
                    <th className="hidden font-medium lg:table-cell">Category</th>
                    <th className="hidden font-medium lg:table-cell">Uploaded by</th>
                    <th className="cursor-pointer select-none font-medium" onClick={() => toggleSort('created_at')}>
                      Date modified{sortIndicator('created_at')}
                    </th>
                    <th className="text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {caseRows.map((item) => (
                    <tr
                      key={`case-${item.lead_number}`}
                      className="cursor-pointer border-base-300 hover:bg-base-200/40"
                      onClick={() => openCase(item.lead_number)}
                    >
                      <td className="max-w-[26rem]">
                        <span className="flex items-center gap-3">
                          <FolderSolidIcon className="h-8 w-8 shrink-0 text-primary" />
                          <span className="min-w-0 flex-1 truncate font-medium text-base-content">
                            {item.lead_number}
                          </span>
                        </span>
                      </td>
                      <td className="hidden md:table-cell">
                        <span className="badge badge-sm border-none font-medium bg-violet-100 text-violet-700">
                          Cases
                        </span>
                      </td>
                      <td className="hidden text-sm text-base-content/70 lg:table-cell">
                        {item.file_count.toLocaleString()} files
                      </td>
                      <td className="hidden lg:table-cell" />
                      <td className="whitespace-nowrap text-sm tabular-nums text-base-content/70">
                        {item.last_added ? formatModified(item.last_added) : '—'}
                      </td>
                      <td>
                        <div className="flex items-center justify-end">
                          <RowActionsMenu
                            actions={[
                              {
                                id: 'open',
                                label: 'Open case folder',
                                icon: FolderOpenIcon,
                                onSelect: () => openCase(item.lead_number),
                              },
                              {
                                id: 'open-lead',
                                label: 'Open case page',
                                icon: BriefcaseIcon,
                                onSelect: () => navigate(`/clients/${item.lead_number}`),
                              },
                            ]}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                  {folders.map((folder) => (
                    <tr
                      key={`folder-${folder.id}`}
                      className={`cursor-pointer select-none border-base-300 ${
                        dropFolderId === folder.id
                          ? 'bg-primary/15 ring-2 ring-inset ring-primary'
                          : selectedFolder?.id === folder.id
                            ? 'bg-primary/10'
                            : 'hover:bg-base-200/40'
                      } ${landedFolderId === folder.id ? 'drive-drop-land' : ''}`}
                      onClick={() => setSelection({ kind: 'folder', id: folder.id })}
                      onDoubleClick={() => openFolder(folder)}
                      {...folderDropProps(folder)}
                    >
                      <td className="max-w-[26rem]">
                        <span className="flex items-center gap-3">
                          <FolderSolidIcon className="h-8 w-8 shrink-0 text-slate-500" />
                          <span className="min-w-0 flex-1 truncate font-medium text-base-content">
                            {folder.title}
                          </span>
                        </span>
                      </td>
                      <td className="hidden md:table-cell">
                        <span className="text-sm text-base-content/70">{folder.scope_key}</span>
                      </td>
                      <td className="hidden text-sm text-base-content/70 lg:table-cell">Folder</td>
                      <td className="hidden lg:table-cell" />
                      <td className="whitespace-nowrap text-sm tabular-nums text-base-content/70">
                        {formatModified(folder.created_at)}
                      </td>
                      <td onClick={(event) => event.stopPropagation()}>
                        <div className="flex items-center justify-end">
                          <RowActionsMenu actions={folderActions(folder)} />
                        </div>
                      </td>
                    </tr>
                  ))}
                  {loading && rows.length === 0 && (
                    <tr className="hover:!bg-transparent">
                      <td colSpan={6} className="py-16 text-center text-base-content/50">
                        <span className="loading loading-spinner loading-md" />
                      </td>
                    </tr>
                  )}
                  {!loading &&
                    rows.length === 0 &&
                    folders.length === 0 &&
                    caseRows.length === 0 &&
                    !error && (
                      <tr className="hover:!bg-transparent">
                        <td colSpan={6} className="p-0">
                          <DriveEmptyPlaceholder {...emptyState} />
                        </td>
                      </tr>
                    )}
                  {rows.map((row) => {
                    const key = stableRowKey(row);
                    const uploaderKey = uploaderKeyOf(row);
                    const uploader = uploaderKey ? uploaders.get(uploaderKey) : undefined;
                    const busy = busyKey === key;
                    return (
                      <tr
                        key={key}
                        className={`cursor-pointer select-none border-base-300 ${
                          selection?.kind === 'doc' && selection.key === key
                            ? 'bg-primary/10'
                            : 'hover:bg-base-200/40'
                        } ${dragKey === key ? 'opacity-40' : ''}`}
                        draggable={isMovableDocument(row)}
                        onClick={() => setSelection({ kind: 'doc', key })}
                        onDoubleClick={() => void openPreview(row)}
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = 'move';
                          event.dataTransfer.setData('text/plain', row.file_name);
                          setDragKey(key);
                          setSelection({ kind: 'doc', key });
                        }}
                        onDragEnd={() => {
                          setDragKey(null);
                          setDropFolderId(null);
                        }}
                      >
                        <td className="max-w-[26rem]">
                          <span className="flex w-full items-center gap-3">
                            <DocumentFileGlyph
                              fileType={row.mime_type || ''}
                              fileName={row.file_name}
                              className="h-8 w-8 shrink-0"
                            />
                            <span className="min-w-0 truncate font-medium text-base-content">
                              {row.file_name}
                            </span>
                          </span>
                        </td>
                        <td className="hidden md:table-cell">
                          <div className="flex items-center gap-2">
                            <span
                              className={`badge badge-sm border-none font-medium ${SOURCE_BADGE[row.source]}`}
                            >
                              {DOCUMENT_SOURCE_LABELS[row.source]}
                            </span>
                            {row.source === 'lead' && row.scope_key ? (
                              <button
                                type="button"
                                className="link link-hover text-sm"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  navigate(`/clients/${row.scope_key}`);
                                }}
                              >
                                {row.scope_label}
                              </button>
                            ) : (
                              <span className="max-w-[12rem] truncate text-sm text-base-content/70">
                                {row.scope_label}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="hidden text-sm text-base-content/70 lg:table-cell">
                          {row.category || '—'}
                        </td>
                        <td className="hidden lg:table-cell">
                          {uploader || uploaderKey ? (
                            <DocumentUploaderCell
                              name={uploader?.name || uploaderKey}
                              photoUrl={uploader?.photoUrl}
                              isClientPortalUpload={uploaderKey === 'portal-client'}
                            />
                          ) : (
                            <span className="text-sm text-base-content/40">—</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap text-sm tabular-nums text-base-content/70">
                          {formatModified(row.created_at)}
                        </td>
                        <td onClick={(event) => event.stopPropagation()}>
                          <div className="flex items-center justify-end">
                            <RowActionsMenu disabled={busy} actions={rowActions(row)} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {loadingMore && (
                    <tr className="hover:!bg-transparent">
                      <td colSpan={6} className="py-6 text-center">
                        <span className="loading loading-spinner loading-sm text-base-content/40" />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            )}
            </div>
          </div>
        </div>
      </div>

      {createMode && (
        <DocumentsDriveCreateModal
          mode={createMode}
          context={createContext}
          initialEntries={droppedEntries ?? undefined}
          onClose={() => {
            setCreateMode(null);
            setDroppedEntries(null);
          }}
          onDone={(created) => {
            setCreateMode(null);
            setDroppedEntries(null);
            setCreatedNonce((prev) => prev + 1);
            reload();
            // A document that was just created is meant to be written in, so open its editor.
            const made = created?.[0];
            if (made && isOfficeEditableFile(made.fileName)) void openCreatedForEditing(made);
          }}
        />
      )}

      {viewerDocs && viewerDocs.length > 0 && (
        <DocumentViewerModal
          isOpen
          onClose={() => {
            setViewerDocs(null);
            setViewerAutoEdit(false);
          }}
          documents={viewerDocs}
          initialIndex={0}
          bucketName={viewerDocs[0].storageBucket || undefined}
          autoStartOfficeEdit={viewerAutoEdit}
          onOfficeSaved={() => reload()}
        />
      )}

      {moveRow && (
        <MoveDocumentDialog
          row={moveRow}
          onClose={() => setMoveRow(null)}
          onMoved={() => {
            setMoveRow(null);
            reload();
          }}
        />
      )}

      {accessRow?.folder_id && (
        <FolderAccessDialog
          folderId={accessRow.folder_id}
          folderPath={accessRow.folder_path || 'Folder'}
          onClose={() => setAccessRow(null)}
        />
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-base-100 shadow-2xl">
            <div className="flex items-start gap-3 px-5 py-5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-error/10">
                <TrashIcon className="h-5 w-5 text-error" />
              </span>
              <div className="min-w-0">
                <h2 className="text-lg font-semibold">
                  {deleteTarget.kind === 'doc' ? 'Delete this document?' : 'Delete this folder?'}
                </h2>
                <p className="mt-1 break-words text-sm text-base-content/70">
                  {deleteTarget.kind === 'doc'
                    ? deleteTarget.row.file_name
                    : deleteTarget.folder.title}
                </p>
                <p className="mt-3 text-sm text-base-content/60">
                  {deleteTarget.kind === 'doc'
                    ? 'The file and its record go for good. This cannot be undone.'
                    : 'Any folders inside go with it. The files are kept, and move back out to the list around it.'}
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-base-300 px-5 py-4">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={deleting}
                onClick={() => setDeleteTarget(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-error btn-sm"
                disabled={deleting}
                onClick={() => void confirmDelete()}
              >
                {deleting && <span className="loading loading-spinner loading-xs" />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/** Moves one case document into another folder of the same lead, tab and area. */
const MoveDocumentDialog: React.FC<{
  row: DocumentIndexRow;
  onClose: () => void;
  onMoved: () => void;
}> = ({ row, onClose, onMoved }) => {
  const scope = scopeOf(row);
  const [folders, setFolders] = useState<DocumentFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [target, setTarget] = useState<string | null>(row.folder_id);

  useEffect(() => {
    if (!scope) return;
    let cancelled = false;
    setLoading(true);
    listDocumentFolders(scope)
      .then((next) => {
        if (!cancelled) setFolders(next);
      })
      .catch((err: any) => toast.error(err?.message || 'Could not load folders'))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.row_id]);

  // Parents before children, so the indent reads as a tree.
  const ordered = useMemo(() => {
    const out: Array<{ folder: DocumentFolder; depth: number }> = [];
    const walk = (parentId: string | null, depth: number) => {
      for (const folder of childFolders(folders, parentId)) {
        out.push({ folder, depth });
        walk(folder.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [folders]);

  const save = async () => {
    setSaving(true);
    try {
      await moveCaseDocumentsToFolder([row.row_id], target);
      toast.success('Moved');
      onMoved();
    } catch (err: any) {
      toast.error(err?.message || 'Could not move this file');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-base-100 shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-base-300 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">Move file</h2>
            <p className="mt-0.5 truncate text-sm text-base-content/60">{row.file_name}</p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm btn-square" onClick={onClose}>
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[50vh] overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="py-8 text-center">
              <span className="loading loading-spinner loading-md" />
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <label className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-base-200 cursor-pointer">
                <input
                  type="radio"
                  className="radio radio-sm radio-primary"
                  checked={target === null}
                  onChange={() => setTarget(null)}
                />
                <span className="text-sm font-medium">All files (no folder)</span>
              </label>
              {ordered.map(({ folder, depth }) => (
                <label
                  key={folder.id}
                  className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-base-200 cursor-pointer"
                  style={{ paddingLeft: `${0.5 + depth * 1.25}rem` }}
                >
                  <input
                    type="radio"
                    className="radio radio-sm radio-primary"
                    checked={target === folder.id}
                    onChange={() => setTarget(folder.id)}
                  />
                  <FolderSolidIcon className="h-4 w-4 shrink-0 text-slate-500" />
                  <span className="truncate text-sm">{folder.title}</span>
                </label>
              ))}
              {ordered.length === 0 && (
                <p className="py-6 text-center text-sm text-base-content/50">
                  This case has no folders yet. Create one from the case documents drawer.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-base-300 px-5 py-4">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={saving || loading || target === row.folder_id}
            onClick={() => void save()}
          >
            {saving ? <span className="loading loading-spinner loading-xs" /> : 'Move'}
          </button>
        </div>
      </div>
    </div>
  );
};

/** Admin-only. A folder with no grants is open to all staff; the first grant locks it down. */
const FolderAccessDialog: React.FC<{
  folderId: string;
  folderPath: string;
  onClose: () => void;
}> = ({ folderId, folderPath, onClose }) => {
  const [grants, setGrants] = useState<DocumentFolderGrant[]>([]);
  const [employees, setEmployees] = useState<ActiveStaffEmployee[]>([]);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [subjectKind, setSubjectKind] = useState<'employee' | 'department' | 'role'>('employee');
  const [subjectValue, setSubjectValue] = useState('');
  const [canEdit, setCanEdit] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setGrants(await fetchFolderGrants(folderId));
    } catch (err: any) {
      toast.error(err?.message || 'Could not load folder access');
    } finally {
      setLoading(false);
    }
  }, [folderId]);

  useEffect(() => {
    void reload();
    fetchActiveStaffEmployees().then(setEmployees).catch(() => setEmployees([]));
    fetchDepartmentOptions().then(setDepartments).catch(() => setDepartments([]));
  }, [reload]);

  const employeeNames = useMemo(
    () => new Map(employees.map((employee) => [employee.id, employee.display_name])),
    [employees],
  );
  const departmentNames = useMemo(
    () => new Map(departments.map((department) => [department.id, department.name])),
    [departments],
  );

  const add = async () => {
    if (!subjectValue) {
      toast.error('Pick who this is for');
      return;
    }
    setSaving(true);
    try {
      const actor = await fetchStageActorInfo();
      await addFolderGrant({
        folderId,
        employeeId: subjectKind === 'employee' ? Number(subjectValue) : null,
        departmentId: subjectKind === 'department' ? Number(subjectValue) : null,
        role: subjectKind === 'role' ? subjectValue : null,
        canEdit,
        grantedByEmployeeId: actor.employeeId,
      });
      setSubjectValue('');
      setCanEdit(false);
      await reload();
    } catch (err: any) {
      toast.error(err?.message || 'Could not add this permission');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-xl rounded-2xl bg-base-100 shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-base-300 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">Folder access</h2>
            <p className="mt-0.5 flex items-center gap-1 truncate text-sm text-base-content/60">
              <FolderSolidIcon className="h-4 w-4 shrink-0 text-slate-500" />
              {folderPath}
            </p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm btn-square" onClick={onClose}>
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[55vh] overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="py-8 text-center">
              <span className="loading loading-spinner loading-md" />
            </div>
          ) : grants.length === 0 ? (
            <div className="rounded-xl bg-base-200 px-4 py-4 text-sm text-base-content/70">
              <span className="flex items-center gap-2 font-medium text-base-content">
                <LockClosedIcon className="h-4 w-4" />
                Open to all staff
              </span>
              <p className="mt-1">
                Adding the first permission restricts this folder and everything inside it to the
                people you list. Admins always keep access.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-base-200">
              {grants.map((grant) => (
                <li key={grant.id} className="flex items-center gap-3 py-3">
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {describeGrantSubject(grant, employeeNames, departmentNames)}
                  </span>
                  <label className="flex items-center gap-2 text-xs text-base-content/70">
                    <input
                      type="checkbox"
                      className="toggle toggle-xs toggle-primary"
                      checked={grant.can_edit}
                      onChange={async (e) => {
                        try {
                          await setFolderGrantCanEdit(grant.id, e.target.checked);
                          await reload();
                        } catch (err: any) {
                          toast.error(err?.message || 'Could not update this permission');
                        }
                      }}
                    />
                    Can edit
                  </label>
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs btn-square"
                    title="Remove"
                    onClick={async () => {
                      try {
                        await removeFolderGrant(grant.id);
                        await reload();
                      } catch (err: any) {
                        toast.error(err?.message || 'Could not remove this permission');
                      }
                    }}
                  >
                    <XMarkIcon className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 rounded-xl border border-base-300 p-4">
            <h3 className="text-sm font-semibold">Give access to</h3>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <select
                className="select select-bordered select-sm sm:w-36"
                value={subjectKind}
                onChange={(e) => {
                  setSubjectKind(e.target.value as 'employee' | 'department' | 'role');
                  setSubjectValue('');
                }}
              >
                <option value="employee">Person</option>
                <option value="department">Department</option>
                <option value="role">Role</option>
              </select>
              <select
                className="select select-bordered select-sm flex-1"
                value={subjectValue}
                onChange={(e) => setSubjectValue(e.target.value)}
              >
                <option value="">Select…</option>
                {subjectKind === 'employee' &&
                  employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.display_name}
                    </option>
                  ))}
                {subjectKind === 'department' &&
                  departments.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                    </option>
                  ))}
                {subjectKind === 'role' &&
                  DOCUMENT_ACCESS_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
              </select>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="toggle toggle-sm toggle-primary"
                  checked={canEdit}
                  onChange={(e) => setCanEdit(e.target.checked)}
                />
                Can edit, not just view
              </label>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={saving || !subjectValue}
                onClick={() => void add()}
              >
                {saving ? <span className="loading loading-spinner loading-xs" /> : 'Add'}
              </button>
            </div>
          </div>
        </div>

        <div className="flex justify-end border-t border-base-300 px-5 py-4">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

export default DocumentsDrivePage;
