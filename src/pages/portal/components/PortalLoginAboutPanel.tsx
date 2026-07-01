import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BanknotesIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DocumentTextIcon,
  Squares2X2Icon,
  UserGroupIcon,
} from '@heroicons/react/24/outline';
import { usePortalLoginI18nOptional } from '../i18n/PortalLoginI18nContext';
import { PORTAL_LOGIN_PANEL_BG_CLASS } from './portalTheme';

type Props = {
  /** Inline in the video panel header — borderless trigger + dropdown */
  variant?: 'default' | 'header' | 'hero';
};

type FeatureItem = {
  title: string;
  body: string;
  icon: React.ComponentType<{ className?: string }>;
};

function AboutFeatureSlide({ item, glass = false }: { item: FeatureItem; glass?: boolean }) {
  const Icon = item.icon;
  if (glass) {
    return (
      <div className="flex w-full items-start gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary text-white shadow-[0_2px_10px_rgba(30,58,138,0.4)]">
          <Icon className="h-6 w-6" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-semibold leading-snug text-white drop-shadow-[0_1px_8px_rgba(0,0,0,0.45)] xl:text-xl">
            {item.title}
          </h3>
          <p className="mt-1.5 whitespace-normal break-words text-sm leading-relaxed text-white/85 drop-shadow-[0_1px_6px_rgba(0,0,0,0.4)] xl:text-base">
            {item.body}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-w-full shrink-0 snap-start snap-always flex-col gap-4 px-1">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary text-white shadow-[0_2px_8px_rgba(30,58,138,0.35)]">
        <Icon className="h-6 w-6" aria-hidden />
      </span>
      <div className="min-w-0">
        <h3 className="text-lg font-semibold leading-snug text-white/90">{item.title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-white/55 md:text-base">{item.body}</p>
      </div>
    </div>
  );
}

function AboutFeatureCarousel({ items, glass = false }: { items: FeatureItem[]; glass?: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const glassCarouselRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const goToIndex = useCallback(
    (index: number) => {
      const clamped = Math.max(0, Math.min(index, items.length - 1));
      setActiveIndex(clamped);
      const el = scrollRef.current;
      if (el) {
        el.scrollTo({ left: clamped * el.clientWidth, behavior: 'smooth' });
      }
    },
    [items.length],
  );

  const syncActiveIndex = useCallback(() => {
    const el = scrollRef.current;
    if (!el || items.length === 0) return;
    const slideWidth = el.clientWidth;
    if (slideWidth <= 0) return;
    const next = Math.round(el.scrollLeft / slideWidth);
    setActiveIndex(Math.max(0, Math.min(next, items.length - 1)));
  }, [items.length]);

  useEffect(() => {
    if (glass) return;
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', syncActiveIndex, { passive: true });
    return () => el.removeEventListener('scroll', syncActiveIndex);
  }, [syncActiveIndex, glass]);

  /** Glass hero: trackpad horizontal swipe changes slide; vertical scrolls the about box. */
  useEffect(() => {
    if (!glass) return;
    const el = glassCarouselRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      const absX = Math.abs(e.deltaX);
      const absY = Math.abs(e.deltaY);
      const scrollParent = el.closest('[data-about-scroll]') as HTMLElement | null;

      if (e.shiftKey && absY > 0) {
        e.preventDefault();
        setActiveIndex((current) =>
          Math.max(0, Math.min(items.length - 1, current + (e.deltaY > 0 ? 1 : -1))),
        );
        return;
      }

      if (absX > absY && absX > 0) {
        e.preventDefault();
        setActiveIndex((current) =>
          Math.max(0, Math.min(items.length - 1, current + (e.deltaX > 0 ? 1 : -1))),
        );
        return;
      }

      if (absY > absX && scrollParent) {
        e.preventDefault();
        scrollParent.scrollTop += e.deltaY;
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [glass, items.length]);

  /** Non-glass: horizontal scroll container trackpad support. */
  useEffect(() => {
    if (glass) return;
    const el = scrollRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      const absX = Math.abs(e.deltaX);
      const absY = Math.abs(e.deltaY);
      const scrollParent = el.closest('[data-about-scroll]') as HTMLElement | null;

      if (e.shiftKey && absY > 0) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
        return;
      }

      if (absX > absY && absX > 0) {
        e.preventDefault();
        el.scrollLeft += e.deltaX;
        return;
      }

      if (absY > absX && scrollParent) {
        e.preventDefault();
        scrollParent.scrollTop += e.deltaY;
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [glass, items.length]);

  const canGoPrev = activeIndex > 0;
  const canGoNext = activeIndex < items.length - 1;

  const arrowClass = glass
    ? 'bg-white/25 text-white shadow-sm hover:bg-white/35'
    : 'bg-white/10 text-white/90 hover:bg-white/20';
  const dotActiveClass = glass ? 'bg-white/90' : 'bg-white/80';
  const dotInactiveClass = glass ? 'bg-white/40 hover:bg-white/55' : 'bg-white/30 hover:bg-white/50';

  if (glass) {
    const activeItem = items[activeIndex];
    if (!activeItem) return null;

    return (
      <div ref={glassCarouselRef} className="mt-8">
        <div className="flex items-start gap-2 md:gap-3">
          <button
            type="button"
            onClick={() => goToIndex(activeIndex - 1)}
            disabled={!canGoPrev}
            className={`mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors disabled:pointer-events-none disabled:opacity-30 ${arrowClass}`}
            aria-label="Previous category"
          >
            <ChevronLeftIcon className="h-5 w-5" />
          </button>

          <div className="min-w-0 flex-1">
            <AboutFeatureSlide item={activeItem} glass />
          </div>

          <button
            type="button"
            onClick={() => goToIndex(activeIndex + 1)}
            disabled={!canGoNext}
            className={`mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors disabled:pointer-events-none disabled:opacity-30 ${arrowClass}`}
            aria-label="Next category"
          >
            <ChevronRightIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 flex justify-center gap-2" role="tablist" aria-label="Feature categories">
          {items.map((item, index) => (
            <button
              key={item.title}
              type="button"
              role="tab"
              aria-selected={index === activeIndex}
              aria-label={item.title}
              onClick={() => goToIndex(index)}
              className={`rounded-full transition-all ${
                index === activeIndex ? `h-2 w-6 ${dotActiveClass}` : `h-2 w-2 ${dotInactiveClass}`
              }`}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={glass ? 'mt-5' : 'mt-5'}>
      <div className="flex items-stretch gap-2 md:gap-3">
        <button
          type="button"
          onClick={() => goToIndex(activeIndex - 1)}
          disabled={!canGoPrev}
          className={`flex h-10 w-10 shrink-0 items-center justify-center self-center rounded-full transition-colors disabled:pointer-events-none disabled:opacity-30 ${arrowClass}`}
          aria-label="Previous category"
        >
          <ChevronLeftIcon className="h-5 w-5" />
        </button>

        <div
          ref={scrollRef}
          className="scrollbar-hide flex min-w-0 flex-1 snap-x snap-mandatory overflow-x-auto overscroll-x-contain"
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          {items.map((item) => (
            <AboutFeatureSlide key={item.title} item={item} glass={glass} />
          ))}
        </div>

        <button
          type="button"
          onClick={() => goToIndex(activeIndex + 1)}
          disabled={!canGoNext}
          className={`flex h-10 w-10 shrink-0 items-center justify-center self-center rounded-full transition-colors disabled:pointer-events-none disabled:opacity-30 ${arrowClass}`}
          aria-label="Next category"
        >
          <ChevronRightIcon className="h-5 w-5" />
        </button>
      </div>

      <div className={`flex justify-center gap-2 ${glass ? 'mt-4' : 'mt-4'}`} role="tablist" aria-label="Feature categories">
        {items.map((item, index) => (
          <button
            key={item.title}
            type="button"
            role="tab"
            aria-selected={index === activeIndex}
            aria-label={item.title}
            onClick={() => goToIndex(index)}
            className={`rounded-full transition-all ${
              index === activeIndex ? `h-2 w-6 ${dotActiveClass}` : `h-2 w-2 ${dotInactiveClass}`
            }`}
          />
        ))}
      </div>
    </div>
  );
}

function AboutFeatureList({
  items,
  listClassName,
}: {
  items: FeatureItem[];
  listClassName?: string;
}) {
  return (
    <ul
      className={
        listClassName ??
        'mt-5 max-h-[min(42vh,300px)] space-y-4 overflow-y-auto overscroll-contain'
      }
    >
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <li key={item.title} className="flex gap-3.5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-white shadow-[0_2px_8px_rgba(30,58,138,0.35)]">
              <Icon className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-semibold leading-snug text-white/90">{item.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-white/55">{item.body}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Collapsible about summary on the login page video panel. */
const PortalLoginAboutPanel: React.FC<Props> = ({ variant = 'default' }) => {
  const i18n = usePortalLoginI18nOptional();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || variant !== 'header') return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open, variant]);

  if (!i18n) return null;

  const { t } = i18n;
  const features: FeatureItem[] = [
    { title: t.aboutFeature1Title, body: t.aboutFeature1Body, icon: Squares2X2Icon },
    { title: t.aboutFeature2Title, body: t.aboutFeature2Body, icon: DocumentTextIcon },
    { title: t.aboutFeature3Title, body: t.aboutFeature3Body, icon: BanknotesIcon },
    { title: t.aboutFeature4Title, body: t.aboutFeature4Body, icon: UserGroupIcon },
  ];

  if (variant === 'hero') {
    return (
      <div
        data-about-scroll
        className="flex max-h-[min(72vh,calc(100dvh-11rem))] w-full max-w-2xl flex-col overflow-y-auto overscroll-y-contain rounded-2xl bg-white/12 p-6 shadow-[0_8px_40px_rgba(0,0,0,0.12)] backdrop-blur-xl backdrop-saturate-150 xl:max-w-3xl xl:rounded-3xl xl:p-8"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        <h2 className="shrink-0 text-xl font-bold tracking-tight text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.5)] xl:text-2xl">
          {t.aboutTitle}
        </h2>
        <p className="mt-1.5 shrink-0 text-sm leading-relaxed text-white/85 drop-shadow-[0_1px_8px_rgba(0,0,0,0.45)] xl:text-base">
          {t.aboutSubtitle}
        </p>
        <AboutFeatureCarousel items={features} glass />
      </div>
    );
  }

  if (variant === 'header') {
    return (
      <div ref={rootRef} className="relative min-w-0">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex max-w-[min(100%,22rem)] items-center gap-2 rounded-full px-3.5 py-2 text-start text-sm font-medium text-white/95 transition-colors hover:bg-white/15 drop-shadow-[0_2px_8px_rgba(0,0,0,0.35)]"
          aria-expanded={open}
        >
          <span className="truncate">{t.aboutTitle}</span>
          <ChevronDownIcon
            className={`h-4 w-4 shrink-0 text-white/70 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          />
        </button>

        {open ? (
          <div
            className={`absolute start-0 top-full z-[60] mt-2 w-[min(26rem,calc(100vw-2rem))] rounded-2xl p-6 shadow-[0_20px_50px_rgba(0,0,0,0.55)] xl:w-[30rem] ${PORTAL_LOGIN_PANEL_BG_CLASS}`}
          >
            <p className="text-base text-white/60">{t.aboutSubtitle}</p>
            <p className="mt-3.5 text-base leading-relaxed text-white/75">{t.aboutIntro}</p>
            <AboutFeatureList items={features} />
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={`w-full max-w-lg rounded-[20px] shadow-[0_20px_50px_rgba(0,0,0,0.45)] xl:max-w-xl ${PORTAL_LOGIN_PANEL_BG_CLASS}`}
    >
      <div className="mx-6 mt-5 h-px w-12 bg-gradient-to-r from-[#d4af37] to-transparent xl:mx-7" />
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-6 py-4 text-start xl:px-7"
        aria-expanded={open}
      >
        <h2 className="text-base font-semibold tracking-tight text-white xl:text-lg">{t.aboutTitle}</h2>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.06]">
          <ChevronDownIcon
            className={`h-4 w-4 text-[#d4af37] transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          />
        </span>
      </button>

      {open ? (
        <div className="border-t border-white/[0.08] px-6 pb-6 pt-1 xl:px-7 xl:pb-7">
          <p className="mt-3 text-base text-white/60">{t.aboutSubtitle}</p>
          <p className="mt-4 text-base leading-relaxed text-white/75">{t.aboutIntro}</p>
          <AboutFeatureList items={features} />
        </div>
      ) : null}
    </div>
  );
};

export default PortalLoginAboutPanel;
