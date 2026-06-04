import React from 'react';
import GenericCRUDManager from './GenericCRUDManager';
import type { AdminCrudEmbedProps } from './FirmsManager';

const FirmTypesManager: React.FC<{ embed?: AdminCrudEmbedProps }> = ({ embed }) => {
  const fields = [
    {
      name: 'code',
      label: 'Code',
      type: 'text' as const,
      required: true,
      placeholder: 'e.g. service_provider, ref_in',
    },
    {
      name: 'label',
      label: 'Label',
      type: 'text' as const,
      required: true,
      placeholder: 'Display name',
    },
    {
      name: 'description',
      label: 'Description',
      type: 'textarea' as const,
      required: false,
    },
    {
      name: 'sort_order',
      label: 'Sort order',
      type: 'number' as const,
      required: false,
      defaultValue: 0,
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
      tableName="firm_types"
      fields={fields}
      title="Firm type"
      description="Classifications used on firms (e.g. Service provider, Ref in, Ref out)"
      pageSize={20}
      sortColumn="sort_order"
      sortAscending
      skipIdAssignment
      listHidden={Boolean(embed)}
      hideTitle={Boolean(embed)}
      hideAddButton={Boolean(embed)}
      externalAddOpen={embed?.addDrawerOpen}
      onExternalAddOpenChange={embed?.onAddDrawerOpenChange}
      onRecordCreated={embed?.onRecordCreated}
    />
  );
};

export default FirmTypesManager;
