import React, { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { ChevronRightIcon } from '@heroicons/react/24/outline';

export const PORTAL_SHELL_CLASS =
  'portal-brand portal-page-shell min-h-[100dvh] bg-gradient-to-b from-[#f7f7fb] to-[#f1f2f6]';

/** Client portal accent — matches footer blue-950 palette */
export const PORTAL_BRAND_BLUE = '#1e3a8a';
export const PORTAL_BRAND_BLUE_DARK = '#172554';
export const PORTAL_BRAND_BLUE_BRIGHT = '#1e40af';
export const PORTAL_ACTIVE_NAV_CLASS = 'bg-blue-100 font-semibold text-blue-900';

/** Client portal design tokens */
export const PORTAL_PAGE_BG = 'bg-gradient-to-b from-[#f7f7fb] to-[#f1f2f6]';
export const PORTAL_NAV_SURFACE_CLASS =
  'rounded-full border border-white/35 bg-white/[0.86] shadow-[0_12px_40px_rgba(0,0,0,0.12)] backdrop-blur-[18px]';
export const PORTAL_DASHBOARD_CONTAINER =
  'mx-auto w-full max-w-[1360px] px-4 md:px-9';
export const PORTAL_TEAM_CARD_CLASS =
  'rounded-3xl border border-[rgba(20,20,30,0.06)] bg-white/[0.92] shadow-[0_18px_45px_rgba(15,23,42,0.06)]';
export const PORTAL_NEXT_STEP_CARD_CLASS =
  'relative overflow-hidden rounded-[22px] border border-white/70 bg-white shadow-[0_22px_50px_rgba(0,0,0,0.18)]';

/** Charcoal gradient — client portal about panel & matching surfaces */
export const PORTAL_LOGIN_PANEL_BG_CLASS =
  'bg-gradient-to-br from-[#34343a] via-[#2e2e33] to-[#28282d]';

/** White sign-in column on portal login split layout */
export const PORTAL_LOGIN_SIGNIN_PANEL_BG_CLASS = 'bg-white';

const INITIALS_AVATAR_PALETTE: ReadonlyArray<{ bg: string; fg: string }> = [
  { bg: '#3730a3', fg: '#ffffff' },
  { bg: '#5b21b6', fg: '#ffffff' },
  { bg: '#1d4ed8', fg: '#ffffff' },
  { bg: '#0f766e', fg: '#ffffff' },
  { bg: '#047857', fg: '#ffffff' },
  { bg: '#b45309', fg: '#ffffff' },
  { bg: '#c2410c', fg: '#ffffff' },
  { bg: '#be123c', fg: '#ffffff' },
  { bg: '#a21caf', fg: '#ffffff' },
  { bg: '#0e7490', fg: '#ffffff' },
];

const UNSPLASH_COVER_PARAMS = 'ixlib=rb-4.0.3&auto=format&fit=crop&w=800&h=400&q=80';

const PORTAL_BANNER_PHOTO_ID = '1486406146926-c627a92ad1ab';

/** Verified live Unsplash photo ids — broken ids return HTML 404 and trigger ORB in the browser */
const COVER_PHOTO_IDS = [
  '1600880292203-757bb62b4baf',
  '1454165804606-c3d57bc86b40',
  '1497366216548-37526070297c',
  '1552664730-d307ca884978',
  '1522071820081-009f0129c71c',
  '1486312338219-ce68d2c6f44d',
  '1517245386807-bb43f82c33c4',
  '1504384308090-c894fdcc538d',
  '1557804506-669a67965ba0',
  '1553877522-43269d4ea984',
] as const;

/** One fixed image per dashboard stat card — excludes hero banner photo */
const STAT_CARD_COVER_PHOTO_IDS = [
  '1522071820081-009f0129c71c',
  '1454165804606-c3d57bc86b40',
  '1497366216548-37526070297c',
  '1517245386807-bb43f82c33c4',
] as const;

const STAT_CARD_COVER_SLOT_SUFFIXES = [
  'stat-next-meeting',
  'stat-next-payment',
  'stat-case-status',
  'stat-meeting-requests',
] as const;

function unsplashCoverUrl(photoId: string): string {
  return `https://images.unsplash.com/photo-${photoId}?${UNSPLASH_COVER_PARAMS}`;
}

const COVER_IMAGES = COVER_PHOTO_IDS.map(unsplashCoverUrl);

const COVER_GRADIENTS = [
  'from-slate-600 via-slate-700 to-slate-800',
  'from-sky-700 via-blue-800 to-indigo-900',
  'from-teal-700 via-cyan-800 to-blue-900',
  'from-indigo-700 via-blue-800 to-slate-900',
  'from-zinc-600 via-slate-700 to-gray-800',
  'from-blue-700 via-indigo-800 to-violet-900',
] as const;

/** Same default banner as MyProfilePage */
export const PORTAL_DEFAULT_BANNER =
  `https://images.unsplash.com/photo-${PORTAL_BANNER_PHOTO_ID}?ixlib=rb-4.0.3&auto=format&fit=crop&w=2070&q=80`;

function hashString(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (Math.imul(31, h) + key.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** Opaque pastel tint — avoids a white fringe from rgba on white card backgrounds. */
function hexToPastel(hex: string, whiteMix = 0.88): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const mix = (channel: number) => Math.round(255 * whiteMix + channel * (1 - whiteMix));
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

function getInitialsPaletteEntry(stableKey: string) {
  const idx = hashString(stableKey) % INITIALS_AVATAR_PALETTE.length;
  return INITIALS_AVATAR_PALETTE[idx];
}


const AVATAR_FRAME_RESET_CLASS =
  'ring-0 ring-offset-0 border-0 shadow-none outline-none [box-shadow:none!important]';

export function getInitialsTheme(stableKey: string) {
  const { bg } = getInitialsPaletteEntry(stableKey);
  const washedBg = hexToPastel(bg);
  return {
    avatarStyle: { backgroundColor: washedBg, color: bg } satisfies CSSProperties,
    headerStyle: {
      backgroundColor: washedBg,
      color: bg,
    } satisfies CSSProperties,
  };
}

function getInitialsStyle(stableKey: string): CSSProperties {
  return getInitialsTheme(stableKey).avatarStyle;
}

export function initialsFromName(name?: string | null): string {
  const s = (name || '').trim();
  if (!s) return 'U';
  return s.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || 'U';
}

export function getCoverMeta(coverKey: string) {
  const idx = hashString(coverKey);
  return {
    imageUrl: COVER_IMAGES[idx % COVER_IMAGES.length],
    gradient: COVER_GRADIENTS[idx % COVER_GRADIENTS.length],
  };
}

/** Fixed cover per stat-card slot — never reuses the hero banner image */
export function getStatCardCoverImage(coverKey: string): string {
  for (let i = 0; i < STAT_CARD_COVER_SLOT_SUFFIXES.length; i++) {
    if (coverKey.includes(STAT_CARD_COVER_SLOT_SUFFIXES[i])) {
      return unsplashCoverUrl(STAT_CARD_COVER_PHOTO_IDS[i]);
    }
  }
  const idx = hashString(coverKey) % STAT_CARD_COVER_PHOTO_IDS.length;
  return unsplashCoverUrl(STAT_CARD_COVER_PHOTO_IDS[idx]);
}

export function isPaymentOverdue(dueDate: string | null | undefined): boolean {
  if (!dueDate) return false;
  const due = new Date(dueDate);
  if (Number.isNaN(due.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  return due.getTime() < today.getTime();
}

export function PortalOverdueBadge() {
  return (
    <span className="inline-flex rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-700 md:text-sm">
      Overdue
    </span>
  );
}

export function PortalPaidBadge() {
  return (
    <span className="inline-flex rounded-full bg-emerald-500/12 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
      Paid
    </span>
  );
}

function formatPortalBadgeDate(d: string | null | undefined): string | null {
  if (!d) return null;
  try {
    return new Date(d).toLocaleDateString();
  } catch {
    return d;
  }
}

export function PortalDueDateBadge({
  date,
  overdue = false,
}: {
  date: string | null | undefined;
  overdue?: boolean;
}) {
  const formatted = formatPortalBadgeDate(date);
  if (!formatted) return null;
  const tone = overdue ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold md:text-sm ${tone}`}
    >
      <span className="font-medium opacity-75">Due</span>
      <span>{formatted}</span>
    </span>
  );
}

export function PortalPaidDateBadge({ date }: { date: string | null | undefined }) {
  const formatted = formatPortalBadgeDate(date);
  if (!formatted) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 md:text-sm">
      <span className="font-medium opacity-75">Paid</span>
      <span>{formatted}</span>
    </span>
  );
}

export function PortalOriginallyDueText({ date }: { date: string | null | undefined }) {
  const formatted = formatPortalBadgeDate(date);
  if (!formatted) return null;
  return (
    <p className="mt-2 text-xs text-gray-400 md:text-sm">
      Originally due {formatted}
    </p>
  );
}

/** Frosted glass surface — stat cards */
export const PORTAL_GLASS_PANEL_CLASS =
  'rounded-[16px] bg-white/28 shadow-[0_8px_32px_rgba(15,23,42,0.08)] backdrop-blur-xl backdrop-saturate-150';

/** Stronger frosted glass — desktop hero profile on banner */
export const PORTAL_HERO_GLASS_PANEL_CLASS =
  'rounded-[20px] bg-white/14 shadow-[0_16px_48px_rgba(15,23,42,0.1)] backdrop-blur-2xl backdrop-saturate-150';

/** CTA on dashboard summary cards (photo backgrounds) */
export const PORTAL_STAT_ACTION_BTN_CLASS =
  'inline-flex min-h-9 items-center gap-2 rounded-full bg-white/95 px-4 py-2 text-sm font-semibold tracking-wide text-blue-900 shadow-sm transition-all hover:-translate-y-0.5 hover:bg-white hover:shadow-md active:translate-y-0 active:scale-[0.98]';

export function PortalLoading({ className = 'py-16' }: { className?: string }) {
  return (
    <div className={`flex justify-center ${className}`}>
      <span className="loading loading-spinner loading-lg text-primary" />
    </div>
  );
}

export function PortalCard({
  children,
  className = '',
  padding = 'p-4 md:p-6',
}: {
  children: ReactNode;
  className?: string;
  padding?: string;
}) {
  return (
    <div className={`rounded-[18px] bg-white ${padding} ${className}`}>
      {children}
    </div>
  );
}

export function PortalSectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-xs font-bold uppercase tracking-widest text-base-content/40 md:text-sm">{children}</p>
  );
}

export function getPortalTabHeaderCoverImage(
  tabId: 'summary' | 'stages' | 'finance' | 'documents' | 'contacts' | 'meetings',
): string {
  const suffixByTab = {
    summary: 'stat-case-status',
    stages: 'stat-case-status',
    finance: 'stat-next-payment',
    documents: 'stat-next-meeting',
    contacts: 'stat-contacts-header',
    meetings: 'stat-meeting-requests',
  } as const;
  return getStatCardCoverImage(`portal-tab::${suffixByTab[tabId]}`);
}

const PORTAL_TAB_HEADER_BOX_CLASS =
  'relative -mx-2 -mt-6 overflow-hidden md:-mx-10 md:-mt-8 lg:mx-auto lg:-mt-6 lg:max-w-4xl lg:rounded-[20px] lg:shadow-[0_8px_32px_rgba(15,23,42,0.1)] xl:max-w-5xl';

export function PortalTabHeaderCover({
  coverImage,
  children,
  tall = false,
}: {
  coverImage: string;
  children: ReactNode;
  tall?: boolean;
}) {
  const coverFallbackUrl = unsplashCoverUrl(STAT_CARD_COVER_PHOTO_IDS[0]);
  const [imgBroken, setImgBroken] = useState(false);

  useEffect(() => {
    setImgBroken(false);
  }, [coverImage]);

  const sizeClass = tall
    ? 'min-h-[11.5rem] md:min-h-[13.5rem] lg:min-h-[14.5rem]'
    : 'h-40 md:h-48 lg:h-52';

  return (
    <div className={`${PORTAL_TAB_HEADER_BOX_CLASS} ${sizeClass}`}>
      <img
        src={imgBroken ? coverFallbackUrl : coverImage}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setImgBroken(true)}
      />
      <div
        className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-black/45 to-black/20"
        aria-hidden
      />
      <div className="relative z-10 flex h-full min-h-[inherit] flex-col justify-end px-4 pb-5 md:px-10 md:pb-7">
        {children}
      </div>
    </div>
  );
}

export function PortalTabFrame({
  title,
  subtitle,
  headerCoverImage,
  children,
}: {
  title: string;
  subtitle?: string;
  /** Same Unsplash covers as dashboard summary stat cards */
  headerCoverImage?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-8">
      {headerCoverImage ? (
        <PortalTabHeaderCover coverImage={headerCoverImage}>
          <h2 className="text-2xl font-bold tracking-tight text-white md:text-3xl">{title}</h2>
          {subtitle ? (
            <p className="mt-2 max-w-2xl text-sm text-white/85 md:text-base">{subtitle}</p>
          ) : null}
        </PortalTabHeaderCover>
      ) : (
        <div>
          <h2 className="text-xl font-bold tracking-tight text-base-content/95">{title}</h2>
          {subtitle ? <p className="mt-2 text-sm text-base-content/50">{subtitle}</p> : null}
        </div>
      )}
      {children}
    </div>
  );
}

export function EntityAvatar({
  name,
  imageUrl,
  stableKey,
  className = 'h-11 w-11 text-sm',
  roundedFull = true,
  borderless = true,
}: {
  name?: string | null;
  imageUrl?: string | null;
  stableKey: string;
  className?: string;
  roundedFull?: boolean;
  borderless?: boolean;
}) {
  const [imgBroken, setImgBroken] = useState(false);
  const resolvedUrl = imageUrl?.trim() || '';
  const showImage = Boolean(resolvedUrl) && !imgBroken;
  const radiusClass = roundedFull ? 'rounded-full' : 'rounded-xl';
  const frameClass = borderless ? AVATAR_FRAME_RESET_CLASS : `${AVATAR_FRAME_RESET_CLASS} shadow-sm`;
  const surfaceResetStyle: CSSProperties = {
    boxShadow: 'none',
    outline: 'none',
    border: 'none',
  };

  useEffect(() => {
    setImgBroken(false);
  }, [resolvedUrl]);

  if (showImage) {
    return (
      <div
        className={`relative shrink-0 overflow-hidden ${frameClass} ${radiusClass} ${className}`}
        style={surfaceResetStyle}
      >
        <img
          src={resolvedUrl}
          alt=""
          className="block h-full w-full object-cover"
          style={surfaceResetStyle}
          onError={() => setImgBroken(true)}
        />
      </div>
    );
  }

  return (
    <div
      className={`relative flex shrink-0 items-center justify-center overflow-hidden font-bold tracking-tight ${frameClass} ${radiusClass} ${className}`}
      style={{ ...surfaceResetStyle, ...getInitialsStyle(stableKey) }}
    >
      {initialsFromName(name)}
    </div>
  );
}

export const PORTAL_DASHBOARD_LOGO = '/DPLOGO1.png';

export function ProfileCover({
  coverKey,
  className = '',
  showBrandLogo = false,
  overlay,
  showDimOverlay = true,
}: {
  coverKey: string;
  className?: string;
  showBrandLogo?: boolean;
  overlay?: ReactNode;
  showDimOverlay?: boolean;
}) {
  const fallback = useMemo(() => getCoverMeta(coverKey), [coverKey]);
  const [broken, setBroken] = useState(false);

  return (
    <div className={`relative h-44 w-full bg-gradient-to-r md:h-56 ${fallback.gradient} ${className}`}>
      {!broken ? (
        <img
          src={PORTAL_DEFAULT_BANNER}
          alt=""
          className="absolute inset-0 h-full w-full object-cover object-center"
          loading="lazy"
          onError={() => setBroken(true)}
        />
      ) : null}
      {showBrandLogo ? (
        <img
          src={PORTAL_DASHBOARD_LOGO}
          alt="Decker Pex & Co Law Offices"
          className="absolute left-3 top-3 z-10 h-10 w-auto max-w-[140px] object-contain drop-shadow-[0_2px_8px_rgba(0,0,0,0.45)] md:left-6 md:top-5 md:h-12 md:max-w-[160px] lg:left-8"
        />
      ) : null}
      {overlay ? (
        <div className="pointer-events-none absolute inset-x-3 top-[3.75rem] z-20 md:inset-x-auto md:right-6 md:left-auto md:top-5 lg:right-8">
          <div className="pointer-events-auto w-full md:w-80">{overlay}</div>
        </div>
      ) : null}
      {showDimOverlay ? (
        <div className="pointer-events-none absolute inset-0 bg-black/20" aria-hidden />
      ) : null}
    </div>
  );
}

const STAT_CARD_THEMES = {
  primary: {
    bg: 'bg-blue-50',
    border: 'border-blue-100',
    title: 'text-blue-950',
    subtitle: 'text-blue-800/70',
    icon: 'text-blue-800',
  },
  sky: {
    bg: 'bg-[#eaf0ff]',
    border: 'border-[#d6e2ff]',
    title: 'text-[#2f3f7a]',
    subtitle: 'text-[#5f73a8]',
    icon: 'text-[#4b63c9]',
  },
  emerald: {
    bg: 'bg-[#e8f8f2]',
    border: 'border-[#cfeede]',
    title: 'text-[#2a5f50]',
    subtitle: 'text-[#578874]',
    icon: 'text-[#2d947b]',
  },
  amber: {
    bg: 'bg-[#fff4e6]',
    border: 'border-[#fde4c3]',
    title: 'text-[#7a4a12]',
    subtitle: 'text-[#a67c3d]',
    icon: 'text-[#d97706]',
  },
} as const;

export function PortalStatCard({
  label,
  value,
  hint,
  icon: Icon,
  accent = 'primary',
  action,
  badge,
  onClick,
  coverKey,
  showChevron = true,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  accent?: 'primary' | 'emerald' | 'amber' | 'sky';
  action?: ReactNode;
  badge?: ReactNode;
  onClick?: () => void;
  /** Stable key — picks a background photo for the card. */
  coverKey?: string;
  showChevron?: boolean;
}) {
  const theme = STAT_CARD_THEMES[accent];
  const coverImageUrl = useMemo(
    () => (coverKey ? getStatCardCoverImage(coverKey) : null),
    [coverKey],
  );
  const [imgBroken, setImgBroken] = useState(false);
  const hasPhoto = Boolean(coverImageUrl && !imgBroken);

  const cardClassName = `group relative flex h-full w-full flex-col overflow-hidden rounded-[20px] text-left transition-all duration-300 ${
    hasPhoto
      ? 'border-0 bg-white shadow-[0_8px_28px_rgba(15,23,42,0.1)] hover:shadow-[0_12px_36px_rgba(15,23,42,0.14)]'
      : `min-h-[145px] border p-4 lg:min-h-[145px] lg:p-4 ${theme.border} ${theme.bg} shadow-sm hover:shadow-md`
  } ${
    onClick
      ? 'cursor-pointer hover:scale-[1.005] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-900/30'
      : ''
  }`;

  const labelClass = `text-[10px] font-bold uppercase tracking-[0.12em] lg:text-xs ${theme.subtitle}`;
  const titleClass = `text-base font-semibold leading-snug tracking-tight lg:text-lg ${theme.title}`;
  const hintClass = `mt-1 line-clamp-2 text-xs leading-relaxed lg:text-sm ${theme.subtitle}`;
  const iconClass = `h-7 w-7 shrink-0 lg:h-8 lg:w-8 ${theme.icon}`;
  const chevronWrapClass =
    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#f6f5fa]';
  const chevronClass = `h-3.5 w-3.5 stroke-[2.5] ${theme.icon}`;

  const details = (options?: { chevronFirst?: boolean }) => (
    <div className="flex min-h-[2.75rem] flex-1 items-start gap-3.5">
      <Icon className={iconClass} aria-hidden />
      <div className="min-w-0 flex-1 text-left">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className={titleClass}>{value}</p>
          {badge ? <span className="inline-flex shrink-0">{badge}</span> : null}
        </div>
        <p className={hintClass}>{hint || '\u00A0'}</p>
      </div>
      {options?.chevronFirst && showChevron && onClick ? (
        <span className={chevronWrapClass} aria-hidden>
          <ChevronRightIcon className={chevronClass} />
        </span>
      ) : null}
    </div>
  );

  const actionBlock = action ? (
    <div
      className="mt-3 flex items-end"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div>{action}</div>
    </div>
  ) : null;

  const content = hasPhoto ? (
    <>
      <div className="relative h-36 w-full shrink-0 overflow-hidden bg-[#f1f2f6]">
        <img
          src={coverImageUrl!}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setImgBroken(true)}
        />
        <span
          className={`absolute left-3 top-3 rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] shadow-sm backdrop-blur-sm lg:text-xs ${theme.bg} ${theme.subtitle}`}
        >
          {label}
        </span>
      </div>
      <div className="flex h-full flex-col p-4 pt-3">
        {details({ chevronFirst: true })}
        {actionBlock}
      </div>
    </>
  ) : (
    <>
      <div className="mb-3 flex items-start justify-between gap-2">
        <span className={labelClass}>{label}</span>
        {showChevron && onClick ? (
          <span className={chevronWrapClass} aria-hidden>
            <ChevronRightIcon className={chevronClass} />
          </span>
        ) : null}
      </div>
      {details()}
      {actionBlock}
    </>
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cardClassName}>
        {content}
      </button>
    );
  }

  return <div className={cardClassName}>{content}</div>;
}
