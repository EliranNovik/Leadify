import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { toast } from 'react-hot-toast';
import { PlusIcon, TrashIcon, XMarkIcon } from '@heroicons/react/24/outline';

interface HandlersSalesEntry {
  field_id: string;
  handlers_sales_percentage: number;
  department_role: 'Handlers' | 'Sales';
}

interface HandlersSalesPercentageModalProps {
  isOpen: boolean;
  onClose: () => void;
  employeeId?: number;
  employeeName?: string;
}

const HandlersSalesPercentageModal: React.FC<HandlersSalesPercentageModalProps> = ({
  isOpen,
  onClose,
  employeeId: initialEmployeeId,
  employeeName: initialEmployeeName
}) => {
  const [entries, setEntries] = useState<HandlersSalesEntry[]>([]);
  const [fields, setFields] = useState<Array<{ value: string; label: string }>>([]);
  const [employees, setEmployees] = useState<Array<{ value: string; label: string }>>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>(initialEmployeeId?.toString() || '');
  const [selectedEmployeeName, setSelectedEmployeeName] = useState<string>(initialEmployeeName || '');
  const [employeeSearchTerm, setEmployeeSearchTerm] = useState('');
  const [showEmployeeDropdown, setShowEmployeeDropdown] = useState(false);
  const [fieldSearchTerms, setFieldSearchTerms] = useState<{ [key: number]: string }>({});
  const [showFieldDropdowns, setShowFieldDropdowns] = useState<{ [key: number]: boolean }>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      fetchFields();
      fetchEmployees();
      if (initialEmployeeId) {
        setSelectedEmployeeId(initialEmployeeId.toString());
        setSelectedEmployeeName(initialEmployeeName || '');
        loadExistingEntries(initialEmployeeId);
      } else {
        setSelectedEmployeeId('');
        setSelectedEmployeeName('');
        setEntries([]);
      }
    } else {
      // Reset state when modal closes
      setSelectedEmployeeId('');
      setSelectedEmployeeName('');
      setEntries([]);
      setEmployeeSearchTerm('');
    }
  }, [isOpen, initialEmployeeId, initialEmployeeName]);

  useEffect(() => {
    if (selectedEmployeeId && isOpen && !initialEmployeeId) {
      const employeeIdNum = parseInt(selectedEmployeeId);
      if (employeeIdNum) {
        loadExistingEntries(employeeIdNum);
        const employee = employees.find(e => e.value === selectedEmployeeId);
        if (employee) {
          setSelectedEmployeeName(employee.label);
        }
      }
    }
  }, [selectedEmployeeId, isOpen, employees, initialEmployeeId]);

  const fetchFields = async () => {
    try {
      const { data, error } = await supabase
        .from('misc_maincategory')
        .select('id, name')
        .order('name');

      if (error) throw error;

      const fieldOptions = data?.map(field => ({
        value: field.id.toString(),
        label: field.name
      })) || [];
      setFields(fieldOptions);
    } catch (error) {
      console.error('Error fetching fields:', error);
      toast.error('Failed to load fields');
    }
  };

  const fetchEmployees = async () => {
    try {
      const { data, error } = await supabase
        .from('tenants_employee')
        .select('id, display_name')
        .order('display_name');

      if (error) throw error;

      const employeeOptions = data?.map(emp => ({
        value: emp.id.toString(),
        label: emp.display_name || `Employee #${emp.id}`
      })) || [];
      setEmployees(employeeOptions);
    } catch (error) {
      console.error('Error fetching employees:', error);
      toast.error('Failed to load employees');
    }
  };

  const loadExistingEntries = async (empId: number) => {
    if (!empId) return;

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('employee_handlers_sales_contributions')
        .select('*')
        .eq('employee_id', empId)
        .eq('is_active', true);

      if (error) throw error;

      if (data && data.length > 0) {
        const loadedEntries: HandlersSalesEntry[] = data.map(item => ({
          field_id: item.field_id.toString(),
          handlers_sales_percentage: item.handlers_sales_percentage || 0,
          department_role: item.department_role === 'Handlers' ? 'Handlers' : 'Sales'
        }));
        setEntries(loadedEntries);
      } else {
        setEntries([{ field_id: '', handlers_sales_percentage: 0, department_role: 'Handlers' }]);
      }
    } catch (error) {
      console.error('Error loading entries:', error);
      toast.error('Failed to load existing entries');
      setEntries([{ field_id: '', handlers_sales_percentage: 0, department_role: 'Handlers' }]);
    } finally {
      setLoading(false);
    }
  };

  const addEntry = () => {
    setEntries([...entries, { field_id: '', handlers_sales_percentage: 0, department_role: 'Handlers' }]);
  };

  const removeEntry = (index: number) => {
    setEntries(entries.filter((_, i) => i !== index));
  };

  const updateEntry = (index: number, updates: Partial<HandlersSalesEntry>) => {
    const newEntries = [...entries];
    newEntries[index] = { ...newEntries[index], ...updates };
    setEntries(newEntries);
  };

  const handleSave = async () => {
    if (!selectedEmployeeId) {
      toast.error('Please select an employee');
      return;
    }

    const employeeId = parseInt(selectedEmployeeId);
    if (!employeeId) {
      toast.error('Invalid employee ID');
      return;
    }

    // Validate entries
    for (const entry of entries) {
      if (!entry.field_id) {
        toast.error('Please select a field for all entries');
        return;
      }
      if (entry.handlers_sales_percentage < 0 || entry.handlers_sales_percentage > 100) {
        toast.error('Percentage must be between 0 and 100');
        return;
      }
    }

    setSaving(true);
    try {
      // Delete existing handlers_sales_contributions records for this employee
      const { error: deleteError } = await supabase
        .from('employee_handlers_sales_contributions')
        .delete()
        .eq('employee_id', employeeId);

      if (deleteError) throw deleteError;

      // Insert new records
      const recordsToInsert = entries
        .filter(entry => entry.field_id)
        .map(entry => ({
          employee_id: employeeId,
          field_id: parseInt(entry.field_id),
          handlers_sales_percentage: entry.handlers_sales_percentage,
          department_role: entry.department_role,
          is_active: true
        }));

      if (recordsToInsert.length > 0) {
        const { error: insertError } = await supabase
          .from('employee_handlers_sales_contributions')
          .insert(recordsToInsert);

        if (insertError) throw insertError;
      }

      toast.success('Handlers/Sales percentages saved successfully');
      onClose();
    } catch (error: any) {
      console.error('Error saving:', error);
      toast.error(error.message || 'Failed to save entries');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  const filteredFields = (index: number) => {
    const searchTerm = fieldSearchTerms[index]?.toLowerCase() || '';
    if (!searchTerm) return fields;
    return fields.filter(field => field.label.toLowerCase().includes(searchTerm));
  };

  const filteredEmployees = () => {
    const searchTerm = employeeSearchTerm.toLowerCase();
    if (!searchTerm) return employees;
    return employees.filter(emp => emp.label.toLowerCase().includes(searchTerm));
  };

  return (
    <div className="modal modal-open">
      <div className="modal-box w-[95vw] max-w-7xl max-h-[95vh] overflow-visible">
        <div className="max-h-[85vh] overflow-y-auto">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-2xl font-bold">
              Manage Handlers/Sales Percentage
              {selectedEmployeeName && ` - ${selectedEmployeeName}`}
            </h3>
            <button className="btn btn-sm btn-circle" onClick={onClose}>
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>

          <div className="mb-4">
            <p className="text-sm text-base-content/70 mb-4">
              Add fixed contribution percentages for Handlers or Sales role per field.
            </p>
          </div>

          {/* Employee Selection */}
          <div className="mb-6">
            <label className="label">
              <span className="label-text font-semibold">Select Employee</span>
            </label>
            <div className="relative">
              <input
                type="text"
                className="input input-bordered w-full"
                placeholder="Search employee..."
                value={employeeSearchTerm || (selectedEmployeeId ? employees.find(e => e.value === selectedEmployeeId)?.label : '')}
                onChange={(e) => {
                  setEmployeeSearchTerm(e.target.value);
                  setShowEmployeeDropdown(true);
                }}
                onFocus={() => setShowEmployeeDropdown(true)}
                onBlur={() => {
                  // Delay to allow dropdown click to register
                  setTimeout(() => setShowEmployeeDropdown(false), 200);
                }}
              />
              {showEmployeeDropdown && (
                <div className="absolute z-[10000] w-full mt-1 bg-base-100 border border-base-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                  {filteredEmployees().length > 0 ? (
                    filteredEmployees().map((employee) => (
                      <div
                        key={employee.value}
                        className="p-2 hover:bg-base-200 cursor-pointer"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setSelectedEmployeeId(employee.value);
                          setSelectedEmployeeName(employee.label);
                          setEmployeeSearchTerm('');
                          setShowEmployeeDropdown(false);
                        }}
                      >
                        {employee.label}
                      </div>
                    ))
                  ) : (
                    <div className="p-2 text-sm text-base-content/70">No employees found</div>
                  )}
                </div>
              )}
            </div>
          </div>

          {!selectedEmployeeId ? (
            <div className="text-center py-8 text-base-content/70">
              Please select an employee to continue
            </div>
          ) : loading ? (
            <div className="flex justify-center py-8">
              <span className="loading loading-spinner loading-lg"></span>
            </div>
          ) : (
            <>
              <div className="space-y-4 max-h-[65vh] overflow-y-auto">
                {entries.map((entry, index) => (
                  <div key={index} className="border border-base-300 rounded-lg p-4">
                    <div className="flex items-center gap-4">
                      <div className="flex-1">
                        <label className="label">
                          <span className="label-text">Field</span>
                        </label>
                        <div className="relative">
                          <input
                            type="text"
                            className="input input-bordered w-full"
                            placeholder="Search field..."
                            value={fieldSearchTerms[index] || ''}
                            onChange={(e) => {
                              setFieldSearchTerms({ ...fieldSearchTerms, [index]: e.target.value });
                              setShowFieldDropdowns({ ...showFieldDropdowns, [index]: true });
                            }}
                            onFocus={() => setShowFieldDropdowns({ ...showFieldDropdowns, [index]: true })}
                            onBlur={() => {
                              setTimeout(() => {
                                setShowFieldDropdowns({ ...showFieldDropdowns, [index]: false });
                              }, 200);
                            }}
                          />
                          {showFieldDropdowns[index] && (
                            <div className="absolute z-[10000] w-full mt-1 bg-base-100 border border-base-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                              {filteredFields(index).length > 0 ? (
                                filteredFields(index).map((field) => (
                                  <div
                                    key={field.value}
                                    className="p-2 hover:bg-base-200 cursor-pointer"
                                    onMouseDown={(e) => {
                                      e.preventDefault();
                                      updateEntry(index, { field_id: field.value });
                                      setFieldSearchTerms({ ...fieldSearchTerms, [index]: '' });
                                      setShowFieldDropdowns({ ...showFieldDropdowns, [index]: false });
                                    }}
                                  >
                                    {field.label}
                                  </div>
                                ))
                              ) : (
                                <div className="p-2 text-sm text-base-content/70">No fields found</div>
                              )}
                            </div>
                          )}
                        </div>
                        {entry.field_id && (
                          <div className="mt-1 text-sm text-base-content/70">
                            Selected: {fields.find(f => f.value === entry.field_id)?.label}
                          </div>
                        )}
                      </div>

                      <div className="w-48">
                        <label className="label">
                          <span className="label-text">Department Role</span>
                        </label>
                        <select
                          className="select select-bordered w-full"
                          value={entry.department_role}
                          onChange={(e) => updateEntry(index, { department_role: e.target.value as 'Handlers' | 'Sales' })}
                        >
                          <option value="Handlers">Handlers</option>
                          <option value="Sales">Sales</option>
                        </select>
                      </div>

                      <div className="w-32">
                        <label className="label">
                          <span className="label-text">Percentage</span>
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            className="input input-bordered w-full"
                            min="0"
                            max="100"
                            step="0.01"
                            value={entry.handlers_sales_percentage}
                            onChange={(e) => updateEntry(index, { handlers_sales_percentage: parseFloat(e.target.value) || 0 })}
                          />
                          <span className="text-sm">%</span>
                        </div>
                      </div>

                      <button
                        className="btn btn-ghost btn-sm mt-8"
                        onClick={() => removeEntry(index)}
                      >
                        <TrashIcon className="w-5 h-5 text-error" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <button
                className="btn btn-outline btn-sm mt-4"
                onClick={addEntry}
              >
                <PlusIcon className="w-4 h-4 mr-2" />
                Add Entry
              </button>
            </>
          )}

          <div className="modal-action">
            <button className="btn" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving || !selectedEmployeeId}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
      <div className="modal-backdrop" onClick={onClose}></div>
    </div>
  );
};

export default HandlersSalesPercentageModal;
