/** Shorter cache TTLs on narrow viewports — balances speed vs freshness on mobile. */

export function isNarrowViewport(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(max-width: 767px)').matches;
}

/** Desktop uses `desktopMs`; mobile uses `mobileMs` (defaults to 5 min). */
export function getMobileAwareCacheTtlMs(
  desktopMs: number,
  mobileMs: number = 5 * 60 * 1000
): number {
  return isNarrowViewport() ? mobileMs : desktopMs;
}
