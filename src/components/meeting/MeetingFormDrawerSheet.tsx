import React from 'react';
import MobileBottomSheet from '../MobileBottomSheet';

export type MeetingFormDrawerSheetProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  footer: React.ReactNode;
  children: React.ReactNode;
  zIndex?: number;
  /**
   * When true, only render the native bottom sheet on mobile viewports.
   * Desktop callers should navigate to a dedicated page instead.
   */
  mobileOnly?: boolean;
  /**
   * Desktop/page mode: render form inline (no drawer chrome). Used by ScheduleMeetingPage.
   */
  inlinePage?: boolean;
};

/** Schedule / reschedule meeting: bottom sheet on mobile; optional inline page on desktop. */
export default function MeetingFormDrawerSheet({
  open,
  onClose,
  title,
  footer,
  children,
  zIndex = 320,
  mobileOnly = false,
  inlinePage = false,
}: MeetingFormDrawerSheetProps) {
  const isMobile =
    typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;

  if (inlinePage) {
    if (!open) return null;
    return (
      <div className="flex flex-col gap-5">
        <div className="px-0 py-0">{children}</div>
        {footer ? <div className="px-0 py-0">{footer}</div> : null}
      </div>
    );
  }

  if (mobileOnly && !isMobile) {
    return null;
  }

  return (
    <MobileBottomSheet
      open={open}
      onClose={onClose}
      title={title}
      mobileFullHeight
      desktopLayout="drawer-right"
      zIndex={zIndex}
      sheetClassName="md:max-w-md"
      contentClassName="px-4 py-4 md:px-6 md:py-5"
      footer={footer}
    >
      {children}
    </MobileBottomSheet>
  );
}

export function MeetingFormDrawerFooter({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex gap-3 p-4 max-md:flex-col-reverse md:justify-end md:px-6 ${className}`.trim()}
    >
      {children}
    </div>
  );
}

type MeetingFormDrawerActionButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement>;

export function MeetingFormDrawerActionButton({
  className = '',
  children,
  ...props
}: MeetingFormDrawerActionButtonProps) {
  return (
    <button
      type="button"
      className={`btn max-md:min-h-12 max-md:w-full md:w-auto ${className}`.trim()}
      {...props}
    >
      {children}
    </button>
  );
}
