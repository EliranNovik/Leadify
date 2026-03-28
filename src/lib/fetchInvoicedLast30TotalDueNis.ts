import { supabase } from './supabase';
import { convertToNIS } from './currencyConversion';

function normalizeDateOnly(s: string): string {
  if (!s || !String(s).trim()) return '';
  return String(s).trim().split('T')[0];
}

/**
 * Total "due" in NIS for the Invoiced table **Total** column — same logic as Dashboard `fetchInvoicedData`,
 * but payments are included when `due_date` falls in **[fromDateStr, toDateStr]** (inclusive, YYYY-MM-DD),
 * matching the Sales Contribution report date filter (not fixed to last 30 days).
 */
export async function fetchInvoicedTotalDueNisForDateRange(fromDateStr: string, toDateStr: string): Promise<number> {
  const rangeStart = normalizeDateOnly(fromDateStr);
  const rangeEnd = normalizeDateOnly(toDateStr);
  if (!rangeStart || !rangeEnd || rangeStart > rangeEnd) {
    return 0;
  }

  try {
      const now = new Date();
      const today = new Date();

      const selectedMonthIndex = now.getMonth();
      const selectedYear = now.getFullYear();
      const selectedDate = new Date(selectedYear, selectedMonthIndex, 1);
      const selectedMonthName = selectedDate.toLocaleDateString('en-US', { month: 'long' });

      let departmentTargets: any[];
      let departmentIds: number[];
      let allCategoriesData: any[] | null;

      const { data: allDepartments, error: departmentsError } = await supabase
        .from('tenant_departement')
        .select('id, name, min_income, important')
        .eq('important', 't')
        .order('id');
      if (departmentsError) throw departmentsError;

      let deptTargets = (allDepartments || []).filter((dept: any) => {
        if (dept.id === 20) return true;
        if (dept.name === 'Commercial - Sales' || dept.name?.includes('Commercial - Sales')) return false;
        const hasDept20 = (allDepartments || []).some((d: any) => d.id === 20);
        if (hasDept20 && (dept.name === 'Commercial & Civil' || dept.name?.includes('Commercial & Civil'))) return false;
        return true;
      });
      departmentTargets = deptTargets.map((dept: any) => (dept.id === 20 ? { ...dept, name: 'Commercial & Civil' } : dept));
      departmentIds = departmentTargets.map((d: any) => d.id);

      const { data: categoriesData, error: categoriesError } = await supabase
        .from('misc_category')
        .select(`
          id, name, parent_id,
          misc_maincategory!parent_id(
            id, name, department_id,
            tenant_departement!fk_misc_maincategory_department_id(id, name)
          )
        `)
        .order('name', { ascending: true });
      if (categoriesError) console.error('Error fetching categories for invoiced department mapping:', categoriesError);
      allCategoriesData = categoriesData || null;

      const categoryNameToDataMap = new Map<string, any>();
      if (allCategoriesData) {
        (allCategoriesData || []).forEach((category: any) => {
          if (category.name) categoryNameToDataMap.set(category.name.trim().toLowerCase(), category);
        });
      }

      // Helper function to resolve category and get department (same as CollectionDueReport)
      const resolveCategoryAndDepartment = (
        categoryValue?: string | null,
        categoryId?: string | number | null,
        miscCategory?: any
      ): { departmentId: number | null; departmentName: string } => {
        let resolvedMiscCategory = miscCategory;

        // If miscCategory join failed but we have categoryId, try to find by ID in allCategoriesData
        if (!resolvedMiscCategory && categoryId !== null && categoryId !== undefined && allCategoriesData) {
          const numericId = typeof categoryId === 'number' ? categoryId : Number(categoryId);
          if (!Number.isNaN(numericId)) {
            const foundById = (allCategoriesData || []).find((cat: any) => cat.id === numericId);
            if (foundById) {
              resolvedMiscCategory = foundById;
            }
          }
        }

        // If we still don't have a category but have categoryValue, try to look it up in the map by name
        if (!resolvedMiscCategory && categoryValue && categoryValue.trim() !== '' && categoryNameToDataMap.size > 0) {
          const normalizedName = categoryValue.trim().toLowerCase();
          const mappedCategory = categoryNameToDataMap.get(normalizedName);
          if (mappedCategory) {
            resolvedMiscCategory = mappedCategory;
          }
        }

        if (!resolvedMiscCategory) {
          return { departmentId: null, departmentName: '—' };
        }

        const categoryRecord = Array.isArray(resolvedMiscCategory) ? resolvedMiscCategory[0] : resolvedMiscCategory;
        if (!categoryRecord) {
          return { departmentId: null, departmentName: '—' };
        }

        let mainCategory = Array.isArray(categoryRecord.misc_maincategory)
          ? categoryRecord.misc_maincategory[0]
          : categoryRecord.misc_maincategory;

        if (!mainCategory) {
          return { departmentId: null, departmentName: categoryRecord.name || '—' };
        }

        const department = mainCategory.tenant_departement
          ? (Array.isArray(mainCategory.tenant_departement) ? mainCategory.tenant_departement[0] : mainCategory.tenant_departement)
          : null;

        const departmentId = department?.id || mainCategory.department_id || null;
        const departmentName = department?.name || mainCategory.name || categoryRecord.name || '—';

        return { departmentId, departmentName };
      };

      // Create target map (department ID -> min_income)
      const targetMap: { [key: number]: number } = {};
      departmentTargets.forEach(dept => {
        targetMap[dept.id] = parseFloat(dept.min_income || '0');
      });

      // Calculate date ranges (income total uses rangeStart/rangeEnd for due_date filter)
      const todayStr = today.toISOString().split('T')[0];
      const startOfMonth = new Date(Date.UTC(selectedYear, selectedMonthIndex, 1));
      const startOfMonthStr = startOfMonth.toISOString().split('T')[0];
      const endOfMonthStr = new Date(selectedYear, selectedMonthIndex + 1, 0).toISOString().split('T')[0];

      console.log('🔍 Invoiced total due (income) — due_date filter range:', {
        rangeStart,
        rangeEnd,
        note: 'Matches Sales Contribution From/To date filters',
      });
      // Calculate date ranges for invoiced data
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];
      const oneWeekAgo = new Date(today);
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
      const oneWeekAgoStr = oneWeekAgo.toISOString().split('T')[0];

      // Initialize invoiced data structure
      const newInvoicedData = {
        Today: [
          { count: 0, amount: 0, expected: 0 }, // General (index 0)
          ...departmentTargets.map(dept => ({
            count: 0,
            amount: 0,
            expected: parseFloat(dept.min_income || '0')
          })), // Actual departments
          { count: 0, amount: 0, expected: 0 }, // Total (last index)
        ],
        Yesterday: [
          { count: 0, amount: 0, expected: 0 }, // General (index 0)
          ...departmentTargets.map(dept => ({
            count: 0,
            amount: 0,
            expected: parseFloat(dept.min_income || '0')
          })), // Actual departments
          { count: 0, amount: 0, expected: 0 }, // Total (last index)
        ],
        Week: [
          { count: 0, amount: 0, expected: 0 }, // General (index 0)
          ...departmentTargets.map(dept => ({
            count: 0,
            amount: 0,
            expected: parseFloat(dept.min_income || '0')
          })), // Actual departments
          { count: 0, amount: 0, expected: 0 }, // Total (last index)
        ],
        "Last 30d": [
          { count: 0, amount: 0, expected: 0 }, // General (index 0)
          ...departmentTargets.map(dept => ({
            count: 0,
            amount: 0,
            expected: parseFloat(dept.min_income || '0')
          })), // Actual departments
          { count: 0, amount: 0, expected: 0 }, // Total (last index)
        ],
        [selectedMonthName]: [
          ...departmentTargets.map(dept => ({
            count: 0,
            amount: 0,
            expected: parseFloat(dept.min_income || '0')
          })), // Actual departments (no General for month)
          { count: 0, amount: 0, expected: 0 }, // Total (last index)
        ],
      };

      // Fetch new payment plans - show all payments with due_date (both paid and unpaid)
      // Note: We don't filter by date range here because we need data for multiple periods (Today, Last 30d, Month)
      // We'll filter by date in the processing step
      console.log('🔍 Invoiced Data - Fetching new payment plans with ready_to_pay=true (showing all, paid and unpaid)...');
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
          paid
        `)
        .eq('ready_to_pay', true)
        .not('due_date', 'is', null)
        .is('cancel_date', null);

      const { data: newPayments, error: newError } = await newPaymentsQuery;
      if (newError) {
        console.error('❌ Invoiced Data - Error fetching new payments:', newError);
        throw newError;
      }
      console.log('✅ Invoiced Data - Fetched new payments:', newPayments?.length || 0);

      // Filter out any payments with cancel_date (safety check)
      const filteredNewPayments = (newPayments || []).filter(p => !p.cancel_date);
      if (filteredNewPayments.length !== (newPayments || []).length) {
        console.log('⚠️ Invoiced Data - Filtered out', (newPayments || []).length - filteredNewPayments.length, 'new payments with cancel_date');
      }

      if (filteredNewPayments.length > 0) {
        console.log('📊 Invoiced Data - Sample new payment:', {
          id: filteredNewPayments[0].id,
          lead_id: filteredNewPayments[0].lead_id,
          due_date: filteredNewPayments[0].due_date,
          value: filteredNewPayments[0].value,
          ready_to_pay: filteredNewPayments[0].ready_to_pay,
          paid: filteredNewPayments[0].paid
        });
      }

      // Fetch legacy payment plans from finances_paymentplanrow
      // IMPORTANT: Match Collection Due Report - NO ready_to_pay filter, only filter by due_date IS NOT NULL
      // Use pagination to fetch ALL records (Supabase limit is 1000 per query)
      // Note: We don't filter by date range here because we need data for multiple periods (Today, Last 30d, Month)
      // We'll filter by date in the processing step
      console.log('🔍 Invoiced Data - Fetching legacy payment plans (matching Collection Due Report - all with due_date, no ready_to_pay filter, using pagination)...');

      let allLegacyPayments: any[] = [];
      const batchSize = 1000; // Supabase limit
      let offset = 0;
      let hasMore = true;
      let batchNumber = 0;

      while (hasMore) {
        batchNumber++;
        const { data: batch, error: batchError } = await supabase
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
            accounting_currencies!finances_paymentplanrow_currency_id_fkey(name, iso_code)
          `)
          .not('due_date', 'is', null) // ONLY filter by due_date - fetch all payments with due_date set (regardless of ready_to_pay flag)
          .is('cancel_date', null) // Exclude cancelled payments only - show both paid and unpaid payments
          .order('id', { ascending: true }) // Order by id for consistent pagination
          .range(offset, offset + batchSize - 1);

        if (batchError) {
          console.error('❌ Invoiced Data - Error fetching legacy payments batch:', batchError);
          throw batchError;
        }

        if (batch && batch.length > 0) {
          allLegacyPayments = [...allLegacyPayments, ...batch];
          console.log(`✅ Invoiced Data - Fetched batch ${batchNumber}: ${batch.length} payments (total so far: ${allLegacyPayments.length})`);

          // If we got fewer than batchSize, we've reached the end
          if (batch.length < batchSize) {
            hasMore = false;
          } else {
            offset += batchSize;
          }
        } else {
          hasMore = false;
        }
      }

      console.log('✅ Invoiced Data - Fetched all legacy payments (all with due_date, matching Collection Due Report):', allLegacyPayments.length);

      // Filter out any payments with cancel_date (safety check)
      const filteredLegacyPayments = allLegacyPayments.filter(p => !p.cancel_date);
      if (filteredLegacyPayments.length !== allLegacyPayments.length) {
        console.log('⚠️ Invoiced Data - Filtered out', allLegacyPayments.length - filteredLegacyPayments.length, 'legacy payments with cancel_date');
      }

      console.log('✅ Invoiced Data - Total legacy payments (after cancel_date filter):', filteredLegacyPayments.length);

      if (filteredLegacyPayments.length > 0) {
        console.log('📊 Invoiced Data - Sample legacy payment:', {
          id: filteredLegacyPayments[0].id,
          lead_id: filteredLegacyPayments[0].lead_id,
          due_date: filteredLegacyPayments[0].due_date,
          date: filteredLegacyPayments[0].date,
          value_base: filteredLegacyPayments[0].value_base,
          actual_date: filteredLegacyPayments[0].actual_date
        });
      }

      // Get unique lead IDs
      const newLeadIds = Array.from(new Set(filteredNewPayments.map(p => p.lead_id).filter(Boolean)));
      const legacyLeadIds = Array.from(new Set(filteredLegacyPayments.map(p => p.lead_id).filter(Boolean))).map(id => Number(id)).filter(id => !Number.isNaN(id));

      console.log('📊 Invoiced Data - Unique new lead IDs:', newLeadIds.length);
      console.log('📊 Invoiced Data - Unique legacy lead IDs:', legacyLeadIds.length);

      // Fetch lead metadata with handler info and category (to get department from category, matching Agreement Signed)
      let newLeadsMap = new Map();
      if (newLeadIds.length > 0) {
        console.log('🔍 Invoiced Data - Fetching new leads metadata...');
        const { data: newLeads, error: newLeadsError } = await supabase
          .from('leads')
          .select(`
            id,
            handler,
            category_id,
            category,
            misc_category!category_id(
              id, name, parent_id,
              misc_maincategory!parent_id(
                id, name, department_id,
                tenant_departement!fk_misc_maincategory_department_id(id, name)
              )
            )
          `)
          .in('id', newLeadIds);

        if (newLeadsError) {
          console.error('❌ Invoiced Data - Error fetching new leads:', newLeadsError);
        } else {
          console.log('✅ Invoiced Data - Fetched new leads:', newLeads?.length || 0);
          if (newLeads) {
            newLeads.forEach(lead => {
              newLeadsMap.set(lead.id, lead);
            });
          }
        }
      }

      let legacyLeadsMap = new Map();
      if (legacyLeadIds.length > 0) {
        console.log('🔍 Invoiced Data - Fetching legacy leads metadata...');

        // Supabase's .in() has a limit of 1000 items, so we need to fetch in batches
        const leadIdBatchSize = 1000;
        let allLegacyLeads: any[] = [];

        for (let i = 0; i < legacyLeadIds.length; i += leadIdBatchSize) {
          const batchLeadIds = legacyLeadIds.slice(i, i + leadIdBatchSize);
          const { data: legacyLeadsBatch, error: legacyLeadsError } = await supabase
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
                  tenant_departement!fk_misc_maincategory_department_id(id, name)
                )
              )
            `)
            .in('id', batchLeadIds);

          if (legacyLeadsError) {
            console.error('❌ Invoiced Data - Error fetching legacy leads batch:', legacyLeadsError);
          } else {
            if (legacyLeadsBatch) {
              allLegacyLeads = [...allLegacyLeads, ...legacyLeadsBatch];
              console.log(`✅ Invoiced Data - Fetched legacy leads batch: ${legacyLeadsBatch.length} leads (total so far: ${allLegacyLeads.length})`);
            }
          }
        }

        console.log('✅ Invoiced Data - Fetched legacy leads:', allLegacyLeads.length);
        if (allLegacyLeads.length > 0) {
          allLegacyLeads.forEach(lead => {
            const key = lead.id?.toString() || String(lead.id);
            legacyLeadsMap.set(key, lead);
            if (typeof lead.id === 'number') {
              legacyLeadsMap.set(lead.id, lead);
            }
          });
        }
      }

      console.log('📊 Invoiced Data - Date ranges:', {
        todayStr,
        rangeStart,
        rangeEnd,
        startOfMonthStr,
        endOfMonthStr,
        selectedMonthName
      });

      // Fetch handler information and map to departments (EXACTLY matching CollectionDueReport)
      // Collect handler names from new leads and handler IDs from legacy leads
      const allHandlerNames = new Set<string>();
      const allHandlerIds = new Set<number>();

      // Collect handler names from new leads
      newLeadsMap.forEach((lead: any) => {
        if (lead.handler && typeof lead.handler === 'string' && lead.handler.trim() && lead.handler !== '---' && lead.handler.toLowerCase() !== 'not assigned') {
          allHandlerNames.add(lead.handler.trim());
        }
      });

      // Collect handler IDs from legacy leads
      legacyLeadsMap.forEach((lead: any) => {
        const handlerId = lead.case_handler_id ? Number(lead.case_handler_id) : null;
        if (handlerId !== null && !Number.isNaN(handlerId)) {
          allHandlerIds.add(handlerId);
        }
      });

      // Fetch employees by display_name for new leads
      const handlerNameToIdMap = new Map<string, number>();
      const handlerMap = new Map<number, string>(); // handlerId -> display_name

      if (allHandlerNames.size > 0) {
        const handlerNamesArray = Array.from(allHandlerNames);
        const { data: handlerDataByName, error: handlerErrorByName } = await supabase
          .from('tenants_employee')
          .select('id, display_name')
          .in('display_name', handlerNamesArray);

        if (!handlerErrorByName && handlerDataByName) {
          handlerDataByName.forEach(emp => {
            const empId = Number(emp.id);
            const displayName = emp.display_name?.trim();
            if (!Number.isNaN(empId) && displayName) {
              handlerNameToIdMap.set(displayName, empId);
              handlerMap.set(empId, displayName);
            }
          });
        }
      }

      // Fetch employees by ID for legacy leads
      const uniqueHandlerIds = Array.from(new Set(allHandlerIds));
      if (uniqueHandlerIds.length > 0) {
        const { data: handlerDataById, error: handlerErrorById } = await supabase
          .from('tenants_employee')
          .select('id, display_name')
          .in('id', uniqueHandlerIds);

        if (!handlerErrorById && handlerDataById) {
          handlerDataById.forEach(emp => {
            const empId = Number(emp.id);
            if (!Number.isNaN(empId)) {
              const displayName = emp.display_name?.trim() || `Employee #${emp.id}`;
              handlerMap.set(empId, displayName);
            }
          });
        }
      }

      // Fetch department information from tenants_employee for all handlers (EXACTLY matching CollectionDueReport)
      const handlerIdsWithDepartments = Array.from(new Set([
        ...Array.from(handlerNameToIdMap.values()),
        ...Array.from(allHandlerIds)
      ]));

      const handlerIdToDepartmentNameMap = new Map<number, string>(); // handlerId -> departmentName (string)

      if (handlerIdsWithDepartments.length > 0) {
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
          employeeDepartmentData.forEach(emp => {
            const empId = Number(emp.id);
            if (!Number.isNaN(empId)) {
              const department = emp.tenant_departement;
              if (department) {
                const dept = Array.isArray(department) ? department[0] : department;
                // Fix department name for ID 20: should be "Commercial & Civil" not "Commercial - Sales"
                let departmentName = dept?.name || '—';
                if (dept?.id === 20) {
                  departmentName = 'Commercial & Civil';
                }
                handlerIdToDepartmentNameMap.set(empId, departmentName);
              } else {
                handlerIdToDepartmentNameMap.set(empId, '—');
              }
            }
          });
        }
      }

      // Create a map from department name to department ID (for matching with departmentIds)
      const departmentNameToIdMap = new Map<string, number>();
      departmentTargets.forEach(dept => {
        departmentNameToIdMap.set(dept.name, dept.id);
      });
      // CRITICAL: Also map "Commercial - Sales" to department 20's ID (for employees who still have the old name)
      const dept20 = departmentTargets.find(d => d.id === 20);
      if (dept20) {
        departmentNameToIdMap.set('Commercial - Sales', 20);
        departmentNameToIdMap.set('Commercial & Civil', 20); // Ensure both names map to the same ID
      }

      // Function to normalize department names by removing " - Sales" suffix for consolidation
      // This ensures "Austria and Germany" and "Austria and Germany - Sales" map to the same department
      const normalizeDepartmentName = (deptName: string): string => {
        if (!deptName || deptName === '—') return deptName;
        // Remove " - Sales" suffix if present
        const baseName = deptName.replace(/ - Sales$/, '').trim();
        return baseName;
      };

      // Create a map from normalized name to primary department ID (the one WITHOUT " - Sales" suffix)
      // First pass: identify primary departments (those without " - Sales" suffix)
      const normalizedNameToPrimaryIdMap = new Map<string, number>();
      departmentTargets.forEach(dept => {
        const normalizedName = normalizeDepartmentName(dept.name);
        // If this is the primary department (no " - Sales" suffix), use it as the primary ID
        if (dept.name === normalizedName) {
          // This is a primary department - use it as the target ID
          if (!normalizedNameToPrimaryIdMap.has(normalizedName)) {
            normalizedNameToPrimaryIdMap.set(normalizedName, dept.id);
          }
        }
      });
      // Second pass: for departments with " - Sales" suffix, map to their primary department
      departmentTargets.forEach(dept => {
        const normalizedName = normalizeDepartmentName(dept.name);
        const primaryId = normalizedNameToPrimaryIdMap.get(normalizedName);
        if (primaryId && dept.name !== normalizedName) {
          // This is a " - Sales" variant - it should map to the primary ID
          // But we still want to keep the original mapping too for exact matches
        }
      });

      // Create a map from any department name (including variants) to the consolidated department ID
      const allDepartmentNamesToIdMap = new Map<string, number>();
      departmentTargets.forEach(dept => {
        const normalizedName = normalizeDepartmentName(dept.name);
        const primaryId = normalizedNameToPrimaryIdMap.get(normalizedName);
        const targetId = primaryId || dept.id; // Use primary ID if available, otherwise use the department's own ID

        // Map the original name to the target ID
        allDepartmentNamesToIdMap.set(dept.name, targetId);
        // Map the normalized name to the target ID (will overwrite with primary ID if it exists)
        allDepartmentNamesToIdMap.set(normalizedName, targetId);
      });
      // Also map "Commercial - Sales" variants
      if (dept20) {
        allDepartmentNamesToIdMap.set('Commercial - Sales', 20);
        allDepartmentNamesToIdMap.set('Commercial & Civil', 20);
      }

      // Process payments and group by department (using employee's department NAME, EXACTLY matching CollectionDueReport)
      // IMPORTANT: Each payment row is counted separately - no deduplication by lead_id
      // Multiple payment rows per lead are all counted and summed
      // Process new payments
      let newPaymentsProcessed = 0;
      let newPaymentsSkipped = 0;
      filteredNewPayments.forEach(payment => {
        const lead = newLeadsMap.get(payment.lead_id);
        if (!lead) {
          newPaymentsSkipped++;
          return;
        }

        // Get department from category -> main category -> department (using helper function)
        const { departmentId, departmentName } = resolveCategoryAndDepartment(
          lead.category,
          lead.category_id,
          lead.misc_category
        );

        // Only include payments that have a department in our department list
        if (!departmentId || !departmentIds.includes(departmentId)) {
          newPaymentsSkipped++;
          return;
        }

        newPaymentsProcessed++;

        // Use value (without VAT) for total amount from payment_plans table (matching CollectionDueReport logic)
        const value = Number(payment.value || 0);
        // Normalize currency: convert symbols to codes for convertToNIS
        let currencyForConversion = payment.currency || 'NIS';
        if (currencyForConversion === '₪') currencyForConversion = 'NIS';
        else if (currencyForConversion === '€') currencyForConversion = 'EUR';
        else if (currencyForConversion === '$') currencyForConversion = 'USD';
        else if (currencyForConversion === '£') currencyForConversion = 'GBP';
        const amountInNIS = convertToNIS(value, currencyForConversion);

        const dueDate = payment.due_date ? (typeof payment.due_date === 'string' ? payment.due_date.split('T')[0] : new Date(payment.due_date).toISOString().split('T')[0]) : null;
        if (!dueDate) return;

        const deptIndex = departmentIds.indexOf(departmentId) + 1; // +1 to skip General column

        // Check if it's today
        if (dueDate === todayStr) {
          newInvoicedData["Today"][deptIndex].count += 1;
          newInvoicedData["Today"][deptIndex].amount += amountInNIS;
          newInvoicedData["Today"][0].count += 1; // General
          newInvoicedData["Today"][0].amount += amountInNIS;
        }

        // Check if it's yesterday
        if (dueDate === yesterdayStr) {
          newInvoicedData["Yesterday"][deptIndex].count += 1;
          newInvoicedData["Yesterday"][deptIndex].amount += amountInNIS;
          newInvoicedData["Yesterday"][0].count += 1; // General
          newInvoicedData["Yesterday"][0].amount += amountInNIS;
        }

        // Check if it's in the last week (7 days including today)
        if (dueDate >= oneWeekAgoStr && dueDate <= todayStr) {
          newInvoicedData["Week"][deptIndex].count += 1;
          newInvoicedData["Week"][deptIndex].amount += amountInNIS;
          newInvoicedData["Week"][0].count += 1; // General
          newInvoicedData["Week"][0].amount += amountInNIS;
        }

        // Report range (Sales Contribution From/To) — same bucket name as Dashboard "Last 30d" in code
        if (dueDate >= rangeStart && dueDate <= rangeEnd) {
          newInvoicedData["Last 30d"][deptIndex].count += 1;
          newInvoicedData["Last 30d"][deptIndex].amount += amountInNIS;
          newInvoicedData["Last 30d"][0].count += 1; // General
          newInvoicedData["Last 30d"][0].amount += amountInNIS;
        }

        // Check if it's in selected month
        if (dueDate >= startOfMonthStr && dueDate <= endOfMonthStr) {
          const monthDeptIndex = departmentIds.indexOf(departmentId); // No General column for month
          newInvoicedData[selectedMonthName][monthDeptIndex].count += 1;
          newInvoicedData[selectedMonthName][monthDeptIndex].amount += amountInNIS;
        }
      });

      console.log('📊 Invoiced Data - New payments processing:', {
        total: filteredNewPayments.length,
        processed: newPaymentsProcessed,
        skipped: newPaymentsSkipped
      });

      // Process legacy payments
      // IMPORTANT: Each payment row is counted separately - no deduplication by lead_id
      // Multiple payment rows per lead are all counted and summed
      let legacyPaymentsProcessed = 0;
      let legacyPaymentsSkipped = 0;
      filteredLegacyPayments.forEach(payment => {
        const leadIdKey = payment.lead_id?.toString() || String(payment.lead_id);
        const leadIdNum = typeof payment.lead_id === 'number' ? payment.lead_id : Number(payment.lead_id);
        let lead = legacyLeadsMap.get(leadIdKey) || legacyLeadsMap.get(leadIdNum);

        if (!lead) {
          legacyPaymentsSkipped++;
          return;
        }

        // Get department from category -> main category -> department (using helper function, matching CollectionDueReport)
        const { departmentId, departmentName } = resolveCategoryAndDepartment(
          lead.category,
          lead.category_id,
          lead.misc_category
        );

        // Only include payments that have a department in our department list (or '—' which we'll skip)
        if (!departmentId || !departmentIds.includes(departmentId)) {
          legacyPaymentsSkipped++;
          return;
        }

        legacyPaymentsProcessed++;

        // Use value (without VAT) for legacy payments as specified in CollectionDueReport
        const value = Number(payment.value || payment.value_base || 0);

        // Get currency from accounting_currencies relation
        const accountingCurrency: any = payment.accounting_currencies
          ? (Array.isArray(payment.accounting_currencies) ? payment.accounting_currencies[0] : payment.accounting_currencies)
          : null;

        // Normalize currency: convert symbols to codes for convertToNIS
        let currencyForConversion = 'NIS'; // Default to NIS
        if (accountingCurrency?.name) {
          currencyForConversion = accountingCurrency.name;
        } else if (accountingCurrency?.iso_code) {
          currencyForConversion = accountingCurrency.iso_code;
        } else if (payment.currency_id) {
          // Map currency_id to code
          switch (payment.currency_id) {
            case 1: currencyForConversion = 'NIS'; break;
            case 2: currencyForConversion = 'EUR'; break;
            case 3: currencyForConversion = 'USD'; break;
            case 4: currencyForConversion = 'GBP'; break;
            default: currencyForConversion = 'NIS'; break;
          }
        }

        // Normalize symbols to codes
        if (currencyForConversion === '₪') currencyForConversion = 'NIS';
        else if (currencyForConversion === '€') currencyForConversion = 'EUR';
        else if (currencyForConversion === '$') currencyForConversion = 'USD';
        else if (currencyForConversion === '£') currencyForConversion = 'GBP';

        // Convert to NIS (value without VAT), same as CollectionDueReport
        const amountInNIS = convertToNIS(value, currencyForConversion);

        // Use due_date for date filtering (same as CollectionDueReport)
        const dueDate = payment.due_date ? (typeof payment.due_date === 'string' ? payment.due_date.split('T')[0] : new Date(payment.due_date).toISOString().split('T')[0]) : null;
        if (!dueDate) return;

        const deptIndex = departmentIds.indexOf(departmentId) + 1; // +1 to skip General column

        // Check if it's today
        if (dueDate === todayStr) {
          newInvoicedData["Today"][deptIndex].count += 1;
          newInvoicedData["Today"][deptIndex].amount += amountInNIS;
          newInvoicedData["Today"][0].count += 1; // General
          newInvoicedData["Today"][0].amount += amountInNIS;
        }

        // Check if it's yesterday
        if (dueDate === yesterdayStr) {
          newInvoicedData["Yesterday"][deptIndex].count += 1;
          newInvoicedData["Yesterday"][deptIndex].amount += amountInNIS;
          newInvoicedData["Yesterday"][0].count += 1; // General
          newInvoicedData["Yesterday"][0].amount += amountInNIS;
        }

        // Check if it's in the last week (7 days including today)
        if (dueDate >= oneWeekAgoStr && dueDate <= todayStr) {
          newInvoicedData["Week"][deptIndex].count += 1;
          newInvoicedData["Week"][deptIndex].amount += amountInNIS;
          newInvoicedData["Week"][0].count += 1; // General
          newInvoicedData["Week"][0].amount += amountInNIS;
        }

        if (dueDate >= rangeStart && dueDate <= rangeEnd) {
          newInvoicedData["Last 30d"][deptIndex].count += 1;
          newInvoicedData["Last 30d"][deptIndex].amount += amountInNIS;
          newInvoicedData["Last 30d"][0].count += 1; // General
          newInvoicedData["Last 30d"][0].amount += amountInNIS;
        }

        // Check if it's in selected month
        if (dueDate >= startOfMonthStr && dueDate <= endOfMonthStr) {
          const monthDeptIndex = departmentIds.indexOf(departmentId); // No General column for month
          newInvoicedData[selectedMonthName][monthDeptIndex].count += 1;
          newInvoicedData[selectedMonthName][monthDeptIndex].amount += amountInNIS;
        }
      });

      console.log('📊 Invoiced Data - Legacy payments processing:', {
        total: filteredLegacyPayments.length,
        processed: legacyPaymentsProcessed,
        skipped: legacyPaymentsSkipped
      });

      console.log('📊 Invoiced Data - Final data before totals:', {
        Today: newInvoicedData["Today"].map((item, idx) => ({ idx, count: item.count, amount: item.amount })),
        Last30d: newInvoicedData["Last 30d"].map((item, idx) => ({ idx, count: item.count, amount: item.amount })),
        Month: newInvoicedData[selectedMonthName].map((item, idx) => ({ idx, count: item.count, amount: item.amount }))
      });

      // Calculate totals
      const numDepartments = departmentTargets.length;
      const totalIndexToday = numDepartments + 1; // General + departments + Total
      const totalIndexMonth = numDepartments; // departments + Total (no General for month)

      // Today totals (sum of departments, excluding General and Total)
      const todayTotalCount = newInvoicedData.Today.slice(1, numDepartments + 1).reduce((sum, item) => sum + item.count, 0);
      const todayTotalAmount = Math.ceil(newInvoicedData.Today.slice(1, numDepartments + 1).reduce((sum, item) => sum + item.amount, 0));
      newInvoicedData.Today[totalIndexToday] = { count: todayTotalCount, amount: todayTotalAmount, expected: 0 };

      // Yesterday totals
      const yesterdayTotalCount = newInvoicedData.Yesterday.slice(1, numDepartments + 1).reduce((sum, item) => sum + item.count, 0);
      const yesterdayTotalAmount = Math.ceil(newInvoicedData.Yesterday.slice(1, numDepartments + 1).reduce((sum, item) => sum + item.amount, 0));
      newInvoicedData.Yesterday[totalIndexToday] = { count: yesterdayTotalCount, amount: yesterdayTotalAmount, expected: 0 };

      // Week totals
      const weekTotalCount = newInvoicedData.Week.slice(1, numDepartments + 1).reduce((sum, item) => sum + item.count, 0);
      const weekTotalAmount = Math.ceil(newInvoicedData.Week.slice(1, numDepartments + 1).reduce((sum, item) => sum + item.amount, 0));
      newInvoicedData.Week[totalIndexToday] = { count: weekTotalCount, amount: weekTotalAmount, expected: 0 };

      // Last 30d totals
      const last30TotalCount = newInvoicedData["Last 30d"].slice(1, numDepartments + 1).reduce((sum, item) => sum + item.count, 0);
      const last30TotalAmount = Math.ceil(newInvoicedData["Last 30d"].slice(1, numDepartments + 1).reduce((sum, item) => sum + item.amount, 0));
      newInvoicedData["Last 30d"][totalIndexToday] = { count: last30TotalCount, amount: last30TotalAmount, expected: 0 };

      // Current month totals
      const monthTotalCount = newInvoicedData[selectedMonthName].slice(0, numDepartments).reduce((sum, item) => sum + item.count, 0);
      const monthTotalAmount = Math.ceil(newInvoicedData[selectedMonthName].slice(0, numDepartments).reduce((sum, item) => sum + item.amount, 0));
      newInvoicedData[selectedMonthName][totalIndexMonth] = { count: monthTotalCount, amount: monthTotalAmount, expected: 0 };

      return last30TotalAmount;

    } catch (e) {
      console.error('fetchInvoicedTotalDueNisForDateRange failed:', e);
      return 0;
    }
}
