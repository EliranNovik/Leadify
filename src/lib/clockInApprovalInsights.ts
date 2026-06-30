import { formatClockTime } from './employeeClockInFormat';
import {
  getClockInApprovalStatus,
  isHomeWfhApprovalRequest,
  manualClockInWorkplaceLabel,
  type ManualClockInApprovalRecord,
} from './employeeClockInApproval';
import {
  type ClockInRevisionSnapshot,
  gpsLocationSummary,
} from './employeeClockInRevisions';

export type ClockInInsightLevel = 'ok' | 'review' | 'flag';

export type ClockInApprovalInsight = {
  level: ClockInInsightLevel;
  title: string;
  detail: string;
};

export type ClockInApprovalReview = {
  level: ClockInInsightLevel;
  insights: ClockInApprovalInsight[];
  changes: string[];
};

const OFFICE_GPS_HINTS: Array<{ match: RegExp; cities: RegExp; label: string }> = [
  {
    match: /ramat\s*gan/i,
    cities: /ramat|רמת/i,
    label: 'Ramat Gan office',
  },
  {
    match: /jerusalem/i,
    cities: /jerusalem|ירושל/i,
    label: 'Jerusalem office',
  },
];

function minutesBetween(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 60_000;
}

function workplaceMatchesGps(
  workplaceName: string,
  city: string | null,
  address: string | null,
): boolean {
  const wp = workplaceName.trim().toLowerCase();
  if (!wp || wp === '—') return true;
  if (wp === 'home') return true;

  const hay = `${city ?? ''} ${address ?? ''}`.trim();
  if (!hay) return false;

  for (const rule of OFFICE_GPS_HINTS) {
    if (rule.match.test(wp)) {
      return rule.cities.test(hay);
    }
  }
  return hay.length > 0;
}

function hasGpsCapture(record: ManualClockInApprovalRecord): boolean {
  return Boolean(
    record.location_latitude != null
    || record.location_longitude != null
    || record.location_city?.trim()
    || record.location_address?.trim(),
  );
}

function isAutoClockOutNote(notes: string | null | undefined): boolean {
  const text = notes?.trim().toLowerCase() ?? '';
  return text.includes('auto clock-out') || text.includes('auto clock out');
}

export function buildClockInChangeLines(
  record: ManualClockInApprovalRecord,
  revision: ClockInRevisionSnapshot | null | undefined,
): string[] {
  if (!revision) return [];

  const lines: string[] = [];

  if (revision.clockInTime !== record.clock_in_time) {
    lines.push(
      `In ${formatClockTime(revision.clockInTime)}→${formatClockTime(record.clock_in_time)}`,
    );
  }

  const prevOut = revision.clockOutTime ?? null;
  const nextOut = record.clock_out_time ?? null;
  if (prevOut !== nextOut) {
    lines.push(
      `Out ${prevOut ? formatClockTime(prevOut) : '—'}→${nextOut ? formatClockTime(nextOut) : '—'}`,
    );
  }

  const prevInPlace = revision.clockInPlace;
  const nextInPlace = manualClockInWorkplaceLabel(record, 'in');
  if (prevInPlace !== nextInPlace) {
    lines.push(`In place ${prevInPlace}→${nextInPlace}`);
  }

  const prevOutPlace = revision.clockOutPlace;
  const nextOutPlace = manualClockInWorkplaceLabel(record, 'out');
  if (prevOutPlace !== nextOutPlace) {
    lines.push(`Out place ${prevOutPlace}→${nextOutPlace}`);
  }

  const prevNotes = revision.notes?.trim() || '';
  const nextNotes = record.notes?.trim() || '';
  if (prevNotes !== nextNotes) {
    lines.push('Notes changed');
  }

  if (lines.length === 0) {
    lines.push('Manual edit');
  }

  return lines;
}

export type ClockInRevisionFieldChanges = {
  clockIn: { previous: string; current: string } | null;
  clockOut: { previous: string; current: string } | null;
  workplaceIn: { previous: string; current: string } | null;
  workplaceOut: { previous: string; current: string } | null;
};

export function getClockInRevisionFieldChanges(
  record: ManualClockInApprovalRecord,
  revision: ClockInRevisionSnapshot | null | undefined,
): ClockInRevisionFieldChanges {
  const empty: ClockInRevisionFieldChanges = {
    clockIn: null,
    clockOut: null,
    workplaceIn: null,
    workplaceOut: null,
  };
  if (!revision) return empty;

  const result = { ...empty };

  if (revision.clockInTime !== record.clock_in_time) {
    result.clockIn = {
      previous: formatClockTime(revision.clockInTime),
      current: formatClockTime(record.clock_in_time),
    };
  }

  const prevOut = revision.clockOutTime ?? null;
  const nextOut = record.clock_out_time ?? null;
  if (prevOut !== nextOut) {
    result.clockOut = {
      previous: prevOut ? formatClockTime(prevOut) : '—',
      current: nextOut ? formatClockTime(nextOut) : '—',
    };
  }

  const nextInPlace = manualClockInWorkplaceLabel(record, 'in');
  if (revision.clockInPlace !== nextInPlace) {
    result.workplaceIn = { previous: revision.clockInPlace, current: nextInPlace };
  }

  const nextOutPlace = manualClockInWorkplaceLabel(record, 'out');
  if (revision.clockOutPlace !== nextOutPlace) {
    result.workplaceOut = { previous: revision.clockOutPlace, current: nextOutPlace };
  }

  return result;
}

export type ClockInApprovalMissingField = 'clock_in' | 'clock_out' | 'workplace';

const MISSING_FIELD_LABELS: Record<ClockInApprovalMissingField, string> = {
  clock_in: 'clock in',
  clock_out: 'clock out',
  workplace: 'workplace',
};

export function getClockInApprovalMissingRequiredFields(
  record: ManualClockInApprovalRecord,
): ClockInApprovalMissingField[] {
  if (isHomeWfhApprovalRequest(record)) return [];

  const missing: ClockInApprovalMissingField[] = [];

  if (!record.clock_in_time?.trim()) {
    missing.push('clock_in');
  }
  if (!record.clock_out_time?.trim()) {
    missing.push('clock_out');
  }

  const workplace = manualClockInWorkplaceLabel(record, 'in');
  if (!workplace || workplace === '—') {
    missing.push('workplace');
  }

  return missing;
}

export function formatClockInApprovalMissingRequiredDetail(
  missing: ClockInApprovalMissingField[],
): string {
  if (missing.length === 0) return '';
  const labels = missing.map((field) => MISSING_FIELD_LABELS[field]);
  if (labels.length === 1) {
    return `Required ${labels[0]} is missing. Ask the employee to complete this entry before approving.`;
  }
  const last = labels[labels.length - 1];
  const rest = labels.slice(0, -1).join(', ');
  return `Required fields are missing: ${rest} and ${last}. Ask the employee to complete this entry before approving.`;
}

export function buildClockInApprovalReview(
  record: ManualClockInApprovalRecord,
  revision: ClockInRevisionSnapshot | null | undefined,
): ClockInApprovalReview {
  const insights: ClockInApprovalInsight[] = [];
  const changes = buildClockInChangeLines(record, revision);

  const missingRequired = getClockInApprovalMissingRequiredFields(record);
  if (missingRequired.length > 0) {
    insights.push({
      level: 'flag',
      title: 'Missing required data',
      detail: formatClockInApprovalMissingRequiredDetail(missingRequired),
    });
  }

  const workplaceIn = manualClockInWorkplaceLabel(record, 'in');
  const workplaceOut = manualClockInWorkplaceLabel(record, 'out');
  const gpsInSummary = gpsLocationSummary(record.location_city ?? null, record.location_address ?? null);
  const gpsOutSummary = gpsLocationSummary(
    record.clock_out_location_city ?? null,
    record.clock_out_location_address ?? null,
  );

  const locationSource = record.location_source?.trim().toLowerCase() ?? revision?.locationSource?.toLowerCase() ?? '';
  const hadAutomaticCapture = locationSource === 'browser' || locationSource === 'ip' || revision?.source === 'automatic';

  if (
    workplaceIn
    && workplaceIn !== '—'
    && workplaceIn.toLowerCase() !== 'home'
    && hadAutomaticCapture
    && hasGpsCapture(record)
    && !workplaceMatchesGps(workplaceIn, record.location_city ?? null, record.location_address ?? null)
  ) {
    const gpsText = gpsInSummary || 'an unknown location';
    insights.push({
      level: 'flag',
      title: 'GPS mismatch at clock-in',
      detail: `The selected workplace is "${workplaceIn}", but the device GPS at clock-in reported ${gpsText}. Please confirm the employee was actually at the selected workplace.`,
    });
  }

  if (
    record.clock_out_time
    && workplaceOut
    && workplaceOut !== '—'
    && workplaceOut.toLowerCase() !== 'home'
    && (record.clock_out_location_city || record.clock_out_location_address)
    && !workplaceMatchesGps(
      workplaceOut,
      record.clock_out_location_city ?? null,
      record.clock_out_location_address ?? null,
    )
  ) {
    const gpsText = gpsOutSummary || 'an unknown location';
    insights.push({
      level: 'flag',
      title: 'GPS mismatch at clock-out',
      detail: `The selected workplace is "${workplaceOut}", but the device GPS at clock-out reported ${gpsText}. Please confirm the employee clocked out from the selected workplace.`,
    });
  }

  if (revision) {
    const inShift = minutesBetween(revision.clockInTime, record.clock_in_time);
    const outShift =
      revision.clockOutTime && record.clock_out_time
        ? minutesBetween(revision.clockOutTime, record.clock_out_time)
        : 0;

    if (inShift >= 30) {
      insights.push({
        level: inShift >= 120 ? 'flag' : 'review',
        title: 'Large clock-in change',
        detail: `Clock-in was moved by ${Math.round(inShift)} minutes (from ${formatClockTime(revision.clockInTime)} to ${formatClockTime(record.clock_in_time)}). Please confirm the new time is correct.`,
      });
    }

    if (outShift >= 30) {
      insights.push({
        level: outShift >= 120 ? 'flag' : 'review',
        title: 'Large clock-out change',
        detail: `Clock-out was moved by ${Math.round(outShift)} minutes (from ${revision.clockOutTime ? formatClockTime(revision.clockOutTime) : '—'} to ${record.clock_out_time ? formatClockTime(record.clock_out_time) : '—'}). Please confirm the new time is correct.`,
      });
    }
  }

  if (isAutoClockOutNote(record.notes)) {
    insights.push({
      level: 'review',
      title: 'Automatic clock-out',
      detail: 'The system closed this session automatically. Please check that the clock-out time reflects when the employee actually finished work.',
    });
  }

  if (insights.length === 0) {
    insights.push({
      level: 'ok',
      title: revision ? 'Routine edit' : 'New manual entry',
      detail: '',
    });
  }

  const meaningfulChanges = changes.filter((line) => line !== 'Manual edit');
  if (
    meaningfulChanges.length > 0
    && !insights.some((item) => item.level === 'flag' || item.level === 'review')
  ) {
    insights.unshift({
      level: 'review',
      title: 'Employee edited entry',
      detail: revision?.source === 'automatic'
        ? 'The employee corrected an automatic clock-in record. Review the updated times and workplace shown in the row above before approving.'
        : 'The employee updated a previously saved entry. Review the highlighted changes in the row above before approving.',
    });
  }

  const level: ClockInInsightLevel = insights.some((item) => item.level === 'flag')
    ? 'flag'
    : insights.some((item) => item.level === 'review')
      ? 'review'
      : 'ok';

  return { level, insights, changes };
}

export function clockInInsightLevelLabel(level: ClockInInsightLevel): string {
  if (level === 'flag') return 'Flag';
  if (level === 'review') return 'Check';
  return 'OK';
}

/** Filled pill — used for status counts (pending, clocked in). */
export function clockInInsightLevelClass(level: ClockInInsightLevel): string {
  if (level === 'flag') return 'bg-red-100 text-red-800 border-red-200/80';
  if (level === 'review') return 'bg-amber-100 text-amber-900 border-amber-200/80';
  return 'bg-emerald-100 text-emerald-800 border-emerald-200/80';
}

/** Outline tag — distinct from status pills on employee cards. */
export function clockInInsightTagClass(level: ClockInInsightLevel): string {
  if (level === 'flag') return 'border-red-500 text-red-700';
  if (level === 'review') return 'border-amber-500 text-amber-800';
  return 'border-emerald-500 text-emerald-700';
}

export function getPrimaryApprovalInsight(
  insights: ClockInApprovalInsight[],
): ClockInApprovalInsight | null {
  return (
    insights.find((item) => item.level === 'flag')
    ?? insights.find((item) => item.level === 'review')
    ?? null
  );
}

/** Actionable notes shown in the approval detail row (excludes routine OK placeholders). */
export function getApprovalInsightNotes(
  insights: ClockInApprovalInsight[],
): ClockInApprovalInsight[] {
  return insights.filter(
    (item) => (item.level === 'flag' || item.level === 'review') && item.detail.trim().length > 0,
  );
}

export type EmployeeGroupApprovalSummary = {
  level: ClockInInsightLevel;
  explanation: string;
};

export function buildEmployeeGroupApprovalSummary(
  records: ManualClockInApprovalRecord[],
  getRevision: (id: number) => ClockInRevisionSnapshot | null | undefined,
): EmployeeGroupApprovalSummary | null {
  const clockRecords = records.filter(
    (record) =>
      getClockInApprovalStatus(record) === 'pending' && !isHomeWfhApprovalRequest(record),
  );
  if (clockRecords.length === 0) return null;

  let worstLevel: ClockInInsightLevel = 'ok';
  const flagTitles: string[] = [];
  const reviewTitles: string[] = [];

  for (const record of clockRecords) {
    const review = buildClockInApprovalReview(record, getRevision(record.id));
    if (review.level === 'flag') {
      worstLevel = 'flag';
      const primary = getPrimaryApprovalInsight(review.insights);
      if (primary && !flagTitles.includes(primary.title)) flagTitles.push(primary.title);
    } else if (review.level === 'review' && worstLevel !== 'flag') {
      worstLevel = 'review';
      const primary = getPrimaryApprovalInsight(review.insights);
      if (primary && !reviewTitles.includes(primary.title)) reviewTitles.push(primary.title);
    }
  }

  if (worstLevel === 'ok') return null;

  const explanation = (worstLevel === 'flag' ? flagTitles : reviewTitles).slice(0, 1).join('');

  return { level: worstLevel, explanation };
}

export function getApprovalInsightTooltip(
  insights: ClockInApprovalInsight[],
): string | undefined {
  const notes = getApprovalInsightNotes(insights);
  if (notes.length === 0) return undefined;
  return notes.map((note) => note.detail).join('\n\n');
}
