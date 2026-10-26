import React, { useEffect, useState } from 'react';
import { initialsFromUploaderName, uploaderAvatarGradient } from '../lib/uploaderDisplay';

export type UploaderAttributionProps = {
  name?: string | null;
  photoUrl?: string | null;
  className?: string;
  imageClassName?: string;
  /** Overrides how the name itself reads, for a table that wants it quieter than the file name. */
  nameClassName?: string;
};

export function UploaderAttribution({
  name: nameProp,
  photoUrl: photoUrlProp,
  className = '',
  imageClassName = 'h-6 w-6',
  nameClassName = 'font-medium text-base-content/80',
}: UploaderAttributionProps) {
  const name = nameProp?.trim();
  const [photoFailed, setPhotoFailed] = useState(false);
  const photoUrl = typeof photoUrlProp === 'string' ? photoUrlProp.trim() : '';

  useEffect(() => {
    setPhotoFailed(false);
  }, [name, photoUrl]);

  if (!name) {
    return <span className="text-base-content/50">—</span>;
  }

  const initials = initialsFromUploaderName(name);
  const showPhoto = photoUrl.length > 0 && !photoFailed;

  return (
    <span className={`inline-flex max-w-full min-w-0 items-center gap-2 ${className}`}>
      {showPhoto ? (
        <img
          src={photoUrl}
          alt=""
          className={`${imageClassName} shrink-0 rounded-full object-cover outline-none`}
          loading="lazy"
          onError={() => setPhotoFailed(true)}
        />
      ) : (
        <span
          className={`${imageClassName} relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br ${uploaderAvatarGradient(
            name,
          )} text-xs font-semibold leading-none text-white shadow-sm outline-none`}
          aria-hidden
        >
          {/* The gloss: a highlight over the top half, the way a bead catches the light. */}
          <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 rounded-t-full bg-gradient-to-b from-white/45 to-white/0" />
          <span className="relative">{initials}</span>
        </span>
      )}
      <span className={`min-w-0 truncate ${nameClassName}`}>{name}</span>
    </span>
  );
}
