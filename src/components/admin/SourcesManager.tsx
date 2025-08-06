import React, { useState, useEffect } from 'react';
import GenericCRUDManager from './GenericCRUDManager';
import { supabase } from '../../lib/supabase';

const SourcesManager: React.FC = () => {
  const [departments, setDepartments] = useState<Array<{id: string, name: string}>>([]);
  const [categories, setCategories] = useState<Array<{id: string, name: string}>>([]);

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

        // Fetch main categories
        const { data: catData } = await supabase
          .from('main_categories')
          .select('id, name')
          .eq('is_active', true)
          .order('name');
        
        if (catData) {
          setCategories(catData);
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
      name: 'kind',
      label: 'Kind',
      type: 'select' as const,
      required: true,
      options: [
        { value: 'Manual', label: 'Manual' },
        { value: 'API hook', label: 'API hook' },
        { value: 'Facebook Campaign', label: 'Facebook Campaign' },
        { value: 'Website-GravityForms', label: 'Website-GravityForms' },
        { value: 'Website-Elemntor API form', label: 'Website-Elemntor API form' }
      ]
    },
    {
      name: 'default_topic',
      label: 'Default Topic',
      type: 'text' as const,
      required: false,
      placeholder: 'e.g., German Citizenship'
    },
    {
      name: 'default_category',
      label: 'Default Category',
      type: 'select' as const,
      required: false,
      options: categories.map(cat => ({ value: cat.name, label: cat.name })),
      foreignKey: {
        table: 'main_categories',
        valueField: 'name',
        displayField: 'name'
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
      name: 'bonus_formula',
      label: 'Bonus Formula',
      type: 'text' as const,
      required: false,
      placeholder: 'e.g., Standard'
    },
    {
      name: 'order_value',
      label: 'Order Value',
      type: 'number' as const,
      required: false,
      placeholder: 'e.g., 1'
    },
    {
      name: 'priority',
      label: 'Priority',
      type: 'number' as const,
      required: false,
      placeholder: 'e.g., 1'
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
      tableName="sources"
      fields={fields}
      title="Source"
      description="Manage lead sources and their configurations"
      pageSize={10}
    />
  );
};

export default SourcesManager; 