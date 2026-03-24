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
      name: 'order',
      label: 'Order',
      type: 'number' as const,
      required: false,
      defaultValue: 0,
      placeholder: 'e.g., 1',
      hideInAdd: true,
      hideInEdit: true,
      hideInTable: true,
      prepareValueForSave: () => 0
    },
    {
      name: 'active',
      label: 'Active',
      type: 'boolean' as const,
      required: false,
      defaultValue: true,
      hideInAdd: true,
      hideInEdit: true,
      prepareValueForSave: () => true
    }
  ];

  return (
    <GenericCRUDManager
      tableName="misc_leadtag"
      fields={fields}
      title="Lead Tag"
      description="Manage lead tags for categorization"
      pageSize={10}
      sortColumn="id"
      skipIdAssignment={true}
    />
  );
};

export default LeadTagsManager; 