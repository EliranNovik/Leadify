import React from 'react';
import GenericCRUDManager from './GenericCRUDManager';
import FirmColumnDocumentCell from './FirmColumnDocumentCell';
import {
  FirmContract1Field,
  FirmContract2Field,
  FirmInvoicesField,
  FirmOtherDocsField,
} from './FirmColumnDocumentField';
import FirmLeadSourcesField from './FirmLeadSourcesField';
import FirmFirmTypesField from './FirmFirmTypesField';
import FirmTypeBadge from '../FirmTypeBadge';

export type AdminCrudEmbedProps = {
  addDrawerOpen: boolean;
  onAddDrawerOpenChange: (open: boolean) => void;
  onRecordCreated?: (record: { id: string; [key: string]: unknown }) => void;
  /** When set, pre-filters browse lists that support firm_id (e.g. create contact). */
  browseFirmId?: string;
};

const FirmsManager: React.FC<{ embed?: AdminCrudEmbedProps }> = ({ embed }) => {
  const fields = [
    {
      name: 'name',
      label: 'Firm name',
      type: 'text' as const,
      required: true,
      placeholder: 'Organization name',
    },
    {
      name: 'firm_type_ids',
      label: 'Firm types',
      type: 'custom' as const,
      required: false,
      customComponent: FirmFirmTypesField,
      defaultValue: () => [] as string[],
      formatValue: (_value: unknown, record: { _firm_type_labels?: string[]; firm_type_ids?: string[] } & Record<string, unknown>) => {
        const labels = record._firm_type_labels;
        const typeIds = record.firm_type_ids;
        if (!labels?.length) return <span className="text-base-content/40">—</span>;
        return (
          <div className="flex flex-wrap gap-1">
            {labels.map((label, i) => (
              <FirmTypeBadge
                key={`${typeIds?.[i] ?? label}-${i}`}
                label={label}
                typeId={typeIds?.[i]}
                size="sm"
              />
            ))}
          </div>
        );
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
      type: 'custom' as const,
      required: false,
      hideInTable: true,
      customComponent: FirmContract1Field,
      formatValue: (value: unknown) => (
        <FirmColumnDocumentCell
          storagePath={typeof value === 'string' ? value : null}
          column="contract"
        />
      ),
    },
    {
      name: 'contract_2',
      label: 'Contract 2',
      type: 'custom' as const,
      required: false,
      hideInTable: true,
      customComponent: FirmContract2Field,
      formatValue: (value: unknown) => (
        <FirmColumnDocumentCell
          storagePath={typeof value === 'string' ? value : null}
          column="contract_2"
        />
      ),
    },
    {
      name: 'invoices',
      label: 'Invoices',
      type: 'custom' as const,
      required: false,
      hideInTable: true,
      customComponent: FirmInvoicesField,
      formatValue: (value: unknown) => (
        <FirmColumnDocumentCell
          storagePath={typeof value === 'string' ? value : null}
          column="invoices"
          linkLabel="Invoices"
        />
      ),
    },
    {
      name: 'other_docs',
      label: 'Other documents',
      type: 'custom' as const,
      required: false,
      hideInTable: true,
      customComponent: FirmOtherDocsField,
      formatValue: (value: unknown) => (
        <FirmColumnDocumentCell
          storagePath={typeof value === 'string' ? value : null}
          column="other_docs"
          linkLabel="Other documents"
        />
      ),
    },
    {
      name: 'notes',
      label: 'Notes',
      type: 'textarea' as const,
      required: false,
      placeholder: 'Internal notes',
    },
    {
      name: 'lead_source_ids',
      label: 'Lead sources (marketing)',
      type: 'custom' as const,
      required: false,
      hideInTable: true,
      hideInAdd: false,
      customComponent: FirmLeadSourcesField,
      defaultValue: () => [] as number[],
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
      listHidden={Boolean(embed)}
      hideTitle={Boolean(embed)}
      hideAddButton={Boolean(embed)}
      externalAddOpen={embed?.addDrawerOpen}
      onExternalAddOpenChange={embed?.onAddDrawerOpenChange}
      onRecordCreated={embed?.onRecordCreated}
    />
  );
};

export default FirmsManager;
