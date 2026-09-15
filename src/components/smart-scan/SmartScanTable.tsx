import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ClockIcon, EllipsisVerticalIcon, InboxArrowDownIcon, Squares2X2Icon } from '@heroicons/react/24/outline';
import type { SmartScanItem, SmartScanLeadRef, SmartScanQueue } from '../../lib/smartScan/smartScanTypes';
import { SMART_SCAN_ISSUE_LABELS, scanQueueBucket } from '../../lib/smartScan/smartScanTypes';
import {
  formatScanDateTime,
  formatScanTime,
  groupSmartScanItems,
  scanArrivalKey,
  scanDocumentTypeLabel,
  scanGroupConfidence,
  scanGroupDocumentLabel,
  scanGroupLead,
  scanGroupPageCount,
  scanGroupQueueBucket,
} from '../../lib/smartScan/smartScanFormat';
import { SmartScanStatusBadge } from './SmartScanStatusBadge';
import { SmartScanConfidenceBadge } from './SmartScanConfidenceBadge';
import { SmartScanLeadSelector } from './SmartScanLeadSelector';

type Props = {
  items: SmartScanItem[];
  loading: boolean;
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onRowClick: (item: SmartScanItem, group?: SmartScanItem[]) => void;
  onPreview: (item: SmartScanItem, group?: SmartScanItem[]) => void;
  onAssignLead: (items: SmartScanItem[], lead: SmartScanLeadRef) => void | Promise<void>;
  onRemove: (items: SmartScanItem[]) => void;
  sort?: 'newest' | 'oldest';
};

const MENU_WIDTH = 176;
const ASSIGN_MENU_WIDTH = 300;

function groupCaption(items: SmartScanItem[]) {
  const count = items.length;
  return `${count} document${count === 1 ? '' : 's'}`;
}

const GROUP_ICON_COLORS = [
  'text-sky-600',
  'text-emerald-600',
  'text-violet-600',
  'text-amber-600',
  'text-rose-600',
  'text-teal-600',
  'text-orange-600',
  'text-indigo-600',
  'text-fuchsia-600',
  'text-cyan-600',
] as const;

function groupIconColor(key: string) {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return GROUP_ICON_COLORS[Math.abs(hash) % GROUP_ICON_COLORS.length];
}

function uniqueLeadMatches(rows: SmartScanItem[]): SmartScanLeadRef[] {
  const seen = new Set<string>();
  const matches: SmartScanLeadRef[] = [];
  for (const row of rows) {
    for (const lead of row.possibleLeadMatches || []) {
      const key = `${lead.id || ''}:${lead.leadNumber}`;
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push(lead);
    }
  }
  return matches;
}

function assignTargetsForItem(item: SmartScanItem, items: SmartScanItem[], selectedIds: Set<string>): SmartScanItem[] {
  if (!selectedIds.has(item.id)) return [item];
  const key = scanArrivalKey(item);
  const selectedInGroup = items.filter((row) => selectedIds.has(row.id) && scanArrivalKey(row) === key);
  return selectedInGroup.length > 1 ? selectedInGroup : [item];
}

function groupIssueLabel(items: SmartScanItem[]): string {
  const issues = [...new Set(items.map((item) => item.issue).filter(Boolean))];
  if (issues.length === 1) return SMART_SCAN_ISSUE_LABELS[issues[0]!].replace(/\.$/, '');
  if (issues.length > 1) return 'Multiple';
  return '—';
}

function ScanDocumentCell({
  label,
  item,
  showPart,
}: {
  label: string;
  item?: SmartScanItem;
  showPart?: boolean;
}) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 text-base font-medium text-gray-800">
      <span>{label}</span>
      {showPart && item?.splitCount && item.splitIndex ? (
        <span className="text-sm font-medium text-sky-700">
          Part {item.splitIndex}/{item.splitCount}
          {item.pageStart && item.pageEnd ? ` · p.${item.pageStart}–${item.pageEnd}` : ''}
        </span>
      ) : null}
    </p>
  );
}

function ScanLeadCell({
  name,
  leadNumber,
  status,
}: {
  name: string;
  leadNumber: string;
  status: SmartScanQueue;
}) {
  return (
    <div className="min-w-[10rem]">
      <p className="text-base font-medium text-gray-900">{name}</p>
      <p className="text-sm text-gray-500">{leadNumber}</p>
      {status === 'matched' ? <p className="text-xs font-medium text-emerald-700">AI suggested — approve</p> : null}
    </div>
  );
}

export function SmartScanTable({
  items,
  loading,
  selectedIds,
  onToggle,
  onToggleAll,
  onRowClick,
  onPreview,
  onAssignLead,
  onRemove,
  sort = 'newest',
}: Props) {
  const allSelected = items.length > 0 && items.every((item) => selectedIds.has(item.id));
  const [openId, setOpenId] = useState<string | null>(null);
  const [assignPanel, setAssignPanel] = useState(false);
  const [menuItem, setMenuItem] = useState<SmartScanItem | null>(null);
  const [assignItems, setAssignItems] = useState<SmartScanItem[]>([]);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [separatedKeys, setSeparatedKeys] = useState<Set<string>>(() => new Set());
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const closeMenu = () => {
    setOpenId(null);
    setAssignPanel(false);
    setMenuItem(null);
    setAssignItems([]);
  };

  const toggleSeparated = (key: string) => {
    setSeparatedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    closeMenu();
  };

  useEffect(() => {
    if (!openId) {
      setMenuPos(null);
      return;
    }

    const updatePos = () => {
      const el = triggerRef.current;
      if (!el) return;
      const width = assignPanel ? ASSIGN_MENU_WIDTH : MENU_WIDTH;
      const rect = el.getBoundingClientRect();
      const menuHeight = menuRef.current?.offsetHeight || (assignPanel ? 220 : 132);
      const left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8);
      const openAbove = rect.bottom + 8 + menuHeight > window.innerHeight && rect.top > menuHeight + 8;
      setMenuPos({
        top: openAbove ? rect.top - menuHeight - 4 : rect.bottom + 4,
        left,
      });
    };

    updatePos();
    const frame = window.requestAnimationFrame(updatePos);
    window.addEventListener('scroll', updatePos, true);
    window.addEventListener('resize', updatePos);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', updatePos, true);
      window.removeEventListener('resize', updatePos);
    };
  }, [openId, assignPanel]);

  useEffect(() => {
    if (!openId) return;
    const onDocClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest('.modal')) return;
      closeMenu();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [openId]);

  const run = (fn: () => void) => {
    closeMenu();
    fn();
  };

  const groups = groupSmartScanItems(items, sort);

  const toggleGroup = (groupItems: SmartScanItem[]) => {
    const ids = groupItems.map((item) => item.id);
    const allOn = ids.every((id) => selectedIds.has(id));
    ids.forEach((id) => {
      if (allOn) onToggle(id);
      else if (!selectedIds.has(id)) onToggle(id);
    });
  };

  const openActions = (menuId: string, item: SmartScanItem, targets?: SmartScanItem[]) => {
    if (openId === menuId) {
      closeMenu();
      return;
    }
    setOpenId(menuId);
    setAssignPanel(false);
    setMenuItem(item);
    setAssignItems(targets || []);
  };

  return (
    <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-gray-100">
      <table className="table w-full text-base">
        <thead>
          <tr className="text-xs uppercase tracking-wider text-gray-500">
            <th className="w-10">
              <input
                type="checkbox"
                className="checkbox checkbox-sm"
                checked={allSelected}
                onChange={onToggleAll}
                aria-label="Select all"
              />
            </th>
            <th>Status</th>
            <th>Client / Lead</th>
            <th>Document</th>
            <th>Pages</th>
            <th>Confidence</th>
            {/* <th>Scanner</th> */}
            {/* <th>Scanned</th> */}
            <th>Issue</th>
            <th className="w-12 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: 6 }).map((_, index) => (
                <tr key={`sk-${index}`}>
                  <td colSpan={8}>
                    <div className="h-9 animate-pulse rounded-lg bg-gray-100" />
                  </td>
                </tr>
              ))
            : groups.flatMap((group) => {
                const grouped = group.items.length > 1;
                const separated = grouped && separatedKeys.has(group.key);
                const collapsed = grouped && !separated;
                const iconColor = groupIconColor(group.key);
                const groupSelected = group.items.every((item) => selectedIds.has(item.id));
                const groupPartial = !groupSelected && group.items.some((item) => selectedIds.has(item.id));
                const combinedLead = scanGroupLead(group.items);
                const combinedStatus = scanGroupQueueBucket(group.items);
                const combinedMenuId = `scan:${group.key}`;
                const displayRows = collapsed ? [group.items[0]] : group.items;

                return [
                  <tr key={`g-${group.key}`} className="bg-[#f3f4f6] hover:bg-[#f3f4f6]">
                    <td onClick={(event) => event.stopPropagation()}>
                      {grouped ? (
                        <input
                          type="checkbox"
                          className="checkbox checkbox-sm"
                          checked={groupSelected}
                          ref={(el) => {
                            if (el) el.indeterminate = groupPartial;
                          }}
                          onChange={() => toggleGroup(group.items)}
                          aria-label={`Select documents scanned at ${formatScanDateTime(group.createdAt)}`}
                        />
                      ) : null}
                    </td>
                    <td colSpan={7} className="py-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-3 pr-1">
                        <div className="flex items-center gap-3">
                          <InboxArrowDownIcon className={`h-7 w-7 shrink-0 ${iconColor}`} />
                          <p className="text-sm text-gray-500">{groupCaption(group.items)}</p>
                          {grouped ? (
                            <button
                              type="button"
                              className={`btn btn-ghost btn-sm btn-square rounded-lg ${
                                separated ? 'bg-white text-sky-700' : 'text-gray-500 hover:bg-white hover:text-gray-800'
                              }`}
                              title={separated ? 'Show as one scan' : 'Separate into documents'}
                              aria-label={separated ? 'Show as one scan' : 'Separate into documents'}
                              aria-pressed={separated}
                              onClick={() => toggleSeparated(group.key)}
                            >
                              <Squares2X2Icon className="h-6 w-6" />
                            </button>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-2 text-gray-600">
                          <ClockIcon className="h-7 w-7" />
                          <div className="leading-tight">
                            <p className="text-xs font-medium text-gray-500">
                              {formatScanDateTime(group.createdAt).replace(formatScanTime(group.createdAt), '').trim() || '—'}
                            </p>
                            <p className="text-base font-bold tabular-nums text-gray-800">
                              {formatScanTime(group.createdAt)}
                            </p>
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>,
                  ...displayRows.map((item) => {
                    const rowItem = collapsed ? group.items[0] : item;
                    const menuId = collapsed ? combinedMenuId : rowItem.id;
                    const status = collapsed ? combinedStatus : scanQueueBucket(rowItem);
                    const lead = collapsed
                      ? combinedLead
                      : {
                          name: rowItem.lead?.name || rowItem.detectedPersonName || 'Unknown',
                          leadNumber: rowItem.lead?.leadNumber || 'No lead',
                        };
                    const docLabel = collapsed ? scanGroupDocumentLabel(group.items) : scanDocumentTypeLabel(rowItem);
                    const pages = collapsed ? scanGroupPageCount(group.items) : rowItem.pageCount;
                    const confidence = collapsed ? scanGroupConfidence(group.items) : rowItem.confidence;
                    const issue = collapsed
                      ? groupIssueLabel(group.items)
                      : rowItem.issue
                        ? SMART_SCAN_ISSUE_LABELS[rowItem.issue].replace(/\.$/, '')
                        : '—';
                    const suggestions = collapsed
                      ? uniqueLeadMatches(group.items).length > 0
                      : (rowItem.possibleLeadMatches?.length ?? 0) > 0;

                    return (
                      <tr
                        key={collapsed ? combinedMenuId : rowItem.id}
                        className="cursor-pointer hover:bg-gray-50"
                        onClick={() => onRowClick(rowItem, collapsed ? group.items : undefined)}
                      >
                        <td onClick={(event) => event.stopPropagation()}>
                          <input
                            type="checkbox"
                            className="checkbox checkbox-sm"
                            checked={collapsed ? groupSelected : selectedIds.has(rowItem.id)}
                            onChange={() => (collapsed ? toggleGroup(group.items) : onToggle(rowItem.id))}
                            aria-label={`Select ${docLabel}`}
                          />
                        </td>
                        <td className="pt-2.5">
                          <SmartScanStatusBadge status={status} hasSuggestions={suggestions} />
                        </td>
                        <td>
                          <ScanLeadCell name={lead.name} leadNumber={lead.leadNumber} status={status} />
                        </td>
                        <td>
                          <ScanDocumentCell label={docLabel} item={rowItem} showPart={!collapsed} />
                        </td>
                        <td className="text-base tabular-nums text-gray-700">{pages}</td>
                        <td>
                          <SmartScanConfidenceBadge value={confidence} />
                        </td>
                        <td className="max-w-[14rem] text-sm text-gray-500">{issue}</td>
                        <td className="text-right" onClick={(event) => event.stopPropagation()}>
                          <button
                            ref={openId === menuId ? triggerRef : undefined}
                            type="button"
                            className="btn btn-ghost btn-sm btn-square rounded-lg text-gray-500"
                            aria-label={`Actions for ${docLabel}`}
                            aria-expanded={openId === menuId}
                            aria-haspopup="menu"
                            onClick={() => openActions(menuId, rowItem, collapsed ? group.items : undefined)}
                          >
                            <EllipsisVerticalIcon className="h-6 w-6" />
                          </button>
                        </td>
                      </tr>
                    );
                  }),
                ];
              })}
        </tbody>
      </table>

      {menuItem && menuPos
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              className="fixed z-[220] rounded-xl border border-gray-200 bg-white py-1 shadow-xl"
              style={{
                top: menuPos.top,
                left: menuPos.left,
                width: assignPanel ? ASSIGN_MENU_WIDTH : MENU_WIDTH,
              }}
              onClick={(event) => event.stopPropagation()}
            >
              {assignPanel ? (
                <SmartScanLeadSelector
                  variant="menu"
                  autoFocus
                  assignCount={Math.max(1, assignItems.length)}
                  assignedLead={menuItem.lead}
                  possibleMatches={uniqueLeadMatches(assignItems.length ? assignItems : [menuItem])}
                  onChoose={async (lead) => {
                    await onAssignLead(assignItems.length ? assignItems : [menuItem], lead);
                    closeMenu();
                  }}
                />
              ) : (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    className="block w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-gray-50"
                    onClick={() => {
                      const targets =
                        assignItems.length > 1 ? assignItems : assignTargetsForItem(menuItem, items, selectedIds);
                      setAssignItems(targets);
                      setAssignPanel(true);
                    }}
                  >
                    {(() => {
                      const count =
                        assignItems.length > 1
                          ? assignItems.length
                          : assignTargetsForItem(menuItem, items, selectedIds).length;
                      return count > 1 ? `Assign ${count} documents` : 'Assign Lead';
                    })()}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="block w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-gray-50"
                    onClick={() => run(() => onPreview(menuItem, assignItems.length > 1 ? assignItems : undefined))}
                  >
                    Preview
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="block w-full px-3 py-2 text-left text-sm text-rose-600 hover:bg-rose-50"
                    onClick={() => run(() => onRemove(assignItems.length ? assignItems : [menuItem]))}
                  >
                    Delete
                  </button>
                </>
              )}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
