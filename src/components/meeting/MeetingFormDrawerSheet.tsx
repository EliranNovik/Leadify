import React from 'react';
import MobileBottomSheet from '../MobileBottomSheet';

export type MeetingFormDrawerSheetProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  footer: React.ReactNode;
  children: React.ReactNode;
  zIndex?: number;
};

/** Schedule / reschedule meeting: bottom sheet on mobile, right drawer on desktop. */
export default function MeetingFormDrawerSheet({
  open,
  onClose,
  title,
  footer,
  children,
  zIndex = 320,
}: MeetingFormDrawerSheetProps) {
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

export function MeetingFormDrawerFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-3 p-4 max-md:flex-col-reverse md:justify-end md:px-6">
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
