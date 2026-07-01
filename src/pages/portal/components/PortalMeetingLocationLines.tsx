import React from 'react';
import { MapPinIcon, VideoCameraIcon } from '@heroicons/react/24/outline';
import { resolvePortalMeetingLocationDisplay } from '../../../lib/meetingLocationUtils';

type Props = {
  location?: string | null;
  isPhysicalMeeting?: boolean;
  meetingAddress?: string | null;
  className?: string;
  locationClassName?: string;
  addressClassName?: string;
};

const PortalMeetingLocationLines: React.FC<Props> = ({
  location,
  isPhysicalMeeting,
  meetingAddress,
  className = 'mt-2 space-y-1',
  locationClassName = 'flex items-center gap-1.5 text-sm text-base-content/55',
  addressClassName = 'pl-5 text-sm leading-snug text-base-content/45 whitespace-pre-wrap',
}) => {
  const resolved = resolvePortalMeetingLocationDisplay(location, {
    isPhysicalMeeting,
    meetingAddress,
  });
  if (!resolved.location) return null;

  const isTeams = resolved.location.toLowerCase() === 'teams';
  const Icon = isTeams ? VideoCameraIcon : MapPinIcon;
  const address = resolved.meetingAddress?.trim();

  return (
    <div className={className}>
      <p className={locationClassName}>
        <Icon className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
        <span className="truncate">{resolved.location}</span>
      </p>
      {resolved.isPhysicalMeeting && address ? (
        <p className={addressClassName}>{address}</p>
      ) : null}
    </div>
  );
};

export default PortalMeetingLocationLines;
