import React, { useEffect, useState } from 'react';

function initialsFromName(name?: string | null): string {
  const s = (name || '').trim();
  if (!s || s === '---') return '?';
  return (
    s
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || '?'
  );
}

type Props = {
  name?: string | null;
  imageUrl?: string | null;
  className?: string;
};

const ContactProfileAvatar: React.FC<Props> = ({
  name,
  imageUrl,
  className = 'h-10 w-10 text-sm',
}) => {
  const [broken, setBroken] = useState(false);
  const resolvedUrl = imageUrl?.trim() || '';
  const showImage = Boolean(resolvedUrl) && !broken;

  useEffect(() => {
    setBroken(false);
  }, [resolvedUrl]);

  return (
    <div
      className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-200 font-semibold text-gray-600 ${className}`}
    >
      {showImage ? (
        <img
          src={resolvedUrl}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setBroken(true)}
        />
      ) : (
        initialsFromName(name)
      )}
    </div>
  );
};

export default ContactProfileAvatar;
