import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { 
  UserGroupIcon, 
  PlusIcon, 
  TrashIcon, 
  ClockIcon,
  CheckIcon,
  XMarkIcon,
  MagnifyingGlassIcon
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';

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
    reason: ''
  });
  const [newUnavailableRange, setNewUnavailableRange] = useState({
    startDate: '',
    endDate: '',
    reason: ''
  });
  const [loading, setLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

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
    } catch (error) {
      console.error('Error fetching employee unavailable times:', error);
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
      // Get current user info for audit trail
      const { data: { user } } = await supabase.auth.getUser();
      const currentUser = user?.id || 'system';

      // Format date as YYYY-MM-DD
      const year = selectedDate.getFullYear();
      const month = String(selectedDate.getMonth() + 1).padStart(2, '0');
      const day = String(selectedDate.getDate()).padStart(2, '0');
      const dateString = `${year}-${month}-${day}`;

      const newTime: UnavailableTime = {
        id: Date.now().toString(),
        date: dateString,
        startTime: newUnavailableTime.startTime,
        endTime: newUnavailableTime.endTime,
        reason: newUnavailableTime.reason,
        created_by: currentUser
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
      setNewUnavailableTime({ startTime: '09:00', endTime: '17:00', reason: '' });
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
      // Get current user info for audit trail
      const { data: { user } } = await supabase.auth.getUser();
      const currentUser = user?.id || 'system';

      const newRange: UnavailableRange = {
        id: Date.now().toString(),
        startDate: newUnavailableRange.startDate,
        endDate: newUnavailableRange.endDate,
        reason: newUnavailableRange.reason,
        created_by: currentUser
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
      setNewUnavailableRange({ startDate: '', endDate: '', reason: '' });
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
                  <div key={time.id} className="flex items-center justify-between gap-2 p-3 bg-base-200 rounded-lg">
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
        <div className="bg-base-100 rounded-lg p-4">
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
                  <div key={range.id} className="flex items-center justify-between gap-2 p-3 bg-base-200 rounded-lg">
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

      {/* Add Unavailable Time Modal */}
      {showAddModal && selectedDate && selectedEmployee && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-base-100 rounded-xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">Add Unavailable Time</h3>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setShowAddModal(false)}
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            
            <div className="mb-4 p-3 bg-primary/10 rounded-lg">
              <div className="text-sm font-medium">{selectedEmployee.display_name}</div>
              <div className="text-xs text-base-content/70">
                {selectedDate.toLocaleDateString()}
              </div>
            </div>
            
            <div className="space-y-4">
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
                  <span className="label-text text-sm">Reason</span>
                </label>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  placeholder="e.g., Personal appointment, Vacation, etc."
                  value={newUnavailableTime.reason}
                  onChange={(e) => setNewUnavailableTime(prev => ({ ...prev, reason: e.target.value }))}
                />
              </div>
            </div>
            
            <div className="flex gap-3 mt-6">
              <button
                className="btn btn-primary flex-1"
                onClick={saveUnavailableTime}
                disabled={loading}
              >
                {loading ? 'Saving...' : 'Save'}
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => setShowAddModal(false)}
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
                onClick={() => setShowAddRangeModal(false)}
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
                  <span className="label-text text-sm">Reason</span>
                </label>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  placeholder="e.g., Vacation, Sick Leave, Conference"
                  value={newUnavailableRange.reason}
                  onChange={(e) => setNewUnavailableRange(prev => ({ ...prev, reason: e.target.value }))}
                />
              </div>
            </div>
            
            <div className="flex gap-3 mt-6">
              <button
                className="btn btn-primary flex-1"
                onClick={saveUnavailableRange}
                disabled={loading}
              >
                {loading ? 'Saving...' : 'Save Range'}
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => setShowAddRangeModal(false)}
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
