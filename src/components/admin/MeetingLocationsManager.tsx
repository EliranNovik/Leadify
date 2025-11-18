import React from 'react';
import GenericCRUDManager from './GenericCRUDManager';

const stripHtml = (value: unknown): string => {
  if (typeof value !== 'string') return '';

  let sanitized = value
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/&nbsp;/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ');

  // Collapse duplicated escape sequences one more time in case of double-encoded strings
  sanitized = sanitized.replace(/\\+/g, '');

  return sanitized.trim();
};

const buildAddressPreview = (value: unknown): string => {
  const clean = stripHtml(value);
  if (!clean) return '—';

  const sentenceBoundary = clean.indexOf('.');
  const lineBreak = clean.indexOf('\n');
  const cutoffCandidates = [sentenceBoundary, lineBreak].filter((idx) => idx > -1);
  const cutoff = cutoffCandidates.length ? Math.min(...cutoffCandidates) : -1;

  const preview = cutoff > -1 ? clean.slice(0, cutoff + (clean[cutoff] === '.' ? 1 : 0)) : clean.trim();
  const trimmed = preview.trim();
  return trimmed ? `${trimmed} ...` : '—';
};

const MeetingLocationsManager: React.FC = () => {
  const fields = [
    {
      name: 'name',
      label: 'Location Name',
      type: 'text' as const,
      required: true,
      placeholder: 'e.g., Tel Aviv Office'
    },
    {
      name: 'default_link',
      label: 'Default Link',
      type: 'text' as const,
      required: false,
      placeholder: 'https://meet.example.com/room123'
    },
    {
      name: 'address',
      label: 'Address',
      type: 'textarea' as const,
      required: false,
      placeholder: 'Street, City, Notes',
      formatValue: (value: unknown) => (
        <span className="block max-w-xs whitespace-pre-wrap text-sm text-gray-700">
          {buildAddressPreview(value)}
        </span>
      ),
      prepareValueForForm: (value: unknown) => stripHtml(value),
      prepareValueForSave: (value: unknown) =>
        typeof value === 'string' ? stripHtml(value) : ''
    },
    {
      name: 'is_physical_location',
      label: 'Physical Location',
      type: 'boolean' as const,
      required: false
    }
  ];

  return (
    <GenericCRUDManager
      tableName="tenants_meetinglocation"
      fields={fields}
      title="Meeting Location"
      description="Manage meeting locations and their configurations"
      pageSize={10}
      sortColumn="id"
    />
  );
};

export default MeetingLocationsManager;