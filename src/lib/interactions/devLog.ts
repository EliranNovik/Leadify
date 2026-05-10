/** Dev-only logging for interactions timeline — no-ops in production builds. */
const isDev = typeof import.meta !== 'undefined' && import.meta.env?.DEV;

export function interactionsDevLog(...args: unknown[]): void {
  if (isDev) console.log(...args);
}

export function interactionsDevWarn(...args: unknown[]): void {
  if (isDev) console.warn(...args);
}
