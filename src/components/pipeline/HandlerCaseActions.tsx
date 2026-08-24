import React from 'react';
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  PaperAirplaneIcon,
  ArrowUturnLeftIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';
import { supabase } from '../../lib/supabase';
import { getUSTimezoneFromPhone } from '../../lib/timezoneHelpers';
import RMQMessagesPage from '../../pages/RMQMessagesPage';
import { handlerDbId, type HandlerPipelineRow } from './handlerTypes';

type CountryRef = { id: number; name: string; timezone?: string | null };

export function resolveHandlerTimezone(
  row: Pick<HandlerPipelineRow, 'country_id' | 'country' | 'timezone' | 'phone' | 'mobile'>,
  countries: CountryRef[] = [],
): string | null {
  const byId = row.country_id != null
    ? countries.find((c) => Number(c.id) === Number(row.country_id))
    : undefined;
  const byName = row.country
    ? countries.find((c) => c.name.toLowerCase().trim() === row.country!.toLowerCase().trim())
    : undefined;
  const country = byId || byName;
  const countryId = country?.id ?? row.country_id;
  if (Number(countryId) === 249) {
    return getUSTimezoneFromPhone(row.phone, row.mobile) || 'America/New_York';
  }
  return country?.timezone || row.timezone || null;
}

export function getBusinessHoursInfo(timezone: string | null): {
  isBusinessHours: boolean;
  localTime: string | null;
} {
  if (!timezone) return { isBusinessHours: false, localTime: null };
  try {
    const now = new Date();
    const formattedTime = now.toLocaleString('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
    const hourFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    });
    const hourParts = hourFormatter.formatToParts(now);
    const hour = parseInt(hourParts.find((part) => part.type === 'hour')?.value || '0', 10);
    return { isBusinessHours: hour >= 8 && hour < 20, localTime: formattedTime };
  } catch {
    return { isBusinessHours: false, localTime: null };
  }
}

export const HandlerCountryHoursDot: React.FC<{
  row: HandlerPipelineRow;
  countries?: CountryRef[];
}> = ({ row, countries = [] }) => {
  if (!row.country) {
    return <span className="text-gray-400">—</span>;
  }
  const timezone = resolveHandlerTimezone(row, countries);
  const businessInfo = getBusinessHoursInfo(timezone);
  return (
    <div className="flex items-center gap-2">
      <span>{row.country}</span>
      {timezone ? (
        <div
          className={`h-3 w-3 shrink-0 rounded-full ${businessInfo.isBusinessHours ? 'bg-green-500' : 'bg-red-500'}`}
          title={`${businessInfo.localTime ? `Local time: ${businessInfo.localTime}` : 'Time unavailable'} - ${businessInfo.isBusinessHours ? 'Business hours' : 'Outside business hours'} (${timezone})`}
        />
      ) : (
        <div className="h-3 w-3 shrink-0 rounded-full bg-gray-300" title="No timezone data available" />
      )}
    </div>
  );
};

type ActionHandlers = {
  onReload: () => void | Promise<void>;
  onOpenRmq: (row: HandlerPipelineRow) => void;
  onToggleRetention: (row: HandlerPipelineRow, nextType: 1 | 2, e: React.MouseEvent) => void;
  onMarkReadyToPay: (row: HandlerPipelineRow, e: React.MouseEvent) => void;
};

export const HandlerActionsColumn: React.FC<{
  row: HandlerPipelineRow;
  handlers: ActionHandlers;
}> = ({ row, handlers }) => (
  <div className="flex items-center justify-end gap-1.5">
    {!row.hasPaymentPlan && (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          handlers.onOpenRmq(row);
        }}
        className="btn btn-circle btn-md border-none bg-orange-500 text-white hover:bg-orange-600 animate-pulse"
        title="Missing Payment Plan - Click to message closer"
      >
        <ExclamationTriangleIcon className="h-6 w-6" />
      </button>
    )}
    {row.bucket === 'active' && row.active_handler_type === 2 && (
      <button
        type="button"
        onClick={(e) => handlers.onToggleRetention(row, 1, e)}
        className="btn btn-circle btn-md border-none bg-rose-500 text-white hover:bg-rose-600"
        title="Transfer to Retention — moves this lead to Non-Active Cases"
      >
        <XCircleIcon className="h-6 w-6" />
      </button>
    )}
    {row.bucket === 'non_active' && row.active_handler_type === 1 && (
      <button
        type="button"
        onClick={(e) => handlers.onToggleRetention(row, 2, e)}
        className="btn btn-circle btn-md border-none bg-emerald-500 text-white hover:bg-emerald-600"
        title="Back to Me — moves this lead back to Active Cases"
      >
        <CheckCircleIcon className="h-6 w-6" />
      </button>
    )}
    {!row.isFirstPaymentPaid && row.hasUnpaidPayment && !row.hasReadyToPay && row.hasPaymentPlan && (
      <button
        type="button"
        onClick={(e) => handlers.onMarkReadyToPay(row, e)}
        className="btn btn-circle btn-md btn-warning animate-pulse"
        title="Mark as Ready to Pay"
      >
        <PaperAirplaneIcon className="h-6 w-6" />
      </button>
    )}
  </div>
);

type RetentionActionHandlers = {
  onOpenRmq: (row: HandlerPipelineRow) => void;
  onStartCase: (row: HandlerPipelineRow, e: React.MouseEvent) => void;
  onReverseStart: (row: HandlerPipelineRow, e: React.MouseEvent) => void;
  onToggleHandler: (row: HandlerPipelineRow, nextType: 1 | 2, e: React.MouseEvent) => void;
  onMarkReadyToPay: (row: HandlerPipelineRow, e: React.MouseEvent) => void;
};

export const RetentionActionsColumn: React.FC<{
  row: HandlerPipelineRow;
  handlers: RetentionActionHandlers;
}> = ({ row, handlers }) => (
  <div className="flex items-center justify-end gap-1.5">
    {!row.hasPaymentPlan && (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          handlers.onOpenRmq(row);
        }}
        className="btn btn-circle btn-md border-none bg-orange-500 text-white hover:bg-orange-600 animate-pulse"
        title="Missing Payment Plan - Click to message closer"
      >
        <ExclamationTriangleIcon className="h-6 w-6" />
      </button>
    )}
    {row.bucket === 'new' && !row.retentionHandlerStarted && (
      <button
        type="button"
        onClick={(e) => handlers.onStartCase(row, e)}
        className="btn btn-circle btn-md border-none bg-emerald-500 text-white hover:bg-emerald-600"
        title="Start Retention Case"
      >
        <ArrowUturnLeftIcon className="h-6 w-6" />
      </button>
    )}
    {row.bucket === 'active' && row.retentionHandlerStarted && (
      <button
        type="button"
        onClick={(e) => handlers.onReverseStart(row, e)}
        className="btn btn-circle btn-md border-none bg-amber-500 text-white hover:bg-amber-600"
        title="Reverse Retention Start Case"
      >
        <ArrowUturnLeftIcon className="h-6 w-6" />
      </button>
    )}
    {row.bucket === 'active' && (
      <button
        type="button"
        onClick={(e) => handlers.onToggleHandler(row, 2, e)}
        className="btn btn-circle btn-md border-none bg-rose-500 text-white hover:bg-rose-600"
        title="Transfer to Handler — moves this lead to Non-Active Cases"
      >
        <XCircleIcon className="h-6 w-6" />
      </button>
    )}
    {row.bucket === 'non_active' && row.active_handler_type === 2 && (
      <button
        type="button"
        onClick={(e) => handlers.onToggleHandler(row, 1, e)}
        className="btn btn-circle btn-md border-none bg-emerald-500 text-white hover:bg-emerald-600"
        title="Back to Me — moves this lead back to Active Cases"
      >
        <CheckCircleIcon className="h-6 w-6" />
      </button>
    )}
    {!row.isFirstPaymentPaid && row.hasUnpaidPayment && !row.hasReadyToPay && row.hasPaymentPlan && (
      <button
        type="button"
        onClick={(e) => handlers.onMarkReadyToPay(row, e)}
        className="btn btn-circle btn-md btn-warning animate-pulse"
        title="Mark as Ready to Pay"
      >
        <PaperAirplaneIcon className="h-6 w-6" />
      </button>
    )}
  </div>
);

export async function setRetentionHandlerStarted(row: HandlerPipelineRow, started: boolean): Promise<void> {
  const payload = started
    ? { retention_handler_started: true, active_handler_type: 1 }
    : { retention_handler_started: false };
  if (row.isNewLead) {
    const { error } = await supabase.from('leads').update(payload).eq('id', row.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('leads_lead').update(payload).eq('id', handlerDbId(row));
    if (error) throw error;
  }
}

export async function toggleHandlerRetention(row: HandlerPipelineRow, nextType: 1 | 2): Promise<void> {
  if (row.isNewLead) {
    const { error } = await supabase.from('leads').update({ active_handler_type: nextType }).eq('id', row.id);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from('leads_lead')
      .update({ active_handler_type: nextType })
      .eq('id', handlerDbId(row));
    if (error) throw error;
  }
}

export async function markHandlerReadyToPay(row: HandlerPipelineRow): Promise<void> {
  const currentDate = new Date().toISOString().split('T')[0];
  if (row.isNewLead) {
    const { data: payments, error: fetchError } = await supabase
      .from('payment_plans')
      .select('id, paid, cancel_date')
      .eq('lead_id', row.id)
      .eq('paid', false)
      .is('cancel_date', null)
      .order('due_date', { ascending: true })
      .limit(1);
    if (fetchError) throw fetchError;
    if (!payments || payments.length === 0) throw new Error('No unpaid payments found for this lead');
    const { error } = await supabase
      .from('payment_plans')
      .update({ ready_to_pay: true, due_date: currentDate })
      .eq('id', payments[0].id);
    if (error) throw error;
    return;
  }
  const { data: payments, error: fetchError } = await supabase
    .from('finances_paymentplanrow')
    .select('id, actual_date, cancel_date')
    .eq('lead_id', handlerDbId(row))
    .is('actual_date', null)
    .is('cancel_date', null)
    .order('date', { ascending: true })
    .limit(1);
  if (fetchError) throw fetchError;
  if (!payments || payments.length === 0) throw new Error('No unpaid payments found for this lead');
  const { error } = await supabase
    .from('finances_paymentplanrow')
    .update({ ready_to_pay: true, date: currentDate, due_date: currentDate })
    .eq('id', payments[0].id);
  if (error) throw error;
}

async function resolveCloserOrManagerUserId(row: HandlerPipelineRow): Promise<{ userId: string; role: string; name: string }> {
  let targetEmployeeId: number | null = null;
  let targetDisplayName: string | null = null;
  let roleType: 'closer' | 'manager' = 'closer';

  if (row.isNewLead) {
    const { data: leadData, error: leadError } = await supabase
      .from('leads')
      .select('closer, manager')
      .eq('id', row.id)
      .single();
    if (leadError) throw leadError;
    const closerName = String(leadData?.closer || '').trim();
    if (closerName) {
      const { data: employeeData } = await supabase
        .from('tenants_employee')
        .select('id, display_name')
        .eq('display_name', closerName)
        .maybeSingle();
      if (employeeData) {
        targetEmployeeId = employeeData.id;
        targetDisplayName = employeeData.display_name;
        roleType = 'closer';
      }
    }
    if (!targetEmployeeId) {
      const managerName = String(leadData?.manager || '').trim();
      if (managerName) {
        const { data: employeeData } = await supabase
          .from('tenants_employee')
          .select('id, display_name')
          .eq('display_name', managerName)
          .maybeSingle();
        if (employeeData) {
          targetEmployeeId = employeeData.id;
          targetDisplayName = employeeData.display_name;
          roleType = 'manager';
        }
      }
    }
  } else {
    const { data: leadData, error: leadError } = await supabase
      .from('leads_lead')
      .select('closer_id, meeting_manager_id')
      .eq('id', handlerDbId(row))
      .single();
    if (leadError) throw leadError;
    if (leadData?.closer_id) {
      const { data: employeeData } = await supabase
        .from('tenants_employee')
        .select('id, display_name')
        .eq('id', leadData.closer_id)
        .maybeSingle();
      if (employeeData) {
        targetEmployeeId = employeeData.id;
        targetDisplayName = employeeData.display_name;
        roleType = 'closer';
      }
    }
    if (!targetEmployeeId && leadData?.meeting_manager_id) {
      const { data: employeeData } = await supabase
        .from('tenants_employee')
        .select('id, display_name')
        .eq('id', leadData.meeting_manager_id)
        .maybeSingle();
      if (employeeData) {
        targetEmployeeId = employeeData.id;
        targetDisplayName = employeeData.display_name;
        roleType = 'manager';
      }
    }
  }

  if (!targetEmployeeId) throw new Error('No closer or manager assigned to this lead');

  const { data: userData, error: userError } = await supabase
    .from('users')
    .select('id')
    .eq('employee_id', targetEmployeeId)
    .maybeSingle();
  if (userError) throw userError;
  if (!userData) {
    throw new Error(`No user account found for ${roleType} (${targetDisplayName}). They may not have access to the system.`);
  }
  return { userId: userData.id, role: roleType, name: targetDisplayName || roleType };
}

type OverlayProps = {
  rmqTarget: { row: HandlerPipelineRow; userId: string } | null;
  onCloseRmq: () => void;
};

export const HandlerCaseOverlays: React.FC<OverlayProps> = ({ rmqTarget, onCloseRmq }) => {
  if (!rmqTarget) return null;
  return (
    <RMQMessagesPage
      isOpen
      onClose={onCloseRmq}
      initialUserId={rmqTarget.userId}
      initialMessage="The finance plan is not ready for this lead. Please create the payment plan."
      initialLeadNumber={rmqTarget.row.lead_number}
      initialLeadName={rmqTarget.row.name}
    />
  );
};

export async function openHandlerRmqForCloser(row: HandlerPipelineRow): Promise<{ userId: string; row: HandlerPipelineRow }> {
  const resolved = await resolveCloserOrManagerUserId(row);
  return { userId: resolved.userId, row };
}
