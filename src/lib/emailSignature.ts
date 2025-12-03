import { supabase } from './supabase';

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

/**
 * Get the current user's email signature from the database
 * @returns Promise<string> - The user's email signature or empty string if not found
 */
export const getCurrentUserEmailSignature = async (): Promise<string> => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) {
      console.warn('No authenticated user found');
      return '';
    }

    // Get the user's full_name from users table
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('full_name')
      .eq('auth_id', user.id)
      .single();

    if (userError || !userData?.full_name) {
      console.warn('Could not get user full name:', userError);
      return '';
    }

    // Get the employee's email signature
    const { data: employeeData, error } = await supabase
      .from('tenants_employee')
      .select('email_signature')
      .eq('display_name', userData.full_name)
      .single();

    if (error) {
      console.warn('Error fetching email signature:', error);
      return '';
    }

    const signature = employeeData?.email_signature || '';
    
    // Sanitize the signature to remove non-email-safe attributes
    if (signature) {
      return sanitizeEmailSignature(signature);
    }
    
    return '';
  } catch (error) {
    console.error('Error getting email signature:', error);
    return '';
  }
};

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
    // For HTML emails, append HTML signature
    return `${emailContent}<br><br>${signature}`;
  } else {
    // For plain text emails, append plain text signature
    return `${emailContent}\n\n${signature}`;
  }
};

/**
 * Get email signature for a specific user by their display name
 * @param displayName - The user's display name
 * @returns Promise<string> - The user's email signature or empty string if not found
 */
export const getEmailSignatureByDisplayName = async (displayName: string): Promise<string> => {
  try {
    const { data: employeeData, error } = await supabase
      .from('tenants_employee')
      .select('email_signature')
      .eq('display_name', displayName)
      .single();

    if (error) {
      console.warn('Error fetching email signature for user:', displayName, error);
      return '';
    }

    const signature = employeeData?.email_signature || '';
    
    // Sanitize the signature to remove non-email-safe attributes
    if (signature) {
      return sanitizeEmailSignature(signature);
    }
    
    return '';
  } catch (error) {
    console.error('Error getting email signature for user:', displayName, error);
    return '';
  }
};
