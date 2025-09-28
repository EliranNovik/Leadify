import React, { useState, useEffect } from 'react';
import { XMarkIcon, CurrencyDollarIcon, CalendarIcon, ChartBarIcon } from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';
import { 
  fetchMonthlyBonusPool, 
  fetchMonthlyRevenue, 
  createOrUpdateMonthlyBonusPool,
  MonthlyBonusPool 
} from '../lib/bonusCalculation';
import { convertToNIS } from '../lib/currencyConversion';

interface BonusPoolModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const BonusPoolModal: React.FC<BonusPoolModalProps> = ({ isOpen, onClose }) => {
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [bonusPoolAmount, setBonusPoolAmount] = useState<string>('');
  const [totalRevenue, setTotalRevenue] = useState<number>(0);
  const [poolPercentage, setPoolPercentage] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [existingPool, setExistingPool] = useState<MonthlyBonusPool | null>(null);
  const [revenueLoading, setRevenueLoading] = useState(false);
  
  // New state for viewing existing pools
  const [viewMode, setViewMode] = useState<'create' | 'view'>('create');
  const [selectedViewYear, setSelectedViewYear] = useState<number>(new Date().getFullYear());
  const [selectedViewMonth, setSelectedViewMonth] = useState<number>(new Date().getMonth() + 1);
  const [viewedPool, setViewedPool] = useState<MonthlyBonusPool | null>(null);
  const [viewLoading, setViewLoading] = useState(false);

  // Fetch revenue when date filter changes
  useEffect(() => {
    if (isOpen && dateFrom && dateTo) {
      fetchRevenueForDateRange();
      checkExistingPool();
    }
  }, [isOpen, dateFrom, dateTo]);

  // Calculate pool percentage when bonus pool amount changes
  useEffect(() => {
    const amount = parseFloat(bonusPoolAmount) || 0;
    if (totalRevenue > 0) {
      setPoolPercentage((amount / totalRevenue) * 100);
    } else {
      setPoolPercentage(0);
    }
  }, [bonusPoolAmount, totalRevenue]);

  // Fetch existing pool data when view mode changes or year/month changes
  useEffect(() => {
    if (isOpen && viewMode === 'view') {
      fetchExistingPoolForView();
    }
  }, [isOpen, viewMode, selectedViewYear, selectedViewMonth]);

  // Fetch revenue for the selected date range
  const fetchRevenueForDateRange = async () => {
    setRevenueLoading(true);
    try {
      console.log(`🔍 Fetching revenue for date range: ${dateFrom} to ${dateTo}`);
      
      // First, let's check what leads exist in this date range (any status)
      const { data: allLeads, error: allLeadsError } = await supabase
        .from('leads_lead')
        .select('id, total, currency_id, cdate, status')
        .gte('cdate', dateFrom)
        .lte('cdate', dateTo);

      if (allLeadsError) {
        console.error('❌ Error fetching all leads:', allLeadsError);
        setError('Failed to fetch leads data');
        return;
      }

      console.log(`📊 Found ${allLeads?.length || 0} total leads in date range`);
      
      if (allLeads && allLeads.length > 0) {
        // Show status distribution
        const statusCounts: { [key: number]: number } = {};
        allLeads.forEach(lead => {
          statusCounts[lead.status] = (statusCounts[lead.status] || 0) + 1;
        });
        console.log('📊 Status distribution:', statusCounts);
        
        // Show sample leads
        console.log('📋 Sample leads:', allLeads.slice(0, 3));
      }
      
      // Use the EXACT same logic as Employee Performance page: department-based revenue calculation
      console.log('🔍 Using Employee Performance page revenue calculation logic...');
      
      // First, get ALL departments from tenant_departement to create a mapping
      const { data: allDepartments, error: departmentsError } = await supabase
        .from('tenant_departement')
        .select('id, name, important')
        .order('id');
      
      if (departmentsError) {
        console.error('❌ Error fetching departments:', departmentsError);
        setError('Failed to fetch departments data');
        return;
      }
      
      // Create department ID to name mapping
      const departmentMap: { [key: number]: string } = {};
      allDepartments?.forEach(dept => {
        departmentMap[dept.id] = dept.name;
      });
      
      console.log('📊 Department mapping created:', departmentMap);
      
      // Fetch signed stages (stage 60 - agreement signed) for the date range
      const { data: signedStages, error: stagesError } = await supabase
        .from('leads_leadstage')
        .select('id, date, lead_id')
        .eq('stage', 60)
        .gte('date', dateFrom)
        .lte('date', dateTo);

      if (stagesError) {
        console.error('❌ Error fetching signed stages:', stagesError);
        setError('Failed to fetch signed stages data');
        return;
      }

      console.log(`📊 Found ${signedStages?.length || 0} signed stages (stage 60) in date range`);

      if (!signedStages || signedStages.length === 0) {
        console.log('⚠️ No signed stages found, revenue will be 0');
        setTotalRevenue(0);
        setBonusPoolAmount('');
        setPoolPercentage(0);
        return;
      }

      // Get unique lead IDs from signed stages
      const leadIds = [...new Set(signedStages.map(stage => stage.lead_id).filter(id => id !== null))];
      console.log(`📋 Found ${leadIds.length} unique signed lead IDs`);

      // Fetch leads data with department mappings (EXACT same query as Employee Performance page)
      const { data: leadsData, error: leadsError } = await supabase
        .from('leads_lead')
        .select(`
          id, total, currency_id,
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
        setError('Failed to fetch leads data');
        return;
      }

      console.log(`✅ Found ${leadsData?.length || 0} signed leads with department mappings`);

      // Calculate total revenue using EXACT same logic as Employee Performance page
      let totalRevenue = 0;
      const leadsMap = new Map(leadsData?.map(lead => [lead.id, lead]) || []);
      
      signedStages.forEach(stageRecord => {
        const lead = leadsMap.get(stageRecord.lead_id);
        if (lead) {
          const amount = parseFloat(lead.total) || 0;
          const amountInNIS = convertToNIS(amount, lead.currency_id);
          
          // Debug currency conversion
          console.log(`🔍 BonusPoolModal Revenue - Lead ${lead.id}:`, {
            originalAmount: amount,
            currencyId: lead.currency_id,
            convertedAmount: amountInNIS,
            conversionRate: amount > 0 ? amountInNIS / amount : 1
          });
          
          totalRevenue += amountInNIS; // Use NIS amount (same as Employee Performance page)
        }
      });

      console.log(`💰 Total revenue for date range: ₪${totalRevenue.toLocaleString()}`);
      setTotalRevenue(totalRevenue);
      
      // Reset bonus pool amount and percentage when revenue changes
      setBonusPoolAmount('');
      setPoolPercentage(0);
      
    } catch (err) {
      console.error('❌ Error fetching revenue:', err);
      setError('Failed to fetch revenue data');
    } finally {
      setRevenueLoading(false);
    }
  };

  // Check if there's an existing pool for the date range
  const checkExistingPool = async () => {
    if (!dateFrom || !dateTo) return;
    
    try {
      // Extract year and month from dateFrom
      const fromDate = new Date(dateFrom);
      const year = fromDate.getFullYear();
      const month = fromDate.getMonth() + 1;
      
      console.log(`🔍 Checking for existing pool for ${year}-${month}`);
      
      // First, let's test if the table is accessible
      const { data: testData, error: testError } = await supabase
        .from('monthly_bonus_pools')
        .select('id')
        .limit(1);
      
      if (testError) {
        console.error('❌ Table access test failed:', testError);
        setError('Cannot access monthly bonus pools table. Please check database setup.');
        return;
      }
      
      console.log('✅ Table access test passed');
      
      const pool = await fetchMonthlyBonusPool(year, month);
      setExistingPool(pool);
      
      if (pool) {
        setBonusPoolAmount(pool.total_bonus_pool.toString());
        setPoolPercentage(pool.pool_percentage);
      }
    } catch (err) {
      console.error('❌ Error checking existing pool:', err);
    }
  };

  // Fetch existing pool data for viewing
  const fetchExistingPoolForView = async () => {
    setViewLoading(true);
    try {
      console.log(`🔍 Fetching existing pool for ${selectedViewYear}-${selectedViewMonth}`);
      
      const pool = await fetchMonthlyBonusPool(selectedViewYear, selectedViewMonth);
      setViewedPool(pool);
      
      if (pool) {
        console.log('✅ Found existing pool:', pool);
      } else {
        console.log('📊 No pool found for this month');
      }
    } catch (err) {
      console.error('❌ Error fetching existing pool:', err);
      setError('Failed to fetch existing pool data');
    } finally {
      setViewLoading(false);
    }
  };

  const handleSave = async () => {
    if (!dateFrom || !dateTo) {
      setError('Please select a date range first');
      return;
    }

    const amount = parseFloat(bonusPoolAmount);
    if (isNaN(amount) || amount < 0) {
      setError('Please enter a valid bonus pool amount');
      return;
    }

    setLoading(true);
    try {
      // Extract year and month from dateFrom
      const fromDate = new Date(dateFrom);
      const year = fromDate.getFullYear();
      const month = fromDate.getMonth() + 1;

      const result = await createOrUpdateMonthlyBonusPool(
        year,
        month,
        amount,
        totalRevenue
      );

      if (result) {
        setExistingPool(result);
        setSuccess('Bonus pool saved successfully!');
        setTimeout(() => setSuccess(null), 3000);
      } else {
        setError('Failed to save bonus pool');
      }
    } catch (err) {
      console.error('Error saving bonus pool:', err);
      setError('Failed to save bonus pool');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!existingPool) return;

    setLoading(true);
    try {
      const { error } = await supabase
        .from('monthly_bonus_pools')
        .delete()
        .eq('id', existingPool.id);

      if (error) {
        console.error('Error deleting bonus pool:', error);
        setError('Failed to delete bonus pool');
        return;
      }

      setExistingPool(null);
      setBonusPoolAmount('');
      setPoolPercentage(0);
      setSuccess('Bonus pool deleted successfully!');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      console.error('Error deleting bonus pool:', err);
      setError('Failed to delete bonus pool');
    } finally {
      setLoading(false);
    }
  };

  const formatDateRange = () => {
    if (!dateFrom || !dateTo) return 'Select Date Range';
    const from = new Date(dateFrom).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const to = new Date(dateTo).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return `${from} - ${to}`;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-screen">
        {/* Backdrop */}
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
          onClick={onClose}
        />
        
        {/* Modal */}
        <div className="relative bg-white w-full max-w-2xl mx-auto my-8 rounded-lg shadow-xl">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-200">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <CurrencyDollarIcon className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-gray-900">Monthly Bonus Pool</h2>
                <p className="text-sm text-gray-600">
                  {viewMode === 'create' ? `Manage bonus pool for ${formatDateRange()}` : `View existing bonus pools`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {/* View Mode Toggle */}
              <div className="flex items-center bg-gray-100 rounded-lg p-1">
                <button
                  onClick={() => setViewMode('create')}
                  className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                    viewMode === 'create' 
                      ? 'bg-white shadow-sm text-primary' 
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Create/Edit
                </button>
                <button
                  onClick={() => setViewMode('view')}
                  className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                    viewMode === 'view' 
                      ? 'bg-white shadow-sm text-primary' 
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  View Existing
                </button>
              </div>
              
              <button
                onClick={onClose}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <XMarkIcon className="w-6 h-6 text-gray-500" />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="p-6 space-y-6">
            {viewMode === 'create' ? (
              <>
                {/* Date Range Selection */}
                <div className="grid grid-cols-2 gap-4">
              <div className="form-control">
                <label className="label">
                  <span className="label-text font-medium">Date From</span>
                </label>
                <input
                  type="date"
                  className="input input-bordered"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                />
              </div>
              
              <div className="form-control">
                <label className="label">
                  <span className="label-text font-medium">Date To</span>
                </label>
                <input
                  type="date"
                  className="input input-bordered"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                />
              </div>
            </div>

            {/* Revenue Information */}
            <div className="card bg-gray-50">
              <div className="card-body p-4">
                <div className="flex items-center gap-2 mb-2">
                  <ChartBarIcon className="w-5 h-5 text-gray-600" />
                  <h3 className="font-semibold text-gray-900">Total Revenue</h3>
                  {revenueLoading && (
                    <span className="loading loading-spinner loading-sm"></span>
                  )}
                </div>
                <div className="text-2xl font-bold text-success">
                  {revenueLoading ? (
                    <span className="text-gray-400">Loading...</span>
                  ) : (
                    `₪${totalRevenue.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
                  )}
                </div>
                <p className="text-sm text-gray-600">
                  {dateFrom && dateTo ? (
                    `Total signed contracts from ${new Date(dateFrom).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} to ${new Date(dateTo).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
                  ) : (
                    'Select a date range to see revenue'
                  )}
                </p>
              </div>
            </div>

            {/* Bonus Pool Input */}
            <div className="form-control">
              <label className="label">
                <span className="label-text font-medium">Bonus Pool Amount (₪)</span>
              </label>
              <input
                type="number"
                className={`input input-bordered w-full ${(!dateFrom || !dateTo || revenueLoading) ? 'input-disabled' : ''}`}
                value={bonusPoolAmount}
                onChange={(e) => setBonusPoolAmount(e.target.value)}
                placeholder={(!dateFrom || !dateTo) ? "Select date range first..." : "Enter bonus pool amount..."}
                min="0"
                step="0.01"
                disabled={!dateFrom || !dateTo || revenueLoading}
              />
            </div>

            {/* Pool Percentage Display */}
            {bonusPoolAmount && (
              <div className="card bg-primary/5 border border-primary/20">
                <div className="card-body p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-primary">Pool Percentage</h3>
                      <p className="text-sm text-gray-600">
                        Percentage of total revenue allocated to bonuses
                      </p>
                    </div>
                    <div className="text-right">
                      <div className="text-3xl font-bold text-primary">
                        {poolPercentage.toFixed(2)}%
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Messages */}
            {error && (
              <div className="alert alert-error">
                <XMarkIcon className="w-5 h-5" />
                <span>{error}</span>
              </div>
            )}

            {success && (
              <div className="alert alert-success">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span>{success}</span>
              </div>
            )}

                {/* Actions */}
                <div className="flex gap-3 justify-end">
                  {existingPool && (
                    <button
                      onClick={handleDelete}
                      className="btn btn-error"
                      disabled={loading}
                    >
                      Delete Pool
                    </button>
                  )}
                  <button
                    onClick={handleSave}
                    className="btn btn-primary"
                    disabled={loading || !bonusPoolAmount || !dateFrom || !dateTo || revenueLoading}
                  >
                    {loading ? (
                      <>
                        <span className="loading loading-spinner loading-sm"></span>
                        Saving...
                      </>
                    ) : (
                      existingPool ? 'Update Pool' : 'Create Pool'
                    )}
                  </button>
                </div>
              </>
            ) : (
              /* View Mode */
              <>
                {/* Month/Year Selection for Viewing */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="form-control">
                    <label className="label">
                      <span className="label-text font-medium">Year</span>
                    </label>
                    <select 
                      className="select select-bordered"
                      value={selectedViewYear}
                      onChange={(e) => setSelectedViewYear(parseInt(e.target.value))}
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
                      value={selectedViewMonth}
                      onChange={(e) => setSelectedViewMonth(parseInt(e.target.value))}
                    >
                      {Array.from({ length: 12 }, (_, i) => {
                        const month = i + 1;
                        const monthName = new Date(2024, i).toLocaleDateString('en-US', { month: 'long' });
                        return <option key={month} value={month}>{monthName}</option>;
                      })}
                    </select>
                  </div>
                </div>

                {/* View Existing Pool Data */}
                {viewLoading ? (
                  <div className="text-center py-8">
                    <span className="loading loading-spinner loading-lg"></span>
                    <p className="mt-2 text-gray-600">Loading pool data...</p>
                  </div>
                ) : viewedPool ? (
                  <div className="space-y-4">
                    <div className="alert alert-success">
                      <ChartBarIcon className="w-5 h-5" />
                      <span>Pool data found for {new Date(selectedViewYear, selectedViewMonth - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="card bg-base-100 shadow-sm">
                        <div className="card-body p-4">
                          <h3 className="card-title text-lg">Total Revenue</h3>
                          <div className="text-2xl font-bold text-primary">
                            ₪{viewedPool.total_revenue.toLocaleString()}
                          </div>
                          <div className="text-sm text-gray-500">
                            Total signed contracts for the month
                          </div>
                        </div>
                      </div>
                      
                      <div className="card bg-base-100 shadow-sm">
                        <div className="card-body p-4">
                          <h3 className="card-title text-lg">Bonus Pool Amount</h3>
                          <div className="text-2xl font-bold text-success">
                            ₪{viewedPool.total_bonus_pool.toLocaleString()}
                          </div>
                          <div className="text-sm text-gray-500">
                            Allocated bonus pool amount
                          </div>
                        </div>
                      </div>
                      
                      <div className="card bg-base-100 shadow-sm">
                        <div className="card-body p-4">
                          <h3 className="card-title text-lg">Pool Percentage</h3>
                          <div className="text-2xl font-bold text-warning">
                            {viewedPool.pool_percentage.toFixed(2)}%
                          </div>
                          <div className="text-sm text-gray-500">
                            Percentage of revenue allocated to bonuses
                          </div>
                        </div>
                      </div>
                      
                      <div className="card bg-base-100 shadow-sm">
                        <div className="card-body p-4">
                          <h3 className="card-title text-lg">Created</h3>
                          <div className="text-sm font-medium">
                            {new Date(viewedPool.created_at).toLocaleDateString('en-US', {
                              year: 'numeric',
                              month: 'long',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </div>
                          <div className="text-sm text-gray-500">
                            Last updated: {new Date(viewedPool.updated_at).toLocaleDateString('en-US', {
                              year: 'numeric',
                              month: 'long',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <div className="alert alert-warning">
                      <ChartBarIcon className="w-5 h-5" />
                      <span>No bonus pool data found for {new Date(selectedViewYear, selectedViewMonth - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span>
                    </div>
                    <p className="text-gray-600 mt-2">Switch to "Create/Edit" mode to add bonus pool data for this month.</p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default BonusPoolModal;
