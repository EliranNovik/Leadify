import React, { useState, useEffect } from 'react';
import GenericCRUDManager from './GenericCRUDManager';
import { supabase } from '../../lib/supabase';

const SourcesManager: React.FC = () => {
  const [departments, setDepartments] = useState<Array<{id: string, name: string}>>([]);
  const [categories, setCategories] = useState<Array<{id: number, name: string, displayName: string}>>([]);

  // Fetch departments and categories for dropdowns
  useEffect(() => {
    const fetchDropdownData = async () => {
      try {
        // Fetch departments
        const { data: deptData } = await supabase
          .from('departments')
          .select('id, name')
          .eq('is_active', true)
          .order('name');
        
        if (deptData) {
          setDepartments(deptData);
        }

        // Fetch misc categories with their main categories
        const { data: catData } = await supabase
          .from('misc_category')
          .select('id, name, parent_id, misc_maincategory!parent_id(id, name)')
          .order('name');
        
        if (catData) {
          // Format categories to show subcategory (main category)
          const formattedCategories = catData.map((cat: any) => {
            const mainCategory = (cat.misc_maincategory as any)?.[0]?.name;
            const displayName = mainCategory ? `${cat.name} (${mainCategory})` : cat.name;
            return {
              id: cat.id,
              name: cat.name,
              displayName: displayName
            };
          });
          setCategories(formattedCategories);
        }
      } catch (error) {
        console.error('Error fetching dropdown data:', error);
      }
    };

    fetchDropdownData();
  }, []);

  const fields = [
    {
      name: 'name',
      label: 'Source Name',
      type: 'text' as const,
      required: true,
      placeholder: 'e.g., Website Referral'
    },
    {
      name: 'default_topic',
      label: 'Default Topic',
      type: 'text' as const,
      required: false,
      placeholder: 'e.g., German Citizenship'
    },
    {
      name: 'default_category_id',
      label: 'Default Category',
      type: 'select' as const,
      required: false,
      searchableSelect: true,
      foreignKey: {
        table: 'misc_category',
        valueField: 'id',
        displayField: 'name',
        joinTable: 'misc_maincategory',
        joinField: 'parent_id',
        joinDisplayField: 'name'
      }
    },
    {
      name: 'code',
      label: 'Code',
      type: 'number' as const,
      required: false,
      placeholder: 'e.g., 12345'
    },
    {
      name: 'campaign_id',
      label: 'Campaign ID',
      type: 'text' as const,
      required: false,
      placeholder: 'e.g., CAMP123'
    },
    {
      name: 'priority',
      label: 'Priority',
      type: 'number' as const,
      required: true,
      placeholder: 'e.g., 1',
      defaultValue: 0
    },
    {
      name: 'order',
      label: 'Order',
      type: 'number' as const,
      required: true,
      defaultValue: 0,
      hideInAdd: true,
      hideInEdit: true,
      hideInTable: true
    },
    {
      name: 'active',
      label: 'Active',
      type: 'boolean' as const,
      required: true,
      defaultValue: false
    }
  ];

  return (
    <GenericCRUDManager
      tableName="misc_leadsource"
      fields={fields}
      title="Source"
      description="Manage lead sources and their configurations"
      pageSize={10}
      sortColumn="id"
    />
  );
};

export default SourcesManager; 