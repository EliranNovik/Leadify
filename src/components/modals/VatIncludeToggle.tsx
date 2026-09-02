import React from 'react';

type Props = {
  includeVat: boolean;
  onChange: (includeVat: boolean) => void;
  disabled?: boolean;
  className?: string;
};

const VatIncludeToggle: React.FC<Props> = ({
  includeVat,
  onChange,
  disabled = false,
  className = '',
}) => {
  const segmentClass = (active: boolean) =>
    `rounded-full px-3.5 py-1.5 text-sm transition ${
      active
        ? 'bg-purple-600 font-semibold text-white shadow-sm'
        : 'font-medium text-slate-500 hover:text-slate-700'
    }`;

  return (
    <div
      role="group"
      aria-label="VAT"
      className={`inline-flex shrink-0 rounded-full bg-slate-100 p-1 ${className}`.trim()}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(false)}
        className={segmentClass(!includeVat)}
      >
        Without VAT
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(true)}
        className={segmentClass(includeVat)}
      >
        With VAT (18%)
      </button>
    </div>
  );
};

export default VatIncludeToggle;
