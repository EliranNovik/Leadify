import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { XMarkIcon } from '@heroicons/react/24/outline';

const DISMISS_DRAG_PX = 100;
const UP_DRAG_RESISTANCE = 0.25;

function isNarrowViewport(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(max-width: 767px)').matches;
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
  /** Desktop: centered modal (default) or right-edge drawer */
  desktopLayout?: 'center' | 'drawer-right';
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
  desktopLayout = 'center',
  closeOnOverlayClick = true,
  onOverlayClick,
  scrollLock = 'always',
}: MobileBottomSheetProps) {
  const autoTitleId = useId();
  const titleId = ariaLabelledBy || (title ? autoTitleId : undefined);
  const contentRef = useRef<HTMLDivElement>(null);
  const dragStartYRef = useRef(0);
  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (!open) {
      setEntered(false);
      setDragY(0);
      return;
    }
    const shouldLockScroll = scrollLock === 'always' || isNarrowViewport();
    const prevOverflow = document.body.style.overflow;
    if (shouldLockScroll) {
      document.body.style.overflow = 'hidden';
    }
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => {
      cancelAnimationFrame(raf);
      if (shouldLockScroll) {
        document.body.style.overflow = prevOverflow;
      }
    };
  }, [open, scrollLock]);

  const canStartDrag = useCallback((target: EventTarget | null) => {
    if (!isNarrowViewport()) return false;
    const el = target as HTMLElement | null;
    if (!el) return false;
    if (el.closest('[data-sheet-no-drag]')) return false;
    if (el.closest('[data-sheet-handle]')) return true;
    return (contentRef.current?.scrollTop ?? 0) <= 0;
  }, []);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (!canStartDrag(e.target)) return;
    dragStartYRef.current = e.touches[0].clientY;
    setIsDragging(true);
  }, [canStartDrag]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging) return;
    const dy = e.touches[0].clientY - dragStartYRef.current;
    if (dy < 0) {
      setDragY(dy * UP_DRAG_RESISTANCE);
    } else {
      setDragY(dy);
    }
  }, [isDragging]);

  const onTouchEnd = useCallback(() => {
    if (!isDragging) return;
    setIsDragging(false);
    if (dragY > DISMISS_DRAG_PX) {
      setDragY(0);
      onClose();
      return;
    }
    setDragY(0);
  }, [dragY, isDragging, onClose]);

  if (!open) return null;

  const mobileMaxH = mobileFullHeight ? 'max-md:max-h-[min(96dvh,100%)]' : 'max-md:max-h-[min(92dvh,100%)]';
  const translateY = isNarrowViewport()
    ? (entered ? Math.max(0, dragY) : (typeof window !== 'undefined' ? window.innerHeight : 800))
    : 0;
  const sheetTransform = isNarrowViewport()
    ? { transform: entered ? `translateY(${translateY}px)` : 'translateY(100%)' }
    : undefined;
  const sheetTransition = isDragging
    ? 'none'
    : 'transform 0.32s cubic-bezier(0.32, 0.72, 0, 1)';

  const showHeader = !hideDefaultHeader && (title || subtitle || headerRight);

  const isDrawerRight = desktopLayout === 'drawer-right';
  const outerPositionClass = isDrawerRight
    ? 'max-md:items-end md:items-stretch md:justify-end'
    : 'max-md:items-end md:items-center md:justify-center md:p-4';
  const sheetLayoutClass = isDrawerRight
    ? 'md:ml-auto md:h-full md:max-h-full md:max-w-md md:w-full md:rounded-none md:border-l md:border-t-0'
    : 'md:rounded-2xl md:border md:max-w-3xl md:max-h-[90vh]';

  return createPortal(
    <div
      className={`fixed inset-0 ${scrollLock === 'mobile' ? 'md:pointer-events-none' : ''}`}
      style={{ zIndex }}
      role="presentation"
    >
      <div
        className={`absolute inset-0 bg-black/50 transition-opacity duration-300 ${overlayClassName}`}
        onClick={() => {
          if (!closeOnOverlayClick) return;
          (onOverlayClick ?? onClose)();
        }}
        aria-hidden="true"
      />
      <div className={`fixed inset-0 flex pointer-events-none ${outerPositionClass}`}>
        <div
          className={`pointer-events-auto flex w-full flex-col overflow-hidden bg-base-100 shadow-2xl border-base-200 max-md:rounded-t-3xl max-md:border-t ${mobileMaxH} ${sheetLayoutClass} ${sheetClassName}`}
          style={{ ...sheetTransform, transition: sheetTransition }}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
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
              className="flex shrink-0 items-start justify-between gap-3 border-b border-base-200 px-4 py-3 md:px-6 md:py-4"
            >
              <div className="min-w-0 flex-1">
                {title && (
                  <h2 id={titleId} className="text-lg font-semibold text-base-content md:text-xl">
                    {title}
                  </h2>
                )}
                {subtitle && (
                  <p className="mt-0.5 text-sm text-base-content/60">{subtitle}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {headerRight}
                <button
                  type="button"
                  className="btn btn-ghost btn-circle btn-sm"
                  onClick={onClose}
                  aria-label="Close"
                >
                  <XMarkIcon className="h-5 w-5" />
                </button>
              </div>
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
              className="shrink-0 border-t border-base-200 bg-base-100"
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
