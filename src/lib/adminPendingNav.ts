export const ADMIN_PENDING_NAV_KEY = 'adminPendingNav';

export function setAdminPendingNav(tabLabel: string, subLabel: string) {
  sessionStorage.setItem(ADMIN_PENDING_NAV_KEY, JSON.stringify({ tabLabel, subLabel }));
}

export function consumeAdminPendingNav(): { tabLabel: string; subLabel: string } | null {
  const raw = sessionStorage.getItem(ADMIN_PENDING_NAV_KEY);
  if (!raw) return null;
  sessionStorage.removeItem(ADMIN_PENDING_NAV_KEY);
  try {
    const parsed = JSON.parse(raw) as { tabLabel?: string; subLabel?: string };
    if (parsed.tabLabel && parsed.subLabel) {
      return { tabLabel: parsed.tabLabel, subLabel: parsed.subLabel };
    }
  } catch {
    // ignore
  }
  return null;
}
