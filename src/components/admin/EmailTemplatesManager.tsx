import React, { useEffect, useState } from 'react';
import GenericCRUDManager from './GenericCRUDManager';
import { supabase } from '../../lib/supabase';

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

const normalizeString = (input: string) =>
  input
    .replace(/\\n/g, '\n')
    .replace(/\\t|\\r/g, ' ')
    .replace(HTML_PREFIX_REGEX, '')
    .replace(CLEAN_TOKEN_REGEX, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\bn\b\s*,?/gi, '\n')
    .replace(/^n(?=[A-Za-z])/i, '')
    .replace(/\s+/g, ' ')
    .replace(/\\\\/g, '\\')
    .trim();

const decodeTemplateContent = (raw?: string | null): string => {
  if (raw === null || raw === undefined) return '';

  if (typeof raw === 'object') {
    const extracted = extractFromOps(raw);
    if (extracted) return normalizeString(extracted);
    return normalizeString(JSON.stringify(raw));
  }

  const trimmed = raw.trim();
  if (!trimmed) return '';

  const attempts = [
    trimmed,
    trimmed.replace(/\\\\/g, '\\'),
    trimmed.replace(/\\'/g, "'"),
    trimmed.replace(/([,{]\s*)([A-Za-z0-9_]+)\s*:/g, '$1"$2":').replace(/'/g, '"')
  ];

  for (const candidate of attempts) {
    try {
      const parsed = JSON.parse(candidate);
      const extracted = extractFromOps(parsed) ?? (typeof parsed === 'string' ? parsed : '');
      if (extracted) return normalizeString(extracted);
    } catch {
      continue;
    }
  }

  if (trimmed.includes('insert\\') || trimmed.includes('delta')) {
    const stripped = trimmed
      .replace(/"|\\+/g, ' ')
      .replace(CLEAN_TOKEN_REGEX, ' ')
      .replace(/[{}\[\]]/g, ' ')
      .replace(/\bn\b\s*,?/gi, '\n')
      .replace(/\s+/g, ' ');
    return normalizeString(stripped);
  }

  return normalizeString(trimmed);
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
  const [placementOptions, setPlacementOptions] = useState<{ value: string; label: string }[]>([]);

  useEffect(() => {
    const loadPlacements = async () => {
      const { data, error } = await supabase
        .from('email_templates_placement')
        .select('id, name')
        .order('name', { ascending: true });

      if (error) {
        console.error('Failed to load placements', error);
        setPlacementOptions([]);
        return;
      }

      setPlacementOptions(
        (data || []).map((item) => ({
          value: String(item.id),
          label: item.name || `Placement ${item.id}`,
        }))
      );
    };

    loadPlacements();
  }, []);

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
      formatValue: (value: unknown) => (
        <span className="block max-w-xl truncate text-sm text-gray-700">
          {buildPreview(decodeTemplateContent(value as string))}
        </span>
      ),
      prepareValueForForm: (value: unknown) => decodeTemplateContent(value as string),
      prepareValueForSave: (value: unknown) => (typeof value === 'string' ? value : '')
    },
    {
      name: 'active',
      label: 'Active',
      type: 'boolean' as const
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
      options: placementOptions,
      foreignKey: {
        table: 'email_templates_placement',
        valueField: 'id',
        displayField: 'name'
      }
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

