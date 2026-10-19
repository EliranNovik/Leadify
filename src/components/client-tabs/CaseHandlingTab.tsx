/**
 * Case Handling: a spreadsheet per lead that handlers fill in together.
 *
 * A handler can upload an existing workbook or start a blank sheet. Edits apply instantly and are
 * autosaved cell by cell, and Realtime shows who else is in the sheet and which cell they are on.
 *
 * Two decisions shape the code below:
 *
 *  - Only the selected cell is an <input>. Every other cell is plain text. A sheet is mostly idle
 *    cells, and one input instead of thousands is what keeps a few hundred rows responsive.
 *
 *  - The grid is the source of truth on screen, Postgres is the source of truth on disk, and the
 *    .xlsx is only an interchange format. See sql/2026-10-14_case_sheets.sql.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as XLSX from 'xlsx';
/* The styled writer, used for the export so a downloaded sheet keeps its colours and alignment. */
import * as XLSXStyle from 'xlsx-js-style';
import JSZip from 'jszip';
import toast from 'react-hot-toast';
import {
  ArrowPathIcon,
  ArrowUpTrayIcon,
  ArrowUturnLeftIcon,
  ArrowUturnRightIcon,
  ArrowsPointingInIcon,
  ArrowsPointingOutIcon,
  Bars3BottomLeftIcon,
  Bars3BottomRightIcon,
  Bars3Icon,
  ExclamationTriangleIcon,
  LanguageIcon,
  NoSymbolIcon,
  PaintBrushIcon,
  PlusIcon,
  XMarkIcon,
  TableCellsIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';

import { supabase } from '../../lib/supabase';
import { useAuthContext } from '../../contexts/AuthContext';
import type { ClientTabProps } from '../../types/client';
import {
  CASE_SHEET_ALIGNMENTS,
  CASE_SHEET_COLUMN_WIDTH_DEFAULT,
  CASE_SHEET_FONT_SIZES,
  CASE_SHEET_ROW_HEIGHT_DEFAULT,
  CASE_SHEET_FONT_SIZE_DEFAULT,
  CASE_SHEET_HIGHLIGHTS,
  CASE_SHEET_TEXT_COLORS,
  CASE_SHEET_MAX_COLUMNS,
  type CaseSheetCellChange,
  type CaseSheetAlign,
  type CaseSheetBorderPreset,
  type CaseSheetCellFormat,
  type CaseSheetCellRef,
  type CaseSheetGrid,
  type CaseSheetRange,
  appendColumn,
  appendRows,
  applyBorderPreset,
  applyFormat,
  containsRtlText,
  applyPastedBlock,
  applyRemoteCell,
  applyRemoteShape,
  bandRange,
  cellChange,
  changedCellsBetween,
  columnLabel,
  createEmptyGrid,
  deleteRow,
  gridShapeChanged,
  getCell,
  getFormat,
  gridFromAoa,
  gridToAoa,
  hasNamedColumns,
  isColumnFullySelected,
  isFormatActive,
  isRowFullySelected,
  normalizeHighlight,
  parsePastedBlock,
  rangeCells,
  renameColumn,
  restoreCells,
  restoreGridShape,
  resolveCellBackground,
  resolveColumnWidth,
  resolveRowHeight,
  setCell,
  setColumnColor,
  setColumnWidth,
  setRowColor,
  setRowHeight,
  sharedFormatValue,
  type CaseSheetImportedStyle,
} from '../../lib/caseSheetGrid';
import { readXlsxCellStyles, sheetPartPaths } from '../../lib/xlsxCellStyles';
import {
  type CaseSheetEditor,
  type CaseSheetRecord,
  type CaseSheetSubscription,
  type CaseSheetViewer,
  caseSheetIdentity,
  createCaseSheet,
  deleteCaseSheet,
  formatCaseSheetEditedAt,
  fetchCaseSheets,
  fetchCaseSheetEditor,
  fetchCaseSheetGrid,
  hasCaseSheetIdentity,
  isForeignCellChange,
  nextCaseSheetName,
  normalizeCaseSheetName,
  renameCaseSheet,
  saveCaseSheetCells,
  saveCaseSheetShape,
  subscribeToCaseSheet,
  viewerColor,
} from '../../lib/caseSheetApi';
import { CaseSheetSaveQueue, type CaseSheetSaveStatus } from '../../lib/caseSheetSaveQueue';
import { CaseSheetShareMenu } from './CaseSheetShareMenu';

/** Long enough to batch a burst of typing, short enough that a handler never doubts it saved. */
const AUTOSAVE_DELAY_MS = 700;
/** How close to the edge a drag has to get before the sheet starts moving under it, in pixels. */
const AUTOSCROLL_EDGE = 56;
/** The most one frame will scroll, so the far end of a wide sheet is reachable but not a blur. */
const AUTOSCROLL_MAX_STEP = 22;
const ROWS_PER_ADD = 20;

/**
 * One undoable step: the sheet before the change and the sheet after it.
 *
 * Both versions are kept because undoing needs the old values and redoing needs the new ones, and
 * the pair also says which cells the step touched — the only cells either direction writes.
 */
type CaseSheetHistoryStep = { before: CaseSheetGrid; after: CaseSheetGrid };

/** Deep enough to walk back out of a mistake, shallow enough not to hold a big sheet many times. */
const MAX_HISTORY_STEPS = 50;

/** The row-number gutter, wide enough for a four-digit row and the delete control beside it. */
const GUTTER_WIDTH = 56;

/**
 * A line a handler drew, as opposed to the pale grid the sheet always shows.
 *
 * Only just wider than that pale 1px line, and deliberately not equal to it: two borders of the
 * same width on the same edge are a tie CSS breaks by position rather than by colour, so a 1px
 * drawn line would disappear wherever a bordered cell sits next to an unbordered one.
 */
const CELL_BORDER = '1.5px solid #374151';

/** Aliases for the library's selection types, so the markup below reads as it did before. */
type Selection = CaseSheetCellRef;
type SelectionRange = CaseSheetRange;

/**
 * The inline style for a cell, shared by the text and the input that floats over it.
 *
 * The background comes in separately because it can belong to the row or the column rather than to
 * the cell, and only the grid knows which of the three wins.
 */
function formatStyle(
  format: CaseSheetCellFormat | null,
  background?: string,
): React.CSSProperties {
  return {
    fontWeight: format?.bold ? 700 : undefined,
    fontStyle: format?.italic ? 'italic' : undefined,
    textDecoration: format?.underline ? 'underline' : undefined,
    backgroundColor: background || undefined,
    // Unset means the sheet's own ink, so an uncoloured cell follows the app rather than a value.
    color: format?.textColor || undefined,
    fontSize: format?.fontSize ? `${format.fontSize}px` : undefined,
    // Unset deliberately, so the cell keeps following the sheet's direction.
    textAlign: format?.align,
  };
}

/**
 * The lines a handler drew, for the `<td>` rather than for the text inside it.
 *
 * They have to sit on the table cell so `border-collapse` can merge each pair of neighbouring edges
 * into one shared line. Drawn on the inner element instead, every cell gets its own closed box and
 * the sheet's pale grid line shows through between them as a gap.
 *
 * Wider than that pale line on purpose: two 1px borders on the same edge are a tie CSS breaks by
 * position, so a thin drawn line would sometimes lose to its neighbour's pale one.
 */
function borderStyle(format: CaseSheetCellFormat | null): React.CSSProperties {
  return {
    borderTop: format?.borderTop ? CELL_BORDER : undefined,
    borderRight: format?.borderRight ? CELL_BORDER : undefined,
    borderBottom: format?.borderBottom ? CELL_BORDER : undefined,
    borderLeft: format?.borderLeft ? CELL_BORDER : undefined,
  };
}

/**
 * Every cell's formatting from an uploaded workbook, laid out to match the rows SheetJS returns.
 *
 * Read from the file's own XML rather than from the parsed workbook because neither spreadsheet
 * library gives formatting back: both collapse a cell's style to its fill, so a sheet's text
 * colours, alignment and borders were being dropped on the way in.
 *
 * The returned table is indexed from the sheet's used range, not from A1, because that is how
 * `sheet_to_json` indexes its rows — a sheet whose content starts at C3 hands back C3 as [0][0],
 * verified rather than assumed.
 */
async function readWorkbookStyles(
  buffer: ArrayBuffer,
  sheetIndex: number,
  worksheet: XLSX.WorkSheet,
  rowCount: number,
): Promise<(CaseSheetImportedStyle | null)[][]> {
  const reference = worksheet['!ref'];
  if (!reference) return [];

  const zip = await JSZip.loadAsync(buffer);
  const read = async (path: string) => {
    const entry = zip.file(path);
    return entry ? entry.async('string') : undefined;
  };

  const stylesXml = await read('xl/styles.xml');
  if (!stylesXml) return [];

  const paths = sheetPartPaths(
    (await read('xl/workbook.xml')) ?? '',
    (await read('xl/_rels/workbook.xml.rels')) ?? '',
  );
  const sheetXml = await read(paths[sheetIndex] ?? 'xl/worksheets/sheet1.xml');
  if (!sheetXml) return [];

  const styles = readXlsxCellStyles(stylesXml, sheetXml, await read('xl/theme/theme1.xml'));
  if (styles.size === 0) return [];

  const range = XLSX.utils.decode_range(reference);
  const table: (CaseSheetImportedStyle | null)[][] = [];

  for (let row = range.s.r; row <= range.e.r && row - range.s.r < rowCount; row += 1) {
    const line: (CaseSheetImportedStyle | null)[] = [];
    for (let col = range.s.c; col <= range.e.c; col += 1) {
      line.push(styles.get(`${row}:${col}`) ?? null);
    }
    table.push(line);
  }

  return table;
}

/**
 * Which cell is under a point on the screen.
 *
 * The grid is a table of thousands of cells, so this asks the browser rather than working it out
 * from scroll offsets and the widths of everything to the left — which would have to account for
 * each hand-resized column and would be wrong the moment one changed.
 *
 * `fallback` fills in the axis the element does not carry: a column heading knows its column but
 * not a row, and during a column drag the row is not part of the selection anyway.
 */
function cellFromPoint(
  x: number,
  y: number,
  fallback: CaseSheetCellRef | null,
): CaseSheetCellRef | null {
  const target = document.elementFromPoint(x, y);
  const cell = target?.closest('[data-cell-row], [data-cell-col]');
  if (!cell) return null;

  const row = cell.getAttribute('data-cell-row');
  const col = cell.getAttribute('data-cell-col');

  const rowIndex = row == null ? fallback?.rowIndex : Number(row);
  const colIndex = col == null ? fallback?.colIndex : Number(col);
  if (!Number.isInteger(rowIndex) || !Number.isInteger(colIndex)) return null;

  return { rowIndex: rowIndex as number, colIndex: colIndex as number };
}

/**
 * How wide this system draws a scrollbar, measured once.
 *
 * Used to push the grid's vertical scrollbar outside a clipping parent, leaving only the horizontal
 * one in view. Measured rather than assumed because it is zero wherever scrollbars are drawn as
 * overlays — on which there is nothing to hide, and shifting the sheet by a guessed 17px would
 * leave a gap and a scroll range that should not be there.
 */
let scrollbarWidth: number | null = null;

function measureScrollbarWidth(): number {
  if (scrollbarWidth != null) return scrollbarWidth;
  if (typeof document === 'undefined') return 0;

  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;top:-9999px;width:100px;height:100px;overflow:scroll';
  document.body.appendChild(probe);
  scrollbarWidth = probe.offsetWidth - probe.clientWidth;
  probe.remove();

  return scrollbarWidth;
}

/** Points, which is what a workbook's font sizes are measured in. */
function pointsFromPixels(pixels: number): number {
  return Math.round((pixels * 3) / 4);
}

/**
 * One cell's formatting in the shape `xlsx-js-style` writes.
 *
 * Only the properties the cell actually has: an empty `font` or `border` would be written out as a
 * style anyway, bloating the file with styles that say nothing.
 */
function exportCellStyle(
  format: CaseSheetCellFormat | null,
  background: string | undefined,
): Record<string, unknown> | undefined {
  const font: Record<string, unknown> = {};
  if (format?.bold) font.bold = true;
  if (format?.italic) font.italic = true;
  if (format?.underline) font.underline = true;
  if (format?.fontSize) font.sz = pointsFromPixels(format.fontSize);
  if (format?.textColor) font.color = { rgb: format.textColor.replace('#', '').toUpperCase() };

  const border: Record<string, unknown> = {};
  if (format?.borderTop) border.top = { style: 'thin' };
  if (format?.borderRight) border.right = { style: 'thin' };
  if (format?.borderBottom) border.bottom = { style: 'thin' };
  if (format?.borderLeft) border.left = { style: 'thin' };

  const style: Record<string, unknown> = {};
  if (Object.keys(font).length > 0) style.font = font;
  if (Object.keys(border).length > 0) style.border = border;
  if (format?.align) style.alignment = { horizontal: format.align };

  const fill = format?.highlight ?? background;
  if (fill) {
    style.fill = { patternType: 'solid', fgColor: { rgb: fill.replace('#', '').toUpperCase() } };
  }

  return Object.keys(style).length > 0 ? style : undefined;
}

const CaseHandlingTab: React.FC<ClientTabProps> = ({ client, readOnly }) => {
  const { user, userFullName, isAdmin } = useAuthContext();

  const identity = useMemo(() => caseSheetIdentity(client?.id), [client?.id]);

  /** Every tab the case has, in strip order. The grid below belongs to the open one. */
  const [sheets, setSheets] = useState<CaseSheetRecord[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [grid, setGrid] = useState<CaseSheetGrid | null>(null);
  const [loading, setLoading] = useState(true);
  /** Switching tabs reloads the grid, which should not blank the whole tab while it happens. */
  const [switching, setSwitching] = useState(false);
  const [renamingTab, setRenamingTab] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveStatus, setSaveStatus] = useState<CaseSheetSaveStatus>('saved');
  const [viewers, setViewers] = useState<CaseSheetViewer[]>([]);
  const [editor, setEditor] = useState<CaseSheetEditor | null>(null);
  /*
   * The selection outlives the input. Pressing a toolbar button blurs the cell, and if that cleared
   * the selection there would be nothing left to format by the time the click arrived.
   */
  const [range, setRange] = useState<SelectionRange | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>('');
  const [editingHeader, setEditingHeader] = useState<number | null>(null);
  /** Mirrors the stacks' depth, which lives in a ref: the buttons have to re-render when it moves. */
  const [historyDepth, setHistoryDepth] = useState({ past: 0, future: 0 });

  const historyRef = useRef<{ past: CaseSheetHistoryStep[]; future: CaseSheetHistoryStep[] }>({
    past: [],
    future: [],
  });
  /** The sheet as it was when a resize drag began, since the drag itself changes it every frame. */
  const resizeBaseRef = useRef<CaseSheetGrid | null>(null);
  const queueRef = useRef<CaseSheetSaveQueue | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const subscriptionRef = useRef<CaseSheetSubscription | null>(null);
  /** The shape is saved as a whole row, so it is tracked separately from the queued cells. */
  const shapeDirtyRef = useRef(false);
  const gridRef = useRef<CaseSheetGrid | null>(null);
  /** The scrolling box around the table, which the drag auto-scroll moves. */
  const scrollRef = useRef<HTMLDivElement | null>(null);
  /**
   * Where a drag started, or null when nothing is being dragged.
   *
   * A ref rather than state: the pointer moves between renders, and re-rendering the whole sheet on
   * every mousemove would make dragging across it stutter.
   */
  const dragAnchorRef = useRef<Selection | null>(null);
  /** Dragging from a header selects whole rows or columns; from a cell, just the cells. */
  const dragModeRef = useRef<'cell' | 'row' | 'column'>('cell');
  const [dragging, setDragging] = useState(false);

  /*
   * Presence and `updated_by` both key on the email rather than the display name: two colleagues can
   * share a first name, and the echo check in `isForeignCellChange` has to be exact.
   */
  const selfKey = user?.email ?? null;
  const selfName = userFullName || user?.email || 'Someone';

  gridRef.current = grid;

  /*
   * Derived rather than held: the strip and the open sheet would otherwise be two copies of the
   * same record, and a rename or a Realtime shape update would have to remember to write to both.
   */
  const sheet = useMemo(
    () => sheets.find((candidate) => candidate.id === activeId) ?? null,
    [sheets, activeId],
  );

  const sheetId = sheet?.id ?? null;
  const canEdit = !readOnly && Boolean(sheet) && !switching;

  // ---------------------------------------------------------------- loading

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setLoadError(null);
      setSheets([]);
      setActiveId(null);
      setGrid(null);

      if (!hasCaseSheetIdentity(identity)) {
        if (!cancelled) setLoading(false);
        return;
      }

      try {
        const records = await fetchCaseSheets(supabase, identity);
        if (cancelled) return;

        setSheets(records);
        setActiveId(records[0]?.id ?? null);

        // The first tab's cells, so the sheet is there to work in as soon as the strip appears.
        if (records[0]) {
          const first = await fetchCaseSheetGrid(supabase, records[0]);
          if (cancelled) return;
          setGrid(first);
        }
      } catch (err) {
        if (cancelled) return;
        console.error('[CaseHandling] failed to load sheet', err);

        /*
         * 42703 is "column does not exist" and 42P01 "table does not exist", which between them mean
         * the database is behind the code rather than anything being wrong with the sheet. Worth
         * naming the file to run, because the raw Postgres message does not suggest a fix.
         */
        const code = (err as { code?: string })?.code;
        if (code === '42703' || code === '42P01') {
          setLoadError(
            'The Case Handling tables are out of date. Run sql/2026-10-14_case_sheets.sql, then reload.',
          );
          return;
        }

        setLoadError(err instanceof Error ? err.message : 'Could not load the sheet');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [identity]);

  // ---------------------------------------------------------------- autosave

  const flushNow = useCallback(async () => {
    const queue = queueRef.current;
    if (!queue || !sheetId) return;

    if (shapeDirtyRef.current && gridRef.current) {
      shapeDirtyRef.current = false;
      try {
        await saveCaseSheetShape(supabase, sheetId, gridRef.current, selfKey);
      } catch (err) {
        console.error('[CaseHandling] failed to save sheet shape', err);
        // Put it back so the next flush retries; losing a renamed column is worse than a retry.
        shapeDirtyRef.current = true;
      }
    }

    await queue.flush();
    setSaveStatus(queue.status);

    // Edits made while the batch was in flight are still waiting, so go round again.
    if (queue.pendingCount > 0 && !queue.error) {
      void flushNow();
    }
  }, [sheetId, selfKey]);

  const scheduleSave = useCallback(() => {
    setSaveStatus((prev) => (prev === 'saving' ? prev : 'pending'));
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void flushNow();
    }, AUTOSAVE_DELAY_MS);
  }, [flushNow]);

  useEffect(() => {
    if (!sheetId) {
      queueRef.current = null;
      return;
    }

    queueRef.current = new CaseSheetSaveQueue(async (changes) => {
      await saveCaseSheetCells(supabase, sheetId, changes, selfKey);
    });
  }, [sheetId, selfKey]);

  const queueChanges = useCallback(
    (changes: CaseSheetCellChange[]) => {
      if (changes.length === 0) return;
      queueRef.current?.enqueue(changes);
      scheduleSave();
    },
    [scheduleSave],
  );

  // ---------------------------------------------------------------- undo / redo

  const recordHistory = useCallback((before: CaseSheetGrid, after: CaseSheetGrid) => {
    if (before === after) return;

    const history = historyRef.current;
    history.past.push({ before, after });
    if (history.past.length > MAX_HISTORY_STEPS) history.past.shift();
    // A new edit is a new branch, so anything that was undone is no longer ahead of us.
    history.future = [];
    setHistoryDepth({ past: history.past.length, future: 0 });
  }, []);

  /*
   * History is per tab. A step records cell addresses, and those addresses mean something different
   * in another sheet, so switching tabs starts again rather than risk writing into the wrong one.
   */
  useEffect(() => {
    historyRef.current = { past: [], future: [] };
    setHistoryDepth({ past: 0, future: 0 });
  }, [sheetId]);

  /**
   * Moves the sheet between the two sides of a step.
   *
   * Only the cells the step itself changed are written: everything else stays as it is now, which is
   * what keeps an undo from reverting a colleague's edit that arrived after the step was recorded.
   */
  const applyHistoryStep = useCallback(
    (from: CaseSheetGrid, to: CaseSheetGrid) => {
      const current = gridRef.current;
      if (!current) return;

      const cells = changedCellsBetween(from, to);
      let next = restoreCells(current, to, cells);
      if (gridShapeChanged(from, to)) {
        next = restoreGridShape(next, to);
        shapeDirtyRef.current = true;
      }

      // Assigned here as well as on render, so a second undo in the same tick sees this one.
      gridRef.current = next;
      setGrid(next);
      // The old selection may point at a row the step just put back or took away.
      setRange(null);
      setEditing(false);

      if (cells.length > 0) {
        queueChanges(cells.map((cell) => cellChange(next, cell.rowIndex, cell.colIndex)));
      } else {
        scheduleSave();
      }
    },
    [queueChanges, scheduleSave],
  );

  const undo = useCallback(() => {
    const history = historyRef.current;
    const step = history.past.pop();
    if (!step) return;

    history.future.push(step);
    setHistoryDepth({ past: history.past.length, future: history.future.length });
    applyHistoryStep(step.after, step.before);
  }, [applyHistoryStep]);

  const redo = useCallback(() => {
    const history = historyRef.current;
    const step = history.future.pop();
    if (!step) return;

    history.past.push(step);
    setHistoryDepth({ past: history.past.length, future: history.future.length });
    applyHistoryStep(step.before, step.after);
  }, [applyHistoryStep]);

  useEffect(() => {
    if (!canEdit) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey && !event.ctrlKey) return;
      const key = event.key.toLowerCase();
      if (key !== 'z' && key !== 'y') return;

      /*
       * Inside a cell, a name box or any other input, undo belongs to that input: the browser can
       * step back through what is being typed, which this cannot once the value is committed.
       */
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }

      event.preventDefault();
      if (key === 'y' || event.shiftKey) redo();
      else undo();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canEdit, undo, redo]);

  /*
   * Leaving the tab must not lose the last few seconds of typing, and the debounce timer does not
   * survive unmount. Flushing here is what makes closing the tab safe.
   */
  const flushRef = useRef(flushNow);
  flushRef.current = flushNow;

  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      void flushRef.current();
    },
    [],
  );

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!queueRef.current?.hasUnsavedWork) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  // ---------------------------------------------------------------- realtime

  useEffect(() => {
    if (!sheetId) {
      setViewers([]);
      return;
    }

    const subscription = subscribeToCaseSheet(supabase, {
      sheetId,
      selfKey: selfKey ?? `anon-${Math.random().toString(36).slice(2)}`,
      selfName,
      onCell: (change) => {
        // Our own save echoes back; applying it would undo anything typed since it left.
        if (!isForeignCellChange(change.updatedBy, selfKey)) return;
        setGrid((prev) =>
          prev
            ? applyRemoteCell(prev, change.rowIndex, change.colIndex, change.value, change.format)
            : prev,
        );
      },
      onViewers: (next) => {
        // Our own avatar is redundant; the toolbar is about who else is here.
        setViewers(next.filter((viewer) => viewer.key !== selfKey));
      },
      onShape: (next) => {
        setSheets((prev) =>
          prev.map((candidate) => (candidate.id === next.id ? { ...candidate, ...next } : candidate)),
        );
        setGrid((prev) => (prev ? applyRemoteShape(prev, next) : prev));
      },
    });

    subscriptionRef.current = subscription;
    return () => {
      subscriptionRef.current = null;
      subscription.unsubscribe();
    };
  }, [sheetId, selfKey, selfName]);

  /** Lets colleagues see which cell is being worked on. */
  useEffect(() => {
    subscriptionRef.current?.setActiveCell(range?.anchor ?? null);
  }, [range]);

  const viewersByCell = useMemo(() => {
    const map = new Map<string, CaseSheetViewer>();
    for (const viewer of viewers) {
      if (viewer.activeCell) {
        map.set(`${viewer.activeCell.rowIndex}:${viewer.activeCell.colIndex}`, viewer);
      }
    }
    return map;
  }, [viewers]);

  // ---------------------------------------------------------------- editing

  const commitDraft = useCallback(
    (value: string, target: Selection) => {
      const current = gridRef.current;
      if (!current) return;

      const result = setCell(current, target.rowIndex, target.colIndex, value);
      if (!result.changed) return;

      if (result.grid.rowCount !== current.rowCount) shapeDirtyRef.current = true;
      recordHistory(current, result.grid);
      setGrid(result.grid);
      // Built from the new grid so the cell's formatting goes along with its text.
      queueChanges([cellChange(result.grid, target.rowIndex, target.colIndex)]);
    },
    [queueChanges, recordHistory],
  );

  /** Commits whatever is in the input, so a half-typed cell is never abandoned. */
  const commitPending = useCallback(() => {
    const current = gridRef.current;
    if (!current || !editing || !range) return;
    const target = range.anchor;
    if (draft !== getCell(current, target.rowIndex, target.colIndex)) commitDraft(draft, target);
  }, [editing, range, draft, commitDraft]);

  const selectCell = useCallback(
    (next: Selection | null, options?: { extend?: boolean }) => {
      const current = gridRef.current;
      commitPending();

      if (!next) {
        setRange(null);
        setEditing(false);
        setDraft('');
        return;
      }

      if (options?.extend && range) {
        // Shift-click grows the rectangle instead of moving it, and closes the input: a multi-cell
        // selection is for formatting, and there is no one cell for the text to go into.
        setRange({ anchor: range.anchor, focus: next });
        setEditing(false);
        return;
      }

      setRange({ anchor: next, focus: next });
      setEditing(true);
      setDraft(current ? getCell(current, next.rowIndex, next.colIndex) : '');
    },
    [range, commitPending],
  );

  const moveSelection = useCallback(
    (rowDelta: number, colDelta: number) => {
      const current = gridRef.current;
      if (!range || !current) return;
      const rowIndex = Math.max(0, Math.min(current.rowCount - 1, range.anchor.rowIndex + rowDelta));
      const colIndex = Math.max(
        0,
        Math.min(current.columns.length - 1, range.anchor.colIndex + colDelta),
      );
      selectCell({ rowIndex, colIndex });
    },
    [range, selectCell],
  );

  /*
   * Resolved from the email the cells record. Keyed on the email alone so an edit by the same person
   * does not refetch, which would otherwise happen on every keystroke's save.
   */
  useEffect(() => {
    let cancelled = false;
    const email = sheet?.updatedBy ?? null;

    if (!email) {
      setEditor(null);
      return;
    }

    void fetchCaseSheetEditor(supabase, email).then((resolved) => {
      if (!cancelled) setEditor(resolved);
    });

    return () => {
      cancelled = true;
    };
  }, [sheet?.updatedBy]);

  /**
   * Whether the sheet is filling the window.
   *
   * An overlay rather than a route of its own: the sheet is live, with a save queue and a Realtime
   * channel attached to this component. Navigating would tear both down and could lose an edit that
   * had not been written yet, where expanding in place costs nothing and fetches nothing.
   */
  const [fullscreen, setFullscreen] = useState(false);

  /** The "add an Excel sheet" dialog, for when the case already has tabs. */
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    if (!importOpen) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setImportOpen(false);
    };

    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [importOpen]);

  useEffect(() => {
    if (!fullscreen) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      // Not while a cell is open, where Escape already means "undo this cell".
      if (event.key !== 'Escape' || editing) return;
      // One Escape closes one thing, and the dialog on top is the one it belongs to.
      if (importOpen) return;
      setFullscreen(false);
    };

    // The page behind must not scroll under the overlay.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [fullscreen, editing, importOpen]);

  /**
   * An in-progress row or column resize.
   *
   * Held in state rather than a ref so the listeners live in an effect and are torn down if the tab
   * closes mid-drag. `startSize` is captured once at the start, so the new size is always measured
   * from where the pointer began rather than accumulated frame by frame, which would drift.
   */
  const [resizing, setResizing] = useState<{
    band: 'row' | 'column';
    index: number;
    startPos: number;
    startSize: number;
  } | null>(null);

  const beginResize = useCallback(
    (band: 'row' | 'column', index: number, event: React.MouseEvent) => {
      const current = gridRef.current;
      if (!canEdit || !current || event.button !== 0) return;

      // The handle sits inside the gutter and the heading, both of which start a selection.
      event.preventDefault();
      event.stopPropagation();

      resizeBaseRef.current = current;

      setResizing({
        band,
        index,
        startPos: band === 'row' ? event.clientY : event.clientX,
        startSize:
          band === 'row' ? resolveRowHeight(current, index) : resolveColumnWidth(current, index),
      });
    },
    [canEdit],
  );

  useEffect(() => {
    if (!resizing) return;

    const onMove = (event: MouseEvent) => {
      const current = gridRef.current;
      if (!current) return;

      if (resizing.band === 'row') {
        const next = setRowHeight(
          current,
          resizing.index,
          resizing.startSize + (event.clientY - resizing.startPos),
        );
        if (next !== current) setGrid(next);
        return;
      }

      /*
       * Mirrored in a right-to-left sheet, where the handle is on the left of its heading and
       * dragging further left is what makes the column wider.
       */
      const travelled = current.rtl
        ? resizing.startPos - event.clientX
        : event.clientX - resizing.startPos;

      const next = setColumnWidth(current, resizing.index, resizing.startSize + travelled);
      if (next !== current) setGrid(next);
    };

    // Saved once on release rather than on every frame, so one drag is one write.
    const onUp = () => {
      setResizing(null);
      const base = resizeBaseRef.current;
      resizeBaseRef.current = null;
      // One drag is one undoable step, measured from where the pointer went down.
      if (base && gridRef.current) recordHistory(base, gridRef.current);
      shapeDirtyRef.current = true;
      scheduleSave();
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [resizing, scheduleSave, recordHistory]);

  const selectedCells = useMemo(() => rangeCells(range), [range]);
  const selectedKeys = useMemo(
    () => new Set(selectedCells.map((cell) => `${cell.rowIndex}:${cell.colIndex}`)),
    [selectedCells],
  );

  /**
   * Starts a drag selection.
   *
   * Editing is held off until the pointer is released: an input under the cursor would swallow the
   * mousemoves the drag depends on, and a single click still ends up in edit mode via `endDrag`.
   */
  const beginDrag = useCallback(
    (cell: Selection, extend: boolean) => {
      commitPending();

      if (extend && range) {
        setRange({ anchor: range.anchor, focus: cell });
        setEditing(false);
        dragAnchorRef.current = range.anchor;
        setDragging(true);
        return;
      }

      dragModeRef.current = 'cell';
      dragAnchorRef.current = cell;
      setDragging(true);
      setRange({ anchor: cell, focus: cell });
      setEditing(false);
    },
    [range, commitPending],
  );

  /** Selecting from the row numbers or the column headings, which covers the whole band. */
  const beginBandDrag = useCallback(
    (band: 'row' | 'column', index: number, extend: boolean) => {
      const current = gridRef.current;
      if (!current) return;
      commitPending();

      const from =
        extend && range
          ? band === 'row'
            ? range.anchor.rowIndex
            : range.anchor.colIndex
          : index;

      dragModeRef.current = band;
      dragAnchorRef.current =
        band === 'row' ? { rowIndex: from, colIndex: 0 } : { rowIndex: 0, colIndex: from };

      setDragging(true);
      setEditing(false);
      setRange(bandRange(band, from, index, current));
    },
    [range, commitPending],
  );

  const extendDrag = useCallback((cell: Selection) => {
    const anchor = dragAnchorRef.current;
    const current = gridRef.current;
    if (!anchor || !current) return;

    // A band drag keeps covering whole rows or columns, however far into the sheet the pointer goes.
    if (dragModeRef.current === 'row') {
      setRange(bandRange('row', anchor.rowIndex, cell.rowIndex, current));
      return;
    }
    if (dragModeRef.current === 'column') {
      setRange(bandRange('column', anchor.colIndex, cell.colIndex, current));
      return;
    }

    setRange({ anchor, focus: cell });
  }, []);

  /**
   * Scrolls the sheet while a selection is being dragged past its edge.
   *
   * Without this a selection can only reach as far as the screen does: to mark more columns a
   * handler has to let go, scroll, and start again — and starting again loses what was selected.
   *
   * Driven by the pointer's position rather than by the cells it passes over, because the gesture
   * this exists for is a pointer held still at the edge while the sheet moves underneath it. No
   * mouseenter fires then, so the cell under the pointer is resolved from the coordinates instead.
   */
  useEffect(() => {
    const container = scrollRef.current;
    if (!dragging || !container) return;

    const pointer = { x: 0, y: 0, seen: false };
    const onMove = (event: MouseEvent) => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.seen = true;
    };

    /*
     * How fast to scroll one axis: nothing until the pointer is inside the edge strip, then faster
     * the deeper in it goes, so a handler can creep along a column or race to the far end.
     */
    const speed = (position: number, start: number, end: number) => {
      if (position > end - AUTOSCROLL_EDGE) {
        const depth = Math.min(1, (position - (end - AUTOSCROLL_EDGE)) / AUTOSCROLL_EDGE);
        return Math.ceil(depth * AUTOSCROLL_MAX_STEP);
      }
      if (position < start + AUTOSCROLL_EDGE) {
        const depth = Math.min(1, (start + AUTOSCROLL_EDGE - position) / AUTOSCROLL_EDGE);
        return -Math.ceil(depth * AUTOSCROLL_MAX_STEP);
      }
      return 0;
    };

    let frame = requestAnimationFrame(function step() {
      frame = requestAnimationFrame(step);
      if (!pointer.seen) return;

      const bounds = container.getBoundingClientRect();
      const dx = speed(pointer.x, bounds.left, bounds.right);
      const dy = speed(pointer.y, bounds.top, bounds.bottom);
      if (dx === 0 && dy === 0) return;

      const { scrollLeft, scrollTop } = container;
      container.scrollBy(dx, dy);
      // Already at the end, so there is nothing new to select and nothing to recompute.
      if (container.scrollLeft === scrollLeft && container.scrollTop === scrollTop) return;

      const next = cellFromPoint(pointer.x, pointer.y, dragAnchorRef.current);
      if (next) extendDrag(next);
    });

    window.addEventListener('mousemove', onMove);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('mousemove', onMove);
    };
  }, [dragging, extendDrag]);

  /*
   * Listening on the window rather than the cell, because a drag often ends with the pointer off the
   * sheet entirely and the selection would otherwise stay stuck to the cursor.
   */
  useEffect(() => {
    if (!dragging) return;

    const endDrag = () => {
      const wasBand = dragModeRef.current !== 'cell';
      dragAnchorRef.current = null;
      dragModeRef.current = 'cell';
      setDragging(false);

      setRange((current) => {
        if (!current) return current;
        const single =
          current.anchor.rowIndex === current.focus.rowIndex &&
          current.anchor.colIndex === current.focus.colIndex;
        /*
         * A plain click is a drag of one cell, and that is the gesture that opens the input. A
         * header click never does, even on a one-column sheet where the band happens to be one cell.
         */
        if (single && !wasBand) {
          setEditing(true);
          setDraft(
            gridRef.current
              ? getCell(gridRef.current, current.anchor.rowIndex, current.anchor.colIndex)
              : '',
          );
        }
        return current;
      });
    };

    window.addEventListener('mouseup', endDrag);
    return () => window.removeEventListener('mouseup', endDrag);
  }, [dragging]);

  /** Paints every row or column the selection touches. */
  const paintBand = useCallback(
    (band: 'row' | 'column', color: string | null) => {
      const current = gridRef.current;
      if (!current || selectedCells.length === 0) return;

      const indexes = new Set(
        selectedCells.map((cell) => (band === 'row' ? cell.rowIndex : cell.colIndex)),
      );

      let next = current;
      for (const index of indexes) {
        next = band === 'row' ? setRowColor(next, index, color) : setColumnColor(next, index, color);
      }
      if (next === current) return;

      shapeDirtyRef.current = true;
      recordHistory(current, next);
      setGrid(next);
      scheduleSave();
    },
    [selectedCells, scheduleSave, recordHistory],
  );

  const applyBorders = useCallback(
    (preset: CaseSheetBorderPreset) => {
      const current = gridRef.current;
      if (!current || !range) return;

      const { grid: next, changes } = applyBorderPreset(current, range, preset);
      if (next === current) return;

      recordHistory(current, next);
      setGrid(next);
      queueChanges(changes);
    },
    [range, queueChanges, recordHistory],
  );

  const toggleRtl = useCallback(() => {
    const current = gridRef.current;
    if (!current) return;
    const next = { ...current, rtl: !current.rtl };
    shapeDirtyRef.current = true;
    recordHistory(current, next);
    setGrid(next);
    scheduleSave();
  }, [scheduleSave, recordHistory]);

  /**
   * Applies a formatting change to the selection.
   *
   * Toolbar buttons suppress mousedown so the cell never loses focus, which keeps a half-typed value
   * in the input while its cell is being restyled.
   */
  const changeFormat = useCallback(
    (patch: { [K in keyof CaseSheetCellFormat]?: CaseSheetCellFormat[K] | null }) => {
      const current = gridRef.current;
      if (!current || selectedCells.length === 0) return;

      const result = applyFormat(current, selectedCells, patch);
      if (result.changes.length === 0) return;

      if (result.grid.rowCount !== current.rowCount) shapeDirtyRef.current = true;
      recordHistory(current, result.grid);
      setGrid(result.grid);
      queueChanges(result.changes);
    },
    [selectedCells, queueChanges, recordHistory],
  );

  const handleCellKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (!range) return;
      const anchor = range.anchor;

      switch (event.key) {
        case 'Enter':
          event.preventDefault();
          moveSelection(event.shiftKey ? -1 : 1, 0);
          break;
        case 'Tab':
          event.preventDefault();
          moveSelection(0, event.shiftKey ? -1 : 1);
          break;
        case 'Escape': {
          event.preventDefault();
          // Back to the stored value, discarding the half-typed one.
          const current = gridRef.current;
          if (current) setDraft(getCell(current, anchor.rowIndex, anchor.colIndex));
          break;
        }
        case 'ArrowUp':
        case 'ArrowDown':
          event.preventDefault();
          moveSelection(event.key === 'ArrowUp' ? -1 : 1, 0);
          break;
        default:
          break;
      }
    },
    [range, moveSelection],
  );

  /**
   * A pasted block from Excel or Sheets fills the cells to the right and below, rather than landing
   * as one long value in the selected cell.
   */
  const handlePaste = useCallback(
    (event: React.ClipboardEvent<HTMLInputElement>) => {
      if (!range || !gridRef.current) return;
      const current = gridRef.current;
      const anchor = range.anchor;

      const text = event.clipboardData?.getData('text/plain') ?? '';
      const block = parsePastedBlock(text);
      // A single value is an ordinary edit, so the input keeps its own behaviour.
      if (block.length <= 1 && (block[0]?.length ?? 0) <= 1) return;

      event.preventDefault();
      const result = applyPastedBlock(current, anchor.rowIndex, anchor.colIndex, block);
      shapeDirtyRef.current = true;
      recordHistory(current, result.grid);
      setGrid(result.grid);
      setDraft(getCell(result.grid, anchor.rowIndex, anchor.colIndex));
      queueChanges(result.changes);
      toast.success(`Pasted ${result.changes.length} cells`);
    },
    [range, queueChanges, recordHistory],
  );

  const handleDeleteRow = useCallback(
    (rowIndex: number) => {
      const current = gridRef.current;
      if (!current) return;
      const result = deleteRow(current, rowIndex);
      shapeDirtyRef.current = true;
      recordHistory(current, result.grid);
      setGrid(result.grid);
      setRange(null);
      setEditing(false);
      queueChanges(result.changes);
    },
    [queueChanges, recordHistory],
  );

  const handleAddRows = useCallback(() => {
    const current = gridRef.current;
    if (!current) return;
    const next = appendRows(current, ROWS_PER_ADD);
    shapeDirtyRef.current = true;
    recordHistory(current, next);
    setGrid(next);
    scheduleSave();
  }, [scheduleSave, recordHistory]);

  const handleAddColumn = useCallback(() => {
    const current = gridRef.current;
    if (!current) return;
    if (current.columns.length >= CASE_SHEET_MAX_COLUMNS) {
      toast.error('This sheet already has the maximum number of columns');
      return;
    }
    const next = appendColumn(current);
    shapeDirtyRef.current = true;
    recordHistory(current, next);
    setGrid(next);
    scheduleSave();
  }, [scheduleSave, recordHistory]);

  const handleRenameColumn = useCallback(
    (colIndex: number, label: string) => {
      const current = gridRef.current;
      if (!current) return;
      setEditingHeader(null);
      const next = renameColumn(current, colIndex, label);
      shapeDirtyRef.current = true;
      recordHistory(current, next);
      setGrid(next);
      scheduleSave();
    },
    [scheduleSave, recordHistory],
  );

  /** Back to the default size, the way double-clicking a divider does in Excel. */
  const resetBandSize = useCallback(
    (band: 'row' | 'column', index: number) => {
      const current = gridRef.current;
      if (!current) return;
      const next =
        band === 'row' ? setRowHeight(current, index, null) : setColumnWidth(current, index, null);
      if (next === current) return;
      shapeDirtyRef.current = true;
      recordHistory(current, next);
      setGrid(next);
      scheduleSave();
    },
    [scheduleSave, recordHistory],
  );

  // ---------------------------------------------------------------- create / import / export

  /**
   * Creates one or more tabs and opens the first of them.
   *
   * Takes a list because an uploaded workbook has as many sheets as it has tabs, and they have to
   * arrive in the order the file lists them — created one at a time rather than in one insert so a
   * sheet that fails to write does not take the rest of the workbook with it.
   */
  const startSheets = useCallback(
    async (
      incoming: { name?: string; grid: CaseSheetGrid }[],
      sourceFilename: string | null,
    ) => {
      if (incoming.length === 0) return;

      setBusy(true);
      try {
        const existing = await fetchCaseSheets(supabase, identity);
        const names = existing.map((record) => record.name);
        const created: CaseSheetRecord[] = [];
        let firstGrid: CaseSheetGrid | null = null;

        for (const [index, candidate] of incoming.entries()) {
          /*
           * Named against what is already there, including the tabs created a moment ago in this
           * same loop, so a workbook with two sheets called the same thing still arrives as two
           * tabs a handler can tell apart.
           */
          const name = normalizeCaseSheetName(candidate.name, nextCaseSheetName(names));
          names.push(name);

          const result = await createCaseSheet(supabase, {
            identity,
            grid: candidate.grid,
            name,
            tabPosition: existing.length + index,
            sourceFilename,
            actor: selfKey,
          });

          created.push(result.sheet);
          if (!firstGrid) firstGrid = result.grid;
        }

        setSheets([...existing, ...created]);
        setActiveId(created[0]?.id ?? null);
        setGrid(firstGrid);

        toast.success(
          sourceFilename
            ? `Imported ${sourceFilename}${created.length > 1 ? ` — ${created.length} tabs` : ''}`
            : 'Sheet created',
        );
      } catch (err) {
        console.error('[CaseHandling] failed to create sheet', err);
        toast.error(err instanceof Error ? err.message : 'Could not create the sheet');
      } finally {
        setBusy(false);
      }
    },
    [identity, selfKey],
  );

  const startSheet = useCallback(
    (next: CaseSheetGrid, sourceFilename: string | null) =>
      startSheets([{ grid: next }], sourceFilename),
    [startSheets],
  );

  // ---------------------------------------------------------------- tabs

  /**
   * Opens another tab.
   *
   * Anything still queued is written first: the queue and the subscription both belong to whichever
   * sheet is open, so switching before the flush would send the previous tab's edits to the new
   * tab's id — writing one handler's work into the wrong sheet.
   */
  const selectSheet = useCallback(
    async (nextId: string) => {
      if (nextId === activeId || switching) return;

      const record = sheets.find((candidate) => candidate.id === nextId);
      if (!record) return;

      setEditing(false);
      setRange(null);
      setEditingHeader(null);
      await flushRef.current?.();

      setSwitching(true);
      try {
        const nextGrid = await fetchCaseSheetGrid(supabase, record);
        setActiveId(nextId);
        setGrid(nextGrid);
      } catch (err) {
        console.error('[CaseHandling] failed to open tab', err);
        toast.error('Could not open that tab');
      } finally {
        setSwitching(false);
      }
    },
    [activeId, sheets, switching],
  );

  const handleAddTab = useCallback(async () => {
    if (readOnly) return;

    await flushRef.current?.();
    setBusy(true);
    try {
      const name = nextCaseSheetName(sheets.map((record) => record.name));
      const result = await createCaseSheet(supabase, {
        identity,
        grid: createEmptyGrid(),
        name,
        // At the end of the strip, where a new sheet goes in a workbook.
        tabPosition: sheets.length,
        actor: selfKey,
      });

      setSheets((prev) => [...prev, result.sheet]);
      setActiveId(result.sheet.id);
      setGrid(result.grid);
      setRange(null);
    } catch (err) {
      console.error('[CaseHandling] failed to add a tab', err);
      toast.error(err instanceof Error ? err.message : 'Could not add a tab');
    } finally {
      setBusy(false);
    }
  }, [identity, readOnly, selfKey, sheets]);

  const handleRenameTab = useCallback(
    async (sheetIdToRename: string, name: string) => {
      setRenamingTab(null);

      const record = sheets.find((candidate) => candidate.id === sheetIdToRename);
      const next = normalizeCaseSheetName(name, record?.name ?? 'Sheet 1');
      if (!record || next === record.name) return;

      // Shown straight away; a name is cosmetic enough that waiting on the round trip would jar.
      setSheets((prev) =>
        prev.map((candidate) =>
          candidate.id === sheetIdToRename ? { ...candidate, name: next } : candidate,
        ),
      );

      try {
        await renameCaseSheet(supabase, sheetIdToRename, next, selfKey);
      } catch (err) {
        console.error('[CaseHandling] failed to rename a tab', err);
        toast.error('Could not rename that tab');
        setSheets((prev) =>
          prev.map((candidate) =>
            candidate.id === sheetIdToRename ? { ...candidate, name: record.name } : candidate,
          ),
        );
      }
    },
    [selfKey, sheets],
  );

  /*
   * Deleting takes a whole spreadsheet, and the people who work a case share it — so it is an
   * admin's call. Checked again inside the handler, not only on the button: the control is hidden
   * for everyone else, and a hidden control is not a check.
   */
  const canDeleteSheet = !readOnly && isAdmin;

  const handleDeleteTab = useCallback(
    async (sheetIdToDelete: string) => {
      const record = sheets.find((candidate) => candidate.id === sheetIdToDelete);
      if (!record || !canDeleteSheet) return;

      // A tab is a whole spreadsheet, and the cells go with it — worth asking.
      const confirmed = window.confirm(
        `Delete the tab "${record.name}" and everything in it? This cannot be undone.`,
      );
      if (!confirmed) return;

      setBusy(true);
      try {
        await deleteCaseSheet(supabase, sheetIdToDelete);

        const remaining = sheets.filter((candidate) => candidate.id !== sheetIdToDelete);
        setSheets(remaining);

        if (sheetIdToDelete !== activeId) return;

        /*
         * Opens the tab that took its place, or the one before it when the last was deleted — the
         * same neighbour Excel moves to.
         */
        const index = sheets.findIndex((candidate) => candidate.id === sheetIdToDelete);
        const neighbour = remaining[index] ?? remaining[index - 1] ?? null;

        setRange(null);
        setEditing(false);
        setActiveId(neighbour?.id ?? null);
        setGrid(neighbour ? await fetchCaseSheetGrid(supabase, neighbour) : null);
      } catch (err) {
        console.error('[CaseHandling] failed to delete a tab', err);
        toast.error(err instanceof Error ? err.message : 'Could not delete that tab');
      } finally {
        setBusy(false);
      }
    },
    [activeId, canDeleteSheet, sheets],
  );

  // ---------------------------------------------------------------- import / export

  const handleUpload = useCallback(
    async (file: File) => {
      setBusy(true);
      try {
        const buffer = await file.arrayBuffer();
        /*
         * Values here, formatting separately from the file's XML below: `cellStyles` gets fills
         * through but nothing else, so text colour, alignment, bold and borders have to be read
         * out of the workbook directly — verified against real files rather than assumed.
         */
        const workbook = XLSX.read(buffer, { type: 'array', cellStyles: true });
        if (workbook.SheetNames.length === 0) throw new Error('That file has no sheets in it');

        /* Every sheet in the file becomes a tab, in the order the workbook lists them. */
        const imported: { name: string; grid: CaseSheetGrid }[] = [];

        for (const [sheetIndex, name] of workbook.SheetNames.entries()) {
          const worksheet = workbook.Sheets[name];
          if (!worksheet) continue;

          /*
           * `raw: false` makes SheetJS hand back the text Excel displays, which is what the handler
           * expects to see: a formatted date stays a date rather than becoming a serial number, and
           * a formula cell comes through as its result.
           *
           * `blankrows` is on so the rows line up one-for-one with the style table below. Dropping
           * blank rows would shift every colour after the first gap onto the wrong row — a blank row
           * with a fill on it is still a blank row as far as values are concerned. It also
           * preserves the spacing the author put in.
           */
          const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
            header: 1,
            raw: false,
            defval: '',
            blankrows: true,
          });

          // An empty tab in the middle of a workbook is skipped rather than failing the import.
          if (rows.length === 0) continue;

          const styles = await readWorkbookStyles(buffer, sheetIndex, worksheet, rows.length);

          /*
           * Column widths and row heights the author set by hand, in pixels, on `!cols` and
           * `!rows`. Entries are sparse: an untouched column has no entry at all.
           */
          const columnWidths = (worksheet['!cols'] ?? []).map((col) => col?.wpx ?? null);
          const rowHeights = (worksheet['!rows'] ?? []).map((row) => row?.hpx ?? null);

          imported.push({
            name,
            grid: gridFromAoa(rows, {
              /*
               * The file's own first row stays a row. Promoting it to the column headings would put
               * it where A, B, C live and leave the sheet a row short of what was uploaded — the
               * handler expects to see their file, titles included, not a reinterpretation of it.
               */
              hasHeaderRow: false,
              styles,
              /*
               * Excel records a Hebrew or Arabic workbook as a right-to-left view, which covers
               * every sheet in it. Where it says so we take its word; otherwise each sheet's own
               * text decides for itself.
               */
              rtl: workbook.Workbook?.Views?.[0]?.RTL === true ? true : undefined,
              columnWidths,
              rowHeights,
            }),
          });
        }

        if (imported.length === 0) throw new Error('Every sheet in that file is empty');
        if (imported.some((entry) => entry.grid.rtl)) {
          toast('Right-to-left sheet — column A is on the right');
        }

        // Added alongside whatever the case already has, rather than replacing a colleague's work.
        await startSheets(imported, file.name);
      } catch (err) {
        console.error('[CaseHandling] failed to import workbook', err);
        toast.error(err instanceof Error ? err.message : 'Could not read that file');
      } finally {
        setBusy(false);
      }
    },
    [startSheets],
  );

  const exportFilename = `Case_Handling_${client?.lead_number || client?.id || 'case'}.xlsx`;

  /** The sheet as a workbook, which both the download and the internal share are built from. */
  const buildWorkbook = useCallback(() => {
    const current = gridRef.current;
    if (!current) return null;

    const worksheet = XLSXStyle.utils.aoa_to_sheet(gridToAoa(current));

    /*
     * Formatting onto the cells of the written sheet.
     *
     * Through `xlsx-js-style` rather than plain `xlsx`, which cannot write styles at all: a
     * downloaded sheet used to arrive as bare text, losing the colours and the lines that are
     * most of what the handler was looking at. Offset by the heading row where there is one, so
     * the styles land on the cells they belong to.
     */
    const headerOffset = hasNamedColumns(current) ? 1 : 0;
    for (let rowIndex = 0; rowIndex < current.rowCount; rowIndex += 1) {
      for (let colIndex = 0; colIndex < current.columns.length; colIndex += 1) {
        const style = exportCellStyle(
          getFormat(current, rowIndex, colIndex),
          resolveCellBackground(current, rowIndex, colIndex),
        );
        if (!style) continue;

        const address = XLSXStyle.utils.encode_cell({
          r: rowIndex + headerOffset,
          c: colIndex,
        });
        // A styled but empty cell has no entry yet, and a style with no cell is not written out.
        if (!worksheet[address]) worksheet[address] = { t: 's', v: '' };
        (worksheet[address] as Record<string, unknown>).s = style;
      }
    }

    /*
     * Widths and heights survive a write — verified by round-tripping one.
     * The leading row is the heading, which `gridToAoa` puts first.
     */
    worksheet['!cols'] = current.columns.map((_, colIndex) => ({
      wpx: resolveColumnWidth(current, colIndex),
    }));
    const bodyHeights = Array.from({ length: current.rowCount }, (_, rowIndex) => ({
      hpx: resolveRowHeight(current, rowIndex),
    }));
    /* Only offset by a heading row when `gridToAoa` actually wrote one. */
    worksheet['!rows'] = hasNamedColumns(current)
      ? [{ hpx: CASE_SHEET_ROW_HEIGHT_DEFAULT }, ...bodyHeights]
      : bodyHeights;

    const workbook = XLSXStyle.utils.book_new();
    XLSXStyle.utils.book_append_sheet(workbook, worksheet, 'Case Handling');

    // Mirrors the sheet for a Hebrew case, the same way Excel records it.
    if (current.rtl) {
      workbook.Workbook = { ...workbook.Workbook, Views: [{ RTL: true }] };
    }

    return workbook;
  }, []);

  const handleExport = useCallback(() => {
    const workbook = buildWorkbook();
    if (!workbook) return;
    XLSXStyle.writeFile(workbook, exportFilename);
  }, [buildWorkbook, exportFilename]);

  /** The same workbook as the download, as bytes, for the internal share to upload. */
  const buildShareBytes = useCallback((): ArrayBuffer | null => {
    const workbook = buildWorkbook();
    if (!workbook) return null;
    return XLSXStyle.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  }, [buildWorkbook]);

  // ---------------------------------------------------------------- render

  if (!hasCaseSheetIdentity(identity)) {
    return (
      <div className="p-8 text-center text-gray-500">
        This case has no lead record, so there is nowhere to attach a sheet.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-3 p-12 text-gray-500">
        <span className="loading loading-spinner loading-md" />
        Loading the case sheet…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="p-8">
        <div className="alert alert-error">
          <ExclamationTriangleIcon className="w-5 h-5" />
          <span>{loadError}</span>
          <button className="btn btn-sm" onClick={() => window.location.reload()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (sheets.length > 0 && (!sheet || !grid)) {
    // Tabs exist but this one's cells are still on their way, or failed to arrive.
    return (
      <div className="flex items-center justify-center gap-3 p-12 text-gray-500">
        <span className="loading loading-spinner loading-md" />
        Opening the sheet…
      </div>
    );
  }

  if (!sheet || !grid) {
    return (
      <div className="flex flex-col items-center justify-center gap-6 p-12 text-center">
        <TableCellsIcon className="w-16 h-16 text-gray-300" />
        <h3 className="text-lg font-semibold text-gray-900">No case sheet yet</h3>
        {!readOnly && (
          <div className="flex w-full max-w-md flex-col items-center gap-4">
            <ExcelDropZone busy={busy} onFile={(file) => void handleUpload(file)} />
            <div className="flex w-full items-center gap-3 text-xs uppercase tracking-wide text-gray-400">
              <span className="h-px flex-1 bg-gray-200" />
              or
              <span className="h-px flex-1 bg-gray-200" />
            </div>
            <button
              className="btn btn-primary gap-2 rounded-full px-6"
              disabled={busy}
              onClick={() => void startSheet(createEmptyGrid(), null)}
            >
              <PlusIcon className="w-5 h-5" />
              New sheet
            </button>
          </div>
        )}
        {busy && <span className="loading loading-spinner loading-sm" />}
      </div>
    );
  }

  const rowNumbers = Array.from({ length: grid.rowCount }, (_, i) => i);

  const columnSelected = (colIndex: number) => isColumnFullySelected(range, colIndex, grid);
  const editedAt = formatCaseSheetEditedAt(sheet.updatedAt);

  const gridScrollbarWidth = measureScrollbarWidth();

  /* Under `table-fixed` the table has to be told its own width, or it cannot be scrolled to. */
  const tableWidth =
    GUTTER_WIDTH +
    grid.columns.reduce((total, _, colIndex) => total + resolveColumnWidth(grid, colIndex), 0);

  const sheetView = (
    /* Full page, the column is the window's height, which is what lets the grid take the slack. */
    <div className={`flex flex-col gap-3 ${fullscreen ? 'h-full' : ''}`}>
      <div className="flex flex-wrap items-center gap-3 px-1">
        <div className="flex items-center gap-2 font-semibold text-gray-900">
          <TableCellsIcon className="w-5 h-5 text-primary" />
          {/* The feature, not the sheet: which sheet is open is what the tab strip below says. */}
          Case Handling
        </div>

        <SaveIndicator status={saveStatus} onRetry={() => void flushNow()} />

        {viewers.length > 0 && (
          <div className="flex items-center gap-2">
            <div className="flex -space-x-2">
              {viewers.slice(0, 4).map((viewer) => (
                <span
                  key={viewer.key}
                  className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white text-[11px] font-bold text-white shadow"
                  style={{ backgroundColor: viewerColor(viewer.key) }}
                  title={`${viewer.name} is in this sheet`}
                >
                  {viewer.initials}
                </span>
              ))}
            </div>
            <span className="text-xs text-gray-500">
              {viewers.length === 1
                ? `${viewers[0].name} is editing`
                : `${viewers.length} others editing`}
            </span>
          </div>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {canEdit && (
            <>
              <button className="btn btn-sm btn-ghost gap-1" onClick={handleAddRows}>
                <PlusIcon className="w-4 h-4" />
                {ROWS_PER_ADD} rows
              </button>
              <button className="btn btn-sm btn-ghost gap-1" onClick={handleAddColumn}>
                <PlusIcon className="w-4 h-4" />
                Column
              </button>
            </>
          )}
          {canEdit && (
            <button
              className="btn btn-sm btn-ghost gap-1"
              title={grid.rtl ? 'Switch to left-to-right' : 'Switch to right-to-left'}
              onClick={toggleRtl}
            >
              <LanguageIcon className="w-4 h-4" />
              {grid.rtl ? 'RTL' : 'LTR'}
            </button>
          )}
          <button
            className="btn btn-sm btn-ghost gap-1"
            title={fullscreen ? 'Back to the tab' : 'Open the sheet full page'}
            onClick={() => setFullscreen((current) => !current)}
          >
            {fullscreen ? (
              <ArrowsPointingInIcon className="w-4 h-4" />
            ) : (
              <ArrowsPointingOutIcon className="w-4 h-4" />
            )}
            {fullscreen ? 'Exit' : 'Full page'}
          </button>

          {/* Export lives inside Share now, as its "external" route — one way to leave the app. */}
          <CaseSheetShareMenu
            sheetId={sheet.id}
            filename={exportFilename}
            leadNumber={client?.lead_number ?? null}
            leadName={client?.name ?? null}
            buildBytes={buildShareBytes}
            onDownload={handleExport}
          />
        </div>
      </div>

      {canEdit && (
        <FormatToolbar
          grid={grid}
          targets={selectedCells}
          onChange={changeFormat}
          onPaintBand={paintBand}
          onBorders={applyBorders}
          canUndo={historyDepth.past > 0}
          canRedo={historyDepth.future > 0}
          onUndo={undo}
          onRedo={redo}
        />
      )}

      {/*
        * The outline belongs to the cells rather than to this container, which leaves the
        * row-number strip outside the grid as a plain gutter — room for the row controls without
        * them sitting on top of the sheet.
        */}
      {/*
        * White behind the table, not grey: the gutter cells paint their own background, so a grey
        * container only showed as a band to the right of a sheet narrower than the panel.
        */}
      {/*
        * Clips the vertical scrollbar that the box inside pushes out of view, so the grid shows
        * only the one along the bottom. Both axes have to belong to the same box for the horizontal
        * bar to stay pinned to the foot of the sheet, and CSS cannot hide a scrollbar on one axis
        * alone — so the box is made wider than this one by exactly a scrollbar, and overhangs.
        */}
      <div
        className={`overflow-hidden rounded-xl bg-white ${fullscreen ? 'min-h-0 flex-1' : ''}`}
      >
        <div
          ref={scrollRef}
          className="h-full overflow-auto"
          style={{
            maxHeight: fullscreen ? undefined : '70vh',
            /*
             * Logical, not left and right: in a Hebrew sheet the vertical scrollbar is drawn on the
             * left, which is also where `inline-end` points once the box reads right-to-left.
             */
            marginInlineEnd: -gridScrollbarWidth,
            paddingInlineEnd: gridScrollbarWidth,
          }}
          /*
           * The direction belongs to the scrolling box, not only to the table inside it. Left on the
           * table alone, the table is still a left-to-right box in a left-to-right parent: it is
           * anchored by its left edge and grows rightward, while its columns grow leftward. Widening
           * a column then moves the table and the column by the same amount in opposite directions,
           * so the divider being dragged stays frozen under the pointer and the far side of the
           * column appears to move instead. Here the box is anchored on the right, the sheet opens on
           * column A, and a dragged edge tracks the pointer exactly.
           */
          dir={grid.rtl ? 'rtl' : 'ltr'}
        >
        <table
          /*
           * `table-fixed`, so a dragged column is exactly as wide as it was dragged to — left to
           * size itself the browser redistributes spare space and the column settles somewhere
           * other than where the pointer was let go. The table still spans the full width of the
           * toolbar above it, because the spare space goes to a trailing spacer column instead of
           * being shared out among the real ones. `minWidth` is what makes it scroll once the
           * columns together are wider than the panel.
           */
          className={`w-full table-fixed border-collapse text-sm ${
            dragging || resizing ? 'select-none' : ''
          }`}
          style={{ minWidth: tableWidth }}
        >
          <colgroup>
            <col style={{ width: GUTTER_WIDTH }} />
            {grid.columns.map((_, colIndex) => (
              <col key={colIndex} style={{ width: resolveColumnWidth(grid, colIndex) }} />
            ))}
            {/* Unsized on purpose: this is the column that soaks up whatever width is left over. */}
            <col />
          </colgroup>

          <thead className="sticky top-0 z-20">
            <tr>
              {/* Opaque, because it is sticky and the sheet scrolls underneath it. */}
              {/* `start-0` rather than `left-0`, so a right-to-left sheet pins it on the right. */}
              <th className="sticky start-0 z-30 bg-gray-100 px-0 py-2" />
              {grid.columns.map((label, colIndex) => (
                <th
                  key={colIndex}
                  data-cell-col={colIndex}
                  className={`relative border-b border-r border-t border-gray-200 px-3 py-2 text-left text-xs font-semibold ${
                    columnSelected(colIndex) ? 'text-primary' : 'text-gray-700'
                  } ${colIndex === 0 ? 'border-l' : ''} ${
                    grid.columnColors.has(colIndex)
                      ? ''
                      : columnSelected(colIndex)
                        ? 'bg-primary/20'
                        : 'bg-gray-50'
                  }`}
                  style={{ backgroundColor: grid.columnColors.get(colIndex) }}
                  dir="auto"
                  onDoubleClick={() => canEdit && setEditingHeader(colIndex)}
                  title={canEdit ? 'Click to select the column, double-click to rename' : undefined}
                  onMouseDown={(event) => {
                    if (!canEdit || event.button !== 0) return;
                    // Not while the heading is being renamed, or the caret could never be placed.
                    if (editingHeader === colIndex) return;
                    beginBandDrag('column', colIndex, event.shiftKey);
                  }}
                  onMouseEnter={() => {
                    if (dragging && dragModeRef.current === 'column') {
                      extendDrag({ rowIndex: 0, colIndex });
                    }
                  }}
                >
                  {editingHeader === colIndex ? (
                    <input
                      autoFocus
                      defaultValue={label}
                      className="input input-xs input-bordered w-full"
                      onBlur={(event) => handleRenameColumn(colIndex, event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') handleRenameColumn(colIndex, event.currentTarget.value);
                        if (event.key === 'Escape') setEditingHeader(null);
                      }}
                    />
                  ) : (
                    <span className="flex items-baseline gap-1">
                      {label}
                      {/* An unnamed column is already called "A", so the hint would just repeat it. */}
                      {label !== columnLabel(colIndex) && (
                        <span className="text-[10px] font-normal text-gray-400">
                          {columnLabel(colIndex)}
                        </span>
                      )}
                    </span>
                  )}

                  {canEdit && (
                    /*
                      * On the trailing edge, which `end-0` mirrors in a right-to-left sheet. Its own
                      * mousedown stops the heading's column-selection gesture from also firing.
                      */
                    <span
                      className="absolute end-0 top-0 z-10 h-full w-1.5 cursor-col-resize hover:bg-primary/40"
                      title="Drag to resize this column"
                      onMouseDown={(event) => beginResize('column', colIndex, event)}
                      onDoubleClick={(event) => {
                        event.stopPropagation();
                        resetBandSize('column', colIndex);
                      }}
                    />
                  )}
                </th>
              ))}
              <th className="border-b border-t border-gray-200 bg-gray-50 p-0" />
            </tr>
          </thead>
          <tbody>
            {rowNumbers.map((rowIndex) => {
              // A fully selected row is marked in its gutter, the way Excel highlights the number.
              const rowSelected = isRowFullySelected(range, rowIndex, grid);
              const rowHeight = resolveRowHeight(grid, rowIndex);

              return (
                <tr key={rowIndex} className="group">
                  {/* Click or drag the numbers to select whole rows, as in Excel. */}
                  <td
                    data-cell-row={rowIndex}
                    /* Sticky already anchors the resize handle below; no `relative` needed. */
                    className={`sticky start-0 z-10 px-0 align-middle text-[11px] ${
                      rowSelected ? 'text-primary font-semibold' : 'text-gray-400'
                    } ${
                      grid.rowColors.has(rowIndex)
                        ? ''
                        : rowSelected
                          ? 'bg-primary/20'
                          : 'bg-gray-100'
                    }`}
                    style={{ backgroundColor: grid.rowColors.get(rowIndex) }}
                    title={canEdit ? 'Click or drag to select rows' : undefined}
                    onMouseDown={(event) => {
                      if (!canEdit || event.button !== 0) return;
                      beginBandDrag('row', rowIndex, event.shiftKey);
                    }}
                    onMouseEnter={() => {
                      if (dragging && dragModeRef.current === 'row') {
                        extendDrag({ rowIndex, colIndex: 0 });
                      }
                    }}
                  >
                    <div
                      className={`flex items-center justify-end gap-1 px-1.5 ${
                        canEdit ? 'cursor-pointer' : ''
                      }`}
                      style={{ height: rowHeight }}
                    >
                      {canEdit && (
                        <button
                          className="invisible text-gray-400 transition-colors hover:text-error group-hover:visible"
                          title="Delete this row"
                          /* Kept out of the row-selection gesture that owns the rest of the gutter. */
                          onMouseDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation();
                            handleDeleteRow(rowIndex);
                          }}
                        >
                          <TrashIcon className="w-5 h-5" />
                        </button>
                      )}
                      <span>{rowIndex + 1}</span>
                    </div>

                    {canEdit && (
                      /* On the bottom edge of the gutter, out of the way of the row selection. */
                      <span
                        className="absolute bottom-0 start-0 z-10 h-1.5 w-full cursor-row-resize hover:bg-primary/40"
                        title="Drag to resize this row"
                        onMouseDown={(event) => beginResize('row', rowIndex, event)}
                        onDoubleClick={(event) => {
                          event.stopPropagation();
                          resetBandSize('row', rowIndex);
                        }}
                      />
                    )}
                  </td>

                  {grid.columns.map((_, colIndex) => {
                    const isAnchor =
                      range?.anchor.rowIndex === rowIndex && range?.anchor.colIndex === colIndex;
                    const inRange = selectedKeys.has(`${rowIndex}:${colIndex}`);
                    const viewer = viewersByCell.get(`${rowIndex}:${colIndex}`);
                    const value = getCell(grid, rowIndex, colIndex);
                    const format = getFormat(grid, rowIndex, colIndex);
                    // The cell's own highlight, or the row's, or the column's — in that order.
                    const style = formatStyle(format, resolveCellBackground(grid, rowIndex, colIndex));
                    const painted = style.backgroundColor != null;

                    return (
                      <td
                        key={colIndex}
                        /* Read back by the auto-scroll, which has only a pointer position to work from. */
                        data-cell-row={rowIndex}
                        data-cell-col={colIndex}
                        className={`relative border-b border-r border-gray-200 p-0 align-middle ${
                          colIndex === 0 ? 'border-l' : ''
                        } ${painted ? '' : 'bg-white'}`}
                        style={{
                          ...borderStyle(format),
                          // A colleague's cell is ringed in their colour, so it is obvious whose it is.
                          boxShadow: viewer
                            ? `inset 0 0 0 2px ${viewerColor(viewer.key)}`
                            : undefined,
                        }}
                        onMouseDown={(event) => {
                          if (!canEdit) return;
                          // Leave the open input alone, so a click inside it can place the caret.
                          if (isAnchor && editing) return;
                          if (event.button !== 0) return;
                          beginDrag({ rowIndex, colIndex }, event.shiftKey);
                        }}
                        onMouseEnter={() => {
                          if (dragging) extendDrag({ rowIndex, colIndex });
                        }}
                      >
                        {/*
                          * This stays in the layout whether or not the cell is being edited, and the
                          * input below floats on top of it. Swapping one for the other would resize
                          * the row on every click, because an input is an inline box and brings its
                          * own baseline spacing with it.
                          */}
                        <div
                          className={`truncate px-3 ${
                            canEdit ? 'cursor-cell' : 'cursor-default'
                          } ${value ? 'text-gray-900' : 'text-gray-300'} ${
                            isAnchor && !editing ? 'ring-2 ring-primary ring-inset' : ''
                          }`}
                          /*
                            * The line height matches the row, which keeps the text centred at any
                            * size and leaves `truncate` working — a flex box would break the
                            * ellipsis, because the text would no longer be the element's own.
                            */
                          style={{ ...style, height: rowHeight, lineHeight: `${rowHeight}px` }}
                          title={value || undefined}
                          /*
                           * Per cell, so a phone number or an English name inside a Hebrew sheet is
                           * laid out the way its own text reads rather than the way the sheet does.
                           */
                          dir="auto"
                        >
                          {value}
                        </div>

                        {/*
                          * The selection is drawn as a layer rather than a background colour. A
                          * painted cell carries its fill as an inline style, which no background
                          * class can override — so a selected row of coloured cells would otherwise
                          * look exactly like an unselected one.
                          */}
                        {inRange && !isAnchor && (
                          <span className="pointer-events-none absolute inset-0 bg-primary/20" />
                        )}

                        {isAnchor && editing && (
                          <input
                            autoFocus
                            value={draft}
                            className="absolute inset-0 h-full w-full border-0 bg-white px-3 outline-none ring-2 ring-primary ring-inset"
                            // The cell's own formatting, so text does not change appearance the
                            // moment it is clicked into. A highlight shows through while editing.
                            style={{ ...style, lineHeight: `${rowHeight}px` }}
                            dir={containsRtlText(draft) ? 'rtl' : 'auto'}
                            onChange={(event) => setDraft(event.target.value)}
                            onKeyDown={handleCellKeyDown}
                            onPaste={handlePaste}
                            onBlur={() => {
                              commitDraft(draft, { rowIndex, colIndex });
                              // The selection stays so the toolbar still has something to act on.
                              setEditing(false);
                            }}
                          />
                        )}

                        {viewer && (
                          <span
                            className="pointer-events-none absolute -top-2 end-0 rounded px-1 text-[9px] font-bold text-white"
                            style={{ backgroundColor: viewerColor(viewer.key) }}
                          >
                            {viewer.initials}
                          </span>
                        )}
                      </td>
                    );
                  })}
                  <td className="border-b border-gray-200 p-0" />
                </tr>
              );
            })}
          </tbody>
          </table>
        </div>
      </div>

      <SheetTabStrip
        sheets={sheets}
        activeId={activeId}
        busy={busy}
        switching={switching}
        readOnly={readOnly}
        canDelete={canDeleteSheet}
        renaming={renamingTab}
        onSelect={(id) => void selectSheet(id)}
        onAdd={() => void handleAddTab()}
        onImport={() => setImportOpen(true)}
        onStartRename={setRenamingTab}
        onRename={(id, name) => void handleRenameTab(id, name)}
        onDelete={(id) => void handleDeleteTab(id)}
      />

      {importOpen && (
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center bg-black/30 p-4"
          onClick={() => setImportOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-label="Add an Excel sheet"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-gray-900">Add an Excel sheet</h3>
                <p className="mt-1 text-sm text-gray-500">
                  Its sheets arrive as new tabs. Nothing already here is replaced.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-square shrink-0"
                aria-label="Close"
                onClick={() => setImportOpen(false)}
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="flex justify-center">
              <ExcelDropZone
                busy={busy}
                onFile={(file) => {
                  setImportOpen(false);
                  void handleUpload(file);
                }}
              />
            </div>
          </div>
        </div>
      )}

      {editor && (
        <span className="flex items-center gap-1.5 px-1 text-xs text-gray-500">
          {editor.photoUrl ? (
            <img
              src={editor.photoUrl}
              alt=""
              className="h-6 w-6 rounded-full object-cover"
              /* A broken photo should fall back to initials rather than show a torn image. */
              onError={(event) => {
                event.currentTarget.style.display = 'none';
              }}
            />
          ) : (
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-200 text-[10px] font-bold text-gray-600">
              {editor.initials}
            </span>
          )}
          <span>
            Last edited by {editor.name}
            {editedAt && <span className="text-gray-400"> · {editedAt}</span>}
          </span>
        </span>
      )}
    </div>
  );

  if (!fullscreen) return sheetView;

  /*
   * Portalled to the body rather than left in place. The tab sits inside a scrolling, clipping
   * panel, and an ancestor there with a transform would make `fixed` position against that element
   * instead of the window — the overlay would end up the size of the tab.
   */
  return createPortal(
    <div className="fixed inset-0 z-[200] bg-gray-100 p-4 sm:p-6">{sheetView}</div>,
    document.body,
  );
};

/** What SheetJS can read here; a handler's own file is nearly always .xlsx. */
const WORKBOOK_FILE_PATTERN = /\.(xlsx|xls|csv)$/i;
const WORKBOOK_FILE_ACCEPT = '.xlsx,.xls,.csv';

/**
 * Where a workbook comes in: a drop target that is also a button.
 *
 * A button rather than a styled div, so it is reachable by keyboard and announces itself. Dragging
 * a file is a mouse gesture, and it cannot be the only way in.
 */
const ExcelDropZone: React.FC<{
  busy: boolean;
  onFile: (file: File) => void;
}> = ({ busy, onFile }) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const take = (file: File | null | undefined) => {
    if (!file) return;
    if (!WORKBOOK_FILE_PATTERN.test(file.name)) {
      toast.error('That is not a spreadsheet — use .xlsx, .xls or .csv');
      return;
    }
    onFile(file);
  };

  return (
    <>
      <button
        type="button"
        className={`flex w-full max-w-md flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-colors ${
          dragging
            ? 'border-primary bg-primary/5'
            : 'border-gray-300 bg-gray-50 hover:border-primary/60 hover:bg-white'
        }`}
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        /* Dragover has to be prevented too, or the browser opens the file instead of dropping it. */
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          take(event.dataTransfer?.files?.[0]);
        }}
      >
        <span
          className={`flex h-12 w-12 items-center justify-center rounded-full ${
            dragging ? 'bg-primary text-white' : 'bg-white text-primary shadow-sm'
          }`}
        >
          {busy ? (
            <span className="loading loading-spinner loading-sm" />
          ) : (
            <ArrowUpTrayIcon className="h-6 w-6" />
          )}
        </span>
        <span className="text-sm font-semibold text-gray-900">
          {dragging ? 'Drop it to add the sheets' : 'Drag an Excel file here'}
        </span>
        <span className="text-xs text-gray-500">
          or click to browse — .xlsx, .xls or .csv. Every sheet in the file becomes a tab.
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={WORKBOOK_FILE_ACCEPT}
        className="hidden"
        onChange={(event) => {
          take(event.target.files?.[0]);
          // Cleared so picking the same file again still counts as a change.
          event.target.value = '';
        }}
      />
    </>
  );
};

/**
 * The row of sheet tabs under the grid, where a workbook keeps them.
 *
 * Each tab is one whole spreadsheet. The strip scrolls sideways rather than wrapping, so a case
 * with a dozen tabs keeps the grid above it the same height whatever happens down here.
 */
const SheetTabStrip: React.FC<{
  sheets: CaseSheetRecord[];
  activeId: string | null;
  busy: boolean;
  switching: boolean;
  readOnly?: boolean;
  /** Deleting is an admin's call, so the control is not simply the opposite of `readOnly`. */
  canDelete: boolean;
  renaming: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onImport: () => void;
  onStartRename: (id: string | null) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}> = ({
  sheets,
  activeId,
  busy,
  switching,
  readOnly,
  canDelete,
  renaming,
  onSelect,
  onAdd,
  onImport,
  onStartRename,
  onRename,
  onDelete,
}) => (
  <div className="flex items-center gap-2 border-t border-gray-200 px-1 pt-2">
    <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto pb-0.5">
      {sheets.map((entry) => {
        const active = entry.id === activeId;

        if (renaming === entry.id) {
          return (
            <input
              key={entry.id}
              autoFocus
              defaultValue={entry.name}
              className="input input-xs input-bordered w-36 shrink-0 rounded-b-lg"
              onBlur={(event) => onRename(entry.id, event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onRename(entry.id, event.currentTarget.value);
                if (event.key === 'Escape') onStartRename(null);
              }}
            />
          );
        }

        return (
          <div
            key={entry.id}
            /*
             * Square at the top and rounded at the bottom, so the open tab reads as part of the
             * sheet above it rather than as a button sitting underneath.
             */
            className={`group flex shrink-0 items-center gap-1 rounded-b-lg border-t-2 px-3 py-1.5 text-xs transition-colors ${
              active
                ? 'border-primary bg-white font-semibold text-gray-900 shadow-sm'
                : 'border-transparent bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700'
            }`}
          >
            <button
              type="button"
              className="max-w-[12rem] truncate"
              disabled={switching}
              title={
                readOnly ? entry.name : `${entry.name} — double-click to rename`
              }
              onClick={() => onSelect(entry.id)}
              onDoubleClick={() => {
                if (!readOnly && active) onStartRename(entry.id);
              }}
            >
              {entry.name}
            </button>

            {active && switching && <span className="loading loading-spinner loading-xs" />}

          </div>
        );
      })}
    </div>

    {!readOnly && (
      <>
        <button
          type="button"
          className="btn btn-xs btn-ghost shrink-0 gap-1"
          disabled={busy}
          title="Add a sheet"
          onClick={onAdd}
        >
          <PlusIcon className="w-3.5 h-3.5" />
          Sheet
        </button>
        <button
          type="button"
          className="btn btn-xs btn-ghost shrink-0 gap-1"
          disabled={busy}
          title="Add the sheets from an Excel file"
          onClick={onImport}
        >
          <ArrowUpTrayIcon className="w-3.5 h-3.5" />
          Excel
        </button>
        {/* Deletes the open tab, which is the one the grid above is showing. Admins only. */}
        {canDelete && activeId && (
          <button
            type="button"
            className="btn btn-xs btn-ghost shrink-0 gap-1 text-error hover:bg-error/10"
            disabled={busy}
            title="Delete the open sheet and everything in it"
            onClick={() => onDelete(activeId)}
          >
            <TrashIcon className="w-3.5 h-3.5" />
            Delete sheet
          </button>
        )}
      </>
    )}
  </div>
);

const ALIGN_ICONS: Record<CaseSheetAlign, React.ComponentType<{ className?: string }>> = {
  left: Bars3BottomLeftIcon,
  center: Bars3Icon,
  right: Bars3BottomRightIcon,
};

const ALIGN_LABELS: Record<CaseSheetAlign, string> = {
  left: 'Align left',
  center: 'Centre',
  right: 'Align right',
};

/**
 * Bold, italic, underline, alignment, highlight and text size for the selected cells.
 *
 * Every control suppresses mousedown. Without that the cell loses focus the instant the button is
 * pressed, and a handler would have to reselect the cell between each change.
 */
const FormatToolbar: React.FC<{
  grid: CaseSheetGrid;
  targets: Selection[];
  onChange: (patch: { [K in keyof CaseSheetCellFormat]?: CaseSheetCellFormat[K] | null }) => void;
  onPaintBand: (band: 'row' | 'column', color: string | null) => void;
  onBorders: (preset: CaseSheetBorderPreset) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}> = ({ grid, targets, onChange, onPaintBand, onBorders, canUndo, canRedo, onUndo, onRedo }) => {
  const disabled = targets.length === 0;
  const keepFocus = (event: React.MouseEvent) => event.preventDefault();

  const bold = isFormatActive(grid, targets, 'bold');
  const italic = isFormatActive(grid, targets, 'italic');
  const underline = isFormatActive(grid, targets, 'underline');
  const highlight = sharedFormatValue(grid, targets, 'highlight');
  const textColor = sharedFormatValue(grid, targets, 'textColor');
  const fontSize = sharedFormatValue(grid, targets, 'fontSize');
  const align = sharedFormatValue(grid, targets, 'align');

  const toggle = (key: 'bold' | 'italic' | 'underline', active: boolean) => () =>
    onChange({ [key]: active ? null : true });

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-xl border border-gray-200 bg-gray-50 px-2 py-1.5">
      {/* A step back and a step forward through the sheet's own edits, not the browser's history. */}
      <button
        type="button"
        className="btn btn-xs btn-ghost"
        disabled={!canUndo}
        title="Undo the last change"
        onMouseDown={keepFocus}
        onClick={onUndo}
      >
        <ArrowUturnLeftIcon className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        className="btn btn-xs btn-ghost"
        disabled={!canRedo}
        title="Redo the change you undid"
        onMouseDown={keepFocus}
        onClick={onRedo}
      >
        <ArrowUturnRightIcon className="w-3.5 h-3.5" />
      </button>

      <span className="mx-1 h-5 w-px bg-gray-300" />

      <button
        type="button"
        className={`btn btn-xs font-serif font-bold ${bold ? 'btn-primary' : 'btn-ghost'}`}
        disabled={disabled}
        aria-pressed={bold}
        title="Bold"
        onMouseDown={keepFocus}
        onClick={toggle('bold', bold)}
      >
        B
      </button>
      <button
        type="button"
        className={`btn btn-xs font-serif italic ${italic ? 'btn-primary' : 'btn-ghost'}`}
        disabled={disabled}
        aria-pressed={italic}
        title="Italic"
        onMouseDown={keepFocus}
        onClick={toggle('italic', italic)}
      >
        I
      </button>
      <button
        type="button"
        className={`btn btn-xs font-serif underline ${underline ? 'btn-primary' : 'btn-ghost'}`}
        disabled={disabled}
        aria-pressed={underline}
        title="Underline"
        onMouseDown={keepFocus}
        onClick={toggle('underline', underline)}
      >
        U
      </button>

      <span className="mx-1 h-5 w-px bg-gray-300" />

      <SwatchMenu
        title="Highlight the selected cells"
        disabled={disabled}
        onPick={(color) => onChange({ highlight: color })}
        trigger={
          <>
            <PaintBrushIcon className="w-3.5 h-3.5" />
            <span
              className="h-3 w-3 rounded border border-gray-300"
              style={{ backgroundColor: highlight || '#ffffff' }}
            />
          </>
        }
      />

      <SwatchMenu
        title="Text colour"
        disabled={disabled}
        options={CASE_SHEET_TEXT_COLORS}
        clearLabel="Automatic"
        onPick={(color) => onChange({ textColor: color })}
        trigger={
          <span className="flex flex-col items-center leading-none">
            <span className="font-serif text-[11px] font-bold">A</span>
            <span
              className="mt-0.5 h-1 w-3.5 rounded-sm"
              /* The bar shows the current colour, which is what makes the button readable at a glance. */
              style={{ backgroundColor: textColor || '#111827' }}
            />
          </span>
        }
      />

      <SwatchMenu
        title="Colour the selected rows"
        disabled={disabled}
        onPick={(color) => onPaintBand('row', color)}
        trigger="Row"
      />
      <SwatchMenu
        title="Colour the selected columns"
        disabled={disabled}
        onPick={(color) => onPaintBand('column', color)}
        trigger="Column"
      />

      <span className="mx-1 h-5 w-px bg-gray-300" />

      <BorderMenu disabled={disabled} onPick={onBorders} />

      <span className="mx-1 h-5 w-px bg-gray-300" />

      {CASE_SHEET_ALIGNMENTS.map((option) => {
        const Icon = ALIGN_ICONS[option];
        const active = align === option;
        return (
          <button
            key={option}
            type="button"
            className={`btn btn-xs ${active ? 'btn-primary' : 'btn-ghost'}`}
            disabled={disabled}
            aria-pressed={active}
            title={ALIGN_LABELS[option]}
            onMouseDown={keepFocus}
            /* Pressing the active one again hands the cell back to the sheet's own direction. */
            onClick={() => onChange({ align: active ? null : option })}
          >
            <Icon className="w-3.5 h-3.5" />
          </button>
        );
      })}

      <span className="mx-1 h-5 w-px bg-gray-300" />

      <select
        className="select select-xs select-bordered w-28"
        disabled={disabled}
        title="Text size"
        /* A mixed selection shows no size rather than claiming one it does not have. */
        value={fontSize ?? (targets.length > 0 ? CASE_SHEET_FONT_SIZE_DEFAULT : '')}
        onMouseDown={keepFocus}
        onChange={(event) => {
          const size = Number(event.target.value);
          onChange({ fontSize: size === CASE_SHEET_FONT_SIZE_DEFAULT ? null : size });
        }}
      >
        {CASE_SHEET_FONT_SIZES.map((size) => (
          <option key={size} value={size}>
            {size === CASE_SHEET_FONT_SIZE_DEFAULT ? `${size} (normal)` : size}
          </option>
        ))}
      </select>

      <span className="ml-2 text-xs text-gray-400">
        {disabled
          ? 'Select a cell to format it'
          : targets.length === 1
            ? 'Formatting 1 cell'
            : `Formatting ${targets.length} cells`}
      </span>
    </div>
  );
};

/**
 * A swatch picker, used for a cell highlight and for painting a whole row or column.
 *
 * The open state lives here rather than in DaisyUI's `dropdown`, which reveals its menu only on
 * `:focus-within`. Every control in this toolbar suppresses mousedown so the selected cell keeps
 * focus, and that also stops the button being focused — so a CSS-driven dropdown never opens at all.
 */
const SwatchMenu: React.FC<{
  trigger: React.ReactNode;
  title: string;
  disabled: boolean;
  onPick: (color: string | null) => void;
  /** Defaults to the fill swatches; text colours are a darker set. */
  options?: { label: string; value: string }[];
  /** What clearing the colour is called — "None" for a fill, "Automatic" for text. */
  clearLabel?: string;
}> = ({ trigger, title, disabled, onPick, options, clearLabel }) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const keepFocus = (event: React.MouseEvent) => event.preventDefault();

  useEffect(() => {
    if (!open) return;

    const closeOnOutside = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    window.addEventListener('mousedown', closeOnOutside);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('mousedown', closeOnOutside);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  // Nothing stays open once the selection it would apply to is gone.
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const pick = (color: string | null) => {
    onPick(color);
    setOpen(false);
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        className={`btn btn-xs gap-1 ${open ? 'btn-active btn-ghost' : 'btn-ghost'}`}
        disabled={disabled}
        title={title}
        aria-expanded={open}
        onMouseDown={keepFocus}
        onClick={() => setOpen((current) => !current)}
      >
        {trigger}
      </button>

      {open && (
        <ul className="menu absolute start-0 top-full z-50 mt-1 w-40 rounded-box bg-base-100 p-2 shadow-lg">
          {(options ?? CASE_SHEET_HIGHLIGHTS).map((option) => (
            <li key={option.value}>
              <button
                type="button"
                className="flex items-center gap-2"
                onMouseDown={keepFocus}
                onClick={() => pick(option.value)}
              >
                <span
                  className="h-4 w-4 rounded border border-gray-300"
                  style={{ backgroundColor: option.value }}
                />
                {option.label}
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              className="flex items-center gap-2"
              onMouseDown={keepFocus}
              onClick={() => pick(null)}
            >
              <NoSymbolIcon className="w-4 h-4 text-gray-400" />
              {clearLabel ?? 'None'}
            </button>
          </li>
        </ul>
      )}
    </div>
  );
};

const BORDER_PRESETS: { preset: CaseSheetBorderPreset; label: string }[] = [
  { preset: 'all', label: 'All borders' },
  { preset: 'outline', label: 'Outside' },
  { preset: 'top', label: 'Top line' },
  { preset: 'bottom', label: 'Bottom line' },
  { preset: 'left', label: 'Left line' },
  { preset: 'right', label: 'Right line' },
];

/**
 * The Borders menu, which draws the row and column lines on a selected block.
 *
 * Open state is held here for the same reason the swatch menu holds its own: the toolbar suppresses
 * mousedown to keep the cell selected, which also stops a CSS-driven dropdown ever opening.
 */
const BorderMenu: React.FC<{
  disabled: boolean;
  onPick: (preset: CaseSheetBorderPreset) => void;
}> = ({ disabled, onPick }) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const keepFocus = (event: React.MouseEvent) => event.preventDefault();

  useEffect(() => {
    if (!open) return;

    const closeOnOutside = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    window.addEventListener('mousedown', closeOnOutside);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('mousedown', closeOnOutside);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const pick = (preset: CaseSheetBorderPreset) => {
    onPick(preset);
    setOpen(false);
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        className={`btn btn-xs gap-1 ${open ? 'btn-active btn-ghost' : 'btn-ghost'}`}
        disabled={disabled}
        title="Row and column lines"
        aria-expanded={open}
        onMouseDown={keepFocus}
        onClick={() => setOpen((current) => !current)}
      >
        <TableCellsIcon className="w-3.5 h-3.5" />
        Lines
      </button>

      {open && (
        <ul className="menu absolute start-0 top-full z-50 mt-1 w-44 rounded-box bg-base-100 p-2 shadow-lg">
          {BORDER_PRESETS.map((option) => (
            <li key={option.preset}>
              <button
                type="button"
                onMouseDown={keepFocus}
                onClick={() => pick(option.preset)}
              >
                {option.label}
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              className="flex items-center gap-2"
              onMouseDown={keepFocus}
              onClick={() => pick('none')}
            >
              <NoSymbolIcon className="w-4 h-4 text-gray-400" />
              Clear lines
            </button>
          </li>
        </ul>
      )}
    </div>
  );
};

const SaveIndicator: React.FC<{ status: CaseSheetSaveStatus; onRetry: () => void }> = ({
  status,
  onRetry,
}) => {
  if (status === 'error') {
    return (
      <button className="btn btn-xs btn-error gap-1" onClick={onRetry}>
        <ExclamationTriangleIcon className="w-3.5 h-3.5" />
        Not saved — retry
      </button>
    );
  }

  if (status === 'saving') {
    return (
      <span className="flex items-center gap-1 text-xs text-gray-500">
        <ArrowPathIcon className="w-3.5 h-3.5 animate-spin" />
        Saving…
      </span>
    );
  }

  /*
   * Nothing is shown once everything is saved. The byline's last-edited time already says the work
   * landed, and a permanent green tick beside it says the same thing twice. The three states above
   * stay, because a handler who cannot see a failed save would keep typing into a sheet that is
   * quietly losing their work.
   */
  return null;
};

export default CaseHandlingTab;
