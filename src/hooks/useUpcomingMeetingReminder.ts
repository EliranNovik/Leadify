import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuthContext } from '../contexts/AuthContext';

export type UpcomingMeetingReminder = {
  id: string;
  kind: 'client' | 'im';
  /** Client: lead number. IM: unused. */
  leadNumber: string | null;
  /** Client: client name. IM: meeting title/subject. */
  label: string;
  /** Lead route id for client meetings. */
  leadRouteId: string | number | null;
  meetingDateTime: Date;
  minutesLeft: number;
  /** Display time HH:MM */
  timeLabel: string;
  location: string | null;
  joinUrl: string | null;
  /** True when online/Teams/Zoom (or IM with link) — show Join. */
  canJoin: boolean;
};

export type UpcomingMeetingReminderState = {
  next: UpcomingMeetingReminder | null;
  meetings: UpcomingMeetingReminder[];
};

function minutesUntil(meetingDateTime: Date, now = new Date()): number {
  return Math.max(0, Math.floor((meetingDateTime.getTime() - now.getTime()) / 60_000));
}

function formatTimeLabel(dt: Date): string {
  const h = dt.getHours().toString().padStart(2, '0');
  const m = dt.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

export function getValidTeamsLink(link: string | null | undefined): string {
  if (!link) return '';
  try {
    if (link.startsWith('http')) return link;
    const obj = JSON.parse(link);
    if (obj && typeof obj === 'object') {
      if (typeof obj.joinUrl === 'string') return obj.joinUrl;
      if (typeof obj.joinWebUrl === 'string') return obj.joinWebUrl;
    }
  } catch {
    if (typeof link === 'string' && link.startsWith('http')) return link;
  }
  return '';
}

export function isOnlineMeetingLocation(location: string | null | undefined): boolean {
  if (!location) return false;
  const locationLower = location.toLowerCase().trim();
  return locationLower === 'online' || locationLower === 'teams' || locationLower === 'zoom';
}

function userMatchesRole(
  meeting: any,
  userEmployeeId: number | null,
  userDisplayName: string | null,
): boolean {
  if (!userEmployeeId) return true;

  if (
    meeting.extern1?.toString() === userEmployeeId.toString()
    || meeting.extern2?.toString() === userEmployeeId.toString()
  ) {
    return true;
  }

  if (meeting.legacy_lead) {
    const legacyLead = meeting.legacy_lead;
    return (
      legacyLead.meeting_scheduler_id?.toString() === userEmployeeId.toString()
      || legacyLead.meeting_manager_id?.toString() === userEmployeeId.toString()
      || legacyLead.meeting_lawyer_id?.toString() === userEmployeeId.toString()
      || legacyLead.expert_id?.toString() === userEmployeeId.toString()
      || legacyLead.closer_id?.toString() === userEmployeeId.toString()
      || legacyLead.case_handler_id?.toString() === userEmployeeId.toString()
    );
  }

  if (meeting.lead) {
    const newLead = meeting.lead;
    const checkField = (field: unknown): boolean => {
      if (field == null || field === '') return false;
      if (!Number.isNaN(Number(field))) {
        return String(field) === String(userEmployeeId);
      }
      if (typeof field === 'string' && userDisplayName) {
        return field.trim() === userDisplayName.trim();
      }
      return false;
    };

    return (
      checkField(newLead.scheduler)
      || checkField(newLead.manager)
      || checkField(newLead.helper)
      || checkField(newLead.expert)
      || checkField(newLead.closer)
      || checkField(newLead.handler)
      || checkField(meeting.scheduler)
      || checkField(meeting.meeting_manager)
      || checkField(meeting.expert)
      || checkField(meeting.helper)
    );
  }

  return (
    meeting.scheduler?.toString() === userEmployeeId.toString()
    || meeting.meeting_manager?.toString() === userEmployeeId.toString()
    || meeting.expert?.toString() === userEmployeeId.toString()
    || meeting.helper?.toString() === userEmployeeId.toString()
  );
}

function parseMeetingDateTime(meetingDate: string | null | undefined, meetingTime: string | null | undefined, now: Date): Date | null {
  if (!meetingTime) return null;
  const timeParts = String(meetingTime).split(':');
  if (timeParts.length < 2) return null;
  const hour = Number.parseInt(timeParts[0]!, 10);
  const minute = Number.parseInt(timeParts[1]!, 10);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;

  const dt = meetingDate ? new Date(`${meetingDate}T00:00:00`) : new Date(now);
  if (Number.isNaN(dt.getTime())) {
    const fallback = new Date(now);
    fallback.setHours(hour, minute, 0, 0);
    return fallback;
  }
  dt.setHours(hour, minute, 0, 0);
  return dt;
}

function withMinutes(list: Omit<UpcomingMeetingReminder, 'minutesLeft'>[], now: Date): UpcomingMeetingReminder[] {
  return list.map((m) => ({
    ...m,
    minutesLeft: minutesUntil(m.meetingDateTime, now),
  }));
}

/**
 * Meetings starting within the next hour (same window as Dashboard Meetings Today reminder).
 */
export function useUpcomingMeetingReminder(enabled = true): UpcomingMeetingReminderState {
  const { user, supabaseSessionReady } = useAuthContext();
  const [state, setState] = useState<UpcomingMeetingReminderState>({ next: null, meetings: [] });

  const refresh = useCallback(async () => {
    if (!enabled || !supabaseSessionReady || !user) {
      setState({ next: null, meetings: [] });
      return;
    }

    try {
      const authUser = user;
      let userEmployeeId: number | null = null;
      let userDisplayName: string | null = null;
      let userEmail = (authUser.email || '').toLowerCase() || null;

      const { data: userData } = await supabase
        .from('users')
        .select(`
          employee_id,
          email,
          tenants_employee!employee_id(
            id,
            display_name
          )
        `)
        .eq('auth_id', authUser.id)
        .maybeSingle();

      if (userData?.employee_id) userEmployeeId = Number(userData.employee_id) || null;
      if (userData?.email) userEmail = String(userData.email).toLowerCase();
      const emp = Array.isArray(userData?.tenants_employee)
        ? userData?.tenants_employee[0]
        : userData?.tenants_employee;
      if (emp?.display_name) userDisplayName = String(emp.display_name);

      const now = new Date();
      const todayStr = now.toISOString().split('T')[0]!;
      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date(now);
      todayEnd.setHours(23, 59, 59, 999);
      const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);
      /** Keep showing until 15 minutes after start. */
      const windowStart = new Date(now.getTime() - 15 * 60 * 1000);

      const candidates: Omit<UpcomingMeetingReminder, 'minutesLeft'>[] = [];

      const { data: meetings } = await supabase
        .from('meetings')
        .select(`
          id,
          meeting_date,
          meeting_time,
          meeting_location,
          teams_meeting_url,
          meeting_manager,
          scheduler,
          expert,
          helper,
          extern1,
          extern2,
          status,
          client_id,
          legacy_lead_id,
          lead:leads!client_id(
            id, name, lead_number, master_id, manager, expert, stage, scheduler, helper, closer, handler, unactivated_at
          ),
          legacy_lead:leads_lead!legacy_lead_id(
            id, name, lead_number, master_id, meeting_manager_id, meeting_lawyer_id, meeting_scheduler_id, expert_id, stage, closer_id, case_handler_id, status
          )
        `)
        .eq('meeting_date', todayStr)
        .or('status.is.null,status.neq.canceled,status.neq.cancelled');

      for (const meeting of meetings || []) {
        const status = String((meeting as any).status || '').toLowerCase();
        if (status === 'canceled' || status === 'cancelled') continue;
        if (!userMatchesRole(meeting, userEmployeeId, userDisplayName)) continue;

        const lead = (meeting as any).lead;
        const legacyLead = (meeting as any).legacy_lead;
        if (lead?.id && !String(lead.id).startsWith('legacy_')) {
          if (lead.stage === 91 || lead.stage === '91' || lead.unactivated_at) continue;
        }
        if (legacyLead?.id) {
          if (legacyLead.stage === 91 || legacyLead.stage === '91') continue;
          if (legacyLead.status === 10 || legacyLead.status === '10') continue;
        }

        const meetingDateTime = parseMeetingDateTime(
          (meeting as any).meeting_date,
          (meeting as any).meeting_time,
          now,
        );
        if (!meetingDateTime) continue;
        if (meetingDateTime < windowStart || meetingDateTime > oneHourLater) continue;

        const clientName = String(lead?.name || legacyLead?.name || 'Client').trim() || 'Client';
        const leadNumber = String(lead?.lead_number || legacyLead?.lead_number || lead?.id || legacyLead?.id || '').trim() || null;
        const leadRouteId = lead?.id ?? legacyLead?.id ?? (meeting as any).client_id ?? (meeting as any).legacy_lead_id ?? null;
        const location = String((meeting as any).meeting_location || '').trim() || null;
        const joinUrl = getValidTeamsLink((meeting as any).teams_meeting_url) || null;
        const isPhysical = Boolean(location) && !isOnlineMeetingLocation(location);

        candidates.push({
          id: `meeting-${(meeting as any).id}`,
          kind: 'client',
          leadNumber,
          label: clientName,
          leadRouteId,
          meetingDateTime,
          timeLabel: formatTimeLabel(meetingDateTime),
          location,
          joinUrl,
          canJoin: Boolean(joinUrl) && !isPhysical,
        });
      }

      if (userEmail) {
        const { data: outlookMeetings } = await supabase
          .from('outlook_teams_meetings')
          .select('id, subject, start_date_time, attendees, status, location, teams_join_url, teams_meeting_url')
          .gte('start_date_time', todayStart.toISOString())
          .lte('start_date_time', todayEnd.toISOString())
          .or('status.is.null,status.neq.cancelled');

        for (const staffMeeting of outlookMeetings || []) {
          const attendees = (staffMeeting as any).attendees;
          if (!Array.isArray(attendees)) continue;
          const isAttendee = attendees.some((attendee: any) => {
            const email = typeof attendee === 'string'
              ? attendee.toLowerCase()
              : String(attendee?.email || '').toLowerCase();
            return email === userEmail;
          });
          if (!isAttendee) continue;

          const meetingDateTime = new Date((staffMeeting as any).start_date_time);
          if (Number.isNaN(meetingDateTime.getTime())) continue;
          if (meetingDateTime < windowStart || meetingDateTime > oneHourLater) continue;

          const location = String((staffMeeting as any).location || 'Teams').trim() || 'Teams';
          const joinUrl =
            getValidTeamsLink((staffMeeting as any).teams_join_url)
            || getValidTeamsLink((staffMeeting as any).teams_meeting_url)
            || null;
          const isPhysical = Boolean(location) && !isOnlineMeetingLocation(location);

          candidates.push({
            id: `staff-${(staffMeeting as any).id}`,
            kind: 'im',
            leadNumber: null,
            label: String((staffMeeting as any).subject || 'Internal meeting').trim() || 'Internal meeting',
            leadRouteId: null,
            meetingDateTime,
            timeLabel: formatTimeLabel(meetingDateTime),
            location,
            joinUrl,
            canJoin: Boolean(joinUrl) && !isPhysical,
          });
        }
      }

      candidates.sort((a, b) => a.meetingDateTime.getTime() - b.meetingDateTime.getTime());
      const meetingsList = withMinutes(candidates, now);
      setState({
        next: meetingsList[0] ?? null,
        meetings: meetingsList,
      });
    } catch (err) {
      console.warn('[useUpcomingMeetingReminder] failed:', err);
      setState({ next: null, meetings: [] });
    }
  }, [enabled, user, supabaseSessionReady]);

  useEffect(() => {
    if (!enabled || !supabaseSessionReady) {
      setState({ next: null, meetings: [] });
      return undefined;
    }

    void refresh();
    const interval = window.setInterval(() => {
      void refresh();
    }, 60_000);

    return () => window.clearInterval(interval);
  }, [enabled, refresh, supabaseSessionReady]);

  // Keep minute countdown fresh without refetching every second.
  useEffect(() => {
    if (state.meetings.length === 0) return undefined;
    const tick = window.setInterval(() => {
      setState((prev) => {
        if (prev.meetings.length === 0) return prev;
        const now = Date.now();
        const updated = prev.meetings
          .filter((m) => m.meetingDateTime.getTime() >= now - 15 * 60_000)
          .map((m) => ({ ...m, minutesLeft: minutesUntil(m.meetingDateTime) }));
        if (updated.length === 0) return { next: null, meetings: [] };
        const same =
          updated.length === prev.meetings.length
          && updated.every((m, i) => m.id === prev.meetings[i]?.id && m.minutesLeft === prev.meetings[i]?.minutesLeft);
        if (same) return prev;
        return { next: updated[0] ?? null, meetings: updated };
      });
    }, 15_000);
    return () => window.clearInterval(tick);
  }, [state.meetings.length, state.next?.id]);

  return state;
}
