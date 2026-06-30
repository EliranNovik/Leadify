import React from 'react';
import MobileBottomSheet from './MobileBottomSheet';

export const EDIT_FIELD_LABEL =
    'mb-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-base-content/45';

export const EDIT_FIELD_INPUT =
    'input input-bordered w-full bg-base-100 transition-shadow focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary/40';

export const EDIT_FIELD_TEXTAREA =
    'textarea textarea-bordered w-full bg-base-100 transition-shadow focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary/40';

export const EDIT_FIELD_DROPDOWN =
    'mt-2 max-h-60 overflow-y-auto rounded-xl border border-base-200/80 bg-base-100 shadow-lg ring-1 ring-black/5 dark:ring-white/10';

export const EDIT_FIELD_DROPDOWN_ITEM =
    'cursor-pointer px-4 py-2.5 text-sm text-base-content/90 transition-colors hover:bg-base-200/70 active:bg-base-200 dark:hover:bg-base-300/50';

export const DESKTOP_CENTER_MODAL_PROPS = {
    overlayClassName: 'backdrop-blur-[2px]',
    sheetClassName: 'md:max-w-lg md:w-full md:shadow-2xl md:ring-1 md:ring-black/5 dark:md:ring-white/10',
    contentClassName: 'px-5 py-5 md:px-6 md:py-6',
    footerClassName: 'px-5 py-4 md:px-6 md:py-4',
} as const;

export type ModalActionFooterProps = {
    onCancel: () => void;
    onConfirm: () => void;
    cancelLabel?: string;
    confirmLabel?: React.ReactNode;
    confirmVariant?: 'primary' | 'success' | 'error';
    loading?: boolean;
    disabled?: boolean;
    cancelDisabled?: boolean;
};

export function ModalActionFooter({
    onCancel,
    onConfirm,
    cancelLabel = 'Cancel',
    confirmLabel = 'Save',
    confirmVariant = 'primary',
    loading = false,
    disabled = false,
    cancelDisabled = false,
}: ModalActionFooterProps) {
    const confirmBtnClass =
        confirmVariant === 'success'
            ? 'btn-success'
            : confirmVariant === 'error'
              ? 'btn-error'
              : 'btn-primary';

    return (
        <div className="flex w-full flex-col-reverse gap-2 md:flex-row md:justify-end md:gap-3">
            <button
                type="button"
                className="btn btn-outline flex-1 md:min-w-[6.5rem] md:flex-none max-md:min-h-12"
                onClick={onCancel}
                disabled={cancelDisabled || loading}
            >
                {cancelLabel}
            </button>
            <button
                type="button"
                className={`btn ${confirmBtnClass} flex-1 md:min-w-[6.5rem] md:flex-none max-md:min-h-12`}
                onClick={onConfirm}
                disabled={disabled || loading}
            >
                {loading ? <span className="loading loading-spinner loading-sm" /> : confirmLabel}
            </button>
        </div>
    );
}

export type EditFieldModalProps = {
    open: boolean;
    onClose: () => void;
    title: React.ReactNode;
    subtitle?: React.ReactNode;
    children: React.ReactNode;
    onSave: () => void | Promise<void>;
    saving?: boolean;
    saveDisabled?: boolean;
    saveLabel?: string;
    cancelLabel?: string;
    zIndex?: number;
    closeOnOverlayClick?: boolean;
    mobileFullHeight?: boolean;
    sheetClassName?: string;
};

export function EditFieldModalFooter({
    onCancel,
    onSave,
    saving = false,
    saveDisabled = false,
    saveLabel = 'Save',
    cancelLabel = 'Cancel',
}: {
    onCancel: () => void;
    onSave: () => void;
    saving?: boolean;
    saveDisabled?: boolean;
    saveLabel?: string;
    cancelLabel?: string;
}) {
    return (
        <div className="flex w-full flex-col-reverse gap-2 md:flex-row md:justify-end md:gap-3">
            <button
                type="button"
                className="btn btn-outline flex-1 md:min-w-[6.5rem] md:flex-none max-md:min-h-12"
                onClick={onCancel}
                disabled={saving}
            >
                {cancelLabel}
            </button>
            <button
                type="button"
                className="btn btn-primary flex-1 md:min-w-[6.5rem] md:flex-none max-md:min-h-12"
                onClick={onSave}
                disabled={saving || saveDisabled}
            >
                {saving ? <span className="loading loading-spinner loading-sm" /> : saveLabel}
            </button>
        </div>
    );
}

export function EditFieldLabel({
    htmlFor,
    children,
}: {
    htmlFor?: string;
    children: React.ReactNode;
}) {
    return (
        <label htmlFor={htmlFor} className={EDIT_FIELD_LABEL}>
            {children}
        </label>
    );
}

export default function EditFieldModal({
    open,
    onClose,
    title,
    subtitle,
    children,
    onSave,
    saving = false,
    saveDisabled = false,
    saveLabel = 'Save',
    cancelLabel = 'Cancel',
    zIndex = 330,
    closeOnOverlayClick = true,
    mobileFullHeight = false,
    sheetClassName = '',
}: EditFieldModalProps) {
    return (
        <MobileBottomSheet
            open={open}
            onClose={onClose}
            title={title}
            subtitle={subtitle}
            zIndex={zIndex}
            closeOnOverlayClick={closeOnOverlayClick && !saving}
            mobileFullHeight={mobileFullHeight}
            desktopLayout="center"
            overlayClassName={DESKTOP_CENTER_MODAL_PROPS.overlayClassName}
            sheetClassName={`${DESKTOP_CENTER_MODAL_PROPS.sheetClassName} ${sheetClassName}`.trim()}
            contentClassName={DESKTOP_CENTER_MODAL_PROPS.contentClassName}
            footerClassName={DESKTOP_CENTER_MODAL_PROPS.footerClassName}
            footer={
                <EditFieldModalFooter
                    onCancel={onClose}
                    onSave={onSave}
                    saving={saving}
                    saveDisabled={saveDisabled}
                    saveLabel={saveLabel}
                    cancelLabel={cancelLabel}
                />
            }
        >
            {children}
        </MobileBottomSheet>
    );
}
