import type React from 'react';

/** Client page route for a lead, identified by its lead number (or id for legacy rows). */
export function leadRoutePath(navId: string | number, search?: string): string {
  return `/clients/${encodeURIComponent(String(navId))}${search || ''}`;
}

/**
 * Row click behaviour shared by the pipeline tables: plain click navigates in place,
 * Cmd/Ctrl click (or middle click) opens the lead in a new tab.
 */
export function openLeadFromRowClick(
  event: React.MouseEvent | undefined,
  navId: string | number,
  navigate: (path: string) => void,
): void {
  const path = leadRoutePath(navId);
  if (event && (event.metaKey || event.ctrlKey || event.button === 1)) {
    event.preventDefault();
    window.open(path, '_blank', 'noopener');
    return;
  }
  navigate(path);
}
