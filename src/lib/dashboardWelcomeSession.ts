const STORAGE_KEY = 'crm_dashboard_welcome_v1';

export type DashboardWelcomeSession = {
  name: string;
  imageUrl: string;
  startedAt: number;
};

export function setDashboardWelcomePending(profile: { name: string; imageUrl: string }): void {
  if (typeof window === 'undefined') return;
  try {
    const payload: DashboardWelcomeSession = {
      name: profile.name,
      imageUrl: profile.imageUrl,
      startedAt: Date.now(),
    };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    sessionStorage.setItem('user_signed_in', 'true');
    sessionStorage.setItem('user_signed_in_timestamp', Date.now().toString());
  } catch {
    /* quota / private mode */
  }
}

export function hasDashboardWelcomePending(): boolean {
  return readDashboardWelcomePending() !== null;
}

export function readDashboardWelcomePending(): DashboardWelcomeSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DashboardWelcomeSession>;
    if (!parsed?.name || typeof parsed.startedAt !== 'number') return null;
    return {
      name: String(parsed.name),
      imageUrl: typeof parsed.imageUrl === 'string' ? parsed.imageUrl : '',
      startedAt: parsed.startedAt,
    };
  } catch {
    return null;
  }
}

export function clearDashboardWelcomePending(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
