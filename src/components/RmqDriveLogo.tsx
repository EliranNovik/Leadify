import React from 'react';

/**
 * The drive's mark: a folder inside a broken ring of three arcs, which reads as files kept in
 * sync. Drawn rather than loaded so it stays sharp at any size, and it sits on the page with no
 * tile behind it, so the arcs are the shape you see.
 */
export function RmqDriveLogo({
  className = '',
  title = 'RMQ Drive',
  animated = false,
}: {
  className?: string;
  title?: string;
  /** Plays the arcs in once, for the mark that greets you on opening the drive. */
  animated?: boolean;
}) {
  // Two of these on one page would otherwise share gradient ids, and the second would win.
  const uid = React.useId().replace(/[^a-zA-Z0-9]/g, '');

  return (
    <svg
      viewBox="0 0 40 40"
      role="img"
      aria-label={title}
      className={`shrink-0 ${animated ? 'rmq-drive-animated' : ''} ${className}`.trim()}
    >
      <defs>
        <linearGradient id={`rd-a-${uid}`} x1="0.2" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#8b5cf6" />
          <stop offset="100%" stopColor="#3b28c7" />
        </linearGradient>
        <linearGradient id={`rd-b-${uid}`} x1="1" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#e879f9" />
          <stop offset="100%" stopColor="#7c3aed" />
        </linearGradient>
        <linearGradient id={`rd-c-${uid}`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#22d3ee" />
          <stop offset="100%" stopColor="#4f46e5" />
        </linearGradient>
        <linearGradient id={`rd-folder-${uid}`} x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0%" stopColor="#6a5bea" />
          <stop offset="100%" stopColor="#3b28c7" />
        </linearGradient>
      </defs>

      {/* Three arcs around the folder, each stopping short of the next. They are listed the way
          they run around the ring, which is the order the entrance draws them in. `pathLength`
          normalises all three, so one dash rule draws arcs of any length. */}
      <g className="rmq-drive-arcs" fill="none" strokeWidth="4" strokeLinecap="round">
        <path
          className="rmq-drive-arc"
          pathLength={100}
          d="M22.78 4.24A16 16 0 0 1 35.04 25.47"
          stroke={`url(#rd-a-${uid})`}
        />
        <path
          className="rmq-drive-arc"
          pathLength={100}
          d="M32.26 30.28A16 16 0 0 1 7.74 30.28"
          stroke={`url(#rd-b-${uid})`}
        />
        <path
          className="rmq-drive-arc"
          pathLength={100}
          d="M4.96 25.47A16 16 0 0 1 17.22 4.24"
          stroke={`url(#rd-c-${uid})`}
        />
      </g>

      {/* The folder, a shade lighter across its back than its front. */}
      <g className="rmq-drive-folder">
        <path
          d="M11.4 16.3a1.9 1.9 0 0 1 1.9-1.9h2.9c.56 0 1.1.25 1.46.68l.63.75h6.41a1.9 1.9 0 0 1 1.9 1.9v6.57a1.9 1.9 0 0 1-1.9 1.9H13.3a1.9 1.9 0 0 1-1.9-1.9z"
          fill={`url(#rd-folder-${uid})`}
          fillOpacity="0.55"
        />
        <path
          d="M11.4 18.7h17.2v5.6a1.9 1.9 0 0 1-1.9 1.9H13.3a1.9 1.9 0 0 1-1.9-1.9z"
          fill={`url(#rd-folder-${uid})`}
        />
      </g>
    </svg>
  );
}

export default RmqDriveLogo;
