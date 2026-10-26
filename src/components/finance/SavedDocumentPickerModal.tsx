import React, { useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom';
import {
  CheckIcon,
  DocumentTextIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import {
  createDocumentIndexSignedUrl,
  fetchDocumentIndex,
  formatDocumentSize,
  hasStoredFile,
  stableRowKey,
  type DocumentIndexRow,
} from '../../lib/documentIndex';
import { financeExpenseDocumentMime } from '../../lib/financeExpenseDocuments';
import { fullScanPreviewUrl } from '../../lib/smartScan/scanCenterInbox';
import {
  formatScanDate,
  scanDisplayFilename,
  scanDocumentTypeLabel,
} from '../../lib/smartScan/smartScanFormat';
import { smartScanService } from '../../lib/smartScan/smartScanService';
import type { SmartScanItem } from '../../lib/smartScan/smartScanTypes';

type Source = 'case' | 'scan';

/** A document already in storage, with everything needed to fetch it on demand. */
type SavedPick = {
  key: string;
  fileName: string;
  /** The type the copy is attached under, already known to be one expenses accept. */
  mime: string;
  resolveUrl: () => Promise<string>;
};

type Props = {
  open: boolean;
  onClose: () => void;
  /** The case this expense is about, which the case list opens on. */
  leadNumber?: string | null;
  /** How many more files the expense has room for. */
  roomLeft: number;
  /** Fetched copies of the chosen documents, for the same list a dropped file lands in. */
  onAttach: (files: File[]) => void;
};

const HOW_MANY_CASE_ROWS = 40;

/** Case folders store their path with bare slashes; this is the same path written for reading. */
function folderPathLabel(path: string | null): string {
  return (path || '')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' / ');
}

function caseRowSublabel(row: DocumentIndexRow): string {
  return [
    row.scope_label || row.scope_key,
    folderPathLabel(row.folder_path),
    formatDocumentSize(row.file_size),
  ]
    .filter(Boolean)
    .join(' · ');
}

function scanItemSublabel(item: SmartScanItem): string {
  return [item.lead?.leadNumber, scanDocumentTypeLabel(item), formatScanDate(item.createdAt)]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Picks a document the office already holds — filed under a case, or waiting in Smart Scan's
 * history — to attach to an expense.
 *
 * What is attached is a copy: the file is fetched here and handed over as if it had just been
 * dropped on the form, so the expense keeps its own invoice even if the original is later renamed,
 * moved or deleted. Nothing about the document it came from changes.
 */
const SavedDocumentPickerModal: React.FC<Props> = ({
  open,
  onClose,
  leadNumber = null,
  roomLeft,
  onAttach,
}) => {
  const [source, setSource] = useState<Source>('case');
  const [search, setSearch] = useState('');
  const [onlyThisCase, setOnlyThisCase] = useState(true);
  const [caseRows, setCaseRows] = useState<DocumentIndexRow[]>([]);
  const [caseLoading, setCaseLoading] = useState(false);
  const [scanItems, setScanItems] = useState<SmartScanItem[]>([]);
  const [scanLoading, setScanLoading] = useState(false);
  const [selected, setSelected] = useState<Map<string, SavedPick>>(new Map());
  const [attaching, setAttaching] = useState(false);

  const caseKey = (leadNumber || '').trim();

  useEffect(() => {
    if (!open) return;
    setSource('case');
    setSearch('');
    setOnlyThisCase(true);
    setSelected(new Map());
    setAttaching(false);
  }, [open]);

  // Case documents are read as the term is typed, since one case can hold hundreds of files.
  useEffect(() => {
    if (!open || source !== 'case') return;
    let cancelled = false;
    const scopeKey = onlyThisCase && caseKey ? caseKey : null;
    setCaseLoading(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const { rows } = await fetchDocumentIndex({
            sources: ['lead'],
            scopeKey,
            search,
            pageSize: HOW_MANY_CASE_ROWS,
          });
          if (!cancelled) setCaseRows(rows.filter(hasStoredFile));
        } catch (err) {
          console.warn('[SavedDocumentPickerModal] case documents:', err);
          if (!cancelled) setCaseRows([]);
        } finally {
          if (!cancelled) setCaseLoading(false);
        }
      })();
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [caseKey, onlyThisCase, open, search, source]);

  // Smart Scan's history is read whole and narrowed here: it is one page of scans, not a store.
  useEffect(() => {
    if (!open || source !== 'scan' || scanItems.length > 0) return;
    let cancelled = false;
    setScanLoading(true);
    void (async () => {
      try {
        const items = await smartScanService.list({ status: 'history' });
        if (!cancelled) setScanItems(items);
      } catch (err) {
        console.warn('[SavedDocumentPickerModal] smart scan history:', err);
        if (!cancelled) toast.error('Could not load Smart Scan history');
      } finally {
        if (!cancelled) setScanLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, scanItems.length, source]);

  const visibleScanItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    const rows = scanItems.filter((item) => Boolean(item.previewUrl || fullScanPreviewUrl(item)));
    if (!term) return rows.slice(0, HOW_MANY_CASE_ROWS);
    return rows
      .filter((item) =>
        [
          scanDisplayFilename(item),
          item.originalFilename,
          item.lead?.leadNumber,
          item.lead?.name,
          scanDocumentTypeLabel(item),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(term),
      )
      .slice(0, HOW_MANY_CASE_ROWS);
  }, [scanItems, search]);

  const toggle = (pick: SavedPick) => {
    if (selected.has(pick.key)) {
      const next = new Map(selected);
      next.delete(pick.key);
      setSelected(next);
      return;
    }
    if (selected.size >= roomLeft) {
      toast.error(
        roomLeft <= 0
          ? 'This expense already has all the files it can hold'
          : `You can add ${roomLeft} more file${roomLeft === 1 ? '' : 's'}`,
      );
      return;
    }
    setSelected(new Map(selected).set(pick.key, pick));
  };

  const attach = async () => {
    const picks = [...selected.values()];
    if (!picks.length) return;
    setAttaching(true);
    try {
      const files: File[] = [];
      for (const pick of picks) {
        try {
          const url = await pick.resolveUrl();
          const response = await fetch(url);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const blob = await response.blob();
          files.push(new File([blob], pick.fileName, { type: pick.mime }));
        } catch (err) {
          console.warn('[SavedDocumentPickerModal] fetch document:', err);
          toast.error(`Could not read ${pick.fileName}`);
        }
      }
      if (!files.length) return;
      onAttach(files);
      onClose();
    } finally {
      setAttaching(false);
    }
  };

  if (!open) return null;

  const renderRow = (args: {
    key: string;
    title: string;
    sublabel: string;
    pick: SavedPick | null;
  }) => {
    const picked = selected.has(args.key);
    return (
      <li key={args.key}>
        <button
          type="button"
          disabled={!args.pick || attaching}
          onClick={() => args.pick && toggle(args.pick)}
          className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
            picked
              ? 'border-blue-500 bg-blue-50/70'
              : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
          }`}
        >
          <DocumentTextIcon className="h-6 w-6 shrink-0 text-blue-600" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-slate-900">{args.title}</span>
            <span className="block truncate text-xs text-slate-500">
              {args.pick ? args.sublabel : `${args.sublabel} · this type cannot be attached`}
            </span>
          </span>
          {/* Held open whether ticked or not, so picking a row does not reflow its text. */}
          <span className="flex h-5 w-5 shrink-0 items-center justify-center">
            {picked ? <CheckIcon className="h-5 w-5 text-blue-600" strokeWidth={3} /> : null}
          </span>
        </button>
      </li>
    );
  };

  return ReactDOM.createPortal(
    // Above every drawer this opens from: the expense drawer sits at z-100 and the cash box's at
    // z-130.
    <div className="fixed inset-0 z-[140] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={attaching ? undefined : onClose} />
      <div className="relative flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 px-5 py-4">
          <div>
            <h3 className="text-lg font-bold text-slate-900">Attach a saved document</h3>
            <p className="mt-0.5 text-sm text-slate-500">
              A copy is filed with this expense; the original stays where it is.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-circle"
            onClick={onClose}
            disabled={attaching}
            aria-label="Close"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-3 px-5 pb-3">
          <div
            role="group"
            aria-label="Where to look"
            className="inline-flex w-full rounded-full bg-slate-100/90 p-1"
          >
            {(
              [
                ['case', 'Case documents'],
                ['scan', 'Smart Scan history'],
              ] as Array<[Source, string]>
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                disabled={attaching}
                onClick={() => setSource(id)}
                className={`flex-1 rounded-full px-3 py-2 text-sm transition ${
                  source === id
                    ? 'bg-white font-semibold text-slate-900 shadow-sm'
                    : 'font-medium text-slate-500 hover:text-slate-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="relative">
            {/* z-10 clears the input: DaisyUI's `.input` is relatively positioned with an opaque
                background and takes z-index 1 when focused. */}
            <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="input input-bordered w-full pl-9"
              placeholder={
                source === 'case' ? 'Search by file, case or folder' : 'Search scans by file or case'
              }
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {source === 'case' && caseKey ? (
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                className="checkbox checkbox-sm"
                checked={onlyThisCase}
                onChange={(e) => setOnlyThisCase(e.target.checked)}
              />
              Only files in {caseKey}
            </label>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
          {(source === 'case' ? caseLoading : scanLoading) ? (
            <div className="flex justify-center py-10">
              <span className="loading loading-spinner loading-md text-blue-600" />
            </div>
          ) : source === 'case' ? (
            caseRows.length === 0 ? (
              <p className="py-10 text-center text-sm text-slate-500">
                {search.trim() ? 'No documents match' : 'No documents filed here yet'}
              </p>
            ) : (
              <ul className="space-y-2">
                {caseRows.map((row) => {
                  const key = `case:${stableRowKey(row)}`;
                  const mime = financeExpenseDocumentMime(row.file_name, row.mime_type);
                  return renderRow({
                    key,
                    title: row.file_name,
                    sublabel: caseRowSublabel(row),
                    pick: mime
                      ? {
                          key,
                          fileName: row.file_name,
                          mime,
                          resolveUrl: () => createDocumentIndexSignedUrl(row),
                        }
                      : null,
                  });
                })}
              </ul>
            )
          ) : visibleScanItems.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-500">
              {search.trim() ? 'No scans match' : 'Nothing in Smart Scan history yet'}
            </p>
          ) : (
            <ul className="space-y-2">
              {visibleScanItems.map((item) => {
                const key = `scan:${item.id}`;
                const fileName = scanDisplayFilename(item) || 'scan.pdf';
                const mime = financeExpenseDocumentMime(fileName, item.contentType);
                const url = item.previewUrl || fullScanPreviewUrl(item) || '';
                return renderRow({
                  key,
                  title: fileName,
                  sublabel: scanItemSublabel(item),
                  pick:
                    mime && url
                      ? { key, fileName, mime, resolveUrl: async () => url }
                      : null,
                });
              })}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <button
            type="button"
            className="rounded-full px-4 py-2.5 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
            onClick={onClose}
            disabled={attaching}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary gap-2 rounded-full px-7"
            onClick={() => void attach()}
            disabled={attaching || selected.size === 0}
          >
            {attaching ? <span className="loading loading-spinner loading-xs" /> : null}
            {selected.size > 1 ? `Attach ${selected.size} files` : 'Attach'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default SavedDocumentPickerModal;
