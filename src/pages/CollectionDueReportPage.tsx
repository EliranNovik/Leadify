import React, { useMemo, useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { supabase } from '../lib/supabase';
import { BanknotesIcon, MagnifyingGlassIcon, Squares2X2Icon, ArrowUturnDownIcon, DocumentDuplicateIcon, ChartPieIcon, AdjustmentsHorizontalIcon, FunnelIcon, ClockIcon, ArrowPathIcon, CheckCircleIcon, UserGroupIcon, UserIcon, AcademicCapIcon, StarIcon, PlusIcon, ClipboardDocumentCheckIcon, ChartBarIcon, ListBulletIcon, CurrencyDollarIcon, BriefcaseIcon, ArrowLeftIcon, InformationCircleIcon, RectangleStackIcon, DocumentTextIcon } from '@heroicons/react/24/solid';
import { XMarkIcon, ArrowDownTrayIcon, ScaleIcon, GlobeAltIcon, HomeIcon, ShieldCheckIcon, UsersIcon, WrenchScrewdriverIcon, ClipboardDocumentListIcon, ExclamationTriangleIcon, BuildingOfficeIcon, HeartIcon, CogIcon } from '@heroicons/react/24/outline';
import * as XLSX from 'xlsx';
import { toast } from 'react-hot-toast';
import EmployeeLeadDrawer, {
  EmployeeLeadDrawerItem,
  LeadBaseDetail,
} from '../components/reports/EmployeeLeadDrawer';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend, Cell } from 'recharts';
import { convertToNIS } from '../lib/currencyConversion';
import { usePersistedFilters, usePersistedState } from '../hooks/usePersistedState';

const CollectionDueReport = () => {
  const navigate = useNavigate();
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  const [filters, setFilters] = usePersistedFilters('reports_collectionDue_filters', {
    fromDate: todayStr,
    toDate: todayStr,
    category: [], // Changed to array for multi-select
    order: [], // Changed to array for multi-select
    department: [], // Changed to array for multi-select
    employee: '',
    employeeType: 'actual_employee_due', // 'case_handler' (Case Handler - who clicked sent to finance) or 'actual_employee_due' (Actual Employee Due - actual handler saved in lead)
  }, {
    storage: 'sessionStorage',
  });
  const [employeeData, setEmployeeData] = usePersistedFilters<any[]>('reports_collectionDue_employeeData', [], {
    storage: 'sessionStorage',
  });
  const [departmentData, setDepartmentData] = usePersistedFilters<any[]>('reports_collectionDue_departmentData', [], {
    storage: 'sessionStorage',
  });
  const [totalDue, setTotalDue] = usePersistedFilters<number>('reports_collectionDue_totalDue', 0, {
    storage: 'sessionStorage',
  });
  const [loading, setLoading] = useState(false);
  const [searchPerformed, setSearchPerformed] = usePersistedFilters('reports_collectionDue_performed', false, {
    storage: 'sessionStorage',
  });
  const [showOrderDropdown, setShowOrderDropdown] = useState(false);
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [showDepartmentDropdown, setShowDepartmentDropdown] = useState(false);
  const [employees, setEmployees] = useState<{ id: number; name: string }[]>([]);
  const [allEmployees, setAllEmployees] = useState<any[]>([]); // Store all employees with photo_url for image display
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [allCategories, setAllCategories] = useState<any[]>([]);
  const [categoryNameToDataMap, setCategoryNameToDataMap] = useState<Map<string, any>>(new Map());

  // Drawer state for lead details
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [drawerTitle, setDrawerTitle] = useState('');
  const [drawerLeads, setDrawerLeads] = useState<any[]>([]);
  const [drawerLoading, setDrawerLoading] = useState(false);

  // Store maps for accessing leadIds when drawer opens
  const [employeeMapStore, setEmployeeMapStore] = useState<Map<string, { handlerId: number | null; handlerName: string; departmentName: string; cases: number; applicantsLeads: Set<string>; applicants: number; total: number }>>(new Map());
  const [departmentMapStore, setDepartmentMapStore] = useState<Map<string, { departmentName: string; cases: number; applicantsLeads: Set<string>; applicants: number; total: number }>>(new Map());
  // Store payment values per lead for drawer display
  const [paymentValueMap, setPaymentValueMap] = useState<Map<string, { value: number; currency: string }>>(new Map());
  // Store payment row IDs per employee - this ensures the count matches exactly what the drawer will show
  const [employeePaymentRowIds, setEmployeePaymentRowIds] = useState<Map<string, Set<string>>>(new Map());

  // Search for other reports functionality
  const [searchQuery, setSearchQuery] = usePersistedState<string>('collectionDueReport_searchQuery', '', {
    storage: 'sessionStorage',
  });

  useEffect(() => {
    const fetchOptions = async () => {
      // Fetch employees with photo_url for image display
      const { data: empData } = await supabase
        .from('tenants_employee')
        .select('id, display_name, photo_url, photo')
        .order('display_name');
      if (empData) {
        setEmployees(empData.map(emp => ({ id: emp.id, name: emp.display_name || `Employee #${emp.id}` })));
        // Store full employee data for image lookup
        setAllEmployees(empData);
      }

      // Fetch departments from tenant_departement (like Dashboard does)
      const { data: deptData } = await supabase
        .from('tenant_departement')
        .select('id, name')
        .order('name');
      if (deptData) {
        setDepartments(deptData.map(dept => ({ id: dept.id.toString(), name: dept.name })));
      }

      // Fetch categories
      const { data: catData } = await supabase
        .from('misc_maincategory')
        .select('id, name')
        .order('name');
      if (catData) {
        setCategories(catData.map(cat => ({ id: cat.id.toString(), name: cat.name })));
      }

      // Fetch all categories with their parent main category names and departments using JOINs
      const { data: categoriesData, error: categoriesError } = await supabase
        .from('misc_category')
        .select(`
          id,
          name,
          parent_id,
          misc_maincategory!parent_id (
            id,
            name,
            department_id,
            tenant_departement!department_id (
              id,
              name
            )
          )
        `)
        .order('name', { ascending: true });

      if (!categoriesError && categoriesData) {
        setAllCategories(categoriesData);

        // Create a map from category name (normalized) to category data (including main category and department)
        const nameToDataMap = new Map<string, any>();
        categoriesData.forEach((category: any) => {
          if (category.name) {
            const normalizedName = category.name.trim().toLowerCase();
            nameToDataMap.set(normalizedName, category);
          }
        });
        setCategoryNameToDataMap(nameToDataMap);
      }
    };
    fetchOptions();
  }, []);

  const handleFilterChange = (field: string, value: any) => {
    setFilters(prev => ({ ...prev, [field]: value }));
  };

  const handleOrderToggle = (orderValue: string) => {
    setFilters(prev => {
      const currentOrders = Array.isArray(prev.order) ? prev.order : [];
      const newOrders = currentOrders.includes(orderValue)
        ? currentOrders.filter(o => o !== orderValue)
        : [...currentOrders, orderValue];
      return { ...prev, order: newOrders };
    });
  };

  const handleSelectAllOrders = () => {
    setFilters(prev => ({ ...prev, order: ['1', '5', '9', '90', '99'] }));
  };

  const handleClearAllOrders = () => {
    setFilters(prev => ({ ...prev, order: [] }));
  };

  const handleCategoryToggle = (categoryId: string) => {
    setFilters(prev => {
      const currentCategories = Array.isArray(prev.category) ? prev.category : [];
      const newCategories = currentCategories.includes(categoryId)
        ? currentCategories.filter(c => c !== categoryId)
        : [...currentCategories, categoryId];
      return { ...prev, category: newCategories };
    });
  };

  const handleSelectAllCategories = () => {
    setFilters(prev => ({ ...prev, category: categories.map(cat => cat.id) }));
  };

  const handleClearAllCategories = () => {
    setFilters(prev => ({ ...prev, category: [] }));
  };

  const handleDepartmentToggle = (departmentId: string) => {
    setFilters(prev => {
      const currentDepartments = Array.isArray(prev.department) ? prev.department : [];
      const newDepartments = currentDepartments.includes(departmentId)
        ? currentDepartments.filter(d => d !== departmentId)
        : [...currentDepartments, departmentId];
      return { ...prev, department: newDepartments };
    });
  };

  const handleSelectAllDepartments = () => {
    setFilters(prev => ({ ...prev, department: departments.map(dept => dept.id) }));
  };

  const handleClearAllDepartments = () => {
    setFilters(prev => ({ ...prev, department: [] }));
  };

  // Helper function to get employee by ID or name (for image lookup)
  const getEmployeeById = (employeeIdOrName: string | number | null | undefined) => {
    if (!employeeIdOrName || employeeIdOrName === '---' || employeeIdOrName === '--' || employeeIdOrName === 'Unknown') {
      return null;
    }

    // First, try to match by ID
    const employeeById = allEmployees.find((emp: any) => {
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
      const employeeByName = allEmployees.find((emp: any) => {
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
  const getEmployeeInitials = (name: string) => {
    if (!name) return '--';
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  // Reports list for search functionality
  type ReportItem = {
    label: string;
    icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
    route?: string;
  };

  type ReportSection = {
    category: string;
    items: ReportItem[];
  };

  const reports: ReportSection[] = [
    {
      category: 'Search',
      items: [
        { label: 'Full Search', icon: MagnifyingGlassIcon, route: '/reports' },
        { label: 'Stage Search', icon: Squares2X2Icon, route: '/reports' },
        { label: 'Anchor Search', icon: ArrowUturnDownIcon, route: '/reports' },
        { label: 'Duplicate Search', icon: DocumentDuplicateIcon, route: '/reports' },
      ],
    },
    {
      category: 'Marketing',
      items: [
        { label: 'Sources pie', icon: ChartPieIcon, route: '/reports' },
        { label: 'Category & source', icon: AdjustmentsHorizontalIcon, route: '/reports' },
        { label: 'Convertion', icon: FunnelIcon, route: '/reports' },
        { label: 'Convertion Steps', icon: FunnelIcon, route: '/reports' },
      ],
    },
    {
      category: 'Meetings',
      items: [
        { label: 'Scheduled', icon: ClockIcon, route: '/reports' },
        { label: 'Rescheduled', icon: ArrowPathIcon, route: '/reports' },
        { label: 'Results', icon: CheckCircleIcon, route: '/reports' },
        { label: 'Collection', icon: BanknotesIcon, route: '/reports' },
        { label: 'Convertion', icon: FunnelIcon, route: '/reports' },
      ],
    },
    {
      category: 'Sales',
      items: [
        { label: 'Actual', icon: UserGroupIcon, route: '/reports' },
        { label: 'Target', icon: UserIcon, route: '/reports' },
        { label: 'Signed', icon: AcademicCapIcon, route: '/sales/signed' },
        { label: 'Scheduling Bonuses', icon: StarIcon, route: '/reports' },
        { label: 'Bonuses (v4)', icon: PlusIcon, route: '/reports' },
      ],
    },
    {
      category: 'Pipelines',
      items: [
        { label: 'General Sales', icon: Squares2X2Icon, route: '/reports' },
        { label: 'Employee', icon: UserIcon, route: '/reports' },
        { label: 'Unhandled', icon: UserIcon, route: '/reports' },
        { label: 'Expert', icon: AcademicCapIcon, route: '/reports' },
      ],
    },
    {
      category: 'Schedulers',
      items: [
        { label: 'Super Pipeline', icon: BanknotesIcon, route: '/reports' },
        { label: 'Schedulers Quality', icon: StarIcon, route: '/reports' },
        { label: 'Performance', icon: ChartBarIcon, route: '/reports' },
        { label: 'Performance by Cat.', icon: ChartBarIcon, route: '/reports' },
      ],
    },
    {
      category: 'Closers',
      items: [
        { label: 'Super Pipeline', icon: BanknotesIcon, route: '/reports' },
        { label: 'Closers Quality', icon: StarIcon, route: '/reports' },
      ],
    },
    {
      category: 'Experts',
      items: [
        { label: 'Experts Assignment', icon: AcademicCapIcon, route: '/reports' },
        { label: 'Experts Results', icon: AcademicCapIcon, route: '/reports' },
      ],
    },
    {
      category: 'Contribution',
      items: [
        { label: 'All', icon: RectangleStackIcon, route: '/reports' },
      ],
    },
    {
      category: 'Analysis',
      items: [
        { label: 'Employees Performance', icon: ChartBarIcon, route: '/reports' },
        { label: 'Statistics', icon: ChartPieIcon, route: '/reports' },
        { label: 'Pies', icon: ChartPieIcon, route: '/reports' },
        { label: 'Tasks', icon: ListBulletIcon, route: '/reports' },
      ],
    },
    {
      category: 'Finances',
      items: [
        { label: 'Profitability', icon: CurrencyDollarIcon, route: '/reports' },
        { label: 'Collection', icon: BanknotesIcon, route: '/reports/collection-finances' },
        { label: 'Collection Due', icon: BanknotesIcon, route: '/reports/collection-due' },
      ],
    },
    {
      category: 'Cases',
      items: [
        { label: 'Sum Active', icon: BriefcaseIcon, route: '/reports' },
      ],
    },
  ];

  // Filter reports based on search query
  const filteredReports = useMemo(() => {
    if (!searchQuery.trim()) {
      return reports;
    }

    const query = searchQuery.toLowerCase().trim();
    return reports
      .map((section) => {
        const filteredItems = section.items.filter((item) => {
          const labelMatch = item.label.toLowerCase().includes(query);
          const categoryMatch = section.category.toLowerCase().includes(query);
          return labelMatch || categoryMatch;
        });
        return { ...section, items: filteredItems };
      })
      .filter((section) => section.items.length > 0);
  }, [searchQuery]);

  // Track image errors per employee to prevent flickering (persists across re-renders)
  const imageErrorCache = useRef<Map<string | number, boolean>>(new Map());

  // Employee Avatar Component
  const EmployeeAvatar: React.FC<{
    employeeIdOrName: string | number | null | undefined;
    size?: 'sm' | 'md';
  }> = ({ employeeIdOrName, size = 'md' }) => {
    const [imageError, setImageError] = useState(false);
    const [imageLoaded, setImageLoaded] = useState(false);
    const employee = getEmployeeById(employeeIdOrName);

    if (!employee) {
      return null;
    }

    const photoUrl = employee.photo_url || employee.photo;
    const initials = getEmployeeInitials(employee.display_name);
    const sizeClasses = size === 'sm' ? 'w-10 h-10 text-sm' : 'w-12 h-12 text-base';

    // Validate photoUrl - must be a non-empty string that looks like a URL
    const isValidPhotoUrl = photoUrl &&
      typeof photoUrl === 'string' &&
      photoUrl.trim() !== '' &&
      (photoUrl.startsWith('http') || photoUrl.startsWith('data:') || photoUrl.startsWith('/'));

    // Check cache first to prevent flickering
    const cacheKey = employeeIdOrName?.toString() || '';
    const cachedError = imageErrorCache.current.get(cacheKey) || false;

    // If no valid photo URL or error occurred (including cached error), show initials
    if (cachedError || imageError || !isValidPhotoUrl) {
      return (
        <div className={`${sizeClasses} rounded-full flex items-center justify-center bg-green-100 text-green-700 font-semibold`}>
          {initials}
        </div>
      );
    }

    // Show initials while image is loading, then show image once loaded
    return (
      <div className={`${sizeClasses} rounded-full relative overflow-hidden bg-green-100`}>
        {!imageLoaded && (
          <div className={`${sizeClasses} absolute inset-0 rounded-full flex items-center justify-center bg-green-100 text-green-700 font-semibold`}>
            {initials}
          </div>
        )}
        <img
          src={photoUrl}
          alt={employee.display_name}
          className={`${sizeClasses} rounded-full object-cover ${imageLoaded ? 'opacity-100' : 'opacity-0'} transition-opacity duration-200`}
          onError={() => {
            // Cache the error to prevent flickering on re-renders
            if (cacheKey) {
              imageErrorCache.current.set(cacheKey, true);
            }
            setImageError(true);
            setImageLoaded(false);
          }}
          onLoad={() => {
            setImageLoaded(true);
          }}
        />
      </div>
    );
  };

  // Function to get the appropriate icon for each department (same as CalendarPage/DepartmentList)
  const getDepartmentIcon = (departmentName: string) => {
    const name = departmentName.toLowerCase();

    // Staff Meeting gets a special icon
    if (name.includes('staff')) {
      return <UsersIcon className="w-5 h-5" />;
    }

    // Legal-related departments
    if (name.includes('legal') || name.includes('law') || name.includes('attorney')) {
      return <ScaleIcon className="w-5 h-5" />;
    }

    // Immigration to Israel - Home icon (representing homeland)
    if (name.includes('israel') || name.includes('israeli') || name.includes('aliyah')) {
      return <HomeIcon className="w-5 h-5" />;
    }

    // USA Immigration - Flag icon (using ShieldCheckIcon as flag representation)
    if (name.includes('usa') || name.includes('united states') || name.includes('america') || name.includes('us immigration')) {
      return <ShieldCheckIcon className="w-5 h-5" />;
    }

    // Small cases - different icon from Austria/Germany
    if (name.includes('small cases') || name.includes('small case')) {
      return <DocumentTextIcon className="w-5 h-5" />;
    }

    // Austria and Germany immigration - globe icon
    if (name.includes('austria') || name.includes('german') || name.includes('germany')) {
      return <GlobeAltIcon className="w-5 h-5" />;
    }

    // General immigration-related departments
    if (name.includes('immigration') || name.includes('citizenship') || name.includes('visa') || name.includes('passport')) {
      return <GlobeAltIcon className="w-5 h-5" />;
    }

    // Business/Corporate departments
    if (name.includes('business') || name.includes('corporate') || name.includes('commercial')) {
      return <BriefcaseIcon className="w-5 h-5" />;
    }

    // HR/Personnel departments
    if (name.includes('hr') || name.includes('human') || name.includes('personnel') || name.includes('staff')) {
      return <UserGroupIcon className="w-5 h-5" />;
    }

    // Finance/Accounting departments
    if (name.includes('finance') || name.includes('accounting') || name.includes('financial') || name.includes('money')) {
      return <BanknotesIcon className="w-5 h-5" />;
    }

    // Marketing departments
    if (name.includes('marketing') || name.includes('sales') || name.includes('advertising')) {
      return <ChartBarIcon className="w-5 h-5" />;
    }

    // IT/Technology departments
    if (name.includes('it') || name.includes('technology') || name.includes('tech') || name.includes('computer')) {
      return <CogIcon className="w-5 h-5" />;
    }

    // Education/Training departments
    if (name.includes('education') || name.includes('training') || name.includes('learning') || name.includes('academy')) {
      return <AcademicCapIcon className="w-5 h-5" />;
    }

    // Healthcare/Medical departments
    if (name.includes('health') || name.includes('medical') || name.includes('healthcare') || name.includes('clinic')) {
      return <HeartIcon className="w-5 h-5" />;
    }

    // Real Estate departments
    if (name.includes('real estate') || name.includes('property') || name.includes('housing')) {
      return <HomeIcon className="w-5 h-5" />;
    }

    // Security departments
    if (name.includes('security') || name.includes('safety') || name.includes('protection')) {
      return <ShieldCheckIcon className="w-5 h-5" />;
    }

    // Operations departments
    if (name.includes('operations') || name.includes('operational') || name.includes('management')) {
      return <WrenchScrewdriverIcon className="w-5 h-5" />;
    }

    // Documentation/Administration departments
    if (name.includes('admin') || name.includes('administration') || name.includes('document') || name.includes('paperwork')) {
      return <ClipboardDocumentListIcon className="w-5 h-5" />;
    }

    // General department (default fallback)
    if (name.includes('general')) {
      return <BuildingOfficeIcon className="w-5 h-5" />;
    }

    // Unassigned meetings
    if (name.includes('unassigned') || name.includes('unknown') || name === '—' || name === '-') {
      return <ExclamationTriangleIcon className="w-5 h-5" />;
    }

    // Default icon for any other department
    return <BuildingOfficeIcon className="w-5 h-5" />;
  };

  // Helper function to normalize order code (similar to CollectionFinancesReport)
  const normalizeOrderCode = (order: string | number | null | undefined): string => {
    if (order === null || order === undefined) return '';
    const raw = order.toString().trim();
    if (!raw) return '';
    if (!Number.isNaN(Number(raw))) {
      return raw;
    }
    switch (raw.toLowerCase()) {
      case 'first payment':
        return '1';
      case 'intermediate payment':
        return '5';
      case 'final payment':
        return '9';
      case 'single payment':
        return '90';
      case 'expense (no vat)':
        return '99';
      default:
        return raw;
    }
  };

  // Helper function to resolve category and get department (similar to SignedSalesReportPage)
  const resolveCategoryAndDepartment = (
    categoryValue?: string | null,
    categoryId?: string | number | null,
    miscCategory?: any
  ): { departmentId: string | null; departmentName: string } => {
    // If we have categoryValue but no miscCategory, try to look it up in the map
    let resolvedMiscCategory = miscCategory;
    if (!miscCategory && categoryValue && categoryValue.trim() !== '' && categoryNameToDataMap.size > 0) {
      const normalizedName = categoryValue.trim().toLowerCase();
      const mappedCategory = categoryNameToDataMap.get(normalizedName);
      if (mappedCategory) {
        resolvedMiscCategory = mappedCategory;
      }
    }

    // If we still don't have a category, return defaults
    if (!resolvedMiscCategory) {
      return { departmentId: null, departmentName: '—' };
    }

    // Handle array case (shouldn't happen, but be safe)
    const categoryRecord = Array.isArray(resolvedMiscCategory) ? resolvedMiscCategory[0] : resolvedMiscCategory;
    if (!categoryRecord) {
      return { departmentId: null, departmentName: '—' };
    }

    // Extract main category (handle both array and object cases)
    let mainCategory = Array.isArray(categoryRecord.misc_maincategory)
      ? categoryRecord.misc_maincategory[0]
      : categoryRecord.misc_maincategory;

    if (!mainCategory) {
      return { departmentId: null, departmentName: categoryRecord.name || '—' };
    }

    // Extract department from main category
    const department = mainCategory.tenant_departement
      ? (Array.isArray(mainCategory.tenant_departement) ? mainCategory.tenant_departement[0] : mainCategory.tenant_departement)
      : null;

    const departmentId = department?.id?.toString() || null;
    const departmentName = department?.name || mainCategory.name || categoryRecord.name || '—';

    return { departmentId, departmentName };
  };

  // Helper function to get category name from ID with main category (similar to CalendarPage)
  const getCategoryName = (categoryId: string | number | null | undefined, fallbackCategory?: string | number) => {
    if (!categoryId || categoryId === '---' || categoryId === '--') {
      // If no category_id but we have a fallback category, try to find it in the loaded categories
      if (fallbackCategory && String(fallbackCategory).trim() !== '') {
        // Try to find the fallback category in the loaded categories
        // First try by ID if fallbackCategory is a number
        let foundCategory = null;
        if (typeof fallbackCategory === 'number') {
          foundCategory = allCategories.find((cat: any) =>
            cat.id.toString() === fallbackCategory.toString()
          );
        }

        // If not found by ID, try by name
        if (!foundCategory) {
          foundCategory = allCategories.find((cat: any) =>
            cat.name.toLowerCase().trim() === String(fallbackCategory).toLowerCase().trim()
          );
        }

        if (foundCategory) {
          // Return category name with main category in parentheses
          if (foundCategory.misc_maincategory?.name) {
            return `${foundCategory.name} (${foundCategory.misc_maincategory.name})`;
          } else {
            return foundCategory.name; // Fallback if no main category
          }
        } else {
          return String(fallbackCategory); // Use as-is if not found in loaded categories
        }
      }
      return '--';
    }

    // If allCategories is not loaded yet, return the original value
    if (!allCategories || allCategories.length === 0) {
      return String(categoryId);
    }

    // First try to find by ID
    const categoryById = allCategories.find((cat: any) => cat.id.toString() === categoryId.toString());
    if (categoryById) {
      // Return category name with main category in parentheses
      if (categoryById.misc_maincategory?.name) {
        return `${categoryById.name} (${categoryById.misc_maincategory.name})`;
      } else {
        return categoryById.name; // Fallback if no main category
      }
    }

    // If not found by ID, try to find by name (in case it's already a name)
    const categoryByName = allCategories.find((cat: any) => cat.name === categoryId);
    if (categoryByName) {
      // Return category name with main category in parentheses
      if (categoryByName.misc_maincategory?.name) {
        return `${categoryByName.name} (${categoryByName.misc_maincategory.name})`;
      } else {
        return categoryByName.name; // Fallback if no main category
      }
    }

    return String(categoryId); // Fallback to original value if not found
  };

  // Export functions for Excel
  const exportEmployeeTable = () => {
    if (employeeData.length === 0) {
      toast.error('No data to export');
      return;
    }

    const headers = ['Employee', 'Department', 'Cases', 'Applicants', 'Total'];
    const excelData = employeeData.map(row => ({
      'Employee': row.employee,
      'Department': row.department,
      'Cases': row.cases,
      'Applicants': row.applicants,
      'Total': formatCurrency(row.total)
    }));

    const ws = XLSX.utils.json_to_sheet(excelData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'By Employee');

    const dateStr = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `Collection_Due_By_Employee_${dateStr}.xlsx`);
  };

  const exportDepartmentTable = () => {
    if (departmentData.length === 0) {
      toast.error('No data to export');
      return;
    }

    const headers = ['Department', 'Cases', 'Applicants', 'Total'];
    const excelData = departmentData.map(row => ({
      'Department': row.department,
      'Cases': row.cases,
      'Applicants': row.applicants,
      'Total': formatCurrency(row.total)
    }));

    const ws = XLSX.utils.json_to_sheet(excelData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'By Department');

    const dateStr = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `Collection_Due_By_Department_${dateStr}.xlsx`);
  };

  const handleSearch = async () => {
    setLoading(true);
    setSearchPerformed(true);
    try {
      console.log('🔍 Collection Due Report - Starting search with filters:', filters);

      // First, let's check what exists in the database without filters to debug
      console.log('🔍 Collection Due Report - DEBUG: Checking all payment_plans in date range...');
      const debugNewFromDate = filters.fromDate ? `${filters.fromDate}T00:00:00` : '2020-01-01T00:00:00';
      const debugNewToDate = filters.toDate ? `${filters.toDate}T23:59:59` : '2030-12-31T23:59:59';
      const { data: debugNewPayments, error: debugNewError } = await supabase
        .from('payment_plans')
        .select('id, lead_id, due_date, ready_to_pay, cancel_date, paid')
        .gte('due_date', debugNewFromDate)
        .lte('due_date', debugNewToDate)
        .limit(10);

      if (debugNewError) {
        console.error('❌ Collection Due Report - DEBUG Error:', debugNewError);
      } else {
        console.log('📊 Collection Due Report - DEBUG: Sample new payments (first 10):', debugNewPayments);
        console.log('📊 Collection Due Report - DEBUG: ready_to_pay values:', debugNewPayments?.map(p => ({ id: p.id, ready_to_pay: p.ready_to_pay, due_date: p.due_date })));
      }

      // Fetch new payment plans - ready to pay (both paid and unpaid)
      console.log('🔍 Collection Due Report - Fetching new payment plans...');
      let newPaymentsQuery = supabase
        .from('payment_plans')
        .select(`
          id,
          lead_id,
          value,
          value_vat,
          currency,
          due_date,
          cancel_date,
          ready_to_pay,
          ready_to_pay_by,
          paid,
          payment_order
        `)
        .eq('ready_to_pay', true)
        .not('due_date', 'is', null)
        .is('cancel_date', null);
      // Note: Removed .eq('paid', false) to show both paid and unpaid payments

      if (filters.fromDate) {
        const fromDateTime = `${filters.fromDate}T00:00:00`;
        console.log('🔍 Collection Due Report - Filtering new payments from date:', fromDateTime);
        newPaymentsQuery = newPaymentsQuery.gte('due_date', fromDateTime);
      }
      if (filters.toDate) {
        const toDateTime = `${filters.toDate}T23:59:59`;
        console.log('🔍 Collection Due Report - Filtering new payments to date:', toDateTime);
        newPaymentsQuery = newPaymentsQuery.lte('due_date', toDateTime);
      }

      let { data: newPayments, error: newError } = await newPaymentsQuery;
      if (newError) {
        console.error('❌ Collection Due Report - Error fetching new payments:', newError);
        throw newError;
      }
      console.log('✅ Collection Due Report - Fetched new payments:', newPayments?.length || 0);

      // DEBUG: Check without ready_to_pay filter
      console.log('🔍 Collection Due Report - DEBUG: Checking new payments WITHOUT ready_to_pay filter...');
      const debugFromDate = filters.fromDate ? `${filters.fromDate}T00:00:00` : '2020-01-01T00:00:00';
      const debugToDate = filters.toDate ? `${filters.toDate}T23:59:59` : '2030-12-31T23:59:59';
      const { data: debugNewWithoutFilter, error: debugNewWithoutError } = await supabase
        .from('payment_plans')
        .select('id, lead_id, due_date, ready_to_pay, cancel_date, paid')
        .not('due_date', 'is', null)
        .is('cancel_date', null)
        .gte('due_date', debugFromDate)
        .lte('due_date', debugToDate)
        .limit(10);

      if (!debugNewWithoutError) {
        console.log('📊 Collection Due Report - DEBUG: New payments without ready_to_pay filter:', debugNewWithoutFilter?.length || 0);
        console.log('📊 Collection Due Report - DEBUG: Sample:', debugNewWithoutFilter);
      }

      // DEBUG: Check legacy payments
      console.log('🔍 Collection Due Report - DEBUG: Checking all finances_paymentplanrow in date range...');
      const debugLegacyFromDate = filters.fromDate ? `${filters.fromDate}T00:00:00` : '2020-01-01T00:00:00';
      const debugLegacyToDate = filters.toDate ? `${filters.toDate}T23:59:59` : '2030-12-31T23:59:59';
      const { data: debugLegacyPayments, error: debugLegacyError } = await supabase
        .from('finances_paymentplanrow')
        .select('id, lead_id, due_date, date, ready_to_pay, cancel_date, actual_date')
        .gte('date', debugLegacyFromDate)
        .lte('date', debugLegacyToDate)
        .limit(10);

      if (debugLegacyError) {
        console.error('❌ Collection Due Report - DEBUG Error:', debugLegacyError);
      } else {
        console.log('📊 Collection Due Report - DEBUG: Sample legacy payments (first 10):', debugLegacyPayments);
        console.log('📊 Collection Due Report - DEBUG: ready_to_pay values:', debugLegacyPayments?.map(p => ({
          id: p.id,
          lead_id: p.lead_id,
          ready_to_pay: p.ready_to_pay,
          ready_to_pay_type: typeof p.ready_to_pay,
          date: p.date,
          due_date: p.due_date,
          actual_date: p.actual_date,
          cancel_date: p.cancel_date
        })));

        // Check how many have ready_to_pay = true
        const withReadyToPay = debugLegacyPayments?.filter(p => p.ready_to_pay === true || p.ready_to_pay === 'true' || p.ready_to_pay === 1);
        console.log('📊 Collection Due Report - DEBUG: Legacy payments with ready_to_pay=true:', withReadyToPay?.length || 0);
      }

      // Fetch legacy payment plans from finances_paymentplanrow
      // IMPORTANT: For legacy leads, we ONLY filter by due_date (not ready_to_pay flag)
      // If due_date exists, the payment is ready to pay, regardless of ready_to_pay flag value
      // This ensures we include ALL payments with due_date set, whether ready_to_pay is true or false
      console.log('🔍 Collection Due Report - Fetching legacy payment plans from finances_paymentplanrow...');
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
          date,
          cancel_date,
          ready_to_pay,
          actual_date,
          due_by_id,
          order,
          accounting_currencies!finances_paymentplanrow_currency_id_fkey(name, iso_code)
        `)
        .not('due_date', 'is', null) // ONLY filter by due_date - fetch all payments with due_date set (regardless of ready_to_pay flag)
        .is('cancel_date', null); // Exclude cancelled payments only - show both paid and unpaid payments

      // Debug: Check for payments with due_by_id = 14 before filtering
      console.log('🔍 DEBUG Employee 14 - About to apply date filters to legacy payments query');

      // DEBUG: Check ALL payments for lead 183061 BEFORE applying date filters
      console.log('🔍 DEBUG Lead 183061 - Checking payments BEFORE date filters...');
      const { data: beforeFilterCheck, error: beforeFilterError } = await supabase
        .from('finances_paymentplanrow')
        .select('id, lead_id, date, due_date, cancel_date, value, value_base')
        .eq('lead_id', 183061)
        .is('cancel_date', null)
        .not('due_date', 'is', null)
        .limit(20);
      if (!beforeFilterError && beforeFilterCheck) {
        console.log('🔍 DEBUG Lead 183061 - Payments BEFORE date filters:', beforeFilterCheck.length, beforeFilterCheck.map((p: any) => ({
          id: p.id,
          date: p.date,
          due_date: p.due_date,
          value: p.value,
          value_base: p.value_base,
          cancel_date: p.cancel_date
        })));
      }

      // Filter by 'due_date' column for date range (this is what determines when payment is due)
      // For legacy leads, only fetch payment rows if due_date is available (due_date means ready to pay)
      // We already have .not('due_date', 'is', null) in the query, so we only get payments with due_date
      if (filters.fromDate) {
        const fromDateTime = `${filters.fromDate}T00:00:00`;
        console.log('🔍 Collection Due Report - Filtering legacy payments by due_date from:', fromDateTime);
        legacyPaymentsQuery = legacyPaymentsQuery.gte('due_date', fromDateTime);
      }
      if (filters.toDate) {
        const toDateTime = `${filters.toDate}T23:59:59`;
        console.log('🔍 Collection Due Report - Filtering legacy payments by due_date to:', toDateTime);
        legacyPaymentsQuery = legacyPaymentsQuery.lte('due_date', toDateTime);
      }

      const { data: legacyPayments, error: legacyError } = await legacyPaymentsQuery;
      if (legacyError) {
        console.error('❌ Collection Due Report - Error fetching legacy payments:', legacyError);
        throw legacyError;
      }
      console.log('✅ Collection Due Report - Fetched legacy payments (due_date in range, ready_to_pay):', legacyPayments?.length || 0);

      // DEBUG: Check specifically for lead 183061
      const paymentsFor183061 = legacyPayments?.filter((p: any) =>
        p.lead_id?.toString() === '183061' || p.lead_id === 183061
      ) || [];
      console.log('🔍 DEBUG Lead 183061 - Payments found in query result (after due_date filter):', paymentsFor183061.length);

      // DEBUG: Check specifically for lead 209192
      const paymentsFor209192 = legacyPayments?.filter((p: any) =>
        p.lead_id?.toString() === '209192' || p.lead_id === 209192
      ) || [];
      console.log('🔍 DEBUG Lead 209192 - Payments found in query result (after due_date filter):', paymentsFor209192.length);
      if (paymentsFor209192.length > 0) {
        console.log('🔍 DEBUG Lead 209192 - Payment details:', paymentsFor209192.map((p: any) => ({
          id: p.id,
          lead_id: p.lead_id,
          date: p.date,
          due_date: p.due_date,
          value: p.value,
          value_base: p.value_base,
          cancel_date: p.cancel_date,
          ready_to_pay: p.ready_to_pay,
          actual_date: p.actual_date,
          due_by_id: p.due_by_id
        })));
      } else {
        console.warn('⚠️ DEBUG Lead 209192 - NO payments found in query result! Checking if lead exists in database...');
        // Query directly to see if payments exist and what their due_date values are
        const { data: directCheck209192, error: directError209192 } = await supabase
          .from('finances_paymentplanrow')
          .select('id, lead_id, date, due_date, cancel_date, value, value_base, ready_to_pay, actual_date, due_by_id')
          .eq('lead_id', 209192)
          .is('cancel_date', null)
          .limit(20);
        if (directError209192) {
          console.error('❌ DEBUG Lead 209192 - Error checking directly:', directError209192);
        } else {
          console.log('🔍 DEBUG Lead 209192 - Direct query result (all payments for this lead):', directCheck209192?.length || 0);
          if (directCheck209192 && directCheck209192.length > 0) {
            console.log('🔍 DEBUG Lead 209192 - All payment details:', directCheck209192.map((p: any) => ({
              id: p.id,
              date: p.date,
              due_date: p.due_date,
              due_date_in_range: p.due_date && filters.fromDate && filters.toDate
                ? (p.due_date >= `${filters.fromDate}T00:00:00` && p.due_date <= `${filters.toDate}T23:59:59`)
                : 'N/A',
              value: p.value,
              value_base: p.value_base,
              cancel_date: p.cancel_date,
              actual_date: p.actual_date,
              ready_to_pay: p.ready_to_pay,
              due_by_id: p.due_by_id
            })));

            // Check which payments would match the date filter
            const fromDateTime = filters.fromDate ? `${filters.fromDate}T00:00:00` : null;
            const toDateTime = filters.toDate ? `${filters.toDate}T23:59:59` : null;
            const matchingPayments = directCheck209192.filter((p: any) => {
              if (!p.due_date) return false;
              if (fromDateTime && p.due_date < fromDateTime) return false;
              if (toDateTime && p.due_date > toDateTime) return false;
              return true;
            });
            console.log('🔍 DEBUG Lead 209192 - Payments matching date filter:', matchingPayments.length);
            console.log('🔍 DEBUG Lead 209192 - Date filter range:', { fromDate: filters.fromDate, toDate: filters.toDate, fromDateTime, toDateTime });
          } else {
            console.warn('⚠️ DEBUG Lead 209192 - No payments found in database for this lead');
          }
        }
      }
      if (paymentsFor183061.length > 0) {
        console.log('🔍 DEBUG Lead 183061 - Payment details:', paymentsFor183061.map((p: any) => ({
          id: p.id,
          lead_id: p.lead_id,
          date: p.date,
          due_date: p.due_date,
          value: p.value,
          value_base: p.value_base,
          cancel_date: p.cancel_date,
          ready_to_pay: p.ready_to_pay,
          actual_date: p.actual_date
        })));
      } else {
        console.warn('⚠️ DEBUG Lead 183061 - NO payments found in query result! Checking if lead exists in database...');
        // Query directly to see if payments exist and what their due_date values are
        const { data: directCheck, error: directError } = await supabase
          .from('finances_paymentplanrow')
          .select('id, lead_id, date, due_date, cancel_date, value, value_base, ready_to_pay, actual_date')
          .eq('lead_id', 183061)
          .is('cancel_date', null)
          .not('due_date', 'is', null)
          .limit(10);
        if (directError) {
          console.error('❌ DEBUG Lead 183061 - Error checking directly:', directError);
        } else {
          console.log('🔍 DEBUG Lead 183061 - Direct query result (all payments for this lead):', directCheck?.length || 0);
          if (directCheck && directCheck.length > 0) {
            console.log('🔍 DEBUG Lead 183061 - Payment details with due_date:', directCheck.map((p: any) => ({
              id: p.id,
              date: p.date,
              due_date: p.due_date,
              due_date_in_range: p.due_date && p.due_date >= `${filters.fromDate}T00:00:00` && p.due_date <= `${filters.toDate}T23:59:59`,
              value: p.value,
              value_base: p.value_base,
              cancel_date: p.cancel_date,
              actual_date: p.actual_date
            })));
          }
        }
      }

      // No need to filter again - we already filtered by due_date in the query
      const filteredLegacyPayments = legacyPayments || [];

      console.log('✅ Collection Due Report - Filtered legacy payments:', filteredLegacyPayments.length);
      if (filteredLegacyPayments.length > 0) {
        console.log('📊 Collection Due Report - Sample filtered legacy payments:', filteredLegacyPayments.slice(0, 3).map((p: any) => ({
          id: p.id,
          lead_id: p.lead_id,
          due_date: p.due_date,
          date: p.date,
          value: p.value,
          ready_to_pay: p.ready_to_pay
        })));
      }
      if (filteredLegacyPayments.length > 0) {
        console.log('📊 Collection Due Report - Sample filtered legacy payments:', filteredLegacyPayments.slice(0, 3).map(p => ({
          id: p.id,
          lead_id: p.lead_id,
          due_date: p.due_date,
          date: p.date,
          value: p.value
        })));
      }

      // Get unique lead IDs
      let newLeadIds = Array.from(new Set((newPayments || []).map(p => p.lead_id).filter(Boolean)));
      let legacyLeadIds = Array.from(new Set(filteredLegacyPayments.map(p => p.lead_id).filter(Boolean))).map(id => Number(id)).filter(id => !Number.isNaN(id));

      console.log('🔍 Collection Due Report - Unique new lead IDs:', newLeadIds.length);
      console.log('🔍 Collection Due Report - Unique legacy lead IDs:', legacyLeadIds.length);
      console.log('🔍 DEBUG Employee 14 - Legacy lead IDs:', legacyLeadIds);
      console.log('🔍 DEBUG Employee 14 - Is 163739 in legacyLeadIds?', legacyLeadIds.includes(163739));

      // Fetch subleads for new leads (optimized - batch queries instead of loops)
      console.log('🔍 Collection Due Report - Fetching subleads for new leads...');
      if (newLeadIds.length > 0) {
        // First, get lead_numbers for the master leads (NOT subleads) to use for pattern matching
        // IMPORTANT: Only fetch master leads (master_id IS NULL) to avoid finding subleads of subleads
        const { data: masterLeads, error: masterLeadsError } = await supabase
          .from('leads')
          .select('id, lead_number, master_id')
          .in('id', newLeadIds)
          .is('master_id', null); // Only get master leads, not subleads

        if (masterLeadsError) {
          console.error('❌ Collection Due Report - Error fetching master lead numbers:', masterLeadsError);
        } else if (masterLeads && masterLeads.length > 0) {
          const allNewSubLeadIds = new Set<string | number>();
          const masterLeadNumbers = masterLeads.map(l => l.lead_number).filter(Boolean);
          const masterIds = masterLeads.map(l => l.id).filter(Boolean);

          // Batch query 1: Pattern matching - fetch all subleads with / and filter client-side
          if (masterLeadNumbers.length > 0) {
            const { data: patternSubLeads, error: patternError } = await supabase
              .from('leads')
              .select('id, lead_number, master_id')
              .like('lead_number', '%/%')
              .order('lead_number', { ascending: true })
              .limit(1000); // Limit to prevent huge queries

            if (!patternError && patternSubLeads) {
              // Filter to only include valid subleads that match our master leads
              const masterLeadNumbersSet = new Set(masterLeadNumbers);
              const masterIdsSet = new Set(masterIds.map(String));

              patternSubLeads.forEach(lead => {
                const leadNumberValue = lead.lead_number || '';
                if (!leadNumberValue.includes('/')) return;

                // Check if this sublead belongs to one of our master leads
                const baseNumber = leadNumberValue.split('/')[0];
                if (masterLeadNumbersSet.has(baseNumber)) {
                  allNewSubLeadIds.add(lead.id);
                } else if (lead.master_id) {
                  const masterIdStr = String(lead.master_id).trim();
                  if (masterIdsSet.has(masterIdStr)) {
                    allNewSubLeadIds.add(lead.id);
                  }
                }
              });
            }
          }

          // Batch query 2: Direct master_id matching - build OR conditions for all masters
          if (masterIds.length > 0) {
            const orConditions: string[] = [];
            masterLeads.forEach(lead => {
              const masterId = lead.id;
              const masterLeadNumber = lead.lead_number;
              if (masterId) {
                orConditions.push(`master_id.eq.${masterId}`);
                orConditions.push(`master_id.eq.${String(masterId)}`);
              }
              if (masterLeadNumber) {
                orConditions.push(`master_id.eq.${masterLeadNumber}`);
                const normalizedBase = masterLeadNumber.replace(/^C/, '').replace(/^L/, '');
                orConditions.push(`master_id.eq.${normalizedBase}`);
              }
            });

            if (orConditions.length > 0) {
              // Split into chunks if too many conditions (Supabase has limits)
              const chunkSize = 50; // Conservative limit
              for (let i = 0; i < orConditions.length; i += chunkSize) {
                const chunk = orConditions.slice(i, i + chunkSize);
                const { data: masterIdSubLeads, error: masterIdError } = await supabase
                  .from('leads')
                  .select('id, master_id')
                  .or(chunk.join(','))
                  .not('master_id', 'is', null);

                if (!masterIdError && masterIdSubLeads) {
                  masterIdSubLeads.forEach(sl => {
                    if (sl.id) allNewSubLeadIds.add(sl.id);
                  });
                }
              }
            }
          }

          if (allNewSubLeadIds.size > 0) {
            const newSubLeadIds = Array.from(allNewSubLeadIds);
            console.log('✅ Collection Due Report - Found new subleads:', newSubLeadIds.length);

            // Fetch payment plans for new subleads
            let newSubPaymentsQuery = supabase
              .from('payment_plans')
              .select(`
                id,
                lead_id,
                value,
                value_vat,
                currency,
                due_date,
                cancel_date,
                ready_to_pay,
                ready_to_pay_by,
                paid,
                payment_order
              `)
              .eq('ready_to_pay', true)
              .not('due_date', 'is', null)
              .is('cancel_date', null)
              .in('lead_id', newSubLeadIds);

            if (filters.fromDate) {
              const fromDateTime = `${filters.fromDate}T00:00:00`;
              newSubPaymentsQuery = newSubPaymentsQuery.gte('due_date', fromDateTime);
            }
            if (filters.toDate) {
              const toDateTime = `${filters.toDate}T23:59:59`;
              newSubPaymentsQuery = newSubPaymentsQuery.lte('due_date', toDateTime);
            }

            const { data: newSubPayments, error: newSubPaymentsError } = await newSubPaymentsQuery;
            if (newSubPaymentsError) {
              console.error('❌ Collection Due Report - Error fetching new sublead payments:', newSubPaymentsError);
            } else if (newSubPayments && newSubPayments.length > 0) {
              console.log('✅ Collection Due Report - Found new sublead payments:', newSubPayments.length);
              // Add sublead payments to the main payments array
              const updatedNewPayments = [...(newPayments || []), ...newSubPayments];
              newPayments = updatedNewPayments;
              // Add sublead IDs to the lead IDs array
              newLeadIds = Array.from(new Set([...newLeadIds, ...newSubLeadIds]));
            }
          }
        }
      }

      // Fetch subleads for legacy leads (optimized - batch queries instead of loops)
      console.log('🔍 Collection Due Report - Fetching subleads for legacy leads...');
      if (legacyLeadIds.length > 0) {
        const numericLegacyLeadIds = legacyLeadIds.map(id => typeof id === 'string' ? parseInt(id, 10) : id).filter(id => !Number.isNaN(id));
        const allLegacySubLeadIds = new Set<number>();

        if (numericLegacyLeadIds.length > 0) {
          // Build OR condition for all master IDs and their normalized variations
          const orConditions: string[] = [];
          numericLegacyLeadIds.forEach(masterId => {
            const masterIdStr = String(masterId);
            const normalizedId = masterIdStr.replace(/^C/, '');
            orConditions.push(`master_id.eq.${masterIdStr}`);
            if (normalizedId !== masterIdStr) {
              orConditions.push(`master_id.eq.${normalizedId}`);
            }
          });

          // Split into chunks if too many conditions (Supabase has limits)
          const chunkSize = 50; // Conservative limit
          for (let i = 0; i < orConditions.length; i += chunkSize) {
            const chunk = orConditions.slice(i, i + chunkSize);
            const { data: legacySubLeads, error: legacySubLeadsError } = await supabase
              .from('leads_lead')
              .select('id, master_id, manual_id')
              .or(chunk.join(','))
              .not('master_id', 'is', null)
              .order('id', { ascending: true });

            if (legacySubLeadsError) {
              console.error('❌ Collection Due Report - Error fetching legacy subleads:', legacySubLeadsError);
            } else if (legacySubLeads && legacySubLeads.length > 0) {
              // Filter to only include valid subleads
              const validLegacySubLeads = legacySubLeads.filter(lead => {
                const hasMasterId = lead.master_id && String(lead.master_id).trim() !== '';
                const hasManualId = lead.manual_id && String(lead.manual_id).trim() !== '';
                return hasMasterId || hasManualId;
              });

              validLegacySubLeads.forEach(sl => {
                if (sl.id) allLegacySubLeadIds.add(Number(sl.id));
              });
            }
          }
        }

        if (allLegacySubLeadIds.size > 0) {
          const legacySubLeadIds = Array.from(allLegacySubLeadIds);
          console.log('✅ Collection Due Report - Found legacy subleads:', legacySubLeadIds.length);

          // Fetch payment plans for legacy subleads
          let legacySubPaymentsQuery = supabase
            .from('finances_paymentplanrow')
            .select(`
              id,
              lead_id,
              value,
              value_base,
              vat_value,
              currency_id,
              due_date,
              date,
              cancel_date,
              ready_to_pay,
              actual_date,
              due_by_id,
              order,
              accounting_currencies!finances_paymentplanrow_currency_id_fkey(name, iso_code)
            `)
            .not('due_date', 'is', null)
            .is('cancel_date', null)
            .in('lead_id', legacySubLeadIds);

          if (filters.fromDate) {
            const fromDateTime = `${filters.fromDate}T00:00:00`;
            legacySubPaymentsQuery = legacySubPaymentsQuery.gte('due_date', fromDateTime);
          }
          if (filters.toDate) {
            const toDateTime = `${filters.toDate}T23:59:59`;
            legacySubPaymentsQuery = legacySubPaymentsQuery.lte('due_date', toDateTime);
          }

          const { data: legacySubPayments, error: legacySubPaymentsError } = await legacySubPaymentsQuery;
          if (legacySubPaymentsError) {
            console.error('❌ Collection Due Report - Error fetching legacy sublead payments:', legacySubPaymentsError);
          } else if (legacySubPayments && legacySubPayments.length > 0) {
            console.log('✅ Collection Due Report - Found legacy sublead payments:', legacySubPayments.length);
            // Add sublead payments to the main payments array
            filteredLegacyPayments.push(...legacySubPayments);
            // Add sublead IDs to the lead IDs array
            legacyLeadIds = Array.from(new Set([...legacyLeadIds, ...legacySubLeadIds]));
          }
        }
      }

      // Debug: Log total legacy payments count after sublead addition
      console.log('📊 Collection Due Report - Total legacy payments (main + sublead):', {
        main: (legacyPayments || []).length,
        sublead: filteredLegacyPayments.length - (legacyPayments || []).length,
        total: filteredLegacyPayments.length,
        dateRange: filters.fromDate && filters.toDate ? `${filters.fromDate} to ${filters.toDate}` : 'no date filter'
      });

      // Fetch lead metadata
      let newLeadsMap = new Map();
      if (newLeadIds.length > 0) {
        console.log('🔍 Collection Due Report - Fetching new leads metadata...');
        const { data: newLeads, error: newLeadsError } = await supabase
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
                name,
                department_id,
                tenant_departement!department_id(
                  id,
                  name
                )
              )
            )
          `)
          .in('id', newLeadIds);

        if (newLeadsError) {
          console.error('❌ Collection Due Report - Error fetching new leads:', newLeadsError);
        } else {
          console.log('✅ Collection Due Report - Fetched new leads:', newLeads?.length || 0);
          if (newLeads) {
            newLeads.forEach(lead => {
              newLeadsMap.set(lead.id, lead);
            });
          }
        }
      }

      let legacyLeadsMap = new Map();
      if (legacyLeadIds.length > 0) {
        console.log('🔍 Collection Due Report - Fetching legacy leads metadata...');
        const { data: legacyLeads, error: legacyLeadsError } = await supabase
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
                name,
                department_id,
                tenant_departement!department_id(
                  id,
                  name
                )
              )
            )
          `)
          .in('id', legacyLeadIds);

        if (legacyLeadsError) {
          console.error('❌ Collection Due Report - Error fetching legacy leads:', legacyLeadsError);
        } else {
          console.log('✅ Collection Due Report - Fetched legacy leads:', legacyLeads?.length || 0);
          console.log('🔍 DEBUG Employee 14 - Fetched legacy leads:', legacyLeads?.length || 0);
          console.log('🔍 DEBUG Employee 14 - Legacy leads with case_handler_id 14:', legacyLeads?.filter((l: any) => Number(l.case_handler_id) === 14).map((l: any) => ({ id: l.id, case_handler_id: l.case_handler_id })));
          if (legacyLeads) {
            legacyLeads.forEach(lead => {
              // Store with string key to match payment.lead_id (which might be string or number)
              const key = lead.id?.toString() || String(lead.id);
              legacyLeadsMap.set(key, lead);
              // Also store with number key for compatibility
              if (typeof lead.id === 'number') {
                legacyLeadsMap.set(lead.id, lead);
              }
            });
            console.log('📊 Collection Due Report - Legacy leads map keys:', Array.from(legacyLeadsMap.keys()));
            console.log('🔍 DEBUG Employee 14 - Is lead 163739 in legacyLeadsMap?', legacyLeadsMap.has('163739') || legacyLeadsMap.has(163739));
          }
        }
      }

      // Fetch applicants count for new leads
      console.log('🔍 Collection Due Report - Fetching applicants for new leads...');
      const applicantsCountMap = new Map<string, number>();
      if (newLeadIds.length > 0) {
        const { data: contacts, error: contactsError } = await supabase
          .from('contacts')
          .select('lead_id')
          .in('lead_id', newLeadIds)
          .eq('is_persecuted', false);

        if (contactsError) {
          console.error('❌ Collection Due Report - Error fetching contacts:', contactsError);
        } else {
          console.log('✅ Collection Due Report - Fetched contacts:', contacts?.length || 0);
          if (contacts) {
            contacts.forEach(contact => {
              const count = applicantsCountMap.get(contact.lead_id) || 0;
              applicantsCountMap.set(contact.lead_id, count + 1);
            });
          }
        }
      }

      // Fetch applicants count for legacy leads
      console.log('🔍 Collection Due Report - Fetching applicants for legacy leads...');
      const legacyApplicantsCountMap = new Map<string, number>();
      if (legacyLeadIds.length > 0) {
        const { data: legacyLeadsForApplicants, error: legacyApplicantsError } = await supabase
          .from('leads_lead')
          .select('id, no_of_applicants')
          .in('id', legacyLeadIds);

        if (legacyApplicantsError) {
          console.error('❌ Collection Due Report - Error fetching legacy applicants:', legacyApplicantsError);
        } else {
          console.log('✅ Collection Due Report - Fetched legacy leads for applicants:', legacyLeadsForApplicants?.length || 0);
          if (legacyLeadsForApplicants) {
            legacyLeadsForApplicants.forEach(lead => {
              // Handle bigint null values - convert to number, default to 0 if null
              const applicantsCount = lead.no_of_applicants !== null && lead.no_of_applicants !== undefined
                ? Number(lead.no_of_applicants)
                : 0;
              legacyApplicantsCountMap.set(lead.id.toString(), applicantsCount);
            });
          }
        }
      }

      // Fetch handler names for all handler IDs (like CollectionFinancesReport does)
      const normalizeHandlerId = (value: any): number | null => {
        if (value === null || value === undefined) return null;
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : null;
      };

      // Collect handler names from new leads and handler IDs from legacy leads
      const allHandlerNames = new Set<string>(); // For new leads - handler is text field
      const allHandlerIds: number[] = []; // For legacy leads - case_handler_id or due_by_id is numeric

      if (filters.employeeType === 'case_handler') {
        // Case Handler: Collect ready_to_pay_by from new payments and due_by_id from legacy payments (who clicked "sent to finance")
        // Collect ready_to_pay_by from new payments
        console.log('🔍 Collection Due Report - Collecting ready_to_pay_by from new payments (Case Handler - who clicked sent to finance)...');
        (newPayments || []).forEach((payment: any) => {
          const handlerId = normalizeHandlerId(payment.ready_to_pay_by);
          if (handlerId !== null) {
            allHandlerIds.push(handlerId);
            if (handlerId === 14) {
              console.log('✅ DEBUG Employee 14 - Added handler ID 14 from new payment ready_to_pay_by:', {
                paymentId: payment.id,
                leadId: payment.lead_id,
                ready_to_pay_by: payment.ready_to_pay_by
              });
            }
            console.log('✅ Added ready_to_pay_by:', handlerId);
          }
        });

        // Collect due_by_id from legacy payments
        console.log('🔍 Collection Due Report - Collecting due_by_id from legacy payments (Case Handler - who clicked sent to finance)...');
        filteredLegacyPayments.forEach((payment: any) => {
          const handlerId = normalizeHandlerId(payment.due_by_id);
          if (handlerId !== null) {
            allHandlerIds.push(handlerId);
            if (handlerId === 14) {
              console.log('✅ DEBUG Employee 14 - Added handler ID 14 from legacy payment due_by_id:', {
                paymentId: payment.id,
                leadId: payment.lead_id,
                due_by_id: payment.due_by_id
              });
            }
            console.log('✅ Added due_by_id:', handlerId);
          }
        });
      } else {
        // Actual Employee Due: Collect handler names/IDs from leads (actual handler saved in leads)
        // Collect handler names from new leads
        if (newLeadsMap.size > 0) {
          console.log('🔍 Collection Due Report - Collecting handler names from new leads (Actual Employee Due - actual handler saved in lead)...');
          newLeadsMap.forEach((lead, leadId) => {
            console.log('📊 New lead handler info:', {
              leadId,
              handler: lead.handler,
              case_handler_id: lead.case_handler_id
            });
            // For new leads, use the handler text field (display_name)
            if (lead.handler && typeof lead.handler === 'string' && lead.handler.trim() && lead.handler !== '---' && lead.handler.toLowerCase() !== 'not assigned') {
              allHandlerNames.add(lead.handler.trim());
              console.log('✅ Added handler name:', lead.handler.trim());
            } else if (lead.case_handler_id) {
              // Fallback to case_handler_id if handler text is not available
              const handlerId = normalizeHandlerId(lead.case_handler_id);
              if (handlerId !== null) {
                allHandlerIds.push(handlerId);
                if (handlerId === 14) {
                  console.log('✅ DEBUG Employee 14 - Added handler ID 14 from new lead case_handler_id:', leadId);
                }
                console.log('✅ Added case_handler_id:', handlerId);
              }
            }
          });
        }

        // Collect case_handler_id from legacy leads
        if (legacyLeadsMap.size > 0) {
          console.log('🔍 Collection Due Report - Collecting handler IDs from legacy leads (Actual Employee Due - actual handler saved in lead)...');
          legacyLeadsMap.forEach((lead: any, leadId: any) => {
            console.log('📊 Legacy lead handler info:', {
              leadId,
              case_handler_id: lead?.case_handler_id,
              case_handler_id_type: typeof lead.case_handler_id
            });
            const handlerId = normalizeHandlerId(lead.case_handler_id);
            if (handlerId !== null) {
              allHandlerIds.push(handlerId);
              if (handlerId === 14) {
                console.log('✅ DEBUG Employee 14 - Added handler ID 14 from legacy lead:', leadId);
              }
              console.log('✅ Added handler ID:', handlerId);
            } else {
              console.log('⚠️ Handler ID is null for lead:', leadId);
            }
          });
        }
      }
      console.log('📊 Collection Due Report - All collected handler names (new):', Array.from(allHandlerNames));
      console.log('📊 Collection Due Report - All collected handler IDs (legacy):', allHandlerIds);
      console.log('🔍 DEBUG Employee 14 - Employee 14 in allHandlerIds?', allHandlerIds.includes(14));

      // Fetch handler information:
      // 1. For new leads (Actual Employee Due mode): fetch employees by display_name (handler text field) to get their IDs
      // 2. For new leads (Case Handler mode): ready_to_pay_by IDs are collected into allHandlerIds
      // 3. For legacy leads: fetch employees by ID (case_handler_id for Actual Employee Due, or due_by_id for Case Handler) to get their display_name
      const handlerMap = new Map<number, string>(); // ID -> display_name
      const handlerNameToIdMap = new Map<string, number>(); // display_name -> ID (for new leads in case_handler mode)

      console.log('🔍 DEBUG Employee 14 - All collected handler names (new):', Array.from(allHandlerNames));
      console.log('🔍 DEBUG Employee 14 - All collected handler IDs (legacy):', allHandlerIds);
      console.log('🔍 DEBUG Employee 14 - Employee 14 in handler IDs?', allHandlerIds.includes(14));

      // Fetch employees by display_name for new leads
      if (allHandlerNames.size > 0) {
        const handlerNamesArray = Array.from(allHandlerNames);
        console.log('🔍 Collection Due Report - Fetching employees by display_name for new leads:', handlerNamesArray);
        const { data: handlerDataByName, error: handlerErrorByName } = await supabase
          .from('tenants_employee')
          .select('id, display_name')
          .in('display_name', handlerNamesArray);

        if (handlerErrorByName) {
          console.error('❌ Collection Due Report - Error fetching handlers by name:', handlerErrorByName);
        } else {
          console.log('📊 Collection Due Report - Handler data by name received:', handlerDataByName?.map(emp => ({ id: emp.id, display_name: emp.display_name })));
          handlerDataByName?.forEach(emp => {
            const empId = Number(emp.id);
            const displayName = emp.display_name?.trim();
            if (!Number.isNaN(empId) && displayName) {
              handlerMap.set(empId, displayName);
              handlerNameToIdMap.set(displayName, empId);
            }
          });
        }
      }

      // Fetch employees by ID (includes legacy case_handler_id/due_by_id and new ready_to_pay_by when in actual_employee_due mode)
      const uniqueHandlerIds = Array.from(new Set(allHandlerIds));
      if (uniqueHandlerIds.length > 0) {
        console.log('🔍 Collection Due Report - Fetching handler names by ID for', uniqueHandlerIds.length, 'handlers:', uniqueHandlerIds);
        const { data: handlerData, error: handlerError } = await supabase
          .from('tenants_employee')
          .select('id, display_name')
          .in('id', uniqueHandlerIds);

        if (handlerError) {
          console.error('❌ Collection Due Report - Error fetching handlers by ID:', handlerError);
        } else {
          console.log('📊 Collection Due Report - Handler data by ID received:', handlerData?.map(emp => ({ id: emp.id, display_name: emp.display_name })));
          console.log('🔍 DEBUG Employee 14 - Employee 14 in handlerData?', handlerData?.some(emp => Number(emp.id) === 14));
          handlerData?.forEach(emp => {
            const empId = Number(emp.id);
            if (!Number.isNaN(empId)) {
              const displayName = emp.display_name?.trim() || `Employee #${emp.id}`;
              handlerMap.set(empId, displayName);
              if (empId === 14) {
                console.log('✅ DEBUG Employee 14 - Added to handlerMap:', { id: empId, displayName });
              }
            }
          });
        }
      }

      console.log('✅ Collection Due Report - Handler map created:', Array.from(handlerMap.entries()).map(([id, name]) => ({ id, name })));
      console.log('✅ Collection Due Report - Handler name to ID map:', Array.from(handlerNameToIdMap.entries()));

      // Process payment data
      type PaymentEntry = {
        id?: string | number; // Payment row ID - critical for matching drawer display
        leadId: string;
        leadType: 'new' | 'legacy';
        amount: number; // Total with VAT
        value: number; // Value without VAT
        currency: string; // Currency code
        handlerId: number | null;
        handlerName: string;
        departmentId: string | null;
        departmentName: string;
        orderCode: string; // Store normalized order code for filtering
        mainCategoryId: string | number | null; // Store main category ID for filtering
        dueDate?: string | null; // Store due_date for date filtering
      };

      const payments: PaymentEntry[] = [];
      const missingHandlerIds = new Set<number>();

      console.log('🔍 Collection Due Report - Processing new payments...');
      // Process new payments
      (newPayments || []).forEach(payment => {
        const lead = newLeadsMap.get(payment.lead_id);
        if (!lead) return;

        // Get handler based on filter selection
        // Case Handler (case_handler): Use ready_to_pay_by from payment_plans table (who clicked "sent to finance")
        // Actual Employee Due (actual_employee_due): Use handler from lead (actual handler saved in lead)
        let handlerId: number | null = null;
        let handlerName = '—';

        if (filters.employeeType === 'case_handler') {
          // Case Handler: Use ready_to_pay_by from payment_plans table (who clicked "sent to finance")
          handlerId = normalizeHandlerId(payment.ready_to_pay_by);
          if (handlerId === 14) {
            console.log('🔍 DEBUG Employee 14 - Found handlerId 14 in new payment ready_to_pay_by:', {
              paymentId: payment.id,
              leadId: payment.lead_id,
              ready_to_pay_by: payment.ready_to_pay_by
            });
          }
          if (handlerId !== null) {
            handlerName = handlerMap.get(handlerId) || '—';
            if (handlerId === 14) {
              console.log('🔍 DEBUG Employee 14 - Handler name from map:', handlerName);
            }
          }
        } else {
          // Actual Employee Due (actual_employee_due): Use handler from lead (actual handler saved in lead)
          // For new leads, handler is stored as text (display_name) in the 'handler' column
          if (lead.handler && typeof lead.handler === 'string' && lead.handler.trim() && lead.handler !== '---' && lead.handler.toLowerCase() !== 'not assigned') {
            const handlerNameFromLead = lead.handler.trim();
            // Look up the employee ID by display_name
            handlerId = handlerNameToIdMap.get(handlerNameFromLead) || null;
            if (handlerId === 14) {
              console.log('🔍 DEBUG Employee 14 - Found handlerId 14 in handlerNameToIdMap for:', handlerNameFromLead);
            }
            if (handlerId !== null) {
              handlerName = handlerMap.get(handlerId) || handlerNameFromLead;
            } else {
              // Handler name not found in map, use the name directly
              handlerName = handlerNameFromLead;
            }
          } else if (lead.case_handler_id) {
            // Fallback to case_handler_id if handler text is not available
            handlerId = normalizeHandlerId(lead.case_handler_id);
            if (handlerId === 14) {
              console.log('🔍 DEBUG Employee 14 - Found handlerId 14 in new lead case_handler_id:', {
                leadId: payment.lead_id,
                case_handler_id: lead.case_handler_id
              });
            }
            if (handlerId !== null) {
              handlerName = handlerMap.get(handlerId) || '—';
            }
          }
        }

        // Get department from category -> main category -> department
        // Use helper function to handle cases where category is stored as text instead of ID
        const { departmentId, departmentName } = resolveCategoryAndDepartment(
          lead.category, // category text field
          lead.category_id, // category ID
          lead.misc_category // joined misc_category data
        );

        // Extract main category ID for filtering
        let mainCategoryId: string | number | null = null;
        if (lead.misc_category) {
          const categoryRecord = Array.isArray(lead.misc_category) ? lead.misc_category[0] : lead.misc_category;
          if (categoryRecord?.misc_maincategory) {
            const mainCategory = Array.isArray(categoryRecord.misc_maincategory)
              ? categoryRecord.misc_maincategory[0]
              : categoryRecord.misc_maincategory;
            mainCategoryId = mainCategory?.id || null;
          } else if (categoryRecord?.parent_id) {
            // Fallback: use parent_id if misc_maincategory join is not available
            mainCategoryId = categoryRecord.parent_id;
          }
        }

        const value = Number(payment.value || 0);
        let vat = Number(payment.value_vat || 0);
        if (!vat && (payment.currency || '₪') === '₪') {
          vat = Math.round(value * 0.18 * 100) / 100;
        }
        const amount = value + vat;
        const orderCode = normalizeOrderCode(payment.payment_order);
        const currency = payment.currency || '₪';

        payments.push({
          id: payment.id, // Store payment row ID - critical for matching drawer display
          leadId: payment.lead_id,
          leadType: 'new',
          amount,
          value, // Store value without VAT
          currency,
          handlerId,
          handlerName,
          departmentId,
          departmentName,
          orderCode,
          mainCategoryId,
          dueDate: payment.due_date || null, // Store due_date for date filtering
        });
      });

      console.log('🔍 Collection Due Report - Processing legacy payments...');

      // First, identify any missing leads that we need to fetch
      const missingLeadIds = new Set<number>();
      filteredLegacyPayments.forEach(payment => {
        const leadIdKey = payment.lead_id?.toString() || String(payment.lead_id);
        const leadIdNum = typeof payment.lead_id === 'number' ? payment.lead_id : Number(payment.lead_id);
        const lead = legacyLeadsMap.get(leadIdKey) || legacyLeadsMap.get(leadIdNum);

        if (!lead && !Number.isNaN(leadIdNum)) {
          missingLeadIds.add(leadIdNum);
        }
      });

      // Fetch missing leads if any
      if (missingLeadIds.size > 0) {
        const missingIdsArray = Array.from(missingLeadIds);
        console.log('🔍 Collection Due Report - Fetching', missingIdsArray.length, 'missing legacy leads:', missingIdsArray);

        // Try fetching with .in() first
        let { data: missingLeads, error: missingLeadsError } = await supabase
          .from('leads_lead')
          .select(`
            id,
            case_handler_id,
            category_id,
            misc_category!category_id(
              id,
              name,
              parent_id,
              misc_maincategory!parent_id(
                id,
                name,
                department_id,
                tenant_departement!department_id(
                  id,
                  name
                )
              )
            )
          `)
          .in('id', missingIdsArray);

        // If no results, try individual queries as a fallback (in case of RLS issues or data inconsistencies)
        if ((!missingLeads || missingLeads.length === 0) && missingIdsArray.length <= 10) {
          console.log('🔍 Collection Due Report - No results with .in(), trying individual queries for:', missingIdsArray);
          const individualResults: any[] = [];
          for (const leadId of missingIdsArray) {
            const { data: singleLead, error: singleError } = await supabase
              .from('leads_lead')
              .select(`
                id,
                case_handler_id,
                category_id,
                misc_category!category_id(
                  id,
                  name,
                  parent_id,
                  misc_maincategory!parent_id(
                    id,
                    name,
                    department_id,
                    tenant_departement!department_id(
                      id,
                      name
                    )
                  )
                )
              `)
              .eq('id', leadId)
              .maybeSingle();

            if (singleError) {
              console.error(`❌ Collection Due Report - Error fetching individual lead ${leadId}:`, singleError);
            } else if (singleLead) {
              individualResults.push(singleLead);
              console.log(`✅ Collection Due Report - Found individual lead ${leadId} with case_handler_id:`, singleLead.case_handler_id);
              if (Number(singleLead.case_handler_id) === 14) {
                console.log('✅ DEBUG Employee 14 - Found lead with case_handler_id 14:', leadId);
              }
            } else {
              console.warn(`⚠️ Collection Due Report - Lead ${leadId} not found (does not exist or RLS blocking)`);
            }
          }

          if (individualResults.length > 0) {
            missingLeads = individualResults;
            missingLeadsError = null;
            console.log(`✅ Collection Due Report - Found ${individualResults.length} leads via individual queries`);
          }
        }

        if (missingLeadsError) {
          console.error('❌ Collection Due Report - Error fetching missing legacy leads:', missingLeadsError);
        } else {
          console.log('✅ Collection Due Report - Fetched', missingLeads?.length || 0, 'missing legacy leads');

          // If we didn't find the leads, try a direct query without RLS to see if they exist
          if (missingLeads?.length === 0 && missingIdsArray.length > 0) {
            console.warn('⚠️ Collection Due Report - No leads found for IDs:', missingIdsArray);
            console.warn('⚠️ This might be due to RLS policies or the leads not existing. Payments for these leads will be skipped unless employeeType is "case_handler"');
          }

          if (missingLeads) {
            missingLeads.forEach(lead => {
              const key = lead.id?.toString() || String(lead.id);
              legacyLeadsMap.set(key, lead);
              if (typeof lead.id === 'number') {
                legacyLeadsMap.set(lead.id, lead);
              }

              // Also collect handler IDs from newly fetched leads
              if (filters.employeeType === 'case_handler') {
                const handlerId = normalizeHandlerId(lead.case_handler_id);
                if (handlerId !== null && !allHandlerIds.includes(handlerId)) {
                  allHandlerIds.push(handlerId);
                  if (handlerId === 14) {
                    console.log('✅ DEBUG Employee 14 - Added handler ID 14 from newly fetched missing lead:', lead.id);
                  }
                  console.log('✅ Added handler ID from missing lead:', handlerId);
                }
              }
            });
            console.log('🔍 DEBUG Employee 14 - Missing leads with case_handler_id 14:', missingLeads.filter((l: any) => Number(l.case_handler_id) === 14).map((l: any) => ({ id: l.id, case_handler_id: l.case_handler_id })));

            // Re-fetch handler data if we discovered new handler IDs from missing leads
            if (filters.employeeType === 'case_handler') {
              const newHandlerIds = missingLeads
                .map((l: any) => normalizeHandlerId(l.case_handler_id))
                .filter((id): id is number => id !== null && !handlerMap.has(id));

              if (newHandlerIds.length > 0) {
                console.log('🔍 Collection Due Report - Re-fetching handler data for newly discovered handler IDs:', newHandlerIds);
                console.log('🔍 DEBUG Employee 14 - Is employee 14 in newHandlerIds?', newHandlerIds.includes(14));
                const { data: newHandlerData, error: newHandlerError } = await supabase
                  .from('tenants_employee')
                  .select('id, display_name')
                  .in('id', newHandlerIds);

                if (newHandlerError) {
                  console.error('❌ Collection Due Report - Error re-fetching handlers:', newHandlerError);
                } else {
                  console.log('📊 Collection Due Report - New handler data received:', newHandlerData?.map(emp => ({ id: emp.id, display_name: emp.display_name })));
                  newHandlerData?.forEach(emp => {
                    const empId = Number(emp.id);
                    if (!Number.isNaN(empId)) {
                      const displayName = emp.display_name?.trim() || `Employee #${emp.id}`;
                      handlerMap.set(empId, displayName);
                      if (empId === 14) {
                        console.log('✅ DEBUG Employee 14 - Added to handlerMap after re-fetch:', { id: empId, displayName });
                      }
                    }
                  });
                }
              }
            }
          }
        }
      }

      // After fetching missing leads, we need to fetch their handler names if we haven't already
      // This will be handled by the existing handler fetching logic below, but we need to ensure
      // allHandlerIds includes the handler IDs from missing leads

      // Process legacy payments - use due_date if available, otherwise use date (like CollectionFinancesReport)
      filteredLegacyPayments.forEach(payment => {
        // Try both string and number keys for lead_id lookup
        const leadIdKey = payment.lead_id?.toString() || String(payment.lead_id);
        const leadIdNum = typeof payment.lead_id === 'number' ? payment.lead_id : Number(payment.lead_id);
        let lead = legacyLeadsMap.get(leadIdKey) || legacyLeadsMap.get(leadIdNum);

        // DEBUG: Check specifically for lead 183061
        const isLead183061 = leadIdNum === 183061 || leadIdKey === '183061';
        if (isLead183061) {
          console.log('🔍 DEBUG Lead 183061 - Processing payment:', {
            paymentId: payment.id,
            lead_id: payment.lead_id,
            leadIdKey,
            leadIdNum,
            leadFound: !!lead,
            employeeType: filters.employeeType,
            due_by_id: payment.due_by_id,
            case_handler_id: lead?.case_handler_id
          });
        }

        // Get handler based on filter selection
        // Case Handler (case_handler): Use due_by_id from finances_paymentplanrow table (who clicked "sent to finance")
        // Actual Employee Due (actual_employee_due): Use case_handler_id from lead (actual handler saved in lead)
        let handlerId: number | null = null;
        let handlerName = '—';

        if (filters.employeeType === 'case_handler') {
          // Case Handler: Use due_by_id from finances_paymentplanrow table (who clicked "sent to finance")
          handlerId = normalizeHandlerId(payment.due_by_id);
          if (handlerId === 14 || payment.due_by_id === 14) {
            console.log('🔍 DEBUG Employee 14 - Found handlerId 14 in legacy payment due_by_id:', {
              paymentId: payment.id,
              leadId: payment.lead_id,
              due_by_id: payment.due_by_id,
              normalizedHandlerId: handlerId
            });
          }
          if (isLead183061) {
            console.log('🔍 DEBUG Lead 183061 - Using due_by_id mode (Case Handler - who clicked sent to finance), handlerId:', handlerId);
          }
        } else {
          // Actual Employee Due (actual_employee_due): Use case_handler_id from lead (actual handler saved in lead)
          // If lead doesn't exist, we can't get case_handler_id, so skip this payment
          if (!lead) {
            if (isLead183061) {
              console.error('❌ DEBUG Lead 183061 - PAYMENT SKIPPED: Lead not found in legacyLeadsMap!', {
                payment_lead_id: payment.lead_id,
                payment_lead_id_type: typeof payment.lead_id,
                leadIdKey,
                leadIdNum,
                available_keys_sample: Array.from(legacyLeadsMap.keys()).slice(0, 10),
                note: 'Skipping payment because we need case_handler_id from lead and lead cannot be fetched'
              });
            }
            console.warn('⚠️ Collection Due Report - Legacy lead not found for payment (cannot get case_handler_id):', {
              payment_lead_id: payment.lead_id,
              payment_lead_id_type: typeof payment.lead_id,
              leadIdKey,
              leadIdNum,
              available_keys: Array.from(legacyLeadsMap.keys()).slice(0, 5),
              note: 'Skipping payment because we need case_handler_id from lead and lead cannot be fetched'
            });
            return;
          }
          handlerId = normalizeHandlerId(lead.case_handler_id);
          if (handlerId === 14 || lead.case_handler_id === 14) {
            console.log('🔍 DEBUG Employee 14 - Found handlerId 14 in legacy lead case_handler_id:', {
              leadId: payment.lead_id,
              case_handler_id: lead?.case_handler_id,
              normalizedHandlerId: handlerId
            });
          }
          if (isLead183061) {
            console.log('🔍 DEBUG Lead 183061 - Using case_handler_id mode (Actual Employee Due - actual handler saved in lead), handlerId:', handlerId, 'from case_handler_id:', lead.case_handler_id);
          }
        }

        // Note: handlerId can be null if no handler is assigned - we still want to process the payment
        // with handlerName set to '—' to show unassigned payments

        if (handlerId !== null) {
          handlerName = handlerMap.get(handlerId) || '—';
          if (handlerId === 14) {
            console.log('🔍 DEBUG Employee 14 - Handler name from map:', handlerName);
          }
          if (handlerName === '—') {
            // Track missing handler IDs to fetch them
            missingHandlerIds.add(handlerId);
            if (handlerId === 14) {
              console.warn('⚠️ DEBUG Employee 14 - Employee 14 handler not found in map, added to missingHandlerIds');
            }
            console.warn('⚠️ Collection Due Report - Legacy lead handler not found in map, will fetch:', {
              handlerId,
              handlerIdType: typeof handlerId,
              employeeType: filters.employeeType,
              case_handler_id: lead?.case_handler_id,
              due_by_id: payment.due_by_id,
              mapKeys: Array.from(handlerMap.keys()),
              leadId: payment.lead_id
            });
          }
        }

        // Skip payment if lead is not found - we need lead data for category/department resolution
        if (!lead) {
          console.warn('⚠️ Collection Due Report - Legacy lead not found for payment (cannot get category/department):', {
            payment_lead_id: payment.lead_id,
            payment_lead_id_type: typeof payment.lead_id,
            leadIdKey,
            leadIdNum,
            available_keys: Array.from(legacyLeadsMap.keys()).slice(0, 5),
            note: 'Skipping payment because we need lead data for category/department resolution'
          });
          return;
        }

        // Get department from category -> main category -> department
        // Use helper function to handle cases where category is stored as text instead of ID
        const { departmentId, departmentName } = resolveCategoryAndDepartment(
          lead.category, // category text field (for legacy leads)
          lead.category_id, // category ID
          lead.misc_category // joined misc_category data
        );

        // Extract main category ID for filtering
        let mainCategoryId: string | number | null = null;
        if (lead.misc_category) {
          const categoryRecord = Array.isArray(lead.misc_category) ? lead.misc_category[0] : lead.misc_category;
          if (categoryRecord?.misc_maincategory) {
            const mainCategory = Array.isArray(categoryRecord.misc_maincategory)
              ? categoryRecord.misc_maincategory[0]
              : categoryRecord.misc_maincategory;
            mainCategoryId = mainCategory?.id || null;
          } else if (categoryRecord?.parent_id) {
            // Fallback: use parent_id if misc_maincategory join is not available
            mainCategoryId = categoryRecord.parent_id;
          }
        }

        // Use value for legacy payments (value_base may be null/0, value contains the actual amount)
        const value = Number(payment.value || payment.value_base || 0);
        let vat = Number(payment.vat_value || 0);

        // Get currency from accounting_currencies relation (joined via currency_id)
        const accountingCurrency: any = payment.accounting_currencies
          ? (Array.isArray(payment.accounting_currencies) ? payment.accounting_currencies[0] : payment.accounting_currencies)
          : null;

        // Map currency_id to currency symbol/name (currency_id 1 = NIS, 2 = EUR, 3 = USD, 4 = GBP)
        let currency = '₪'; // Default to NIS
        if (accountingCurrency?.name) {
          currency = accountingCurrency.name;
        } else if (accountingCurrency?.iso_code) {
          currency = accountingCurrency.iso_code;
        } else if (payment.currency_id) {
          switch (payment.currency_id) {
            case 1: currency = '₪'; break; // NIS
            case 2: currency = '€'; break; // EUR
            case 3: currency = '$'; break; // USD
            case 4: currency = '£'; break; // GBP
            default: currency = '₪'; break;
          }
        }

        // Calculate VAT if not provided and currency is NIS (₪)
        if (!vat && (currency === '₪' || currency === 'ILS')) {
          vat = Math.round(value * 0.18 * 100) / 100;
        }
        const amount = value + vat;
        const orderCode = normalizeOrderCode(payment.order);

        // DEBUG: Check specifically for lead 183061 (reuse variable declared earlier in loop)
        if (isLead183061) {
          console.log('🔍 DEBUG Lead 183061 - Adding payment to payments array:', {
            leadId: `legacy_${payment.lead_id}`,
            amount,
            value,
            currency,
            handlerId,
            handlerName,
            departmentId,
            departmentName,
            mainCategoryId
          });
        }

        payments.push({
          id: payment.id, // Store payment row ID - critical for matching drawer display
          leadId: `legacy_${payment.lead_id}`,
          leadType: 'legacy',
          amount,
          value, // Store value without VAT
          currency,
          handlerId,
          handlerName,
          departmentId,
          departmentName,
          orderCode,
          mainCategoryId,
          dueDate: payment.due_date || null, // Store due_date for date filtering
        });
      });

      // DEBUG: Final check for lead 183061 in payments array
      const finalPayments183061 = payments.filter(p => p.leadId?.includes('183061'));
      console.log('🔍 DEBUG Lead 183061 - Final payments in array:', finalPayments183061.length, finalPayments183061.map(p => ({
        leadId: p.leadId,
        handlerId: p.handlerId,
        handlerName: p.handlerName,
        amount: p.amount,
        value: p.value
      })));

      // After processing all payments, check if we found any new handler IDs that weren't in our initial collection
      // This can happen if we fetched missing leads that had different handler IDs
      const handlerIdsFromPayments = new Set(payments.map(p => p.handlerId).filter((id): id is number => id !== null));
      const missingHandlerIdsFromPayments = Array.from(handlerIdsFromPayments).filter(id => !allHandlerIds.includes(id));

      if (missingHandlerIdsFromPayments.length > 0) {
        console.log('🔍 Collection Due Report - Found handler IDs in payments that were not in initial collection:', missingHandlerIdsFromPayments);
        console.log('🔍 DEBUG Employee 14 - Is employee 14 in missingHandlerIdsFromPayments?', missingHandlerIdsFromPayments.includes(14));
        // Add these to allHandlerIds so they get fetched
        missingHandlerIdsFromPayments.forEach(id => allHandlerIds.push(id));
      }

      console.log('✅ Collection Due Report - Total payments processed:', payments.length);

      // Log all handler IDs in payments
      const handlerIdsInPayments = payments.map(p => p.handlerId).filter(Boolean);
      console.log('📊 Collection Due Report - Handler IDs in payments:', handlerIdsInPayments);
      console.log('🔍 DEBUG Employee 14 - Employee 14 in payments handlerIds?', handlerIdsInPayments.includes(14));
      const paymentsWith14All = payments.filter(p => p.handlerId === 14);
      console.log('🔍 DEBUG Employee 14 - All payments with handlerId 14:', paymentsWith14All.length, paymentsWith14All);
      console.log('📊 Collection Due Report - Payment entries:', payments.map(p => ({ handlerId: p.handlerId, handlerName: p.handlerName, leadId: p.leadId })));

      // Fetch any missing handler IDs that appeared in payments but weren't in our initial map
      if (missingHandlerIds.size > 0) {
        const missingIdsArray = Array.from(missingHandlerIds);
        console.log('🔍 Collection Due Report - Fetching', missingIdsArray.length, 'missing handler IDs:', missingIdsArray);
        const { data: missingHandlerData, error: missingHandlerError } = await supabase
          .from('tenants_employee')
          .select('id, display_name')
          .in('id', missingIdsArray);

        if (!missingHandlerError && missingHandlerData) {
          missingHandlerData.forEach(emp => {
            const empId = Number(emp.id);
            if (!Number.isNaN(empId)) {
              const displayName = emp.display_name?.trim() || `Employee #${emp.id}`;
              handlerMap.set(empId, displayName);
              console.log('✅ Collection Due Report - Added missing handler to map:', { id: empId, name: displayName });
            }
          });

          // Update handler names in payments array for missing handlers
          payments.forEach(payment => {
            if (payment.handlerId !== null && missingHandlerIds.has(payment.handlerId) && payment.handlerName === '—') {
              payment.handlerName = handlerMap.get(payment.handlerId) || '—';
              if (payment.handlerId === 14) {
                console.log('✅ DEBUG Employee 14 - Updated payment handler name after fetching missing:', { handlerId: payment.handlerId, handlerName: payment.handlerName });
              }
              console.log('✅ Collection Due Report - Updated payment handler name:', { handlerId: payment.handlerId, handlerName: payment.handlerName });
            }
          });
        }
      }

      // Filter payments by order and category if filters are selected
      let filteredPayments = payments;

      // Apply order filter (multi-select)
      if (filters.order && Array.isArray(filters.order) && filters.order.length > 0) {
        filteredPayments = filteredPayments.filter(payment => {
          // Check if payment's order code is in the selected orders array
          return filters.order.includes(payment.orderCode);
        });
        console.log(`✅ Collection Due Report - Payments filtered by orders [${filters.order.join(', ')}]:`, filteredPayments.length, 'out of', payments.length);
      }

      // Apply category filter (multi-select by main category)
      if (filters.category && Array.isArray(filters.category) && filters.category.length > 0) {
        const beforeCategoryFilter = filteredPayments.length;
        filteredPayments = filteredPayments.filter(payment => {
          // Check if payment's main category ID is in the selected categories array
          return payment.mainCategoryId !== null &&
            payment.mainCategoryId !== undefined &&
            filters.category.includes(String(payment.mainCategoryId));
        });
        console.log(`✅ Collection Due Report - Payments filtered by main categories [${filters.category.join(', ')}]:`, filteredPayments.length, 'out of', beforeCategoryFilter);
      }

      // Apply department filter (multi-select)
      if (filters.department && Array.isArray(filters.department) && filters.department.length > 0) {
        const beforeDepartmentFilter = filteredPayments.length;
        filteredPayments = filteredPayments.filter(payment => {
          // Check if payment's department ID is in the selected departments array
          return payment.departmentId !== null &&
            payment.departmentId !== undefined &&
            filters.department.includes(String(payment.departmentId));
        });
        console.log(`✅ Collection Due Report - Payments filtered by departments [${filters.department.join(', ')}]:`, filteredPayments.length, 'out of', beforeDepartmentFilter);
      }

      if ((!filters.order || (Array.isArray(filters.order) && filters.order.length === 0)) && 
          (!filters.category || (Array.isArray(filters.category) && filters.category.length === 0)) &&
          (!filters.department || (Array.isArray(filters.department) && filters.department.length === 0))) {
        console.log('✅ Collection Due Report - Payments (filtered only by ready_to_pay and due_date):', filteredPayments.length);
      }

      // Create a map of leadId -> payment value and currency for drawer display (from filtered payments)
      const paymentValueMapLocal = new Map<string, { value: number; currency: string }>();
      filteredPayments.forEach(payment => {
        // For legacy leads, the leadId is stored as "legacy_XXX"
        const leadIdKey = payment.leadId;
        const existing = paymentValueMapLocal.get(leadIdKey);
        if (existing) {
          // If multiple payments exist for the same lead, sum them
          paymentValueMapLocal.set(leadIdKey, {
            value: existing.value + payment.value,
            currency: payment.currency // Use the currency from the payment
          });
        } else {
          paymentValueMapLocal.set(leadIdKey, {
            value: payment.value,
            currency: payment.currency
          });
        }
      });
      setPaymentValueMap(paymentValueMapLocal);

      // Group by employee
      // Cases count now represents the actual number of payment rows (not unique leads)
      const employeeMap = new Map<string, { handlerId: number | null; handlerName: string; departmentName: string; cases: number; applicantsLeads: Set<string>; applicants: number; total: number }>();

      // Store payment row IDs per employee - this ensures the count matches exactly what the drawer will show
      const employeePaymentRowIds = new Map<string, Set<string>>();
      // Store payment row values (in NIS) by payment row ID for accurate total calculation
      const paymentRowValues = new Map<string, number>();

      // Debug: Check if any payments have handlerId 14
      const paymentsWith14 = filteredPayments.filter(p => p.handlerId === 14);
      console.log('🔍 DEBUG Employee 14 - Payments with handlerId 14 in filteredPayments:', paymentsWith14.length, paymentsWith14);

      filteredPayments.forEach(payment => {
        if (payment.handlerId === 14) {
          console.log('🔍 DEBUG Employee 14 - Processing payment for employee 14:', {
            leadId: payment.leadId,
            handlerId: payment.handlerId,
            handlerName: payment.handlerName,
            value: payment.value,
            amount: payment.amount
          });
        }

        // For unassigned payments (no handler), combine all together as "Unknown"
        const key = payment.handlerId !== null && payment.handlerId !== undefined
          ? payment.handlerId.toString()
          : 'unknown';

        if (!employeeMap.has(key)) {
          employeeMap.set(key, {
            handlerId: payment.handlerId,
            handlerName: 'Unknown', // Display "Unknown" instead of "—"
            departmentName: '', // Empty department for unknown rows
            cases: 0, // Count of payment rows
            applicantsLeads: new Set(),
            applicants: 0,
            total: 0,
          });
          if (payment.handlerId === 14) {
            console.log('✅ DEBUG Employee 14 - Created new entry in employeeMap:', {
              key,
              handlerId: payment.handlerId,
              handlerName: payment.handlerName,
              departmentName: payment.departmentName
            });
          }
        }
        const entry = employeeMap.get(key)!;

        // IMPORTANT: Only count payment rows that have due_date within the date filter range
        // This ensures the count matches exactly what the drawer will show
        if (!payment.dueDate) {
          return; // Skip payment rows without due_date
        }

        // Verify due_date is within date filter range (if date filters are applied)
        if (filters.fromDate || filters.toDate) {
          const paymentDueDate = new Date(payment.dueDate);

          if (filters.fromDate) {
            const fromDate = new Date(`${filters.fromDate}T00:00:00`);
            if (paymentDueDate < fromDate) {
              return; // Skip payment rows outside date range
            }
          }

          if (filters.toDate) {
            const toDate = new Date(`${filters.toDate}T23:59:59`);
            if (paymentDueDate > toDate) {
              return; // Skip payment rows outside date range
            }
          }
        }

        // Payment row passes all filters - count it and store its ID
        entry.cases++; // Count each payment row

        // Store payment row ID for this employee (to match drawer display)
        if (!employeePaymentRowIds.has(key)) {
          employeePaymentRowIds.set(key, new Set());
        }

        // Convert value to NIS before adding to total
        // Normalize currency: convert symbols to codes for convertToNIS
        let currencyForConversion = payment.currency || 'NIS';
        if (currencyForConversion === '₪') currencyForConversion = 'NIS';
        else if (currencyForConversion === '€') currencyForConversion = 'EUR';
        else if (currencyForConversion === '$') currencyForConversion = 'USD';
        else if (currencyForConversion === '£') currencyForConversion = 'GBP';
        const valueInNIS = convertToNIS(payment.value, currencyForConversion);

        // Store payment row identifier using the actual payment database ID
        if (payment.id) {
          const paymentRowId = payment.leadType === 'new'
            ? `new-${payment.id}`
            : `legacy-${payment.id}`;
          employeePaymentRowIds.get(key)!.add(paymentRowId);
          // Store the value for this payment row ID so we can recalculate totals accurately
          paymentRowValues.set(paymentRowId, valueInNIS);
        }

        entry.total += valueInNIS; // Use value converted to NIS

        if (payment.handlerId === 14) {
          console.log('🔍 DEBUG Employee 14 - Updated entry:', {
            cases: entry.cases,
            total: entry.total,
            handlerName: entry.handlerName
          });
        }

        // Add applicants count only once per lead
        if (!entry.applicantsLeads.has(payment.leadId)) {
          entry.applicantsLeads.add(payment.leadId);
          if (payment.leadType === 'new') {
            const applicants = applicantsCountMap.get(payment.leadId) || 0;
            entry.applicants += applicants;
          } else {
            const legacyId = payment.leadId.replace('legacy_', '');
            const applicants = legacyApplicantsCountMap.get(legacyId) || 0;
            entry.applicants += applicants;
          }
        }
      });

      // Final check: fetch any handler IDs that appear in employee map but have "--" as name
      const missingHandlerIdsFinal = new Set<number>();
      employeeMap.forEach((entry, key) => {
        if (entry.handlerId !== null && entry.handlerName === '—') {
          missingHandlerIdsFinal.add(entry.handlerId);
        }
      });

      if (missingHandlerIdsFinal.size > 0) {
        const missingIdsFinalArray = Array.from(missingHandlerIdsFinal);
        console.log('🔍 Collection Due Report - Found handler IDs with "--" in employee map, fetching:', missingIdsFinalArray);
        const { data: missingHandlerDataFinal, error: missingHandlerErrorFinal } = await supabase
          .from('tenants_employee')
          .select('id, display_name')
          .in('id', missingIdsFinalArray);

        if (!missingHandlerErrorFinal && missingHandlerDataFinal) {
          missingHandlerDataFinal.forEach(emp => {
            const empId = Number(emp.id);
            if (!Number.isNaN(empId)) {
              const displayName = emp.display_name?.trim() || `Employee #${emp.id}`;
              handlerMap.set(empId, displayName);
              // Update the employee map entry
              const key = empId.toString();
              const entry = employeeMap.get(key);
              if (entry) {
                entry.handlerName = displayName;
                console.log('✅ Collection Due Report - Updated employee map entry:', { handlerId: empId, handlerName: displayName });
              }
            }
          });
        }
      }

      // Fetch department information from tenants_employee for all handlers
      const handlerIdsWithDepartments = Array.from(employeeMap.values())
        .map(entry => entry.handlerId)
        .filter((id): id is number => id !== null);

      if (handlerIdsWithDepartments.length > 0) {
        console.log('🔍 Collection Due Report - Fetching departments from tenants_employee for', handlerIdsWithDepartments.length, 'handlers');
        const { data: employeeDepartmentData, error: employeeDepartmentError } = await supabase
          .from('tenants_employee')
          .select(`
            id,
            display_name,
            department_id,
            tenant_departement!department_id (
              id,
              name
            )
          `)
          .in('id', handlerIdsWithDepartments);

        if (!employeeDepartmentError && employeeDepartmentData) {
          console.log('📊 Collection Due Report - Employee department data received:', employeeDepartmentData.length, 'records');

          // Create maps for department name and display name
          const handlerDepartmentMap = new Map<number, string>();
          const handlerDisplayNameMap = new Map<number, string>();

          employeeDepartmentData.forEach(emp => {
            const empId = Number(emp.id);
            if (!Number.isNaN(empId)) {
              // Map display_name
              const displayName = emp.display_name?.trim() || `Employee #${emp.id}`;
              handlerDisplayNameMap.set(empId, displayName);

              // Map department
              const department = emp.tenant_departement;
              if (department) {
                const dept = Array.isArray(department) ? department[0] : department;
                const departmentName = dept?.name || '—';
                handlerDepartmentMap.set(empId, departmentName);
                console.log('✅ Collection Due Report - Mapped handler to department:', { handlerId: empId, departmentName });
              } else {
                handlerDepartmentMap.set(empId, '—');
              }
            }
          });

          // Update employeeMap entries with correct department and display_name from tenants_employee
          employeeMap.forEach((entry, key) => {
            if (entry.handlerId !== null) {
              // Update display_name
              const correctDisplayName = handlerDisplayNameMap.get(entry.handlerId);
              if (correctDisplayName !== undefined) {
                entry.handlerName = correctDisplayName;
                console.log('✅ Collection Due Report - Updated handler name in employee map:', { handlerId: entry.handlerId, handlerName: correctDisplayName });
              }

              // Update department
              const correctDepartment = handlerDepartmentMap.get(entry.handlerId);
              if (correctDepartment !== undefined) {
                entry.departmentName = correctDepartment;
                console.log('✅ Collection Due Report - Updated department in employee map:', { handlerId: entry.handlerId, departmentName: correctDepartment });
              }
            }
          });
        } else if (employeeDepartmentError) {
          console.error('❌ Collection Due Report - Error fetching employee departments:', employeeDepartmentError);
        }
      }

      // Store maps for drawer access
      setEmployeeMapStore(employeeMap);

      // Debug: Check if employee 14 is in employeeMap
      const employee14Entry = Array.from(employeeMap.entries()).find(([key, entry]) => entry.handlerId === 14);
      console.log('🔍 DEBUG Employee 14 - Employee 14 in employeeMap?', employee14Entry ? 'YES' : 'NO', employee14Entry);
      console.log('🔍 DEBUG Employee 14 - All handlerIds in employeeMap:', Array.from(employeeMap.values()).map(e => e.handlerId));

      // Collect unique leadIds for drawer access (still need Set for this)
      // Use same key structure as employeeMap: for unassigned, use 'unknown'
      const leadIdsMap = new Map<string, Set<string>>();
      filteredPayments.forEach(payment => {
        const key = payment.handlerId !== null && payment.handlerId !== undefined
          ? payment.handlerId.toString()
          : 'unknown';
        if (!leadIdsMap.has(key)) {
          leadIdsMap.set(key, new Set());
        }
        leadIdsMap.get(key)!.add(payment.leadId);
      });

      // Store payment row IDs map for drawer access
      setEmployeePaymentRowIds(employeePaymentRowIds);

      const employeeDataArray = Array.from(employeeMap.entries()).map(([mapKey, entry]) => {
        // Use the mapKey directly since it matches the leadIdsMap key structure
        const leadIds = leadIdsMap.get(mapKey) || new Set();
        // Get the actual count of payment rows that will be shown in drawer (based on stored IDs)
        const paymentRowIdsForEmployee = employeePaymentRowIds.get(mapKey) || new Set();
        const actualCount = paymentRowIdsForEmployee.size;

        // Recalculate total based only on payment rows that will be shown in drawer
        let recalculatedTotal = 0;
        paymentRowIdsForEmployee.forEach(paymentRowId => {
          const value = paymentRowValues.get(paymentRowId) || 0;
          recalculatedTotal += value;
        });

        return {
          employee: entry.handlerName,
          department: entry.departmentName,
          cases: actualCount, // Use actual count from stored payment row IDs - this matches drawer exactly
          applicants: entry.applicants,
          total: recalculatedTotal > 0 ? recalculatedTotal : entry.total, // Use recalculated total based on stored payment row IDs
          handlerId: entry.handlerId, // Store handlerId for drawer access
          leadIds: Array.from(leadIds), // Store leadIds for drawer
          paymentRowIds: Array.from(paymentRowIdsForEmployee), // Store payment row IDs for drawer filtering
        };
      }).sort((a, b) => {
        // Sort alphabetically by employee name
        // Put "Unknown" at the bottom of the table
        const aIsUnknown = a.employee === 'Unknown' || a.employee === '—' || !a.employee || a.employee.trim() === '';
        const bIsUnknown = b.employee === 'Unknown' || b.employee === '—' || !b.employee || b.employee.trim() === '';

        if (aIsUnknown && !bIsUnknown) return 1; // Unknown goes after regular employees
        if (!aIsUnknown && bIsUnknown) return -1; // Regular employees go before Unknown
        return a.employee.localeCompare(b.employee, undefined, { sensitivity: 'base' });
      });

      // Debug: Check if employee 14 is in employeeDataArray
      const employee14InArray = employeeDataArray.find(e => e.handlerId === 14);
      console.log('🔍 DEBUG Employee 14 - Employee 14 in employeeDataArray?', employee14InArray ? 'YES' : 'NO', employee14InArray);
      console.log('🔍 DEBUG Employee 14 - All handlerIds in employeeDataArray:', employeeDataArray.map(e => e.handlerId));

      console.log('✅ Collection Due Report - Employee data array:', employeeDataArray.length, 'employees');
      console.log('📊 Collection Due Report - Employee data:', employeeDataArray);
      console.log('📊 Collection Due Report - Employee map entries:', Array.from(employeeMap.entries()).map(([key, entry]) => ({ key, handlerId: entry.handlerId, handlerName: entry.handlerName })));

      // Group by department - use lead's category department (not employee's department)
      // Match leads by category to department, same as signed agreements table in Dashboard
      // Cases count now represents the actual number of payment rows (not unique leads)
      // Payments without category (departmentName is '—') should be combined into "General" department
      const departmentMap = new Map<string, { departmentName: string; cases: number; applicantsLeads: Set<string>; applicants: number; total: number }>();
      // Store payment row IDs per department - this ensures the count matches exactly what the drawer will show
      const departmentPaymentRowIds = new Map<string, Set<string>>();
      // Store payment row values (in NIS) by payment row ID for accurate total calculation
      const departmentPaymentRowValues = new Map<string, number>();
      filteredPayments.forEach(payment => {
        // Get department from lead's category -> main category -> department
        // This is already extracted in payment.departmentId and payment.departmentName
        // If departmentName is '—' (no category), use "General" instead
        const departmentName = payment.departmentName && payment.departmentName !== '—'
          ? payment.departmentName
          : 'General';
        const key = departmentName;

        if (!departmentMap.has(key)) {
          departmentMap.set(key, {
            departmentName: departmentName,
            cases: 0, // Count of payment rows
            applicantsLeads: new Set(),
            applicants: 0,
            total: 0,
          });
        }
        const entry = departmentMap.get(key)!;
        
        // IMPORTANT: Only count payment rows that have due_date within the date filter range
        // This ensures the count matches exactly what the drawer will show
        if (!payment.dueDate) {
          return; // Skip payment rows without due_date
        }

        // Verify due_date is within date filter range (if date filters are applied)
        if (filters.fromDate || filters.toDate) {
          const paymentDueDate = new Date(payment.dueDate);

          if (filters.fromDate) {
            const fromDate = new Date(`${filters.fromDate}T00:00:00`);
            if (paymentDueDate < fromDate) {
              return; // Skip payment rows outside date range
            }
          }

          if (filters.toDate) {
            const toDate = new Date(`${filters.toDate}T23:59:59`);
            if (paymentDueDate > toDate) {
              return; // Skip payment rows outside date range
            }
          }
        }

        // Payment row passes all filters - count it and store its ID
        entry.cases++; // Count each payment row

        // Store payment row ID for this department (to match drawer display)
        if (!departmentPaymentRowIds.has(key)) {
          departmentPaymentRowIds.set(key, new Set());
        }

        // Convert value to NIS before adding to total
        // Normalize currency: convert symbols to codes for convertToNIS
        let currencyForConversion = payment.currency || 'NIS';
        if (currencyForConversion === '₪') currencyForConversion = 'NIS';
        else if (currencyForConversion === '€') currencyForConversion = 'EUR';
        else if (currencyForConversion === '$') currencyForConversion = 'USD';
        else if (currencyForConversion === '£') currencyForConversion = 'GBP';
        const valueInNIS = convertToNIS(payment.value, currencyForConversion);

        // Store payment row identifier using the actual payment database ID
        if (payment.id) {
          const paymentRowId = payment.leadType === 'new'
            ? `new-${payment.id}`
            : `legacy-${payment.id}`;
          departmentPaymentRowIds.get(key)!.add(paymentRowId);
          // Store the value for this payment row ID so we can recalculate totals accurately
          departmentPaymentRowValues.set(paymentRowId, valueInNIS);
        }

        entry.total += valueInNIS; // Use value converted to NIS

        // Add applicants count only once per lead
        if (!entry.applicantsLeads.has(payment.leadId)) {
          entry.applicantsLeads.add(payment.leadId);
          if (payment.leadType === 'new') {
            const applicants = applicantsCountMap.get(payment.leadId) || 0;
            entry.applicants += applicants;
          } else {
            const legacyId = payment.leadId.replace('legacy_', '');
            const applicants = legacyApplicantsCountMap.get(legacyId) || 0;
            entry.applicants += applicants;
          }
        }
      });

      // Store department map for drawer access
      setDepartmentMapStore(departmentMap);

      // Collect unique leadIds for drawer access (still need Set for this)
      const departmentLeadIdsMap = new Map<string, Set<string>>();
      filteredPayments.forEach(payment => {
        // Use same logic as department grouping: '—' becomes "General"
        const departmentName = payment.departmentName && payment.departmentName !== '—'
          ? payment.departmentName
          : 'General';
        if (!departmentLeadIdsMap.has(departmentName)) {
          departmentLeadIdsMap.set(departmentName, new Set());
        }
        departmentLeadIdsMap.get(departmentName)!.add(payment.leadId);
      });

      const departmentDataArray = Array.from(departmentMap.values()).map(entry => {
        const leadIds = departmentLeadIdsMap.get(entry.departmentName) || new Set();
        // Get the actual count of payment rows that will be shown in drawer (based on stored IDs)
        const paymentRowIdsForDepartment = departmentPaymentRowIds.get(entry.departmentName) || new Set();
        const actualCount = paymentRowIdsForDepartment.size;

        // Recalculate total based only on payment rows that will be shown in drawer
        let recalculatedTotal = 0;
        paymentRowIdsForDepartment.forEach(paymentRowId => {
          const value = departmentPaymentRowValues.get(paymentRowId) || 0;
          recalculatedTotal += value;
        });

        return {
          department: entry.departmentName,
          cases: actualCount, // Use actual count from stored payment row IDs - this matches drawer exactly
          applicants: entry.applicants,
          total: recalculatedTotal > 0 ? recalculatedTotal : entry.total, // Use recalculated total based on stored payment row IDs
          leadIds: Array.from(leadIds), // Store leadIds for drawer
          paymentRowIds: Array.from(paymentRowIdsForDepartment), // Store payment row IDs for drawer filtering
        };
      }).sort((a, b) => b.total - a.total);

      console.log('✅ Collection Due Report - Department data array:', departmentDataArray.length, 'departments');
      console.log('📊 Collection Due Report - Department data:', departmentDataArray);

      const calculatedTotal = employeeDataArray.reduce((sum, item) => sum + item.total, 0);
      console.log('✅ Collection Due Report - Total due:', calculatedTotal);

      setEmployeeData(employeeDataArray);
      setDepartmentData(departmentDataArray);
      setTotalDue(calculatedTotal);
    } catch (error) {
      console.error('Error fetching collection due data:', error);
      alert('Failed to fetch collection due data.');
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('he-IL', {
      style: 'currency',
      currency: 'ILS',
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(amount);
  };

  // Helper to convert numeric order back to descriptive text (matching FinancesTab.tsx)
  const getOrderText = (orderNumber: number | string | null | undefined): string => {
    // Handle string input (for new leads that might already be text)
    if (typeof orderNumber === 'string') {
      // If it's already a descriptive string, return it as-is
      const lowerStr = orderNumber.toLowerCase();
      if (lowerStr.includes('first') || lowerStr.includes('intermediate') || lowerStr.includes('final') || lowerStr.includes('single') || lowerStr.includes('expense')) {
        return orderNumber;
      }
      // Try to parse as number
      const num = parseInt(orderNumber, 10);
      if (!isNaN(num)) {
        orderNumber = num;
      } else {
        return orderNumber; // Return as-is if can't parse
      }
    }

    // Handle numeric input
    if (typeof orderNumber === 'number') {
      switch (orderNumber) {
        case 1: return 'First Payment';
        case 5: return 'Intermediate Payment';
        case 9: return 'Final Payment';
        case 90: return 'Single Payment';
        case 99: return 'Expense (no VAT)';
        default: return 'First Payment'; // Default fallback
      }
    }

    // Handle null/undefined
    return 'First Payment';
  };

  const handleOpenDrawer = async (leadIds: string[], title: string, handlerId: number | null = null, paymentRowIds: string[] = []) => {
    console.log('🔍 [Drawer] Opening drawer with title:', title);
    console.log('🔍 [Drawer] Received leadIds:', leadIds.length, leadIds.slice(0, 10));
    console.log('🔍 [Drawer] Filtering by handlerId:', handlerId);
    console.log('🔍 [Drawer] Payment row IDs that were counted:', paymentRowIds.length, paymentRowIds.slice(0, 10));
    setDrawerLoading(true);
    setIsDrawerOpen(true);
    setDrawerTitle(title);

    // Use the payment row IDs passed directly (more reliable than reading from state)
    const countedPaymentRowIds = new Set(paymentRowIds);

    // Extract actual payment IDs from countedPaymentRowIds to fetch them directly
    const newPaymentIds: string[] = [];
    const legacyPaymentIds: number[] = [];

    countedPaymentRowIds.forEach(paymentRowId => {
      if (paymentRowId.startsWith('new-')) {
        const paymentId = paymentRowId.replace('new-', '');
        if (paymentId) {
          newPaymentIds.push(paymentId);
        }
      } else if (paymentRowId.startsWith('legacy-')) {
        const paymentId = Number(paymentRowId.replace('legacy-', ''));
        if (!Number.isNaN(paymentId)) {
          legacyPaymentIds.push(paymentId);
        }
      }
    });

    console.log('🔍 [Drawer] Extracted payment IDs - New:', newPaymentIds.length, 'Legacy:', legacyPaymentIds.length);

    try {
      // Separate new and legacy leadIds
      const newLeadIds: string[] = [];
      const legacyLeadIds: number[] = [];

      leadIds.forEach(leadId => {
        if (leadId.startsWith('legacy_')) {
          const legacyId = Number(leadId.replace('legacy_', ''));
          if (!Number.isNaN(legacyId)) {
            legacyLeadIds.push(legacyId);
          }
        } else {
          newLeadIds.push(leadId);
        }
      });

      console.log('🔍 [Drawer] Separated leadIds - New:', newLeadIds.length, 'Legacy:', legacyLeadIds.length);
      console.log('🔍 [Drawer] New leadIds sample:', newLeadIds.slice(0, 5));
      console.log('🔍 [Drawer] Legacy leadIds sample:', legacyLeadIds.slice(0, 5));

      const paymentRows: any[] = [];

      // Fetch payment rows directly by their IDs (from countedPaymentRowIds)
      // This ensures we fetch exactly what was counted, regardless of leadIds or filters
      if (newPaymentIds.length > 0) {
        console.log('🔍 [Drawer] Fetching new payment plans by ID for', newPaymentIds.length, 'payment rows');
        const paymentsStartTime = performance.now();

        // Fetch payment rows directly by their IDs
        // IMPORTANT: Apply the same filters as the main calculation (due_date, cancel_date, ready_to_pay, and date range)
        let newPaymentsQuery = supabase
          .from('payment_plans')
          .select(`
            id,
            lead_id,
            value,
            value_vat,
            currency,
            due_date,
            cancel_date,
            ready_to_pay,
            ready_to_pay_by,
            paid,
            payment_order,
            notes
          `)
          .in('id', newPaymentIds)
          .eq('ready_to_pay', true) // Same as main calculation
          .not('due_date', 'is', null) // Only fetch payment rows with due_date (same as main calculation)
          .is('cancel_date', null); // Only fetch non-cancelled payments

        // Apply date filters (same as main calculation)
        if (filters.fromDate) {
          const fromDateTime = `${filters.fromDate}T00:00:00`;
          newPaymentsQuery = newPaymentsQuery.gte('due_date', fromDateTime);
        }
        if (filters.toDate) {
          const toDateTime = `${filters.toDate}T23:59:59`;
          newPaymentsQuery = newPaymentsQuery.lte('due_date', toDateTime);
        }

        const { data: newPayments, error: newPaymentsError } = await newPaymentsQuery;
        const paymentsTime = performance.now() - paymentsStartTime;
        console.log(`⏱️ [Drawer] Payment plans fetch took ${paymentsTime.toFixed(2)}ms`);

        if (newPaymentsError) {
          console.error('❌ [Drawer] Error fetching new payments:', newPaymentsError);
          console.error('❌ [Drawer] Error details:', JSON.stringify(newPaymentsError, null, 2));
        } else if (newPayments && newPayments.length > 0) {
          console.log('✅ [Drawer] Found', newPayments.length, 'new payment plans');

          // Collect unique lead IDs from the fetched payment rows
          const uniqueLeadIds = Array.from(new Set(newPayments.map((p: any) => p.lead_id).filter(Boolean)));
          console.log('🔍 [Drawer] Unique lead IDs from payment rows:', uniqueLeadIds.length, uniqueLeadIds.slice(0, 5));

          // Fetch lead metadata for the leads that have these payment rows
          const { data: newLeads, error: newLeadsError } = await supabase
            .from('leads')
            .select(`
              id,
              lead_number,
              master_id,
              name,
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
                  name,
                  department_id,
                  tenant_departement!department_id(
                    id,
                    name
                  )
                )
              )
            `)
            .in('id', uniqueLeadIds);

          if (newLeadsError) {
            console.error('❌ Collection Due Report Drawer - Error fetching new leads:', newLeadsError);
          }

          // Fetch contacts for contact names (for new leads, use lead_leadcontact to get main contact)
          const contactsByLead = new Map<string, string>();
          const { data: leadContacts, error: leadContactsError } = await supabase
            .from('lead_leadcontact')
            .select('newlead_id, main, leads_contact:contact_id(name)')
            .eq('main', 'true')
            .in('newlead_id', newLeadIds);

          if (!leadContactsError && leadContacts) {
            leadContacts.forEach((entry: any) => {
              const leadId = entry.newlead_id?.toString();
              const contactName = entry.leads_contact?.name;
              if (leadId && contactName) {
                contactsByLead.set(leadId, contactName);
              }
            });
          }

          // Fallback: if no main contact found, fetch from contacts table
          if (contactsByLead.size === 0) {
            const { data: contacts, error: contactsError } = await supabase
              .from('contacts')
              .select('id, name, lead_id')
              .in('lead_id', newLeadIds)
              .eq('is_persecuted', false);

            if (!contactsError && contacts) {
              // Store the first contact name for each lead
              contacts.forEach((contact: any) => {
                if (contact.lead_id && contact.name) {
                  if (!contactsByLead.has(contact.lead_id)) {
                    contactsByLead.set(contact.lead_id, contact.name);
                  }
                }
              });
            }
          }

          // Fetch handler names - ALWAYS use case_handler_id (actual case handler), never ready_to_pay_by
          const handlerMap = new Map<number, string>();
          const handlerIds = new Set<number>();
          newLeads?.forEach(lead => {
            if (lead.case_handler_id) {
              const handlerId = Number(lead.case_handler_id);
              if (!Number.isNaN(handlerId)) {
                handlerIds.add(handlerId);
              }
            }
          });

          if (handlerIds.size > 0) {
            const { data: handlers, error: handlersError } = await supabase
              .from('tenants_employee')
              .select('id, display_name')
              .in('id', Array.from(handlerIds));

            if (!handlersError && handlers) {
              handlers.forEach((handler: any) => {
                if (handler.id && handler.display_name) {
                  handlerMap.set(Number(handler.id), handler.display_name);
                }
              });
            }
          }

          // Process each payment row
          // IMPORTANT: Filter by countedPaymentRowIds FIRST to ensure we only show what was counted
          newPayments.forEach(payment => {
            // Check if this payment row was counted in the main calculation
            const paymentRowId = `new-${payment.id}`;
            if (countedPaymentRowIds.size > 0 && !countedPaymentRowIds.has(paymentRowId)) {
              return; // Skip this payment row - it wasn't counted in the main calculation
            }

            // Verify the payment row has due_date and it's within the date range (query should handle this, but double-check)
            if (!payment.due_date) {
              return; // Skip payment rows without due_date
            }

            if (filters.fromDate || filters.toDate) {
              const paymentDueDate = new Date(payment.due_date);
              if (filters.fromDate) {
                const fromDate = new Date(`${filters.fromDate}T00:00:00`);
                if (paymentDueDate < fromDate) {
                  return; // Skip payment rows outside date range
                }
              }
              if (filters.toDate) {
                const toDate = new Date(`${filters.toDate}T23:59:59`);
                if (paymentDueDate > toDate) {
                  return; // Skip payment rows outside date range
                }
              }
            }

            const lead = newLeads?.find(l => l.id === payment.lead_id);
            if (!lead) return;

            // Get contact name (for new leads, use the first contact for the lead)
            const contactName = contactsByLead.get(payment.lead_id) || null;

            // Get handler name - ALWAYS use case_handler_id (actual case handler), never ready_to_pay_by
            const handlerId = lead.case_handler_id ? Number(lead.case_handler_id) : null;
            const handlerName = handlerId ? (handlerMap.get(handlerId) || '—') : '—';

            // Get category (main and sub) - use getCategoryName function to properly map category_id
            // This matches how categories are displayed elsewhere on the page (e.g., ExpertPipelineReport)
            // The function properly maps category_id to category name with main category in parentheses
            let categoryDisplay = '—';
            if (lead.category_id) {
              // Use the getCategoryName function which properly maps category_id to category name with main category
              // It looks up the category in allCategories and formats as "Subcategory (Main Category)"
              categoryDisplay = getCategoryName(lead.category_id, lead.category);
            } else if (lead.category) {
              // Fallback: if no category_id but we have category text, try to find it in allCategories
              categoryDisplay = getCategoryName(null, lead.category);
            }

            // Calculate amount - NEVER include VAT (use value only)
            // IMPORTANT: Use the payment row that has due_date (already filtered by query)
            const value = Number(payment.value || 0);
            // Don't calculate or include VAT - amount should be value only
            const amount = value;

            // Get order - map to text using getOrderText function
            const orderCode = payment.payment_order ? getOrderText(payment.payment_order) : '—';

            // Format case number with sublead suffix if applicable
            // Store both the actual lead_number (for navigation) and formatted display (for UI)
            const actualLeadNumber = lead.lead_number || lead.id?.toString() || '';
            let caseNumber: string; // Formatted display number
            let isSubLead = false;

            if (lead.master_id) {
              // It's a sublead - we need to calculate the suffix
              isSubLead = true;
              // If lead_number already has a /, use it; otherwise show as master_id/2
              if (lead.lead_number && lead.lead_number.includes('/')) {
                caseNumber = `#${lead.lead_number}`;
              } else {
                // Default to /2 for subleads without explicit suffix in lead_number
                // Find the master lead_number to format properly
                const masterLead = newLeads?.find(l => l.id === lead.master_id);
                const masterLeadNumber = masterLead?.lead_number || lead.master_id?.toString() || '';
                caseNumber = `#${masterLeadNumber}/2`;
              }
            } else {
              // It's a master lead or standalone lead
              caseNumber = lead.lead_number ? `#${lead.lead_number}` : `#${lead.id}`;
            }

            paymentRows.push({
              id: `new-${payment.id}`,
              name: lead.name || '—', // Client name
              client: contactName || '—', // Contact name
              amount,
              currency: payment.currency || '₪',
              order: orderCode,
              handler: handlerName,
              case: caseNumber, // Lead number with sublead formatting (for display)
              caseNav: actualLeadNumber, // Actual lead_number for navigation (like lead_number_nav in SchedulerToolPage)
              isSubLead, // Flag to indicate if this is a sublead
              category: categoryDisplay,
              notes: payment.notes || '—',
              leadType: 'new',
              leadId: payment.lead_id,
            });
          });
        }
      }

      // Fetch payment rows directly by their IDs (from countedPaymentRowIds)
      // This ensures we fetch exactly what was counted, regardless of leadIds or filters
      if (legacyPaymentIds.length > 0) {
        console.log('🔍 [Drawer] Fetching legacy payment plans by ID for', legacyPaymentIds.length, 'payment rows');
        const legacyPaymentsStartTime = performance.now();

        // Fetch payment rows directly by their IDs
        // IMPORTANT: Apply the same filters as the main calculation (due_date, cancel_date, and date range)
        let legacyPaymentsQuery = supabase
          .from('finances_paymentplanrow')
          .select(`
            id,
            lead_id,
            client_id,
            value,
            value_base,
            vat_value,
            currency_id,
            due_date,
            date,
            cancel_date,
            ready_to_pay,
            actual_date,
            due_by_id,
            order,
            notes,
            accounting_currencies!finances_paymentplanrow_currency_id_fkey(name, iso_code)
          `)
          .in('id', legacyPaymentIds)
          .not('due_date', 'is', null) // Only fetch payment rows with due_date (same as main calculation)
          .is('cancel_date', null); // Only fetch non-cancelled payments

        // Apply date filters (same as main calculation)
        if (filters.fromDate) {
          const fromDateTime = `${filters.fromDate}T00:00:00`;
          legacyPaymentsQuery = legacyPaymentsQuery.gte('due_date', fromDateTime);
        }
        if (filters.toDate) {
          const toDateTime = `${filters.toDate}T23:59:59`;
          legacyPaymentsQuery = legacyPaymentsQuery.lte('due_date', toDateTime);
        }

        const { data: legacyPayments, error: legacyPaymentsError } = await legacyPaymentsQuery;
        const legacyPaymentsTime = performance.now() - legacyPaymentsStartTime;
        console.log(`⏱️ [Drawer] Legacy payment plans fetch took ${legacyPaymentsTime.toFixed(2)}ms`);

        if (legacyPaymentsError) {
          console.error('❌ [Drawer] Error fetching legacy payments:', legacyPaymentsError);
          console.error('❌ [Drawer] Error details:', JSON.stringify(legacyPaymentsError, null, 2));
        } else if (legacyPayments && legacyPayments.length > 0) {
          console.log('✅ [Drawer] Found', legacyPayments.length, 'legacy payment plans');

          // Collect unique lead IDs from the fetched payment rows
          const uniqueLegacyLeadIds = Array.from(new Set(legacyPayments.map((p: any) => p.lead_id).filter(Boolean)));
          console.log('🔍 [Drawer] Unique legacy lead IDs from payment rows:', uniqueLegacyLeadIds.length, uniqueLegacyLeadIds.slice(0, 5));

          // Fetch lead metadata for the leads that have these payment rows
          console.log('🔍 [Drawer] Fetching legacy leads metadata for', uniqueLegacyLeadIds.length, 'lead IDs');
          const legacyLeadsStartTime = performance.now();
          const { data: legacyLeads, error: legacyLeadsError } = await supabase
            .from('leads_lead')
            .select(`
              id,
              name,
              lead_number,
              manual_id,
              master_id,
              case_handler_id,
              category_id,
              category,
              misc_category!category_id(
                id,
                name,
                parent_id,
                misc_maincategory!parent_id(
                  id,
                  name,
                  department_id,
                  tenant_departement!department_id(
                    id,
                    name
                  )
                )
              )
            `)
            .in('id', uniqueLegacyLeadIds);
          const legacyLeadsTime = performance.now() - legacyLeadsStartTime;
          console.log(`⏱️ [Drawer] Legacy leads metadata fetch took ${legacyLeadsTime.toFixed(2)}ms`);

          if (legacyLeadsError) {
            console.error('❌ [Drawer] Error fetching legacy leads:', legacyLeadsError);
            console.error('❌ [Drawer] Error details:', JSON.stringify(legacyLeadsError, null, 2));
          } else {
            console.log('✅ [Drawer] Fetched', legacyLeads?.length || 0, 'legacy leads');
            console.log('🔍 [Drawer] Legacy lead IDs fetched:', legacyLeads?.map(l => l.id).slice(0, 10));
          }

          // Fetch contacts for contact names (client_id in finances_paymentplanrow is contact_id)
          const contactIds = Array.from(new Set(legacyPayments.map(p => p.client_id).filter(Boolean))).map(id => Number(id)).filter(id => !Number.isNaN(id));
          const contactMap = new Map<number, string>();
          if (contactIds.length > 0) {
            const { data: contacts, error: contactsError } = await supabase
              .from('leads_contact')
              .select('id, name')
              .in('id', contactIds);

            if (!contactsError && contacts) {
              contacts.forEach((contact: any) => {
                if (contact.id && contact.name) {
                  contactMap.set(Number(contact.id), contact.name);
                }
              });
            }
          }

          // Fetch handler names - ALWAYS use case_handler_id (actual case handler), never due_by_id
          const handlerMap = new Map<number, string>();
          const handlerIds = new Set<number>();
          legacyLeads?.forEach(lead => {
            if (lead.case_handler_id) {
              const handlerId = Number(lead.case_handler_id);
              if (!Number.isNaN(handlerId)) {
                handlerIds.add(handlerId);
              }
            }
          });

          if (handlerIds.size > 0) {
            const { data: handlers, error: handlersError } = await supabase
              .from('tenants_employee')
              .select('id, display_name')
              .in('id', Array.from(handlerIds));

            if (!handlersError && handlers) {
              handlers.forEach((handler: any) => {
                if (handler.id && handler.display_name) {
                  handlerMap.set(Number(handler.id), handler.display_name);
                }
              });
            }
          }

          // Process each payment row
          // IMPORTANT: Each payment row already has due_date (filtered by query)
          // We use this specific payment row's data (value, value_base, currency, etc.) - not from other rows
          console.log('🔍 [Drawer] Processing', legacyPayments.length, 'legacy payment rows');
          let processedCount = 0;
          let skippedNoLeadCount = 0;

          legacyPayments.forEach((payment, index) => {
            // Try multiple ways to match the lead
            const paymentLeadId = payment.lead_id;
            const lead = legacyLeads?.find(l => {
              // Try exact match
              if (l.id === paymentLeadId) return true;
              // Try string comparison
              if (String(l.id) === String(paymentLeadId)) return true;
              // Try number comparison
              if (Number(l.id) === Number(paymentLeadId)) return true;
              return false;
            });

            if (!lead) {
              skippedNoLeadCount++;
              if (index < 5) {
                console.warn(`⚠️ [Drawer] Payment ${index}: No lead found for payment.lead_id=${paymentLeadId} (type: ${typeof paymentLeadId})`);
                console.warn(`⚠️ [Drawer] Available lead IDs:`, legacyLeads?.map(l => ({ id: l.id, type: typeof l.id })).slice(0, 10));
              }
              return;
            }

            processedCount++;

            // Get contact name
            const contactId = payment.client_id ? Number(payment.client_id) : null;
            const contactName = contactId && !Number.isNaN(contactId) ? contactMap.get(contactId) : null;

            // Get handler name - ALWAYS use case_handler_id (actual case handler), never due_by_id
            const handlerId = lead.case_handler_id ? Number(lead.case_handler_id) : null;
            const handlerName = handlerId && !Number.isNaN(handlerId) ? (handlerMap.get(handlerId) || '—') : '—';

            // Get category (main and sub)
            const miscCategory: any = lead.misc_category;
            const categoryEntry: any = Array.isArray(miscCategory) ? miscCategory[0] : miscCategory;
            const mainCategory: any = categoryEntry?.misc_maincategory;
            let mainCategoryName: string | undefined = undefined;
            if (Array.isArray(mainCategory) && mainCategory[0]) {
              mainCategoryName = mainCategory[0]?.name;
            } else if (mainCategory) {
              mainCategoryName = mainCategory?.name;
            }
            const subCategoryName: string = categoryEntry?.name || lead.category || '—';
            const categoryDisplay = mainCategoryName ? `${subCategoryName} (${mainCategoryName})` : subCategoryName;

            // Calculate amount - NEVER include VAT (use value only)
            // IMPORTANT: Use the payment row that has due_date (already filtered by query)
            const value = Number(payment.value || payment.value_base || 0);
            const accountingCurrency: any = payment.accounting_currencies
              ? (Array.isArray(payment.accounting_currencies) ? payment.accounting_currencies[0] : payment.accounting_currencies)
              : null;
            const currency = accountingCurrency?.name || accountingCurrency?.iso_code ||
              (payment.currency_id === 2 ? '€' :
                payment.currency_id === 3 ? '$' :
                  payment.currency_id === 4 ? '£' : '₪');
            // Don't calculate or include VAT - amount should be value only
            const amount = value;

            // Get order - map to text using getOrderText function
            const orderCode = payment.order ? getOrderText(payment.order) : '—';

            // Format case number with sublead suffix if applicable
            // Store both the actual lead ID (for navigation) and formatted display (for UI)
            const actualLeadId = lead.id?.toString() || '';
            let caseNumber: string; // Formatted display number
            let isSubLead = false;

            if (lead.master_id) {
              // It's a sublead - format as master_id/suffix
              isSubLead = true;
              // If lead_number already has a pattern, use it
              if (lead.lead_number && String(lead.lead_number).includes('/')) {
                caseNumber = `#${lead.lead_number}`;
              } else {
                // Use master_id (or manual_id if available) with /2 suffix
                // Find the master lead to format properly
                const masterLead = legacyLeads?.find(l => l.id === lead.master_id);
                const masterLeadNumber = masterLead?.lead_number || masterLead?.manual_id || lead.master_id?.toString() || '';
                caseNumber = `#${masterLeadNumber}/2`;
              }
            } else {
              // It's a master lead or standalone lead
              const leadNumber = lead.lead_number || lead.manual_id || lead.id;
              caseNumber = `#${leadNumber}`;
            }

            paymentRows.push({
              id: `legacy-${payment.id}`,
              name: lead.name || '—', // Client name
              client: contactName || '—', // Contact name
              amount,
              currency,
              order: orderCode,
              handler: handlerName,
              case: caseNumber, // Lead number with sublead formatting (for display)
              caseNav: actualLeadId, // Actual lead ID for navigation (numeric ID for legacy leads)
              isSubLead, // Flag to indicate if this is a sublead
              category: categoryDisplay,
              notes: payment.notes || '—',
              leadType: 'legacy',
              leadId: `legacy_${lead.id}`,
            });
          });

          console.log(`✅ [Drawer] Processed ${processedCount} legacy payment rows`);
          if (skippedNoLeadCount > 0) {
            console.warn(`⚠️ [Drawer] Skipped ${skippedNoLeadCount} legacy payment rows (no matching lead found)`);
          }
        }
      }

      console.log('✅ [Drawer] Total payment rows collected:', paymentRows.length);
      console.log('📊 [Drawer] Payment rows breakdown:', {
        new: paymentRows.filter(r => r.leadType === 'new').length,
        legacy: paymentRows.filter(r => r.leadType === 'legacy').length
      });

      setDrawerLeads(paymentRows);
    } catch (error) {
      console.error('❌ [Drawer] Fatal error fetching payment rows for drawer:', error);
      console.error('❌ [Drawer] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
      console.error('❌ [Drawer] Error details:', JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
      setDrawerLeads([]);
    } finally {
      setDrawerLoading(false);
      console.log('✅ [Drawer] Drawer loading completed');
    }
  };

  const handleCloseDrawer = () => {
    setIsDrawerOpen(false);
    setDrawerTitle('');
    setDrawerLeads([]);
  };

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (showOrderDropdown && !target.closest('.dropdown')) {
        setShowOrderDropdown(false);
      }
      if (showCategoryDropdown && !target.closest('.dropdown')) {
        setShowCategoryDropdown(false);
      }
      if (showDepartmentDropdown && !target.closest('.dropdown')) {
        setShowDepartmentDropdown(false);
      }
    };

    if (showOrderDropdown || showCategoryDropdown || showDepartmentDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showOrderDropdown, showCategoryDropdown, showDepartmentDropdown]);

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <BanknotesIcon className="w-10 h-10 text-primary" />
            Collection Due Report
          </h1>
          <p className="text-gray-500 mt-1">Track collection due payments by employee and department.</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Search Bar */}
          <div className="relative max-w-xs">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search other reports..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-10 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent text-sm"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <XMarkIcon className="w-4 h-4" />
              </button>
            )}
          </div>
          {/* Back to Reports Button */}
          <Link
            to="/reports"
            className="btn btn-outline btn-primary flex items-center gap-2"
          >
            <ArrowLeftIcon className="w-5 h-5" />
            Back to Reports
          </Link>
        </div>
      </div>

      {/* Search Results Dropdown */}
      {searchQuery && (
        <div className="border border-gray-200 rounded-lg bg-white shadow-lg max-h-96 overflow-y-auto">
          <div className="p-4">
            <p className="text-sm font-semibold text-gray-700 mb-3">Quick Switch to:</p>
            <div className="space-y-2">
              {filteredReports.map((section) =>
                section.items.map((item) => (
                  <button
                    key={item.label}
                    onClick={() => {
                      if (item.route) {
                        navigate(item.route);
                        setSearchQuery('');
                      }
                    }}
                    className={`w-full text-left px-4 py-2 rounded-md hover:bg-primary hover:text-white transition-colors flex items-center gap-3 ${item.route === '/reports/collection-due' ? 'bg-primary text-white' : 'bg-gray-50'
                      }`}
                  >
                    <item.icon className="w-5 h-5" />
                    <div className="flex-1">
                      <div className="font-medium">{item.label}</div>
                      <div className="text-xs opacity-75">{section.category}</div>
                    </div>
                  </button>
                ))
              )}
            </div>
            {filteredReports.length === 0 && (
              <div className="text-center py-4 text-gray-500 text-sm">
                No reports found matching "{searchQuery}"
              </div>
            )}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card bg-base-100 shadow-lg p-6">
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4 items-end">
          <div className="form-control">
            <label className="label mb-2"><span className="label-text">From date:</span></label>
            <input
              type="date"
              className="input input-bordered"
              value={filters.fromDate}
              onChange={e => handleFilterChange('fromDate', e.target.value)}
            />
          </div>
          <div className="form-control">
            <label className="label mb-2"><span className="label-text">To date:</span></label>
            <input
              type="date"
              className="input input-bordered"
              value={filters.toDate}
              onChange={e => handleFilterChange('toDate', e.target.value)}
            />
          </div>
          <div className="form-control">
            <label className="label mb-2"><span className="label-text">Category:</span></label>
            <div className="dropdown dropdown-bottom w-full">
              <button
                type="button"
                className="btn btn-outline w-full justify-between"
                onClick={() => setShowCategoryDropdown(!showCategoryDropdown)}
              >
                <span>
                  {Array.isArray(filters.category) && filters.category.length > 0
                    ? `${filters.category.length} selected`
                    : 'ALL'}
                </span>
                <svg
                  className={`w-4 h-4 transition-transform ${showCategoryDropdown ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {showCategoryDropdown && (
                <ul className="dropdown-content menu p-2 shadow-lg bg-base-100 rounded-box w-full z-[1] border border-gray-200 mt-1 overflow-x-hidden">
                  <li>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost w-full justify-start"
                      onClick={handleSelectAllCategories}
                    >
                      Select All
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost w-full justify-start"
                      onClick={handleClearAllCategories}
                    >
                      Clear All
                    </button>
                  </li>
                  <li className="divider my-1"></li>
                  {categories.map(cat => {
                    const isSelected = Array.isArray(filters.category) && filters.category.includes(cat.id);
                    return (
                      <li key={cat.id}>
                        <button
                          type="button"
                          className="w-full text-left"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleCategoryToggle(cat.id);
                          }}
                        >
                          <label className="label cursor-pointer justify-start gap-2 py-2 hover:bg-gray-100 rounded w-full">
                            <input
                              type="checkbox"
                              className="checkbox checkbox-sm pointer-events-none"
                              checked={isSelected}
                              readOnly
                            />
                            <span className="label-text flex-1 break-words">{cat.name}</span>
                          </label>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
          <div className="form-control">
            <label className="label mb-2"><span className="label-text">Order:</span></label>
            <div className="dropdown dropdown-bottom w-full">
              <button
                type="button"
                className="btn btn-outline w-full justify-between"
                onClick={() => setShowOrderDropdown(!showOrderDropdown)}
              >
                <span>
                  {Array.isArray(filters.order) && filters.order.length > 0
                    ? `${filters.order.length} selected`
                    : 'ALL'}
                </span>
                <svg
                  className={`w-4 h-4 transition-transform ${showOrderDropdown ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {showOrderDropdown && (
                <ul className="dropdown-content menu p-2 shadow-lg bg-base-100 rounded-box w-full z-[1] border border-gray-200 mt-1">
                  <li>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost w-full justify-start"
                      onClick={handleSelectAllOrders}
                    >
                      Select All
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost w-full justify-start"
                      onClick={handleClearAllOrders}
                    >
                      Clear All
                    </button>
                  </li>
                  <li className="divider my-1"></li>
                  {[
                    { value: '1', label: 'First Payment' },
                    { value: '5', label: 'Intermediate Payment' },
                    { value: '9', label: 'Final Payment' },
                    { value: '90', label: 'Single Payment' },
                    { value: '99', label: 'Expense (no VAT)' },
                  ].map(option => {
                    const isSelected = Array.isArray(filters.order) && filters.order.includes(option.value);
                    return (
                      <li key={option.value}>
                        <button
                          type="button"
                          className="w-full text-left"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleOrderToggle(option.value);
                          }}
                        >
                          <label className="label cursor-pointer justify-start gap-2 py-2 hover:bg-gray-100 rounded w-full">
                            <input
                              type="checkbox"
                              className="checkbox checkbox-sm pointer-events-none"
                              checked={isSelected}
                              readOnly
                            />
                            <span className="label-text flex-1">{option.label}</span>
                          </label>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
          <div className="form-control">
            <label className="label mb-2"><span className="label-text">Department:</span></label>
            <div className="dropdown dropdown-bottom w-full">
              <button
                type="button"
                className="btn btn-outline w-full justify-between"
                onClick={() => setShowDepartmentDropdown(!showDepartmentDropdown)}
              >
                <span>
                  {Array.isArray(filters.department) && filters.department.length > 0
                    ? `${filters.department.length} selected`
                    : 'ALL'}
                </span>
                <svg
                  className={`w-4 h-4 transition-transform ${showDepartmentDropdown ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {showDepartmentDropdown && (
                <ul className="dropdown-content menu p-2 shadow-lg bg-base-100 rounded-box w-full z-[1] border border-gray-200 mt-1 overflow-x-hidden">
                  <li>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost w-full justify-start"
                      onClick={handleSelectAllDepartments}
                    >
                      Select All
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost w-full justify-start"
                      onClick={handleClearAllDepartments}
                    >
                      Clear All
                    </button>
                  </li>
                  <li className="divider my-1"></li>
                  {departments.map(dept => {
                    const isSelected = Array.isArray(filters.department) && filters.department.includes(dept.id);
                    return (
                      <li key={dept.id}>
                        <button
                          type="button"
                          className="w-full text-left"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleDepartmentToggle(dept.id);
                          }}
                        >
                          <label className="label cursor-pointer justify-start gap-2 py-2 hover:bg-gray-100 rounded w-full">
                            <input
                              type="checkbox"
                              className="checkbox checkbox-sm pointer-events-none"
                              checked={isSelected}
                              readOnly
                            />
                            <span className="label-text flex-1 break-words">{dept.name}</span>
                          </label>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
          <div className="form-control">
            <label className="label mb-2"><span className="label-text">By employee:</span></label>
            <select
              className="select select-bordered"
              value={filters.employeeType}
              onChange={e => {
                handleFilterChange('employeeType', e.target.value);
                handleFilterChange('employee', ''); // Reset employee filter when changing type
              }}
            >
              <option value="case_handler">Actual Employee Due</option>
              <option value="actual_employee_due">Case Handler</option>
            </select>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-4">
          <button
            className="btn btn-primary"
            onClick={handleSearch}
            disabled={loading}
          >
            {loading ? 'Loading...' : 'Show'}
          </button>
          {searchPerformed && (
            <div className="bg-green-500 text-white px-4 py-2 rounded-lg">
              <span className="text-2xl font-bold">{formatCurrency(totalDue)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Results */}
      {searchPerformed && (
        <div>
          {/* Tables Container - Side by side on larger screens */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-16">
            {/* By Employee Table */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold">By Employee</h3>
                <button
                  onClick={exportEmployeeTable}
                  className="btn btn-sm btn-outline btn-primary flex items-center gap-2"
                  title="Export to Excel"
                >
                  <ArrowDownTrayIcon className="w-4 h-4" />
                  <span className="hidden sm:inline">Export Excel</span>
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="table w-full">
                  <thead>
                    <tr>
                      <th className="text-left lg:px-3">Employee</th>
                      <th className="text-left lg:px-3">Department</th>
                      <th className="text-center lg:px-3">Cases</th>
                      <th className="text-center lg:px-3">Applicants</th>
                      <th className="text-right lg:px-3">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={5} className="text-center py-4">
                          <span className="loading loading-spinner loading-md"></span>
                        </td>
                      </tr>
                    ) : employeeData.length > 0 ? (
                      employeeData.map((row, index) => (
                        <tr key={index}>
                          <td className="text-left font-medium lg:px-3">
                            <div className="flex items-center gap-2">
                              <EmployeeAvatar employeeIdOrName={row.handlerId || row.employee} size="md" />
                              <span>{row.employee}</span>
                            </div>
                          </td>
                          <td className="text-left lg:px-3">{row.department}</td>
                          <td className="text-center lg:px-3">{row.cases}</td>
                          <td className="text-center lg:px-3">{row.applicants}</td>
                          <td className="text-right font-semibold lg:px-3">
                            {formatCurrency(row.total)}
                            <InformationCircleIcon
                              className="w-4 h-4 inline-block ml-2 text-gray-400 hover:text-primary cursor-pointer transition-colors"
                              onClick={() => handleOpenDrawer(row.leadIds || [], `${row.employee} - Leads`, row.handlerId, row.paymentRowIds || [])}
                              title="View leads"
                            />
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} className="text-center py-4 text-gray-500">No data found</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* By Department Table */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold">By Department</h3>
                <button
                  onClick={exportDepartmentTable}
                  className="btn btn-sm btn-outline btn-primary flex items-center gap-2"
                  title="Export to Excel"
                >
                  <ArrowDownTrayIcon className="w-4 h-4" />
                  <span className="hidden sm:inline">Export Excel</span>
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="table w-full">
                  <thead>
                    <tr>
                      <th className="text-left lg:px-3">Department</th>
                      <th className="text-center lg:px-3">Cases</th>
                      <th className="text-center lg:px-3">Applicants</th>
                      <th className="text-right lg:px-3">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={4} className="text-center py-4">
                          <span className="loading loading-spinner loading-md"></span>
                        </td>
                      </tr>
                    ) : departmentData.length > 0 ? (
                      departmentData.map((row, index) => (
                        <tr key={index}>
                          <td className="text-left font-medium lg:px-3">
                            <div className="flex items-center gap-2">
                              {getDepartmentIcon(row.department)}
                              <span>{row.department}</span>
                            </div>
                          </td>
                          <td className="text-center lg:px-3">{row.cases}</td>
                          <td className="text-center lg:px-3">{row.applicants}</td>
                          <td className="text-right font-semibold lg:px-3">
                            {formatCurrency(row.total)}
                            <InformationCircleIcon
                              className="w-4 h-4 inline-block ml-2 text-gray-400 hover:text-primary cursor-pointer transition-colors"
                              onClick={() => handleOpenDrawer(row.leadIds || [], `${row.department} - Leads`, null, row.paymentRowIds || [])}
                              title="View leads"
                            />
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={4} className="text-center py-4 text-gray-500">No data found</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Leads Drawer */}
      {isDrawerOpen && typeof window !== 'undefined' && createPortal(
        <>
          {/* Overlay */}
          <div
            className="fixed inset-0 bg-black/30 z-[10000] transition-opacity duration-300"
            onClick={handleCloseDrawer}
            style={{ top: 0, left: 0, right: 0, bottom: 0 }}
          />

          {/* Drawer */}
          <div className="fixed top-0 right-0 bottom-0 w-full max-w-4xl bg-white shadow-2xl flex flex-col z-[10001]" style={{ height: '100vh', top: 0, left: 'auto' }}>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div>
                <h2 className="text-xl font-bold text-gray-900">{drawerTitle}</h2>
                <p className="text-sm text-gray-500 mt-1">
                  {drawerLeads.length} {drawerLeads.length === 1 ? 'lead' : 'leads'}
                </p>
              </div>
              <button
                className="btn btn-ghost btn-circle"
                onClick={handleCloseDrawer}
                aria-label="Close drawer"
              >
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {drawerLoading ? (
                <div className="flex justify-center items-center py-12">
                  <span className="loading loading-spinner loading-lg"></span>
                </div>
              ) : drawerLeads.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="table w-full">
                    <thead>
                      <tr className="bg-gray-50">
                        <th className="text-left">Name</th>
                        <th className="text-left">Client</th>
                        <th className="text-right">Amount</th>
                        <th className="text-center">Order</th>
                        <th className="text-left">Handler</th>
                        <th className="text-left">Case</th>
                        <th className="text-left">Category</th>
                        <th className="text-left">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {drawerLeads.map((row, index) => (
                        <tr
                          key={row.id || index}
                          className="hover:bg-gray-50 cursor-pointer transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            // Handle navigation for new leads with subleads (matching SchedulerToolPage logic)
                            if (row.leadType === 'new' && row.caseNav) {
                              const isSubLead = row.isSubLead || (row.case && row.case.includes('/'));
                              if (isSubLead) {
                                // Sublead: path uses actual lead_number, query uses formatted display
                                const formattedCase = row.case?.replace('#', '') || '';
                                navigate(`/clients/${encodeURIComponent(row.caseNav)}?lead=${encodeURIComponent(formattedCase)}`);
                              } else {
                                // Regular new lead: just use lead_number
                                navigate(`/clients/${encodeURIComponent(row.caseNav)}`);
                              }
                            } else if (row.leadType === 'legacy' && row.caseNav) {
                              // Legacy lead: use caseNav which contains the actual lead ID
                              const legacyId = row.caseNav;
                              const isSubLead = row.isSubLead || (row.case && row.case.includes('/'));
                              if (isSubLead) {
                                // Legacy sublead: use numeric ID in path, formatted lead_number in query
                                const formattedCase = row.case?.replace('#', '') || '';
                                navigate(`/clients/${encodeURIComponent(legacyId)}?lead=${encodeURIComponent(formattedCase)}`);
                              } else {
                                // Legacy master lead: use numeric ID
                                navigate(`/clients/${encodeURIComponent(legacyId)}`);
                              }
                            } else if (row.case) {
                              // Fallback: use case number directly
                              const leadNumber = row.case.replace('#', '');
                              navigate(`/clients/${encodeURIComponent(leadNumber)}`);
                            }
                          }}
                        >
                          <td className="text-left font-semibold">{row.name || '—'}</td>
                          <td className="text-left">{row.client || '—'}</td>
                          <td className="text-right">
                            {row.amount > 0
                              ? `${row.currency || '₪'}${row.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                              : '—'
                            }
                          </td>
                          <td className="text-center">{row.order || '—'}</td>
                          <td className="text-left">{row.handler || '—'}</td>
                          <td className="text-left">{row.case || '—'}</td>
                          <td className="text-left">{row.category || '—'}</td>
                          <td className="text-left text-sm text-gray-600">{row.notes || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-12 text-gray-500">
                  No leads found
                </div>
              )}
            </div>
          </div>
        </>,
        document.body
      )}
    </div>
  );
};

export default CollectionDueReport;
