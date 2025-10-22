import React from 'react';
import GenericCRUDManager from './GenericCRUDManager';

const UsersManager: React.FC = () => {

  const fields = [
    {
      name: 'email',
      label: 'Email',
      type: 'email' as const,
      required: true,
      placeholder: 'e.g., user@example.com'
    },
    {
      name: 'first_name',
      label: 'First Name',
      type: 'text' as const,
      required: false,
      placeholder: 'e.g., John'
    },
    {
      name: 'last_name',
      label: 'Last Name',
      type: 'text' as const,
      required: false,
      placeholder: 'e.g., Doe'
    },
    {
      name: 'role',
      label: 'Role',
      type: 'select' as const,
      required: false,
      options: [
        { value: 'user', label: 'User' },
        { value: 'admin', label: 'Admin' }
      ],
      placeholder: 'Select a role'
    },
    {
      name: 'is_active',
      label: 'Is Active',
      type: 'boolean' as const,
      required: false
    },
    {
      name: 'is_staff',
      label: 'Is Staff',
      type: 'boolean' as const,
      required: false
    },
    {
      name: 'is_superuser',
      label: 'Is Superuser',
      type: 'boolean' as const,
      required: false
    },
    {
      name: 'password',
      label: 'Password',
      type: 'password' as const,
      required: true,
      placeholder: 'Enter password (required for new users)',
      hideInTable: true
    },
    {
      name: 'new_password',
      label: 'New Password',
      type: 'password' as const,
      required: false,
      placeholder: 'Enter new password (leave blank to keep current)',
      hideInTable: true,
      hideInAdd: true
    },
    {
      name: 'updated_by',
      label: 'Updated By',
      type: 'text' as const,
      required: false,
      placeholder: 'User ID who last updated',
      hideInTable: true,
      readOnly: true,
      foreignKey: {
        table: 'users',
        displayField: 'email',
        valueField: 'id'
      }
    },
    {
      name: 'created_at',
      label: 'Created At',
      type: 'datetime' as const,
      required: false,
      hideInTable: true,
      readOnly: true
    },
    {
      name: 'updated_at',
      label: 'Updated At',
      type: 'datetime' as const,
      required: false,
      hideInTable: true,
      readOnly: true
    },
    {
      name: 'last_login',
      label: 'Last Login',
      type: 'datetime' as const,
      required: false,
      hideInTable: true,
      readOnly: true
    },
    {
      name: 'date_joined',
      label: 'Date Joined',
      type: 'datetime' as const,
      required: false,
      hideInTable: true,
      readOnly: true
    }
  ];

  return (
    <GenericCRUDManager
      tableName="users"
      fields={fields}
      title="User"
      description="Manage system users and their permissions"
      pageSize={50}
      sortColumn="created_at"
    />
  );
};

export default UsersManager;
