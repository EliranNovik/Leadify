import React from 'react';
import GenericCRUDManager from './GenericCRUDManager';

const EmailTemplatesPlacementManager: React.FC = () => {
  const fields = [
    {
      name: 'name',
      label: 'Placement Name',
      type: 'text' as const,
      required: true,
      placeholder: 'e.g., Header, Footer, Body'
    }
  ];

  return (
    <GenericCRUDManager
      tableName="email_templates_placement"
      fields={fields}
      title="Email Templates Placement"
      description="Manage email template placement options"
      pageSize={20}
      sortColumn="name"
    />
  );
};

export default EmailTemplatesPlacementManager;

