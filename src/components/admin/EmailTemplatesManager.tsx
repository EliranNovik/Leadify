import React from 'react';
import GenericCRUDManager from './GenericCRUDManager';

const CLEAN_TOKEN_REGEX = /\b(delta|ops|insert|attributes|underline|bold|italic|direction|align|list|background|color|font|size|script)\b\s*[:=]\s*[^,]+,?/gi;
const HTML_PREFIX_REGEX = /html\s*:\s*/i;

const extractFromOps = (value: any): string | null => {
  const ops =
    value?.delta?.ops ||
    value?.ops ||
    (Array.isArray(value) ? value : null);
  if (!Array.isArray(ops)) return null;

  return ops
    .map((op) => {
      if (typeof op.insert !== 'string') return '';
      return op.insert;
    })
    .join('');
};

// Enhanced HTML tag removal function - preserves line breaks
const stripHtmlTags = (input: string): string => {
  if (!input || typeof input !== 'string') return '';
  
  let cleaned = input;
  
  // First decode HTML entities to prevent them from being part of tags
  cleaned = cleaned
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
  
  // Convert block-level HTML elements to line breaks BEFORE removing tags
  // This preserves paragraph and div structure as line breaks
  cleaned = cleaned
    .replace(/<\/p>/gi, '\n') // Paragraph closing tags become line breaks
    .replace(/<p[^>]*>/gi, '\n') // Paragraph opening tags become line breaks
    .replace(/<\/div>/gi, '\n') // Div closing tags become line breaks
    .replace(/<div[^>]*>/gi, '\n') // Div opening tags become line breaks
    .replace(/<\/h[1-6]>/gi, '\n') // Heading closing tags become line breaks
    .replace(/<h[1-6][^>]*>/gi, '\n') // Heading opening tags become line breaks
    .replace(/<br\s*\/?>/gi, '\n') // BR tags become line breaks
    .replace(/<\/li>/gi, '\n') // List item closing tags become line breaks
    .replace(/<li[^>]*>/gi, '\n• ') // List item opening tags become line breaks with bullet
    .replace(/<\/ul>/gi, '\n') // Unordered list closing
    .replace(/<ul[^>]*>/gi, '\n') // Unordered list opening
    .replace(/<\/ol>/gi, '\n') // Ordered list closing
    .replace(/<ol[^>]*>/gi, '\n'); // Ordered list opening
  
  // Remove all HTML tags - more comprehensive regex
  // This handles: <tag>, </tag>, <tag attr="value">, <tag/>, <!-- comments -->
  cleaned = cleaned
    .replace(/<!--[\s\S]*?-->/g, '') // Remove HTML comments first
    .replace(/<script[\s\S]*?<\/script>/gi, '') // Remove script tags and content
    .replace(/<style[\s\S]*?<\/style>/gi, '') // Remove style tags and content
    .replace(/<[^>]*>/g, '') // Remove all remaining HTML tags (opening, closing, self-closing)
    .replace(/<\/[^>]*>/g, '') // Extra pass for closing tags
    .replace(/<[^>]*$/g, '') // Remove incomplete tags at end
    .replace(/^[^<]*>/g, ''); // Remove incomplete tags at start
  
  // Remove any remaining HTML entities
  cleaned = cleaned
    .replace(/&[a-z]{2,10};/gi, '') // Remove named entities (2-10 chars)
    .replace(/&#\d{1,7};/g, '') // Remove numeric entities
    .replace(/&#x[0-9a-f]{1,6};/gi, '') // Remove hex entities
    .replace(/&[#\w]+;/g, ''); // Catch-all for any remaining entities
  
  // Normalize line breaks (convert \r\n to \n, then clean up multiple line breaks)
  cleaned = cleaned
    .replace(/\r\n/g, '\n') // Windows line breaks
    .replace(/\r/g, '\n') // Old Mac line breaks
    .replace(/\n{3,}/g, '\n\n') // Multiple line breaks to max 2
    .replace(/[ \t]+/g, ' ') // Multiple spaces/tabs to single space (but preserve line breaks)
    .replace(/[ \t]+\n/g, '\n') // Remove trailing spaces before line breaks
    .replace(/\n[ \t]+/g, '\n') // Remove leading spaces after line breaks
    .trim();
  
  return cleaned;
};

const normalizeString = (input: string) => {
  let normalized = input
    .replace(/\\n/g, '\n') // Convert escaped newlines to actual newlines
    .replace(/\\r/g, '\n') // Convert escaped carriage returns to newlines
    .replace(/\\t/g, ' ') // Convert tabs to spaces
    .replace(HTML_PREFIX_REGEX, '')
    .replace(CLEAN_TOKEN_REGEX, '')
    .replace(/\bn\b\s*,?/gi, '\n') // Convert literal 'n' followed by comma to newline
    .replace(/^n(?=[A-Za-z])/i, '') // Remove leading 'n' before letters
    .replace(/\\\\/g, '\\'); // Unescape backslashes
  
  // Normalize line breaks but preserve them
  normalized = normalized
    .replace(/\r\n/g, '\n') // Windows line breaks
    .replace(/\r/g, '\n') // Old Mac line breaks
    .replace(/\n{3,}/g, '\n\n') // Multiple line breaks to max 2
    .trim();
  
  return normalized;
};

const decodeTemplateContent = (raw?: string | null): string => {
  if (raw === null || raw === undefined) return '';

  let processedContent = '';

  if (typeof raw === 'object') {
    const extracted = extractFromOps(raw);
    processedContent = extracted || JSON.stringify(raw);
  } else {
    const trimmed = raw.trim();
    if (!trimmed) return '';

    const attempts = [
      trimmed,
      trimmed.replace(/\\\\/g, '\\'),
      trimmed.replace(/\\'/g, "'"),
      trimmed.replace(/([,{]\s*)([A-Za-z0-9_]+)\s*:/g, '$1"$2":').replace(/'/g, '"')
    ];

    let found = false;
    for (const candidate of attempts) {
      try {
        const parsed = JSON.parse(candidate);
        const extracted = extractFromOps(parsed) ?? (typeof parsed === 'string' ? parsed : '');
        if (extracted) {
          processedContent = extracted;
          found = true;
          break;
        }
      } catch {
        continue;
      }
    }

    if (!found) {
      if (trimmed.includes('insert\\') || trimmed.includes('delta')) {
        processedContent = trimmed
          .replace(/"|\\+/g, ' ')
          .replace(CLEAN_TOKEN_REGEX, ' ')
          .replace(/[{}\[\]]/g, ' ')
          .replace(/\bn\b\s*,?/gi, '\n')
          .replace(/\s+/g, ' ');
      } else {
        processedContent = trimmed;
      }
    }
  }

  // First strip HTML tags, then normalize
  const htmlStripped = stripHtmlTags(processedContent);
  return normalizeString(htmlStripped);
};

const buildPreview = (text: string): string => {
  const normalized = text.replace(/\s+/g, ' ').replace(/^n+/i, '').trim();
  if (!normalized) return '—';
  const boundary = normalized.indexOf('.');
  if (boundary > -1 && boundary < 90) {
    return `${normalized.slice(0, boundary + 1).trim()} …`;
  }
  if (normalized.length > 90) {
    return `${normalized.slice(0, 90).trim()} …`;
  }
  return normalized;
};

const EmailTemplatesManager: React.FC = () => {
  // Placement options are now loaded automatically via foreignKey configuration

  const fields = [
    {
      name: 'name',
      label: 'Template Name',
      type: 'text' as const,
      required: true,
      placeholder: 'e.g., Welcome Email'
    },
    {
      name: 'content',
      label: 'Content',
      type: 'textarea' as const,
      required: true,
      placeholder: 'Paste the email body here...',
      formatValue: (value: unknown) => {
        const decoded = decodeTemplateContent(value as string);
        const cleaned = stripHtmlTags(decoded); // Extra pass to ensure HTML is removed
        // Preserve line breaks in preview by converting to spaces for single-line display
        const preview = cleaned.replace(/\n/g, ' ').substring(0, 100);
        return (
          <span className="block max-w-xl truncate text-sm text-gray-700 whitespace-pre-wrap">
            {preview}{cleaned.length > 100 ? '...' : ''}
          </span>
        );
      },
      prepareValueForForm: (value: unknown) => {
        const decoded = decodeTemplateContent(value as string);
        return stripHtmlTags(decoded); // Ensure HTML is stripped when loading into form
      },
      prepareValueForSave: (value: unknown) => {
        // When saving, strip HTML tags to keep database clean
        if (typeof value === 'string') {
          return stripHtmlTags(value);
        }
        return '';
      }
    },
    {
      name: 'active',
      label: 'Active',
      type: 'boolean' as const,
      hideInAdd: true, // Hide in add mode - will default to active
      hideInEdit: true, // Hide in edit mode since there's a toggle in the table
      defaultValue: true // Default to active (true) when creating new templates - will be converted to 't' on save
    },
    {
      name: 'category_id',
      label: 'Category',
      type: 'select' as const,
      foreignKey: {
        table: 'misc_category',
        valueField: 'id',
        displayField: 'name',
        joinTable: 'misc_maincategory',
        joinField: 'parent_id',
        joinDisplayField: 'name'
      }
    },
    {
      name: 'language_id',
      label: 'Language',
      type: 'select' as const,
      foreignKey: {
        table: 'misc_language',
        valueField: 'id',
        displayField: 'name'
      }
    },
    {
      name: 'placement_id',
      label: 'Placement',
      type: 'select' as const,
      required: false,
      foreignKey: {
        table: 'email_templates_placement',
        valueField: 'id',
        displayField: 'name'
      },
      placeholder: 'Select Placement'
    }
  ];

  return (
    <GenericCRUDManager
      tableName="misc_emailtemplate"
      fields={fields}
      title="Email Templates"
      description="Manage reusable email templates"
      sortColumn="id"
      pageSize={20}
    />
  );
};

export default EmailTemplatesManager;

