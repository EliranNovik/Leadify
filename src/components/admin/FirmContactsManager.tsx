import React from 'react';
import GenericCRUDManager from './GenericCRUDManager';

import type { AdminCrudEmbedProps } from './FirmsManager';

const FirmContactsManager: React.FC<{
  embed?: AdminCrudEmbedProps & { createDefaults?: Record<string, unknown> };
  /** Render inside connect-contact overlay; edit drawer stacks above modal. */
  elevatedDrawer?: boolean;
  browseFirmId?: string;
  onRecordSaved?: (record: { id: string; firm_id?: string; [key: string]: unknown }) => void;
}> = ({ embed, elevatedDrawer = false, browseFirmId, onRecordSaved }) => {
  const fields = [
    {
      name: 'firm_id',
      label: 'Firm',
      type: 'select' as const,
      required: true,
      searchableSelect: true,
      foreignKey: {
        table: 'firms',
        valueField: 'id',
        displayField: 'name',
      },
    },
    {
      name: 'name',
      label: 'Name',
      type: 'text' as const,
      required: true,
    },
    {
      name: 'email',
      label: 'Email',
      type: 'email' as const,
      required: false,
    },
    {
      name: 'second_email',
      label: 'Second email',
      type: 'email' as const,
      required: false,
    },
    {
      name: 'phone',
      label: 'Phone',
      type: 'text' as const,
      required: false,
    },
    {
      name: 'profile_image_url',
      label: 'Profile image URL',
      type: 'text' as const,
      required: false,
      placeholder: 'https://…',
    },
    {
      name: 'user_email',
      label: 'Login email',
      type: 'email' as const,
      required: false,
      placeholder: 'If different from contact email',
    },
    {
      name: 'user_id',
      label: 'Linked user',
      type: 'select' as const,
      required: false,
      searchableSelect: true,
      hideInTable: true,
      placeholder: 'Select a CRM user to link',
      foreignKey: {
        table: 'users',
        valueField: 'id',
        displayField: 'email',
      },
    },
    {
      name: 'password_hash',
      label: 'Password hash',
      type: 'password' as const,
      required: false,
      hideInTable: true,
      placeholder: 'Store only a hash — or leave blank',
    },
    {
      name: 'firm_owner',
      label: 'Firm owner',
      type: 'boolean' as const,
      required: false,
    },
    {
      name: 'is_active',
      label: 'Active',
      type: 'boolean' as const,
      required: false,
    },
    {
      name: 'notes',
      label: 'Notes',
      type: 'textarea' as const,
      required: false,
    },
  ];

  const firmFilter = browseFirmId?.trim() || embed?.browseFirmId?.trim();

  return (
    <GenericCRUDManager
      tableName="firm_contacts"
      fields={fields}
      title="Firm contact"
      description="People linked to a firm."
      pageSize={15}
      sortColumn="name"
      skipIdAssignment
      listHidden={Boolean(embed) && !elevatedDrawer}
      hideTitle={Boolean(embed) && !elevatedDrawer}
      hideAddButton={Boolean(embed) && !elevatedDrawer}
      externalAddOpen={embed?.addDrawerOpen}
      onExternalAddOpenChange={embed?.onAddDrawerOpenChange}
      createDefaults={embed?.createDefaults}
      onRecordCreated={onRecordSaved ?? embed?.onRecordSaved ?? embed?.onRecordCreated}
      onRecordSaved={onRecordSaved ?? embed?.onRecordSaved ?? embed?.onRecordCreated}
      elevatedDrawer={elevatedDrawer}
      queryModifier={
        firmFilter ? (query) => query.eq('firm_id', firmFilter) : undefined
      }
      queryModifierKey={firmFilter ?? undefined}
    />
  );
};

export default FirmContactsManager;
