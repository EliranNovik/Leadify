import React from 'react';
import { FlagIcon } from '@heroicons/react/24/outline';
import type { FlagTypeRow } from '../lib/userContentFlags';

type Props = {
  flagTypes: FlagTypeRow[];
  isFlagged: boolean;
  disabled?: boolean;
  onAdd: (flagTypeId: number) => void;
  onRemove: () => void;
  titleFlag?: string;
  titleRemove?: string;
  className?: string;
};

/**
 * Flag control: when not flagged, opens a dropdown to pick flag type; when flagged, one click removes.
 */
const FlagTypeFlagButton: React.FC<Props> = ({
  flagTypes,
  isFlagged,
  disabled,
  onAdd,
  onRemove,
  titleFlag = 'Flag',
  titleRemove = 'Remove my flag',
  className = '',
}) => {
  const addDisabled = Boolean(disabled || flagTypes.length === 0);

  if (isFlagged) {
    return (
      <button
        type="button"
        className={`btn btn-ghost btn-sm btn-square rounded-full text-amber-600 bg-amber-50 ${className}`}
        title={titleRemove}
        aria-pressed
        aria-label={titleRemove}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
      >
        <FlagIcon className="w-5 h-5 fill-current" />
      </button>
    );
  }

  return (
    <details className="dropdown dropdown-end" onClick={(e) => e.stopPropagation()}>
      <summary
        className={`btn btn-ghost btn-sm btn-square rounded-full text-gray-400 list-none [&::-webkit-details-marker]:hidden cursor-pointer ${addDisabled ? 'btn-disabled pointer-events-none opacity-50' : ''} ${className}`}
        title={titleFlag}
        aria-label={titleFlag}
        aria-haspopup="listbox"
        onClick={(e) => {
          if (addDisabled) e.preventDefault();
          e.stopPropagation();
        }}
      >
        <FlagIcon className="w-5 h-5" />
      </summary>
      <ul className="dropdown-content menu z-[50] mt-1 min-w-[10rem] rounded-box border border-base-300 bg-base-100 p-2 shadow-lg">
        {flagTypes.map((ft) => (
          <li key={ft.id}>
            <button
              type="button"
              className="w-full text-left text-sm"
              disabled={disabled}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const details = e.currentTarget.closest('details');
                if (details) details.removeAttribute('open');
                onAdd(ft.id);
              }}
            >
              {ft.label}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
};

export default FlagTypeFlagButton;
