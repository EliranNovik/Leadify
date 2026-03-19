import React from 'react';

/** Minimal full-area loader for lazy route chunks (mobile-friendly). */
const PageLoader: React.FC = () => (
  <div
    className="flex min-h-[40vh] w-full flex-col items-center justify-center gap-3 bg-base-100 px-4"
    aria-busy="true"
    aria-label="Loading page"
  >
    <span className="loading loading-spinner loading-lg text-primary" />
    <span className="text-sm text-base-content/60">Loading…</span>
  </div>
);

export default PageLoader;
