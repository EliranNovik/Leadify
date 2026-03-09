import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { EyeIcon, ChevronDownIcon, ChevronRightIcon, CurrencyDollarIcon } from '@heroicons/react/24/outline';
import EmployeeRoleLeadsModal from './EmployeeRoleLeadsModal';
import {
  batchCalculateEmployeeMetrics,
  type EmployeeCalculationInput,
  type EmployeeCalculationResult,
} from '../utils/salesContributionCalculator';
import { processNewPayments, processLegacyPayments } from '../utils/paymentPlanProcessor';
import {
  calculateNewLeadFullAmount,
  calculateLegacyLeadFullAmount,
} from '../utils/salesContributionCalculator';

const toStartOfDayIso = (dateStr: string) => `${dateStr}T00:00:00.000Z`;
const toEndOfDayIso = (dateStr: string) => `${dateStr}T23:59:59.999Z`;
const computeDateBounds = (fromDate?: string, toDate?: string) => {
  const startIso = fromDate ? toStartOfDayIso(fromDate) : null;
  const endIso = toDate ? toEndOfDayIso(toDate) : fromDate ? toEndOfDayIso(fromDate) : null;
  return { startIso, endIso };
};

const getRolePercentagesHash = (percentages: Map<string, number>): string => {
  const roleNames = ['CLOSER', 'SCHEDULER', 'MANAGER', 'EXPERT', 'HANDLER', 'CLOSER_WITH_HELPER', 'HELPER_CLOSER', 'HELPER_HANDLER', 'DEPARTMENT_MANAGER'];
  return roleNames.map(role => `${role}:${percentages.get(role) || 0}`).join('|');
};

function getLast30DaysRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 29);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { from: fmt(from), to: fmt(to) };
}

export interface MyContributionProps {
  employeeId: number | null;
  employeeName: string;
}

interface EmployeeRowData {
  employeeId: number;
  employeeName: string;
  department: string;
  photoUrl: string | null;
  signed: number;
  due: number;
  contribution: number;
  contributionFixed: number;
  salaryBrutto: number;
  totalSalaryCost: number;
  roleBreakdown: Array<{ role: string; signedTotal: number; dueTotal: number }>;
}

const getInitials = (name: string) => {
  if (!name) return '--';
  return name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
};

const EmployeeAvatar: React.FC<{ photoUrl: string | null; name: string }> = ({ photoUrl, name }) => {
  const [imgError, setImgError] = useState(false);
  const showImg = photoUrl && !imgError;
  return (
    <div className="flex items-center gap-3">
      {showImg ? (
        <img
          src={photoUrl!}
          alt={name}
          className="w-10 h-10 rounded-full object-cover flex-shrink-0"
          onError={() => setImgError(true)}
        />
      ) : (
        <span className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold bg-primary/20 text-primary flex-shrink-0">
          {getInitials(name)}
        </span>
      )}
      <span>{name}</span>
    </div>
  );
};

const MyContribution: React.FC<MyContributionProps> = ({ employeeId, employeeName }) => {
  const { from: defaultFrom, to: defaultTo } = getLast30DaysRange();
  const [fromDate, setFromDate] = useState(defaultFrom);
  const [toDate, setToDate] = useState(defaultTo);
  const [loading, setLoading] = useState(false);
  const [totalSignedValue, setTotalSignedValue] = useState(0);
  const [loadingSignedValue, setLoadingSignedValue] = useState(false);
  const totalSignedValueRef = useRef(0);
  const [rowData, setRowData] = useState<EmployeeRowData | null>(null);
  const [totalIncome, setTotalIncome] = useState(0);
  const [dueNormalizedPercentage, setDueNormalizedPercentage] = useState(0);
  const [rolePercentages, setRolePercentages] = useState<Map<string, number>>(new Map());
  const [expanded, setExpanded] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalRole, setModalRole] = useState('');

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);

  const fetchSettings = useCallback(async () => {
    try {
      const { data: incomeRow } = await supabase
        .from('sales_contribution_income')
        .select('income_amount, due_normalized_percentage')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (incomeRow) {
        const income = Number(incomeRow.income_amount);
        const duePct = Number(incomeRow.due_normalized_percentage);
        if (!isNaN(income) && income >= 0) setTotalIncome(income);
        if (!isNaN(duePct) && duePct >= 0 && duePct <= 100) setDueNormalizedPercentage(duePct);
      }
      const { data: roleRows } = await supabase.from('role_percentages').select('role_name, percentage').order('role_name');
      if (roleRows) {
        const map = new Map<string, number>();
        roleRows.forEach((r: any) => map.set(r.role_name, Number(r.percentage) || 0));
        setRolePercentages(map);
      }
    } catch (e) {
      console.error('MyContribution fetchSettings:', e);
    }
  }, []);

  const fetchTotalSignedValue = useCallback(async () => {
    if (!fromDate || !toDate) {
      setTotalSignedValue(0);
      totalSignedValueRef.current = 0;
      return;
    }
    setLoadingSignedValue(true);
    try {
      const { startIso, endIso } = computeDateBounds(fromDate, toDate);
      const fromDateTime = startIso!;
      const toDateTime = endIso!;

      const [legacyRes, newRes] = await Promise.all([
        supabase
          .from('leads_leadstage')
          .select('id, date, cdate, lead_id')
          .eq('stage', 60)
          .not('lead_id', 'is', null)
          .gte('date', fromDateTime)
          .lte('date', toDateTime),
        supabase
          .from('leads_leadstage')
          .select('id, date, cdate, newlead_id')
          .eq('stage', 60)
          .not('newlead_id', 'is', null)
          .gte('date', fromDateTime)
          .lte('date', toDateTime),
      ]);

      const legacyRecordsMap = new Map<number, any>();
      (legacyRes.data || []).forEach((record: any) => {
        if (!record.lead_id) return;
        const existing = legacyRecordsMap.get(record.lead_id);
        const recordDate = record.date || record.cdate;
        if (!existing || (recordDate && new Date(recordDate) > new Date(existing.date || existing.cdate)))
          legacyRecordsMap.set(record.lead_id, record);
      });
      const newLeadRecordsMap = new Map<string, any>();
      (newRes.data || []).forEach((record: any) => {
        if (!record.newlead_id) return;
        const id = String(record.newlead_id);
        const recordDate = record.date || record.cdate;
        const existing = newLeadRecordsMap.get(id);
        if (!existing || (recordDate && new Date(recordDate) > new Date(existing.date || existing.cdate)))
          newLeadRecordsMap.set(id, record);
      });

      let legacyLeadsData: any[] = [];
      const legacyIds = Array.from(legacyRecordsMap.keys());
      if (legacyIds.length > 0) {
        const { data } = await supabase
          .from('leads_lead')
          .select('id, total, total_base, currency_id, subcontractor_fee, meeting_total_currency_id, accounting_currencies!leads_lead_currency_id_fkey(iso_code, name)')
          .in('id', legacyIds);
        legacyLeadsData = data || [];
      }
      let newLeadsData: any[] = [];
      const newIds = Array.from(newLeadRecordsMap.keys());
      if (newIds.length > 0) {
        const { data } = await supabase
          .from('leads')
          .select('id, balance, proposal_total, currency_id, balance_currency, proposal_currency, subcontractor_fee, accounting_currencies!leads_currency_id_fkey(iso_code, name)')
          .in('id', newIds);
        newLeadsData = data || [];
      }

      let totalNIS = 0;
      legacyLeadsData.forEach(lead => { totalNIS += calculateLegacyLeadFullAmount(lead); });
      newLeadsData.forEach(lead => { totalNIS += calculateNewLeadFullAmount(lead); });
      const value = Math.ceil(totalNIS);
      setTotalSignedValue(value);
      totalSignedValueRef.current = value;
    } catch (e) {
      console.error('MyContribution fetchTotalSignedValue:', e);
      setTotalSignedValue(0);
      totalSignedValueRef.current = 0;
    } finally {
      setLoadingSignedValue(false);
    }
  }, [fromDate, toDate]);

  const fetchDueAmounts = useCallback(async (empId: number, empName: string): Promise<number> => {
    try {
      const { startIso: fromDateTime, endIso: toDateTime } = computeDateBounds(fromDate, toDate);
      let totalDue = 0;
      const { data: emp } = await supabase.from('tenants_employee').select('id, display_name').eq('id', empId).single();
      if (!emp) return 0;
      const displayName = emp.display_name;

      const { data: newLeadsWithHandler } = await supabase
        .from('leads')
        .select('id, handler, case_handler_id')
        .or(`handler.eq.${displayName},case_handler_id.eq.${empId}`);
      if (newLeadsWithHandler && newLeadsWithHandler.length > 0) {
        const leadIds = newLeadsWithHandler.map((l: any) => l.id).filter(Boolean);
        let q = supabase.from('payment_plans').select('id, lead_id, value, value_vat, currency, due_date, cancel_date, ready_to_pay').eq('ready_to_pay', true).not('due_date', 'is', null).is('cancel_date', null).in('lead_id', leadIds);
        if (fromDateTime) q = q.gte('due_date', fromDateTime);
        if (toDateTime) q = q.lte('due_date', toDateTime);
        const { data: newPayments } = await q;
        if (newPayments) {
          const processed = processNewPayments(newPayments);
          processed.forEach(amount => { totalDue += amount; });
        }
      }

      const { data: legacyLeadsWithHandler } = await supabase.from('leads_lead').select('id, case_handler_id').eq('case_handler_id', empId);
      if (legacyLeadsWithHandler && legacyLeadsWithHandler.length > 0) {
        const legacyIds = legacyLeadsWithHandler.map((l: any) => Number(l.id)).filter(Boolean);
        let q = supabase.from('finances_paymentplanrow').select('id, lead_id, value, value_base, vat_value, currency_id, due_date, cancel_date, accounting_currencies!finances_paymentplanrow_currency_id_fkey(name, iso_code)').not('due_date', 'is', null).is('cancel_date', null).in('lead_id', legacyIds);
        if (fromDateTime) q = q.gte('due_date', fromDateTime);
        if (toDateTime) q = q.lte('due_date', toDateTime);
        const { data: legacyPayments } = await q;
        if (legacyPayments) {
          const processed = processLegacyPayments(legacyPayments, new Map());
          processed.forEach(amount => { totalDue += amount; });
        }
      }
      return totalDue;
    } catch (e) {
      console.error('fetchDueAmounts:', e);
      return 0;
    }
  }, [fromDate, toDate]);

  const runSearch = useCallback(async () => {
    if (!employeeId || !employeeName) {
      setRowData(null);
      return;
    }
    setLoading(true);
    await fetchTotalSignedValue();
    try {
      const { startIso: fromDateTime, endIso: toDateTime } = computeDateBounds(fromDate, toDate);
      if (!fromDateTime || !toDateTime) {
        setRowData(null);
        return;
      }

      const { data: stageData, error: stageErr } = await supabase
        .from('leads_leadstage')
        .select('id, stage, date, cdate, lead_id, newlead_id')
        .eq('stage', 60)
        .gte('date', fromDateTime)
        .lte('date', toDateTime);
      if (stageErr) throw stageErr;

      const newLeadIds = new Set<string>();
      const legacyLeadIds = new Set<number>();
      (stageData || []).forEach((entry: any) => {
        if (entry.newlead_id) newLeadIds.add(entry.newlead_id.toString());
        if (entry.lead_id != null) legacyLeadIds.add(Number(entry.lead_id));
      });

      const newLeadsMap = new Map<string, any>();
      if (newLeadIds.size > 0) {
        const { data: newLeads } = await supabase
          .from('leads')
          .select(`
            id, lead_number, name, balance, balance_currency, proposal_total, proposal_currency, currency_id,
            closer, scheduler, handler, helper, meeting_lawyer_id, lawyer, expert, case_handler_id, manager, meeting_manager_id, subcontractor_fee, category_id, category,
            accounting_currencies!leads_currency_id_fkey(name, iso_code),
            misc_category!category_id(id, name, parent_id, misc_maincategory!parent_id(id, name))
          `)
          .in('id', Array.from(newLeadIds));
        (newLeads || []).forEach((l: any) => newLeadsMap.set(l.id, l));
      }

      const legacyLeadsMap = new Map<number, any>();
      if (legacyLeadIds.size > 0) {
        const { data: legacyLeads } = await supabase
          .from('leads_lead')
          .select(`
            id, total, total_base, currency_id, subcontractor_fee, meeting_total_currency_id,
            closer_id, meeting_scheduler_id, meeting_lawyer_id, case_handler_id, meeting_manager_id, expert_id, category_id, category,
            accounting_currencies!leads_lead_currency_id_fkey(name, iso_code),
            misc_category!category_id(id, name, parent_id, misc_maincategory!parent_id(id, name))
          `)
          .in('id', Array.from(legacyLeadIds));
        (legacyLeads || []).forEach((l: any) => legacyLeadsMap.set(Number(l.id), l));
      }

      const newPaymentsMap = new Map<string, number>();
      if (newLeadIds.size > 0) {
        let q = supabase.from('payment_plans').select('lead_id, value, value_vat, currency, due_date').eq('ready_to_pay', true).eq('paid', false).not('due_date', 'is', null).is('cancel_date', null).in('lead_id', Array.from(newLeadIds));
        if (fromDateTime) q = q.gte('due_date', fromDateTime);
        if (toDateTime) q = q.lte('due_date', toDateTime);
        const { data: newPayments } = await q;
        if (newPayments) {
          const processed = processNewPayments(newPayments);
          processed.forEach((amount, leadId) => newPaymentsMap.set(leadId, (newPaymentsMap.get(leadId) || 0) + amount));
        }
      }

      const legacyPaymentsMap = new Map<number, number>();
      if (legacyLeadIds.size > 0) {
        let q = supabase.from('finances_paymentplanrow').select('lead_id, value, value_base, vat_value, currency_id, due_date').not('due_date', 'is', null).is('cancel_date', null).in('lead_id', Array.from(legacyLeadIds));
        if (fromDateTime) q = q.gte('due_date', fromDateTime);
        if (toDateTime) q = q.lte('due_date', toDateTime);
        const { data: legacyPayments } = await q;
        if (legacyPayments) {
          const processed = processLegacyPayments(legacyPayments, legacyLeadsMap);
          processed.forEach((amount, leadId) => legacyPaymentsMap.set(leadId, (legacyPaymentsMap.get(leadId) || 0) + amount));
        }
      }

      const checkNew = (lead: any, roleField: string): boolean => {
        if (roleField === 'closer' && lead.closer) {
          const v = lead.closer;
          return typeof v === 'string' ? v.toLowerCase() === employeeName.toLowerCase() : Number(v) === employeeId;
        }
        if (roleField === 'scheduler' && lead.scheduler) {
          const v = lead.scheduler;
          return typeof v === 'string' ? v.toLowerCase() === employeeName.toLowerCase() : Number(v) === employeeId;
        }
        if (roleField === 'handler') {
          if (lead.handler && (typeof lead.handler === 'string' ? lead.handler.toLowerCase() === employeeName.toLowerCase() : Number(lead.handler) === employeeId)) return true;
          if (lead.case_handler_id && Number(lead.case_handler_id) === employeeId) return true;
          return false;
        }
        if (roleField === 'helper') {
          if (lead.helper != null && lead.helper !== '' && (typeof lead.helper === 'string' ? lead.helper.toLowerCase() === employeeName.toLowerCase() : Number(lead.helper) === employeeId)) return true;
          if (lead.meeting_lawyer_id != null && Number(lead.meeting_lawyer_id) === employeeId) return true;
          if (lead.lawyer != null && lead.lawyer !== '' && (typeof lead.lawyer === 'string' ? lead.lawyer.toLowerCase() === employeeName.toLowerCase() : Number(lead.lawyer) === employeeId)) return true;
          return false;
        }
        if (roleField === 'expert' && lead.expert) return Number(lead.expert) === employeeId;
        if (roleField === 'meeting_manager_id') {
          if (lead.manager) {
            const v = lead.manager;
            if (typeof v === 'string') {
              const n = Number(v);
              if (!isNaN(n) && n.toString() === v.trim()) return n === employeeId;
              return v.toLowerCase() === employeeName.toLowerCase();
            }
            return Number(v) === employeeId;
          }
          if (lead.meeting_manager_id) return Number(lead.meeting_manager_id) === employeeId;
          return false;
        }
        return false;
      };

      const employeeNewLeads = Array.from(newLeadsMap.values()).filter(lead =>
        checkNew(lead, 'closer') || checkNew(lead, 'scheduler') || checkNew(lead, 'handler') || checkNew(lead, 'helper') || checkNew(lead, 'expert') || checkNew(lead, 'meeting_manager_id')
      );
      const employeeLegacyLeads = Array.from(legacyLeadsMap.values()).filter(lead =>
        (lead.closer_id && Number(lead.closer_id) === employeeId) ||
        (lead.meeting_scheduler_id && Number(lead.meeting_scheduler_id) === employeeId) ||
        (lead.meeting_lawyer_id && Number(lead.meeting_lawyer_id) === employeeId) ||
        (lead.case_handler_id && Number(lead.case_handler_id) === employeeId) ||
        (lead.expert_id && Number(lead.expert_id) === employeeId) ||
        (lead.meeting_manager_id && Number(lead.meeting_manager_id) === employeeId)
      );

      const totalDueAmount = await fetchDueAmounts(employeeId, employeeName);
      const totalSignedOverall = totalSignedValueRef.current || 0;

      const salaryDataMap = new Map<number, { salaryBrutto: number; totalSalaryCost: number }>();
      const toDateObj = new Date(toDate);
      const salaryMonth = toDateObj.getMonth() + 1;
      const salaryYear = toDateObj.getFullYear();
      const { data: salaryData } = await supabase
        .from('employee_salary')
        .select('employee_id, net_salary, gross_salary')
        .eq('salary_month', salaryMonth)
        .eq('salary_year', salaryYear)
        .eq('employee_id', employeeId);
      if (salaryData && salaryData.length > 0) {
        const s = salaryData[0];
        salaryDataMap.set(employeeId, {
          salaryBrutto: Number(s.net_salary || 0),
          totalSalaryCost: Number(s.gross_salary || 0),
        });
      }

      const input: EmployeeCalculationInput = {
        employeeId,
        employeeName,
        leads: { newLeads: employeeNewLeads, legacyLeads: employeeLegacyLeads },
        payments: { newPayments: newPaymentsMap, legacyPayments: legacyPaymentsMap },
        totalDueAmount,
        totalSignedOverall,
        totalIncome,
        dueNormalizedPercentage,
        rolePercentages,
      };

      const results = batchCalculateEmployeeMetrics([input]);
      const result = results.get(employeeId);
      if (!result) {
        setRowData(null);
        return;
      }

      const salaryDataEmp = salaryDataMap.get(employeeId);
      const salaryBrutto = salaryDataEmp?.salaryBrutto ?? 0;
      const totalSalaryCost = salaryDataEmp?.totalSalaryCost ?? 0;

      let contributionFixed = 0;
      const { data: fixedRows } = await supabase
        .from('employee_fixed_contribution')
        .select('fixed_contribution_amount')
        .eq('employee_id', employeeId);
      if (fixedRows && fixedRows.length > 0) {
        contributionFixed = (fixedRows as any[]).reduce((sum, r) => sum + (Number(r.fixed_contribution_amount) || 0), 0);
      }

      let department = 'Unknown';
      let photoUrl: string | null = null;
      const { data: empRow } = await supabase
        .from('tenants_employee')
        .select('department_id, photo_url, photo, tenant_departement:department_id(name)')
        .eq('id', employeeId)
        .maybeSingle();
      if (empRow) {
        photoUrl = (empRow as any).photo_url || (empRow as any).photo || null;
        if ((empRow as any).tenant_departement) {
          const dept = Array.isArray((empRow as any).tenant_departement) ? (empRow as any).tenant_departement[0] : (empRow as any).tenant_departement;
          if (dept?.name) department = dept.name;
        }
      }

      setRowData({
        employeeId,
        employeeName,
        department,
        photoUrl,
        signed: result.signed,
        due: result.due,
        contribution: result.contribution,
        contributionFixed,
        salaryBrutto,
        totalSalaryCost,
        roleBreakdown: result.roleBreakdown.map(r => ({ role: r.role, signedTotal: r.signedTotal, dueTotal: r.dueTotal })),
      });
    } catch (e) {
      console.error('MyContribution runSearch:', e);
      setRowData(null);
    } finally {
      setLoading(false);
    }
  }, [employeeId, employeeName, fromDate, toDate, totalIncome, dueNormalizedPercentage, rolePercentages, fetchTotalSignedValue, fetchDueAmounts]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  useEffect(() => {
    if (fromDate && toDate) fetchTotalSignedValue();
  }, [fromDate, toDate, fetchTotalSignedValue]);

  useEffect(() => {
    if (employeeId && employeeName && fromDate && toDate && rolePercentages.size >= 0) {
      runSearch();
    } else {
      setRowData(null);
    }
  }, [employeeId, employeeName, fromDate, toDate, totalIncome, dueNormalizedPercentage, rolePercentages]);

  if (employeeId == null) {
    return (
      <div className="rounded-xl border border-base-300 bg-base-200/50 p-4">
        <h3 className="text-lg font-semibold text-base-content">My Contribution</h3>
        <p className="text-base-content/70 text-sm mt-2">Sign in and link your account to an employee to see your contribution.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl shadow-xl border border-base-200 bg-base-100 overflow-hidden md:shadow-lg md:border-gray-200 md:bg-white">
      {/* Header: same on all viewports */}
      <div className="p-4 md:p-4 border-b border-base-200 flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-base-200/50 to-transparent md:bg-white md:border-gray-200">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center flex-shrink-0 shadow-md">
            <CurrencyDollarIcon className="w-5 h-5 text-primary-content" />
          </div>
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold text-base-content">My Contribution</h3>
            {loading && (
              <span className="loading loading-spinner loading-sm text-primary" title="Loading data…" />
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 md:gap-3">
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-medium text-base-content/60 hidden sm:inline">From</label>
            <input
              type="date"
              className="input input-bordered input-sm w-32 md:w-36 rounded-lg text-sm"
              value={fromDate}
              onChange={e => setFromDate(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-medium text-base-content/60 hidden sm:inline">To</label>
            <input
              type="date"
              className="input input-bordered input-sm w-32 md:w-36 rounded-lg text-sm"
              value={toDate}
              onChange={e => setToDate(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Mobile: stylish box/card view */}
      <div className="md:hidden p-4 space-y-4">
        {loading && (
          <div className="flex flex-col items-center justify-center py-12 text-base-content/60 gap-3">
            <span className="loading loading-spinner loading-lg text-primary" />
            <span className="text-sm">Loading your contribution…</span>
          </div>
        )}
        {!loading && rowData && (
          <>
            <div
              className="rounded-2xl bg-gradient-to-br from-base-100 to-base-200/30 border border-base-300/50 p-5 shadow-md active:scale-[0.99] transition-transform touch-manipulation"
              onClick={() => setExpanded(e => !e)}
              role="button"
              tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && setExpanded(prev => !prev)}
            >
              {/* Employee block */}
              <div className="flex items-center justify-between gap-3 mb-4">
                <div className="min-w-0 flex-1">
                  <EmployeeAvatar photoUrl={rowData.photoUrl} name={rowData.employeeName} />
                  <p className="text-xs text-base-content/60 mt-1 truncate">{rowData.department}</p>
                </div>
                <div className="flex-shrink-0 w-9 h-9 rounded-full bg-base-300/50 flex items-center justify-center">
                  {expanded ? <ChevronDownIcon className="w-5 h-5 text-base-content/70" /> : <ChevronRightIcon className="w-5 h-5 text-base-content/70" />}
                </div>
              </div>

              {/* Metrics grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-base-100 border border-base-300/50 p-3 shadow-sm">
                  <p className="text-xs font-medium text-base-content/50 uppercase tracking-wide mb-0.5">Signed</p>
                  <p className="text-base font-semibold text-base-content">{formatCurrency(rowData.signed)}</p>
                </div>
                <div className="rounded-xl bg-base-100 border border-base-300/50 p-3 shadow-sm">
                  <p className="text-xs font-medium text-base-content/50 uppercase tracking-wide mb-0.5">Due</p>
                  <p className="text-base font-semibold text-base-content">{formatCurrency(rowData.due)}</p>
                </div>
                <div className="rounded-xl bg-primary/10 border border-primary/20 p-3 shadow-sm col-span-2">
                  <p className="text-xs font-medium text-primary/80 uppercase tracking-wide mb-0.5">Contribution</p>
                  <p className="text-lg font-bold text-primary">{formatCurrency(rowData.contribution)}</p>
                </div>
                {rowData.contributionFixed != null && rowData.contributionFixed !== 0 && (
                  <div className="rounded-xl bg-base-100 border border-base-300/50 p-3 shadow-sm col-span-2">
                    <p className="text-xs font-medium text-base-content/50 uppercase tracking-wide mb-0.5">Contribution fixed</p>
                    <p className="text-base font-semibold text-base-content">{formatCurrency(rowData.contributionFixed)}</p>
                  </div>
                )}
              </div>
              <p className="text-xs text-base-content/40 mt-3 text-center">Tap to see role breakdown</p>
            </div>

            {expanded && rowData.roleBreakdown.length > 0 && (
              <div className="rounded-2xl border border-base-300/50 bg-base-100 p-4 shadow-md space-y-1">
                <h4 className="text-sm font-semibold text-base-content/80 mb-3 px-1">Role breakdown</h4>
                {rowData.roleBreakdown.map((item, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between gap-2 py-3 px-3 rounded-xl bg-base-200/40 hover:bg-base-200/60 transition-colors"
                  >
                    <span className="font-medium text-sm text-base-content">{item.role}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-base-content/70 tabular-nums">{formatCurrency(item.signedTotal)} / {formatCurrency(item.dueTotal)}</span>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm btn-circle btn-primary"
                        title="View leads"
                        onClick={e => {
                          e.stopPropagation();
                          setModalRole(item.role);
                          setModalOpen(true);
                        }}
                      >
                        <EyeIcon className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        {!loading && !rowData && employeeId && (
          <div className="rounded-2xl border border-dashed border-base-300 bg-base-200/30 py-12 text-center">
            <p className="text-base-content/60">No data for this period.</p>
            <p className="text-sm text-base-content/40 mt-1">Try another date range</p>
          </div>
        )}
      </div>

      {/* Desktop: table view */}
      <div className="hidden md:block overflow-x-auto">
        <table className="table table-zebra">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Department</th>
              <th className="text-right">Signed</th>
              <th className="text-right">Due</th>
              <th className="text-right">Contribution</th>
              {rowData && rowData.contributionFixed != null && rowData.contributionFixed !== 0 && (
                <th className="text-right">Contribution fixed</th>
              )}
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={rowData && rowData.contributionFixed != null && rowData.contributionFixed !== 0 ? 7 : 6} className="text-center py-8 text-base-content/70">
                  <span className="loading loading-spinner loading-md" /> Loading…
                </td>
              </tr>
            )}
            {!loading && rowData && (
              <>
                <tr
                  className="cursor-pointer hover:bg-base-200"
                  onClick={() => setExpanded(e => !e)}
                >
                  <td className="font-medium">
                    <EmployeeAvatar photoUrl={rowData.photoUrl} name={rowData.employeeName} />
                  </td>
                  <td>{rowData.department}</td>
                  <td className="text-right">{formatCurrency(rowData.signed)}</td>
                  <td className="text-right">{formatCurrency(rowData.due)}</td>
                  <td className="text-right">{formatCurrency(rowData.contribution)}</td>
                  {rowData.contributionFixed != null && rowData.contributionFixed !== 0 && (
                    <td className="text-right">{formatCurrency(rowData.contributionFixed)}</td>
                  )}
                  <td>{expanded ? <ChevronDownIcon className="w-4 h-4" /> : <ChevronRightIcon className="w-4 h-4" />}</td>
                </tr>
                {expanded && rowData.roleBreakdown.length > 0 && (
                  <>
                    <tr className="bg-white">
                      <td colSpan={rowData.contributionFixed != null && rowData.contributionFixed !== 0 ? 7 : 6} className="bg-white pt-2 pb-1 font-medium text-base-content/70">
                        Role breakdown
                      </td>
                    </tr>
                    {rowData.roleBreakdown.map((item, idx) => (
                      <tr key={idx} className="bg-white">
                        <td className="bg-white font-medium pl-4">{item.role}</td>
                        <td className="bg-white" />
                        <td className="bg-white text-right">{formatCurrency(item.signedTotal)}</td>
                        <td className="bg-white text-right">{formatCurrency(item.dueTotal)}</td>
                        <td className="bg-white" />
                        {rowData.contributionFixed != null && rowData.contributionFixed !== 0 && <td className="bg-white" />}
                        <td className="bg-white">
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm btn-circle"
                            title="View leads"
                            onClick={e => {
                              e.stopPropagation();
                              setModalRole(item.role);
                              setModalOpen(true);
                            }}
                          >
                            <EyeIcon className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </>
                )}
              </>
            )}
            {!loading && !rowData && employeeId && (
              <tr>
                <td colSpan={6} className="text-center py-6 text-base-content/60">No data for this period.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {employeeId && (
        <EmployeeRoleLeadsModal
          isOpen={modalOpen}
          onClose={() => {
            setModalOpen(false);
            setModalRole('');
          }}
          employeeId={employeeId}
          employeeName={employeeName}
          role={modalRole}
          fromDate={fromDate}
          toDate={toDate}
        />
      )}
    </div>
  );
};

export default MyContribution;
