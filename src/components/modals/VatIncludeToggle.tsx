import React from 'react';
import SegmentedToggle from './SegmentedToggle';

type Props = {
  includeVat: boolean;
  onChange: (includeVat: boolean) => void;
  disabled?: boolean;
  className?: string;
};

/** Boolean wrapper over `SegmentedToggle`, keeping this component's existing callers unchanged. */
const VatIncludeToggle: React.FC<Props> = ({
  includeVat,
  onChange,
  disabled = false,
  className = '',
}) => (
  <SegmentedToggle
    ariaLabel="VAT"
    options={[
      { value: 'without', label: 'Without VAT' },
      { value: 'with', label: 'With VAT (18%)' },
    ]}
    value={includeVat ? 'with' : 'without'}
    onChange={(next) => onChange(next === 'with')}
    disabled={disabled}
    className={className}
  />
);

export default VatIncludeToggle;
