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
  mapActionsClassName?: string;
  mapButtonClassName?: string;
};

const URL_PATTERN = /https?:\/\/\S+/gi;

/** Addresses are free text, so collapse ragged spacing and pull map URLs out of the body copy. */
function splitAddress(address: string): { text: string; links: string[] } {
  const links = Array.from(new Set(address.match(URL_PATTERN) ?? []));
  const text = address
    .replace(URL_PATTERN, ' ')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
  return { text, links };
}

function linkHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function mapLinkLabel(url: string): string {
  const host = linkHost(url);
  if (host.includes('waze')) return 'Waze';
  if (host.includes('google')) return 'Google Maps';
  if (host.includes('apple')) return 'Apple Maps';
  return 'Open map link';
}

function googleMapsSearchUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** Recognizable Google Maps pin mark for the maps action button. */
function GoogleMapsIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden focusable="false">
      <path
        fill="#EA4335"
        d="M12 2.5C8.41 2.5 5.5 5.41 5.5 9c0 4.88 5.35 10.86 6.18 11.75a.5.5 0 0 0 .64 0C13.15 19.86 18.5 13.88 18.5 9c0-3.59-2.91-6.5-6.5-6.5z"
      />
      <circle cx="12" cy="9" r="3.25" fill="#FFFFFF" />
      <circle cx="12" cy="9" r="1.7" fill="#4285F4" />
    </svg>
  );
}

const PortalMeetingLocationLines: React.FC<Props> = ({
  location,
  isPhysicalMeeting,
  meetingAddress,
  className = 'mt-2 space-y-1',
  locationClassName = 'flex items-center gap-1.5 text-sm text-base-content/55',
  addressClassName = 'pl-5 text-sm leading-relaxed text-base-content/45 whitespace-pre-line break-words [overflow-wrap:anywhere]',
  mapActionsClassName = 'flex flex-wrap gap-2 pl-5 pt-1',
  mapButtonClassName = 'inline-flex h-9 min-h-9 items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3.5 text-sm font-medium text-gray-800 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50',
}) => {
  const resolved = resolvePortalMeetingLocationDisplay(location, {
    isPhysicalMeeting,
    meetingAddress,
  });
  if (!resolved.location) return null;

  const isTeams = resolved.location.toLowerCase() === 'teams';
  const Icon = isTeams ? VideoCameraIcon : MapPinIcon;
  const address = resolved.meetingAddress?.trim();
  const { text: addressText, links: addressLinks } =
    resolved.isPhysicalMeeting && address ? splitAddress(address) : { text: '', links: [] };

  const mapLinks = addressLinks.map((url) => ({ url, label: mapLinkLabel(url) }));
  const mapsQuery = [addressText.replace(/\n/g, ', '), resolved.location]
    .map((part) => part.trim())
    .filter(Boolean)[0];
  if (resolved.isPhysicalMeeting && mapsQuery && !addressLinks.some((url) => linkHost(url).includes('google'))) {
    mapLinks.push({ url: googleMapsSearchUrl(mapsQuery), label: 'Google Maps' });
  }

  return (
    <div className={className}>
      <p className={locationClassName}>
        <Icon className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
        <span className="truncate">{resolved.location}</span>
      </p>
      {addressText ? <p className={addressClassName}>{addressText}</p> : null}
      {mapLinks.length > 0 ? (
        <div className={mapActionsClassName}>
          {mapLinks.map(({ url, label }) => {
            const isGoogleMaps = label === 'Google Maps';
            return (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className={mapButtonClassName}
              >
                {isGoogleMaps ? (
                  <GoogleMapsIcon className="h-4 w-4 shrink-0" />
                ) : (
                  <MapPinIcon className="h-4 w-4 shrink-0 text-gray-500" aria-hidden />
                )}
                {label}
              </a>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};

export default PortalMeetingLocationLines;
