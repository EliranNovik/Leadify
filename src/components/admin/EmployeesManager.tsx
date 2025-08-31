import React, { useState, useEffect } from 'react';
import GenericCRUDManager from './GenericCRUDManager';
import { supabase } from '../../lib/supabase';

const EmployeesManager: React.FC = () => {
  const [departments, setDepartments] = useState<Array<{ value: string; label: string }>>([]);

  // Fetch departments from the database
  useEffect(() => {
    const fetchDepartments = async () => {
      try {
        const { data, error } = await supabase
          .from('departments')
          .select('name')
          .order('name');

        if (error) {
          console.error('Error fetching departments:', error);
        } else {
          const departmentOptions = data?.map(dept => ({
            value: dept.name,
            label: dept.name
          })) || [];
          setDepartments(departmentOptions);
        }
      } catch (error) {
        console.error('Error fetching departments:', error);
      }
    };

    fetchDepartments();
  }, []);

  const fields = [
    {
      name: 'display_name',
      label: 'Display Name',
      type: 'text' as const,
      required: true,
      placeholder: 'e.g., John Doe'
    },
    {
      name: 'official_name',
      label: 'Official Name',
      type: 'text' as const,
      required: true,
      placeholder: 'e.g., John Michael Doe'
    },
    {
      name: 'department',
      label: 'Department',
      type: 'select' as const,
      required: false,
      options: departments,
      placeholder: 'Select a department'
    },
    {
      name: 'mobile',
      label: 'Mobile',
      type: 'text' as const,
      required: false,
      placeholder: 'e.g., +972-50-123-4567'
    },
    {
      name: 'phone',
      label: 'Phone',
      type: 'text' as const,
      required: false,
      placeholder: 'e.g., +972-50-123-4567'
    },
    {
      name: 'phone_extension',
      label: 'Phone Extension',
      type: 'text' as const,
      required: false,
      placeholder: 'e.g., 123'
    },
    {
      name: 'mobile_extension',
      label: 'Mobile Extension',
      type: 'text' as const,
      required: false,
      placeholder: 'e.g., 456'
    },
    {
      name: 'last_call_from',
      label: 'Last Call From',
      type: 'text' as const,
      required: false,
      placeholder: 'e.g., +972-50-123-4567'
    },
    {
      name: 'meeting_link',
      label: 'Meeting Link',
      type: 'text' as const,
      required: false,
      placeholder: 'e.g., https://meet.google.com/abc-defg-hij'
    },
    {
      name: 'photo_url',
      label: 'Photo URL',
      type: 'text' as const,
      required: false,
      placeholder: 'e.g., https://example.com/photo.jpg'
    },
    {
      name: 'is_manager',
      label: 'Is Manager',
      type: 'boolean' as const,
      required: false
    },
    {
      name: 'is_lawyer',
      label: 'Is Lawyer',
      type: 'boolean' as const,
      required: false
    },
    {
      name: 'is_meeting_scheduler',
      label: 'Is Meeting Scheduler',
      type: 'boolean' as const,
      required: false
    },
    {
      name: 'is_leads_router',
      label: 'Is Leads Router',
      type: 'boolean' as const,
      required: false
    },
    {
      name: 'is_collection_manager',
      label: 'Is Collection Manager',
      type: 'boolean' as const,
      required: false
    },
    {
      name: 'can_see_reports',
      label: 'Can See Reports',
      type: 'boolean' as const,
      required: false
    },
    {
      name: 'can_decline_price_offers',
      label: 'Can Decline Price Offers',
      type: 'boolean' as const,
      required: false
    },
    {
      name: 'permissions_level',
      label: 'Permissions Level',
      type: 'select' as const,
      required: false,
      options: [
        { value: 'Access all leads', label: 'Access all leads' },
        { value: 'Leads limited access (view only)', label: 'Leads limited access (view only)' },
        { value: 'Exclusive leads only', label: 'Exclusive leads only' }
      ]
    },
    {
      name: 'bonuses_role',
      label: 'Bonuses Role',
      type: 'select' as const,
      required: false,
      options: [
        { value: 'One-time bonus (temporary)', label: 'One-time bonus (temporary)' },
        { value: 'No bonuses', label: 'No bonuses' },
        { value: 'scheduler', label: 'Scheduler' },
        { value: 'expert', label: 'Expert' },
        { value: 'closer', label: 'Closer' }
      ]
    },
    {
      name: 'display_order',
      label: 'Display Order',
      type: 'number' as const,
      required: false,
      placeholder: 'e.g., 100'
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
      tableName="employees"
      fields={fields}
      title="Employee"
      description="Manage company employees and their roles"
      pageSize={10}
    />
  );
};

export default EmployeesManager; 