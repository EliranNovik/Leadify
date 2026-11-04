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

type Brand = 'facebook' | 'google' | 'reddit' | 'chatgpt' | 'linkedin' | null;

function detectBrand(text: string): Brand {
  const low = text.toLowerCase();
  if (low.includes('facebook')) return 'facebook';
  if (low.includes('google') || low.includes('goggle')) return 'google';
  if (low.includes('reddit')) return 'reddit';
  if (low.includes('linkedin') || low.includes('linked in')) return 'linkedin';
  if (
    low.includes('chatgpt') ||
    low.includes('chat gpt') ||
    low.includes('chat-gpt') ||
    low.includes('openai')
  ) {
    return 'chatgpt';
  }
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
  if (brand === 'chatgpt') {
    // Official OpenAI / ChatGPT mark (Simple Icons openai.svg).
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-[18px] w-[18px] shrink-0"
        fill="none"
      >
        <path
          fill={color}
          d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"
        />
      </svg>
    );
  }
  if (brand === 'linkedin') {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-[18px] w-[18px] shrink-0"
        fill="none"
      >
        <path
          fill={color}
          d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12ZM7.12 20.45H3.56V9h3.56v11.45ZM22.23 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.46c.98 0 1.77-.77 1.77-1.73V1.73C24 .77 23.21 0 22.23 0Z"
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
    if (low.includes('linkedin') || low.includes('linked in')) {
      return inactive ? 'hsl(201 70% 48%)' : 'hsl(201 100% 35%)'; // LinkedIn blue
    }
    if (
      low.includes('chatgpt') ||
      low.includes('chat gpt') ||
      low.includes('chat-gpt') ||
      low.includes('openai')
    ) {
      return inactive ? 'hsl(0 0% 40%)' : 'hsl(0 0% 12%)'; // ChatGPT / OpenAI black
    }

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

