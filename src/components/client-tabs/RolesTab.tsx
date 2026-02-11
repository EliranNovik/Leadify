import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClientTabProps } from '../../types/client';
import TimelineHistoryButtons from './TimelineHistoryButtons';
import { UserGroupIcon, PencilSquareIcon, UserIcon, CheckIcon, XMarkIcon, CalendarIcon, UserCircleIcon, AcademicCapIcon, HandRaisedIcon, WrenchScrewdriverIcon, CogIcon, LockClosedIcon, LockOpenIcon } from '@heroicons/react/24/outline';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import { fetchStageActorInfo } from '../../lib/leadStageManager';

interface Role {
  id: string;
  title: string;
  assignee: string;
  fieldName: string;
  legacyFieldName?: string; // For legacy leads
}

// Will be replaced by real users from DB
const defaultAssignees = ['---'];

const RolesTab: React.FC<ClientTabProps> = ({ client, onClientUpdate, allEmployees: allEmployeesProp = [] }) => {
  const navigate = useNavigate();
  const [allUsers, setAllUsers] = useState<{ full_name: string; role: string }[]>([]);
  // Use employees from prop (loaded in parent) or fallback to local state
  const [allEmployees, setAllEmployees] = useState<any[]>(allEmployeesProp);
  const [allEmployeeOptions, setAllEmployeeOptions] = useState<string[]>([]);

  // Search terms and dropdown visibility for each role
  const [searchTerms, setSearchTerms] = useState<{ [key: string]: string }>({});
  const [showDropdowns, setShowDropdowns] = useState<{ [key: string]: boolean }>({});

  // Check if this is a legacy lead
  const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');

  // Helper function to get employee by ID or name (matching CalendarPage logic)
  const getEmployeeById = (employeeIdOrName: string | number | null | undefined) => {
    const employeesToUse = (allEmployeesProp && allEmployeesProp.length > 0) ? allEmployeesProp : allEmployees;

    if (!employeeIdOrName || employeeIdOrName === '---' || employeeIdOrName === '--' || employeeIdOrName === '') {
      return null;
    }

    // First, try to match by ID
    const employeeById = employeesToUse.find((emp: any) => {
      const empId = typeof emp.id === 'bigint' ? Number(emp.id) : emp.id;
      const searchId = typeof employeeIdOrName === 'string' ? parseInt(employeeIdOrName, 10) : employeeIdOrName;

      if (isNaN(Number(searchId))) return false;

      if (empId.toString() === searchId.toString()) return true;
      if (Number(empId) === Number(searchId)) return true;

      return false;
    });

    if (employeeById) {
      return employeeById;
    }

    // If not found by ID, try to match by display name
    if (typeof employeeIdOrName === 'string') {
      const employeeByName = employeesToUse.find((emp: any) => {
        if (!emp.display_name) return false;
        return emp.display_name.trim().toLowerCase() === employeeIdOrName.trim().toLowerCase();
      });

      if (employeeByName) {
        return employeeByName;
      }
    }

    return null;
  };

  // Helper function to get employee initials
  const getEmployeeInitials = (name: string | null | undefined): string => {
    if (!name || name === '---' || name === '--' || name === 'Not assigned') return '';
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  // Helper to get employee ID from role assignee name
  const getEmployeeIdFromRole = (role: Role): string | number | null => {
    const employeesToUse = (allEmployeesProp && allEmployeesProp.length > 0) ? allEmployeesProp : allEmployees;

    if (!role.assignee || role.assignee === '---') return null;

    if (isLegacyLead && role.legacyFieldName) {
      // For legacy leads, get the ID directly from the client
      return (client as any)[role.legacyFieldName] || null;
    } else {
      // For new leads, find employee by display name
      const employee = employeesToUse.find((emp: any) => {
        return emp.display_name && emp.display_name.trim() === role.assignee.trim();
      });
      return employee?.id || null;
    }
  };

  // Component to render employee avatar
  const EmployeeAvatar: React.FC<{
    employeeId: string | number | null | undefined;
    size?: 'sm' | 'md' | 'lg';
  }> = ({ employeeId, size = 'md' }) => {
    const [imageError, setImageError] = useState(false);
    const employee = getEmployeeById(employeeId);
    const sizeClasses = size === 'sm' ? 'w-8 h-8 text-xs' : size === 'md' ? 'w-12 h-12 text-sm' : 'w-16 h-16 text-base';

    if (!employee) {
      return null;
    }

    const photoUrl = employee.photo_url || employee.photo;
    const initials = getEmployeeInitials(employee.display_name);

    // If we know there's no photo URL or we have an error, show initials immediately
    if (imageError || !photoUrl) {
      return (
        <div
          className={`${sizeClasses} rounded-full flex items-center justify-center bg-green-100 text-green-700 font-semibold flex-shrink-0 cursor-pointer hover:opacity-80 transition-opacity`}
          onClick={() => {
            if (employee.id) {
              navigate(`/my-profile/${employee.id}`);
            }
          }}
          title={`View ${employee.display_name}'s profile`}
        >
          {initials}
        </div>
      );
    }

    // Try to render image
    return (
      <img
        src={photoUrl}
        alt={employee.display_name}
        className={`${sizeClasses} rounded-full object-cover flex-shrink-0 cursor-pointer hover:opacity-80 transition-opacity`}
        onClick={() => {
          if (employee.id) {
            navigate(`/my-profile/${employee.id}`);
          }
        }}
        onError={() => setImageError(true)}
        title={`View ${employee.display_name}'s profile`}
      />
    );
  };

  // Update local employees state when prop changes (employees are loaded in parent)
  useEffect(() => {
    if (allEmployeesProp && allEmployeesProp.length > 0) {
      setAllEmployees(allEmployeesProp);
    }
  }, [allEmployeesProp]);

  // Helper function to get employee display name from ID
  const getEmployeeDisplayName = useMemo(() => {
    return (employeeId: string | number | null | undefined, employees: any[]) => {
      if (!employeeId || employeeId === '---' || employeeId === null || employeeId === undefined) return '---';

      // If employees array is empty, return placeholder
      if (!employees || employees.length === 0) {
        return 'Loading...';
      }

      // Convert employeeId to number for comparison
      const idAsNumber = typeof employeeId === 'string' ? parseInt(employeeId, 10) : Number(employeeId);

      if (isNaN(idAsNumber)) {
        console.warn('Invalid employee ID:', employeeId);
        return '---';
      }

      // Find employee by ID - try multiple comparison methods for robustness
      const employee = employees.find((emp: any) => {
        if (!emp || !emp.id) return false;

        // Handle bigint type
        const empId = typeof emp.id === 'bigint' ? Number(emp.id) : emp.id;
        const empIdNum = typeof empId === 'string' ? parseInt(empId, 10) : Number(empId);

        if (isNaN(empIdNum)) return false;

        // Try string comparison
        if (String(empId) === String(employeeId)) return true;
        // Try number comparison
        if (empIdNum === idAsNumber) return true;

        return false;
      });

      if (employee && employee.display_name) {
        return employee.display_name;
      }

      // If not found, log for debugging
      if (employees.length > 0) {
        console.warn(`Employee not found for ID: ${employeeId} (as number: ${idAsNumber})`);
        console.log('Available employee IDs:', employees.map((e: any) => ({ id: e.id, display_name: e.display_name })));
      }

      return '---';
    };
  }, []);

  // Compute roles immediately when both client and employees are available (synchronously)
  const computedRoles = useMemo(() => {
    // Use prop employees if available, otherwise use local state
    const employeesToUse = (allEmployeesProp && allEmployeesProp.length > 0) ? allEmployeesProp : allEmployees;

    // If employees aren't loaded yet, return default roles
    if (!employeesToUse || employeesToUse.length === 0) {
      return [
        { id: 'scheduler', title: 'Scheduler', assignee: '---', fieldName: 'scheduler', legacyFieldName: 'meeting_scheduler_id' },
        { id: 'manager', title: 'Manager', assignee: '---', fieldName: 'manager', legacyFieldName: 'meeting_manager_id' },
        { id: 'helper', title: 'Helper', assignee: '---', fieldName: 'helper', legacyFieldName: 'meeting_lawyer_id' },
        { id: 'expert', title: 'Expert', assignee: '---', fieldName: 'expert', legacyFieldName: 'expert_id' },
        { id: 'closer', title: 'Closer', assignee: '---', fieldName: 'closer', legacyFieldName: 'closer_id' },
        { id: 'handler', title: 'Handler', assignee: '---', fieldName: 'handler', legacyFieldName: 'case_handler_id' },
      ];
    }

    return [
      {
        id: 'scheduler',
        title: 'Scheduler',
        assignee: isLegacyLead ? getEmployeeDisplayName((client as any).meeting_scheduler_id, employeesToUse) : client.scheduler || '---',
        fieldName: 'scheduler',
        legacyFieldName: 'meeting_scheduler_id'
      },
      {
        id: 'manager',
        title: 'Manager',
        assignee: isLegacyLead
          ? getEmployeeDisplayName((client as any).meeting_manager_id, employeesToUse)
          : getEmployeeDisplayName((client as any).manager, employeesToUse) || '---',
        fieldName: 'manager',
        legacyFieldName: 'meeting_manager_id'
      },
      {
        id: 'helper',
        title: 'Helper',
        assignee: isLegacyLead
          ? getEmployeeDisplayName((client as any).meeting_lawyer_id, employeesToUse)
          : getEmployeeDisplayName((client as any).helper, employeesToUse) || '---',
        fieldName: 'helper',
        legacyFieldName: 'meeting_lawyer_id'
      },
      {
        id: 'expert',
        title: 'Expert',
        assignee: isLegacyLead
          ? getEmployeeDisplayName((client as any).expert_id, employeesToUse)
          : getEmployeeDisplayName((client as any).expert, employeesToUse) || '---',
        fieldName: 'expert',
        legacyFieldName: 'expert_id'
      },
      {
        id: 'closer',
        title: 'Closer',
        assignee: (() => {
          if (isLegacyLead) {
            return getEmployeeDisplayName((client as any).closer_id, employeesToUse);
          }
          // For new leads, closer is saved as display_name (text) or potentially as ID
          const closer = client.closer;
          if (!closer || closer === '---' || closer === '--') {
            return '---';
          }
          // If it's numeric, treat as ID and convert to display name
          if (/^\d+$/.test(String(closer).trim())) {
            return getEmployeeDisplayName(Number(closer), employeesToUse);
          }
          // Otherwise, it's already a display name, but verify it exists in employees
          const employee = employeesToUse.find((emp: any) =>
            emp.display_name && emp.display_name.trim() === String(closer).trim()
          );
          // If found, return the display name; otherwise return as-is (might be a name not in our list)
          return employee ? employee.display_name : closer;
        })(),
        fieldName: 'closer',
        legacyFieldName: 'closer_id'
      },
      {
        id: 'handler',
        title: 'Handler',
        assignee: isLegacyLead
          ? getEmployeeDisplayName((client as any).case_handler_id, employeesToUse)
          : (() => {
            // For new leads: handler can be stored as employee_id in handler column OR as display_name
            // Also check case_handler_id if available
            const handlerId = (client as any).case_handler_id || (client as any).handler;
            const handlerValue = (client as any).handler;

            // If case_handler_id exists, use it (most reliable)
            if ((client as any).case_handler_id) {
              return getEmployeeDisplayName((client as any).case_handler_id, employeesToUse);
            }

            // If handler is numeric (employee ID), map it
            if (handlerValue && (typeof handlerValue === 'number' || (typeof handlerValue === 'string' && !isNaN(Number(handlerValue)) && handlerValue.toString().trim() !== ''))) {
              return getEmployeeDisplayName(handlerValue, employeesToUse);
            }

            // Otherwise, assume handler is already a display name
            return handlerValue || '---';
          })(),
        fieldName: 'handler',
        legacyFieldName: 'case_handler_id'
      },
    ];
  }, [client, isLegacyLead, allEmployeesProp, allEmployees, getEmployeeDisplayName]);

  // Sync local allEmployees state with prop when it changes
  useEffect(() => {
    if (allEmployeesProp && allEmployeesProp.length > 0) {
      setAllEmployees(allEmployeesProp);
    }
  }, [allEmployeesProp]);

  // Use computed roles as the source of truth - initialize state with computed roles
  const [roles, setRoles] = useState<Role[]>(computedRoles);
  const [isEditing, setIsEditing] = useState(false);
  const [originalRoles, setOriginalRoles] = useState<Role[]>(computedRoles);
  const [isRolesLocked, setIsRolesLocked] = useState<boolean>(false);
  const [isSuperuser, setIsSuperuser] = useState<boolean>(false);

  // Update roles state when computed roles change
  useEffect(() => {
    setRoles(computedRoles);
    setOriginalRoles(computedRoles);
  }, [computedRoles]);

  // Update locked status from client data
  useEffect(() => {
    if (isLegacyLead) {
      // For legacy leads, sales_roles_locked is text ('true' or 'false')
      const lockedValue = (client as any).sales_roles_locked;
      setIsRolesLocked(lockedValue === 'true' || lockedValue === true);
    } else {
      // For new leads, sales_roles_locked is boolean
      setIsRolesLocked((client as any).sales_roles_locked === true);
    }
  }, [client, isLegacyLead]);

  // Update employee options when employees are available (from prop or local state)
  useEffect(() => {
    if (allEmployees && allEmployees.length > 0) {
      // Include all employees in all dropdowns, filter out "Not assigned"
      const allEmployeeNames = allEmployees
        .map((emp: any) => emp.display_name)
        .filter(Boolean)
        .filter((name: string) => name.toLowerCase() !== 'not assigned');
      setAllEmployeeOptions(['---', ...allEmployeeNames]);
    } else if (allEmployeesProp && allEmployeesProp.length > 0) {
      // Fallback: use prop if local state is empty
      const allEmployeeNames = allEmployeesProp
        .map((emp: any) => emp.display_name)
        .filter(Boolean)
        .filter((name: string) => name.toLowerCase() !== 'not assigned');
      setAllEmployeeOptions(['---', ...allEmployeeNames]);
    } else {
      // Only fetch if not provided via prop
      const fetchEmployees = async () => {
        const { data, error } = await supabase
          .from('tenants_employee')
          .select('id, display_name, photo_url, photo')
          .order('display_name', { ascending: true });

        if (!error && data) {
          setAllEmployees(data);
          // Include all employees in all dropdowns, filter out "Not assigned"
          const allEmployeeNames = data
            .map((emp: any) => emp.display_name)
            .filter(Boolean)
            .filter((name: string) => name.toLowerCase() !== 'not assigned');
          setAllEmployeeOptions(['---', ...allEmployeeNames]);
        }
      };
      fetchEmployees();
    }
  }, [allEmployees, allEmployeesProp]);

  // Fetch current user's superuser status
  useEffect(() => {
    const fetchSuperuserStatus = async () => {
      try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
          setIsSuperuser(false);
          return;
        }

        // Try to find user by auth_id first
        let { data: userData, error } = await supabase
          .from('users')
          .select('is_superuser')
          .eq('auth_id', user.id)
          .maybeSingle();

        // If not found by auth_id, try by email
        if (!userData && user.email) {
          const { data: userByEmail, error: emailError } = await supabase
            .from('users')
            .select('is_superuser')
            .eq('email', user.email)
            .maybeSingle();

          userData = userByEmail;
          error = emailError;
        }

        if (!error && userData) {
          // Check if user is superuser (handle boolean, string, or number)
          const superuserStatus = userData.is_superuser === true ||
            userData.is_superuser === 'true' ||
            userData.is_superuser === 1;
          setIsSuperuser(superuserStatus);
        } else {
          setIsSuperuser(false);
        }
      } catch (error) {
        console.error('Error fetching superuser status:', error);
        setIsSuperuser(false);
      }
    };

    fetchSuperuserStatus();
  }, []);

  const handleRoleChange = (roleId: string, newAssignee: string) => {
    setRoles(roles.map(role =>
      role.id === roleId ? { ...role, assignee: newAssignee } : role
    ));
    // Clear search term when an option is selected
    setSearchTerms(prev => ({ ...prev, [roleId]: '' }));
    setShowDropdowns(prev => ({ ...prev, [roleId]: false }));
  };

  const handleSearchChange = (roleId: string, value: string) => {
    setSearchTerms(prev => ({ ...prev, [roleId]: value }));
    setShowDropdowns(prev => ({ ...prev, [roleId]: true }));
  };

  const handleShowDropdown = (roleId: string) => {
    setShowDropdowns(prev => ({ ...prev, [roleId]: true }));
  };

  const handleHideDropdown = (roleId: string) => {
    setTimeout(() => {
      setShowDropdowns(prev => ({ ...prev, [roleId]: false }));
    }, 200);
  };

  // Get filtered options for a role based on search term
  const getFilteredOptions = (roleId: string) => {
    const searchTerm = searchTerms[roleId] || '';
    const currentAssignee = roles.find(r => r.id === roleId)?.assignee || '';

    // Filter options based on search term, and exclude "Not assigned"
    let filtered = allEmployeeOptions.filter(opt =>
      opt.toLowerCase() !== 'not assigned'
    );
    if (searchTerm) {
      filtered = filtered.filter(opt =>
        opt.toLowerCase().includes(searchTerm.toLowerCase()) || opt === '---'
      );
    }

    // Always include "---" at the top for unassigning
    const unassignOption = ['---'];
    const otherOptions = filtered.filter(opt => opt !== '---');

    // If there's a current assignee and it's not in the filtered list, add it (but not if it's "Not assigned")
    if (currentAssignee &&
      currentAssignee !== '---' &&
      currentAssignee.toLowerCase() !== 'not assigned' &&
      !otherOptions.includes(currentAssignee)) {
      return [...unassignOption, currentAssignee, ...otherOptions];
    }

    return [...unassignOption, ...otherOptions];
  };

  const handleSaveRoles = async () => {
    try {
      // Helper function to convert display name back to employee ID
      const getEmployeeIdFromDisplayName = (displayName: string) => {
        if (displayName === '---' || !displayName || displayName.trim() === '') return null;

        // Try exact match first
        let employee = allEmployees.find((emp: any) =>
          emp.display_name && emp.display_name.trim() === displayName.trim()
        );

        // If not found, try case-insensitive match
        if (!employee) {
          employee = allEmployees.find((emp: any) =>
            emp.display_name && emp.display_name.trim().toLowerCase() === displayName.trim().toLowerCase()
          );
        }

        if (!employee) {
          console.warn(`Employee not found for display name: "${displayName}"`);
          console.log('Available employees:', allEmployees.map((e: any) => e.display_name).filter(Boolean));
          console.log('All employees data:', allEmployees);
          return null;
        }

        // Ensure ID is a number (bigint)
        const employeeId = typeof employee.id === 'string' ? parseInt(employee.id, 10) : Number(employee.id);
        if (isNaN(employeeId)) {
          console.error(`Invalid employee ID for "${displayName}":`, employee.id);
          return null;
        }

        return employeeId;
      };

      // Prepare update object with all role changes
      const updateData: any = {};
      roles.forEach(role => {
        if (isLegacyLead && role.legacyFieldName) {
          // For legacy leads, convert display name back to employee ID (bigint)
          const employeeId = getEmployeeIdFromDisplayName(role.assignee);
          updateData[role.legacyFieldName] = employeeId;
          console.log(`Legacy role: ${role.legacyFieldName} = ${employeeId} (from "${role.assignee}")`);
        } else {
          // For new leads, check if this role needs ID conversion
          // Roles that need ID conversion: manager, expert, helper
          const rolesNeedingIdConversion = ['manager', 'expert', 'helper'];
          if (rolesNeedingIdConversion.includes(role.id)) {
            // Convert display name to employee ID for these roles
            const employeeId = getEmployeeIdFromDisplayName(role.assignee);
            updateData[role.fieldName] = employeeId;
            console.log(`New lead role (ID): ${role.fieldName} = ${employeeId} (from "${role.assignee}")`);
          } else {
            // For other roles (scheduler, closer, handler), use display name as string
            // Save null when "---" or "Not assigned" is selected, otherwise save the display name
            const assigneeValue = role.assignee;
            const shouldSaveNull = assigneeValue === '---' ||
              !assigneeValue ||
              assigneeValue.trim() === '' ||
              assigneeValue.toLowerCase() === 'not assigned';

            updateData[role.fieldName] = shouldSaveNull ? null : assigneeValue;

            // For handler role, also clear case_handler_id when unassigning
            if (role.id === 'handler' && shouldSaveNull) {
              updateData['case_handler_id'] = null;
            }

            console.log(`New lead role (string): ${role.fieldName} = ${updateData[role.fieldName]}`);
          }
        }
      });

      console.log('Update data for save:', updateData);
      console.log('Is legacy lead:', isLegacyLead);
      console.log('Client ID:', client.id);

      let error;
      if (isLegacyLead) {
        // Update legacy lead in leads_lead table
        const legacyId = client.id.toString().replace('legacy_', '');
        // Ensure legacyId is a number if it's numeric
        const numericLegacyId = /^\d+$/.test(legacyId) ? parseInt(legacyId, 10) : legacyId;
        console.log('Updating legacy lead with ID:', numericLegacyId);

        const { data, error: legacyError } = await supabase
          .from('leads_lead')
          .update(updateData)
          .eq('id', numericLegacyId);

        console.log('Legacy update result:', { data, error: legacyError });
        error = legacyError;
      } else {
        // Update new lead in leads table
        console.log('Updating new lead with ID:', client.id);
        const { data, error: newError } = await supabase
          .from('leads')
          .update(updateData)
          .eq('id', client.id);

        console.log('New lead update result:', { data, error: newError });
        error = newError;
      }

      if (error) {
        console.error('Update error:', error);
        throw error;
      }

      setOriginalRoles([...roles]);
      setIsEditing(false);
      // Clear search terms after saving
      setSearchTerms({});
      setShowDropdowns({});

      toast.success('Roles saved successfully');

      // Refresh client data in parent component
      if (onClientUpdate) {
        await onClientUpdate();
      }
    } catch (error: any) {
      console.error('Error saving roles:', error);
      const errorMessage = error?.message || error?.details || 'Failed to save roles';
      toast.error(`Failed to save roles: ${errorMessage}`);
      console.error('Full error details:', error);
    }
  };

  const handleCancelEdit = () => {
    setRoles([...originalRoles]);
    setIsEditing(false);
    // Clear search terms when canceling
    setSearchTerms({});
    setShowDropdowns({});
  };

  const handleStartEditing = () => {
    if (isRolesLocked) {
      toast.error('Roles are locked. Please unlock roles first.');
      return;
    }
    setIsEditing(true);
    // Initialize search terms with current assignees
    const initialSearchTerms: { [key: string]: string } = {};
    roles.forEach(role => {
      initialSearchTerms[role.id] = '';
    });
    setSearchTerms(initialSearchTerms);
  };

  const handleToggleLock = async () => {
    try {
      const newLockStatus = !isRolesLocked;
      const tableName = isLegacyLead ? 'leads_lead' : 'leads';
      const idField = isLegacyLead ? 'id' : 'id';
      const clientId = isLegacyLead
        ? client.id.toString().replace('legacy_', '')
        : client.id;

      const updateData: any = {};

      if (isLegacyLead) {
        // For legacy leads, sales_roles_locked is text
        updateData.sales_roles_locked = newLockStatus ? 'true' : 'false';
      } else {
        // For new leads, sales_roles_locked is boolean
        updateData.sales_roles_locked = newLockStatus;
      }

      const { error } = await supabase
        .from(tableName)
        .update(updateData)
        .eq(idField, isLegacyLead ? parseInt(clientId as string, 10) : clientId);

      if (error) {
        console.error('Error toggling lock:', error);
        throw error;
      }

      setIsRolesLocked(newLockStatus);
      toast.success(newLockStatus ? 'Roles locked' : 'Roles unlocked');

      // If locking, cancel any active editing
      if (newLockStatus && isEditing) {
        handleCancelEdit();
      }

      // Refresh client data in parent component
      if (onClientUpdate) {
        await onClientUpdate();
      }
    } catch (error: any) {
      console.error('Error toggling roles lock:', error);
      const errorMessage = error?.message || error?.details || 'Failed to toggle lock';
      toast.error(`Failed to toggle lock: ${errorMessage}`);
    }
  };

  const handleSetMeAsCloser = async () => {
    if (isRolesLocked) {
      toast.error('Roles are locked. Please unlock roles first.');
      return;
    }
    try {
      // Get current user's employee info
      const actor = await fetchStageActorInfo();
      const currentEmployeeId = actor.employeeId;

      if (!currentEmployeeId) {
        toast.error('Unable to verify your employee status. Please contact an administrator.');
        return;
      }

      // Find the employee's display name
      const currentEmployee = allEmployees.find((emp: any) => {
        const empId = typeof emp.id === 'string' ? parseInt(emp.id, 10) : Number(emp.id);
        return !isNaN(empId) && empId === currentEmployeeId;
      });

      if (!currentEmployee || !currentEmployee.display_name) {
        toast.error('Employee information not found. Please contact an administrator.');
        return;
      }

      const employeeDisplayName = currentEmployee.display_name;
      let error;

      if (isLegacyLead) {
        // Update legacy lead in leads_lead table with employee ID
        const legacyId = client.id.toString().replace('legacy_', '');
        const numericLegacyId = /^\d+$/.test(legacyId) ? parseInt(legacyId, 10) : legacyId;

        const { error: legacyError } = await supabase
          .from('leads_lead')
          .update({ closer_id: currentEmployeeId })
          .eq('id', numericLegacyId);
        error = legacyError;
      } else {
        // Update new lead in leads table with display name (closer is stored as string for new leads)
        const { error: newError } = await supabase
          .from('leads')
          .update({ closer: employeeDisplayName })
          .eq('id', client.id);
        error = newError;
      }

      if (error) {
        console.error('Error setting closer:', error);
        throw error;
      }

      // Update local state
      const updatedRoles = roles.map(role =>
        role.id === 'closer' ? { ...role, assignee: employeeDisplayName } : role
      );
      setRoles(updatedRoles);
      setOriginalRoles(updatedRoles);

      toast.success('You have been set as the closer');

      // Refresh client data in parent component
      if (onClientUpdate) {
        await onClientUpdate();
      }
    } catch (error: any) {
      console.error('Error setting closer:', error);
      const errorMessage = error?.message || error?.details || 'Failed to set closer';
      toast.error(`Failed to set closer: ${errorMessage}`);
    }
  };

  // Function to get the appropriate icon for each role
  const getRoleIcon = (roleId: string) => {
    switch (roleId) {
      case 'scheduler':
        return CalendarIcon;
      case 'manager':
        return UserCircleIcon;
      case 'helper':
        return WrenchScrewdriverIcon;
      case 'expert':
        return AcademicCapIcon;
      case 'closer':
        return HandRaisedIcon;
      case 'handler':
        return CogIcon;
      default:
        return UserIcon;
    }
  };

  return (
    <div className="p-2 sm:p-4 md:p-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 rounded-lg flex items-center justify-center">
            <UserGroupIcon className="w-6 h-6 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-bold">Roles</h2>
              {isRolesLocked && (
                <LockClosedIcon className="w-5 h-5 text-gray-500" />
              )}
            </div>
            <p className="text-sm text-gray-500">
              {isRolesLocked ? 'Roles are locked and cannot be modified' : 'Manage team roles and assignments'}
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-row gap-2 sm:gap-4 flex-wrap">
          {/* Lock Button - Only visible for superusers */}
          {isSuperuser && (
            <button
              className={`btn gap-2 px-6 shadow-md hover:scale-105 transition-transform ${isRolesLocked
                ? 'btn-error text-white'
                : 'btn-ghost border border-gray-300'
                }`}
              onClick={handleToggleLock}
              title={isRolesLocked ? 'Unlock roles' : 'Lock roles'}
            >
              {isRolesLocked ? (
                <>
                  <LockClosedIcon className="w-5 h-5" />
                  Unlock Roles
                </>
              ) : (
                <>
                  <LockOpenIcon className="w-5 h-5" />
                  Lock Roles
                </>
              )}
            </button>
          )}

          {/* Set Roles and Set me as closer buttons - Hidden when locked */}
          {!isRolesLocked && (
            <>
              {isEditing ? (
                <>
                  <button
                    className="btn btn-primary gap-2 px-6 shadow-md hover:scale-105 transition-transform"
                    onClick={handleSaveRoles}
                  >
                    <CheckIcon className="w-5 h-5" />
                    Save Roles
                  </button>
                  <button
                    className="btn btn-ghost gap-2 px-6 border border-base-200 shadow-sm hover:bg-base-200/60 hover:scale-105 transition-transform"
                    onClick={handleCancelEdit}
                  >
                    <XMarkIcon className="w-5 h-5" />
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  className="btn btn-ghost border border-gray-300 gap-2 px-6 shadow-md hover:scale-105 transition-transform"
                  onClick={handleStartEditing}
                >
                  <PencilSquareIcon className="w-5 h-5" />
                  Set Roles
                </button>
              )}
              <button
                className="btn btn-ghost text-primary hover:bg-primary/10 gap-2 px-6 border border-primary/30 shadow-sm hover:scale-105 transition-transform"
                onClick={handleSetMeAsCloser}
              >
                <UserIcon className="w-5 h-5" />
                Set me as closer
              </button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {roles.map((role, idx) => {
          const hasAssignee = role.assignee && role.assignee !== '---';
          const initials = hasAssignee
            ? String(role.assignee).split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
            : '';

          return (
            <div
              key={role.id}
              className="bg-white border border-gray-200 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-200 overflow-visible"
            >
              {/* Title Section */}
              <div className="pl-6 pt-2 pb-2 w-2/5">
                <div className="flex items-center justify-between">
                  <h4 className="text-lg font-semibold text-black">{role.title}</h4>
                </div>
                <div className="border-b border-gray-200 mt-2"></div>
              </div>

              {/* Content Section */}
              <div className="p-6">
                <div className="flex items-center gap-4">
                  {/* Role Icon */}
                  <div className="w-12 h-12 rounded-full flex items-center justify-center bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600">
                    {React.createElement(getRoleIcon(role.id), { className: "w-6 h-6 text-white" })}
                  </div>

                  {/* Employee Avatar */}
                  {hasAssignee && (
                    <EmployeeAvatar employeeId={getEmployeeIdFromRole(role)} size="md" />
                  )}

                  {/* Assignee Name */}
                  <div className="flex-1 relative">
                    {isEditing && !isRolesLocked ? (
                      <div className="relative">
                        <input
                          type="text"
                          className="input input-bordered w-full max-w-xs font-semibold text-base"
                          placeholder={role.assignee === '---' ? '---' : 'Type to search...'}
                          value={searchTerms[role.id] !== undefined && searchTerms[role.id] !== ''
                            ? searchTerms[role.id]
                            : (role.assignee === '---' ? '' : role.assignee)}
                          onChange={(e) => handleSearchChange(role.id, e.target.value)}
                          onFocus={() => handleShowDropdown(role.id)}
                          onBlur={() => handleHideDropdown(role.id)}
                        />
                        {showDropdowns[role.id] && getFilteredOptions(role.id).length > 0 && (
                          <div className="absolute z-50 w-full max-w-xs mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto" style={{ top: '100%', left: 0 }}>
                            {getFilteredOptions(role.id).map((option: string, index: number) => (
                              <div
                                key={index}
                                className="px-4 py-2 cursor-pointer hover:bg-gray-100 text-sm"
                                onClick={() => handleRoleChange(role.id, option)}
                              >
                                {option}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className={`text-base font-semibold ${hasAssignee ? 'text-gray-900' : 'text-gray-500 italic'}`}>
                        {hasAssignee ? role.assignee : 'Unassigned'}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <TimelineHistoryButtons client={client} />
    </div>
  );
};

export default RolesTab; 