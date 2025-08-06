import React from 'react';
import GenericCRUDManager from './GenericCRUDManager';

const HolidaysManager: React.FC = () => {
  const fields = [
    {
      name: 'name',
      label: 'Holiday Name',
      type: 'text' as const,
      required: true,
      placeholder: 'e.g., New Year'
    },
    {
      name: 'date',
      label: 'Date',
      type: 'date' as const,
      required: true
    },
    {
      name: 'start_time',
      label: 'Start Time',
      type: 'text' as const,
      required: false,
      placeholder: 'e.g., 09:00'
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
      tableName="holidays"
      fields={fields}
      title="Holiday"
      description="Manage company holidays and their schedules"
      pageSize={10}
    />
  );
};

export default HolidaysManager; 