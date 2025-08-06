import React from 'react';
import GenericCRUDManager from './GenericCRUDManager';

const BankAccountsManager: React.FC = () => {
  const fields = [
    {
      name: 'name',
      label: 'Bank Name',
      type: 'text' as const,
      required: true,
      placeholder: 'e.g., Hapoalim'
    },
    {
      name: 'account_name',
      label: 'Account Name',
      type: 'text' as const,
      required: false,
      placeholder: 'e.g., Adv. Michael Decker'
    },
    {
      name: 'account_number',
      label: 'Account Number',
      type: 'text' as const,
      required: false,
      placeholder: 'e.g., 3444445'
    },
    {
      name: 'bank_code',
      label: 'Bank Code',
      type: 'text' as const,
      required: false,
      placeholder: 'e.g., 12'
    },
    {
      name: 'branch_number',
      label: 'Branch Number',
      type: 'text' as const,
      required: false,
      placeholder: 'e.g., 782'
    },
    {
      name: 'branch_name',
      label: 'Branch Name',
      type: 'text' as const,
      required: false,
      placeholder: 'e.g., 782'
    },
    {
      name: 'branch_address',
      label: 'Branch Address',
      type: 'textarea' as const,
      required: false,
      placeholder: 'e.g., Rehavia, 38 Azza St., Jerusalem'
    },
    {
      name: 'swift_code',
      label: 'SWIFT Code',
      type: 'text' as const,
      required: false,
      placeholder: 'e.g., POALILIT'
    },
    {
      name: 'iban',
      label: 'IBAN',
      type: 'text' as const,
      required: false,
      placeholder: 'e.g., IL100127820000000344445'
    },
    {
      name: 'bank_phone',
      label: 'Bank Phone',
      type: 'text' as const,
      required: false,
      placeholder: 'e.g., +972-2-569854'
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
      tableName="bank_accounts"
      fields={fields}
      title="Bank Account"
      description="Manage company bank accounts and their details"
      pageSize={10}
    />
  );
};

export default BankAccountsManager; 