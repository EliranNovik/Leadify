import React from 'react';
import GenericCRUDManager from './GenericCRUDManager';

const toHrDocumentTypeSlug = (label: unknown): string => {
  const raw = String(label ?? '')
    .trim()
    .toLowerCase();
  const underscored = raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
  return underscored || 'document_type';
};

/**
 * Admin UI for `hr_document_types` — dropdown options on My Profile → Documents.
 * Types in use by `employee_hr_documents` cannot be hard-deleted (FK); deactivate instead.
 */
const HrDocumentTypesManager: React.FC = () => {
  const fields = [
    {
      name: 'slug',
      label: 'Slug',
      type: 'text' as const,
      required: true,
      hideInAdd: true,
      hideInEdit: true,
      prepareValueForSave: (_value: unknown, record?: any) => {
        const existing = String(record?.slug ?? '').trim();
        if (existing) return existing;
        return toHrDocumentTypeSlug(record?.label);
      },
    },
    {
      name: 'label',
      label: 'Label',
      type: 'text' as const,
      required: true,
      placeholder: 'e.g. Employment contract',
      maxLength: 200,
    },
    {
      name: 'sort_order',
      label: 'Sort order',
      type: 'number' as const,
      required: false,
      defaultValue: 0,
      placeholder: 'Lower appears first in the document type dropdown',
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
      tableName="hr_document_types"
      fields={fields}
      title="HR document type"
      description="Document types shown in My Profile → Documents (upload type dropdown). Inactive types are hidden from new uploads. Delete fails if the type is already used — set Active off instead."
      pageSize={50}
      sortColumn="sort_order"
      sortAscending
      skipIdAssignment
    />
  );
};

export default HrDocumentTypesManager;
