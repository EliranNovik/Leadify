import React, { useState, useEffect } from 'react';
import GenericCRUDManager from './GenericCRUDManager';
import { supabase } from '../../lib/supabase';

const MainCategoriesManager: React.FC = () => {
  const [departments, setDepartments] = useState<Array<{id: string, name: string}>>([]);

  // Fetch departments for dropdown
  useEffect(() => {
    const fetchDepartments = async () => {
      try {
        const { data } = await supabase
          .from('tenant_departement')
          .select('id, name')
          .order('name');
        
        if (data) {
          setDepartments(data);
        }
      } catch (error) {
        console.error('Error fetching departments:', error);
      }
    };

    fetchDepartments();
  }, []);

  const fields = [
    {
      name: 'name',
      label: 'Category Name',
      type: 'text' as const,
      required: true,
      placeholder: 'e.g., German Citizenship'
    },
    {
      name: 'order',
      label: 'Order',
      type: 'number' as const,
      required: false,
      placeholder: 'e.g., 1'
    },
    {
      name: 'max_daily_meetings',
      label: 'Max Daily Meetings',
      type: 'number' as const,
      required: false,
      placeholder: 'e.g., 10'
    },
    {
      name: 'max_hourly_meetings',
      label: 'Max Hourly Meetings',
      type: 'number' as const,
      required: false,
      placeholder: 'e.g., 2'
    },
    {
      name: 'important',
      label: 'Important Category',
      type: 'boolean' as const,
      required: false
    },
    {
      name: 'active',
      label: 'Active',
      type: 'boolean' as const,
      required: false
    },
    {
      name: 'department_id',
      label: 'Department',
      type: 'select' as const,
      required: false,
      options: departments.map(dep => ({ value: dep.id, label: dep.name })),
      foreignKey: {
        table: 'tenant_departement',
        valueField: 'id',
        displayField: 'name'
      }
    }
  ];

  return (
    <GenericCRUDManager
      tableName="misc_maincategory"
      fields={fields}
      title="Main Category"
      description="Manage main categories for lead classification"
      pageSize={10}
      sortColumn="id"
    />
  );
};

export default MainCategoriesManager; 