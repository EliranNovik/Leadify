import React from 'react';
import GenericCRUDManager from './GenericCRUDManager';

const toFlagCode = (label: unknown): string => {
  const raw = String(label ?? '')
    .trim()
    .toLowerCase();
  // keep letters/numbers, turn everything else into underscores, collapse repeats
  const underscored = raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
  return underscored || 'flag';
};

const FlagTypesManager: React.FC = () => {
  const fields = [
    {
      name: 'code',
      label: 'Code',
      type: 'text' as const,
      required: true,
      hideInAdd: true,
      hideInEdit: true,
      hideInTable: true,
      prepareValueForSave: (_value: unknown, record?: any) => toFlagCode(record?.label),
    },
    {
      name: 'label',
      label: 'Label',
      type: 'text' as const,
      required: true,
      placeholder: 'e.g., Probability',
    },
  ];

  return (
    <GenericCRUDManager
      tableName="flag_types"
      fields={fields}
      title="Flag Type"
      description="Manage available flag types (used by flags dropdown and badges)."
      pageSize={25}
      sortColumn="id"
    />
  );
};

export default FlagTypesManager;

