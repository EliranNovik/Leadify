import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type SnapIndex = 0 | 1 | 2;

/** Viewport-height fractions for peek → mid → expanded (mobile only). */
const SNAP_RATIOS = [0.38, 0.58, 0.94] as const;
const FULL_HEIGHT_RATIO = 0.96;
/** Default open position: mid (centered), not fully expanded. */
const DEFAULT_SNAP_INDEX: SnapIndex = 1;
/** How far past the peek snap (px) before a release dismisses. */
const DISMISS_PAST_PEEK_PX = 120;
/** Downward fling speed (px/ms) that dismisses from peek. */
const DISMISS_VELOCITY_PX_MS = 1.15;
const UP_DRAG_RESISTANCE = 0.28;
const SHEET_EASING = 'cubic-bezier(0.32, 0.72, 0, 1)';
const SNAP_MS = 360;
const CLOSE_MS = 280;

function isNarrowViewport(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(max-width: 767px)').matches;
}

function snapHeightsForViewport(vh: number, mobileFullHeight: boolean): [number, number, number] {
  const full = Math.round(vh * (mobileFullHeight ? FULL_HEIGHT_RATIO : SNAP_RATIOS[2]));
  return [
    Math.round(vh * SNAP_RATIOS[0]),
    Math.round(vh * SNAP_RATIOS[1]),
    Math.max(full, Math.round(vh * SNAP_RATIOS[1]) + 48),
  ];
}

function nearestSnapByHeight(heights: [number, number, number], height: number): SnapIndex {
  let best: SnapIndex = 0;
  let bestDist = Infinity;
  for (let i = 0; i < 3; i++) {
    const d = Math.abs(height - heights[i]);
    if (d < bestDist) {
      bestDist = d;
      best = i as SnapIndex;
    }
  }
  return best;
}

function resolveReleaseSnap(
  heights: [number, number, number],
  height: number,
  dismissY: number,
  velocityY: number,
  fromSnap: SnapIndex,
): SnapIndex | 'close' {
  if (
    dismissY >= DISMISS_PAST_PEEK_PX ||
    (dismissY > 40 && velocityY > DISMISS_VELOCITY_PX_MS) ||
    (height < heights[0] - 40 && velocityY > 0.5)
  ) {
    return 'close';
  }

  if (velocityY > 0.65) {
    if (fromSnap > 0) return (fromSnap - 1) as SnapIndex;
    return dismissY > 40 ? 'close' : 0;
  }
  if (velocityY < -0.65) {
    return Math.min(2, fromSnap + 1) as SnapIndex;
  }

  return nearestSnapByHeight(heights, height);
}

export type MobileBottomSheetProps = {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  headerRight?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  zIndex?: number;
  /** Nearly full viewport height on mobile */
  mobileFullHeight?: boolean;
  /** Skip built-in header (use custom header inside children) */
  hideDefaultHeader?: boolean;
  /** Skip drag handle on mobile */
  hideDragHandle?: boolean;
  ariaLabelledBy?: string;
  sheetClassName?: string;
  contentClassName?: string;
  overlayClassName?: string;
  footerClassName?: string;
  /** Extra classes for the default header row (e.g. omit `border-b`). */
  headerClassName?: string;
  /** Desktop: centered modal (default) or right-edge drawer */
  desktopLayout?: 'center' | 'drawer-right';
  /** Desktop: nearly full viewport (assign staff, large tables) */
  desktopFullScreen?: boolean;
  /** When false, tapping the backdrop does nothing */
  closeOnOverlayClick?: boolean;
  onOverlayClick?: () => void;
  /** Lock background page scroll. Use `mobile` to keep desktop page scrollable (e.g. side drawer). */
  scrollLock?: 'always' | 'mobile';
};

export default function MobileBottomSheet({
  open,
  onClose,
  title,
  subtitle,
  headerRight,
  footer,
  children,
  zIndex = 100,
  mobileFullHeight = false,
  hideDefaultHeader = false,
  hideDragHandle = false,
  ariaLabelledBy,
  sheetClassName = '',
  contentClassName = '',
  overlayClassName = '',
  footerClassName = '',
  headerClassName = '',
  desktopLayout = 'center',
  desktopFullScreen = false,
  closeOnOverlayClick = true,
  onOverlayClick,
  scrollLock = 'always',
}: MobileBottomSheetProps) {
  const autoTitleId = useId();
  const titleId = ariaLabelledBy || (title ? autoTitleId : undefined);
  const contentRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? isNarrowViewport() : false,
  );
  const [entered, setEntered] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [snapIndex, setSnapIndex] = useState<SnapIndex>(DEFAULT_SNAP_INDEX);
  const [heights, setHeights] = useState<[number, number, number]>(() =>
    typeof window !== 'undefined'
      ? snapHeightsForViewport(window.innerHeight, mobileFullHeight)
      : [300, 460, 740],
  );

  /** Visible sheet height (footer stays inside this box at every snap). */
  const heightRef = useRef(heights[DEFAULT_SNAP_INDEX]);
  /** Extra downward slide used only while dismissing past peek. */
  const dismissYRef = useRef(0);
  const snapIndexRef = useRef<SnapIndex>(DEFAULT_SNAP_INDEX);
  const heightsRef = useRef(heights);
  const dragActiveRef = useRef(false);
  const dragStartYRef = useRef(0);
  const dragStartHeightRef = useRef(0);
  const lastTouchYRef = useRef(0);
  const lastTouchTimeRef = useRef(0);
  const velocityYRef = useRef(0);
  const closingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  heightsRef.current = heights;
  snapIndexRef.current = snapIndex;

  const applyVisual = useCallback((
    height: number,
    dismissY: number,
    withTransition: boolean,
    durationMs = SNAP_MS,
  ) => {
    const sheet = sheetRef.current;
    const overlay = overlayRef.current;
    if (!sheet) return;
    heightRef.current = height;
    dismissYRef.current = dismissY;
    const full = heightsRef.current[2] || 1;
    const visible = Math.max(0, height - dismissY);
    const progress = Math.min(1, Math.max(0, visible / full));

    const transition = withTransition
      ? `height ${durationMs}ms ${SHEET_EASING}, transform ${durationMs}ms ${SHEET_EASING}`
      : 'none';
    sheet.style.transition = transition;
    sheet.style.height = `${Math.max(0, height)}px`;
    sheet.style.maxHeight = `${Math.max(0, height)}px`;
    sheet.style.transform = `translate3d(0, ${Math.max(0, dismissY)}px, 0)`;

    if (overlay) {
      overlay.style.transition = withTransition
        ? `opacity ${durationMs}ms ${SHEET_EASING}`
        : 'none';
      overlay.style.opacity = String(0.2 + progress * 0.35);
    }
  }, []);

  const measureHeights = useCallback(() => {
    if (typeof window === 'undefined') return;
    const next = snapHeightsForViewport(window.innerHeight, mobileFullHeight);
    setHeights(next);
    heightsRef.current = next;
  }, [mobileFullHeight]);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (!open) return;
    measureHeights();
    const onResize = () => measureHeights();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open, measureHeights]);

  useEffect(() => {
    if (!open) {
      setEntered(false);
      setIsDragging(false);
      setSnapIndex(DEFAULT_SNAP_INDEX);
      snapIndexRef.current = DEFAULT_SNAP_INDEX;
      closingRef.current = false;
      dragActiveRef.current = false;
      heightRef.current = 0;
      dismissYRef.current = 0;
      return;
    }

    const shouldLockScroll = scrollLock === 'always' || isNarrowViewport();
    const prevOverflow = document.body.style.overflow;
    if (shouldLockScroll) {
      document.body.style.overflow = 'hidden';
    }

    return () => {
      if (shouldLockScroll) {
        document.body.style.overflow = prevOverflow;
      }
    };
  }, [open, scrollLock]);

  // Mobile enter: grow from 0 to default (mid) snap
  useLayoutEffect(() => {
    if (!open) return;
    if (!isMobile) {
      const raf = requestAnimationFrame(() => setEntered(true));
      return () => cancelAnimationFrame(raf);
    }

    closingRef.current = false;
    const target = heightsRef.current[DEFAULT_SNAP_INDEX];
    setSnapIndex(DEFAULT_SNAP_INDEX);
    snapIndexRef.current = DEFAULT_SNAP_INDEX;
    applyVisual(0, 0, false);
    setEntered(false);

    const raf = requestAnimationFrame(() => {
      setEntered(true);
      applyVisual(target, 0, true, SNAP_MS);
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isMobile, applyVisual]);

  useEffect(() => {
    if (!open || !isMobile || dragActiveRef.current || closingRef.current) return;
    applyVisual(heights[snapIndexRef.current], 0, true, SNAP_MS);
  }, [heights, open, isMobile, applyVisual]);

  const animateToSnap = useCallback((snap: SnapIndex) => {
    setSnapIndex(snap);
    snapIndexRef.current = snap;
    applyVisual(heightsRef.current[snap], 0, true, SNAP_MS);
  }, [applyVisual]);

  const animateClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    const h = heightRef.current;
    applyVisual(h, h + 24, true, CLOSE_MS);
    window.setTimeout(() => {
      onCloseRef.current();
    }, CLOSE_MS);
  }, [applyVisual]);

  const canStartDrag = useCallback((target: EventTarget | null) => {
    if (!isNarrowViewport()) return false;
    if (closingRef.current) return false;
    const el = target as HTMLElement | null;
    if (!el) return false;
    if (el.closest('[data-sheet-no-drag]')) return false;
    if (el.closest('button, a, input, textarea, select, [role="button"]')) return false;
    if (el.closest('[data-sheet-handle]')) return true;
    return (contentRef.current?.scrollTop ?? 0) <= 0;
  }, []);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (!canStartDrag(e.target)) return;
    const y = e.touches[0].clientY;
    dragActiveRef.current = true;
    dragStartYRef.current = y;
    dragStartHeightRef.current = heightRef.current - dismissYRef.current;
    lastTouchYRef.current = y;
    lastTouchTimeRef.current = performance.now();
    velocityYRef.current = 0;
    setIsDragging(true);
    applyVisual(heightRef.current, dismissYRef.current, false);
  }, [canStartDrag, applyVisual]);

  const onTouchEnd = useCallback(() => {
    if (!dragActiveRef.current) return;
    dragActiveRef.current = false;
    setIsDragging(false);

    const result = resolveReleaseSnap(
      heightsRef.current,
      heightRef.current,
      dismissYRef.current,
      velocityYRef.current,
      snapIndexRef.current,
    );

    if (result === 'close') {
      animateClose();
      return;
    }
    animateToSnap(result);
  }, [animateClose, animateToSnap]);

  useEffect(() => {
    const sheet = sheetRef.current;
    if (!open || !isMobile || !sheet) return;

    const onMove = (e: TouchEvent) => {
      if (!dragActiveRef.current) return;
      const y = e.touches[0].clientY;
      const now = performance.now();
      const dt = Math.max(1, now - lastTouchTimeRef.current);
      const instantV = (y - lastTouchYRef.current) / dt;
      velocityYRef.current = velocityYRef.current * 0.6 + instantV * 0.4;
      lastTouchYRef.current = y;
      lastTouchTimeRef.current = now;

      const dy = y - dragStartYRef.current;
      // Drag down → shorter sheet; drag up → taller
      let nextHeight = dragStartHeightRef.current - dy;
      let dismissY = 0;
      const peek = heightsRef.current[0];
      const full = heightsRef.current[2];

      if (nextHeight > full) {
        const over = nextHeight - full;
        nextHeight = full + over * UP_DRAG_RESISTANCE;
      } else if (nextHeight < peek) {
        dismissY = peek - nextHeight;
        nextHeight = peek;
      }

      if (Math.abs(dy) > 6) e.preventDefault();
      applyVisual(nextHeight, dismissY, false);
    };

    sheet.addEventListener('touchmove', onMove, { passive: false });
    return () => sheet.removeEventListener('touchmove', onMove);
  }, [open, isMobile, applyVisual]);

  const handleOverlayClick = () => {
    if (!closeOnOverlayClick || closingRef.current) return;
    if (isMobile) {
      animateClose();
      return;
    }
    (onOverlayClick ?? onClose)();
  };

  if (!open) return null;

  const showHeader = !hideDefaultHeader && (title || subtitle || headerRight);
  const isDrawerRight = desktopLayout === 'drawer-right';
  const outerPositionClass = desktopFullScreen
    ? 'max-md:items-end md:items-stretch md:justify-stretch md:p-0'
    : isDrawerRight
      ? 'max-md:items-end md:items-stretch md:justify-end'
      : 'max-md:items-end md:items-center md:justify-center md:p-4';
  const sheetLayoutClass = desktopFullScreen
    ? 'md:rounded-none md:border-0 md:max-w-none md:w-full md:h-full md:max-h-full'
    : isDrawerRight
      ? 'md:ml-auto md:h-full md:max-h-full md:max-w-md md:w-full md:rounded-none md:border-l md:border-t-0'
      : 'md:rounded-2xl md:border md:border-base-200/80 md:max-w-3xl md:max-h-[90vh] md:transition-all md:duration-200 md:ease-out';
  const desktopCenterMotion = !isDrawerRight && !isMobile
    ? entered
      ? 'md:scale-100 md:opacity-100'
      : 'md:scale-[0.97] md:opacity-0'
    : '';

  const mobileSheetStyle: React.CSSProperties | undefined = isMobile
    ? {
        height: heightRef.current || heights[DEFAULT_SNAP_INDEX],
        maxHeight: heightRef.current || heights[DEFAULT_SNAP_INDEX],
        transform: `translate3d(0, ${dismissYRef.current}px, 0)`,
        transition: isDragging
          ? 'none'
          : `height ${SNAP_MS}ms ${SHEET_EASING}, transform ${SNAP_MS}ms ${SHEET_EASING}`,
        willChange: 'height, transform',
      }
    : undefined;

  return createPortal(
    <div
      className={`fixed inset-0 ${scrollLock === 'mobile' ? 'md:pointer-events-none' : ''}`}
      style={{ zIndex }}
      role="presentation"
    >
      <div
        ref={overlayRef}
        className={`absolute inset-0 bg-black/50 ${overlayClassName}`}
        style={isMobile ? { opacity: 0.55 } : undefined}
        onClick={handleOverlayClick}
        aria-hidden="true"
      />
      <div className={`fixed inset-0 flex pointer-events-none ${outerPositionClass}`}>
        <div
          ref={sheetRef}
          className={`pointer-events-auto flex w-full flex-col overflow-hidden bg-base-100 shadow-2xl border-base-200 max-md:rounded-t-3xl max-md:border-t max-md:max-h-none ${sheetLayoutClass} ${desktopCenterMotion} ${sheetClassName}`}
          style={mobileSheetStyle}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchEnd}
        >
          {!hideDragHandle && (
            <div
              data-sheet-handle
              className="md:hidden flex shrink-0 justify-center pt-3 pb-1 touch-none cursor-grab active:cursor-grabbing"
              aria-hidden="true"
            >
              <div className="h-1.5 w-12 rounded-full bg-base-300" />
            </div>
          )}

          {showHeader && (
            <div
              data-sheet-handle
              className={`flex shrink-0 items-start justify-between gap-3 border-b border-base-200/80 bg-base-100 px-4 py-3.5 md:px-6 md:py-4 ${headerClassName}`}
            >
              <div className="min-w-0 flex-1">
                {title && (
                  <h2 id={titleId} className="text-lg font-semibold tracking-tight text-base-content md:text-xl">
                    {title}
                  </h2>
                )}
                {subtitle && (
                  <p className="mt-1 text-sm text-base-content/55">{subtitle}</p>
                )}
              </div>
              {headerRight ? (
                <div className="flex shrink-0 items-center gap-1" data-sheet-no-drag>
                  {headerRight}
                </div>
              ) : null}
            </div>
          )}

          <div
            ref={contentRef}
            className={`min-h-0 flex-1 overflow-y-auto overscroll-contain ${contentClassName}`}
            data-sheet-scroll
          >
            {children}
          </div>

          {footer && (
            <div
              className={`shrink-0 border-t border-base-200/80 bg-base-100/95 backdrop-blur-sm ${footerClassName}`}
              style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))' }}
              data-sheet-no-drag
            >
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
