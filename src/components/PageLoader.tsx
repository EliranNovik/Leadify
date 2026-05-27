import React from 'react';

/** Minimal full-area loader for lazy route chunks (mobile-friendly). */
const PageLoader: React.FC = () => (
  <div
    className="flex min-h-[calc(100dvh-3.5rem)] w-full items-center justify-center bg-gray-100 dark:bg-base-300 px-4"
    aria-busy="true"
    aria-label="Loading"
  >
    <div
      className="flex items-center justify-center rounded-3xl p-3 md:p-4 shadow-xl animate-pulse"
      style={{ backgroundColor: '#301f8a' }}
    >
      <img
        src="/RMQ_LOGO.png"
        alt="RMQ"
        className="h-40 w-auto md:h-52 select-none"
        draggable={false}
      />
    </div>
  </div>
);

export default PageLoader;
