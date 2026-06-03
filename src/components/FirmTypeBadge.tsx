import React from 'react';

/** Stable per-type colours (hash of id/label — same type always same badge) */
const FIRM_TYPE_BADGE_COLORS = [
  'bg-violet-100 text-violet-800',
  'bg-indigo-100 text-indigo-800',
  'bg-sky-100 text-sky-800',
  'bg-teal-100 text-teal-800',
  'bg-emerald-100 text-emerald-800',
  'bg-lime-100 text-lime-800',
  'bg-amber-100 text-amber-900',
  'bg-orange-100 text-orange-800',
  'bg-rose-100 text-rose-800',
  'bg-fuchsia-100 text-fuchsia-800',
  'bg-pink-100 text-pink-800',
  'bg-cyan-100 text-cyan-800',
  'bg-blue-100 text-blue-800',
  'bg-purple-100 text-purple-800',
] as const;

function hashStringForFirmTypeBadge(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (Math.imul(31, h) + key.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function firmTypeBadgeColorClass(stableKey: string): string {
  const idx = hashStringForFirmTypeBadge(stableKey) % FIRM_TYPE_BADGE_COLORS.length;
  return FIRM_TYPE_BADGE_COLORS[idx];
}

export default function FirmTypeBadge({
  label,
  typeId,
  size = 'md',
  className = '',
}: {
  label: string;
  typeId?: string | null;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const sizeCls = size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-sm px-2.5 py-1';
  const colorCls = firmTypeBadgeColorClass(typeId?.trim() || label.trim());
  return (
    <span
      className={`inline-block rounded-md font-medium shrink-0 ${sizeCls} ${colorCls} ${className}`}
    >
      {label}
    </span>
  );
}
