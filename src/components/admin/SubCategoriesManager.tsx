import React, { useState, useEffect } from 'react';
import GenericCRUDManager from './GenericCRUDManager';
import { supabase } from '../../lib/supabase';

const SubCategoriesManager: React.FC = () => {
  const [mainCategories, setMainCategories] = useState<Array<{id: string, name: string}>>([]);

  // Fetch main categories for dropdown
  useEffect(() => {
    const fetchMainCategories = async () => {
      try {
        const { data } = await supabase
          .from('main_categories')
          .select('id, name')
          .eq('is_active', true)
          .order('name');
        
        if (data) {
          setMainCategories(data);
        }
      } catch (error) {
        console.error('Error fetching main categories:', error);
      }
    };

    fetchMainCategories();
  }, []);

  const fields = [
    {
      name: 'name',
      label: 'Sub Category Name',
      type: 'text' as const,
      required: true,
      placeholder: 'e.g., German Citizenship - Basic'
    },
    {
      name: 'parent_id',
      label: 'Parent Category',
      type: 'select' as const,
      required: false,
      options: mainCategories.map(cat => ({ value: cat.id, label: cat.name })),
      foreignKey: {
        table: 'main_categories',
        valueField: 'id',
        displayField: 'name'
      }
    },
    {
      name: 'order_value',
      label: 'Order Value',
      type: 'number' as const,
      required: false,
      placeholder: 'e.g., 1'
    },
    {
      name: 'is_important',
      label: 'Important Sub Category',
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
      tableName="sub_categories"
      fields={fields}
      title="Sub Category"
      description="Manage sub categories for detailed lead classification"
      pageSize={10}
    />
  );
};

export default SubCategoriesManager; 