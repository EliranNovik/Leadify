import React, { useState, useEffect } from 'react';
import GenericCRUDManager from './GenericCRUDManager';
import { supabase } from '../../lib/supabase';

// Helper function to map role codes to display names (same as EmployeePerformancePage)
const getRoleDisplayName = (roleCode: string): string => {
  const roleMap: { [key: string]: string } = {
    'c': 'Closer',
    's': 'Scheduler',
    'h': 'Handler',
    'n': 'No role',
    'e': 'Expert',
    'z': 'Manager',
    'Z': 'Manager',
    'p': 'Partner',
    'm': 'Manager',
    'dm': 'Department Manager',
    'pm': 'Project Manager',
    'se': 'Secretary',
    'b': 'Book keeper',
    'partners': 'Partners',
    'dv': 'Developer',
    'ma': 'Marketing',
    'P': 'Partner',
    'M': 'Manager',
    'DM': 'Department Manager',
    'PM': 'Project Manager',
    'SE': 'Secretary',
    'B': 'Book keeper',
    'Partners': 'Partners',
    'd': 'Diverse',
    'f': 'Finance'
  };
  
  return roleMap[roleCode] || roleCode || 'No role';
};

const EmployeesManager: React.FC = () => {
  const [departments, setDepartments] = useState<Array<{ value: string; label: string }>>([]);
  const [users, setUsers] = useState<Array<{ value: string; label: string }>>([]);
  const [mainCategories, setMainCategories] = useState<Array<{ value: string; label: string }>>([]);

  // Fetch departments and users from the database
  useEffect(() => {
    const fetchDepartments = async () => {
      try {
        const { data, error } = await supabase
          .from('tenant_departement')
          .select('id, name')
          .order('name');

        if (error) {
          console.error('Error fetching departments:', error);
        } else {
          const departmentOptions = data?.map(dept => ({
            value: dept.id.toString(),
            label: dept.name
          })) || [];
          setDepartments(departmentOptions);
        }
      } catch (error) {
        console.error('Error fetching departments:', error);
      }
    };

    const fetchUsers = async () => {
      try {
        const { data, error } = await supabase
          .from('users')
          .select('id, email, first_name, last_name, is_active')
          .order('email');

        if (error) {
          console.error('Error fetching users:', error);
        } else {
          const userOptions = data?.map(user => ({
            value: user.id.toString(),
            label: `${user.email}${user.first_name || user.last_name ? ` (${user.first_name || ''} ${user.last_name || ''})`.trim() : ''}${user.is_active ? '' : ' [INACTIVE]'}`
          })) || [];
          setUsers(userOptions);
        }
      } catch (error) {
        console.error('Error fetching users:', error);
      }
    };

    const fetchMainCategories = async () => {
      try {
        const { data, error } = await supabase
          .from('misc_maincategory')
          .select('id, name')
          .order('name');

        if (error) {
          console.error('Error fetching main categories:', error);
        } else {
          const categoryOptions = data?.map(cat => ({
            value: cat.id.toString(),
            label: cat.name
          })) || [];
          setMainCategories(categoryOptions);
        }
      } catch (error) {
        console.error('Error fetching main categories:', error);
      }
    };

    fetchDepartments();
    fetchUsers();
    fetchMainCategories();
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
      name: 'user_id',
      label: 'Connected User',
      type: 'select' as const,
      required: false,
      options: users,
      placeholder: 'Select a user to connect (optional)',
      hideInTable: true,
      hideInEdit: true, // Only show in ADD form, not EDIT form
      // Temporarily disabled foreign key lookup due to data type mismatch
      // user_id contains integers but users.id is UUID
      // foreignKey: {
      //   table: 'users',
      //   displayField: 'email',
      //   valueField: 'id'
      // }
    },
    {
      name: 'official_name',
      label: 'Official Name',
      type: 'text' as const,
      required: false,
      placeholder: 'e.g., John Michael Doe'
    },
    {
      name: 'department_id',
      label: 'Department',
      type: 'select' as const,
      required: false,
      options: departments,
      placeholder: 'Select a department',
      foreignKey: {
        table: 'tenant_departement',
        displayField: 'name',
        valueField: 'id'
      }
    },
    {
      name: 'preferred_category',
      label: 'Preferred Categories',
      type: 'select' as const,
      required: false,
      options: mainCategories,
      isMulti: true,
      hideInTable: false,
      hideInAdd: false,
      hideInEdit: false
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
      name: 'phone_ext',
      label: 'Phone Ext',
      type: 'text' as const,
      required: false,
      placeholder: 'e.g., 123'
    },
    {
      name: 'mobile_ext',
      label: 'Mobile Ext',
      type: 'text' as const,
      required: false,
      placeholder: 'e.g., 456',
      hideInEdit: true // Hide in edit drawer only
    },
    {
      name: 'last_call_from',
      label: 'Last Call',
      type: 'text' as const,
      required: false,
      placeholder: 'e.g., +972-50-123-4567',
      hideInEdit: true // Hide in edit drawer only
    },
    {
      name: 'photo',
      label: 'Photo',
      type: 'text' as const,
      required: false,
      placeholder: 'Base64 encoded photo data',
      hideInEdit: true // Hide in edit drawer only
    },
    {
      name: 'is_lawyer',
      label: 'Is Lawyer',
      type: 'boolean' as const,
      required: false,
      hideInEdit: true // Hide in edit drawer only
    },
    {
      name: 'is_manager',
      label: 'Is Manager',
      type: 'boolean' as const,
      required: false,
      hideInEdit: true // Hide in edit drawer only
    },
    {
      name: 'is_reports',
      label: 'Can See Reports',
      type: 'boolean' as const,
      required: false,
      hideInEdit: true // Hide in edit drawer only
    },
    {
      name: 'is_router',
      label: 'Is Router',
      type: 'boolean' as const,
      required: false,
      hideInEdit: true // Hide in edit drawer only
    },
    {
      name: 'is_collection',
      label: 'Is Collection Manager',
      type: 'boolean' as const,
      required: false,
      hideInEdit: true // Hide in edit drawer only
    },
    {
      name: 'is_meeting_scheduler',
      label: 'Is Meeting Scheduler',
      type: 'boolean' as const,
      required: false,
      hideInEdit: true // Hide in edit drawer only
    },
    {
      name: 'is_decline_po',
      label: 'Can Decline Price Offers',
      type: 'boolean' as const,
      required: false,
      hideInEdit: true // Hide in edit drawer only
    },
    {
      name: 'bonuses_role',
      label: 'Bonuses Role',
      type: 'select' as const,
      required: false,
      options: [
        { value: 'One-time bonus (temporary)', label: 'One-time bonus (temporary)' },
        { value: 'No bonuses', label: 'No bonuses' },
        { value: 'c', label: 'Closer' },
        { value: 's', label: 'Scheduler' },
        { value: 'h', label: 'Handler' },
        { value: 'e', label: 'Expert' },
        { value: 'z', label: 'Manager' },
        { value: 'Z', label: 'Manager' },
        { value: 'p', label: 'Partner' },
        { value: 'm', label: 'Manager' },
        { value: 'dm', label: 'Department Manager' },
        { value: 'pm', label: 'Project Manager' },
        { value: 'se', label: 'Secretary' },
        { value: 'b', label: 'Book keeper' },
        { value: 'partners', label: 'Partners' },
        { value: 'dv', label: 'Developer' },
        { value: 'ma', label: 'Marketing' },
        { value: 'P', label: 'Partner' },
        { value: 'M', label: 'Manager' },
        { value: 'DM', label: 'Department Manager' },
        { value: 'PM', label: 'Project Manager' },
        { value: 'SE', label: 'Secretary' },
        { value: 'B', label: 'Book keeper' },
        { value: 'Partners', label: 'Partners' },
        { value: 'd', label: 'Diverse' },
        { value: 'f', label: 'Finance' },
        { value: 'n', label: 'No role' }
      ]
    },
    {
      name: 'worker_id',
      label: 'Worker ID',
      type: 'text' as const,
      required: false,
      placeholder: 'e.g., 134',
      hideInTable: false,
      hideInAdd: false,
      hideInEdit: false
    },
    {
      name: 'onecom_code',
      label: 'OneCom Code',
      type: 'number' as const,
      required: false,
      placeholder: 'e.g., 12345',
      hideInTable: false,
      hideInAdd: false,
      hideInEdit: false
    },
  ];

  return (
    <GenericCRUDManager
      tableName="tenants_employee"
      fields={fields}
      title="Employee"
      description="Manage company employees and their roles"
      pageSize={50}
      sortColumn="id"
    />
  );
};

export default EmployeesManager; 