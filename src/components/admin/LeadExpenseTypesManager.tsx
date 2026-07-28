import React from 'react';
import GenericCRUDManager from './GenericCRUDManager';

const toExpenseTypeCode = (label: unknown): string => {
  const raw = String(label ?? '')
    .trim()
    .toLowerCase();
  const underscored = raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
  return underscored || 'expense_type';
};

/**
 * Admin UI for `lead_expense_types` — categories used on Finances → Expenses.
 * Types in use by `lead_expenses` cannot be hard-deleted (FK RESTRICT); deactivate instead.
 */
const LeadExpenseTypesManager: React.FC = () => {
  const fields = [
    {
      name: 'code',
      label: 'Code',
      type: 'text' as const,
      required: true,
      hideInAdd: true,
      hideInEdit: true,
      prepareValueForSave: (_value: unknown, record?: any) => {
        const existing = String(record?.code ?? '').trim();
        if (existing) return existing;
        return toExpenseTypeCode(record?.label);
      },
    },
    {
      name: 'label',
      label: 'Label',
      type: 'text' as const,
      required: true,
      placeholder: 'e.g. Government and court fees',
      maxLength: 200,
    },
    {
      name: 'sort_order',
      label: 'Sort order',
      type: 'number' as const,
      required: false,
      defaultValue: 0,
      placeholder: 'Lower appears first in expense dropdowns',
    },
    {
      name: 'is_active',
      label: 'Active',
      type: 'boolean' as const,
      required: false,
      defaultValue: true,
    },
    {
      name: 'created_at',
      label: 'Created',
      type: 'datetime' as const,
      readOnly: true,
      hideInAdd: true,
      hideInEdit: true,
    },
  ];

  return (
    <GenericCRUDManager
      tableName="lead_expense_types"
      fields={fields}
      title="Lead expense type"
      description="Categories for lead expenses (Finances → Expenses / fees). Inactive types are hidden from new expenses. Delete fails if the type is already used — set Active off instead."
      pageSize={50}
      sortColumn="sort_order"
      sortAscending
      skipIdAssignment
    />
  );
};

export default LeadExpenseTypesManager;
