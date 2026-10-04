import React from 'react';

export type SegmentedToggleOption<T extends string> = {
  value: T;
  label: string;
};

type Props<T extends string> = {
  options: SegmentedToggleOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Describes the group for screen readers, e.g. 'VAT' or 'Due dates'. */
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
};

/**
 * Pill-shaped segmented control — the modal toolbars' standard two-or-more-way switch.
 *
 * Shared so every switch of this kind stays identical: the VAT toggle and the auto plan's due-date
 * mode are the same control with different labels, and they had drifted apart as separate markup.
 */
function SegmentedToggle<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  disabled = false,
  className = '',
}: Props<T>) {
  const segmentClass = (active: boolean) =>
    `rounded-full px-3.5 py-1.5 text-sm transition ${
      active
        ? 'bg-purple-200 font-semibold text-purple-900 shadow-sm'
        : 'font-medium text-slate-500 hover:text-slate-700'
    }`;

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={`inline-flex shrink-0 rounded-full bg-slate-100 p-1 ${className}`.trim()}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          disabled={disabled}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={segmentClass(value === option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export default SegmentedToggle;
