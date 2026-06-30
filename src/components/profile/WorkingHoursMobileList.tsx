import React from 'react';
import {
  CalendarDaysIcon,
  PencilSquareIcon,
  PlusIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import {
  formatWorkingHoursDateLabel,
  formatWorkingHoursWeekday,
  sumClockDurations,
} from '../../lib/employeeClockInFormat';
import {
  clockInApprovalLabelClass,
  clockInApprovalRowClass,
  clockInApprovalWatermarkLabel,
  filterCountedClockInRecords,
  formatDayDeclineNotes,
  getDayClockInApprovalStatus,
} from '../../lib/employeeClockInApproval';
import {
  documentNameFromUrl,
  unavailabilityReasonText,
  unavailabilityTypeLabel,
  type EmployeeUnavailabilityDayRow,
} from '../../lib/employeeUnavailabilities';
import type { DailyClockInSummary } from '../../lib/workingHoursExport';
import UnavailabilityTypeBadge from '../UnavailabilityTypeBadge';
import { DocumentFileGlyph } from '../../lib/documentFileGlyphs';

export type WorkingHoursMobileDayRow = {
  dateKey: string;
  date: string;
  clock: DailyClockInSummary | null;
  unavailabilities: EmployeeUnavailabilityDayRow[];
  isMissingPlaceholder?: boolean;
  isHolidayPlaceholder?: boolean;
  holidayNames?: string[];
};

type WeekMeta = {
  weekNum: number;
  isFirstInWeek: boolean;
};

type ClockInRow = {
  id: number;
  notes: string | null;
  decline_note: string | null;
  manually: boolean;
  approved: boolean;
  declined: boolean;
};

type WorkingHoursMobileListProps = {
  rows: WorkingHoursMobileDayRow[];
  weekMeta: Map<string, WeekMeta>;
  loading: boolean;
  hasActiveRowFilters: boolean;
  bulkSelectMode: boolean;
  bulkSelectedDateKeys: Set<string>;
  isMonthSubmitted: boolean;
  loadingActions: boolean;
  deletingRowKey: string | null;
  deletingClockInDay: string | null;
  recordsByDay: Map<string, ClockInRow[]>;
  getWeekAccentColor: (weekNum: number) => string;
  isRowLocked: (dateKey: string) => boolean;
  onToggleBulkSelect: (dateKey: string) => void;
  onPlaceholderAddUnavailability: (dateKey: string) => void;
  onPlaceholderAddClockIn: (dateKey: string) => void;
  onEditNotes: (dateKey: string) => void;
  onEditUnavailability: (row: EmployeeUnavailabilityDayRow) => void;
  onDeleteUnavailability: (row: EmployeeUnavailabilityDayRow) => void;
  onEditClockIn: (dateKey: string) => void;
  onDeleteClockIn: (dateKey: string) => void;
  onViewDocument: (doc: {
    url: string;
    name: string;
    reason: string;
    uploadedAt: string;
  }) => void;
};

function MobileDateLabel({ dateKey, muted = false }: { dateKey: string; muted?: boolean }) {
  return (
    <span className={`text-base ${muted ? 'text-gray-500' : 'text-base-content'}`}>
      <span className="font-semibold text-gray-500">{formatWorkingHoursWeekday(dateKey)}</span>
      <span className="mx-1.5 text-gray-300" aria-hidden>·</span>
      <span className="font-medium">{formatWorkingHoursDateLabel(dateKey)}</span>
    </span>
  );
}

function MobileField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium text-gray-500 mb-1">
        {label}
      </p>
      <div className="text-base text-base-content leading-snug">{children}</div>
    </div>
  );
}

function MobileApprovalBadges({
  hasManual,
  approvalStatus,
}: {
  hasManual: boolean;
  approvalStatus: ReturnType<typeof getDayClockInApprovalStatus>;
}) {
  if (!hasManual) return null;
  const label = clockInApprovalWatermarkLabel(approvalStatus);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span
        className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-100 text-amber-700 border border-amber-200"
        title="Manual entry"
      >
        <PencilSquareIcon className="w-3.5 h-3.5" />
      </span>
      {label && (
        <span className={`text-xs font-medium ${clockInApprovalLabelClass(approvalStatus)}`}>
          {label}
        </span>
      )}
    </div>
  );
}

function MobileDayActions({
  dateKey,
  unavailabilities,
  hasClock,
  readOnly,
  loading,
  deletingRowKey,
  deletingClockInDay,
  onEditUnavailability,
  onDeleteUnavailability,
  onEditClockIn,
  onDeleteClockIn,
}: {
  dateKey: string;
  unavailabilities: EmployeeUnavailabilityDayRow[];
  hasClock: boolean;
  readOnly: boolean;
  loading: boolean;
  deletingRowKey: string | null;
  deletingClockInDay: string | null;
  onEditUnavailability: (row: EmployeeUnavailabilityDayRow) => void;
  onDeleteUnavailability: (row: EmployeeUnavailabilityDayRow) => void;
  onEditClockIn: (dateKey: string) => void;
  onDeleteClockIn: (dateKey: string) => void;
}) {
  if (readOnly || (!hasClock && unavailabilities.length === 0)) return null;

  const isDeletingClock = deletingClockInDay === dateKey;
  const multipleUnavail = unavailabilities.length > 1;

  return (
    <div className="flex flex-wrap gap-1 pt-2 border-t border-base-200/80 -mx-1">
      {unavailabilities.map((unavail) => {
        const rowKey = `${unavail.id}-${unavail.date}`;
        const typeLabel = unavailabilityTypeLabel(unavail.unavailability_type);
        const suffix = multipleUnavail ? ` (${typeLabel})` : '';
        const isDeleting = deletingRowKey === rowKey;
        return (
          <React.Fragment key={rowKey}>
            <button
              type="button"
              className="btn btn-sm btn-ghost gap-1.5 h-9 min-h-9 px-2 text-base-content/80"
              disabled={loading || isDeleting}
              onClick={() => onEditUnavailability(unavail)}
            >
              <PencilSquareIcon className="w-4 h-4" />
              Edit{suffix}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost gap-1.5 h-9 min-h-9 px-2 text-error"
              disabled={loading || isDeleting}
              onClick={() => onDeleteUnavailability(unavail)}
            >
              {isDeleting ? (
                <span className="loading loading-spinner loading-xs" />
              ) : (
                <TrashIcon className="w-4 h-4" />
              )}
              Delete{suffix}
            </button>
          </React.Fragment>
        );
      })}
      {hasClock && (
        <>
          <button
            type="button"
            className="btn btn-sm btn-ghost gap-1.5 h-9 min-h-9 px-2 text-base-content/80"
            disabled={loading || isDeletingClock}
            onClick={() => onEditClockIn(dateKey)}
          >
            <PencilSquareIcon className="w-4 h-4" />
            Edit{unavailabilities.length > 0 ? ' clock-in' : ''}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost gap-1.5 h-9 min-h-9 px-2 text-error"
            disabled={loading || isDeletingClock}
            onClick={() => onDeleteClockIn(dateKey)}
          >
            {isDeletingClock ? (
              <span className="loading loading-spinner loading-xs" />
            ) : (
              <TrashIcon className="w-4 h-4" />
            )}
            Delete{unavailabilities.length > 0 ? ' clock-in' : ''}
          </button>
        </>
      )}
    </div>
  );
}

export default function WorkingHoursMobileList({
  rows,
  weekMeta,
  loading,
  hasActiveRowFilters,
  bulkSelectMode,
  bulkSelectedDateKeys,
  isMonthSubmitted,
  loadingActions,
  deletingRowKey,
  deletingClockInDay,
  recordsByDay,
  getWeekAccentColor,
  isRowLocked,
  onToggleBulkSelect,
  onPlaceholderAddUnavailability,
  onPlaceholderAddClockIn,
  onEditNotes,
  onEditUnavailability,
  onDeleteUnavailability,
  onEditClockIn,
  onDeleteClockIn,
  onViewDocument,
}: WorkingHoursMobileListProps) {
  if (loading) {
    return (
      <div className="flex justify-center py-16 md:hidden">
        <span className="loading loading-spinner loading-md text-primary" />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="text-center py-12 text-gray-400 text-sm md:hidden">
        {hasActiveRowFilters
          ? 'No entries match the selected filters.'
          : 'No working hours or unavailabilities for this period.'}
      </p>
    );
  }

  return (
    <div className="md:hidden space-y-2 rounded-[18px] bg-[#ececec] p-2">
      {rows.map((row) => {
        const meta = weekMeta.get(row.dateKey);
        const weekHeader = meta?.isFirstInWeek ? (
          <div
            key={`wh-mobile-week-${meta.weekNum}-${row.dateKey}`}
            className="flex items-center gap-2 px-1 pt-2 pb-1"
            style={{ borderLeft: `3px solid ${getWeekAccentColor(meta.weekNum)}` }}
          >
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
              Week {meta.weekNum}
            </span>
          </div>
        ) : null;

        const isPlaceholder = row.isMissingPlaceholder || row.isHolidayPlaceholder;
        const isBulkSelectable = bulkSelectMode && isPlaceholder && !isMonthSubmitted;
        const isBulkSelected = bulkSelectedDateKeys.has(row.dateKey);
        const readOnly = isRowLocked(row.dateKey);

        if (isPlaceholder) {
          const isHoliday = row.isHolidayPlaceholder;
          const holidayLabel = row.holidayNames?.[0];
          const hintText = isHoliday
            ? holidayLabel
              ? `${holidayLabel} — no entry yet`
              : 'Holiday — no entry yet'
            : 'No entry yet';
          const cardBg = isHoliday ? 'bg-[#f5f3ff]' : 'bg-[#f3f4f6]';

          return (
            <React.Fragment key={row.dateKey}>
              {weekHeader}
              <div
                id={`wh-row-${row.dateKey}`}
                className={[
                  'rounded-2xl border border-base-200/60 p-3.5 space-y-3',
                  cardBg,
                  isBulkSelected ? 'ring-2 ring-primary/40' : '',
                ].filter(Boolean).join(' ')}
                onClick={isBulkSelectable ? () => onToggleBulkSelect(row.dateKey) : undefined}
                role={isBulkSelectable ? 'button' : undefined}
              >
                <div className="flex items-start justify-between gap-2">
                  <MobileDateLabel dateKey={row.dateKey} muted />
                  {isBulkSelectable && (
                    <input
                      type="checkbox"
                      className="checkbox checkbox-sm checkbox-primary shrink-0"
                      checked={isBulkSelected}
                      onChange={() => onToggleBulkSelect(row.dateKey)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Select ${row.date}`}
                    />
                  )}
                </div>
                <p className="text-base italic text-gray-500">{hintText}</p>
                {!isMonthSubmitted && !bulkSelectMode && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn btn-sm btn-outline btn-primary gap-1.5 flex-1 min-w-[8.5rem]"
                      onClick={() => onPlaceholderAddUnavailability(row.dateKey)}
                    >
                      <CalendarDaysIcon className="w-4 h-4" />
                      Add unavailability
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline btn-primary gap-1.5 flex-1 min-w-[8.5rem]"
                      onClick={() => onPlaceholderAddClockIn(row.dateKey)}
                    >
                      <PlusIcon className="w-4 h-4" />
                      Add clock-in
                    </button>
                  </div>
                )}
              </div>
            </React.Fragment>
          );
        }

        const hasClock = row.clock != null;
        const dayRecords = recordsByDay.get(row.dateKey) ?? [];
        const approvalStatus = getDayClockInApprovalStatus(dayRecords, {
          hasManualClockSummary: row.clock?.hasManual === true,
        });
        const accent = meta?.weekNum ? getWeekAccentColor(meta.weekNum) : '#d1d5db';
        const hasNotes = dayRecords.some((r) => Boolean(r.notes?.trim()));
        const declineNotes = formatDayDeclineNotes(dayRecords);

        return (
          <React.Fragment key={row.dateKey}>
            {weekHeader}
            <div
              id={`wh-row-${row.dateKey}`}
              className={`rounded-2xl border border-base-200/80 bg-white p-3.5 space-y-3 ${clockInApprovalRowClass(approvalStatus)}`}
              style={{ borderLeftWidth: 3, borderLeftColor: accent }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1.5 min-w-0">
                  <MobileDateLabel dateKey={row.dateKey} />
                  {row.clock?.hasManual && (
                    <MobileApprovalBadges
                      hasManual={row.clock.hasManual}
                      approvalStatus={approvalStatus}
                    />
                  )}
                  {declineNotes && (
                    <p className="text-xs font-medium leading-snug text-red-700">{declineNotes}</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                <MobileField label="Unavailability">
                  {row.unavailabilities.length > 0 ? (
                    <div className="flex flex-col gap-1.5">
                      {row.unavailabilities.map((u) => (
                        <UnavailabilityTypeBadge
                          key={`${u.id}-${u.date}`}
                          type={u.unavailability_type}
                          size="md"
                          borderless
                        />
                      ))}
                    </div>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </MobileField>
                <MobileField label="Total">
                  {hasClock ? (
                    <span className="inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold bg-primary/10 text-primary w-fit">
                      {sumClockDurations(filterCountedClockInRecords(dayRecords))}
                    </span>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </MobileField>
                <MobileField label="Clock in">
                  {hasClock ? row.clock!.clockIns : <span className="text-gray-400">—</span>}
                </MobileField>
                <MobileField label="Clock out">
                  {hasClock ? row.clock!.clockOuts : <span className="text-gray-400">—</span>}
                </MobileField>
                <MobileField label="Workplace">
                  {hasClock ? row.clock!.workplacesIn : <span className="text-gray-400">—</span>}
                </MobileField>
                <MobileField label="Notes">
                  {hasNotes && row.clock ? (
                    <button
                      type="button"
                      className="text-left text-base text-primary underline underline-offset-2 line-clamp-2"
                      onClick={() => onEditNotes(row.dateKey)}
                    >
                      {row.clock.notes}
                    </button>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </MobileField>
              </div>

              {row.unavailabilities.some((u) => u.document_url) && (
                <div className="flex flex-wrap gap-2">
                  {row.unavailabilities
                    .filter((u) => u.document_url)
                    .map((unavail) => {
                      const docName = documentNameFromUrl(unavail.document_url!);
                      return (
                        <button
                          key={`doc-${unavail.id}-${unavail.date}`}
                          type="button"
                          className="btn btn-xs btn-ghost gap-1.5 border border-base-200"
                          onClick={() =>
                            onViewDocument({
                              url: unavail.document_url!,
                              name: docName,
                              reason: unavailabilityReasonText(unavail),
                              uploadedAt: unavail.created_at,
                            })
                          }
                        >
                          <DocumentFileGlyph fileName={docName} className="h-5 w-5" />
                          <span className="truncate max-w-[8rem]">{docName}</span>
                        </button>
                      );
                    })}
                </div>
              )}

              <MobileDayActions
                dateKey={row.dateKey}
                unavailabilities={row.unavailabilities}
                hasClock={hasClock}
                readOnly={readOnly}
                loading={loadingActions}
                deletingRowKey={deletingRowKey}
                deletingClockInDay={deletingClockInDay}
                onEditUnavailability={onEditUnavailability}
                onDeleteUnavailability={onDeleteUnavailability}
                onEditClockIn={onEditClockIn}
                onDeleteClockIn={onDeleteClockIn}
              />
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}
