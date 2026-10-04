import React, { useState } from 'react';

type Props = {
  label: string;
  /**
   * Keeps the label lifted while the control is not focused.
   *
   * Pass `true` for selects and other controls that always hold a value, so their label never drops
   * back over the displayed value.
   */
  hasValue: boolean;
  className?: string;
  children: React.ReactNode;
};

/**
 * Floating label wrapper: the label sits inside the control and lifts onto its top border once the
 * control is focused or filled. Matches the lead search filters.
 *
 * Focus is tracked here through capture handlers rather than by each caller, which otherwise needs a
 * piece of state per field. The top padding is reserved unconditionally so the lifted label cannot
 * shift the surrounding layout when focus arrives.
 */
const FloatingLabelField: React.FC<Props> = ({ label, hasValue, className = '', children }) => {
  const [focused, setFocused] = useState(false);
  const floated = focused || hasValue;

  return (
    <div
      className={`relative pt-2 ${className}`.trim()}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={() => setFocused(false)}
    >
      <div className="relative">
        {children}
        <span
          aria-hidden
          className={
            floated
              ? 'pointer-events-none absolute left-2.5 top-0 z-[1] max-w-[calc(100%-1.25rem)] -translate-y-1/2 truncate bg-white px-1 text-xs font-medium text-base-content/65 transition-[color,font-size,transform,top] duration-200 ease-out dark:bg-base-100'
              : 'pointer-events-none absolute left-3 top-1/2 z-[1] max-w-[calc(100%-1.5rem)] -translate-y-1/2 truncate text-sm font-medium text-gray-500 transition-[color,font-size,transform,top] duration-200 ease-out dark:text-base-content/45'
          }
        >
          {label}
        </span>
      </div>
    </div>
  );
};

export default FloatingLabelField;
