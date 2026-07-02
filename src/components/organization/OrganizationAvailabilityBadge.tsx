import React from 'react';
import {
  ClockIcon,
  FaceFrownIcon,
  SunIcon,
  XCircleIcon,
} from '@heroicons/react/24/solid';
import {
  unavailabilityDateRangeLabel,
  unavailabilityTypeShortLabel,
  vacationPeriodLabel,
  type UnavailabilityType,
} from '../../lib/employeeUnavailabilities';

const AVAILABLE_BADGE_CLASS =
  'inline-flex items-center justify-center gap-2 rounded-full bg-black/50 p-2 text-[11px] font-semibold leading-none tracking-wide text-white shadow-sm backdrop-blur-md md:px-3 md:py-1.5 md:text-xs';

const UNAVAILABILITY_BADGE_CLASS: Record<UnavailabilityType, string> = {
  sick_days:
    'inline-flex items-center gap-1 rounded-full bg-orange-500 px-2 py-1 text-[10px] font-semibold leading-none tracking-wide text-white shadow-sm md:gap-1.5 md:px-3 md:py-1.5 md:text-xs',
  vacation:
    'inline-flex max-w-[calc(100%-0.25rem)] items-center gap-1 rounded-full bg-red-600 px-2 py-1 text-[10px] font-semibold leading-none tracking-wide text-white shadow-sm md:max-w-none md:gap-1.5 md:flex-col md:items-start md:gap-0.5 md:rounded-2xl md:px-2.5 md:py-1.5 md:leading-tight md:text-xs',
  general:
    'inline-flex items-center gap-1.5 rounded-full bg-slate-600 px-3 py-1.5 text-[11px] font-semibold leading-none tracking-wide text-white shadow-sm md:text-xs',
};

const UNAVAILABILITY_ICON_CLASS = 'h-3.5 w-3.5 shrink-0';
const UNAVAILABILITY_ICON_CLASS_MOBILE_SM =
  'h-3 w-3 shrink-0 md:h-5 md:w-5';

const UNAVAILABILITY_ICON: Record<UnavailabilityType, React.ReactNode> = {
  sick_days: <FaceFrownIcon className={UNAVAILABILITY_ICON_CLASS_MOBILE_SM} aria-hidden />,
  vacation: <SunIcon className={UNAVAILABILITY_ICON_CLASS_MOBILE_SM} aria-hidden />,
  general: <ClockIcon className={UNAVAILABILITY_ICON_CLASS} aria-hidden />,
};

type OrganizationAvailabilityBadgeProps = {
  isClockedIn: boolean;
  unavailabilityType: UnavailabilityType | null;
  unavailabilityStartDate?: string | null;
  unavailabilityEndDate?: string | null;
  className?: string;
  showUnavailableIcon?: boolean;
  /** Table rows always show vacation date range; chart cards keep compact Today labels on mobile. */
  variant?: 'default' | 'table';
};

const TABLE_VACATION_BADGE_CLASS =
  'inline-flex flex-col items-center gap-0.5 rounded-2xl bg-red-600 px-2 py-1.5 text-center text-[10px] font-semibold leading-tight tracking-wide text-white shadow-sm md:text-[11px]';

const OrganizationAvailabilityBadge: React.FC<OrganizationAvailabilityBadgeProps> = ({
  isClockedIn,
  unavailabilityType,
  unavailabilityStartDate = null,
  unavailabilityEndDate = null,
  className = '',
  showUnavailableIcon = false,
  variant = 'default',
}) => {
  if (isClockedIn) {
    return (
      <span className={`${AVAILABLE_BADGE_CLASS} ${className}`.trim()} title="Available">
        <span className="h-3 w-3 shrink-0 rounded-full bg-green-400 md:h-3 md:w-3" aria-hidden />
        <span className="hidden md:inline">Available</span>
      </span>
    );
  }

  if (unavailabilityType) {
    const label = unavailabilityTypeShortLabel(unavailabilityType);
    const vacationPeriod =
      unavailabilityType === 'vacation' && unavailabilityStartDate
        ? variant === 'table'
          ? unavailabilityDateRangeLabel(unavailabilityStartDate, unavailabilityEndDate)
          : vacationPeriodLabel(unavailabilityStartDate, unavailabilityEndDate)
        : null;
    const title = vacationPeriod ? `${label}: ${vacationPeriod}` : label;

    if (unavailabilityType === 'vacation' && vacationPeriod) {
      if (variant === 'table') {
        return (
          <span className={`${TABLE_VACATION_BADGE_CLASS} ${className}`.trim()} title={title}>
            <span className="inline-flex items-center gap-1">
              {UNAVAILABILITY_ICON.vacation}
              <span>{label}</span>
            </span>
            <span className="max-w-full whitespace-normal break-words px-0.5 text-[9px] font-medium opacity-95 md:text-[10px]">
              {vacationPeriod}
            </span>
          </span>
        );
      }

      return (
        <span
          className={`${UNAVAILABILITY_BADGE_CLASS.vacation} ${className}`.trim()}
          title={title}
        >
          <span className="inline-flex items-center gap-1 md:gap-1.5">
            {UNAVAILABILITY_ICON.vacation}
            <span>{label}</span>
          </span>
          <span className="hidden pl-[1.625rem] text-[9px] font-medium leading-tight opacity-95 md:block md:pl-[1.75rem] md:text-[10px]">
            {vacationPeriod}
          </span>
        </span>
      );
    }

    return (
      <span
        className={`${UNAVAILABILITY_BADGE_CLASS[unavailabilityType]} ${className}`.trim()}
        title={title}
      >
        {UNAVAILABILITY_ICON[unavailabilityType]}
        {label}
      </span>
    );
  }

  if (showUnavailableIcon) {
    return (
      <XCircleIcon className="mx-auto h-7 w-7 text-base-content/30 md:h-8 md:w-8" title="Not available" />
    );
  }

  return null;
};

export default OrganizationAvailabilityBadge;
