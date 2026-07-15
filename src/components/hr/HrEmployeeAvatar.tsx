import React, { useEffect, useState } from 'react';
import {
  getSalaryEmployeeInitials,
  salaryAvatarGradientStyle,
} from '../../lib/employeeSalaries';

type AvatarSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl';

const SIZE_CLASS: Record<AvatarSize, string> = {
  sm: 'h-9 w-9 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-12 w-12 text-base',
  xl: 'h-20 w-20 text-2xl',
  '2xl': 'h-28 w-28 md:h-36 md:w-36 text-3xl md:text-4xl',
};

export type HrEmployeeAvatarProps = {
  employeeId: number | null | undefined;
  name: string;
  photoUrl?: string | null;
  size?: AvatarSize;
  /** circle (default) or rounded square for profile headers */
  shape?: 'circle' | 'rounded';
  className?: string;
};

/**
 * Employee photo with initials fallback when missing or broken (common for empty CDN URLs).
 */
const HrEmployeeAvatar: React.FC<HrEmployeeAvatarProps> = ({
  employeeId,
  name,
  photoUrl,
  size = 'md',
  shape = 'circle',
  className = '',
}) => {
  const [imageError, setImageError] = useState(false);
  const label = name.trim() || 'Employee';
  const url = typeof photoUrl === 'string' ? photoUrl.trim() : '';

  useEffect(() => {
    setImageError(false);
  }, [url]);

  const showPhoto = url.length > 0 && !imageError;
  const id = employeeId != null && Number.isFinite(Number(employeeId)) ? Number(employeeId) : 0;
  const shapeClass = shape === 'rounded' ? 'rounded-2xl' : 'rounded-full';
  const sizeClass = SIZE_CLASS[size];

  if (showPhoto) {
    return (
      <img
        src={url}
        alt=""
        className={`${sizeClass} shrink-0 ${shapeClass} object-cover ${className}`.trim()}
        onError={() => setImageError(true)}
      />
    );
  }

  return (
    <span
      className={`${sizeClass} shrink-0 flex items-center justify-center ${shapeClass} font-bold text-white ${className}`.trim()}
      style={salaryAvatarGradientStyle(id, label)}
      aria-hidden
    >
      {getSalaryEmployeeInitials(label) || '?'}
    </span>
  );
};

export default HrEmployeeAvatar;
