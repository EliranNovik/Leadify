import React from 'react';
import GenericCRUDManager from './GenericCRUDManager';

/**
 * Admin UI for `case_document_classifications` — tab labels and order in the Case documents modal.
 * Slug is stable id used in app/references; changing it may affect integrations — prefer renaming the label only.
 */
const CaseDocumentCategoriesManager: React.FC = () => {
  const fields = [
    {
      name: 'slug',
      label: 'Slug',
      type: 'text' as const,
      required: true,
      placeholder: 'e.g. application_documents',
      maxLength: 120,
    },
    {
      name: 'label',
      label: 'Tab name (display)',
      type: 'text' as const,
      required: true,
      placeholder: 'e.g. Application documents',
      maxLength: 200,
    },
    {
      name: 'sort_order',
      label: 'Sort order',
      type: 'number' as const,
      required: false,
      defaultValue: 0,
      placeholder: 'Lower appears first in the modal',
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
      tableName="case_document_classifications"
      fields={fields}
      title="Case document category"
      description="Defines tabs in the Case documents modal (classification per upload). Inactive tabs are hidden when browsing; slug should stay stable if files are linked by tooling."
      pageSize={50}
      sortColumn="sort_order"
      sortAscending
      skipIdAssignment
    />
  );
};

export default CaseDocumentCategoriesManager;
