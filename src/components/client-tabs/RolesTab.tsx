import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClientTabProps } from '../../types/client';
import { UserGroupIcon, PencilSquareIcon, UserIcon, XMarkIcon, CalendarIcon, UserCircleIcon, AcademicCapIcon, HandRaisedIcon, WrenchScrewdriverIcon, CogIcon, LockClosedIcon, LockOpenIcon, BriefcaseIcon, BanknotesIcon, MegaphoneIcon } from '@heroicons/react/24/outline';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import { fetchStageActorInfo } from '../../lib/leadStageManager';
import { ClientTabPageHeader } from './ClientTabPageHeader';
import {
  clientsTabCacheLeadKey,
  readClientsTabCache,
  writeClientsTabCache,
} from '../../lib/clientsTabCache';
import {
  fetchLeadSubEffortContributors,
  type LeadSubEffortContributor,
} from '../../lib/leadSubEfforts';

/** Cached light slice for Roles — avoids re-flashing permission gate on remount. */
type RolesTabCacheSlice = {
  isSuperuser?: boolean;
};
/** Main sections + role card order in the Roles tab */
const ROLE_SECTIONS: { title: string; roleIds: string[] }[] = [
  { title: 'Sales', roleIds: ['scheduler', 'manager', 'helper', 'expert', 'closer'] },
  { title: 'Handlers', roleIds: ['handler', 'retainer_handler'] },
  { title: 'Finance', roleIds: ['collection_manager'] },
  { title: 'Marketing', roleIds: ['marketing_officer'] },
];

/** Role cards turned off in the UI (read-only; not persisted from this tab) */
const DISABLED_ROLE_IDS = new Set<string>(['collection_manager', 'marketing_officer']);

interface Role {
  id: string;
  title: string;
  assignee: string;
  fieldName: string;
  legacyFieldName?: string; // For legacy leads
}

// Will be replaced by real users from DB
const defaultAssignees = ['---'];

const RolesTab: React.FC<ClientTabProps> = ({
  client,
  onClientUpdate,
  allEmployees: allEmployeesProp = [],
  readOnly = false,
}) => {
  const navigate = useNavigate();
  const [allUsers, setAllUsers] = useState<{ full_name: string; role: string }[]>([]);
  // Use employees from prop (loaded in parent) or fallback to local state
  const [allEmployees, setAllEmployees] = useState<any[]>(allEmployeesProp);
  const [allEmployeeOptions, setAllEmployeeOptions] = useState<string[]>([]);

  // Search terms and dropdown visibility for each role
  const [searchTerms, setSearchTerms] = useState<{ [key: string]: string }>({});
  const [showDropdowns, setShowDropdowns] = useState<{ [key: string]: boolean }>({});

  const [subEffortContributors, setSubEffortContributors] = useState<LeadSubEffortContributor[]>([]);
  const [subEffortContributorsLoading, setSubEffortContributorsLoading] = useState(false);

  // Check if this is a legacy lead
  const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
  const isUnassignedValue = (value: string | null | undefined): boolean => {
    if (!value) return true;
    const normalized = value.trim().toLowerCase().replace(/[\s_]+/g, ' ');
    return normalized === '' || normalized === '---' || normalized === '--' || normalized === 'not assigned';
  };

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

  const firstInitialChar = (word: string): string => {
    const match = word.match(/[\p{L}\p{N}]/u);
    return match?.[0] ?? '';
  };

  // Helper function to get employee initials
  const getEmployeeInitials = (name: string | null | undefined): string => {
    if (isUnassignedValue(name)) return '';
    const parts = (name ?? '').trim().split(/\s+/).filter((part) => part.length > 0);
    if (parts.length === 0) return '';
    if (parts.length >= 2) {
      return `${firstInitialChar(parts[0])}${firstInitialChar(parts[parts.length - 1])}`.toUpperCase();
    }
    const word = parts[0];
    const letters = [...word].filter((ch) => /[\p{L}\p{N}]/u.test(ch)).slice(0, 2).join('');
    return (letters || word.substring(0, 2)).toUpperCase();
  };

  // Helper to get employee ID from role assignee — ID columns first (new and legacy)
  const getEmployeeIdFromRole = (role: Role): string | number | null => {
    const employeesToUse = (allEmployeesProp && allEmployeesProp.length > 0) ? allEmployeesProp : allEmployees;

    if (role.legacyFieldName) {
      const raw = (client as any)[role.legacyFieldName];
      if (raw != null && String(raw).trim() !== '' && String(raw).trim() !== '---') {
        return raw;
      }
    }

    if (!role.assignee || role.assignee === '---') return null;

    const employee = employeesToUse.find((emp: any) => {
      return emp.display_name && emp.display_name.trim().toLowerCase() === role.assignee.trim().toLowerCase();
    });
    return employee?.id || null;
  };

  // Initials always paint; a photo only covers them after it actually loads.
  const EmployeeAvatar: React.FC<{
    employeeId: string | number | null | undefined;
    displayName?: string | null;
    size?: 'sm' | 'md' | 'lg';
  }> = ({ employeeId, displayName, size = 'md' }) => {
    const [imageError, setImageError] = useState(false);
    const [imageLoaded, setImageLoaded] = useState(false);
    const employee = getEmployeeById(employeeId) || getEmployeeById(displayName);
    const sizeClasses = size === 'sm' ? 'w-8 h-8 text-xs' : size === 'md' ? 'w-12 h-12 text-sm' : 'w-16 h-16 text-base';
    const name = employee?.display_name || employee?.official_name || displayName || '';
    const initials = getEmployeeInitials(name);
    const rawPhoto = employee?.photo_url || employee?.photo;
    const trimmedPhoto = rawPhoto != null ? String(rawPhoto).trim() : '';
    const photoUrl = !imageError && trimmedPhoto && trimmedPhoto !== 'null' && trimmedPhoto !== 'undefined'
      ? trimmedPhoto
      : null;

    useEffect(() => {
      setImageError(false);
      setImageLoaded(false);
    }, [employeeId, displayName]);

    if (!initials && !photoUrl) {
      return null;
    }

    return (
      <div
        className={`${sizeClasses} relative rounded-full flex items-center justify-center bg-gray-200 text-gray-600 font-medium flex-shrink-0 overflow-hidden cursor-pointer hover:opacity-80 transition-opacity`}
        onClick={() => {
          if (employee?.id) {
            navigate(`/my-profile/${employee.id}`);
          }
        }}
        title={name ? `View ${name}'s profile` : undefined}
      >
        {(!photoUrl || !imageLoaded) && initials}
        {photoUrl ? (
          <img
            src={photoUrl}
            alt=""
            className={`absolute inset-0 h-full w-full object-cover ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
            onLoad={() => setImageLoaded(true)}
            onError={() => {
              setImageError(true);
              setImageLoaded(false);
            }}
          />
        ) : null}
      </div>
    );
  };

  // Update local employees state when prop changes (employees are loaded in parent)
  useEffect(() => {
    if (allEmployeesProp && allEmployeesProp.length > 0) {
      setAllEmployees(allEmployeesProp);
    }
  }, [allEmployeesProp]);

  // Employees with saved sub-effort updates on this lead (Sub Efforts modal)
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!client?.id) {
        setSubEffortContributors([]);
        return;
      }
      setSubEffortContributorsLoading(true);
      try {
        const rows = await fetchLeadSubEffortContributors(supabase, client);
        if (!cancelled) setSubEffortContributors(rows);
      } catch (err) {
        console.error('Failed to load sub-effort contributors:', err);
        if (!cancelled) {
          setSubEffortContributors([]);
          toast.error('Failed to load sub-effort contributors');
        }
      } finally {
        if (!cancelled) setSubEffortContributorsLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [client?.id, client?.lead_type]);

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
        // Normalize "Not_assigned", "Not assigned", etc. to '---'
        const displayName = employee.display_name;
        if (displayName.toLowerCase() === 'not_assigned' || displayName.toLowerCase() === 'not assigned') {
          return '---';
        }
        return displayName;
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
        { id: 'retainer_handler', title: 'Retention Handler', assignee: '---', fieldName: 'retainer_handler', legacyFieldName: 'retainer_handler_id' },
        { id: 'collection_manager', title: 'Collection manager', assignee: '---', fieldName: 'meeting_collection_id', legacyFieldName: 'meeting_collection_id' },
        { id: 'marketing_officer', title: 'Marketing Officer', assignee: '---', fieldName: 'marketing_officer_id', legacyFieldName: 'marketing_officer_id' },
      ];
    }

    const legacyDisplay = (field: string) => {
      const v = (client as any)[field];
      if (v != null && String(v).trim() !== '' && String(v).trim() !== '---' && String(v).toLowerCase() !== 'not assigned') return String(v).trim();
      return null;
    };

    const resolveAssignee = (textValue: unknown, idValue: unknown) => {
      if (idValue != null && String(idValue).trim() !== '') {
        const fromId = getEmployeeDisplayName(idValue, employeesToUse);
        if (fromId && fromId !== '---') return fromId;
      }
      if (textValue == null) return '---';
      const text = String(textValue).trim();
      if (!text || text === '---' || text === '--' || /^not[_\s]?assigned$/i.test(text)) return '---';
      if (/^\d+$/.test(text)) return getEmployeeDisplayName(text, employeesToUse);
      const employee = employeesToUse.find((emp: any) =>
        emp.display_name && emp.display_name.trim().toLowerCase() === text.toLowerCase()
      );
      return employee?.display_name || text;
    };

    return [
      {
        id: 'scheduler',
        title: 'Scheduler',
        assignee: (() => {
          if (isLegacyLead) {
            const fromJoin = legacyDisplay('scheduler');
            if (fromJoin) {
              if (/^\d+$/.test(fromJoin)) {
                return getEmployeeDisplayName(fromJoin, employeesToUse);
              }
              return fromJoin;
            }
            return getEmployeeDisplayName((client as any).meeting_scheduler_id, employeesToUse);
          }
          return resolveAssignee(client.scheduler, (client as any).meeting_scheduler_id);
        })(),
        fieldName: 'scheduler',
        legacyFieldName: 'meeting_scheduler_id'
      },
      {
        id: 'manager',
        title: 'Manager',
        assignee: isLegacyLead
          ? (legacyDisplay('manager') ?? getEmployeeDisplayName((client as any).meeting_manager_id, employeesToUse))
          : resolveAssignee((client as any).manager, (client as any).meeting_manager_id),
        fieldName: 'manager',
        legacyFieldName: 'meeting_manager_id'
      },
      {
        id: 'helper',
        title: 'Helper',
        assignee: isLegacyLead
          ? getEmployeeDisplayName((client as any).meeting_lawyer_id, employeesToUse)
          : resolveAssignee((client as any).helper, (client as any).meeting_lawyer_id),
        fieldName: 'helper',
        legacyFieldName: 'meeting_lawyer_id'
      },
      {
        id: 'expert',
        title: 'Expert',
        assignee: isLegacyLead
          ? (legacyDisplay('expert') ?? getEmployeeDisplayName((client as any).expert_id, employeesToUse))
          : resolveAssignee((client as any).expert, (client as any).expert_id),
        fieldName: 'expert',
        legacyFieldName: 'expert_id'
      },
      {
        id: 'closer',
        title: 'Closer',
        assignee: (() => {
          if (isLegacyLead) {
            return legacyDisplay('closer') ?? getEmployeeDisplayName((client as any).closer_id, employeesToUse);
          }
          return resolveAssignee(client.closer, (client as any).closer_id);
        })(),
        fieldName: 'closer',
        legacyFieldName: 'closer_id'
      },
      {
        id: 'handler',
        title: 'Handler',
        assignee: isLegacyLead
          ? (() => {
            const fromJoin = legacyDisplay('handler');
            if (fromJoin) return fromJoin;
            const handlerDisplayName = getEmployeeDisplayName((client as any).case_handler_id, employeesToUse);
            if (!handlerDisplayName || handlerDisplayName === '---' || handlerDisplayName.toLowerCase() === 'not_assigned' || handlerDisplayName.toLowerCase() === 'not assigned') return '---';
            return handlerDisplayName;
          })()
          : resolveAssignee((client as any).handler, (client as any).case_handler_id),
        fieldName: 'handler',
        legacyFieldName: 'case_handler_id'
      },
      {
        id: 'retainer_handler',
        title: 'Retention Handler',
        assignee: isLegacyLead
          ? getEmployeeDisplayName((client as any).retainer_handler_id, employeesToUse)
          : getEmployeeDisplayName((client as any).retainer_handler_id, employeesToUse) || '---',
        fieldName: 'retainer_handler',
        legacyFieldName: 'retainer_handler_id'
      },
      {
        id: 'collection_manager',
        title: 'Collection manager',
        assignee: getEmployeeDisplayName((client as any).meeting_collection_id, employeesToUse) || '---',
        fieldName: 'meeting_collection_id',
        legacyFieldName: 'meeting_collection_id'
      },
      {
        id: 'marketing_officer',
        title: 'Marketing Officer',
        assignee: getEmployeeDisplayName((client as any).marketing_officer_id, employeesToUse) || '---',
        fieldName: 'marketing_officer_id',
        legacyFieldName: 'marketing_officer_id'
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
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [originalRoles, setOriginalRoles] = useState<Role[]>(computedRoles);
  const [isRolesLocked, setIsRolesLocked] = useState<boolean>(false);
  const rolesLeadKey = clientsTabCacheLeadKey(client);
  const cachedRolesTabData = readClientsTabCache<RolesTabCacheSlice>(rolesLeadKey, 'roles');
  const [isSuperuser, setIsSuperuser] = useState<boolean>(() => cachedRolesTabData?.isSuperuser ?? false);

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
          writeClientsTabCache(rolesLeadKey, 'roles', { isSuperuser: superuserStatus });
        } else {
          setIsSuperuser(false);
          writeClientsTabCache(rolesLeadKey, 'roles', { isSuperuser: false });
        }
      } catch (error) {
        console.error('Error fetching superuser status:', error);
        setIsSuperuser(false);
      }
    };

    fetchSuperuserStatus();
  }, [rolesLeadKey]);

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

  const handleSaveRoles = async (rolesToSave?: Role[]) => {
    const rolesToUse = rolesToSave ?? roles;
    try {
      // Use the best available employee list (prop takes priority, falls back to local state)
      const employeesToSearch = (allEmployeesProp && allEmployeesProp.length > 0) ? allEmployeesProp : allEmployees;

      // Helper function to convert display name back to employee ID
      const getEmployeeIdFromDisplayName = (displayName: string) => {
        if (displayName === '---' || !displayName || displayName.trim() === '') return null;

        // Try exact match first
        let employee = employeesToSearch.find((emp: any) =>
          emp.display_name && emp.display_name.trim() === displayName.trim()
        );

        // If not found, try case-insensitive match
        if (!employee) {
          employee = employeesToSearch.find((emp: any) =>
            emp.display_name && emp.display_name.trim().toLowerCase() === displayName.trim().toLowerCase()
          );
        }

        if (!employee) {
          console.warn(`Employee not found for display name: "${displayName}"`);
          console.log('Available employees:', employeesToSearch.map((e: any) => e.display_name).filter(Boolean));
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
      let handlerAssigneeUnresolved: string | null = null;
      rolesToUse.forEach(role => {
        if (DISABLED_ROLE_IDS.has(role.id)) {
          return;
        }
        if (isLegacyLead && role.legacyFieldName) {
          // For legacy leads, convert display name back to employee ID (bigint)
          const employeeId = getEmployeeIdFromDisplayName(role.assignee);
          updateData[role.legacyFieldName] = employeeId;
          console.log(`Legacy role: ${role.legacyFieldName} = ${employeeId} (from "${role.assignee}")`);
        } else {
          // For new leads, check if this role needs ID conversion
          // Roles stored as employee IDs on new leads
          const rolesNeedingIdConversion = ['manager', 'expert', 'helper', 'retainer_handler', 'collection_manager', 'marketing_officer'];
          if (rolesNeedingIdConversion.includes(role.id)) {
            // Convert display name to employee ID for these roles
            const employeeId = getEmployeeIdFromDisplayName(role.assignee);
            // Map UI role id → DB column for id-backed fields
            const fieldName =
              role.id === 'retainer_handler' ? 'retainer_handler_id' : role.fieldName;
            updateData[fieldName] = employeeId;
            console.log(`New lead role (ID): ${fieldName} = ${employeeId} (from "${role.assignee}")`);
          } else {
            // For other roles (scheduler, closer, handler), use display name as string
            // Save null when "---" or "Not assigned" is selected, otherwise save the display name
            const assigneeValue = role.assignee;
            const shouldSaveNull = isUnassignedValue(assigneeValue);

            updateData[role.fieldName] = shouldSaveNull ? null : assigneeValue;

            // Handler: UI reads case_handler_id first; must stay in sync with display name (same pattern as retainer_handler_id).
            if (role.id === 'handler') {
              if (shouldSaveNull) {
                updateData.case_handler_id = null;
              } else {
                const hid = getEmployeeIdFromDisplayName(assigneeValue);
                if (hid == null) {
                  handlerAssigneeUnresolved = assigneeValue;
                } else {
                  updateData.case_handler_id = hid;
                }
              }
            }

            console.log(`New lead role (string): ${role.fieldName} = ${updateData[role.fieldName]}`);
          }
        }
      });

      if (handlerAssigneeUnresolved) {
        toast.error(`Could not resolve employee for handler: "${handlerAssigneeUnresolved}".`);
        return;
      }

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

      setOriginalRoles([...rolesToUse]);
      setIsEditing(false);
      setEditingRoleId(null);
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
    setEditingRoleId(null);
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

  const handleStartRowEdit = (roleId: string) => {
    if (isRolesLocked) {
      toast.error('Roles are locked. Please unlock roles first.');
      return;
    }
    setEditingRoleId(roleId);
    setSearchTerms(prev => ({ ...prev, [roleId]: '' }));
    setShowDropdowns(prev => ({ ...prev, [roleId]: true }));
  };

  const handleCancelRowEdit = () => {
    const rid = editingRoleId;
    if (rid) {
      const original = originalRoles.find(r => r.id === rid);
      if (original) {
        setRoles(roles.map(r => r.id === rid ? { ...r, assignee: original.assignee } : r));
      }
      setSearchTerms(prev => ({ ...prev, [rid]: '' }));
      setShowDropdowns(prev => ({ ...prev, [rid]: false }));
    }
    setEditingRoleId(null);
  };

  const handleRoleSelectAndSave = async (roleId: string, option: string) => {
    const newRoles = roles.map(role =>
      role.id === roleId ? { ...role, assignee: option } : role
    );
    setRoles(newRoles);
    setSearchTerms(prev => ({ ...prev, [roleId]: '' }));
    setShowDropdowns(prev => ({ ...prev, [roleId]: false }));
    setEditingRoleId(null);
    await handleSaveRoles(newRoles);
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
      if (newLockStatus && (isEditing || editingRoleId)) {
        handleCancelEdit();
        setEditingRoleId(null);
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
      case 'retainer_handler':
        return BriefcaseIcon;
      case 'collection_manager':
        return BanknotesIcon;
      case 'marketing_officer':
        return MegaphoneIcon;
      default:
        return UserIcon;
    }
  };

  return (
    <div className="p-1 sm:p-2 md:p-3">
      <div className="mb-3">
        <ClientTabPageHeader
          className="mb-0"
          icon={UserGroupIcon}
          title="Roles"
          subtitle={
            readOnly
              ? 'Team roles and assignments'
              : isRolesLocked
                ? 'Roles are locked and cannot be modified'
                : 'Manage team roles and assignments'
          }
          titleExtra={
            !readOnly && isSuperuser ? (
              <button
                type="button"
                className={`inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  isRolesLocked
                    ? 'bg-red-100 text-red-700 hover:bg-red-200'
                    : 'btn btn-ghost btn-sm h-auto min-h-0'
                }`}
                onClick={handleToggleLock}
                title={isRolesLocked ? 'Unlock roles' : 'Lock roles'}
              >
                {isRolesLocked ? (
                  <>
                    <LockClosedIcon className="w-4 h-4" />
                    Locked
                  </>
                ) : (
                  <>
                    <LockOpenIcon className="w-4 h-4" />
                    Lock Roles
                  </>
                )}
              </button>
            ) : isRolesLocked ? (
              <LockClosedIcon className="w-5 h-5 text-gray-500" />
            ) : undefined
          }
        />
      </div>

      <div className="w-full min-w-0">
        <div className="w-full space-y-10">
          {ROLE_SECTIONS.map((section) => (
            <div key={section.title}>
              <h3 className="text-lg font-semibold text-gray-900 mb-3">
                {section.title}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {section.roleIds.map((roleId) => {
                  const role = roles.find((r) => r.id === roleId);
                  if (!role) return null;
                  const hasAssignee = role.assignee && role.assignee !== '---';
                  const isEditingRow = editingRoleId === role.id;
                  const roleUiDisabled = DISABLED_ROLE_IDS.has(role.id);

                  return (
                    <div
                      key={role.id}
                      className={`rounded-xl border-0 bg-white px-4 py-4 shadow-[0_4px_18px_rgba(20,24,40,0.04)] transition-shadow dark:bg-base-100 dark:shadow-[0_4px_18px_rgba(0,0,0,0.25)] ${
                        roleUiDisabled
                          ? 'opacity-45 pointer-events-none select-none'
                          : 'hover:shadow-[0_8px_24px_rgba(20,24,40,0.08)]'
                      }`}
                      aria-disabled={roleUiDisabled}
                      title={roleUiDisabled ? 'This role is temporarily unavailable' : undefined}
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <span className="inline-flex items-center gap-1.5 rounded-md bg-base-200 px-2.5 py-1 text-sm font-medium text-gray-700">
                          {React.createElement(getRoleIcon(role.id), { className: 'w-5 h-5 text-black shrink-0' })}
                          {role.title}
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                          {roleUiDisabled && (
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 bg-base-200 px-2 py-0.5 rounded">
                              Unavailable
                            </span>
                          )}
                          {!readOnly && !isRolesLocked && !roleUiDisabled && (
                            isEditingRow ? (
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm btn-square h-9 w-9 min-h-0"
                                onClick={handleCancelRowEdit}
                                title="Cancel"
                              >
                                <XMarkIcon className="w-5 h-5" />
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm btn-square h-9 w-9 min-h-0"
                                onClick={() => handleStartRowEdit(role.id)}
                                title="Edit"
                              >
                                <PencilSquareIcon className="w-5 h-5" />
                              </button>
                            )
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        {hasAssignee ? (
                          <EmployeeAvatar employeeId={getEmployeeIdFromRole(role)} displayName={role.assignee} size="md" />
                        ) : (
                          <div className="w-12 h-12 rounded-full flex items-center justify-center bg-gray-200 flex-shrink-0">
                            {React.createElement(getRoleIcon(role.id), { className: 'w-6 h-6 text-gray-500' })}
                          </div>
                        )}

                        <div className="flex-1 relative min-w-0">
                          {!readOnly && isEditingRow && !isRolesLocked && !roleUiDisabled ? (
                            <div className="relative">
                              <input
                                type="text"
                                className="input input-bordered w-full max-w-[280px] min-h-12 text-base"
                                placeholder={role.assignee === '---' ? '---' : 'Type to search...'}
                                value={searchTerms[role.id] !== undefined
                                  ? searchTerms[role.id]
                                  : (role.assignee === '---' ? '' : role.assignee)}
                                onChange={(e) => handleSearchChange(role.id, e.target.value)}
                                onFocus={() => handleShowDropdown(role.id)}
                                onBlur={() => handleHideDropdown(role.id)}
                                autoFocus
                              />
                              {showDropdowns[role.id] && getFilteredOptions(role.id).length > 0 && (
                                <div className="absolute z-50 w-full max-w-[280px] mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto" style={{ top: '100%', left: 0 }}>
                                  {getFilteredOptions(role.id).map((option: string, index: number) => (
                                    <div
                                      key={index}
                                      className="px-4 py-2 cursor-pointer hover:bg-gray-100 text-sm"
                                      onClick={() => handleRoleSelectAndSave(role.id, option)}
                                    >
                                      {option}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className={`text-base ${hasAssignee ? 'text-gray-900 font-medium' : 'text-gray-500 italic'}`}>
                              {hasAssignee ? role.assignee : 'Unassigned'}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-3">
              Sub efforts by employee
            </h3>
            <div className="rounded-xl border-0 bg-white px-4 py-4 shadow-[0_4px_18px_rgba(20,24,40,0.04)] dark:bg-base-100 dark:shadow-[0_4px_18px_rgba(0,0,0,0.25)]">
              {subEffortContributorsLoading ? (
                <div className="flex items-center justify-center py-8 text-sm text-gray-500">
                  <span className="loading loading-spinner loading-sm mr-2" />
                  Loading sub efforts…
                </div>
              ) : subEffortContributors.length === 0 ? (
                <p className="py-6 text-sm text-gray-500 italic text-center">
                  No employees have updated sub efforts on this lead yet.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="table w-full">
                    <thead>
                      <tr>
                        <th className="bg-transparent">Employee</th>
                        <th className="bg-transparent">Sub efforts</th>
                        <th className="bg-transparent whitespace-nowrap">Effort %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {subEffortContributors.map((row) => {
                        const totalEffortPct = row.efforts.reduce(
                          (sum, effort) => sum + (effort.balancedPercentage ?? 0),
                          0,
                        );
                        const totalEffortLabel = Number.isInteger(totalEffortPct)
                          ? `${totalEffortPct}%`
                          : `${Math.round(totalEffortPct * 10) / 10}%`;
                        return (
                          <tr key={row.employeeName}>
                            <td className="align-middle">
                              <div className="flex items-center gap-3 min-w-0">
                                <EmployeeAvatar
                                  employeeId={row.employeeId}
                                  displayName={row.employeeName}
                                  size="md"
                                />
                                <span className="font-medium text-gray-900 truncate">
                                  {row.employeeName}
                                </span>
                              </div>
                            </td>
                            <td className="align-middle">
                              <div className="flex flex-wrap gap-2">
                                {row.efforts.map((effort) => (
                                  <div key={effort.title} className="inline-flex flex-col items-start gap-0.5">
                                    <span className="inline-flex items-center gap-2 rounded-md bg-base-200 px-3 py-1.5 text-sm font-medium text-gray-700">
                                      <span>{effort.title}</span>
                                      {effort.balancedPercentage != null && (
                                        <span className="tabular-nums text-gray-500">
                                          {Number.isInteger(effort.balancedPercentage)
                                            ? `${effort.balancedPercentage}%`
                                            : `${effort.balancedPercentage.toFixed(1)}%`}
                                        </span>
                                      )}
                                    </span>
                                    <span className="px-0.5 text-xs text-gray-500">
                                      {effort.lastUpdatedAt
                                        ? `Updated at ${new Date(effort.lastUpdatedAt).toLocaleDateString()}`
                                        : '—'}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </td>
                            <td className="align-middle whitespace-nowrap">
                              <span className="text-base font-semibold tabular-nums text-gray-900">
                                {totalEffortLabel}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

    </div>
  );
};

export default RolesTab; 