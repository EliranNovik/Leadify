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
          .from('departments')
          .select('id, name')
          .eq('is_active', true)
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
      name: 'order_value',
      label: 'Order Value',
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
      name: 'is_important',
      label: 'Important Category',
      type: 'boolean' as const,
      required: false
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
      tableName="main_categories"
      fields={fields}
      title="Main Category"
      description="Manage main categories for lead classification"
      pageSize={10}
    />
  );
};

export default MainCategoriesManager; 