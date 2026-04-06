import React from 'react';
import GenericCRUDManager from './GenericCRUDManager';

const FirmContactsManager: React.FC = () => {
  const fields = [
    {
      name: 'firm_id',
      label: 'Firm',
      type: 'select' as const,
      required: true,
      searchableSelect: true,
      foreignKey: {
        table: 'firms',
        valueField: 'id',
        displayField: 'name',
      },
    },
    {
      name: 'name',
      label: 'Name',
      type: 'text' as const,
      required: true,
    },
    {
      name: 'email',
      label: 'Email',
      type: 'email' as const,
      required: false,
    },
    {
      name: 'second_email',
      label: 'Second email',
      type: 'email' as const,
      required: false,
    },
    {
      name: 'phone',
      label: 'Phone',
      type: 'text' as const,
      required: false,
    },
    {
      name: 'profile_image_url',
      label: 'Profile image URL',
      type: 'text' as const,
      required: false,
      placeholder: 'https://…',
    },
    {
      name: 'user_email',
      label: 'Login email',
      type: 'email' as const,
      required: false,
      placeholder: 'If different from contact email',
    },
    {
      name: 'password_hash',
      label: 'Password hash',
      type: 'password' as const,
      required: false,
      hideInTable: true,
      placeholder: 'Store only a hash — or leave blank',
    },
    {
      name: 'firm_owner',
      label: 'Firm owner',
      type: 'boolean' as const,
      required: false,
    },
    {
      name: 'is_active',
      label: 'Active',
      type: 'boolean' as const,
      required: false,
    },
    {
      name: 'notes',
      label: 'Notes',
      type: 'textarea' as const,
      required: false,
    },
  ];

  return (
    <GenericCRUDManager
      tableName="firm_contacts"
      fields={fields}
      title="Firm contact"
      description="People linked to a firm."
      pageSize={15}
      sortColumn="name"
      skipIdAssignment
    />
  );
};

export default FirmContactsManager;
