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
      name: 'is_important',
      label: 'Important Department',
      type: 'boolean' as const,
      required: false
    },
    {
      name: 'fixed_monthly_cost',
      label: 'Fixed Monthly Cost',
      type: 'number' as const,
      required: false,
      placeholder: 'e.g., 5000'
    },
    {
      name: 'marginal_cost_percentage',
      label: 'Marginal Cost %',
      type: 'number' as const,
      required: false,
      placeholder: 'e.g., 15.5'
    },
    {
      name: 'min_monthly_sales_target',
      label: 'Min Monthly Sales Target',
      type: 'number' as const,
      required: false,
      placeholder: 'e.g., 10000'
    }
  ];

  return (
    <GenericCRUDManager
      tableName="departments"
      fields={fields}
      title="Department"
      description="Manage company departments and their cost structures"
      pageSize={10}
    />
  );
};

export default DepartmentsManager; 