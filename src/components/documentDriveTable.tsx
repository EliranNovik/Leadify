import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { EllipsisVerticalIcon } from '@heroicons/react/24/outline';
import { EyeSlashIcon as EyeSlashSolidIcon } from '@heroicons/react/24/solid';

/**
 * Pinned to the corner of the icon, as the drive marks it. Viewable is what everything is until
 * someone says otherwise, so hidden is what gets marked and a viewable file carries no badge.
 */
export const HiddenFromClientMark: React.FC = () => (
  <span
    className="pointer-events-none absolute -right-1.5 -top-1.5 flex h-[17px] w-[17px] items-center justify-center rounded-full bg-rose-500 shadow-sm ring-2 ring-white"
    title="Hidden from the client portal"
  >
    <EyeSlashSolidIcon className="h-2.5 w-2.5 text-white" />
  </span>
);

/**
 * The documents drive's own list, for the screens that show a case's files elsewhere: the
 * sub-effort modal, its category tabs, the attach-from-case picker and the client portal.
 *
 * One table, folders above files, so wherever a file is shown it is shown the same way. Only the
 * look lives here — each screen keeps its own columns, menus and dragging, and passes rows in.
 *
 * `drive-table` is the drive's row divider (src/index.css), which is why the class is shared
 * rather than copied.
 */

export type DriveTableColumn = {
  id: string;
  label: string;
  /** Width and when the column is worth showing, in the drive's idiom: `hidden w-[11rem] lg:table-cell`. */
  className?: string;
  align?: 'left' | 'center' | 'right';
};

export type DriveTablePick = {
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  /** Spoken name of the checkbox, since the row's name is not a label. */
  label: string;
  onChange: () => void;
};

export type DriveTableRow = {
  key: string;
  /** Folder or file glyph, drawn at the head of the name. */
  icon: React.ReactNode;
  /** Usually the name; a node so a row can hold a rename field instead. */
  name: React.ReactNode;
  title?: string;
  /** A second line under the name: what is inside a folder, where a file is filed. */
  below?: React.ReactNode;
  /** By column id. A column a row has nothing for is left empty. */
  cells?: Record<string, React.ReactNode>;
  actions?: React.ReactNode;
  pick?: DriveTablePick;
  selected?: boolean;
  /** The row being dragged, faded where it came from. */
  dragging?: boolean;
  /** A folder a file is being held over. */
  dropActive?: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
  /** Clicking the name itself, which is how a file is opened. */
  onNameClick?: () => void;
  draggable?: boolean;
  dragProps?: React.HTMLAttributes<HTMLTableRowElement>;
};

export type RowMenuItem = {
  id: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  danger?: boolean;
  /** Named above the item when it opens a new part of the menu, as "Move to" does. */
  section?: string;
  /** How deep a folder sits, for a list of folders to move into. */
  depth?: number;
  /** A download, which the browser must do itself rather than through a click handler. */
  href?: string;
  downloadAs?: string;
  onSelect?: () => void;
};

/**
 * The actions of one row, in a menu that hangs off the body rather than the row: these tables live
 * inside modals that scroll, and a menu drawn in place would be cut off at their edge.
 */
export function RowKebabMenu({
  items,
  disabled = false,
  busy = false,
  label = 'Row options',
}: {
  items: RowMenuItem[];
  disabled?: boolean;
  busy?: boolean;
  label?: string;
}) {
  const [position, setPosition] = useState<{ top?: number; bottom?: number; right: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const open = position !== null;

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setPosition(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPosition(null);
    };
    const onMove = () => setPosition(null);
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open]);

  if (items.length === 0) return null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
          open ? 'bg-gray-900 text-white shadow-sm' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'
        }`}
        disabled={disabled || busy}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          if (open) {
            setPosition(null);
            return;
          }
          const rect = event.currentTarget.getBoundingClientRect();
          const gap = 4;
          const estimated = items.length * 44 + 12;
          const spaceBelow = window.innerHeight - rect.bottom - gap - 8;
          const openUp = spaceBelow < estimated && rect.top > spaceBelow;
          setPosition({
            top: openUp ? undefined : rect.bottom + gap,
            bottom: openUp ? window.innerHeight - rect.top + gap : undefined,
            right: Math.max(8, window.innerWidth - rect.right),
          });
        }}
      >
        {busy ? (
          <span className="loading loading-spinner loading-xs" />
        ) : (
          <EllipsisVerticalIcon className="h-5 w-5" />
        )}
      </button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              className="fixed z-[80] w-56 overflow-y-auto overscroll-contain rounded-xl border border-base-200 bg-white py-1 shadow-lg"
              style={{
                top: position?.top,
                bottom: position?.bottom,
                right: position?.right,
                maxHeight: 'min(22rem, calc(100vh - 2rem))',
              }}
            >
              {items.map((item, index) => {
                const itemClass = `flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm ${
                  item.danger ? 'text-red-600 hover:bg-red-50' : 'text-base-content hover:bg-base-200/70'
                }`;
                const style = item.depth ? { paddingLeft: 12 + Math.min(item.depth, 6) * 12 } : undefined;
                const body = (
                  <>
                    {item.icon ? <item.icon className="h-4 w-4 shrink-0 opacity-70" /> : null}
                    <span className="min-w-0 truncate">{item.label}</span>
                  </>
                );
                return (
                  <React.Fragment key={item.id}>
                    {item.section && item.section !== items[index - 1]?.section ? (
                      <>
                        <div className="my-1 border-t border-gray-100" />
                        <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-base-content/45">
                          {item.section}
                        </div>
                      </>
                    ) : null}
                    {item.href ? (
                      <a
                        href={item.href}
                        target="_blank"
                        rel="noreferrer"
                        download={item.downloadAs}
                        role="menuitem"
                        className={itemClass}
                        style={style}
                        onClick={(event) => {
                          event.stopPropagation();
                          setPosition(null);
                        }}
                      >
                        {body}
                      </a>
                    ) : (
                      <button
                        type="button"
                        role="menuitem"
                        className={itemClass}
                        style={style}
                        onClick={(event) => {
                          event.stopPropagation();
                          setPosition(null);
                          item.onSelect?.();
                        }}
                      >
                        {body}
                      </button>
                    )}
                  </React.Fragment>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

const ALIGN_CLASS: Record<NonNullable<DriveTableColumn['align']>, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
};

function DriveTableBodyRow({ row, columns, pickable }: {
  row: DriveTableRow;
  columns: DriveTableColumn[];
  pickable: boolean;
}) {
  const interactive = Boolean(row.onClick || row.onDoubleClick);
  return (
    <tr
      className={`border-base-300 ${interactive ? 'cursor-pointer select-none' : ''} ${
        row.dropActive
          ? 'bg-primary/15 ring-2 ring-inset ring-primary'
          : row.selected
            ? 'bg-primary/10'
            : interactive
              ? 'hover:bg-base-200/40'
              : ''
      } ${row.dragging ? 'opacity-40' : ''}`}
      onClick={row.onClick}
      onDoubleClick={row.onDoubleClick}
      draggable={row.draggable}
      {...(row.dragProps ?? {})}
    >
      {pickable ? (
        <td className="w-12 text-center" onClick={(event) => event.stopPropagation()}>
          {row.pick ? (
            <input
              type="checkbox"
              className="checkbox checkbox-sm"
              checked={row.pick.checked}
              disabled={row.pick.disabled}
              ref={(node) => {
                if (node) node.indeterminate = Boolean(row.pick?.indeterminate && !row.pick.checked);
              }}
              onChange={() => row.pick?.onChange()}
              aria-label={row.pick.label}
            />
          ) : null}
        </td>
      ) : null}
      <td className="max-w-[26rem]">
        <div className="flex min-w-0 items-center gap-3">
          <span className="relative shrink-0">{row.icon}</span>
          <div className="min-w-0 flex-1">
            {row.onNameClick ? (
              <button
                type="button"
                className="block min-w-0 max-w-full truncate text-left font-medium text-base-content hover:underline"
                title={row.title}
                onClick={(event) => {
                  event.stopPropagation();
                  row.onNameClick?.();
                }}
              >
                {row.name}
              </button>
            ) : (
              <div className="min-w-0 truncate font-medium text-base-content" title={row.title}>
                {row.name}
              </div>
            )}
            {row.below ? <div className="min-w-0">{row.below}</div> : null}
          </div>
        </div>
      </td>
      {columns.map((column) => (
        <td
          key={column.id}
          className={`overflow-hidden ${column.className ?? ''} ${ALIGN_CLASS[column.align ?? 'left']}`}
        >
          {row.cells?.[column.id] ?? null}
        </td>
      ))}
      <td onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-end">{row.actions ?? null}</div>
      </td>
    </tr>
  );
}

export function DocumentDriveTable({
  columns,
  folders = [],
  files = [],
  selectAll,
  nameLabel = 'Name',
  minWidthClass = 'min-w-[680px]',
  empty,
  footer,
}: {
  columns: DriveTableColumn[];
  folders?: DriveTableRow[];
  files?: DriveTableRow[];
  /** Offered in the head of the checkbox column, as the drive offers "select all". */
  selectAll?: DriveTablePick | null;
  nameLabel?: string;
  minWidthClass?: string;
  /** Shown in place of rows when there are none. */
  empty?: React.ReactNode;
  /** Under the last row, inside the card: a loading line, a hint. */
  footer?: React.ReactNode;
}) {
  const pickable = Boolean(selectAll) || [...folders, ...files].some((row) => row.pick);
  const columnCount = columns.length + 2 + (pickable ? 1 : 0);
  const hasRows = folders.length > 0 || files.length > 0;

  return (
    <div className="min-w-0 overflow-x-auto rounded-2xl bg-white">
      <div className={minWidthClass}>
        <table className="drive-table table table-fixed [&_td]:py-2 [&_th]:py-2">
          <thead>
            <tr className="bg-white text-base-content/60">
              {pickable ? (
                <th className="w-12 text-center font-medium">
                  {selectAll ? (
                    <input
                      type="checkbox"
                      className="checkbox checkbox-sm"
                      checked={selectAll.checked}
                      disabled={selectAll.disabled}
                      ref={(node) => {
                        if (node) node.indeterminate = Boolean(selectAll.indeterminate && !selectAll.checked);
                      }}
                      onChange={() => selectAll.onChange()}
                      aria-label={selectAll.label}
                    />
                  ) : (
                    <span className="sr-only">Selected</span>
                  )}
                </th>
              ) : null}
              <th className="w-[26rem] font-medium">{nameLabel}</th>
              {columns.map((column) => (
                <th
                  key={column.id}
                  className={`font-medium ${column.className ?? ''} ${ALIGN_CLASS[column.align ?? 'left']}`}
                >
                  {column.label}
                </th>
              ))}
              <th className="w-[5.5rem] text-right font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {folders.map((row) => (
              <DriveTableBodyRow key={row.key} row={row} columns={columns} pickable={pickable} />
            ))}
            {files.map((row) => (
              <DriveTableBodyRow key={row.key} row={row} columns={columns} pickable={pickable} />
            ))}
            {/* Nothing to point at, so the row neither lights up nor rules a line under itself. */}
            {!hasRows && empty ? (
              <tr className="!bg-none !bg-transparent hover:!bg-transparent">
                <td colSpan={columnCount} className="!bg-transparent p-0 hover:!bg-transparent">
                  {empty}
                </td>
              </tr>
            ) : null}
            {footer ? (
              <tr className="!bg-none !bg-transparent hover:!bg-transparent">
                <td colSpan={columnCount} className="!bg-transparent hover:!bg-transparent">
                  {footer}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default DocumentDriveTable;
