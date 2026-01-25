import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { 
  UserGroupIcon, 
  PlusIcon, 
  TrashIcon, 
  ClockIcon,
  CheckIcon,
  XMarkIcon,
  MagnifyingGlassIcon,
  DocumentArrowUpIcon
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';

interface UnavailabilityReason {
  id: number;
  employee_id: number;
  unavailability_type: 'sick_days' | 'vacation' | 'general';
  start_date: string;
  end_date: string | null;
  start_time?: string | null;
  end_time?: string | null;
  sick_days_reason?: string | null;
  vacation_reason?: string | null;
  general_reason?: string | null;
  document_url?: string | null;
  created_at: string;
}

// Role mapping function to convert role codes to full names
const getRoleDisplayName = (roleCode: string): string => {
  const roleMap: { [key: string]: string } = {
    'pm': 'Project Manager',
    'dev': 'Developer',
    'admin': 'Administrator',
    'manager': 'Manager',
    'closer': 'Closer',
    'scheduler': 'Scheduler',
    'expert': 'Expert',
    'handler': 'Handler',
    'analyst': 'Analyst',
    'coordinator': 'Coordinator',
    'supervisor': 'Supervisor',
    'director': 'Director',
    'lead': 'Team Lead',
    'senior': 'Senior',
    'junior': 'Junior',
    'intern': 'Intern',
    'consultant': 'Consultant',
    'specialist': 'Specialist',
    'assistant': 'Assistant',
    'executive': 'Executive'
  };
  
  return roleMap[roleCode?.toLowerCase()] || roleCode || 'Unknown Role';
};

interface Employee {
  id: string;
  display_name: string;
  bonuses_role?: string;
  department_id?: number;
  photo_url?: string;
  photo?: string;
}

interface UnavailableTime {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  reason: string;
  created_by?: string;
}

interface UnavailableRange {
  id: string;
  startDate: string;
  endDate: string;
  reason: string;
  created_by?: string;
}

const EmployeeAvailabilityManager: React.FC = () => {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [unavailableTimes, setUnavailableTimes] = useState<UnavailableTime[]>([]);
  const [unavailableRanges, setUnavailableRanges] = useState<UnavailableRange[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showAddRangeModal, setShowAddRangeModal] = useState(false);
  const [newUnavailableTime, setNewUnavailableTime] = useState({
    startTime: '09:00',
    endTime: '17:00',
    reason: '',
    unavailabilityType: 'general' as 'sick_days' | 'vacation' | 'general',
    documentFile: null as File | null
  });
  const [newUnavailableRange, setNewUnavailableRange] = useState({
    startDate: '',
    endDate: '',
    reason: '',
    unavailabilityType: 'general' as 'sick_days' | 'vacation' | 'general',
    documentFile: null as File | null
  });
  const [loading, setLoading] = useState(false);
  const [uploadingDocument, setUploadingDocument] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [unavailabilityReasons, setUnavailabilityReasons] = useState<UnavailabilityReason[]>([]);

  // Fetch all employees
  const fetchEmployees = async () => {
    try {
      const { data, error } = await supabase
        .from('tenants_employee')
        .select('id, display_name, bonuses_role, department_id, photo_url, photo')
        .not('display_name', 'is', null)
        .not('id', 'eq', 143) // Exclude employee ID 143
        .order('display_name');

      if (error) {
        console.error('Error fetching employees:', error);
        toast.error('Failed to fetch employees');
        return;
      }

      setEmployees(data || []);
    } catch (error) {
      console.error('Error fetching employees:', error);
      toast.error('Failed to fetch employees');
    }
  };

  // Fetch selected employee's unavailable times
  const fetchEmployeeUnavailableTimes = async (employeeId: string) => {
    try {
      const { data, error } = await supabase
        .from('tenants_employee')
        .select('unavailable_times, unavailable_ranges')
        .eq('id', employeeId)
        .single();

      if (error) {
        console.error('Error fetching employee unavailable times:', error);
        return;
      }

      setUnavailableTimes(data?.unavailable_times || []);
      setUnavailableRanges(data?.unavailable_ranges || []);

      // Fetch from new employee_unavailability_reasons table
      const { data: reasonsData, error: reasonsError } = await supabase
        .from('employee_unavailability_reasons')
        .select('*')
        .eq('employee_id', parseInt(employeeId))
        .order('start_date', { ascending: false });

      if (!reasonsError && reasonsData) {
        setUnavailabilityReasons(reasonsData);
      }
    } catch (error) {
      console.error('Error fetching employee unavailable times:', error);
    }
  };

  // Upload document to storage
  const uploadDocument = async (file: File, employeeId: string): Promise<string | null> => {
    setUploadingDocument(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `employee_${employeeId}_${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
      
      const { data, error } = await supabase.storage
        .from('employee-unavailability-documents')
        .upload(fileName, file, {
          cacheControl: '3600',
          upsert: false,
          contentType: file.type
        });

      if (error) {
        console.error('Error uploading document:', error);
        toast.error('Failed to upload document');
        return null;
      }

      return data.path;
    } catch (error) {
      console.error('Error uploading document:', error);
      toast.error('Failed to upload document');
      return null;
    } finally {
      setUploadingDocument(false);
    }
  };

  // Save unavailable time for selected employee
  const saveUnavailableTime = async () => {
    if (!selectedEmployee || !selectedDate || !newUnavailableTime.reason.trim()) {
      toast.error('Please select an employee, date, and provide a reason');
      return;
    }

    // Check if the selected date is in the past
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (selectedDate < today) {
      toast.error('Cannot add unavailable times for past dates');
      return;
    }

    setLoading(true);
    try {
      // Format date as YYYY-MM-DD
      const year = selectedDate.getFullYear();
      const month = String(selectedDate.getMonth() + 1).padStart(2, '0');
      const day = String(selectedDate.getDate()).padStart(2, '0');
      const dateString = `${year}-${month}-${day}`;

      // For sick_days and vacation, check if there's already an entry for this date and type
      // For general, allow multiple entries on the same day
      if (newUnavailableTime.unavailabilityType !== 'general') {
        const { data: existingReasons, error: checkError } = await supabase
          .from('employee_unavailability_reasons')
          .select('id')
          .eq('employee_id', parseInt(selectedEmployee.id))
          .eq('start_date', dateString)
          .eq('unavailability_type', newUnavailableTime.unavailabilityType);

        if (checkError) {
          console.error('Error checking existing unavailability:', checkError);
          toast.error('Failed to check existing unavailability');
          setLoading(false);
          return;
        }

        if (existingReasons && existingReasons.length > 0) {
          toast.error(`This employee already has a ${newUnavailableTime.unavailabilityType === 'sick_days' ? 'sick day' : 'vacation'} entry for this date`);
          setLoading(false);
          return;
        }
      }

      // Upload document if it's a sick day and document is provided
      let documentUrl: string | null = null;
      if (newUnavailableTime.unavailabilityType === 'sick_days' && newUnavailableTime.documentFile) {
        documentUrl = await uploadDocument(newUnavailableTime.documentFile, selectedEmployee.id);
        if (!documentUrl) {
          setLoading(false);
          return;
        }
      }

      // Prepare reason data based on type
      const reasonData: any = {
        employee_id: parseInt(selectedEmployee.id),
        unavailability_type: newUnavailableTime.unavailabilityType,
        start_date: dateString,
        start_time: newUnavailableTime.startTime,
        end_time: newUnavailableTime.endTime,
      };

      if (newUnavailableTime.unavailabilityType === 'sick_days') {
        reasonData.sick_days_reason = newUnavailableTime.reason;
        if (documentUrl) {
          reasonData.document_url = documentUrl;
        }
      } else if (newUnavailableTime.unavailabilityType === 'vacation') {
        reasonData.vacation_reason = newUnavailableTime.reason;
      } else {
        reasonData.general_reason = newUnavailableTime.reason;
      }

      // Save to new table
      const { error: reasonError } = await supabase
        .from('employee_unavailability_reasons')
        .insert(reasonData);

      if (reasonError) {
        console.error('Error saving unavailability reason:', reasonError);
        toast.error('Failed to save unavailability reason');
        setLoading(false);
        return;
      }

      // Also save to existing unavailable_times for backward compatibility
      const newTime: UnavailableTime = {
        id: Date.now().toString(),
        date: dateString,
        startTime: newUnavailableTime.startTime,
        endTime: newUnavailableTime.endTime,
        reason: newUnavailableTime.reason
      };

      const updatedTimes = [...unavailableTimes, newTime];
      setUnavailableTimes(updatedTimes);

      // Save to database
      const { error } = await supabase
        .from('tenants_employee')
        .update({ 
          unavailable_times: updatedTimes,
          last_sync_date: new Date().toISOString()
        })
        .eq('id', selectedEmployee.id);

      if (error) {
        console.error('Error saving unavailable time:', error);
        toast.error('Failed to save unavailable time');
        return;
      }

      toast.success(`Unavailable time saved for ${selectedEmployee.display_name}`);
      setShowAddModal(false);
      setNewUnavailableTime({ startTime: '09:00', endTime: '17:00', reason: '', unavailabilityType: 'general', documentFile: null });
      fetchEmployeeUnavailableTimes(selectedEmployee.id); // Refresh the list
    } catch (error) {
      console.error('Error saving unavailable time:', error);
      toast.error('Failed to save unavailable time');
    } finally {
      setLoading(false);
    }
  };

  // Save unavailable range for selected employee
  const saveUnavailableRange = async () => {
    if (!selectedEmployee || !newUnavailableRange.startDate || !newUnavailableRange.endDate || !newUnavailableRange.reason.trim()) {
      toast.error('Please select an employee and fill in all fields');
      return;
    }

    // Check if start date is before end date
    if (new Date(newUnavailableRange.startDate) > new Date(newUnavailableRange.endDate)) {
      toast.error('Start date must be before end date');
      return;
    }

    // Check if the start date is in the past
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (new Date(newUnavailableRange.startDate) < today) {
      toast.error('Cannot add unavailable ranges for past dates');
      return;
    }

    setLoading(true);
    try {
      // Upload document if it's a sick day and document is provided
      let documentUrl: string | null = null;
      if (newUnavailableRange.unavailabilityType === 'sick_days' && newUnavailableRange.documentFile) {
        documentUrl = await uploadDocument(newUnavailableRange.documentFile, selectedEmployee.id);
        if (!documentUrl) {
          setLoading(false);
          return;
        }
      }

      // Prepare reason data based on type
      const reasonData: any = {
        employee_id: parseInt(selectedEmployee.id),
        unavailability_type: newUnavailableRange.unavailabilityType,
        start_date: newUnavailableRange.startDate,
        end_date: newUnavailableRange.endDate,
      };

      if (newUnavailableRange.unavailabilityType === 'sick_days') {
        reasonData.sick_days_reason = newUnavailableRange.reason;
        if (documentUrl) {
          reasonData.document_url = documentUrl;
        }
      } else if (newUnavailableRange.unavailabilityType === 'vacation') {
        reasonData.vacation_reason = newUnavailableRange.reason;
      } else {
        reasonData.general_reason = newUnavailableRange.reason;
      }

      // Save to new table
      const { error: reasonError } = await supabase
        .from('employee_unavailability_reasons')
        .insert(reasonData);

      if (reasonError) {
        console.error('Error saving unavailability reason:', reasonError);
        toast.error('Failed to save unavailability reason');
        setLoading(false);
        return;
      }

      // Also save to existing unavailable_ranges for backward compatibility
      const newRange: UnavailableRange = {
        id: Date.now().toString(),
        startDate: newUnavailableRange.startDate,
        endDate: newUnavailableRange.endDate,
        reason: newUnavailableRange.reason
      };

      const updatedRanges = [...unavailableRanges, newRange];
      setUnavailableRanges(updatedRanges);

      // Save to database
      const { error } = await supabase
        .from('tenants_employee')
        .update({ 
          unavailable_ranges: updatedRanges,
          last_sync_date: new Date().toISOString()
        })
        .eq('id', selectedEmployee.id);

      if (error) {
        console.error('Error saving unavailable range:', error);
        toast.error('Failed to save unavailable range');
        return;
      }

      toast.success(`Unavailable range saved for ${selectedEmployee.display_name}`);
      setShowAddRangeModal(false);
      setNewUnavailableRange({ startDate: '', endDate: '', reason: '', unavailabilityType: 'general', documentFile: null });
      fetchEmployeeUnavailableTimes(selectedEmployee.id); // Refresh the list
    } catch (error) {
      console.error('Error saving unavailable range:', error);
      toast.error('Failed to save unavailable range');
    } finally {
      setLoading(false);
    }
  };

  // Delete unavailable time
  const deleteUnavailableTime = async (timeId: string) => {
    if (!selectedEmployee) return;

    setLoading(true);
    try {
      const updatedTimes = unavailableTimes.filter(ut => ut.id !== timeId);
      setUnavailableTimes(updatedTimes);

      const { error } = await supabase
        .from('tenants_employee')
        .update({ 
          unavailable_times: updatedTimes,
          last_sync_date: new Date().toISOString()
        })
        .eq('id', selectedEmployee.id);

      if (error) {
        console.error('Error deleting unavailable time:', error);
        toast.error('Failed to delete unavailable time');
        return;
      }

      toast.success('Unavailable time deleted successfully');
    } catch (error) {
      console.error('Error deleting unavailable time:', error);
      toast.error('Failed to delete unavailable time');
    } finally {
      setLoading(false);
    }
  };

  // Delete unavailable range
  const deleteUnavailableRange = async (rangeId: string) => {
    if (!selectedEmployee) return;

    setLoading(true);
    try {
      const updatedRanges = unavailableRanges.filter(r => r.id !== rangeId);
      setUnavailableRanges(updatedRanges);

      const { error } = await supabase
        .from('tenants_employee')
        .update({ 
          unavailable_ranges: updatedRanges,
          last_sync_date: new Date().toISOString()
        })
        .eq('id', selectedEmployee.id);

      if (error) {
        console.error('Error deleting unavailable range:', error);
        toast.error('Failed to delete unavailable range');
        return;
      }

      toast.success('Unavailable range deleted successfully');
    } catch (error) {
      console.error('Error deleting unavailable range:', error);
      toast.error('Failed to delete unavailable range');
    } finally {
      setLoading(false);
    }
  };

  // Delete unavailability reason from new table
  const deleteUnavailabilityReason = async (reasonId: number) => {
    if (!selectedEmployee) return;

    setLoading(true);
    try {
      const { error } = await supabase
        .from('employee_unavailability_reasons')
        .delete()
        .eq('id', reasonId);

      if (error) {
        console.error('Error deleting unavailability reason:', error);
        toast.error('Failed to delete unavailability');
        return;
      }

      toast.success('Unavailability deleted successfully');
      fetchEmployeeUnavailableTimes(selectedEmployee.id); // Refresh the list
    } catch (error) {
      console.error('Error deleting unavailability reason:', error);
      toast.error('Failed to delete unavailability');
    } finally {
      setLoading(false);
    }
  };

  // Filter employees based on search term
  const filteredEmployees = employees.filter(employee =>
    employee.display_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    employee.department_id?.toString().toLowerCase().includes(searchTerm.toLowerCase())
  );

  useEffect(() => {
    fetchEmployees();
  }, []);

  useEffect(() => {
    if (selectedEmployee) {
      fetchEmployeeUnavailableTimes(selectedEmployee.id);
    }
  }, [selectedEmployee]);

  return (
    <div className="space-y-6">

      {/* Employee Selection */}
      <div className="bg-base-100 rounded-lg p-4">
        <div className="mb-4">
          <label className="label">
            <span className="label-text font-medium">Select Employee</span>
          </label>
          <div className="relative">
            <MagnifyingGlassIcon className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-base-content/50" />
            <input
              type="text"
              placeholder="Search employees by name or department..."
              className="input input-bordered w-full pl-10"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        {searchTerm && (
          <div className="max-h-60 overflow-y-auto border border-base-300 rounded-lg">
            {filteredEmployees.length === 0 ? (
              <div className="p-4 text-center text-base-content/70">
                No employees found matching "{searchTerm}"
              </div>
            ) : (
              <div className="space-y-1 p-2">
                {filteredEmployees.map(employee => (
                  <button
                    key={employee.id}
                    onClick={() => {
                      setSelectedEmployee(employee);
                      setSearchTerm(''); // Clear search term to close dropdown
                    }}
                    className={`w-full text-left p-3 rounded-lg transition-colors ${
                      selectedEmployee?.id === employee.id
                        ? 'bg-primary text-primary-content'
                        : 'hover:bg-base-200'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-sm font-medium">
                        {employee.display_name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="font-medium">{employee.display_name}</div>
                        <div className="text-xs opacity-70">
                          {getRoleDisplayName(employee.bonuses_role || '')}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {selectedEmployee && (
          <div className="mt-4 p-3 bg-primary/10 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center text-lg font-medium">
                {selectedEmployee.display_name.charAt(0).toUpperCase()}
              </div>
              <div>
                <div className="font-medium">{selectedEmployee.display_name}</div>
                <div className="text-sm text-base-content/70">
                  {getRoleDisplayName(selectedEmployee.bonuses_role || '')}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      {selectedEmployee && (
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={() => {
              setSelectedDate(new Date());
              setShowAddModal(true);
            }}
            className="btn btn-primary btn-sm"
            disabled={loading}
          >
            <PlusIcon className="w-4 h-4 mr-2" />
            Add Unavailable Time
          </button>
          <button
            onClick={() => setShowAddRangeModal(true)}
            className="btn btn-primary btn-sm"
            disabled={loading}
          >
            <PlusIcon className="w-4 h-4 mr-2" />
            Add Unavailable Range
          </button>
        </div>
      )}

      {/* Unavailable Times List */}
      {selectedEmployee && (
        <div className="bg-base-100 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-lg font-semibold">Unavailable Times</h4>
            <div className="text-sm text-base-content/70">
              {selectedEmployee.display_name} • {getRoleDisplayName(selectedEmployee.bonuses_role || '')}
            </div>
          </div>
          {unavailableTimes.length === 0 ? (
            <p className="text-base-content/70 text-center py-6">
              No unavailable times set for {selectedEmployee.display_name}
            </p>
          ) : (
            <div className="space-y-2">
              {unavailableTimes
                .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                .map(time => (
                  <div 
                    key={time.id} 
                    className="flex items-center justify-between gap-2 p-3 bg-white rounded-lg"
                    style={{
                      boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05), 0 0 0 1px rgba(0, 0, 0, 0.05), 0 20px 25px -5px rgba(0, 0, 0, 0.1)'
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4">
                        <div className="text-sm font-medium">
                          {new Date(time.date).toLocaleDateString()}
                        </div>
                        <div className="text-xs text-base-content/70">
                          {time.startTime} - {time.endTime}
                        </div>
                      </div>
                      <div className="text-xs text-base-content/80 mt-1 truncate">
                        {time.reason}
                      </div>
                    </div>
                    <button
                      className="btn btn-ghost btn-xs text-error hover:bg-error/10 flex-shrink-0"
                      onClick={() => deleteUnavailableTime(time.id)}
                      disabled={loading}
                    >
                      <TrashIcon className="w-3 h-3" />
                    </button>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {/* Unavailable Ranges List */}
      {selectedEmployee && (
        <div className="bg-base-100 rounded-lg p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-lg font-semibold">Unavailable Ranges</h4>
            <div className="text-sm text-base-content/70">
              {selectedEmployee.display_name} • {getRoleDisplayName(selectedEmployee.bonuses_role || '')}
            </div>
          </div>
          {unavailableRanges.length === 0 ? (
            <p className="text-base-content/70 text-center py-6">
              No unavailable ranges set for {selectedEmployee.display_name}
            </p>
          ) : (
            <div className="space-y-2">
              {unavailableRanges
                .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())
                .map(range => (
                  <div 
                    key={range.id} 
                    className="flex items-center justify-between gap-2 p-3 bg-white rounded-lg"
                    style={{
                      boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05), 0 0 0 1px rgba(0, 0, 0, 0.05), 0 20px 25px -5px rgba(0, 0, 0, 0.1)'
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4">
                        <div className="text-sm font-medium">
                          {new Date(range.startDate).toLocaleDateString()} - {new Date(range.endDate).toLocaleDateString()}
                        </div>
                      </div>
                      <div className="text-xs text-base-content/80 mt-1 truncate">
                        {range.reason}
                      </div>
                    </div>
                    <button
                      className="btn btn-ghost btn-xs text-error hover:bg-error/10 flex-shrink-0"
                      onClick={() => deleteUnavailableRange(range.id)}
                      disabled={loading}
                    >
                      <TrashIcon className="w-3 h-3" />
                    </button>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {/* All Unavailabilities from New Table */}
      {selectedEmployee && (
        <div className="bg-base-100 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-lg font-semibold">All Unavailabilities</h4>
            <div className="text-sm text-base-content/70">
              {selectedEmployee.display_name} • {getRoleDisplayName(selectedEmployee.bonuses_role || '')}
            </div>
          </div>
          {unavailabilityReasons.length === 0 ? (
            <p className="text-base-content/70 text-center py-6">
              No unavailabilities recorded for {selectedEmployee.display_name} yet.
            </p>
          ) : (
            <div className="space-y-2">
              {unavailabilityReasons.map(reason => {
                const getReasonText = () => {
                  if (reason.unavailability_type === 'sick_days') return reason.sick_days_reason || '';
                  if (reason.unavailability_type === 'vacation') return reason.vacation_reason || '';
                  return reason.general_reason || '';
                };

                const getTypeLabel = () => {
                  if (reason.unavailability_type === 'sick_days') return 'Sick day/s';
                  if (reason.unavailability_type === 'vacation') return 'Vacation';
                  return 'General';
                };

                const dateRange = reason.end_date 
                  ? `${new Date(reason.start_date).toLocaleDateString()} - ${new Date(reason.end_date).toLocaleDateString()}`
                  : new Date(reason.start_date).toLocaleDateString();
                
                const timeRange = reason.start_time && reason.end_time 
                  ? `${reason.start_time} - ${reason.end_time}`
                  : '';

                return (
                  <div 
                    key={reason.id} 
                    className="flex items-center justify-between gap-2 p-3 bg-white rounded-lg"
                    style={{
                      boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05), 0 0 0 1px rgba(0, 0, 0, 0.05), 0 20px 25px -5px rgba(0, 0, 0, 0.1)'
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4">
                        <div className="text-sm font-medium">
                          {dateRange}
                          {timeRange && <span className="ml-2 text-xs text-base-content/70">({timeRange})</span>}
                        </div>
                        <div className="badge badge-sm badge-primary">{getTypeLabel()}</div>
                        {reason.document_url && (
                          <div className="flex items-center gap-1 text-xs text-success">
                            <DocumentArrowUpIcon className="w-3 h-3" />
                            <span>Document</span>
                          </div>
                        )}
                      </div>
                      <div className="text-xs text-base-content/80 mt-1 truncate">
                        {getReasonText()}
                      </div>
                    </div>
                    <button
                      className="btn btn-ghost btn-xs text-error hover:bg-error/10 flex-shrink-0"
                      onClick={() => deleteUnavailabilityReason(reason.id)}
                      disabled={loading}
                    >
                      <TrashIcon className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Add Unavailable Time Modal */}
      {showAddModal && selectedDate && selectedEmployee && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-base-100 rounded-xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">Add Unavailable Time</h3>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setShowAddModal(false);
                  setNewUnavailableTime({ startTime: '09:00', endTime: '17:00', reason: '', unavailabilityType: 'general', documentFile: null });
                }}
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            
            <div className="mb-4 p-3 bg-primary/10 rounded-lg">
              <div className="text-sm font-medium">{selectedEmployee.display_name}</div>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="label">
                  <span className="label-text text-sm">Date</span>
                </label>
                <input
                  type="date"
                  className="input input-bordered w-full"
                  value={selectedDate ? selectedDate.toISOString().split('T')[0] : ''}
                  onChange={(e) => {
                    const newDate = e.target.value ? new Date(e.target.value) : null;
                    if (newDate) {
                      setSelectedDate(newDate);
                    }
                  }}
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">
                    <span className="label-text text-sm">Start Time</span>
                  </label>
                  <input
                    type="time"
                    className="input input-bordered w-full"
                    value={newUnavailableTime.startTime}
                    onChange={(e) => setNewUnavailableTime(prev => ({ ...prev, startTime: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label">
                    <span className="label-text text-sm">End Time</span>
                  </label>
                  <input
                    type="time"
                    className="input input-bordered w-full"
                    value={newUnavailableTime.endTime}
                    onChange={(e) => setNewUnavailableTime(prev => ({ ...prev, endTime: e.target.value }))}
                  />
                </div>
              </div>
              
              <div>
                <label className="label">
                  <span className="label-text text-sm">Type</span>
                </label>
                <select
                  className="select select-bordered w-full"
                  value={newUnavailableTime.unavailabilityType}
                  onChange={(e) => setNewUnavailableTime({ 
                    ...newUnavailableTime, 
                    unavailabilityType: e.target.value as 'sick_days' | 'vacation' | 'general',
                    documentFile: e.target.value !== 'sick_days' ? null : newUnavailableTime.documentFile
                  })}
                >
                  <option value="general">General</option>
                  <option value="sick_days">Sick day/s</option>
                  <option value="vacation">Vacation</option>
                </select>
              </div>

              <div>
                <label className="label">
                  <span className="label-text text-sm">Reason</span>
                </label>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  placeholder={newUnavailableTime.unavailabilityType === 'sick_days' ? 'e.g., Flu, Doctor appointment' : newUnavailableTime.unavailabilityType === 'vacation' ? 'e.g., Family vacation' : 'e.g., Personal appointment'}
                  value={newUnavailableTime.reason}
                  onChange={(e) => setNewUnavailableTime(prev => ({ ...prev, reason: e.target.value }))}
                />
              </div>

              {/* Document Upload for Sick Days */}
              {newUnavailableTime.unavailabilityType === 'sick_days' && (
                <div>
                  <label className="label">
                    <span className="label-text text-sm">Doctors Documents</span>
                  </label>
                  <div
                    className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
                      newUnavailableTime.documentFile
                        ? 'border-primary bg-primary/5'
                        : 'border-gray-300 hover:border-primary/50'
                    }`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const file = e.dataTransfer.files[0];
                      if (file) {
                        const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
                        if (allowedTypes.includes(file.type)) {
                          if (file.size <= 10 * 1024 * 1024) { // 10MB
                            setNewUnavailableTime({ ...newUnavailableTime, documentFile: file });
                          } else {
                            toast.error('File size must be less than 10MB');
                          }
                        } else {
                          toast.error('Invalid file type. Please upload images or documents (PDF, Word)');
                        }
                      }
                    }}
                  >
                    {newUnavailableTime.documentFile ? (
                      <div className="space-y-2">
                        <DocumentArrowUpIcon className="w-8 h-8 mx-auto text-primary" />
                        <p className="text-sm font-medium text-gray-700">{newUnavailableTime.documentFile.name}</p>
                        <button
                          type="button"
                          className="btn btn-xs btn-ghost"
                          onClick={() => setNewUnavailableTime({ ...newUnavailableTime, documentFile: null })}
                        >
                          Remove
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <DocumentArrowUpIcon className="w-8 h-8 mx-auto text-gray-400" />
                        <p className="text-sm text-gray-600">
                          Drag and drop a document here, or{' '}
                          <label className="text-primary cursor-pointer hover:underline">
                            click to browse
                            <input
                              type="file"
                              className="hidden"
                              accept="image/*,.pdf,.doc,.docx"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
                                  if (allowedTypes.includes(file.type)) {
                                    if (file.size <= 10 * 1024 * 1024) { // 10MB
                                      setNewUnavailableTime({ ...newUnavailableTime, documentFile: file });
                                    } else {
                                      toast.error('File size must be less than 10MB');
                                    }
                                  } else {
                                    toast.error('Invalid file type. Please upload images or documents (PDF, Word)');
                                  }
                                }
                              }}
                            />
                          </label>
                        </p>
                        <p className="text-xs text-gray-500">PDF, Word, or Images (max 10MB)</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            
            <div className="flex gap-3 mt-6">
              <button
                className="btn btn-primary flex-1"
                onClick={saveUnavailableTime}
                disabled={loading || uploadingDocument}
              >
                {loading || uploadingDocument ? 'Saving...' : 'Save'}
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setShowAddModal(false);
                  setNewUnavailableTime({ startTime: '09:00', endTime: '17:00', reason: '', unavailabilityType: 'general', documentFile: null });
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Unavailable Range Modal */}
      {showAddRangeModal && selectedEmployee && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-base-100 rounded-xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">Add Unavailable Range</h3>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setShowAddRangeModal(false);
                  setNewUnavailableRange({ startDate: '', endDate: '', reason: '', unavailabilityType: 'general', documentFile: null });
                }}
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            
            <div className="mb-4 p-3 bg-primary/10 rounded-lg">
              <div className="text-sm font-medium">{selectedEmployee.display_name}</div>
            </div>
            
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">
                    <span className="label-text text-sm">Start Date</span>
                  </label>
                  <input
                    type="date"
                    className="input input-bordered w-full"
                    value={newUnavailableRange.startDate}
                    onChange={(e) => setNewUnavailableRange(prev => ({ ...prev, startDate: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label">
                    <span className="label-text text-sm">End Date</span>
                  </label>
                  <input
                    type="date"
                    className="input input-bordered w-full"
                    value={newUnavailableRange.endDate}
                    onChange={(e) => setNewUnavailableRange(prev => ({ ...prev, endDate: e.target.value }))}
                  />
                </div>
              </div>
              
              <div>
                <label className="label">
                  <span className="label-text text-sm">Type</span>
                </label>
                <select
                  className="select select-bordered w-full"
                  value={newUnavailableRange.unavailabilityType}
                  onChange={(e) => setNewUnavailableRange({ 
                    ...newUnavailableRange, 
                    unavailabilityType: e.target.value as 'sick_days' | 'vacation' | 'general',
                    documentFile: e.target.value !== 'sick_days' ? null : newUnavailableRange.documentFile
                  })}
                >
                  <option value="general">General</option>
                  <option value="sick_days">Sick day/s</option>
                  <option value="vacation">Vacation</option>
                </select>
              </div>

              <div>
                <label className="label">
                  <span className="label-text text-sm">Reason</span>
                </label>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  placeholder={newUnavailableRange.unavailabilityType === 'sick_days' ? 'e.g., Flu, Doctor appointment' : newUnavailableRange.unavailabilityType === 'vacation' ? 'e.g., Family vacation' : 'e.g., Conference'}
                  value={newUnavailableRange.reason}
                  onChange={(e) => setNewUnavailableRange(prev => ({ ...prev, reason: e.target.value }))}
                />
              </div>

              {/* Document Upload for Sick Days */}
              {newUnavailableRange.unavailabilityType === 'sick_days' && (
                <div>
                  <label className="label">
                    <span className="label-text text-sm">Doctors Documents</span>
                  </label>
                  <div
                    className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
                      newUnavailableRange.documentFile
                        ? 'border-primary bg-primary/5'
                        : 'border-gray-300 hover:border-primary/50'
                    }`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const file = e.dataTransfer.files[0];
                      if (file) {
                        const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
                        if (allowedTypes.includes(file.type)) {
                          if (file.size <= 10 * 1024 * 1024) { // 10MB
                            setNewUnavailableRange({ ...newUnavailableRange, documentFile: file });
                          } else {
                            toast.error('File size must be less than 10MB');
                          }
                        } else {
                          toast.error('Invalid file type. Please upload images or documents (PDF, Word)');
                        }
                      }
                    }}
                  >
                    {newUnavailableRange.documentFile ? (
                      <div className="space-y-2">
                        <DocumentArrowUpIcon className="w-8 h-8 mx-auto text-primary" />
                        <p className="text-sm font-medium text-gray-700">{newUnavailableRange.documentFile.name}</p>
                        <button
                          type="button"
                          className="btn btn-xs btn-ghost"
                          onClick={() => setNewUnavailableRange({ ...newUnavailableRange, documentFile: null })}
                        >
                          Remove
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <DocumentArrowUpIcon className="w-8 h-8 mx-auto text-gray-400" />
                        <p className="text-sm text-gray-600">
                          Drag and drop a document here, or{' '}
                          <label className="text-primary cursor-pointer hover:underline">
                            click to browse
                            <input
                              type="file"
                              className="hidden"
                              accept="image/*,.pdf,.doc,.docx"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
                                  if (allowedTypes.includes(file.type)) {
                                    if (file.size <= 10 * 1024 * 1024) { // 10MB
                                      setNewUnavailableRange({ ...newUnavailableRange, documentFile: file });
                                    } else {
                                      toast.error('File size must be less than 10MB');
                                    }
                                  } else {
                                    toast.error('Invalid file type. Please upload images or documents (PDF, Word)');
                                  }
                                }
                              }}
                            />
                          </label>
                        </p>
                        <p className="text-xs text-gray-500">PDF, Word, or Images (max 10MB)</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            
            <div className="flex gap-3 mt-6">
              <button
                className="btn btn-primary flex-1"
                onClick={saveUnavailableRange}
                disabled={loading || uploadingDocument}
              >
                {loading || uploadingDocument ? 'Saving...' : 'Save Range'}
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setShowAddRangeModal(false);
                  setNewUnavailableRange({ startDate: '', endDate: '', reason: '', unavailabilityType: 'general', documentFile: null });
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EmployeeAvailabilityManager;
