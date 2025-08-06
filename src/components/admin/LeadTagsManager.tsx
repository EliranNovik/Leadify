import React from 'react';
import GenericCRUDManager from './GenericCRUDManager';

const LeadTagsManager: React.FC = () => {
  const fields = [
    {
      name: 'name',
      label: 'Tag Name',
      type: 'text' as const,
      required: true,
      placeholder: 'e.g., VIP'
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
      tableName="leads_tags"
      fields={fields}
      title="Lead Tag"
      description="Manage lead tags for categorization"
      pageSize={10}
    />
  );
};

export default LeadTagsManager; 