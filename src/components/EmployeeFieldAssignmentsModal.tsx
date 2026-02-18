import React, { useState, useEffect } from 'react';
import { XMarkIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';
import { toast } from 'react-hot-toast';

interface FieldAssignment {
    field_id: number;
    field_name: string;
    field_percentage: number;
    department_role: string;
}

interface HandlersSalesEntry {
    field_id: number;
    field_name: string;
    handlers_sales_percentage: number;
    department_role: 'Handlers' | 'Sales';
}

interface EmployeeFieldAssignmentsModalProps {
    isOpen: boolean;
    onClose: () => void;
    employeeId: number;
    employeeName: string;
    employeePhotoUrl?: string;
    onSave?: () => void;
}

const departmentRoleOptions = [
    { value: 'Sales', label: 'Sales' },
    { value: 'Handlers', label: 'Handlers' },
    { value: 'Partners', label: 'Partners' },
    { value: 'Marketing', label: 'Marketing' },
    { value: 'Finance', label: 'Finance' }
];

const EmployeeFieldAssignmentsModal: React.FC<EmployeeFieldAssignmentsModalProps> = ({
    isOpen,
    onClose,
    employeeId,
    employeeName,
    employeePhotoUrl,
    onSave
}) => {
    const [fields, setFields] = useState<Array<{ id: number; name: string }>>([]);
    const [fieldAssignments, setFieldAssignments] = useState<Map<string, FieldAssignment[]>>(new Map());
    const [handlersSalesEntries, setHandlersSalesEntries] = useState<Map<string, HandlersSalesEntry[]>>(new Map());
    const [hasHandlersSalesData, setHasHandlersSalesData] = useState<Map<string, boolean>>(new Map());
    const [availableRoles, setAvailableRoles] = useState<string[]>([]);
    const [selectedRole, setSelectedRole] = useState<string>('Sales');
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    // Initialize maps for all roles
    useEffect(() => {
        if (isOpen) {
            const initialFieldAssignments = new Map<string, FieldAssignment[]>();
            const initialHandlersSalesEntries = new Map<string, HandlersSalesEntry[]>();
            const initialHasHandlersSalesData = new Map<string, boolean>();
            
            departmentRoleOptions.forEach(role => {
                initialFieldAssignments.set(role.value, []);
                initialHandlersSalesEntries.set(role.value, []);
                initialHasHandlersSalesData.set(role.value, false);
            });
            
            setFieldAssignments(initialFieldAssignments);
            setHandlersSalesEntries(initialHandlersSalesEntries);
            setHasHandlersSalesData(initialHasHandlersSalesData);
            setAvailableRoles([]);
            setSelectedRole('Sales');
        }
    }, [isOpen]);

    useEffect(() => {
        if (isOpen) {
            fetchFields();
            fetchEmployeeAssignments();
        }
    }, [isOpen, employeeId]);

    const fetchFields = async () => {
        try {
            const { data, error } = await supabase
                .from('misc_maincategory')
                .select('id, name')
                .order('name');

            if (error) throw error;
            setFields(data || []);
        } catch (error: any) {
            console.error('Error fetching fields:', error);
            toast.error('Failed to load fields');
        }
    };

    const fetchEmployeeAssignments = async () => {
        setIsLoading(true);
        try {
            // Fetch from first table (employee_field_assignments)
            const { data: assignments, error: assignmentsError } = await supabase
                .from('employee_field_assignments')
                .select(`
                    field_id,
                    field_percentage,
                    department_role,
                    misc_maincategory!inner(name)
                `)
                .eq('employee_id', employeeId)
                .eq('is_active', true);

            if (assignmentsError) throw assignmentsError;

            // Group by role
            const fieldAssignmentsMap = new Map<string, FieldAssignment[]>();
            departmentRoleOptions.forEach(role => {
                fieldAssignmentsMap.set(role.value, []);
            });

            assignments?.forEach((assignment: any) => {
                const role = assignment.department_role;
                if (role && fieldAssignmentsMap.has(role)) {
                    const fieldId = assignment.field_id;
                    const fieldName = assignment.misc_maincategory?.name || '';
                    const percentage = Number(assignment.field_percentage) || 0;

                    const existing = fieldAssignmentsMap.get(role)!;
                    const existingIndex = existing.findIndex(f => f.field_id === fieldId);
                    
                    if (existingIndex >= 0) {
                        // Update if percentage is higher
                        if (percentage > existing[existingIndex].field_percentage) {
                            existing[existingIndex].field_percentage = percentage;
                        }
                    } else {
                        existing.push({
                            field_id: fieldId,
                            field_name: fieldName,
                            field_percentage: percentage,
                            department_role: role
                        });
                    }
                }
            });

            setFieldAssignments(fieldAssignmentsMap);

            // Fetch from second table (employee_handlers_sales_contributions)
            const { data: contributions, error: contributionsError } = await supabase
                .from('employee_handlers_sales_contributions')
                .select(`
                    field_id,
                    handlers_sales_percentage,
                    department_role,
                    misc_maincategory!inner(name)
                `)
                .eq('employee_id', employeeId)
                .eq('is_active', true);

            if (contributionsError) throw contributionsError;

            // Group by role
            const handlersSalesMap = new Map<string, HandlersSalesEntry[]>();
            const hasDataMap = new Map<string, boolean>();
            
            departmentRoleOptions.forEach(role => {
                handlersSalesMap.set(role.value, []);
                hasDataMap.set(role.value, false);
            });

            contributions?.forEach((contribution: any) => {
                const role = contribution.department_role;
                if (role && (role === 'Handlers' || role === 'Sales')) {
                    const fieldId = contribution.field_id;
                    const fieldName = contribution.misc_maincategory?.name || '';
                    const percentage = Number(contribution.handlers_sales_percentage) || 0;

                    const existing = handlersSalesMap.get(role)!;
                    const existingIndex = existing.findIndex(f => f.field_id === fieldId);
                    
                    if (existingIndex >= 0) {
                        // Update if percentage is higher
                        if (percentage > existing[existingIndex].handlers_sales_percentage) {
                            existing[existingIndex].handlers_sales_percentage = percentage;
                        }
                    } else {
                        existing.push({
                            field_id: fieldId,
                            field_name: fieldName,
                            handlers_sales_percentage: percentage,
                            department_role: role as 'Handlers' | 'Sales'
                        });
                    }
                    hasDataMap.set(role, true);
                }
            });

            setHandlersSalesEntries(handlersSalesMap);
            setHasHandlersSalesData(hasDataMap);

            // Determine which roles have data (either in fieldAssignments or handlersSalesEntries)
            const rolesWithData = new Set<string>();
            fieldAssignmentsMap.forEach((assignments, role) => {
                if (assignments.length > 0) {
                    rolesWithData.add(role);
                }
            });
            handlersSalesMap.forEach((entries, role) => {
                if (entries.length > 0) {
                    rolesWithData.add(role);
                }
            });

            const availableRolesList = Array.from(rolesWithData).sort((a, b) => {
                // Sort in the order of departmentRoleOptions
                const indexA = departmentRoleOptions.findIndex(r => r.value === a);
                const indexB = departmentRoleOptions.findIndex(r => r.value === b);
                if (indexA === -1) return 1;
                if (indexB === -1) return -1;
                return indexA - indexB;
            });

            setAvailableRoles(availableRolesList);

            // Update selectedRole to first available role if current selection doesn't have data
            if (availableRolesList.length > 0) {
                if (!rolesWithData.has(selectedRole)) {
                    setSelectedRole(availableRolesList[0]);
                }
            } else {
                // No roles available, reset selectedRole
                setSelectedRole('Sales');
            }
        } catch (error: any) {
            console.error('Error fetching employee assignments:', error);
            toast.error('Failed to load employee assignments');
        } finally {
            setIsLoading(false);
        }
    };

    const handleAddField = () => {
        const currentAssignments = fieldAssignments.get(selectedRole) || [];
        const newAssignments = [...currentAssignments, { 
            field_id: 0, 
            field_name: '', 
            field_percentage: 0,
            department_role: selectedRole
        }];
        setFieldAssignments(new Map(fieldAssignments.set(selectedRole, newAssignments)));
        
        // Add role to availableRoles if not already present
        if (!availableRoles.includes(selectedRole)) {
            const updatedRoles = [...availableRoles, selectedRole].sort((a, b) => {
                const indexA = departmentRoleOptions.findIndex(r => r.value === a);
                const indexB = departmentRoleOptions.findIndex(r => r.value === b);
                if (indexA === -1) return 1;
                if (indexB === -1) return -1;
                return indexA - indexB;
            });
            setAvailableRoles(updatedRoles);
        }
        
    };

    const handleRemoveField = (index: number) => {
        const currentAssignments = fieldAssignments.get(selectedRole) || [];
        const newAssignments = currentAssignments.filter((_, i) => i !== index);
        setFieldAssignments(new Map(fieldAssignments.set(selectedRole, newAssignments)));
        
        // Remove role from availableRoles if no data left
        const handlersSalesForRole = handlersSalesEntries.get(selectedRole) || [];
        if (newAssignments.length === 0 && handlersSalesForRole.length === 0) {
            const updatedRoles = availableRoles.filter(r => r !== selectedRole);
            setAvailableRoles(updatedRoles);
            // Switch to first available role if current role is removed
            if (updatedRoles.length > 0) {
                setSelectedRole(updatedRoles[0]);
            }
        }
    };

    const handleFieldChange = (index: number, fieldId: number) => {
        const field = fields.find(f => f.id === fieldId);
        const currentAssignments = fieldAssignments.get(selectedRole) || [];
        const newAssignments = [...currentAssignments];
        newAssignments[index] = {
            ...newAssignments[index],
            field_id: fieldId,
            field_name: field?.name || ''
        };
        setFieldAssignments(new Map(fieldAssignments.set(selectedRole, newAssignments)));
    };

    const handlePercentageChange = (index: number, percentage: number) => {
        const currentAssignments = fieldAssignments.get(selectedRole) || [];
        const newAssignments = [...currentAssignments];
        newAssignments[index].field_percentage = Math.max(0, Math.min(100, percentage));
        setFieldAssignments(new Map(fieldAssignments.set(selectedRole, newAssignments)));
    };

    const handleAddHandlersSales = () => {
        const currentEntries = handlersSalesEntries.get(selectedRole) || [];
        const newEntries = [...currentEntries, { 
            field_id: 0, 
            field_name: '', 
            handlers_sales_percentage: 0,
            department_role: (selectedRole === 'Handlers' || selectedRole === 'Sales') ? selectedRole as 'Handlers' | 'Sales' : 'Handlers'
        }];
        setHandlersSalesEntries(new Map(handlersSalesEntries.set(selectedRole, newEntries)));
        setHasHandlersSalesData(new Map(hasHandlersSalesData.set(selectedRole, true)));
        
        // Add role to availableRoles if not already present
        if (!availableRoles.includes(selectedRole)) {
            const updatedRoles = [...availableRoles, selectedRole].sort((a, b) => {
                const indexA = departmentRoleOptions.findIndex(r => r.value === a);
                const indexB = departmentRoleOptions.findIndex(r => r.value === b);
                if (indexA === -1) return 1;
                if (indexB === -1) return -1;
                return indexA - indexB;
            });
            setAvailableRoles(updatedRoles);
        }
        
    };

    const handleRemoveHandlersSales = (index: number) => {
        const currentEntries = handlersSalesEntries.get(selectedRole) || [];
        const newEntries = currentEntries.filter((_, i) => i !== index);
        setHandlersSalesEntries(new Map(handlersSalesEntries.set(selectedRole, newEntries)));
        if (newEntries.length === 0) {
            setHasHandlersSalesData(new Map(hasHandlersSalesData.set(selectedRole, false)));
        }
        
        // Remove role from availableRoles if no data left
        const fieldAssignmentsForRole = fieldAssignments.get(selectedRole) || [];
        if (newEntries.length === 0 && fieldAssignmentsForRole.length === 0) {
            const updatedRoles = availableRoles.filter(r => r !== selectedRole);
            setAvailableRoles(updatedRoles);
            // Switch to first available role if current role is removed
            if (updatedRoles.length > 0) {
                setSelectedRole(updatedRoles[0]);
            }
        }
    };

    const handleHandlersSalesFieldChange = (index: number, fieldId: number) => {
        const field = fields.find(f => f.id === fieldId);
        const currentEntries = handlersSalesEntries.get(selectedRole) || [];
        const newEntries = [...currentEntries];
        newEntries[index] = {
            ...newEntries[index],
            field_id: fieldId,
            field_name: field?.name || ''
        };
        setHandlersSalesEntries(new Map(handlersSalesEntries.set(selectedRole, newEntries)));
    };

    const handleHandlersSalesPercentageChange = (index: number, percentage: number) => {
        const currentEntries = handlersSalesEntries.get(selectedRole) || [];
        const newEntries = [...currentEntries];
        newEntries[index].handlers_sales_percentage = Math.max(0, Math.min(100, percentage));
        setHandlersSalesEntries(new Map(handlersSalesEntries.set(selectedRole, newEntries)));
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            // Save first table (employee_field_assignments)
            // Delete all existing assignments for this employee
            const { error: deleteError } = await supabase
                .from('employee_field_assignments')
                .delete()
                .eq('employee_id', employeeId);

            if (deleteError) throw deleteError;

            // Insert new records from all roles
            const recordsToInsert: any[] = [];
            fieldAssignments.forEach((assignments, role) => {
                assignments.forEach(assignment => {
                    if (assignment.field_id > 0) {
                        recordsToInsert.push({
                            employee_id: employeeId,
                            field_id: assignment.field_id,
                            field_percentage: assignment.field_percentage,
                            department_role: role,
                            is_active: true
                        });
                    }
                });
            });

            if (recordsToInsert.length > 0) {
                const { error: insertError } = await supabase
                    .from('employee_field_assignments')
                    .insert(recordsToInsert);

                if (insertError) throw insertError;
            }

            // Save second table (employee_handlers_sales_contributions)
            // Delete all existing contributions for this employee
            const { error: deleteContributionsError } = await supabase
                .from('employee_handlers_sales_contributions')
                .delete()
                .eq('employee_id', employeeId);

            if (deleteContributionsError) throw deleteContributionsError;

            // Insert new records from all roles
            const contributionsToInsert: any[] = [];
            handlersSalesEntries.forEach((entries, role) => {
                entries.forEach(entry => {
                    if (entry.field_id > 0 && (role === 'Handlers' || role === 'Sales')) {
                        contributionsToInsert.push({
                            employee_id: employeeId,
                            field_id: entry.field_id,
                            handlers_sales_percentage: entry.handlers_sales_percentage,
                            department_role: role,
                            is_active: true
                        });
                    }
                });
            });

            if (contributionsToInsert.length > 0) {
                const { error: insertContributionsError } = await supabase
                    .from('employee_handlers_sales_contributions')
                    .insert(contributionsToInsert);

                if (insertContributionsError) throw insertContributionsError;
            }

            toast.success('Employee assignments updated successfully');
            onSave?.();
            onClose();
        } catch (error: any) {
            console.error('Error saving assignments:', error);
            toast.error('Failed to save assignments');
        } finally {
            setIsSaving(false);
        }
    };

    if (!isOpen) return null;

    const currentFieldAssignments = fieldAssignments.get(selectedRole) || [];
    const currentHandlersSalesEntries = handlersSalesEntries.get(selectedRole) || [];
    
    // Show Field % tab only if current role has field assignments
    const showFieldTab = currentFieldAssignments.length > 0;
    
    // Show Other % tab only if current role has handlers/sales entries AND role is Handlers or Sales
    const showOtherTab = currentHandlersSalesEntries.length > 0 && (selectedRole === 'Handlers' || selectedRole === 'Sales');
    

    return (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black bg-opacity-50">
            <div className="bg-base-100 rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b">
                    <div className="flex items-center gap-4">
                        {employeePhotoUrl ? (
                            <img
                                src={employeePhotoUrl}
                                alt={employeeName}
                                className="w-16 h-16 rounded-full object-cover"
                            />
                        ) : (
                            <div className="w-16 h-16 rounded-full bg-green-100 text-green-700 font-semibold flex items-center justify-center text-lg">
                                {employeeName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                            </div>
                        )}
                        <div>
                            <h2 className="text-lg font-semibold">{employeeName}</h2>
                            <p className="text-sm text-gray-500">Edit Field Assignments</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="btn btn-ghost btn-sm btn-circle"
                    >
                        <XMarkIcon className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto flex flex-col">
                    {/* Role Tabs - Only show roles with data */}
                    {availableRoles.length > 0 && (
                        <div className="border-b">
                            <div className="flex gap-2 p-2 overflow-x-auto">
                                {availableRoles.map(roleValue => {
                                    const roleOption = departmentRoleOptions.find(r => r.value === roleValue);
                                    if (!roleOption) return null;
                                    return (
                                        <button
                                            key={roleValue}
                                            onClick={() => {
                                                setSelectedRole(roleValue);
                                            }}
                                            className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap transition-colors ${
                                                selectedRole === roleValue
                                                    ? 'bg-primary text-primary-content'
                                                    : 'bg-base-200 text-base-content hover:bg-base-300'
                                            }`}
                                        >
                                            {roleOption.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {isLoading ? (
                        <div className="flex items-center justify-center py-8">
                            <span className="loading loading-spinner loading-md"></span>
                            <span className="ml-2">Loading assignments...</span>
                        </div>
                    ) : availableRoles.length === 0 ? (
                        <div className="p-4 text-center text-gray-500">
                            No role assignments found for this employee.
                        </div>
                    ) : (
                        <>
                            {/* Content - Show both sections directly without tabs */}
                            <div className="flex-1 overflow-y-auto p-4 space-y-6">
                                {!showFieldTab && !showOtherTab ? (
                                    <div className="text-center py-8 text-gray-500">
                                        No assignments found for {departmentRoleOptions.find(r => r.value === selectedRole)?.label || selectedRole} role.
                                    </div>
                                ) : (
                                    <>
                                        {/* Field % Section */}
                                        {showFieldTab && (
                                            <div className="space-y-4">
                                                <div className="flex items-center justify-between">
                                                    <label className="label">
                                                        <span className="label-text font-semibold">Field Assignments ({selectedRole})</span>
                                                    </label>
                                                    <button
                                                        onClick={handleAddField}
                                                        className="btn btn-sm btn-primary"
                                                    >
                                                        <PlusIcon className="w-4 h-4 mr-1" />
                                                        Add Field
                                                    </button>
                                                </div>

                                                <div className="space-y-3">
                                                    {currentFieldAssignments.map((assignment, index) => (
                                                        <div key={index} className="flex items-center gap-3 p-3 rounded-lg border border-base-300">
                                                            <div className="flex-1">
                                                                {assignment.field_id > 0 ? (
                                                                    <div className="text-sm font-medium py-2">
                                                                        {assignment.field_name || fields.find(f => f.id === assignment.field_id)?.name || 'Unknown Field'}
                                                                    </div>
                                                                ) : (
                                                                    <select
                                                                        className="select select-bordered select-sm w-full"
                                                                        value={assignment.field_id}
                                                                        onChange={(e) => handleFieldChange(index, parseInt(e.target.value))}
                                                                    >
                                                                        <option value={0}>Select Field</option>
                                                                        {fields.map(field => (
                                                                            <option key={field.id} value={field.id}>
                                                                                {field.name}
                                                                            </option>
                                                                        ))}
                                                                    </select>
                                                                )}
                                                            </div>
                                                            <div className="w-32 flex items-center gap-1">
                                                                <input
                                                                    type="number"
                                                                    className="input input-bordered input-sm w-full"
                                                                    min="0"
                                                                    max="100"
                                                                    step="0.01"
                                                                    value={assignment.field_percentage}
                                                                    onChange={(e) => handlePercentageChange(index, parseFloat(e.target.value) || 0)}
                                                                    placeholder="0"
                                                                />
                                                                <span className="text-base font-medium text-gray-700">%</span>
                                                            </div>
                                                            {currentFieldAssignments.length > 1 && (
                                                                <button
                                                                    onClick={() => handleRemoveField(index)}
                                                                    className="btn btn-ghost btn-sm btn-circle"
                                                                >
                                                                    <TrashIcon className="w-4 h-4 text-red-500" />
                                                                </button>
                                                            )}
                                                        </div>
                                                    ))}

                                                    {currentFieldAssignments.length === 0 && (
                                                        <div className="text-center py-8 text-gray-500">
                                                            No field assignments. Click "Add Field" to add one.
                                                        </div>
                                                    )}

                                                    {currentFieldAssignments.length > 0 && (
                                                        <div className="text-right text-base font-medium text-gray-700 mt-2">
                                                            Total: {currentFieldAssignments.reduce((sum, f) => sum + f.field_percentage, 0).toFixed(2)}%
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        )}

                                        {/* Other % Section */}
                                        {showOtherTab && (
                                            <div className="space-y-4">
                                                <div className="flex items-center justify-between">
                                                    <label className="label">
                                                        <span className="label-text font-semibold">Handlers/Sales Contributions ({selectedRole})</span>
                                                    </label>
                                                    {(selectedRole === 'Handlers' || selectedRole === 'Sales') && (
                                                        <button
                                                            onClick={handleAddHandlersSales}
                                                            className="btn btn-sm btn-primary"
                                                        >
                                                            <PlusIcon className="w-4 h-4 mr-1" />
                                                            Add Entry
                                                        </button>
                                                    )}
                                                </div>

                                                {selectedRole !== 'Handlers' && selectedRole !== 'Sales' ? (
                                                    <div className="text-center py-8 text-gray-500">
                                                        Handlers/Sales contributions are only available for Handlers and Sales roles.
                                                    </div>
                                                ) : (
                                                    <div className="space-y-3">
                                                        {currentHandlersSalesEntries.map((entry, index) => (
                                                            <div key={index} className="flex items-center gap-3 p-3 rounded-lg border border-base-300">
                                                                <div className="flex-1">
                                                                    {entry.field_id > 0 ? (
                                                                        <div className="text-sm font-medium py-2">
                                                                            {entry.field_name || fields.find(f => f.id === entry.field_id)?.name || 'Unknown Field'}
                                                                        </div>
                                                                    ) : (
                                                                        <select
                                                                            className="select select-bordered select-sm w-full"
                                                                            value={entry.field_id}
                                                                            onChange={(e) => handleHandlersSalesFieldChange(index, parseInt(e.target.value))}
                                                                        >
                                                                            <option value={0}>Select Field</option>
                                                                            {fields.map(field => (
                                                                                <option key={field.id} value={field.id}>
                                                                                    {field.name}
                                                                                </option>
                                                                            ))}
                                                                        </select>
                                                                    )}
                                                                </div>
                                                                <div className="w-32 flex items-center gap-1">
                                                                    <input
                                                                        type="number"
                                                                        className="input input-bordered input-sm w-full"
                                                                        min="0"
                                                                        max="100"
                                                                        step="0.01"
                                                                        value={entry.handlers_sales_percentage}
                                                                        onChange={(e) => handleHandlersSalesPercentageChange(index, parseFloat(e.target.value) || 0)}
                                                                        placeholder="0"
                                                                    />
                                                                    <span className="text-base font-medium text-gray-700">%</span>
                                                                </div>
                                                                {currentHandlersSalesEntries.length > 1 && (
                                                                    <button
                                                                        onClick={() => handleRemoveHandlersSales(index)}
                                                                        className="btn btn-ghost btn-sm btn-circle"
                                                                    >
                                                                        <TrashIcon className="w-4 h-4 text-red-500" />
                                                                    </button>
                                                                )}
                                                            </div>
                                                        ))}

                                                        {currentHandlersSalesEntries.length === 0 && (
                                                            <div className="text-center py-8 text-gray-500">
                                                                No contributions. Click "Add Entry" to add one.
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        </>
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-2 p-4 border-t">
                    <button
                        onClick={onClose}
                        className="btn btn-ghost"
                        disabled={isSaving}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        className="btn btn-primary"
                        disabled={isSaving || isLoading}
                    >
                        {isSaving ? (
                            <>
                                <span className="loading loading-spinner loading-sm"></span>
                                Saving...
                            </>
                        ) : (
                            'Save Changes'
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default EmployeeFieldAssignmentsModal;
