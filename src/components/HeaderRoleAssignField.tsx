import React, { useState } from 'react';
import { CheckIcon } from '@heroicons/react/24/solid';

export const HEADER_ROLE_ASSIGN_WIDTH_CLASS = 'w-[min(100%,13.5rem)]';

const LABEL_CLASS =
  'mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-base-content/45';

const INPUT_CLASS =
  'input w-full min-h-12 h-12 rounded-xl border border-base-200/80 bg-white px-3.5 text-base font-medium leading-snug text-base-content shadow-sm transition-all placeholder:text-base-content/35 focus:border-primary/45 focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-base-300/50 dark:bg-base-100';

const CONFIRM_BTN_CLASS =
  'btn btn-square min-h-12 h-12 w-12 shrink-0 rounded-xl border-0 bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-md transition-all hover:scale-[1.02] hover:from-emerald-600 hover:to-teal-700 hover:shadow-lg active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40';

export const HEADER_ROLE_ASSIGN_DROPDOWN_CLASS =
  'absolute top-[calc(100%+0.35rem)] left-0 z-[100] max-h-60 w-full overflow-y-auto rounded-xl border border-base-200/80 bg-base-100 py-1 shadow-xl ring-1 ring-black/5 dark:ring-white/10';

export const HEADER_ROLE_ASSIGN_DROPDOWN_ITEM_CLASS =
  'flex w-full items-center gap-3 px-3 py-2.5 text-left text-[15px] font-medium text-base-content/90 transition-colors hover:bg-base-200/70 disabled:opacity-50';

export type AssignFieldEmployeeRef = {
  id?: string | number | null;
  displayName: string;
  photoUrl?: string | null;
};

function getAssignFieldEmployeeInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.trim().slice(0, 2).toUpperCase();
}

function AssignFieldEmployeeAvatar({
  employee,
}: {
  employee?: AssignFieldEmployeeRef | null;
}) {
  const [imageError, setImageError] = useState(false);
  if (!employee?.displayName) {
    return <span className="h-10 w-10 shrink-0" aria-hidden />;
  }

  const photoUrl = employee.photoUrl?.trim() || '';
  const initials = getAssignFieldEmployeeInitials(employee.displayName);

  if (!photoUrl || imageError) {
    return (
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-base-200 text-xs font-semibold text-base-content/65"
        aria-hidden
      >
        {initials}
      </span>
    );
  }

  return (
    <img
      src={photoUrl}
      alt=""
      className="h-10 w-10 shrink-0 rounded-full object-cover"
      onError={() => setImageError(true)}
    />
  );
}

export function HeaderRoleAssignDropdownItem({
  label,
  onClick,
  disabled = false,
  employee,
  showAvatar = true,
}: {
  label: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  employee?: AssignFieldEmployeeRef | null;
  showAvatar?: boolean;
}) {
  return (
    <button
      type="button"
      className={HEADER_ROLE_ASSIGN_DROPDOWN_ITEM_CLASS}
      onClick={onClick}
      disabled={disabled}
    >
      {showAvatar ? <AssignFieldEmployeeAvatar employee={employee} /> : null}
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}

export type HeaderRoleAssignFieldProps = {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
  onConfirm: () => void;
  confirmDisabled?: boolean;
  inputDisabled?: boolean;
  confirmTitle?: string;
  containerRef?: React.RefObject<HTMLDivElement | null>;
  dropdownOpen?: boolean;
  dropdown?: React.ReactNode;
  className?: string;
};

export default function HeaderRoleAssignField({
  label,
  placeholder = '—',
  value,
  onChange,
  onFocus,
  onConfirm,
  confirmDisabled = false,
  inputDisabled = false,
  confirmTitle = 'Confirm assignment',
  containerRef,
  dropdownOpen = false,
  dropdown,
  className = '',
}: HeaderRoleAssignFieldProps) {
  return (
    <div
      ref={containerRef}
      className={`relative ${HEADER_ROLE_ASSIGN_WIDTH_CLASS} ${className}`.trim()}
      data-assign-dropdown="true"
      style={{ overflow: 'visible' }}
    >
      <label className={LABEL_CLASS}>{label}</label>
      <div className="flex items-stretch gap-1.5">
        <div className="relative min-w-0 flex-1">
          <input
            type="text"
            className={INPUT_CLASS}
            placeholder={placeholder}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onFocus={onFocus}
            autoComplete="off"
            disabled={inputDisabled}
          />
        </div>
        <button
          type="button"
          className={CONFIRM_BTN_CLASS}
          onClick={onConfirm}
          disabled={confirmDisabled || inputDisabled}
          title={confirmTitle}
          aria-label={confirmTitle}
        >
          <CheckIcon className="h-5 w-5" aria-hidden />
        </button>
      </div>
      {dropdownOpen && dropdown ? (
        <div className={HEADER_ROLE_ASSIGN_DROPDOWN_CLASS}>{dropdown}</div>
      ) : null}
    </div>
  );
}
