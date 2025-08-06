import React from 'react';
import GenericCRUDManager from './GenericCRUDManager';

const WhatsAppTemplatesManager: React.FC = () => {
  const fields = [
    {
      name: 'title',
      label: 'Title',
      type: 'text' as const,
      required: true,
      placeholder: 'e.g., meeting_scheduling'
    },
    {
      name: 'name360',
      label: 'Name 360',
      type: 'text' as const,
      required: true,
      placeholder: 'e.g., meeting_scheduling'
    },
    {
      name: 'category',
      label: 'Category',
      type: 'text' as const,
      required: false,
      placeholder: 'e.g., Poland/Poland'
    },
    {
      name: 'params',
      label: 'Parameters',
      type: 'text' as const,
      required: false,
      placeholder: 'e.g., parameter1,parameter2'
    },
    {
      name: 'content',
      label: 'Content',
      type: 'textarea' as const,
      required: false,
      placeholder: 'e.g., Template message content',
      hideInTable: true
    },
    {
      name: 'languages',
      label: 'Languages',
      type: 'textarea' as const,
      required: false,
      placeholder: 'e.g., ["en", "he"]',
      hideInTable: true
    },
    {
      name: 'order_value',
      label: 'Order Value',
      type: 'number' as const,
      required: false,
      placeholder: 'e.g., 1'
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
      tableName="whatsapp_templates"
      fields={fields}
      title="WhatsApp Template"
      description="Manage WhatsApp message templates and their configurations"
      pageSize={10}
    />
  );
};

export default WhatsAppTemplatesManager; 