import type { CompanySignatureSettings, SignaturePerson } from './companyEmailSignature';
import { toAbsolutePublicUrl } from './companyEmailSignature';

const NAVY = '#1B2A4A';
const GRAY = '#6B7280';
const GOLD = '#C4A574';
const FONT = 'Arial, Helvetica, sans-serif';
const ICON_PX = 16;
const SOCIAL_PX = 28;
const PHOTO_PX = 128;
const LOGO_WIDTH = 230;
const LOGO_HEIGHT = 88;
const DUNS_WIDTH = 108;
const DUNS_HEIGHT = 52;

const CONTACT_ICONS = {
  phone: '/signature-icons/phone.png?v=4',
  email: '/signature-icons/email.png?v=4',
  globe: '/signature-icons/globe.png?v=4',
  pin: '/signature-icons/pin.png?v=4',
} as const;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isEmailSafeImageUrl(url: string): boolean {
  if (!url) return false;
  if (url.startsWith('data:image/')) return true;
  return /^https?:\/\//i.test(url) || url.startsWith('/');
}

function displayWebsite(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/\/$/, '');
}

function normalizeHref(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('mailto:')) return trimmed;
  if (trimmed.includes('@') && !trimmed.includes(' ')) return `mailto:${trimmed}`;
  return `https://${trimmed.replace(/^\/+/, '')}`;
}

function imgTag(src: string, width: number, height: number, alt: string, extraStyle = ''): string {
  const safeSrc = escapeHtml(src);
  const safeAlt = escapeHtml(alt);
  return `<img src="${safeSrc}" width="${width}" height="${height}" alt="${safeAlt}" border="0" style="display:block;border:0;outline:none;text-decoration:none;width:${width}px;height:${height}px;max-width:${width}px;max-height:${height}px;${extraStyle}" />`;
}

function contactIconImg(src: string, alt: string): string {
  return imgTag(
    src,
    ICON_PX,
    ICON_PX,
    alt,
    'object-fit:contain;vertical-align:middle;',
  );
}

function socialIconImg(src: string, alt: string): string {
  return imgTag(
    src,
    SOCIAL_PX,
    SOCIAL_PX,
    alt,
    'border-radius:50%;-webkit-border-radius:50%;object-fit:contain;vertical-align:middle;',
  );
}

type SocialLink = {
  key: string;
  label: string;
  href: string;
  iconUrl: string;
  show: boolean;
};

function socialLinks(settings: CompanySignatureSettings, origin?: string): SocialLink[] {
  const websiteHref = settings.website_url ? normalizeHref(settings.website_url) : '';
  const icon = (custom: string | null | undefined, fallback: string) =>
    toAbsolutePublicUrl(custom || fallback, origin);
  return [
    {
      key: 'facebook',
      label: 'Facebook',
      href: settings.facebook_url ? normalizeHref(settings.facebook_url) : '',
      iconUrl: icon(settings.facebook_icon_url, '/signature-icons/facebook.png?v=4'),
      show: Boolean(settings.show_facebook && settings.facebook_url),
    },
    {
      key: 'linkedin',
      label: 'LinkedIn',
      href: settings.linkedin_url ? normalizeHref(settings.linkedin_url) : '',
      iconUrl: icon(settings.linkedin_icon_url, '/signature-icons/linkedin.png?v=4'),
      show: Boolean(settings.show_linkedin && settings.linkedin_url),
    },
    {
      key: 'youtube',
      label: 'YouTube',
      href: settings.youtube_url ? normalizeHref(settings.youtube_url) : '',
      iconUrl: icon(settings.youtube_icon_url, '/signature-icons/youtube.png?v=4'),
      show: Boolean(settings.show_youtube && settings.youtube_url),
    },
    {
      key: 'website',
      label: 'Website',
      href: websiteHref,
      iconUrl: icon(settings.website_icon_url, '/signature-icons/website.png?v=4'),
      show: Boolean(settings.show_website && websiteHref),
    },
    {
      key: 'instagram',
      label: 'Instagram',
      href: settings.instagram_url ? normalizeHref(settings.instagram_url) : '',
      iconUrl: toAbsolutePublicUrl(settings.instagram_icon_url, origin),
      show: Boolean(settings.show_instagram && settings.instagram_url),
    },
  ].filter((link) => link.show && link.href);
}

function googleMapsHref(address: string): string {
  const query = address.replace(/\s+/g, ' ').trim();
  if (!query) return '';
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function renderSocialUnderPhoto(settings: CompanySignatureSettings, origin?: string): string {
  const links = socialLinks(settings, origin);
  if (links.length === 0) return '';

  const cells = links
    .map((link, index) => {
      const label = escapeHtml(link.label.toUpperCase());
      const href = escapeHtml(link.href);
      const iconSrc = toAbsolutePublicUrl(link.iconUrl, origin) || link.iconUrl;
      const inner = isEmailSafeImageUrl(iconSrc)
        ? socialIconImg(iconSrc, link.label)
        : `<span style="font-family:${FONT};font-size:9px;color:${NAVY};text-decoration:none;">${label}</span>`;
      const pad = index === 0 ? '0' : '0 0 0 6px';
      return `<td width="${SOCIAL_PX}" valign="middle" style="width:${SOCIAL_PX}px;height:${SOCIAL_PX}px;padding:${pad};vertical-align:middle;line-height:0;font-size:0;"><a href="${href}" target="_blank" style="color:${NAVY};text-decoration:none;display:block;width:${SOCIAL_PX}px;height:${SOCIAL_PX}px;line-height:0;">${inner}</a></td>`;
    })
    .join('');

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="left" style="margin-top:0;">
    <tr>${cells}</tr>
  </table>`;
}

function contactLine(iconPath: string, contentHtml: string, origin?: string): string {
  const src = toAbsolutePublicUrl(iconPath, origin);
  const icon = isEmailSafeImageUrl(src) ? contactIconImg(src, '') : '';
  return `<tr>
    <td style="padding:4px 0;font-family:${FONT};font-size:13px;line-height:${ICON_PX}px;color:${GRAY};">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td width="${ICON_PX}" height="${ICON_PX}" valign="middle" style="width:${ICON_PX}px;height:${ICON_PX}px;padding:0 10px 0 0;vertical-align:middle;line-height:0;font-size:0;">
            ${icon}
          </td>
          <td valign="middle" style="vertical-align:middle;font-family:${FONT};font-size:13px;line-height:18px;color:${NAVY};">
            ${contentHtml}
          </td>
        </tr>
      </table>
    </td>
  </tr>`;
}

export function initialsFromDisplayName(name: string): string {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] || ''}${parts[parts.length - 1][0] || ''}`.toUpperCase();
  }
  const single = parts[0] || '';
  if (single.length >= 2) return single.slice(0, 2).toUpperCase();
  return (single[0] || '?').toUpperCase();
}

function roundProfilePhoto(src: string, alt: string): string {
  const safeSrc = escapeHtml(src);
  const safeAlt = escapeHtml(alt);
  const radius = `${PHOTO_PX}px`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${PHOTO_PX}" height="${PHOTO_PX}" style="width:${PHOTO_PX}px;height:${PHOTO_PX}px;border-collapse:separate;">
    <tr>
      <td width="${PHOTO_PX}" height="${PHOTO_PX}" align="center" valign="top" style="width:${PHOTO_PX}px;height:${PHOTO_PX}px;border-radius:${radius};overflow:hidden;line-height:0;font-size:0;">
        <img src="${safeSrc}" width="${PHOTO_PX}" height="${PHOTO_PX}" alt="${safeAlt}" border="0" style="display:block;width:${PHOTO_PX}px;height:${PHOTO_PX}px;max-width:${PHOTO_PX}px;border:0;outline:none;text-decoration:none;border-radius:${radius};-webkit-border-radius:${radius};-moz-border-radius:${radius};object-fit:cover;" />
      </td>
    </tr>
  </table>`;
}

function initialsAvatar(name: string): string {
  const initials = escapeHtml(initialsFromDisplayName(name));
  const radius = `${PHOTO_PX}px`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${PHOTO_PX}" height="${PHOTO_PX}" style="width:${PHOTO_PX}px;height:${PHOTO_PX}px;border-collapse:separate;">
    <tr>
      <td width="${PHOTO_PX}" height="${PHOTO_PX}" align="center" valign="middle" bgcolor="#EEF1F6" style="width:${PHOTO_PX}px;height:${PHOTO_PX}px;border-radius:${radius};-webkit-border-radius:${radius};background-color:#EEF1F6;text-align:center;vertical-align:middle;font-family:${FONT};font-size:42px;font-weight:700;line-height:${PHOTO_PX}px;color:${NAVY};letter-spacing:0.04em;">
        ${initials}
      </td>
    </tr>
  </table>`;
}

/**
 * Outlook-safe email signature HTML.
 * Tables + inline styles only. Public HTTPS image URLs. No Tailwind.
 */
export function generateEmailSignatureHtml(
  person: SignaturePerson,
  settings: CompanySignatureSettings,
  options?: { origin?: string; force?: boolean },
): string {
  if (!options?.force && (!settings.signature_enabled || !person.signatureEnabled)) return '';

  const origin = options?.origin;
  const name = escapeHtml(person.displayName || '');
  const jobTitle = escapeHtml(person.jobTitle || '');
  const department = escapeHtml(person.department || '');
  const phone = escapeHtml(person.phone || '');
  const email = escapeHtml(person.email || '');
  const websiteUrl = settings.website_url ? normalizeHref(settings.website_url) : '';
  const websiteLabel = websiteUrl ? escapeHtml(displayWebsite(websiteUrl)) : '';
  const rawAddress = settings.show_office_address ? (settings.office_address || '').trim() : '';
  const mapsHref = rawAddress ? googleMapsHref(rawAddress) : '';
  const address = rawAddress ? escapeHtml(rawAddress).replace(/\n/g, '<br />') : '';
  const officePhone = settings.show_office_phone ? escapeHtml(settings.office_phone || '') : '';
  const disclaimer = escapeHtml(settings.signature_disclaimer || '');

  const photoAbs = toAbsolutePublicUrl(person.profileImageUrl, origin);
  const photoSrc =
    photoAbs && isEmailSafeImageUrl(photoAbs) && !photoAbs.startsWith('data:')
      ? photoAbs
      : '';
  const usePhoto = Boolean(photoSrc && /^https?:\/\//i.test(photoSrc));

  const logoSrc = settings.show_logo
    ? toAbsolutePublicUrl(settings.logo_url || '/DPLOGO1.png', origin)
    : '';
  const dunsSrc = settings.show_secondary_logo
    ? toAbsolutePublicUrl(settings.secondary_logo_url, origin)
    : '';
  const useLogo = Boolean(logoSrc && /^https?:\/\//i.test(logoSrc));
  const useDuns = Boolean(dunsSrc && /^https?:\/\//i.test(dunsSrc));

  const leftColWidth = Math.max(PHOTO_PX, SOCIAL_PX * 4 + 18);
  const photoBlock = usePhoto
    ? roundProfilePhoto(photoSrc, person.displayName)
    : initialsAvatar(person.displayName);

  const titleBlock = [
    name
      ? `<div style="font-family:${FONT};font-size:17px;line-height:22px;font-weight:700;color:${NAVY};letter-spacing:0.08em;text-transform:uppercase;">${name}</div>`
      : '',
    jobTitle
      ? `<div style="font-family:${FONT};font-size:13px;line-height:18px;font-style:italic;color:${GRAY};padding-top:3px;">${jobTitle}</div>`
      : '',
    department
      ? `<div style="font-family:${FONT};font-size:12px;line-height:16px;color:${GRAY};padding-top:1px;">${department}</div>`
      : '',
  ]
    .filter(Boolean)
    .join('');

  const contactRows = [
    phone ? contactLine(CONTACT_ICONS.phone, `<span style="color:${NAVY};">${phone}</span>`, origin) : '',
    officePhone && officePhone !== phone
      ? contactLine(CONTACT_ICONS.phone, `<span style="color:${NAVY};">${officePhone}</span>`, origin)
      : '',
    email
      ? contactLine(
          CONTACT_ICONS.email,
          `<a href="mailto:${email}" style="color:${NAVY};text-decoration:none;">${email}</a>`,
          origin,
        )
      : '',
    settings.show_website && websiteUrl
      ? contactLine(
          CONTACT_ICONS.globe,
          `<a href="${escapeHtml(websiteUrl)}" target="_blank" style="color:${NAVY};text-decoration:none;">${websiteLabel}</a>`,
          origin,
        )
      : '',
    address
      ? contactLine(
          CONTACT_ICONS.pin,
          mapsHref
            ? `<a href="${escapeHtml(mapsHref)}" target="_blank" style="color:${NAVY};text-decoration:none;">${address}</a>`
            : `<span style="color:${NAVY};">${address}</span>`,
          origin,
        )
      : '',
  ]
    .filter(Boolean)
    .join('');

  const brandingWidth = Math.max(useLogo ? LOGO_WIDTH : 0, useDuns ? DUNS_WIDTH : 0);
  const brandingCol =
    useLogo || useDuns
      ? `<td width="${brandingWidth}" valign="top" align="left" style="width:${brandingWidth}px;padding:4px 8px 20px 16px;vertical-align:top;text-align:left;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="left">
            ${
              useLogo
                ? `<tr><td align="left" style="padding:0;text-align:left;line-height:0;font-size:0;">${imgTag(logoSrc, LOGO_WIDTH, LOGO_HEIGHT, settings.company_name || 'Logo', `width:${LOGO_WIDTH}px;height:${LOGO_HEIGHT}px;object-fit:contain;`)}</td></tr>`
                : ''
            }
            ${
              useDuns
                ? `<tr><td align="left" style="padding:0;text-align:left;line-height:0;font-size:0;">${imgTag(dunsSrc, DUNS_WIDTH, DUNS_HEIGHT, 'Duns 100', `width:${DUNS_WIDTH}px;height:${DUNS_HEIGHT}px;object-fit:contain;margin-top:-14px;`)}</td></tr>`
                : ''
            }
          </table>
        </td>`
      : '';

  const disclaimerRow = disclaimer
    ? `<tr>
        <td colspan="6" style="padding:14px 0 0 0;font-family:${FONT};font-size:10px;line-height:14px;color:${GRAY};">
          ${disclaimer}
        </td>
      </tr>`
    : '';

  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="820" data-email-signature="1" style="border-collapse:collapse;background-color:#ffffff;width:820px;max-width:820px;">
  <tr>
    <td width="${leftColWidth}" valign="top" align="left" style="width:${leftColWidth}px;padding:8px 0 20px 4px;vertical-align:top;text-align:left;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="height:100%;">
        <tr>
          <td valign="top" align="left" style="vertical-align:top;text-align:left;">${photoBlock}</td>
        </tr>
        <tr>
          <td valign="bottom" align="left" style="vertical-align:bottom;text-align:left;padding-top:18px;">
            ${renderSocialUnderPhoto(settings, origin)}
          </td>
        </tr>
      </table>
    </td>
    <td width="32" style="width:32px;min-width:32px;font-size:0;line-height:0;">&nbsp;</td>
    <td width="4" bgcolor="${GOLD}" data-signature-gold="1" style="width:4px;min-width:4px;max-width:4px;padding:0;background-color:${GOLD};font-size:0;line-height:0;">&nbsp;</td>
    <td width="32" style="width:32px;min-width:32px;font-size:0;line-height:0;">&nbsp;</td>
    <td valign="top" style="vertical-align:top;padding:4px 16px 20px 0;">
      ${titleBlock}
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;">
        ${contactRows}
      </table>
    </td>
    ${brandingCol}
  </tr>
  ${disclaimerRow}
</table>`.trim();
}

export function generateEmailSignature(
  person: SignaturePerson,
  settings: CompanySignatureSettings,
  options?: { origin?: string; force?: boolean },
): string {
  return generateEmailSignatureHtml(person, settings, options);
}
