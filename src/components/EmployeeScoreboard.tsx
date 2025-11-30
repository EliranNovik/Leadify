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

      // Fetch closers data (signed contracts) - Use leads_leadstage table (stage 60)
      console.log('🔍 EmployeeScoreboard - Fetching closers data from leads_leadstage...');
      
      const startDateStr = startDateISO.split('T')[0];
      const endDateStr = endDateISO.split('T')[0];
      
      const { data: closersData, error: closersError } = await supabase
        .from('leads_leadstage')
        .select('id, stage, date, creator_id, lead_id, newlead_id')
        .eq('stage', 60)
        .gte('date', startDateStr)
        .lte('date', endDateStr);

      if (closersError) {
        console.error('❌ EmployeeScoreboard - Error fetching closers data:', closersError);
      } else {
        console.log('✅ EmployeeScoreboard - Closers data fetched successfully:', closersData?.length || 0, 'records');
      }

      if (!closersError && closersData) {
        const closerCounts: { [key: number]: { count: number; employee: any } } = {};
        
        // Deduplicate by lead_id/newlead_id to avoid counting same lead twice
        const uniqueContracts = new Map<string, any>();
        closersData.forEach(contract => {
          const key = contract.newlead_id ? `new_${contract.newlead_id}` : `legacy_${contract.lead_id}`;
          if (!uniqueContracts.has(key)) {
            uniqueContracts.set(key, contract);
          }
        });
        const deduplicatedContracts = Array.from(uniqueContracts.values());
        
        // Separate contracts with creator_id and without
        const contractsWithCreator = deduplicatedContracts.filter(c => c.creator_id);
        const contractsWithoutCreator = deduplicatedContracts.filter(c => !c.creator_id);
        
        // Count contracts with creator_id
        contractsWithCreator.forEach((contract: any) => {
          const creatorId = contract.creator_id;
          if (creatorId) {
            const employee = employees?.find(emp => String(emp.id) === String(creatorId));
            if (employee) {
              if (!closerCounts[creatorId]) {
                closerCounts[creatorId] = { count: 0, employee };
              }
              closerCounts[creatorId].count += 1;
            }
          }
        });
        
        // Batch fetch leads for contracts without creator_id
        const newLeadIds = contractsWithoutCreator.map(c => c.newlead_id).filter(Boolean);
        const legacyLeadIds = contractsWithoutCreator.map(c => c.lead_id).filter(Boolean);
        
        // Fetch new leads in batch
        if (newLeadIds.length > 0) {
          const { data: newLeads } = await supabase
            .from('leads')
            .select('id, closer')
            .in('id', newLeadIds);
          
          if (newLeads) {
            // Get unique closer names
            const closerNames = [...new Set(newLeads.map(l => l.closer).filter(Boolean))];
            
            // Fetch employee IDs for these closer names
            if (closerNames.length > 0) {
              const { data: closerEmployees } = await supabase
                .from('tenants_employee')
                .select('id, display_name, photo_url, photo')
                .in('display_name', closerNames);
              
              // Create a map of closer name to employee
              const closerNameToEmployee: Record<string, any> = {};
              closerEmployees?.forEach(emp => {
                if (emp.display_name) {
                  closerNameToEmployee[emp.display_name] = emp;
                }
              });
              
              // Count contracts by closer
              contractsWithoutCreator.forEach(contract => {
                if (contract.newlead_id) {
                  const lead = newLeads.find(l => l.id === contract.newlead_id);
                  if (lead?.closer && closerNameToEmployee[lead.closer]) {
                    const employee = closerNameToEmployee[lead.closer];
                    const employeeId = employee.id;
                    if (!closerCounts[employeeId]) {
                      closerCounts[employeeId] = { count: 0, employee };
                    }
                    closerCounts[employeeId].count += 1;
                  }
                }
              });
            }
          }
        }
        
        // Fetch legacy leads in batch
        if (legacyLeadIds.length > 0) {
          const { data: legacyLeads } = await supabase
            .from('leads_lead')
            .select('id, closer_id')
            .in('id', legacyLeadIds);
          
          if (legacyLeads) {
            // Count contracts by closer_id
            contractsWithoutCreator.forEach(contract => {
              if (contract.lead_id) {
                const lead = legacyLeads.find(l => l.id === contract.lead_id);
                if (lead?.closer_id) {
                  const employee = employees?.find(emp => String(emp.id) === String(lead.closer_id));
                  if (employee) {
                    const employeeId = employee.id;
                    if (!closerCounts[employeeId]) {
                      closerCounts[employeeId] = { count: 0, employee };
                    }
                    closerCounts[employeeId].count += 1;
                  }
                }
              }
            });
          }
        }
        
        scoreboard.closers = Object.entries(closerCounts)
          .map(([employeeId, data]) => ({ name: data.employee.display_name, count: data.count, employee: data.employee }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 3);
        console.log('✅ EmployeeScoreboard - Closers processed:', scoreboard.closers);
      }

      // Fetch schedulers data (scheduled meetings) - Use leads_leadstage table (stage 20)
      console.log('🔍 EmployeeScoreboard - Fetching schedulers data from leads_leadstage...');
      
      const { data: schedulersData, error: schedulersError } = await supabase
        .from('leads_leadstage')
        .select('id, stage, date, creator_id, lead_id, newlead_id')
        .eq('stage', 20)
        .gte('date', startDateStr)
        .lte('date', endDateStr);

      if (schedulersError) {
        console.error('❌ EmployeeScoreboard - Error fetching schedulers data:', schedulersError);
      } else {
        console.log('✅ EmployeeScoreboard - Schedulers data fetched successfully:', schedulersData?.length || 0, 'records');
      }

      if (!schedulersError && schedulersData) {
        const schedulerCounts: { [key: number]: { count: number; employee: any } } = {};
        
        // Deduplicate by lead_id/newlead_id to avoid counting same lead twice
        const uniqueMeetings = new Map<string, any>();
        schedulersData.forEach(meeting => {
          const key = meeting.newlead_id ? `new_${meeting.newlead_id}` : `legacy_${meeting.lead_id}`;
          if (!uniqueMeetings.has(key)) {
            uniqueMeetings.set(key, meeting);
          }
        });
        const deduplicatedMeetings = Array.from(uniqueMeetings.values());
        
        // Separate meetings with creator_id and without
        const meetingsWithCreator = deduplicatedMeetings.filter(m => m.creator_id);
        const meetingsWithoutCreator = deduplicatedMeetings.filter(m => !m.creator_id);
        
        // Count meetings with creator_id
        meetingsWithCreator.forEach((meeting: any) => {
          const creatorId = meeting.creator_id;
          if (creatorId) {
            const employee = employees?.find(emp => String(emp.id) === String(creatorId));
            if (employee) {
              if (!schedulerCounts[creatorId]) {
                schedulerCounts[creatorId] = { count: 0, employee };
              }
              schedulerCounts[creatorId].count += 1;
            }
          }
        });
        
        // Batch fetch leads for meetings without creator_id
        const newLeadIdsForMeetings = meetingsWithoutCreator.map(m => m.newlead_id).filter(Boolean);
        const legacyLeadIdsForMeetings = meetingsWithoutCreator.map(m => m.lead_id).filter(Boolean);
        
        // Fetch new leads in batch
        if (newLeadIdsForMeetings.length > 0) {
          const { data: newLeadsForMeetings } = await supabase
            .from('leads')
            .select('id, scheduler')
            .in('id', newLeadIdsForMeetings);
          
          if (newLeadsForMeetings) {
            // Get unique scheduler names
            const schedulerNames = [...new Set(newLeadsForMeetings.map(l => l.scheduler).filter(Boolean))];
            
            // Fetch employee IDs for these scheduler names
            if (schedulerNames.length > 0) {
              const { data: schedulerEmployees } = await supabase
                .from('tenants_employee')
                .select('id, display_name, photo_url, photo')
                .in('display_name', schedulerNames);
              
              // Create a map of scheduler name to employee
              const schedulerNameToEmployee: Record<string, any> = {};
              schedulerEmployees?.forEach(emp => {
                if (emp.display_name) {
                  schedulerNameToEmployee[emp.display_name] = emp;
                }
              });
              
              // Count meetings by scheduler
              meetingsWithoutCreator.forEach(meeting => {
                if (meeting.newlead_id) {
                  const lead = newLeadsForMeetings.find(l => l.id === meeting.newlead_id);
                  if (lead?.scheduler && schedulerNameToEmployee[lead.scheduler]) {
                    const employee = schedulerNameToEmployee[lead.scheduler];
                    const employeeId = employee.id;
                    if (!schedulerCounts[employeeId]) {
                      schedulerCounts[employeeId] = { count: 0, employee };
                    }
                    schedulerCounts[employeeId].count += 1;
                  }
                }
              });
            }
          }
        }
        
        // Fetch legacy leads in batch
        if (legacyLeadIdsForMeetings.length > 0) {
          const { data: legacyLeadsForMeetings } = await supabase
            .from('leads_lead')
            .select('id, meeting_scheduler_id')
            .in('id', legacyLeadIdsForMeetings);
          
          if (legacyLeadsForMeetings) {
            // Count meetings by meeting_scheduler_id
            meetingsWithoutCreator.forEach(meeting => {
              if (meeting.lead_id) {
                const lead = legacyLeadsForMeetings.find(l => l.id === meeting.lead_id);
                if (lead?.meeting_scheduler_id) {
                  const employee = employees?.find(emp => String(emp.id) === String(lead.meeting_scheduler_id));
                  if (employee) {
                    const employeeId = employee.id;
                    if (!schedulerCounts[employeeId]) {
                      schedulerCounts[employeeId] = { count: 0, employee };
                    }
                    schedulerCounts[employeeId].count += 1;
                  }
                }
              }
            });
          }
        }
        
        scoreboard.schedulers = Object.entries(schedulerCounts)
          .map(([employeeId, data]) => ({ name: data.employee.display_name, count: data.count, employee: data.employee }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 3);
        console.log('✅ EmployeeScoreboard - Schedulers processed:', scoreboard.schedulers);
      }

      // Fetch experts data (expert examinations) - From both new leads and legacy leads
      console.log('🔍 EmployeeScoreboard - Fetching experts data from new and legacy leads...');
      
      // Fetch new leads with expert opinions
      const { data: newLeadsExperts, error: newLeadsExpertsError } = await supabase
        .from('leads')
        .select('id, expert, eligibility_status, created_at')
        .not('expert', 'is', null)
        .neq('expert', '---')
        .in('eligibility_status', ['feasible_no_check', 'feasible_check', 'not_feasible'])
        .gte('created_at', startDateISO)
        .lte('created_at', endDateISO);
      
      console.log('🔍 EmployeeScoreboard - New leads experts query:', {
        startDate: startDateISO,
        endDate: endDateISO,
        filters: {
          expert: 'not null and not ---',
          eligibility_status: ['feasible_no_check', 'feasible_check', 'not_feasible']
        }
      });

      // Fetch legacy leads with expert examinations
      const { data: legacyLeadsExperts, error: legacyLeadsExpertsError } = await supabase
        .from('leads_lead')
        .select('id, expert_id, expert_examination, cdate')
        .not('expert_id', 'is', null)
        .not('expert_examination', 'is', null)
        .neq('expert_examination', '0')
        .neq('expert_examination', '')
        .gte('cdate', startDateStr)
        .lte('cdate', endDateStr);

      if (newLeadsExpertsError) {
        console.error('❌ EmployeeScoreboard - Error fetching new leads experts data:', newLeadsExpertsError);
      } else {
        console.log('✅ EmployeeScoreboard - New leads experts data fetched successfully:', newLeadsExperts?.length || 0, 'records');
      }

      if (legacyLeadsExpertsError) {
        console.error('❌ EmployeeScoreboard - Error fetching legacy leads experts data:', legacyLeadsExpertsError);
      } else {
        console.log('✅ EmployeeScoreboard - Legacy leads experts data fetched successfully:', legacyLeadsExperts?.length || 0, 'records');
      }

      const expertCounts: { [key: number]: { count: number; employee: any } } = {};
      
      // Process new leads
      if (newLeadsExperts && newLeadsExperts.length > 0) {
        console.log('🔍 EmployeeScoreboard - Processing new leads experts:', newLeadsExperts.length, 'leads');
        
        // Separate expert values into IDs and names
        const expertIds: number[] = [];
        const expertNames: string[] = [];
        
        newLeadsExperts.forEach(lead => {
          if (lead.expert) {
            // Check if expert is a numeric ID or a name
            const expertValue = String(lead.expert).trim();
            const numericId = parseInt(expertValue);
            if (!isNaN(numericId) && expertValue === String(numericId)) {
              // It's a numeric ID
              expertIds.push(numericId);
            } else {
              // It's a display name
              expertNames.push(expertValue);
            }
          }
        });
        
        console.log('🔍 EmployeeScoreboard - Expert IDs found:', expertIds);
        console.log('🔍 EmployeeScoreboard - Expert names found:', expertNames);
        
        // Fetch employees by ID
        if (expertIds.length > 0) {
          const uniqueExpertIds = [...new Set(expertIds)];
          const { data: expertEmployeesById } = await supabase
            .from('tenants_employee')
            .select('id, display_name, photo_url, photo')
            .in('id', uniqueExpertIds);
          
          console.log('🔍 EmployeeScoreboard - Expert employees found by ID:', expertEmployeesById?.length || 0);
          
          // Add to expertCounts
          expertEmployeesById?.forEach(emp => {
            if (!expertCounts[emp.id]) {
              expertCounts[emp.id] = { count: 0, employee: emp };
            }
          });
        }
        
        // Fetch employees by display name
        if (expertNames.length > 0) {
          const uniqueExpertNames = [...new Set(expertNames)];
          const { data: expertEmployeesByName } = await supabase
            .from('tenants_employee')
            .select('id, display_name, photo_url, photo')
            .in('display_name', uniqueExpertNames);
          
          console.log('🔍 EmployeeScoreboard - Expert employees found by name:', expertEmployeesByName?.length || 0);
          
          // Create a map of expert name to employee
          const expertNameToEmployee: Record<string, any> = {};
          expertEmployeesByName?.forEach(emp => {
            if (emp.display_name) {
              expertNameToEmployee[emp.display_name] = emp;
            }
          });
          
          // Add to expertCounts
          expertEmployeesByName?.forEach(emp => {
            if (!expertCounts[emp.id]) {
              expertCounts[emp.id] = { count: 0, employee: emp };
            }
          });
        }
        
        // Count expert opinions
        newLeadsExperts.forEach(lead => {
          if (lead.expert) {
            const expertValue = String(lead.expert).trim();
            const numericId = parseInt(expertValue);
            let employee: any = null;
            let employeeId: number | null = null;
            
            if (!isNaN(numericId) && expertValue === String(numericId)) {
              // It's a numeric ID - find in expertCounts or employees array
              employeeId = numericId;
              employee = expertCounts[numericId]?.employee || employees?.find(emp => String(emp.id) === String(numericId));
            } else {
              // It's a display name - find in employees array
              employee = employees?.find(emp => emp.display_name === expertValue);
              if (employee) {
                employeeId = employee.id;
              }
            }
            
            if (employee && employeeId) {
              if (!expertCounts[employeeId]) {
                expertCounts[employeeId] = { count: 0, employee };
              }
              expertCounts[employeeId].count += 1;
            } else {
              console.log('⚠️ EmployeeScoreboard - Employee not found for expert:', lead.expert, '(value:', expertValue, ', numericId:', numericId, ')');
            }
          }
        });
      } else {
        console.log('⚠️ EmployeeScoreboard - No new leads experts data to process');
      }
      
      // Process legacy leads
      if (legacyLeadsExperts) {
        legacyLeadsExperts.forEach((lead: any) => {
          if (lead.expert_id) {
            // Only count if expert_examination is not null and not "0"
            const examinationValue = lead.expert_examination;
            const examStr = String(examinationValue);
            if (examStr && examStr !== "0" && examStr !== "" && examStr !== "null") {
              const employee = employees?.find(emp => String(emp.id) === String(lead.expert_id));
              if (employee) {
                const employeeId = employee.id;
                if (!expertCounts[employeeId]) {
                  expertCounts[employeeId] = { count: 0, employee };
                }
                expertCounts[employeeId].count += 1;
              }
            }
          }
        });
      }
      
      scoreboard.experts = Object.entries(expertCounts)
        .map(([employeeId, data]) => ({ name: data.employee.display_name, count: data.count, employee: data.employee }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 3);
      console.log('✅ EmployeeScoreboard - Experts processed:', scoreboard.experts);

      // Fetch handlers data (stage changes) - Use leads_leadstage table (stage 150 and 200)
      console.log('🔍 EmployeeScoreboard - Fetching handlers data from leads_leadstage...');
      
      const { data: handlersData, error: handlersError } = await supabase
        .from('leads_leadstage')
        .select('id, stage, date, creator_id, lead_id, newlead_id')
        .in('stage', [150, 200])
        .gte('date', startDateStr)
        .lte('date', endDateStr);

      if (handlersError) {
        console.error('❌ EmployeeScoreboard - Error fetching handlers data:', handlersError);
      } else {
        console.log('✅ EmployeeScoreboard - Handlers data fetched successfully:', handlersData?.length || 0, 'records');
      }

      if (!handlersError && handlersData) {
        const handlerCounts: { [key: number]: { count: number; employee: any } } = {};
        
        // Deduplicate by lead_id/newlead_id to avoid counting same lead twice
        const uniqueChanges = new Map<string, any>();
        handlersData.forEach(change => {
          const key = change.newlead_id ? `new_${change.newlead_id}` : `legacy_${change.lead_id}`;
          if (!uniqueChanges.has(key)) {
            uniqueChanges.set(key, change);
          }
        });
        const deduplicatedChanges = Array.from(uniqueChanges.values());
        
        // For handlers, NEVER use creator_id - always get handler from the lead
        // Batch fetch leads for all stage changes
        const newLeadIdsForHandlers = deduplicatedChanges.map(h => h.newlead_id).filter(Boolean);
        const legacyLeadIdsForHandlers = deduplicatedChanges.map(h => h.lead_id).filter(Boolean);
        
        // Fetch new leads in batch
        if (newLeadIdsForHandlers.length > 0) {
          const { data: newLeadsForHandlers } = await supabase
            .from('leads')
            .select('id, handler')
            .in('id', newLeadIdsForHandlers);
          
          if (newLeadsForHandlers) {
            // Get unique handler names
            const handlerNames = [...new Set(newLeadsForHandlers.map(l => l.handler).filter(Boolean))];
            
            // Fetch employee IDs for these handler names
            if (handlerNames.length > 0) {
              const { data: handlerEmployees } = await supabase
                .from('tenants_employee')
                .select('id, display_name, photo_url, photo')
                .in('display_name', handlerNames);
              
              // Create a map of handler name to employee
              const handlerNameToEmployee: Record<string, any> = {};
              handlerEmployees?.forEach(emp => {
                if (emp.display_name) {
                  handlerNameToEmployee[emp.display_name] = emp;
                }
              });
              
              // Count stage changes by handler
              deduplicatedChanges.forEach((change: any) => {
                if (change.newlead_id) {
                  const lead = newLeadsForHandlers.find(l => l.id === change.newlead_id);
                  if (lead?.handler && handlerNameToEmployee[lead.handler]) {
                    const employee = handlerNameToEmployee[lead.handler];
                    const employeeId = employee.id;
                    if (!handlerCounts[employeeId]) {
                      handlerCounts[employeeId] = { count: 0, employee };
                    }
                    handlerCounts[employeeId].count += 1;
                  }
                }
              });
            }
          }
        }
        
        // Fetch legacy leads in batch
        if (legacyLeadIdsForHandlers.length > 0) {
          const { data: legacyLeadsForHandlers } = await supabase
            .from('leads_lead')
            .select('id, case_handler_id')
            .in('id', legacyLeadIdsForHandlers);
          
          if (legacyLeadsForHandlers) {
            // Count stage changes by case_handler_id
            deduplicatedChanges.forEach((change: any) => {
              if (change.lead_id) {
                const lead = legacyLeadsForHandlers.find(l => l.id === change.lead_id);
                if (lead?.case_handler_id) {
                  const employee = employees?.find(emp => String(emp.id) === String(lead.case_handler_id));
                  if (employee) {
                    const employeeId = employee.id;
                    if (!handlerCounts[employeeId]) {
                      handlerCounts[employeeId] = { count: 0, employee };
                    }
                    handlerCounts[employeeId].count += 1;
                  }
                }
              }
            });
          }
        }
        
        scoreboard.handlers = Object.entries(handlerCounts)
          .map(([employeeId, data]) => ({ name: data.employee.display_name, count: data.count, employee: data.employee }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 3);
        console.log('✅ EmployeeScoreboard - Handlers processed:', scoreboard.handlers);
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
