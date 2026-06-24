import React, { useEffect, useState } from 'react';
import { initialsFromUploaderName } from '../lib/uploaderDisplay';

export type UploaderAttributionProps = {
  name?: string | null;
  photoUrl?: string | null;
  className?: string;
  imageClassName?: string;
};

export function UploaderAttribution({
  name: nameProp,
  photoUrl: photoUrlProp,
  className = '',
  imageClassName = 'h-6 w-6',
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
          className={`${imageClassName} flex shrink-0 items-center justify-center rounded-full bg-gray-200 text-xs font-semibold leading-none text-gray-700 outline-none dark:bg-gray-600 dark:text-gray-100`}
          aria-hidden
        >
          {initials}
        </span>
      )}
      <span className="min-w-0 truncate font-medium text-base-content/80">{name}</span>
    </span>
  );
}
