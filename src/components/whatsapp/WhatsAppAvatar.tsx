import React from 'react';

interface WhatsAppAvatarProps {
  name: string;
  profilePictureUrl?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const WhatsAppAvatar: React.FC<WhatsAppAvatarProps> = ({
  name,
  profilePictureUrl,
  size = 'md',
  className = ''
}) => {
  // Get initials from name
  const getInitials = (name: string): string => {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  const sizeClasses = {
    sm: 'w-8 h-8 text-xs',
    md: 'w-10 h-10 text-sm',
    lg: 'w-12 h-12 text-base'
  };

  const initials = getInitials(name);

  return (
    <div className={`${sizeClasses[size]} ${className} rounded-full flex items-center justify-center overflow-hidden flex-shrink-0 border bg-green-100 border-green-200 text-green-700 shadow-[0_4px_12px_rgba(16,185,129,0.2)] font-semibold`}>
      {profilePictureUrl ? (
        <img
          src={profilePictureUrl}
          alt={name}
          className="w-full h-full object-cover"
          onError={(e) => {
            // Fallback to initials if image fails to load
            const target = e.target as HTMLImageElement;
            target.style.display = 'none';
            const parent = target.parentElement;
            if (parent) {
              parent.innerHTML = `<span class="flex items-center justify-center w-full h-full text-green-700 font-semibold">${initials}</span>`;
            }
          }}
        />
      ) : (
        <span>{initials}</span>
      )}
    </div>
  );
};

export default WhatsAppAvatar;

