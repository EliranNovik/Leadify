import type { CompanySignatureSettings, SignaturePerson } from './companyEmailSignature';
import { toAbsolutePublicUrl } from './companyEmailSignature';

const NAVY = '#1B2A4A';
const GRAY = '#6B7280';
const GOLD = '#C4A574';
/** Hairline rule between the details and the branding, and the contact column separators. */
const DIVIDER = '#E5E7EB';
const FONT = 'Arial, Helvetica, sans-serif';

/*
 * Sized for a normal email signature rather than a web banner. The width is not arbitrary: the
 * office address gets a full-width row it is not allowed to wrap on, and at 12px that line needs
 * 381px, so the details column is budgeted to clear it. Shrinking the width further without
 * letting the address wrap would just push the table wider than this number at render time.
 */
const SIGNATURE_WIDTH = 740;

/*
 * 120px is the largest the circle can be for free: the row of four social buttons already forces
 * the left column to 120px, so anything past this starts taking width from the contact details.
 */
const PHOTO_PX = 120;
/** Initials fall back for a missing photo — scaled off the circle so the two stay in proportion. */
const INITIALS_FONT_PX = Math.round(PHOTO_PX * 0.33);
const SOCIAL_PX = 28;
/** Gap between social buttons. Paired with `SOCIAL_PX` in the `leftColWidth` budget. */
const SOCIAL_GAP_PX = 8;
const PHOTO_SOCIAL_GAP_PX = 8;

const NAME_FONT_PX = 18;
const NAME_LINE_PX = 22;
/** One style for both job title and department: the design shows a single line under the name. */
const SUBTITLE_FONT_PX = 12;
const SUBTITLE_LINE_PX = 16;

/** The short gold bar under the name, which replaced the old full-height gold column. */
const ACCENT_WIDTH_PX = 44;
const ACCENT_HEIGHT_PX = 2;
const ACCENT_SPACE_ABOVE_PX = 3;
const ACCENT_SPACE_BELOW_PX = 10;

/** The confidentiality notice, in its own outlined box under the signature. */
const DISCLAIMER_FONT_PX = 10;
const DISCLAIMER_LINE_PX = 14;
const DISCLAIMER_PAD_PX = 8;
const DISCLAIMER_SPACE_ABOVE_PX = 14;

const ICON_PX = 13;
const CONTACT_FONT_PX = 12;
const CONTACT_LINE_PX = 17;
const CONTACT_ICON_GAP_PX = 7;
const CONTACT_ROW_PAD_PX = 3;
/** Additional vertical space between contact-detail rows. */
const CONTACT_ROW_GAP_PX = 3;
const CONTACT_SEPARATOR_PAD_PX = 12;
/**
 * Contact details are stacked one per row: phone, then email, then website. The address takes a
 * full-width row of its own below them so it fits on one line.
 */
const CONTACT_COLUMNS = 1;
/**
 * Nudge for the icon cell so a 13px icon reads as centred on the first 17px text line.
 *
 * The cells are top-aligned on purpose: a wrapped detail has to keep its icon level with its first
 * line, which `valign="middle"` would not do.
 */
const CONTACT_ICON_TOP_NUDGE_PX = 2;

const COLUMN_GAP_PX = 16;
const RULE_GAP_PX = 14;
/*
 * The rule tapers off at both ends instead of running the full height as a flat line. A 1px rule
 * cannot physically narrow, so the taper is a symmetric ramp from near-white up to the divider grey
 * and back down — stepped colours rather than a CSS gradient because Outlook supports neither
 * gradients nor opacity. The stack is also shorter than the row and vertically centred, so the line
 * never reaches the top or bottom edge.
 */
const RULE_SEGMENTS: ReadonlyArray<{ heightPx: number; color: string }> = [
  { heightPx: 14, color: '#F6F7F9' },
  { heightPx: 20, color: '#EFF1F3' },
  { heightPx: 56, color: DIVIDER },
  { heightPx: 20, color: '#EFF1F3' },
  { heightPx: 14, color: '#F6F7F9' },
];
const RULE_HEIGHT_PX = RULE_SEGMENTS.reduce((total, segment) => total + segment.heightPx, 0);
/** Outer padding at each end of the row. Named because the details width is derived from them. */
const EDGE_PAD_PX = 4;
const BRANDING_EDGE_PAD_PX = 6;
/** Floor for the details column, so a very wide logo can never crush the contact grid. */
const MIN_DETAILS_WIDTH_PX = 240;

// Exactly 60:23, the artwork's ratio: Outlook honours the width/height attributes and ignores
// object-fit, so a mismatched pair here stretches the logo rather than letterboxing it.
const LOGO_WIDTH = 180;
const LOGO_HEIGHT = 69;
// 27:13, the artwork's exact ratio.
const DUNS_WIDTH = 81;
const DUNS_HEIGHT = 39;
/** The badge artwork carries its own top whitespace, so it is tucked up under the logo. */
const DUNS_PULL_UP_PX = 9;

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

/**
 * Escapes the stored disclaimer, then turns `**…**` into bold so the notice can lead with an
 * emphasised phrase. Escaping deliberately runs first: `<strong>` is the only tag this can
 * produce, no matter what an admin pastes into the field.
 */
function disclaimerToHtml(raw: string): string {
  return escapeHtml(raw).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
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

/** The website is not among these: it reads as a contact detail beside the globe icon instead. */
function socialLinks(settings: CompanySignatureSettings, origin?: string): SocialLink[] {
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
      const pad = index === 0 ? '0' : `0 0 0 ${SOCIAL_GAP_PX}px`;
      return `<td width="${SOCIAL_PX}" valign="middle" style="width:${SOCIAL_PX}px;height:${SOCIAL_PX}px;padding:${pad};vertical-align:middle;line-height:0;font-size:0;"><a href="${href}" target="_blank" style="color:${NAVY};text-decoration:none;display:block;width:${SOCIAL_PX}px;height:${SOCIAL_PX}px;line-height:0;">${inner}</a></td>`;
    })
    .join('');

  // `align` centres the row under the photo in Outlook, which ignores `margin:0 auto`.
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;">
    <tr>${cells}</tr>
  </table>`;
}

/** `fullWidth` items get a row to themselves instead of sharing one with a neighbour. */
type ContactItem = { iconPath: string; contentHtml: string; fullWidth?: boolean };

/** The icon cell and the text cell for one contact detail. `topGapPx` spaces it from the row above. */
function contactItemCells(
  item: ContactItem,
  origin?: string,
  textColSpan = 1,
  topGapPx = 0,
): string {
  const src = toAbsolutePublicUrl(item.iconPath, origin);
  const icon = isEmailSafeImageUrl(src) ? contactIconImg(src, '') : '';
  const iconTop = CONTACT_ROW_PAD_PX + CONTACT_ICON_TOP_NUDGE_PX + topGapPx;
  const textTop = CONTACT_ROW_PAD_PX + topGapPx;
  const span = textColSpan > 1 ? ` colspan="${textColSpan}"` : '';
  // A full-width row is the one place nothing can sit beside the text, so it is also the only place
  // we can promise a single line.
  const wrap = item.fullWidth ? 'white-space:nowrap;' : '';
  return `<td width="${ICON_PX}" valign="top" style="width:${ICON_PX}px;padding:${iconTop}px ${CONTACT_ICON_GAP_PX}px ${CONTACT_ROW_PAD_PX}px 0;vertical-align:top;line-height:0;font-size:0;">${icon}</td>
          <td${span} valign="top" style="padding:${textTop}px 0 ${CONTACT_ROW_PAD_PX}px 0;vertical-align:top;font-family:${FONT};font-size:${CONTACT_FONT_PX}px;line-height:${CONTACT_LINE_PX}px;color:${NAVY};${wrap}">${item.contentHtml}</td>`;
}

/**
 * Contact details as a grid, `CONTACT_COLUMNS` per row with a hairline separator between columns.
 *
 * A trailing odd item simply gets a shorter row, so an optional office phone cannot break the shape.
 * Items flagged `fullWidth` are pulled out and appended as single-item rows spanning the whole grid.
 */
function renderContactGrid(items: ContactItem[], origin?: string): string {
  if (items.length === 0) return '';

  const paired = items.filter((item) => !item.fullWidth);
  const solo = items.filter((item) => item.fullWidth);

  // The separator has to take the row's own top padding too, or it floats above its neighbours.
  const separator = (topPad: number) =>
    `<td valign="top" style="padding:${topPad}px ${CONTACT_SEPARATOR_PAD_PX}px ${CONTACT_ROW_PAD_PX}px ${CONTACT_SEPARATOR_PAD_PX}px;vertical-align:top;font-family:${FONT};font-size:${CONTACT_FONT_PX}px;line-height:${CONTACT_LINE_PX}px;color:${DIVIDER};">|</td>`;

  const rows: string[] = [];
  for (let i = 0; i < paired.length; i += CONTACT_COLUMNS) {
    const group = paired.slice(i, i + CONTACT_COLUMNS);
    const gap = i === 0 ? 0 : CONTACT_ROW_GAP_PX;
    const cells = group
      .map((item, index) => {
        const needsSeparator = index < group.length - 1;
        return (
          contactItemCells(item, origin, 1, gap) +
          (needsSeparator ? separator(CONTACT_ROW_PAD_PX + gap) : '')
        );
      })
      .join('');
    rows.push(`<tr>${cells}</tr>`);
  }

  // Widest paired row: each column is an icon cell plus a text cell, with a separator between
  // columns. A solo item's text cell has to span everything the icon cell leaves over.
  const widestColumns = Math.min(CONTACT_COLUMNS, paired.length);
  const cellsPerRow = widestColumns > 0 ? widestColumns * 2 + (widestColumns - 1) : 2;
  solo.forEach((item, index) => {
    const gap = rows.length === 0 && index === 0 ? 0 : CONTACT_ROW_GAP_PX;
    rows.push(`<tr>${contactItemCells(item, origin, cellsPerRow - 1, gap)}</tr>`);
  });

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0">${rows.join('')}</table>`;
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

  /*
   * Outlook on Windows renders mail with the Word engine, which ignores border-radius no matter
   * how many times it is declared, so the photo arrives square there. A VML oval filled with the
   * photo is the only way to get a real circle out of that renderer.
   *
   * The two versions are mutually exclusive: `[if mso]` is a comment to every engine except Word,
   * and the downlevel-revealed `[if !mso]` hides the <img> from Word alone. Outlook for Mac and
   * Outlook on the web ignore conditional comments entirely and take the <img>, which is right —
   * they honour border-radius.
   *
   * `escapeHtml` is what keeps the VML inside a legal comment: it turns any `>` in the URL into
   * `&gt;`, so the src can never produce the `-->` that would close the comment early.
   */
  const vmlCircle =
    `<!--[if mso]><v:oval xmlns:v="urn:schemas-microsoft-com:vml" style="width:${PHOTO_PX}px;height:${PHOTO_PX}px;" stroked="f"><v:fill type="frame" src="${safeSrc}" /></v:oval><![endif]-->`;
  const imgCircle =
    `<!--[if !mso]><!--><img src="${safeSrc}" width="${PHOTO_PX}" height="${PHOTO_PX}" alt="${safeAlt}" border="0" style="display:block;width:${PHOTO_PX}px;height:${PHOTO_PX}px;max-width:${PHOTO_PX}px;border:0;outline:none;text-decoration:none;border-radius:${radius};-webkit-border-radius:${radius};-moz-border-radius:${radius};object-fit:cover;" /><!--<![endif]-->`;

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${PHOTO_PX}" height="${PHOTO_PX}" style="width:${PHOTO_PX}px;height:${PHOTO_PX}px;border-collapse:separate;">
    <tr>
      <td width="${PHOTO_PX}" height="${PHOTO_PX}" align="center" valign="top" style="width:${PHOTO_PX}px;height:${PHOTO_PX}px;border-radius:${radius};overflow:hidden;line-height:0;font-size:0;">
        ${vmlCircle}${imgCircle}
      </td>
    </tr>
  </table>`;
}

function initialsAvatar(name: string): string {
  const initials = escapeHtml(initialsFromDisplayName(name));
  const radius = `${PHOTO_PX}px`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${PHOTO_PX}" height="${PHOTO_PX}" style="width:${PHOTO_PX}px;height:${PHOTO_PX}px;border-collapse:separate;">
    <tr>
      <td width="${PHOTO_PX}" height="${PHOTO_PX}" align="center" valign="middle" bgcolor="#EEF1F6" style="width:${PHOTO_PX}px;height:${PHOTO_PX}px;border-radius:${radius};-webkit-border-radius:${radius};background-color:#EEF1F6;text-align:center;vertical-align:middle;font-family:${FONT};font-size:${INITIALS_FONT_PX}px;font-weight:700;line-height:${PHOTO_PX}px;color:${NAVY};letter-spacing:0.04em;">
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
  // One line, in full: a newline in the stored address becomes a comma separator rather than a <br />.
  // Trailing commas are stripped first so an address already written one-per-line with commas does
  // not end up doubling them.
  const address = rawAddress
    ? rawAddress
        .split(/\n+/)
        .map((line) => line.trim().replace(/,+$/, ''))
        .filter(Boolean)
        .map((line) => escapeHtml(line))
        .join(', ')
    : '';
  const officePhone = settings.show_office_phone ? escapeHtml(settings.office_phone || '') : '';
  const disclaimer = disclaimerToHtml(settings.signature_disclaimer || '');

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
  const socialCount = socialLinks(settings, origin).length;
  const useLogo = Boolean(logoSrc && /^https?:\/\//i.test(logoSrc));
  const useDuns = Boolean(dunsSrc && /^https?:\/\//i.test(dunsSrc));

  /*
   * Wide enough for the photo, or for the social row if that is wider. The count comes from the
   * links actually enabled rather than a fixed four, because the difference is spendable: the
   * details column gets whatever this leaves, and the no-wrap address needs 381px of it, which
   * caps this at 124px. Three buttons fit under the photo's 120px; a fourth at this icon size
   * would push past the cap and start stretching the address line.
   */
  const leftColWidth = Math.max(
    PHOTO_PX,
    socialCount * SOCIAL_PX + Math.max(0, socialCount - 1) * SOCIAL_GAP_PX,
  );
  const photoBlock = usePhoto
    ? roundProfilePhoto(photoSrc, person.displayName)
    : initialsAvatar(person.displayName);

  // Role and department share one line, separated the way the profile header does it. Either can
  // be missing, so the separator only appears when there is something on both sides of it.
  const roleLine = [jobTitle, department].filter(Boolean).join(' &middot; ');

  const titleBlock = [
    name
      ? `<div style="font-family:${FONT};font-size:${NAME_FONT_PX}px;line-height:${NAME_LINE_PX}px;font-weight:700;color:${NAVY};letter-spacing:0.08em;text-transform:uppercase;">${name}</div>`
      : '',
    // nowrap: the role is a short phrase that reads badly split over two lines, and it is well
    // inside the details width even for long titles.
    roleLine
      ? `<div style="font-family:${FONT};font-size:${SUBTITLE_FONT_PX}px;line-height:${SUBTITLE_LINE_PX}px;color:${GRAY};white-space:nowrap;">${roleLine}</div>`
      : '',
  ]
    .filter(Boolean)
    .join('');

  const contactItems: ContactItem[] = [
    phone ? { iconPath: CONTACT_ICONS.phone, contentHtml: phone } : null,
    officePhone && officePhone !== phone
      ? { iconPath: CONTACT_ICONS.phone, contentHtml: officePhone }
      : null,
    email
      ? {
          iconPath: CONTACT_ICONS.email,
          contentHtml: `<a href="mailto:${email}" style="color:${NAVY};text-decoration:none;">${email}</a>`,
        }
      : null,
    settings.show_website && websiteUrl
      ? {
          iconPath: CONTACT_ICONS.globe,
          contentHtml: `<a href="${escapeHtml(websiteUrl)}" target="_blank" style="color:${NAVY};text-decoration:none;">${websiteLabel}</a>`,
        }
      : null,
    address
      ? {
          iconPath: CONTACT_ICONS.pin,
          contentHtml: mapsHref
            ? `<a href="${escapeHtml(mapsHref)}" target="_blank" style="color:${NAVY};text-decoration:none;">${address}</a>`
            : address,
          // Its own row under the website, with the whole details width to itself.
          fullWidth: true,
        }
      : null,
  ].filter((item): item is ContactItem => item !== null);

  const contactGrid = renderContactGrid(contactItems, origin);

  const goldAccent = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${ACCENT_WIDTH_PX}" style="width:${ACCENT_WIDTH_PX}px;">
          <tr><td height="${ACCENT_HEIGHT_PX}" bgcolor="${GOLD}" data-signature-gold="1" style="height:${ACCENT_HEIGHT_PX}px;line-height:${ACCENT_HEIGHT_PX}px;font-size:0;background-color:${GOLD};">&nbsp;</td></tr>
        </table>`;

  const brandingWidth = Math.max(useLogo ? LOGO_WIDTH : 0, useDuns ? DUNS_WIDTH : 0);
  // Same 12px top padding as the details column, so a top-aligned logo starts on the name's line.
  const brandingCol =
    useLogo || useDuns
      ? `<td width="${brandingWidth}" valign="top" align="center" style="width:${brandingWidth}px;padding:12px ${BRANDING_EDGE_PAD_PX}px 12px 0;vertical-align:top;text-align:center;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" width="${brandingWidth}" style="width:${brandingWidth}px;">
            ${
              useLogo
                ? `<tr><td align="center" style="padding:0;text-align:center;line-height:0;font-size:0;">${imgTag(logoSrc, LOGO_WIDTH, LOGO_HEIGHT, settings.company_name || 'Logo', `width:${LOGO_WIDTH}px;height:${LOGO_HEIGHT}px;object-fit:contain;margin:0 auto;`)}</td></tr>`
                : ''
            }
            ${
              useDuns
                ? `<tr><td align="center" style="padding:0;text-align:center;line-height:0;font-size:0;">${imgTag(dunsSrc, DUNS_WIDTH, DUNS_HEIGHT, 'Duns 100', `width:${DUNS_WIDTH}px;height:${DUNS_HEIGHT}px;object-fit:contain;margin:-${DUNS_PULL_UP_PX}px auto 0;`)}</td></tr>`
                : ''
            }
          </table>
        </td>`
      : '';

  // A hairline rule separates the details from the branding, so it only exists when branding does.
  const ruleStack = RULE_SEGMENTS.map(
    (segment) =>
      `<tr><td width="1" height="${segment.heightPx}" bgcolor="${segment.color}" style="width:1px;height:${segment.heightPx}px;padding:0;background-color:${segment.color};font-size:0;line-height:0;">&nbsp;</td></tr>`,
  ).join('');
  const ruleCols = brandingCol
    ? `<td width="${RULE_GAP_PX}" style="width:${RULE_GAP_PX}px;font-size:0;line-height:0;">&nbsp;</td>
    <td width="1" valign="middle" style="width:1px;min-width:1px;max-width:1px;padding:0;vertical-align:middle;font-size:0;line-height:0;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="1" height="${RULE_HEIGHT_PX}" style="width:1px;height:${RULE_HEIGHT_PX}px;border-collapse:collapse;">${ruleStack}</table>
    </td>
    <td width="${RULE_GAP_PX}" style="width:${RULE_GAP_PX}px;font-size:0;line-height:0;">&nbsp;</td>`
    : '';

  // colspan has to cover every cell actually emitted, which varies with the branding block.
  const columnCount = 2 + (ruleCols ? 3 : 0) + (brandingCol ? 1 : 0);

  /*
   * The details column needs a declared width. Every other cell in the row has one, and the table is
   * a fixed 920px, so leaving this one to the auto-layout algorithm let it collapse towards its
   * longest word — which wrapped the name and role far earlier than the space required.
   * Derived from the paddings rather than hard-coded, so editing a gap cannot desync the arithmetic.
   */
  const detailsWidth = Math.max(
    MIN_DETAILS_WIDTH_PX,
    SIGNATURE_WIDTH -
      (leftColWidth + EDGE_PAD_PX + COLUMN_GAP_PX) -
      (ruleCols ? RULE_GAP_PX * 2 + 1 : 0) -
      (brandingCol ? brandingWidth + BRANDING_EDGE_PAD_PX : 0),
  );

  /*
   * The box is a nested table rather than a border on the spanning cell, so the gap above the
   * notice stays outside the outline. Its width is 100% instead of SIGNATURE_WIDTH because the
   * 1px border would otherwise sit outside that number and push the signature 2px wider.
   */
  const disclaimerRow = disclaimer
    ? `<tr>
        <td colspan="${columnCount}" style="padding:${DISCLAIMER_SPACE_ABOVE_PX}px 0 0 0;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;width:100%;">
            <tr>
              <td style="border:1px solid ${DIVIDER};padding:${DISCLAIMER_PAD_PX}px;font-family:${FONT};font-size:${DISCLAIMER_FONT_PX}px;line-height:${DISCLAIMER_LINE_PX}px;color:${NAVY};text-align:justify;">${disclaimer}</td>
            </tr>
          </table>
        </td>
      </tr>`
    : '';

  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${SIGNATURE_WIDTH}" data-email-signature="1" style="border-collapse:collapse;background-color:#ffffff;width:${SIGNATURE_WIDTH}px;max-width:${SIGNATURE_WIDTH}px;">
  <tr>
    <td width="${leftColWidth}" valign="middle" align="left" style="width:${leftColWidth}px;padding:12px ${COLUMN_GAP_PX}px 12px ${EDGE_PAD_PX}px;vertical-align:middle;text-align:left;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td valign="top" align="left" style="vertical-align:top;text-align:left;">${photoBlock}</td>
        </tr>
        <tr>
          <td valign="top" align="center" style="vertical-align:top;text-align:center;padding-top:${PHOTO_SOCIAL_GAP_PX}px;">
            ${renderSocialUnderPhoto(settings, origin)}
          </td>
        </tr>
      </table>
    </td>
    <td width="${detailsWidth}" valign="top" style="width:${detailsWidth}px;vertical-align:top;padding:12px 0;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${detailsWidth}" style="width:${detailsWidth}px;">
        <tr>
          <td align="left" style="text-align:left;">${titleBlock}</td>
        </tr>
        <tr>
          <td align="left" style="text-align:left;padding:${ACCENT_SPACE_ABOVE_PX}px 0 ${ACCENT_SPACE_BELOW_PX}px 0;">
            ${goldAccent}
          </td>
        </tr>
        <tr>
          <td align="left" style="text-align:left;">${contactGrid}</td>
        </tr>
      </table>
    </td>
    ${ruleCols}
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
