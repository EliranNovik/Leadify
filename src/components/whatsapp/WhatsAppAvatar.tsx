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
    <div className={`${sizeClasses[size]} ${className} rounded-full flex items-center justify-center overflow-hidden flex-shrink-0 text-white font-semibold shadow-sm`} style={{ background: 'linear-gradient(to bottom right, #059669, #0d9488)' }}>
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
              parent.innerHTML = `<span class="flex items-center justify-center w-full h-full">${initials}</span>`;
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

