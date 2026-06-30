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
  cancelLabel?: string;
  cancelDisabled?: boolean;
  hideFooter?: boolean;
  zIndex?: number;
  closeOnOverlayClick?: boolean;
  mobileFullHeight?: boolean;
  sheetClassName?: string;
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
  cancelLabel = 'Cancel',
  cancelDisabled = false,
  hideFooter = false,
  zIndex = PROFILE_MODAL_Z_INDEX,
  closeOnOverlayClick = true,
  mobileFullHeight = false,
  sheetClassName = '',
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
            saving={saving}
            disabled={saveDisabled}
            cancelDisabled={cancelDisabled || saving}
            saveLabel={saveLabel}
            cancelLabel={cancelLabel}
            confirmVariant={confirmVariant}
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
      footerClassName={DESKTOP_CENTER_MODAL_PROPS.footerClassName}
      footer={resolvedFooter}
    >
      {children}
    </MobileBottomSheet>
  );
}
