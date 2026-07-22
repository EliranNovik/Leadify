import React from 'react';

export const INTERNAL_MEETING_TYPE_BADGE_PALETTE: Record<
  string,
  { bg: string; fg: string; border: string }
> = {
  staff: { bg: '#eef2ff', fg: '#3730a3', border: '#c7d2fe' },
  providers: { bg: '#ecfdf5', fg: '#065f46', border: '#a7f3d0' },
  sub_contractor: { bg: '#fffbeb', fg: '#92400e', border: '#fde68a' },
  extern: { bg: '#fff7ed', fg: '#9a3412', border: '#fed7aa' },
  firm: { bg: '#fdf4ff', fg: '#86198f', border: '#f5d0fe' },
  lawyer_group: { bg: '#eff6ff', fg: '#1e40af', border: '#bfdbfe' },
  sponsor: { bg: '#f0fdf4', fg: '#166534', border: '#bbf7d0' },
  other: { bg: '#f9fafb', fg: '#4b5563', border: '#e5e7eb' },
};

export const NEUTRAL_INTERNAL_MEETING_TYPE_BADGE = {
  bg: '#f3f4f6',
  fg: '#374151',
  border: '#e5e7eb',
};

export function resolveInternalMeetingTypeBadge(
  typeLabel: string | null | undefined,
  typeCode: string | null | undefined,
  hasTypeId: boolean,
): { label: string; code: string; palette: { bg: string; fg: string; border: string } } {
  if (typeLabel) {
    const code = String(typeCode || 'staff').toLowerCase() || 'staff';
    const palette =
      code && INTERNAL_MEETING_TYPE_BADGE_PALETTE[code]
        ? INTERNAL_MEETING_TYPE_BADGE_PALETTE[code]
        : hasTypeId
          ? NEUTRAL_INTERNAL_MEETING_TYPE_BADGE
          : INTERNAL_MEETING_TYPE_BADGE_PALETTE.staff;
    return { label: String(typeLabel), code, palette };
  }
  if (hasTypeId) {
    return { label: 'Type', code: '', palette: NEUTRAL_INTERNAL_MEETING_TYPE_BADGE };
  }
  return { label: 'Staff', code: 'staff', palette: INTERNAL_MEETING_TYPE_BADGE_PALETTE.staff };
}

export type InternalMeetingTypeBadgeProps = {
  typeLabel?: string | null;
  typeCode?: string | null;
  internalMeetingTypeId?: number | null;
  className?: string;
};

export function InternalMeetingTypeBadge({
  typeLabel,
  typeCode,
  internalMeetingTypeId,
  className = '',
}: InternalMeetingTypeBadgeProps) {
  const hasTypeId =
    internalMeetingTypeId != null &&
    !(typeof internalMeetingTypeId === 'number' && !Number.isFinite(internalMeetingTypeId));
  const { label, code, palette } = resolveInternalMeetingTypeBadge(typeLabel, typeCode, hasTypeId);
  const titleParts: string[] = [];
  if (code) titleParts.push(`Internal meeting type (${code})`);
  if (!code && !hasTypeId) titleParts.push('Default: Staff (no type selected)');

  return (
    <span
      className={`stage-badge inline-flex items-center rounded-md border-0 px-2 py-1 text-xs font-semibold sm:px-2.5 sm:py-1 sm:text-sm ${className}`}
      style={{ backgroundColor: palette.bg, color: palette.fg }}
      title={titleParts.length ? titleParts.join(' · ') : undefined}
    >
      {label}
    </span>
  );
}
