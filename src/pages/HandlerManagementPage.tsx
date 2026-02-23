import React, { useEffect, useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { UserGroupIcon, DocumentTextIcon, CurrencyDollarIcon, CheckCircleIcon, BriefcaseIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { getStageName, fetchStageNames } from '../lib/stageUtils';
import { convertToNIS } from '../lib/currencyConversion';
import LeadDetailsModal from '../components/LeadDetailsModal';
import AssignMultipleLeadsModal from '../components/AssignMultipleLeadsModal';

interface Handler {
  id: number;
  display_name: string;
  official_name?: string;
  department?: string;
  newCasesCount: number;
  activeCasesCount: number;
  inProcessCount?: number;
  applicationsSentCount?: number;
  dueAmount?: number;
  firstPaymentDue?: number;
  intermediatePaymentDue?: number;
  finalPaymentDueGermany?: number;
  finalPaymentDueAustria?: number;
}

interface UnassignedLead {
  id: string | number;
  name: string;
  lead_number?: string;
  stage: number | string;
  stage_name?: string;
  category?: string;
  topic?: string;
  total?: number;
  currency_id?: number;
  currency?: string;
  isLegacy: boolean;
  applicantsCount?: number;
  signed_date?: string;
}

interface NextPayment {
  lead_id: string | number;
  contact_name: string;
  category?: string;
  due_date: string;
  date?: string;
  value: number;
  currency_id?: number;
  currency?: string;
  isLegacy: boolean;
}

const HandlerManagementPage: React.FC = () => {
  const navigate = useNavigate();
  const [handlers, setHandlers] = useState<Handler[]>([]);
  const [unassignedLeads, setUnassignedLeads] = useState<UnassignedLead[]>([]);
  const [nextPayments, setNextPayments] = useState<NextPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [assigningLeadId, setAssigningLeadId] = useState<string | number | null>(null);
  const [selectedHandlerId, setSelectedHandlerId] = useState<number | null>(null);
  const [employees, setEmployees] = useState<Map<number, { id: number; display_name: string; photo_url?: string; photo?: string }>>(new Map());
  const [viewMode, setViewMode] = useState<'boxes' | 'table'>('table');
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [selectedLeadForAssign, setSelectedLeadForAssign] = useState<string | number | null>(null);
  const [employeeSearchQuery, setEmployeeSearchQuery] = useState('');
  const [pageEmployeeSearchQuery, setPageEmployeeSearchQuery] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState<string>('');
  const [sortColumn, setSortColumn] = useState<'due' | 'newCases' | 'activeCases' | 'inProcess' | 'applicationsSent' | 'totalCases' | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedStages, setSelectedStages] = useState<number[]>([]);
  const [categorySearch, setCategorySearch] = useState<string>('');
  const [stageSearch, setStageSearch] = useState<string>('');
  const [showCategoryDropdown, setShowCategoryDropdown] = useState<boolean>(false);
  const [showStageDropdown, setShowStageDropdown] = useState<boolean>(false);
  const [showLeadDetailsModal, setShowLeadDetailsModal] = useState(false);
  const [selectedLeadForModal, setSelectedLeadForModal] = useState<{ id: string | number; name: string } | null>(null);
  const [showAssignMultipleModal, setShowAssignMultipleModal] = useState(false);
  const [showNextPaymentsTable, setShowNextPaymentsTable] = useState(false);
  const [selectedLeads, setSelectedLeads] = useState<Set<string | number>>(new Set());
  const [showSelectedLeadsAssignBox, setShowSelectedLeadsAssignBox] = useState(false);
  const [selectedLeadsHandlerSearch, setSelectedLeadsHandlerSearch] = useState('');
  const [assigningSelectedLeads, setAssigningSelectedLeads] = useState(false);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const unassignedLeadsRef = useRef<HTMLDivElement>(null);
  const nextPaymentsRef = useRef<HTMLDivElement>(null);

  // Initialize stage names cache on mount
  useEffect(() => {
    fetchStageNames().catch(error => {
      console.error('Error initializing stage names:', error);
    });
  }, []);

  // Fetch all employees for avatars
  useEffect(() => {
    const fetchEmployees = async () => {
      const { data, error } = await supabase
        .from('tenants_employee')
        .select('id, display_name, photo_url, photo');

      if (!error && data) {
        const employeeMap = new Map();
        data.forEach(emp => {
          employeeMap.set(emp.id, emp);
        });
        setEmployees(employeeMap);
      }
    };
    fetchEmployees();
  }, []);

  // Helper function to get employee by ID
  const getEmployeeById = (employeeId: number | string | null | undefined) => {
    if (!employeeId) return null;
    const id = typeof employeeId === 'string' ? parseInt(employeeId) : employeeId;
    return employees.get(id) || null;
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

  // Employee Avatar Component
  const EmployeeAvatar: React.FC<{
    employeeId: number | string | null | undefined;
    size?: 'xs' | 'sm' | 'md' | 'lg';
  }> = ({ employeeId, size = 'md' }) => {
    const [imageError, setImageError] = useState(false);
    const employee = getEmployeeById(employeeId);
    const sizeClasses = {
      xs: 'w-6 h-6 text-xs',
      sm: 'w-8 h-8 text-xs',
      md: 'w-12 h-12 text-sm',
      lg: 'w-16 h-16 text-base'
    };

    if (!employee) {
      return (
        <div className={`${sizeClasses[size]} rounded-full flex items-center justify-center bg-gray-200 text-gray-500 font-semibold`}>
          --
        </div>
      );
    }

    const photoUrl = employee.photo_url || employee.photo;
    const initials = getEmployeeInitials(employee.display_name);

    if (imageError || !photoUrl) {
      return (
        <div className={`${sizeClasses[size]} rounded-full flex items-center justify-center bg-green-100 text-green-700 font-semibold`}>
          {initials}
        </div>
      );
    }

    return (
      <img
        src={photoUrl}
        alt={employee.display_name}
        className={`${sizeClasses[size]} rounded-full object-cover`}
        onError={() => setImageError(true)}
        title={employee.display_name}
      />
    );
  };

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      await Promise.all([
        fetchHandlers(),
        fetchUnassignedLeads(),
        fetchNextPayments()
      ]);
    } catch (error) {
      console.error('Error fetching data:', error);
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  // Helper function to get stage ID from stage value
  const getStageId = (stage: string | number | null | undefined): number | null => {
    if (!stage) return null;
    if (typeof stage === 'number') return stage;
    const parsed = parseInt(String(stage), 10);
    return isNaN(parsed) ? null : parsed;
  };

  // Helper function to normalize order code (same as CollectionDueReportPage)
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

  const fetchHandlers = async () => {
    try {
      // First, fetch main category IDs for Germany and Austria
      const { data: germanyCategory, error: germanyError } = await supabase
        .from('misc_maincategory')
        .select('id, name')
        .eq('name', 'Germany')
        .maybeSingle();

      const { data: austriaCategory, error: austriaError } = await supabase
        .from('misc_maincategory')
        .select('id, name')
        .eq('name', 'Austria')
        .maybeSingle();

      const germanyMainCategoryId = germanyCategory?.id ? Number(germanyCategory.id) : null;
      const austriaMainCategoryId = austriaCategory?.id ? Number(austriaCategory.id) : null;

      // Fetch all staff employees from users table with tenants_employee join
      // Fetch departments separately to avoid nested join issues
      const { data: allEmployeesData, error: handlersError } = await supabase
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
            official_name,
            department_id
          )
        `)
        .not('employee_id', 'is', null)
        .eq('is_active', true)
        .eq('is_staff', true);

      if (handlersError) {
        console.error('❌ HandlerManagementPage - Error fetching handlers:', handlersError);
        console.error('❌ Error details:', {
          message: handlersError.message,
          code: handlersError.code,
          details: handlersError.details,
          hint: handlersError.hint
        });
        throw handlersError;
      }

      // Extract unique department IDs
      const departmentIds = new Set<number>();
      (allEmployeesData || []).forEach(user => {
        if (user.tenants_employee) {
          const employee = Array.isArray(user.tenants_employee)
            ? user.tenants_employee[0]
            : user.tenants_employee;
          if (employee?.department_id) {
            departmentIds.add(Number(employee.department_id));
          }
        }
      });

      // Fetch departments separately
      let departmentsMap = new Map<number, string>();
      if (departmentIds.size > 0) {
        const { data: departmentsData, error: deptError } = await supabase
          .from('tenant_departement')
          .select('id, name')
          .in('id', Array.from(departmentIds));

        if (!deptError && departmentsData) {
          departmentsMap = new Map(
            departmentsData.map(dept => [Number(dept.id), dept.name])
          );
        }
      }

      // Process employees data
      const handlersData = (allEmployeesData || [])
        .filter(user => user.tenants_employee && user.email)
        .map(user => {
          const employee = Array.isArray(user.tenants_employee)
            ? user.tenants_employee[0]
            : user.tenants_employee;
          const departmentId = employee?.department_id ? Number(employee.department_id) : null;
          return {
            id: Number(employee.id),
            display_name: employee.display_name,
            official_name: employee.official_name || null,
            department: departmentId ? (departmentsMap.get(departmentId) || 'Unknown') : 'Unknown'
          };
        })
        .sort((a, b) => a.display_name.localeCompare(b.display_name));

      // For each handler, count their assigned cases (separated into new and active)
      const handlersWithCounts = await Promise.all(
        handlersData.map(async (handler) => {
          const handlerId = handler.id;
          const handlerName = handler.display_name || handler.official_name || '';

          // Fetch all new leads assigned to this handler (exclude stage 91 and inactive leads)
          const { data: newLeads } = await supabase
            .from('leads')
            .select('id, stage, handler_stage')
            .or(`handler.eq.${handlerName},case_handler_id.eq.${handlerId}`)
            .gte('stage', 60)
            .neq('stage', 91) // Exclude stage 91 (Dropped/Spam/Irrelevant)
            .is('unactivated_at', null); // Only active leads (exclude inactive: unactivated_at IS NULL means active)

          // Fetch all legacy leads assigned to this handler (exclude stage 91 and inactive leads)
          const { data: legacyLeads } = await supabase
            .from('leads_lead')
            .select('id, stage')
            .eq('case_handler_id', handlerId)
            .gte('stage', 60)
            .neq('stage', 91) // Exclude stage 91 (Dropped/Spam/Irrelevant)
            .or('status.eq.0,status.is.null'); // Only active leads (status 0 or null = active, status 10 = inactive)

          // Categorize leads into new and active cases (same logic as DashboardTab)
          let newCasesCount = 0;
          let activeCasesCount = 0;

          const allLeads = [
            ...(newLeads || []).map(l => ({ stage: (l as any).handler_stage || l.stage, lead_type: 'new' })),
            ...(legacyLeads || []).map(l => ({ stage: l.stage, lead_type: 'legacy' }))
          ];

          allLeads.forEach(lead => {
            const stageId = getStageId(lead.stage);

            if (stageId === null || stageId === undefined) {
              // If we can't determine stage, count as new case
              newCasesCount++;
            } else if (stageId === 200) {
              // Closed cases: stage === 200 (don't count)
            } else if (stageId <= 105) {
              // New cases: stage <= 105 (up to and including "handler set")
              newCasesCount++;
            } else if (stageId >= 110) {
              // Active cases: stage >= 110 (from "handler started" and beyond) and stage !== 200
              activeCasesCount++;
            } else {
              // Anything else goes to new cases
              newCasesCount++;
            }
          });

          // Calculate "In Process" = New Cases (stage <= 105) + Active Cases (stage >= 110 AND stage < 150)
          let inProcessCount = 0;
          allLeads.forEach(lead => {
            const stageId = getStageId(lead.stage);
            if (stageId !== null && stageId !== undefined && stageId !== 200) {
              // New cases: stage <= 105 OR Active cases: stage >= 110 AND stage < 150 (exclude Application Submitted and above)
              if (stageId <= 105 || (stageId >= 110 && stageId < 150)) {
                inProcessCount++;
              }
            }
          });

          // Calculate "Applications Sent" = Count distinct leads from leads_leadstage where stage >= 150
          let applicationsSentCount = 0;
          try {
            const handlerNewLeadIds = (newLeads || []).map(l => l.id).filter(Boolean);
            const handlerLegacyLeadIds = (legacyLeads || []).map(l => Number(l.id)).filter(id => !Number.isNaN(id));

            // For new leads - count distinct leads from leads_leadstage where stage >= 150
            if (handlerNewLeadIds.length > 0) {
              const { data: newStageRecords, error: newStageError } = await supabase
                .from('leads_leadstage')
                .select('newlead_id', { count: 'exact', head: false })
                .in('newlead_id', handlerNewLeadIds)
                .gte('stage', 150);

              if (!newStageError && newStageRecords) {
                const uniqueNewLeadIds = new Set(newStageRecords.map(r => r.newlead_id).filter(Boolean));
                applicationsSentCount += uniqueNewLeadIds.size;
              }
            }

            // For legacy leads - count distinct leads from leads_leadstage where stage >= 150
            if (handlerLegacyLeadIds.length > 0) {
              const { data: legacyStageRecords, error: legacyStageError } = await supabase
                .from('leads_leadstage')
                .select('lead_id', { count: 'exact', head: false })
                .in('lead_id', handlerLegacyLeadIds)
                .gte('stage', 150);

              if (!legacyStageError && legacyStageRecords) {
                const uniqueLegacyLeadIds = new Set(legacyStageRecords.map(r => r.lead_id).filter(Boolean));
                applicationsSentCount += uniqueLegacyLeadIds.size;
              }
            }
          } catch (error) {
            console.error(`Error calculating applications sent count for handler ${handlerId}:`, error);
          }

          // Calculate due amount for last 30 days (similar to CollectionDueReportPage)
          let dueAmount = 0;
          try {
            const today = new Date();
            const thirtyDaysAgo = new Date(today);
            thirtyDaysAgo.setDate(today.getDate() - 30);
            const fromDate = thirtyDaysAgo.toISOString().split('T')[0];
            const toDate = today.toISOString().split('T')[0];
            const fromDateTime = `${fromDate}T00:00:00`;
            const toDateTime = `${toDate}T23:59:59`;

            // Fetch new payment plans for this handler's leads (last 30 days)
            const { data: newPayments } = await supabase
              .from('payment_plans')
              .select('id, lead_id, value, currency, due_date, ready_to_pay, cancel_date')
              .eq('ready_to_pay', true)
              .not('due_date', 'is', null)
              .is('cancel_date', null)
              .gte('due_date', fromDateTime)
              .lte('due_date', toDateTime);

            // Get new lead IDs for this handler
            const handlerNewLeadIds = (newLeads || []).map(l => l.id).filter(Boolean);

            // Filter payments for this handler's leads
            const handlerNewPayments = (newPayments || []).filter(p =>
              handlerNewLeadIds.includes(p.lead_id)
            );

            // Calculate total for new payments
            handlerNewPayments.forEach(payment => {
              const value = Number(payment.value || 0);
              let currencyForConversion = payment.currency || 'NIS';
              if (currencyForConversion === '₪') currencyForConversion = 'NIS';
              else if (currencyForConversion === '€') currencyForConversion = 'EUR';
              else if (currencyForConversion === '$') currencyForConversion = 'USD';
              else if (currencyForConversion === '£') currencyForConversion = 'GBP';
              const valueInNIS = convertToNIS(value, currencyForConversion);
              dueAmount += valueInNIS;
            });

            // Fetch legacy payment plans for this handler's leads (last 30 days)
            const handlerLegacyLeadIds = (legacyLeads || []).map(l => l.id).filter(Boolean);

            if (handlerLegacyLeadIds.length > 0) {
              const { data: legacyPayments } = await supabase
                .from('finances_paymentplanrow')
                .select(`
                  id,
                  lead_id,
                  value,
                  value_base,
                  currency_id,
                  due_date,
                  cancel_date,
                  accounting_currencies!finances_paymentplanrow_currency_id_fkey(name, iso_code)
                `)
                .not('due_date', 'is', null)
                .is('cancel_date', null)
                .gte('due_date', fromDateTime)
                .lte('due_date', toDateTime)
                .in('lead_id', handlerLegacyLeadIds);

              // Calculate total for legacy payments
              (legacyPayments || []).forEach(payment => {
                const value = Number(payment.value || payment.value_base || 0);
                const accountingCurrency: any = payment.accounting_currencies
                  ? (Array.isArray(payment.accounting_currencies) ? payment.accounting_currencies[0] : payment.accounting_currencies)
                  : null;

                let currencyForConversion = 'NIS';
                if (accountingCurrency?.name) {
                  currencyForConversion = accountingCurrency.name;
                } else if (accountingCurrency?.iso_code) {
                  currencyForConversion = accountingCurrency.iso_code;
                } else if (payment.currency_id) {
                  switch (payment.currency_id) {
                    case 1: currencyForConversion = 'NIS'; break;
                    case 2: currencyForConversion = 'EUR'; break;
                    case 3: currencyForConversion = 'USD'; break;
                    case 4: currencyForConversion = 'GBP'; break;
                    default: currencyForConversion = 'NIS'; break;
                  }
                }

                const valueInNIS = convertToNIS(value, currencyForConversion);
                dueAmount += valueInNIS;
              });
            }
          } catch (error) {
            console.error(`Error calculating due amount for handler ${handlerId}:`, error);
          }

          // Calculate payment amounts by order and category (last 30 days)
          let firstPaymentDue = 0;
          let intermediatePaymentDue = 0;
          let finalPaymentDueGermany = 0;
          let finalPaymentDueAustria = 0;

          try {
            // Calculate date range for last 30 days (same as dueAmount calculation)
            const today = new Date();
            const thirtyDaysAgo = new Date(today);
            thirtyDaysAgo.setDate(today.getDate() - 30);
            const fromDate = thirtyDaysAgo.toISOString().split('T')[0];
            const toDate = today.toISOString().split('T')[0];
            const fromDateTime = `${fromDate}T00:00:00`;
            const toDateTime = `${toDate}T23:59:59`;

            const handlerNewLeadIds = (newLeads || []).map(l => l.id).filter(Boolean);
            const handlerLegacyLeadIds = (legacyLeads || []).map(l => l.id).filter(Boolean);

            // Fetch new leads metadata separately (same as CollectionDueReportPage)
            let newLeadsMap = new Map();
            if (handlerNewLeadIds.length > 0) {
              const { data: newLeadsData, error: newLeadsError } = await supabase
                .from('leads')
                .select(`
                  id,
                  category_id,
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
                .in('id', handlerNewLeadIds);

              if (!newLeadsError && newLeadsData) {
                newLeadsData.forEach(lead => {
                  newLeadsMap.set(lead.id, lead);
                });
              }
            }

            // Fetch legacy leads metadata separately (same as CollectionDueReportPage)
            let legacyLeadsMap = new Map();
            if (handlerLegacyLeadIds.length > 0) {
              const { data: legacyLeadsData, error: legacyLeadsError } = await supabase
                .from('leads_lead')
                .select(`
                  id,
                  category_id,
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
                .in('id', handlerLegacyLeadIds);

              if (!legacyLeadsError && legacyLeadsData) {
                legacyLeadsData.forEach(lead => {
                  const key = lead.id?.toString() || String(lead.id);
                  legacyLeadsMap.set(key, lead);
                  if (typeof lead.id === 'number') {
                    legacyLeadsMap.set(lead.id, lead);
                  }
                });
              }
            }

            // Fetch new payments for this handler's leads (last 30 days)
            const { data: allNewPayments } = await supabase
              .from('payment_plans')
              .select(`
                id,
                lead_id,
                value,
                currency,
                payment_order,
                due_date,
                ready_to_pay,
                cancel_date
              `)
              .eq('ready_to_pay', true)
              .not('due_date', 'is', null)
              .is('cancel_date', null)
              .gte('due_date', fromDateTime)
              .lte('due_date', toDateTime);

            const handlerNewPayments = (allNewPayments || []).filter(p =>
              handlerNewLeadIds.includes(p.lead_id)
            );

            // Process new payments (same as CollectionDueReportPage)
            handlerNewPayments.forEach(payment => {
              const lead = newLeadsMap.get(payment.lead_id);
              if (!lead) return;

              const value = Number(payment.value || 0);
              let currencyForConversion = payment.currency || 'NIS';
              if (currencyForConversion === '₪') currencyForConversion = 'NIS';
              else if (currencyForConversion === '€') currencyForConversion = 'EUR';
              else if (currencyForConversion === '$') currencyForConversion = 'USD';
              else if (currencyForConversion === '£') currencyForConversion = 'GBP';
              const valueInNIS = convertToNIS(value, currencyForConversion);

              // Use normalizeOrderCode to properly match orders (same as CollectionDueReportPage)
              const orderCode = normalizeOrderCode(payment.payment_order);

              // Get main category ID from lead (same as CollectionDueReportPage)
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

              // Match by normalized order code (same as CollectionDueReportPage)
              if (orderCode === '1') {
                firstPaymentDue += valueInNIS;
              } else if (orderCode === '5') {
                intermediatePaymentDue += valueInNIS;
              } else if (orderCode === '9') {
                // Compare by main category ID (same as CollectionDueReportPage)
                if (mainCategoryId !== null && mainCategoryId !== undefined) {
                  const mainCategoryIdNum = typeof mainCategoryId === 'number' ? mainCategoryId : Number(mainCategoryId);
                  if (!isNaN(mainCategoryIdNum)) {
                    if (germanyMainCategoryId !== null && mainCategoryIdNum === germanyMainCategoryId) {
                      finalPaymentDueGermany += valueInNIS;
                    } else if (austriaMainCategoryId !== null && mainCategoryIdNum === austriaMainCategoryId) {
                      finalPaymentDueAustria += valueInNIS;
                    }
                  }
                }
              }
            });

            // Fetch legacy payments (last 30 days)
            if (handlerLegacyLeadIds.length > 0) {
              const { data: allLegacyPayments } = await supabase
                .from('finances_paymentplanrow')
                .select(`
                  id,
                  lead_id,
                  value,
                  value_base,
                  currency_id,
                  order,
                  due_date,
                  cancel_date,
                  accounting_currencies!finances_paymentplanrow_currency_id_fkey(name, iso_code)
                `)
                .not('due_date', 'is', null)
                .is('cancel_date', null)
                .gte('due_date', fromDateTime)
                .lte('due_date', toDateTime)
                .in('lead_id', handlerLegacyLeadIds);

              // Process legacy payments (same as CollectionDueReportPage)
              (allLegacyPayments || []).forEach(payment => {
                // Try both string and number keys for lead_id lookup
                const leadIdKey = payment.lead_id?.toString() || String(payment.lead_id);
                const leadIdNum = typeof payment.lead_id === 'number' ? payment.lead_id : Number(payment.lead_id);
                const lead = legacyLeadsMap.get(leadIdKey) || legacyLeadsMap.get(leadIdNum);
                if (!lead) return;

                const value = Number(payment.value || payment.value_base || 0);
                const accountingCurrency: any = payment.accounting_currencies
                  ? (Array.isArray(payment.accounting_currencies) ? payment.accounting_currencies[0] : payment.accounting_currencies)
                  : null;

                let currencyForConversion = 'NIS';
                if (accountingCurrency?.name) {
                  currencyForConversion = accountingCurrency.name;
                } else if (accountingCurrency?.iso_code) {
                  currencyForConversion = accountingCurrency.iso_code;
                } else if (payment.currency_id) {
                  switch (payment.currency_id) {
                    case 1: currencyForConversion = 'NIS'; break;
                    case 2: currencyForConversion = 'EUR'; break;
                    case 3: currencyForConversion = 'USD'; break;
                    case 4: currencyForConversion = 'GBP'; break;
                    default: currencyForConversion = 'NIS'; break;
                  }
                }

                const valueInNIS = convertToNIS(value, currencyForConversion);

                // Use normalizeOrderCode to properly match orders (same as CollectionDueReportPage)
                const orderCode = normalizeOrderCode(payment.order);

                // Get main category ID from lead (same as CollectionDueReportPage)
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

                // Match by normalized order code (same as CollectionDueReportPage)
                if (orderCode === '1') {
                  firstPaymentDue += valueInNIS;
                } else if (orderCode === '5') {
                  intermediatePaymentDue += valueInNIS;
                } else if (orderCode === '9') {
                  // Compare by main category ID (same as CollectionDueReportPage)
                  if (mainCategoryId !== null && mainCategoryId !== undefined) {
                    const mainCategoryIdNum = typeof mainCategoryId === 'number' ? mainCategoryId : Number(mainCategoryId);
                    if (!isNaN(mainCategoryIdNum)) {
                      if (germanyMainCategoryId !== null && mainCategoryIdNum === germanyMainCategoryId) {
                        finalPaymentDueGermany += valueInNIS;
                      } else if (austriaMainCategoryId !== null && mainCategoryIdNum === austriaMainCategoryId) {
                        finalPaymentDueAustria += valueInNIS;
                      }
                    }
                  }
                }
              });
            }
          } catch (error) {
            console.error(`Error calculating payment amounts by order for handler ${handlerId}:`, error);
          }

          return {
            ...handler,
            newCasesCount,
            activeCasesCount,
            inProcessCount,
            applicationsSentCount,
            dueAmount,
            firstPaymentDue,
            intermediatePaymentDue,
            finalPaymentDueGermany,
            finalPaymentDueAustria
          };
        })
      );

      setHandlers(handlersWithCounts);
    } catch (error) {
      console.error('Error fetching handlers:', error);
      throw error;
    }
  };

  const fetchUnassignedLeads = async () => {
    try {
      const unassigned: UnassignedLead[] = [];

      // Fetch new leads in stages >= 60 (exclude inactive: unactivated_at IS NULL, exclude stage 91)
      // We'll filter for unassigned leads client-side to properly check both handler text and case_handler_id
      const { data: newLeads, error: newLeadsError } = await supabase
        .from('leads')
        .select(`
          id,
          lead_number,
          manual_id,
          master_id,
          name,
          stage,
          balance,
          balance_currency,
          category,
          topic,
          category_id,
          handler,
          case_handler_id,
          misc_category!category_id(
            id,
            name,
            parent_id,
            misc_maincategory!parent_id(id, name)
          )
        `)
        .gte('stage', 60)
        .neq('stage', 91) // Exclude stage 91 (Dropped/Spam/Irrelevant)
        .is('unactivated_at', null); // Only active leads (same as LeadSearchPage)

      if (newLeadsError) {
        console.error('Error fetching new unassigned leads:', newLeadsError);
      } else {
        // Filter unassigned leads first
        const filteredNewLeads = (newLeads || []).filter(lead => {
          const hasHandlerText = lead.handler &&
            lead.handler !== '---' &&
            lead.handler !== '--' &&
            lead.handler !== '' &&
            lead.handler !== null &&
            lead.handler.trim() !== '';
          const hasHandlerId = lead.case_handler_id &&
            lead.case_handler_id !== null &&
            lead.case_handler_id !== undefined;
          return !hasHandlerText && !hasHandlerId;
        });

        // Calculate sublead suffixes for new leads (same logic as LeadSearchPage)
        const newSubLeadSuffixMap = new Map<string, number>();
        const newMasterIdsWithSubLeads = new Set<string>();
        const newLeadsWithMaster = filteredNewLeads.filter((l: any) => l.master_id);
        const newMasterIds = Array.from(new Set(newLeadsWithMaster.map((l: any) => l.master_id?.toString()).filter(Boolean)));

        for (const masterId of newMasterIds) {
          const sameMasterLeads = filteredNewLeads.filter((l: any) => l.master_id?.toString() === masterId);
          sameMasterLeads.sort((a: any, b: any) => {
            const aId = typeof a.id === 'string' ? parseInt(a.id) || 0 : (a.id || 0);
            const bId = typeof b.id === 'string' ? parseInt(b.id) || 0 : (b.id || 0);
            return aId - bId;
          });

          if (sameMasterLeads.length > 0) {
            newMasterIdsWithSubLeads.add(masterId);
          }

          sameMasterLeads.forEach((lead: any, index: number) => {
            const leadKey = lead.id?.toString();
            if (leadKey) {
              newSubLeadSuffixMap.set(leadKey, index + 2);
            }
          });
        }

        filteredNewLeads.forEach(lead => {
          // Extract main category only
          let categoryDisplay = 'No Category';
          if (lead.misc_category) {
            const category = lead.misc_category;
            const mainRel = category.misc_maincategory;
            const mainCategory = Array.isArray(mainRel)
              ? mainRel[0]?.name
              : mainRel?.name;
            if (mainCategory) {
              categoryDisplay = mainCategory;
            } else {
              categoryDisplay = category.name || lead.category || 'No Category';
            }
          } else if (lead.category) {
            categoryDisplay = lead.category;
          }

          // Format lead number with sublead handling (same logic as LeadSearchPage)
          let displayLeadNumber: string;
          const anyLead = lead as any;
          if (anyLead.master_id) {
            // It's a sublead - format as master_id/suffix
            if (anyLead.lead_number && String(anyLead.lead_number).includes('/')) {
              displayLeadNumber = anyLead.lead_number;
            } else {
              const leadKey = anyLead.id?.toString();
              const suffix = leadKey ? newSubLeadSuffixMap.get(leadKey) : undefined;
              const masterLead = filteredNewLeads.find((l: any) => l.id === anyLead.master_id);
              const masterLeadNumber = masterLead?.lead_number || anyLead.master_id?.toString() || '';
              displayLeadNumber = suffix ? `${masterLeadNumber}/${suffix}` : `${masterLeadNumber}/2`;
            }
          } else {
            // It's a master lead or standalone lead
            const baseNumber = anyLead.lead_number || anyLead.manual_id || anyLead.id?.toString?.() || '';
            const leadIdStr = anyLead.id?.toString();
            const hasSubLeads = leadIdStr && newMasterIdsWithSubLeads.has(leadIdStr);
            if (hasSubLeads && baseNumber && !baseNumber.includes('/')) {
              displayLeadNumber = `${baseNumber}/1`;
            } else {
              displayLeadNumber = baseNumber;
            }
          }

          unassigned.push({
            id: lead.id,
            name: lead.name || 'Unknown',
            lead_number: displayLeadNumber,
            stage: lead.stage,
            stage_name: getStageName(String(lead.stage)), // Use getStageName like Clients.tsx
            category: categoryDisplay,
            topic: lead.topic || 'N/A',
            total: lead.balance || 0,
            currency: lead.balance_currency || 'NIS',
            isLegacy: false
          });
        });
      }

      // Fetch legacy leads in stages >= 60 with no handler (exclude inactive: status = 0 OR status IS NULL, exclude stage 91)
      const { data: legacyLeads, error: legacyLeadsError } = await supabase
        .from('leads_lead')
        .select(`
          id,
          name,
          master_id,
          stage,
          total,
          currency_id,
          category,
          topic,
          category_id,
          misc_category!category_id(
            id,
            name,
            parent_id,
            misc_maincategory!parent_id(id, name)
          )
        `)
        .gte('stage', 60)
        .neq('stage', 91) // Exclude stage 91 (Dropped/Spam/Irrelevant)
        .is('case_handler_id', null)
        .or('status.eq.0,status.is.null'); // Only active leads (same as LeadSearchPage)

      if (legacyLeadsError) {
        console.error('Error fetching legacy unassigned leads:', legacyLeadsError);
      } else {
        // Calculate sublead suffixes for legacy leads (same logic as LeadSearchPage)
        const legacySubLeadSuffixMap = new Map<string, number>();
        const legacyMasterIdsWithSubLeads = new Set<string>();
        const legacyLeadsWithMaster = (legacyLeads || []).filter((l: any) => l.master_id);
        const legacyMasterIds = Array.from(new Set(legacyLeadsWithMaster.map((l: any) => l.master_id?.toString()).filter(Boolean)));

        for (const masterId of legacyMasterIds) {
          const sameMasterLeads = (legacyLeads || []).filter((l: any) => l.master_id?.toString() === masterId);
          sameMasterLeads.sort((a: any, b: any) => {
            const aId = typeof a.id === 'string' ? parseInt(a.id) || 0 : (a.id || 0);
            const bId = typeof b.id === 'string' ? parseInt(b.id) || 0 : (b.id || 0);
            return aId - bId;
          });

          if (sameMasterLeads.length > 0) {
            legacyMasterIdsWithSubLeads.add(masterId);
          }

          sameMasterLeads.forEach((lead: any, index: number) => {
            const leadKey = lead.id?.toString();
            if (leadKey) {
              legacySubLeadSuffixMap.set(leadKey, index + 2);
            }
          });
        }

        (legacyLeads || []).forEach(lead => {
          // Extract main category only
          let categoryDisplay = 'No Category';
          if (lead.misc_category) {
            const category = lead.misc_category;
            const mainRel = category.misc_maincategory;
            const mainCategory = Array.isArray(mainRel)
              ? mainRel[0]?.name
              : mainRel?.name;
            if (mainCategory) {
              categoryDisplay = mainCategory;
            } else {
              categoryDisplay = category.name || lead.category || 'No Category';
            }
          } else if (lead.category) {
            categoryDisplay = lead.category;
          }

          // Format lead number with sublead handling (same logic as LeadSearchPage)
          let displayLeadNumber: string;
          const legacyLeadAny = lead as any;
          const masterId = legacyLeadAny.master_id;
          const leadId = String(lead.id);

          if (masterId && String(masterId).trim() !== '') {
            // It's a sublead - format as masterId/suffix
            const leadKey = lead.id?.toString();
            const suffix = leadKey ? legacySubLeadSuffixMap.get(leadKey) : undefined;
            if (suffix !== undefined) {
              displayLeadNumber = `${masterId}/${suffix}`;
            } else {
              displayLeadNumber = `${masterId}/?`;
            }
          } else {
            // It's a master lead or standalone lead
            const leadIdStr = lead.id?.toString();
            const hasSubLeads = leadIdStr && legacyMasterIdsWithSubLeads.has(leadIdStr);
            displayLeadNumber = hasSubLeads ? `${leadId}/1` : leadId;
          }

          // Add "C" prefix for legacy leads with stage "100" (Success) - same as LeadSearchPage
          if (lead.stage === 100 || lead.stage === '100') {
            displayLeadNumber = `C${displayLeadNumber}`;
          }

          unassigned.push({
            id: `legacy_${lead.id}`,
            name: lead.name || 'Unknown',
            lead_number: displayLeadNumber,
            stage: lead.stage,
            stage_name: getStageName(String(lead.stage)), // Use getStageName like Clients.tsx
            category: categoryDisplay,
            topic: lead.topic || 'N/A',
            total: lead.total || 0,
            currency_id: lead.currency_id,
            isLegacy: true
          });
        });
      }

      // Fetch applicants count for all leads (batch fetch for efficiency)
      const newLeadIds = unassigned.filter(lead => !lead.isLegacy).map(lead => lead.id);
      const legacyLeadIds = unassigned.filter(lead => lead.isLegacy).map(lead => {
        const id = typeof lead.id === 'string' && lead.id.startsWith('legacy_')
          ? lead.id.replace('legacy_', '')
          : lead.id;
        return typeof id === 'string' ? parseInt(id) : id;
      }).filter((id): id is number => typeof id === 'number');

      // Batch fetch contacts for new leads
      const newLeadsContactsMap = new Map<string | number, number>();
      if (newLeadIds.length > 0) {
        const { data: newContactsData, error: newContactsError } = await supabase
          .from('contacts')
          .select('lead_id')
          .in('lead_id', newLeadIds);

        if (!newContactsError && newContactsData) {
          newContactsData.forEach(contact => {
            if (contact.lead_id) {
              newLeadsContactsMap.set(contact.lead_id, (newLeadsContactsMap.get(contact.lead_id) || 0) + 1);
            }
          });
        }
      }

      // Batch fetch contacts for legacy leads via lead_leadcontact
      const legacyLeadsContactsMap = new Map<number, number>();
      if (legacyLeadIds.length > 0) {
        const { data: leadContactsData, error: leadContactsError } = await supabase
          .from('lead_leadcontact')
          .select('lead_id')
          .in('lead_id', legacyLeadIds);

        if (!leadContactsError && leadContactsData) {
          leadContactsData.forEach(lc => {
            const leadId = typeof lc.lead_id === 'number' ? lc.lead_id : parseInt(String(lc.lead_id));
            if (!isNaN(leadId)) {
              legacyLeadsContactsMap.set(leadId, (legacyLeadsContactsMap.get(leadId) || 0) + 1);
            }
          });
        }
      }

      // Fetch signed dates from leads_leadstage (stage 60 = Client signed agreement)
      const newLeadsSignedDatesMap = new Map<string | number, string>();
      if (newLeadIds.length > 0) {
        const { data: newSignedStages, error: newSignedStagesError } = await supabase
          .from('leads_leadstage')
          .select('newlead_id, date, cdate')
          .eq('stage', 60)
          .in('newlead_id', newLeadIds);

        if (!newSignedStagesError && newSignedStages) {
          newSignedStages.forEach(stage => {
            if (stage.newlead_id) {
              // Use date field, fallback to cdate
              const signedDate = stage.date || stage.cdate;
              if (signedDate) {
                // Keep the latest date if multiple records exist
                const existingDate = newLeadsSignedDatesMap.get(stage.newlead_id);
                if (!existingDate || (signedDate && new Date(signedDate) > new Date(existingDate))) {
                  newLeadsSignedDatesMap.set(stage.newlead_id, signedDate);
                }
              }
            }
          });
        }
      }

      // Fetch signed dates for legacy leads
      const legacyLeadsSignedDatesMap = new Map<number, string>();
      if (legacyLeadIds.length > 0) {
        const { data: legacySignedStages, error: legacySignedStagesError } = await supabase
          .from('leads_leadstage')
          .select('lead_id, date, cdate')
          .eq('stage', 60)
          .in('lead_id', legacyLeadIds);

        if (!legacySignedStagesError && legacySignedStages) {
          legacySignedStages.forEach(stage => {
            if (stage.lead_id) {
              const leadId = typeof stage.lead_id === 'number' ? stage.lead_id : parseInt(String(stage.lead_id));
              if (!isNaN(leadId)) {
                // Use date field, fallback to cdate
                const signedDate = stage.date || stage.cdate;
                if (signedDate) {
                  // Keep the latest date if multiple records exist
                  const existingDate = legacyLeadsSignedDatesMap.get(leadId);
                  if (!existingDate || (signedDate && new Date(signedDate) > new Date(existingDate))) {
                    legacyLeadsSignedDatesMap.set(leadId, signedDate);
                  }
                }
              }
            }
          });
        }
      }

      // Map applicants count and signed dates to each lead
      const leadsWithApplicants = unassigned.map(lead => {
        let applicantsCount = 0;
        let signedDate: string | undefined;

        if (!lead.isLegacy) {
          applicantsCount = newLeadsContactsMap.get(lead.id) || 0;
          signedDate = newLeadsSignedDatesMap.get(lead.id);
        } else {
          const legacyId = typeof lead.id === 'string' && lead.id.startsWith('legacy_')
            ? parseInt(lead.id.replace('legacy_', ''))
            : (typeof lead.id === 'number' ? lead.id : parseInt(String(lead.id)));
          if (!isNaN(legacyId)) {
            applicantsCount = legacyLeadsContactsMap.get(legacyId) || 0;
            signedDate = legacyLeadsSignedDatesMap.get(legacyId);
          }
        }

        return {
          ...lead,
          applicantsCount,
          signed_date: signedDate
        };
      });

      setUnassignedLeads(leadsWithApplicants);
    } catch (error) {
      console.error('Error fetching unassigned leads:', error);
      throw error;
    }
  };

  const fetchNextPayments = async () => {
    try {
      const payments: NextPayment[] = [];

      // Get all unassigned lead IDs (both new and legacy)
      const unassignedNewLeadIds: string[] = [];
      const unassignedLegacyLeadIds: number[] = [];

      // Fetch new leads with no handler (exclude inactive: unactivated_at IS NULL, exclude stage 91)
      const { data: newLeads } = await supabase
        .from('leads')
        .select('id, name, lead_number')
        .gte('stage', 60)
        .neq('stage', 91) // Exclude stage 91 (Dropped/Spam/Irrelevant)
        .is('unactivated_at', null) // Only active leads
        .or('handler.is.null,handler.eq.---,handler.eq.,case_handler_id.is.null');

      (newLeads || []).forEach(lead => {
        const hasHandler = lead.handler &&
          lead.handler !== '---' &&
          lead.handler !== '' &&
          lead.handler !== null;
        const hasHandlerId = lead.case_handler_id && lead.case_handler_id !== null;

        if (!hasHandler && !hasHandlerId) {
          unassignedNewLeadIds.push(lead.id);
        }
      });

      // Fetch legacy leads with no handler (exclude inactive: status = 0 OR status IS NULL, exclude stage 91)
      const { data: legacyLeads } = await supabase
        .from('leads_lead')
        .select('id, name')
        .gte('stage', 60)
        .neq('stage', 91) // Exclude stage 91 (Dropped/Spam/Irrelevant)
        .is('case_handler_id', null)
        .or('status.eq.0,status.is.null'); // Only active leads

      (legacyLeads || []).forEach(lead => {
        unassignedLegacyLeadIds.push(lead.id);
      });

      // Fetch next payments for new leads (only future dates)
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayStr = today.toISOString().split('T')[0];

      if (unassignedNewLeadIds.length > 0) {
        const { data: newPayments, error: newPaymentsError } = await supabase
          .from('payment_plans')
          .select('lead_id, due_date, value, currency')
          .in('lead_id', unassignedNewLeadIds)
          .is('cancel_date', null)
          .is('paid', false)
          .not('due_date', 'is', null)
          .gte('due_date', todayStr) // Only future dates
          .order('due_date', { ascending: true });

        if (!newPaymentsError && newPayments) {
          // Fetch leads with category information
          const { data: leadsWithCategory } = await supabase
            .from('leads')
            .select(`
              id,
              category,
              category_id,
              misc_category!category_id(
                id,
                name,
                parent_id,
                misc_maincategory!parent_id(id, name)
              )
            `)
            .in('id', unassignedNewLeadIds);

          // Fetch contacts for new leads (use lead_leadcontact to get main contact)
          const contactsByLead = new Map<string, string>();
          const { data: leadContacts, error: leadContactsError } = await supabase
            .from('lead_leadcontact')
            .select('newlead_id, main, leads_contact:contact_id(name)')
            .eq('main', 'true')
            .in('newlead_id', unassignedNewLeadIds);

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
              .in('lead_id', unassignedNewLeadIds)
              .eq('is_persecuted', false);

            if (!contactsError && contacts) {
              contacts.forEach((contact: any) => {
                if (contact.lead_id && contact.name) {
                  if (!contactsByLead.has(contact.lead_id)) {
                    contactsByLead.set(contact.lead_id, contact.name);
                  }
                }
              });
            }
          }

          // Get unique leads with their next payment (filter out past dates)
          const leadPaymentMap = new Map<string, NextPayment>();
          newPayments.forEach(payment => {
            const leadId = payment.lead_id;
            // Double-check that due_date is in the future
            if (payment.due_date) {
              const dueDate = new Date(payment.due_date);
              if (dueDate < today) {
                return; // Skip past dates
              }
            }
            if (!leadPaymentMap.has(leadId)) {
              const lead = leadsWithCategory?.find(l => l.id === leadId);

              // Format category display (same pattern as unassigned leads)
              let categoryDisplay = lead?.category || 'No Category';
              if (lead?.misc_category) {
                const category = lead.misc_category;
                const mainRel = category.misc_maincategory;
                const mainCategory = Array.isArray(mainRel)
                  ? mainRel[0]?.name
                  : mainRel?.name;
                if (mainCategory) {
                  categoryDisplay = `${category.name} (${mainCategory})`;
                } else {
                  categoryDisplay = category.name || lead.category || 'No Category';
                }
              }

              const contactName = contactsByLead.get(leadId) || 'No Contact';

              leadPaymentMap.set(leadId, {
                lead_id: leadId,
                contact_name: contactName,
                category: categoryDisplay,
                due_date: payment.due_date,
                value: payment.value || 0,
                currency: payment.currency || 'NIS',
                isLegacy: false
              });
            }
          });
          payments.push(...Array.from(leadPaymentMap.values()));
        }
      }

      // Fetch next payments for legacy leads (only future dates)
      if (unassignedLegacyLeadIds.length > 0) {
        const { data: legacyPayments, error: legacyPaymentsError } = await supabase
          .from('finances_paymentplanrow')
          .select(`
            lead_id,
            client_id,
            date,
            due_date,
            value,
            currency_id,
            accounting_currencies!finances_paymentplanrow_currency_id_fkey(name, iso_code)
          `)
          .in('lead_id', unassignedLegacyLeadIds)
          .is('cancel_date', null)
          .is('actual_date', null)
          .not('date', 'is', null)
          .gte('date', todayStr) // Only future dates (using date field for legacy)
          .order('date', { ascending: true });

        if (!legacyPaymentsError && legacyPayments) {
          // Fetch leads with category information
          const { data: leadsWithCategory } = await supabase
            .from('leads_lead')
            .select(`
              id,
              category,
              category_id,
              misc_category!category_id(
                id,
                name,
                parent_id,
                misc_maincategory!parent_id(id, name)
              )
            `)
            .in('id', unassignedLegacyLeadIds);

          // Fetch contacts for legacy leads (client_id in finances_paymentplanrow is contact_id)
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

          // Get unique leads with their next payment (filter out past dates)
          const leadPaymentMap = new Map<number, NextPayment>();
          legacyPayments.forEach(payment => {
            const leadId = payment.lead_id;
            // Use due_date if available, otherwise use date field
            const paymentDate = payment.due_date || payment.date;
            if (paymentDate) {
              const dueDate = new Date(paymentDate);
              if (dueDate < today) {
                return; // Skip past dates
              }
            }
            if (!leadPaymentMap.has(leadId)) {
              const lead = leadsWithCategory?.find(l => l.id === leadId);

              // Format category display (same pattern as unassigned leads)
              let categoryDisplay = lead?.category || 'No Category';
              if (lead?.misc_category) {
                const category = lead.misc_category;
                const mainRel = category.misc_maincategory;
                const mainCategory = Array.isArray(mainRel)
                  ? mainRel[0]?.name
                  : mainRel?.name;
                if (mainCategory) {
                  categoryDisplay = `${category.name} (${mainCategory})`;
                } else {
                  categoryDisplay = category.name || lead.category || 'No Category';
                }
              }

              // Get contact name from client_id
              const contactId = payment.client_id ? Number(payment.client_id) : null;
              const contactName = contactId && !Number.isNaN(contactId) ? contactMap.get(contactId) : null;

              const currency = (payment.accounting_currencies as any)?.iso_code || 'NIS';
              leadPaymentMap.set(leadId, {
                lead_id: `legacy_${leadId}`,
                contact_name: contactName || 'No Contact',
                category: categoryDisplay,
                date: payment.date,
                due_date: payment.due_date || payment.date,
                value: payment.value || 0,
                currency_id: payment.currency_id,
                currency: currency,
                isLegacy: true
              });
            }
          });
          payments.push(...Array.from(leadPaymentMap.values()));
        }
      }

      // Sort by due date
      payments.sort((a, b) => {
        const dateA = new Date(a.due_date || a.date || '').getTime();
        const dateB = new Date(b.due_date || b.date || '').getTime();
        return dateA - dateB;
      });

      setNextPayments(payments);
    } catch (error) {
      console.error('Error fetching next payments:', error);
      throw error;
    }
  };

  const assignHandler = async (leadId: string | number, handlerId: number) => {
    setAssigningLeadId(leadId);
    try {
      const handler = handlers.find(h => h.id === handlerId);
      if (!handler) {
        toast.error('Handler not found');
        return;
      }

      const handlerName = handler.display_name || handler.official_name || '';
      const isLegacy = typeof leadId === 'string' && leadId.startsWith('legacy_');

      if (isLegacy) {
        // Update legacy lead
        const legacyId = parseInt(leadId.toString().replace('legacy_', ''));
        const { error } = await supabase
          .from('leads_lead')
          .update({ case_handler_id: handlerId })
          .eq('id', legacyId);

        if (error) throw error;
      } else {
        // Update new lead
        const { error } = await supabase
          .from('leads')
          .update({
            handler: handlerName,
            case_handler_id: handlerId
          })
          .eq('id', leadId);

        if (error) throw error;
      }

      toast.success(`Handler ${handlerName} assigned successfully!`);

      // Refresh data
      await fetchData();
    } catch (error) {
      console.error('Error assigning handler:', error);
      toast.error('Failed to assign handler');
    } finally {
      setAssigningLeadId(null);
      setSelectedHandlerId(null);
    }
  };

  // Helper function to build client route (similar to CalendarPage.tsx)
  const buildClientRoute = (lead: UnassignedLead): string => {
    if (!lead) return '/clients';

    // For legacy leads
    if (lead.isLegacy) {
      const legacyId = typeof lead.id === 'string' && lead.id.startsWith('legacy_')
        ? lead.id.replace('legacy_', '')
        : lead.id;
      const isSubLead = lead.lead_number && lead.lead_number.includes('/');

      if (isSubLead) {
        // Legacy sublead: use numeric ID in path, formatted lead_number in query
        return `/clients/${encodeURIComponent(legacyId)}?lead=${encodeURIComponent(lead.lead_number || '')}`;
      } else {
        // Legacy master lead: use numeric ID
        return `/clients/${encodeURIComponent(legacyId)}`;
      }
    }
    // For new leads
    else if (lead.lead_number) {
      const isSubLead = lead.lead_number.includes('/');
      if (isSubLead) {
        // Sublead: extract base from lead_number
        const baseLeadNumber = lead.lead_number.split('/')[0];
        return `/clients/${encodeURIComponent(baseLeadNumber)}?lead=${encodeURIComponent(lead.lead_number)}`;
      } else {
        // Regular new lead: use lead_number
        return `/clients/${encodeURIComponent(lead.lead_number)}`;
      }
    }

    // Fallback: use id if lead_number is not available
    return `/clients/${encodeURIComponent(lead.id)}`;
  };

  const handleViewClient = (lead: UnassignedLead, event?: React.MouseEvent) => {
    const isNewTab = event?.metaKey || event?.ctrlKey;
    const navigationUrl = buildClientRoute(lead);

    if (isNewTab) {
      // Open in new tab
      window.open(navigationUrl, '_blank');
      return;
    }

    // Normal navigation in same tab
    navigate(navigationUrl);
  };

  const formatCurrency = (value: number, currency: string = 'NIS') => {
    // Normalize currency code - handle shekel symbol and various formats
    let normalizedCurrency = currency || 'NIS';

    // Convert shekel symbol (₪) or NIS to ILS (ISO code)
    if (normalizedCurrency === '₪' || normalizedCurrency === 'NIS' || normalizedCurrency === 'nis') {
      normalizedCurrency = 'ILS';
    }

    // Remove any non-ASCII characters that might cause issues
    normalizedCurrency = normalizedCurrency.replace(/[^\x20-\x7E]/g, '');

    // If still not a valid 3-letter code, default to ILS
    if (normalizedCurrency.length !== 3) {
      normalizedCurrency = 'ILS';
    }

    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: normalizedCurrency,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      }).format(value);
    } catch (error) {
      // Fallback if currency code is still invalid
      return `${normalizedCurrency} ${value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
    }
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  // Helper function to toggle category selection
  const toggleCategorySelection = (category: string) => {
    const currentCategories = selectedCategories || [];
    if (currentCategories.includes(category)) {
      setSelectedCategories(currentCategories.filter(c => c !== category));
    } else {
      setSelectedCategories([...currentCategories, category]);
    }
  };

  // Helper function to toggle stage selection
  const toggleStageSelection = (stageId: number) => {
    const currentStages = selectedStages || [];
    if (currentStages.includes(stageId)) {
      setSelectedStages(currentStages.filter(s => s !== stageId));
    } else {
      setSelectedStages([...currentStages, stageId]);
    }
  };

  // Get unique categories and stages for filters
  const uniqueCategories = Array.from(new Set(unassignedLeads.map(lead => lead.category).filter((cat): cat is string => Boolean(cat)))).sort();
  const uniqueStages = Array.from(new Set(unassignedLeads.map(lead => {
    const stageId = typeof lead.stage === 'number' ? lead.stage : Number(lead.stage);
    return isNaN(stageId) ? null : stageId;
  }).filter((id): id is number => id !== null))).sort((a, b) => a - b);

  // Filter categories and stages based on search
  const filteredCategories = uniqueCategories.filter((cat): cat is string =>
    cat !== undefined && cat !== null && cat.toLowerCase().includes(categorySearch.toLowerCase())
  );

  const filteredStages = uniqueStages.filter(stageId => {
    const stageName = getStageName(String(stageId));
    return stageName.toLowerCase().includes(stageSearch.toLowerCase()) ||
      String(stageId).includes(stageSearch);
  });

  // Get unique departments from handlers
  const uniqueDepartments = Array.from(new Set(handlers.map(h => h.department).filter(Boolean))).sort();

  // Filter handlers based on page search query and department filter
  let filteredHandlersForPage = handlers.filter(handler => {
    // Department filter
    if (selectedDepartment && handler.department !== selectedDepartment) {
      return false;
    }

    // Search query filter
    if (!pageEmployeeSearchQuery.trim()) return true;
    const query = pageEmployeeSearchQuery.toLowerCase();
    return handler.display_name.toLowerCase().includes(query) ||
      (handler.department && handler.department.toLowerCase().includes(query));
  });

  // Sort handlers if a sort column is selected
  if (sortColumn) {
    filteredHandlersForPage = [...filteredHandlersForPage].sort((a, b) => {
      let valueA: number;
      let valueB: number;

      switch (sortColumn) {
        case 'due':
          valueA = a.dueAmount || 0;
          valueB = b.dueAmount || 0;
          break;
        case 'newCases':
          valueA = a.newCasesCount;
          valueB = b.newCasesCount;
          break;
        case 'activeCases':
          valueA = a.activeCasesCount;
          valueB = b.activeCasesCount;
          break;
        case 'inProcess':
          valueA = a.inProcessCount || 0;
          valueB = b.inProcessCount || 0;
          break;
        case 'applicationsSent':
          valueA = a.applicationsSentCount || 0;
          valueB = b.applicationsSentCount || 0;
          break;
        case 'totalCases':
          valueA = a.newCasesCount + a.activeCasesCount;
          valueB = b.newCasesCount + b.activeCasesCount;
          break;
        default:
          return 0;
      }

      if (sortDirection === 'asc') {
        return valueA - valueB;
      } else {
        return valueB - valueA;
      }
    });
  }

  const handleSort = (column: 'due' | 'newCases' | 'activeCases' | 'inProcess' | 'applicationsSent' | 'totalCases') => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  // Filter handlers based on modal search query
  const filteredHandlersForModal = handlers.filter(handler => {
    if (!employeeSearchQuery.trim()) return true;
    const query = employeeSearchQuery.toLowerCase();
    return handler.display_name.toLowerCase().includes(query) ||
      (handler.department && handler.department.toLowerCase().includes(query));
  });

  const handleAssignClick = (leadId: string | number) => {
    setSelectedLeadForAssign(leadId);
    setEmployeeSearchQuery('');
    setShowAssignModal(true);
  };

  const handleAssignConfirm = (handlerId: number) => {
    if (selectedLeadForAssign) {
      assignHandler(selectedLeadForAssign, handlerId);
      setShowAssignModal(false);
      setSelectedLeadForAssign(null);
      setEmployeeSearchQuery('');
    }
  };

  const scrollToUnassignedLeads = () => {
    unassignedLeadsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const scrollToNextPayments = () => {
    nextPaymentsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <span className="loading loading-spinner loading-lg"></span>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[95vw] xl:max-w-[98vw] mx-auto px-2 sm:px-4 md:px-6 lg:px-8 xl:px-12 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Handler Management</h1>
        <p className="text-gray-600">Manage handlers and assign leads</p>
      </div>

      {/* Employee Search Bar and Department Filter */}
      <div className="mb-6 flex flex-col sm:flex-row gap-4">
        <div className="flex-1">
          <label className="label pb-2">
            <span className="label-text font-semibold">Search Employees</span>
          </label>
          <input
            type="text"
            placeholder="Search by name or department..."
            className="input input-bordered w-full"
            value={pageEmployeeSearchQuery}
            onChange={(e) => setPageEmployeeSearchQuery(e.target.value)}
          />
        </div>
        <div className="sm:w-64">
          <label className="label pb-2">
            <span className="label-text font-semibold">Department</span>
          </label>
          <select
            className="select select-bordered w-full"
            value={selectedDepartment}
            onChange={(e) => setSelectedDepartment(e.target.value)}
          >
            <option value="">All Departments</option>
            {uniqueDepartments.map(dept => (
              <option key={dept} value={dept}>{dept}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Summary Boxes */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        {/* Handlers Summary */}
        <div className="bg-blue-50 rounded-2xl shadow-md border border-blue-100 p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-3 bg-blue-100 rounded-xl">
              <UserGroupIcon className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Total Handlers</h3>
              <p className="text-3xl font-bold text-gray-900">{handlers.length}</p>
            </div>
          </div>
        </div>

        {/* Total Cases Summary */}
        <div className="bg-purple-50 rounded-2xl shadow-md border border-purple-100 p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-3 bg-purple-100 rounded-xl">
              <BriefcaseIcon className="w-6 h-6 text-purple-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Total Cases (New + Active)</h3>
              <p className="text-3xl font-bold text-gray-900">
                {handlers.reduce((sum, h) => sum + h.newCasesCount + h.activeCasesCount, 0)}
              </p>
            </div>
          </div>
        </div>

        {/* Unassigned Leads Summary */}
        <div className="bg-yellow-50 rounded-2xl shadow-md border border-yellow-100 p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-3 bg-yellow-100 rounded-xl">
              <DocumentTextIcon className="w-6 h-6 text-yellow-600" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-gray-900">Unassigned Leads</h3>
              <p className="text-3xl font-bold text-gray-900">{unassignedLeads.length}</p>
            </div>
          </div>
          <button
            onClick={scrollToUnassignedLeads}
            className="btn btn-sm btn-outline w-full mt-2"
          >
            View Table
          </button>
        </div>

        {/* Next Payments Summary */}
        <div className="bg-green-50 rounded-2xl shadow-md border border-green-100 p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-3 bg-green-100 rounded-xl">
              <CurrencyDollarIcon className="w-6 h-6 text-green-600" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-gray-900">Upcoming Payments</h3>
              <p className="text-3xl font-bold text-gray-900">{nextPayments.length}</p>
            </div>
          </div>
          <button
            onClick={() => {
              setShowNextPaymentsTable(!showNextPaymentsTable);
              if (!showNextPaymentsTable) {
                // Scroll to table when opening
                setTimeout(() => {
                  nextPaymentsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }, 100);
              }
            }}
            className="btn btn-sm btn-outline w-full mt-2"
          >
            {showNextPaymentsTable ? 'Hide Table' : 'View Table'}
          </button>
        </div>
      </div>

      {/* Handlers and Their Cases */}
      <div className="mb-8">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-gray-900">Handlers & Their Cases</h2>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">View:</span>
            <div className="btn-group">
              <button
                className={`btn btn-sm ${viewMode === 'boxes' ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setViewMode('boxes')}
              >
                Boxes
              </button>
              <button
                className={`btn btn-sm ${viewMode === 'table' ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setViewMode('table')}
              >
                Table
              </button>
            </div>
          </div>
        </div>

        {viewMode === 'boxes' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredHandlersForPage.map(handler => (
              <div
                key={handler.id}
                className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => navigate(`/case-manager?handlerId=${handler.id}`)}
              >
                <div className="flex items-center gap-3 mb-2">
                  <EmployeeAvatar employeeId={handler.id} size="md" />
                  <div className="flex-1">
                    <h3 className="font-semibold text-gray-900">{handler.display_name}</h3>
                    <p className="text-xs text-gray-500">{handler.department || 'Unknown'}</p>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-600">New Cases</p>
                    <p className="text-xl font-bold text-blue-600">{handler.newCasesCount}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Active Cases</p>
                    <p className="text-xl font-bold" style={{ color: 'rgb(25, 49, 31)' }}>{handler.activeCasesCount}</p>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-gray-200 grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-600">In Process</p>
                    <p className="text-lg font-bold text-gray-900">{handler.inProcessCount || 0}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Applications Sent</p>
                    <p className="text-lg font-bold text-gray-900">{handler.applicationsSentCount || 0}</p>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-gray-200">
                  <p className="text-sm text-gray-600">Due (Last 30 Days)</p>
                  <p className="text-lg font-bold text-gray-900">{formatCurrency(handler.dueAmount || 0, 'NIS')}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table w-full">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Department</th>
                  <th>
                    <button
                      className="flex items-center gap-1 hover:text-primary cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSort('due');
                      }}
                    >
                      Due
                      {sortColumn === 'due' && (
                        <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </button>
                  </th>
                  <th>
                    <button
                      className="flex items-center gap-1 hover:text-primary cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSort('newCases');
                      }}
                    >
                      New Cases
                      {sortColumn === 'newCases' && (
                        <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </button>
                  </th>
                  <th>
                    <button
                      className="flex items-center gap-1 hover:text-primary cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSort('activeCases');
                      }}
                    >
                      Active Cases
                      {sortColumn === 'activeCases' && (
                        <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </button>
                  </th>
                  <th>
                    <button
                      className="flex items-center gap-1 hover:text-primary cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSort('inProcess');
                      }}
                    >
                      In Process
                      {sortColumn === 'inProcess' && (
                        <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </button>
                  </th>
                  <th>
                    <button
                      className="flex items-center gap-1 hover:text-primary cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSort('applicationsSent');
                      }}
                    >
                      Applications Sent
                      {sortColumn === 'applicationsSent' && (
                        <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </button>
                  </th>
                  <th className="bg-green-50">
                    <button
                      className="flex items-center gap-1 hover:text-primary cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSort('totalCases');
                      }}
                    >
                      Total Cases (New + Active)
                      {sortColumn === 'totalCases' && (
                        <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredHandlersForPage.map(handler => (
                  <tr
                    key={handler.id}
                    className="hover cursor-pointer"
                    onClick={() => navigate(`/case-manager?handlerId=${handler.id}`)}
                  >
                    <td>
                      <div className="flex items-center gap-3">
                        <EmployeeAvatar employeeId={handler.id} size="md" />
                        <span className="font-semibold text-gray-900">{handler.display_name}</span>
                      </div>
                    </td>
                    <td>
                      <span className="text-gray-700">{handler.department || 'Unknown'}</span>
                    </td>
                    <td>
                      <span className="text-gray-900 font-semibold">
                        {formatCurrency(handler.dueAmount || 0, 'NIS')}
                      </span>
                    </td>
                    <td>
                      <span className="text-gray-900">{handler.newCasesCount}</span>
                    </td>
                    <td>
                      <span className="text-gray-900">{handler.activeCasesCount}</span>
                    </td>
                    <td>
                      <span className="text-gray-900">{handler.inProcessCount || 0}</span>
                    </td>
                    <td>
                      <span className="text-gray-900">{handler.applicationsSentCount || 0}</span>
                    </td>
                    <td className="bg-green-50">
                      <span className="text-gray-900">{handler.newCasesCount + handler.activeCasesCount}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Unassigned Leads */}
      <div ref={unassignedLeadsRef} className="mb-8">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Unassigned Leads (From stage Client signed Agreement)</h2>

        {/* Filters */}
        {unassignedLeads.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-4">
            {/* Category Filter */}
            <div className="relative flex-1 min-w-[200px]">
              <label className="block text-sm font-medium text-gray-700 mb-1">Main Category (Multi-select)</label>
              <input
                type="text"
                className="w-full mb-2 px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Search main categories..."
                value={categorySearch}
                onChange={(e) => {
                  setCategorySearch(e.target.value);
                  if (!showCategoryDropdown) {
                    setShowCategoryDropdown(true);
                  }
                }}
                onFocus={() => setShowCategoryDropdown(true)}
              />
              <div
                className="w-full min-h-[42px] px-3 py-2 border border-gray-300 rounded-md focus-within:outline-none focus-within:ring-2 focus-within:ring-blue-500 cursor-text flex flex-wrap gap-2 items-center"
                onClick={() => setShowCategoryDropdown(true)}
              >
                {selectedCategories && selectedCategories.length > 0 ? (
                  selectedCategories.map((category) => (
                    <div
                      key={category}
                      className="badge badge-primary badge-sm flex items-center gap-1"
                    >
                      <span>{category}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleCategorySelection(category);
                        }}
                        className="ml-1 hover:bg-primary-focus rounded-full p-0.5"
                      >
                        <XMarkIcon className="w-3 h-3" />
                      </button>
                    </div>
                  ))
                ) : (
                  <span className="text-gray-400 text-sm">Click to select main categories...</span>
                )}
              </div>
              {showCategoryDropdown && (
                <>
                  <div
                    className="fixed inset-0 z-[5]"
                    onClick={() => setShowCategoryDropdown(false)}
                  />
                  <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                    <div
                      className="px-4 py-2 cursor-pointer hover:bg-gray-100 text-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedCategories([]);
                        setCategorySearch('');
                      }}
                    >
                      Clear All
                    </div>
                    <div className="border-t border-gray-200 my-1"></div>
                    {filteredCategories.map((cat) => {
                      const isSelected = selectedCategories?.includes(cat) || false;
                      return (
                        <div
                          key={cat}
                          className="px-4 py-2 cursor-pointer hover:bg-gray-100 text-sm flex items-center gap-2"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleCategorySelection(cat);
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleCategorySelection(cat)}
                            onClick={(e) => e.stopPropagation()}
                            className="checkbox checkbox-sm checkbox-primary"
                          />
                          <span className={isSelected ? 'font-semibold' : ''}>{cat}</span>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            {/* Stage Filter */}
            <div className="relative flex-1 min-w-[200px]">
              <label className="block text-sm font-medium text-gray-700 mb-1">Stage (Multi-select)</label>
              <input
                type="text"
                className="w-full mb-2 px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Search stages..."
                value={stageSearch}
                onChange={(e) => {
                  setStageSearch(e.target.value);
                  if (!showStageDropdown) {
                    setShowStageDropdown(true);
                  }
                }}
                onFocus={() => setShowStageDropdown(true)}
              />
              <div
                className="w-full min-h-[42px] px-3 py-2 border border-gray-300 rounded-md focus-within:outline-none focus-within:ring-2 focus-within:ring-blue-500 cursor-text flex flex-wrap gap-2 items-center"
                onClick={() => setShowStageDropdown(true)}
              >
                {selectedStages && selectedStages.length > 0 ? (
                  selectedStages.map((stageId) => {
                    const stageName = getStageName(String(stageId));
                    return (
                      <div
                        key={stageId}
                        className="badge badge-primary badge-sm flex items-center gap-1 max-w-full"
                      >
                        <span className="truncate text-xs">{stageName} ({stageId})</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleStageSelection(stageId);
                          }}
                          className="ml-1 hover:bg-primary-focus rounded-full p-0.5 flex-shrink-0"
                        >
                          <XMarkIcon className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })
                ) : (
                  <span className="text-gray-400 text-sm">Click to select stages...</span>
                )}
              </div>
              {showStageDropdown && (
                <>
                  <div
                    className="fixed inset-0 z-[5]"
                    onClick={() => setShowStageDropdown(false)}
                  />
                  <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                    <div
                      className="px-4 py-2 cursor-pointer hover:bg-gray-100 text-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedStages([]);
                        setStageSearch('');
                      }}
                    >
                      Clear All
                    </div>
                    <div className="border-t border-gray-200 my-1"></div>
                    {filteredStages.map((stageId) => {
                      const isSelected = selectedStages?.includes(stageId) || false;
                      const stageName = getStageName(String(stageId));
                      return (
                        <div
                          key={stageId}
                          className="px-4 py-2 cursor-pointer hover:bg-gray-100 text-sm flex items-center gap-2"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleStageSelection(stageId);
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleStageSelection(stageId)}
                            onClick={(e) => e.stopPropagation()}
                            className="checkbox checkbox-sm checkbox-primary"
                          />
                          <span className={isSelected ? 'font-semibold' : ''}>{stageName} ({stageId})</span>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            {/* Assign Buttons */}
            <div className="flex items-end gap-2">
              <button
                className="btn btn-primary"
                onClick={() => {
                  if (!isSelectionMode) {
                    // Enable selection mode
                    setIsSelectionMode(true);
                    setSelectedLeads(new Set());
                  } else {
                    // If in selection mode and has selections, show assignment box
                    if (selectedLeads.size === 0) {
                      // Cancel selection mode if no leads selected
                      setIsSelectionMode(false);
                      setSelectedLeads(new Set());
                      return;
                    }
                    setShowSelectedLeadsAssignBox(true);
                  }
                }}
              >
                {isSelectionMode
                  ? selectedLeads.size > 0
                    ? `Assign Selected Leads (${selectedLeads.size})`
                    : 'Cancel Selection'
                  : 'Assign Selected Leads'
                }
              </button>
              {isSelectionMode && (
                <button
                  className="btn btn-circle btn-outline"
                  onClick={() => {
                    setIsSelectionMode(false);
                    setSelectedLeads(new Set());
                  }}
                  title="Cancel Selection"
                >
                  <XMarkIcon className="w-5 h-5" />
                </button>
              )}
              <button
                className="btn btn-primary"
                onClick={() => {
                  const filteredLeads = unassignedLeads.filter(lead => {
                    const categoryMatch = selectedCategories.length === 0 || (lead.category && selectedCategories.includes(lead.category));
                    const stageMatch = selectedStages.length === 0 || (() => {
                      const stageId = typeof lead.stage === 'number' ? lead.stage : Number(lead.stage);
                      return !isNaN(stageId) && selectedStages.includes(stageId);
                    })();
                    return categoryMatch && stageMatch;
                  });

                  if (filteredLeads.length === 0) {
                    toast.error('No leads to assign. Please adjust your filters.');
                    return;
                  }

                  setShowAssignMultipleModal(true);
                }}
                disabled={unassignedLeads.length === 0}
              >
                Assign Multiple Leads
              </button>
            </div>
          </div>
        )}

        {/* Filtered Leads Count */}
        {unassignedLeads.length > 0 && (
          <div className="mb-4 text-sm text-gray-600">
            Showing {unassignedLeads.filter(lead => {
              const categoryMatch = selectedCategories.length === 0 || (lead.category && selectedCategories.includes(lead.category));
              const stageMatch = selectedStages.length === 0 || (() => {
                const stageId = typeof lead.stage === 'number' ? lead.stage : Number(lead.stage);
                return !isNaN(stageId) && selectedStages.includes(stageId);
              })();
              return categoryMatch && stageMatch;
            }).length} of {unassignedLeads.length} leads
          </div>
        )}

        {unassignedLeads.length === 0 ? (
          <p className="text-gray-500 text-center py-8">No unassigned leads found</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table w-full">
              <thead>
                <tr>
                  {isSelectionMode && (
                    <th>
                      <input
                        type="checkbox"
                        className="checkbox checkbox-sm"
                        checked={selectedLeads.size > 0 && selectedLeads.size === unassignedLeads.filter(lead => {
                          const categoryMatch = selectedCategories.length === 0 || (lead.category && selectedCategories.includes(lead.category));
                          const stageMatch = selectedStages.length === 0 || (() => {
                            const stageId = typeof lead.stage === 'number' ? lead.stage : Number(lead.stage);
                            return !isNaN(stageId) && selectedStages.includes(stageId);
                          })();
                          return categoryMatch && stageMatch;
                        }).length}
                        onChange={(e) => {
                          const filteredLeads = unassignedLeads.filter(lead => {
                            const categoryMatch = selectedCategories.length === 0 || (lead.category && selectedCategories.includes(lead.category));
                            const stageMatch = selectedStages.length === 0 || (() => {
                              const stageId = typeof lead.stage === 'number' ? lead.stage : Number(lead.stage);
                              return !isNaN(stageId) && selectedStages.includes(stageId);
                            })();
                            return categoryMatch && stageMatch;
                          });

                          if (e.target.checked) {
                            setSelectedLeads(new Set(filteredLeads.map(lead => lead.id)));
                          } else {
                            setSelectedLeads(new Set());
                          }
                        }}
                      />
                    </th>
                  )}
                  <th>Lead Name</th>
                  <th>Lead Number</th>
                  <th>Category</th>
                  <th>Topic</th>
                  <th>Stage</th>
                  <th>Signed</th>
                  <th>Total Applicants</th>
                  <th>Total</th>
                  <th>Assign Handler</th>
                </tr>
              </thead>
              <tbody>
                {unassignedLeads.filter(lead => {
                  const categoryMatch = selectedCategories.length === 0 || (lead.category && selectedCategories.includes(lead.category));
                  const stageMatch = selectedStages.length === 0 || (() => {
                    const stageId = typeof lead.stage === 'number' ? lead.stage : Number(lead.stage);
                    return !isNaN(stageId) && selectedStages.includes(stageId);
                  })();
                  return categoryMatch && stageMatch;
                }).map(lead => (
                  <tr
                    key={lead.id}
                    className={`cursor-pointer hover:bg-gray-50 ${selectedLeads.has(lead.id) ? 'bg-blue-50' : ''}`}
                    onClick={(e) => {
                      // Don't open modal if clicking on checkbox or assign button
                      if ((e.target as HTMLElement).closest('input[type="checkbox"]') ||
                        (e.target as HTMLElement).closest('button.btn')) {
                        return;
                      }
                      // Use the lead ID directly - it's already formatted correctly (legacy_ prefix for legacy leads)
                      setSelectedLeadForModal({ id: lead.id, name: lead.name });
                      setShowLeadDetailsModal(true);
                    }}
                  >
                    {isSelectionMode && (
                      <td onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          className="checkbox checkbox-sm"
                          checked={selectedLeads.has(lead.id)}
                          onChange={(e) => {
                            e.stopPropagation();
                            setSelectedLeads(prev => {
                              const newSet = new Set(prev);
                              if (e.target.checked) {
                                newSet.add(lead.id);
                              } else {
                                newSet.delete(lead.id);
                              }
                              return newSet;
                            });
                          }}
                        />
                      </td>
                    )}
                    <td>
                      <button
                        className="text-blue-600 hover:underline"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleViewClient(lead, e);
                        }}
                      >
                        {lead.name}
                      </button>
                    </td>
                    <td>{lead.lead_number || (lead.isLegacy ? lead.id.toString().replace('legacy_', '') : String(lead.id))}</td>
                    <td>{lead.category || 'No Category'}</td>
                    <td>{lead.topic || 'N/A'}</td>
                    <td>{lead.stage_name || lead.stage}</td>
                    <td>{lead.signed_date ? formatDate(lead.signed_date) : 'N/A'}</td>
                    <td>{lead.applicantsCount ?? 0}</td>
                    <td>{formatCurrency(lead.total || 0, lead.currency)}</td>
                    <td>
                      <button
                        className="btn btn-sm btn-outline"
                        disabled={assigningLeadId === lead.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAssignClick(lead.id);
                        }}
                      >
                        {assigningLeadId === lead.id ? (
                          <span className="loading loading-spinner loading-xs"></span>
                        ) : (
                          'Assign'
                        )}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Next Payments */}
      {showNextPaymentsTable && (
        <div ref={nextPaymentsRef}>
          <h2 className="text-xl font-bold text-gray-900 mb-4">Next Payments (Unassigned Leads)</h2>
          {nextPayments.length === 0 ? (
            <p className="text-gray-500 text-center py-8">No upcoming payments found</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="table w-full">
                <thead>
                  <tr>
                    <th>Contact</th>
                    <th>Category</th>
                    <th>Due Date</th>
                    <th>Amount</th>
                    <th>Assign Handler</th>
                  </tr>
                </thead>
                <tbody>
                  {nextPayments.map((payment, index) => (
                    <tr key={`${payment.lead_id}-${index}`}>
                      <td>
                        <button
                          className="text-blue-600 hover:underline"
                          onClick={(e) => {
                            // Try to find the lead in unassignedLeads to get lead_number
                            const matchingLead = unassignedLeads.find(lead => lead.id === payment.lead_id);

                            // Convert payment to UnassignedLead-like object for buildClientRoute
                            const leadForRoute: UnassignedLead = {
                              id: payment.lead_id,
                              name: payment.contact_name,
                              lead_number: matchingLead?.lead_number || (payment.isLegacy ? payment.lead_id.toString().replace('legacy_', '') : payment.lead_id.toString()),
                              stage: 0,
                              isLegacy: payment.isLegacy
                            };
                            handleViewClient(leadForRoute, e);
                          }}
                        >
                          {payment.contact_name}
                        </button>
                      </td>
                      <td>{payment.category || 'No Category'}</td>
                      <td>{formatDate(payment.due_date || payment.date || '')}</td>
                      <td>{formatCurrency(payment.value, payment.currency)}</td>
                      <td>
                        <button
                          className="btn btn-sm btn-outline"
                          disabled={assigningLeadId === payment.lead_id}
                          onClick={() => handleAssignClick(payment.lead_id)}
                        >
                          {assigningLeadId === payment.lead_id ? (
                            <span className="loading loading-spinner loading-xs"></span>
                          ) : (
                            'Assign'
                          )}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Assign Handler Modal */}
      {showAssignModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-[1400px] w-full mx-4 max-h-[80vh] flex flex-col">
            <div className="p-6 border-b border-gray-200">
              <h3 className="text-xl font-bold text-gray-900">Assign Handler</h3>
              <p className="text-sm text-gray-600 mt-1">Search and select an employee to assign</p>
            </div>
            <div className="p-6 flex-1 overflow-y-auto">
              <div className="mb-4">
                <input
                  type="text"
                  placeholder="Search by name or department..."
                  className="input input-bordered w-full"
                  value={employeeSearchQuery}
                  onChange={(e) => setEmployeeSearchQuery(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {filteredHandlersForModal.length === 0 ? (
                  <p className="text-center text-gray-500 py-8">No employees found</p>
                ) : (
                  filteredHandlersForModal.map(handler => (
                    <button
                      key={handler.id}
                      onClick={() => handleAssignConfirm(handler.id)}
                      className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-gray-100 transition-colors text-left border border-gray-200"
                    >
                      <EmployeeAvatar employeeId={handler.id} size="md" />
                      <div className="flex-1 min-w-[150px]">
                        <p className="font-semibold text-gray-900">{handler.display_name}</p>
                        {handler.department && (
                          <p className="text-sm text-gray-500">{handler.department}</p>
                        )}
                      </div>
                      <div className="flex-shrink-0 flex items-center gap-4">
                        <div className="text-center min-w-[100px]">
                          <p className="text-xs text-gray-500">First Payment</p>
                          <p className="text-sm font-semibold text-gray-900">
                            {formatCurrency(handler.firstPaymentDue || 0, 'NIS')}
                          </p>
                        </div>
                        <div className="text-center min-w-[120px]">
                          <p className="text-xs text-gray-500">Intermediate Payment</p>
                          <p className="text-sm font-semibold text-gray-900">
                            {formatCurrency(handler.intermediatePaymentDue || 0, 'NIS')}
                          </p>
                        </div>
                        <div className="text-center min-w-[140px]">
                          <p className="text-xs text-gray-500">Final (Germany)</p>
                          <p className="text-sm font-semibold text-gray-900">
                            {formatCurrency(handler.finalPaymentDueGermany || 0, 'NIS')}
                          </p>
                        </div>
                        <div className="text-center min-w-[140px]">
                          <p className="text-xs text-gray-500">Final (Austria)</p>
                          <p className="text-sm font-semibold text-gray-900">
                            {formatCurrency(handler.finalPaymentDueAustria || 0, 'NIS')}
                          </p>
                        </div>
                        <div className="text-center min-w-[80px]">
                          <p className="text-xs text-gray-500">New Cases</p>
                          <p className="text-sm font-semibold text-gray-900">{handler.newCasesCount ?? 0}</p>
                        </div>
                        <div className="text-center min-w-[90px]">
                          <p className="text-xs text-gray-500">Active Cases</p>
                          <p className="text-sm font-semibold" style={{ color: 'rgb(25, 49, 31)' }}>
                            {handler.activeCasesCount ?? 0}
                          </p>
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
            <div className="p-6 border-t border-gray-200 flex justify-end gap-2">
              <button
                className="btn btn-outline"
                onClick={() => {
                  setShowAssignModal(false);
                  setSelectedLeadForAssign(null);
                  setEmployeeSearchQuery('');
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lead Details Modal */}
      <LeadDetailsModal
        isOpen={showLeadDetailsModal}
        onClose={() => {
          setShowLeadDetailsModal(false);
          setSelectedLeadForModal(null);
        }}
        leadId={selectedLeadForModal?.id || ''}
        leadName={selectedLeadForModal?.name}
      />

      {/* Assign Multiple Leads Modal */}
      <AssignMultipleLeadsModal
        isOpen={showAssignMultipleModal}
        onClose={() => setShowAssignMultipleModal(false)}
        leads={unassignedLeads.filter(lead => {
          const categoryMatch = selectedCategories.length === 0 || (lead.category && selectedCategories.includes(lead.category));
          const stageMatch = selectedStages.length === 0 || (() => {
            const stageId = typeof lead.stage === 'number' ? lead.stage : Number(lead.stage);
            return !isNaN(stageId) && selectedStages.includes(stageId);
          })();
          return categoryMatch && stageMatch;
        })}
        handlers={handlers}
        onAssignComplete={async () => {
          // Refresh the data after assignment
          await fetchData();
        }}
      />

      {/* Floating Assign Selected Leads Box */}
      {showSelectedLeadsAssignBox && selectedLeads.size > 0 && (
        <>
          {/* Background Overlay */}
          <div
            className="fixed inset-0 bg-black bg-opacity-50 z-40"
            onClick={() => {
              setShowSelectedLeadsAssignBox(false);
              setSelectedLeadsHandlerSearch('');
              setIsSelectionMode(false);
              setSelectedLeads(new Set());
            }}
          />
          {/* Modal */}
          <div className="fixed top-20 right-4 bg-white rounded-lg shadow-2xl border border-gray-200 z-50 w-[1200px] max-h-[80vh] flex flex-col">
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-gray-900">Assign Selected Leads</h3>
                <p className="text-sm text-gray-600 mt-1">{selectedLeads.size} lead{selectedLeads.size !== 1 ? 's' : ''} selected</p>
              </div>
              <button
                onClick={() => {
                  setShowSelectedLeadsAssignBox(false);
                  setSelectedLeadsHandlerSearch('');
                  setIsSelectionMode(false);
                  setSelectedLeads(new Set());
                }}
                className="btn btn-sm btn-circle btn-ghost"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 flex-1 overflow-y-auto">
              <div className="mb-4">
                <input
                  type="text"
                  placeholder="Search employee..."
                  className="input input-bordered w-full"
                  value={selectedLeadsHandlerSearch}
                  onChange={(e) => setSelectedLeadsHandlerSearch(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {handlers.filter(handler =>
                  handler.display_name.toLowerCase().includes(selectedLeadsHandlerSearch.toLowerCase()) ||
                  handler.department?.toLowerCase().includes(selectedLeadsHandlerSearch.toLowerCase())
                ).length === 0 ? (
                  <p className="text-center text-gray-500 py-8">No employees found</p>
                ) : (
                  handlers
                    .filter(handler =>
                      handler.display_name.toLowerCase().includes(selectedLeadsHandlerSearch.toLowerCase()) ||
                      handler.department?.toLowerCase().includes(selectedLeadsHandlerSearch.toLowerCase())
                    )
                    .map(handler => (
                      <button
                        key={handler.id}
                        className="w-full p-3 hover:bg-gray-50 rounded-lg border border-gray-200 flex items-center gap-3 text-left"
                        onClick={async () => {
                          if (assigningSelectedLeads) return;

                          setAssigningSelectedLeads(true);
                          try {
                            const selectedLeadsArray = Array.from(selectedLeads);
                            let successCount = 0;
                            let errorCount = 0;

                            for (const leadId of selectedLeadsArray) {
                              try {
                                const lead = unassignedLeads.find(l => l.id === leadId);
                                if (!lead) {
                                  errorCount++;
                                  continue;
                                }

                                await assignHandler(leadId, handler.id);
                                successCount++;
                              } catch (error) {
                                console.error('Error assigning lead:', error);
                                errorCount++;
                              }
                            }

                            if (errorCount === 0) {
                              toast.success(`Successfully assigned ${successCount} lead(s) to ${handler.display_name}`);
                            } else {
                              toast.success(`Assigned ${successCount} lead(s), ${errorCount} failed`);
                            }

                            // Clear selection and close box
                            setSelectedLeads(new Set());
                            setShowSelectedLeadsAssignBox(false);
                            setSelectedLeadsHandlerSearch('');
                            setIsSelectionMode(false);

                            // Refresh data
                            await fetchData();
                          } catch (error: any) {
                            console.error('Error assigning leads:', error);
                            toast.error('Failed to assign leads');
                          } finally {
                            setAssigningSelectedLeads(false);
                          }
                        }}
                        disabled={assigningSelectedLeads}
                      >
                        <EmployeeAvatar employeeId={handler.id} size="md" />
                        <div className="flex-1 min-w-[150px]">
                          <p className="font-medium text-gray-900">{handler.display_name}</p>
                          {handler.department && (
                            <p className="text-sm text-gray-500">{handler.department}</p>
                          )}
                        </div>
                        <div className="flex-shrink-0 flex items-center gap-4">
                          <div className="text-center min-w-[100px]">
                            <p className="text-xs text-gray-500">First Payment</p>
                            <p className="text-sm font-semibold text-gray-900">
                              {formatCurrency(handler.firstPaymentDue || 0, 'NIS')}
                            </p>
                          </div>
                          <div className="text-center min-w-[120px]">
                            <p className="text-xs text-gray-500">Intermediate Payment</p>
                            <p className="text-sm font-semibold text-gray-900">
                              {formatCurrency(handler.intermediatePaymentDue || 0, 'NIS')}
                            </p>
                          </div>
                          <div className="text-center min-w-[140px]">
                            <p className="text-xs text-gray-500">Final (Germany)</p>
                            <p className="text-sm font-semibold text-gray-900">
                              {formatCurrency(handler.finalPaymentDueGermany || 0, 'NIS')}
                            </p>
                          </div>
                          <div className="text-center min-w-[140px]">
                            <p className="text-xs text-gray-500">Final (Austria)</p>
                            <p className="text-sm font-semibold text-gray-900">
                              {formatCurrency(handler.finalPaymentDueAustria || 0, 'NIS')}
                            </p>
                          </div>
                          <div className="text-center min-w-[80px]">
                            <p className="text-xs text-gray-500">New Cases</p>
                            <p className="text-sm font-semibold text-gray-900">{handler.newCasesCount ?? 0}</p>
                          </div>
                          <div className="text-center min-w-[90px]">
                            <p className="text-xs text-gray-500">Active Cases</p>
                            <p className="text-sm font-semibold" style={{ color: 'rgb(25, 49, 31)' }}>
                              {handler.activeCasesCount ?? 0}
                            </p>
                          </div>
                        </div>
                      </button>
                    ))
                )}
              </div>
            </div>
            {assigningSelectedLeads && (
              <div className="p-4 border-t border-gray-200 bg-gray-50">
                <div className="flex items-center justify-center gap-2 text-gray-600">
                  <span className="loading loading-spinner loading-sm"></span>
                  <span className="text-sm">Assigning leads...</span>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default HandlerManagementPage;
