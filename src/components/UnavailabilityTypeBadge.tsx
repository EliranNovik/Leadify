import React from 'react';
import {
  CalendarDaysIcon,
  FaceFrownIcon,
  SunIcon,
} from '@heroicons/react/24/outline';
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

function UnavailabilityTypeIcon({
  type,
  className,
}: {
  type: UnavailabilityType | string;
  className?: string;
}) {
  const iconClass = className || 'h-5 w-5 shrink-0';
  switch (type) {
    case 'sick_days':
      return <FaceFrownIcon className={iconClass} aria-hidden />;
    case 'vacation':
      return <SunIcon className={iconClass} aria-hidden />;
    case 'general':
      return <CalendarDaysIcon className={iconClass} aria-hidden />;
    default:
      return <CalendarDaysIcon className={iconClass} aria-hidden />;
  }
}

const UnavailabilityTypeBadge: React.FC<UnavailabilityTypeBadgeProps> = ({
  type,
  size = 'sm',
  borderless = false,
  className = '',
}) => {
  const sizeClass =
    size === 'xs' ? 'badge-xs' : size === 'md' ? 'badge-md text-sm font-medium' : 'badge-sm';
  const iconSize = size === 'md' ? 'h-5 w-5 shrink-0' : size === 'xs' ? 'h-4 w-4 shrink-0' : 'h-5 w-5 shrink-0';

  return (
    <span
      className={`badge inline-flex items-center gap-1.5 ${sizeClass} ${unavailabilityTypeBadgeClass(type)} ${borderless ? 'border-0' : ''} ${className}`.trim()}
    >
      <UnavailabilityTypeIcon type={type} className={iconSize} />
      {unavailabilityTypeLabel(type)}
    </span>
  );
};

export { UnavailabilityTypeIcon };
export default UnavailabilityTypeBadge;
