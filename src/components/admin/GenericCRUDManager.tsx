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
  type: 'text' | 'number' | 'email' | 'textarea' | 'select' | 'boolean' | 'date' | 'datetime';
  required?: boolean;
  options?: { value: string; label: string }[];
  placeholder?: string;
  hideInTable?: boolean;
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
  pageSize = 10
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
  const [foreignKeyData, setForeignKeyData] = useState<{[key: string]: {[key: string]: string}}>({});

  // Fetch records
  const fetchRecords = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from(tableName)
        .select('*', { count: 'exact' });

      // Add search functionality if search term exists
      if (searchTerm) {
        // Search in all text fields
        const textFields = fields.filter(f => f.type === 'text' || f.type === 'email' || f.type === 'textarea');
        if (textFields.length > 0) {
          const searchConditions = textFields.map(field => `${field.name}.ilike.%${searchTerm}%`);
          query = query.or(searchConditions.join(','));
        }
      }

      // Add pagination
      const from = (currentPage - 1) * pageSize;
      const to = from + pageSize - 1;
      query = query.range(from, to).order('created_at', { ascending: false });

      const { data, error, count } = await query;

      if (error) {
        console.error(`Error fetching ${tableName}:`, error);
        toast.error(`Failed to load ${title}`);
      } else {
        setRecords(data || []);
        setTotalRecords(count || 0);
        
        // Fetch foreign key data
        await fetchForeignKeyData(data || []);
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

    for (const field of foreignKeyFields) {
      if (!field.foreignKey) continue;
      
      const { table, valueField, displayField } = field.foreignKey;
      const uniqueIds = [...new Set(records.map(r => r[field.name]).filter(id => id))];
      
      if (uniqueIds.length > 0) {
        try {
          const { data } = await supabase
            .from(table)
            .select(`${valueField}, ${displayField}`)
            .in(valueField, uniqueIds);
          
          if (data) {
            fkData[field.name] = {};
            data.forEach(item => {
              fkData[field.name][item[valueField] as string] = item[displayField] as string;
            });
          }
        } catch (error) {
          console.error(`Error fetching foreign key data for ${field.name}:`, error);
        }
      }
    }
    
    setForeignKeyData(fkData);
  };

  useEffect(() => {
    fetchRecords();
  }, [currentPage, searchTerm]);

  // Create or update record
  const saveRecord = async (record: Partial<Record>) => {
    // Handle array fields for Postgres
    ['languages', 'allowed_employee_names'].forEach((arrayField) => {
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
    try {
      let result;
      if (editingRecord?.id) {
        // Update existing record
        const { data, error } = await supabase
          .from(tableName)
          .update(record)
          .eq('id', editingRecord.id)
          .select()
          .single();

        if (error) throw error;
        result = data;
        toast.success(`${title} updated successfully`);
      } else {
        // Create new record
        const { data, error } = await supabase
          .from(tableName)
          .insert(record)
          .select()
          .single();

        if (error) throw error;
        result = data;
        toast.success(`${title} created successfully`);
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
        .eq('id', recordToDelete.id);

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
    const commonProps = {
      name: field.name,
      className: 'input input-bordered w-full',
      placeholder: field.placeholder,
      value: value || '',
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        let newValue: any = e.target.value;
        if (field.type === 'number') {
          newValue = parseFloat(newValue) || 0;
        } else if (field.type === 'boolean') {
          newValue = (e.target as HTMLInputElement).checked;
        }
        onChange(newValue);
      }
    };

    switch (field.type) {
      case 'textarea':
        return (
          <textarea
            {...commonProps}
            rows={4}
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
          />
        );

      case 'select':
        return (
          <select {...commonProps} value={value || ''}>
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
            className="checkbox checkbox-success"
            checked={value || false}
            onChange={(e) => onChange(e.target.checked)}
          />
        );

      case 'date':
        return (
          <input
            {...commonProps}
            type="date"
            value={value ? new Date(value).toISOString().split('T')[0] : ''}
            onChange={(e) => onChange(e.target.value)}
          />
        );

      case 'datetime':
        return (
          <input
            {...commonProps}
            type="datetime-local"
            value={value ? new Date(value).toISOString().slice(0, 16) : ''}
            onChange={(e) => onChange(e.target.value)}
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

      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          placeholder={`Search ${title}...`}
          className="input input-bordered w-full max-w-md"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {/* Records Table */}
      <div className="card bg-base-100 shadow-xl">
        <div className="card-body">
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="loading loading-spinner loading-lg"></div>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="table table-zebra w-full">
                  <thead>
                    <tr>
                      {fields.filter(field => !field.hideInTable).map(field => (
                        <th key={field.name} className="font-semibold">
                          {field.label}
                        </th>
                      ))}
                      <th className="font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map(record => (
                      <tr key={record.id}>
                        {fields.filter(field => !field.hideInTable).map(field => (
                          <td key={field.name}>
                            {field.type === 'boolean' ? (
                              <input
                                type="checkbox"
                                className="checkbox checkbox-success"
                                checked={record[field.name] || false}
                                disabled
                              />
                            ) : field.type === 'date' || field.type === 'datetime' ? (
                              new Date(record[field.name]).toLocaleDateString()
                            ) : field.foreignKey ? (
                              // Display foreign key name instead of ID
                              foreignKeyData[field.name]?.[record[field.name]] || record[field.name] || '-'
                            ) : (
                              record[field.name] || '-'
                            )}
                          </td>
                        ))}
                        <td>
                          <div className="flex gap-2">
                            <button
                              onClick={() => openModal(record)}
                              className="btn btn-ghost btn-sm"
                              title="Edit"
                            >
                              <PencilIcon className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => openDeleteModal(record)}
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

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex justify-between items-center mt-4">
                  <div className="text-sm text-base-content/70">
                    Showing {((currentPage - 1) * pageSize) + 1} to {Math.min(currentPage * pageSize, totalRecords)} of {totalRecords} records
                  </div>
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
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Add/Edit Modal */}
      {isModalOpen && (
        <div className="modal modal-open">
          <div className="modal-box w-11/12 max-w-2xl">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold">
                {editingRecord?.id ? `Edit ${title}` : `Add ${title}`}
              </h3>
              <button onClick={closeModal} className="btn btn-ghost btn-sm">
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={(e) => {
              e.preventDefault();
              const formData = new FormData(e.currentTarget);
              const record: Partial<Record> = {};
              
              fields.forEach(field => {
                const value = formData.get(field.name);
                if (field.type === 'number') {
                  // Handle empty strings for number fields
                  const numValue = value === '' ? null : parseFloat(value as string);
                  record[field.name] = isNaN(numValue as number) ? null : numValue;
                } else if (field.type === 'boolean') {
                  record[field.name] = value === 'on';
                } else {
                  record[field.name] = value;
                }
              });

              saveRecord(record);
            }}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {fields.map(field => (
                  <div key={field.name} className="form-control">
                    <label className="label">
                      <span className="label-text font-semibold">
                        {field.label}
                        {field.required && <span className="text-error">*</span>}
                      </span>
                    </label>
                                         {renderField(
                       field,
                       editingRecord?.[field.name],
                       (value) => {
                         setEditingRecord(prev => prev ? ({
                           ...prev,
                           [field.name]: value
                         }) : null);
                       }
                     )}
                  </div>
                ))}
              </div>

              <div className="modal-action">
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