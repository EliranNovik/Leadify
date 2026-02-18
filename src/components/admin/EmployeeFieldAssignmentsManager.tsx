import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { toast } from 'react-hot-toast';
import { PlusIcon, PencilIcon, TrashIcon, XMarkIcon, CurrencyDollarIcon } from '@heroicons/react/24/outline';
import EmployeeFieldAssignmentsForm from './EmployeeFieldAssignmentsForm';
import HandlersSalesPercentageModal from './HandlersSalesPercentageModal';

interface Record {
  id: number;
  employee_id: number;
  field_id: number;
  field_percentage: number | null;
  department_role: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface HandlersSalesContribution {
  id: number;
  employee_id: number;
  field_id: number;
  handlers_sales_percentage: number;
  department_role: 'Handlers' | 'Sales';
  is_active: boolean;
}

const EmployeeFieldAssignmentsManager: React.FC = () => {
  const [records, setRecords] = useState<Record[]>([]);
  const [handlersSalesContributions, setHandlersSalesContributions] = useState<HandlersSalesContribution[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingRecord, setEditingRecord] = useState<Record | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [recordToDelete, setRecordToDelete] = useState<Record | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [formData, setFormData] = useState<any>(null);
  const [employeeMap, setEmployeeMap] = useState<Map<number, string>>(new Map());
  const [fieldMap, setFieldMap] = useState<Map<number, string>>(new Map());
  const [isHandlersSalesModalOpen, setIsHandlersSalesModalOpen] = useState(false);
  const [selectedEmployeeForHandlersSales, setSelectedEmployeeForHandlersSales] = useState<{ id: number; name: string } | null>(null);
  const pageSize = 20;

  // Fetch records
  const fetchRecords = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('employee_field_assignments')
        .select('*', { count: 'exact' })
        .order('field_percentage', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false });

      if (searchTerm) {
        const searchNum = parseInt(searchTerm);
        const isNumeric = !isNaN(searchNum);

        if (isNumeric) {
          // Search by employee_id or field_id if it's a number
          query = query.or(`employee_id.eq.${searchNum},field_id.eq.${searchNum}`);
        } else {
          // Search by employee display_name or field name
          // First, find employees matching the search term
          const { data: matchingEmployees } = await supabase
            .from('tenants_employee')
            .select('id')
            .ilike('display_name', `%${searchTerm}%`);

          // Find fields matching the search term
          const { data: matchingFields } = await supabase
            .from('misc_maincategory')
            .select('id')
            .ilike('name', `%${searchTerm}%`);

          const employeeIds = matchingEmployees?.map(e => e.id) || [];
          const fieldIds = matchingFields?.map(f => f.id) || [];

          if (employeeIds.length > 0 || fieldIds.length > 0) {
            // Build OR condition for Supabase
            const orConditions: string[] = [];
            if (employeeIds.length > 0) {
              orConditions.push(`employee_id.in.(${employeeIds.join(',')})`);
            }
            if (fieldIds.length > 0) {
              orConditions.push(`field_id.in.(${fieldIds.join(',')})`);
            }
            if (orConditions.length > 0) {
              query = query.or(orConditions.join(','));
            }
          } else {
            // No matches, return empty result
            query = query.eq('id', -1); // Impossible condition
          }
        }
      }

      const { data, error, count } = await query
        .range((currentPage - 1) * pageSize, currentPage * pageSize - 1);

      if (error) throw error;

      setRecords(data || []);
      setTotalRecords(count || 0);

      // Fetch handlers/sales contributions separately
      let contributionsQuery = supabase
        .from('employee_handlers_sales_contributions')
        .select('*')
        .eq('is_active', true);

      // If we have a search term, filter contributions by matching employees/fields
      if (searchTerm && data && data.length > 0) {
        const employeeIds = [...new Set(data.map(r => r.employee_id))];
        const fieldIds = [...new Set(data.map(r => r.field_id))];

        if (employeeIds.length > 0 || fieldIds.length > 0) {
          const orConditions: string[] = [];
          if (employeeIds.length > 0) {
            orConditions.push(`employee_id.in.(${employeeIds.join(',')})`);
          }
          if (fieldIds.length > 0) {
            orConditions.push(`field_id.in.(${fieldIds.join(',')})`);
          }
          if (orConditions.length > 0) {
            contributionsQuery = contributionsQuery.or(orConditions.join(','));
          }
        }
      }

      const { data: contributionsData, error: contributionsError } = await contributionsQuery;

      if (contributionsError) {
        console.error('Error fetching contributions:', contributionsError);
      } else {
        setHandlersSalesContributions(contributionsData || []);
      }

      // Fetch employee and field names for display
      const allEmployeeIds = new Set<number>();
      const allFieldIds = new Set<number>();

      if (data && data.length > 0) {
        data.forEach(r => {
          allEmployeeIds.add(r.employee_id);
          allFieldIds.add(r.field_id);
        });
      }

      if (contributionsData && contributionsData.length > 0) {
        contributionsData.forEach(c => {
          allEmployeeIds.add(c.employee_id);
          allFieldIds.add(c.field_id);
        });
      }

      if (allEmployeeIds.size > 0 || allFieldIds.size > 0) {
        const employeeIds = Array.from(allEmployeeIds);
        const fieldIds = Array.from(allFieldIds);

        const { data: employees } = await supabase
          .from('tenants_employee')
          .select('id, display_name')
          .in('id', employeeIds);

        const { data: fields } = await supabase
          .from('misc_maincategory')
          .select('id, name')
          .in('id', fieldIds);

        const empMap = new Map<number, string>();
        employees?.forEach(emp => empMap.set(emp.id, emp.display_name));
        setEmployeeMap(empMap);

        const fldMap = new Map<number, string>();
        fields?.forEach(fld => fldMap.set(fld.id, fld.name));
        setFieldMap(fldMap);
      } else {
        // Clear maps if no data
        setEmployeeMap(new Map());
        setFieldMap(new Map());
      }
    } catch (error) {
      console.error('Error fetching records:', error);
      toast.error('Failed to fetch records');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecords();
  }, [currentPage, searchTerm]);

  const openModal = async (record?: Record) => {
    setEditingRecord(record || null);

    if (record) {
      // Load all records for this employee
      try {
        const { data, error } = await supabase
          .from('employee_field_assignments')
          .select('*')
          .eq('employee_id', record.employee_id);

        if (error) throw error;

        if (data && data.length > 0) {
          console.log('Loading employee data:', data);

          // Group by field_id to get unique fields with their percentages
          // Also track which roles are associated with which fields
          const fieldMap = new Map<string, {
            field_id: string;
            field_percentage: number;
            roles: Set<string>;
          }>();

          data.forEach((item: any) => {
            const fieldId = item.field_id.toString();
            if (!fieldMap.has(fieldId)) {
              fieldMap.set(fieldId, {
                field_id: fieldId,
                field_percentage: item.field_percentage,
                roles: new Set()
              });
            } else {
              // If percentages differ, log a warning but keep the first one
              const existing = fieldMap.get(fieldId);
              if (existing && existing.field_percentage !== item.field_percentage) {
                console.warn(`Field ${fieldId} has different percentages: ${existing.field_percentage} vs ${item.field_percentage}. Using ${existing.field_percentage}.`);
              }
            }

            // Add role to this field's roles set
            if (item.department_role) {
              fieldMap.get(fieldId)!.roles.add(item.department_role);
            }
          });

          // Collect all unique department roles from all records
          // This preserves all roles that were assigned to any field
          const allRoles = [...new Set(data.map((item: any) => item.department_role).filter(Boolean))];

          // Convert fieldMap to field_entries (without roles, as roles are global in the UI)
          const fieldEntries = Array.from(fieldMap.values()).map(field => ({
            field_id: field.field_id,
            field_percentage: field.field_percentage
          }));

          console.log('Loaded form data:', {
            employee_id: record.employee_id.toString(),
            field_entries: fieldEntries,
            department_roles: allRoles,
            is_active: data[0].is_active,
            fieldRoleMap: Object.fromEntries(
              Array.from(fieldMap.entries()).map(([fieldId, field]) => [
                fieldId,
                Array.from(field.roles)
              ])
            )
          });

          setFormData({
            employee_id: record.employee_id.toString(),
            field_entries: fieldEntries,
            department_roles: allRoles,
            is_active: data[0].is_active
          });
        }
      } catch (error) {
        console.error('Error loading employee data:', error);
        toast.error('Failed to load employee data');
      }
    } else {
      // For new records, initialize with empty form data
      setFormData({
        employee_id: '',
        field_entries: [{ field_id: '', field_percentage: 0 }],
        department_roles: [],
        is_active: true
      });
    }

    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingRecord(null);
    setFormData(null);
  };

  const saveRecord = async () => {
    if (!formData || !formData.employee_id) {
      toast.error('Please select an employee');
      return;
    }

    if (!formData.field_entries || formData.field_entries.length === 0) {
      toast.error('Please add at least one field assignment');
      return;
    }

    try {
      const employeeId = parseInt(formData.employee_id);

      // If editing, delete all existing records for this employee first
      if (editingRecord) {
        const { error: deleteError } = await supabase
          .from('employee_field_assignments')
          .delete()
          .eq('employee_id', employeeId);

        if (deleteError) throw deleteError;
      }

      // Create records for each field + role combination
      const recordsToInsert: any[] = [];
      const departmentRoles = formData.department_roles || [];

      console.log('Saving with form data:', formData);
      console.log('Department roles:', departmentRoles);
      console.log('Field entries:', formData.field_entries);

      for (const entry of formData.field_entries) {
        if (!entry.field_id) {
          toast.error('Please select a field for all entries');
          return;
        }

        const fieldId = parseInt(entry.field_id);
        const fieldPercentage = parseFloat(entry.field_percentage) || 0;
        const activeStatus = formData.is_active !== false;

        // If no roles selected, create one record with null role
        if (!departmentRoles || departmentRoles.length === 0) {
          recordsToInsert.push({
            employee_id: employeeId,
            field_id: fieldId,
            field_percentage: fieldPercentage,
            department_role: null,
            is_active: activeStatus
          });
        } else {
          // Create one record per role for this field
          for (const role of departmentRoles) {
            recordsToInsert.push({
              employee_id: employeeId,
              field_id: fieldId,
              field_percentage: fieldPercentage,
              department_role: role,
              is_active: activeStatus
            });
          }
        }
      }

      console.log('Records to insert:', recordsToInsert);

      if (recordsToInsert.length === 0) {
        toast.error('No valid records to save');
        return;
      }

      const { error } = await supabase
        .from('employee_field_assignments')
        .insert(recordsToInsert);

      if (error) throw error;

      toast.success(`Successfully saved ${recordsToInsert.length} assignment(s)`);
      closeModal();
      fetchRecords();
    } catch (error: any) {
      console.error('Error saving records:', error);
      toast.error(error.message || 'Failed to save assignments');
    }
  };

  const deleteRecord = async () => {
    if (!recordToDelete) return;

    try {
      // Delete all records for this employee
      const { error } = await supabase
        .from('employee_field_assignments')
        .delete()
        .eq('employee_id', recordToDelete.employee_id);

      if (error) throw error;

      toast.success('Assignments deleted successfully');
      setIsDeleteModalOpen(false);
      setRecordToDelete(null);
      fetchRecords();
    } catch (error: any) {
      console.error('Error deleting records:', error);
      toast.error(error.message || 'Failed to delete assignments');
    }
  };

  // Create a map of handlers/sales contributions by employee_id and field_id
  const contributionsMap = new Map<string, Map<string, number>>(); // employeeId -> fieldId -> role -> percentage
  handlersSalesContributions.forEach(contrib => {
    const key = `${contrib.employee_id}-${contrib.field_id}`;
    if (!contributionsMap.has(key)) {
      contributionsMap.set(key, new Map());
    }
    contributionsMap.get(key)!.set(contrib.department_role, contrib.handlers_sales_percentage);
  });

  // Group records by employee, then by field to avoid duplicate fields
  const groupedByEmployee = records.reduce((acc, record) => {
    if (!acc[record.employee_id]) {
      acc[record.employee_id] = {};
    }
    const fieldId = record.field_id.toString();
    if (!acc[record.employee_id][fieldId]) {
      acc[record.employee_id][fieldId] = {
        field_id: record.field_id,
        field_percentage: record.field_percentage,
        roles: new Set<string>(),
        handlersSalesRoles: new Map<string, number>(), // Map role to percentage
        is_active: record.is_active,
        firstRecord: record // Keep first record for edit/delete actions
      };

      // Add handlers/sales contributions for this employee-field combination
      const contribKey = `${record.employee_id}-${record.field_id}`;
      const contribMap = contributionsMap.get(contribKey);
      if (contribMap) {
        contribMap.forEach((percentage, role) => {
          acc[record.employee_id][fieldId].handlersSalesRoles.set(role, percentage);
        });
      }
    }
    // Add role to the set
    if (record.department_role) {
      acc[record.employee_id][fieldId].roles.add(record.department_role);
    }
    return acc;
  }, {} as { [employeeId: number]: { [fieldId: string]: { field_id: number; field_percentage: number | null; roles: Set<string>; handlersSalesRoles: Map<string, number>; is_active: boolean; firstRecord: Record } } });

  const groupedRecordsArray = Object.entries(groupedByEmployee).map(([employeeId, fields]) => ({
    employeeId: parseInt(employeeId),
    fields: Object.values(fields).map(field => ({
      field_id: field.field_id,
      field_percentage: field.field_percentage,
      roles: Array.from(field.roles).sort(),
      handlersSalesRoles: field.handlersSalesRoles,
      is_active: field.is_active,
      firstRecord: field.firstRecord
    }))
  }));

  return (
    <div className="w-full">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Employee Field Assignments</h1>
        <p className="text-base-content/70">
          Manage employee assignments to fields (categories) with field percentage and department role.
          Each employee can have multiple field assignments with multiple department roles.
        </p>
      </div>

      <div className="flex justify-between items-center mb-4">
        <input
          type="text"
          placeholder="Search by employee name, field name, or ID..."
          className="input input-bordered w-64"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        <div className="flex gap-2">
          <button
            className="btn btn-secondary"
            onClick={() => {
              setSelectedEmployeeForHandlersSales(null);
              setIsHandlersSalesModalOpen(true);
            }}
          >
            <CurrencyDollarIcon className="w-5 h-5 mr-2" />
            Contributed - %
          </button>
          <button
            className="btn btn-primary"
            onClick={() => openModal()}
          >
            <PlusIcon className="w-5 h-5 mr-2" />
            Add Assignment
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <span className="loading loading-spinner loading-lg"></span>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="table w-full">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Field</th>
                <th>Percentage</th>
                <th>Department Role</th>
                <th>Fixed Contribution</th>
                <th>Active</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {groupedRecordsArray.map(({ employeeId, fields }) => {
                // Collect all unique roles across all fields for this employee
                const allRoles = new Set<string>();
                fields.forEach(field => {
                  field.roles.forEach(role => allRoles.add(role));
                });
                const rolesDisplay = allRoles.size > 0 ? Array.from(allRoles).sort().join(', ') : '—';

                return (
                  <React.Fragment key={employeeId}>
                    {fields.map((field, idx) => {
                      const record = field.firstRecord;

                      return (
                        <tr key={`${employeeId}-${field.field_id}-${idx}`}>
                          {idx === 0 && (
                            <td rowSpan={fields.length} className="align-top">
                              {employeeMap.get(employeeId) || `Employee #${employeeId}`}
                            </td>
                          )}
                          <td>{fieldMap.get(field.field_id) || `Field #${field.field_id}`}</td>
                          <td>{field.field_percentage !== null ? `${field.field_percentage}%` : '—'}</td>
                          {idx === 0 && (
                            <td rowSpan={fields.length} className="align-top">
                              {rolesDisplay}
                            </td>
                          )}
                          <td>
                            {field.handlersSalesRoles.size > 0 ? (
                              <div className="text-sm">
                                {Array.from(field.handlersSalesRoles.entries()).map(([role, percentage]) => (
                                  <div key={role}>
                                    {role}: {percentage}%
                                  </div>
                                ))}
                              </div>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td>
                            <input
                              type="checkbox"
                              className="checkbox"
                              checked={field.is_active}
                              disabled
                            />
                          </td>
                          {idx === 0 && (
                            <td rowSpan={fields.length} className="align-top">
                              <div className="flex flex-col gap-2">
                                <div className="flex gap-2">
                                  <button
                                    className="btn btn-ghost btn-sm"
                                    onClick={() => openModal(record)}
                                  >
                                    <PencilIcon className="w-4 h-4" />
                                  </button>
                                  <button
                                    className="btn btn-ghost btn-sm text-error"
                                    onClick={() => {
                                      setRecordToDelete(record);
                                      setIsDeleteModalOpen(true);
                                    }}
                                  >
                                    <TrashIcon className="w-4 h-4" />
                                  </button>
                                </div>
                                <button
                                  className="btn btn-outline btn-sm"
                                  onClick={() => {
                                    setSelectedEmployeeForHandlersSales({
                                      id: employeeId,
                                      name: employeeMap.get(employeeId) || `Employee #${employeeId}`
                                    });
                                    setIsHandlersSalesModalOpen(true);
                                  }}
                                >
                                  <CurrencyDollarIcon className="w-4 h-4" />
                                  Contributed - %
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      <div className="flex justify-between items-center mt-4">
        <div>
          Showing {(currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, totalRecords)} of {totalRecords} records
        </div>
        <div className="join">
          <button
            className="join-item btn"
            disabled={currentPage === 1}
            onClick={() => setCurrentPage(p => p - 1)}
          >
            Previous
          </button>
          <button className="join-item btn">
            Page {currentPage}
          </button>
          <button
            className="join-item btn"
            disabled={currentPage * pageSize >= totalRecords}
            onClick={() => setCurrentPage(p => p + 1)}
          >
            Next
          </button>
        </div>
      </div>

      {/* Add/Edit Modal */}
      {isModalOpen && (
        <div className="modal modal-open">
          <div className="modal-box w-11/12 max-w-4xl">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-2xl font-bold">
                {editingRecord ? 'Edit' : 'Add'} Employee Field Assignment
              </h3>
              <button className="btn btn-sm btn-circle" onClick={closeModal}>
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            <EmployeeFieldAssignmentsForm
              value={formData}
              onChange={(newValue) => {
                console.log('Form onChange called with:', newValue);
                setFormData(newValue);
              }}
              record={editingRecord || undefined}
            />

            <div className="modal-action">
              <button className="btn" onClick={closeModal}>Cancel</button>
              <button className="btn btn-primary" onClick={saveRecord}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Modal */}
      {isDeleteModalOpen && recordToDelete && (
        <div className="modal modal-open">
          <div className="modal-box">
            <h3 className="text-lg font-bold">Delete Assignment</h3>
            <p className="py-4">
              Are you sure you want to delete all field assignments for employee "{employeeMap.get(recordToDelete.employee_id) || `#${recordToDelete.employee_id}`}"?
              This action cannot be undone.
            </p>
            <div className="modal-action">
              <button className="btn" onClick={() => {
                setIsDeleteModalOpen(false);
                setRecordToDelete(null);
              }}>
                Cancel
              </button>
              <button className="btn btn-error" onClick={deleteRecord}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Handlers/Sales Percentage Modal */}
      {isHandlersSalesModalOpen && (
        <HandlersSalesPercentageModal
          isOpen={isHandlersSalesModalOpen}
          onClose={() => {
            setIsHandlersSalesModalOpen(false);
            setSelectedEmployeeForHandlersSales(null);
            fetchRecords(); // Refresh data after closing
          }}
          employeeId={selectedEmployeeForHandlersSales?.id}
          employeeName={selectedEmployeeForHandlersSales?.name}
        />
      )}
    </div>
  );
};

export default EmployeeFieldAssignmentsManager;
