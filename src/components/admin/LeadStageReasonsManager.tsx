import React from 'react';
import GenericCRUDManager from './GenericCRUDManager';

const LeadStageReasonsManager: React.FC = () => {
  const fields = [
    {
      name: 'name',
      label: 'Reason Name',
      type: 'text' as const,
      required: true,
      placeholder: 'e.g., test'
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
      tableName="lead_stage_reasons"
      fields={fields}
      title="Lead Stage Reason"
      description="Manage lead stage reasons for categorization"
      pageSize={10}
    />
  );
};

export default LeadStageReasonsManager; 