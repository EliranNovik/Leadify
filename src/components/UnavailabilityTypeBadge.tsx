import React from 'react';
import {
  unavailabilityTypeBadgeClass,
  unavailabilityTypeLabel,
  type UnavailabilityType,
} from '../lib/employeeUnavailabilities';

interface UnavailabilityTypeBadgeProps {
  type: UnavailabilityType | string;
  size?: 'sm' | 'xs' | 'md';
  borderless?: boolean;
  className?: string;
}

const UnavailabilityTypeBadge: React.FC<UnavailabilityTypeBadgeProps> = ({
  type,
  size = 'sm',
  borderless = false,
  className = '',
}) => {
  const sizeClass =
    size === 'xs' ? 'badge-xs' : size === 'md' ? 'badge-md text-sm font-medium' : 'badge-sm';
  return (
    <span
      className={`badge ${sizeClass} ${unavailabilityTypeBadgeClass(type)} ${borderless ? 'border-0' : ''} ${className}`.trim()}
    >
      {unavailabilityTypeLabel(type)}
    </span>
  );
};

export default UnavailabilityTypeBadge;
