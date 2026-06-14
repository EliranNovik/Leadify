import React from 'react';
import {
  unavailabilityTypeBadgeClass,
  unavailabilityTypeLabel,
  type UnavailabilityType,
} from '../lib/employeeUnavailabilities';

interface UnavailabilityTypeBadgeProps {
  type: UnavailabilityType | string;
  size?: 'sm' | 'xs';
  className?: string;
}

const UnavailabilityTypeBadge: React.FC<UnavailabilityTypeBadgeProps> = ({
  type,
  size = 'sm',
  className = '',
}) => {
  const sizeClass = size === 'xs' ? 'badge-xs' : 'badge-sm';
  return (
    <span
      className={`badge ${sizeClass} ${unavailabilityTypeBadgeClass(type)} ${className}`.trim()}
    >
      {unavailabilityTypeLabel(type)}
    </span>
  );
};

export default UnavailabilityTypeBadge;
