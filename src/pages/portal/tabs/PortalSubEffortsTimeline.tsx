import React, { useEffect, useMemo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DocumentIcon,
  ArrowDownTrayIcon,
  FolderIcon,
  FolderOpenIcon,
} from '@heroicons/react/24/outline';
import {
  CheckCircleIcon as CheckCircleSolidIcon,
  FolderIcon as FolderSolidIcon,
} from '@heroicons/react/24/solid';
import {
  DocumentPreviewModal,
  type DocumentPreviewItem,
} from '../../../components/DocumentModal';
import { portalGetDocumentSignedUrls } from '../../../lib/portalApi';
import {
  findCurrentPortalSubEffortId,
  getPortalSubEffortProgress,
  type PortalSubEffortFolder,
  type PortalSubEffortProgress,
  type PortalSubEffortRow,
} from '../../../lib/portalSubEfforts';
import { EntityAvatar } from '../components/portalTheme';
import {
  DocumentDriveTable,
  RowKebabMenu,
  type DriveTableColumn,
} from '../../../components/documentDriveTable';
import { useFileHoverPeek } from '../../../components/documentHoverPeek';
import {
  translatePortalDynamicDescription,
  translatePortalDynamicLabel,
} from '../i18n/portalDynamicLabels';

/** What the client is shown about a file, in the drive's own list. */
function buildPortalDocColumns(t: TFunction): DriveTableColumn[] {
  return [
    { id: 'type', label: t('stages.timeline.columns.type'), className: 'hidden w-[11rem] sm:table-cell' },
  ];
}

type Props = {
  rows: PortalSubEffortRow[];
  folders?: PortalSubEffortFolder[];
  emptyMessage?: string;
};

type DocItem = {
  url?: string;
  path?: string;
  name?: string;
  mimeType?: string;
  folder_id?: string | null;
};

function asArray(value: unknown): unknown[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return [value];
}

function normalizeDocItems(documentUrl: unknown): DocItem[] {
  if (!documentUrl) return [];

  if (typeof documentUrl === 'string') {
    const s = documentUrl.trim();
    if (!s) return [];
    if (/^https?:\/\//i.test(s)) return [{ url: s }];
    return [{ path: s }];
  }
  if (Array.isArray(documentUrl)) {
    return documentUrl.flatMap((u) => normalizeDocItems(u));
  }
  if (typeof documentUrl === 'object' && documentUrl !== null) {
    const o = documentUrl as Record<string, unknown>;
    const candidates = [
      ...asArray(o.urls),
      ...asArray(o.files),
      ...asArray(o.documents),
    ];
    if (o.path || o.url || o.publicUrl || o.signedUrl) {
      const item: DocItem = {};
      if (typeof o.path === 'string') item.path = o.path.trim();
      if (typeof o.url === 'string') item.url = o.url.trim();
      else if (typeof o.publicUrl === 'string') item.url = o.publicUrl.trim();
      else if (typeof o.signedUrl === 'string') item.url = o.signedUrl.trim();
      if (typeof o.name === 'string') item.name = o.name;
      if (typeof o.mimeType === 'string') item.mimeType = o.mimeType;
      else if (typeof o.contentType === 'string') item.mimeType = o.contentType;
      const folderRaw = o.folder_id;
      if (typeof folderRaw === 'string' && folderRaw.trim()) item.folder_id = folderRaw.trim();
      else if (folderRaw === null) item.folder_id = null;
      return [item, ...candidates.flatMap((u) => normalizeDocItems(u))];
    }
    return candidates.flatMap((u) => normalizeDocItems(u));
  }

  return [];
}

function isImageUrl(url: string): boolean {
  const withoutQuery = url.split('?')[0].split('#')[0].toLowerCase();
  return (
    withoutQuery.endsWith('.png') ||
    withoutQuery.endsWith('.jpg') ||
    withoutQuery.endsWith('.jpeg') ||
    withoutQuery.endsWith('.gif') ||
    withoutQuery.endsWith('.webp')
  );
}

function isPdfUrl(url: string): boolean {
  const withoutQuery = url.split('?')[0].split('#')[0].toLowerCase();
  return withoutQuery.endsWith('.pdf');
}

function resolveDocItems(
  documentUrl: unknown,
  signedUrls: Record<string, string>,
): ResolvedDoc[] {
  return normalizeDocItems(documentUrl)
    .map((d) => {
      const raw = (d.url || d.path || '').trim();
      if (!raw) return null;
      const url = d.url
        ? d.url
        : d.path
          ? (signedUrls[d.path] ?? '')
          : '';
      const name = d.name || (d.path ? d.path.split('/').slice(-1)[0] : undefined);
      const mimeType = d.mimeType;
      const isImage =
        (typeof mimeType === 'string' && mimeType.startsWith('image/')) ||
        (url ? isImageUrl(url) : false) ||
        (name ? isImageUrl(name) : false) ||
        (raw ? isImageUrl(raw) : false);
      const isPdf =
        mimeType === 'application/pdf' ||
        (url ? isPdfUrl(url) : false) ||
        (name ? isPdfUrl(name) : false) ||
        (raw ? isPdfUrl(raw) : false);
      return {
        raw,
        url,
        name,
        isImage,
        isPdf,
        folder_id: d.folder_id ?? null,
      };
    })
    .filter(Boolean) as ResolvedDoc[];
}

function guessStoragePaths(documentUrl: unknown): string[] {
  return normalizeDocItems(documentUrl)
    .map((d) => (typeof d.path === 'string' ? d.path.trim() : ''))
    .filter(Boolean);
}

type ResolvedDoc = {
  raw: string;
  url: string;
  name?: string;
  isImage: boolean;
  isPdf: boolean;
  folder_id?: string | null;
};

function guessFileType(doc: ResolvedDoc): string {
  const name = (doc.name || doc.raw || '').toLowerCase();
  if (doc.isPdf || name.endsWith('.pdf')) return 'application/pdf';
  if (doc.isImage || isImageUrl(name) || isImageUrl(doc.raw)) {
    if (name.endsWith('.png')) return 'image/png';
    if (name.endsWith('.gif')) return 'image/gif';
    if (name.endsWith('.webp')) return 'image/webp';
    return 'image/jpeg';
  }
  return 'application/octet-stream';
}

function docsToPreviewItems(docs: ResolvedDoc[], t: TFunction): DocumentPreviewItem[] {
  return docs
    .filter((d) => !!d.url)
    .map((d, i) => ({
      id: d.raw || String(i),
      name: d.name || d.raw.split('/').pop() || t('common.documentFallback'),
      downloadUrl: d.url,
      fileType: guessFileType(d),
    }));
}

function formatFileTypeLabel(doc: ResolvedDoc, t: TFunction): string {
  const name = (doc.name || doc.raw || '').toLowerCase();
  if (doc.isPdf || name.endsWith('.pdf')) return t('stages.timeline.fileTypes.pdfDocument');
  if (doc.isImage) {
    const ext = name.split('.').pop()?.toUpperCase();
    return ext ? t('stages.timeline.fileTypes.imageWithExt', { ext }) : t('stages.timeline.fileTypes.image');
  }
  const ext = name.split('.').pop();
  return ext ? ext.toUpperCase() : t('common.documentFallback');
}

function StageUpdaterMeta({
  name,
  photoUrl,
  compact = false,
}: {
  name?: string | null;
  photoUrl?: string | null;
  compact?: boolean;
}) {
  const { i18n } = useTranslation();
  const raw = name?.trim() || '';
  if (!raw) return null;
  const who = translatePortalDynamicLabel(i18n.language, raw);

  return (
    <div
      className={`flex min-w-0 items-center gap-1.5 ${
        compact ? 'mt-1.5 text-[12px] text-gray-500' : 'mt-2 text-sm text-gray-500'
      }`}
    >
      <EntityAvatar
        name={who}
        imageUrl={photoUrl}
        stableKey={`portal-stage-updater::${raw}`}
        className={compact ? 'h-8 w-8 text-[11px]' : 'h-7 w-7 text-[11px]'}
      />
      <span className="min-w-0 truncate font-medium text-gray-600">{who}</span>
    </div>
  );
}

function StageProgressIcon({ progress }: { progress: PortalSubEffortProgress }) {
  if (progress === 'completed') {
    return <CheckCircleSolidIcon className="h-[22px] w-[22px] shrink-0 text-emerald-500" aria-hidden />;
  }
  if (progress === 'in_progress') {
    return (
      <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center" aria-hidden>
        <span className="h-3.5 w-3.5 rounded-full bg-blue-600 shadow-[0_0_0_5px_rgba(37,99,235,0.15)]" />
      </span>
    );
  }
  return (
    <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center" aria-hidden>
      <span className="h-3.5 w-3.5 rounded-full border-2 border-slate-300 bg-white" />
    </span>
  );
}

function StageProgressBadge({ progress }: { progress: PortalSubEffortProgress }) {
  const { t } = useTranslation();
  const label =
    progress === 'completed'
      ? t('common.status.done')
      : progress === 'in_progress'
        ? t('common.status.inProcess')
        : t('common.status.pending');
  const tone =
    progress === 'completed'
      ? 'bg-emerald-50 text-emerald-700'
      : progress === 'in_progress'
        ? 'bg-blue-100 text-blue-800'
        : 'bg-slate-100 text-slate-500';

  return (
    <span
      className={`ms-auto inline-flex shrink-0 items-center rounded-lg px-3 py-1.5 text-sm font-semibold leading-none ${tone}`}
      title={label}
      aria-label={label}
    >
      {label}
    </span>
  );
}

function PortalStageTimelineItem({
  row,
  progress,
  onSelect,
}: {
  row: PortalSubEffortRow;
  progress: PortalSubEffortProgress;
  onSelect: () => void;
}) {
  const { i18n } = useTranslation();
  const stageTitle = translatePortalDynamicLabel(
    i18n.language,
    row.sub_effort_name,
    row.sub_effort_name_he,
  );
  const subCategoryLabel = (row.sub_category_efforts ?? [])
    .map((item) => translatePortalDynamicLabel(i18n.language, item.name, item.name_he))
    .filter(Boolean)
    .join(' · ');
  const isPending = progress === 'pending';

  return (
    <div className="relative ps-[4.25rem]">
      <div className="absolute start-0 top-0 z-[2]">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-xl ring-4 ring-white">
          <StageProgressIcon progress={progress} />
        </div>
      </div>
      <button
        type="button"
        onClick={onSelect}
        className="group w-full cursor-pointer text-start"
      >
        <div className="min-w-0">
          <div
            className={`rounded-2xl border p-4 shadow-md transition-all duration-300 group-hover:scale-[1.01] group-hover:shadow-lg sm:p-5 ${
              progress === 'in_progress'
                ? 'border-blue-200 bg-blue-50'
                : isPending
                  ? 'border-slate-100 bg-slate-50 opacity-75 shadow-none'
                  : 'border-base-200 bg-white'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="break-words text-base font-semibold leading-snug text-gray-900 [overflow-wrap:anywhere]">
                  {stageTitle}
                </p>
                {subCategoryLabel ? (
                  <p className="mt-1 line-clamp-2 text-sm leading-snug text-gray-500">{subCategoryLabel}</p>
                ) : null}
              </div>
              <StageProgressBadge progress={progress} />
            </div>
            <StageUpdaterMeta name={row.updated_by} photoUrl={row.updated_by_photo_url} />
          </div>
        </div>
      </button>
    </div>
  );
}

const PortalSubEffortsTimeline: React.FC<Props> = ({ rows, folders = [], emptyMessage }) => {
  const { t, i18n } = useTranslation();
  const portalDocColumns = useMemo(() => buildPortalDocColumns(t), [t]);
  const currentStageId = useMemo(() => findCurrentPortalSubEffortId(rows), [rows]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [urlsLoading, setUrlsLoading] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewItems, setPreviewItems] = useState<DocumentPreviewItem[]>([]);
  const [previewInitialIndex, setPreviewInitialIndex] = useState(0);
  /** Resting on a file's icon shows the file itself, so it can be told from the one beside it. */
  const { peekProps, peekNode } = useFileHoverPeek();

  const selected = useMemo(
    () => rows.find((r) => r.id === selectedId) ?? null,
    [rows, selectedId],
  );

  const stageFolders = useMemo(
    () => (selected ? folders.filter((folder) => folder.lead_sub_effort_id === selected.id) : []),
    [folders, selected],
  );

  /** Root-first way down to the open folder, for the path above the list. */
  const folderTrail = useMemo(() => {
    const byId = new Map(stageFolders.map((folder) => [folder.id, folder]));
    const trail: PortalSubEffortFolder[] = [];
    let cursor = activeFolderId ? byId.get(activeFolderId) : undefined;
    while (cursor && trail.length < 12) {
      trail.unshift(cursor);
      cursor = cursor.parent_id ? byId.get(cursor.parent_id) : undefined;
    }
    return trail;
  }, [stageFolders, activeFolderId]);

  const visibleFolders = useMemo(
    () => stageFolders.filter((folder) => (folder.parent_id ?? null) === activeFolderId),
    [stageFolders, activeFolderId],
  );


  const handleSelectRow = (id: number) => {
    setSelectedId(id);
    setActiveFolderId(null);
  };

  const closeDetail = () => {
    setSelectedId(null);
    setActiveFolderId(null);
  };

  const paths = useMemo(() => (selected ? guessStoragePaths(selected.document_url) : []), [selected]);

  const docs = useMemo(
    () => (selected ? resolveDocItems(selected.document_url, signedUrls) : []),
    [selected, signedUrls],
  );

  /**
   * How many of the stage's files a folder holds, counting the folders inside it: a folder saying
   * nothing is in it while a folder within is full would read as a mistake.
   */
  const filesInsideFolder = useMemo(() => {
    const counts = new Map<string, number>();
    const parentOf = new Map(stageFolders.map((folder) => [folder.id, folder.parent_id ?? null]));
    for (const doc of docs) {
      let cursor = doc.folder_id ?? null;
      let guard = 0;
      while (cursor && parentOf.has(cursor) && guard < 12) {
        counts.set(cursor, (counts.get(cursor) || 0) + 1);
        cursor = parentOf.get(cursor) ?? null;
        guard += 1;
      }
    }
    return counts;
  }, [stageFolders, docs]);

  /*
   * The files at the level now open. A file filed in a folder the stage does not show — the case
   * team moved it elsewhere — belongs at the top rather than nowhere.
   */
  const visibleDocs = useMemo(() => {
    const known = new Set(stageFolders.map((folder) => folder.id));
    return docs.filter((doc) => {
      const folderId = doc.folder_id && known.has(doc.folder_id) ? doc.folder_id : null;
      return folderId === activeFolderId;
    });
  }, [docs, stageFolders, activeFolderId]);

  const hasDocs = docs.length > 0;
  const hasFolders = stageFolders.length > 0;
  const docsReady = visibleDocs.some((d) => d.url);

  const openDocPreview = useCallback(
    (doc: ResolvedDoc) => {
      if (!doc.url) return;
      const items = docsToPreviewItems(visibleDocs, t);
      const docId = doc.raw || doc.url;
      const idx = items.findIndex((item) => item.id === docId);
      setPreviewItems(items);
      setPreviewInitialIndex(idx >= 0 ? idx : 0);
      setPreviewOpen(true);
    },
    [visibleDocs, t],
  );

  // Notes and documents stay closed until a step is opened. Drop a selection that no longer exists.
  useEffect(() => {
    if (!rows.length) {
      setSelectedId(null);
      setActiveFolderId(null);
      return;
    }
    setSelectedId((prev) => (prev != null && rows.some((row) => row.id === prev) ? prev : null));
  }, [rows]);

  useEffect(() => {
    if (activeFolderId && !stageFolders.some((folder) => folder.id === activeFolderId)) {
      setActiveFolderId(null);
    }
  }, [activeFolderId, stageFolders]);

  useEffect(() => {
    if (!paths.length) {
      setUrlsLoading(false);
      return;
    }
    void (async () => {
      setUrlsLoading(true);
      try {
        const urls = await portalGetDocumentSignedUrls(paths);
        setSignedUrls((prev) => ({ ...prev, ...urls }));
      } catch (e) {
        console.error('Failed to load document URLs', e);
      } finally {
        setUrlsLoading(false);
      }
    })();
  }, [paths.join('|')]);

  if (!rows.length) {
    return (
      <p className="text-gray-500">
        {emptyMessage ?? t('stages.timeline.emptyFallback')}
      </p>
    );
  }

  const selectedProgress = selected ? getPortalSubEffortProgress(selected, currentStageId) : 'pending';

  const selectedTitle = selected
    ? translatePortalDynamicLabel(i18n.language, selected.sub_effort_name, selected.sub_effort_name_he)
    : '';
  const selectedDescription = selected
    ? translatePortalDynamicDescription(
        i18n.language,
        selected.sub_effort_description,
        selected.sub_effort_description_he,
      )
    : '';

  return (
    <div>
      <div className={selected ? 'hidden' : 'w-full'}>
      <div className="mb-4 px-0.5 text-center">
        <span className="text-base font-semibold text-gray-800 md:text-lg">{t('stages.timeline.workflowTitle')}</span>
        {currentStageId == null && rows.every((row) => row.active === false) ? (
          <p className="mt-0.5 text-xs text-emerald-700 md:text-sm">{t('stages.timeline.allStagesComplete')}</p>
        ) : null}
      </div>
      <div className="relative w-full">
        <div className="absolute bottom-0 start-[22px] top-0 w-0.5 bg-base-300" aria-hidden />
        <div className="space-y-8 md:space-y-10">
          {rows.map((row) => (
            <PortalStageTimelineItem
              key={row.id}
              row={row}
              progress={getPortalSubEffortProgress(row, currentStageId)}
              onSelect={() => handleSelectRow(row.id)}
            />
          ))}
        </div>
      </div>
      </div>

      {selected && (
        <div className="w-full">
            <button
              type="button"
              onClick={closeDetail}
              className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary"
            >
              <ChevronLeftIcon className="h-4 w-4 rtl:rotate-180" />
              {t('stages.timeline.backToStages')}
            </button>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="break-words text-2xl font-bold text-gray-900 [overflow-wrap:anywhere] md:text-[28px]">{selectedTitle}</h3>
              </div>
              <StageProgressBadge progress={selectedProgress} />
            </div>
            {selectedDescription ? (
              <p className="mt-3 text-sm leading-relaxed text-gray-600 whitespace-pre-wrap">{selectedDescription}</p>
            ) : null}

          <div className="mt-5">
            <div className="mb-2 px-0.5">
              <span className="text-sm font-semibold text-gray-700">{t('stages.timeline.notesTitle')}</span>
            </div>
            <div className="rounded-[18px] bg-white px-5 py-4 shadow-sm">
              {selected.client_notes ? (
                <p className="text-sm leading-relaxed whitespace-pre-wrap break-words text-gray-800">
                  {selected.client_notes}
                </p>
              ) : (
                <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/60 px-4 py-3 text-sm text-gray-400">
                  {t('stages.timeline.notesEmpty')}
                </div>
              )}
            </div>
          </div>

          <div>
            <div className="mb-2 px-0.5">
              <span className="text-sm font-semibold text-gray-700">{t('stages.timeline.documentsTitle')}</span>
            </div>
            <div className="rounded-[18px] bg-white px-5 py-4 shadow-sm">
              {/* The folders are the case team's own, shown the way our drive shows them: the path
                  back up, then the folders of this level, then the files sitting in it. */}
              {hasFolders ? (
                <nav className="mb-3 flex min-w-0 flex-wrap items-center gap-1 text-sm" aria-label={t('documents.folderPathAria')}>
                  <button
                    type="button"
                    className={`inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium transition-colors ${
                      activeFolderId ? 'text-gray-500 hover:bg-gray-100' : 'text-gray-900'
                    }`}
                    onClick={() => setActiveFolderId(null)}
                  >
                    <FolderIcon className="h-4 w-4 shrink-0" aria-hidden />
                    {t('stages.timeline.allDocuments')}
                  </button>
                  {folderTrail.map((folder, index) => (
                    <span key={folder.id} className="inline-flex min-w-0 items-center gap-1">
                      <ChevronRightIcon className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden />
                      <button
                        type="button"
                        className={`max-w-[12rem] truncate rounded-md px-2 py-1 font-medium transition-colors ${
                          index === folderTrail.length - 1
                            ? 'text-gray-900'
                            : 'text-gray-500 hover:bg-gray-100'
                        }`}
                        onClick={() => setActiveFolderId(folder.id)}
                      >
                        {folder.title}
                      </button>
                    </span>
                  ))}
                </nav>
              ) : null}

              {!hasDocs && !hasFolders ? (
                <div className="flex min-h-[160px] flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50/50 px-5 py-10 text-center text-sm text-gray-400">
                  {t('stages.timeline.noDocumentsStage')}
                </div>
              ) : urlsLoading && !docsReady && !hasFolders ? (
                <div className="flex items-center gap-3 py-6 text-sm text-gray-500">
                  <span className="loading loading-spinner loading-sm" />
                  {t('stages.timeline.loadingDocuments')}
                </div>
              ) : (
                <DocumentDriveTable
                  columns={portalDocColumns}
                  minWidthClass="min-w-[520px]"
                  folders={visibleFolders.map((folder) => {
                    const count = filesInsideFolder.get(folder.id) || 0;
                    return {
                      key: `folder-${folder.id}`,
                      icon: <FolderSolidIcon className="h-7 w-7 text-slate-500" />,
                      name: folder.title,
                      title: folder.title,
                      below: (
                        <span className="text-xs text-gray-500">
                          {count === 0 ? t('common.empty') : t('stages.timeline.documentCount', { count })}
                          {folder.note ? ` · ${folder.note}` : ''}
                        </span>
                      ),
                      cells: {
                        type: <span className="text-sm text-gray-500">{t('common.folder')}</span>,
                      },
                      onClick: () => setActiveFolderId(folder.id),
                      actions: (
                        <RowKebabMenu
                          label={t('stages.timeline.folderActions.optionsFor', { name: folder.title })}
                          items={[
                            {
                              id: 'open',
                              label: t('stages.timeline.folderActions.openFolder'),
                              icon: FolderOpenIcon,
                              onSelect: () => setActiveFolderId(folder.id),
                            },
                          ]}
                        />
                      ),
                    };
                  })}
                  files={visibleDocs.map((doc, idx) => {
                    const label = doc.name || doc.raw.split('/').pop() || t('common.documentFallback');
                    const href = doc.url || doc.raw;
                    const canPreview = !!doc.url;
                    return {
                      key: `${doc.raw}-${idx}`,
                      icon: (
                        <span
                          className="relative inline-flex"
                          {...peekProps({
                            id: `${doc.raw}-${idx}`,
                            name: label,
                            url: doc.url,
                            fileType: guessFileType(doc),
                            note: formatFileTypeLabel(doc, t),
                          })}
                        >
                          <DocumentIcon
                            className={`h-7 w-7 ${doc.isPdf ? 'text-red-500/80' : 'text-slate-400'}`}
                          />
                        </span>
                      ),
                      name: label,
                      title: label,
                      onNameClick: canPreview ? () => openDocPreview(doc) : undefined,
                      onDoubleClick: canPreview ? () => openDocPreview(doc) : undefined,
                      cells: {
                        type: (
                          <span className="block truncate text-sm text-gray-500">
                            {formatFileTypeLabel(doc, t)}
                          </span>
                        ),
                      },
                      actions: (
                        <RowKebabMenu
                          label={t('stages.timeline.folderActions.optionsFor', { name: label })}
                          items={[
                            ...(canPreview
                              ? [
                                  {
                                    id: 'preview',
                                    label: t('common.preview'),
                                    icon: DocumentIcon,
                                    onSelect: () => openDocPreview(doc),
                                  },
                                ]
                              : []),
                            {
                              id: 'download',
                              label: t('common.download'),
                              icon: ArrowDownTrayIcon,
                              href,
                              downloadAs: label,
                            },
                          ]}
                        />
                      ),
                    };
                  })}
                  empty={
                    <p className="px-4 py-8 text-center text-sm text-gray-400">
                      {activeFolderId
                        ? t('stages.timeline.folderEmpty')
                        : t('stages.timeline.noDocumentsStage')}
                    </p>
                  }
                  footer={
                    visibleDocs.length === 0 && visibleFolders.length > 0 ? (
                      <span className="block text-center text-xs text-gray-400">
                        {activeFolderId
                          ? t('stages.timeline.filesInFolderFooter')
                          : t('stages.timeline.filesOutsideFoldersFooter')}
                      </span>
                    ) : null
                  }
                />
              )}
            </div>
          </div>
        </div>
      )}

      {peekNode}

      <DocumentPreviewModal
        isOpen={previewOpen}
        onClose={() => {
          setPreviewOpen(false);
          setPreviewItems([]);
        }}
        documents={previewItems}
        initialIndex={previewInitialIndex}
      />

    </div>
  );
};

export default PortalSubEffortsTimeline;
