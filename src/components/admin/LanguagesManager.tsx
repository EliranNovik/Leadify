import React from 'react';
import GenericCRUDManager from './GenericCRUDManager';

const LanguagesManager: React.FC = () => {
  const fields = [
    {
      name: 'name',
      label: 'Language Name',
      type: 'text' as const,
      required: true,
      placeholder: 'e.g., English'
    },
    {
      name: 'iso_code',
      label: 'ISO Code',
      type: 'text' as const,
      required: true,
      placeholder: 'e.g., EN'
    },
    {
      name: 'is_active',
      label: 'Active',
      type: 'boolean' as const,
      required: false
    }
  ];

  return (
    <GenericCRUDManager
      tableName="languages"
      fields={fields}
      title="Language"
      description="Manage system languages and their configurations"
      pageSize={10}
    />
  );
};

export default LanguagesManager; 