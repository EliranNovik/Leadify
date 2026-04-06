import React from 'react';
import GenericCRUDManager from './GenericCRUDManager';

const FirmsManager: React.FC = () => {
  const fields = [
    {
      name: 'name',
      label: 'Firm name',
      type: 'text' as const,
      required: true,
      placeholder: 'Organization name',
    },
    {
      name: 'firm_type_id',
      label: 'Firm type',
      type: 'select' as const,
      required: false,
      searchableSelect: true,
      foreignKey: {
        table: 'firm_types',
        valueField: 'id',
        displayField: 'label',
      },
    },
    {
      name: 'legal_name',
      label: 'Legal name',
      type: 'text' as const,
      required: false,
      placeholder: 'Registered legal entity name',
    },
    {
      name: 'vat_number',
      label: 'VAT number',
      type: 'text' as const,
      required: false,
    },
    {
      name: 'website',
      label: 'Website',
      type: 'text' as const,
      required: false,
      placeholder: 'https://…',
    },
    {
      name: 'address',
      label: 'Address',
      type: 'textarea' as const,
      required: false,
      hideInTable: true,
    },
    {
      name: 'contract',
      label: 'Contract',
      type: 'textarea' as const,
      required: false,
      placeholder: 'URL, storage path, or notes',
      hideInTable: true,
    },
    {
      name: 'invoices',
      label: 'Invoices',
      type: 'textarea' as const,
      required: false,
      placeholder: 'URL, storage path, or notes',
      hideInTable: true,
    },
    {
      name: 'other_docs',
      label: 'Other documents',
      type: 'textarea' as const,
      required: false,
      placeholder: 'URL, storage path, or notes',
      hideInTable: true,
    },
    {
      name: 'notes',
      label: 'Notes',
      type: 'textarea' as const,
      required: false,
      placeholder: 'Internal notes',
    },
    {
      name: 'is_active',
      label: 'Active',
      type: 'boolean' as const,
      required: false,
    },
  ];

  return (
    <GenericCRUDManager
      tableName="firms"
      fields={fields}
      title="Firm"
      description="Organizations, referral partners, and service providers"
      pageSize={15}
      sortColumn="name"
      skipIdAssignment
    />
  );
};

export default FirmsManager;
