import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  DocumentIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
// import { CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/solid';
import MobileBottomSheet from '../MobileBottomSheet';
import {
  SMART_SCAN_DOCUMENT_TYPES,
  SMART_SCAN_ISSUE_LABELS,
  buildSuggestedFilename,
  scanQueueBucket,
  type SmartScanItem,
  type SmartScanLeadRef,
} from '../../lib/smartScan/smartScanTypes';
import { formatScanDate, formatScanLongDateTime, scanDisplayFilename, scanGroupLead, scanGroupPageRanges, scanTabLabel, uniqueScanLeadMatches } from '../../lib/smartScan/smartScanFormat';
import { SmartScanConfidenceBadge } from './SmartScanConfidenceBadge';
import { SmartScanStatusBadge } from './SmartScanStatusBadge';
import { SmartScanActivity } from './SmartScanActivity';
import { SmartScanLeadSelector } from './SmartScanLeadSelector';
import { SmartScanScanPreview } from './SmartScanScanPreview';
import { SmartScanShareMenu } from './SmartScanShareMenu';
import { fullScanPreviewUrl } from '../../lib/smartScan/scanCenterInbox';

type Props = {
  open: boolean;
  item: SmartScanItem | null;
  scanItems?: SmartScanItem[] | null;
  assigning: boolean;
  onClose: () => void;
  onSave: (id: string, patch: Partial<SmartScanItem>) => Promise<void>;
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
  onRetry: (id: string) => Promise<void>;
  onAssign: (id: string, lead: SmartScanLeadRef) => Promise<void>;
  onAssignMany?: (ids: string[], lead: SmartScanLeadRef) => Promise<void>;
  onRemove: (ids: string[]) => Promise<void>;
  onOpenLead: (item: SmartScanItem) => void;
};

const fieldLabel = 'text-[11px] font-semibold uppercase tracking-wider text-gray-500';
const inputClass = 'h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-gray-100';
const headerBtn = 'btn btn-ghost btn-sm btn-circle';

/** How long typing has to pause before an edit is sent. Blur and closing commit immediately. */
const AUTOSAVE_IDLE_MS = 900;

type ScanFields = { documentType: string; suggestedFilename: string; summary: string };

const EMPTY_FIELDS: ScanFields = { documentType: '', suggestedFilename: '', summary: '' };

function sameFields(a: ScanFields, b: ScanFields): boolean {
  return a.documentType === b.documentType && a.suggestedFilename === b.suggestedFilename && a.summary === b.summary;
}

function isPreviewableImage(contentType?: string, filename?: string): boolean {
  const type = String(contentType || '').toLowerCase();
  if (type.startsWith('image/')) return true;
  return /\.(png|jpe?g|gif|webp|heic|tif{1,2})$/i.test(String(filename || ''));
}

function isPreviewablePdf(contentType?: string, filename?: string): boolean {
  const type = String(contentType || '').toLowerCase();
  if (type.includes('pdf')) return true;
  return /\.pdf$/i.test(String(filename || ''));
}

function SmartScanPreviewPane({ item }: { item: SmartScanItem }) {
  const url = item.previewUrl;
  const image = isPreviewableImage(item.contentType, item.originalFilename);
  const pdf = isPreviewablePdf(item.contentType, item.originalFilename);

  if (url && pdf) {
    return (
      <div className="h-full min-h-0 overflow-hidden rounded-2xl border border-gray-200 bg-white">
        <iframe title={item.originalFilename} src={url} className="h-full min-h-[24rem] w-full border-0" />
      </div>
    );
  }

  if (url && image) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center overflow-hidden rounded-2xl border border-gray-200 bg-gray-50 p-3">
        <img src={url} alt={item.originalFilename} className="max-h-full w-full object-contain" />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-[18rem] flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-4 py-10 text-center">
      <DocumentIcon className="mb-3 h-12 w-12 text-gray-300" />
      <p className="text-sm font-medium text-gray-700">Document preview</p>
      <p className="mt-1 max-w-xs text-xs text-gray-400">Original file: {item.originalFilename}</p>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="btn btn-sm mt-4 rounded-xl">
          Open file
        </a>
      ) : (
        <p className="mt-3 text-xs text-gray-500">The file is still downloading from Scan Center.</p>
      )}
    </div>
  );
}

export function SmartScanReviewDrawer({
  open,
  item,
  scanItems,
  assigning,
  onClose,
  onSave,
  onApprove: _onApprove,
  onReject: _onReject,
  onRetry,
  onAssign,
  onAssignMany,
  onRemove,
  onOpenLead,
}: Props) {
  const mergedItems = scanItems && scanItems.length > 1 ? scanItems : null;
  const [documentType, setDocumentType] = useState('');
  const [filename, setFilename] = useState('');
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeScanId, setActiveScanId] = useState<string | null>(null);

  const activeMerged = mergedItems?.find((row) => row.id === activeScanId) || mergedItems?.[0] || null;
  const activeDoc = activeMerged || item;
  /*
   * Filing a scan under a lead does not freeze its details: a reviewer still renames and retypes
   * documents afterwards, and the rename follows through to the copy filed under the lead. Only an
   * in-flight scan is off limits, because classification is still writing these same fields.
   */
  const editable = Boolean(activeDoc && activeDoc.status !== 'processing');
  // Reprocessing re-runs classification and re-files, so it stays off once a scan is filed.
  const canReprocess = Boolean(activeDoc && activeDoc.status !== 'processing' && activeDoc.status !== 'completed');

  useEffect(() => {
    if (!mergedItems?.length) {
      setActiveScanId(null);
      return;
    }
    setActiveScanId((current) => (current && mergedItems.some((row) => row.id === current) ? current : mergedItems[0].id));
  }, [mergedItems]);

  /** What the server last told us these fields are. Only fields that drifted from it get sent. */
  const baselineRef = useRef<ScanFields>(EMPTY_FIELDS);
  /** What was last sent, so repeatedly leaving an untouched field costs nothing. */
  const sentRef = useRef<ScanFields>(EMPTY_FIELDS);
  const pendingRef = useRef<{ id: string; fields: ScanFields } | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The save in flight, so actions that re-read this row on the server can wait for it. */
  const savePromiseRef = useRef<Promise<void> | null>(null);

  /*
   * The server copy is read back into the inputs only when the document changes or when the server
   * itself changed these fields — a new scan, a reprocess, a lead assignment. Reacting to every
   * prop identity change instead would wipe out what someone is typing each time an autosave
   * round-trip lands mid-keystroke, since each save hands back a fresh item object.
   */
  const hydrationKey = activeDoc
    ? [activeDoc.id, activeDoc.status, activeDoc.processedAt || '', activeDoc.lead?.leadNumber || ''].join('|')
    : '';

  useEffect(() => {
    if (!activeDoc) return;
    const next: ScanFields = {
      documentType: activeDoc.documentType || activeDoc.suggestedDocumentType || '',
      suggestedFilename: activeDoc.suggestedFilename || '',
      summary: activeDoc.summary || '',
    };
    setDocumentType(next.documentType);
    setFilename(next.suggestedFilename);
    setSummary(next.summary);
    baselineRef.current = next;
    sentRef.current = next;
    pendingRef.current = null;
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrationKey names every field read here
  }, [hydrationKey]);

  const regeneratedName = useMemo(() => {
    if (!item) return '';
    return buildSuggestedFilename({
      ...item,
      documentType: documentType || item.documentType,
    });
  }, [item, documentType]);

  if (!item) {
    return (
      <MobileBottomSheet
        open={open}
        onClose={onClose}
        title="Smart Scan"
        desktopFullScreen
        mobileFullPage
        scrollLock="always"
        hideDragHandle
      >
        <p className="p-6 text-sm text-gray-500">Select a scanned document.</p>
      </MobileBottomSheet>
    );
  }

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      /*
       * Assigning, reprocessing and the rest all re-read this row on the server, so a queued or still
       * in-flight edit has to land first — otherwise the copy filed under the lead is named after
       * whatever the row said before the reviewer typed.
       */
      flushSave();
      if (savePromiseRef.current) await savePromiseRef.current;
      await fn();
    } finally {
      setBusy(false);
    }
  };

  /*
   * There is no Save button, so edits commit on their own: a select commits on change, text commits
   * on blur or after a pause in typing, and anything still pending commits when the drawer closes.
   */
  const clearIdleTimer = () => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  };

  const flushSave = () => {
    clearIdleTimer();
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    sentRef.current = pending.fields;

    /*
     * Only drifted fields travel. That keeps a view where one field is read-only from quietly
     * rewriting it — the merged view can edit the summary alone, and sending its document type too
     * would promote the AI's guess into a confirmed value nobody chose.
     */
    const baseline = baselineRef.current;
    const patch: Partial<SmartScanItem> = {};
    if (pending.fields.documentType && pending.fields.documentType !== baseline.documentType) {
      patch.documentType = pending.fields.documentType;
    }
    // An emptied box is left out rather than sent: a blank name is read as "regenerate", so a
    // half-finished rename would briefly swap in a freshly generated one.
    const name = pending.fields.suggestedFilename.trim();
    if (name && name !== baseline.suggestedFilename) patch.suggestedFilename = name;
    if (pending.fields.summary !== baseline.summary) patch.summary = pending.fields.summary;
    if (Object.keys(patch).length === 0) return;

    setSaving(true);
    const inFlight = onSave(pending.id, patch).finally(() => {
      setSaving(false);
      if (savePromiseRef.current === inFlight) savePromiseRef.current = null;
    });
    savePromiseRef.current = inFlight;
  };

  /** Queues an edit, or drops it when nothing actually changed so idle blurs cost no requests. */
  const trackChange = (id: string, fields: ScanFields, commit: boolean) => {
    if (sameFields(fields, sentRef.current)) {
      pendingRef.current = null;
      clearIdleTimer();
      return;
    }
    pendingRef.current = { id, fields };
    if (commit) {
      flushSave();
      return;
    }
    clearIdleTimer();
    idleTimerRef.current = setTimeout(flushSave, AUTOSAVE_IDLE_MS);
  };

  /** Closing is the last chance to commit a keystroke that never lost focus. */
  const closeWithFlush = () => {
    flushSave();
    onClose();
  };

  const savingNote = saving ? <span className="text-xs text-gray-400">Saving…</span> : null;

  /** Every field is collected on each edit; `flushSave` is what narrows it down to what drifted. */
  const fieldsWith = (patch: Partial<ScanFields>): ScanFields => ({
    documentType,
    suggestedFilename: filename,
    summary,
    ...patch,
  });

  if (mergedItems && activeMerged) {
    const groupLead = scanGroupLead(mergedItems);
    const ranges = scanGroupPageRanges(mergedItems);
    const previewSrc = fullScanPreviewUrl(mergedItems[0]);
    const mergedEditable = activeMerged.status !== 'processing' && activeMerged.status !== 'completed';
    const assignedLeadNumber =
      mergedItems.every((row) => row.status === 'completed') && groupLead.lead?.leadNumber
        ? groupLead.lead.leadNumber
        : null;
    return (
      <MobileBottomSheet
        open={open}
        onClose={closeWithFlush}
        desktopFullScreen
        mobileFullPage
        scrollLock="always"
        hideDefaultHeader
        hideDragHandle
        contentClassName="relative flex flex-col overflow-hidden"
        footer={null}
      >
        <div className="shrink-0 bg-white px-4 py-1.5 md:px-6">
          <div className={`relative ${assignedLeadNumber ? 'pr-[16rem] md:pr-[25rem]' : 'pr-28'}`}>
            <div className="absolute right-0 top-0 z-30 flex items-center gap-0.5">
              {assignedLeadNumber ? (
                <span className="mr-1 inline-flex max-w-[7rem] items-center truncate rounded-full bg-emerald-50 px-4 py-1.5 text-sm font-semibold text-emerald-800 md:max-w-[16rem] md:text-base">
                  Assigned to: {assignedLeadNumber}
                </span>
              ) : null}
              {/* A completed scan hides the lead search, so share joins the other actions instead. */}
              {assignedLeadNumber ? <SmartScanShareMenu item={activeMerged} disabled={busy} /> : null}
              {groupLead.lead ? (
                <button
                  type="button"
                  className={headerBtn}
                  title="Open lead"
                  aria-label="Open lead"
                  onClick={() => onOpenLead({ ...activeMerged, lead: groupLead.lead })}
                >
                  <ArrowTopRightOnSquareIcon className="h-5 w-5" />
                </button>
              ) : null}
              {mergedEditable ? (
                <button
                  type="button"
                  className={headerBtn}
                  disabled={busy}
                  title="Reprocess"
                  aria-label="Reprocess"
                  onClick={() => run(() => onRetry(activeMerged.id))}
                >
                  <ArrowPathIcon className="h-5 w-5" />
                </button>
              ) : null}
              <button
                type="button"
                className={`${headerBtn} text-rose-600 hover:bg-rose-50`}
                disabled={busy}
                title="Delete scan"
                aria-label="Delete scan"
                onClick={() => {
                  if (
                    window.confirm(
                      `Remove ${mergedItems.length} documents from this scan? They will not be fetched again.`,
                    )
                  ) {
                    void run(() => onRemove(mergedItems.map((row) => row.id)));
                  }
                }}
              >
                <TrashIcon className="h-5 w-5" />
              </button>
              <button type="button" className={headerBtn} onClick={closeWithFlush} aria-label="Close">
                <XMarkIcon className="h-6 w-6" />
              </button>
            </div>
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
              <div className={`min-w-0 flex-1 ${assignedLeadNumber ? '' : 'md:pr-[min(44rem,48%)]'}`}>
                <h2 className="truncate text-sm font-semibold tracking-tight text-gray-900 md:text-base">
                  Full scan
                </h2>
                <p className="truncate text-xs text-gray-500">
                  {mergedItems.length} documents
                  {groupLead.name !== 'Unknown' ? ` · ${groupLead.name}` : ''}
                  {groupLead.leadNumber !== 'No lead' && groupLead.leadNumber !== 'Multiple leads'
                    ? ` · ${groupLead.leadNumber}`
                    : ''}
                </p>
              </div>
              {assignedLeadNumber ? null : (
                <div className="w-full md:absolute md:left-1/2 md:top-1/2 md:w-[min(44rem,calc(100%-20rem))] md:-translate-x-1/2 md:-translate-y-1/2">
                  <SmartScanLeadSelector
                    variant="header"
                    assignCount={mergedItems.length}
                    assignedLead={groupLead.lead}
                    possibleMatches={uniqueScanLeadMatches(mergedItems)}
                    disabled={busy || mergedItems.some((row) => row.status === 'processing')}
                    autoFocus={assigning}
                    trailing={<SmartScanShareMenu item={activeMerged} disabled={busy} />}
                    onChoose={(lead) =>
                      run(async () => {
                        if (onAssignMany) await onAssignMany(mergedItems.map((row) => row.id), lead);
                        else {
                          for (const row of mergedItems) await onAssign(row.id, lead);
                        }
                      })
                    }
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 gap-6 overflow-hidden p-4 md:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] md:p-6">
          <SmartScanScanPreview
            src={previewSrc}
            filename={scanDisplayFilename(mergedItems[0])}
            ranges={ranges}
            activeId={activeMerged.id}
            onActiveChange={setActiveScanId}
          />

          <div className="min-h-0 space-y-4 overflow-y-auto">
            <div className="-mx-1 flex flex-wrap gap-1 rounded-2xl bg-gray-200/70 p-1">
              {mergedItems.map((row) => {
                const selected = row.id === activeMerged.id;
                return (
                  <button
                    key={row.id}
                    type="button"
                    className={`rounded-full px-3 py-1.5 text-sm font-semibold transition ${
                      selected ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'
                    }`}
                    onClick={() => setActiveScanId(row.id)}
                  >
                    {scanTabLabel(row, mergedItems)}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <SmartScanStatusBadge
                status={scanQueueBucket(activeMerged)}
                hasSuggestions={(activeMerged.possibleLeadMatches?.length ?? 0) > 0}
              />
              <SmartScanConfidenceBadge value={activeMerged.confidence} />
              {activeMerged.issue ? (
                <span className="text-sm font-medium text-amber-700">
                  {SMART_SCAN_ISSUE_LABELS[activeMerged.issue].replace(/\.$/, '')}
                </span>
              ) : null}
              {savingNote}
            </div>

            {mergedItems.some((row) => row.status === 'processing') ? (
              <p className="text-sm text-sky-800">AI is identifying documents in this scan…</p>
            ) : null}

            <p className="text-sm text-gray-500">
              {activeMerged.pageStart && activeMerged.pageEnd
                ? `Pages ${activeMerged.pageStart}–${activeMerged.pageEnd}`
                : `${activeMerged.pageCount} page${activeMerged.pageCount === 1 ? '' : 's'}`}
            </p>

            {mergedEditable ? (
              <label className="block">
                <span className={fieldLabel}>AI summary</span>
                <textarea
                  className="min-h-[8rem] w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-100"
                  value={summary}
                  onChange={(event) => {
                    setSummary(event.target.value);
                    trackChange(activeMerged.id, fieldsWith({ summary: event.target.value }), false);
                  }}
                  onBlur={() => flushSave()}
                />
              </label>
            ) : (
              <div>
                <p className={fieldLabel}>AI summary</p>
                <p className="text-sm text-gray-800">{activeMerged.summary || '—'}</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className={fieldLabel}>Detected person</p>
                <p className="text-gray-900">{activeMerged.detectedPersonName || '—'}</p>
              </div>
              <div>
                <p className={fieldLabel}>Country</p>
                <p className="text-gray-900">{activeMerged.detectedCountry || '—'}</p>
              </div>
              <div>
                <p className={fieldLabel}>Document date</p>
                <p className="text-gray-900">{formatScanDate(activeMerged.documentDate)}</p>
              </div>
              <div>
                <p className={fieldLabel}>Expiry</p>
                <p className="text-gray-900">{formatScanDate(activeMerged.expiryDate)}</p>
              </div>
              <div className="col-span-2">
                <p className={fieldLabel}>Scanned</p>
                <p className="text-gray-900">{formatScanLongDateTime(activeMerged.createdAt)}</p>
              </div>
            </div>

            <section>
              <h3 className="mb-2 text-sm font-semibold text-gray-900">Activity</h3>
              <SmartScanActivity entries={activeMerged.activity} />
            </section>
          </div>
        </div>
      </MobileBottomSheet>
    );
  }

  const assignedLeadNumber =
    item.status === 'completed' && item.lead?.leadNumber ? item.lead.leadNumber : null;

  const title = item.documentType || item.suggestedDocumentType || item.title || 'Scanned document';
  const subtitle = item.lead
    ? `${item.lead.name} · ${item.lead.leadNumber}`
    : item.detectedPersonName
      ? `Detected: ${item.detectedPersonName}`
      : 'Unmatched scan';

  return (
    <MobileBottomSheet
      open={open}
      onClose={closeWithFlush}
      desktopFullScreen
      mobileFullPage
      scrollLock="always"
      hideDefaultHeader
      hideDragHandle
      contentClassName="relative flex flex-col overflow-hidden"
      footer={null}
    >
      <div className="shrink-0 bg-white px-4 py-1.5 md:px-6">
        <div className={`relative ${assignedLeadNumber ? 'pr-[16rem] md:pr-[25rem]' : 'pr-28'}`}>
          <div className="absolute right-0 top-0 z-30 flex items-center gap-0.5">
            {assignedLeadNumber ? (
              <span className="mr-1 inline-flex max-w-[7rem] items-center truncate rounded-full bg-emerald-50 px-4 py-1.5 text-sm font-semibold text-emerald-800 md:max-w-[16rem] md:text-base">
                Assigned to: {assignedLeadNumber}
              </span>
            ) : null}
            {/* A completed scan hides the lead search, so share joins the other actions instead. */}
            {assignedLeadNumber ? <SmartScanShareMenu item={item} disabled={busy} /> : null}
            {item.lead ? (
              <button
                type="button"
                className={headerBtn}
                title="Open lead"
                aria-label="Open lead"
                onClick={() => onOpenLead(item)}
              >
                <ArrowTopRightOnSquareIcon className="h-5 w-5" />
              </button>
            ) : null}
            {canReprocess ? (
              <button
                type="button"
                className={headerBtn}
                disabled={busy}
                title={item.status === 'failed' ? 'Retry processing' : 'Reprocess'}
                aria-label={item.status === 'failed' ? 'Retry processing' : 'Reprocess'}
                onClick={() => run(() => onRetry(item.id))}
              >
                <ArrowPathIcon className="h-5 w-5" />
              </button>
            ) : null}
            <button
              type="button"
              className={`${headerBtn} text-rose-600 hover:bg-rose-50`}
              disabled={busy}
              title="Delete"
              aria-label="Delete"
              onClick={() => {
                if (window.confirm('Remove this document from Smart Scan? It will not be fetched again.')) {
                  void run(() => onRemove([item.id]));
                }
              }}
            >
              <TrashIcon className="h-5 w-5" />
            </button>
            <button type="button" className={headerBtn} onClick={closeWithFlush} aria-label="Close">
              <XMarkIcon className="h-6 w-6" />
            </button>
          </div>
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
            <div className={`min-w-0 flex-1 ${assignedLeadNumber ? '' : 'md:pr-[min(44rem,48%)]'}`}>
              <h2 className="truncate text-sm font-semibold tracking-tight text-gray-900 md:text-base">{title}</h2>
              <p className="truncate text-xs text-gray-500">{subtitle}</p>
            </div>
            {assignedLeadNumber ? null : (
              <div className="w-full md:absolute md:left-1/2 md:top-1/2 md:w-[min(44rem,calc(100%-20rem))] md:-translate-x-1/2 md:-translate-y-1/2">
                <SmartScanLeadSelector
                  variant="header"
                  assignedLead={item.lead}
                  possibleMatches={item.possibleLeadMatches}
                  disabled={busy || item.status === 'processing'}
                  autoFocus={assigning}
                  trailing={<SmartScanShareMenu item={item} disabled={busy} />}
                  onChoose={(lead) => run(() => onAssign(item.id, lead))}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-6 overflow-hidden p-4 md:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] md:p-6">
        <SmartScanPreviewPane item={item} />

        <div className="min-h-0 space-y-5 overflow-y-auto">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <SmartScanStatusBadge
              status={scanQueueBucket(item)}
              hasSuggestions={(item.possibleLeadMatches?.length ?? 0) > 0}
            />
            <SmartScanConfidenceBadge value={item.confidence} />
            {item.issue ? (
              <span className="text-sm font-medium text-amber-700">
                {SMART_SCAN_ISSUE_LABELS[item.issue].replace(/\.$/, '')}
              </span>
            ) : null}
            {savingNote}
          </div>

          {item.status === 'processing' ? (
            <p className="text-sm text-sky-800">AI is identifying the document type and splitting if needed…</p>
          ) : null}

          {scanQueueBucket(item) === 'matched' ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              AI suggested this lead. Approve to confirm, or search to assign a different one.
            </div>
          ) : null}

          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-900">Detected information</h3>
            {item.splitCount && item.splitIndex ? (
              <p className="rounded-xl border border-sky-100 bg-sky-50 px-3 py-2 text-sm text-sky-900">
                Split part {item.splitIndex} of {item.splitCount}
                {item.pageStart && item.pageEnd ? ` · pages ${item.pageStart}–${item.pageEnd}` : ''}
              </p>
            ) : null}

            {editable ? (
              <label className="block">
                <span className={fieldLabel}>Document type</span>
                <select
                  className={inputClass}
                  value={documentType}
                  onChange={(event) => {
                    setDocumentType(event.target.value);
                    trackChange(item.id, fieldsWith({ documentType: event.target.value }), true);
                  }}
                >
                  <option value="">Select type</option>
                  {SMART_SCAN_DOCUMENT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div>
                <p className={fieldLabel}>Document type</p>
                <p className="text-sm text-gray-900">{item.documentType || item.suggestedDocumentType || 'Unknown'}</p>
              </div>
            )}

            {editable ? (
              <label className="block">
                <span className={fieldLabel}>Filename</span>
                <input
                  className={inputClass}
                  value={filename}
                  onChange={(event) => {
                    setFilename(event.target.value);
                    trackChange(item.id, fieldsWith({ suggestedFilename: event.target.value }), false);
                  }}
                  onBlur={() => flushSave()}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      flushSave();
                    }
                  }}
                />
                <button
                  type="button"
                  className="mt-1 text-xs text-blue-600 hover:underline"
                  onClick={() => {
                    setFilename(regeneratedName);
                    trackChange(item.id, fieldsWith({ suggestedFilename: regeneratedName }), true);
                  }}
                >
                  Use generated name
                </button>
              </label>
            ) : (
              <div>
                <p className={fieldLabel}>Suggested filename</p>
                <p className="break-all text-sm text-gray-900">{item.suggestedFilename}</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className={fieldLabel}>Detected person</p>
                <p className="text-gray-900">{item.detectedPersonName || '—'}</p>
              </div>
              <div>
                <p className={fieldLabel}>Country</p>
                <p className="text-gray-900">{item.detectedCountry || '—'}</p>
              </div>
              <div>
                <p className={fieldLabel}>Document date</p>
                <p className="text-gray-900">{formatScanDate(item.documentDate)}</p>
              </div>
              <div>
                <p className={fieldLabel}>Expiry</p>
                <p className="text-gray-900">{formatScanDate(item.expiryDate)}</p>
              </div>
            </div>

            {editable ? (
              <label className="block">
                <span className={fieldLabel}>AI summary</span>
                <textarea
                  className="min-h-[5rem] w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-100"
                  value={summary}
                  onChange={(event) => {
                    setSummary(event.target.value);
                    trackChange(item.id, fieldsWith({ summary: event.target.value }), false);
                  }}
                  onBlur={() => flushSave()}
                />
              </label>
            ) : (
              <div>
                <p className={fieldLabel}>AI summary</p>
                <p className="text-sm text-gray-800">{item.summary || '—'}</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 text-sm">
              {/* <div>
                <p className={fieldLabel}>Scanner</p>
                <p className="text-gray-900">{item.scannerName || '—'}</p>
              </div> */}
              <div>
                <p className={fieldLabel}>Batch</p>
                <p className="text-gray-900">{item.batchId}</p>
              </div>
              <div className="col-span-2">
                <p className={fieldLabel}>Scanned</p>
                <p className="text-gray-900">{formatScanLongDateTime(item.createdAt)}</p>
              </div>
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-gray-900">Activity</h3>
            <SmartScanActivity entries={item.activity} />
          </section>
        </div>
      </div>
    </MobileBottomSheet>
  );
}
