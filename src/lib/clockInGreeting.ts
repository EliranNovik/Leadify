export function getJerusalemHour(from = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(from);
  return Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
}

export function getTimeBasedGreeting(hour = new Date().getHours()): string {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  if (hour < 21) return 'Good evening';
  return 'Good night';
}

export function getJerusalemTimeGreeting(from = new Date()): string {
  return getTimeBasedGreeting(getJerusalemHour(from));
}

export function getGreetingFirstName(fullName: string): string {
  const trimmed = fullName.trim();
  if (!trimmed) return '';
  return trimmed.split(/\s+/)[0] || trimmed;
}
