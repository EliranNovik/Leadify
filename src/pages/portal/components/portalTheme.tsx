import React, { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { ChevronRightIcon } from '@heroicons/react/24/outline';

export const PORTAL_SHELL_CLASS = 'portal-page-shell min-h-[100dvh] bg-[#ececec]';

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
  '1600880292203-757bb62b4baf',
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
    <span className="text-xs font-semibold text-red-600 md:text-sm">
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

/** Frosted glass surface — stat cards */
export const PORTAL_GLASS_PANEL_CLASS =
  'rounded-[16px] bg-white/28 shadow-[0_8px_32px_rgba(15,23,42,0.08)] backdrop-blur-xl backdrop-saturate-150';

/** Stronger frosted glass — desktop hero profile on banner */
export const PORTAL_HERO_GLASS_PANEL_CLASS =
  'rounded-[20px] bg-white/14 shadow-[0_16px_48px_rgba(15,23,42,0.1)] backdrop-blur-2xl backdrop-saturate-150';

/** Purple oval CTA on dashboard stat-card photo backgrounds */
export const PORTAL_STAT_ACTION_BTN_CLASS =
  'inline-flex min-h-9 items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold tracking-wide text-primary-content shadow-[0_4px_14px_rgba(0,0,0,0.28)] transition-all hover:-translate-y-0.5 hover:brightness-110 hover:shadow-[0_6px_18px_rgba(0,0,0,0.38)] active:translate-y-0 active:scale-[0.98]';

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
  tabId: 'stages' | 'finance' | 'documents' | 'contacts' | 'meetings',
): string {
  const suffixByTab = {
    stages: 'stat-case-status',
    finance: 'stat-next-payment',
    documents: 'stat-next-meeting',
    contacts: 'stat-contacts-header',
    meetings: 'stat-meeting-requests',
  } as const;
  return getStatCardCoverImage(`portal-tab::${suffixByTab[tabId]}`);
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
  const coverFallbackUrl = unsplashCoverUrl(STAT_CARD_COVER_PHOTO_IDS[0]);
  const [imgBroken, setImgBroken] = useState(false);

  useEffect(() => {
    setImgBroken(false);
  }, [headerCoverImage]);

  return (
    <div className="space-y-8">
      {headerCoverImage ? (
        <div className="relative -mx-2 -mt-6 h-40 overflow-hidden md:-mx-10 md:-mt-8 md:h-48 lg:mx-auto lg:-mt-6 lg:h-52 lg:max-w-4xl lg:rounded-[20px] lg:shadow-[0_8px_32px_rgba(15,23,42,0.1)] xl:max-w-5xl">
          <img
            src={imgBroken ? coverFallbackUrl : headerCoverImage}
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
          <div className="relative z-10 flex h-full flex-col justify-end px-4 pb-6 md:px-10 md:pb-8">
            <h2 className="text-2xl font-bold tracking-tight text-white md:text-3xl">{title}</h2>
            {subtitle ? (
              <p className="mt-2 max-w-2xl text-sm text-white/85 md:text-base">{subtitle}</p>
            ) : null}
          </div>
        </div>
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
}: {
  label: string;
  value: string;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  accent?: 'primary' | 'emerald' | 'amber' | 'sky';
  action?: ReactNode;
  badge?: ReactNode;
  onClick?: () => void;
  /** Stable key — picks a fixed stat-card cover via getStatCardCoverImage */
  coverKey?: string;
}) {
  const coverImageUrl = useMemo(
    () => (coverKey ? getStatCardCoverImage(coverKey) : null),
    [coverKey],
  );
  const coverFallbackUrl = unsplashCoverUrl(STAT_CARD_COVER_PHOTO_IDS[0]);
  const [imgBroken, setImgBroken] = useState(false);

  const cover = coverImageUrl;

  const titleMap = {
    primary: 'text-primary',
    emerald: 'text-emerald-700',
    amber: 'text-amber-700',
    sky: 'text-sky-700',
  };

  const iconBoxClassName = {
    primary: 'bg-primary/10 text-primary',
    emerald: 'bg-emerald-500/10 text-emerald-700',
    amber: 'bg-amber-500/10 text-amber-700',
    sky: 'bg-sky-500/10 text-sky-700',
  };

  const coverIconClassName = {
    primary: 'h-9 w-9 shrink-0 text-primary md:h-10 md:w-10',
    emerald: 'h-9 w-9 shrink-0 text-emerald-700 md:h-10 md:w-10',
    amber: 'h-9 w-9 shrink-0 text-amber-700 md:h-10 md:w-10',
    sky: 'h-9 w-9 shrink-0 text-sky-700 md:h-10 md:w-10',
  };
  const coverValueClassName = 'text-xl font-bold tracking-tight text-neutral-900 md:text-2xl';

  const glassPanelClassName =
    'rounded-[16px] bg-white/85 shadow-[0_8px_32px_rgba(15,23,42,0.08)] backdrop-blur-xl backdrop-saturate-150';
  const titleClassName = titleMap[accent];
  const valueClassName = 'text-xl font-bold tracking-tight text-base-content/90 md:text-2xl';
  const hintClassName =
    'mt-1 min-h-[2.5rem] text-base leading-relaxed text-neutral-600 line-clamp-2';
  const coverLabelClassName =
    'text-xs font-bold uppercase tracking-wide text-white drop-shadow-sm md:text-sm';
  const coverHintClassName =
    'text-xs leading-snug text-white/90 drop-shadow-sm line-clamp-2 md:text-sm';
  const statCardChevronIconClassName = cover
    ? 'h-4 w-4 stroke-[2.5] text-white md:h-5 md:w-5'
    : 'h-4 w-4 stroke-[2.5] text-base-content/60 md:h-5 md:w-5';
  const statCardChevronIcon = onClick ? (
    <span
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full shadow-[0_8px_32px_rgba(15,23,42,0.08)] backdrop-blur-xl backdrop-saturate-150 md:h-9 md:w-9 ${
        cover ? 'bg-white/28' : 'bg-white/80 shadow-[0_4px_16px_rgba(15,23,42,0.08)] backdrop-blur-md'
      }`}
      aria-hidden
    >
      <ChevronRightIcon className={statCardChevronIconClassName} />
    </span>
  ) : null;

  const cardClassName =
    'group relative flex h-full min-h-[13.5rem] w-full flex-col overflow-hidden rounded-[18px] text-left shadow-sm transition-shadow hover:shadow-md md:min-h-[14rem]';

  const plainInnerContent = (
    <>
      <div className="mb-3 flex items-start justify-between gap-2">
        <p className={`text-base font-bold uppercase tracking-wide ${titleClassName}`}>{label}</p>
        {statCardChevronIcon}
      </div>
      <div className="flex min-h-[3.75rem] flex-1 items-start gap-3 md:gap-4">
        <div
          className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl ${iconBoxClassName[accent]}`}
        >
          <Icon className="h-8 w-8" aria-hidden />
        </div>
        <div className="min-w-0 flex-1 text-left">
          <div className="flex flex-wrap items-center gap-2">
            <p className={valueClassName}>{value}</p>
            {badge ? <span className="inline-flex shrink-0">{badge}</span> : null}
          </div>
          <p className={hintClassName}>{hint || '\u00A0'}</p>
        </div>
      </div>
      <div
        className="relative z-10 flex min-h-[2.25rem] items-end"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {action ? <div>{action}</div> : null}
      </div>
    </>
  );

  const coverInnerContent = (
    <>
      <div className="mt-auto flex flex-col gap-3">
        <div className={`${glassPanelClassName} flex items-center gap-3 px-4 py-3 md:gap-4 md:px-5 md:py-4`}>
          <Icon className={coverIconClassName[accent]} aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className={coverValueClassName}>{value}</p>
              {badge ? <span className="inline-flex shrink-0">{badge}</span> : null}
            </div>
          </div>
        </div>
        <div
          className="relative z-10 flex min-h-[2.25rem] items-end"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {action ? <div>{action}</div> : null}
        </div>
      </div>
    </>
  );

  const coverHeaderTitles = (
    <div className="absolute right-3 top-3 z-20 flex max-w-[88%] items-center justify-end gap-x-2 md:right-4 md:top-4 md:gap-x-2.5">
      <p className={`shrink-0 ${coverLabelClassName}`}>{label}</p>
      {hint && hint !== '\u00A0' ? (
        <p className={`min-w-0 ${coverHintClassName}`}>{hint}</p>
      ) : null}
      {statCardChevronIcon}
    </div>
  );

  const content = (
    <>
      {cover ? (
        <>
          {!imgBroken ? (
            <img
              src={coverImageUrl!}
              alt=""
              className="pointer-events-none absolute inset-0 h-full w-full object-cover"
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={() => setImgBroken(true)}
            />
          ) : (
            <img
              src={coverFallbackUrl}
              alt=""
              className="pointer-events-none absolute inset-0 h-full w-full object-cover"
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          )}
          <div
            className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-[68%] bg-gradient-to-b from-black/60 via-black/25 to-transparent"
            aria-hidden
          />
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-[50%] bg-gradient-to-t from-white/55 via-white/25 to-transparent"
            aria-hidden
          />
          {coverHeaderTitles}
        </>
      ) : (
        <div
          className="pointer-events-none absolute inset-0 bg-white transition-colors group-hover:bg-base-200/35"
          aria-hidden
        />
      )}
      <div
        className={`relative z-10 flex flex-1 flex-col ${cover ? 'p-3 md:p-4' : 'gap-4 px-4 pb-5 pt-4 md:px-6 md:pb-6 md:pt-5'}`}
      >
        {cover ? coverInnerContent : plainInnerContent}
      </div>
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
