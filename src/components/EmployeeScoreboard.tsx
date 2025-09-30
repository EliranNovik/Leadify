import React, { useState, useEffect } from 'react';
import { UserGroupIcon, CalendarIcon } from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';

// Helper function to get initials from display name
const getInitials = (displayName: string): string => {
  return displayName
    .split(' ')
    .map(name => name.charAt(0))
    .join('')
    .toUpperCase()
    .slice(0, 2);
};

// Employee Avatar Component
const EmployeeAvatar: React.FC<{ 
  employee: { id: string; display_name: string; photo_url?: string; photo?: string } | undefined;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}> = ({ employee, size = 'md', className = '' }) => {
  if (!employee) return null;

  const sizeClasses = {
    sm: 'w-12 h-12 text-sm',
    md: 'w-14 h-14 text-base',
    lg: 'w-16 h-16 text-lg'
  };

  const imageUrl = employee.photo_url || employee.photo;
  
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={employee.display_name}
        className={`${sizeClasses[size]} rounded-full object-cover shadow-lg ${className}`}
        onError={(e) => {
          // Fallback to initials if image fails to load
          const target = e.target as HTMLImageElement;
          target.style.display = 'none';
          const parent = target.parentElement;
          if (parent) {
            parent.innerHTML = `<div class="${sizeClasses[size]} rounded-full flex items-center justify-center font-bold shadow-lg bg-white/20 text-white">${getInitials(employee.display_name)}</div>`;
          }
        }}
      />
    );
  }

  return (
    <div className={`${sizeClasses[size]} rounded-full flex items-center justify-center font-bold shadow-lg bg-white/20 text-white ${className}`}>
      {getInitials(employee.display_name)}
    </div>
  );
};

interface EmployeeScoreboardProps {
  className?: string;
}

interface ScoreboardData {
  closers: { name: string; count: number; employee?: { id: string; display_name: string; photo_url?: string; photo?: string } }[];
  schedulers: { name: string; count: number; employee?: { id: string; display_name: string; photo_url?: string; photo?: string } }[];
  experts: { name: string; count: number; employee?: { id: string; display_name: string; photo_url?: string; photo?: string } }[];
  handlers: { name: string; count: number; employee?: { id: string; display_name: string; photo_url?: string; photo?: string } }[];
}

const EmployeeScoreboard: React.FC<EmployeeScoreboardProps> = ({ className = '' }) => {
  const [employeeScoreboard, setEmployeeScoreboard] = useState<ScoreboardData>({
    closers: [],
    schedulers: [],
    experts: [],
    handlers: []
  });
  const [scoreboardLoading, setScoreboardLoading] = useState(false);
  
  // Date filter state for scoreboard
  const [scoreboardDateFilter, setScoreboardDateFilter] = useState({
    month: new Date().getMonth() + 1, // Current month (1-12)
    year: new Date().getFullYear() // Current year
  });
  const [useLast30Days, setUseLast30Days] = useState(true); // Default to last 30 days

  // Fetch employee scoreboard data for selected period
  const fetchEmployeeScoreboard = async () => {
    setScoreboardLoading(true);
    try {
      let startDateISO: string;
      let endDateISO: string;
      
      if (useLast30Days) {
        // Use last 30 days
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(endDate.getDate() - 30);
        startDateISO = startDate.toISOString();
        endDateISO = endDate.toISOString();
      } else {
        // Use selected month and year
        const startDate = new Date(scoreboardDateFilter.year, scoreboardDateFilter.month - 1, 1);
        const endDate = new Date(scoreboardDateFilter.year, scoreboardDateFilter.month, 0, 23, 59, 59, 999);
        startDateISO = startDate.toISOString();
        endDateISO = endDate.toISOString();
      }
      
      console.log('🔍 EmployeeScoreboard - Starting fetch with parameters:', {
        useLast30Days,
        month: scoreboardDateFilter.month,
        year: scoreboardDateFilter.year,
        startDate: startDateISO,
        endDate: endDateISO,
        startDateFormatted: startDateISO.split('T')[0],
        endDateFormatted: endDateISO.split('T')[0]
      });

      // Fetch all employees with their roles
      console.log('🔍 EmployeeScoreboard - Fetching employees...');
      const { data: employees, error: employeesError } = await supabase
        .from('tenants_employee')
        .select('id, display_name, bonuses_role, photo_url, photo')
        .not('display_name', 'is', null)
        .not('id', 'eq', 143); // Exclude employee ID 143

      if (employeesError) {
        console.error('❌ EmployeeScoreboard - Error fetching employees:', employeesError);
        console.error('❌ EmployeeScoreboard - Error details:', {
          message: employeesError.message,
          details: employeesError.details,
          hint: employeesError.hint,
          code: employeesError.code
        });
        return;
      }
      
      console.log('✅ EmployeeScoreboard - Employees fetched successfully:', employees?.length || 0, 'employees');

      const scoreboard: ScoreboardData = {
        closers: [],
        schedulers: [],
        experts: [],
        handlers: []
      };

      // Fetch closers data (signed contracts) - Use EmployeeModal approach without JOINs
      console.log('🔍 EmployeeScoreboard - Fetching closers data...');
      console.log('🔍 EmployeeScoreboard - Closers query parameters:', {
        table: 'leads_lead',
        select: 'closer_id',
        filters: {
          closer_id: 'not.is.null',
          cdate_gte: startDateISO.split('T')[0],
          cdate_lte: endDateISO.split('T')[0]
        }
      });
      
      const { data: closersData, error: closersError } = await supabase
        .from('leads_lead')
        .select('closer_id')
        .not('closer_id', 'is', null)
        .gte('cdate', startDateISO.split('T')[0])
        .lte('cdate', endDateISO.split('T')[0]);

      if (closersError) {
        console.error('❌ EmployeeScoreboard - Error fetching closers data:', closersError);
        console.error('❌ EmployeeScoreboard - Closers error details:', {
          message: closersError.message,
          details: closersError.details,
          hint: closersError.hint,
          code: closersError.code
        });
      } else {
        console.log('✅ EmployeeScoreboard - Closers data fetched successfully:', closersData?.length || 0, 'records');
        console.log('🔍 EmployeeScoreboard - Sample closers data:', closersData?.[0]);
      }

      if (!closersError && closersData) {
        const closerCounts: { [key: string]: { count: number; employee: any } } = {};
        closersData.forEach((lead: any) => {
          if (lead.closer_id) {
            // Find the employee name from the employees data we fetched earlier
            // Convert both to strings for comparison (like EmployeeModal does)
            const employee = employees?.find(emp => String(emp.id) === String(lead.closer_id));
            if (employee?.display_name) {
              const name = employee.display_name;
              if (!closerCounts[name]) {
                closerCounts[name] = { count: 0, employee };
              }
              closerCounts[name].count += 1;
            }
          }
        });
        scoreboard.closers = Object.entries(closerCounts)
          .map(([name, data]) => ({ name, count: data.count, employee: data.employee }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 3);
        console.log('✅ EmployeeScoreboard - Closers processed:', scoreboard.closers);
        console.log('🔍 EmployeeScoreboard - Closer counts before processing:', closerCounts);
      }

      // Fetch schedulers data (scheduled meetings) - Use EmployeeModal approach from leads_lead table
      console.log('🔍 EmployeeScoreboard - Fetching schedulers data...');
      console.log('🔍 EmployeeScoreboard - Schedulers query parameters:', {
        table: 'leads_lead',
        select: 'meeting_scheduler_id',
        filters: {
          meeting_scheduler_id: 'not.is.null',
          cdate_gte: startDateISO.split('T')[0],
          cdate_lte: endDateISO.split('T')[0]
        }
      });
      
      const { data: schedulersData, error: schedulersError } = await supabase
        .from('leads_lead')
        .select('meeting_scheduler_id')
        .not('meeting_scheduler_id', 'is', null)
        .gte('cdate', startDateISO.split('T')[0])
        .lte('cdate', endDateISO.split('T')[0]);

      if (schedulersError) {
        console.error('❌ EmployeeScoreboard - Error fetching schedulers data:', schedulersError);
        console.error('❌ EmployeeScoreboard - Schedulers error details:', {
          message: schedulersError.message,
          details: schedulersError.details,
          hint: schedulersError.hint,
          code: schedulersError.code
        });
      } else {
        console.log('✅ EmployeeScoreboard - Schedulers data fetched successfully:', schedulersData?.length || 0, 'records');
        console.log('🔍 EmployeeScoreboard - Sample schedulers data:', schedulersData?.[0]);
      }

      if (!schedulersError && schedulersData) {
        const schedulerCounts: { [key: string]: { count: number; employee: any } } = {};
        schedulersData.forEach((lead: any) => {
          if (lead.meeting_scheduler_id) {
            // Find the employee name from the employees data we fetched earlier
            // Convert both to strings for comparison (like EmployeeModal does)
            const employee = employees?.find(emp => String(emp.id) === String(lead.meeting_scheduler_id));
            if (employee?.display_name) {
              const name = employee.display_name;
              if (!schedulerCounts[name]) {
                schedulerCounts[name] = { count: 0, employee };
              }
              schedulerCounts[name].count += 1;
            }
          }
        });
        scoreboard.schedulers = Object.entries(schedulerCounts)
          .map(([name, data]) => ({ name, count: data.count, employee: data.employee }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 3);
        console.log('✅ EmployeeScoreboard - Schedulers processed:', scoreboard.schedulers);
        console.log('🔍 EmployeeScoreboard - Scheduler counts before processing:', schedulerCounts);
      }

      // Fetch experts data (expert examinations) - Use EmployeeModal approach without JOINs
      console.log('🔍 EmployeeScoreboard - Fetching experts data...');
      console.log('🔍 EmployeeScoreboard - Experts query parameters:', {
        table: 'leads_lead',
        select: 'expert_id, expert_examination',
        filters: {
          expert_id: 'not.is.null',
          cdate_gte: startDateISO.split('T')[0],
          cdate_lte: endDateISO.split('T')[0]
        }
      });
      
      const { data: expertsData, error: expertsError } = await supabase
        .from('leads_lead')
        .select('expert_id, expert_examination')
        .not('expert_id', 'is', null)
        .gte('cdate', startDateISO.split('T')[0])
        .lte('cdate', endDateISO.split('T')[0]);

      if (expertsError) {
        console.error('❌ EmployeeScoreboard - Error fetching experts data:', expertsError);
        console.error('❌ EmployeeScoreboard - Experts error details:', {
          message: expertsError.message,
          details: expertsError.details,
          hint: expertsError.hint,
          code: expertsError.code
        });
      } else {
        console.log('✅ EmployeeScoreboard - Experts data fetched successfully:', expertsData?.length || 0, 'records');
        console.log('🔍 EmployeeScoreboard - Sample experts data:', expertsData?.[0]);
      }

      if (!expertsError && expertsData) {
        const expertCounts: { [key: string]: { count: number; employee: any } } = {};
        expertsData.forEach((lead: any) => {
          if (lead.expert_id) {
            // Only count if expert_examination is not null and not "0" (like EmployeeModal)
            const examinationValue = lead.expert_examination;
            const examStr = String(examinationValue);
            if (examStr && examStr !== "0" && examStr !== "" && examStr !== "null") {
              // Find the employee name from the employees data we fetched earlier
              // Convert both to strings for comparison (like EmployeeModal does)
              const employee = employees?.find(emp => String(emp.id) === String(lead.expert_id));
              if (employee?.display_name) {
                const name = employee.display_name;
                if (!expertCounts[name]) {
                  expertCounts[name] = { count: 0, employee };
                }
                expertCounts[name].count += 1;
              }
            }
          }
        });
        scoreboard.experts = Object.entries(expertCounts)
          .map(([name, data]) => ({ name, count: data.count, employee: data.employee }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 3);
        console.log('✅ EmployeeScoreboard - Experts processed:', scoreboard.experts);
        console.log('🔍 EmployeeScoreboard - Expert counts before processing:', expertCounts);
      }

      // Fetch handlers data (cases where they are case_handler_id) - Use EmployeeModal approach without JOINs
      console.log('🔍 EmployeeScoreboard - Fetching handlers data...');
      console.log('🔍 EmployeeScoreboard - Handlers query parameters:', {
        table: 'leads_lead',
        select: 'case_handler_id',
        filters: {
          case_handler_id: 'not.is.null',
          cdate_gte: startDateISO.split('T')[0],
          cdate_lte: endDateISO.split('T')[0]
        }
      });
      
      const { data: handlersData, error: handlersError } = await supabase
        .from('leads_lead')
        .select('case_handler_id')
        .not('case_handler_id', 'is', null)
        .gte('cdate', startDateISO.split('T')[0])
        .lte('cdate', endDateISO.split('T')[0]);

      if (handlersError) {
        console.error('❌ EmployeeScoreboard - Error fetching handlers data:', handlersError);
        console.error('❌ EmployeeScoreboard - Handlers error details:', {
          message: handlersError.message,
          details: handlersError.details,
          hint: handlersError.hint,
          code: handlersError.code
        });
      } else {
        console.log('✅ EmployeeScoreboard - Handlers data fetched successfully:', handlersData?.length || 0, 'records');
        console.log('🔍 EmployeeScoreboard - Sample handlers data:', handlersData?.[0]);
      }

      if (!handlersError && handlersData) {
        const handlerCounts: { [key: string]: { count: number; employee: any } } = {};
        handlersData.forEach((lead: any) => {
          if (lead.case_handler_id) {
            // Find the employee name from the employees data we fetched earlier
            // Convert both to strings for comparison (like EmployeeModal does)
            const employee = employees?.find(emp => String(emp.id) === String(lead.case_handler_id));
            if (employee?.display_name) {
              const name = employee.display_name;
              if (!handlerCounts[name]) {
                handlerCounts[name] = { count: 0, employee };
              }
              handlerCounts[name].count += 1;
            }
          }
        });
        scoreboard.handlers = Object.entries(handlerCounts)
          .map(([name, data]) => ({ name, count: data.count, employee: data.employee }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 3);
        console.log('✅ EmployeeScoreboard - Handlers processed:', scoreboard.handlers);
        console.log('🔍 EmployeeScoreboard - Handler counts before processing:', handlerCounts);
      }

      setEmployeeScoreboard(scoreboard);
      console.log('✅ EmployeeScoreboard - Final scoreboard data:', scoreboard);
      console.log('✅ EmployeeScoreboard - Summary:', {
        closers: scoreboard.closers.length,
        schedulers: scoreboard.schedulers.length,
        experts: scoreboard.experts.length,
        handlers: scoreboard.handlers.length
      });
    } catch (error) {
      console.error('❌ EmployeeScoreboard - Fatal error:', error);
      console.error('❌ EmployeeScoreboard - Error details:', {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        scoreboardDateFilter,
        errorType: typeof error,
        errorConstructor: error?.constructor?.name
      });
    } finally {
      setScoreboardLoading(false);
      console.log('🔍 EmployeeScoreboard - Loading state set to false');
    }
  };

  // Fetch employee scoreboard data on component mount and when date filter changes
  // Fetch data when component mounts, date filter changes, or useLast30Days changes
  useEffect(() => {
    console.log('🔍 EmployeeScoreboard - useEffect triggered with scoreboardDateFilter:', scoreboardDateFilter, 'useLast30Days:', useLast30Days);
    fetchEmployeeScoreboard();
  }, [scoreboardDateFilter, useLast30Days]);

  // Auto-refresh every 30 minutes when using last 30 days
  useEffect(() => {
    if (!useLast30Days) return; // Only auto-refresh when using last 30 days
    
    const interval = setInterval(() => {
      console.log('🔄 EmployeeScoreboard - Auto-refreshing data (30 minutes)');
      fetchEmployeeScoreboard();
    }, 30 * 60 * 1000); // 30 minutes

    return () => clearInterval(interval);
  }, [useLast30Days]);

  return (
    <div className={`w-full mb-6 px-4 md:px-0 ${className}`}>
      {/* Date Filter for Scoreboard */}
      <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-4 mb-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex flex-col md:flex-row md:items-center gap-4">
            <h3 className="text-lg font-semibold text-gray-900">Employee Performance</h3>
            
            {/* Mode Toggle */}
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700">Period:</label>
              <div className="flex bg-gray-100 rounded-lg p-1">
                <button
                  onClick={() => setUseLast30Days(true)}
                  className={`px-3 py-1 text-sm rounded-md transition-colors ${
                    useLast30Days 
                      ? 'bg-white text-gray-900 shadow-sm' 
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Last 30 Days
                </button>
                <button
                  onClick={() => setUseLast30Days(false)}
                  className={`px-3 py-1 text-sm rounded-md transition-colors ${
                    !useLast30Days 
                      ? 'bg-white text-gray-900 shadow-sm' 
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Custom Month
                </button>
              </div>
            </div>
            
            {/* Month/Year Selectors - Only show when not using last 30 days */}
            {!useLast30Days && (
              <>
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium text-gray-700">Month:</label>
                  <select 
                    value={scoreboardDateFilter.month} 
                    onChange={(e) => setScoreboardDateFilter(prev => ({ ...prev, month: parseInt(e.target.value) }))}
                    className="select select-bordered select-sm w-32"
                  >
                    <option value={1}>January</option>
                    <option value={2}>February</option>
                    <option value={3}>March</option>
                    <option value={4}>April</option>
                    <option value={5}>May</option>
                    <option value={6}>June</option>
                    <option value={7}>July</option>
                    <option value={8}>August</option>
                    <option value={9}>September</option>
                    <option value={10}>October</option>
                    <option value={11}>November</option>
                    <option value={12}>December</option>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium text-gray-700">Year:</label>
                  <select 
                    value={scoreboardDateFilter.year} 
                    onChange={(e) => setScoreboardDateFilter(prev => ({ ...prev, year: parseInt(e.target.value) }))}
                    className="select select-bordered select-sm w-24"
                  >
                    {Array.from({ length: 5 }, (_, i) => {
                      const year = new Date().getFullYear() - 2 + i;
                      return (
                        <option key={year} value={year}>{year}</option>
                      );
                    })}
                  </select>
                </div>
              </>
            )}
          </div>
          
          <div className="text-sm text-gray-500">
            {useLast30Days 
              ? 'Showing data for the last 30 days (auto-updates every 30 minutes)'
              : `Showing data for ${new Date(scoreboardDateFilter.year, scoreboardDateFilter.month - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`
            }
          </div>
        </div>
      </div>
      
      {/* Scoreboard Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-6 w-full mb-12">
        {/* Top Closers */}
        <div className="rounded-2xl p-3 md:p-8 flex flex-col items-center shadow-lg border border-white/20 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white h-full min-h-[180px] md:min-h-0">
          <div className="flex items-center gap-2 mb-2">
            <UserGroupIcon className="w-5 h-5 md:w-6 md:h-6 text-white opacity-90" />
            <span className="text-sm md:text-base font-bold text-white drop-shadow">Top Closers</span>
          </div>
          <div className="w-full flex flex-col gap-2 mt-1 flex-1">
            {scoreboardLoading ? (
              <div className="flex justify-center items-center py-4">
                <div className="loading loading-spinner loading-sm text-white"></div>
              </div>
            ) : employeeScoreboard.closers.length > 0 ? (
              employeeScoreboard.closers.map((user, idx) => (
                <div key={user.name} className="flex items-center gap-2 w-full">
                  <div className="flex items-center gap-1">
                    <EmployeeAvatar 
                      employee={user.employee} 
                      size="md" 
                      className="w-12 h-12 md:w-14 md:h-14"
                    />
                  </div>
                  <div className="flex-1">
                    <span className="font-semibold text-white text-base md:text-xl">{user.name}</span>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-xs text-white/80">Contracts</span>
                    <span className="text-2xl md:text-3xl font-bold text-white">{user.count}</span>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-white/70 text-center py-4">No data available</div>
            )}
          </div>
        </div>
        
        {/* Top Schedulers */}
        <div className="rounded-2xl p-3 md:p-8 flex flex-col items-center shadow-lg border border-white/20 bg-gradient-to-tr from-purple-600 via-blue-600 to-blue-500 text-white h-full min-h-[180px] md:min-h-0">
          <div className="flex items-center gap-2 mb-2">
            <CalendarIcon className="w-5 h-5 md:w-6 md:h-6 text-white opacity-90" />
            <span className="text-sm md:text-base font-bold text-white drop-shadow">Top Schedulers</span>
          </div>
          <div className="w-full flex flex-col gap-2 mt-1 flex-1">
            {scoreboardLoading ? (
              <div className="flex justify-center items-center py-4">
                <div className="loading loading-spinner loading-sm text-white"></div>
              </div>
            ) : employeeScoreboard.schedulers.length > 0 ? (
              employeeScoreboard.schedulers.map((user, idx) => (
                <div key={user.name} className="flex items-center gap-2 w-full">
                  <div className="flex items-center gap-1">
                    <EmployeeAvatar 
                      employee={user.employee} 
                      size="md" 
                      className="w-12 h-12 md:w-14 md:h-14"
                    />
                  </div>
                  <div className="flex-1">
                    <span className="font-semibold text-white text-base md:text-xl">{user.name}</span>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-xs text-white/80">Meetings</span>
                    <span className="text-2xl md:text-3xl font-bold text-white">{user.count}</span>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-white/70 text-center py-4">No data available</div>
            )}
          </div>
        </div>
        
        {/* Top Experts */}
        <div className="rounded-2xl p-3 md:p-8 flex flex-col items-center shadow-lg border border-white/20 bg-gradient-to-tr from-blue-500 via-cyan-500 to-teal-400 text-white h-full min-h-[180px] md:min-h-0">
          <div className="flex items-center gap-2 mb-2">
            <svg className="w-5 h-5 md:w-6 md:h-6 text-white opacity-90" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 14l9-5-9-5-9 5 9 5z" /><path d="M12 14l6.16-3.422A12.083 12.083 0 0112 21.5a12.083 12.083 0 01-6.16-10.922L12 14z" /></svg>
            <span className="text-sm md:text-base font-bold text-white drop-shadow">Top Experts</span>
          </div>
          <div className="w-full flex flex-col gap-2 mt-1 flex-1">
            {scoreboardLoading ? (
              <div className="flex justify-center items-center py-4">
                <div className="loading loading-spinner loading-sm text-white"></div>
              </div>
            ) : employeeScoreboard.experts.length > 0 ? (
              employeeScoreboard.experts.map((user, idx) => (
                <div key={user.name} className="flex items-center gap-2 w-full">
                  <div className="flex items-center gap-1">
                    <EmployeeAvatar 
                      employee={user.employee} 
                      size="md" 
                      className="w-12 h-12 md:w-14 md:h-14"
                    />
                  </div>
                  <div className="flex-1">
                    <span className="font-semibold text-white text-base md:text-xl">{user.name}</span>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-xs text-white/80">Examinations</span>
                    <span className="text-2xl md:text-3xl font-bold text-white">{user.count}</span>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-white/70 text-center py-4">No data available</div>
            )}
          </div>
        </div>
        
        {/* Top Handlers */}
        <div className="rounded-2xl p-3 md:p-8 flex flex-col items-center shadow-lg border border-white/20 bg-gradient-to-tr from-[#4b2996] via-[#6c4edb] to-[#3b28c7] text-white h-full min-h-[180px] md:min-h-0">
          <div className="flex items-center gap-2 mb-2">
            <UserGroupIcon className="w-5 h-5 md:w-6 md:h-6 text-white opacity-90" />
            <span className="text-sm md:text-base font-bold text-white drop-shadow">Top Handlers</span>
          </div>
          <div className="w-full flex flex-col gap-2 mt-1 flex-1">
            {scoreboardLoading ? (
              <div className="flex justify-center items-center py-4">
                <div className="loading loading-spinner loading-sm text-white"></div>
              </div>
            ) : employeeScoreboard.handlers.length > 0 ? (
              employeeScoreboard.handlers.map((user, idx) => (
                <div key={user.name} className="flex items-center gap-2 w-full">
                  <div className="flex items-center gap-1">
                    <EmployeeAvatar 
                      employee={user.employee} 
                      size="md" 
                      className="w-12 h-12 md:w-14 md:h-14"
                    />
                  </div>
                  <div className="flex-1">
                    <span className="font-semibold text-white text-base md:text-xl">{user.name}</span>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-xs text-white/80">Cases</span>
                    <span className="text-2xl md:text-3xl font-bold text-white">{user.count}</span>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-white/70 text-center py-4">No data available</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default EmployeeScoreboard;
