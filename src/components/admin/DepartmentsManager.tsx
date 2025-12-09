import React from 'react';
import GenericCRUDManager from './GenericCRUDManager';

const DepartmentsManager: React.FC = () => {
  const fields = [
    {
      name: 'name',
      label: 'Department Name',
      type: 'text' as const,
      required: true,
      placeholder: 'e.g., Legal Department'
    },
    {
      name: 'fixed_cost',
      label: 'Fixed Cost',
      type: 'text' as const,
      required: false,
      placeholder: 'e.g., 5000'
    },
    {
      name: 'marginal_cost',
      label: 'Marginal Cost',
      type: 'text' as const,
      required: false,
      placeholder: 'e.g., 15.5'
    },
    {
      name: 'min_income',
      label: 'Min Income',
      type: 'text' as const,
      required: false,
      placeholder: 'e.g., 10000'
    },
    {
      name: 'important',
      label: 'Important',
      type: 'boolean' as const,
      required: false,
      hideInAdd: true,
      hideInEdit: true,
      prepareValueForForm: (value: any) => {
        if (value === 't' || value === true) return true;
        if (value === 'f' || value === false) return false;
        return false;
      },
      prepareValueForSave: (value: any) => {
        return value === true ? 't' : 'f';
      }
    }
  ];

  return (
    <GenericCRUDManager
      tableName="tenant_departement"
      fields={fields}
      title="Department"
      description="Manage company departments and their cost structures"
      pageSize={10}
      sortColumn="id"
    />
  );
};

export default DepartmentsManager; 