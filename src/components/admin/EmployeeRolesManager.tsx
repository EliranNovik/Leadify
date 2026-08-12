import React from 'react';
import GenericCRUDManager from './GenericCRUDManager';

const EmployeeRolesManager: React.FC = () => {
  const fields = [
    {
      name: 'id',
      label: 'ID',
      type: 'number' as const,
      required: false,
      hideInAdd: true,
      hideInEdit: true,
      readOnly: true,
    },
    {
      name: 'code',
      label: 'Code',
      type: 'text' as const,
      required: true,
      placeholder: 'e.g., om',
    },
    {
      name: 'name',
      label: 'Display name',
      type: 'text' as const,
      required: true,
      placeholder: 'e.g., Office Manager',
    },
    {
      name: 'sort_order',
      label: 'Sort order',
      type: 'number' as const,
      required: false,
      defaultValue: 100,
      placeholder: '100',
    },
    {
      name: 'is_selectable',
      label: 'Selectable',
      type: 'boolean' as const,
      required: false,
      defaultValue: true,
    },
    {
      name: 'is_active',
      label: 'Active',
      type: 'boolean' as const,
      required: false,
      defaultValue: true,
    },
    {
      name: 'alias_of_id',
      label: 'Alias of',
      type: 'select' as const,
      required: false,
      searchableSelect: true,
      foreignKey: {
        table: 'employee_roles',
        valueField: 'id',
        displayField: 'name',
      },
      placeholder: 'Optional — leave empty for canonical roles',
    },
  ];

  return (
    <GenericCRUDManager
      tableName="employee_roles"
      fields={fields}
      title="Employee role"
      description="Manage employee bonuses/org roles (stored by id; employees link via bonuses_role_id)."
      pageSize={25}
      sortColumn="sort_order"
    />
  );
};

export default EmployeeRolesManager;
