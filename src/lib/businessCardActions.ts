import type { EmployeeProfile } from './fetchEmployeeProfile';
import { buildBackendApiUrl } from './backendApiBase';

const FIRM_NAME = 'Decker, Pex, Levi Law Offices';
const OFFICE_LABEL = 'Tel Aviv Office';
const OFFICE_ADDRESS = 'Menachem Begin Rd. 11, Ramat Gan, Israel';

function escapeVCard(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function splitName(officialName: string): { first: string; last: string } {
  const parts = officialName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: '', last: '' };
  if (parts.length === 1) return { first: parts[0]!, last: '' };
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1]! };
}

function isAppleMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  // iPadOS 13+ reports as Macintosh with touch
  return /Macintosh/i.test(ua) && (navigator.maxTouchPoints || 0) > 1;
}

function isAndroid(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android/i.test(navigator.userAgent || '');
}

function buildSafeFileName(profile: EmployeeProfile): string {
  const safeName = (profile.official_name || profile.display_name || 'contact')
    .replace(/[^\w\s-]+/g, '')
    .trim()
    .replace(/\s+/g, '-') || 'contact';
  return `${safeName}.vcf`;
}

export function buildBusinessCardVCard(
  profile: EmployeeProfile,
  cardUrl: string,
): string {
  const { first, last } = splitName(profile.official_name || profile.display_name);
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `N:${escapeVCard(last)};${escapeVCard(first)};;;`,
    `FN:${escapeVCard(profile.official_name || profile.display_name)}`,
    `ORG:${escapeVCard(FIRM_NAME)}`,
    `TITLE:${escapeVCard(`${profile.department_name} Department`)}`,
  ];

  if (profile.mobile?.trim()) {
    lines.push(`TEL;TYPE=CELL:${escapeVCard(profile.mobile.trim())}`);
  }
  if (profile.phone?.trim()) {
    const work = profile.phone_ext?.trim()
      ? `${profile.phone.trim()} Ext. ${profile.phone_ext.trim()}`
      : profile.phone.trim();
    lines.push(`TEL;TYPE=WORK:${escapeVCard(work)}`);
  }
  if (profile.email?.trim()) {
    lines.push(`EMAIL;TYPE=INTERNET:${escapeVCard(profile.email.trim())}`);
  }
  lines.push(`ADR;TYPE=WORK:;;${escapeVCard(OFFICE_ADDRESS)};;;;`);
  lines.push(`NOTE:${escapeVCard(OFFICE_LABEL)}`);
  lines.push(`URL:${escapeVCard(cardUrl)}`);
  if (profile.linkedin_url?.trim()) {
    lines.push(`URL;TYPE=LinkedIn:${escapeVCard(profile.linkedin_url.trim())}`);
  }
  lines.push('END:VCARD');
  return `${lines.join('\r\n')}\r\n`;
}

/**
 * Opens / downloads a .vcf so the OS contact UI can save it.
 * iOS Safari: open blob (Add Contact). Android Chrome: download then open.
 */
export function downloadVCardFile(vcard: string, fileName: string): void {
  const safeName = fileName.endsWith('.vcf') ? fileName : `${fileName}.vcf`;
  // text/x-vcard is more reliably recognized on older Android; text/vcard on modern.
  const mime = isAndroid() ? 'text/x-vcard;charset=utf-8' : 'text/vcard;charset=utf-8';
  const blob = new Blob([vcard], { type: mime });
  const url = URL.createObjectURL(blob);

  if (isAppleMobile()) {
    // iOS ignores <a download> for vCards — opening the blob triggers Add Contact.
    const opened = window.open(url, '_blank');
    if (!opened) {
      window.location.assign(url);
    }
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return;
  }

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = safeName;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => URL.revokeObjectURL(url), 5_000);
}

/** Opens the native “add contact” flow on most phones (vCard download / open). */
export async function addBusinessCardToContacts(
  profile: EmployeeProfile,
  cardUrl: string,
): Promise<'shared' | 'downloaded'> {
  const vcard = buildBusinessCardVCard(profile, cardUrl);
  const fileName = buildSafeFileName(profile);
  // Android prefers text/x-vcard; iOS prefers text/vcard for Files/share.
  const mime = isAndroid() ? 'text/x-vcard' : 'text/vcard';
  const file = new File([vcard], fileName, { type: mime });

  const nav = navigator as Navigator & {
    canShare?: (data?: ShareData) => boolean;
  };

  // Web Share with a .vcf is the most reliable “pick Contacts” path on many Androids.
  // On iOS, prefer opening the vCard directly (share sheet often lacks Add to Contacts).
  if (!isAppleMobile() && typeof nav.share === 'function' && typeof nav.canShare === 'function') {
    try {
      if (nav.canShare({ files: [file] })) {
        await nav.share({
          files: [file],
          title: profile.official_name || profile.display_name,
          text: `Add ${profile.official_name || profile.display_name} to your contacts`,
        });
        return 'shared';
      }
    } catch (err) {
      if ((err as { name?: string } | null)?.name === 'AbortError') {
        throw err;
      }
      // Fall through to download
    }
  }

  downloadVCardFile(vcard, fileName);
  return 'downloaded';
}

export type WalletPlatform = 'apple' | 'google' | 'unknown';

export type WalletBackendStatus = {
  appleConfigured: boolean;
  googleConfigured: boolean;
};

export function detectWalletPlatform(): WalletPlatform {
  if (typeof navigator === 'undefined') return 'unknown';
  if (isAppleMobile()) return 'apple';
  if (isAndroid()) return 'google';
  return 'unknown';
}

export async function fetchWalletBackendStatus(): Promise<WalletBackendStatus> {
  try {
    const res = await fetch(buildBackendApiUrl('/api/wallet/status'));
    if (!res.ok) {
      return { appleConfigured: false, googleConfigured: false };
    }
    const data = (await res.json()) as Partial<WalletBackendStatus>;
    return {
      appleConfigured: Boolean(data.appleConfigured),
      googleConfigured: Boolean(data.googleConfigured),
    };
  } catch {
    return { appleConfigured: false, googleConfigured: false };
  }
}

/**
 * Opens the signed .pkpass from the backend. Safari on iPhone shows Add to Wallet.
 * Direct navigation preserves Content-Type so iOS recognizes the pass.
 */
export async function addBusinessCardToAppleWallet(employeeId: number): Promise<void> {
  const status = await fetchWalletBackendStatus();
  if (!status.appleConfigured) {
    const err = new Error(
      'Apple Wallet is not configured on the server yet.',
    ) as Error & { status?: number };
    err.status = 503;
    throw err;
  }

  window.location.assign(
    buildBackendApiUrl(`/api/wallet/business-card/${employeeId}/apple`),
  );
}

/** Opens Google’s Add to Wallet save URL for this employee. */
export async function addBusinessCardToGoogleWallet(employeeId: number): Promise<void> {
  const url = buildBackendApiUrl(`/api/wallet/business-card/${employeeId}/google`);
  const res = await fetch(url);
  if (!res.ok) {
    let message = 'Could not create Google Wallet pass';
    try {
      const body = (await res.json()) as { error?: string; code?: string };
      if (body.error) message = body.error;
    } catch {
      // ignore
    }
    const err = new Error(message) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }

  const data = (await res.json()) as { saveUrl?: string };
  if (!data.saveUrl) {
    throw new Error('Google Wallet save link missing');
  }
  window.location.assign(data.saveUrl);
}

export type WalletSaveResult =
  | 'apple'
  | 'google'
  | 'shared'
  | 'downloaded'
  | 'unavailable';

/**
 * Prefer real Wallet passes when the backend is configured; otherwise fall back to Contacts.
 */
export async function saveBusinessCardForWallet(
  profile: EmployeeProfile,
  cardUrl: string,
  platform: WalletPlatform = detectWalletPlatform(),
): Promise<WalletSaveResult> {
  const status = await fetchWalletBackendStatus();

  if (platform === 'apple' && status.appleConfigured) {
    await addBusinessCardToAppleWallet(profile.id);
    return 'apple';
  }
  if (platform === 'google' && status.googleConfigured) {
    await addBusinessCardToGoogleWallet(profile.id);
    return 'google';
  }

  // Backend not configured yet — Contacts is still useful on both platforms.
  if (platform === 'unknown') {
    return 'unavailable';
  }

  const contactResult = await addBusinessCardToContacts(profile, cardUrl);
  return contactResult;
}

export function walletSaveHint(
  platform: WalletPlatform = detectWalletPlatform(),
  status?: WalletBackendStatus | null,
): string {
  if (platform === 'apple') {
    if (status?.appleConfigured) {
      return 'Adds a signed pass to Apple Wallet with your name, details, and a QR to this card.';
    }
    return 'Apple Wallet signing is not set up on the server yet. You can still save this card to Contacts.';
  }
  if (platform === 'google') {
    if (status?.googleConfigured) {
      return 'Opens Google Wallet so you can save this digital business card with a QR back to the live page.';
    }
    return 'Google Wallet is not set up on the server yet. You can still save this card to Contacts.';
  }
  return 'Open this page on an iPhone or Android phone to add the card to Wallet.';
}

export async function shareBusinessCard(options: {
  name: string;
  department: string;
  url: string;
}): Promise<'shared' | 'copied'> {
  const title = `${options.name} — ${FIRM_NAME}`;
  const text = `${options.name}\n${options.department} Department\n${FIRM_NAME}`;

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text, url: options.url });
      return 'shared';
    } catch (err) {
      if ((err as { name?: string } | null)?.name === 'AbortError') {
        throw err;
      }
    }
  }

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(options.url);
    return 'copied';
  }

  throw new Error('Sharing is not supported on this device.');
}

export { FIRM_NAME, OFFICE_ADDRESS, OFFICE_LABEL, isAppleMobile, isAndroid };
