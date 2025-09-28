// Alternative Dashboard Queries - No Foreign Key Dependencies
// Use this approach if the foreign key relationships are still not working

// 1. Fetch leads_leadstage data separately
const fetchStageRecords = async (startDate: string, endDate: string) => {
  const { data: stageRecords, error: stageError } = await supabase
    .from('leads_leadstage')
    .select('id, date, lead_id, stage')
    .eq('stage', 60)
    .gte('date', startDate)
    .lte('date', endDate);
  
  if (stageError) {
    console.error('❌ Error fetching stage records:', stageError);
    throw stageError;
  }
  
  return stageRecords || [];
};

// 2. Fetch leads_lead data separately
const fetchLeadsData = async (leadIds: number[]) => {
  if (leadIds.length === 0) return [];
  
  const { data: leadsData, error: leadsError } = await supabase
    .from('leads_lead')
    .select(`
      id, total,
      misc_category(
        id, name, parent_id,
        misc_maincategory(
          id, name, department_id,
          tenant_departement(id, name)
        )
      )
    `)
    .in('id', leadIds);
  
  if (leadsError) {
    console.error('❌ Error fetching leads data:', leadsError);
    throw leadsError;
  }
  
  return leadsData || [];
};

// 3. Fetch proformas data separately
const fetchProformasData = async (startDate: string, endDate: string) => {
  const { data: proformasData, error: proformasError } = await supabase
    .from('proformas')
    .select('id, lead_id, total, cdate')
    .gte('cdate', startDate)
    .lte('cdate', endDate);
  
  if (proformasError) {
    console.error('❌ Error fetching proformas data:', proformasError);
    throw proformasError;
  }
  
  return proformasData || [];
};

// 4. Combined function to fetch and join stage data
const fetchStageDataWithJoins = async (startDate: string, endDate: string) => {
  console.log('📋 Fetching stage records separately...');
  
  // Fetch stage records
  const stageRecords = await fetchStageRecords(startDate, endDate);
  console.log('✅ Stage records fetched:', stageRecords.length, 'records');
  
  if (stageRecords.length === 0) {
    return [];
  }
  
  // Extract unique lead IDs
  const leadIds = [...new Set(stageRecords.map(record => record.lead_id).filter(id => id !== null))];
  console.log('📋 Fetching leads data for', leadIds.length, 'unique leads...');
  
  // Fetch leads data
  const leadsData = await fetchLeadsData(leadIds);
  console.log('✅ Leads data fetched:', leadsData.length, 'records');
  
  // Create a map for quick lookup
  const leadsMap = new Map(leadsData.map(lead => [lead.id, lead]));
  
  // Join the data
  const joinedData = stageRecords.map(stageRecord => {
    const lead = leadsMap.get(stageRecord.lead_id);
    return {
      ...stageRecord,
      leads_lead: lead || null
    };
  }).filter(record => record.leads_lead !== null); // Only include records with valid leads
  
  console.log('✅ Joined data created:', joinedData.length, 'records');
  return joinedData;
};

// 5. Combined function to fetch and join proformas data
const fetchProformasDataWithJoins = async (startDate: string, endDate: string) => {
  console.log('📋 Fetching proformas records separately...');
  
  // Fetch proformas records
  const proformasData = await fetchProformasData(startDate, endDate);
  console.log('✅ Proformas records fetched:', proformasData.length, 'records');
  
  if (proformasData.length === 0) {
    return [];
  }
  
  // Extract unique lead IDs
  const leadIds = [...new Set(proformasData.map(record => record.lead_id).filter(id => id !== null))];
  console.log('📋 Fetching leads data for', leadIds.length, 'unique leads...');
  
  // Fetch leads data
  const leadsData = await fetchLeadsData(leadIds);
  console.log('✅ Leads data fetched:', leadsData.length, 'records');
  
  // Create a map for quick lookup
  const leadsMap = new Map(leadsData.map(lead => [lead.id, lead]));
  
  // Join the data
  const joinedData = proformasData.map(proformaRecord => {
    const lead = leadsMap.get(proformaRecord.lead_id);
    return {
      ...proformaRecord,
      leads_lead: lead || null
    };
  }).filter(record => record.leads_lead !== null); // Only include records with valid leads
  
  console.log('✅ Joined proformas data created:', joinedData.length, 'records');
  return joinedData;
};

// 6. Updated department performance fetch function
const fetchDepartmentPerformanceAlternative = async () => {
  setDepartmentPerformanceLoading(true);
  try {
    console.log('🔍 Starting department performance fetch (alternative approach)...');
    
    const now = new Date();
    const today = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(now.getDate() - 30);
    
    // Use selected month and year instead of current month
    const selectedMonthIndex = months.indexOf(selectedMonth);
    const selectedDate = new Date(selectedYear, selectedMonthIndex, 1);
    const selectedMonthName = selectedDate.toLocaleDateString('en-US', { month: 'long' });
    
    console.log('📅 Selected month/year:', selectedMonth, selectedYear);
    console.log('📅 Selected month name for display:', selectedMonthName);
    
    // Date calculations
    const todayStr = today.toISOString().split('T')[0];
    const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];
    const startOfMonthStr = new Date(selectedYear, selectedMonthIndex, 1).toISOString().split('T')[0];
    const endOfMonthStr = new Date(selectedYear, selectedMonthIndex + 1, 0).toISOString().split('T')[0];
    
    console.log('📅 Date ranges:');
    console.log('  - Today:', todayStr);
    console.log('  - 30 days ago:', thirtyDaysAgoStr);
    console.log('  - Start of month:', startOfMonthStr);
    console.log('  - End of month:', endOfMonthStr);
    
    // Fetch stage data for last 30 days
    console.log('📋 Fetching stage 60 records for last 30 days...');
    const stageRecords30d = await fetchStageDataWithJoins(thirtyDaysAgoStr, todayStr);
    
    // Fetch stage data for selected month
    console.log('📋 Fetching stage 60 records for selected month...');
    const stageRecordsMonth = await fetchStageDataWithJoins(startOfMonthStr, endOfMonthStr);
    
    // Process the data (same logic as before)
    const processStageData = (records: any[]) => {
      const departmentData: { [key: number]: { count: number; total: number } } = {};
      
      records.forEach(record => {
        if (record.leads_lead?.misc_category?.misc_maincategory?.department_id) {
          const deptId = record.leads_lead.misc_category.misc_maincategory.department_id;
          if (!departmentData[deptId]) {
            departmentData[deptId] = { count: 0, total: 0 };
          }
          departmentData[deptId].count++;
          departmentData[deptId].total += parseFloat(record.leads_lead.total || '0');
        }
      });
      
      return departmentData;
    };
    
    const departmentData30d = processStageData(stageRecords30d);
    const departmentDataMonth = processStageData(stageRecordsMonth);
    
    console.log('✅ Department data processed:');
    console.log('  - 30 days:', departmentData30d);
    console.log('  - Month:', departmentDataMonth);
    
    // Set the state (same as before)
    setDepartmentPerformanceData({
      last30Days: departmentData30d,
      selectedMonth: departmentDataMonth
    });
    
  } catch (error) {
    console.error('❌ Error fetching department performance:', error);
  } finally {
    setDepartmentPerformanceLoading(false);
  }
};

// 7. Updated invoiced data fetch function
const fetchInvoicedDataAlternative = async () => {
  setInvoicedLoading(true);
  try {
    console.log('🔍 Starting invoiced data fetch (alternative approach)...');
    
    const now = new Date();
    const today = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(now.getDate() - 30);
    
    // Use selected month and year
    const selectedMonthIndex = months.indexOf(selectedMonth);
    const selectedDate = new Date(selectedYear, selectedMonthIndex, 1);
    const selectedMonthName = selectedDate.toLocaleDateString('en-US', { month: 'long' });
    
    console.log('📅 Fetching invoiced data for:', selectedMonthName, selectedYear);
    
    // Date calculations
    const todayStr = today.toISOString().split('T')[0];
    const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];
    const startOfMonthStr = new Date(selectedYear, selectedMonthIndex, 1).toISOString().split('T')[0];
    const endOfMonthStr = new Date(selectedYear, selectedMonthIndex + 1, 0).toISOString().split('T')[0];
    
    // Fetch proformas data for last 30 days
    console.log('📋 Fetching proformas records for last 30 days...');
    const proformasData30d = await fetchProformasDataWithJoins(thirtyDaysAgoStr, todayStr);
    
    // Fetch proformas data for selected month
    console.log('📋 Fetching proformas records for selected month...');
    const proformasDataMonth = await fetchProformasDataWithJoins(startOfMonthStr, endOfMonthStr);
    
    // Process the data (same logic as before)
    const processProformasData = (records: any[]) => {
      const departmentData: { [key: number]: { count: number; total: number } } = {};
      
      records.forEach(record => {
        if (record.leads_lead?.misc_category?.misc_maincategory?.department_id) {
          const deptId = record.leads_lead.misc_category.misc_maincategory.department_id;
          if (!departmentData[deptId]) {
            departmentData[deptId] = { count: 0, total: 0 };
          }
          departmentData[deptId].count++;
          departmentData[deptId].total += parseFloat(record.total || '0');
        }
      });
      
      return departmentData;
    };
    
    const invoicedData30d = processProformasData(proformasData30d);
    const invoicedDataMonth = processProformasData(proformasDataMonth);
    
    console.log('✅ Invoiced data processed:');
    console.log('  - 30 days:', invoicedData30d);
    console.log('  - Month:', invoicedDataMonth);
    
    // Set the state (same as before)
    setInvoicedData({
      last30Days: invoicedData30d,
      selectedMonth: invoicedDataMonth
    });
    
  } catch (error) {
    console.error('❌ Error fetching invoiced data:', error);
  } finally {
    setInvoicedLoading(false);
  }
};
