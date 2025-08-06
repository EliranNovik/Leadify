import React from 'react';
import GenericCRUDManager from './GenericCRUDManager';

const CurrenciesManager: React.FC = () => {
  const fields = [
    {
      name: 'name',
      label: 'Currency Symbol',
      type: 'text' as const,
      required: true,
      placeholder: 'e.g., ₪, €, $, £'
    },
    {
      name: 'iso_code',
      label: 'ISO Code',
      type: 'text' as const,
      required: true,
      placeholder: 'e.g., ILS, EUR, USD, GBP'
    },
    {
      name: 'order_value',
      label: 'Display Order',
      type: 'number' as const,
      required: false,
      placeholder: 'e.g., 100'
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
      tableName="currencies"
      fields={fields}
      title="Currency"
      description="Manage system currencies and their display settings"
      pageSize={10}
    />
  );
};

export default CurrenciesManager; 