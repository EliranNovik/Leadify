import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import { convertToNIS } from '../lib/currencyConversion';
import { usePersistedFilters, usePersistedState } from '../hooks/usePersistedState';
import { ChevronDownIcon, ChevronRightIcon, EyeIcon, ChartBarIcon, UserGroupIcon, BuildingOfficeIcon, SpeakerWaveIcon, CurrencyDollarIcon, PencilIcon, CheckIcon, XMarkIcon, GlobeAltIcon, FlagIcon, BriefcaseIcon, HomeIcon, AcademicCapIcon, RocketLaunchIcon, MapPinIcon, DocumentTextIcon, ScaleIcon, ShieldCheckIcon, BanknotesIcon, CogIcon, HeartIcon, WrenchScrewdriverIcon, ClipboardDocumentListIcon, ExclamationTriangleIcon, UsersIcon, Squares2X2Icon } from '@heroicons/react/24/outline';
import EmployeeRoleLeadsModal from '../components/EmployeeRoleLeadsModal';
import { calculateSignedPortionAmount } from '../utils/rolePercentageCalculator';
import { 
  calculateEmployeeMetrics, 
  batchCalculateEmployeeMetrics,
  type EmployeeCalculationInput,
  type EmployeeCalculationResult 
} from '../utils/salesContributionCalculator';
import { calculateFieldViewDueByCategory } from '../utils/fieldViewDueCalculator';

interface EmployeeData {
  employeeId: number;
  employeeName: string;
  department: string;
  photoUrl?: string | null;
  signed: number;
  signedNormalized: number;
  dueNormalized: number;
  signedPortion: number;
  salaryBudget: number;
  salaryBrutto: number;
  totalSalaryCost: number;
  due: number;
  duePortion: number;
  total: number;
  totalPortionDue: number;
  percentOfIncome: number;
  normalized: number;
}

interface DepartmentData {
  departmentName: string;
  employees: EmployeeData[];
  totals: {
    signed: number;
    signedNormalized: number;
    dueNormalized: number;
    signedPortion: number;
    salaryBudget: number;
    salaryBrutto: number;
    totalSalaryCost: number;
    due: number;
    duePortion: number;
    total: number;
    totalPortionDue: number;
    percentOfIncome: number;
    normalized: number;
  };
}

const SalesContributionPage = () => {
  const navigate = useNavigate();

  // Helper function to format date as YYYY-MM-DD in local timezone
  const formatDateLocal = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const today = new Date();
  const firstDayOfMonth = formatDateLocal(new Date(today.getFullYear(), today.getMonth(), 1));
  const lastDayOfMonth = formatDateLocal(new Date(today.getFullYear(), today.getMonth() + 1, 0));

  const [filters, setFilters] = usePersistedFilters('salesContribution_filters', {
    fromDate: firstDayOfMonth,
    toDate: lastDayOfMonth,
  }, {
    storage: 'sessionStorage',
  });

  const [departmentData, setDepartmentData] = useState<Map<string, DepartmentData>>(new Map());
  const [fieldViewData, setFieldViewData] = useState<Map<string, DepartmentData>>(new Map());
  const [viewMode, setViewMode] = useState<'employee' | 'field'>('employee');
  const [loading, setLoading] = useState(false);
  const [isCalculating, setIsCalculating] = useState(false);
  const [allCategories, setAllCategories] = useState<any[]>([]);
  const [categoryNameToDataMap, setCategoryNameToDataMap] = useState<Map<string, any>>(new Map());
  const [categoriesLoaded, setCategoriesLoaded] = useState(false);
  const [searchPerformed, setSearchPerformed] = usePersistedState('salesContribution_performed', true, {
    storage: 'sessionStorage',
  });
  const [totalIncome, setTotalIncome] = usePersistedState('salesContribution_income', 0, {
    storage: 'sessionStorage',
  });
  const [dueNormalizedPercentage, setDueNormalizedPercentage] = usePersistedState('salesContribution_dueNormalizedPercentage', 0, {
    storage: 'sessionStorage',
  });
  const [employeeSearchTerm, setEmployeeSearchTerm] = useState('');

  // Define department names to match (must be before functions that use it)
  const departmentNames = ['Sales', 'Handlers', 'Partners', 'Marketing', 'Finance'];

  // Department percentage settings
  const [departmentPercentages, setDepartmentPercentages] = useState<Map<string, number>>(new Map());
  const [editingPercentage, setEditingPercentage] = useState<string | null>(null);
  const [tempPercentage, setTempPercentage] = useState<string>('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [loadingSettings, setLoadingSettings] = useState(false);

  // Role percentage settings
  const [rolePercentages, setRolePercentages] = useState<Map<string, number>>(new Map());
  const [tempRolePercentages, setTempRolePercentages] = useState<Map<string, string>>(new Map());
  const [showRolePercentagesModal, setShowRolePercentagesModal] = useState(false);
  const [savingRolePercentages, setSavingRolePercentages] = useState(false);
  const [loadingRolePercentages, setLoadingRolePercentages] = useState(false);


  // Fetch department percentages and income from database
  const fetchSettings = useCallback(async () => {
    setLoadingSettings(true);
    try {
      // Fetch department percentages
      const { data: departmentSettings, error: deptError } = await supabase
        .from('sales_contribution_settings')
        .select('department_name, percentage')
        .order('department_name');

      if (deptError) {
        console.error('Error fetching department percentages:', deptError);
        // If table doesn't exist, initialize with defaults
        const defaultPercentages = new Map<string, number>();
        departmentNames.forEach(dept => {
          defaultPercentages.set(dept, 0);
        });
        setDepartmentPercentages(defaultPercentages);
      } else if (departmentSettings) {
        const percentagesMap = new Map<string, number>();
        departmentSettings.forEach(setting => {
          percentagesMap.set(setting.department_name, Number(setting.percentage) || 0);
        });
        setDepartmentPercentages(percentagesMap);
      }

      // Fetch income setting - always load from database on initial load
      // Session storage will be checked first by usePersistedState, so we only update if DB has a value
      const { data: incomeSettings, error: incomeError } = await supabase
        .from('sales_contribution_income')
        .select('income_amount, due_normalized_percentage')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!incomeError && incomeSettings) {
        if (incomeSettings.income_amount !== null && incomeSettings.income_amount !== undefined) {
          const incomeAmount = Number(incomeSettings.income_amount);
          if (!isNaN(incomeAmount) && incomeAmount >= 0) {
            // Always set from database on initial load (fetchSettings only runs once)
            setTotalIncome(incomeAmount);
          }
        }
        if (incomeSettings.due_normalized_percentage !== null && incomeSettings.due_normalized_percentage !== undefined) {
          const duePercentage = Number(incomeSettings.due_normalized_percentage);
          if (!isNaN(duePercentage) && duePercentage >= 0 && duePercentage <= 100) {
            // Always set from database on initial load (fetchSettings only runs once)
            setDueNormalizedPercentage(duePercentage);
          }
        }
      }
    } catch (error) {
      console.error('Error fetching settings:', error);
    } finally {
      setLoadingSettings(false);
    }
  }, [departmentNames, setTotalIncome, totalIncome, setDueNormalizedPercentage]);

  // Fetch role percentages from database
  const fetchRolePercentages = useCallback(async () => {
    setLoadingRolePercentages(true);
    try {
      const { data: roleSettings, error: roleError } = await supabase
        .from('role_percentages')
        .select('role_name, percentage, description')
        .order('role_name');

      if (roleError) {
        console.error('Error fetching role percentages:', roleError);
        // Initialize with defaults if table doesn't exist
        const defaultRolePercentages = new Map<string, number>();
        defaultRolePercentages.set('CLOSER', 40);
        defaultRolePercentages.set('SCHEDULER', 30);
        defaultRolePercentages.set('MANAGER', 20);
        defaultRolePercentages.set('EXPERT', 10);
        defaultRolePercentages.set('HANDLER', 0);
        defaultRolePercentages.set('CLOSER_WITH_HELPER', 20);
        defaultRolePercentages.set('HELPER_CLOSER', 20);
        defaultRolePercentages.set('HELPER_HANDLER', 0);
        defaultRolePercentages.set('DEPARTMENT_MANAGER', 0);
        setRolePercentages(defaultRolePercentages);
      } else if (roleSettings && roleSettings.length > 0) {
        const percentagesMap = new Map<string, number>();
        roleSettings.forEach(setting => {
          percentagesMap.set(setting.role_name, Number(setting.percentage) || 0);
        });
        setRolePercentages(percentagesMap);
        // Initialize temp map with current values
        const tempMap = new Map<string, string>();
        roleSettings.forEach(setting => {
          tempMap.set(setting.role_name, setting.percentage.toString());
        });
        // Ensure all roles are in temp map
        const allRoles = ['CLOSER', 'SCHEDULER', 'MANAGER', 'EXPERT', 'HANDLER', 'CLOSER_WITH_HELPER', 'HELPER_CLOSER', 'HELPER_HANDLER', 'DEPARTMENT_MANAGER'];
        allRoles.forEach(role => {
          if (!tempMap.has(role)) {
            tempMap.set(role, '0');
          }
        });
        setTempRolePercentages(tempMap);
      } else {
        // No data in database, use defaults
        const defaultRolePercentages = new Map<string, number>();
        defaultRolePercentages.set('CLOSER', 40);
        defaultRolePercentages.set('SCHEDULER', 30);
        defaultRolePercentages.set('MANAGER', 20);
        defaultRolePercentages.set('EXPERT', 10);
        defaultRolePercentages.set('HANDLER', 0);
        defaultRolePercentages.set('CLOSER_WITH_HELPER', 20);
        defaultRolePercentages.set('HELPER_CLOSER', 20);
        defaultRolePercentages.set('HELPER_HANDLER', 0);
        defaultRolePercentages.set('DEPARTMENT_MANAGER', 0);
        setRolePercentages(defaultRolePercentages);
        // Initialize temp map with defaults
        const tempMap = new Map<string, string>();
        defaultRolePercentages.forEach((value, key) => {
          tempMap.set(key, value.toString());
        });
        setTempRolePercentages(tempMap);
      }
    } catch (error) {
      console.error('Error fetching role percentages:', error);
      toast.error('Failed to load role percentages');
    } finally {
      setLoadingRolePercentages(false);
    }
  }, []);

  // Helper function to generate a hash of role percentages for cache key
  const getRolePercentagesHash = useCallback((percentages: Map<string, number>): string => {
    const roleNames = ['CLOSER', 'SCHEDULER', 'MANAGER', 'EXPERT', 'HANDLER', 'CLOSER_WITH_HELPER', 'HELPER_CLOSER', 'HELPER_HANDLER', 'DEPARTMENT_MANAGER'];
    const values = roleNames.map(role => `${role}:${percentages.get(role) || 0}`).join('|');
    // Simple hash - just use the values string (could use a proper hash function if needed)
    return values;
  }, []);

  // Save role percentages to database
  const saveRolePercentages = useCallback(async () => {
    setSavingRolePercentages(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const userId = user?.id || null;

      const roleNames = ['CLOSER', 'SCHEDULER', 'MANAGER', 'EXPERT', 'HANDLER', 'CLOSER_WITH_HELPER', 'HELPER_CLOSER', 'HELPER_HANDLER', 'DEPARTMENT_MANAGER'];
      const savePromises = roleNames.map(async (roleName) => {
        // Get value from tempRolePercentages, fallback to rolePercentages, then to '0'
        const percentageStr = tempRolePercentages.get(roleName) || rolePercentages.get(roleName)?.toString() || '0';
        const percentage = parseFloat(percentageStr);

        if (isNaN(percentage) || percentage < 0 || percentage > 100) {
          throw new Error(`Invalid percentage for ${roleName}: ${percentageStr}`);
        }

        const { error } = await supabase
          .from('role_percentages')
          .upsert({
            role_name: roleName,
            percentage: percentage,
            updated_at: new Date().toISOString(),
            updated_by: userId,
          }, {
            onConflict: 'role_name'
          });

        if (error) {
          console.error(`Error saving percentage for ${roleName}:`, error);
          throw error;
        }

        // Update the actual role percentages map
        setRolePercentages(prev => {
          const updated = new Map(prev);
          updated.set(roleName, percentage);
          return updated;
        });
      });

      await Promise.all(savePromises);

      // Clear cache to force recalculation with new role percentages
      setRoleDataCache(new Map());

      // Trigger recalculation for all employees if we have data loaded
      if (departmentData.size > 0 && filters.fromDate && filters.toDate) {
        const allEmployeeIds: number[] = [];
        const employeeNamesMap = new Map<number, string>();
        departmentData.forEach(deptData => {
          deptData.employees.forEach(emp => {
            if (!allEmployeeIds.includes(emp.employeeId)) {
              allEmployeeIds.push(emp.employeeId);
              employeeNamesMap.set(emp.employeeId, emp.employeeName);
            }
          });
        });

        // Refetch role data for all employees in parallel batches
        // Note: fetchRoleData is accessed via closure (defined later in the file)
        // eslint-disable-next-line react-hooks/exhaustive-deps
        const refetchAll = async () => {
          const batchSize = 10;
          for (let i = 0; i < allEmployeeIds.length; i += batchSize) {
            const batch = allEmployeeIds.slice(i, i + batchSize);
            await Promise.all(
              batch.map(employeeId => {
                const employeeName = employeeNamesMap.get(employeeId) || '';
                return fetchRoleData(employeeId, employeeName).catch(err => {
                  console.error(`Error refetching role data for employee ${employeeId} after role percentages change:`, err);
                });
              })
            );
          }
        };

        // Trigger refetch in background (don't await)
        refetchAll();
      }

      toast.success('Role percentages saved successfully');
      setShowRolePercentagesModal(false);
    } catch (error: any) {
      console.error('Error saving role percentages:', error);
      toast.error(error.message || 'Failed to save role percentages');
    } finally {
      setSavingRolePercentages(false);
    }
  }, [tempRolePercentages, rolePercentages, departmentData, filters.fromDate, filters.toDate]);

  // Save department percentages and income to database
  const saveSettings = useCallback(async () => {
    setSavingSettings(true);
    try {
      // Get current user for tracking
      const { data: { user } } = await supabase.auth.getUser();
      const userId = user?.id || null;

      // Save department percentages
      const percentagePromises = departmentNames.map(async (deptName) => {
        const percentage = departmentPercentages.get(deptName) || 0;
        const { error } = await supabase
          .from('sales_contribution_settings')
          .upsert({
            department_name: deptName,
            percentage: percentage,
            updated_at: new Date().toISOString(),
            updated_by: userId,
          }, {
            onConflict: 'department_name'
          });

        if (error) {
          console.error(`Error saving percentage for ${deptName}:`, error);
          console.error('Error details:', JSON.stringify(error, null, 2));
          throw error;
        }
      });

      // Save income and due normalized percentage - get existing row first, then update or insert
      const { data: existingIncome } = await supabase
        .from('sales_contribution_income')
        .select('id')
        .limit(1)
        .maybeSingle();

      let incomeError;
      if (existingIncome?.id) {
        // Update existing row
        const { error } = await supabase
          .from('sales_contribution_income')
          .update({
            income_amount: totalIncome,
            due_normalized_percentage: dueNormalizedPercentage,
            updated_at: new Date().toISOString(),
            updated_by: userId,
          })
          .eq('id', existingIncome.id);
        incomeError = error;
      } else {
        // Insert new row (shouldn't happen, but handle it)
        const { error } = await supabase
          .from('sales_contribution_income')
          .insert({
            income_amount: totalIncome,
            due_normalized_percentage: dueNormalizedPercentage,
            updated_at: new Date().toISOString(),
            updated_by: userId,
          });
        incomeError = error;
      }

      if (incomeError) {
        console.error('Error saving income:', incomeError);
        console.error('Income error details:', JSON.stringify(incomeError, null, 2));
        throw incomeError;
      }

      await Promise.all(percentagePromises);
      toast.success('Settings saved successfully');

      // Recalculate signed portions for all employees after income change
      // Clear role data cache to force recalculation with new income
      // The cache key includes income, so clearing cache will force refetch with new income
      setRoleDataCache(new Map());
    } catch (error: any) {
      console.error('Error saving settings:', error);
      console.error('Error details:', JSON.stringify(error, null, 2));

      // Provide more specific error messages
      let errorMessage = 'Failed to save settings';
      if (error?.code === '42P01') {
        errorMessage = 'Database table does not exist. Please run the SQL migration.';
      } else if (error?.code === '42501') {
        errorMessage = 'Permission denied. Please check database permissions.';
      } else if (error?.message) {
        errorMessage = `Failed to save: ${error.message}`;
      }

      toast.error(errorMessage);
    } finally {
      setSavingSettings(false);
    }
  }, [departmentNames, departmentPercentages, totalIncome, dueNormalizedPercentage, filters.fromDate, filters.toDate, departmentData]);

  // Fetch all categories with their parent main category names (for mapping text categories)
  useEffect(() => {
    const fetchCategories = async () => {
      // Fetch categories
      const { data: categoriesData, error: categoriesError } = await supabase
        .from('misc_category')
        .select(`
          id,
          name,
          parent_id,
          misc_maincategory!parent_id (
            id,
            name
          )
        `)
        .order('name', { ascending: true });

      // Fetch main categories directly
      const { data: mainCategoriesData, error: mainCategoriesError } = await supabase
        .from('misc_maincategory')
        .select('id, name')
        .order('name', { ascending: true });

      if (!categoriesError && categoriesData) {
        setAllCategories(categoriesData);

        // Create a map from category name (normalized) to category data (including main category)
        const nameToDataMap = new Map<string, any>();
        
        // First, add all categories to the map
        categoriesData.forEach((category: any) => {
          if (category.name) {
            const normalizedName = category.name.trim().toLowerCase();
            nameToDataMap.set(normalizedName, category);
            
            // Also map the main category name if it exists
            const mainCategory = Array.isArray(category.misc_maincategory)
              ? category.misc_maincategory[0]
              : category.misc_maincategory;
            
            if (mainCategory && mainCategory.name) {
              const normalizedMainCategoryName = mainCategory.name.trim().toLowerCase();
              // Always add main category name mapping (even if same as category name)
              // This ensures we can match text categories that are main category names
              if (!nameToDataMap.has(normalizedMainCategoryName)) {
                nameToDataMap.set(normalizedMainCategoryName, category);
              }
            }
          }
        });
        
        // Also add main categories directly to the map
        // This helps when leads have text categories that match main category names exactly
        if (!mainCategoriesError && mainCategoriesData) {
          mainCategoriesData.forEach((mainCategory: any) => {
            if (mainCategory.name) {
              const normalizedMainCategoryName = mainCategory.name.trim().toLowerCase();
              
              // Find a category that belongs to this main category
              const categoryForMainCategory = categoriesData.find((cat: any) => {
                const catMainCategory = Array.isArray(cat.misc_maincategory)
                  ? cat.misc_maincategory[0]
                  : cat.misc_maincategory;
                return catMainCategory && catMainCategory.id === mainCategory.id;
              });
              
              // If we found a category, use it; otherwise create a synthetic entry
              if (categoryForMainCategory) {
                if (!nameToDataMap.has(normalizedMainCategoryName)) {
                  nameToDataMap.set(normalizedMainCategoryName, categoryForMainCategory);
                }
              } else {
                // Create a synthetic category entry for this main category
                const syntheticCategory = {
                  id: null,
                  name: mainCategory.name,
                  parent_id: mainCategory.id,
                  misc_maincategory: mainCategory
                };
                nameToDataMap.set(normalizedMainCategoryName, syntheticCategory);
              }
            }
          });
        }
        
        setCategoryNameToDataMap(nameToDataMap);
        setCategoriesLoaded(true);
        
        // Debug: Log the map size and sample keys
        console.log('🔍 Category Name to Data Map populated:', {
          size: nameToDataMap.size,
          sampleKeys: Array.from(nameToDataMap.keys()).slice(0, 30),
          hasSmallWithoutMeeting: nameToDataMap.has('small without meetin'),
          mainCategoriesCount: mainCategoriesData?.length || 0
        });
      } else {
        // Even if there's an error, mark as loaded so we don't wait forever
        setCategoriesLoaded(true);
      }
    };
    fetchCategories();
  }, []);

  // Load settings on mount (only once)
  const hasLoadedSettingsRef = useRef(false);
  useEffect(() => {
    if (!hasLoadedSettingsRef.current) {
      hasLoadedSettingsRef.current = true;
      fetchSettings();
      fetchRolePercentages();
    }
  }, [fetchRolePercentages]); // Only run once on mount

  // Update tempRolePercentages when rolePercentages changes and modal is open
  useEffect(() => {
    if (showRolePercentagesModal && rolePercentages.size > 0) {
      const tempMap = new Map<string, string>();
      rolePercentages.forEach((value, key) => {
        tempMap.set(key, value.toString());
      });
      // Ensure all roles are in temp map
      const allRoles = ['CLOSER', 'SCHEDULER', 'MANAGER', 'EXPERT', 'HANDLER', 'CLOSER_WITH_HELPER', 'HELPER_CLOSER', 'HELPER_HANDLER', 'DEPARTMENT_MANAGER'];
      allRoles.forEach(role => {
        if (!tempMap.has(role)) {
          tempMap.set(role, '0');
        }
      });
      setTempRolePercentages(tempMap);
    }
  }, [showRolePercentagesModal, rolePercentages]);

  const [totalSignedValue, setTotalSignedValue] = useState<number>(0);
  const totalSignedValueRef = useRef<number>(0);
  const [loadingSignedValue, setLoadingSignedValue] = useState<boolean>(false);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [roleDataCache, setRoleDataCache] = useState<Map<string, any[]>>(new Map());
  const [loadingRoleData, setLoadingRoleData] = useState<Set<string>>(new Set());
  const [categoryBreakdownCache, setCategoryBreakdownCache] = useState<Map<string, any[]>>(new Map());
  const [loadingCategoryBreakdown, setLoadingCategoryBreakdown] = useState<Set<string>>(new Set());
  const [modalOpen, setModalOpen] = useState(false);
  const [modalEmployeeId, setModalEmployeeId] = useState<number | null>(null);
  const [modalEmployeeName, setModalEmployeeName] = useState<string>('');
  const [modalRole, setModalRole] = useState<string>('');
  const [employeeMap, setEmployeeMap] = useState<Map<number, { display_name: string; department: string; photo_url?: string | null }>>(new Map());
  const imageErrorCache = useRef<Map<number, boolean>>(new Map());

  // Helper function to get employee initials
  const getEmployeeInitials = (name: string) => {
    if (!name) return '--';
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  // Employee Avatar component
  const EmployeeAvatar: React.FC<{
    employeeId: number;
    size?: 'sm' | 'md' | 'lg';
  }> = ({ employeeId, size = 'md' }) => {
    const [imageError, setImageError] = useState(false);
    const employee = employeeMap.get(employeeId);

    if (!employee) {
      const sizeClasses = size === 'sm' ? 'w-8 h-8' : size === 'md' ? 'w-10 h-10' : 'w-12 h-12';
      return (
        <div className={`${sizeClasses} rounded-full flex items-center justify-center bg-gray-200 text-gray-500 text-xs font-semibold`}>
          --
        </div>
      );
    }

    const photoUrl = employee.photo_url;
    const initials = getEmployeeInitials(employee.display_name);
    const sizeClasses = size === 'sm' ? 'w-8 h-8 text-xs' : size === 'md' ? 'w-10 h-10 text-sm' : 'w-12 h-12 text-base';

    // Check cache for image errors
    const cachedError = imageErrorCache.current.get(employeeId) || false;
    const hasError = cachedError || imageError;

    // If we know there's no photo URL or we have a cached error, show initials immediately
    if (hasError || !photoUrl) {
      return (
        <div className={`${sizeClasses} rounded-full flex items-center justify-center bg-green-100 text-green-700 font-semibold`}>
          {initials}
        </div>
      );
    }

    // Try to render image
    return (
      <img
        src={photoUrl}
        alt={employee.display_name}
        className={`${sizeClasses} rounded-full object-cover`}
        onError={(e) => {
          // Cache the error to prevent flickering on re-renders
          imageErrorCache.current.set(employeeId, true);
          setImageError(true);
        }}
      />
    );
  };

  // Fetch total signed value based on date filter - using same logic as Dashboard's agreement signed total column
  const fetchTotalSignedValue = useCallback(async () => {
    if (!filters.fromDate || !filters.toDate) {
      setTotalSignedValue(0);
      totalSignedValueRef.current = 0;
      return;
    }

    setLoadingSignedValue(true);
    try {
      // Use explicit UTC timestamps to include full day: from 00:00:00.000 to 23:59:59.999
      // IMPORTANT: Filter by sign date (when stage 60 was set), NOT creation date
      const fromDateTime = `${filters.fromDate}T00:00:00.000Z`;
      const toDateTime = `${filters.toDate}T23:59:59.999Z`;

      // Fetch legacy leads stage records (stage 60) - same as Dashboard
      const { data: legacyStageRecords, error: legacyStageError } = await supabase
        .from('leads_leadstage')
        .select('id, date, cdate, lead_id')
        .eq('stage', 60)
        .not('lead_id', 'is', null)
        .gte('date', fromDateTime)
        .lte('date', toDateTime);

      if (legacyStageError) {
        console.error('Error fetching legacy stage records:', legacyStageError);
      }

      // Fetch new leads stage records (stage 60) - same as Dashboard
      const { data: newLeadStageRecords, error: newLeadStageError } = await supabase
        .from('leads_leadstage')
        .select('id, date, cdate, newlead_id')
        .eq('stage', 60)
        .not('newlead_id', 'is', null)
        .gte('date', fromDateTime)
        .lte('date', toDateTime);

      if (newLeadStageError) {
        console.error('Error fetching new lead stage records:', newLeadStageError);
      }

      // Deduplicate legacy leads - keep only latest date for each lead_id (same as Dashboard)
      const legacyRecordsMap = new Map<number, any>();
      (legacyStageRecords || []).forEach(record => {
        if (!record.lead_id) return;
        const leadId = record.lead_id;
        const recordDate = record.date || record.cdate;
        if (!recordDate) return;

        const existingRecord = legacyRecordsMap.get(leadId);
        if (!existingRecord) {
          legacyRecordsMap.set(leadId, record);
        } else {
          const existingDate = existingRecord.date || existingRecord.cdate;
          if (existingDate && new Date(recordDate) > new Date(existingDate)) {
            legacyRecordsMap.set(leadId, record);
          }
        }
      });

      // Deduplicate new leads - keep only latest date for each newlead_id (same as Dashboard)
      const newLeadRecordsMap = new Map<string, any>();
      (newLeadStageRecords || []).forEach(record => {
        if (!record.newlead_id) return;
        const newLeadId = String(record.newlead_id);
        const recordDate = record.date || record.cdate;
        if (!recordDate) return;

        const existingRecord = newLeadRecordsMap.get(newLeadId);
        if (!existingRecord) {
          newLeadRecordsMap.set(newLeadId, record);
        } else {
          const existingDate = existingRecord.date || existingRecord.cdate;
          if (existingDate && new Date(recordDate) > new Date(existingDate)) {
            newLeadRecordsMap.set(newLeadId, record);
          }
        }
      });

      // Fetch legacy leads data - include total_base and subcontractor_fee (same as Dashboard)
      const legacyLeadIds = Array.from(legacyRecordsMap.keys());
      let legacyLeadsData: any[] = [];
      if (legacyLeadIds.length > 0) {
        const { data: legacyLeads, error: legacyLeadsError } = await supabase
          .from('leads_lead')
          .select(`
            id, total, total_base, currency_id, subcontractor_fee, meeting_total_currency_id,
            accounting_currencies!leads_lead_currency_id_fkey(iso_code, name)
          `)
          .in('id', legacyLeadIds);

        if (!legacyLeadsError && legacyLeads) {
          legacyLeadsData = legacyLeads;
        }
      }

      // Fetch new leads data - include subcontractor_fee (same as Dashboard)
      const newLeadIds = Array.from(newLeadRecordsMap.keys());
      let newLeadsData: any[] = [];
      if (newLeadIds.length > 0) {
        const { data: newLeads, error: newLeadsError } = await supabase
          .from('leads')
          .select(`
            id, balance, proposal_total, currency_id, balance_currency, proposal_currency, subcontractor_fee,
            accounting_currencies!leads_currency_id_fkey(iso_code, name)
          `)
          .in('id', newLeadIds);

        if (!newLeadsError && newLeads) {
          newLeadsData = newLeads;
        }
      }

      // Helper functions from Dashboard logic
      const parseNumericAmount = (val: any): number => {
        if (typeof val === 'number') return val;
        if (typeof val === 'string') {
          const cleaned = val.replace(/[^0-9.-]/g, '');
          const parsed = parseFloat(cleaned);
          return Number.isNaN(parsed) ? 0 : parsed;
        }
        return 0;
      };

      const buildCurrencyMeta = (...candidates: any[]): { displaySymbol: string; conversionValue: string | number } => {
        for (const candidate of candidates) {
          if (candidate === null || candidate === undefined) continue;
          const rawValue = Array.isArray(candidate) ? candidate[0] : candidate;
          if (rawValue === null || rawValue === undefined) continue;

          if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
            // For currency IDs: 1=NIS, 2=USD, 3=EUR, 4=GBP
            const currencyMap: { [key: number]: string } = { 1: 'NIS', 2: 'USD', 3: 'EUR', 4: 'GBP' };
            return { displaySymbol: '₪', conversionValue: currencyMap[rawValue] || 'NIS' };
          }

          const valueStr = rawValue.toString().trim();
          if (!valueStr) continue;

          const numeric = Number(valueStr);
          if (!Number.isNaN(numeric) && numeric.toString() === valueStr) {
            const currencyMap: { [key: number]: string } = { 1: 'NIS', 2: 'USD', 3: 'EUR', 4: 'GBP' };
            return { displaySymbol: '₪', conversionValue: currencyMap[numeric] || 'NIS' };
          }

          const upper = valueStr.toUpperCase();
          if (upper === '₪' || upper === 'NIS' || upper === 'ILS') {
            return { displaySymbol: '₪', conversionValue: 'NIS' };
          }
          if (upper === 'USD' || valueStr === '$') {
            return { displaySymbol: '$', conversionValue: 'USD' };
          }
          if (upper === 'EUR' || valueStr === '€') {
            return { displaySymbol: '€', conversionValue: 'EUR' };
          }
          if (upper === 'GBP' || valueStr === '£') {
            return { displaySymbol: '£', conversionValue: 'GBP' };
          }
        }
        return { displaySymbol: '₪', conversionValue: 'NIS' };
      };

      // Calculate total signed value in NIS - using same logic as Dashboard
      let totalNIS = 0;

      // Process legacy leads - same logic as Dashboard
      legacyLeadsData.forEach(lead => {
        // For legacy leads: if currency_id is 1 (NIS/ILS), use total_base; otherwise use total
        const currencyId = lead.currency_id;
        const numericCurrencyId = typeof currencyId === 'string' ? parseInt(currencyId, 10) : Number(currencyId);
        let amount = 0;
        if (numericCurrencyId === 1) {
          // Use total_base for NIS/ILS currency
          amount = parseFloat(lead.total_base) || 0;
        } else {
          // Use total for other currencies
          amount = parseFloat(lead.total) || 0;
        }
        const amountInNIS = convertToNIS(amount, lead.currency_id);

        // Calculate and subtract subcontractor_fee (same as Dashboard)
        const subcontractorFee = parseNumericAmount(lead.subcontractor_fee) || 0;
        const currencyMeta = buildCurrencyMeta(lead.currency_id, lead.meeting_total_currency_id, lead.accounting_currencies);
        const subcontractorFeeNIS = convertToNIS(subcontractorFee, currencyMeta.conversionValue);
        const amountAfterFee = amountInNIS - subcontractorFeeNIS;

        totalNIS += amountAfterFee;
      });

      // Process new leads - same logic as Dashboard
      newLeadsData.forEach(lead => {
        // For new leads, use balance or proposal_total
        const amount = parseFloat(lead.balance) || parseFloat(lead.proposal_total) || 0;
        const amountInNIS = convertToNIS(amount, lead.currency_id);

        // Calculate and subtract subcontractor_fee (same as Dashboard)
        const subcontractorFee = parseNumericAmount(lead.subcontractor_fee) || 0;
        const currencyMeta = buildCurrencyMeta(lead.currency_id, lead.proposal_currency, lead.balance_currency);
        const subcontractorFeeNIS = convertToNIS(subcontractorFee, currencyMeta.conversionValue);
        const amountAfterFee = amountInNIS - subcontractorFeeNIS;

        totalNIS += amountAfterFee;
      });

      // Round up to match Dashboard behavior (Math.ceil)
      const finalValue = Math.ceil(totalNIS);
      setTotalSignedValue(finalValue);
      totalSignedValueRef.current = finalValue;
    } catch (error) {
      console.error('Error fetching total signed value:', error);
      setTotalSignedValue(0);
      totalSignedValueRef.current = 0;
    } finally {
      setLoadingSignedValue(false);
    }
  }, [filters.fromDate, filters.toDate]);

  // Auto-run search on mount to load data by default - but wait for categories to load first
  useEffect(() => {
    if (filters.fromDate && filters.toDate && categoriesLoaded) {
      handleSearch();
      fetchTotalSignedValue();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoriesLoaded]); // Run when categories are loaded

  // Fetch total signed value when date filters change
  useEffect(() => {
    if (filters.fromDate && filters.toDate) {
      // Clear role data cache when date filters change
      setRoleDataCache(new Map());
      fetchTotalSignedValue();
    }
  }, [filters.fromDate, filters.toDate, fetchTotalSignedValue]);

  const handleFilterChange = (field: string, value: any) => {
    setFilters(prev => ({ ...prev, [field]: value }));
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('he-IL', {
      style: 'currency',
      currency: 'ILS',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatPercent = (value: number) => {
    return `${value.toFixed(2)}%`;
  };

  // Fetch role data for an employee
  const fetchRoleData = useCallback(async (employeeId: number, employeeName: string) => {
    // Include date range, income, due normalized percentage, and role percentages hash in cache key to ensure data is refetched when any of these change
    const dateRangeKey = `${filters.fromDate || ''}_${filters.toDate || ''}`;
    const incomeKey = totalIncome || 0;
    const dueNormalizedPercentageKey = dueNormalizedPercentage || 0;
    const rolePercentagesHash = getRolePercentagesHash(rolePercentages);
    const employeeKey = `${employeeId}_${dateRangeKey}`;
    const cacheKey = `${employeeId}_${dateRangeKey}_${incomeKey}_${dueNormalizedPercentageKey}_${rolePercentagesHash}`;

    // Check cache - but always recalculate signed portion with current income
    // Skip only if we have cached data for this exact combination (date + income)
    const cachedData = roleDataCache.get(cacheKey);
    if (cachedData) {
      // Still update signed totals from cache (exclude "Handler only" rows)
      const totalSignedFromCache = cachedData.reduce((sum, roleItem) => {
        // Exclude "Handler only" from signed totals
        const isHandlerOnly = roleItem.role === 'Handler';
        return sum + (isHandlerOnly ? 0 : (roleItem.signedTotal || 0));
      }, 0);
      updateEmployeeSignedTotal(employeeId, totalSignedFromCache);

      // Recalculate signed/due normalized and salary budget from cached data
      // We need to recalculate these because totalSignedValue might have changed
      // Use ref to get the latest value
      const totalSignedOverallFromCache = totalSignedValueRef.current || 0;
      const incomeAmountFromCache = totalIncome || 0;
      let normalizationRatioFromCache = 1;
      if (incomeAmountFromCache > 0 && totalSignedOverallFromCache > 0 && incomeAmountFromCache < totalSignedOverallFromCache) {
        normalizationRatioFromCache = incomeAmountFromCache / totalSignedOverallFromCache;
      }

      // Fetch due amount for this employee (if they are a handler)
      const dueAmountFromCache = await fetchDueAmounts(employeeId, employeeName);

      // Signed normalized: only use signed amounts (no due)
      const signedNormalized = totalSignedFromCache * normalizationRatioFromCache;

      // Due normalized: use separate percentage from due_normalized_percentage
      const dueNormalizedPercentageValueFromCache = (dueNormalizedPercentage || 0) / 100; // Convert percentage to decimal
      const dueNormalized = dueAmountFromCache * dueNormalizedPercentageValueFromCache;

      // Calculate signed portion from cached role data
      // We need to recalculate this from the actual leads, but for now use a simplified approach
      // Actually, we should recalculate it properly, so let's continue with the fetch
      // But first update what we can from cache

      // Calculate due portion: Handler gets a percentage of due amounts
      const handlerPercentageFromCache = rolePercentages && rolePercentages.has('HANDLER')
        ? (rolePercentages.get('HANDLER')! / 100)
        : 0;
      const duePortionFromCache = dueAmountFromCache * handlerPercentageFromCache;

      setDepartmentData(prev => {
        const updated = new Map(prev);
        updated.forEach((deptData, deptName) => {
          const updatedEmployees = deptData.employees.map(emp => {
            if (emp.employeeId === employeeId) {
              // Note: We can't accurately calculate contribution from cache because we need
              // the raw totalSignedPortion which is calculated from individual leads.
              // Contribution will be recalculated in the full fetch below.
              // For now, just update the normalized values.
              return {
                ...emp,
                signed: totalSignedFromCache,
                due: dueAmountFromCache,
                signedNormalized: signedNormalized,
                dueNormalized: dueNormalized,
                // Keep existing signedPortion and salaryBudget - they will be updated in full fetch
              };
            }
            return emp;
          });

          // Recalculate department totals
          const deptSigned = updatedEmployees.reduce((sum, emp) => sum + emp.signed, 0);
          const deptDue = updatedEmployees.reduce((sum, emp) => sum + (emp.due || 0), 0);
          const deptSignedNormalized = updatedEmployees.reduce((sum, emp) => sum + (emp.signedNormalized || 0), 0);
          const deptDueNormalized = updatedEmployees.reduce((sum, emp) => sum + (emp.dueNormalized || 0), 0);
          const deptSignedPortion = updatedEmployees.reduce((sum, emp) => sum + emp.signedPortion, 0);
          const deptSalaryBudget = updatedEmployees.reduce((sum, emp) => sum + (emp.salaryBudget || 0), 0);

          updated.set(deptName, {
            ...deptData,
            employees: updatedEmployees,
            totals: {
              ...deptData.totals,
              signed: deptSigned,
              due: deptDue,
              signedNormalized: deptSignedNormalized,
              dueNormalized: deptDueNormalized,
              signedPortion: deptSignedPortion,
              salaryBudget: deptSalaryBudget,
            },
          });
        });
        return updated;
      });

      // Don't return early - we need to recalculate signed portion to ensure it's correct
      // Continue with the fetch to recalculate signed portion
    }

    // Use employee ID only for loading state (not date-specific)
    setLoadingRoleData(prev => {
      const newSet = new Set(prev);
      newSet.add(`${employeeId}`);
      return newSet;
    });

    try {
      // Define roles and their field mappings (fixed roles as requested)
      const roles = [
        { name: 'Closer', legacyField: 'closer_id', newField: 'closer' },
        { name: 'Scheduler', legacyField: 'meeting_scheduler_id', newField: 'scheduler' },
        { name: 'Helper Closer', legacyField: 'meeting_lawyer_id', newField: 'helper' },
        { name: 'Handler', legacyField: 'case_handler_id', newField: 'handler' },
        { name: 'Meeting Manager', legacyField: 'meeting_manager_id', newField: 'meeting_manager_id' },
        { name: 'Helper Handler', legacyField: null, newField: null }, // No direct field exists - will show 0
        { name: 'Expert', legacyField: 'expert_id', newField: 'expert' },
      ];

      const roleDataResults: any[] = [];

      // Step 1: Find signed leads (stage 60) in date range
      // IMPORTANT: Filter by sign date (when stage 60 was set), NOT creation date
      // Use 'date' field from leads_leadstage table (not 'cdate') to match fetchTotalSignedValue logic
      // Use explicit UTC timestamps to include full day: from 00:00:00.000 to 23:59:59.999
      const fromDateTime = filters.fromDate ? `${filters.fromDate}T00:00:00.000Z` : null;
      const toDateTime = filters.toDate ? `${filters.toDate}T23:59:59.999Z` : null;

      let stageHistoryQuery = supabase
        .from('leads_leadstage')
        .select('id, stage, date, cdate, lead_id, newlead_id')
        .eq('stage', 60); // Only stage 60 (signed agreements)

      // Filter by the date when the lead was signed (stage 60 date), not when it was created
      // Include full day: from 00:00:00.000 to 23:59:59.999 UTC
      if (fromDateTime) {
        stageHistoryQuery = stageHistoryQuery.gte('date', fromDateTime);
      }
      if (toDateTime) {
        stageHistoryQuery = stageHistoryQuery.lte('date', toDateTime);
      }

      const { data: stageHistoryData, error: stageHistoryError } = await stageHistoryQuery;
      if (stageHistoryError) throw stageHistoryError;

      // Separate new and legacy lead IDs
      const newLeadIds = new Set<string>();
      const legacyLeadIds = new Set<number>();

      stageHistoryData?.forEach((entry: any) => {
        if (entry.newlead_id) {
          newLeadIds.add(entry.newlead_id.toString());
        }
        if (entry.lead_id !== null && entry.lead_id !== undefined) {
          legacyLeadIds.add(Number(entry.lead_id));
        }
      });

      // Step 2: Fetch new leads data
      // NOTE: No date filtering here - we already filtered by sign date in step 1
      // We're only fetching leads that have stage 60 entries in the date range
      const newLeadsMap = new Map();
      if (newLeadIds.size > 0) {
        const newLeadIdsArray = Array.from(newLeadIds);
        const { data: newLeads, error: newLeadsError } = await supabase
          .from('leads')
          .select(`
            id,
            balance,
            balance_currency,
            proposal_total,
            proposal_currency,
            currency_id,
            closer,
            scheduler,
            handler,
            helper,
            expert,
            case_handler_id,
            meeting_manager_id,
            subcontractor_fee,
            category_id,
            category,
            accounting_currencies!leads_currency_id_fkey(name, iso_code),
            misc_category!category_id(
              id,
              name,
              parent_id,
              misc_maincategory!parent_id(
                id,
                name
              )
            )
          `)
          .in('id', newLeadIdsArray);

        if (!newLeadsError && newLeads) {
          // Pre-process leads to ensure categories are correctly mapped
          const processedLeads = preprocessLeadsCategories(newLeads, false);
          processedLeads.forEach(lead => {
            newLeadsMap.set(lead.id, lead);
          });
        }
      }

      // Step 3: Fetch legacy leads data - include total_base and subcontractor_fee for proper calculation
      // NOTE: No date filtering here - we already filtered by sign date in step 1
      // We're only fetching leads that have stage 60 entries in the date range
      const legacyLeadsMap = new Map();
      if (legacyLeadIds.size > 0) {
        const legacyLeadIdsArray = Array.from(legacyLeadIds);
        const { data: legacyLeads, error: legacyLeadsError } = await supabase
          .from('leads_lead')
          .select(`
            id,
            total,
            total_base,
            currency_id,
            subcontractor_fee,
            meeting_total_currency_id,
            closer_id,
            meeting_scheduler_id,
            meeting_lawyer_id,
            case_handler_id,
            meeting_manager_id,
            expert_id,
            category_id,
            category,
            accounting_currencies!leads_lead_currency_id_fkey(name, iso_code),
            misc_category!category_id(
              id,
              name,
              parent_id,
              misc_maincategory!parent_id(
                id,
                name
              )
            )
          `)
          .in('id', legacyLeadIdsArray);

        if (!legacyLeadsError && legacyLeads) {
          // Pre-process leads to ensure categories are correctly mapped
          const processedLeads = preprocessLeadsCategories(legacyLeads, true);
          processedLeads.forEach(lead => {
            legacyLeadsMap.set(Number(lead.id), lead);
          });
        }
      }

      // Step 4: Fetch payment plans for due amounts
      const newPaymentsMap = new Map<string, number>();
      if (newLeadIds.size > 0) {
        try {
          const newLeadIdsArray = Array.from(newLeadIds);
          if (newLeadIdsArray.length === 0) {
            // Skip if no new lead IDs - but don't return, just continue
          } else {
            let newPaymentsQuery = supabase
              .from('payment_plans')
              .select('lead_id, value, value_vat, currency, due_date')
              .in('lead_id', newLeadIdsArray)
              .eq('ready_to_pay', true)
              .eq('paid', false)
              .not('due_date', 'is', null)
              .is('cancel_date', null);

            if (fromDateTime) {
              newPaymentsQuery = newPaymentsQuery.gte('due_date', fromDateTime);
            }
            if (toDateTime) {
              newPaymentsQuery = newPaymentsQuery.lte('due_date', toDateTime);
            }

            const { data: newPayments, error: newPaymentsError } = await newPaymentsQuery;

            if (newPaymentsError) {
              console.error('Error fetching new payment plans:', newPaymentsError);
              // Continue without payment data rather than failing completely
            } else {
              newPayments?.forEach((payment: any) => {
                const leadId = payment.lead_id;
                // Use value only (no VAT) - same as modal logic
                const value = Number(payment.value || 0);
                const currency = payment.currency || '₪';

                // Normalize currency for conversion (same as modal)
                const normalizedCurrency = currency === '₪' ? 'NIS' :
                  currency === '€' ? 'EUR' :
                    currency === '$' ? 'USD' :
                      currency === '£' ? 'GBP' : currency;

                // Convert value to NIS (same as modal footer calculation)
                const amountNIS = convertToNIS(value, normalizedCurrency);
                const current = newPaymentsMap.get(leadId) || 0;
                newPaymentsMap.set(leadId, current + amountNIS);
              });
            }
          }
        } catch (error) {
          console.error('Error in new payment plans fetch:', error);
          // Continue without payment data rather than failing completely
        }
      }

      // Step 5: Fetch legacy payment plans
      const legacyPaymentsMap = new Map<number, number>();
      if (legacyLeadIds.size > 0) {
        try {
          const legacyLeadIdsArray = Array.from(legacyLeadIds);
          if (legacyLeadIdsArray.length > 0) {
            let legacyPaymentsQuery = supabase
              .from('finances_paymentplanrow')
              .select('lead_id, value, value_base, currency_id, due_date, accounting_currencies!finances_paymentplanrow_currency_id_fkey(name, iso_code)')
              .in('lead_id', legacyLeadIdsArray)
              .is('actual_date', null)
              .eq('ready_to_pay', true)
              .not('due_date', 'is', null);

            if (fromDateTime) {
              legacyPaymentsQuery = legacyPaymentsQuery.gte('due_date', fromDateTime);
            }
            if (toDateTime) {
              legacyPaymentsQuery = legacyPaymentsQuery.lte('due_date', toDateTime);
            }

            const { data: legacyPayments, error: legacyPaymentsError } = await legacyPaymentsQuery;

            if (legacyPaymentsError) {
              console.error('Error fetching legacy payment plans:', legacyPaymentsError);
              // Continue without payment data rather than failing completely
            } else {
              legacyPayments?.forEach((payment: any) => {
                const leadId = Number(payment.lead_id);
                // Use value only (no VAT) - same as modal logic
                const value = Number(payment.value || payment.value_base || 0);

                // Get currency (same as modal logic)
                const accountingCurrency: any = payment.accounting_currencies
                  ? (Array.isArray(payment.accounting_currencies) ? payment.accounting_currencies[0] : payment.accounting_currencies)
                  : null;
                let currency = '₪';
                if (accountingCurrency?.name) {
                  currency = accountingCurrency.name;
                } else if (accountingCurrency?.iso_code) {
                  currency = accountingCurrency.iso_code;
                } else {
                  // Fallback to lead's currency if payment currency not available
                  const lead = legacyLeadsMap.get(leadId);
                  currency = lead?.accounting_currencies?.iso_code || '₪';
                }

                // Normalize currency for conversion (same as modal)
                const normalizedCurrency = currency === '₪' ? 'NIS' :
                  currency === '€' ? 'EUR' :
                    currency === '$' ? 'USD' :
                      currency === '£' ? 'GBP' : currency;

                // Convert value to NIS (same as modal footer calculation)
                const amountNIS = convertToNIS(value, normalizedCurrency);
                const current = legacyPaymentsMap.get(leadId) || 0;
                legacyPaymentsMap.set(leadId, current + amountNIS);
              });
            }
          }
        } catch (error) {
          console.error('Error in legacy payment plans fetch:', error);
          // Continue without payment data rather than failing completely
        }
      }

      // Step 6: For Handler role, also fetch payment plans for ALL handler leads (not just signed ones)
      // This ensures due amounts are calculated from payment plans filtered by due_date, not by signed status
      // Get employee display name for matching
      const { data: employeeDataForPayments } = await supabase
        .from('tenants_employee')
        .select('id, display_name')
        .eq('id', employeeId)
        .single();

      if (employeeDataForPayments) {
        const employeeDisplayNameForPayments = employeeDataForPayments.display_name;

        // For payment plans, use format without .000Z (same as fetchDueAmounts)
        const fromDateTimeForPayments = filters.fromDate ? `${filters.fromDate}T00:00:00` : null;
        const toDateTimeForPayments = filters.toDate ? `${filters.toDate}T23:59:59` : null;

        // Find ALL new leads where this employee is handler (not just signed ones)
        const { data: allHandlerNewLeads } = await supabase
          .from('leads')
          .select('id, handler, case_handler_id')
          .or(`handler.eq.${employeeDisplayNameForPayments},case_handler_id.eq.${employeeId}`);

        if (allHandlerNewLeads && allHandlerNewLeads.length > 0) {
          const allHandlerNewLeadIds = allHandlerNewLeads.map(l => l.id).filter(Boolean);

          // Fetch payment plans for these leads with due dates in range
          let allHandlerPaymentsQuery = supabase
            .from('payment_plans')
            .select('lead_id, value, value_vat, currency, due_date')
            .eq('ready_to_pay', true)
            .not('due_date', 'is', null)
            .is('cancel_date', null)
            .in('lead_id', allHandlerNewLeadIds);

          if (fromDateTimeForPayments) {
            allHandlerPaymentsQuery = allHandlerPaymentsQuery.gte('due_date', fromDateTimeForPayments);
          }
          if (toDateTimeForPayments) {
            allHandlerPaymentsQuery = allHandlerPaymentsQuery.lte('due_date', toDateTimeForPayments);
          }

          const { data: allHandlerPayments } = await allHandlerPaymentsQuery;
          if (allHandlerPayments) {
            allHandlerPayments.forEach((payment: any) => {
              const leadId = payment.lead_id;
              // Use value only (no VAT) - same as modal logic
              const value = Number(payment.value || 0);
              const currency = payment.currency || '₪';

              // Normalize currency for conversion (same as modal)
              const normalizedCurrency = currency === '₪' ? 'NIS' :
                currency === '€' ? 'EUR' :
                  currency === '$' ? 'USD' :
                    currency === '£' ? 'GBP' : currency;

              // Convert value to NIS (same as modal footer calculation)
              const amountNIS = convertToNIS(value, normalizedCurrency);
              // Add to map (sum if already exists from signed leads)
              const current = newPaymentsMap.get(leadId) || 0;
              newPaymentsMap.set(leadId, current + amountNIS);
            });
          }
        }

        // Find ALL legacy leads where this employee is handler (not just signed ones)
        const { data: allHandlerLegacyLeads } = await supabase
          .from('leads_lead')
          .select('id, case_handler_id')
          .eq('case_handler_id', employeeId);

        if (allHandlerLegacyLeads && allHandlerLegacyLeads.length > 0) {
          const allHandlerLegacyLeadIds = allHandlerLegacyLeads.map(l => l.id).filter(Boolean).map(id => Number(id));

          // Fetch payment plans for these leads with due dates in range
          let allHandlerLegacyPaymentsQuery = supabase
            .from('finances_paymentplanrow')
            .select('lead_id, value, value_base, vat_value, currency_id, due_date, accounting_currencies!finances_paymentplanrow_currency_id_fkey(name, iso_code)')
            .not('due_date', 'is', null)
            .is('cancel_date', null)
            .in('lead_id', allHandlerLegacyLeadIds);

          if (fromDateTimeForPayments) {
            allHandlerLegacyPaymentsQuery = allHandlerLegacyPaymentsQuery.gte('due_date', fromDateTimeForPayments);
          }
          if (toDateTimeForPayments) {
            allHandlerLegacyPaymentsQuery = allHandlerLegacyPaymentsQuery.lte('due_date', toDateTimeForPayments);
          }

          const { data: allHandlerLegacyPayments } = await allHandlerLegacyPaymentsQuery;
          if (allHandlerLegacyPayments) {
            allHandlerLegacyPayments.forEach((payment: any) => {
              const leadIdNum = Number(payment.lead_id);
              // Use value only (no VAT) - same as modal logic
              const value = Number(payment.value || payment.value_base || 0);

              // Get currency (same as modal logic)
              const accountingCurrency: any = payment.accounting_currencies
                ? (Array.isArray(payment.accounting_currencies) ? payment.accounting_currencies[0] : payment.accounting_currencies)
                : null;
              let currency = '₪';
              if (accountingCurrency?.name) {
                currency = accountingCurrency.name;
              } else if (accountingCurrency?.iso_code) {
                currency = accountingCurrency.iso_code;
              } else if (payment.currency_id) {
                switch (payment.currency_id) {
                  case 1: currency = '₪'; break;
                  case 2: currency = '€'; break;
                  case 3: currency = '$'; break;
                  case 4: currency = '£'; break;
                  default: currency = '₪'; break;
                }
              }

              // Normalize currency for conversion (same as modal)
              const normalizedCurrency = currency === '₪' ? 'NIS' :
                currency === '€' ? 'EUR' :
                  currency === '$' ? 'USD' :
                    currency === '£' ? 'GBP' : currency;

              // Convert value to NIS (same as modal footer calculation)
              const amountNIS = convertToNIS(value, normalizedCurrency);
              // Add to map (sum if already exists from signed leads)
              const current = legacyPaymentsMap.get(leadIdNum) || 0;
              legacyPaymentsMap.set(leadIdNum, current + amountNIS);
            });
          }
        }
      }

      // Note: Field view data processing is now done in handleSearch batch calculation
      // to avoid multiple calls and ensure due amounts are calculated correctly

      // Step 6: Group leads by role combinations
      // Map to store role combinations and their totals
      const roleCombinationMap = new Map<string, { roles: string[], signedTotal: number, dueTotal: number }>();

      // Helper function to check if employee is in a role for a new lead
      const checkEmployeeInRole = (lead: any, roleField: string, roleName: string): boolean => {
        if (roleName === 'Helper Handler') {
          return false; // No direct field exists
        }

        if (roleField === 'closer' && lead.closer) {
          const closerValue = lead.closer;
          return typeof closerValue === 'string'
            ? closerValue.toLowerCase() === employeeName.toLowerCase()
            : Number(closerValue) === employeeId;
        } else if (roleField === 'scheduler' && lead.scheduler) {
          const schedulerValue = lead.scheduler;
          return typeof schedulerValue === 'string'
            ? schedulerValue.toLowerCase() === employeeName.toLowerCase()
            : Number(schedulerValue) === employeeId;
        } else if (roleField === 'handler') {
          // Check both handler (text) and case_handler_id (numeric) for new leads
          if (lead.handler) {
            const handlerValue = lead.handler;
            if (typeof handlerValue === 'string' && handlerValue.toLowerCase() === employeeName.toLowerCase()) {
              return true;
            }
            if (Number(handlerValue) === employeeId) {
              return true;
            }
          }
          // Also check case_handler_id for new leads
          if (lead.case_handler_id && Number(lead.case_handler_id) === employeeId) {
            return true;
          }
          return false;
        } else if (roleField === 'helper' && lead.helper) {
          const helperValue = lead.helper;
          return typeof helperValue === 'string'
            ? helperValue.toLowerCase() === employeeName.toLowerCase()
            : Number(helperValue) === employeeId;
        } else if (roleField === 'expert' && lead.expert) {
          return Number(lead.expert) === employeeId;
        } else if (roleField === 'meeting_manager_id' && lead.meeting_manager_id) {
          return Number(lead.meeting_manager_id) === employeeId;
        }
        return false;
      };

      // Helper function to check if employee is in a role for a legacy lead
      const checkEmployeeInRoleLegacy = (lead: any, roleField: string): boolean => {
        if (roleField === 'closer_id' && lead.closer_id) {
          return Number(lead.closer_id) === employeeId;
        } else if (roleField === 'meeting_scheduler_id' && lead.meeting_scheduler_id) {
          return Number(lead.meeting_scheduler_id) === employeeId;
        } else if (roleField === 'meeting_lawyer_id' && lead.meeting_lawyer_id) {
          return Number(lead.meeting_lawyer_id) === employeeId;
        } else if (roleField === 'case_handler_id' && lead.case_handler_id) {
          return Number(lead.case_handler_id) === employeeId;
        } else if (roleField === 'expert_id' && lead.expert_id) {
          return Number(lead.expert_id) === employeeId;
        } else if (roleField === 'meeting_manager_id' && lead.meeting_manager_id) {
          return Number(lead.meeting_manager_id) === employeeId;
        }
        return false;
      };

      // Helper functions for calculating amounts (same as fetchTotalSignedValue)
      const parseNumericAmount = (val: any): number => {
        if (typeof val === 'number') return val;
        if (typeof val === 'string') {
          const cleaned = val.replace(/[^0-9.-]/g, '');
          const parsed = parseFloat(cleaned);
          return Number.isNaN(parsed) ? 0 : parsed;
        }
        return 0;
      };

      const buildCurrencyMeta = (...candidates: any[]): { displaySymbol: string; conversionValue: string | number } => {
        for (const candidate of candidates) {
          if (candidate === null || candidate === undefined) continue;
          const rawValue = Array.isArray(candidate) ? candidate[0] : candidate;
          if (rawValue === null || rawValue === undefined) continue;

          if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
            const currencyMap: { [key: number]: string } = { 1: 'NIS', 2: 'USD', 3: 'EUR', 4: 'GBP' };
            return { displaySymbol: '₪', conversionValue: currencyMap[rawValue] || 'NIS' };
          }

          const valueStr = rawValue.toString().trim();
          if (!valueStr) continue;

          const numeric = Number(valueStr);
          if (!Number.isNaN(numeric) && numeric.toString() === valueStr) {
            const currencyMap: { [key: number]: string } = { 1: 'NIS', 2: 'USD', 3: 'EUR', 4: 'GBP' };
            return { displaySymbol: '₪', conversionValue: currencyMap[numeric] || 'NIS' };
          }

          const upper = valueStr.toUpperCase();
          if (upper === '₪' || upper === 'NIS' || upper === 'ILS') {
            return { displaySymbol: '₪', conversionValue: 'NIS' };
          }
          if (upper === 'USD' || valueStr === '$') {
            return { displaySymbol: '$', conversionValue: 'USD' };
          }
          if (upper === 'EUR' || valueStr === '€') {
            return { displaySymbol: '€', conversionValue: 'EUR' };
          }
          if (upper === 'GBP' || valueStr === '£') {
            return { displaySymbol: '£', conversionValue: 'GBP' };
          }
        }
        return { displaySymbol: '₪', conversionValue: 'NIS' };
      };

      // Process new leads - determine role combinations
      newLeadsMap.forEach((lead: any, leadId: string) => {
        const employeeRoles: string[] = [];

        roles.forEach(role => {
          if (role.newField && checkEmployeeInRole(lead, role.newField, role.name)) {
            employeeRoles.push(role.name);
          }
        });

        // Check if employee is handler for this lead (needed for due amounts)
        const isHandler = checkEmployeeInRole(lead, 'handler', 'Handler');

        // If employee has no roles but is a handler, add Handler role for due amount tracking
        if (employeeRoles.length === 0 && isHandler) {
          employeeRoles.push('Handler');
        }

        // Only process if employee has at least one role in this lead
        if (employeeRoles.length > 0) {
          // Sort roles to create consistent combination key
          const sortedRoles = [...employeeRoles].sort();
          const combinationKey = sortedRoles.join(', ');

          // Check if this is "Handler only" - exclude from signed totals but still show if has due amounts
          const isHandlerOnly = employeeRoles.length === 1 && employeeRoles[0] === 'Handler';

          // Calculate amount same way as fetchTotalSignedValue
          const balanceAmount = parseFloat(lead.balance || 0);
          const proposalAmount = parseFloat(lead.proposal_total || 0);
          const rawAmount = balanceAmount || proposalAmount || 0;
          const currencyCode = lead.accounting_currencies?.iso_code || lead.balance_currency || lead.proposal_currency || 'NIS';
          const amountInNIS = convertToNIS(rawAmount, currencyCode);

          // Calculate and subtract subcontractor_fee (same as fetchTotalSignedValue)
          const subcontractorFee = parseNumericAmount(lead.subcontractor_fee) || 0;
          const currencyMeta = buildCurrencyMeta(lead.currency_id, lead.proposal_currency, lead.balance_currency);
          const subcontractorFeeNIS = convertToNIS(subcontractorFee, currencyMeta.conversionValue);
          const amountNIS = amountInNIS - subcontractorFeeNIS;

          // Due amount: only count if employee is handler for this lead
          const dueAmount = isHandler ? (newPaymentsMap.get(leadId) || 0) : 0;

          const existing = roleCombinationMap.get(combinationKey);
          if (existing) {
            // Only add to signedTotal if NOT handler only
            if (!isHandlerOnly) {
              existing.signedTotal += amountNIS;
            }
            existing.dueTotal += dueAmount;
          } else {
            roleCombinationMap.set(combinationKey, {
              roles: sortedRoles,
              // Only set signedTotal if NOT handler only
              signedTotal: isHandlerOnly ? 0 : amountNIS,
              dueTotal: dueAmount,
            });
          }
        }
      });

      // Process legacy leads - determine role combinations
      legacyLeadsMap.forEach((lead: any, leadId: number) => {
        const employeeRoles: string[] = [];

        roles.forEach(role => {
          if (role.legacyField && checkEmployeeInRoleLegacy(lead, role.legacyField)) {
            employeeRoles.push(role.name);
          }
        });

        // Check if employee is handler for this lead (needed for due amounts)
        const isHandler = checkEmployeeInRoleLegacy(lead, 'case_handler_id');

        // If employee has no roles but is a handler, add Handler role for due amount tracking
        if (employeeRoles.length === 0 && isHandler) {
          employeeRoles.push('Handler');
        }

        // Only process if employee has at least one role in this lead
        if (employeeRoles.length > 0) {
          // Sort roles to create consistent combination key
          const sortedRoles = [...employeeRoles].sort();
          const combinationKey = sortedRoles.join(', ');

          // Check if this is "Handler only" - exclude from signed totals but still show if has due amounts
          const isHandlerOnly = employeeRoles.length === 1 && employeeRoles[0] === 'Handler';

          // Calculate amount same way as SignedSalesReportPage (lines 1544-1565)
          // For legacy leads: if currency_id is 1 (NIS/ILS), use total_base; otherwise use total
          const currencyId = lead.currency_id;
          const numericCurrencyId = typeof currencyId === 'string' ? parseInt(currencyId, 10) : Number(currencyId);
          let resolvedAmount = 0;
          if (numericCurrencyId === 1) {
            // Use total_base for NIS/ILS currency
            resolvedAmount = parseNumericAmount(lead.total_base) || 0;
          } else {
            // Use total for other currencies
            resolvedAmount = parseNumericAmount(lead.total) || 0;
          }

          // Build currency meta same way as SignedSalesReportPage
          const currencyMeta = buildCurrencyMeta(
            lead.currency_id,
            lead.meeting_total_currency_id,
            lead.accounting_currencies
          );

          // Convert to NIS using currencyMeta.conversionValue (same as SignedSalesReportPage line 1562)
          const amountNIS = convertToNIS(resolvedAmount, currencyMeta.conversionValue);

          // Get subcontractor_fee and convert to NIS (same as SignedSalesReportPage lines 1564-1565)
          const subcontractorFee = parseNumericAmount(lead.subcontractor_fee) || 0;
          const subcontractorFeeNIS = convertToNIS(subcontractorFee, currencyMeta.conversionValue);

          // Store amount before fee (same as SignedSalesReportPage - fee is subtracted in display)
          // For this report, we want to show amount after fee, so subtract it here
          const amountAfterFee = amountNIS - subcontractorFeeNIS;

          // Due amount: only count if employee is handler for this lead (isHandler already checked above)
          const dueAmount = isHandler ? (legacyPaymentsMap.get(leadId) || 0) : 0;

          const existing = roleCombinationMap.get(combinationKey);
          if (existing) {
            // Only add to signedTotal if NOT handler only
            if (!isHandlerOnly) {
              existing.signedTotal += amountAfterFee;
            }
            existing.dueTotal += dueAmount;
          } else {
            roleCombinationMap.set(combinationKey, {
              roles: sortedRoles,
              // Only set signedTotal if NOT handler only
              signedTotal: isHandlerOnly ? 0 : amountAfterFee,
              dueTotal: dueAmount,
            });
          }
        }
      });

      // Calculate signed/due normalized and signed portion
      // Get total signed value (already calculated by fetchTotalSignedValue)
      const totalSignedOverall = totalSignedValueRef.current || 0;
      const incomeAmount = totalIncome || 0;

      // Calculate normalization ratio: if income < total signed, apply percentage reduction
      let normalizationRatio = 1; // Default: no normalization
      if (incomeAmount > 0 && totalSignedOverall > 0 && incomeAmount < totalSignedOverall) {
        // If income is less than total signed, we need to reduce proportionally
        normalizationRatio = incomeAmount / totalSignedOverall;
      }

      // Fetch due amount for this employee (if they are a handler)
      const dueAmount = await fetchDueAmounts(employeeId, employeeName);

      console.log(`📊 Signed/Due Normalized Calculation for employee ${employeeId}:`, {
        totalIncome: incomeAmount,
        totalSigned: totalSignedOverall,
        dueAmount: dueAmount,
        normalizationRatio: normalizationRatio,
        willNormalize: incomeAmount < totalSignedOverall
      });

      // Now calculate signed portion WITHOUT the difference ratio adjustment
      // Just use role percentages directly on amountAfterFee
      let totalSignedPortion = 0;

      // Process new leads to calculate signed portion
      newLeadsMap.forEach((lead: any, leadId: string) => {
        // Check if this employee has any role in this lead
        const employeeRoles: string[] = [];
        roles.forEach(role => {
          if (role.newField && checkEmployeeInRole(lead, role.newField, role.name)) {
            employeeRoles.push(role.name);
          }
        });

        // Exclude "Handler only" from signed portion calculation
        const isHandlerOnly = employeeRoles.length === 1 && employeeRoles[0] === 'Handler';

        if (employeeRoles.length > 0 && !isHandlerOnly) {
          // Calculate amount same way as above
          const balanceAmount = parseFloat(lead.balance || 0);
          const proposalAmount = parseFloat(lead.proposal_total || 0);
          const rawAmount = balanceAmount || proposalAmount || 0;
          const currencyCode = lead.accounting_currencies?.iso_code || lead.balance_currency || lead.proposal_currency || 'NIS';
          const amountInNIS = convertToNIS(rawAmount, currencyCode);

          // Calculate and subtract subcontractor_fee
          const subcontractorFee = parseNumericAmount(lead.subcontractor_fee) || 0;
          const currencyMeta = buildCurrencyMeta(lead.currency_id, lead.proposal_currency, lead.balance_currency);
          const subcontractorFeeNIS = convertToNIS(subcontractorFee, currencyMeta.conversionValue);
          const amountAfterFee = amountInNIS - subcontractorFeeNIS;

          // Calculate signed portion based on employee's roles using amountAfterFee directly
          // (No difference ratio adjustment - that's now only for signed normalized)
          const leadRoles = {
            closer: lead.closer,
            scheduler: lead.scheduler,
            manager: lead.meeting_manager_id, // Meeting Manager is stored as meeting_manager_id (numeric) in new leads
            expert: lead.expert,
            handler: lead.handler, // Handler role
            helperCloser: lead.helper, // Helper Closer is stored as 'helper' in new leads
          };

          // Calculate signed portion from amountAfterFee (no adjustment)
          const signedPortion = calculateSignedPortionAmount(
            amountAfterFee,
            leadRoles,
            employeeId,
            false, // isLegacy = false for new leads
            rolePercentages // Pass role percentages from database
          );

          totalSignedPortion += signedPortion;
        }
      });

      // Process legacy leads to calculate signed portion
      legacyLeadsMap.forEach((lead: any, leadId: number) => {
        // Check if this employee has any role in this lead
        const employeeRoles: string[] = [];
        roles.forEach(role => {
          if (role.legacyField && checkEmployeeInRoleLegacy(lead, role.legacyField)) {
            employeeRoles.push(role.name);
          }
        });

        // Exclude "Handler only" from signed portion calculation
        const isHandlerOnly = employeeRoles.length === 1 && employeeRoles[0] === 'Handler';

        if (employeeRoles.length > 0 && !isHandlerOnly) {
          // Calculate amount same way as above
          const currencyId = lead.currency_id;
          const numericCurrencyId = typeof currencyId === 'string' ? parseInt(currencyId, 10) : Number(currencyId);
          let resolvedAmount = 0;
          if (numericCurrencyId === 1) {
            resolvedAmount = parseNumericAmount(lead.total_base) || 0;
          } else {
            resolvedAmount = parseNumericAmount(lead.total) || 0;
          }

          const currencyMeta = buildCurrencyMeta(
            lead.currency_id,
            lead.meeting_total_currency_id,
            lead.accounting_currencies
          );

          const amountNIS = convertToNIS(resolvedAmount, currencyMeta.conversionValue);

          const subcontractorFee = parseNumericAmount(lead.subcontractor_fee) || 0;
          const subcontractorFeeNIS = convertToNIS(subcontractorFee, currencyMeta.conversionValue);
          const amountAfterFee = amountNIS - subcontractorFeeNIS;

          // Calculate signed portion based on employee's roles using amountAfterFee directly
          // (No difference ratio adjustment - that's now only for signed normalized)
          const leadRoles = {
            closer_id: lead.closer_id,
            meeting_scheduler_id: lead.meeting_scheduler_id,
            meeting_manager_id: lead.meeting_manager_id,
            expert_id: lead.expert_id,
            case_handler_id: lead.case_handler_id, // Handler role
            meeting_lawyer_id: lead.meeting_lawyer_id, // Helper Closer
          };

          // Calculate signed portion from amountAfterFee (no adjustment)
          const signedPortion = calculateSignedPortionAmount(
            amountAfterFee,
            leadRoles,
            employeeId,
            true, // isLegacy = true for legacy leads
            rolePercentages // Pass role percentages from database
          );

          totalSignedPortion += signedPortion;
        }
      });

      // Use fetchDueAmounts to get the total due amount for this employee
      // This ensures we capture ALL due amounts, even from leads not in the signed leads list
      // fetchDueAmounts queries ALL leads where employee is handler, not just signed ones
      const totalDueFromFetchDueAmounts = await fetchDueAmounts(employeeId, employeeName);

      // Check if Handler is already in any role combination
      let handlerFoundInCombinations = false;
      let handlerCombinationKey: string | null = null;
      roleCombinationMap.forEach((data, key) => {
        if (data.roles.includes('Handler')) {
          handlerFoundInCombinations = true;
          // If it's Handler only (not combined with other roles), track it
          if (data.roles.length === 1 && data.roles[0] === 'Handler') {
            handlerCombinationKey = key;
          }
        }
      });

      // If Handler role combination doesn't exist but there are due amounts, create it
      if (!handlerFoundInCombinations && totalDueFromFetchDueAmounts > 0) {
        roleCombinationMap.set('Handler', {
          roles: ['Handler'],
          signedTotal: 0, // Handler only doesn't count toward signed
          dueTotal: totalDueFromFetchDueAmounts,
        });
      } else if (handlerCombinationKey && totalDueFromFetchDueAmounts > 0) {
        // If Handler-only combination exists, update its due total to match fetchDueAmounts
        // This ensures the Handler role shows the correct total (all handler leads, not just signed ones)
        const handlerData = roleCombinationMap.get(handlerCombinationKey);
        if (handlerData) {
          // Replace the dueTotal with the authoritative total from fetchDueAmounts
          // This ensures consistency with the main table's Due column
          handlerData.dueTotal = totalDueFromFetchDueAmounts;
          roleCombinationMap.set(handlerCombinationKey, handlerData);
        }
      } else {
        // If Handler appears in combinations with other roles, we need to ensure the total is correct
        // Sum all dueTotal values that include Handler role
        let totalDueFromHandlerCombinations = 0;
        roleCombinationMap.forEach((data, key) => {
          if (data.roles.includes('Handler')) {
            totalDueFromHandlerCombinations += data.dueTotal || 0;
          }
        });

        // If the sum from role combinations doesn't match fetchDueAmounts, 
        // it means there are handler leads with due amounts that aren't in signed leads
        // In this case, we should still show the correct total in the main table
        // The role breakdown will show individual combinations, but the main table uses fetchDueAmounts
      }

      // Convert map to array for display
      roleCombinationMap.forEach((data, combinationKey) => {
        roleDataResults.push({
          role: combinationKey, // Display all roles combined
          signedTotal: data.signedTotal,
          dueTotal: data.dueTotal,
          roles: data.roles, // Store individual roles for modal filtering
          action: '',
        });
      });

      // Update employee signed total from role data (exclude Handler only)
      const totalSigned = roleDataResults.reduce((sum, roleItem) => {
        const isHandlerOnly = roleItem.role === 'Handler';
        return sum + (isHandlerOnly ? 0 : (roleItem.signedTotal || 0));
      }, 0);

      // Calculate total due from all role combinations
      // Sum all dueTotal values from role combinations
      const totalDueFromRoleCombinations = roleDataResults.reduce((sum, roleItem) => {
        return sum + (roleItem.dueTotal || 0);
      }, 0);

      // Fetch due amount for this employee (if they are a handler)
      // Use fetchDueAmounts to get the authoritative total (includes all handler leads, not just signed ones)
      // This ensures consistency with the modal which also uses fetchDueAmounts logic
      // fetchDueAmounts queries ALL leads where employee is handler and filters payment plans by due_date
      const dueAmountForEmployee = await fetchDueAmounts(employeeId, employeeName);

      // Calculate signed normalized: only use signed amounts, apply normalization ratio based on income
      // IMPORTANT: Use ref to get the latest totalSignedValue to avoid stale closure issues
      const totalSignedOverallForEmployee = totalSignedValueRef.current || 0;
      const incomeAmountForEmployee = totalIncome || 0;
      let normalizationRatioForEmployee = 1;
      if (incomeAmountForEmployee > 0 && totalSignedOverallForEmployee > 0 && incomeAmountForEmployee < totalSignedOverallForEmployee) {
        normalizationRatioForEmployee = incomeAmountForEmployee / totalSignedOverallForEmployee;
      }

      // Signed normalized: only use signed amounts (no due)
      const signedNormalized = totalSigned * normalizationRatioForEmployee;

      // Due normalized: use separate percentage from due_normalized_percentage
      const dueNormalizedPercentageValue = (dueNormalizedPercentage || 0) / 100; // Convert percentage to decimal
      const dueNormalized = dueAmountForEmployee * dueNormalizedPercentageValue;

      // Calculate due portion: Handler gets a percentage of due amounts
      // Get handler percentage from rolePercentages (0-100, convert to 0-1)
      const handlerPercentage = rolePercentages && rolePercentages.has('HANDLER')
        ? (rolePercentages.get('HANDLER')! / 100)
        : 0; // Default to 0 if not found

      const duePortion = dueAmountForEmployee * handlerPercentage;

      // Normalize signed portion: apply normalization ratio to signedPortion
      const signedPortionNormalized = totalSignedPortion * normalizationRatioForEmployee;

      // Normalize due portion: apply due normalized percentage to duePortion
      const duePortionNormalized = duePortion * dueNormalizedPercentageValue;

      // Calculate Contribution: combine normalized signed portion + normalized due portion
      const contribution = signedPortionNormalized + duePortionNormalized;

      // Calculate Salary Budget from Contribution
      const salaryBudget = contribution * 0.4;

      setRoleDataCache(prev => {
        const newCache = new Map(prev);
        // Include date range, income, due normalized percentage, and role percentages hash in cache key
        const dateRangeKey = `${filters.fromDate || ''}_${filters.toDate || ''}`;
        const incomeKey = totalIncome || 0;
        const dueNormalizedPercentageKey = dueNormalizedPercentage || 0;
        const rolePercentagesHash = getRolePercentagesHash(rolePercentages);
        const cacheKey = `${employeeId}_${dateRangeKey}_${incomeKey}_${dueNormalizedPercentageKey}_${rolePercentagesHash}`;
        newCache.set(cacheKey, roleDataResults);
        return newCache;
      });

      // Update ALL employee data in a single state update to avoid race conditions
      setDepartmentData(prev => {
        const updated = new Map(prev);
        updated.forEach((deptData, deptName) => {
          const updatedEmployees = deptData.employees.map(emp => {
            if (emp.employeeId === employeeId) {
              return {
                ...emp,
                signed: totalSigned, // Update signed here too to ensure consistency
                due: dueAmountForEmployee, // Update due amount
                signedNormalized: signedNormalized,
                dueNormalized: dueNormalized,
                signedPortion: contribution, // Use normalized contribution
                salaryBudget: salaryBudget
              };
            }
            return emp;
          });

          // Recalculate department totals from all employees
          const deptSigned = updatedEmployees.reduce((sum, emp) => sum + (emp.signed || 0), 0);
          const deptSignedNormalized = updatedEmployees.reduce((sum, emp) => sum + (emp.signedNormalized || 0), 0);
          const deptDueNormalized = updatedEmployees.reduce((sum, emp) => sum + (emp.dueNormalized || 0), 0);
          const deptSignedPortion = updatedEmployees.reduce((sum, emp) => sum + (emp.signedPortion || 0), 0);
          const deptSalaryBudget = updatedEmployees.reduce((sum, emp) => sum + (emp.salaryBudget || 0), 0);

          updated.set(deptName, {
            ...deptData,
            employees: updatedEmployees,
            totals: {
              ...deptData.totals,
              signed: deptSigned,
              signedNormalized: deptSignedNormalized,
              dueNormalized: deptDueNormalized,
              signedPortion: deptSignedPortion,
              salaryBudget: deptSalaryBudget,
            },
          });
        });
        return updated;
      });

      // Also update via updateEmployeeSignedTotal for consistency (but the above update is primary)
      updateEmployeeSignedTotal(employeeId, totalSigned);
    } catch (error) {
      console.error('Error fetching role data:', error);
      toast.error('Failed to load role data');
    } finally {
      // Use employee ID only for loading state (not date-specific)
      setLoadingRoleData(prev => {
        const newSet = new Set(prev);
        newSet.delete(`${employeeId}`);
        return newSet;
      });
    }
  }, [filters.fromDate, filters.toDate, totalSignedValue, totalIncome, dueNormalizedPercentage, rolePercentages, getRolePercentagesHash, categoriesLoaded, categoryNameToDataMap, allCategories]);

  // Recalculate signed portions when income changes
  // This ensures signed portions are recalculated with the new income value immediately
  const prevIncomeRef = useRef<number>(totalIncome);
  useEffect(() => {
    // Only trigger if income actually changed and we have employees loaded
    if (prevIncomeRef.current !== totalIncome && departmentData.size > 0 && filters.fromDate && filters.toDate) {
      prevIncomeRef.current = totalIncome;
      // Clear cache to force recalculation (cache key includes income, so old cache won't match)
      setRoleDataCache(new Map());

      // Trigger refetch for all employees
      const allEmployeeIds: number[] = [];
      const employeeNamesMap = new Map<number, string>();
      departmentData.forEach(deptData => {
        deptData.employees.forEach(emp => {
          if (!allEmployeeIds.includes(emp.employeeId)) {
            allEmployeeIds.push(emp.employeeId);
            employeeNamesMap.set(emp.employeeId, emp.employeeName);
          }
        });
      });

      // Refetch role data for all employees in parallel batches
      const refetchAll = async () => {
        const batchSize = 10;
        for (let i = 0; i < allEmployeeIds.length; i += batchSize) {
          const batch = allEmployeeIds.slice(i, i + batchSize);
          // Fetch all in batch in parallel
          await Promise.all(
            batch.map(employeeId => {
              const employeeName = employeeNamesMap.get(employeeId) || '';
              return fetchRoleData(employeeId, employeeName).catch(err => {
                console.error(`Error refetching role data for employee ${employeeId} after income change:`, err);
              });
            })
          );
        }
      };

      refetchAll();
    }
  }, [totalIncome, departmentData, filters.fromDate, filters.toDate, fetchRoleData]);

  // Recalculate due normalized when due normalized percentage changes
  // This ensures due normalized is recalculated with the new percentage value immediately
  const prevDueNormalizedPercentageRef = useRef<number>(dueNormalizedPercentage);
  useEffect(() => {
    // Only trigger if due normalized percentage actually changed and we have employees loaded
    if (prevDueNormalizedPercentageRef.current !== dueNormalizedPercentage && departmentData.size > 0 && filters.fromDate && filters.toDate) {
      prevDueNormalizedPercentageRef.current = dueNormalizedPercentage;
      // Clear cache to force recalculation (cache key includes due normalized percentage, so old cache won't match)
      setRoleDataCache(new Map());

      // Trigger refetch for all employees
      const allEmployeeIds: number[] = [];
      const employeeNamesMap = new Map<number, string>();
      departmentData.forEach(deptData => {
        deptData.employees.forEach(emp => {
          if (!allEmployeeIds.includes(emp.employeeId)) {
            allEmployeeIds.push(emp.employeeId);
            employeeNamesMap.set(emp.employeeId, emp.employeeName);
          }
        });
      });

      // Refetch role data for all employees in parallel batches
      const refetchAll = async () => {
        const batchSize = 10;
        for (let i = 0; i < allEmployeeIds.length; i += batchSize) {
          const batch = allEmployeeIds.slice(i, i + batchSize);
          // Fetch all in batch in parallel
          await Promise.all(
            batch.map(employeeId => {
              const employeeName = employeeNamesMap.get(employeeId) || '';
              return fetchRoleData(employeeId, employeeName).catch(err => {
                console.error(`Error refetching role data for employee ${employeeId} after due normalized percentage change:`, err);
              });
            })
          );
        }
      };

      refetchAll();
    }
  }, [dueNormalizedPercentage, departmentData, filters.fromDate, filters.toDate, fetchRoleData]);

  // Update employee signed total in department data
  const updateEmployeeSignedTotal = useCallback((employeeId: number, signedTotal: number) => {
    setDepartmentData(prev => {
      const updated = new Map(prev);

      updated.forEach((deptData, deptName) => {
        const updatedEmployees = deptData.employees.map(emp => {
          if (emp.employeeId === employeeId) {
            return { ...emp, signed: signedTotal };
          }
          return emp;
        });

        // Recalculate department totals
        const deptSigned = updatedEmployees.reduce((sum, emp) => sum + emp.signed, 0);

        updated.set(deptName, {
          ...deptData,
          employees: updatedEmployees,
          totals: {
            ...deptData.totals,
            signed: deptSigned,
          },
        });
      });

      return updated;
    });
  }, []);

  // Update employee signed portion in department data
  // Fetch due amounts for employees who are handlers
  const fetchDueAmounts = useCallback(async (employeeId: number, employeeName: string) => {
    try {
      const fromDateTime = filters.fromDate ? `${filters.fromDate}T00:00:00` : null;
      const toDateTime = filters.toDate ? `${filters.toDate}T23:59:59` : null;

      let totalDue = 0;

      // Fetch new payment plans where employee is handler
      // For new leads, handler is stored in 'handler' field (text) or 'case_handler_id' (numeric)
      // First, get employee's display_name to match against handler field
      const { data: employeeData } = await supabase
        .from('tenants_employee')
        .select('id, display_name')
        .eq('id', employeeId)
        .single();

      if (!employeeData) {
        return 0;
      }

      const employeeDisplayName = employeeData.display_name;

      // Fetch new leads where this employee is handler
      let newLeadsQuery = supabase
        .from('leads')
        .select('id, handler, case_handler_id')
        .or(`handler.eq.${employeeDisplayName},case_handler_id.eq.${employeeId}`);

      const { data: newLeadsWithHandler, error: newLeadsError } = await newLeadsQuery;
      if (newLeadsError) {
        console.error('Error fetching new leads with handler:', newLeadsError);
      } else if (newLeadsWithHandler && newLeadsWithHandler.length > 0) {
        const newLeadIds = newLeadsWithHandler.map(l => l.id).filter(Boolean);

        if (newLeadIds.length > 0) {
          // Fetch payment plans for these leads
          let newPaymentsQuery = supabase
            .from('payment_plans')
            .select('id, lead_id, value, value_vat, currency, due_date, cancel_date, ready_to_pay')
            .eq('ready_to_pay', true)
            .not('due_date', 'is', null)
            .is('cancel_date', null)
            .in('lead_id', newLeadIds);

          if (fromDateTime) {
            newPaymentsQuery = newPaymentsQuery.gte('due_date', fromDateTime);
          }
          if (toDateTime) {
            newPaymentsQuery = newPaymentsQuery.lte('due_date', toDateTime);
          }

          const { data: newPayments, error: newPaymentsError } = await newPaymentsQuery;
          if (!newPaymentsError && newPayments) {
            newPayments.forEach((payment: any) => {
              // Use value only (no VAT) - same as modal logic
              const value = Number(payment.value || 0);
              const currency = payment.currency || '₪';

              // Normalize currency for conversion (same as modal)
              const normalizedCurrency = currency === '₪' ? 'NIS' :
                currency === '€' ? 'EUR' :
                  currency === '$' ? 'USD' :
                    currency === '£' ? 'GBP' : currency;

              // Convert value to NIS (same as modal footer calculation)
              const amountInNIS = convertToNIS(value, normalizedCurrency);
              totalDue += amountInNIS;
            });
          }
        }
      }

      // Fetch legacy leads where this employee is handler (case_handler_id)
      const { data: legacyLeadsWithHandler, error: legacyLeadsError } = await supabase
        .from('leads_lead')
        .select('id, case_handler_id')
        .eq('case_handler_id', employeeId);

      if (!legacyLeadsError && legacyLeadsWithHandler && legacyLeadsWithHandler.length > 0) {
        const legacyLeadIds = legacyLeadsWithHandler.map(l => l.id).filter(Boolean).map(id => Number(id));

        if (legacyLeadIds.length > 0) {
          // Fetch payment plans for these leads
          let legacyPaymentsQuery = supabase
            .from('finances_paymentplanrow')
            .select(`
              id,
              lead_id,
              value,
              value_base,
              vat_value,
              currency_id,
              due_date,
              cancel_date,
              accounting_currencies!finances_paymentplanrow_currency_id_fkey(name, iso_code)
            `)
            .not('due_date', 'is', null)
            .is('cancel_date', null)
            .in('lead_id', legacyLeadIds);

          if (fromDateTime) {
            legacyPaymentsQuery = legacyPaymentsQuery.gte('due_date', fromDateTime);
          }
          if (toDateTime) {
            legacyPaymentsQuery = legacyPaymentsQuery.lte('due_date', toDateTime);
          }

          const { data: legacyPayments, error: legacyPaymentsError } = await legacyPaymentsQuery;
          if (!legacyPaymentsError && legacyPayments) {
            legacyPayments.forEach((payment: any) => {
              // Use value only (no VAT) - same as modal logic
              const value = Number(payment.value || payment.value_base || 0);

              // Get currency (same as modal logic)
              const accountingCurrency: any = payment.accounting_currencies
                ? (Array.isArray(payment.accounting_currencies) ? payment.accounting_currencies[0] : payment.accounting_currencies)
                : null;
              let currency = '₪';
              if (accountingCurrency?.name) {
                currency = accountingCurrency.name;
              } else if (accountingCurrency?.iso_code) {
                currency = accountingCurrency.iso_code;
              } else if (payment.currency_id) {
                switch (payment.currency_id) {
                  case 1: currency = '₪'; break;
                  case 2: currency = '€'; break;
                  case 3: currency = '$'; break;
                  case 4: currency = '£'; break;
                  default: currency = '₪'; break;
                }
              }

              // Normalize currency for conversion (same as modal)
              const normalizedCurrency = currency === '₪' ? 'NIS' :
                currency === '€' ? 'EUR' :
                  currency === '$' ? 'USD' :
                    currency === '£' ? 'GBP' : currency;

              // Convert value to NIS (same as modal footer calculation)
              const amountInNIS = convertToNIS(value, normalizedCurrency);
              totalDue += amountInNIS;
            });
          }
        }
      }

      return totalDue;
    } catch (error) {
      console.error('Error fetching due amounts:', error);
      return 0;
    }
  }, [filters.fromDate, filters.toDate]);

  const updateEmployeeSignedPortion = useCallback((employeeId: number, signedPortion: number) => {
    setDepartmentData(prev => {
      const updated = new Map(prev);

      updated.forEach((deptData, deptName) => {
        const updatedEmployees = deptData.employees.map(emp => {
          if (emp.employeeId === employeeId) {
            return { ...emp, signedPortion: signedPortion };
          }
          return emp;
        });

        // Recalculate department totals
        const deptSignedPortion = updatedEmployees.reduce((sum, emp) => sum + emp.signedPortion, 0);

        updated.set(deptName, {
          ...deptData,
          employees: updatedEmployees,
          totals: {
            ...deptData.totals,
            signedPortion: deptSignedPortion,
          },
        });
      });

      return updated;
    });
  }, []);

  // Fetch category breakdown for a main category (field view)
  const fetchCategoryBreakdown = useCallback(async (mainCategoryName: string) => {
    const cacheKey = `${mainCategoryName}_${filters.fromDate || ''}_${filters.toDate || ''}`;

    // Check cache first
    if (categoryBreakdownCache.has(cacheKey)) {
      return;
    }

    // Set loading state
    setLoadingCategoryBreakdown(prev => {
      const newSet = new Set(prev);
      newSet.add(mainCategoryName);
      return newSet;
    });

    // Define main categories that should be shown separately (same as in processFieldViewData)
    const separateMainCategories = new Set([
      'Immigration Israel',
      'Germany',
      'Small without meetin',
      'Uncategorized',
      'USA',
      'Austria',
      'Damages',
      'Commer/Civil/Adm/Fam',
      'Other Citizenships',
      'Poland',
      'German\\Austrian',
      'Referral Commission'
    ]);

    // Helper function to check if a lead should be included
    const shouldIncludeLead = (leadMainCategory: string): boolean => {
      if (mainCategoryName === 'General') {
        // For General, include leads that are NOT in the separate list
        return !separateMainCategories.has(leadMainCategory);
      } else {
        // For specific categories, only include exact matches
        return leadMainCategory === mainCategoryName;
      }
    };

    try {
      // Step 1: Find signed leads (stage 60) in date range
      const fromDateTime = filters.fromDate ? `${filters.fromDate}T00:00:00.000Z` : null;
      const toDateTime = filters.toDate ? `${filters.toDate}T23:59:59.999Z` : null;

      let stageHistoryQuery = supabase
        .from('leads_leadstage')
        .select('id, stage, date, cdate, lead_id, newlead_id')
        .eq('stage', 60);

      if (fromDateTime) {
        stageHistoryQuery = stageHistoryQuery.gte('date', fromDateTime);
      }
      if (toDateTime) {
        stageHistoryQuery = stageHistoryQuery.lte('date', toDateTime);
      }

      const { data: stageHistoryData, error: stageHistoryError } = await stageHistoryQuery;
      if (stageHistoryError) throw stageHistoryError;

      // Separate new and legacy lead IDs
      const newLeadIds = new Set<string>();
      const legacyLeadIds = new Set<number>();

      stageHistoryData?.forEach((entry: any) => {
        if (entry.newlead_id) {
          newLeadIds.add(entry.newlead_id.toString());
        }
        if (entry.lead_id !== null && entry.lead_id !== undefined) {
          legacyLeadIds.add(Number(entry.lead_id));
        }
      });

      const categoryBreakdown: any[] = [];

      // Helper functions for calculating amounts
      const parseNumericAmount = (val: any): number => {
        if (typeof val === 'number') return val;
        if (typeof val === 'string') {
          const cleaned = val.replace(/[^0-9.-]/g, '');
          const parsed = parseFloat(cleaned);
          return Number.isNaN(parsed) ? 0 : parsed;
        }
        return 0;
      };

      const buildCurrencyMeta = (...candidates: any[]): { displaySymbol: string; conversionValue: string | number } => {
        for (const candidate of candidates) {
          if (candidate === null || candidate === undefined) continue;
          const rawValue = Array.isArray(candidate) ? candidate[0] : candidate;
          if (rawValue === null || rawValue === undefined) continue;

          if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
            const currencyMap: { [key: number]: string } = { 1: 'NIS', 2: 'USD', 3: 'EUR', 4: 'GBP' };
            return { displaySymbol: '₪', conversionValue: currencyMap[rawValue] || 'NIS' };
          }

          const valueStr = rawValue.toString().trim();
          if (!valueStr) continue;

          const numeric = Number(valueStr);
          if (!Number.isNaN(numeric) && numeric.toString() === valueStr) {
            const currencyMap: { [key: number]: string } = { 1: 'NIS', 2: 'USD', 3: 'EUR', 4: 'GBP' };
            return { displaySymbol: '₪', conversionValue: currencyMap[numeric] || 'NIS' };
          }

          const upper = valueStr.toUpperCase();
          if (upper === '₪' || upper === 'NIS' || upper === 'ILS') {
            return { displaySymbol: '₪', conversionValue: 'NIS' };
          }
          if (upper === '$' || upper === 'USD') {
            return { displaySymbol: '$', conversionValue: 'USD' };
          }
          if (upper === '€' || upper === 'EUR') {
            return { displaySymbol: '€', conversionValue: 'EUR' };
          }
          if (upper === '£' || upper === 'GBP') {
            return { displaySymbol: '£', conversionValue: 'GBP' };
          }
        }
        return { displaySymbol: '₪', conversionValue: 'NIS' };
      };

      // Fetch new leads with category and client info
      if (newLeadIds.size > 0) {
        const newLeadIdsArray = Array.from(newLeadIds);
        const { data: newLeads, error: newLeadsError } = await supabase
          .from('leads')
          .select(`
            id,
            lead_number,
            name,
            balance,
            balance_currency,
            proposal_total,
            proposal_currency,
            currency_id,
            subcontractor_fee,
            category_id,
            category,
            accounting_currencies!leads_currency_id_fkey(name, iso_code),
            misc_category!category_id(
              id,
              name,
              parent_id,
              misc_maincategory!parent_id(
                id,
                name
              )
            )
          `)
          .in('id', newLeadIdsArray);

        if (!newLeadsError && newLeads) {
          // Pre-process leads to ensure categories are correctly mapped BEFORE processing
          const processedLeads = preprocessLeadsCategories(newLeads, false);
          
          // Debug: Track uncategorized leads
          const uncategorizedLeads: any[] = [];
          
          processedLeads.forEach((lead: any) => {
            // Get main category name using helper function
            const mainCategoryNameFromLead = resolveMainCategory(
              lead.category, // category text field
              lead.category_id, // category ID
              lead.misc_category // joined misc_category data
            );

            // Debug: Track leads that resolve to Uncategorized
            if (mainCategoryNameFromLead === 'Uncategorized' && mainCategoryName === 'Uncategorized') {
              uncategorizedLeads.push({
                leadId: lead.id,
                leadNumber: lead.lead_number,
                categoryText: lead.category,
                categoryId: lead.category_id,
                hasMiscCategory: !!lead.misc_category
              });
            }

            // Get sub category name
            let subCategoryName = 'Uncategorized';
            if (lead.misc_category) {
              const category = Array.isArray(lead.misc_category) ? lead.misc_category[0] : lead.misc_category;
              subCategoryName = category?.name || lead.category || 'Uncategorized';
            } else if (lead.category) {
              subCategoryName = lead.category;
            }

            // Only process leads that match the requested main category (or should go to General)
            if (shouldIncludeLead(mainCategoryNameFromLead)) {
              // Calculate amount
              const balanceAmount = parseFloat(lead.balance || 0);
              const proposalAmount = parseFloat(lead.proposal_total || 0);
              const rawAmount = balanceAmount || proposalAmount || 0;
              const currencyCode = lead.accounting_currencies?.iso_code || lead.balance_currency || lead.proposal_currency || 'NIS';
              const amountInNIS = convertToNIS(rawAmount, currencyCode);

              // Subtract subcontractor fee
              const subcontractorFee = parseNumericAmount(lead.subcontractor_fee) || 0;
              const currencyMeta = buildCurrencyMeta(lead.currency_id, lead.proposal_currency, lead.balance_currency);
              const subcontractorFeeNIS = convertToNIS(subcontractorFee, currencyMeta.conversionValue);
              const amountAfterFee = amountInNIS - subcontractorFeeNIS;

              categoryBreakdown.push({
                category: subCategoryName,
                lead: lead.lead_number || lead.id,
                clientName: lead.name || 'Unknown',
                total: amountAfterFee,
                leadId: lead.id,
                isLegacy: false,
              });
            }
          });
          
          // Debug: Log uncategorized leads found
          if (mainCategoryName === 'Uncategorized' && uncategorizedLeads.length > 0) {
            console.log('🔍 Category Breakdown (New Leads) - Uncategorized leads found:', {
              count: uncategorizedLeads.length,
              totalNewLeads: processedLeads.length,
              samples: uncategorizedLeads.slice(0, 5)
            });
          }
        }
      }

      // Fetch legacy leads with category and client info
      if (legacyLeadIds.size > 0) {
        const legacyLeadIdsArray = Array.from(legacyLeadIds);
        const { data: legacyLeads, error: legacyLeadsError } = await supabase
          .from('leads_lead')
          .select(`
            id,
            lead_number,
            name,
            total,
            total_base,
            currency_id,
            subcontractor_fee,
            meeting_total_currency_id,
            category_id,
            category,
            accounting_currencies!leads_lead_currency_id_fkey(name, iso_code),
            misc_category!category_id(
              id,
              name,
              parent_id,
              misc_maincategory!parent_id(
                id,
                name
              )
            )
          `)
          .in('id', legacyLeadIdsArray);

        if (!legacyLeadsError && legacyLeads) {
          // Pre-process leads to ensure categories are correctly mapped BEFORE processing
          const processedLeads = preprocessLeadsCategories(legacyLeads, true);
          
          // Debug: Track uncategorized leads
          const uncategorizedLegacyLeads: any[] = [];
          
          processedLeads.forEach((lead: any) => {
            // Get main category name using helper function
            // After preprocessing, misc_category should be set, so this should work correctly
            const mainCategoryNameFromLead = resolveMainCategory(
              lead.category, // category text field
              lead.category_id, // category ID
              lead.misc_category // preprocessed misc_category data
            );
            
            // Debug: Log if category was resolved
            if (mainCategoryNameFromLead === 'Uncategorized' && lead.category && lead.category.trim() !== '') {
              console.warn('⚠️ fetchCategoryBreakdown (Legacy) - Lead still uncategorized after preprocessing:', {
                leadId: lead.id,
                leadNumber: lead.lead_number,
                categoryText: lead.category,
                categoryId: lead.category_id,
                hasMiscCategory: !!lead.misc_category,
                miscCategoryName: lead.misc_category?.name,
                miscMainCategoryName: lead.misc_category?.misc_maincategory?.name || 
                  (Array.isArray(lead.misc_category?.misc_maincategory) ? lead.misc_category.misc_maincategory[0]?.name : null)
              });
            }

            // Debug: Track leads that resolve to Uncategorized
            if (mainCategoryNameFromLead === 'Uncategorized' && mainCategoryName === 'Uncategorized') {
              uncategorizedLegacyLeads.push({
                leadId: lead.id,
                leadNumber: lead.lead_number,
                categoryText: lead.category,
                categoryId: lead.category_id,
                hasMiscCategory: !!lead.misc_category
              });
            }

            // Get sub category name
            let subCategoryName = 'Uncategorized';
            if (lead.misc_category) {
              const category = Array.isArray(lead.misc_category) ? lead.misc_category[0] : lead.misc_category;
              subCategoryName = category?.name || lead.category || 'Uncategorized';
            } else if (lead.category) {
              subCategoryName = lead.category;
            }

            // Only process leads that match the requested main category (or should go to General)
            if (shouldIncludeLead(mainCategoryNameFromLead)) {
              // Debug log for General category breakdown
              if (mainCategoryName === 'General') {
                console.log('🔍 General breakdown - Including legacy lead:', {
                  leadId: lead.id,
                  leadNumber: lead.lead_number,
                  mainCategory: mainCategoryNameFromLead,
                  subCategory: subCategoryName,
                  clientName: lead.name
                });
              }
              // Calculate amount (same logic as fetchRoleData)
              const currencyId = lead.currency_id;
              const numericCurrencyId = typeof currencyId === 'string' ? parseInt(currencyId, 10) : Number(currencyId);
              let resolvedAmount = 0;
              if (numericCurrencyId === 1) {
                resolvedAmount = parseNumericAmount(lead.total_base) || 0;
              } else {
                resolvedAmount = parseNumericAmount(lead.total) || 0;
              }

              const currencyMeta = buildCurrencyMeta(
                lead.currency_id,
                lead.meeting_total_currency_id,
                lead.accounting_currencies
              );

              const amountNIS = convertToNIS(resolvedAmount, currencyMeta.conversionValue);
              const subcontractorFee = parseNumericAmount(lead.subcontractor_fee) || 0;
              const subcontractorFeeNIS = convertToNIS(subcontractorFee, currencyMeta.conversionValue);
              const amountAfterFee = amountNIS - subcontractorFeeNIS;

              categoryBreakdown.push({
                category: subCategoryName,
                lead: lead.lead_number || lead.id,
                clientName: lead.name || 'Unknown',
                total: amountAfterFee,
                leadId: lead.id,
                isLegacy: true,
              });
            }
          });
        }
      }

      // Group by sub-category and sum totals
      const groupedByCategory = new Map<string, { category: string; leads: any[]; total: number }>();

      categoryBreakdown.forEach(item => {
        if (!groupedByCategory.has(item.category)) {
          groupedByCategory.set(item.category, {
            category: item.category,
            leads: [],
            total: 0,
          });
        }
        const group = groupedByCategory.get(item.category)!;
        group.leads.push(item);
        group.total += item.total;
      });

      // Convert to array format
      const result = Array.from(groupedByCategory.values()).map(group => ({
        category: group.category,
        leads: group.leads,
        total: group.total,
      }));

      // Cache the result
      setCategoryBreakdownCache(prev => {
        const newCache = new Map(prev);
        newCache.set(cacheKey, result);
        return newCache;
      });
    } catch (error) {
      console.error(`Error fetching category breakdown for ${mainCategoryName}:`, error);
    } finally {
      setLoadingCategoryBreakdown(prev => {
        const newSet = new Set(prev);
        newSet.delete(mainCategoryName);
        return newSet;
      });
    }
  }, [filters.fromDate, filters.toDate, categoryBreakdownCache, categoryNameToDataMap, allCategories, categoriesLoaded]);

  // Toggle row expansion
  const toggleRowExpansion = useCallback((employeeId: number, employeeName: string) => {
    const employeeKey = viewMode === 'field' ? employeeName : `${employeeId}`;

    setExpandedRows(prev => {
      const newSet = new Set(prev);
      if (newSet.has(employeeKey)) {
        newSet.delete(employeeKey);
      } else {
        newSet.add(employeeKey);
        // Fetch data based on view mode
        if (viewMode === 'field') {
          // For field view, fetch category breakdown
          const categoryKey = `${employeeName}_${filters.fromDate || ''}_${filters.toDate || ''}`;
          if (!categoryBreakdownCache.has(categoryKey)) {
            fetchCategoryBreakdown(employeeName);
          }
        } else {
          // For employee view, fetch role data
          const dateRangeKey = `${filters.fromDate || ''}_${filters.toDate || ''}`;
          const incomeKey = totalIncome || 0;
          const dueNormalizedPercentageKey = dueNormalizedPercentage || 0;
          const rolePercentagesHash = getRolePercentagesHash(rolePercentages);
          const cacheKey = `${employeeId}_${dateRangeKey}_${incomeKey}_${dueNormalizedPercentageKey}_${rolePercentagesHash}`;
          if (!roleDataCache.has(cacheKey)) {
            fetchRoleData(employeeId, employeeName);
          }
        }
      }
      return newSet;
    });
  }, [viewMode, roleDataCache, categoryBreakdownCache, fetchRoleData, fetchCategoryBreakdown, filters.fromDate, filters.toDate, totalIncome]);

  const handleSearch = async () => {
    // Wait for categories to be loaded before processing
    if (!categoriesLoaded) {
      console.warn('⚠️ handleSearch - Waiting for categories to load...');
      // Wait up to 5 seconds for categories to load
      let waitCount = 0;
      while (!categoriesLoaded && waitCount < 50) {
        await new Promise(resolve => setTimeout(resolve, 100));
        waitCount++;
      }
      if (!categoriesLoaded) {
        console.error('❌ handleSearch - Categories not loaded after waiting, proceeding anyway');
      }
    }

    setLoading(true);
    setSearchPerformed(true);
    // Fetch total signed value when search is triggered - MUST complete before calculating portions
    await fetchTotalSignedValue();
    try {
      console.log('🔍 Sales Contribution Report - Starting search with filters:', filters);
      console.log('🔍 Categories loaded:', {
        categoriesLoaded,
        mapSize: categoryNameToDataMap.size,
        allCategoriesCount: allCategories.length
      });

      // Step 1: Fetch ALL employees (similar to EmployeePerformancePage)
      // Fetch employees from users table with tenants_employee join (only active users)
      const { data: allEmployeesData, error: allEmployeesDataError } = await supabase
        .from('users')
        .select(`
          id,
          full_name,
          email,
          employee_id,
          is_active,
          tenants_employee!employee_id(
            id,
            display_name,
            bonuses_role,
            department_id,
            user_id,
            photo_url,
            photo,
            tenant_departement!department_id(
              id,
              name
            )
          )
        `)
        .not('employee_id', 'is', null)
        .eq('is_active', true);

      if (allEmployeesDataError) {
        console.error('❌ Sales Contribution Report - Error fetching employees:', allEmployeesDataError);
        throw allEmployeesDataError;
      }

      // Process employees data
      const processedEmployees = (allEmployeesData || [])
        .filter(user => user.tenants_employee && user.email)
        .map(user => {
          const employee = user.tenants_employee as any;
          const dept = Array.isArray(employee.tenant_departement) ? employee.tenant_departement[0] : employee.tenant_departement;
          return {
            id: Number(employee.id),
            display_name: employee.display_name,
            bonuses_role: employee.bonuses_role || null,
            department: dept?.name || 'Unknown',
            photo_url: employee.photo_url || employee.photo || null,
            email: user.email,
          };
        });

      // Deduplicate by employee ID
      const uniqueEmployeesMap = new Map();
      processedEmployees.forEach(emp => {
        if (!uniqueEmployeesMap.has(emp.id)) {
          uniqueEmployeesMap.set(emp.id, emp);
        }
      });
      const allEmployees = Array.from(uniqueEmployeesMap.values());

      // Store employee data in employeeMap for avatar access
      const newEmployeeMap = new Map<number, { display_name: string; department: string; photo_url?: string | null }>();
      allEmployees.forEach(emp => {
        newEmployeeMap.set(emp.id, {
          display_name: emp.display_name,
          department: emp.department,
          photo_url: emp.photo_url,
        });
      });
      setEmployeeMap(newEmployeeMap);

      // Filter out excluded employees (same as EmployeePerformancePage)
      const excludedEmployees = ['FINANCE', 'INTERNS', 'NO SCHEDULER', 'Mango Test', 'pink', 'Interns'];
      const filteredEmployees = allEmployees.filter(emp =>
        !excludedEmployees.includes(emp.display_name)
      );

      console.log('✅ Sales Contribution Report - Fetched', filteredEmployees.length, 'employees');

      // Step 2: Group employees by bonuses_role (same logic as EmployeePerformancePage)
      // Helper function to determine department from bonuses_role and department name
      const getDepartmentFromEmployee = (emp: any): string => {
        const role = emp.bonuses_role?.toLowerCase() || '';
        const deptName = emp.department?.toLowerCase() || '';

        // Sales: scheduler, manager, closer, expert (s, z, Z, c, e)
        if (['s', 'z', 'c', 'e'].includes(role)) {
          return 'Sales';
        }
        // Handlers: handler (h, d, dm) - Note: 'e' (Expert) is excluded from Handlers
        if (['h', 'd', 'dm'].includes(role)) {
          return 'Handlers';
        }
        // Marketing: marketing (ma)
        if (['ma'].includes(role)) {
          return 'Marketing';
        }
        // Partners: partners (p, m, pm, se, b, partners, dv) - Note: 'dm' moved to Handlers
        if (['p', 'm', 'pm', 'se', 'b', 'partners', 'dv'].includes(role)) {
          return 'Partners';
        }
        // Finance/Collection: collection (col) or department name contains finance/collection
        if (['col'].includes(role) || deptName.includes('finance') || deptName.includes('collection')) {
          return 'Finance';
        }

        return 'Sales'; // Default
      };

      // Group employees by department using bonuses_role (same logic as EmployeePerformancePage)
      const salesEmployees = filteredEmployees.filter(emp => {
        const role = emp.bonuses_role;
        return role && ['s', 'z', 'Z', 'c', 'e'].includes(role);
      });

      const handlersEmployees = filteredEmployees.filter(emp => {
        const role = emp.bonuses_role;
        // Include h, d, dm - but exclude 'e' (Expert) from Handlers
        return role && ['h', 'd', 'dm'].includes(role);
      });

      const marketingEmployees = filteredEmployees.filter(emp => {
        const role = emp.bonuses_role;
        return role && ['ma'].includes(role);
      });

      const financeEmployees = filteredEmployees.filter(emp => {
        const dept = emp.department?.toLowerCase() || '';
        const role = emp.bonuses_role;
        return dept.includes('finance') ||
          dept.includes('collection') ||
          (role && ['col'].includes(role));
      });

      const partnersEmployees = filteredEmployees.filter(emp => {
        const role = emp.bonuses_role;
        // Note: 'dm' moved to Handlers
        return role && ['p', 'm', 'pm', 'se', 'b', 'partners', 'dv'].includes(role);
      });

      console.log('✅ Sales Contribution Report - Grouped employees:', {
        Sales: salesEmployees.length,
        Handlers: handlersEmployees.length,
        Marketing: marketingEmployees.length,
        Finance: financeEmployees.length,
        Partners: partnersEmployees.length,
      });

      // Step 3: Create EmployeeData entries for all employees (with 0 data for now)
      const departmentEmployeeData = new Map<string, Map<number, EmployeeData>>();

      // Initialize department maps
      departmentNames.forEach(deptName => {
        departmentEmployeeData.set(deptName, new Map());
      });

      // Helper to create employee data with zeros
      const createEmployeeData = (emp: any): EmployeeData => {
        return {
          employeeId: emp.id,
          employeeName: emp.display_name,
          department: emp.department || 'Unknown',
          photoUrl: emp.photo_url || null,
          signed: 0,
          signedNormalized: 0,
          dueNormalized: 0,
          signedPortion: 0,
          salaryBudget: 0,
          salaryBrutto: 0,
          totalSalaryCost: 0,
          due: 0,
          duePortion: 0,
          total: 0,
          totalPortionDue: 0,
          percentOfIncome: 0,
          normalized: 0,
        };
      };

      // Add employees to their respective departments
      salesEmployees.forEach(emp => {
        const deptMap = departmentEmployeeData.get('Sales')!;
        deptMap.set(emp.id, createEmployeeData(emp));
      });

      handlersEmployees.forEach(emp => {
        const deptMap = departmentEmployeeData.get('Handlers')!;
        deptMap.set(emp.id, createEmployeeData(emp));
      });

      marketingEmployees.forEach(emp => {
        const deptMap = departmentEmployeeData.get('Marketing')!;
        deptMap.set(emp.id, createEmployeeData(emp));
      });

      financeEmployees.forEach(emp => {
        const deptMap = departmentEmployeeData.get('Finance')!;
        deptMap.set(emp.id, createEmployeeData(emp));
      });

      partnersEmployees.forEach(emp => {
        const deptMap = departmentEmployeeData.get('Partners')!;
        deptMap.set(emp.id, createEmployeeData(emp));
      });

      // Step 4: Calculate totals and percentages (all zeros for now)
      let globalTotal = 0;
      // Note: Don't reset totalIncome here - it should persist across searches

      // Calculate portions and percentages
      const finalDepartmentData = new Map<string, DepartmentData>();

      departmentNames.forEach(deptName => {
        const empMap = departmentEmployeeData.get(deptName);
        if (!empMap) {
          finalDepartmentData.set(deptName, {
            departmentName: deptName,
            employees: [],
            totals: {
              signed: 0,
              signedNormalized: 0,
              dueNormalized: 0,
              signedPortion: 0,
              salaryBudget: 0,
              salaryBrutto: 0,
              totalSalaryCost: 0,
              due: 0,
              duePortion: 0,
              total: 0,
              totalPortionDue: 0,
              percentOfIncome: 0,
              normalized: 0,
            },
          });
          return;
        }

        const employees: EmployeeData[] = [];
        let deptSigned = 0;
        let deptSignedNormalized = 0;
        let deptDueNormalized = 0;
        let deptSignedPortion = 0;
        let deptSalaryBudget = 0;
        let deptSalaryBrutto = 0;
        let deptTotalSalaryCost = 0;
        let deptDue = 0;
        let deptDuePortion = 0;
        let deptTotal = 0;
        let deptTotalPortionDue = 0;

        empMap.forEach(empData => {
          // Calculate signed total from role breakdown if available
          // Include date range, income, due normalized percentage, and role percentages hash in cache key to get correct data
          const dateRangeKey = `${filters.fromDate || ''}_${filters.toDate || ''}`;
          const incomeKey = totalIncome || 0;
          const dueNormalizedPercentageKey = dueNormalizedPercentage || 0;
          const rolePercentagesHash = getRolePercentagesHash(rolePercentages);
          const cacheKey = `${empData.employeeId}_${dateRangeKey}_${incomeKey}_${dueNormalizedPercentageKey}_${rolePercentagesHash}`;
          const roleData = roleDataCache.get(cacheKey) || [];
          if (roleData.length > 0) {
            // Sum up all signedTotal from role combinations for this employee
            const totalSigned = roleData.reduce((sum, roleItem) => sum + (roleItem.signedTotal || 0), 0);
            empData.signed = totalSigned;
          }

          // Portions are already calculated during processing based on role percentages
          // Calculate percent of income and normalized
          empData.percentOfIncome = globalTotal > 0 ? (empData.total / globalTotal) * 100 : 0;
          empData.normalized = empData.total; // Already in NIS

          employees.push(empData);

          deptSigned += empData.signed;
          deptSignedNormalized += empData.signedNormalized || 0;
          deptDueNormalized += empData.dueNormalized || 0;
          deptSignedPortion += empData.signedPortion;
          deptSalaryBudget += empData.salaryBudget || 0;
          deptSalaryBrutto += empData.salaryBrutto || 0;
          deptTotalSalaryCost += empData.totalSalaryCost || 0;
          deptDue += empData.due;
          deptDuePortion += empData.duePortion;
          deptTotal += empData.total;
          deptTotalPortionDue += empData.totalPortionDue;
        });

        const deptPercentOfIncome = globalTotal > 0 ? (deptTotal / globalTotal) * 100 : 0;
        const deptNormalized = deptTotal;

        finalDepartmentData.set(deptName, {
          departmentName: deptName,
          employees: employees.sort((a, b) => a.employeeName.localeCompare(b.employeeName)), // Sort by name alphabetically
          totals: {
            signed: deptSigned,
            signedNormalized: deptSignedNormalized,
            dueNormalized: deptDueNormalized,
            signedPortion: deptSignedPortion,
            salaryBudget: deptSalaryBudget,
            salaryBrutto: deptSalaryBrutto,
            totalSalaryCost: deptTotalSalaryCost,
            due: deptDue,
            duePortion: deptDuePortion,
            total: deptTotal,
            totalPortionDue: deptTotalPortionDue,
            percentOfIncome: deptPercentOfIncome,
            normalized: deptNormalized,
          },
        });
      });

      setDepartmentData(finalDepartmentData);
      console.log('✅ Sales Contribution Report - Processed data for', finalDepartmentData.size, 'departments');

      // Set loading to false immediately so table shows right away
      setLoading(false);

      // Fetch role data for all employees to populate signed totals in the background
      const allEmployeeIds: number[] = [];
      const employeeNamesMap = new Map<number, string>();

      finalDepartmentData.forEach(deptData => {
        deptData.employees.forEach(emp => {
          if (!allEmployeeIds.includes(emp.employeeId)) {
            allEmployeeIds.push(emp.employeeId);
            employeeNamesMap.set(emp.employeeId, emp.employeeName);
          }
        });
      });

      // Wait a bit to ensure totalSignedValue state is updated after fetchTotalSignedValue
      // This is a workaround for React state batching - we need the latest totalSignedValue
      await new Promise(resolve => setTimeout(resolve, 100));

      // Fetch role data in the background (non-blocking)
      const dateRangeKey = `${filters.fromDate || ''}_${filters.toDate || ''}`;
      const incomeKey = totalIncome || 0;
      const dueNormalizedPercentageKey = dueNormalizedPercentage || 0;

      // Collect all employees that need fetching
      const rolePercentagesHash = getRolePercentagesHash(rolePercentages);
      const employeesToFetch: Array<{ id: number; name: string }> = [];
      allEmployeeIds.forEach(employeeId => {
        const cacheKey = `${employeeId}_${dateRangeKey}_${incomeKey}_${dueNormalizedPercentageKey}_${rolePercentagesHash}`;
        // Only fetch if not already cached for current date range, income, due normalized percentage, and role percentages
        if (!roleDataCache.has(cacheKey)) {
          const employeeName = employeeNamesMap.get(employeeId) || '';
          employeesToFetch.push({ id: employeeId, name: employeeName });
        }
      });

      // Batch calculate all employees at once to prevent "popcorn" rendering
      // This ensures all calculations are done before any state updates
      if (employeesToFetch.length > 0) {
        setIsCalculating(true);
        
        // Fetch all data first, then calculate everything, then update state once
      (async () => {
          try {
            const fromDateTime = filters.fromDate ? `${filters.fromDate}T00:00:00.000Z` : null;
            const toDateTime = filters.toDate ? `${filters.toDate}T23:59:59.999Z` : null;

            // Step 1: Fetch all signed leads (stage 60) - ONCE for all employees
            let stageHistoryQuery = supabase
              .from('leads_leadstage')
              .select('id, stage, date, cdate, lead_id, newlead_id')
              .eq('stage', 60);

            if (fromDateTime) {
              stageHistoryQuery = stageHistoryQuery.gte('date', fromDateTime);
            }
            if (toDateTime) {
              stageHistoryQuery = stageHistoryQuery.lte('date', toDateTime);
            }

            const { data: stageHistoryData, error: stageHistoryError } = await stageHistoryQuery;
            if (stageHistoryError) throw stageHistoryError;

            // Separate new and legacy lead IDs
            const allNewLeadIds = new Set<string>();
            const allLegacyLeadIds = new Set<number>();

            stageHistoryData?.forEach((entry: any) => {
              if (entry.newlead_id) {
                allNewLeadIds.add(entry.newlead_id.toString());
              }
              if (entry.lead_id !== null && entry.lead_id !== undefined) {
                allLegacyLeadIds.add(Number(entry.lead_id));
              }
            });

            // Step 2: Fetch all new leads - ONCE
            const newLeadsMap = new Map();
            if (allNewLeadIds.size > 0) {
              const newLeadIdsArray = Array.from(allNewLeadIds);
              const { data: newLeads, error: newLeadsError } = await supabase
                .from('leads')
                .select(`
                  id,
                  balance,
                  balance_currency,
                  proposal_total,
                  proposal_currency,
                  currency_id,
                  closer,
                  scheduler,
                  handler,
                  helper,
                  expert,
                  case_handler_id,
                  meeting_manager_id,
                  subcontractor_fee,
                  category_id,
                  category,
                  accounting_currencies!leads_currency_id_fkey(name, iso_code),
                  misc_category!category_id(
                    id,
                    name,
                    parent_id,
                    misc_maincategory!parent_id(
                      id,
                      name
                    )
                  )
                `)
                .in('id', newLeadIdsArray);

              if (!newLeadsError && newLeads) {
                // Pre-process leads to ensure categories are correctly mapped
                const processedLeads = preprocessLeadsCategories(newLeads, false);
                processedLeads.forEach(lead => {
                  newLeadsMap.set(lead.id, lead);
                });
              }
            }

            // Step 3: Fetch all legacy leads - ONCE
            const legacyLeadsMap = new Map();
            if (allLegacyLeadIds.size > 0) {
              const legacyLeadIdsArray = Array.from(allLegacyLeadIds);
              const { data: legacyLeads, error: legacyLeadsError } = await supabase
          .from('leads_lead')
          .select(`
            id,
            total,
            total_base,
            currency_id,
            subcontractor_fee,
            meeting_total_currency_id,
            closer_id,
            meeting_scheduler_id,
            meeting_lawyer_id,
            case_handler_id,
            meeting_manager_id,
            expert_id,
            category_id,
            category,
            accounting_currencies!leads_lead_currency_id_fkey(name, iso_code),
            misc_category!category_id(
              id,
              name,
              parent_id,
              misc_maincategory!parent_id(
                id,
                name
              )
            )
          `)
          .in('id', legacyLeadIdsArray);

              if (!legacyLeadsError && legacyLeads) {
                // Pre-process leads to ensure categories are correctly mapped
                const processedLeads = preprocessLeadsCategories(legacyLeads, true);
                processedLeads.forEach(lead => {
                  legacyLeadsMap.set(Number(lead.id), lead);
                });
              }
            }

            // Step 4: Fetch all payment plans - ONCE
            const newPaymentsMap = new Map<string, number>();
            const legacyPaymentsMap = new Map<number, number>();

            if (allNewLeadIds.size > 0) {
              const newLeadIdsArray = Array.from(allNewLeadIds);
              let newPaymentsQuery = supabase
                .from('payment_plans')
                .select('lead_id, value, currency, due_date')
                .eq('ready_to_pay', true)
                .eq('paid', false)
                .not('due_date', 'is', null)
                .is('cancel_date', null)
                .in('lead_id', newLeadIdsArray);

              if (fromDateTime) {
                newPaymentsQuery = newPaymentsQuery.gte('due_date', fromDateTime);
              }
              if (toDateTime) {
                newPaymentsQuery = newPaymentsQuery.lte('due_date', toDateTime);
              }

              const { data: newPayments } = await newPaymentsQuery;
              newPayments?.forEach((payment: any) => {
                const leadId = payment.lead_id;
                const value = Number(payment.value || 0);
                const currency = payment.currency || '₪';
                const normalizedCurrency = currency === '₪' ? 'NIS' :
                  currency === '€' ? 'EUR' :
                    currency === '$' ? 'USD' :
                      currency === '£' ? 'GBP' : currency;
                const amountNIS = convertToNIS(value, normalizedCurrency);
                const current = newPaymentsMap.get(leadId) || 0;
                newPaymentsMap.set(leadId, current + amountNIS);
              });
            }

            if (allLegacyLeadIds.size > 0) {
              const legacyLeadIdsArray = Array.from(allLegacyLeadIds);
              let legacyPaymentsQuery = supabase
                .from('finances_paymentplanrow')
                .select('lead_id, value, value_base, currency_id, due_date, accounting_currencies!finances_paymentplanrow_currency_id_fkey(name, iso_code)')
                .is('actual_date', null)
                .eq('ready_to_pay', true)
                .not('due_date', 'is', null)
                .in('lead_id', legacyLeadIdsArray);

              if (fromDateTime) {
                legacyPaymentsQuery = legacyPaymentsQuery.gte('due_date', fromDateTime);
              }
              if (toDateTime) {
                legacyPaymentsQuery = legacyPaymentsQuery.lte('due_date', toDateTime);
              }

              const { data: legacyPayments } = await legacyPaymentsQuery;
              legacyPayments?.forEach((payment: any) => {
                const leadId = Number(payment.lead_id);
                const value = Number(payment.value || payment.value_base || 0);
                const accountingCurrency: any = payment.accounting_currencies
                  ? (Array.isArray(payment.accounting_currencies) ? payment.accounting_currencies[0] : payment.accounting_currencies)
                  : null;
                let currency = '₪';
                if (accountingCurrency?.name) {
                  currency = accountingCurrency.name;
                } else if (accountingCurrency?.iso_code) {
                  currency = accountingCurrency.iso_code;
                }
                const normalizedCurrency = currency === '₪' ? 'NIS' :
                  currency === '€' ? 'EUR' :
                    currency === '$' ? 'USD' :
                      currency === '£' ? 'GBP' : currency;
                const amountNIS = convertToNIS(value, normalizedCurrency);
                const current = legacyPaymentsMap.get(leadId) || 0;
                legacyPaymentsMap.set(leadId, current + amountNIS);
              });
            }

            // Step 5: Process field view data (grouped by main category) - do this once for all employees
            await processFieldViewData(newLeadsMap, legacyLeadsMap, newPaymentsMap, legacyPaymentsMap);

            // Step 6: Fetch due amounts for all handlers in parallel
            const dueAmountsMap = new Map<number, number>();
          await Promise.all(
              employeesToFetch.map(async ({ id, name }) => {
                const dueAmount = await fetchDueAmounts(id, name);
                if (dueAmount > 0) {
                  dueAmountsMap.set(id, dueAmount);
                }
              })
            );

            // Step 6.5: Fetch salary data for all employees based on toDate filter
            const salaryDataMap = new Map<number, { salaryBrutto: number; totalSalaryCost: number }>();
            if (filters.toDate && allEmployeeIds.length > 0) {
              try {
                // Parse toDate to get month and year
                const toDateObj = new Date(filters.toDate + 'T00:00:00'); // Add time to ensure correct date parsing
                const salaryMonth = toDateObj.getMonth() + 1; // getMonth() returns 0-11, we need 1-12
                const salaryYear = toDateObj.getFullYear();

                console.log('🔍 Fetching salary data:', {
                  toDate: filters.toDate,
                  salaryMonth,
                  salaryYear,
                  employeeCount: allEmployeeIds.length
                });

                // Fetch salary data for all employees
                const { data: salaryData, error: salaryError } = await supabase
                  .from('employee_salary')
                  .select('employee_id, net_salary, gross_salary')
                  .eq('salary_month', salaryMonth)
                  .eq('salary_year', salaryYear)
                  .in('employee_id', allEmployeeIds);

                console.log('✅ Salary data fetched:', {
                  count: salaryData?.length || 0,
                  error: salaryError?.message
                });

                if (!salaryError && salaryData) {
                  salaryData.forEach((salary: any) => {
                    const employeeId = Number(salary.employee_id);
                    salaryDataMap.set(employeeId, {
                      salaryBrutto: Number(salary.net_salary || 0),
                      totalSalaryCost: Number(salary.gross_salary || 0),
                    });
                  });
                } else if (salaryError) {
                  console.error('Error fetching salary data:', salaryError);
                }
              } catch (error) {
                console.error('Error in salary data fetch:', error);
              }
            }

            // Step 7: Filter leads for each employee and prepare calculation inputs
            const calculationInputs: EmployeeCalculationInput[] = [];
            const totalSignedOverall = totalSignedValueRef.current || 0;

            employeesToFetch.forEach(({ id: employeeId, name: employeeName }) => {
              // Helper to check if employee is in a role for a new lead
              const checkEmployeeInRole = (lead: any, roleField: string): boolean => {
                if (roleField === 'closer' && lead.closer) {
                  const closerValue = lead.closer;
                  return typeof closerValue === 'string'
                    ? closerValue.toLowerCase() === employeeName.toLowerCase()
                    : Number(closerValue) === employeeId;
                } else if (roleField === 'scheduler' && lead.scheduler) {
                  const schedulerValue = lead.scheduler;
                  return typeof schedulerValue === 'string'
                    ? schedulerValue.toLowerCase() === employeeName.toLowerCase()
                    : Number(schedulerValue) === employeeId;
                } else if (roleField === 'handler') {
                  if (lead.handler) {
                    const handlerValue = lead.handler;
                    if (typeof handlerValue === 'string' && handlerValue.toLowerCase() === employeeName.toLowerCase()) {
                      return true;
                    }
                    if (Number(handlerValue) === employeeId) {
                      return true;
                    }
                  }
                  if (lead.case_handler_id && Number(lead.case_handler_id) === employeeId) {
                    return true;
                  }
                  return false;
                } else if (roleField === 'helper' && lead.helper) {
                  const helperValue = lead.helper;
                  return typeof helperValue === 'string'
                    ? helperValue.toLowerCase() === employeeName.toLowerCase()
                    : Number(helperValue) === employeeId;
                } else if (roleField === 'expert' && lead.expert) {
                  return Number(lead.expert) === employeeId;
                } else if (roleField === 'meeting_manager_id' && lead.meeting_manager_id) {
                  return Number(lead.meeting_manager_id) === employeeId;
                }
                return false;
              };

              // Filter new leads for this employee
              const employeeNewLeads = Array.from(newLeadsMap.values()).filter(lead => {
                return (
                  checkEmployeeInRole(lead, 'closer') ||
                  checkEmployeeInRole(lead, 'scheduler') ||
                  checkEmployeeInRole(lead, 'handler') ||
                  checkEmployeeInRole(lead, 'helper') ||
                  checkEmployeeInRole(lead, 'expert') ||
                  checkEmployeeInRole(lead, 'meeting_manager_id')
                );
              });

              // Filter legacy leads for this employee
              const employeeLegacyLeads = Array.from(legacyLeadsMap.values()).filter(lead => {
                return (
                  (lead.closer_id && Number(lead.closer_id) === employeeId) ||
                  (lead.meeting_scheduler_id && Number(lead.meeting_scheduler_id) === employeeId) ||
                  (lead.meeting_lawyer_id && Number(lead.meeting_lawyer_id) === employeeId) ||
                  (lead.case_handler_id && Number(lead.case_handler_id) === employeeId) ||
                  (lead.expert_id && Number(lead.expert_id) === employeeId) ||
                  (lead.meeting_manager_id && Number(lead.meeting_manager_id) === employeeId)
                );
              });

              calculationInputs.push({
                employeeId,
                employeeName,
                leads: {
                  newLeads: employeeNewLeads,
                  legacyLeads: employeeLegacyLeads,
                },
                payments: {
                  newPayments: newPaymentsMap,
                  legacyPayments: legacyPaymentsMap,
                },
                totalDueAmount: dueAmountsMap.get(employeeId) || 0,
                totalSignedOverall,
                totalIncome,
                dueNormalizedPercentage,
                rolePercentages,
              });
            });

            // Step 8: Calculate ALL employee metrics in one batch (PURE calculation, no async)
            const calculationResults = batchCalculateEmployeeMetrics(calculationInputs);

            // Step 9: Update state ONCE with all results
            const dateRangeKey = `${filters.fromDate || ''}_${filters.toDate || ''}`;
            const incomeKey = totalIncome || 0;
            const dueNormalizedPercentageKey = dueNormalizedPercentage || 0;
            const rolePercentagesHash = getRolePercentagesHash(rolePercentages);

            // Update role data cache
            setRoleDataCache(prev => {
              const newCache = new Map(prev);
              calculationResults.forEach((result, employeeId) => {
                const cacheKey = `${employeeId}_${dateRangeKey}_${incomeKey}_${dueNormalizedPercentageKey}_${rolePercentagesHash}`;
                newCache.set(cacheKey, result.roleBreakdown.map(r => ({
                  role: r.role,
                  signedTotal: r.signedTotal,
                  dueTotal: r.dueTotal,
                  roles: r.roles,
                  action: '',
                })));
              });
              return newCache;
            });

            // Update department data ONCE
            setDepartmentData(prev => {
              const updated = new Map(prev);
              
              updated.forEach((deptData, deptName) => {
                const updatedEmployees = deptData.employees.map(emp => {
                  const result = calculationResults.get(emp.employeeId);
                  const salaryData = salaryDataMap.get(emp.employeeId);
                  
                  // Always update salary data if available
                  const updatedEmp: EmployeeData = {
                    ...emp,
                    salaryBrutto: salaryData?.salaryBrutto || emp.salaryBrutto || 0,
                    totalSalaryCost: salaryData?.totalSalaryCost || emp.totalSalaryCost || 0,
                  };
                  
                  // Update calculation results if available
                  if (result) {
                    updatedEmp.signed = result.signed;
                    updatedEmp.due = result.due;
                    updatedEmp.signedNormalized = result.signedNormalized;
                    updatedEmp.dueNormalized = result.dueNormalized;
                    updatedEmp.signedPortion = result.contribution;
                    updatedEmp.salaryBudget = result.salaryBudget;
                  }
                  
                  return updatedEmp;
                });

                // Recalculate department totals
                const deptSigned = updatedEmployees.reduce((sum, emp) => sum + (emp.signed || 0), 0);
                const deptDue = updatedEmployees.reduce((sum, emp) => sum + (emp.due || 0), 0);
                const deptSignedNormalized = updatedEmployees.reduce((sum, emp) => sum + (emp.signedNormalized || 0), 0);
                const deptDueNormalized = updatedEmployees.reduce((sum, emp) => sum + (emp.dueNormalized || 0), 0);
                const deptSignedPortion = updatedEmployees.reduce((sum, emp) => sum + (emp.signedPortion || 0), 0);
                const deptSalaryBudget = updatedEmployees.reduce((sum, emp) => sum + (emp.salaryBudget || 0), 0);
                const deptSalaryBrutto = updatedEmployees.reduce((sum, emp) => sum + (emp.salaryBrutto || 0), 0);
                const deptTotalSalaryCost = updatedEmployees.reduce((sum, emp) => sum + (emp.totalSalaryCost || 0), 0);

                updated.set(deptName, {
                  ...deptData,
                  employees: updatedEmployees,
                  totals: {
                    ...deptData.totals,
                    signed: deptSigned,
                    due: deptDue,
                    signedNormalized: deptSignedNormalized,
                    dueNormalized: deptDueNormalized,
                    signedPortion: deptSignedPortion,
                    salaryBudget: deptSalaryBudget,
                    salaryBrutto: deptSalaryBrutto,
                    totalSalaryCost: deptTotalSalaryCost,
                  },
                });
              });

              return updated;
            });

            setIsCalculating(false);
          } catch (error) {
            console.error('Error in batch calculation:', error);
            toast.error('Failed to calculate employee metrics');
            setIsCalculating(false);
          }
        })();
      }
    } catch (error) {
      console.error('❌ Sales Contribution Report - Error:', error);
      toast.error('Failed to fetch sales contribution data');
      setLoading(false);
    }
  };

  // Helper function to normalize category text for matching
  const normalizeCategoryText = useCallback((text: string): string => {
    return text
      .trim()
      .toLowerCase()
      .replace(/[^\w\s]/g, '') // Remove special characters
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }, []);

  // Helper function to find best matching category from map
  const findBestCategoryMatch = useCallback((categoryValue: string): any => {
    if (!categoryValue || typeof categoryValue !== 'string' || categoryValue.trim() === '') {
      return null;
    }

    const trimmedValue = categoryValue.trim();
    const normalizedValue = normalizeCategoryText(trimmedValue);
    
    // Try exact match first (normalized)
    let mappedCategory = categoryNameToDataMap.get(normalizedValue);
    if (mappedCategory) return mappedCategory;
    
    // Try exact match with original case
    mappedCategory = categoryNameToDataMap.get(trimmedValue.toLowerCase());
    if (mappedCategory) return mappedCategory;
    
    // If no exact match, try matching the category name part (before parentheses)
    if (trimmedValue.includes('(')) {
      const categoryNamePart = trimmedValue.split('(')[0].trim().toLowerCase();
      mappedCategory = categoryNameToDataMap.get(categoryNamePart);
      if (mappedCategory) return mappedCategory;
      
      const normalizedCategoryNamePart = normalizeCategoryText(categoryNamePart);
      mappedCategory = categoryNameToDataMap.get(normalizedCategoryNamePart);
      if (mappedCategory) return mappedCategory;
    }
    
    // Try removing all spaces and special characters for comparison
    const normalizedValueNoSpaces = normalizedValue.replace(/[\s_-]/g, '');
    
    // Try exact match after removing spaces
    for (const [mapKey, mapValue] of categoryNameToDataMap.entries()) {
      const normalizedMapKey = normalizeCategoryText(mapKey).replace(/[\s_-]/g, '');
      if (normalizedMapKey === normalizedValueNoSpaces) {
        return mapValue;
      }
    }
    
    // Try matching just the category name part (before parentheses in map key)
    for (const [mapKey, mapValue] of categoryNameToDataMap.entries()) {
      const mapKeyNamePart = mapKey.split('(')[0].trim().toLowerCase().replace(/[\s_-]/g, '');
      if (mapKeyNamePart === normalizedValueNoSpaces || normalizedValueNoSpaces === mapKeyNamePart) {
        return mapValue;
      }
    }
    
    // Try substring matching (one contains the other) - be more lenient
    for (const [mapKey, mapValue] of categoryNameToDataMap.entries()) {
      const normalizedMapKey = normalizeCategoryText(mapKey).replace(/[\s_-]/g, '');
      
      if (normalizedMapKey.includes(normalizedValueNoSpaces) || normalizedValueNoSpaces.includes(normalizedMapKey)) {
        const lengthDiff = Math.abs(normalizedMapKey.length - normalizedValueNoSpaces.length);
        const minLength = Math.min(normalizedMapKey.length, normalizedValueNoSpaces.length);
        // Allow match if difference is small relative to the shorter string (up to 50% difference)
        if (lengthDiff <= Math.max(3, minLength * 0.5)) {
          return mapValue;
        }
      }
    }
    
    // Try word-by-word matching (for cases like "Small without meetin" vs "Small Without Meeting")
    const valueWords = normalizedValue.split(/[\s_-]+/).filter(w => w.length > 0);
    if (valueWords.length > 0) {
      for (const [mapKey, mapValue] of categoryNameToDataMap.entries()) {
        const mapKeyWords = normalizeCategoryText(mapKey).split(/[\s_-]+/).filter(w => w.length > 0);
        if (mapKeyWords.length > 0) {
          const matchingWords = mapKeyWords.filter(word => 
            valueWords.some(vw => 
              vw === word || 
              word.includes(vw) || 
              vw.includes(word) ||
              word.startsWith(vw) ||
              vw.startsWith(word)
            )
          );
          // If most words match (at least 60% of words), consider it a match
          const matchRatio = matchingWords.length / Math.min(mapKeyWords.length, valueWords.length);
          if (matchRatio >= 0.6 && matchingWords.length > 0) {
            return mapValue;
          }
        }
      }
    }
    
    // Try character-by-character similarity (Levenshtein-like, simplified)
    let bestMatch: { category: any; score: number } | null = null;
    for (const [mapKey, mapValue] of categoryNameToDataMap.entries()) {
      const normalizedMapKey = normalizeCategoryText(mapKey);
      const shorter = normalizedValue.length < normalizedMapKey.length ? normalizedValue : normalizedMapKey;
      const longer = normalizedValue.length >= normalizedMapKey.length ? normalizedValue : normalizedMapKey;
      
      // Calculate simple similarity score
      let matches = 0;
      for (let i = 0; i < shorter.length; i++) {
        if (longer.includes(shorter[i])) matches++;
      }
      const score = matches / Math.max(shorter.length, 1);
      
      // If similarity is high enough (70%+), consider it a match
      if (score >= 0.7 && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { category: mapValue, score };
      }
    }
    
    if (bestMatch) {
      return bestMatch.category;
    }
    
    return null;
  }, [categoryNameToDataMap, normalizeCategoryText]);

  // Helper function to resolve main category from lead (similar to CollectionDueReportPage)
  const resolveMainCategory = (
    categoryValue?: string | null,
    categoryId?: string | number | null,
    miscCategory?: any
  ): string => {
    // Check if miscCategory is actually valid (not null, undefined, or empty array)
    // Supabase joins return null or empty array when there's no match
    const hasMiscCategory = miscCategory !== null &&
      miscCategory !== undefined &&
      !(Array.isArray(miscCategory) && miscCategory.length === 0) &&
      (Array.isArray(miscCategory) ? miscCategory.length > 0 && miscCategory[0] : miscCategory);

    // First, try to use the joined miscCategory if it's valid
    let resolvedMiscCategory = hasMiscCategory ? (Array.isArray(miscCategory) ? miscCategory[0] : miscCategory) : null;

    // If we don't have a valid miscCategory, try to look up by category_id first
    if (!resolvedMiscCategory && categoryId && allCategories.length > 0) {
      const categoryById = allCategories.find((cat: any) => cat.id.toString() === categoryId.toString());
      if (categoryById) {
        resolvedMiscCategory = categoryById;
      }
    }

    // If we still don't have a category, try to look it up by text category name in the map
    // This is important for new leads that have category saved as text
    if (!resolvedMiscCategory && categoryValue && typeof categoryValue === 'string' && categoryValue.trim() !== '' && categoryNameToDataMap.size > 0) {
      const mappedCategory = findBestCategoryMatch(categoryValue);
      if (mappedCategory) {
        resolvedMiscCategory = mappedCategory;
      }
    }

    // If we still don't have a category, return 'Uncategorized'
    if (!resolvedMiscCategory) {
      // Log for debugging - helps identify which categories are not being mapped
      if (categoryValue && categoryValue.trim() !== '') {
        const normalizedValue = normalizeCategoryText(categoryValue);
        const sampleMapKeys = Array.from(categoryNameToDataMap.keys()).slice(0, 20);
        console.warn('⚠️ Sales Contribution - Could not resolve category:', {
          categoryValue,
          normalizedValue,
          categoryId,
          hasMiscCategory: !!hasMiscCategory,
          mapSize: categoryNameToDataMap.size,
          sampleMapKeys,
          allCategoriesCount: allCategories.length,
          // Show similar keys for debugging
          similarKeys: Array.from(categoryNameToDataMap.keys()).filter(key => {
            const normalizedKey = normalizeCategoryText(key);
            return normalizedKey.includes(normalizedValue) || normalizedValue.includes(normalizedKey);
          }).slice(0, 5)
        });
      }
      return 'Uncategorized';
    }

    // Handle array case (shouldn't happen at this point, but be safe)
    const categoryRecord = Array.isArray(resolvedMiscCategory) ? resolvedMiscCategory[0] : resolvedMiscCategory;
    if (!categoryRecord) {
      return 'Uncategorized';
    }

    // Extract main category (handle both array and object cases)
    let mainCategory = Array.isArray(categoryRecord.misc_maincategory)
      ? categoryRecord.misc_maincategory[0]
      : categoryRecord.misc_maincategory;

    if (!mainCategory) {
      return 'Uncategorized';
    }

    return mainCategory.name || 'Uncategorized';
  };

  // Pre-process leads to ensure all categories are correctly mapped
  const preprocessLeadsCategories = useCallback((leads: any[], isLegacy: boolean = false): any[] => {
    if (!leads || leads.length === 0) return leads;
    
    // If categories aren't loaded yet, we can't preprocess - this should not happen if called correctly
    if (!categoriesLoaded || (categoryNameToDataMap.size === 0 && allCategories.length === 0)) {
      console.error('❌ Preprocessing called before categories loaded! This should not happen.', {
        categoriesLoaded,
        mapSize: categoryNameToDataMap.size,
        allCategoriesCount: allCategories.length,
        leadsCount: leads.length
      });
      // Still try to process with what we have - might work if categories are partially loaded
    }

    let resolvedCount = 0;
    let unresolvedCount = 0;
    const unresolvedCategories = new Set<string>();

    const processedLeads = leads.map(lead => {
      // If category is already correctly resolved via join, keep it
      const existingMiscCategory = Array.isArray(lead.misc_category) 
        ? (lead.misc_category.length > 0 ? lead.misc_category[0] : null)
        : lead.misc_category;
      
      if (existingMiscCategory && existingMiscCategory.misc_maincategory) {
        return lead; // Already has valid category
      }

      // Try to resolve category using text value
      if (lead.category && typeof lead.category === 'string' && lead.category.trim() !== '') {
        const resolvedCategory = findBestCategoryMatch(lead.category);
        if (resolvedCategory) {
          resolvedCount++;
          // Update the lead with the resolved category
          return {
            ...lead,
            misc_category: resolvedCategory,
            category_id: resolvedCategory.id || lead.category_id
          };
        } else {
          unresolvedCount++;
          unresolvedCategories.add(lead.category);
        }
      }

      // Try to resolve using category_id if available
      if (lead.category_id && allCategories.length > 0) {
        const categoryById = allCategories.find((cat: any) => cat.id.toString() === lead.category_id.toString());
        if (categoryById) {
          resolvedCount++;
          return {
            ...lead,
            misc_category: categoryById
          };
        }
      }

      return lead;
    });

    // Debug logging
    if (unresolvedCount > 0) {
      console.warn('⚠️ Preprocessing - Some categories could not be resolved:', {
        totalLeads: leads.length,
        resolved: resolvedCount,
        unresolved: unresolvedCount,
        unresolvedCategories: Array.from(unresolvedCategories).slice(0, 10),
        mapSize: categoryNameToDataMap.size,
        allCategoriesCount: allCategories.length
      });
    } else if (resolvedCount > 0) {
      console.log('✅ Preprocessing - All categories resolved:', {
        totalLeads: leads.length,
        resolved: resolvedCount
      });
    }

    return processedLeads;
  }, [allCategories, categoryNameToDataMap, findBestCategoryMatch]);

  // Process data for field view (grouped by main category)
  const processFieldViewDataRef = useRef<Promise<void> | null>(null);
  const processFieldViewData = async (
    newLeadsMap: Map<string, any>,
    legacyLeadsMap: Map<number, any>,
    newPaymentsMap: Map<string, number>,
    legacyPaymentsMap: Map<number, number>
  ) => {
    // Prevent multiple simultaneous calls
    if (processFieldViewDataRef.current) {
      await processFieldViewDataRef.current;
      return;
    }

    const processPromise = (async () => {
    try {
      // First, fetch ALL main categories from the database
      const { data: allMainCategoriesData, error: mainCategoriesError } = await supabase
        .from('misc_maincategory')
        .select('id, name')
        .order('name', { ascending: true });

      const allMainCategoryNames = new Set<string>();
      if (!mainCategoriesError && allMainCategoriesData) {
        allMainCategoriesData.forEach((mainCat: any) => {
          if (mainCat.name) {
            allMainCategoryNames.add(mainCat.name);
          }
        });
      }
      console.log('🔍 Field View - All main categories from DB:', Array.from(allMainCategoryNames));

      // Define main categories that should be shown separately (not in General)
      // These are the main categories we want to display as individual fields
      const separateMainCategories = new Set([
        'Immigration Israel',
        'Germany',
        'Small without meetin',
        'Uncategorized',
        'USA',
        'Austria',
        'Damages',
        'Commer/Civil/Adm/Fam',
        'Other Citizenships',
        'Poland',
        'German\\Austrian',
        'Referral Commission'
      ]);

      const fieldDataMap = new Map<string, {
        mainCategoryName: string;
        signed: number;
        signedNormalized: number;
        signedPortion: number;
        salaryBudget: number;
        due: number;
        dueNormalized: number;
      }>();

      // Initialize all separate categories with zero values so they always appear
      separateMainCategories.forEach(categoryName => {
        fieldDataMap.set(categoryName, {
          mainCategoryName: categoryName,
          signed: 0,
          signedNormalized: 0,
          signedPortion: 0,
          salaryBudget: 0,
          due: 0,
          dueNormalized: 0,
        });
      });

      // Helper functions for calculating amounts
      const parseNumericAmount = (val: any): number => {
        if (typeof val === 'number') return val;
        if (typeof val === 'string') {
          const cleaned = val.replace(/[^0-9.-]/g, '');
          const parsed = parseFloat(cleaned);
          return Number.isNaN(parsed) ? 0 : parsed;
        }
        return 0;
      };

      const buildCurrencyMeta = (...candidates: any[]): { displaySymbol: string; conversionValue: string | number } => {
        for (const candidate of candidates) {
          if (candidate === null || candidate === undefined) continue;
          const rawValue = Array.isArray(candidate) ? candidate[0] : candidate;
          if (rawValue === null || rawValue === undefined) continue;

          if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
            const currencyMap: { [key: number]: string } = { 1: 'NIS', 2: 'USD', 3: 'EUR', 4: 'GBP' };
            return { displaySymbol: '₪', conversionValue: currencyMap[rawValue] || 'NIS' };
          }

          const valueStr = rawValue.toString().trim();
          if (!valueStr) continue;

          const numeric = Number(valueStr);
          if (!Number.isNaN(numeric) && numeric.toString() === valueStr) {
            const currencyMap: { [key: number]: string } = { 1: 'NIS', 2: 'USD', 3: 'EUR', 4: 'GBP' };
            return { displaySymbol: '₪', conversionValue: currencyMap[numeric] || 'NIS' };
          }

          const upper = valueStr.toUpperCase();
          if (upper === '₪' || upper === 'NIS' || upper === 'ILS') {
            return { displaySymbol: '₪', conversionValue: 'NIS' };
          }
          if (upper === '$' || upper === 'USD') {
            return { displaySymbol: '$', conversionValue: 'USD' };
          }
          if (upper === '€' || upper === 'EUR') {
            return { displaySymbol: '€', conversionValue: 'EUR' };
          }
          if (upper === '£' || upper === 'GBP') {
            return { displaySymbol: '£', conversionValue: 'GBP' };
          }
        }
        return { displaySymbol: '₪', conversionValue: 'NIS' };
      };

      // Process new leads
      newLeadsMap.forEach((lead: any) => {
        // Get main category name using helper function
        const mainCategoryName = resolveMainCategory(
          lead.category, // category text field
          lead.category_id, // category ID
          lead.misc_category // joined misc_category data
        );

        // Debug logging for uncategorized leads
        if (mainCategoryName === 'Uncategorized' && lead.category && lead.category.trim() !== '') {
          console.warn('⚠️ Field View - New lead categorized as Uncategorized:', {
            leadId: lead.id,
            categoryText: lead.category,
            categoryId: lead.category_id,
            hasMiscCategory: !!lead.misc_category
          });
        }

        // Calculate amount
        const balanceAmount = parseFloat(lead.balance || 0);
        const proposalAmount = parseFloat(lead.proposal_total || 0);
        const rawAmount = balanceAmount || proposalAmount || 0;
        const currencyCode = lead.accounting_currencies?.iso_code || lead.balance_currency || lead.proposal_currency || 'NIS';
        const amountInNIS = convertToNIS(rawAmount, currencyCode);

        // Subtract subcontractor fee
        const subcontractorFee = parseNumericAmount(lead.subcontractor_fee) || 0;
        const currencyMeta = buildCurrencyMeta(lead.currency_id, lead.proposal_currency, lead.balance_currency);
        const subcontractorFeeNIS = convertToNIS(subcontractorFee, currencyMeta.conversionValue);
        const amountAfterFee = amountInNIS - subcontractorFeeNIS;

        // Get or create field data
        if (!fieldDataMap.has(mainCategoryName)) {
          fieldDataMap.set(mainCategoryName, {
            mainCategoryName,
            signed: 0,
            signedNormalized: 0,
            signedPortion: 0,
            salaryBudget: 0,
            due: 0,
            dueNormalized: 0,
          });
        }

        const fieldData = fieldDataMap.get(mainCategoryName)!;
        fieldData.signed += amountAfterFee;
      });

      // Process legacy leads
      legacyLeadsMap.forEach((lead: any) => {
        // Get main category name using helper function
        const mainCategoryName = resolveMainCategory(
          lead.category, // category text field
          lead.category_id, // category ID
          lead.misc_category // joined misc_category data
        );

        // Debug logging for uncategorized leads
        if (mainCategoryName === 'Uncategorized' && lead.category && lead.category.trim() !== '') {
          console.warn('⚠️ Field View - Legacy lead categorized as Uncategorized:', {
            leadId: lead.id,
            categoryText: lead.category,
            categoryId: lead.category_id,
            hasMiscCategory: !!lead.misc_category
          });
        }

        // Calculate amount (same logic as fetchRoleData)
        const currencyId = lead.currency_id;
        const numericCurrencyId = typeof currencyId === 'string' ? parseInt(currencyId, 10) : Number(currencyId);
        let resolvedAmount = 0;
        if (numericCurrencyId === 1) {
          resolvedAmount = parseNumericAmount(lead.total_base) || 0;
        } else {
          resolvedAmount = parseNumericAmount(lead.total) || 0;
        }

        const currencyMeta = buildCurrencyMeta(
          lead.currency_id,
          lead.meeting_total_currency_id,
          lead.accounting_currencies
        );

        const amountNIS = convertToNIS(resolvedAmount, currencyMeta.conversionValue);
        const subcontractorFee = parseNumericAmount(lead.subcontractor_fee) || 0;
        const subcontractorFeeNIS = convertToNIS(subcontractorFee, currencyMeta.conversionValue);
        const amountAfterFee = amountNIS - subcontractorFeeNIS;

        // Get or create field data
        if (!fieldDataMap.has(mainCategoryName)) {
          fieldDataMap.set(mainCategoryName, {
            mainCategoryName,
            signed: 0,
            signedNormalized: 0,
            signedPortion: 0,
            salaryBudget: 0,
            due: 0,
            dueNormalized: 0,
          });
        }

        const fieldData = fieldDataMap.get(mainCategoryName)!;
        fieldData.signed += amountAfterFee;
      });

      // Calculate due amounts from ALL handler leads (not just signed ones)
      // This matches the logic in fetchDueAmounts - query all leads with handlers
      const fromDateTime = filters.fromDate ? `${filters.fromDate}T00:00:00` : null;
      const toDateTime = filters.toDate ? `${filters.toDate}T23:59:59` : null;

      try {
        // Step 1: Fetch all payment plans for new leads with handlers, filtered by due_date
        let newPaymentsQuery = supabase
          .from('payment_plans')
          .select('lead_id, value, currency, due_date')
          .eq('ready_to_pay', true)
          .eq('paid', false)
          .not('due_date', 'is', null)
          .is('cancel_date', null);

        if (fromDateTime) {
          newPaymentsQuery = newPaymentsQuery.gte('due_date', fromDateTime);
        }
        if (toDateTime) {
          newPaymentsQuery = newPaymentsQuery.lte('due_date', toDateTime);
        }

        const { data: allNewPayments, error: newPaymentsError } = await newPaymentsQuery;
        
        if (!newPaymentsError && allNewPayments && allNewPayments.length > 0) {
          // Step 2: Get unique lead IDs from payments
          const paymentLeadIds = [...new Set(allNewPayments.map((p: any) => p.lead_id).filter(Boolean))];
          
          // Step 3: Fetch leads that have handlers OR are in the signed leads map (they might have handlers too)
          // First, get all lead IDs that might have handlers (from payments + from signed leads)
          const signedLeadIds = Array.from(newLeadsMap.keys());
          const allPotentialLeadIds = [...new Set([...paymentLeadIds, ...signedLeadIds])];
          
          const { data: handlerLeads, error: handlerLeadsError } = await supabase
            .from('leads')
            .select(`
              id,
              handler,
              case_handler_id,
              category_id,
              category,
              misc_category!category_id(
                id,
                name,
                parent_id,
                misc_maincategory!parent_id(
                  id,
                  name
                )
              )
            `)
            .in('id', allPotentialLeadIds)
            .or('handler.not.is.null,case_handler_id.not.is.null');

          if (!handlerLeadsError && handlerLeads) {
            // Step 4: Create a map of lead_id to category
            const leadToCategoryMap = new Map<string, string>();
            const categoryMappingDebug: any[] = [];
            handlerLeads.forEach((lead: any) => {
              const mainCategoryName = resolveMainCategory(
                lead.category,
                lead.category_id,
                lead.misc_category
              );
              leadToCategoryMap.set(lead.id, mainCategoryName);
              
              // Debug logging for category mapping issues
              if (mainCategoryName === 'Uncategorized' && lead.category && lead.category.trim() !== '') {
                categoryMappingDebug.push({
                  leadId: lead.id,
                  categoryText: lead.category,
                  categoryId: lead.category_id,
                  hasMiscCategory: !!lead.misc_category,
                  miscCategoryName: lead.misc_category?.name
                });
              }
            });
            
            // Log category mapping debug info
            if (categoryMappingDebug.length > 0) {
              console.warn('⚠️ Field View Due (New Leads) - Handler leads mapped to Uncategorized:', {
                count: categoryMappingDebug.length,
                samples: categoryMappingDebug.slice(0, 5),
                categoryNameToDataMapSize: categoryNameToDataMap.size,
                sampleMapKeys: Array.from(categoryNameToDataMap.keys()).slice(0, 10)
              });
            }

            // Step 5: Group payments by category using utility function
            const categoryDueMap = calculateFieldViewDueByCategory({
              payments: allNewPayments.map((p: any) => ({
                lead_id: p.lead_id,
                value: p.value,
                currency: p.currency
              })),
              leadToCategoryMap: leadToCategoryMap
            });
            
            // Debug logging for category mapping
            const categoriesWithDueArray = Array.from(categoryDueMap.entries()).map(([cat, amount]) => ({ category: cat, amount }));
            const smallWithoutMeetingAmount = categoryDueMap.get('Small without meetin') || 0;
            const uncategorizedAmount = categoryDueMap.get('Uncategorized') || 0;
            
            console.log('🔍 Field View Due (New Leads) - Category mapping:', {
              totalPayments: allNewPayments.length,
              handlerLeadsFound: handlerLeads.length,
              leadToCategoryMapSize: leadToCategoryMap.size,
              categoriesWithDue: categoriesWithDueArray,
              hasSmallWithoutMeeting: categoryDueMap.has('Small without meetin'),
              smallWithoutMeetingAmount: smallWithoutMeetingAmount,
              uncategorizedAmount: uncategorizedAmount,
              // Show sample of lead to category mappings
              sampleLeadMappings: Array.from(leadToCategoryMap.entries()).slice(0, 10).map(([leadId, cat]) => ({ leadId, category: cat }))
            });

            // Step 6: Also check signed leads for due payments (they might have handlers too)
            // Process signed leads that have handlers and due payments
            newLeadsMap.forEach((lead: any) => {
              // Check if this lead has a handler
              const hasHandler = (lead.handler || lead.case_handler_id);
              if (!hasHandler) return;
              
              // Check if this lead has due payments
              const leadDueAmount = newPaymentsMap.get(lead.id) || 0;
              if (leadDueAmount <= 0) return;
              
              // Get main category name
              const mainCategoryName = resolveMainCategory(
                lead.category,
                lead.category_id,
                lead.misc_category
              );
              
              // Add to category due map
              const current = categoryDueMap.get(mainCategoryName) || 0;
              categoryDueMap.set(mainCategoryName, current + leadDueAmount);
            });

            // Step 7: Add due amounts to categories (separate categories are already initialized)
            categoryDueMap.forEach((dueAmount, mainCategoryName) => {
              // Separate categories are already initialized, so they should exist
              // But also allow adding to any category that exists (for categories with signed data)
              if (fieldDataMap.has(mainCategoryName)) {
                const existingDue = fieldDataMap.get(mainCategoryName)!.due;
                fieldDataMap.get(mainCategoryName)!.due = existingDue + dueAmount;
                
                // Debug logging for "Small without meetin"
                if (mainCategoryName === 'Small without meetin') {
                  console.log('🔍 Field View Due (New Leads) - Adding due to Small without meetin:', {
                    existingDue,
                    newDueAmount: dueAmount,
                    totalDue: existingDue + dueAmount
                  });
                }
              } else if (separateMainCategories.has(mainCategoryName)) {
                // This shouldn't happen since we initialize them, but just in case
                fieldDataMap.set(mainCategoryName, {
                  mainCategoryName,
                  signed: 0,
                  signedNormalized: 0,
                  signedPortion: 0,
                  salaryBudget: 0,
                  due: dueAmount,
                  dueNormalized: 0,
                });
                
                // Debug logging for "Small without meetin"
                if (mainCategoryName === 'Small without meetin') {
                  console.log('🔍 Field View Due (New Leads) - Creating Small without meetin with due:', dueAmount);
                }
              } else {
                // Log for debugging - category not found and not in separate list
                console.warn('⚠️ Field View Due (New Leads) - Category not found for due amount:', {
                  mainCategoryName,
                  dueAmount,
                  isSeparateCategory: separateMainCategories.has(mainCategoryName),
                  hasFieldData: fieldDataMap.has(mainCategoryName)
                });
              }
            });
          }
        }

        // Step 1: Fetch all payment plans for legacy leads with handlers, filtered by due_date
        let legacyPaymentsQuery = supabase
          .from('finances_paymentplanrow')
          .select('lead_id, value, value_base, currency_id, due_date, accounting_currencies!finances_paymentplanrow_currency_id_fkey(name, iso_code)')
          .is('actual_date', null)
          .eq('ready_to_pay', true)
          .not('due_date', 'is', null)
          .is('cancel_date', null);

        if (fromDateTime) {
          legacyPaymentsQuery = legacyPaymentsQuery.gte('due_date', fromDateTime);
        }
        if (toDateTime) {
          legacyPaymentsQuery = legacyPaymentsQuery.lte('due_date', toDateTime);
        }

        const { data: allLegacyPayments, error: legacyPaymentsError } = await legacyPaymentsQuery;
        
        if (!legacyPaymentsError && allLegacyPayments && allLegacyPayments.length > 0) {
          // Step 2: Get unique lead IDs from payments
          const paymentLeadIds = [...new Set(allLegacyPayments.map((p: any) => Number(p.lead_id)).filter(Boolean))];
          
          // Step 3: Fetch leads that have handlers
          const { data: handlerLeads, error: handlerLeadsError } = await supabase
            .from('leads_lead')
            .select(`
              id,
              case_handler_id,
              category_id,
              category,
              misc_category!category_id(
                id,
                name,
                parent_id,
                misc_maincategory!parent_id(
                  id,
                  name
                )
              )
            `)
            .in('id', paymentLeadIds)
            .not('case_handler_id', 'is', null);

          if (!handlerLeadsError && handlerLeads) {
            // Step 4: Create a map of lead_id to category
            const leadToCategoryMap = new Map<number, string>();
            const categoryMappingDebug: any[] = [];
            handlerLeads.forEach((lead: any) => {
              const mainCategoryName = resolveMainCategory(
                lead.category,
                lead.category_id,
                lead.misc_category
              );
              leadToCategoryMap.set(Number(lead.id), mainCategoryName);
              
              // Debug logging for category mapping issues
              if (mainCategoryName === 'Uncategorized' && lead.category && lead.category.trim() !== '') {
                categoryMappingDebug.push({
                  leadId: lead.id,
                  categoryText: lead.category,
                  categoryId: lead.category_id,
                  hasMiscCategory: !!lead.misc_category,
                  miscCategoryName: lead.misc_category?.name
                });
              }
            });
            
            // Log category mapping debug info
            if (categoryMappingDebug.length > 0) {
              console.warn('⚠️ Field View Due (Legacy Leads) - Handler leads mapped to Uncategorized:', {
                count: categoryMappingDebug.length,
                samples: categoryMappingDebug.slice(0, 5),
                categoryNameToDataMapSize: categoryNameToDataMap.size,
                sampleMapKeys: Array.from(categoryNameToDataMap.keys()).slice(0, 10)
              });
            }

            // Step 5: Group payments by category using utility function
            // Create a map with numeric keys for legacy leads
            const legacyLeadToCategoryMap = new Map<string | number, string>();
            leadToCategoryMap.forEach((category, leadId) => {
              legacyLeadToCategoryMap.set(leadId, category);
              legacyLeadToCategoryMap.set(Number(leadId), category);
            });
            
            const categoryDueMap = calculateFieldViewDueByCategory({
              payments: allLegacyPayments.map((p: any) => ({
                lead_id: Number(p.lead_id),
                value: p.value || p.value_base || 0,
                currency_id: p.currency_id,
                accounting_currencies: p.accounting_currencies
              })),
              leadToCategoryMap: legacyLeadToCategoryMap
            });
            
            // Debug logging for category mapping
            const legacyCategoriesWithDueArray = Array.from(categoryDueMap.entries()).map(([cat, amount]) => ({ category: cat, amount }));
            const smallWithoutMeetingAmount = categoryDueMap.get('Small without meetin') || 0;
            const uncategorizedAmount = categoryDueMap.get('Uncategorized') || 0;
            
            console.log('🔍 Field View Due (Legacy Leads) - Category mapping:', {
              totalPayments: allLegacyPayments.length,
              handlerLeadsFound: handlerLeads.length,
              leadToCategoryMapSize: leadToCategoryMap.size,
              categoriesWithDue: legacyCategoriesWithDueArray,
              hasSmallWithoutMeeting: categoryDueMap.has('Small without meetin'),
              smallWithoutMeetingAmount: smallWithoutMeetingAmount,
              uncategorizedAmount: uncategorizedAmount,
              // Show sample of lead to category mappings
              sampleLeadMappings: Array.from(leadToCategoryMap.entries()).slice(0, 10).map(([leadId, cat]) => ({ leadId, category: cat }))
            });

            // Step 6: Add due amounts to categories (separate categories are already initialized)
            categoryDueMap.forEach((dueAmount, mainCategoryName) => {
              // Separate categories are already initialized, so they should exist
              // But also allow adding to any category that exists (for categories with signed data)
              if (fieldDataMap.has(mainCategoryName)) {
                const existingDue = fieldDataMap.get(mainCategoryName)!.due;
                fieldDataMap.get(mainCategoryName)!.due = existingDue + dueAmount;
                
                // Debug logging for "Small without meetin"
                if (mainCategoryName === 'Small without meetin') {
                  console.log('🔍 Field View Due (Legacy Leads) - Adding due to Small without meetin:', {
                    existingDue,
                    newDueAmount: dueAmount,
                    totalDue: existingDue + dueAmount
                  });
                }
              } else if (separateMainCategories.has(mainCategoryName)) {
                // This shouldn't happen since we initialize them, but just in case
                fieldDataMap.set(mainCategoryName, {
                  mainCategoryName,
                  signed: 0,
                  signedNormalized: 0,
                  signedPortion: 0,
                  salaryBudget: 0,
                  due: dueAmount,
                  dueNormalized: 0,
                });
                
                // Debug logging for "Small without meetin"
                if (mainCategoryName === 'Small without meetin') {
                  console.log('🔍 Field View Due (Legacy Leads) - Creating Small without meetin with due:', dueAmount);
                }
              } else {
                // Log for debugging - category not found and not in separate list
                console.warn('⚠️ Field View Due (Legacy Leads) - Category not found for due amount:', {
                  mainCategoryName,
                  dueAmount,
                  isSeparateCategory: separateMainCategories.has(mainCategoryName),
                  hasFieldData: fieldDataMap.has(mainCategoryName)
                });
              }
            });
          }
        }
      } catch (error) {
        console.error('Error fetching due amounts for field view:', error);
        // Continue processing even if due amounts fail
      }

      // Calculate signed normalized and signed portion for each field
      const totalSignedOverall = totalSignedValueRef.current || 0;
      const incomeAmount = totalIncome || 0;
      let normalizationRatio = 1;
      if (incomeAmount > 0 && totalSignedOverall > 0 && incomeAmount < totalSignedOverall) {
        normalizationRatio = incomeAmount / totalSignedOverall;
      }

      // Calculate signed portion for each category by processing all leads with role data
      // We need to sum up signed portions from all employees for leads in each category
      const categorySignedPortionMap = new Map<string, number>();

      // Process new leads to calculate signed portions per category
      newLeadsMap.forEach((lead: any) => {
        // Get main category name using helper function
        const mainCategoryName = resolveMainCategory(
          lead.category, // category text field
          lead.category_id, // category ID
          lead.misc_category // joined misc_category data
        );

        // Calculate amount
        const balanceAmount = parseFloat(lead.balance || 0);
        const proposalAmount = parseFloat(lead.proposal_total || 0);
        const rawAmount = balanceAmount || proposalAmount || 0;
        const currencyCode = lead.accounting_currencies?.iso_code || lead.balance_currency || lead.proposal_currency || 'NIS';
        const amountInNIS = convertToNIS(rawAmount, currencyCode);

        // Subtract subcontractor fee
        const subcontractorFee = parseNumericAmount(lead.subcontractor_fee) || 0;
        const currencyMeta = buildCurrencyMeta(lead.currency_id, lead.proposal_currency, lead.balance_currency);
        const subcontractorFeeNIS = convertToNIS(subcontractorFee, currencyMeta.conversionValue);
        const amountAfterFee = amountInNIS - subcontractorFeeNIS;

        // Calculate total signed portion for this lead (sum of all employees' portions)
        const leadRoles = {
          closer: lead.closer,
          scheduler: lead.scheduler,
          manager: lead.manager,
          expert: lead.expert,
          handler: lead.handler, // Handler role
          helperCloser: lead.helper,
        };

        // Get all unique employee IDs from this lead
        const employeeIds = new Set<number>();
        if (lead.closer) employeeIds.add(typeof lead.closer === 'string' ? 0 : Number(lead.closer));
        if (lead.scheduler) employeeIds.add(typeof lead.scheduler === 'string' ? 0 : Number(lead.scheduler));
        if (lead.manager) employeeIds.add(typeof lead.manager === 'string' ? 0 : Number(lead.manager));
        if (lead.expert) employeeIds.add(Number(lead.expert));
        if (lead.handler) employeeIds.add(typeof lead.handler === 'string' ? 0 : Number(lead.handler));
        if (lead.helper) employeeIds.add(typeof lead.helper === 'string' ? 0 : Number(lead.helper));

        // Calculate signed portion for each employee and sum them
        let leadTotalSignedPortion = 0;
        employeeIds.forEach(empId => {
          if (empId > 0) {
            const signedPortion = calculateSignedPortionAmount(
              amountAfterFee,
              leadRoles,
              empId,
              false, // isLegacy = false for new leads
              rolePercentages // Pass role percentages from database
            );
            leadTotalSignedPortion += signedPortion;
          }
        });

        // Add to category total
        const current = categorySignedPortionMap.get(mainCategoryName) || 0;
        categorySignedPortionMap.set(mainCategoryName, current + leadTotalSignedPortion);
      });

      // Process legacy leads to calculate signed portions per category
      legacyLeadsMap.forEach((lead: any) => {
        // Get main category name using helper function
        const mainCategoryName = resolveMainCategory(
          lead.category, // category text field
          lead.category_id, // category ID
          lead.misc_category // joined misc_category data
        );

        // Calculate amount
        const currencyId = lead.currency_id;
        const numericCurrencyId = typeof currencyId === 'string' ? parseInt(currencyId, 10) : Number(currencyId);
        let resolvedAmount = 0;
        if (numericCurrencyId === 1) {
          resolvedAmount = parseNumericAmount(lead.total_base) || 0;
        } else {
          resolvedAmount = parseNumericAmount(lead.total) || 0;
        }

        const currencyMeta = buildCurrencyMeta(
          lead.currency_id,
          lead.meeting_total_currency_id,
          lead.accounting_currencies
        );

        const amountNIS = convertToNIS(resolvedAmount, currencyMeta.conversionValue);
        const subcontractorFee = parseNumericAmount(lead.subcontractor_fee) || 0;
        const subcontractorFeeNIS = convertToNIS(subcontractorFee, currencyMeta.conversionValue);
        const amountAfterFee = amountNIS - subcontractorFeeNIS;

        // Calculate total signed portion for this lead
        const leadRoles = {
          closer_id: lead.closer_id,
          meeting_scheduler_id: lead.meeting_scheduler_id,
          meeting_manager_id: lead.meeting_manager_id,
          expert_id: lead.expert_id,
          case_handler_id: lead.case_handler_id, // Handler role
          meeting_lawyer_id: lead.meeting_lawyer_id,
        };

        // Get all unique employee IDs from this lead
        const employeeIds = new Set<number>();
        if (lead.closer_id) employeeIds.add(Number(lead.closer_id));
        if (lead.meeting_scheduler_id) employeeIds.add(Number(lead.meeting_scheduler_id));
        if (lead.meeting_manager_id) employeeIds.add(Number(lead.meeting_manager_id));
        if (lead.expert_id) employeeIds.add(Number(lead.expert_id));
        if (lead.case_handler_id) employeeIds.add(Number(lead.case_handler_id));
        if (lead.meeting_lawyer_id) employeeIds.add(Number(lead.meeting_lawyer_id));

        // Calculate signed portion for each employee and sum them
        let leadTotalSignedPortion = 0;
        employeeIds.forEach(empId => {
          if (empId > 0) {
            const signedPortion = calculateSignedPortionAmount(
              amountAfterFee,
              leadRoles,
              empId,
              true, // isLegacy = true for legacy leads
              rolePercentages // Pass role percentages from database
            );
            leadTotalSignedPortion += signedPortion;
          }
        });

        // Add to category total
        const current = categorySignedPortionMap.get(mainCategoryName) || 0;
        categorySignedPortionMap.set(mainCategoryName, current + leadTotalSignedPortion);
      });

      // Calculate due normalized for each category
      const dueNormalizedPercentageValue = (dueNormalizedPercentage || 0) / 100; // Convert percentage to decimal
      fieldDataMap.forEach((fieldData) => {
        fieldData.dueNormalized = fieldData.due * dueNormalizedPercentageValue;
      });
      
      // Debug: Log due amounts for "Small without meetin" specifically
      const smallWithoutMeetingData = fieldDataMap.get('Small without meetin');
      if (smallWithoutMeetingData) {
        console.log('🔍 Field View - Small without meetin due data (after normalization):', {
          due: smallWithoutMeetingData.due,
          dueNormalized: smallWithoutMeetingData.dueNormalized,
          signed: smallWithoutMeetingData.signed,
          dueNormalizedPercentage: dueNormalizedPercentage
        });
      } else {
        console.log('⚠️ Field View - Small without meetin not found in fieldDataMap');
      }
      
      // Debug: Log all categories with due amounts
      const categoriesWithDue = Array.from(fieldDataMap.entries())
        .filter(([name, data]) => data.due > 0)
        .map(([name, data]) => ({ category: name, due: data.due, dueNormalized: data.dueNormalized }));
      console.log('🔍 Field View - All categories with due amounts:', categoriesWithDue);

      // Separate main categories into those that should be shown separately and those that go to General
      const generalFieldData = {
        mainCategoryName: 'General',
        signed: 0,
        signedNormalized: 0,
        signedPortion: 0,
        salaryBudget: 0,
        due: 0,
        dueNormalized: 0,
      };

      // Log all main categories found
      console.log('🔍 Field View - All main categories found in data:', Array.from(fieldDataMap.keys()));
      console.log('🔍 Field View - All main categories from DB:', Array.from(allMainCategoryNames));
      console.log('🔍 Field View - Separate categories list:', Array.from(separateMainCategories));

      // Convert to DepartmentData format for consistency
      const fieldViewDataMap = new Map<string, DepartmentData>();
      const categoriesGoingToGeneral: string[] = [];

      // Debug: Log due amounts before processing
      console.log('🔍 Field View - Due amounts before processing:', 
        Array.from(fieldDataMap.entries())
          .filter(([name, data]) => data.due > 0)
          .map(([name, data]) => ({ category: name, due: data.due }))
      );

      // First, process all categories that have data
      fieldDataMap.forEach((fieldData, mainCategoryName) => {
        const signedNormalized = fieldData.signed * normalizationRatio;
        const signedPortion = categorySignedPortionMap.get(mainCategoryName) || 0;
        const salaryBudget = signedPortion * 0.4;

        // Check if this main category should be shown separately or go to General
        const shouldShowSeparately = separateMainCategories.has(mainCategoryName);

        if (shouldShowSeparately) {
          // Show this main category as its own field
          fieldViewDataMap.set(mainCategoryName, {
            departmentName: mainCategoryName,
            employees: [{
              employeeId: 0,
              employeeName: mainCategoryName,
              department: '',
              signed: fieldData.signed,
              signedNormalized: signedNormalized,
              dueNormalized: fieldData.dueNormalized,
              signedPortion: signedPortion,
              salaryBudget: salaryBudget,
              salaryBrutto: 0,
              totalSalaryCost: 0,
              due: fieldData.due || 0, // Ensure we use the calculated due amount
              duePortion: 0,
              total: fieldData.signed,
              totalPortionDue: 0,
              percentOfIncome: 0,
              normalized: fieldData.signed,
            }],
            totals: {
              signed: fieldData.signed,
              signedNormalized: signedNormalized,
              dueNormalized: fieldData.dueNormalized,
              signedPortion: signedPortion,
              salaryBudget: salaryBudget,
              salaryBrutto: 0,
              totalSalaryCost: 0,
              due: fieldData.due || 0, // Ensure we use the calculated due amount
              duePortion: 0,
              total: fieldData.signed,
              totalPortionDue: 0,
              percentOfIncome: 0,
              normalized: fieldData.signed,
            },
          });
        } else {
          // Add to General field
          categoriesGoingToGeneral.push(mainCategoryName);
          generalFieldData.signed += fieldData.signed;
          generalFieldData.signedPortion += signedPortion;
          generalFieldData.due += fieldData.due;
          generalFieldData.dueNormalized += fieldData.dueNormalized;
        }
      });

      // Now, process all main categories from DB that don't have data but should go to General
      allMainCategoryNames.forEach((mainCategoryName) => {
        // Skip if already processed (has data) or if it's in separate list
        if (fieldDataMap.has(mainCategoryName) || separateMainCategories.has(mainCategoryName)) {
          return;
        }

        // This main category exists in DB but has no data in current date range - add to General
        categoriesGoingToGeneral.push(mainCategoryName);
        console.log('🔍 Field View - Adding main category with no data to General:', mainCategoryName);
      });

      // Log for debugging
      console.log('🔍 Field View - Categories going to General:', categoriesGoingToGeneral);
      console.log('🔍 Field View - General field data:', generalFieldData);

      // Calculate General field totals - always show General if there are categories going to it
      if (categoriesGoingToGeneral.length > 0 || generalFieldData.signed > 0) {
        const generalSignedNormalized = generalFieldData.signed * normalizationRatio;
        const generalSalaryBudget = generalFieldData.signedPortion * 0.4;

        fieldViewDataMap.set('General', {
          departmentName: 'General',
          employees: [{
            employeeId: 0,
            employeeName: 'General',
            department: '',
            signed: generalFieldData.signed,
            signedNormalized: generalSignedNormalized,
            dueNormalized: generalFieldData.dueNormalized,
            signedPortion: generalFieldData.signedPortion,
            salaryBudget: generalSalaryBudget,
            salaryBrutto: 0,
            totalSalaryCost: 0,
            due: generalFieldData.due,
            duePortion: 0,
            total: generalFieldData.signed,
            totalPortionDue: 0,
            percentOfIncome: 0,
            normalized: generalFieldData.signed,
          }],
          totals: {
            signed: generalFieldData.signed,
            signedNormalized: generalSignedNormalized,
            dueNormalized: generalFieldData.dueNormalized,
            signedPortion: generalFieldData.signedPortion,
            salaryBudget: generalSalaryBudget,
            salaryBrutto: 0,
            totalSalaryCost: 0,
            due: generalFieldData.due,
            duePortion: 0,
            total: generalFieldData.signed,
            totalPortionDue: 0,
            percentOfIncome: 0,
            normalized: generalFieldData.signed,
          },
        });
        console.log('✅ Field View - General field added to map');
      } else {
        console.log('⚠️ Field View - No categories going to General, General field not created');
      }

      // Debug: Log final due amounts before setting state
      const finalDueAmounts = Array.from(fieldViewDataMap.entries())
        .filter(([name, data]) => data.totals.due > 0)
        .map(([name, data]) => ({ category: name, due: data.totals.due, dueNormalized: data.totals.dueNormalized }));
      console.log('🔍 Field View - Final due amounts before setting state:', finalDueAmounts);
      
      const smallWithoutMeetingFinal = fieldViewDataMap.get('Small without meetin');
      if (smallWithoutMeetingFinal) {
        console.log('🔍 Field View - Small without meetin final data:', {
          due: smallWithoutMeetingFinal.totals.due,
          dueNormalized: smallWithoutMeetingFinal.totals.dueNormalized
        });
      }

      setFieldViewData(fieldViewDataMap);
    } catch (error) {
      console.error('Error processing field view data:', error);
      } finally {
        processFieldViewDataRef.current = null;
    }
    })();

    processFieldViewDataRef.current = processPromise;
    await processPromise;
  };

  // Handler for starting to edit percentage
  const handleStartEditPercentage = (departmentName: string) => {
    const currentPercentage = departmentPercentages.get(departmentName) || 0;
    setEditingPercentage(departmentName);
    setTempPercentage(currentPercentage.toString());
  };

  // Handler for canceling edit
  const handleCancelEditPercentage = () => {
    setEditingPercentage(null);
    setTempPercentage('');
  };

  // Handler for saving percentage (individual)
  const handleSavePercentage = async (departmentName: string) => {
    const numValue = Number(tempPercentage);
    if (isNaN(numValue) || numValue < 0 || numValue > 100) {
      toast.error('Please enter a valid percentage between 0 and 100');
      return;
    }

    try {
      // Get current user for tracking
      const { data: { user } } = await supabase.auth.getUser();
      const userId = user?.id || null;

      // Save to database immediately
      const { error } = await supabase
        .from('sales_contribution_settings')
        .upsert({
          department_name: departmentName,
          percentage: numValue,
          updated_at: new Date().toISOString(),
          updated_by: userId,
        }, {
          onConflict: 'department_name'
        });

      if (error) {
        console.error(`Error saving percentage for ${departmentName}:`, error);
        console.error('Error details:', JSON.stringify(error, null, 2));
        toast.error(`Failed to save percentage: ${error.message || 'Unknown error'}`);
        return;
      }

      // Update local state only after successful database save
      const newPercentages = new Map(departmentPercentages);
      newPercentages.set(departmentName, numValue);
      setDepartmentPercentages(newPercentages);
      setEditingPercentage(null);
      setTempPercentage('');
      toast.success(`Percentage for ${departmentName} saved`);
    } catch (error: any) {
      console.error('Error saving percentage:', error);
      toast.error(`Failed to save percentage: ${error.message || 'Unknown error'}`);
    }
  };

  // Render summary box with percentage and edit functionality
  const renderSummaryBox = (departmentName: string, icon: React.ReactNode, gradientClasses: string) => {
    const deptTotal = departmentData.get(departmentName)?.totals.total || 0;
    const percentage = departmentPercentages.get(departmentName) || 0;
    const isEditing = editingPercentage === departmentName;

    // Calculate summary box amount: 40% of income * department percentage
    const baseAmount = (totalIncome || 0) * 0.4;
    const summaryAmount = baseAmount * (percentage / 100);

    return (
      <div className={`flex-shrink-0 rounded-2xl transition-all duration-300 hover:scale-[1.03] hover:shadow-2xl shadow-xl ${gradientClasses} text-white relative overflow-hidden p-4 md:p-6 w-[calc(50vw-0.75rem)] md:w-auto h-36 md:h-32 min-h-[144px] ${departmentName === 'Sales' ? 'ml-4 md:ml-0' : ''}`}>
        {/* Edit button - top right */}
        <div className="absolute top-2 right-2 z-10">
          {isEditing ? (
            <div className="flex items-center gap-1 bg-white/20 backdrop-blur-sm rounded-lg p-1">
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={tempPercentage}
                onChange={(e) => setTempPercentage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSavePercentage(departmentName);
                  } else if (e.key === 'Escape') {
                    handleCancelEditPercentage();
                  }
                }}
                className="w-16 h-7 px-2 rounded text-sm font-semibold text-white bg-white/30 border border-white/50 focus:outline-none focus:ring-2 focus:ring-white/50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                autoFocus
                placeholder="0.00"
              />
              <button
                onClick={() => handleSavePercentage(departmentName)}
                className="p-1 hover:bg-white/30 rounded transition-colors"
                title="Save percentage"
              >
                <CheckIcon className="w-4 h-4 text-white" />
              </button>
              <button
                onClick={handleCancelEditPercentage}
                className="p-1 hover:bg-white/30 rounded transition-colors"
                title="Cancel"
              >
                <XMarkIcon className="w-4 h-4 text-white" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => handleStartEditPercentage(departmentName)}
              className="p-2 bg-white/20 hover:bg-white/30 backdrop-blur-sm rounded-lg transition-all duration-200 hover:scale-110 group"
              title="Edit percentage"
            >
              <PencilIcon className="w-4 h-4 text-white group-hover:text-yellow-200" />
            </button>
          )}
        </div>

        {/* Percentage display - top right (below edit button when editing) */}
        {!isEditing && (
          <div className="absolute top-2 right-11 md:right-12 bg-white/20 backdrop-blur-sm rounded-lg px-2 py-1 shadow-sm">
            <span className="text-xs md:text-sm font-bold text-white">
              {percentage % 1 === 0 ? percentage.toFixed(0) : percentage.toFixed(2)}%
            </span>
          </div>
        )}

        <div className="flex items-center gap-2 md:gap-4 pt-8 md:pt-6">
          <div className="flex items-center justify-center w-12 h-12 md:w-14 md:h-14 rounded-full bg-white/20 shadow">
            {icon}
          </div>
          <div>
            <div className="text-3xl md:text-4xl font-extrabold text-white leading-tight">
              {formatCurrency(summaryAmount)}
            </div>
            <div className="text-white/80 text-sm md:text-sm font-medium mt-1">{departmentName}</div>
          </div>
        </div>
        {/* SVG Placeholder - adjust position to not overlap with percentage */}
        <svg className="absolute bottom-2 right-2 w-10 h-5 md:w-16 md:h-8 opacity-40" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 64 32"><path d="M2 28 Q16 8 32 20 T62 8" /></svg>
      </div>
    );
  };

  // Get icon for main category
  // Function to get the appropriate icon for each main category (matching DepartmentList logic)
  const getCategoryIcon = (categoryName: string): React.ReactNode => {
    const name = categoryName.toLowerCase();

    // General category - grid icon
    if (name === 'general') {
      return <Squares2X2Icon className="w-8 h-8 text-gray-500" />;
    }

    // Staff Meeting gets a special icon
    if (name.includes('staff')) {
      return <UsersIcon className="w-8 h-8 text-blue-500" />;
    }

    // Legal-related categories
    if (name.includes('legal') || name.includes('law') || name.includes('attorney')) {
      return <ScaleIcon className="w-8 h-8 text-blue-500" />;
    }

    // Immigration to Israel - Israel flag emoji
    if (name.includes('israel') || name.includes('israeli') || name.includes('aliyah') || (name.includes('immigration') && name.includes('israel'))) {
      return <span className="text-3xl" role="img" aria-label="Israel flag">🇮🇱</span>;
    }

    // USA Immigration - USA flag emoji
    if (name.includes('usa') || name.includes('united states') || name.includes('america') || name.includes('us immigration')) {
      return <span className="text-3xl" role="img" aria-label="USA flag">🇺🇸</span>;
    }

    // Small cases - different icon from Austria/Germany
    if (name.includes('small cases') || name.includes('small case') || (name.includes('small') && name.includes('meeting'))) {
      return <DocumentTextIcon className="w-8 h-8 text-green-500" />;
    }

    // Germany - Germany flag emoji
    if (name.includes('germany') || name.includes('german')) {
      return <span className="text-3xl" role="img" aria-label="Germany flag">🇩🇪</span>;
    }

    // Austria - Austria flag emoji
    if (name.includes('austria')) {
      return <span className="text-3xl" role="img" aria-label="Austria flag">🇦🇹</span>;
    }

    // General immigration-related categories
    if (name.includes('immigration') || name.includes('citizenship') || name.includes('visa') || name.includes('passport')) {
      return <GlobeAltIcon className="w-8 h-8 text-blue-500" />;
    }

    // Business/Corporate categories
    if (name.includes('business') || name.includes('corporate') || name.includes('commercial')) {
      return <BriefcaseIcon className="w-8 h-8 text-purple-500" />;
    }

    // HR/Personnel categories
    if (name.includes('hr') || name.includes('human') || name.includes('personnel')) {
      return <UserGroupIcon className="w-8 h-8 text-blue-500" />;
    }

    // Finance/Accounting categories
    if (name.includes('finance') || name.includes('accounting') || name.includes('financial') || name.includes('money')) {
      return <BanknotesIcon className="w-8 h-8 text-green-500" />;
    }

    // Marketing categories
    if (name.includes('marketing') || name.includes('sales') || name.includes('advertising')) {
      return <ChartBarIcon className="w-8 h-8 text-blue-500" />;
    }

    // IT/Technology categories
    if (name.includes('it') || name.includes('technology') || name.includes('tech') || name.includes('computer')) {
      return <CogIcon className="w-8 h-8 text-gray-500" />;
    }

    // Education/Training categories
    if (name.includes('education') || name.includes('training') || name.includes('learning') || name.includes('academy')) {
      return <AcademicCapIcon className="w-8 h-8 text-blue-500" />;
    }

    // Healthcare/Medical categories
    if (name.includes('health') || name.includes('medical') || name.includes('healthcare') || name.includes('clinic')) {
      return <HeartIcon className="w-8 h-8 text-red-500" />;
    }

    // Real Estate categories
    if (name.includes('real estate') || name.includes('property') || name.includes('housing')) {
      return <HomeIcon className="w-8 h-8 text-blue-500" />;
    }

    // Security categories
    if (name.includes('security') || name.includes('safety') || name.includes('protection')) {
      return <ShieldCheckIcon className="w-8 h-8 text-blue-500" />;
    }

    // Operations categories
    if (name.includes('operations') || name.includes('operational') || name.includes('management')) {
      return <WrenchScrewdriverIcon className="w-8 h-8 text-gray-500" />;
    }

    // Documentation/Administration categories
    if (name.includes('admin') || name.includes('administration') || name.includes('document') || name.includes('paperwork')) {
      return <ClipboardDocumentListIcon className="w-8 h-8 text-gray-500" />;
    }

    // Unassigned/Uncategorized
    if (name.includes('unassigned') || name.includes('unknown') || name.includes('uncategorized') || name.includes('other')) {
      return <ExclamationTriangleIcon className="w-8 h-8 text-gray-500" />;
    }

    // Default icon for any other category
    return <BuildingOfficeIcon className="w-8 h-8 text-purple-500" />;
  };

  const renderTable = (deptData: DepartmentData, hideTitle?: boolean) => {
    const isFieldView = hideTitle === true;
    const colSpanValue = isFieldView ? 9 : 10; // Updated for new salary columns

    return (
      <div key={deptData.departmentName} className="mb-8">
        {!hideTitle && <h2 className="text-2xl font-bold mb-4">{deptData.departmentName}</h2>}
        <div className="overflow-x-auto">
          <table className="table w-full table-fixed">
            <thead>
              <tr>
                <th className={isFieldView ? 'w-[20%]' : 'w-[25%]'}>{isFieldView ? 'Category' : 'Employee'}</th>
                {!isFieldView && <th className="w-[15%]">Department</th>}
                <th className="text-right w-[10%]">Signed</th>
                <th className="text-right w-[10%]">Due</th>
                <th className="text-right w-[10%]">Signed Normalized</th>
                <th className="text-right w-[10%]">Due Normalized</th>
                <th className="text-right w-[10%]">Contribution</th>
                <th className="text-right w-[10%]">Salary Budget</th>
                <th className="text-right w-[10%]">Salary (Brutto)</th>
                <th className="text-right w-[10%]">Total Salary Cost</th>
              </tr>
            </thead>
            <tbody>
              {deptData.employees
                .filter((emp) => {
                  // Filter by search term (case-insensitive search on name and department)
                  if (!employeeSearchTerm.trim()) return true;
                  const searchLower = employeeSearchTerm.toLowerCase().trim();
                  const nameMatch = emp.employeeName.toLowerCase().includes(searchLower);
                  const deptMatch = emp.department.toLowerCase().includes(searchLower);
                  return nameMatch || deptMatch;
                })
                .map((emp) => {
                  // Use employeeName as key in field view, employeeId in employee view
                  const employeeKey = isFieldView ? emp.employeeName : `${emp.employeeId}`;
                  const dateRangeKey = `${filters.fromDate || ''}_${filters.toDate || ''}`;
                  const incomeKey = totalIncome || 0;
                  const dueNormalizedPercentageKey = dueNormalizedPercentage || 0;
                  const rolePercentagesHash = getRolePercentagesHash(rolePercentages);
                  const cacheKey = `${emp.employeeId}_${dateRangeKey}_${incomeKey}_${dueNormalizedPercentageKey}_${rolePercentagesHash}`;
                  const isExpanded = expandedRows.has(employeeKey);
                  const roleData = roleDataCache.get(cacheKey) || [];
                  const isLoadingRoleData = loadingRoleData.has(employeeKey);

                  return (
                    <React.Fragment key={emp.employeeId}>
                      <tr
                        className="cursor-pointer hover:bg-base-200"
                        onClick={() => toggleRowExpansion(emp.employeeId, emp.employeeName)}
                      >
                        <td className={isFieldView ? 'w-[20%]' : 'w-[25%]'}>
                          <div className="flex items-center gap-2">
                            {isExpanded ? (
                              <ChevronDownIcon className="w-4 h-4 text-gray-500" />
                            ) : (
                              <ChevronRightIcon className="w-4 h-4 text-gray-500" />
                            )}
                            {isFieldView ? (
                              <div className="flex items-center justify-center w-10 h-10 rounded-full bg-base-200">
                                {getCategoryIcon(emp.employeeName)}
                              </div>
                            ) : (
                              <EmployeeAvatar employeeId={emp.employeeId} size="lg" />
                            )}
                            <span>{emp.employeeName}</span>
                          </div>
                        </td>
                        {!isFieldView && <td className="w-[15%]">{emp.department}</td>}
                        <td className="text-right w-[10%]">{formatCurrency(emp.signed)}</td>
                        <td className="text-right w-[10%]">{formatCurrency(emp.due || 0)}</td>
                        <td className="text-right w-[10%]">{formatCurrency(emp.signedNormalized || 0)}</td>
                        <td className="text-right w-[10%]">{formatCurrency(emp.dueNormalized || 0)}</td>
                        <td className="text-right w-[10%]">{formatCurrency(emp.signedPortion)}</td>
                        <td className="text-right w-[10%]">
                          <div className="flex flex-col">
                            <span>{formatCurrency(emp.salaryBudget || 0)}</span>
                            <span className="text-xs text-gray-500">40%</span>
                          </div>
                        </td>
                        <td className="text-right w-[10%]">
                          <div className="flex flex-col">
                            <span>{formatCurrency(emp.salaryBrutto || 0)}</span>
                            {emp.signedPortion > 0 ? (
                              <span className={`text-xs ${((emp.salaryBrutto || 0) - emp.signedPortion) / emp.signedPortion * 100 >= 0 ? 'text-red-500' : 'text-green-500'}`}>
                                {((emp.salaryBrutto || 0) - emp.signedPortion) / emp.signedPortion * 100 >= 0 ? '+' : ''}
                                {(((emp.salaryBrutto || 0) - emp.signedPortion) / emp.signedPortion * 100).toFixed(1)}%
                              </span>
                            ) : (
                              <span className="text-xs text-gray-500">-</span>
                            )}
                          </div>
                        </td>
                        <td className="text-right w-[10%]">
                          <div className="flex flex-col">
                            <span>{formatCurrency(emp.totalSalaryCost || 0)}</span>
                            {emp.signedPortion > 0 ? (
                              <span className={`text-xs ${((emp.totalSalaryCost || 0) - emp.signedPortion) / emp.signedPortion * 100 >= 0 ? 'text-red-500' : 'text-green-500'}`}>
                                {((emp.totalSalaryCost || 0) - emp.signedPortion) / emp.signedPortion * 100 >= 0 ? '+' : ''}
                                {(((emp.totalSalaryCost || 0) - emp.signedPortion) / emp.signedPortion * 100).toFixed(1)}%
                              </span>
                            ) : (
                              <span className="text-xs text-gray-500">-</span>
                            )}
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={colSpanValue} className="p-0 bg-base-100">
                            <div className="p-4 border-t-2 border-primary">
                              {isFieldView ? (
                                <>
                                  <h3 className="text-lg font-semibold mb-3">Category Breakdown for {emp.employeeName}</h3>
                                  {(() => {
                                    const categoryKey = `${emp.employeeName}_${filters.fromDate || ''}_${filters.toDate || ''}`;
                                    const categoryData = categoryBreakdownCache.get(categoryKey) || [];
                                    const isLoading = loadingCategoryBreakdown.has(emp.employeeName);

                                    // Fetch data if not cached and not loading
                                    if (!isLoading && categoryData.length === 0 && !categoryBreakdownCache.has(categoryKey)) {
                                      fetchCategoryBreakdown(emp.employeeName);
                                    }

                                    if (isLoading) {
                                      return (
                                        <div className="flex items-center justify-center py-8">
                                          <span className="loading loading-spinner loading-md"></span>
                                          <span className="ml-2">Loading category data...</span>
                                        </div>
                                      );
                                    }

                                    return (
                                      <div className="overflow-x-auto">
                                        <table className="table w-full table-fixed">
                                          <thead>
                                            <tr>
                                              <th className="w-[30%]">Category</th>
                                              <th className="w-[20%]">Lead</th>
                                              <th className="w-[30%]">Client Name</th>
                                              <th className="text-right w-[20%]">Total</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {categoryData.length === 0 ? (
                                              <tr>
                                                <td colSpan={4} className="text-center text-gray-500">
                                                  No leads found for this category
                                                </td>
                                              </tr>
                                            ) : (
                                              categoryData.map((categoryGroup: any, groupIndex: number) => (
                                                <React.Fragment key={groupIndex}>
                                                  {/* Category header row */}
                                                  <tr className="bg-base-200 font-semibold">
                                                    <td className="w-[30%]" colSpan={3}>{categoryGroup.category}</td>
                                                    <td className="text-right w-[20%]">{formatCurrency(categoryGroup.total)}</td>
                                                  </tr>
                                                  {/* Individual leads in this category */}
                                                  {categoryGroup.leads.map((lead: any, leadIndex: number) => (
                                                    <tr key={`${groupIndex}-${leadIndex}`} className="hover:bg-base-100">
                                                      <td className="w-[30%]"></td>
                                                      <td className="w-[20%]">
                                                        <button
                                                          onClick={(e) => {
                                                            e.stopPropagation();
                                                            navigate(`/clients/${lead.lead}`);
                                                          }}
                                                          className="link link-primary"
                                                        >
                                                          {lead.lead}
                                                        </button>
                                                      </td>
                                                      <td className="w-[30%]">{lead.clientName}</td>
                                                      <td className="text-right w-[20%]">{formatCurrency(lead.total)}</td>
                                                    </tr>
                                                  ))}
                                                </React.Fragment>
                                              ))
                                            )}
                                          </tbody>
                                        </table>
                                      </div>
                                    );
                                  })()}
                                </>
                              ) : (
                                <>
                                  <h3 className="text-lg font-semibold mb-3">Role Breakdown for {emp.employeeName}</h3>
                                  {isLoadingRoleData ? (
                                    <div className="flex items-center justify-center py-8">
                                      <span className="loading loading-spinner loading-md"></span>
                                      <span className="ml-2">Loading role data...</span>
                                    </div>
                                  ) : (
                                    <div className="overflow-x-auto">
                                      <table className="table w-full table-fixed">
                                        <thead>
                                          <tr>
                                            <th className="w-[40%]">Role</th>
                                            <th className="text-right w-[25%]">Signed Total</th>
                                            <th className="text-right w-[25%]">Due Total</th>
                                            <th className="w-[10%]">Action</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {roleData.map((roleItem: any, index: number) => (
                                            <tr key={index}>
                                              <td className="w-[40%]">{roleItem.role}</td>
                                              <td className="text-right w-[25%]">{formatCurrency(roleItem.signedTotal)}</td>
                                              <td className="text-right w-[25%]">{formatCurrency(roleItem.dueTotal)}</td>
                                              <td className="w-[10%]">
                                                <button
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    setModalEmployeeId(emp.employeeId);
                                                    setModalEmployeeName(emp.employeeName);
                                                    // Pass the role combination (may contain multiple roles)
                                                    setModalRole(roleItem.role);
                                                    setModalOpen(true);
                                                  }}
                                                  className="btn btn-ghost btn-xs btn-circle"
                                                  title="View leads"
                                                >
                                                  <EyeIcon className="w-4 h-4" />
                                                </button>
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              {deptData.employees.filter((emp) => {
                if (!employeeSearchTerm.trim()) return true;
                const searchLower = employeeSearchTerm.toLowerCase().trim();
                const nameMatch = emp.employeeName.toLowerCase().includes(searchLower);
                const deptMatch = emp.department.toLowerCase().includes(searchLower);
                return nameMatch || deptMatch;
              }).length === 0 && (
                  <tr>
                    <td colSpan={colSpanValue} className="text-center text-gray-500">
                      {employeeSearchTerm.trim() ? 'No employees found matching your search' : 'No employees found'}
                    </td>
                  </tr>
                )}
              {/* Totals row */}
              <tr className="font-bold bg-base-200">
                <td className={isFieldView ? 'w-[20%]' : 'w-[25%]'}>Total</td>
                {!isFieldView && <td className="w-[15%]"></td>}
                <td className="text-right w-[10%]"></td>
                <td className="text-right w-[10%]"></td>
                <td className="text-right w-[10%]"></td>
                <td className="text-right w-[10%]"></td>
                <td className="text-right w-[10%]">{formatCurrency(deptData.totals.signedPortion)}</td>
                <td className="text-right w-[10%]">
                  <div className="flex flex-col">
                    <span>{formatCurrency(deptData.totals.salaryBudget || 0)}</span>
                    <span className="text-xs text-gray-500">40%</span>
                  </div>
                </td>
                <td className="text-right w-[10%]">
                  <div className="flex flex-col">
                    <span>{formatCurrency(deptData.totals.salaryBrutto || 0)}</span>
                    {deptData.totals.signedPortion > 0 ? (
                      <span className={`text-xs ${((deptData.totals.salaryBrutto || 0) - deptData.totals.signedPortion) / deptData.totals.signedPortion * 100 >= 0 ? 'text-red-500' : 'text-green-500'}`}>
                        {((deptData.totals.salaryBrutto || 0) - deptData.totals.signedPortion) / deptData.totals.signedPortion * 100 >= 0 ? '+' : ''}
                        {(((deptData.totals.salaryBrutto || 0) - deptData.totals.signedPortion) / deptData.totals.signedPortion * 100).toFixed(1)}%
                      </span>
                    ) : (
                      <span className="text-xs text-gray-500">-</span>
                    )}
                  </div>
                </td>
                <td className="text-right w-[10%]">
                  <div className="flex flex-col">
                    <span>{formatCurrency(deptData.totals.totalSalaryCost || 0)}</span>
                    {deptData.totals.signedPortion > 0 ? (
                      <span className={`text-xs ${((deptData.totals.totalSalaryCost || 0) - deptData.totals.signedPortion) / deptData.totals.signedPortion * 100 >= 0 ? 'text-red-500' : 'text-green-500'}`}>
                        {((deptData.totals.totalSalaryCost || 0) - deptData.totals.signedPortion) / deptData.totals.signedPortion * 100 >= 0 ? '+' : ''}
                        {(((deptData.totals.totalSalaryCost || 0) - deptData.totals.signedPortion) / deptData.totals.signedPortion * 100).toFixed(1)}%
                      </span>
                    ) : (
                      <span className="text-xs text-gray-500">-</span>
                    )}
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="w-full px-4 py-6">
      <div className="mb-6">
        <button
          onClick={() => navigate('/reports')}
          className="btn btn-ghost btn-sm mb-4"
        >
          ← Back to Reports
        </button>
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
          <div className="flex items-center gap-4">
            <h1 className="text-3xl font-bold">Sales Contribution Report</h1>
            <div className="flex items-center gap-3">
              <span className={`text-sm font-medium transition-colors ${viewMode === 'employee' ? 'text-primary' : 'text-gray-500'}`}>
                Employee
              </span>
              <input
                type="checkbox"
                className="toggle toggle-primary"
                checked={viewMode === 'field'}
                onChange={(e) => setViewMode(e.target.checked ? 'field' : 'employee')}
              />
              <span className={`text-sm font-medium transition-colors ${viewMode === 'field' ? 'text-primary' : 'text-gray-500'}`}>
                Fields
              </span>
            </div>
          </div>
          <div className="flex flex-col md:flex-row gap-4">
            {/* Income Input */}
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium whitespace-nowrap">Income:</label>
              <input
                type="text"
                className="input input-bordered w-32 md:w-40"
                value={totalIncome !== null && totalIncome !== undefined && totalIncome > 0
                  ? totalIncome.toLocaleString('en-US')
                  : ''}
                onChange={(e) => {
                  // Remove all non-digit characters (except decimal point if needed, but we'll keep it simple for integers)
                  const rawValue = e.target.value.replace(/[^\d]/g, '');
                  if (rawValue === '') {
                    setTotalIncome(0);
                  } else {
                    const numValue = parseFloat(rawValue);
                    if (!isNaN(numValue) && numValue >= 0) {
                      setTotalIncome(numValue);
                    }
                  }
                }}
                onBlur={(e) => {
                  // Ensure the value is formatted on blur
                  if (totalIncome && totalIncome > 0) {
                    e.target.value = totalIncome.toLocaleString('en-US');
                  }
                }}
                onFocus={(e) => {
                  // Show raw number when focused for easier editing
                  if (totalIncome && totalIncome > 0) {
                    e.target.value = totalIncome.toString();
                  }
                }}
                placeholder="Enter income amount"
              />
              <span className="text-sm text-gray-600">₪</span>
            </div>
            {/* Due Normalized Percentage Input */}
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium whitespace-nowrap">Due Normalized %:</label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                className="input input-bordered w-24 md:w-28 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                value={dueNormalizedPercentage !== null && dueNormalizedPercentage !== undefined
                  ? dueNormalizedPercentage.toString()
                  : ''}
                onChange={(e) => {
                  const rawValue = e.target.value;
                  if (rawValue === '') {
                    setDueNormalizedPercentage(0);
                  } else {
                    const numValue = parseFloat(rawValue);
                    if (!isNaN(numValue) && numValue >= 0 && numValue <= 100) {
                      setDueNormalizedPercentage(numValue);
                    }
                  }
                }}
                placeholder="0.00"
              />
              <span className="text-sm text-gray-600">%</span>
              <button
                onClick={saveSettings}
                disabled={savingSettings}
                className="btn btn-primary btn-sm gap-2"
                title="Save income and percentages"
              >
                {savingSettings ? (
                  <>
                    <span className="loading loading-spinner loading-xs"></span>
                    Saving...
                  </>
                ) : (
                  <>
                    <CheckIcon className="w-4 h-4" />
                    Save
                  </>
                )}
              </button>
              <button
                onClick={async () => {
                  // Always fetch latest values when opening modal
                  await fetchRolePercentages();
                  setShowRolePercentagesModal(true);
                }}
                className="btn btn-outline btn-sm gap-2"
                title="Configure role percentages"
              >
                <ChartBarIcon className="w-4 h-4" />
                Role %
              </button>
            </div>
            {/* Total Signed Value */}
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium whitespace-nowrap">Total Signed:</label>
              <div className="px-4 py-2 bg-base-200 rounded-lg border border-base-300 min-w-[120px] text-right">
                {loadingSignedValue ? (
                  <span className="loading loading-spinner loading-sm"></span>
                ) : (
                  <span className="font-semibold">{formatCurrency(totalSignedValue)}</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Role Percentages Modal */}
      {showRolePercentagesModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-base-100 rounded-lg shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-2xl font-bold">Role Percentages Configuration</h3>
                <button
                  onClick={() => setShowRolePercentagesModal(false)}
                  className="btn btn-ghost btn-sm btn-circle"
                >
                  <XMarkIcon className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4 mb-6">
                <p className="text-sm text-gray-600 mb-4">
                  Configure the percentage allocation for each role. Sales roles apply to signed amounts, Handler roles apply to due amounts. Expert appears in both sections but can only be edited in Handler section.
                </p>

                {loadingRolePercentages ? (
                  <div className="flex justify-center py-8">
                    <span className="loading loading-spinner loading-lg"></span>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* Sales Section */}
                    <div>
                      <h4 className="text-lg font-bold mb-3 text-primary">Sales</h4>
                  <div className="space-y-3">
                    {[
                      { role: 'CLOSER', label: 'Closer', description: 'Percentage when Closer works alone (no Helper Closer)' },
                      { role: 'CLOSER_WITH_HELPER', label: 'Closer (with Helper)', description: 'Percentage when Helper Closer also exists' },
                      { role: 'HELPER_CLOSER', label: 'Helper Closer', description: 'Percentage when Helper Closer is assigned' },
                      { role: 'SCHEDULER', label: 'Scheduler', description: 'Meeting Scheduler percentage' },
                      { role: 'MANAGER', label: 'Meeting Manager', description: 'Meeting Manager percentage' },
                          { role: 'EXPERT', label: 'Expert', description: 'Expert percentage (read-only - edit in Handler section)', readOnly: true },
                        ].map(({ role, label, description, readOnly }) => (
                          <div key={role} className="flex items-center gap-4 p-4 bg-base-200 rounded-lg">
                            <div className="flex-1">
                              <label className="font-semibold text-sm">{label}</label>
                              <p className="text-xs text-gray-500 mt-1">{description}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                min="0"
                                max="100"
                                step="0.01"
                                className="input input-bordered w-24 text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                value={tempRolePercentages.get(role) || rolePercentages.get(role)?.toString() || '0'}
                                onChange={(e) => {
                                  if (!readOnly) {
                                    const value = e.target.value;
                                    setTempRolePercentages(prev => {
                                      const updated = new Map(prev);
                                      updated.set(role, value);
                                      return updated;
                                    });
                                  }
                                }}
                                placeholder="0"
                                disabled={readOnly}
                                readOnly={readOnly}
                              />
                              <span className="text-sm font-medium">%</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Handler Section */}
                    <div>
                      <h4 className="text-lg font-bold mb-3 text-secondary">Handler</h4>
                      <div className="space-y-3">
                        {[
                          { role: 'HANDLER', label: 'Handler', description: 'Handler percentage applied to due amounts' },
                          { role: 'HELPER_HANDLER', label: 'Helper Handler', description: 'Helper Handler percentage applied to due amounts' },
                          { role: 'EXPERT', label: 'Expert', description: 'Expert percentage applied to due amounts (also applies to signed amounts)' },
                      { role: 'DEPARTMENT_MANAGER', label: 'Department Manager', description: 'Department Manager percentage' },
                    ].map(({ role, label, description }) => (
                      <div key={role} className="flex items-center gap-4 p-4 bg-base-200 rounded-lg">
                        <div className="flex-1">
                          <label className="font-semibold text-sm">{label}</label>
                          <p className="text-xs text-gray-500 mt-1">{description}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.01"
                            className="input input-bordered w-24 text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            value={tempRolePercentages.get(role) || rolePercentages.get(role)?.toString() || '0'}
                            onChange={(e) => {
                              const value = e.target.value;
                              setTempRolePercentages(prev => {
                                const updated = new Map(prev);
                                updated.set(role, value);
                                return updated;
                              });
                            }}
                            placeholder="0"
                          />
                          <span className="text-sm font-medium">%</span>
                        </div>
                      </div>
                    ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-base-300">
                <button
                  onClick={() => setShowRolePercentagesModal(false)}
                  className="btn btn-ghost"
                  disabled={savingRolePercentages}
                >
                  Cancel
                </button>
                <button
                  onClick={saveRolePercentages}
                  disabled={savingRolePercentages || loadingRolePercentages}
                  className="btn btn-primary gap-2"
                >
                  {savingRolePercentages ? (
                    <>
                      <span className="loading loading-spinner loading-sm"></span>
                      Saving...
                    </>
                  ) : (
                    <>
                      <CheckIcon className="w-4 h-4" />
                      Save Percentages
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="card bg-base-100 shadow-xl mb-6">
        <div className="card-body">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="label">
                <span className="label-text">From Date</span>
              </label>
              <input
                type="date"
                className="input input-bordered w-full"
                value={filters.fromDate}
                onChange={(e) => handleFilterChange('fromDate', e.target.value)}
              />
            </div>
            <div>
              <label className="label">
                <span className="label-text">To Date</span>
              </label>
              <input
                type="date"
                className="input input-bordered w-full"
                value={filters.toDate}
                onChange={(e) => handleFilterChange('toDate', e.target.value)}
              />
            </div>
            <div>
              <label className="label">
                <span className="label-text">Search Employee</span>
              </label>
              <input
                type="text"
                className="input input-bordered w-full"
                placeholder="Search by name or department..."
                value={employeeSearchTerm}
                onChange={(e) => setEmployeeSearchTerm(e.target.value)}
              />
            </div>
            <div className="flex items-end">
              <button
                className="btn btn-primary w-full"
                onClick={handleSearch}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <span className="loading loading-spinner loading-sm"></span>
                    Searching...
                  </>
                ) : (
                  'Search'
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {searchPerformed && !loading && (
        <div className="space-y-6">
          {/* Summary Boxes - Only show in employee view */}
          {viewMode === 'employee' && (
            <div className="flex md:grid md:grid-cols-5 gap-3 md:gap-6 mb-8 w-full overflow-x-auto scrollbar-hide pb-2 md:pb-0 overflow-y-visible">
              {/* Sales */}
              {renderSummaryBox(
                'Sales',
                <ChartBarIcon className="w-7 h-7 md:w-7 md:h-7 text-white opacity-90" />,
                'bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600'
              )}

              {/* Handlers */}
              {renderSummaryBox(
                'Handlers',
                <UserGroupIcon className="w-7 h-7 md:w-7 md:h-7 text-white opacity-90" />,
                'bg-gradient-to-tr from-purple-600 via-blue-600 to-blue-500'
              )}

              {/* Partners */}
              {renderSummaryBox(
                'Partners',
                <BuildingOfficeIcon className="w-7 h-7 md:w-7 md:h-7 text-white opacity-90" />,
                'bg-gradient-to-tr from-blue-500 via-cyan-500 to-teal-400'
              )}

              {/* Marketing */}
              {renderSummaryBox(
                'Marketing',
                <SpeakerWaveIcon className="w-7 h-7 md:w-7 md:h-7 text-white opacity-90" />,
                'bg-gradient-to-tr from-teal-500 via-green-500 to-emerald-500'
              )}

              {/* Finance */}
              {renderSummaryBox(
                'Finance',
                <CurrencyDollarIcon className="w-7 h-7 md:w-7 md:h-7 text-white opacity-90" />,
                'bg-gradient-to-tr from-[#4b2996] via-[#6c4edb] to-[#3b28c7]'
              )}
            </div>
          )}

          {viewMode === 'employee' ? (
            departmentNames
              .filter(deptName => {
                const deptData = departmentData.get(deptName);
                if (!deptData) return false;

                // If there's a search term, only show departments with matching employees
                if (employeeSearchTerm.trim()) {
                  const searchLower = employeeSearchTerm.toLowerCase().trim();
                  return deptData.employees.some(emp => {
                    const nameMatch = emp.employeeName.toLowerCase().includes(searchLower);
                    const deptMatch = emp.department.toLowerCase().includes(searchLower);
                    return nameMatch || deptMatch;
                  });
                }
                // If no search term, show all departments
                return true;
              })
              .map(deptName => {
                const deptData = departmentData.get(deptName);
                if (deptData) {
                  return renderTable(deptData);
                }
                return null;
              })
          ) : (
            // Field View - show tables by main category
            Array.from(fieldViewData.values())
              .filter((fieldData) => {
                // If there's a search term, filter by category name
                if (employeeSearchTerm.trim()) {
                  const searchLower = employeeSearchTerm.toLowerCase().trim();
                  return fieldData.departmentName.toLowerCase().includes(searchLower);
                }
                return true;
              })
              .map((fieldData) => {
                return renderTable(fieldData, true); // true = hide department title
              })
          )}
        </div>
      )}

      {!searchPerformed && (
        <div className="alert alert-info">
          <span>Please select date range and click Search to view the report</span>
        </div>
      )}

      {/* Employee Role Leads Modal */}
      {modalEmployeeId && (
        <EmployeeRoleLeadsModal
          isOpen={modalOpen}
          onClose={() => {
            setModalOpen(false);
            setModalEmployeeId(null);
            setModalEmployeeName('');
            setModalRole('');
          }}
          employeeId={modalEmployeeId}
          employeeName={modalEmployeeName}
          role={modalRole}
          fromDate={filters.fromDate}
          toDate={filters.toDate}
        />
      )}
    </div>
  );
};

export default SalesContributionPage;
