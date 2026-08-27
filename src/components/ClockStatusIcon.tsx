import React from 'react';

type ClockStatusIconProps = {
  className?: string;
  /** Clocked-in: thick clock plus a check badge. */
  checked?: boolean;
};

const ClockStatusIcon: React.FC<ClockStatusIconProps> = ({
  className = 'w-8 h-8',
  checked = false,
}) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    className={className}
    aria-hidden
  >
    <circle
      cx={checked ? 11 : 12}
      cy={checked ? 11 : 12}
      r={checked ? 7.05 : 8.05}
      stroke="currentColor"
      strokeWidth="2.45"
    />
    <path
      d={checked ? 'M11 7.2v4.1l2.65 1.5' : 'M12 7.2v5.05l3.3 1.85'}
      stroke="currentColor"
      strokeWidth="2.45"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {checked && (
      <g>
        <circle
          cx="17.45"
          cy="17.45"
          r="4.55"
          fill="#10b981"
          stroke="currentColor"
          strokeWidth="1.35"
        />
        <path
          d="M15.2 17.5l1.45 1.4 2.85-2.95"
          stroke="#fff"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    )}
  </svg>
);

export default ClockStatusIcon;
