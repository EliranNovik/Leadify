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
  deductedHoursLabel?: string;
  tooltip?: string;
  displayLabel?: string;
  subtitle?: string;
}

export function UnavailabilityTypeIcon({
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
  deductedHoursLabel,
  tooltip,
  displayLabel,
  subtitle,
}) => {
  const sizeClass =
    size === 'xs' ? 'badge-xs' : size === 'md' ? 'badge-md text-sm font-medium' : 'badge-sm';
  const iconSize = size === 'md' ? 'h-5 w-5 shrink-0' : size === 'xs' ? 'h-4 w-4 shrink-0' : 'h-5 w-5 shrink-0';

  const badge = (
    <span
      className={`badge inline-flex items-center gap-1.5 ${sizeClass} ${
        subtitle ? 'h-auto min-h-0 py-1.5' : ''
      } ${unavailabilityTypeBadgeClass(type)} ${borderless ? 'border-0' : ''} ${className}`.trim()}
    >
      <UnavailabilityTypeIcon type={type} className={iconSize} />
      {subtitle ? (
        <span className="flex min-w-0 flex-col items-start leading-tight">
          <span className="font-semibold">{displayLabel || unavailabilityTypeLabel(type)}</span>
          <span
            className="max-w-[9rem] truncate text-xs font-normal opacity-75"
            title={subtitle}
          >
            {subtitle}
          </span>
        </span>
      ) : (
        displayLabel || unavailabilityTypeLabel(type)
      )}
    </span>
  );

  if (!deductedHoursLabel) return badge;

  return (
    <span
      className="relative inline-flex"
      title={tooltip}
      aria-label={tooltip}
    >
      {badge}
      <span className="badge badge-error badge-xs absolute -right-2 -top-2 z-10 border-0 font-bold text-white shadow-sm">
        -{deductedHoursLabel}
      </span>
    </span>
  );
};

export default UnavailabilityTypeBadge;
