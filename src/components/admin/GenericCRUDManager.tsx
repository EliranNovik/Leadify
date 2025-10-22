import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { toast } from 'react-hot-toast';
import { 
  PlusIcon, 
  PencilIcon, 
  TrashIcon, 
  XMarkIcon,
  ChevronLeftIcon,
  ChevronRightIcon
} from '@heroicons/react/24/outline';

interface Field {
  name: string;
  label: string;
  type: 'text' | 'number' | 'email' | 'password' | 'textarea' | 'select' | 'boolean' | 'date' | 'datetime';
  required?: boolean;
  options?: { value: string; label: string }[];
  placeholder?: string;
  hideInTable?: boolean;
  hideInAdd?: boolean;
  hideInEdit?: boolean;
  readOnly?: boolean;
  foreignKey?: {
    table: string;
    displayField: string;
    valueField: string;
  };
}

interface GenericCRUDManagerProps {
  tableName: string;
  fields: Field[];
  title: string;
  description?: string;
  pageSize?: number;
  sortColumn?: string;
}

interface Record {
  id: string;
  [key: string]: any;
}

const GenericCRUDManager: React.FC<GenericCRUDManagerProps> = ({
  tableName,
  fields,
  title,
  description,
  pageSize = 50,
  sortColumn = 'created_at'
}) => {
  const [records, setRecords] = useState<Record[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingRecord, setEditingRecord] = useState<Record | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [recordToDelete, setRecordToDelete] = useState<Record | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [isActiveFilter, setIsActiveFilter] = useState<string>('all'); // Filter for is_active field
  const [userActiveFilter, setUserActiveFilter] = useState<string>('all'); // Filter for user is_active status (for tenants_employee)
  const [showAllRecords, setShowAllRecords] = useState(true); // Show all records by default
  const [foreignKeyData, setForeignKeyData] = useState<{[key: string]: {[key: string]: string}}>({});

  // Fetch records
  const fetchRecords = async () => {
    setLoading(true);
    try {
      // For tenants_employee table, we need to join with users table to filter by user active status
      // But only if the user_id column exists and userActiveFilter is not 'all'
      const needsUserJoin = tableName === 'tenants_employee' && userActiveFilter !== 'all';
      const hasUserIdField = fields.some(f => f.name === 'user_id');
      
      let query = supabase
        .from(tableName)
        .select(needsUserJoin && hasUserIdField ? '*, users!user_id(is_active)' : '*', { count: 'exact' });

      // Add search functionality if search term exists
      if (searchTerm) {
        // Search in all text fields, but exclude UUID fields and array fields that cause issues
        const uuidFields = ['id', 'auth_id', 'user_id', 'employee_id', 'updated_by'];
        const arrayFields = ['groups', 'user_permissions']; // Array fields that don't support ilike
        const textFields = fields.filter(f => 
          (f.type === 'text' || f.type === 'email' || f.type === 'textarea') && 
          !uuidFields.includes(f.name) &&
          !arrayFields.includes(f.name)
        );
        if (textFields.length > 0) {
          // Escape any % characters in the search term to prevent PostgREST parsing errors
          const escapedSearchTerm = searchTerm.replace(/%/g, '\\%');
          const searchConditions = textFields.map(field => `${field.name}.ilike.%${escapedSearchTerm}%`);
          query = query.or(searchConditions.join(','));
        }
      }

      // Add is_active filter if the field exists and filter is not 'all'
      const hasIsActiveField = fields.some(f => f.name === 'is_active');
      if (hasIsActiveField && isActiveFilter !== 'all') {
        const isActiveValue = isActiveFilter === 'yes' ? true : false;
        query = query.eq('is_active', isActiveValue);
      }

      // Add user active filter for tenants_employee table (based on connected user's is_active status)
      if (tableName === 'tenants_employee' && userActiveFilter !== 'all' && hasUserIdField) {
        const userActiveValue = userActiveFilter === 'yes' ? true : false;
        query = query.eq('users.is_active', userActiveValue);
      }

      // Add pagination only if not showing all records
      if (!showAllRecords) {
        const from = (currentPage - 1) * pageSize;
        const to = from + pageSize - 1;
        query = query.range(from, to);
      }
      
      // Order by the specified sort column (default to created_at, fallback to id)
      const columnToSort = sortColumn || 'id';
      query = query.order(columnToSort, { ascending: false });

      const { data, error, count } = await query;

      if (error) {
        console.error(`Error fetching ${tableName}:`, error);
        toast.error(`Failed to load ${title}`);
      } else {
        // Transform boolean fields from 't'/'f' to true/false
        const transformedData = (data || []).map((record: any) => {
          const transformedRecord: any = { ...record };
          fields.forEach(field => {
            if (field.type === 'boolean' && record[field.name] !== null && record[field.name] !== undefined) {
              transformedRecord[field.name] = record[field.name] === 't' || record[field.name] === true;
            }
          });
          return transformedRecord;
        });
        
        setRecords(transformedData);
        setTotalRecords(count || 0);
        
        // Fetch foreign key data
        await fetchForeignKeyData(transformedData);
      }
    } catch (error) {
      console.error(`Error fetching ${tableName}:`, error);
      toast.error(`Failed to load ${title}`);
    } finally {
      setLoading(false);
    }
  };

  // Fetch foreign key data for display
  const fetchForeignKeyData = async (records: Record[]) => {
    const foreignKeyFields = fields.filter(f => f.foreignKey);
    const fkData: {[key: string]: {[key: string]: string}} = {};

    console.log(`🔍 Fetching foreign key data for ${foreignKeyFields.length} fields`);

    for (const field of foreignKeyFields) {
      if (!field.foreignKey) continue;
      
      const { table, valueField, displayField } = field.foreignKey;
      const uniqueIds = [...new Set(records.map(r => r[field.name]).filter(id => id))];
      
      console.log(`🔍 Field ${field.name}: ${uniqueIds.length} unique IDs for table ${table}`);
      
      if (uniqueIds.length > 0) {
        try {
          // Process in batches to avoid URL length limits and improve performance
          const batchSize = 50; // Process 50 IDs at a time
          const batches = [];
          for (let i = 0; i < uniqueIds.length; i += batchSize) {
            batches.push(uniqueIds.slice(i, i + batchSize));
          }
          
          fkData[field.name] = {};
          console.log(`🔍 Processing ${batches.length} batches for ${field.name}`);
          
          for (const batch of batches) {
            try {
              // Special handling for users table to avoid RLS issues
              let data, error;
              
              if (table === 'users') {
                // Check if the batch contains valid UUIDs for users table
                const isValidUUID = (str: string) => {
                  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
                  return uuidRegex.test(str);
                };
                
                // Filter out non-UUID values for users table
                const validUUIDs = batch.filter(id => isValidUUID(id.toString()));
                
                if (validUUIDs.length === 0) {
                  console.log(`⚠️ Skipping users table lookup - no valid UUIDs in batch:`, batch);
                  continue; // Skip this batch
                }
                
                if (validUUIDs.length !== batch.length) {
                  console.log(`⚠️ Filtering batch for users table - ${batch.length - validUUIDs.length} non-UUID values removed:`, batch);
                }
                
                // Add additional fields that might be needed for display
                const result = await supabase
                  .from(table)
                  .select(`${valueField}, ${displayField}, first_name, last_name, is_active`)
                  .in(valueField, validUUIDs);
                data = result.data;
                error = result.error;
              } else {
                const result = await supabase
                  .from(table)
                  .select(`${valueField}, ${displayField}`)
                  .in(valueField, batch);
                data = result.data;
                error = result.error;
              }
              
              if (error) {
                console.error(`❌ Error fetching foreign key data for ${field.name} batch:`, error);
                console.error(`❌ Batch IDs:`, batch);
                continue; // Skip this batch but continue with others
              }
              
              if (data) {
                console.log(`✅ Fetched ${data.length} records for ${field.name} batch`);
                data.forEach((item: any) => {
                  const key = item[valueField] as string;
                  let value = item[displayField] as string;
                  
                  // For users table, create a better display value
                  if (table === 'users' && item.first_name && item.last_name) {
                    value = `${item.first_name} ${item.last_name} (${item.email})`;
                  } else if (table === 'users' && item.email) {
                    value = item.email;
                  }
                  
                  (fkData[field.name] as { [key: string]: string })[key] = value;
                });
              }
            } catch (batchError) {
              console.error(`❌ Error fetching foreign key data for ${field.name} batch:`, batchError);
              console.error(`❌ Batch IDs:`, batch);
              // Continue with next batch
            }
          }
        } catch (error) {
          console.error(`❌ Error fetching foreign key data for ${field.name}:`, error);
        }
      }
    }
    
    console.log(`🔍 Final foreign key data:`, fkData);
    setForeignKeyData(fkData);
  };

  useEffect(() => {
    fetchRecords();
  }, [currentPage, searchTerm, isActiveFilter, userActiveFilter, showAllRecords]);

  // Handle boolean toggle changes
  const handleToggleBoolean = async (record: Record, fieldName: string, newValue: boolean) => {
    try {
      // Transform boolean value to database format
      const dbValue = newValue ? 't' : 'f';
      
      const { error } = await supabase
        .from(tableName)
        .update({ [fieldName]: dbValue })
        .eq('id', String(record.id));

      if (error) {
        console.error(`Error updating ${fieldName}:`, error);
        toast.error(`Failed to update ${fieldName}`);
      } else {
        // Update local state
        setRecords(prev => prev.map(r => 
          r.id === record.id 
            ? { ...r, [fieldName]: newValue }
            : r
        ));
        toast.success(`${fieldName} updated successfully`);
      }
    } catch (error) {
      console.error(`Error in handleToggleBoolean:`, error);
      toast.error(`Failed to update ${fieldName}`);
    }
  };

  // Create user with auth user first
  const createUserWithAuth = async (record: Partial<Record>) => {
    const API_BASE_URL = 'https://leadify-crm-backend.onrender.com/api';
    
    // Check if password is provided for new users
    if (!record.password) {
      throw new Error('Password is required for new users');
    }

    // Create user via API (handles both auth user and database record creation)
    const response = await fetch(`${API_BASE_URL}/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: record.email,
        password: record.password,
        first_name: record.first_name,
        last_name: record.last_name,
        role: record.role,
        is_active: record.is_active,
        is_staff: record.is_staff,
        is_superuser: record.is_superuser
      })
    });

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || 'Failed to create user');
    }

    // The API handles both auth user creation and database record creation
    // We just need to refresh the records to show the new user
    toast.success(`${title} created successfully`);
    
    // Return a mock record for the UI (the real record will be fetched on refresh)
    return {
      id: result.user_id || result.auth_id || 'new',
      email: record.email,
      first_name: record.first_name,
      last_name: record.last_name,
      role: record.role,
      is_active: record.is_active,
      is_staff: record.is_staff,
      is_superuser: record.is_superuser
    };
  };

  // Create or update record
  const saveRecord = async (record: Partial<Record>) => {
    // Handle array fields for Postgres
    ['languages', 'allowed_employee_names', 'groups', 'user_permissions'].forEach((arrayField) => {
      if (arrayField in record) {
        let val = record[arrayField];
        if (typeof val === 'string') {
          if (val.trim() === '') {
            record[arrayField] = null;
          } else {
            try {
              // Try to parse as JSON array
              const parsed = JSON.parse(val);
              if (Array.isArray(parsed)) {
                record[arrayField] = parsed;
              } else {
                record[arrayField] = [val];
              }
            } catch {
              // Fallback: split by comma
              record[arrayField] = val.split(',').map(v => v.trim()).filter(Boolean);
            }
          }
        }
      }
    });

    // Transform boolean fields from true/false to 't'/'f' for database
    fields.forEach(field => {
      if (field.type === 'boolean' && field.name in record) {
        const value = record[field.name];
        if (value === true) {
          record[field.name] = 't';
        } else if (value === false) {
          record[field.name] = 'f';
        }
        // Keep null/undefined as is
      }
    });

    try {
      let result;
      if (editingRecord?.id) {
        // Update existing record
        if (tableName === 'users' && record.new_password && record.new_password.trim() !== '') {
          // Special handling for password change in users table
          const API_BASE_URL = 'https://leadify-crm-backend.onrender.com/api';
          
          // Remove new_password from the record before updating
          const { new_password, ...updateData } = record;
          
          // Call API to update password
          const response = await fetch(`${API_BASE_URL}/users/${editingRecord.id}/password`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              new_password: new_password
            })
          });

          const passwordResult = await response.json();
          if (!passwordResult.success) {
            throw new Error(passwordResult.error || 'Failed to update password');
          }

          // Update other fields via Supabase - remove fields that shouldn't be updated
          const { 
            password,
            id, 
            created_at, 
            updated_at, 
            auth_id, 
            date_joined, 
            last_login, 
            groups, 
            user_permissions, 
            password_hash,
            updated_by,
            ...updateDataWithoutId 
          } = updateData;
          console.log(`Updating ${tableName} record with ID: ${editingRecord.id}`, updateDataWithoutId);
          
          // First, check if the record exists
          const { data: existingRecord, error: checkError } = await supabase
            .from(tableName)
            .select('id')
            .eq('id', String(editingRecord.id))
            .single();
          
          if (checkError) {
            console.error(`Record check error for ${tableName}:`, checkError);
            throw new Error(`Record with ID ${editingRecord.id} not found`);
          }
          
          console.log(`Record exists:`, existingRecord);
          
          console.log(`Attempting update with query:`, {
            table: tableName,
            id: String(editingRecord.id),
            updateData: updateDataWithoutId
          });
          
          const { data, error } = await supabase
            .from(tableName)
            .update(updateDataWithoutId)
            .eq('id', String(editingRecord.id))
            .select();
          
          console.log(`Update result:`, { data, error });

          if (error) {
            console.error(`Update error for ${tableName}:`, error);
            throw error;
          }

          if (!data || data.length === 0) {
            // Try to get more information about why the update failed
            console.log(`Update failed for ${tableName} record with ID ${editingRecord.id}. Attempting to fetch current user info...`);
            
            const { data: currentUser, error: userError } = await supabase.auth.getUser();
            console.log(`Current user:`, currentUser);
            
            // Check the current user's role in the users table
            let currentUserRecord = null;
            if (currentUser?.user?.id) {
              const { data: userRecord, error: currentUserError } = await supabase
                .from('users')
                .select('id, email, role, is_staff, is_superuser')
                .eq('id', currentUser.user.id)
                .single();
              
              currentUserRecord = userRecord;
              console.log(`Current user record from users table:`, { currentUserRecord, currentUserError });
            }
            
            // Try a simple select to see if we can read the record
            const { data: selectData, error: selectError } = await supabase
              .from(tableName)
              .select('*')
              .eq('id', String(editingRecord.id));
            
            console.log(`Select test result:`, { selectData, selectError });
            
            // Try a minimal update to test if it's a field-specific issue
            console.log(`Testing minimal update with just one field...`);
            const { data: testUpdateData, error: testUpdateError } = await supabase
              .from(tableName)
              .update({ updated_at: new Date().toISOString() })
              .eq('id', String(editingRecord.id))
              .select();
            
            console.log(`Test update result:`, { testUpdateData, testUpdateError });
            
            // Show user-friendly error message based on available information
            if (currentUserRecord) {
              // We have user record information
              const userRole = currentUserRecord.role || 'user';
              const isStaff = currentUserRecord.is_staff;
              const isSuperuser = currentUserRecord.is_superuser;
              
              if (userRole === 'admin' || isStaff || isSuperuser) {
                toast.error(`Access denied: Your account has ${userRole} role but still cannot update ${title.toLowerCase()} records. Please contact your system administrator.`);
              } else {
                toast.error(`Access denied: You don't have permission to update ${title.toLowerCase()} records. Only admin or superuser accounts can perform this action.`);
              }
            } else {
              // We don't have user record information
              toast.error(`Access denied: You don't have permission to update ${title.toLowerCase()} records. Only admin or superuser accounts can perform this action.`);
            }
            
            throw new Error(`Update failed: No rows were updated for ${tableName} record with ID ${editingRecord.id}. This is likely due to Row Level Security policies. Current user: ${currentUser?.user?.email || 'unknown'}`);
          }

          result = data[0];
          toast.success(`${title} updated successfully`);
        } else {
          // Regular update - remove fields that shouldn't be updated
          const { 
            new_password, 
            password,
            id, 
            created_at, 
            updated_at, 
            auth_id, 
            date_joined, 
            last_login, 
            groups, 
            user_permissions, 
            password_hash,
            updated_by,
            ...updateData 
          } = record;
          console.log(`Updating ${tableName} record with ID: ${editingRecord.id}`, updateData);
          
          // First, check if the record exists
          const { data: existingRecord, error: checkError } = await supabase
            .from(tableName)
            .select('id')
            .eq('id', String(editingRecord.id))
            .single();
          
          if (checkError) {
            console.error(`Record check error for ${tableName}:`, checkError);
            throw new Error(`Record with ID ${editingRecord.id} not found`);
          }
          
          console.log(`Record exists:`, existingRecord);
          
          console.log(`Attempting update with query:`, {
            table: tableName,
            id: String(editingRecord.id),
            updateData: updateData
          });
          
          const { data, error } = await supabase
            .from(tableName)
            .update(updateData)
            .eq('id', String(editingRecord.id))
            .select();
          
          console.log(`Update result:`, { data, error });

          if (error) {
            console.error(`Update error for ${tableName}:`, error);
            throw error;
          }

          if (!data || data.length === 0) {
            // Try to get more information about why the update failed
            console.log(`Update failed for ${tableName} record with ID ${editingRecord.id}. Attempting to fetch current user info...`);
            
            const { data: currentUser, error: userError } = await supabase.auth.getUser();
            console.log(`Current user:`, currentUser);
            
            // Check the current user's role in the users table
            let currentUserRecord = null;
            if (currentUser?.user?.id) {
              const { data: userRecord, error: currentUserError } = await supabase
                .from('users')
                .select('id, email, role, is_staff, is_superuser')
                .eq('id', currentUser.user.id)
                .single();
              
              currentUserRecord = userRecord;
              console.log(`Current user record from users table:`, { currentUserRecord, currentUserError });
            }
            
            // Try a simple select to see if we can read the record
            const { data: selectData, error: selectError } = await supabase
              .from(tableName)
              .select('*')
              .eq('id', String(editingRecord.id));
            
            console.log(`Select test result:`, { selectData, selectError });
            
            // Try a minimal update to test if it's a field-specific issue
            console.log(`Testing minimal update with just one field...`);
            const { data: testUpdateData, error: testUpdateError } = await supabase
              .from(tableName)
              .update({ updated_at: new Date().toISOString() })
              .eq('id', String(editingRecord.id))
              .select();
            
            console.log(`Test update result:`, { testUpdateData, testUpdateError });
            
            // Show user-friendly error message based on available information
            if (currentUserRecord) {
              // We have user record information
              const userRole = currentUserRecord.role || 'user';
              const isStaff = currentUserRecord.is_staff;
              const isSuperuser = currentUserRecord.is_superuser;
              
              if (userRole === 'admin' || isStaff || isSuperuser) {
                toast.error(`Access denied: Your account has ${userRole} role but still cannot update ${title.toLowerCase()} records. Please contact your system administrator.`);
              } else {
                toast.error(`Access denied: You don't have permission to update ${title.toLowerCase()} records. Only admin or superuser accounts can perform this action.`);
              }
            } else {
              // We don't have user record information
              toast.error(`Access denied: You don't have permission to update ${title.toLowerCase()} records. Only admin or superuser accounts can perform this action.`);
            }
            
            throw new Error(`Update failed: No rows were updated for ${tableName} record with ID ${editingRecord.id}. This is likely due to Row Level Security policies. Current user: ${currentUser?.user?.email || 'unknown'}`);
          }

          result = data[0];
          toast.success(`${title} updated successfully`);
        }
      } else {
        // Create new record
        if (tableName === 'users') {
          // Special handling for users table - create auth user first
          result = await createUserWithAuth(record);
        } else {
          // Regular create for other tables
          const { data, error } = await supabase
            .from(tableName)
            .insert(record)
            .select()
            .single();

          if (error) throw error;
          result = data;
          toast.success(`${title} created successfully`);
        }
      }

      setRecords(prev => {
        if (editingRecord?.id) {
          return prev.map(r => r.id === editingRecord.id ? result : r);
        } else {
          return [result, ...prev];
        }
      });

      closeModal();
    } catch (error) {
      console.error(`Error saving ${tableName}:`, error);
      toast.error(`Failed to save ${title}`);
    }
  };

  // Delete record
  const deleteRecord = async () => {
    if (!recordToDelete) return;

    try {
      const { error } = await supabase
        .from(tableName)
        .delete()
        .eq('id', String(recordToDelete.id));

      if (error) throw error;

      setRecords(prev => prev.filter(r => r.id !== recordToDelete.id));
      toast.success(`${title} deleted successfully`);
      closeDeleteModal();
    } catch (error) {
      console.error(`Error deleting ${tableName}:`, error);
      toast.error(`Failed to delete ${title}`);
    }
  };

  const openModal = (record?: Record) => {
    console.log(`Opening modal for ${tableName} with record:`, record);
    setEditingRecord(record || null);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setEditingRecord(null);
    setIsModalOpen(false);
  };

  const openDeleteModal = (record: Record) => {
    setRecordToDelete(record);
    setIsDeleteModalOpen(true);
  };

  const closeDeleteModal = () => {
    setRecordToDelete(null);
    setIsDeleteModalOpen(false);
  };

  const totalPages = Math.ceil(totalRecords / pageSize);

    const renderField = (field: Field, value: any, onChange: (value: any) => void) => {
    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      let newValue: any = e.target.value;
      if (field.type === 'number') {
        newValue = parseFloat(newValue) || 0;
      } else if (field.type === 'boolean') {
        newValue = (e.target as HTMLInputElement).checked;
      }
      onChange(newValue);
    };

    const commonProps = {
      name: field.name,
      className: `input input-bordered w-full ${field.readOnly ? 'input-disabled bg-gray-100' : ''}`,
      placeholder: field.placeholder,
      value: value || '',
      readOnly: field.readOnly,
      disabled: field.readOnly,
      onChange: field.readOnly ? undefined : handleChange
    };

    switch (field.type) {
      case 'textarea':
        return (
          <textarea
            {...commonProps}
            rows={4}
            value={value || ''}
            onChange={field.readOnly ? undefined : handleChange}
          />
        );

      case 'select':
        return (
          <select {...commonProps} value={value || ''} onChange={field.readOnly ? undefined : handleChange}>
            <option value="">Select {field.label}</option>
            {field.options?.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        );

      case 'boolean':
        return (
          <input
            name={field.name}
            type="checkbox"
            className={`checkbox checkbox-success ${field.readOnly ? 'checkbox-disabled' : ''}`}
            checked={value || false}
            disabled={field.readOnly}
            onChange={field.readOnly ? undefined : (e) => onChange(e.target.checked)}
          />
        );

      case 'date':
        return (
          <input
            {...commonProps}
            type="date"
            value={value ? new Date(value).toISOString().split('T')[0] : ''}
            onChange={field.readOnly ? undefined : handleChange}
          />
        );

      case 'datetime':
        return (
          <input
            {...commonProps}
            type="datetime-local"
            value={value ? new Date(value).toISOString().slice(0, 16) : ''}
            onChange={field.readOnly ? undefined : handleChange}
          />
        );

      default:
        return <input {...commonProps} type={field.type} />;
    }
  };

  return (
    <div className="w-full">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold text-base-content">{title}</h2>
          {description && <p className="text-base-content/70 mt-1">{description}</p>}
        </div>
        <button
          onClick={() => openModal()}
          className="btn btn-primary gap-2"
        >
          <PlusIcon className="w-5 h-5" />
          Add {title}
        </button>
      </div>

      {/* Search and Filters */}
      <div className="mb-4 flex flex-col sm:flex-row gap-4">
        {/* Search Input */}
        <div className="flex-1">
          <input
            type="text"
            placeholder={`Search ${title}...`}
            className="input input-bordered w-full max-w-md"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        
        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-2">
          {/* Is Active Filter */}
          {fields.some(f => f.name === 'is_active') && (
            <select
              className="select select-bordered w-full sm:w-32"
              value={isActiveFilter}
              onChange={(e) => setIsActiveFilter(e.target.value)}
            >
              <option value="all">All Status</option>
              <option value="yes">Active</option>
              <option value="no">Inactive</option>
            </select>
          )}
          
          {/* User Active Filter (for tenants_employee table with user_id field) */}
          {/* Temporarily disabled until user_id column is added to database */}
          {/* {tableName === 'tenants_employee' && fields.some(f => f.name === 'user_id') && (
            <select
              className="select select-bordered w-full sm:w-40"
              value={userActiveFilter}
              onChange={(e) => setUserActiveFilter(e.target.value)}
            >
              <option value="all">All User Status</option>
              <option value="yes">Active Users</option>
              <option value="no">Inactive Users</option>
            </select>
          )} */}
          
          {/* Show All Records Toggle */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              className="toggle toggle-primary"
              checked={showAllRecords}
              onChange={(e) => setShowAllRecords(e.target.checked)}
            />
            <span className="text-sm">Show All</span>
          </div>
        </div>
      </div>

      {/* Records Table */}
      <div className="bg-base-100 shadow-xl rounded-lg overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="loading loading-spinner loading-lg"></div>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto w-full p-4">
              <table className="table w-full">
                <thead className="bg-base-200">
                  <tr>
                    {fields.filter(field => !field.hideInTable).map(field => (
                      <th key={field.name} className="font-semibold">
                        {field.label}
                      </th>
                    ))}
                    <th className="font-semibold w-20">Actions</th>
                  </tr>
                </thead>
                  <tbody>
                    {records.map(record => (
                      <tr 
                        key={record.id}
                        className="cursor-pointer"
                        onClick={() => openModal(record)}
                      >
                        {fields.filter(field => !field.hideInTable).map(field => (
                          <td key={field.name}>
                            {field.type === 'boolean' ? (
                              <input
                                type="checkbox"
                                className="toggle toggle-success toggle-sm"
                                checked={record[field.name] || false}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  handleToggleBoolean(record, field.name, e.target.checked);
                                }}
                              />
                            ) : field.type === 'date' || field.type === 'datetime' ? (
                              new Date(record[field.name]).toLocaleDateString()
                            ) : field.foreignKey ? (
                              // Display foreign key name instead of ID
                              foreignKeyData[field.name]?.[record[field.name]] || record[field.name] || '-'
                            ) : field.name === 'bonuses_role' ? (
                              // Special handling for bonuses_role to display mapped role names
                              (() => {
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
                                const roleCode = record[field.name];
                                return roleMap[roleCode] || roleCode || '-';
                              })()
                            ) : field.name === 'groups' || field.name === 'user_permissions' ? (
                              // Special handling for array fields
                              (() => {
                                const value = record[field.name];
                                if (!value) return '-';
                                if (Array.isArray(value)) {
                                  return value.length > 0 ? value.join(', ') : '-';
                                }
                                if (typeof value === 'string') {
                                  try {
                                    const parsed = JSON.parse(value);
                                    if (Array.isArray(parsed)) {
                                      return parsed.length > 0 ? parsed.join(', ') : '-';
                                    }
                                  } catch {
                                    return value || '-';
                                  }
                                }
                                return value || '-';
                              })()
                            ) : (
                              record[field.name] || '-'
                            )}
                          </td>
                        ))}
                        <td className="w-20">
                          <div className="flex justify-center">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                openDeleteModal(record);
                              }}
                              className="btn btn-ghost btn-sm text-error"
                              title="Delete"
                            >
                              <TrashIcon className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Record Count and Pagination */}
              <div className="flex justify-between items-center mt-4">
                <div className="text-sm text-base-content/70">
                  {showAllRecords ? (
                    `Showing all ${totalRecords} records`
                  ) : (
                    `Showing ${((currentPage - 1) * pageSize) + 1} to ${Math.min(currentPage * pageSize, totalRecords)} of ${totalRecords} records`
                  )}
                </div>
                
                {/* Pagination Controls - Only show when not showing all records */}
                {!showAllRecords && totalPages > 1 && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                      disabled={currentPage === 1}
                      className="btn btn-sm btn-outline"
                    >
                      <ChevronLeftIcon className="w-4 h-4" />
                    </button>
                    <span className="btn btn-sm btn-outline">
                      {currentPage} of {totalPages}
                    </span>
                    <button
                      onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                      disabled={currentPage === totalPages}
                      className="btn btn-sm btn-outline"
                    >
                      <ChevronRightIcon className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
      </div>

      {/* Add/Edit Drawer */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex">
          {/* Overlay */}
          <div className="fixed inset-0 bg-black/30 transition-opacity duration-300" onClick={closeModal} />
          {/* Drawer */}
          <div className="ml-auto w-full max-w-2xl bg-white h-full shadow-2xl p-0 flex flex-col animate-slideInRight z-50 overflow-y-auto border-l border-gray-200">
            {/* Header */}
            <div className="flex items-center justify-between px-8 pt-8 pb-4 border-b border-gray-100">
              <div>
                <h3 className="text-2xl font-bold text-gray-900">
                  {editingRecord?.id ? `Edit ${title}` : `Add ${title}`}
                </h3>
                <div className="text-base font-medium text-gray-500 mt-1">
                  {editingRecord?.id ? 'Update record details' : 'Create new record'}
                </div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={closeModal}>
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>

            {/* Form Content */}
            <div className="flex-1 overflow-y-auto p-8">
              <form onSubmit={(e) => {
                e.preventDefault();
                if (!editingRecord) return;
                
                const record: Partial<Record> = { ...editingRecord };
                
                // Add boolean fields from editingRecord
                fields.filter(field => field.type === 'boolean').forEach(field => {
                  record[field.name] = editingRecord[field.name] || false;
                });

                saveRecord(record);
              }}>
                <div className="grid grid-cols-1 gap-6">
                  {fields.filter(field => field.type !== 'boolean' && (!editingRecord?.id || !field.hideInAdd) && (!editingRecord?.id || !field.hideInEdit)).map(field => (
                    <div key={field.name} className="form-control">
                      <label className="label">
                        <span className="label-text font-semibold text-gray-700">
                          {field.label}
                          {field.required && !editingRecord?.id && <span className="text-error ml-1">*</span>}
                        </span>
                      </label>
                      {renderField(
                        field,
                        editingRecord?.[field.name],
                        (value) => {
                          setEditingRecord(prev => prev ? {
                            ...prev,
                            [field.name]: value
                          } : null);
                        }
                      )}
                    </div>
                  ))}
                  
                  {/* Boolean fields */}
                  {fields.filter(field => field.type === 'boolean' && (!editingRecord?.id || !field.hideInAdd) && (!editingRecord?.id || !field.hideInEdit)).map(field => (
                    <div key={field.name} className="form-control">
                      <label className="label">
                        <span className="label-text font-semibold text-gray-700">
                          {field.label}
                          {field.required && !editingRecord?.id && <span className="text-error ml-1">*</span>}
                        </span>
                      </label>
                      {renderField(
                        field,
                        editingRecord?.[field.name],
                        (value) => {
                          setEditingRecord(prev => prev ? {
                            ...prev,
                            [field.name]: value
                          } : null);
                        }
                      )}
                    </div>
                  ))}
                </div>

                {/* Action Buttons */}
                <div className="flex justify-end gap-3 mt-8 pt-6 border-t border-gray-100">
                  <button type="button" onClick={closeModal} className="btn btn-ghost">
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary">
                    {editingRecord?.id ? 'Update' : 'Create'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {isDeleteModalOpen && (
        <div className="modal modal-open">
          <div className="modal-box">
            <h3 className="text-lg font-bold mb-4">Confirm Delete</h3>
            <p className="mb-4">
              Are you sure you want to delete this {title.toLowerCase()}? This action cannot be undone.
            </p>
            <div className="modal-action">
              <button onClick={closeDeleteModal} className="btn btn-ghost">
                Cancel
              </button>
              <button onClick={deleteRecord} className="btn btn-error">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default GenericCRUDManager; 