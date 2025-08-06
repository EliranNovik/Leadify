import React from 'react';
import GenericCRUDManager from './GenericCRUDManager';

const WhatsAppNumbersManager: React.FC = () => {
  const fields = [
    {
      name: 'name',
      label: 'Name',
      type: 'text' as const,
      required: true,
      placeholder: 'e.g., default, mike'
    },
    {
      name: 'title',
      label: 'Title',
      type: 'text' as const,
      required: true,
      placeholder: 'e.g., default, mike'
    },
    {
      name: 'display_title',
      label: 'Display Title',
      type: 'text' as const,
      required: false,
      placeholder: 'e.g., Default WhatsApp Number'
    },
    {
      name: 'phone_number',
      label: 'Phone Number',
      type: 'text' as const,
      required: true,
      placeholder: 'e.g., 972503489649'
    },
    {
      name: 'api_key',
      label: 'API Key',
      type: 'textarea' as const,
      required: true,
      placeholder: 'e.g., vo00nbg4mNvDMmK5J0Xn0asAAK'
    },
    {
      name: 'namespace',
      label: 'Namespace',
      type: 'text' as const,
      required: true,
      placeholder: 'e.g., 445b1f0f_3c24_4d76_9fca_d0be0f371117'
    },
    {
      name: 'allowed_employee_names',
      label: 'Allowed Employee Names',
      type: 'textarea' as const,
      required: false,
      placeholder: 'e.g., ["John Doe", "Jane Smith"]',
      hideInTable: true
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
      tableName="whatsapp_numbers"
      fields={fields}
      title="WhatsApp Number"
      description="Manage WhatsApp Business API numbers and their configurations"
      pageSize={10}
    />
  );
};

export default WhatsAppNumbersManager; 