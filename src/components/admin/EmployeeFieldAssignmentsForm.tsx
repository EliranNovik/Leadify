import React, { useState, useEffect, useMemo } from 'react';
import { PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { supabase } from '../../lib/supabase';
import { toast } from 'react-hot-toast';

interface FieldEntry {
    field_id: string;
    field_percentage: number;
}

interface EmployeeFieldAssignmentsFormProps {
    value: any;
    onChange: (value: any) => void;
    record?: any;
    readOnly?: boolean;
}

const EmployeeFieldAssignmentsForm: React.FC<EmployeeFieldAssignmentsFormProps> = ({
    value,
    onChange,
    record,
    readOnly = false
}) => {
    const [employees, setEmployees] = useState<Array<{ value: string; label: string }>>([]);
    const [fields, setFields] = useState<Array<{ value: string; label: string }>>([]);
    const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>(value?.employee_id || '');
    const [fieldEntries, setFieldEntries] = useState<FieldEntry[]>(
        value?.field_entries || [{ field_id: '', field_percentage: 0 }]
    );
    const [departmentRoles, setDepartmentRoles] = useState<string[]>(value?.department_roles || []);
    const [isActive, setIsActive] = useState<boolean>(value?.is_active !== false);
    const [employeeSearchTerm, setEmployeeSearchTerm] = useState('');
    const [fieldSearchTerms, setFieldSearchTerms] = useState<{ [key: number]: string }>({});
    const [showEmployeeDropdown, setShowEmployeeDropdown] = useState(false);
    const [showFieldDropdowns, setShowFieldDropdowns] = useState<{ [key: number]: boolean }>({});

    const departmentRoleOptions = [
        { value: 'Sales', label: 'Sales' },
        { value: 'Handlers', label: 'Handlers' },
        { value: 'Partners', label: 'Partners' },
        { value: 'Marketing', label: 'Marketing' },
        { value: 'Finance', label: 'Finance' }
    ];

    useEffect(() => {
        const fetchEmployees = async () => {
            try {
                const { data, error } = await supabase
                    .from('tenants_employee')
                    .select('id, display_name')
                    .order('display_name');

                if (error) {
                    console.error('Error fetching employees:', error);
                    toast.error('Failed to load employees');
                } else {
                    const employeeOptions = data?.map(emp => ({
                        value: emp.id.toString(),
                        label: emp.display_name || `Employee #${emp.id}`
                    })) || [];
                    console.log('Loaded employees:', employeeOptions.length);
                    setEmployees(employeeOptions);
                }
            } catch (error) {
                console.error('Error fetching employees:', error);
                toast.error('Failed to load employees');
            }
        };

        const fetchFields = async () => {
            try {
                const { data, error } = await supabase
                    .from('misc_maincategory')
                    .select('id, name')
                    .order('name');

                if (error) {
                    console.error('Error fetching fields:', error);
                } else {
                    const fieldOptions = data?.map(field => ({
                        value: field.id.toString(),
                        label: field.name
                    })) || [];
                    setFields(fieldOptions);
                }
            } catch (error) {
                console.error('Error fetching fields:', error);
            }
        };

        fetchEmployees();
        fetchFields();
    }, []);

    // Initialize from value prop
    useEffect(() => {
        if (value) {
            if (value.employee_id) {
                setSelectedEmployeeId(value.employee_id.toString());
            }
            if (value.field_entries) {
                setFieldEntries(value.field_entries);
            }
            if (value.department_roles) {
                setDepartmentRoles(value.department_roles);
            }
            if (value.is_active !== undefined) {
                setIsActive(value.is_active);
            }
        }
    }, [value]);

    const filteredEmployees = useMemo(() => {
        if (!employeeSearchTerm) {
            return employees;
        }
        const searchLower = employeeSearchTerm.toLowerCase();
        return employees.filter(emp =>
            emp.label.toLowerCase().includes(searchLower)
        );
    }, [employees, employeeSearchTerm]);

    const getFilteredFields = (index: number) => {
        const searchTerm = fieldSearchTerms[index] || '';
        return fields.filter(field =>
            field.label.toLowerCase().includes(searchTerm.toLowerCase())
        );
    };

    const handleEmployeeChange = (employeeId: string) => {
        setSelectedEmployeeId(employeeId);
        updateValue(employeeId, fieldEntries);
    };

    const handleAddField = () => {
        const newEntries = [...fieldEntries, { field_id: '', field_percentage: 0 }];
        setFieldEntries(newEntries);
        updateValue(selectedEmployeeId, newEntries, departmentRoles);
    };

    const handleRemoveField = (index: number) => {
        const newEntries = fieldEntries.filter((_, i) => i !== index);
        setFieldEntries(newEntries);
        updateValue(selectedEmployeeId, newEntries, departmentRoles);
    };

    const handleFieldChange = (index: number, fieldId: string) => {
        const newEntries = [...fieldEntries];
        newEntries[index].field_id = fieldId;
        setFieldEntries(newEntries);
        updateValue(selectedEmployeeId, newEntries, departmentRoles);
    };

    const handlePercentageChange = (index: number, percentage: number) => {
        const newEntries = [...fieldEntries];
        newEntries[index].field_percentage = percentage;
        setFieldEntries(newEntries);
        updateValue(selectedEmployeeId, newEntries, departmentRoles);
    };

    const handleRoleToggle = (role: string) => {
        const newRoles = departmentRoles.includes(role)
            ? departmentRoles.filter(r => r !== role)
            : [...departmentRoles, role];
        setDepartmentRoles(newRoles);
        updateValue(selectedEmployeeId, fieldEntries, newRoles);
    };

    const updateValue = (employeeId: string, entries: FieldEntry[], roles: string[] = departmentRoles, active: boolean = isActive) => {
        onChange({
            employee_id: employeeId,
            field_entries: entries,
            department_roles: roles,
            is_active: active
        });
    };

    const handleActiveChange = (active: boolean) => {
        setIsActive(active);
        updateValue(selectedEmployeeId, fieldEntries, departmentRoles, active);
    };

    const getSelectedEmployeeName = () => {
        const employee = employees.find(emp => emp.value === selectedEmployeeId);
        return employee?.label || '';
    };

    const getSelectedFieldName = (fieldId: string) => {
        const field = fields.find(f => f.value === fieldId);
        return field?.label || '';
    };

    if (readOnly) {
        return (
            <div className="space-y-4">
                <div>
                    <label className="label">
                        <span className="label-text">Employee</span>
                    </label>
                    <div className="text-base-content">{getSelectedEmployeeName() || 'Not selected'}</div>
                </div>
                {fieldEntries.map((entry, index) => (
                    <div key={index} className="border p-4 rounded-lg">
                        <div className="text-base-content font-semibold">{getSelectedFieldName(entry.field_id)}</div>
                        <div className="text-sm text-base-content/70">Percentage: {entry.field_percentage}%</div>
                        <div className="text-sm text-base-content/70">Roles: {entry.department_roles.join(', ') || 'None'}</div>
                    </div>
                ))}
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Employee Selection */}
            <div>
                <label className="label">
                    <span className="label-text">Employee *</span>
                </label>
                <div className="relative">
                    <input
                        type="text"
                        className="input input-bordered w-full"
                        placeholder="Search and select an employee"
                        value={employeeSearchTerm !== '' ? employeeSearchTerm : getSelectedEmployeeName()}
                        onChange={(e) => {
                            const val = e.target.value;
                            setEmployeeSearchTerm(val);
                            setShowEmployeeDropdown(true);
                            // If user clears the input, clear selection
                            if (val === '') {
                                handleEmployeeChange('');
                            }
                        }}
                        onFocus={() => {
                            setShowEmployeeDropdown(true);
                            // When focusing, if there's a selected employee, clear search to show all employees
                            if (selectedEmployeeId) {
                                setEmployeeSearchTerm('');
                            }
                        }}
                        onBlur={(e) => {
                            // Don't close if clicking on dropdown item
                            const relatedTarget = e.relatedTarget as HTMLElement;
                            if (!relatedTarget || !relatedTarget.closest('.employee-dropdown')) {
                                setTimeout(() => {
                                    setShowEmployeeDropdown(false);
                                    // Reset search term to show selected employee name
                                    if (selectedEmployeeId) {
                                        setEmployeeSearchTerm('');
                                    }
                                }, 200);
                            }
                        }}
                    />
                    {showEmployeeDropdown && (
                        <div className="absolute z-[100] w-full mt-1 bg-base-100 border border-base-300 rounded-lg shadow-lg max-h-60 overflow-y-auto employee-dropdown">
                            {employees.length === 0 ? (
                                <div className="px-4 py-2 text-base-content/70 text-sm">Loading employees...</div>
                            ) : filteredEmployees.length > 0 ? (
                                filteredEmployees.map((emp) => (
                                    <button
                                        key={emp.value}
                                        type="button"
                                        className="w-full text-left px-4 py-2 hover:bg-base-200"
                                        onMouseDown={(e) => {
                                            e.preventDefault(); // Prevent input blur
                                            handleEmployeeChange(emp.value);
                                            setEmployeeSearchTerm('');
                                            setShowEmployeeDropdown(false);
                                        }}
                                    >
                                        {emp.label}
                                    </button>
                                ))
                            ) : (
                                <div className="px-4 py-2 text-base-content/70 text-sm">
                                    No employees found matching "{employeeSearchTerm}"
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Field Entries */}
            <div>
                <label className="label">
                    <span className="label-text">Field Assignments *</span>
                </label>
                <div className="space-y-4">
                    {fieldEntries.map((entry, index) => (
                        <div key={index} className="border border-base-300 rounded-lg p-4 space-y-3">
                            <div className="flex items-start justify-between">
                                <div className="flex-1 space-y-3">
                                    {/* Field Selection */}
                                    <div className="relative">
                                        <label className="label py-1">
                                            <span className="label-text text-sm">Field (Category)</span>
                                        </label>
                                        <input
                                            type="text"
                                            className="input input-bordered w-full"
                                            placeholder="Search and select a field"
                                            value={fieldSearchTerms[index] !== undefined && fieldSearchTerms[index] !== ''
                                                ? fieldSearchTerms[index]
                                                : getSelectedFieldName(entry.field_id)}
                                            onChange={(e) => {
                                                const val = e.target.value;
                                                setFieldSearchTerms({ ...fieldSearchTerms, [index]: val });
                                                setShowFieldDropdowns({ ...showFieldDropdowns, [index]: true });
                                                // If user clears the input, clear selection
                                                if (val === '') {
                                                    handleFieldChange(index, '');
                                                }
                                            }}
                                            onFocus={() => {
                                                setShowFieldDropdowns({ ...showFieldDropdowns, [index]: true });
                                                // When focusing, show search term if no field selected, otherwise show selected name
                                                if (!entry.field_id) {
                                                    setFieldSearchTerms({ ...fieldSearchTerms, [index]: '' });
                                                }
                                            }}
                                            onBlur={(e) => {
                                                // Don't close if clicking on dropdown item
                                                const relatedTarget = e.relatedTarget as HTMLElement;
                                                if (!relatedTarget || !relatedTarget.closest('.field-dropdown')) {
                                                    setTimeout(() => {
                                                        setShowFieldDropdowns({ ...showFieldDropdowns, [index]: false });
                                                        // Reset search term to show selected field name
                                                        if (entry.field_id) {
                                                            setFieldSearchTerms({ ...fieldSearchTerms, [index]: '' });
                                                        }
                                                    }, 200);
                                                }
                                            }}
                                        />
                                        {showFieldDropdowns[index] && (
                                            <div className="absolute z-[100] w-full mt-1 bg-base-100 border border-base-300 rounded-lg shadow-lg max-h-60 overflow-y-auto field-dropdown">
                                                {getFilteredFields(index).length > 0 ? (
                                                    getFilteredFields(index).map((field) => (
                                                        <button
                                                            key={field.value}
                                                            type="button"
                                                            className="w-full text-left px-4 py-2 hover:bg-base-200"
                                                            onMouseDown={(e) => {
                                                                e.preventDefault(); // Prevent input blur
                                                                handleFieldChange(index, field.value);
                                                                setFieldSearchTerms({ ...fieldSearchTerms, [index]: '' });
                                                                setShowFieldDropdowns({ ...showFieldDropdowns, [index]: false });
                                                            }}
                                                        >
                                                            {field.label}
                                                        </button>
                                                    ))
                                                ) : (
                                                    <div className="px-4 py-2 text-base-content/70 text-sm">No fields found</div>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    {/* Field Percentage */}
                                    <div>
                                        <label className="label py-1">
                                            <span className="label-text text-sm">Field Percentage (%)</span>
                                        </label>
                                        <input
                                            type="number"
                                            className="input input-bordered w-full"
                                            placeholder="0.00"
                                            min="0"
                                            max="100"
                                            step="0.01"
                                            value={entry.field_percentage}
                                            onChange={(e) => handlePercentageChange(index, parseFloat(e.target.value) || 0)}
                                        />
                                    </div>
                                </div>
                                {fieldEntries.length > 1 && (
                                    <button
                                        type="button"
                                        className="btn btn-ghost btn-sm btn-circle ml-2"
                                        onClick={() => handleRemoveField(index)}
                                    >
                                        <TrashIcon className="w-4 h-4" />
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
                <button
                    type="button"
                    className="btn btn-outline btn-sm mt-2"
                    onClick={handleAddField}
                >
                    <PlusIcon className="w-4 h-4 mr-1" />
                    Add Field
                </button>
            </div>

            {/* Department Roles - Single selection for all fields */}
            <div>
                <label className="label">
                    <span className="label-text">Department Roles</span>
                </label>
                <div className="flex flex-wrap gap-2">
                    {departmentRoleOptions.map((role) => (
                        <label key={role.value} className="cursor-pointer label">
                            <input
                                type="checkbox"
                                className="checkbox checkbox-sm mr-2"
                                checked={departmentRoles.includes(role.value)}
                                onChange={() => handleRoleToggle(role.value)}
                            />
                            <span className="label-text text-sm">{role.label}</span>
                        </label>
                    ))}
                </div>
            </div>

            {/* Active Toggle */}
            <div>
                <label className="label cursor-pointer">
                    <span className="label-text">Active</span>
                    <input
                        type="checkbox"
                        className="checkbox"
                        checked={isActive}
                        onChange={(e) => handleActiveChange(e.target.checked)}
                    />
                </label>
            </div>
        </div>
    );
};

export default EmployeeFieldAssignmentsForm;
