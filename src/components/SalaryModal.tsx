import React, { useState, useEffect } from 'react';
import { XMarkIcon, UserGroupIcon, MagnifyingGlassIcon, FunnelIcon, CurrencyDollarIcon, CalendarIcon, Squares2X2Icon, ListBulletIcon } from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';
import { convertToNIS } from '../lib/currencyConversion';

interface Employee {
  id: string;
  display_name: string;
  email: string;
  bonuses_role: string;
  department: string;
  is_active: boolean;
  photo_url?: string;
}

interface SalaryRecord {
  id: string;
  employee_id: number;
  year: number;
  month: number;
  salary_amount: number;
  currency_id?: string;
  created_at: string;
  updated_at: string;
  created_by?: number;
  updated_by?: number;
}

interface SalaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  employees: Employee[];
}

// Helper function to generate initials from display name
const getInitials = (displayName: string): string => {
  return displayName
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
};

// Helper function to map role codes to display names
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

// Employee Salary Row Component
interface EmployeeSalaryRowProps {
  employee: Employee;
  salaryRecord?: SalaryRecord;
  onUpdateSalary: (employeeId: number, amount: number) => Promise<void>;
  onDeleteSalary: (employeeId: number) => Promise<void>;
}

const EmployeeSalaryRow: React.FC<EmployeeSalaryRowProps> = ({ 
  employee, 
  salaryRecord, 
  onUpdateSalary, 
  onDeleteSalary 
}) => {
  const [editAmount, setEditAmount] = useState<string>(salaryRecord?.salary_amount?.toString() || '');

  // Update edit amount when salary record changes
  React.useEffect(() => {
    setEditAmount(salaryRecord?.salary_amount?.toString() || '');
  }, [salaryRecord]);

  return (
    <tr>
      <td>
        <div className="flex items-center gap-3">
          <div className="avatar">
            {employee.photo_url ? (
              <div className="rounded-full w-16 h-16">
                <img 
                  src={employee.photo_url} 
                  alt={employee.display_name}
                  className="w-full h-full object-cover rounded-full"
                  onError={(e) => {
                    // Fallback to initials if image fails to load
                    const target = e.target as HTMLImageElement;
                    target.style.display = 'none';
                    const parent = target.parentElement;
                    if (parent) {
                      parent.innerHTML = `
                        <div class="bg-primary text-primary-content rounded-full w-16 h-16 flex items-center justify-center">
                          <span class="text-lg font-bold">${getInitials(employee.display_name)}</span>
                        </div>
                      `;
                    }
                  }}
                />
              </div>
            ) : (
              <div className="bg-primary text-primary-content rounded-full w-16 h-16 flex items-center justify-center">
                <span className="text-lg font-bold">
                  {getInitials(employee.display_name)}
                </span>
              </div>
            )}
          </div>
          <div>
            <div className="font-semibold">{employee.display_name}</div>
            <div className="text-sm text-gray-500">{employee.email}</div>
          </div>
        </div>
      </td>
      <td>
        <span className="badge badge-outline">{employee.department}</span>
      </td>
      <td>
        <span className="badge badge-primary">
          {getRoleDisplayName(employee.bonuses_role)}
        </span>
      </td>
      <td>
        <div className="flex items-center gap-2">
          <input
            type="number"
            className="input input-bordered w-32 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            value={editAmount}
            onChange={(e) => setEditAmount(e.target.value)}
            min="0"
            step="0.01"
          />
          <button
            onClick={() => onUpdateSalary(parseInt(employee.id), parseFloat(editAmount) || 0)}
            className="btn btn-sm btn-primary"
            disabled={!editAmount || parseFloat(editAmount) < 0}
          >
            Save
          </button>
          {salaryRecord && (
            <button
              onClick={() => onDeleteSalary(parseInt(employee.id))}
              className="btn btn-sm btn-error"
            >
              Delete
            </button>
          )}
        </div>
      </td>
      <td>
        <div className="text-sm text-gray-500">
          {salaryRecord ? (
            <span className="text-success">Salary set</span>
          ) : (
            <span style={{ color: '#3e2bcd' }}>No salary</span>
          )}
        </div>
      </td>
    </tr>
  );
};

// Employee Salary Box Component for mobile view
const EmployeeSalaryBox: React.FC<EmployeeSalaryRowProps> = ({ 
  employee, 
  salaryRecord, 
  onUpdateSalary, 
  onDeleteSalary 
}) => {
  const [editAmount, setEditAmount] = useState<string>(salaryRecord?.salary_amount?.toString() || '');

  // Update edit amount when salary record changes
  React.useEffect(() => {
    setEditAmount(salaryRecord?.salary_amount?.toString() || '');
  }, [salaryRecord]);

  return (
    <div className="card bg-base-100 shadow-2xl overflow-hidden" style={{ boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(255, 255, 255, 0.1)' }}>
      {/* Header with background image */}
      <div className="relative h-24 overflow-hidden" style={{ backgroundColor: '#3e2bcd' }}>
        {/* Background pattern overlay */}
        <div className="absolute inset-0 bg-black/20"></div>
        <div className="absolute inset-0 bg-gradient-to-br from-transparent via-transparent to-black/30"></div>
        
        {/* Decorative elements */}
        <div className="absolute top-2 right-2 w-16 h-16 bg-white/10 rounded-full blur-xl"></div>
        <div className="absolute bottom-2 left-2 w-12 h-12 bg-white/5 rounded-full blur-lg"></div>
        
        {/* Employee info overlay */}
        <div className="relative z-10 p-4 h-full flex items-end">
          <div className="flex items-center gap-3">
            <div className="avatar">
              {employee.photo_url ? (
                <div className="rounded-full w-16 h-16 ring-2 ring-white/30">
                  <img 
                    src={employee.photo_url} 
                    alt={employee.display_name}
                    className="w-full h-full object-cover rounded-full"
                    onError={(e) => {
                      // Fallback to initials if image fails to load
                      const target = e.target as HTMLImageElement;
                      target.style.display = 'none';
                      const parent = target.parentElement;
                      if (parent) {
                        parent.innerHTML = `
                          <div class="bg-white/20 backdrop-blur-sm text-white rounded-full w-16 h-16 flex items-center justify-center ring-2 ring-white/30">
                            <span class="text-lg font-bold">${getInitials(employee.display_name)}</span>
                          </div>
                        `;
                      }
                    }}
                  />
                </div>
              ) : (
                <div className="bg-white/20 backdrop-blur-sm text-white rounded-full w-16 h-16 flex items-center justify-center ring-2 ring-white/30">
                  <span className="text-lg font-bold">
                    {getInitials(employee.display_name)}
                  </span>
                </div>
              )}
            </div>
            <div className="text-white flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="font-semibold text-lg truncate drop-shadow-sm">{employee.display_name}</div>
                <span className="text-xs px-2 py-1 rounded-full text-white font-medium bg-white/20 backdrop-blur-sm shadow-sm flex-shrink-0">
                  {getRoleDisplayName(employee.bonuses_role)}
                </span>
              </div>
              <div className="text-white/80 text-sm truncate drop-shadow-sm">{employee.email}</div>
            </div>
          </div>
        </div>
      </div>
      
      {/* Department Glassy Box */}
      <div className="relative -mt-2 mx-4 mb-4">
        <div className="bg-white/80 backdrop-blur-md rounded-lg p-3 border border-white/20" style={{ boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04), inset 0 1px 0 rgba(255, 255, 255, 0.1)' }}>
          <div className="flex items-center">
            <span className="text-sm font-medium text-gray-700">{employee.department}</span>
          </div>
        </div>
      </div>
      
      <div className="card-body p-4">

        {/* Salary Input */}
        <div className="space-y-3">
          <div>
            <label className="label">
              <span className="label-text font-medium">Salary Amount (₪)</span>
            </label>
            <div className="flex gap-2">
              <input
                type="number"
                className="input input-bordered flex-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                value={editAmount}
                onChange={(e) => setEditAmount(e.target.value)}
                min="0"
                step="0.01"
                placeholder="Enter amount..."
              />
              <button
                onClick={() => onUpdateSalary(parseInt(employee.id), parseFloat(editAmount) || 0)}
                className="btn btn-primary"
                disabled={!editAmount || parseFloat(editAmount) < 0}
              >
                Save
              </button>
            </div>
          </div>

          {/* Status and Actions */}
          <div className="flex items-center justify-between">
            <div className="text-sm">
              {salaryRecord ? (
                <span className="text-success font-medium">✓ Salary set</span>
              ) : (
                <span className="font-medium" style={{ color: '#3e2bcd' }}>⚠ No salary</span>
              )}
            </div>
            {salaryRecord && (
              <button
                onClick={() => onDeleteSalary(parseInt(employee.id))}
                className="btn btn-sm btn-error"
              >
                Delete
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const SalaryModal: React.FC<SalaryModalProps> = ({ isOpen, onClose, employees }) => {
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth() + 1);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedDepartment, setSelectedDepartment] = useState<string>('all');
  const [salaryStatusFilter, setSalaryStatusFilter] = useState<'all' | 'missing' | 'added'>('all');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('grid');
  const [salaryRecords, setSalaryRecords] = useState<SalaryRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Get unique departments for filters
  const departments = [...new Set(employees.map(emp => emp.department).filter(Boolean))];

  // Filter employees based on search, department, and role
  const getFilteredEmployees = () => {
    let filtered = employees;

    if (selectedDepartment !== 'all') {
      filtered = filtered.filter(emp => emp.department === selectedDepartment);
    }

    // Filter by salary status
    if (salaryStatusFilter === 'missing') {
      filtered = filtered.filter(employee => !salaryRecords.some(record => record.employee_id === parseInt(employee.id)));
    } else if (salaryStatusFilter === 'added') {
      filtered = filtered.filter(employee => salaryRecords.some(record => record.employee_id === parseInt(employee.id)));
    }

    if (searchQuery.trim()) {
      filtered = filtered.filter(emp => 
        emp.display_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        emp.email.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    return filtered;
  };

  // Fetch existing salary records for the selected month/year
  const fetchSalaryRecords = async () => {
    if (!isOpen) return;
    
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('employee_salaries')
        .select('*')
        .eq('year', selectedYear)
        .eq('month', selectedMonth);

      if (error) {
        console.error('Error fetching salary records:', error);
        setError('Failed to load salary records');
        return;
      }

      setSalaryRecords(data || []);
    } catch (err) {
      console.error('Error fetching salary records:', err);
      setError('Failed to load salary records');
    } finally {
      setLoading(false);
    }
  };


  // Update individual salary
  const updateIndividualSalary = async (employeeId: number, newAmount: number) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const currentUserId = user?.id ? parseInt(user.id) : null;

      const { error } = await supabase
        .from('employee_salaries')
        .upsert({
          employee_id: employeeId,
          year: selectedYear,
          month: selectedMonth,
          salary_amount: newAmount,
          currency_id: null,
          updated_by: currentUserId
        }, {
          onConflict: 'employee_id,year,month'
        });

      if (error) {
        console.error('Error updating salary:', error);
        setError('Failed to update salary');
        return;
      }

      // Refresh salary records
      await fetchSalaryRecords();
    } catch (err) {
      console.error('Error updating salary:', err);
      setError('Failed to update salary');
    }
  };

  // Delete salary record
  const deleteSalary = async (employeeId: number) => {
    try {
      const { error } = await supabase
        .from('employee_salaries')
        .delete()
        .eq('employee_id', employeeId)
        .eq('year', selectedYear)
        .eq('month', selectedMonth);

      if (error) {
        console.error('Error deleting salary:', error);
        setError('Failed to delete salary');
        return;
      }

      // Refresh salary records
      await fetchSalaryRecords();
    } catch (err) {
      console.error('Error deleting salary:', err);
      setError('Failed to delete salary');
    }
  };

  // Fetch salary records when modal opens or filters change
  useEffect(() => {
    if (isOpen) {
      fetchSalaryRecords();
    }
  }, [isOpen, selectedYear, selectedMonth]);

  // Clear messages after 5 seconds
  useEffect(() => {
    if (error || success) {
      const timer = setTimeout(() => {
        setError(null);
        setSuccess(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [error, success]);

  if (!isOpen) return null;

  const filteredEmployees = getFilteredEmployees();
  const monthName = new Date(selectedYear, selectedMonth - 1).toLocaleDateString('en-US', { month: 'long' });

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-screen">
        {/* Backdrop */}
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
          onClick={onClose}
        />
        
        {/* Full Screen Modal */}
        <div className="relative bg-white w-full h-screen overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between p-6 bg-white/80 backdrop-blur-md border-b border-white/20">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <CurrencyDollarIcon className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-gray-900">Employee Salary Management</h2>
                <p className="text-sm text-gray-600">Manage monthly salaries for employees</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* View Toggle */}
              <div className="flex items-center bg-gray-100 rounded-lg p-1">
                <button
                  onClick={() => setViewMode('grid')}
                  className={`p-2 rounded-md transition-colors ${
                    viewMode === 'grid' 
                      ? 'bg-white shadow-sm text-primary' 
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                  title="Grid View"
                >
                  <Squares2X2Icon className="w-5 h-5" />
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={`p-2 rounded-md transition-colors ${
                    viewMode === 'list' 
                      ? 'bg-white shadow-sm text-primary' 
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                  title="List View"
                >
                  <ListBulletIcon className="w-5 h-5" />
                </button>
              </div>
              
              {/* Close Button */}
              <button
                onClick={onClose}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <XMarkIcon className="w-6 h-6 text-gray-500" />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="p-6 overflow-y-auto h-[calc(100vh-120px)]">
            {/* Controls */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-6">
              {/* Month/Year Selection */}
              <div className="card bg-base-100 shadow-sm">
                <div className="card-body p-4">
                  {/* Month/Year Selection */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="form-control">
                      <label className="label">
                        <span className="label-text font-medium">Year</span>
                      </label>
                      <select 
                        className="select select-bordered"
                        value={selectedYear}
                        onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                      >
                        {Array.from({ length: 5 }, (_, i) => {
                          const year = new Date().getFullYear() - i;
                          return <option key={year} value={year}>{year}</option>;
                        })}
                      </select>
                    </div>
                    
                    <div className="form-control">
                      <label className="label">
                        <span className="label-text font-medium">Month</span>
                      </label>
                      <select 
                        className="select select-bordered"
                        value={selectedMonth}
                        onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
                      >
                        {Array.from({ length: 12 }, (_, i) => {
                          const month = i + 1;
                          const monthName = new Date(2024, i).toLocaleDateString('en-US', { month: 'long' });
                          return <option key={month} value={month}>{monthName}</option>;
                        })}
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              {/* Search */}
              <div className="card bg-base-100 shadow-sm">
                <div className="card-body p-4">
                  <div className="form-control">
                    <label className="label">
                      <span className="label-text font-medium">Search Employee</span>
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="Search by name or email..."
                        className="input input-bordered w-full pr-10"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                      />
                      <MagnifyingGlassIcon className="w-5 h-5 text-gray-400 absolute right-3 top-1/2 transform -translate-y-1/2" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Department Filter */}
              <div className="card bg-base-100 shadow-sm">
                <div className="card-body p-4">
                  <div className="form-control">
                    <label className="label">
                      <span className="label-text font-medium">Department</span>
                    </label>
                    <select
                      className="select select-bordered w-full"
                      value={selectedDepartment}
                      onChange={(e) => setSelectedDepartment(e.target.value)}
                    >
                      <option value="all">All Departments</option>
                      {departments.map(dept => (
                        <option key={dept} value={dept}>{dept}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Salary Status Filter */}
              <div className="card bg-base-100 shadow-sm">
                <div className="card-body p-4">
                  <div className="form-control">
                    <label className="label">
                      <span className="label-text font-medium">Salary Status</span>
                    </label>
                    <select
                      className="select select-bordered w-full"
                      value={salaryStatusFilter}
                      onChange={(e) => setSalaryStatusFilter(e.target.value as 'all' | 'missing' | 'added')}
                    >
                      <option value="all">All</option>
                      <option value="missing">Missing Salary</option>
                      <option value="added">Added Salary</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>

            {/* Messages */}
            {error && (
              <div className="alert alert-error mb-4">
                <XMarkIcon className="w-5 h-5" />
                <span>{error}</span>
              </div>
            )}

            {success && (
              <div className="alert alert-success mb-4">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span>{success}</span>
              </div>
            )}

            {/* Employee List */}
            {viewMode === 'list' ? (
              <div className="card bg-base-100 shadow-sm">
                <div className="card-body p-0">
                  <div className="overflow-x-auto">
                    <table className="table w-full">
                      <thead>
                        <tr>
                          <th>Employee</th>
                          <th>Department</th>
                          <th>Role</th>
                          <th>Current Salary (₪)</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {loading ? (
                          <tr>
                            <td colSpan={5} className="text-center py-8">
                              <span className="loading loading-spinner loading-lg"></span>
                              <p className="mt-2 text-gray-600">Loading salary data...</p>
                            </td>
                          </tr>
                        ) : filteredEmployees.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="text-center py-8 text-gray-500">
                              No employees found matching the current filters
                            </td>
                          </tr>
                        ) : (
                          filteredEmployees.map((employee) => {
                            const salaryRecord = salaryRecords.find(record => record.employee_id === parseInt(employee.id));
                            
                            return (
                              <EmployeeSalaryRow
                                key={employee.id}
                                employee={employee}
                                salaryRecord={salaryRecord}
                                onUpdateSalary={updateIndividualSalary}
                                onDeleteSalary={deleteSalary}
                              />
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : (
              /* Grid View */
              <div className="space-y-4">
                {loading ? (
                  <div className="text-center py-8">
                    <span className="loading loading-spinner loading-lg"></span>
                    <p className="mt-2 text-gray-600">Loading salary data...</p>
                  </div>
                ) : filteredEmployees.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    No employees found matching the current filters
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredEmployees.map((employee) => {
                      const salaryRecord = salaryRecords.find(record => record.employee_id === parseInt(employee.id));
                      
                      return (
                        <EmployeeSalaryBox
                          key={employee.id}
                          employee={employee}
                          salaryRecord={salaryRecord}
                          onUpdateSalary={updateIndividualSalary}
                          onDeleteSalary={deleteSalary}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Summary */}
            {filteredEmployees.length > 0 && (
              <div className="mt-6 p-4 bg-gray-50 rounded-lg">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-semibold text-gray-900">Summary</h4>
                    <p className="text-sm text-gray-600">
                      {filteredEmployees.length} employees • {salaryRecords.length} with salaries set
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-primary">
                      ₪{salaryRecords.reduce((sum, record) => sum + record.salary_amount, 0).toLocaleString()}
                    </div>
                    <div className="text-sm text-gray-600">Total Monthly Salaries</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SalaryModal;
