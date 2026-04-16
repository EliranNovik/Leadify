import React, { useMemo } from 'react';

type ChannelLabelProps = {
  label: string;
  /** Optional stable seed (e.g. channel.code or channel.id). */
  seed?: string | null;
  /** When true, render as subdued/disabled (e.g. inactive channel). */
  inactive?: boolean;
  className?: string;
  /** Show brand icon when known. */
  showIcon?: boolean;
};

const PALETTE = [
  { hue: 222, sat: 72, lit: 52 }, // blue
  { hue: 162, sat: 62, lit: 42 }, // teal
  { hue: 278, sat: 62, lit: 55 }, // violet
  { hue: 14, sat: 82, lit: 54 }, // orange
  { hue: 338, sat: 68, lit: 54 }, // pink
  { hue: 46, sat: 92, lit: 52 }, // amber
  { hue: 196, sat: 74, lit: 48 }, // cyan
  { hue: 120, sat: 52, lit: 38 }, // green
];

function hashToIndex(input: string, mod: number) {
  // djb2
  let h = 5381;
  for (let i = 0; i < input.length; i += 1) {
    h = ((h << 5) + h) ^ input.charCodeAt(i);
  }
  return Math.abs(h) % mod;
}

function cleanLabel(label: string) {
  return String(label || '').replace(/\s*\(inactive\)\s*$/i, '').trim();
}

type Brand = 'facebook' | 'google' | 'reddit' | null;

function detectBrand(text: string): Brand {
  const low = text.toLowerCase();
  if (low.includes('facebook')) return 'facebook';
  if (low.includes('google') || low.includes('goggle')) return 'google';
  if (low.includes('reddit')) return 'reddit';
  return null;
}

function BrandIcon({
  brand,
  color,
}: {
  brand: Exclude<Brand, null>;
  color: string;
}) {
  // Simple inline SVG marks (small, crisp at 14px).
  if (brand === 'facebook') {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-[18px] w-[18px] shrink-0"
        fill="none"
      >
        <path
          d="M14 8.5V7.2c0-.8.4-1.2 1.3-1.2H17V3h-2.3C12.2 3 11 4.4 11 6.9v1.6H9v3h2V21h3v-9.5h2.2l.6-3H14Z"
          fill={color}
        />
      </svg>
    );
  }
  if (brand === 'google') {
    // Minimal "G" mark (not full multicolor Google lockup) in requested brand color.
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-[18px] w-[18px] shrink-0"
        fill="none"
      >
        <path
          d="M12 10.2v3.2h4.5c-.2 1-.9 2.4-2.4 3.2-1 .7-2.3 1.1-4.1 1.1-3.1 0-5.6-2.6-5.6-5.7S6.9 6.3 10 6.3c1.8 0 3 .7 3.7 1.4l2.5-2.4C14.8 3.9 13 3 10 3 5.6 3 2 6.6 2 11s3.6 8 8 8c4.7 0 7.8-3.3 7.8-7.9 0-.5-.1-1-.1-1.4H12Z"
          fill={color}
        />
      </svg>
    );
  }
  // reddit
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-[18px] w-[18px] shrink-0"
      fill="none"
    >
      <path
        d="M20.5 12.2c.6.5 1 1.3 1 2.1 0 1.3-1 2.4-2.3 2.4-.5 0-.9-.1-1.3-.4-1.4 1.4-3.6 2.3-6 2.3s-4.6-.9-6-2.3c-.4.3-.8.4-1.3.4C3.5 18.7 2.5 17.6 2.5 16.3c0-.8.4-1.6 1-2.1-.1-.4-.2-.9-.2-1.3 0-2.8 3.6-5.1 8.2-5.1.9 0 1.8.1 2.6.3l1.1-3.4 3.1.8c.2-.7.8-1.2 1.6-1.2 1 0 1.8.8 1.8 1.8S20.9 8 19.9 8c-.7 0-1.3-.4-1.6-1l-2.1-.6-.8 2.6c2.7 1 4.5 2.7 4.5 4.9 0 .4-.1.9-.2 1.3Z"
        fill={color}
        opacity="0.95"
      />
      <path
        d="M8.8 13.3c0 .8-.6 1.4-1.4 1.4S6 14.1 6 13.3s.6-1.4 1.4-1.4 1.4.6 1.4 1.4Zm9.2 0c0 .8-.6 1.4-1.4 1.4s-1.4-.6-1.4-1.4.6-1.4 1.4-1.4 1.4.6 1.4 1.4Z"
        fill="#fff"
      />
    </svg>
  );
}

type GenericIcon = 'spark' | 'bolt' | 'megaphone' | 'link' | 'globe' | 'chart';

function pickGenericIcon(seed: string): GenericIcon {
  const icons: GenericIcon[] = ['spark', 'bolt', 'megaphone', 'link', 'globe', 'chart'];
  return icons[hashToIndex(seed, icons.length)];
}

function GenericChannelIcon({ kind, color }: { kind: GenericIcon; color: string }) {
  const cls = 'h-[18px] w-[18px] shrink-0';
  const stroke = color;
  const common = { stroke, strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

  if (kind === 'bolt') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className={cls} fill="none">
        <path {...common} d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z" />
      </svg>
    );
  }
  if (kind === 'megaphone') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className={cls} fill="none">
        <path {...common} d="M3 11v2c0 1.1.9 2 2 2h2l5 3V6L7 9H5c-1.1 0-2 .9-2 2Z" />
        <path {...common} d="M14 8c2.5 0 4 1.8 4 4s-1.5 4-4 4" />
      </svg>
    );
  }
  if (kind === 'link') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className={cls} fill="none">
        <path {...common} d="M10 13a5 5 0 0 1 0-7l1-1a5 5 0 0 1 7 7l-1 1" />
        <path {...common} d="M14 11a5 5 0 0 1 0 7l-1 1a5 5 0 0 1-7-7l1-1" />
      </svg>
    );
  }
  if (kind === 'globe') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className={cls} fill="none">
        <circle {...common} cx="12" cy="12" r="9" />
        <path {...common} d="M3 12h18" />
        <path {...common} d="M12 3c2.5 2.8 4 6 4 9s-1.5 6.2-4 9c-2.5-2.8-4-6-4-9s1.5-6.2 4-9Z" />
      </svg>
    );
  }
  if (kind === 'chart') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className={cls} fill="none">
        <path {...common} d="M4 19V5" />
        <path {...common} d="M4 19h16" />
        <path {...common} d="M7 15l4-4 3 3 5-6" />
      </svg>
    );
  }
  // spark
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={cls} fill="none">
      <path {...common} d="M12 2l1.2 4.2L17 7.5l-3.8 1.3L12 13l-1.2-4.2L7 7.5l3.8-1.3L12 2Z" />
      <path {...common} d="M5 14l.7 2.4L8 17l-2.3.6L5 20l-.7-2.4L2 17l2.3-.6L5 14Z" />
    </svg>
  );
}

export const ChannelLabel: React.FC<ChannelLabelProps> = ({
  label,
  seed,
  inactive = false,
  className,
  showIcon = true,
}) => {
  const text = cleanLabel(label);
  const isPlaceholder =
    text === '' || text === '-' || text === '—' || text.toLowerCase().includes('unknown');
  const brand = useMemo(() => (isPlaceholder ? null : detectBrand(text)), [isPlaceholder, text]);

  const color = useMemo(() => {
    if (isPlaceholder) return 'rgba(107, 114, 128, 1)'; // gray-500

    // Brand overrides (requested).
    const low = text.toLowerCase();
    if (low.includes('facebook')) return inactive ? 'hsl(217 70% 62%)' : 'hsl(217 91% 60%)'; // blue
    if (low.includes('google') || low.includes('goggle')) return inactive ? 'hsl(0 70% 62%)' : 'hsl(0 84% 60%)'; // red
    if (low.includes('reddit')) return inactive ? 'hsl(24 85% 58%)' : 'hsl(24 95% 55%)'; // orange

    const key = (seed && String(seed).trim()) || text;
    const pick = PALETTE[hashToIndex(key, PALETTE.length)];
    // Slightly reduce saturation for inactive channels.
    const sat = inactive ? Math.max(28, Math.round(pick.sat * 0.55)) : pick.sat;
    const lit = inactive ? Math.min(62, Math.round(pick.lit + 12)) : pick.lit;
    return `hsl(${pick.hue} ${sat}% ${lit}%)`;
  }, [inactive, isPlaceholder, seed, text]);

  const genericIcon = useMemo(() => {
    if (isPlaceholder || brand) return null;
    const key = (seed && String(seed).trim()) || text;
    return pickGenericIcon(key);
  }, [brand, isPlaceholder, seed, text]);

  return (
    <span className="inline-flex items-center gap-1.5" title={label}>
      {showIcon && brand ? <BrandIcon brand={brand} color={color} /> : null}
      {showIcon && !brand && genericIcon ? (
        <GenericChannelIcon kind={genericIcon} color={color} />
      ) : null}
      <span className={className || 'font-semibold'} style={{ color }}>
        {label}
      </span>
    </span>
  );
};

