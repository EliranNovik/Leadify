import React from 'react';
import GenericCRUDManager from './GenericCRUDManager';

/**
 * Admin UI for `lead_case_document_types` — options for client portal uploads,
 * CRM Documents tab, and document-type assignment in case/sub-effort document modals.
 * Types referenced by documents cannot be hard-deleted (FK SET NULL / CASCADE on assignments);
 * deactivate instead when in doubt.
 */
const LeadCaseDocumentTypesManager: React.FC = () => {
  const fields = [
    {
      name: 'name',
      label: 'Name',
      type: 'text' as const,
      required: true,
      placeholder: 'e.g. Birth Certificate',
      maxLength: 200,
    },
    {
      name: 'sort_order',
      label: 'Sort order',
      type: 'number' as const,
      required: false,
      defaultValue: 0,
      placeholder: 'Lower appears first in document type dropdowns',
    },
    {
      name: 'active',
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
    {
      name: 'updated_at',
      label: 'Updated',
      type: 'datetime' as const,
      readOnly: true,
      hideInAdd: true,
      hideInEdit: true,
    },
  ];

  return (
    <GenericCRUDManager
      tableName="lead_case_document_types"
      fields={fields}
      title="Case document type"
      description="Document types for the client portal upload picker, CRM Documents tab, and type assignment in Sequence of Events / Client uploads modals. Inactive types are hidden from new selections. Prefer deactivating instead of deleting if the type is already used."
      pageSize={50}
      sortColumn="sort_order"
      sortAscending
      skipIdAssignment
    />
  );
};

export default LeadCaseDocumentTypesManager;
