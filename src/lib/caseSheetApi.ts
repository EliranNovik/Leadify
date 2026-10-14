/**
 * Reading and writing the Case Handling sheet, plus the Realtime wiring that lets two handlers work
 * on it at the same time.
 *
 * Takes the Supabase client as an argument like `leadSubEfforts` and `leadHelperHandlers` do, rather
 * than importing the singleton, so the pure parts can be tested without standing up a client.
 *
 * See sql/2026-10-14_case_sheets.sql for why cells are rows rather than one document.
 */
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

import { leadSubEffortIdentityFromClientId } from './leadSubEfforts';
import { type CaseSheetAiCell, renderCaseSheetsForAi } from './caseSheetAiText';
import {
  type CaseSheetCellChange,
  type CaseSheetGrid,
  type CaseSheetStoredCell,
  bandMapToRecord,
  formatFromStoredCell,
  sizeMapToRecord,
  gridFromStoredCells,
  usedBounds,
} from './caseSheetGrid';

export type CaseSheetIdentity = {
  newLeadId: string | null;
  legacyLeadId: number | null;
};

export type CaseSheetRecord = {
  id: string;
  name: string;
  /** Where it sits in the case's row of tabs. */
  tabPosition: number;
  columns: string[];
  rowCount: number;
  sourceFilename: string | null;
  rtl: boolean;
  rowColors: Record<string, string>;
  columnColors: Record<string, string>;
  rowHeights: Record<string, number>;
  columnWidths: Record<string, number>;
  updatedAt: string | null;
  updatedBy: string | null;
};

/** Who last touched the sheet, for the byline beside the save state. */
export type CaseSheetEditor = {
  email: string;
  name: string;
  initials: string;
  photoUrl: string | null;
};

export type CaseSheetWithGrid = { sheet: CaseSheetRecord; grid: CaseSheetGrid };

/** Someone currently looking at the sheet, for the avatars in the toolbar. */
export type CaseSheetViewer = {
  key: string;
  name: string;
  initials: string;
  /** Which cell they have selected, so the grid can outline it in their colour. */
  activeCell: { rowIndex: number; colIndex: number } | null;
};

const SHEET_COLUMNS =
  'id, name, tab_position, columns, row_count, source_filename, rtl, row_colors, column_colors, row_heights, column_widths, updated_at, updated_by';

/**
 * Split a CRM client id into the key for whichever lead table owns it.
 *
 * Delegated rather than reimplemented so the per-lead features cannot disagree about what a client
 * id means; legacy ids reach the UI prefixed with `legacy_`.
 */
export function caseSheetIdentity(clientId: string | number | null | undefined): CaseSheetIdentity {
  const { legacyLeadId, newLeadId } = leadSubEffortIdentityFromClientId(
    clientId == null ? null : String(clientId),
  );
  return { newLeadId, legacyLeadId };
}

export function hasCaseSheetIdentity(identity: CaseSheetIdentity): boolean {
  return Boolean(identity.newLeadId || identity.legacyLeadId);
}

/** Initials for a presence avatar; two letters at most, so the circle stays legible. */
export function viewerInitials(name: string | null | undefined): string {
  const parts = String(name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * A stable colour per viewer, derived from their name.
 *
 * Deriving rather than assigning on arrival means a handler keeps the same colour across reloads and
 * looks the same to everyone, so "the blue cursor is Tamar" stays true.
 */
const VIEWER_COLORS = [
  '#2563eb',
  '#16a34a',
  '#db2777',
  '#ea580c',
  '#7c3aed',
  '#0891b2',
  '#ca8a04',
];

export function viewerColor(key: string | null | undefined): string {
  const text = String(key ?? '');
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) % 100000;
  }
  return VIEWER_COLORS[hash % VIEWER_COLORS.length];
}

function toSheetRecord(row: any): CaseSheetRecord {
  return {
    id: String(row?.id ?? ''),
    name: String(row?.name ?? 'Case Handling'),
    tabPosition: Number(row?.tab_position ?? 0),
    columns: Array.isArray(row?.columns) ? row.columns.map((c: unknown) => String(c ?? '')) : [],
    rowCount: Number(row?.row_count ?? 0),
    sourceFilename: row?.source_filename ?? null,
    rtl: row?.rtl === true,
    rowColors: row?.row_colors && typeof row.row_colors === 'object' ? row.row_colors : {},
    columnColors:
      row?.column_colors && typeof row.column_colors === 'object' ? row.column_colors : {},
    rowHeights: row?.row_heights && typeof row.row_heights === 'object' ? row.row_heights : {},
    columnWidths:
      row?.column_widths && typeof row.column_widths === 'object' ? row.column_widths : {},
    updatedAt: row?.updated_at ?? null,
    updatedBy: row?.updated_by ?? null,
  };
}

/**
 * Resolves the stored editor identity into something worth showing.
 *
 * Cells record an email, because presence and the echo check both need an exact key and two
 * colleagues can share a first name. A byline wants a person, so the email is traded for a name and
 * a photo here rather than storing a display name that would go stale when someone is renamed.
 */
export async function fetchCaseSheetEditor(
  supabase: SupabaseClient,
  email: string | null | undefined,
): Promise<CaseSheetEditor | null> {
  const address = String(email ?? '').trim();
  if (!address) return null;

  const { data, error } = await supabase
    .from('users')
    .select('first_name, last_name, full_name, email, tenants_employee!employee_id (display_name, photo_url, photo)')
    .ilike('email', address)
    .limit(1);

  if (error) {
    // A missing byline is not worth failing the sheet over; the email is shown instead.
    console.warn('[CaseHandling] could not resolve the last editor', error);
    return { email: address, name: address, initials: viewerInitials(address), photoUrl: null };
  }

  const row: any = data?.[0];
  if (!row) return { email: address, name: address, initials: viewerInitials(address), photoUrl: null };

  const employee = Array.isArray(row.tenants_employee) ? row.tenants_employee[0] : row.tenants_employee;

  const name =
    (row.first_name?.trim() && row.last_name?.trim()
      ? `${row.first_name.trim()} ${row.last_name.trim()}`
      : '') ||
    row.full_name?.trim() ||
    employee?.display_name?.trim() ||
    address;

  const photoUrl =
    (typeof employee?.photo_url === 'string' && employee.photo_url.trim()) ||
    (typeof employee?.photo === 'string' && employee.photo.trim()) ||
    null;

  return { email: address, name, initials: viewerInitials(name), photoUrl };
}

/**
 * Builds the rows a save sends.
 *
 * A cleared cell is stored as an empty string rather than deleted: one upsert handles edits and
 * clears together, where deleting would need a separate request per cell because the key is
 * composite. `gridFromStoredCells` already treats an empty value as a blank cell.
 */
export type CaseSheetCellRow = {
  sheet_id: string;
  row_index: number;
  col_index: number;
  value: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  highlight: string | null;
  text_color: string | null;
  font_size: number | null;
  align: string | null;
  border_top: boolean;
  border_right: boolean;
  border_bottom: boolean;
  border_left: boolean;
  updated_by: string | null;
  updated_at: string;
};

export function buildCaseSheetCellRows(
  sheetId: string,
  changes: CaseSheetCellChange[],
  actor: string | null,
): CaseSheetCellRow[] {
  const updatedAt = new Date().toISOString();
  return changes.map((change) => ({
    sheet_id: sheetId,
    row_index: change.rowIndex,
    col_index: change.colIndex,
    value: change.value,
    /*
     * The whole row goes every time, including the half that did not change. An upsert replaces the
     * row, so omitting the formatting would reset a bold cell to plain on the next text edit.
     */
    bold: change.format?.bold === true,
    italic: change.format?.italic === true,
    underline: change.format?.underline === true,
    highlight: change.format?.highlight ?? null,
    text_color: change.format?.textColor ?? null,
    font_size: change.format?.fontSize ?? null,
    align: change.format?.align ?? null,
    border_top: change.format?.borderTop === true,
    border_right: change.format?.borderRight === true,
    border_bottom: change.format?.borderBottom === true,
    border_left: change.format?.borderLeft === true,
    updated_by: actor,
    updated_at: updatedAt,
  }));
}

/**
 * When the sheet was last touched, for the byline beside who touched it.
 *
 * Shows a clock time rather than "2 minutes ago" because the byline is not re-rendered on a timer —
 * a relative label would quietly go stale and claim the sheet was edited more recently than it was.
 * The date appears only once it is no longer today, so the common case stays short.
 */
export function formatCaseSheetEditedAt(iso: string | null | undefined, now?: Date): string {
  if (!iso) return '';

  const edited = new Date(iso);
  if (Number.isNaN(edited.getTime())) return '';

  const today = now ?? new Date();
  const time = edited.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (sameDay(edited, today)) return time;

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameDay(edited, yesterday)) return `yesterday at ${time}`;

  const date = edited.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    // A year only earns its space once the edit is not from this one.
    year: edited.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  });
  return `${date} at ${time}`;
}

/**
 * Where a shared snapshot of a sheet is stored.
 *
 * The filename is rebuilt from scratch rather than cleaned up, because it ends up in a storage path:
 * a stray slash would silently move the object into another folder, and a leading dot or an empty
 * name would produce a path the bucket rejects.
 */
export function caseSheetSharePath(sheetId: string, filename: string): string {
  const safeId = String(sheetId ?? '').replace(/[^a-zA-Z0-9-]/g, '') || 'sheet';
  const raw = String(filename ?? '');

  /*
   * The extension is held back and reattached rather than sanitised along with the rest. Cleaning
   * the whole name at once loses it on a name with no ASCII in it — every character becomes a
   * separator, and stripping the leading separators takes the dot with them. The recipient then
   * downloads a file Excel will not open.
   */
  const dot = raw.lastIndexOf('.');
  const extension = dot > 0 ? raw.slice(dot + 1).replace(/[^a-zA-Z0-9]/g, '') : '';
  const stem = (dot > 0 ? raw.slice(0, dot) : raw)
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/^[._-]+/, '')
    .replace(/_{2,}/g, '_')
    .slice(0, 100);

  return `case-sheets/${safeId}/${Date.now()}-${stem || 'case-sheet'}.${extension || 'xlsx'}`;
}

/**
 * A tab's name, as it can be stored.
 *
 * Excel caps a sheet name at 31 characters; this is looser, but still capped — the name is drawn in
 * a tab, and a paragraph pasted into the rename box would push every other tab off the strip.
 */
export const CASE_SHEET_NAME_MAX = 60;

export function normalizeCaseSheetName(value: unknown, fallback = 'Sheet 1'): string {
  const name = String(value ?? '')
    // One line, one space between words: a tab is a single line of text.
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, CASE_SHEET_NAME_MAX);
  return name || fallback;
}

/**
 * The name a new tab gets: the first "Sheet n" the case is not already using.
 *
 * Counting the tabs instead would reuse a name as soon as one is deleted, leaving two tabs called
 * the same thing — which is the one way a handler cannot tell them apart.
 */
export function nextCaseSheetName(existing: Iterable<string>): string {
  const taken = new Set<string>();
  for (const name of existing) taken.add(normalizeCaseSheetName(name).toLowerCase());

  for (let n = 1; ; n += 1) {
    const candidate = `Sheet ${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/**
 * Every sheet the case has, in tab order.
 *
 * Records only — the cells of one sheet are fetched separately, when its tab is opened, so a case
 * with a dozen tabs does not pay for all of them to show the first.
 */
export async function fetchCaseSheets(
  supabase: SupabaseClient,
  identity: CaseSheetIdentity,
): Promise<CaseSheetRecord[]> {
  if (!hasCaseSheetIdentity(identity)) return [];

  let query = supabase.from('case_sheets').select(SHEET_COLUMNS);
  query = identity.newLeadId
    ? query.eq('new_lead_id', identity.newLeadId)
    : query.eq('legacy_lead_id', identity.legacyLeadId as number);

  const { data, error } = await query
    .order('tab_position', { ascending: true })
    // Ties go to whoever created theirs first, so the order is the same for everyone.
    .order('created_at', { ascending: true });
  if (error) throw error;

  return (data ?? []).map(toSheetRecord);
}

/**
 * Every tab of a case as text, for the AI.
 *
 * A separate read from the editor's, and a much lighter one: only the cells that have something in
 * them, only their text, and capped — the editor needs every cell and all its formatting, while a
 * prompt needs what the sheet says. One query across all the tabs rather than one per tab, because
 * this runs while someone waits for an answer.
 *
 * Returns an empty string when the case has no sheets, or when the tables are not there yet, so a
 * lead whose database is behind the code still gets its case file.
 */
export async function fetchCaseSheetsTextForAi(
  supabase: SupabaseClient,
  identity: CaseSheetIdentity,
): Promise<string> {
  if (!hasCaseSheetIdentity(identity)) return '';

  try {
    const sheets = await fetchCaseSheets(supabase, identity);
    if (sheets.length === 0) return '';

    const { data, error } = await supabase
      .from('case_sheet_cells')
      .select('sheet_id, row_index, col_index, value')
      .in(
        'sheet_id',
        sheets.map((sheet) => sheet.id),
      )
      // Formatting-only cells are stored with no text, and have nothing to say in a prompt.
      .neq('value', '')
      .order('sheet_id', { ascending: true })
      .order('row_index', { ascending: true })
      .order('col_index', { ascending: true })
      .limit(AI_CELL_LIMIT);

    if (error) throw error;

    const bySheet = new Map<string, CaseSheetAiCell[]>();
    for (const row of data ?? []) {
      const key = String((row as any).sheet_id ?? '');
      const cells = bySheet.get(key) ?? [];
      cells.push({
        rowIndex: Number((row as any).row_index),
        colIndex: Number((row as any).col_index),
        value: String((row as any).value ?? ''),
      });
      bySheet.set(key, cells);
    }

    return renderCaseSheetsForAi(
      sheets.map((sheet) => ({
        name: sheet.name,
        rtl: sheet.rtl,
        columns: sheet.columns,
        updatedAt: sheet.updatedAt,
        cells: bySheet.get(sheet.id) ?? [],
      })),
    );
  } catch (error) {
    // Worth a line in the console, not worth failing a summary or an email over.
    console.warn('[CaseHandling] could not read the sheets for the AI case file', error);
    return '';
  }
}

/**
 * Every cell for a sheet, paged.
 *
 * Supabase caps a response at 1000 rows by default, and a modest 40-column sheet passes that inside
 * 25 rows — without paging a handler would silently lose the bottom of their own spreadsheet.
 */
const CELL_PAGE_SIZE = 1000;

/**
 * The most cells the AI reading will pull across all of a case's tabs.
 *
 * Unpaged on purpose: past this much spreadsheet the renderer is going to drop rows to stay inside
 * its prompt budget anyway, so fetching more would only cost the handler time while they wait.
 */
const AI_CELL_LIMIT = 6000;

export async function fetchCaseSheetGrid(
  supabase: SupabaseClient,
  sheet: CaseSheetRecord,
): Promise<CaseSheetGrid> {
  const rows: CaseSheetStoredCell[] = [];

  for (let page = 0; ; page += 1) {
    const from = page * CELL_PAGE_SIZE;
    const { data, error } = await supabase
      .from('case_sheet_cells')
      .select(
        'row_index, col_index, value, bold, italic, underline, highlight, text_color, font_size, align, border_top, border_right, border_bottom, border_left',
      )
      .eq('sheet_id', sheet.id)
      .order('row_index', { ascending: true })
      .order('col_index', { ascending: true })
      .range(from, from + CELL_PAGE_SIZE - 1);

    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < CELL_PAGE_SIZE) break;
  }

  return gridFromStoredCells(sheet.columns, sheet.rowCount, rows, {
    rtl: sheet.rtl,
    rowColors: sheet.rowColors,
    columnColors: sheet.columnColors,
    rowHeights: sheet.rowHeights,
    columnWidths: sheet.columnWidths,
  });
}

export async function createCaseSheet(
  supabase: SupabaseClient,
  params: {
    identity: CaseSheetIdentity;
    grid: CaseSheetGrid;
    name?: string;
    tabPosition?: number;
    sourceFilename?: string | null;
    actor?: string | null;
  },
): Promise<CaseSheetWithGrid> {
  if (!hasCaseSheetIdentity(params.identity)) {
    throw new Error('Cannot create a case sheet without a lead');
  }

  const actor = params.actor ?? null;
  const { data, error } = await supabase
    .from('case_sheets')
    .insert({
      new_lead_id: params.identity.newLeadId,
      legacy_lead_id: params.identity.legacyLeadId,
      name: normalizeCaseSheetName(params.name),
      tab_position: params.tabPosition ?? 0,
      columns: params.grid.columns,
      row_count: params.grid.rowCount,
      source_filename: params.sourceFilename ?? null,
      rtl: params.grid.rtl,
      row_colors: bandMapToRecord(params.grid.rowColors),
      row_heights: sizeMapToRecord(params.grid.rowHeights),
      column_widths: sizeMapToRecord(params.grid.columnWidths),
      column_colors: bandMapToRecord(params.grid.columnColors),
      created_by: actor,
      updated_by: actor,
    })
    .select(SHEET_COLUMNS)
    .single();

  if (error) throw error;
  const sheet = toSheetRecord(data);

  // An imported workbook arrives with its cells already filled in, so they go down with the sheet.
  const addresses = new Set([...params.grid.cells.keys(), ...params.grid.formats.keys()]);
  const changes: CaseSheetCellChange[] = [...addresses].map((key) => {
    const [row, col] = key.split(':');
    return {
      rowIndex: Number(row),
      colIndex: Number(col),
      value: params.grid.cells.get(key) ?? '',
      format: params.grid.formats.get(key) ?? null,
    };
  });

  if (changes.length > 0) {
    await saveCaseSheetCells(supabase, sheet.id, changes, actor);
  }

  return { sheet, grid: params.grid };
}

/**
 * Writes changed cells.
 *
 * Chunked because an imported workbook can be thousands of cells, and a single request that large
 * is the one most likely to hit a statement timeout.
 */
const CELL_WRITE_CHUNK = 500;

export async function saveCaseSheetCells(
  supabase: SupabaseClient,
  sheetId: string,
  changes: CaseSheetCellChange[],
  actor: string | null,
): Promise<void> {
  const rows = buildCaseSheetCellRows(sheetId, changes, actor);

  for (let i = 0; i < rows.length; i += CELL_WRITE_CHUNK) {
    const { error } = await supabase
      .from('case_sheet_cells')
      .upsert(rows.slice(i, i + CELL_WRITE_CHUNK), {
        onConflict: 'sheet_id,row_index,col_index',
      });
    if (error) throw error;
  }
}

/**
 * Saves the sheet's headers and height.
 *
 * Separate from the cells because this is the one part of the sheet that is genuinely a shared
 * document: renaming a column is a whole-sheet change, not a per-cell one.
 */
export async function saveCaseSheetShape(
  supabase: SupabaseClient,
  sheetId: string,
  grid: CaseSheetGrid,
  actor: string | null,
): Promise<void> {
  const { rows } = usedBounds(grid);
  const { error } = await supabase
    .from('case_sheets')
    .update({
      columns: grid.columns,
      // Never record fewer rows than there are cells, or reloading would hide them.
      row_count: Math.max(grid.rowCount, rows),
      rtl: grid.rtl,
      /*
       * The whole map goes each time, so two handlers painting different rows inside the same save
       * window will leave only the later one's colour. A row colour is cosmetic and trivially
       * reapplied, which is why it is not worth a row per band to avoid.
       */
      row_colors: bandMapToRecord(grid.rowColors),
      column_colors: bandMapToRecord(grid.columnColors),
      /* Same wholesale replacement as the colours, and cosmetic in the same way. */
      row_heights: sizeMapToRecord(grid.rowHeights),
      column_widths: sizeMapToRecord(grid.columnWidths),
      updated_by: actor,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sheetId);

  if (error) throw error;
}

export async function renameCaseSheet(
  supabase: SupabaseClient,
  sheetId: string,
  name: string,
  actor: string | null,
): Promise<void> {
  const { error } = await supabase
    .from('case_sheets')
    .update({ name: normalizeCaseSheetName(name), updated_by: actor })
    .eq('id', sheetId);
  if (error) throw error;
}

export async function deleteCaseSheet(supabase: SupabaseClient, sheetId: string): Promise<void> {
  // Cells go with it through ON DELETE CASCADE.
  const { error } = await supabase.from('case_sheets').delete().eq('id', sheetId);
  if (error) throw error;
}

/**
 * Decides whether an inbound Realtime cell should be applied.
 *
 * Postgres publishes a change to everyone, including whoever made it, so without this a handler's
 * own save would echo back and overwrite whatever they typed in the intervening moment.
 */
export function isForeignCellChange(payloadUpdatedBy: unknown, selfKey: string | null): boolean {
  if (!selfKey) return true;
  return String(payloadUpdatedBy ?? '') !== selfKey;
}

export type CaseSheetSubscription = {
  channel: RealtimeChannel;
  /** Tells the others which cell is selected, so they see where a colleague is working. */
  setActiveCell: (cell: { rowIndex: number; colIndex: number } | null) => void;
  unsubscribe: () => void;
};

/**
 * Subscribes to a sheet: cell changes from Postgres, and who else is in it from Realtime presence.
 *
 * Supabase Realtime is used rather than the socket.io server in `backend/` because presence is built
 * into it and `postgres_changes` already carries the changed row — the socket route would need a new
 * endpoint and its own copy of the cell payload to say the same thing.
 */
export function subscribeToCaseSheet(
  supabase: SupabaseClient,
  params: {
    sheetId: string;
    selfKey: string;
    selfName: string;
    onCell: (change: CaseSheetCellChange & { updatedBy: string | null }) => void;
    onViewers: (viewers: CaseSheetViewer[]) => void;
    onShape?: (sheet: CaseSheetRecord) => void;
  },
): CaseSheetSubscription {
  const channel = supabase.channel(`case-sheet:${params.sheetId}`, {
    config: { presence: { key: params.selfKey } },
  });

  let activeCell: { rowIndex: number; colIndex: number } | null = null;

  channel.on(
    'postgres_changes',
    {
      event: '*',
      schema: 'public',
      table: 'case_sheet_cells',
      filter: `sheet_id=eq.${params.sheetId}`,
    },
    (payload: any) => {
      const row = payload.eventType === 'DELETE' ? payload.old : payload.new;
      if (!row) return;

      const rowIndex = Number(row.row_index);
      const colIndex = Number(row.col_index);
      if (!Number.isInteger(rowIndex) || !Number.isInteger(colIndex)) return;

      const gone = payload.eventType === 'DELETE';
      params.onCell({
        rowIndex,
        colIndex,
        // A delete means the cell is gone, which on screen is the same as blank and unformatted.
        value: gone ? '' : String(row.value ?? ''),
        format: gone ? null : formatFromStoredCell(row),
        updatedBy: row.updated_by ?? null,
      });
    },
  );

  if (params.onShape) {
    channel.on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'case_sheets',
        filter: `id=eq.${params.sheetId}`,
      },
      (payload: any) => {
        if (payload.new) params.onShape?.(toSheetRecord(payload.new));
      },
    );
  }

  const publishViewers = () => {
    const state = channel.presenceState() as Record<string, any[]>;
    const viewers: CaseSheetViewer[] = Object.entries(state).map(([key, entries]) => {
      const latest = entries?.[entries.length - 1] ?? {};
      const name = String(latest.name ?? 'Someone');
      return {
        key,
        name,
        initials: viewerInitials(name),
        activeCell:
          Number.isInteger(latest.activeRow) && Number.isInteger(latest.activeCol)
            ? { rowIndex: latest.activeRow, colIndex: latest.activeCol }
            : null,
      };
    });
    params.onViewers(viewers);
  };

  channel.on('presence', { event: 'sync' }, publishViewers);
  channel.on('presence', { event: 'join' }, publishViewers);
  channel.on('presence', { event: 'leave' }, publishViewers);

  const track = () =>
    channel.track({
      name: params.selfName,
      activeRow: activeCell?.rowIndex ?? null,
      activeCol: activeCell?.colIndex ?? null,
      at: Date.now(),
    });

  channel.subscribe((status) => {
    // Tracking before the channel is joined is dropped, and after a reconnect it has to be redone.
    if (status === 'SUBSCRIBED') void track();
  });

  return {
    channel,
    setActiveCell: (cell) => {
      activeCell = cell;
      void track();
    },
    unsubscribe: () => {
      void supabase.removeChannel(channel);
    },
  };
}
