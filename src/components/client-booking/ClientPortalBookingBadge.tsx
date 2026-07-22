import React from 'react';

/** Marks meetings scheduled by the client via the public / portal booking link. */
export function ClientPortalBookingBadge({
  className = '',
  compact: _compact = false,
}: {
  className?: string;
  /** Kept for call-site compatibility; label is always "Client booking". */
  compact?: boolean;
}) {
  return (
    <span
      className={`inline-flex w-fit max-w-fit shrink-0 items-center self-start rounded-full border-0 bg-primary px-2.5 py-1 text-xs font-semibold leading-none text-primary-content whitespace-nowrap sm:text-sm ${className}`}
      title="Booked by client via portal"
    >
      Client booking
    </span>
  );
}

export default ClientPortalBookingBadge;
