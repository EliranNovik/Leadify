import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  ArchiveBoxArrowDownIcon,
  ArrowDownTrayIcon,
  ArrowLeftIcon,
  ArrowRightCircleIcon,
  ArrowUpTrayIcon,
  Bars3Icon,
  BriefcaseIcon,
  BuildingOffice2Icon,
  CalendarDaysIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  DocumentDuplicateIcon,
  EllipsisVerticalIcon,
  EyeIcon,
  EyeSlashIcon,
  FolderArrowDownIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  FunnelIcon,
  IdentificationIcon,
  ListBulletIcon,
  LockClosedIcon,
  MagnifyingGlassIcon,
  PencilSquareIcon,
  PlusIcon,
  ShareIcon,
  ShieldCheckIcon,
  SparklesIcon,
  Squares2X2Icon,
  TrashIcon,
  UserIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import {
  EyeSlashIcon as EyeSlashSolidIcon,
  FolderIcon as FolderSolidIcon,
  FolderOpenIcon as FolderOpenSolidIcon,
} from '@heroicons/react/24/solid';
import { supabase } from '../lib/supabase';
import { DocumentFileGlyph, ExcelLogoIcon, WordLogoIcon } from '../lib/documentFileGlyphs';
import DocumentSidebarThumb from '../components/DocumentSidebarThumb';
import { RmqDriveLogo } from '../components/RmqDriveLogo';
import { RmqAiLogo, RMQ_AI_HEADER_LOGO_SRC } from '../components/RmqAiLogo';
import { openRmqAiChat } from '../lib/rmqAiPendingPrompt';
import {
  rmqAiDriveDocumentFromRow,
  setRmqAiDriveDocument,
  setRmqAiDriveView,
} from '../lib/rmqAiDriveContext';
import DocumentsDriveCreateModal, {
  type DriveCreateContext,
  type DriveCreateMode,
} from '../components/DocumentsDriveCreateModal';
import { isOfficeEditableFile } from '../lib/officeOnlineEdit';
import type { DriveCreatedFile } from '../lib/documentDriveUpload';
import DocumentViewerModal, { type DocumentViewerItem } from '../components/DocumentViewerModal';
import { DocumentUploaderCell } from '../components/caseDocumentsModalUi';
import { DocumentShareDialog } from '../components/share/DocumentShareMenu';
import { documentIndexShareTarget } from '../lib/documentShareTargets';
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
  buildDepartmentColours,
  CASE_DEPARTMENT_OTHER,
  fetchCaseLeadInfo,
  fetchCaseLeadRoute,
  fetchDepartmentCaseLeadNumbers,
  findLeadNumbersByPerson,
  type CaseDepartmentKey,
  type CaseLeadInfo,
} from '../lib/caseDepartments';
import {
  setCaseDocumentsClientVisible,
  setDocumentFolderClientVisible,
} from '../lib/clientVisibleDocuments';
import { fetchMainDepartments, type MainDepartment } from '../lib/mainDepartments';
import {
  deleteOfficeDocumentFolder,
  fetchOfficeDocumentFolders,
  moveOfficeDocumentFolder,
  moveOfficeDocumentsToFolder,
  renameOfficeDocumentFolder,
} from '../lib/officeDocuments';
import {
  deleteEmployeePersonalFolder,
  fetchEmployeePersonalFolders,
  moveEmployeePersonalFilesToFolder,
  moveEmployeePersonalFolder,
  renameEmployeePersonalFolder,
} from '../lib/employeePersonalSpace';
import {
  MAX_SPACE_FOLDER_DEPTH,
  spaceFolderDepth,
  spaceFolderPath,
  type SpaceFolderNode,
} from '../lib/spaceFolders';
import {
  canFileDocumentInFolder,
  createDocumentIndexSignedUrl,
  DOCUMENT_INDEX_PAGE_SIZE,
  fetchAllDocumentIndexCases,
  createDocumentIndexSignedUrls,
  deleteDocumentIndexRow,
  DOCUMENT_INDEX_SOURCES,
  DOCUMENT_SOURCE_LABELS,
  fetchDocumentIndex,
  fetchDocumentIndexCases,
  fetchDocumentIndexCategories,
  fetchDocumentIndexCounts,
  fetchDocumentsInFolder,
  formatDocumentSize,
  hasDocumentIndexFilters,
  hasStoredFile,
  isMovableDocument,
  nextDocumentIndexPage,
  renameDocumentIndexRow,
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
  MAX_DOCUMENT_FOLDER_DEPTH,
  moveCaseDocumentsToFolder,
  moveDocumentFolder,
  renameDocumentFolder,
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

/** Who uploaded a file and when are context, not the thing you are reading, so both stay grey. */
const MUTED_CELL_CLASS = 'text-gray-500 dark:text-base-content/60';
const UPLOADER_NAME_CLASS = `font-normal ${MUTED_CELL_CLASS}`;

/**
 * Where you are in the sections list, in the turquoise of the drive's mark. Written as plain rgba
 * rather than a themed colour so it stays the mark's turquoise under every theme, and spelled out
 * in full because daisyUI's palette tokens drop the opacity modifier.
 */
const NAV_ACTIVE_BG = 'bg-[rgba(34,211,238,0.16)]';
const NAV_ACTIVE_BADGE = 'bg-[rgba(34,211,238,0.28)]';
/** Turquoise reads thin on white, so the text leans a few shades darker than the mark itself. */
const NAV_ACTIVE_TEXT = 'text-[#0e8da6] dark:text-[#22d3ee]';

function formatModified(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Where a file sits inside its case or space, written the same way for both. A case folder joins
 * its path with a bare slash and a space's folder joins its with a spaced one, which is a
 * difference in the stores rather than anything a reader should have to see.
 */
function folderPathLabel(path: string): string {
  return path
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' / ');
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
  | { kind: 'docs'; rows: DocumentIndexRow[] }
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
    <span className="flex h-24 w-24 items-center justify-center rounded-3xl bg-base-200">
      <Icon className="h-14 w-14 text-slate-400" />
    </span>
    <p className="mt-5 text-base font-medium text-base-content/70">{title}</p>
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
    // No client ever sees these spaces, so there is nothing to hide from one.
    client_visible: true,
  };
}

/**
 * The icon of a file or folder the client portal will not show, with a struck-through eye in its
 * corner. Hidden is the exception, so it is what gets marked — a visible file carries no badge.
 */
const HiddenFromClientMark: React.FC = () => (
  <span
    className="pointer-events-none absolute -right-2 -top-2 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-rose-500 shadow-sm ring-2 ring-base-100"
    title="Hidden from the client portal"
  >
    <EyeSlashSolidIcon className="h-3 w-3 text-white" />
  </span>
);

/** Whether this is something the client portal could show, and so something to hide. */
function canHideFromClient(row: DocumentIndexRow): boolean {
  return row.source === 'lead';
}

/**
 * Loading rows shaped like the rows they are standing in for, so a list arrives rather than
 * appearing out of a spinner.
 */
const SkeletonBar: React.FC<{ className?: string }> = ({ className = '' }) => (
  <span className={`block animate-pulse rounded-full bg-base-200 ${className}`} aria-hidden />
);

const DriveSkeletonRows: React.FC<{ count?: number }> = ({ count = 10 }) => (
  <>
    {Array.from({ length: count }).map((_, index) => (
      <tr key={`skeleton-row-${index}`} className="border-base-300 hover:!bg-transparent">
        <td className="max-w-[26rem]">
          <span className="flex items-center gap-3">
            <SkeletonBar className="h-7 w-7 rounded-lg" />
            {/* Uneven widths, since a column of identical bars reads as a pattern. */}
            <SkeletonBar className={index % 3 === 0 ? 'h-3.5 w-56' : 'h-3.5 w-40'} />
          </span>
        </td>
        <td className="hidden md:table-cell">
          <SkeletonBar className="h-3 w-24" />
        </td>
        <td className="hidden lg:table-cell">
          <SkeletonBar className="h-3 w-20" />
        </td>
        <td className="hidden lg:table-cell">
          <SkeletonBar className="h-3 w-28" />
        </td>
        <td>
          <SkeletonBar className="h-3 w-20" />
        </td>
        <td>
          <span className="flex justify-end">
            <SkeletonBar className="h-6 w-6" />
          </span>
        </td>
      </tr>
    ))}
  </>
);

const DriveSkeletonCards: React.FC<{ count?: number }> = ({ count = 8 }) => (
  <>
    {Array.from({ length: count }).map((_, index) => (
      <div
        key={`skeleton-card-${index}`}
        className="flex items-center gap-3 rounded-xl bg-base-200/50 px-3 py-4"
      >
        <SkeletonBar className="h-7 w-7 rounded-lg bg-base-300" />
        <span className="flex min-w-0 flex-1 flex-col gap-2">
          <SkeletonBar className="h-3 w-3/4 bg-base-300" />
          <SkeletonBar className="h-2.5 w-1/3 bg-base-300" />
        </span>
      </div>
    ))}
  </>
);

/** What a hover preview lists: the folders inside first, then the files. */
type FolderPeekItems = { folders: string[]; documents: string[]; more: number };

/** What is being rested on: a folder, a whole case, or a single document. */
type PeekTarget =
  | { kind: 'folder'; id: string; title: string; folder: DocumentFolder }
  | { kind: 'case'; id: string; title: string; leadNumber: string }
  | { kind: 'doc'; id: string; title: string; row: DocumentIndexRow };

/** The department a case belongs to, as a dot in front of its folder. */
const CaseDepartmentDot: React.FC<{
  info?: CaseLeadInfo;
  colours: Map<CaseDepartmentKey, string>;
}> = ({ info, colours }) => (
  <span
    className={`h-2.5 w-2.5 shrink-0 rounded-full ${
      info ? colours.get(info.department) || 'bg-slate-400' : 'bg-base-300'
    }`}
    title={info?.departmentName || undefined}
    aria-hidden
  />
);

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

/** Whether two documents share one folder tree: the same case, the same tab and the same area. */
function sameFolderScope(
  a: DocumentFolderScope | null,
  b: DocumentFolderScope | null,
): boolean {
  return (
    !!a &&
    !!b &&
    a.scopeKey === b.scopeKey &&
    a.classificationId === b.classificationId &&
    a.area === b.area
  );
}

const DocumentsDrivePage: React.FC<{ onOpenAppNav?: () => void }> = ({ onOpenAppNav }) => {
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
  /** The category and date filters, which live behind the funnel in the search bar. */
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Cases are what the drive is opened for nearly every time, so that is where it opens.
  const [source, setSource] = useState<DocumentIndexSource | 'all'>('lead');
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
  /** Which department's cases are listed, or null for every case. */
  const [caseDepartment, setCaseDepartment] = useState<CaseDepartmentKey | null>(null);
  const [departments, setDepartments] = useState<MainDepartment[]>([]);
  /** Client name and department per listed case, which the case list itself does not carry. */
  const [caseInfo, setCaseInfo] = useState<Map<string, CaseLeadInfo>>(new Map());
  /**
   * Cases whose lead has been looked for, found or not. Some case numbers answer to no lead at
   * all, and without this they would be left waiting on a lookup that already came back empty.
   */
  const [caseInfoTried, setCaseInfoTried] = useState<Set<string>>(new Set());
  const [folderTrail, setFolderTrail] = useState<DocumentFolder[]>([]);
  const [folders, setFolders] = useState<DocumentFolder[]>([]);
  /** Why the folder list is empty, when it is empty because the read failed. */
  const [foldersError, setFoldersError] = useState<string | null>(null);
  const [createMode, setCreateMode] = useState<DriveCreateMode | null>(null);
  const [droppedEntries, setDroppedEntries] = useState<FolderUploadEntry[] | null>(null);
  const [fileDragOver, setFileDragOver] = useState(false);
  const [createdNonce, setCreatedNonce] = useState(0);
  const [viewerDocs, setViewerDocs] = useState<DocumentViewerItem[] | null>(null);
  /** Which of them the viewer opens on, since it opens on the file that was asked for. */
  const [viewerIndex, setViewerIndex] = useState(0);
  /** The listed rows behind the viewer's files, so a rename in there knows what to write to. */
  const [viewerRows, setViewerRows] = useState<DocumentIndexRow[]>([]);
  /** Set only for a document created a moment ago, which opens straight into its editor. */
  const [viewerAutoEdit, setViewerAutoEdit] = useState(false);
  /** Which file the viewer is showing, which changes as it is paged through. */
  const [viewerActiveId, setViewerActiveId] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [moveRows, setMoveRows] = useState<DocumentIndexRow[] | null>(null);
  /** The document being renamed from the row menu, and the name being typed for it. */
  const [renameRow, setRenameRow] = useState<DocumentIndexRow | null>(null);
  /** The folder being renamed, which is one somebody made rather than a case's own folder. */
  const [renameFolder, setRenameFolder] = useState<DocumentFolder | null>(null);
  const [transfer, setTransfer] = useState<{
    mode: 'copy' | 'move';
    rows: DocumentIndexRow[];
  } | null>(null);
  /** The document whose share options are open, from the row menu. */
  const [shareRow, setShareRow] = useState<DocumentIndexRow | null>(null);
  /** The document whose AI summary is open in the side panel. */
  const [summaryRow, setSummaryRow] = useState<DocumentIndexRow | null>(null);
  const [accessRow, setAccessRow] = useState<DocumentIndexRow | null>(null);
  /** What the delete confirmation is asking about — superusers only. */
  const [deleteTarget, setDeleteTarget] = useState<DriveDeleteTarget>(null);
  const [deleting, setDeleting] = useState(false);
  /** Who is signed in, which is whose folders the My space section browses. */
  const [employeeId, setEmployeeId] = useState<number | null>(null);
  const [selection, setSelection] = useState<DriveSelection>(null);
  /**
   * The several documents picked out together, by their stable key, which fills up as rows are
   * clicked with Command or Control held. It is empty whenever a single row is the selection, so
   * the list is either on one row or on a group of them and never on both.
   */
  const [checkedKeys, setCheckedKeys] = useState<Set<string>>(new Set());
  /** The row being dragged within the list, which is a document or a folder of its own. */
  const [dragging, setDragging] = useState<DriveSelection>(null);
  const [dropFolderId, setDropFolderId] = useState<string | null>(null);
  const [landedFolderId, setLandedFolderId] = useState<string | null>(null);
  /** What is being rested on, and where its preview sits. */
  const [peek, setPeek] = useState<{ target: PeekTarget; top: number; left: number } | null>(null);
  const [peekItems, setPeekItems] = useState<FolderPeekItems | null>(null);
  const peekCache = useRef(new Map<string, FolderPeekItems>());
  const peekTimer = useRef<number | null>(null);

  const reloadToken = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(0);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  // Cases browse like a drive: cases, then their folders, then the files. Every other section is
  // a flat list.
  /**
   * A search looks through the whole drive. The section, the open case, the open folder and the
   * department all stop applying while there is a term — only the category and date filters on
   * the side still narrow what comes back, so a file can be found without knowing where it is.
   */
  const searching = search.length > 0;
  const inCasesTree = source === 'lead';
  // The view knows a case only by its number, so the people behind it — the client and the
  // contacts, by name, email or phone — are looked up separately and their cases joined in.
  const [searchCaseKeys, setSearchCaseKeys] = useState<string[]>([]);

  useEffect(() => {
    if (search.length < 2) {
      setSearchCaseKeys([]);
      return;
    }
    let cancelled = false;
    void findLeadNumbersByPerson(search)
      .then((keys) => {
        if (!cancelled) setSearchCaseKeys(keys);
      })
      .catch(() => {
        if (!cancelled) setSearchCaseKeys([]);
      });
    return () => {
      cancelled = true;
    };
  }, [search]);

  /**
   * A search in Cases answers with case folders, not with a flat list of files: what you are
   * after there is the client's case, and the files are one click inside it. Every other section
   * has nothing to group by, so a search there lists the documents themselves.
   */
  const showCaseList = inCasesTree && !caseKey;
  const activeFolder = folderTrail.length > 0 ? folderTrail[folderTrail.length - 1] : null;

  // Office is split per department, and the sidebar sub-item narrows the list to one space.
  const activeOfficeSpace =
    source === 'office' && officeSpaceKey
      ? officeSpaces.find((space) => space.scopeKey === officeSpaceKey) ?? null
      : null;
  /** Every section but meetings browses into folders, since meetings store none. */
  const inPersonalSpace = source === 'personal';
  const showFolderRows =
    !searching && ((inCasesTree && !!caseKey) || !!activeOfficeSpace || inPersonalSpace);
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
      searchScopeKeys: searchCaseKeys,
      category: category || null,
      createdFrom: dateFrom || null,
      createdTo: dateTo || null,
    }),
    [search, searchCaseKeys, category, dateFrom, dateTo],
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
        // A department is not something the case list can be asked for: it comes from the lead's
        // category, so the whole list is read once and narrowed here, then paged locally.
        if (caseDepartment != null) {
          const [all, leadNumbers] = await Promise.all([
            fetchAllDocumentIndexCases(filters),
            fetchDepartmentCaseLeadNumbers(caseDepartment, departments),
          ]);
          if (token !== reloadToken.current) return;
          const matching = all.rows.filter((item) => leadNumbers.has(item.lead_number));
          setCaseRows(matching.slice(0, (page + 1) * DOCUMENT_INDEX_PAGE_SIZE));
          setRows([]);
          setTotal(matching.length);
          if (!append) setUploaders(new Map());
          return;
        }

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
        sources: searching || source === 'all' ? undefined : [source],
        scopeKey: searching ? null : scopeKey,
        // Narrowing inside a case looks through the whole case, not just the open folder.
        folder: searching
          ? 'any'
          : activeFolder
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
      // Only a first page replaces the list. A failed 'load more' leaves what is already on
      // screen alone: those rows are still correct, and emptying the list over them turns a
      // page that merely stopped growing into a section that appears to hold nothing.
      if (page > 0) {
        // A range past the end is how the store says it has no more rows, which is not an error.
        if (err?.code !== 'PGRST103') setError(message);
        return;
      }
      setError(
        /client_visible/i.test(message)
          ? 'Client visibility is not set up yet. Run sql/2026-10-28_client_visible_documents.sql, then reload.'
          : /document_index/i.test(message)
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
    searching,
    source,
    showCaseList,
    caseDepartment,
    departments,
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
    fetchMainDepartments()
      .then((next) => {
        if (!cancelled) setDepartments(next);
      })
      .catch(() => {
        if (!cancelled) setDepartments([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Leaving Cases altogether drops the department. Opening a case does not: coming back up the
  // breadcrumb has to land on the same filtered list you left.
  useEffect(() => {
    if (!inCasesTree && caseDepartment != null) setCaseDepartment(null);
  }, [inCasesTree, caseDepartment]);

  // The case list knows a lead number and a file count; the name and department come from the
  // lead itself, looked up a page at a time.
  useEffect(() => {
    if (caseRows.length === 0 || departments.length === 0) return;
    let cancelled = false;
    const missing = caseRows
      .map((item) => item.lead_number)
      .filter((leadNumber) => !caseInfo.has(leadNumber) && !caseInfoTried.has(leadNumber));
    if (missing.length === 0) return;

    fetchCaseLeadInfo(missing, departments)
      .then((next) => {
        if (cancelled) return;
        if (next.size > 0) setCaseInfo((prev) => new Map([...prev, ...next]));
      })
      .catch(() => {
        // A missing name only costs the row its subtitle.
      })
      .finally(() => {
        // Asked and answered, whatever the answer was: these rows stop waiting, and are not
        // asked about again on the next page of cases.
        if (!cancelled) setCaseInfoTried((prev) => new Set([...prev, ...missing]));
      });
    return () => {
      cancelled = true;
    };
  }, [caseRows, departments, caseInfo, caseInfoTried]);

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
    setPage((prev) => nextDocumentIndexPage(prev, total));
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

  /**
   * A renamed file under its new name everywhere it is on screen — the list, and the viewer's own
   * panel — rather than by reloading the page under whoever is reading it.
   */
  const applyRename = (row: DocumentIndexRow, fileName: string) => {
    const key = stableRowKey(row);
    const renamed = (item: DocumentIndexRow) =>
      stableRowKey(item) === key ? { ...item, file_name: fileName } : item;
    setRows((prev) => prev.map(renamed));
    setViewerRows((prev) => prev.map(renamed));
    setViewerDocs((prev) =>
      prev ? prev.map((doc) => (doc.id === key ? { ...doc, name: fileName } : doc)) : prev,
    );
  };

  /** One listed row as the viewer wants it, given a URL it can already display. */
  const viewerItem = (row: DocumentIndexRow, url: string): DocumentViewerItem => ({
    id: stableRowKey(row),
    name: row.file_name,
    url,
    fileType: row.mime_type || '',
    lastModified: row.created_at,
    storagePath: row.storage_path,
    storageBucket: row.storage_bucket,
  });

  /**
   * Opens a set of files in the viewer, on the one that was asked for. The panel down the
   * viewer's left is how you move between them, so it is given the whole set — whichever kind of
   * file each one is — and the URLs for the lot are signed in one request per bucket.
   */
  const openRowsInViewer = async (listed: DocumentIndexRow[], focus: DocumentIndexRow) => {
    const key = stableRowKey(focus);
    setBusyKey(key);
    try {
      const urls = await createDocumentIndexSignedUrls(listed);
      const openable = listed.filter((item) => urls.has(item.storage_path));
      const index = openable.findIndex((item) => stableRowKey(item) === key);
      if (index < 0) {
        // The file asked for was not among those signed, so it opens by itself rather than not
        // at all — it is the one the click was about.
        const url = await createDocumentIndexSignedUrl(focus);
        setViewerRows([focus]);
        setViewerDocs([viewerItem(focus, url)]);
        setViewerIndex(0);
        return;
      }
      setViewerRows(openable);
      setViewerDocs(openable.map((item) => viewerItem(item, urls.get(item.storage_path) as string)));
      setViewerIndex(index);
    } catch (err: any) {
      toast.error(err?.message || 'Could not open this file');
    } finally {
      setBusyKey(null);
    }
  };

  /** Opening one file opens the list it sits in, so the panel beside it is the list. */
  const openPreview = (row: DocumentIndexRow) => openRowsInViewer(rows.filter(hasStoredFile), row);

  /** The listed row a file in the viewer came from, which is what anything written goes to. */
  const viewerRowOf = (doc: DocumentViewerItem) =>
    viewerRows.find((item) => stableRowKey(item) === doc.id) ?? null;

  /** The viewer reports what it is showing, since it can be paged through from inside. */
  const handleViewerDocumentChange = useCallback((doc: DocumentViewerItem | null) => {
    setViewerActiveId(doc?.id ?? null);
  }, []);

  /** A file's new name, written to the row the viewer is showing. */
  const renameViewerDoc = async (doc: DocumentViewerItem, newName: string) => {
    const row = viewerRowOf(doc);
    if (!row) throw new Error('Could not work out which file to rename');
    const fileName = await renameDocumentIndexRow(row, newName);
    applyRename(row, fileName);
  };

  /** Show a just-created document in the viewer, already on its way into Word or Excel. */
  const openCreatedForEditing = async (made: DriveCreatedFile) => {
    try {
      const { data, error } = await supabase.storage
        .from(made.bucket)
        .createSignedUrl(made.storagePath, 3600);
      if (error || !data?.signedUrl) throw error || new Error('Could not open the new document');
      setViewerAutoEdit(true);
      // Created this moment and not in any list yet, so there is no row behind it to rename.
      setViewerRows([]);
      setViewerIndex(0);
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

  /** Several files at once leave as one zip, since a browser only downloads one file at a time. */
  const downloadRowsZip = async (picked: DocumentIndexRow[]) => {
    const progress = toast.loading(`Preparing ${picked.length} files…`);
    try {
      const urls = await createDocumentIndexSignedUrls(picked);
      const { successCount, errorCount } = await downloadFilesAsZip({
        files: picked
          .filter((row) => urls.has(row.storage_path))
          .map((row) => ({ name: row.file_name, url: urls.get(row.storage_path) as string })),
        zipFileName: 'documents.zip',
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
      const openable = contents.docs.filter((doc) => contents.urls.has(doc.storage_path));
      setViewerRows(openable);
      setViewerIndex(0);
      setViewerDocs(
        openable.map((doc) => viewerItem(doc, contents.urls.get(doc.storage_path) as string)),
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

  /**
   * The case's own page, which is not `/clients/<case number>`: a legacy case opens by its row
   * id, and a sub-case of either kind needs the number it is filed under in the query. The lead
   * read for the case list already carries the route; anything else is resolved on the spot.
   */
  const openLeadPage = useCallback(
    (leadNumber: string) => {
      const known = caseInfo.get(leadNumber)?.route;
      if (known) {
        navigate(known);
        return;
      }
      fetchCaseLeadRoute(leadNumber)
        .then((route) => navigate(route))
        .catch(() => navigate(`/clients/${encodeURIComponent(leadNumber)}`));
    },
    [caseInfo, navigate],
  );

  /**
   * Whether a case is still waiting to hear who it is for. A case whose lead came back without a
   * name, or answers to no lead at all, is not waiting for anything and shows its number alone.
   */
  const caseNamePending = useCallback(
    (leadNumber: string) => !caseInfo.has(leadNumber) && !caseInfoTried.has(leadNumber),
    [caseInfo, caseInfoTried],
  );

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
      } else if (deleteTarget.kind === 'docs') {
        // One at a time, so a file the delete policy refuses stops that file rather than the lot.
        let done = 0;
        let failed = 0;
        for (const row of deleteTarget.rows) {
          try {
            await deleteDocumentIndexRow(row);
            done += 1;
          } catch {
            failed += 1;
          }
        }
        if (done === 0) {
          throw new Error('None of these documents are yours to delete');
        }
        toast.success(
          failed > 0 ? `Deleted ${done} documents, ${failed} refused` : `Deleted ${done} documents`,
        );
        clearChecked();
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
        hint: 'Try a case number, one word from the file name, or the client’s name, email or phone.',
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

  const closePeek = useCallback(() => {
    if (peekTimer.current != null) {
      window.clearTimeout(peekTimer.current);
      peekTimer.current = null;
    }
    setPeek(null);
    setPeekItems(null);
  }, []);

  const loadPeek = async (target: PeekTarget) => {
    // A document shows itself rather than a list, and the thumbnail fetches its own picture.
    if (target.kind === 'doc') return;

    const cached = peekCache.current.get(target.id);
    if (cached) {
      setPeekItems(cached);
      return;
    }

    let folderNames: string[] = [];
    let fileNames: string[] = [];

    try {
      if (target.kind === 'case') {
        // A case is its own tree: the folders at its top, then the files sitting loose in it.
        const [children, loose] = await Promise.all([
          listFolderChildrenAcrossScopes(null, { scopeKey: target.leadNumber }),
          fetchDocumentIndex({
            sources: ['lead'],
            scopeKey: target.leadNumber,
            sort: 'created_at',
            ascending: false,
            pageSize: 8,
          }),
        ]);
        folderNames = children.map((child) => child.title);
        fileNames = loose.rows.map((row) => row.file_name);
      } else {
        const folder = target.folder;
        const documents = await fetchDocumentsInFolder(folder.id, 8);
        fileNames = documents.map((row) => row.file_name);
        // Each store keeps its folders in its own table, so the children come from whichever one
        // this folder lives in.
        if (folder.scope_type === 'office' && activeOfficeSpace) {
          const rows = await fetchOfficeDocumentFolders(activeOfficeSpace.departmentId);
          folderNames = rows.filter((row) => row.parent_id === folder.id).map((row) => row.title);
        } else if (folder.scope_type === 'employee' && employeeId != null) {
          const rows = await fetchEmployeePersonalFolders(employeeId);
          folderNames = rows.filter((row) => row.parent_id === folder.id).map((row) => row.title);
        } else {
          const children = await listFolderChildrenAcrossScopes(folder.id, {
            scopeKey: folder.scope_key,
          });
          folderNames = children.map((child) => child.title);
        }
      }
    } catch {
      // A preview is worth nothing if it can raise an error over the page it is previewing.
    }

    const items = {
      folders: folderNames.slice(0, 6),
      documents: fileNames.slice(0, 8),
      more: Math.max(0, folderNames.length - 6),
    };
    peekCache.current.set(target.id, items);
    setPeekItems(items);
  };

  /** Dragging a row onto a folder files it there, the same move the dialog makes. */
  const dropOnFolder = async (folder: DocumentFolder) => {
    const dragged = dragging;
    setDropFolderId(null);
    setDragging(null);
    if (!dragged) return;
    if (dragged.kind === 'folder') {
      await dropFolderInFolder(dragged.id, folder);
      return;
    }

    const row = rows.find((item) => stableRowKey(item) === dragged.key);
    if (!row) return;
    // Dragging one of the rows picked out together carries the whole group; dragging any other
    // row carries only itself.
    const moving = checkedKeys.has(dragged.key) && checkedRows.length > 1 ? checkedRows : [row];
    // A folder only takes files from its own store, so the move goes through that store's own
    // helper and nothing can be filed across two spaces.
    const expectedSource: DocumentIndexSource =
      folder.scope_type === 'office' ? 'office' : folder.scope_type === 'employee' ? 'personal' : 'lead';
    const allowed = moving.filter(
      (item) => item.source === expectedSource && canFileDocumentInFolder(item),
    );
    if (allowed.length === 0) {
      toast.error(
        expectedSource === 'lead'
          ? 'Only case documents can be filed into folders'
          : 'Only files from this space can be filed into its folders',
      );
      return;
    }
    const pending = allowed.filter((item) => item.folder_id !== folder.id);
    if (pending.length === 0) return;
    const ids = pending.map((item) => item.row_id);
    try {
      if (folder.scope_type === 'office') {
        await moveOfficeDocumentsToFolder(ids, folder.id);
      } else if (folder.scope_type === 'employee') {
        await moveEmployeePersonalFilesToFolder(ids, folder.id);
      } else {
        await moveCaseDocumentsToFolder(ids, folder.id);
      }
      setLandedFolderId(folder.id);
      toast.success(
        pending.length === 1
          ? `Moved to “${folder.title}”`
          : `Moved ${pending.length} files to “${folder.title}”`,
      );
      // Said once, rather than per file: the rest of the group belongs to another store.
      const refused = moving.length - allowed.length;
      if (refused > 0) {
        toast(`${refused} ${refused === 1 ? 'file' : 'files'} could not be filed here`);
      }
      clearChecked();
      reload();
    } catch (err: any) {
      toast.error(err?.message || 'Could not move these files');
    }
  };

  /**
   * Dragging a folder onto another one files it, and everything inside it, in there. Only folders
   * standing side by side are ever both on screen, so a folder cannot be dropped into its own
   * subfolder and no cycle is possible.
   */
  const dropFolderInFolder = async (folderId: string, target: DocumentFolder) => {
    const moved = folders.find((folder) => folder.id === folderId);
    if (!moved || moved.id === target.id) return;
    if (moved.parent_id === target.id) return;
    if (moved.scope_type !== target.scope_type || moved.scope_key !== target.scope_key) {
      toast.error('A folder can only be moved within its own space');
      return;
    }
    // Both caps count levels, while depth counts the folders above, so the deepest a folder may
    // sit is one less than the cap.
    const levels = target.scope_type === 'lead' ? MAX_DOCUMENT_FOLDER_DEPTH : MAX_SPACE_FOLDER_DEPTH;
    if (target.depth + 1 > levels - 1) {
      toast.error(`Folders can be nested ${levels} levels deep`);
      return;
    }
    try {
      if (target.scope_type === 'office') {
        await moveOfficeDocumentFolder(folderId, target.id);
      } else if (target.scope_type === 'employee') {
        await moveEmployeePersonalFolder(folderId, target.id);
      } else {
        await moveDocumentFolder(folderId, target.id);
      }
      setLandedFolderId(target.id);
      setSelection(null);
      toast.success(`Moved “${moved.title}” into “${target.title}”`);
      // The folder list is read by its own effect, which this nonce is what reruns.
      setCreatedNonce((prev) => prev + 1);
      reload();
    } catch (err: any) {
      toast.error(err?.message || 'Could not move this folder');
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

  /** What a folder row needs to be both a drop target and a thing you can pick up and move. */
  const folderDragDropProps = (folder: DocumentFolder) => ({
    draggable: true,
    onDragStart: (event: React.DragEvent) => {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', folder.title);
      setDragging({ kind: 'folder', id: folder.id });
      setSelection({ kind: 'folder', id: folder.id });
      closePeek();
    },
    onDragEnd: () => {
      setDragging(null);
      setDropFolderId(null);
    },
    onDragOver: (event: React.DragEvent) => {
      // A folder cannot be dropped on itself, and nothing from the desktop lands here: a file
      // dragged in from outside is an upload, which the list as a whole takes.
      if (!dragging || (dragging.kind === 'folder' && dragging.id === folder.id)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      setDropFolderId(folder.id);
    },
    onDragLeave: () => setDropFolderId((prev) => (prev === folder.id ? null : prev)),
    onDrop: (event: React.DragEvent) => {
      if (!dragging) return;
      event.preventDefault();
      event.stopPropagation();
      void dropOnFolder(folder);
    },
    onAnimationEnd: () => setLandedFolderId((prev) => (prev === folder.id ? null : prev)),
  });

  /**
   * Resting on a folder or a case shows what is inside it, so you can tell two similarly named
   * ones apart without opening either. Contents are kept once read: the same row is hovered over
   * and over while you are looking for something.
   */
  const peekProps = (target: PeekTarget) => ({
    onMouseEnter: (event: React.MouseEvent<HTMLElement>) => {
      const element = event.currentTarget;
      if (peekTimer.current != null) window.clearTimeout(peekTimer.current);
      peekTimer.current = window.setTimeout(() => {
        const rect = element.getBoundingClientRect();
        setPeek({
          target,
          // Below the row and inside the window, whichever edge it is near.
          top: Math.min(rect.bottom + 6, window.innerHeight - 280),
          left: Math.min(Math.max(rect.left + 24, 8), window.innerWidth - 304),
        });
        void loadPeek(target);
      }, 450);
    },
    onMouseLeave: closePeek,
  });

  const folderPeekProps = (folder: DocumentFolder) =>
    peekProps({ kind: 'folder', id: folder.id, title: folder.title, folder });

  const casePeekProps = (leadNumber: string) =>
    peekProps({ kind: 'case', id: `case:${leadNumber}`, title: leadNumber, leadNumber });

  const documentPeekProps = (row: DocumentIndexRow) =>
    peekProps({ kind: 'doc', id: `doc:${stableRowKey(row)}`, title: row.file_name, row });

  /** What a document row needs to be dragged into one of the folders beside it. */
  const documentDragProps = (row: DocumentIndexRow, key: string) => ({
    draggable: canFileDocumentInFolder(row),
    onDragStart: (event: React.DragEvent) => {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', row.file_name);
      setDragging({ kind: 'doc', key });
      // Picking up one of the rows held together keeps the group, so all of them travel. Any
      // other row starts afresh from itself.
      if (!checkedKeys.has(key)) {
        clearChecked();
        setSelection({ kind: 'doc', key });
      }
    },
    onDragEnd: () => {
      setDragging(null);
      setDropFolderId(null);
    },
  });

  /**
   * Shows or hides case documents in the client portal.
   *
   * The lists hold their own copy of each row, so they are corrected here: the mark has to appear
   * the moment the menu closes, not whenever the next read comes back.
   */
  const setRowsClientVisible = async (picked: DocumentIndexRow[], visible: boolean) => {
    const ids = picked.filter(canHideFromClient).map((row) => row.row_id);
    if (ids.length === 0) return;
    try {
      await setCaseDocumentsClientVisible(ids, visible);
      const changed = new Set(ids);
      setRows((prev) =>
        prev.map((row) =>
          row.source === 'lead' && changed.has(row.row_id) ? { ...row, client_visible: visible } : row,
        ),
      );
      toast.success(
        visible
          ? `${ids.length === 1 ? 'Document is' : `${ids.length} documents are`} viewable by the client`
          : `${ids.length === 1 ? 'Document is' : `${ids.length} documents are`} hidden from the client`,
      );
    } catch (err: any) {
      toast.error(err?.message || 'Could not change what the client sees');
    }
  };

  const setFolderClientVisible = async (folder: DocumentFolder, visible: boolean) => {
    try {
      await setDocumentFolderClientVisible(folder.id, visible);
      const patch = (item: DocumentFolder) =>
        item.id === folder.id ? { ...item, client_visible: visible } : item;
      setFolders((prev) => prev.map(patch));
      setFolderTrail((trail) => trail.map(patch));
      toast.success(
        visible
          ? `“${folder.title}” is viewable by the client`
          : `“${folder.title}” and everything in it are hidden from the client`,
      );
    } catch (err: any) {
      toast.error(err?.message || 'Could not change what the client sees');
    }
  };

  /** The menu entry that flips it, worded for the state it is in. */
  const clientVisibilityAction = (visible: boolean, onSelect: () => void): RowAction => ({
    id: 'client-visibility',
    label: visible ? 'Hide from client portal' : 'Make viewable by client',
    icon: visible ? EyeSlashIcon : EyeIcon,
    onSelect,
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
      {
        id: 'rename-folder',
        label: 'Rename folder',
        icon: PencilSquareIcon,
        onSelect: () => setRenameFolder(folder),
      },
    ];
    // Only a case has a client reading it, and only its own folders are in the portal.
    if (folder.scope_type === 'lead') {
      actions.push(
        clientVisibilityAction(folder.client_visible !== false, () =>
          void setFolderClientVisible(folder, folder.client_visible === false),
        ),
      );
    }
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

  /**
   * A folder's new name, written to whichever store the folder belongs to. The breadcrumb keeps
   * its own copy of each folder it stepped through, so it is corrected here rather than waiting
   * for the list underneath to come back.
   */
  const saveFolderTitle = async (folder: DocumentFolder, title: string) => {
    if (folder.scope_type === 'office') await renameOfficeDocumentFolder(folder.id, title);
    else if (folder.scope_type === 'employee') await renameEmployeePersonalFolder(folder.id, title);
    else await renameDocumentFolder(folder.id, title);
    setFolderTrail((trail) =>
      trail.map((item) => (item.id === folder.id ? { ...item, title } : item)),
    );
    setCreatedNonce((prev) => prev + 1);
  };

  /**
   * A click with Command or Control held adds a row to the group, or takes it back out. The row
   * that was already picked out on its own becomes the first of the group, and a group worn down
   * to a single row turns back into that one pick, so one row and several are never both in play.
   */
  const toggleChecked = (key: string) => {
    const anchor = selection?.kind === 'doc' ? selection.key : null;
    const next = new Set(checkedKeys.size === 0 && anchor ? [anchor] : checkedKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    if (next.size > 1) {
      setCheckedKeys(next);
      setSelection(null);
      return;
    }
    const [only] = next;
    setCheckedKeys(new Set());
    setSelection(only ? { kind: 'doc', key: only } : null);
  };

  /** Lets go of the group, which is what finishing an action on it means. */
  const clearChecked = () =>
    setCheckedKeys((prev) => (prev.size === 0 ? prev : new Set<string>()));

  /** Lets go of everything in hand, one row or a group of them. */
  const clearSelection = () => {
    setSelection(null);
    clearChecked();
  };

  /**
   * Every document listed here, picked out in one go — what Command-clicking down a long page
   * amounts to. Folders and cases are left out: the action bar only ever works on documents.
   */
  const checkEveryRow = () => {
    if (rows.length === 0) return;
    // A single row is a single pick, not a group of one, which is the rule toggleChecked keeps.
    if (rows.length === 1) {
      setCheckedKeys(new Set());
      setSelection({ kind: 'doc', key: stableRowKey(rows[0]) });
      return;
    }
    setCheckedKeys(new Set(rows.map(stableRowKey)));
    setSelection(null);
  };

  /**
   * What can be done to every document in the group at once. Deliberately shorter than one row's own
   * menu: sharing, renaming and managing access are each about one file, and a case to open
   * belongs to one document.
   */
  const bulkActions = (picked: DocumentIndexRow[]): RowAction[] => {
    const actions: RowAction[] = [];
    const stored = picked.filter(hasStoredFile);
    if (stored.length > 0) {
      actions.push(
        {
          id: 'preview',
          label: `Preview ${stored.length} files`,
          icon: EyeIcon,
          onSelect: () => void openRowsInViewer(stored, stored[0]),
        },
        {
          id: 'download',
          label: `Download all ${stored.length} as a zip file`,
          icon: ArrowDownTrayIcon,
          onSelect: () => void downloadRowsZip(stored),
        },
      );
    }
    // Filing into a folder happens inside one case's own tree, so they all have to be in one.
    const scope = scopeOf(picked[0]);
    if (scope && picked.every((row) => sameFolderScope(scopeOf(row), scope))) {
      actions.push({
        id: 'move',
        label: 'Move to folder',
        icon: FolderArrowDownIcon,
        onSelect: () => setMoveRows(picked),
      });
    }
    if (stored.length > 0) {
      actions.push(
        {
          id: 'copy-to',
          label: 'Copy to another place',
          icon: DocumentDuplicateIcon,
          onSelect: () => setTransfer({ mode: 'copy', rows: stored }),
        },
        {
          id: 'move-to',
          label: 'Move to another place',
          icon: ArrowRightCircleIcon,
          onSelect: () => setTransfer({ mode: 'move', rows: stored }),
        },
      );
    }
    const caseDocs = picked.filter(canHideFromClient);
    if (caseDocs.length > 0) {
      // One answer for the group: if any of them is still viewable, the group is hidden.
      const anyVisible = caseDocs.some((row) => row.client_visible !== false);
      actions.push({
        id: 'client-visibility',
        label: anyVisible
          ? `Hide ${caseDocs.length} from client portal`
          : `Make ${caseDocs.length} viewable by client`,
        icon: anyVisible ? EyeSlashIcon : EyeIcon,
        onSelect: () => void setRowsClientVisible(caseDocs, !anyVisible),
      });
    }
    if (isSuperUser) {
      actions.push({
        id: 'delete',
        label: `Delete ${picked.length} ${picked.length === 1 ? 'file' : 'files'}`,
        icon: TrashIcon,
        danger: true,
        onSelect: () => setDeleteTarget({ kind: 'docs', rows: picked }),
      });
    }
    return actions;
  };

  const rowActions = (row: DocumentIndexRow): RowAction[] => {
    const actions: RowAction[] = [];
    // Passing a file on is the first thing asked of it, so it sits above opening it.
    if (hasStoredFile(row)) {
      actions.push({ id: 'share', label: 'Share', icon: ShareIcon, onSelect: () => setShareRow(row) });
    }
    actions.push(
      { id: 'preview', label: 'Preview', icon: EyeIcon, onSelect: () => void openPreview(row) },
      { id: 'download', label: 'Download', icon: ArrowDownTrayIcon, onSelect: () => void download(row) },
      {
        id: 'rename',
        label: 'Rename',
        icon: PencilSquareIcon,
        onSelect: () => setRenameRow(row),
      },
    );
    if (row.source === 'lead' && row.scope_key) {
      actions.push({
        id: 'open-case',
        label: `Open case ${row.scope_key}`,
        icon: BriefcaseIcon,
        onSelect: () => openLeadPage(row.scope_key as string),
      });
    }
    if (isMovableDocument(row)) {
      actions.push({
        id: 'move',
        label: 'Move to folder',
        icon: FolderArrowDownIcon,
        onSelect: () => setMoveRows([row]),
      });
    }
    if (hasStoredFile(row)) {
      actions.push(
        {
          id: 'copy-to',
          label: 'Copy to another place',
          icon: DocumentDuplicateIcon,
          onSelect: () => setTransfer({ mode: 'copy', rows: [row] }),
        },
        {
          id: 'move-to',
          label: 'Move to another place',
          icon: ArrowRightCircleIcon,
          onSelect: () => setTransfer({ mode: 'move', rows: [row] }),
        },
      );
    }
    if (canHideFromClient(row)) {
      actions.push(
        clientVisibilityAction(row.client_visible !== false, () =>
          void setRowsClientVisible([row], row.client_visible === false),
        ),
      );
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

  /*
   * What RMQ AI is told the user is looking at: the file open in the viewer, or failing that the
   * row they clicked. That is what lets "what is this document about?" mean something in the chat,
   * and it is cleared on the way out so the chat never talks about a file from a page ago.
   */
  const viewerFocusRow = viewerActiveId
    ? viewerRows.find((row) => stableRowKey(row) === viewerActiveId) ?? null
    : null;
  useEffect(() => {
    const focused = viewerFocusRow || selectedDoc;
    setRmqAiDriveDocument(
      focused ? rmqAiDriveDocumentFromRow(focused, viewerFocusRow ? 'open' : 'selected') : null,
    );
  }, [viewerFocusRow, selectedDoc]);

  useEffect(() => {
    setRmqAiDriveView({
      source,
      caseKey,
      caseLabel: caseKey ? caseInfo.get(caseKey)?.name ?? null : null,
      folderPath: folderTrail.map((folder) => folder.title).join(' / ') || null,
    });
  }, [source, caseKey, caseInfo, folderTrail]);

  useEffect(
    () => () => {
      setRmqAiDriveDocument(null);
      setRmqAiDriveView(null);
    },
    [],
  );

  const selectionActions: RowAction[] = selectedDoc
    ? rowActions(selectedDoc)
    : selectedFolder
      ? folderActions(selectedFolder)
      : [];
  const selectionLabel = selectedDoc?.file_name || selectedFolder?.title || '';

  /** The documents picked out together, in the order they are listed. */
  const checkedRows = useMemo(
    () => rows.filter((row) => checkedKeys.has(stableRowKey(row))),
    [rows, checkedKeys],
  );
  /** Whether a row is one of the rows being acted on, alone or as part of a group. */
  const isPicked = (key: string) =>
    (selection?.kind === 'doc' && selection.key === key) || checkedKeys.has(key);
  /** With everything listed already in hand, the header offer turns into letting go of it. */
  const everyRowPicked =
    rows.length > 0 && rows.every((row) => isPicked(stableRowKey(row)));

  // A group only means anything while its rows are on screen: navigating, filtering or reloading
  // leaves keys behind that nothing can be done to.
  useEffect(() => {
    setCheckedKeys((prev) => {
      if (prev.size === 0) return prev;
      const listed = new Set(rows.map(stableRowKey));
      const next = new Set([...prev].filter((key) => listed.has(key)));
      return next.size === prev.size ? prev : next;
    });
  }, [rows]);

  /**
   * The grey pill works on the group when there is one, and on the single row that was clicked
   * otherwise. Since a group is never fewer than two rows, the two cases cannot overlap.
   */
  const barActions = checkedRows.length > 0 ? bulkActions(checkedRows) : selectionActions;
  const barCount = checkedRows.length > 0 ? checkedRows.length : selectionActions.length > 0 ? 1 : 0;
  const barLabel =
    checkedRows.length > 0 ? checkedRows.map((row) => row.file_name).join(', ') : selectionLabel;

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

  const departmentColours = useMemo(() => buildDepartmentColours(departments), [departments]);

  /** A department's dot, in the shape the row menus want their icons in. */
  const departmentDotIcon = useCallback(
    (key: CaseDepartmentKey) => {
      const colour = departmentColours.get(key) || 'bg-slate-400';
      const DepartmentDot: React.FC<{ className?: string }> = ({ className }) => (
        <span className={`${className ?? ''} flex items-center justify-center`} aria-hidden>
          <span className={`h-2.5 w-2.5 rounded-full ${colour}`} />
        </span>
      );
      return DepartmentDot;
    },
    [departmentColours],
  );

  const caseDepartmentChips = useMemo(
    () => [
      { key: null as CaseDepartmentKey | null, label: 'All departments' },
      ...departments.map((department) => ({
        key: department.id as CaseDepartmentKey | null,
        label: department.name,
      })),
      // The dashboard keeps the practice areas it sets no target for in one bucket, and so does this.
      { key: CASE_DEPARTMENT_OTHER as CaseDepartmentKey | null, label: 'Other' },
    ],
    [departments],
  );

  const activeCaseDepartment =
    caseDepartment == null
      ? null
      : caseDepartmentChips.find((chip) => chip.key === caseDepartment) ?? null;

  const sortIndicator = (column: DocumentIndexSort) =>
    sort === column ? <span className="ml-1 text-xs">{ascending ? '▲' : '▼'}</span> : null;

  const activeChip = chips.find((chip) => chip.value === source) ?? chips[0];

  type Crumb = { id: string; label: string; onNavigate: () => void; actions: RowAction[] };

  // A flat search leaves the drive's structure behind, so it says so instead of pretending you
  // are still somewhere. Cases keeps its own crumb, since its results are still case folders.
  const crumbs: Crumb[] = searching && !showCaseList
    ? [
        {
          id: 'search',
          label: `Results for “${search}”`,
          onNavigate: () => {
            setSearchInput('');
            setPage(0);
          },
          actions: createActions,
        },
      ]
    : [
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
            // The space's own crumb is its top level, so it has to close any folder that is open
            // under it. Leaving the trail alone made this crumb do nothing at all.
            onNavigate: () => {
              setFolderTrail([]);
              setPage(0);
            },
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
                onSelect: () => openLeadPage(caseKey),
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
    <div className="flex h-full min-h-0 w-full flex-col bg-[#f8fafd] dark:bg-base-300">
      <div className="flex shrink-0 flex-wrap items-center gap-3 px-2 pb-3 pt-2 md:px-4 md:pb-4">
        {/* Width matches the side panel plus its gutter, so the search lines up with the table. */}
        {/* Without the back button the width matches the side panel, so the search lines up. */}
        <div
          className={`flex shrink-0 items-center gap-1.5 pr-4 pl-1 ${
            returnTo ? 'gap-3' : 'md:w-[14.75rem] lg:w-[15.75rem]'
          }`}
        >
          {/* The drive hides the app header, so this is the way back to the rest of the CRM.
              Under the pointer it lifts into the same white badge the Back button wears, which
              stands out against the page's tinted background. The border is there unhovered as
              well, in its own colour, so nothing shifts by a pixel when it appears. */}
          {onOpenAppNav ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm btn-circle shrink-0 border border-transparent text-base-content/70 hover:border-base-300 hover:bg-white hover:shadow-sm dark:hover:bg-base-100"
              onClick={onOpenAppNav}
              aria-label="Open the main menu"
              title="Menu"
              // The panel closes on a click outside itself; this button owns that state instead.
              data-drive-app-nav-toggle
            >
              <Bars3Icon className="h-6 w-6" />
            </button>
          ) : null}
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
          <RmqDriveLogo className="h-11 w-11" animated />
          <span className="text-2xl font-normal tracking-tight text-base-content/70">Drive</span>
        </div>
        {/* Grey against the page, white once you are typing in it. Styled without daisyUI's
            `input` class, which paints itself base-100 and rings itself in base-content on focus:
            an opacity-modified background like `bg-base-300/80` compiles to nothing against its
            colours, so the white underneath was all that ever showed. */}
        <div className="relative flex min-w-0 flex-1 items-center md:max-w-2xl">
          <label className="flex h-12 w-full cursor-text items-center gap-2 rounded-full bg-[#e9eef5] px-4 transition-colors focus-within:bg-white focus-within:shadow-md dark:bg-base-100 dark:focus-within:bg-base-200">
            <MagnifyingGlassIcon className="h-5 w-5 shrink-0 text-base-content/40" />
            <input
              type="search"
              className="grow border-none bg-transparent text-sm text-base-content outline-none placeholder:text-base-content/50 focus:outline-none"
              placeholder="Search files, or a client by name, email or phone"
              aria-label="Search in documents"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            {searchInput ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-circle shrink-0 text-base-content/50 hover:bg-base-200 hover:text-base-content"
                title="Clear the search"
                aria-label="Clear the search"
                onClick={() => {
                  setSearchInput('');
                  setSearch('');
                  setPage(0);
                }}
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            ) : null}
            {/* The filters live in here rather than out at the edge: they narrow the same list the
                search does, and the dot says at a glance that something is still narrowing it. */}
            <button
              type="button"
              className={`btn btn-ghost btn-sm btn-circle relative shrink-0 hover:bg-base-200 ${
                narrowed || filtersOpen ? 'text-primary' : 'text-base-content/50 hover:text-base-content'
              }`}
              title={narrowed ? 'Filters are narrowing this list' : 'Filter by category or date'}
              aria-label="Filter by category or date"
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((open) => !open)}
            >
              <FunnelIcon className="h-5 w-5" />
              {narrowed ? (
                <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-primary ring-2 ring-white dark:ring-base-100" />
              ) : null}
            </button>
          </label>

          {filtersOpen ? (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setFiltersOpen(false)} />
              <div className="absolute right-0 top-full z-40 mt-2 w-[28rem] max-w-[calc(100vw-1.5rem)] rounded-2xl border border-base-300 bg-white p-4 shadow-xl dark:bg-base-100">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-base-content">Filters</p>
                  {narrowed ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs gap-1 text-base-content/60"
                      onClick={() => {
                        setCategory('');
                        setDateFrom('');
                        setDateTo('');
                        setPage(0);
                      }}
                    >
                      <XMarkIcon className="h-4 w-4" />
                      Clear all
                    </button>
                  ) : null}
                </div>

                <label className="mt-3 block">
                  <span className="text-xs font-medium uppercase tracking-wide text-base-content/50">
                    Category
                  </span>
                  <select
                    className="select select-bordered mt-1 h-10 min-h-0 w-full rounded-xl text-sm"
                    value={category}
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
                </label>

                <div className="mt-3">
                  <span className="text-xs font-medium uppercase tracking-wide text-base-content/50">
                    Uploaded between
                  </span>
                  <div className="mt-1 flex items-center gap-2">
                    <CalendarDaysIcon className="h-5 w-5 shrink-0 text-base-content/40" />
                    <input
                      type="date"
                      className="input input-bordered h-10 min-h-0 w-full rounded-xl text-sm"
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
                      className="input input-bordered h-10 min-h-0 w-full rounded-xl text-sm"
                      value={dateTo}
                      min={dateFrom || undefined}
                      aria-label="To date"
                      onChange={(e) => {
                        setDateTo(e.target.value);
                        setPage(0);
                      }}
                    />
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </div>
        <RowActionsMenu
          actions={createActions}
          align="end"
          ariaLabel="Create or upload"
          triggerClassName="btn h-11 shrink-0 gap-2 rounded-2xl border border-base-300 bg-white pl-3 pr-4 text-sm font-medium text-base-content shadow-md transition-shadow hover:bg-base-200 hover:shadow-lg dark:bg-base-100"
          trigger={
            <>
              <PlusIcon className="h-6 w-6" />
              New
            </>
          }
        />
        {/* The drive hides the app header, so this is the only way to RMQ AI from here. It is told
            which file is picked out or open, so it can be asked what a document says. */}
        <button
          type="button"
          className="btn h-11 w-11 shrink-0 rounded-full border border-base-300 bg-white p-0 shadow-md transition-shadow hover:bg-base-200 hover:shadow-lg md:ml-auto dark:bg-base-100"
          title="Ask RMQ AI about these documents"
          aria-label="Open RMQ AI"
          onClick={() => openRmqAiChat()}
        >
          <RmqAiLogo src={RMQ_AI_HEADER_LOGO_SRC} className="h-8 w-8" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 items-stretch px-2 pb-3 md:px-4 md:pb-4">
        <aside className="hidden w-56 shrink-0 flex-col gap-1 overflow-y-auto pr-3 md:flex lg:w-60">
          {chips.map((chip) => {
            const Icon = SOURCE_ICON[chip.value];
            const active = source === chip.value;
            // Office holds one space per department, so it opens up rather than just filtering.
            const expandable = chip.value === 'office' && officeSpaces.length > 1;
            // Office's own row steps back while one of its spaces is open, since the space is
            // the thing you are standing in.
            const marked = active && !activeOfficeSpace;
            return (
              <React.Fragment key={chip.value}>
                <div
                  className={`group flex items-center gap-1 rounded-full pr-3 transition-colors hover:bg-base-300 ${
                    marked ? NAV_ACTIVE_BG : ''
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
                    <Icon
                      className={`h-6 w-6 shrink-0 ${marked ? NAV_ACTIVE_TEXT : 'text-base-content'}`}
                    />
                    <span
                      className={`flex-1 truncate ${
                        marked
                          ? `font-semibold ${NAV_ACTIVE_TEXT}`
                          : `text-base-content/50 group-hover:text-base-content ${
                              active ? 'font-semibold' : ''
                            }`
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
                        active
                          ? `${NAV_ACTIVE_BADGE} ${NAV_ACTIVE_TEXT}`
                          : 'bg-base-300/80 text-base-content/50'
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
                          spaceActive ? NAV_ACTIVE_BG : ''
                        }`}
                        onClick={() => {
                          setSource('office');
                          setOfficeSpaceKey(space.scopeKey);
                          setPage(0);
                        }}
                      >
                        <FolderSolidIcon
                          className={`h-5 w-5 shrink-0 ${
                            spaceActive ? NAV_ACTIVE_TEXT : 'text-slate-500'
                          }`}
                        />
                        <span
                          className={`flex-1 truncate ${
                            spaceActive
                              ? `font-semibold ${NAV_ACTIVE_TEXT}`
                              : 'text-base-content/50 group-hover:text-base-content'
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
                className={`btn btn-sm shrink-0 rounded-full border-none ${
                  source === chip.value
                    ? `${NAV_ACTIVE_BG} ${NAV_ACTIVE_TEXT}`
                    : 'btn-ghost bg-base-100'
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
                  <h1 className="truncate text-base-content">{crumbs[0].label}</h1>
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
              {barCount > 0 && (
                <div
                  className="flex min-w-0 items-center gap-1 overflow-x-auto rounded-full bg-base-200 px-2 py-1"
                  title={barLabel}
                >
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm btn-circle text-base-content/60 hover:bg-base-300 hover:text-base-content"
                    aria-label="Clear selection"
                    onClick={() => {
                      setSelection(null);
                      clearChecked();
                    }}
                  >
                    <XMarkIcon className="h-5 w-5" />
                  </button>
                  {/* Several rows are picked out by holding Command or Control while clicking
                      them, so this only has to say how many are in hand. */}
                  <span className="hidden shrink-0 px-2 text-sm text-base-content/70 sm:inline">
                    {barCount} selected
                  </span>
                  {barActions.length > 0 && (
                    <span className="mx-1 h-5 w-px shrink-0 bg-base-300" />
                  )}
                  {/* Ahead of everything else, and drawn a size larger: the rest of the pill is
                      about moving the file around, this one is about what is inside it. Offered
                      only on files already read, since it opens a summary rather than asks for one. */}
                  {checkedRows.length === 0 && selectedDoc?.ai_summary?.trim() ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm btn-circle text-primary hover:bg-base-300"
                      title="Read the AI summary"
                      aria-label={`AI summary of ${selectedDoc.file_name}`}
                      onClick={() => setSummaryRow(selectedDoc)}
                    >
                      <SparklesIcon className="h-6 w-6" />
                    </button>
                  ) : null}
                  {barActions
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
                  {/* Red rather than grey, and how much it deletes is spelled out in the
                      confirmation it opens. */}
                  {barActions
                    .filter((action) => action.danger)
                    .map((action) => (
                      <button
                        key={action.id}
                        type="button"
                        className="btn btn-ghost btn-sm btn-circle text-error hover:bg-error/10"
                        title={action.label}
                        aria-label={action.label}
                        onClick={() => action.onSelect()}
                      >
                        <action.icon className="h-5 w-5" />
                      </button>
                    ))}
                  {barActions.length > 0 && (
                    <RowActionsMenu
                      actions={barActions}
                      align="start"
                      ariaLabel="Selection actions"
                    />
                  )}
                </div>
              )}
              <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
                {/* A case belongs to a department through its category, the same way the
                    dashboard's scoreboard groups one. Only the chosen one is named here. */}
                {showCaseList && departments.length > 0 && (
                  <RowActionsMenu
                    actions={caseDepartmentChips.map((chip) => ({
                      id: String(chip.key),
                      label: chip.label,
                      icon: chip.key == null ? Squares2X2Icon : departmentDotIcon(chip.key),
                      onSelect: () => {
                        if (chip.key === caseDepartment) return;
                        setCaseDepartment(chip.key);
                        // Resolving a department reads the whole case list, which takes a moment.
                        // Clearing the rows now puts the skeleton up instead of leaving the cases
                        // of the department you just left on screen as though they still matched.
                        setCaseRows([]);
                        setTotal(0);
                        setLoading(true);
                        setPage(0);
                      },
                    }))}
                    align="end"
                    ariaLabel="Filter cases by department"
                    triggerClassName="btn btn-sm max-w-[13rem] gap-1 rounded-full border-base-300 bg-white text-base-content/70 hover:bg-base-200 dark:bg-base-100"
                    trigger={
                      <>
                        {activeCaseDepartment ? (
                          <span
                            className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                              departmentColours.get(activeCaseDepartment.key as CaseDepartmentKey) ||
                              'bg-slate-400'
                            }`}
                            aria-hidden
                          />
                        ) : null}
                        <span className="truncate">
                          {activeCaseDepartment?.label || 'All departments'}
                        </span>
                        <ChevronDownIcon className="h-4 w-4 shrink-0 opacity-60" />
                      </>
                    }
                  />
                )}
                {/* Inside a case, the case itself is one click away rather than buried in the
                    breadcrumb's menu. */}
                {inCasesTree && caseKey && !searching && (
                  <button
                    type="button"
                    className="btn btn-sm rounded-full border-none bg-primary/10 font-medium text-primary hover:bg-primary/20"
                    onClick={() => openLeadPage(caseKey)}
                    title={`Open case ${caseKey}`}
                  >
                    Lead {caseKey}
                  </button>
                )}
                <span className="hidden text-sm tabular-nums text-base-content/50 lg:inline">
                  {total > 0
                    ? `${total.toLocaleString()} ${
                        showCaseList ? 'cases' : searching ? 'results' : 'files'
                      }`
                    : ''}
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
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
                    <DriveSkeletonCards />
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
                        <CaseDepartmentDot
                          info={caseInfo.get(item.lead_number)}
                          colours={departmentColours}
                        />
                        <span className="shrink-0" {...casePeekProps(item.lead_number)}>
                          <FolderSolidIcon className="h-7 w-7 text-primary" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-base-content">
                            {item.lead_number}
                            {caseNamePending(item.lead_number) ? (
                              <span className="ml-2 inline-block h-3 w-20 animate-pulse rounded bg-base-300 align-middle" />
                            ) : caseInfo.get(item.lead_number)?.name ? (
                              <span className="font-normal text-base-content/60">
                                {` · ${caseInfo.get(item.lead_number)?.name}`}
                              </span>
                            ) : null}
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
                          dropFolderId === folder.id
                            ? 'bg-primary/15 ring-2 ring-inset ring-primary'
                            : selectedFolder?.id === folder.id
                              ? 'bg-primary/15'
                              : 'bg-base-200 hover:bg-base-300'
                        } ${dragging?.kind === 'folder' && dragging.id === folder.id ? 'opacity-40' : ''} ${
                          landedFolderId === folder.id ? 'drive-drop-land' : ''
                        }`}
                        onClick={() => setSelection({ kind: 'folder', id: folder.id })}
                        onDoubleClick={() => openFolder(folder)}
                        {...folderDragDropProps(folder)}
                      >
                        <span className="relative shrink-0" {...folderPeekProps(folder)}>
                          <FolderSolidIcon className="h-7 w-7 text-slate-500" />
                          {folder.client_visible === false && <HiddenFromClientMark />}
                        </span>
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
                            isPicked(key) ? 'bg-primary/15' : 'bg-base-200 hover:bg-base-300'
                          } ${dragging?.kind === 'doc' && dragging.key === key ? 'opacity-40' : ''}`}
                          onClick={(event) => {
                            if (event.metaKey || event.ctrlKey) {
                              toggleChecked(key);
                              return;
                            }
                            clearChecked();
                            setSelection({ kind: 'doc', key });
                          }}
                          onDoubleClick={() => void openPreview(row)}
                          {...documentDragProps(row, key)}
                        >
                          <div className="flex items-center gap-2">
                            <span className="relative shrink-0" {...documentPeekProps(row)}>
                              <DocumentFileGlyph
                                fileType={row.mime_type || ''}
                                fileName={row.file_name}
                                className="h-6 w-6"
                              />
                              {row.client_visible === false && <HiddenFromClientMark />}
                            </span>
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
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
                    <DriveSkeletonCards count={4} />
                  </div>
                )}
              </div>
            ) : (
            <div className="min-h-0 flex-1 overflow-auto" onScroll={handleListScroll}>
              {/* The columns are laid out from these widths alone, never from what is in them.
                  Sized to their contents, every page of rows that scrolled in brought a longer
                  category or name with it and shoved the columns sideways, and the client names
                  arriving did the same. The widths read as ratios, so narrow screens scale them
                  down together. */}
              <table className="drive-table table table-fixed table-pin-rows [&_td]:py-2 [&_th]:py-2">
                <thead>
                  <tr className="bg-white text-base-content/60 dark:bg-base-100">
                    <th className="group w-[26rem] select-none font-medium">
                      <span className="flex items-center gap-2">
                        <span className="cursor-pointer" onClick={() => toggleSort('file_name')}>
                          Name{sortIndicator('file_name')}
                        </span>
                        {/* Kept out of sight until the header is passed over, so the column still
                            reads as a column, and only offered where there is a list to take. */}
                        {rows.length > 0 && (
                          <button
                            type="button"
                            className={`btn btn-ghost btn-xs h-5 min-h-0 gap-1 rounded-full px-2 font-medium normal-case text-base-content/70 hover:bg-base-200 ${
                              everyRowPicked
                                ? ''
                                : 'opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100'
                            }`}
                            onClick={() => (everyRowPicked ? clearSelection() : checkEveryRow())}
                          >
                            {everyRowPicked ? (
                              <XMarkIcon className="h-3.5 w-3.5" />
                            ) : (
                              <CheckIcon className="h-3.5 w-3.5" />
                            )}
                            {everyRowPicked ? 'Clear' : `Select all ${rows.length}`}
                          </button>
                        )}
                      </span>
                    </th>
                    <th
                      className="hidden w-[11rem] cursor-pointer select-none font-medium md:table-cell"
                      onClick={() => toggleSort('scope_label')}
                    >
                      Location{sortIndicator('scope_label')}
                    </th>
                    <th className="hidden w-[9rem] font-medium lg:table-cell">Category</th>
                    <th className="hidden w-[11rem] font-medium lg:table-cell">Uploaded by</th>
                    <th
                      className="w-[10rem] cursor-pointer select-none font-medium"
                      onClick={() => toggleSort('created_at')}
                    >
                      Date modified{sortIndicator('created_at')}
                    </th>
                    <th className="w-[5.5rem] text-right font-medium">Actions</th>
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
                          <CaseDepartmentDot
                            info={caseInfo.get(item.lead_number)}
                            colours={departmentColours}
                          />
                          {/* The preview hangs off the icon alone, so passing over a row on the
                              way somewhere else does not open anything. */}
                          <span className="shrink-0" {...casePeekProps(item.lead_number)}>
                            <FolderSolidIcon className="h-7 w-7 text-primary" />
                          </span>
                          <span className="min-w-0 flex-1 truncate">
                            <span className="font-medium text-base-content">{item.lead_number}</span>
                            {/* Whose case it is comes from a second read of the leads. Until it
                                lands its place is held, so the row fills in rather than jumps. */}
                            {caseNamePending(item.lead_number) ? (
                              <span className="ml-2 inline-block h-3 w-32 max-w-[40%] animate-pulse rounded bg-base-300 align-middle" />
                            ) : caseInfo.get(item.lead_number)?.name ? (
                              <span className="ml-2 text-base-content/60">
                                {caseInfo.get(item.lead_number)?.name}
                              </span>
                            ) : null}
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
                      <td className={`whitespace-nowrap text-sm tabular-nums ${MUTED_CELL_CLASS}`}>
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
                                onSelect: () => openLeadPage(item.lead_number),
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
                      } ${landedFolderId === folder.id ? 'drive-drop-land' : ''} ${
                        dragging?.kind === 'folder' && dragging.id === folder.id ? 'opacity-40' : ''
                      }`}
                      onClick={() => setSelection({ kind: 'folder', id: folder.id })}
                      onDoubleClick={() => openFolder(folder)}
                      {...folderDragDropProps(folder)}
                    >
                      <td className="max-w-[26rem]">
                        <span className="flex items-center gap-3">
                          <span className="relative shrink-0" {...folderPeekProps(folder)}>
                            <FolderSolidIcon className="h-7 w-7 text-slate-500" />
                            {folder.client_visible === false && <HiddenFromClientMark />}
                          </span>
                          <span className="min-w-0 flex-1 truncate font-medium text-base-content">
                            {folder.title}
                          </span>
                        </span>
                      </td>
                      <td className="hidden truncate text-sm text-base-content/70 md:table-cell">
                        {folder.scope_key}
                      </td>
                      <td className="hidden text-sm text-base-content/70 lg:table-cell">Folder</td>
                      <td className="hidden lg:table-cell" />
                      <td className={`whitespace-nowrap text-sm tabular-nums ${MUTED_CELL_CLASS}`}>
                        {formatModified(folder.created_at)}
                      </td>
                      <td onClick={(event) => event.stopPropagation()}>
                        <div className="flex items-center justify-end">
                          <RowActionsMenu actions={folderActions(folder)} />
                        </div>
                      </td>
                    </tr>
                  ))}
                  {loading && rows.length === 0 && <DriveSkeletonRows />}
                  {/* Nothing here to point at, so the empty row neither lights up under the
                      pointer nor rules a line under itself. daisyUI paints the hover on the cells,
                      which is why the cell carries the override too. */}
                  {!loading &&
                    rows.length === 0 &&
                    folders.length === 0 &&
                    caseRows.length === 0 &&
                    !error && (
                      <tr className="!bg-none !bg-transparent hover:!bg-transparent">
                        <td colSpan={6} className="!bg-transparent p-0 hover:!bg-transparent">
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
                          isPicked(key) ? 'bg-primary/10' : 'hover:bg-base-200/40'
                        } ${dragging?.kind === 'doc' && dragging.key === key ? 'opacity-40' : ''}`}
                        onClick={(event) => {
                          // Command or Control held means "and this one too", the way any file
                          // list adds to what is already picked. Plainly clicked, a row is the
                          // only one picked and whatever was held before it is let go.
                          if (event.metaKey || event.ctrlKey) {
                            toggleChecked(key);
                            return;
                          }
                          clearChecked();
                          setSelection({ kind: 'doc', key });
                        }}
                        onDoubleClick={() => void openPreview(row)}
                        {...documentDragProps(row, key)}
                      >
                        <td className="max-w-[26rem]">
                          <span className="flex w-full items-center gap-3">
                            {/* Resting on the icon shows the document itself. */}
                            <span className="relative shrink-0" {...documentPeekProps(row)}>
                              <DocumentFileGlyph
                                fileType={row.mime_type || ''}
                                fileName={row.file_name}
                                className="h-7 w-7"
                              />
                              {row.client_visible === false && <HiddenFromClientMark />}
                            </span>
                            <span className="min-w-0 truncate font-medium text-base-content">
                              {row.file_name}
                            </span>
                          </span>
                        </td>
                        <td className="hidden overflow-hidden md:table-cell">
                          <div className="flex min-w-0 flex-col gap-0.5">
                            <div className="flex min-w-0 items-center gap-2">
                              <span
                                className={`badge badge-sm shrink-0 border-none font-medium ${SOURCE_BADGE[row.source]}`}
                              >
                                {DOCUMENT_SOURCE_LABELS[row.source]}
                              </span>
                              {row.source === 'lead' && row.scope_key ? (
                                <button
                                  type="button"
                                  className="link link-hover min-w-0 truncate text-sm"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    openLeadPage(row.scope_key as string);
                                  }}
                                >
                                  {row.scope_label}
                                </button>
                              ) : (
                                <span className="min-w-0 truncate text-sm text-base-content/70">
                                  {row.scope_label}
                                </span>
                              )}
                            </div>
                            {/* One case can hold the same document in two different folders, so
                                where the file is filed is spelled out under the case it belongs
                                to. Files sitting loose in a case have no path and say nothing. */}
                            {row.folder_path ? (
                              <span
                                className={`flex min-w-0 items-center gap-1 text-xs ${MUTED_CELL_CLASS}`}
                                title={folderPathLabel(row.folder_path)}
                              >
                                <FolderIcon className="h-3 w-3 shrink-0" aria-hidden />
                                <span className="min-w-0 truncate" dir="auto">
                                  {folderPathLabel(row.folder_path)}
                                </span>
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="hidden truncate text-sm text-base-content/70 lg:table-cell">
                          {row.category || '—'}
                        </td>
                        <td className="hidden overflow-hidden lg:table-cell">
                          {uploader || uploaderKey ? (
                            <DocumentUploaderCell
                              name={uploader?.name || uploaderKey}
                              photoUrl={uploader?.photoUrl}
                              isClientPortalUpload={uploaderKey === 'portal-client'}
                              nameClassName={UPLOADER_NAME_CLASS}
                            />
                          ) : (
                            <span className="text-sm text-base-content/40">—</span>
                          )}
                        </td>
                        <td className={`whitespace-nowrap text-sm tabular-nums ${MUTED_CELL_CLASS}`}>
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
                  {loadingMore && <DriveSkeletonRows count={3} />}
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

      {shareRow && (
        <DocumentShareDialog
          target={documentIndexShareTarget(shareRow)}
          onClose={() => setShareRow(null)}
        />
      )}

      {transfer && (
        <DocumentsDriveCreateModal
          mode={transfer.mode}
          sourceRows={transfer.rows}
          onClose={() => setTransfer(null)}
          onDone={() => {
            setTransfer(null);
            clearChecked();
            setCreatedNonce((prev) => prev + 1);
            reload();
          }}
        />
      )}

      {/* The summary slides in beside the list rather than over it, so the file it belongs to
          stays in view. Reading only: it is offered on files that have already been read, and a
          new one is asked for from the case drawer or from RMQ AI. */}
      {summaryRow ? (
        <>
          <div
            className="fixed inset-0 z-[60] bg-black/20"
            onClick={() => setSummaryRow(null)}
            aria-hidden
          />
          <aside
            className="fixed inset-y-0 right-0 z-[61] flex w-full max-w-md flex-col border-l border-base-300 bg-white shadow-2xl dark:bg-base-100"
            aria-label={`AI summary of ${summaryRow.file_name}`}
          >
            <div className="flex items-start gap-3 border-b border-base-200 px-4 py-3">
              <DocumentFileGlyph
                fileType={summaryRow.mime_type || ''}
                fileName={summaryRow.file_name}
                className="h-7 w-7"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-base-content" title={summaryRow.file_name}>
                  {summaryRow.file_name}
                </p>
                <p className="truncate text-xs text-base-content/55">
                  {[
                    summaryRow.category,
                    summaryRow.source === 'lead' ? summaryRow.scope_label : DOCUMENT_SOURCE_LABELS[summaryRow.source],
                    formatModified(summaryRow.created_at),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-circle shrink-0"
                onClick={() => setSummaryRow(null)}
                aria-label="Close the summary"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-base-content/45">
                <SparklesIcon className="h-3.5 w-3.5" />
                AI summary
              </p>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-base-content/90">
                {summaryRow.ai_summary?.trim()}
              </p>
            </div>
            <div className="flex items-center gap-2 border-t border-base-200 px-4 py-3">
              <button
                type="button"
                className="btn btn-sm flex-1 gap-2"
                onClick={() => void openPreview(summaryRow)}
              >
                <EyeIcon className="h-4 w-4" />
                Open the file
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm gap-2"
                onClick={() => {
                  const text = summaryRow.ai_summary?.trim() || '';
                  if (!text) return;
                  void navigator.clipboard
                    ?.writeText(text)
                    .then(() => toast.success('Summary copied'))
                    .catch(() => toast.error('Could not copy the summary'));
                }}
              >
                <DocumentDuplicateIcon className="h-4 w-4" />
                Copy
              </button>
            </div>
          </aside>
        </>
      ) : null}

      {viewerDocs && viewerDocs.length > 0 && (
        <DocumentViewerModal
          isOpen
          onClose={() => {
            setViewerDocs(null);
            setViewerRows([]);
            setViewerAutoEdit(false);
          }}
          onActiveDocumentChange={handleViewerDocumentChange}
          // The chat is told which file is on screen, so it can be asked about it from in here.
          onOpenAiChat={() => openRmqAiChat()}
          documents={viewerDocs}
          initialIndex={viewerIndex}
          bucketName={viewerDocs[0].storageBucket || undefined}
          // Word and Excel files open in the editor and save back over themselves from here.
          allowOfficeEditing
          autoStartOfficeEdit={viewerAutoEdit}
          onOfficeSaved={() => reload()}
          // Only files that came from a listed row can be renamed or shared the drive's way; a
          // brand new one has no row behind it yet.
          onRename={viewerRows.length > 0 ? renameViewerDoc : undefined}
          onShare={
            viewerRows.length > 0
              ? (doc) => {
                  const row = viewerRowOf(doc);
                  if (row) setShareRow(row);
                }
              : undefined
          }
        />
      )}

      {/* Follows the mouse rather than the layout, so it is drawn at the window's level. */}
      {peek &&
        createPortal(
          <div
            className="pointer-events-none fixed z-[70] w-72 overflow-hidden rounded-xl border border-base-300 bg-[#f8fafd] p-3 shadow-2xl dark:bg-base-200"
            style={{ top: peek.top, left: peek.left }}
          >
            <p className="mb-2 truncate text-xs font-semibold uppercase tracking-wide text-base-content/40">
              {peek.target.title}
            </p>
            {peek.target.kind === 'doc' ? (
              <>
                <DocumentSidebarThumb
                  name={peek.target.row.file_name}
                  url=""
                  fileType={peek.target.row.mime_type || ''}
                  storagePath={peek.target.row.storage_path}
                  bucketName={peek.target.row.storage_bucket}
                />
                <p className="mt-2 flex items-center justify-between gap-2 text-xs text-base-content/50">
                  <span className="truncate">{peek.target.row.category || '—'}</span>
                  <span className="shrink-0 tabular-nums">
                    {formatDocumentSize(peek.target.row.file_size)}
                  </span>
                </p>
              </>
            ) : !peekItems ? (
              <span className="loading loading-spinner loading-xs text-base-content/40" />
            ) : peekItems.folders.length === 0 && peekItems.documents.length === 0 ? (
              <p className="text-sm text-base-content/50">
                {peek.target.kind === 'case' ? 'This case holds no files' : 'This folder is empty'}
              </p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {peekItems.folders.map((title) => (
                  <li key={`peek-folder-${title}`} className="flex items-center gap-2">
                    <FolderSolidIcon className="h-4 w-4 shrink-0 text-slate-400" />
                    <span className="truncate text-base-content/80">{title}</span>
                  </li>
                ))}
                {peekItems.documents.map((fileName) => (
                  <li key={`peek-doc-${fileName}`} className="flex items-center gap-2">
                    <DocumentFileGlyph fileType="" fileName={fileName} className="h-4 w-4 shrink-0" />
                    <span className="truncate text-base-content/70">{fileName}</span>
                  </li>
                ))}
                {peekItems.more > 0 && (
                  <li className="pl-6 text-xs text-base-content/40">
                    and {peekItems.more.toLocaleString()} more
                  </li>
                )}
              </ul>
            )}
          </div>,
          document.body,
        )}

      {renameRow && (
        <RenameDocumentDialog
          row={renameRow}
          onClose={() => setRenameRow(null)}
          onRenamed={(fileName) => applyRename(renameRow, fileName)}
        />
      )}

      {renameFolder && (
        <RenameFolderDialog
          folder={renameFolder}
          onClose={() => setRenameFolder(null)}
          onSave={(title) => saveFolderTitle(renameFolder, title)}
        />
      )}

      {moveRows && moveRows.length > 0 && (
        <MoveDocumentDialog
          rows={moveRows}
          onClose={() => setMoveRows(null)}
          onMoved={() => {
            setMoveRows(null);
            clearChecked();
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
                  {deleteTarget.kind === 'doc'
                    ? 'Delete this document?'
                    : deleteTarget.kind === 'docs'
                      ? `Delete ${deleteTarget.rows.length} ${
                          deleteTarget.rows.length === 1 ? 'file' : 'files'
                        }?`
                      : 'Delete this folder?'}
                </h2>
                {/* One file is named; a selection is counted in the heading, since a list of
                    names long enough to matter is too long to read. */}
                {deleteTarget.kind !== 'docs' && (
                  <p className="mt-1 break-words text-sm text-base-content/70">
                    {deleteTarget.kind === 'doc'
                      ? deleteTarget.row.file_name
                      : deleteTarget.folder.title}
                  </p>
                )}
                <p className="mt-3 text-sm text-base-content/60">
                  {deleteTarget.kind === 'doc'
                    ? 'The file and its record go for good. This cannot be undone.'
                    : deleteTarget.kind === 'docs'
                      ? 'The files and their records go for good. This cannot be undone.'
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
                className="btn btn-error gap-2 rounded-full px-7"
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

/**
 * Renames one document from the row menu. Only the name it is listed under changes; the stored
 * file stays exactly where it was uploaded.
 */
const RenameDocumentDialog: React.FC<{
  row: DocumentIndexRow;
  onClose: () => void;
  onRenamed: (fileName: string) => void;
}> = ({ row, onClose, onRenamed }) => {
  const [value, setValue] = useState(row.file_name);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const next = value.trim();
    if (!next || saving) return;
    if (next === row.file_name) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      const fileName = await renameDocumentIndexRow(row, next);
      onRenamed(fileName);
      toast.success('Name updated');
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Could not rename this file');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-base-100 shadow-2xl">
        <div className="px-5 py-5">
          <h2 className="text-lg font-semibold">Rename document</h2>
          <input
            type="text"
            className="input input-bordered mt-4 w-full"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void save();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
              }
            }}
            autoFocus
            disabled={saving}
            aria-label="File name"
          />
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-base-300 px-5 py-4">
          <button type="button" className="btn btn-ghost btn-sm" disabled={saving} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary gap-2 rounded-full px-7"
            disabled={saving || !value.trim()}
            onClick={() => void save()}
          >
            {saving && <span className="loading loading-spinner loading-xs" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * Renames a folder somebody made, in a case tree or in one of the spaces. Only its name changes:
 * everything filed inside it stays where it is.
 */
const RenameFolderDialog: React.FC<{
  folder: DocumentFolder;
  onSave: (title: string) => Promise<void>;
  onClose: () => void;
}> = ({ folder, onSave, onClose }) => {
  const [value, setValue] = useState(folder.title);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const next = value.trim();
    if (!next || saving) return;
    if (next === folder.title) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      await onSave(next);
      toast.success('Folder renamed');
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Could not rename this folder');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-base-100 shadow-2xl">
        <div className="px-5 py-5">
          <h2 className="text-lg font-semibold">Rename folder</h2>
          <input
            type="text"
            className="input input-bordered mt-4 w-full"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void save();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
              }
            }}
            autoFocus
            disabled={saving}
            aria-label="Folder name"
          />
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-base-300 px-5 py-4">
          <button type="button" className="btn btn-ghost btn-sm" disabled={saving} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary gap-2 rounded-full px-7"
            disabled={saving || !value.trim()}
            onClick={() => void save()}
          >
            {saving && <span className="loading loading-spinner loading-xs" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * Moves case documents into another folder of the same lead, tab and area. Several at once, which
 * is one list of ids to write and one folder tree to choose from — the caller has already made
 * sure they share it.
 */
const MoveDocumentDialog: React.FC<{
  rows: DocumentIndexRow[];
  onClose: () => void;
  onMoved: () => void;
}> = ({ rows, onClose, onMoved }) => {
  const row = rows[0];
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
      await moveCaseDocumentsToFolder(
        rows.map((item) => item.row_id),
        target,
      );
      toast.success(rows.length > 1 ? `Moved ${rows.length} files` : 'Moved');
      onMoved();
    } catch (err: any) {
      toast.error(err?.message || 'Could not move these files');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-base-100 shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-base-300 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">
              {rows.length > 1 ? `Move ${rows.length} files` : 'Move file'}
            </h2>
            <p className="mt-0.5 truncate text-sm text-base-content/60">
              {rows.length > 1 ? rows.map((item) => item.file_name).join(', ') : row.file_name}
            </p>
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
            className="btn btn-primary gap-2 rounded-full px-7"
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
