import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../lib/supabase';
import { CurrencyDollarIcon } from '@heroicons/react/24/outline';
import EmployeeRoleLeadsModal from './EmployeeRoleLeadsModal';
import {
  batchCalculateEmployeeMetrics,
  type EmployeeCalculationInput,
  type EmployeeCalculationResult,
} from '../utils/salesContributionCalculator';
import { legacyLeadMatchesExpert, newLeadMatchesExpert } from '../utils/rolePercentageCalculator';
import { resolveNewLeadIdsForHandler } from '../utils/handlerNewLeadIds';
import { processNewPayments, processLegacyPayments } from '../utils/paymentPlanProcessor';
import {
  calculateNewLeadAmount,
  calculateLegacyLeadAmount,
} from '../utils/salesContributionCalculator';

const toStartOfDayIso = (dateStr: string) => `${dateStr}T00:00:00.000Z`;
const toEndOfDayIso = (dateStr: string) => `${dateStr}T23:59:59.999Z`;
const computeDateBounds = (fromDate?: string, toDate?: string) => {
  const startIso = fromDate ? toStartOfDayIso(fromDate) : null;
  const endIso = toDate ? toEndOfDayIso(toDate) : fromDate ? toEndOfDayIso(fromDate) : null;
  return { startIso, endIso };
};

const shiftIsoDateByDays = (isoDate: string, deltaDays: number): string => {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
};

const daysBetweenIsoDatesInclusive = (from: string, to: string): number => {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const a = Date.UTC(fy, fm - 1, fd);
  const b = Date.UTC(ty, tm - 1, td);
  const diff = Math.floor((b - a) / (24 * 60 * 60 * 1000));
  return Math.max(1, diff + 1);
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
  /** When true, show the Contribution Fixed column even if value is 0 (e.g. fixed contributor but missing salary). */
  hasContributionFixed: boolean;
  /** Salary budget = 40% × (contribution + contributionFixed) (same as SalesContributionPage). */
  salaryBudget: number;
  salaryBrutto: number;
  totalSalaryCost: number;
  /** Previous month (calendar-shifted) contribution for arrow indicator. */
  previousContribution?: number;
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

type GiveawayRecipient = { employeeId: number; employeeName: string; photoUrl: string | null; amount: number };

const EmployeeAvatar: React.FC<{ photoUrl: string | null; name: string; className?: string }> = ({ photoUrl, name, className }) => {
  const [imgError, setImgError] = useState(false);
  const showImg = photoUrl && !imgError;
  return (
    showImg ? (
      <img
        src={photoUrl!}
        alt={name}
        className={className || 'w-10 h-10 rounded-full object-cover flex-shrink-0'}
        onError={() => setImgError(true)}
      />
    ) : (
      <span className={className || 'w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold bg-primary/20 text-primary flex-shrink-0'}>
        {getInitials(name)}
      </span>
    )
  );
};

const GiveawayPopover: React.FC<{
  isOpen: boolean;
  anchorRect: DOMRect | null;
  recipients: GiveawayRecipient[];
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  formatCurrency: (n: number) => string;
}> = ({ isOpen, anchorRect, recipients, onMouseEnter, onMouseLeave, formatCurrency }) => {
  if (!isOpen || !anchorRect || recipients.length === 0) return null;
  const width = 320;
  const margin = 12;
  const left = Math.max(
    margin,
    Math.min(anchorRect.left, window.innerWidth - width - margin)
  );
  const top = Math.min(anchorRect.bottom + 8, window.innerHeight - margin);
  return createPortal(
    <div
      style={{ position: 'fixed', left, top, width, zIndex: 99999 }}
      className="rounded-box border border-base-300 bg-base-100 p-3 shadow-lg text-left whitespace-normal break-words [overflow-wrap:anywhere]"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <p className="text-[0.7rem] text-base-content/60 leading-snug mb-2">
        You are giving part of your contribution to:
      </p>
      <ul className="space-y-2">
        {recipients.map((r) => (
          <li key={r.employeeId} className="flex items-center gap-2 min-w-0">
            <EmployeeAvatar photoUrl={r.photoUrl} name={r.employeeName} className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium truncate">{r.employeeName}</div>
              <div className="text-xs tabular-nums text-primary">{formatCurrency(r.amount)}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>,
    document.body
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
  const [departmentPercentages, setDepartmentPercentages] = useState<Map<string, number>>(new Map());
  const [useFixedContributionFromDb, setUseFixedContributionFromDb] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalRole, setModalRole] = useState('');
  const [giveawayRecipients, setGiveawayRecipients] = useState<GiveawayRecipient[]>([]);
  const [giveawayOpen, setGiveawayOpen] = useState(false);
  const [giveawayAnchorRect, setGiveawayAnchorRect] = useState<DOMRect | null>(null);
  const giveawayCloseTimerRef = useRef<number | null>(null);

  const clearGiveawayCloseTimer = () => {
    if (giveawayCloseTimerRef.current != null) {
      window.clearTimeout(giveawayCloseTimerRef.current);
      giveawayCloseTimerRef.current = null;
    }
  };

  const scheduleGiveawayClose = () => {
    clearGiveawayCloseTimer();
    giveawayCloseTimerRef.current = window.setTimeout(() => setGiveawayOpen(false), 140);
  };

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

      const { data: deptRows } = await supabase
        .from('sales_contribution_settings')
        .select('department, percentage');
      if (deptRows) {
        const map = new Map<string, number>();
        (deptRows as any[]).forEach((r: any) => map.set(String(r.department), Number(r.percentage) || 0));
        setDepartmentPercentages(map);
      }

      const { data: fixedToggleRow } = await supabase
        .from('sales_contribution_use_fixed_from_db')
        .select('use_fixed_contribution_from_db')
        .eq('id', 1)
        .maybeSingle();
      setUseFixedContributionFromDb(!!(fixedToggleRow as any)?.use_fixed_contribution_from_db);
    } catch (e) {
      console.error('MyContribution fetchSettings:', e);
    }
  }, []);

  const computeTotalSignedValueForRange = useCallback(async (from: string, to: string): Promise<number> => {
    const { startIso, endIso } = computeDateBounds(from, to);
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
    legacyLeadsData.forEach(lead => { totalNIS += calculateLegacyLeadAmount(lead); });
    newLeadsData.forEach(lead => { totalNIS += calculateNewLeadAmount(lead); });
    return Math.ceil(totalNIS);
  }, []);

  const fetchTotalSignedValue = useCallback(async () => {
    if (!fromDate || !toDate) {
      setTotalSignedValue(0);
      totalSignedValueRef.current = 0;
      return;
    }
    setLoadingSignedValue(true);
    try {
      const value = await computeTotalSignedValueForRange(fromDate, toDate);
      setTotalSignedValue(value);
      totalSignedValueRef.current = value;
    } catch (e) {
      console.error('MyContribution fetchTotalSignedValue:', e);
      setTotalSignedValue(0);
      totalSignedValueRef.current = 0;
    } finally {
      setLoadingSignedValue(false);
    }
  }, [fromDate, toDate, computeTotalSignedValueForRange]);

  const fetchDueAmountsForRange = useCallback(async (empId: number, empName: string, from: string, to: string): Promise<number> => {
    try {
      const { startIso: fromDateTime, endIso: toDateTime } = computeDateBounds(from, to);
      let totalDue = 0;
      const { data: emp } = await supabase.from('tenants_employee').select('id, display_name').eq('id', empId).single();
      if (!emp) return 0;
      const displayName = emp.display_name;

      const leadIds = await resolveNewLeadIdsForHandler(empId, displayName);
      if (leadIds.length > 0) {
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
  }, []);

  const fetchDueAmounts = useCallback(async (empId: number, empName: string): Promise<number> => {
    return fetchDueAmountsForRange(empId, empName, fromDate, toDate);
  }, [fetchDueAmountsForRange, fromDate, toDate]);

  const runSearch = useCallback(async () => {
    if (!employeeId || !employeeName) {
      setRowData(null);
      setGiveawayRecipients([]);
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
            closer, scheduler, handler, helper, meeting_lawyer_id, lawyer, expert, expert_id, case_handler_id, manager, meeting_manager_id, subcontractor_fee, category_id, category,
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
        if (roleField === 'expert') return newLeadMatchesExpert(lead, employeeId, employeeName);
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
        legacyLeadMatchesExpert(lead, employeeId, employeeName) ||
        (lead.meeting_manager_id && Number(lead.meeting_manager_id) === employeeId)
      );

      const totalDueAmount = await fetchDueAmounts(employeeId, employeeName);
      const totalSignedOverall = totalSignedValueRef.current || 0;

      // Fetch employee department + photo early so we can apply same dept% + fixed logic as SalesContributionPage
      let department = 'Unknown';
      let departmentRole: 'Sales' | 'Handlers' | 'Partners' | 'Marketing' | 'Finance' | 'Other' = 'Other';
      let photoUrl: string | null = null;
      const { data: empRow } = await supabase
        .from('tenants_employee')
        .select('department_id, photo_url, photo, tenant_departement:department_id(name)')
        .eq('id', employeeId)
        .maybeSingle();
      if (empRow) {
        photoUrl = (empRow as any).photo_url || (empRow as any).photo || null;
        const dept = (empRow as any).tenant_departement
          ? (Array.isArray((empRow as any).tenant_departement) ? (empRow as any).tenant_departement[0] : (empRow as any).tenant_departement)
          : null;
        if (dept?.name) department = dept.name;
      }

      // Department role (Sales/Handlers/Partners/Marketing/Finance) must come from employee_field_assignments (same as SalesContributionPage).
      try {
        const { data: myAssignments } = await supabase
          .from('employee_field_assignments')
          .select('department_role')
          .eq('employee_id', employeeId)
          .eq('is_active', true);
        const roles = new Set<string>((myAssignments || []).map((a: any) => String(a.department_role)).filter(Boolean));
        if (roles.has('Sales')) departmentRole = 'Sales';
        else if (roles.has('Handlers')) departmentRole = 'Handlers';
        else if (roles.has('Partners')) departmentRole = 'Partners';
        else if (roles.has('Marketing')) departmentRole = 'Marketing';
        else if (roles.has('Finance')) departmentRole = 'Finance';
        else departmentRole = 'Other';
      } catch (e) {
        console.error('MyContribution fetch department_role:', e);
      }

      // Partners/Marketing/Finance use Sales % in SalesContributionPage
      const pctKey = (departmentRole === 'Partners' || departmentRole === 'Marketing' || departmentRole === 'Finance') ? 'Sales' : departmentRole;
      const departmentPercentage = departmentPercentages.get(pctKey) ?? 35;

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
        departmentPercentage,
        departmentName: departmentRole,
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

      // Contribution fixed — same logic as SalesContributionPage (toggle: DB vs hardcoded)
      let contributionFixed = 0;
      let hasContributionFixed = false;
      if (useFixedContributionFromDb) {
        const { data: fixedRows } = await supabase
          .from('employee_fixed_contribution')
          .select('fixed_contribution_amount')
          .eq('employee_id', employeeId);
        hasContributionFixed = !!(fixedRows && fixedRows.length > 0);
        if (fixedRows && fixedRows.length > 0) {
          contributionFixed = (fixedRows as any[]).reduce((sum, r) => sum + (Number(r.fixed_contribution_amount) || 0), 0);
        }
      } else {
        // Matches SalesContributionPage: 60% for M/F/P, 100% salaryB for employees with active assignment in those roles, else 0.
        const employeesWithFixedContribution = new Set<number>();
        try {
          const { data: fieldAssignments } = await supabase
            .from('employee_field_assignments')
            .select('employee_id')
            .in('department_role', ['Marketing', 'Finance', 'Partners'])
            .eq('is_active', true);
          (fieldAssignments || []).forEach((a: any) => employeesWithFixedContribution.add(Number(a.employee_id)));
        } catch (e) {
          console.error('MyContribution fetch employee_field_assignments:', e);
        }
        if (departmentRole === 'Marketing' || departmentRole === 'Finance' || departmentRole === 'Partners') {
          hasContributionFixed = true;
          contributionFixed = salaryBrutto * 0.6;
        } else if (employeesWithFixedContribution.has(employeeId)) {
          hasContributionFixed = true;
          contributionFixed = salaryBrutto;
        } else {
          contributionFixed = 0;
        }
      }

      // Hover: “who we are giving away contribution for” — same equal-split logic as SalesContributionPage
      // amount to each fixed colleague = (their fixed) / N, where N is count of dept colleagues with fixed==0.
      try {
        const recipients: GiveawayRecipient[] = [];
        const isGiver = contributionFixed === 0 && (result.contribution || 0) > 0;
        if (isGiver && departmentRole !== 'Other') {
          const { data: deptAssignments } = await supabase
            .from('employee_field_assignments')
            .select('employee_id')
            .eq('department_role', departmentRole)
            .eq('is_active', true);
          const deptEmployeeIds = [...new Set((deptAssignments || []).map((a: any) => Number(a.employee_id)).filter(Boolean))];
          if (deptEmployeeIds.length > 0) {
            const { data: deptEmployees } = await supabase
              .from('tenants_employee')
              .select('id, official_name, display_name, photo_url, photo')
              .in('id', deptEmployeeIds);
            const empMeta = new Map<number, { name: string; photoUrl: string | null }>();
            (deptEmployees || []).forEach((e: any) => {
              const name = (e.official_name || e.display_name || `Employee ${e.id}`) as string;
              empMeta.set(Number(e.id), { name, photoUrl: e.photo_url || e.photo || null });
            });

            // salaryB for dept employees (needed for hardcoded fixed logic)
            const salaryBById = new Map<number, number>();
            if (!useFixedContributionFromDb) {
              const { data: deptSalary } = await supabase
                .from('employee_salary')
                .select('employee_id, net_salary')
                .eq('salary_month', salaryMonth)
                .eq('salary_year', salaryYear)
                .in('employee_id', deptEmployeeIds);
              (deptSalary || []).forEach((s: any) => salaryBById.set(Number(s.employee_id), Number(s.net_salary || 0)));
            }

            let fixedById = new Map<number, number>();
            if (useFixedContributionFromDb) {
              const { data: fixedRowsAll } = await supabase
                .from('employee_fixed_contribution')
                .select('employee_id, fixed_contribution_amount')
                .in('employee_id', deptEmployeeIds);
              fixedById = new Map<number, number>();
              (fixedRowsAll || []).forEach((r: any) => {
                const id = Number(r.employee_id);
                const amount = Number(r.fixed_contribution_amount) || 0;
                fixedById.set(id, (fixedById.get(id) || 0) + amount);
              });
            } else {
              const employeesWithFixedContribution = new Set<number>();
              try {
                const { data: fieldAssignments } = await supabase
                  .from('employee_field_assignments')
                  .select('employee_id')
                  .in('department_role', ['Marketing', 'Finance', 'Partners'])
                  .eq('is_active', true)
                  .in('employee_id', deptEmployeeIds);
                (fieldAssignments || []).forEach((a: any) => employeesWithFixedContribution.add(Number(a.employee_id)));
              } catch (e) {
                console.error('MyContribution fetch employee_field_assignments (dept):', e);
              }
              fixedById = new Map<number, number>();
              deptEmployeeIds.forEach((id) => {
                const salaryB = salaryBById.get(id) || 0;
                let fixed = 0;
                if (departmentRole === 'Marketing' || departmentRole === 'Finance' || departmentRole === 'Partners') {
                  fixed = salaryB * 0.6;
                } else if (employeesWithFixedContribution.has(id)) {
                  fixed = salaryB;
                } else {
                  fixed = 0;
                }
                fixedById.set(id, fixed);
              });
            }

            const nGivers = deptEmployeeIds.filter((id) => (fixedById.get(id) || 0) <= 0).length;
            if (nGivers > 0) {
              deptEmployeeIds.forEach((id) => {
                const f = fixedById.get(id) || 0;
                if (f <= 0) return;
                const meta = empMeta.get(id);
                recipients.push({
                  employeeId: id,
                  employeeName: meta?.name || `Employee ${id}`,
                  photoUrl: meta?.photoUrl ?? null,
                  amount: Math.round((f / nGivers) * 100) / 100,
                });
              });
            }
          }
        }
        recipients.sort((a, b) => a.employeeName.localeCompare(b.employeeName));
        setGiveawayRecipients(recipients);
      } catch (e) {
        console.error('MyContribution giveaway recipients:', e);
        setGiveawayRecipients([]);
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
        hasContributionFixed,
        salaryBudget: ((result.contribution || 0) + (contributionFixed || 0)) * 0.4,
        salaryBrutto,
        totalSalaryCost,
        previousContribution: undefined,
        roleBreakdown: result.roleBreakdown.map(r => ({ role: r.role, signedTotal: r.signedTotal, dueTotal: r.dueTotal })),
      });

      // Previous period contribution for arrow indicator:
      // same-length range immediately BEFORE current [fromDate, toDate], ending the day before fromDate.
      try {
        const spanDays = daysBetweenIsoDatesInclusive(fromDate, toDate);
        const prevTo = shiftIsoDateByDays(fromDate, -1);
        const prevFrom = shiftIsoDateByDays(prevTo, -(spanDays - 1));
        const prevTotalSignedOverall = await computeTotalSignedValueForRange(prevFrom, prevTo);
        const prevTotalDueAmount = await fetchDueAmountsForRange(employeeId, employeeName, prevFrom, prevTo);

        const { startIso: prevFromIso, endIso: prevToIso } = computeDateBounds(prevFrom, prevTo);
        const { data: prevStageData, error: prevStageErr } = await supabase
          .from('leads_leadstage')
          .select('id, stage, date, cdate, lead_id, newlead_id')
          .eq('stage', 60)
          .gte('date', prevFromIso!)
          .lte('date', prevToIso!);
        if (prevStageErr) throw prevStageErr;

        const prevNewLeadIds = new Set<string>();
        const prevLegacyLeadIds = new Set<number>();
        (prevStageData || []).forEach((entry: any) => {
          if (entry.newlead_id) prevNewLeadIds.add(entry.newlead_id.toString());
          if (entry.lead_id != null) prevLegacyLeadIds.add(Number(entry.lead_id));
        });

        const prevNewLeadsMap = new Map<string, any>();
        if (prevNewLeadIds.size > 0) {
          const { data: newLeads } = await supabase
            .from('leads')
            .select(`
              id, lead_number, name, balance, balance_currency, proposal_total, proposal_currency, currency_id,
              closer, scheduler, handler, helper, meeting_lawyer_id, lawyer, expert, expert_id, case_handler_id, manager, meeting_manager_id, subcontractor_fee, category_id, category,
              accounting_currencies!leads_currency_id_fkey(name, iso_code),
              misc_category!category_id(id, name, parent_id, misc_maincategory!parent_id(id, name))
            `)
            .in('id', Array.from(prevNewLeadIds));
          (newLeads || []).forEach((l: any) => prevNewLeadsMap.set(l.id, l));
        }

        const prevLegacyLeadsMap = new Map<number, any>();
        if (prevLegacyLeadIds.size > 0) {
          const { data: legacyLeads } = await supabase
            .from('leads_lead')
            .select(`
              id, total, total_base, currency_id, subcontractor_fee, meeting_total_currency_id,
              closer_id, meeting_scheduler_id, meeting_lawyer_id, case_handler_id, meeting_manager_id, expert_id, category_id, category,
              accounting_currencies!leads_lead_currency_id_fkey(name, iso_code),
              misc_category!category_id(id, name, parent_id, misc_maincategory!parent_id(id, name))
            `)
            .in('id', Array.from(prevLegacyLeadIds));
          (legacyLeads || []).forEach((l: any) => prevLegacyLeadsMap.set(Number(l.id), l));
        }

        const prevNewPaymentsMap = new Map<string, number>();
        if (prevNewLeadIds.size > 0) {
          let q = supabase.from('payment_plans').select('lead_id, value, value_vat, currency, due_date').eq('ready_to_pay', true).eq('paid', false).not('due_date', 'is', null).is('cancel_date', null).in('lead_id', Array.from(prevNewLeadIds));
          if (prevFromIso) q = q.gte('due_date', prevFromIso);
          if (prevToIso) q = q.lte('due_date', prevToIso);
          const { data: newPayments } = await q;
          if (newPayments) {
            const processed = processNewPayments(newPayments);
            processed.forEach((amount, leadId) => prevNewPaymentsMap.set(leadId, (prevNewPaymentsMap.get(leadId) || 0) + amount));
          }
        }

        const prevLegacyPaymentsMap = new Map<number, number>();
        if (prevLegacyLeadIds.size > 0) {
          let q = supabase.from('finances_paymentplanrow').select('lead_id, value, value_base, vat_value, currency_id, due_date').not('due_date', 'is', null).is('cancel_date', null).in('lead_id', Array.from(prevLegacyLeadIds));
          if (prevFromIso) q = q.gte('due_date', prevFromIso);
          if (prevToIso) q = q.lte('due_date', prevToIso);
          const { data: legacyPayments } = await q;
          if (legacyPayments) {
            const processed = processLegacyPayments(legacyPayments, prevLegacyLeadsMap);
            processed.forEach((amount, leadId) => prevLegacyPaymentsMap.set(leadId, (prevLegacyPaymentsMap.get(leadId) || 0) + amount));
          }
        }

        const checkNewPrev = (lead: any, roleField: string): boolean => {
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
          if (roleField === 'expert') return newLeadMatchesExpert(lead, employeeId, employeeName);
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

        const prevEmployeeNewLeads = Array.from(prevNewLeadsMap.values()).filter((lead) =>
          checkNewPrev(lead, 'closer') || checkNewPrev(lead, 'scheduler') || checkNewPrev(lead, 'handler') || checkNewPrev(lead, 'helper') || checkNewPrev(lead, 'expert') || checkNewPrev(lead, 'meeting_manager_id')
        );
        const prevEmployeeLegacyLeads = Array.from(prevLegacyLeadsMap.values()).filter((lead) =>
          (lead.closer_id && Number(lead.closer_id) === employeeId) ||
          (lead.meeting_scheduler_id && Number(lead.meeting_scheduler_id) === employeeId) ||
          (lead.meeting_lawyer_id && Number(lead.meeting_lawyer_id) === employeeId) ||
          (lead.case_handler_id && Number(lead.case_handler_id) === employeeId) ||
          legacyLeadMatchesExpert(lead, employeeId, employeeName) ||
          (lead.meeting_manager_id && Number(lead.meeting_manager_id) === employeeId)
        );

        const prevInput: EmployeeCalculationInput = {
          employeeId,
          employeeName,
          leads: { newLeads: prevEmployeeNewLeads, legacyLeads: prevEmployeeLegacyLeads },
          payments: { newPayments: prevNewPaymentsMap, legacyPayments: prevLegacyPaymentsMap },
          totalDueAmount: prevTotalDueAmount,
          totalSignedOverall: prevTotalSignedOverall,
          totalIncome,
          dueNormalizedPercentage,
          rolePercentages,
          departmentPercentage,
          departmentName: departmentRole,
        };
        const prevRes = batchCalculateEmployeeMetrics([prevInput]).get(employeeId);
        const prevContribution = prevRes?.contribution ?? 0;

        setRowData((prev) => prev ? ({ ...prev, previousContribution: prevContribution }) : prev);
      } catch (e) {
        // Best effort; keep no arrow if previous calc fails.
        setRowData((prev) => prev ? ({ ...prev, previousContribution: undefined }) : prev);
      }
    } catch (e) {
      console.error('MyContribution runSearch:', e);
      setRowData(null);
      setGiveawayRecipients([]);
    } finally {
      setLoading(false);
    }
  }, [employeeId, employeeName, fromDate, toDate, totalIncome, dueNormalizedPercentage, rolePercentages, departmentPercentages, useFixedContributionFromDb, fetchTotalSignedValue, fetchDueAmounts, fetchDueAmountsForRange, computeTotalSignedValueForRange]);

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
    <div className="rounded-2xl shadow-xl border border-base-200 bg-base-100 overflow-visible md:shadow-lg md:border-gray-200 md:bg-white">
      {/* Header: same on all viewports */}
      <div className="p-4 md:p-4 border-b border-base-200 flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-base-200/50 to-transparent md:bg-white md:border-gray-200">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center flex-shrink-0 shadow-md">
            <CurrencyDollarIcon className="w-5 h-5 text-primary-content" />
          </div>
          <div className="flex flex-col leading-tight">
            <h3 className="text-lg font-semibold text-base-content">My Contribution</h3>
            <span className="text-xs text-base-content/50 -mt-0.5">Last 30 days</span>
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
              onClick={() => {
                setModalRole('ALL');
                setModalOpen(true);
              }}
              role="button"
              tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && (() => {
                setModalRole('ALL');
                setModalOpen(true);
              })()}
            >
              {/* Employee block */}
              <div className="flex items-center justify-between gap-3 mb-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={giveawayRecipients.length > 0 ? 'cursor-help rounded-full hover:opacity-90 focus:outline-none focus-visible:ring focus-visible:ring-primary/40' : ''}
                      title={giveawayRecipients.length > 0 ? 'Hover to see who receives fixed contribution on your behalf' : undefined}
                      onMouseEnter={(e) => {
                        if (giveawayRecipients.length === 0) return;
                        clearGiveawayCloseTimer();
                        setGiveawayAnchorRect((e.currentTarget as HTMLElement).getBoundingClientRect());
                        setGiveawayOpen(true);
                      }}
                      onMouseLeave={() => {
                        if (giveawayRecipients.length === 0) return;
                        scheduleGiveawayClose();
                      }}
                      onClick={(e) => {
                        if (giveawayRecipients.length > 0) e.stopPropagation();
                      }}
                    >
                      <EmployeeAvatar photoUrl={rowData.photoUrl} name={rowData.employeeName} className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
                    </div>
                    <span className="truncate">{rowData.employeeName}</span>
                  </div>
                  <GiveawayPopover
                    isOpen={giveawayOpen}
                    anchorRect={giveawayAnchorRect}
                    recipients={giveawayRecipients}
                    onMouseEnter={() => clearGiveawayCloseTimer()}
                    onMouseLeave={() => scheduleGiveawayClose()}
                    formatCurrency={formatCurrency}
                  />
                  <p className="text-xs text-base-content/60 mt-1 truncate">{rowData.department}</p>
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
                {(() => {
                  const isGreen = (rowData.salaryBudget || 0) >= (rowData.totalSalaryCost || 0);
                  const prev = rowData.previousContribution ?? null;
                  const hasPrev = prev != null && Number.isFinite(prev) && prev > 0;
                  const trendUp = hasPrev ? (rowData.contribution || 0) > prev : false;
                  const trendDown = hasPrev ? (rowData.contribution || 0) < prev : false;
                  return (
                    <div className={`rounded-xl p-3 shadow-sm col-span-2 border ${isGreen ? 'bg-green-100/70 border-green-300/60' : 'bg-red-100/70 border-red-300/60'}`}>
                      <p className={`text-xs font-medium uppercase tracking-wide mb-0.5 ${isGreen ? 'text-green-800' : 'text-red-800'}`}>Contribution</p>
                      <div className="flex items-center justify-between gap-2">
                        <p className={`text-lg font-bold tabular-nums ${isGreen ? 'text-green-800' : 'text-red-800'}`}>
                          {formatCurrency(rowData.contribution)}
                        </p>
                        {hasPrev && (trendUp || trendDown) && (
                          <span className={`text-xs font-semibold tabular-nums ${trendUp ? 'text-green-700' : 'text-red-700'}`}>
                            {trendUp ? '▲' : '▼'}
                          </span>
                        )}
                      </div>
                      <p className={`text-[11px] mt-1 tabular-nums ${isGreen ? 'text-green-700/80' : 'text-red-700/80'}`}>
                        Budget {formatCurrency(rowData.salaryBudget)} · Cost {formatCurrency(rowData.totalSalaryCost)}
                      </p>
                    </div>
                  );
                })()}
                <div className="rounded-xl bg-base-100 border border-base-300/50 p-3 shadow-sm col-span-2">
                  <p className="text-xs font-medium text-base-content/50 uppercase tracking-wide mb-0.5">Contribution fixed</p>
                  <p className="text-base font-semibold text-base-content">{formatCurrency(rowData.contributionFixed)}</p>
                </div>
              </div>
            </div>
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
      <div className="hidden md:block overflow-x-auto overflow-y-visible">
        <table className="table table-zebra">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Department</th>
              <th className="text-right">Signed</th>
              <th className="text-right">Due</th>
              <th className="text-right">Contribution</th>
              <th className="text-right">Contribution fixed</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="text-center py-8 text-base-content/70">
                  <span className="loading loading-spinner loading-md" /> Loading…
                </td>
              </tr>
            )}
            {!loading && rowData && (
              <>
                <tr
                  className="cursor-pointer hover:bg-base-200"
                  onClick={() => {
                    setModalRole('ALL');
                    setModalOpen(true);
                  }}
                >
                  <td className="font-medium">
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={giveawayRecipients.length > 0 ? 'cursor-help rounded-full hover:opacity-90 focus:outline-none focus-visible:ring focus-visible:ring-primary/40' : ''}
                        title={giveawayRecipients.length > 0 ? 'Hover to see who receives fixed contribution on your behalf' : undefined}
                        onMouseEnter={(e) => {
                          if (giveawayRecipients.length === 0) return;
                          clearGiveawayCloseTimer();
                          setGiveawayAnchorRect((e.currentTarget as HTMLElement).getBoundingClientRect());
                          setGiveawayOpen(true);
                        }}
                        onMouseLeave={() => {
                          if (giveawayRecipients.length === 0) return;
                          scheduleGiveawayClose();
                        }}
                        onClick={(e) => {
                          if (giveawayRecipients.length > 0) e.stopPropagation();
                        }}
                      >
                        <EmployeeAvatar photoUrl={rowData.photoUrl} name={rowData.employeeName} className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
                      </div>
                      <span className="truncate">{rowData.employeeName}</span>
                    </div>
                    <GiveawayPopover
                      isOpen={giveawayOpen}
                      anchorRect={giveawayAnchorRect}
                      recipients={giveawayRecipients}
                      onMouseEnter={() => clearGiveawayCloseTimer()}
                      onMouseLeave={() => scheduleGiveawayClose()}
                      formatCurrency={formatCurrency}
                    />
                  </td>
                  <td>{rowData.department}</td>
                  <td className="text-right">{formatCurrency(rowData.signed)}</td>
                  <td className="text-right">{formatCurrency(rowData.due)}</td>
                  <td className="text-right">
                    {(() => {
                      const isGreen = (rowData.salaryBudget || 0) >= (rowData.totalSalaryCost || 0);
                      const prev = rowData.previousContribution ?? null;
                      const hasPrev = prev != null && Number.isFinite(prev) && prev > 0;
                      const trendUp = hasPrev ? (rowData.contribution || 0) > prev : false;
                      const trendDown = hasPrev ? (rowData.contribution || 0) < prev : false;
                      return (
                        <span className={`inline-flex items-center justify-end gap-1.5 px-2 py-1 rounded-md font-semibold tabular-nums border ${isGreen ? 'bg-green-100 text-green-800 border-green-300/60' : 'bg-red-100 text-red-800 border-red-300/60'}`}>
                          {formatCurrency(rowData.contribution)}
                          {hasPrev && (trendUp || trendDown) && (
                            <span className={`text-[11px] font-bold tabular-nums ${trendUp ? 'text-green-700' : 'text-red-700'}`}>
                              {trendUp ? '▲' : '▼'}
                            </span>
                          )}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="text-right">{formatCurrency(rowData.contributionFixed)}</td>
                </tr>
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
