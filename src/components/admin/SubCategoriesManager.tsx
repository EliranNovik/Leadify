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
          .from('misc_maincategory')
          .select('id, name')
          .eq('active', true)
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
        table: 'misc_maincategory',
        valueField: 'id',
        displayField: 'name'
      }
    },
    {
      name: 'order',
      label: 'Order',
      type: 'number' as const,
      required: false,
      placeholder: 'e.g., 1',
      defaultValue: 100,
      hideInAdd: true,
      hideInEdit: true,
      hideInTable: true,
      prepareValueForSave: (value: any, record?: any) => (record?.id ? (value ?? 100) : 100)
    },
    {
      name: 'active',
      label: 'Active',
      type: 'boolean' as const,
      required: false,
      defaultValue: true,
      hideInAdd: true,
      hideInEdit: true,
      prepareValueForSave: (value: any, record?: any) => (record?.id ? (value ?? true) : true)
    }
  ];

  return (
    <GenericCRUDManager
      tableName="misc_category"
      fields={fields}
      title="Sub Category"
      description="Manage sub categories for detailed lead classification"
      pageSize={10}
      sortColumn="id"
    />
  );
};

export default SubCategoriesManager; 