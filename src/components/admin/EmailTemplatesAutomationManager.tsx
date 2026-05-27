import React from 'react';
import GenericCRUDManager from './GenericCRUDManager';

const EmailTemplatesAutomationManager: React.FC = () => {
  const fields = [
    {
      name: 'meeting_location_id',
      label: 'Meeting Location',
      type: 'select' as const,
      required: false,
      placeholder: 'All locations (fallback)',
      foreignKey: {
        table: 'tenants_meetinglocation',
        valueField: 'id',
        displayField: 'name',
      },
      prepareValueForSave: (value: unknown) => {
        if (value == null || value === '' || value === 'null') return null;
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
      },
    },
    {
      name: 'placement_id',
      label: 'Email Placement',
      type: 'select' as const,
      required: true,
      foreignKey: {
        table: 'email_templates_placement',
        valueField: 'id',
        displayField: 'name',
      },
    },
    {
      name: 'language_id',
      label: 'Language',
      type: 'select' as const,
      required: true,
      foreignKey: {
        table: 'misc_language',
        valueField: 'id',
        displayField: 'name',
      },
    },
    {
      name: 'email_template_id',
      label: 'Email Template',
      type: 'select' as const,
      required: true,
      foreignKey: {
        table: 'misc_emailtemplate',
        valueField: 'id',
        displayField: 'name',
      },
    },
    {
      name: 'is_active',
      label: 'Active',
      type: 'boolean' as const,
      defaultValue: true,
    },
    {
      name: 'notes',
      label: 'Notes',
      type: 'textarea' as const,
      required: false,
      placeholder: 'Optional admin notes',
    },
  ];

  return (
    <GenericCRUDManager
      tableName="email_templates_automation"
      fields={fields}
      title="Email Templates Automation"
      description="Connect meeting locations, email placements, and languages to email templates used by the Meeting tab."
      pageSize={20}
      sortColumn="id"
      booleanStorage="native"
    />
  );
};

export default EmailTemplatesAutomationManager;
