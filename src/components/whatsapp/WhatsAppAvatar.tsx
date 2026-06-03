import React from 'react';
import { whatsAppAvatarBackgroundStyle } from '../../lib/whatsappAvatarColors';

interface WhatsAppAvatarProps {
  name: string;
  profilePictureUrl?: string | null;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  /** Stable key (client id, contact id) for consistent background color. */
  colorSeed?: string;
}

const WhatsAppAvatar: React.FC<WhatsAppAvatarProps> = ({
  name,
  profilePictureUrl,
  size = 'md',
  className = '',
  colorSeed,
}) => {
  const getInitial = (displayName: string): string => {
    const trimmed = displayName?.trim();
    if (!trimmed) return '?';
    return trimmed.charAt(0).toUpperCase();
  };

  const sizeClasses = {
    sm: 'w-8 h-8 text-sm',
    md: 'w-10 h-10 text-base',
    lg: 'w-12 h-12 text-lg',
    xl: 'w-14 h-14 text-xl',
  };

  const seed = colorSeed || name;
  const initial = getInitial(name);
  const avatarStyle = whatsAppAvatarBackgroundStyle(seed);

  return (
    <div
      className={`${sizeClasses[size]} ${className} rounded-full flex items-center justify-center overflow-hidden flex-shrink-0 font-bold tracking-tight shadow-sm`}
      style={avatarStyle}
    >
      {profilePictureUrl ? (
        <img
          src={profilePictureUrl}
          alt={name}
          className="w-full h-full object-cover"
          onError={(e) => {
            const target = e.target as HTMLImageElement;
            target.style.display = 'none';
            const parent = target.parentElement;
            if (parent) {
              const span = document.createElement('span');
              span.className =
                'flex items-center justify-center w-full h-full font-bold text-white';
              span.textContent = initial;
              parent.appendChild(span);
            }
          }}
        />
      ) : (
        <span className="text-white font-bold leading-none select-none">{initial}</span>
      )}
    </div>
  );
};

export default WhatsAppAvatar;
