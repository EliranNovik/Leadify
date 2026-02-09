import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import { CheckCircleIcon, XCircleIcon, UserIcon, IdentificationIcon, XMarkIcon, PhoneIcon, DevicePhoneMobileIcon, BriefcaseIcon } from '@heroicons/react/24/outline';

interface EmployeeInfo {
  id: number;
  display_name: string;
  photo_url: string | null;
  phone: string | null;
  mobile: string | null;
  phone_ext: string | null;
  email: string;
  linkedin_url: string | null;
  diplom: string | null;
  school: string | null;
  bonuses_role: string | null;
  department: string | null;
}

// Helper function to get initials from name
const getInitials = (name: string): string => {
  return name
    .split(' ')
    .map(word => word[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
};

// Helper function to map role codes to display names
const getRoleDisplayName = (roleCode: string | null | undefined): string => {
  if (!roleCode) return '---';

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
    'f': 'Finance',
    'col': 'Collection',
    'lawyer': 'Helper Closer'
  };

  return roleMap[roleCode] || roleCode || '---';
};

const EmployeeInfoReport = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [employees, setEmployees] = useState<EmployeeInfo[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeFilter, setActiveFilter] = useState<'missing-phone' | 'missing-mobile' | 'missing-linkedin' | null>(null);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeInfo | null>(null);

  useEffect(() => {
    fetchEmployees();
  }, []);

  const fetchEmployees = async () => {
    try {
      setLoading(true);

      // Fetch employees from users table with tenants_employee join (only staff users)
      // Similar to SalesContributionPage pattern
      const { data: allEmployeesData, error: allEmployeesDataError } = await supabase
        .from('users')
        .select(`
          id,
          full_name,
          email,
          employee_id,
          is_active,
          is_staff,
          tenants_employee!employee_id(
            id,
            display_name,
            photo_url,
            phone,
            mobile,
            phone_ext,
            linkedin_url,
            diplom,
            school,
            bonuses_role,
            department_id,
            tenant_departement!department_id(
              id,
              name
            )
          )
        `)
        .not('employee_id', 'is', null)
        .eq('is_staff', true)
        .order('full_name', { ascending: true });

      if (allEmployeesDataError) {
        console.error('Error fetching employees:', allEmployeesDataError);
        throw allEmployeesDataError;
      }

      if (allEmployeesData) {
        // Process employees data - filter and map similar to SalesContributionPage
        const formattedEmployees: EmployeeInfo[] = allEmployeesData
          .filter((user: any) => user.tenants_employee && user.email)
          .map((user: any) => {
            const employee = user.tenants_employee as any;

            // Handle school - it might be an array or string
            const schoolValue = Array.isArray(employee.school) && employee.school.length > 0
              ? employee.school[0]
              : (employee.school || null);

            // Get department name
            const dept = Array.isArray(employee.tenant_departement)
              ? employee.tenant_departement[0]
              : employee.tenant_departement;
            const departmentName = dept?.name || null;

            return {
              id: Number(employee.id),
              display_name: employee.display_name || 'Unknown',
              photo_url: employee.photo_url,
              phone: employee.phone,
              mobile: employee.mobile,
              phone_ext: employee.phone_ext,
              email: user.email,
              linkedin_url: employee.linkedin_url,
              diplom: employee.diplom,
              school: schoolValue,
              bonuses_role: employee.bonuses_role || null,
              department: departmentName,
            };
          });

        setEmployees(formattedEmployees);
      }
    } catch (error) {
      console.error('Error fetching employees:', error);
      toast.error('Failed to load employee information');
    } finally {
      setLoading(false);
    }
  };

  // Calculate summary counts
  const missingPhoneCount = employees.filter(emp => !emp.phone || emp.phone.trim() === '').length;
  const missingMobileCount = employees.filter(emp => !emp.mobile || emp.mobile.trim() === '').length;
  const missingLinkedInCount = employees.filter(emp => !emp.linkedin_url || emp.linkedin_url.trim() === '').length;

  const filteredEmployees = employees.filter((emp) => {
    // Apply active filter
    if (activeFilter === 'missing-phone') {
      if (emp.phone && emp.phone.trim() !== '') return false;
    } else if (activeFilter === 'missing-mobile') {
      if (emp.mobile && emp.mobile.trim() !== '') return false;
    } else if (activeFilter === 'missing-linkedin') {
      if (emp.linkedin_url && emp.linkedin_url.trim() !== '') return false;
    }

    // Apply search term filter
    if (!searchTerm.trim()) return true;
    const searchLower = searchTerm.toLowerCase();
    return (
      emp.display_name.toLowerCase().includes(searchLower) ||
      emp.email.toLowerCase().includes(searchLower) ||
      (emp.phone && emp.phone.includes(searchTerm)) ||
      (emp.mobile && emp.mobile.includes(searchTerm))
    );
  });

  const handleFilterClick = (filterType: 'missing-phone' | 'missing-mobile' | 'missing-linkedin' | null) => {
    if (activeFilter === filterType) {
      // If clicking the same filter, clear it
      setActiveFilter(null);
    } else {
      // Set the new filter
      setActiveFilter(filterType);
    }
  };

  const handleOpenProfileModal = (employee: EmployeeInfo) => {
    setSelectedEmployee(employee);
    setShowProfileModal(true);
  };

  const handleCloseProfileModal = () => {
    setShowProfileModal(false);
    setSelectedEmployee(null);
  };

  const handleViewProfile = () => {
    if (selectedEmployee?.id) {
      navigate(`/my-profile/${selectedEmployee.id}`);
      handleCloseProfileModal();
    }
  };

  const handleViewBusinessCard = () => {
    if (selectedEmployee?.id) {
      navigate(`/business-card/${selectedEmployee.id}`);
      handleCloseProfileModal();
    }
  };

  const EmployeeAvatar: React.FC<{
    employee: EmployeeInfo;
    size?: 'sm' | 'md' | 'lg';
  }> = ({ employee, size = 'md' }) => {
    const [imageError, setImageError] = useState(false);
    const photoUrl = employee.photo_url;
    const initials = getInitials(employee.display_name);
    const sizeClasses = size === 'sm' ? 'w-10 h-10 text-xs' : size === 'md' ? 'w-14 h-14 text-base' : 'w-16 h-16 text-lg';

    const handleClick = () => {
      handleOpenProfileModal(employee);
    };

    if (imageError || !photoUrl) {
      return (
        <div
          className={`${sizeClasses} rounded-full flex items-center justify-center bg-green-100 text-green-700 font-semibold cursor-pointer hover:opacity-80 transition-opacity`}
          onClick={handleClick}
          title={`View ${employee.display_name}'s profile`}
        >
          {initials}
        </div>
      );
    }

    return (
      <img
        src={photoUrl}
        alt={employee.display_name}
        className={`${sizeClasses} rounded-full object-cover cursor-pointer hover:opacity-80 transition-opacity`}
        onError={() => setImageError(true)}
        onClick={handleClick}
        title={`View ${employee.display_name}'s profile`}
      />
    );
  };

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold mb-2">Employee Info</h1>
          <p className="text-gray-600">View employee contact information and details</p>
        </div>
        <button
          onClick={() => navigate('/reports')}
          className="btn btn-outline btn-sm md:btn-md"
        >
          Back to Reports
        </button>
      </div>

      {/* Summary Boxes */}
      {!loading && (
        <div className="mb-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <button
            onClick={() => handleFilterClick('missing-phone')}
            className={`card bg-base-100 shadow-md hover:shadow-lg transition-all cursor-pointer ${activeFilter === 'missing-phone' ? 'ring-2 ring-primary' : ''
              }`}
          >
            <div className="card-body p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600 mb-1">Missing Phone Number</p>
                  <p className="text-2xl font-bold text-primary">{missingPhoneCount}</p>
                </div>
                <div className="text-black">
                  <PhoneIcon className="w-8 h-8" />
                </div>
              </div>
            </div>
          </button>

          <button
            onClick={() => handleFilterClick('missing-mobile')}
            className={`card bg-base-100 shadow-md hover:shadow-lg transition-all cursor-pointer ${activeFilter === 'missing-mobile' ? 'ring-2 ring-primary' : ''
              }`}
          >
            <div className="card-body p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600 mb-1">Missing Mobile Number</p>
                  <p className="text-2xl font-bold text-primary">{missingMobileCount}</p>
                </div>
                <div className="text-black">
                  <DevicePhoneMobileIcon className="w-8 h-8" />
                </div>
              </div>
            </div>
          </button>

          <button
            onClick={() => handleFilterClick('missing-linkedin')}
            className={`card bg-base-100 shadow-md hover:shadow-lg transition-all cursor-pointer ${activeFilter === 'missing-linkedin' ? 'ring-2 ring-primary' : ''
              }`}
          >
            <div className="card-body p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600 mb-1">Missing LinkedIn</p>
                  <p className="text-2xl font-bold text-primary">{missingLinkedInCount}</p>
                </div>
                <div className="text-black">
                  <BriefcaseIcon className="w-8 h-8" />
                </div>
              </div>
            </div>
          </button>
        </div>
      )}

      {/* Search */}
      <div className="mb-6">
        <div className="form-control w-full max-w-xs">
          <input
            type="text"
            placeholder="Search employees..."
            className="input input-bordered w-full"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center items-center py-12">
          <span className="loading loading-spinner loading-lg"></span>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="table w-full min-w-[1000px]">
            <thead>
              <tr>
                <th className="text-[10px] md:text-sm whitespace-nowrap">Employee</th>
                <th className="text-[10px] md:text-sm whitespace-nowrap">Department</th>
                <th className="text-[10px] md:text-sm whitespace-nowrap">Phone</th>
                <th className="text-[10px] md:text-sm whitespace-nowrap">Ext</th>
                <th className="text-[10px] md:text-sm whitespace-nowrap">Mobile</th>
                <th className="text-[10px] md:text-sm whitespace-nowrap">Email</th>
                <th className="text-[10px] md:text-sm whitespace-nowrap">LinkedIn</th>
                <th className="text-[10px] md:text-sm whitespace-nowrap">Diploma</th>
                <th className="text-[10px] md:text-sm whitespace-nowrap">School</th>
              </tr>
            </thead>
            <tbody>
              {filteredEmployees.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-8 text-gray-500">
                    {searchTerm ? 'No employees found matching your search' : 'No employees found'}
                  </td>
                </tr>
              ) : (
                filteredEmployees.map((employee) => (
                  <tr key={employee.id} className="hover:bg-base-200">
                    <td className="text-[10px] md:text-sm whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <EmployeeAvatar employee={employee} size="md" />
                        <span className="font-medium">{employee.display_name}</span>
                      </div>
                    </td>
                    <td className="text-[10px] md:text-sm whitespace-nowrap">
                      <div className="flex flex-col">
                        <span className="font-medium">{getRoleDisplayName(employee.bonuses_role)}</span>
                        {employee.department && (
                          <span className="text-xs text-gray-500">{employee.department}</span>
                        )}
                      </div>
                    </td>
                    <td className="text-[10px] md:text-sm whitespace-nowrap">
                      {employee.phone || '---'}
                    </td>
                    <td className="text-[10px] md:text-sm whitespace-nowrap">
                      {employee.phone_ext || '---'}
                    </td>
                    <td className="text-[10px] md:text-sm whitespace-nowrap">
                      {employee.mobile || '---'}
                    </td>
                    <td className="text-[10px] md:text-sm whitespace-nowrap">
                      {employee.email || '---'}
                    </td>
                    <td className="text-[10px] md:text-sm whitespace-nowrap">
                      {employee.linkedin_url ? (
                        <div className="flex items-center justify-center">
                          <CheckCircleIcon className="w-5 h-5 text-green-500" title="LinkedIn profile exists" />
                        </div>
                      ) : (
                        <div className="flex items-center justify-center">
                          <XCircleIcon className="w-5 h-5 text-gray-400" title="No LinkedIn profile" />
                        </div>
                      )}
                    </td>
                    <td className="text-[10px] md:text-sm whitespace-nowrap">
                      {employee.diplom ? (
                        <div className="flex items-center justify-center">
                          <CheckCircleIcon className="w-5 h-5 text-green-500" title="Diploma exists" />
                        </div>
                      ) : (
                        <div className="flex items-center justify-center">
                          <XCircleIcon className="w-5 h-5 text-gray-400" title="No diploma" />
                        </div>
                      )}
                    </td>
                    <td className="text-[10px] md:text-sm whitespace-nowrap">
                      {employee.school ? (
                        <div className="flex items-center justify-center">
                          <CheckCircleIcon className="w-5 h-5 text-green-500" title="School exists" />
                        </div>
                      ) : (
                        <div className="flex items-center justify-center">
                          <XCircleIcon className="w-5 h-5 text-gray-400" title="No school" />
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Summary */}
      {!loading && (
        <div className="mt-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="text-sm text-gray-600">
            Showing {filteredEmployees.length} of {employees.length} employees
            {activeFilter && (
              <span className="ml-2">
                <button
                  onClick={() => setActiveFilter(null)}
                  className="btn btn-xs btn-ghost"
                >
                  Clear filter
                </button>
              </span>
            )}
          </div>
        </div>
      )}

      {/* Profile Options Modal */}
      {showProfileModal && selectedEmployee && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={handleCloseProfileModal}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-gray-900">
                View {selectedEmployee.display_name}
              </h3>
              <button
                onClick={handleCloseProfileModal}
                className="btn btn-ghost btn-sm btn-circle"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="space-y-3">
              <button
                onClick={handleViewProfile}
                className="w-full btn btn-outline btn-lg justify-start gap-3 hover:btn-primary transition-colors"
              >
                <UserIcon className="w-6 h-6" />
                <div className="text-left">
                  <div className="font-semibold">View Profile</div>
                  <div className="text-xs text-gray-500">Full profile page</div>
                </div>
              </button>

              <button
                onClick={handleViewBusinessCard}
                className="w-full btn btn-outline btn-lg justify-start gap-3 hover:btn-primary transition-colors"
              >
                <IdentificationIcon className="w-6 h-6" />
                <div className="text-left">
                  <div className="font-semibold">View Business Card</div>
                  <div className="text-xs text-gray-500">Digital business card</div>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EmployeeInfoReport;
