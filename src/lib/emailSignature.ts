import { supabase } from './supabase';
import { convertBodyToHtml } from './emailBodyHtml';
import {
  buildSignaturePerson,
  emptySignatureProfile,
  fetchCompanySignatureSettings,
  fetchCurrentUserSignatureContext,
  fetchSignatureEmployee,
  fetchUserSignatureProfile,
} from './companyEmailSignature';
import { generateEmailSignatureHtml } from './generateEmailSignatureHtml';

export type InlineEmailAttachment = {
  name: string;
  contentType: string;
  contentBytes: string;
  contentId: string;
  isInline: true;
};

/** Collapse newlines/spaces inside <img> tags so data-URIs stay one attribute. */
function flattenImgTags(html: string): string {
  return html.replace(/<img\b[\s\S]*?>/gi, (tag) => tag.replace(/\s+/g, ' '));
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error('Failed to read image'));
    reader.readAsDataURL(blob);
  });
}

function resolveImageSrc(src: string, pageOrigin: string): string {
  const trimmed = src.trim();
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('data:') || trimmed.startsWith('cid:')) {
    return trimmed;
  }
  if (trimmed.startsWith('/') && pageOrigin) return `${pageOrigin}${trimmed}`;
  return trimmed;
}

/** Local CRM assets (signature icons, /DPLOGO1.png) cannot be loaded by Gmail/Outlook. */
function shouldEmbedImageForEmailClients(src: string, pageOrigin: string): boolean {
  const trimmed = src.trim();
  if (!trimmed || trimmed.startsWith('cid:') || trimmed.startsWith('data:')) return false;
  if (/\/signature-icons\//i.test(trimmed)) return true;
  if (trimmed.startsWith('/')) return true;
  try {
    const url = new URL(trimmed, pageOrigin || 'http://localhost');
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return true;
    if (pageOrigin && url.origin === pageOrigin) return true;
  } catch {
    return false;
  }
  return false;
}

/**
 * Gmail and Microsoft Graph do not reliably render data:image URIs — they often
 * show the raw <img> markup as text. Convert them to cid: inline attachments.
 */
export function inlineDataImagesInHtml(html: string): {
  html: string;
  inlineAttachments: InlineEmailAttachment[];
} {
  if (!html) return { html: '', inlineAttachments: [] };

  let next = flattenImgTags(html);
  const inlineAttachments: InlineEmailAttachment[] = [];
  let index = 0;

  next = next.replace(
    /<img\b([^>]*?)src\s*=\s*(["'])data:image\/([a-zA-Z0-9.+-]+);base64,([\s\S]*?)\2([^>]*)>/gi,
    (_match, before, _quote, subtype, rawB64, after) => {
      const contentBytes = String(rawB64).replace(/\s+/g, '');
      if (!contentBytes) return _match;
      const safeType = String(subtype).toLowerCase().replace(/[^a-z0-9.+-]/g, '') || 'png';
      const ext =
        safeType.includes('jpeg') || safeType === 'jpg' ? 'jpg' : safeType.split('+')[0] || 'png';
      const contentId = `signature-image-${Date.now()}-${index}`;
      inlineAttachments.push({
        name: `signature-${index + 1}.${ext}`,
        contentType: `image/${safeType}`,
        contentBytes,
        contentId,
        isInline: true,
      });
      index += 1;
      return `<img${before}src="cid:${contentId}"${after}>`;
    },
  );

  return { html: next, inlineAttachments };
}

/**
 * Embed CRM-hosted signature images (icons, local logos) as CID attachments so
 * Gmail/Outlook do not have to fetch localhost or app-origin URLs.
 */
export async function inlineSignatureImagesForSend(html: string): Promise<{
  html: string;
  inlineAttachments: InlineEmailAttachment[];
}> {
  const dataInlined = inlineDataImagesInHtml(html);
  let next = dataInlined.html;
  const inlineAttachments = [...dataInlined.inlineAttachments];
  const pageOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  const cidBySrc = new Map<string, string>();
  let index = inlineAttachments.length;

  const imgRe = /<img\b([^>]*?)src\s*=\s*(["'])([^"']+)\2([^>]*)>/gi;
  const matches = [...next.matchAll(imgRe)];

  for (const match of matches) {
    const src = match[3];
    if (!shouldEmbedImageForEmailClients(src, pageOrigin)) continue;

    const absolute = resolveImageSrc(src, pageOrigin);
    let contentId = cidBySrc.get(absolute);
    if (!contentId) {
      try {
        const response = await fetch(absolute);
        if (!response.ok) continue;
        const blob = await response.blob();
        const contentBytes = await blobToBase64(blob);
        if (!contentBytes) continue;
        const mime = (blob.type || 'image/png').split(';')[0].trim() || 'image/png';
        const safeType = mime.replace(/^image\//i, '').toLowerCase().replace(/[^a-z0-9.+-]/g, '') || 'png';
        const ext =
          safeType.includes('jpeg') || safeType === 'jpg' ? 'jpg' : safeType.split('+')[0] || 'png';
        contentId = `signature-icon-${Date.now()}-${index}`;
        inlineAttachments.push({
          name: `signature-icon-${index + 1}.${ext}`,
          contentType: mime.startsWith('image/') ? mime : `image/${safeType}`,
          contentBytes,
          contentId,
          isInline: true,
        });
        cidBySrc.set(absolute, contentId);
        index += 1;
      } catch (error) {
        console.warn('Could not embed signature image', absolute, error);
        continue;
      }
    }

    next = next.replace(match[0], `<img${match[1]}src="cid:${contentId}"${match[4]}>`);
  }

  return { html: next, inlineAttachments };
}

export async function buildOutgoingHtmlWithSignature(emailContent: string): Promise<{
  html: string;
  inlineAttachments: InlineEmailAttachment[];
}> {
  const withSignature = await appendEmailSignature(emailContent);
  return inlineSignatureImagesForSend(withSignature);
}

/**
 * Sanitize HTML signature for email clients (especially Gmail)
 * Removes non-email-safe attributes and ensures clean HTML
 * @param html - Raw HTML signature
 * @returns Cleaned HTML signature safe for email clients
 */
const sanitizeEmailSignature = (html: string): string => {
  if (!html) return '';
  
  // Use DOMParser if available (browser), otherwise use regex fallback
  if (typeof window !== 'undefined' && window.DOMParser) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      
      // List of email-safe HTML tags
      const allowedTags = ['div', 'p', 'br', 'strong', 'b', 'em', 'i', 'u', 'a', 'img', 
                          'span', 'table', 'tr', 'td', 'th', 'tbody', 'thead', 'ul', 'ol', 'li',
                          'h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
      
      // List of email-safe attributes per tag
      const allowedAttributes: Record<string, string[]> = {
        'a': ['href', 'target', 'style'],
        'img': ['src', 'alt', 'width', 'height', 'style'],
        'div': ['style'],
        'p': ['style'],
        'span': ['style'],
        'table': ['style', 'border', 'cellpadding', 'cellspacing'],
        'td': ['style', 'colspan', 'rowspan'],
        'th': ['style', 'colspan', 'rowspan'],
        'tr': ['style'],
        'ul': ['style'],
        'ol': ['style'],
        'li': ['style'],
      };
      
      // Recursively clean elements
      const cleanElement = (element: Element): void => {
        // Remove data-* attributes and other non-email-safe attributes
        Array.from(element.attributes).forEach(attr => {
          const tagName = element.tagName.toLowerCase();
          const allowed = allowedAttributes[tagName] || [];
          
          if (attr.name.startsWith('data-') || 
              attr.name.startsWith('id') && !allowed.includes('id') ||
              (!allowed.includes(attr.name) && attr.name !== 'style' && !allowedTags.includes(tagName))) {
            element.removeAttribute(attr.name);
          }
        });
        
        // Clean style attribute - remove unsupported CSS properties for email
        if (element.hasAttribute('style')) {
          const style = element.getAttribute('style') || '';
          // Keep only email-safe CSS properties
          const emailSafeStyles = style.split(';')
            .filter(prop => {
              const [key] = prop.split(':').map(s => s.trim());
              // Allow common email-safe CSS properties
              return ['color', 'background-color', 'font-family', 'font-size', 'font-weight',
                     'text-align', 'margin', 'padding', 'width', 'height', 'border',
                     'display', 'line-height', 'text-decoration'].includes(key.toLowerCase());
            })
            .join(';');
          
          if (emailSafeStyles) {
            element.setAttribute('style', emailSafeStyles);
          } else {
            element.removeAttribute('style');
          }
        }
        
        // Recursively clean children
        Array.from(element.children).forEach(child => {
          cleanElement(child as Element);
        });
      };
      
      // Clean all elements in the document
      if (doc.body) {
        Array.from(doc.body.children).forEach(child => {
          cleanElement(child);
        });
        
        return doc.body.innerHTML;
      }
    } catch (error) {
      console.warn('Failed to parse signature HTML, using fallback cleaning:', error);
    }
  }
  
  // Fallback: Use regex to remove data-* attributes and clean up
  let cleaned = html
    // Remove data-* attributes (including data-editing-info) - be more aggressive
    .replace(/\s+data-[a-zA-Z0-9\-_]*="[^"]*"/gi, '')
    .replace(/\s+data-[a-zA-Z0-9\-_]*='[^']*'/gi, '')
    .replace(/\s+data-[a-zA-Z0-9\-_]*=[^\s>]*/gi, '')
    // Remove id attributes (often contain editor-specific IDs like x_image_0)
    .replace(/\s+id="[^"]*"/gi, '')
    .replace(/\s+id='[^']*'/gi, '')
    .replace(/\s+id=[^\s>]*/gi, '')
    // Remove class attributes with editor-specific classes (like x_image_0)
    .replace(/\s+class="[^"]*x_[^"]*"/gi, '')
    .replace(/\s+class='[^']*x_[^']*'/gi, '')
    // Handle img tags with data-editing-info attribute - extract src from JSON
    .replace(/<img([^>]*)data-editing-info=['"](\{[^'"]*\})['"]([^>]*)>/gi, (match, before, jsonStr, after) => {
      try {
        // Parse the JSON from data-editing-info
        const jsonData = JSON.parse(jsonStr.replace(/'/g, '"'));
        const src = jsonData.src || '';
        
        if (src) {
          // Extract other attributes from the original img tag
          const combinedAttrs = before + after;
          const altMatch = combinedAttrs.match(/alt=["']([^"']+)["']/i);
          const widthMatch = combinedAttrs.match(/width=["']?(\d+)/i) || jsonStr.match(/"width":\s*(\d+)/i);
          const heightMatch = combinedAttrs.match(/height=["']?(\d+)/i) || jsonStr.match(/"height":\s*(\d+)/i);
          const styleMatch = combinedAttrs.match(/style=["']([^"']+)["']/i);
          
          // Build clean img tag
          let cleanImg = '<img';
          cleanImg += ` src="${src}"`;
          if (altMatch) cleanImg += ` alt="${altMatch[1]}"`;
          if (widthMatch) cleanImg += ` width="${widthMatch[1]}"`;
          if (heightMatch) cleanImg += ` height="${heightMatch[1]}"`;
          
          // Only keep email-safe styles (width, height, max-width, margin, display)
          if (styleMatch) {
            const safeStyles = styleMatch[1]
              .split(';')
              .filter((s: string) => {
                const [key] = s.split(':').map(x => x.trim());
                return ['width', 'height', 'max-width', 'margin', 'display', 'maxwidth'].includes(key.toLowerCase().replace(/-/g, ''));
              })
              .join(';');
            if (safeStyles.trim()) cleanImg += ` style="${safeStyles.trim()}"`;
          }
          cleanImg += ' />';
          return cleanImg;
        }
      } catch (e) {
        // If JSON parsing fails, try to extract src directly
        const srcMatch = jsonStr.match(/"src"\s*:\s*"([^"]+)"/i) || jsonStr.match(/'src'\s*:\s*'([^']+)'/i);
        if (srcMatch && srcMatch[1]) {
          return `<img src="${srcMatch[1]}" />`;
        }
      }
      return ''; // Remove broken tag if we can't fix it
    })
    // Fix base64 images: ensure they're properly formatted
    .replace(/data:image\/([^;]+);base64,([^"'>\s]+)/gi, (match, format, base64) => {
      // Ensure base64 string is valid and properly encoded
      return `data:image/${format};base64,${base64.trim()}`;
    })
    // Clean up any remaining img tags with problematic attributes
    .replace(/<img([^>]*id=["']x_[^"']+["'][^>]*)>/gi, (match) => {
      // Remove id attribute and clean up
      return match.replace(/\s+id=["']x_[^"']+["']/gi, '');
    })
    // Clean up multiple spaces
    .replace(/\s+/g, ' ')
    // Clean up empty style attributes
    .replace(/\s+style="\s*"/gi, '')
    .replace(/\s+style='\s*'/gi, '')
    // Remove any remaining data-* attributes that might have been missed
    .replace(/data-[a-zA-Z0-9\-]+="[^"]*"/gi, '')
    .replace(/data-[a-zA-Z0-9\-]+='[^']*'/gi, '')
    // Clean up quotes in HTML attributes
    .replace(/'/g, '"')
    // Ensure proper closing of img tags (some email clients need this)
    .replace(/<img([^>]+)>/gi, '<img$1 />');
  
  return cleaned;
};

async function generateCompanySignatureHtml(employeeId?: number): Promise<string> {
  const origin = typeof window !== 'undefined' ? window.location.origin : undefined;

  if (!employeeId) {
    const context = await fetchCurrentUserSignatureContext();
    if (!context) return '';
    if (!context.settings.signature_enabled) return '';
    if (context.profile.signature_enabled === false) return '';
    const html = generateEmailSignatureHtml(
      buildSignaturePerson(
        context.employee,
        context.profile.employee_id ? context.profile : emptySignatureProfile(context.employee.id),
      ),
      context.settings,
      { origin },
    );
    return html ? flattenImgTags(html) : '';
  }

  const [settings, employee, profile] = await Promise.all([
    fetchCompanySignatureSettings(),
    fetchSignatureEmployee(employeeId),
    fetchUserSignatureProfile(employeeId),
  ]);
  if (!settings.signature_enabled || !employee) return '';
  if (profile.signature_enabled === false) return '';

  const html = generateEmailSignatureHtml(
    buildSignaturePerson(employee, profile.employee_id ? profile : emptySignatureProfile(employee.id)),
    settings,
    { origin },
  );
  return html ? flattenImgTags(html) : '';
}

let currentUserSignatureCache: Promise<string> | null = null;

export function invalidateCurrentUserEmailSignatureCache(): void {
  currentUserSignatureCache = null;
}

/**
 * Build the current user's email signature at send time from company branding
 * + employee profile data. Does not persist HTML onto templates.
 */
export const getCurrentUserEmailSignature = async (): Promise<string> => {
  if (!currentUserSignatureCache) {
    currentUserSignatureCache = (async () => {
      try {
        const html = await generateCompanySignatureHtml();
        // Empty can mean auth session is not ready yet — do not cache that miss.
        if (!html) currentUserSignatureCache = null;
        return html;
      } catch (error) {
        console.error('Error getting email signature:', error);
        currentUserSignatureCache = null;
        return '';
      }
    })();
  }
  return currentUserSignatureCache;
};

export function prefetchCurrentUserEmailSignature(): void {
  void supabase.auth.getSession().then(({ data }) => {
    if (data.session?.user?.id) void getCurrentUserEmailSignature();
  });
}

/**
 * Append the user's email signature to email content
 * @param emailContent - The main email content
 * @returns Promise<string> - Email content with signature appended
 */
export const appendEmailSignature = async (emailContent: string): Promise<string> => {
  const signature = await getCurrentUserEmailSignature();
  
  if (!signature) {
    return emailContent;
  }

  // Check if signature is HTML or plain text
  const isHtml = signature.includes('<') && signature.includes('>');
  
  if (isHtml) {
    // Marker div lets the reading pane keep free text and signature on separate rows
    return `${emailContent}<div><br></div><div><br></div><div data-email-signature="1">${signature}</div>`;
  }

  return `${emailContent}${convertBodyToHtml(`--\n${signature}`)}`;
};

/**
 * Get email signature for a specific user by their display name
 * @param displayName - The user's display name
 * @returns Promise<string> - The user's email signature or empty string if not found
 */
export const getEmailSignatureByDisplayName = async (displayName: string): Promise<string> => {
  try {
    const trimmed = displayName.trim();
    if (!trimmed) return '';

    const { data: employeeData, error } = await supabase
      .from('tenants_employee')
      .select('id')
      .eq('display_name', trimmed)
      .maybeSingle();

    if (error || !employeeData?.id) {
      console.warn('Error fetching email signature for user:', displayName, error);
      return '';
    }

    return await generateCompanySignatureHtml(Number(employeeData.id));
  } catch (error) {
    console.error('Error getting email signature for user:', displayName, error);
    return '';
  }
};
