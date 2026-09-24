import React from 'react';
import MobileBottomSheet from '../MobileBottomSheet';
import { DESKTOP_CENTER_MODAL_PROPS, ModalActionFooter } from '../EditFieldModal';

export const PROFILE_MODAL_Z_INDEX = 10050;
export const PROFILE_STACKED_MODAL_Z_INDEX = 10060;

export type ProfileBottomSheetModalProps = {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  onSave?: () => void;
  saving?: boolean;
  saveDisabled?: boolean;
  saveLabel?: React.ReactNode;
  saveTooltip?: string;
  cancelLabel?: string;
  cancelDisabled?: boolean;
  hideFooter?: boolean;
  zIndex?: number;
  closeOnOverlayClick?: boolean;
  mobileFullHeight?: boolean;
  sheetClassName?: string;
  headerClassName?: string;
  footerClassName?: string;
  headerRight?: React.ReactNode;
  confirmVariant?: 'primary' | 'success' | 'error';
};

export default function ProfileBottomSheetModal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  onSave,
  saving = false,
  saveDisabled = false,
  saveLabel = 'Save',
  saveTooltip,
  cancelLabel = 'Cancel',
  cancelDisabled = false,
  hideFooter = false,
  zIndex = PROFILE_MODAL_Z_INDEX,
  closeOnOverlayClick = true,
  mobileFullHeight = false,
  sheetClassName = '',
  headerClassName = '',
  footerClassName = '',
  headerRight,
  confirmVariant = 'primary',
}: ProfileBottomSheetModalProps) {
  const resolvedFooter = hideFooter
    ? undefined
    : footer ?? (
        onSave != null ? (
          <ModalActionFooter
            onCancel={onClose}
            onConfirm={onSave}
            loading={saving}
            disabled={saveDisabled}
            cancelDisabled={cancelDisabled || saving}
            confirmLabel={saveLabel}
            cancelLabel={cancelLabel}
            confirmVariant={confirmVariant}
            confirmTooltip={saveTooltip}
          />
        ) : undefined
      );

  return (
    <MobileBottomSheet
      open={open}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      headerRight={headerRight}
      zIndex={zIndex}
      closeOnOverlayClick={closeOnOverlayClick && !saving}
      mobileFullHeight={mobileFullHeight}
      desktopLayout="center"
      overlayClassName={DESKTOP_CENTER_MODAL_PROPS.overlayClassName}
      sheetClassName={`${DESKTOP_CENTER_MODAL_PROPS.sheetClassName} ${sheetClassName}`.trim()}
      contentClassName={DESKTOP_CENTER_MODAL_PROPS.contentClassName}
      headerClassName={headerClassName}
      footerClassName={`${DESKTOP_CENTER_MODAL_PROPS.footerClassName} ${footerClassName}`.trim()}
      footer={resolvedFooter}
    >
      {children}
    </MobileBottomSheet>
  );
}
