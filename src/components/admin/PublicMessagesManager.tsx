import React from 'react';
import GenericCRUDManager from './GenericCRUDManager';

// Helper function to detect Hebrew text
const containsHebrew = (text: string | null | undefined): boolean => {
  if (!text) return false;
  // Hebrew Unicode range: \u0590-\u05FF
  return /[\u0590-\u05FF]/.test(text);
};

const PublicMessagesManager: React.FC = () => {
  const fields = [
    {
      name: 'title',
      label: 'Title',
      type: 'text' as const,
      required: false,
      placeholder: 'e.g., Important Notice',
      formatValue: (value: any) => {
        if (!value) return '-';
        const isRTL = containsHebrew(String(value));
        return (
          <span dir={isRTL ? 'rtl' : 'ltr'} className="block text-right">
            {value}
          </span>
        );
      }
    },
    {
      name: 'content',
      label: 'Content',
      type: 'textarea' as const,
      required: true,
      placeholder: 'Enter the message content...',
      formatValue: (value: any) => {
        if (!value) return '-';
        const isRTL = containsHebrew(String(value));
        return (
          <span dir={isRTL ? 'rtl' : 'ltr'} className="block whitespace-pre-wrap text-right max-w-md">
            {value}
          </span>
        );
      }
    },
    {
      name: 'display_mode',
      label: 'Display Mode',
      type: 'select' as const,
      required: true,
      defaultValue: 'Everywhere',
      options: [
        { value: 'Scheduling screen only', label: 'Scheduling screen only' },
        { value: 'Everywhere', label: 'Everywhere' }
      ]
    },
    {
      name: 'start_date',
      label: 'Start Date',
      type: 'date' as const,
      required: true
    },
    {
      name: 'end_date',
      label: 'End Date',
      type: 'date' as const,
      required: true
    },
    {
      name: 'is_active',
      label: 'Active',
      type: 'boolean' as const,
      required: false,
      defaultValue: true,
      hideInEdit: true // Hide in edit mode since there's a toggle in the table
    }
  ];

  return (
    <GenericCRUDManager
      tableName="public_messages"
      fields={fields}
      title="Public Messages"
      description="Manage public messages displayed to users"
      pageSize={20}
      sortColumn="created_at"
    />
  );
};

export default PublicMessagesManager;

