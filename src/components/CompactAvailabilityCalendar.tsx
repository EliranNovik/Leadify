import React, { useState, useEffect, useImperativeHandle, forwardRef } from 'react';
import { supabase } from '../lib/supabase';
import { useMsal } from '@azure/msal-react';
import {
  CalendarIcon,
  PlusIcon,
  TrashIcon,
  ClockIcon,
  CheckIcon,
  XMarkIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DocumentArrowUpIcon
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';

interface UnavailableTime {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  reason: string;
  outlookEventId?: string;
}

interface UnavailableRange {
  id: string;
  startDate: string;
  endDate: string;
  reason: string;
  outlookEventId?: string;
}

interface CalendarDay {
  date: Date;
  isCurrentMonth: boolean;
  isToday: boolean;
  unavailableTimes: UnavailableTime[];
  isInUnavailableRange: boolean;
  unavailableRangeReason?: string;
  hasMeeting: boolean;
}

export interface CompactAvailabilityCalendarRef {
  openAddRangeModal: () => void;
}

interface CompactAvailabilityCalendarProps {
  onAvailabilityChange?: () => void;
}

const CompactAvailabilityCalendar = forwardRef<CompactAvailabilityCalendarRef, CompactAvailabilityCalendarProps>((props, ref) => {
  const { onAvailabilityChange } = props;
  const { instance } = useMsal();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [unavailableTimes, setUnavailableTimes] = useState<UnavailableTime[]>([]);
  const [unavailableRanges, setUnavailableRanges] = useState<UnavailableRange[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showAddRangeModal, setShowAddRangeModal] = useState(false);
  const [newUnavailableTime, setNewUnavailableTime] = useState({
    startTime: '09:00',
    endTime: '17:00',
    reason: '',
    unavailabilityType: 'general' as 'sick_days' | 'vacation' | 'general',
    documentFile: null as File | null
  });
  const [newUnavailableRange, setNewUnavailableRange] = useState({
    startDate: '',
    endDate: '',
    reason: '',
    unavailabilityType: 'general' as 'sick_days' | 'vacation' | 'general',
    documentFile: null as File | null
  });
  const [uploadingDocument, setUploadingDocument] = useState(false);
  const [currentEmployeeId, setCurrentEmployeeId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [outlookSyncEnabled, setOutlookSyncEnabled] = useState(false);
  const [meetingDates, setMeetingDates] = useState<Set<string>>(new Set());
  const [selectedDateMeetings, setSelectedDateMeetings] = useState<any[]>([]);
  const [rangeMeetings, setRangeMeetings] = useState<Map<string, any[]>>(new Map());
  const [existingUnavailabilities, setExistingUnavailabilities] = useState<any[]>([]);

  // Get current month and year
  const currentMonth = currentDate.getMonth();
  const currentYear = currentDate.getFullYear();

  // Generate calendar days
  const generateCalendarDays = (): CalendarDay[] => {
    const firstDayOfMonth = new Date(currentYear, currentMonth, 1);
    const lastDayOfMonth = new Date(currentYear, currentMonth + 1, 0);
    const firstDayOfWeek = firstDayOfMonth.getDay();
    const daysInMonth = lastDayOfMonth.getDate();

    const days: CalendarDay[] = [];

    // Add previous month's trailing days
    for (let i = firstDayOfWeek - 1; i >= 0; i--) {
      const date = new Date(currentYear, currentMonth, -i);
      days.push({
        date,
        isCurrentMonth: false,
        isToday: false,
        unavailableTimes: [],
        isInUnavailableRange: false,
        hasMeeting: false
      });
    }

    // Add current month's days
    for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
      const date = new Date(currentYear, currentMonth, dayNum);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const dateString = `${year}-${month}-${day}`;
      const dayUnavailableTimes = unavailableTimes.filter(ut => ut.date === dateString);

      // Check if this date is in any unavailable range
      const rangeInfo = unavailableRanges.find(range => {
        const isInRange = dateString >= range.startDate && dateString <= range.endDate;
        return isInRange;
      });

      // Check if this date has a meeting
      const hasMeeting = meetingDates.has(dateString);

      days.push({
        date,
        isCurrentMonth: true,
        isToday: date.toDateString() === new Date().toDateString(),
        unavailableTimes: dayUnavailableTimes,
        isInUnavailableRange: !!rangeInfo,
        unavailableRangeReason: rangeInfo?.reason,
        hasMeeting
      });
    }

    // Add next month's leading days
    const remainingDays = 42 - days.length;
    for (let dayNum = 1; dayNum <= remainingDays; dayNum++) {
      const date = new Date(currentYear, currentMonth + 1, dayNum);
      days.push({
        date,
        isCurrentMonth: false,
        isToday: false,
        unavailableTimes: [],
        isInUnavailableRange: false,
        hasMeeting: false
      });
    }

    return days;
  };

  // Fetch user's unavailable times
  const fetchUnavailableTimes = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) return;

      // Get employee_id from users table using auth_id (same logic as Clients.tsx)
      let userEmployeeId: number | null = null;
      let userDisplayName: string | null = null;

      const { data: userData, error: userError } = await supabase
        .from('users')
        .select(`
          full_name,
          employee_id,
          tenants_employee!employee_id(
            id,
            display_name
          )
        `)
        .eq('auth_id', user.id)
        .single();

      if (userError || !userData) {
        console.error('Error getting user data:', userError);
        return;
      }

      // Get employee_id directly from users table (same as Clients.tsx)
      if (userData?.employee_id) {
        userEmployeeId = userData.employee_id;
      }

      // Get display name from employee relationship or fallback to full_name
      if (userData?.tenants_employee) {
        const empData = Array.isArray(userData.tenants_employee)
          ? userData.tenants_employee[0]
          : userData.tenants_employee;
        if (empData?.display_name) {
          userDisplayName = empData.display_name;
        }
      }

      if (!userDisplayName && userData?.full_name) {
        userDisplayName = userData.full_name;
      }

      // Use employee_id directly instead of matching by display_name (same as Clients.tsx)
      if (userEmployeeId) {
        const { data: employeeData, error } = await supabase
          .from('tenants_employee')
          .select('unavailable_times, outlook_calendar_sync, id, unavailable_ranges')
          .eq('id', userEmployeeId)
          .single();

        if (error) {
          console.error('Error fetching unavailable times:', error);
          return;
        }

        if (employeeData) {
          setUnavailableTimes(employeeData.unavailable_times || []);
          setOutlookSyncEnabled(employeeData.outlook_calendar_sync || false);
          setCurrentEmployeeId(employeeData.id);

          // Also set unavailable ranges if available
          if (employeeData.unavailable_ranges) {
            setUnavailableRanges(employeeData.unavailable_ranges);
          }
        }
      } else {
        console.error('No employee_id found in users table for current user');
      }

      // Fetch meetings where user is manager or helper (use employee_id from users table)
      await fetchUserMeetings(userDisplayName || '', userEmployeeId || undefined);
    } catch (error) {
      console.error('Error fetching unavailable times:', error);
    }
  };

  // Fetch meetings where user is manager or helper (same logic as Dashboard)
  const fetchUserMeetings = async (userDisplayName: string, employeeId?: number) => {
    try {
      const meetingDatesSet = new Set<string>();

      if (!employeeId && !userDisplayName) {
        setMeetingDates(meetingDatesSet);
        return;
      }

      // Calculate date range for current month (first day to last day)
      const firstDayOfMonth = new Date(currentYear, currentMonth, 1);
      const lastDayOfMonth = new Date(currentYear, currentMonth + 1, 0);
      const startDateStr = firstDayOfMonth.toISOString().split('T')[0];
      const endDateStr = lastDayOfMonth.toISOString().split('T')[0];

      // Fetch all meetings with proper joins to both leads and leads_lead tables (same as Dashboard)
      const { data: meetings, error } = await supabase
        .from('meetings')
        .select(`
          meeting_date,
          meeting_time,
          meeting_manager,
          expert,
          helper,
          lead:leads!client_id(
            id, name, lead_number, manager, topic, expert, stage, scheduler, helper, closer, handler
          ),
          legacy_lead:leads_lead!legacy_lead_id(
            id, name, meeting_manager_id, meeting_lawyer_id, meeting_scheduler_id, expert_id, closer_id, case_handler_id
          )
        `)
        .gte('meeting_date', startDateStr)
        .lte('meeting_date', endDateStr)
        .or('status.is.null,status.neq.canceled');

      if (error) {
        console.error('Error fetching meetings:', error);
        setMeetingDates(meetingDatesSet);
        return;
      }

      if (!meetings || meetings.length === 0) {
        setMeetingDates(meetingDatesSet);
        return;
      }

      // Helper function to check if user matches any role (same logic as Dashboard)
      const userMatchesRole = (meeting: any): boolean => {
        // Check legacy lead roles
        if (meeting.legacy_lead) {
          const legacyLead = meeting.legacy_lead;
          if (employeeId) {
            return (
              legacyLead.meeting_scheduler_id?.toString() === employeeId.toString() ||
              legacyLead.meeting_manager_id?.toString() === employeeId.toString() ||
              legacyLead.meeting_lawyer_id?.toString() === employeeId.toString() ||
              legacyLead.expert_id?.toString() === employeeId.toString() ||
              legacyLead.closer_id?.toString() === employeeId.toString() ||
              legacyLead.case_handler_id?.toString() === employeeId.toString()
            );
          }
        }

        // Check new lead roles
        if (meeting.lead) {
          const newLead = meeting.lead;
          // For new leads, fields might be IDs or display names
          const checkField = (field: any): boolean => {
            if (!field) return false;
            // If it's a number/ID, compare directly with employee_id
            if (!isNaN(Number(field))) {
              return employeeId ? field.toString() === employeeId.toString() : false;
            }
            // If it's a string (display name), compare with user's display name
            if (typeof field === 'string' && userDisplayName) {
              return field.trim() === userDisplayName.trim();
            }
            return false;
          };

          return (
            checkField(newLead.scheduler) ||
            checkField(newLead.manager) ||
            checkField(newLead.helper) ||
            checkField(newLead.expert) ||
            checkField(newLead.closer) ||
            checkField(newLead.handler) ||
            checkField(meeting.meeting_manager) ||
            checkField(meeting.expert) ||
            checkField(meeting.helper)
          );
        }

        // Fallback: check meeting-level fields
        if (employeeId) {
          return (
            meeting.meeting_manager?.toString() === employeeId.toString() ||
            meeting.expert?.toString() === employeeId.toString() ||
            meeting.helper?.toString() === employeeId.toString()
          );
        }

        // Fallback: check by display name
        if (userDisplayName) {
          return (
            meeting.meeting_manager?.trim() === userDisplayName.trim() ||
            meeting.expert?.trim() === userDisplayName.trim() ||
            meeting.helper?.trim() === userDisplayName.trim()
          );
        }

        return false;
      };

      // Filter meetings and collect dates
      meetings.forEach((meeting: any) => {
        if (userMatchesRole(meeting) && meeting.meeting_date) {
          meetingDatesSet.add(meeting.meeting_date);
        }
      });

      setMeetingDates(meetingDatesSet);
    } catch (error) {
      console.error('Error fetching user meetings:', error);
    }
  };

  // Fetch meetings for a specific date
  const fetchMeetingsForDate = async (date: Date, userDisplayName: string, employeeId?: number) => {
    try {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const dateString = `${year}-${month}-${day}`;

      // Fetch all meetings for this date
      const { data: meetings, error } = await supabase
        .from('meetings')
        .select(`
          id,
          meeting_date,
          meeting_time,
          meeting_manager,
          helper,
          lead:leads!client_id(
            id, name, lead_number
          ),
          legacy_lead:leads_lead!legacy_lead_id(
            id, name
          )
        `)
        .eq('meeting_date', dateString)
        .or('status.is.null,status.neq.canceled')
        .order('meeting_time', { ascending: true });

      if (error) {
        console.error('Error fetching meetings for date:', error);
        return [];
      }

      if (!meetings || meetings.length === 0) {
        return [];
      }

      // Helper function to get user's role for a meeting
      const getUserRole = (meeting: any): string => {
        if (!employeeId && !userDisplayName) return '';

        const checkField = (field: any): boolean => {
          if (!field) return false;
          if (!isNaN(Number(field))) {
            return Number(field) === employeeId;
          }
          if (typeof field === 'string' && userDisplayName) {
            return field.trim() === userDisplayName.trim();
          }
          return false;
        };

        // Check legacy lead roles
        if (meeting.legacy_lead) {
          const legacyLead = meeting.legacy_lead;
          if (legacyLead.meeting_scheduler_id && Number(legacyLead.meeting_scheduler_id) === employeeId) return 'Scheduler';
          if (legacyLead.meeting_manager_id && Number(legacyLead.meeting_manager_id) === employeeId) return 'Manager';
          if (legacyLead.meeting_lawyer_id && Number(legacyLead.meeting_lawyer_id) === employeeId) return 'Lawyer';
          if (legacyLead.expert_id && Number(legacyLead.expert_id) === employeeId) return 'Expert';
          if (legacyLead.closer_id && Number(legacyLead.closer_id) === employeeId) return 'Closer';
          if (legacyLead.case_handler_id && Number(legacyLead.case_handler_id) === employeeId) return 'Handler';
        }

        // Check new lead roles and meeting-level roles
        if (meeting.lead || meeting.meeting_manager || meeting.helper) {
          const newLead = meeting.lead;
          if (checkField(newLead?.scheduler)) return 'Scheduler';
          if (checkField(newLead?.manager)) return 'Manager';
          if (checkField(newLead?.helper)) return 'Helper';
          if (checkField(newLead?.expert)) return 'Expert';
          if (checkField(newLead?.closer)) return 'Closer';
          if (checkField(newLead?.handler)) return 'Handler';
          if (checkField(meeting.meeting_manager)) return 'Meeting Manager';
          if (checkField(meeting.helper)) return 'Meeting Helper';
        }
        return '';
      };

      // Helper function to check if user matches any role
      const userMatchesRole = (meeting: any): boolean => {
        return getUserRole(meeting) !== '';
      };

      // Helper function to format time (remove seconds)
      const formatTime = (time: string): string => {
        if (!time) return '';
        // If time includes seconds (HH:MM:SS), remove them
        if (time.length === 8 && time.includes(':')) {
          return time.substring(0, 5); // Return HH:MM
        }
        return time; // Already in HH:MM format or invalid
      };

      // Filter meetings by user role and format for display
      const userMeetings = meetings
        .filter(userMatchesRole)
        .map((meeting: any) => ({
          id: meeting.id,
          time: formatTime(meeting.meeting_time || ''),
          leadNumber: meeting.lead?.lead_number || meeting.legacy_lead?.id?.toString() || '',
          clientName: meeting.lead?.name || meeting.legacy_lead?.name || 'Unknown',
          role: getUserRole(meeting)
        }));

      return userMeetings;
    } catch (error) {
      console.error('Error fetching meetings for date:', error);
      return [];
    }
  };

  // Upload document to storage
  const uploadDocument = async (file: File): Promise<string | null> => {
    if (!currentEmployeeId) {
      toast.error('Employee ID not found');
      return null;
    }

    setUploadingDocument(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `employee_${currentEmployeeId}_${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;

      const { data, error } = await supabase.storage
        .from('employee-unavailability-documents')
        .upload(fileName, file, {
          cacheControl: '3600',
          upsert: false,
          contentType: file.type
        });

      if (error) {
        console.error('Error uploading document:', error);
        toast.error('Failed to upload document');
        return null;
      }

      // Return the file path (not public URL since bucket is private)
      // We'll generate signed URLs when viewing
      return fileName;
    } catch (error) {
      console.error('Error uploading document:', error);
      toast.error('Failed to upload document');
      return null;
    } finally {
      setUploadingDocument(false);
    }
  };

  // Helper function to convert time string to minutes
  const timeToMinutes = (timeStr: string): number => {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
  };

  // Helper function to check if two time ranges overlap
  const timeRangesOverlap = (start1: string, end1: string, start2: string, end2: string): boolean => {
    const start1Min = timeToMinutes(start1);
    const end1Min = timeToMinutes(end1);
    const start2Min = timeToMinutes(start2);
    const end2Min = timeToMinutes(end2);

    // Check if ranges overlap (not just touching)
    return (start1Min < end2Min && end1Min > start2Min);
  };

  // Helper to normalize time (remove seconds if present)
  const normalizeTime = (timeStr: string): string => {
    if (!timeStr) return '';
    // If time has seconds (HH:MM:SS), remove them
    if (timeStr.includes(':') && timeStr.split(':').length === 3) {
      return timeStr.substring(0, 5); // Keep only HH:MM
    }
    return timeStr;
  };

  // Fetch existing unavailabilities for a specific date
  const fetchExistingUnavailabilitiesForDate = async (date: Date) => {
    if (!currentEmployeeId) return [];

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const dateString = `${year}-${month}-${day}`;

    try {
      // Fetch from employee_unavailability_reasons table
      // Get all records for this employee, we'll filter by date in code
      const { data: reasonsData, error: reasonsError } = await supabase
        .from('employee_unavailability_reasons')
        .select('*')
        .eq('employee_id', currentEmployeeId);

      if (reasonsError) {
        console.error('Error fetching existing unavailabilities:', reasonsError);
        return [];
      }

      const existing: any[] = [];

      // Process reasons data
      if (reasonsData) {
        reasonsData.forEach((reason: any) => {
          const reasonStartDate = reason.start_date;
          const reasonEndDate = reason.end_date || reasonStartDate;

          // Check if the selected date falls within this unavailability
          if (dateString >= reasonStartDate && dateString <= reasonEndDate) {
            let reasonText = '';
            if (reason.unavailability_type === 'sick_days') {
              reasonText = reason.sick_days_reason || '';
            } else if (reason.unavailability_type === 'vacation') {
              reasonText = reason.vacation_reason || '';
            } else {
              reasonText = reason.general_reason || '';
            }

            if (reason.start_time && reason.end_time) {
              existing.push({
                id: `reason-${reason.id}`,
                date: dateString,
                startTime: reason.start_time,
                endTime: reason.end_time,
                reason: reasonText,
                type: reason.unavailability_type,
                source: 'reasons_table'
              });
            } else {
              // All day range
              existing.push({
                id: `reason-${reason.id}`,
                date: dateString,
                startTime: null,
                endTime: null,
                reason: reasonText,
                type: reason.unavailability_type,
                source: 'reasons_table',
                isAllDay: true
              });
            }
          }
        });
      }

      // Also fetch from legacy unavailable_times, but only if not already in the new table
      // Create a set of keys from the new table to check for duplicates
      const existingKeys = new Set<string>();
      existing.forEach((ex: any) => {
        if (ex.isAllDay) {
          existingKeys.add(`all-day-${ex.date}`);
        } else {
          const normalizedStart = normalizeTime(ex.startTime || '');
          const normalizedEnd = normalizeTime(ex.endTime || '');
          existingKeys.add(`${ex.date}-${normalizedStart}-${normalizedEnd}`);
        }
      });

      // Only add legacy entries that don't match existing entries
      const dayUnavailableTimes = unavailableTimes.filter(ut => ut.date === dateString);
      dayUnavailableTimes.forEach((time: UnavailableTime) => {
        const normalizedStart = normalizeTime(time.startTime);
        const normalizedEnd = normalizeTime(time.endTime);
        const key = `${time.date}-${normalizedStart}-${normalizedEnd}`;
        // Only add if not already in the new table
        if (!existingKeys.has(key)) {
          existing.push({
            id: `time-${time.id}`,
            date: time.date,
            startTime: time.startTime,
            endTime: time.endTime,
            reason: time.reason,
            type: 'general',
            source: 'legacy_times'
          });
        }
      });

      return existing;
    } catch (error) {
      console.error('Error fetching existing unavailabilities:', error);
      return [];
    }
  };

  // Save unavailable time
  const saveUnavailableTime = async () => {
    if (!selectedDate || !newUnavailableTime.reason.trim()) {
      toast.error('Please select a date and provide a reason');
      return;
    }

    if (!currentEmployeeId) {
      toast.error('Employee ID not found');
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (selectedDate < today) {
      toast.error('Cannot add unavailable times for past dates');
      return;
    }

    const year = selectedDate.getFullYear();
    const month = String(selectedDate.getMonth() + 1).padStart(2, '0');
    const day = String(selectedDate.getDate()).padStart(2, '0');
    const dateString = `${year}-${month}-${day}`;

    // Validate start time is before end time
    if (newUnavailableTime.startTime >= newUnavailableTime.endTime) {
      toast.error('Start time must be before end time');
      return;
    }

    setLoading(true);
    try {
      // Fetch existing unavailabilities for this date
      const existing = await fetchExistingUnavailabilitiesForDate(selectedDate);

      // Check for exact duplicates (same date, same time)
      const exactDuplicate = existing.find((ex: any) => {
        if (ex.isAllDay) return false; // All day entries don't conflict with time-based entries
        return ex.startTime === newUnavailableTime.startTime &&
          ex.endTime === newUnavailableTime.endTime;
      });

      if (exactDuplicate) {
        toast.error('You already have an unavailability with the same time on this date');
        setLoading(false);
        return;
      }

      // Check for overlapping times (excluding all-day entries)
      const overlapping = existing.find((ex: any) => {
        if (ex.isAllDay) return true; // All day entries conflict with any time-based entry
        if (!ex.startTime || !ex.endTime) return false;
        return timeRangesOverlap(
          newUnavailableTime.startTime,
          newUnavailableTime.endTime,
          ex.startTime,
          ex.endTime
        );
      });

      if (overlapping) {
        const overlapTime = overlapping.isAllDay
          ? 'All Day'
          : `${overlapping.startTime} - ${overlapping.endTime}`;
        toast.error(`This time overlaps with an existing unavailability (${overlapTime})`);
        setLoading(false);
        return;
      }

      // For sick_days and vacation, check if there's already an entry for this date and type
      // For general, allow multiple entries on the same day (but not duplicates/overlaps)
      if (newUnavailableTime.unavailabilityType !== 'general') {
        const typeConflict = existing.find((ex: any) =>
          ex.type === newUnavailableTime.unavailabilityType && ex.isAllDay
        );

        if (typeConflict) {
          toast.error(`You already have a ${newUnavailableTime.unavailabilityType === 'sick_days' ? 'sick day' : 'vacation'} entry for this date`);
          setLoading(false);
          return;
        }
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) {
        toast.error('User not authenticated');
        return;
      }

      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('full_name')
        .eq('auth_id', user.id)
        .single();

      if (userError || !userData?.full_name) {
        toast.error('Could not get user information');
        return;
      }

      // Upload document if it's a sick day and document is provided
      let documentUrl: string | null = null;
      if (newUnavailableTime.unavailabilityType === 'sick_days' && newUnavailableTime.documentFile) {
        documentUrl = await uploadDocument(newUnavailableTime.documentFile);
        if (!documentUrl) {
          setLoading(false);
          return;
        }
      }

      // Prepare reason data based on type
      const reasonData: any = {
        employee_id: currentEmployeeId,
        unavailability_type: newUnavailableTime.unavailabilityType,
        start_date: dateString,
        start_time: newUnavailableTime.startTime,
        end_time: newUnavailableTime.endTime,
      };

      if (newUnavailableTime.unavailabilityType === 'sick_days') {
        reasonData.sick_days_reason = newUnavailableTime.reason;
        if (documentUrl) {
          reasonData.document_url = documentUrl;
        }
      } else if (newUnavailableTime.unavailabilityType === 'vacation') {
        reasonData.vacation_reason = newUnavailableTime.reason;
      } else {
        reasonData.general_reason = newUnavailableTime.reason;
      }

      // Save to new table
      const { error: reasonError } = await supabase
        .from('employee_unavailability_reasons')
        .insert(reasonData);

      if (reasonError) {
        console.error('Error saving unavailability reason:', reasonError);
        toast.error('Failed to save unavailability reason');
        setLoading(false);
        return;
      }

      // Create Outlook event if enabled (using the new data structure)
      if (outlookSyncEnabled) {
        try {
          const newTime: UnavailableTime = {
            id: Date.now().toString(),
            date: dateString,
            startTime: newUnavailableTime.startTime,
            endTime: newUnavailableTime.endTime,
            reason: newUnavailableTime.reason
          };
          const outlookEventId = await createOutlookEvent(newTime);
          // Note: Outlook event ID is not stored in the new table structure
        } catch (error) {
          console.error('Error creating Outlook event:', error);
        }
      }

      toast.success('Unavailable time saved successfully');
      setShowAddModal(false);
      setNewUnavailableTime({ startTime: '09:00', endTime: '17:00', reason: '', unavailabilityType: 'general', documentFile: null });
      setExistingUnavailabilities([]);

      // Refresh unavailable times
      await fetchUnavailableTimes();

      // Trigger refresh of team availability
      if (onAvailabilityChange) {
        onAvailabilityChange();
      }
    } catch (error) {
      console.error('Error saving unavailable time:', error);
      toast.error('Failed to save unavailable time');
    } finally {
      setLoading(false);
    }
  };

  // Create Outlook event
  const createOutlookEvent = async (unavailableTime: UnavailableTime): Promise<string> => {
    const account = instance.getActiveAccount();
    if (!account) {
      throw new Error('No active account');
    }

    const accessToken = await instance.acquireTokenSilent({
      scopes: ['https://graph.microsoft.com/calendars.readwrite'],
      account: account
    });

    const [year, month, day] = unavailableTime.date.split('-').map(Number);
    const startDateTime = new Date(year, month - 1, day,
      parseInt(unavailableTime.startTime.split(':')[0]),
      parseInt(unavailableTime.startTime.split(':')[1]), 0);
    const endDateTime = new Date(year, month - 1, day,
      parseInt(unavailableTime.endTime.split(':')[0]),
      parseInt(unavailableTime.endTime.split(':')[1]), 0);

    const event = {
      subject: `Unavailable - ${unavailableTime.reason}`,
      body: {
        contentType: 'text',
        content: `Marked as unavailable: ${unavailableTime.reason}`
      },
      start: {
        dateTime: startDateTime.toISOString(),
        timeZone: 'UTC'
      },
      end: {
        dateTime: endDateTime.toISOString(),
        timeZone: 'UTC'
      },
      isAllDay: false,
      showAs: 'busy'
    };

    const response = await fetch('https://graph.microsoft.com/v1.0/me/events', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(event)
    });

    if (!response.ok) {
      throw new Error('Failed to create Outlook event');
    }

    const eventData = await response.json();
    return eventData.id;
  };

  // Delete unavailable time (from new table only)
  const deleteUnavailableTime = async (timeId: string) => {
    // Check if it's from the new table (starts with "reason-")
    if (timeId.startsWith('reason-')) {
      const reasonId = timeId.replace('reason-', '');
      setLoading(true);
      try {
        const { error } = await supabase
          .from('employee_unavailability_reasons')
          .delete()
          .eq('id', reasonId);

        if (error) {
          console.error('Error deleting unavailability reason:', error);
          toast.error('Failed to delete unavailability');
          return;
        }

        toast.success('Unavailable time deleted successfully');

        // Refresh unavailable times
        await fetchUnavailableTimes();

        // Trigger refresh of team availability
        if (onAvailabilityChange) {
          onAvailabilityChange();
        }
      } catch (error) {
        console.error('Error deleting unavailable time:', error);
        toast.error('Failed to delete unavailable time');
      } finally {
        setLoading(false);
      }
    } else {
      // Legacy entry - just show a message that it can't be deleted from here
      toast.error('Legacy unavailability entries cannot be deleted from this interface');
    }
  };

  // Delete Outlook event
  const deleteOutlookEvent = async (eventId: string) => {
    const account = instance.getActiveAccount();
    if (!account) return;

    const accessToken = await instance.acquireTokenSilent({
      scopes: ['https://graph.microsoft.com/calendars.readwrite'],
      account: account
    });

    const response = await fetch(`https://graph.microsoft.com/v1.0/me/events/${eventId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${accessToken.accessToken}`
      }
    });

    if (!response.ok) {
      throw new Error('Failed to delete Outlook event');
    }
  };

  // Save unavailable range
  const saveUnavailableRange = async () => {
    if (!newUnavailableRange.startDate || !newUnavailableRange.endDate || !newUnavailableRange.reason.trim()) {
      toast.error('Please fill in all fields');
      return;
    }

    if (!currentEmployeeId) {
      toast.error('Employee ID not found');
      return;
    }

    if (new Date(newUnavailableRange.startDate) > new Date(newUnavailableRange.endDate)) {
      toast.error('Start date must be before end date');
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (new Date(newUnavailableRange.startDate) < today) {
      toast.error('Cannot add unavailable ranges for past dates');
      return;
    }

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) {
        toast.error('User not authenticated');
        return;
      }

      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('full_name')
        .eq('auth_id', user.id)
        .single();

      if (userError || !userData?.full_name) {
        toast.error('Could not get user information');
        return;
      }

      // Upload document if it's a sick day and document is provided
      let documentUrl: string | null = null;
      if (newUnavailableRange.unavailabilityType === 'sick_days' && newUnavailableRange.documentFile) {
        documentUrl = await uploadDocument(newUnavailableRange.documentFile);
        if (!documentUrl) {
          setLoading(false);
          return;
        }
      }

      // Prepare reason data based on type
      const reasonData: any = {
        employee_id: currentEmployeeId,
        unavailability_type: newUnavailableRange.unavailabilityType,
        start_date: newUnavailableRange.startDate,
        end_date: newUnavailableRange.endDate,
      };

      if (newUnavailableRange.unavailabilityType === 'sick_days') {
        reasonData.sick_days_reason = newUnavailableRange.reason;
        if (documentUrl) {
          reasonData.document_url = documentUrl;
        }
      } else if (newUnavailableRange.unavailabilityType === 'vacation') {
        reasonData.vacation_reason = newUnavailableRange.reason;
      } else {
        reasonData.general_reason = newUnavailableRange.reason;
      }

      // Save to new table
      const { error: reasonError } = await supabase
        .from('employee_unavailability_reasons')
        .insert(reasonData);

      if (reasonError) {
        console.error('Error saving unavailability reason:', reasonError);
        toast.error('Failed to save unavailability reason');
        setLoading(false);
        return;
      }

      // Create Outlook event if enabled
      if (outlookSyncEnabled) {
        try {
          const newRange: UnavailableRange = {
            id: Date.now().toString(),
            startDate: newUnavailableRange.startDate,
            endDate: newUnavailableRange.endDate,
            reason: newUnavailableRange.reason
          };
          await createOutlookRangeEvent(newRange);
        } catch (error) {
          console.error('Error creating Outlook event:', error);
        }
      }

      toast.success('Unavailable range saved successfully');
      setShowAddRangeModal(false);
      setNewUnavailableRange({ startDate: '', endDate: '', reason: '', unavailabilityType: 'general', documentFile: null });
      setRangeMeetings(new Map());
      setRangeMeetings(new Map());

      // Trigger refresh of team availability
      if (onAvailabilityChange) {
        onAvailabilityChange();
      }
    } catch (error) {
      console.error('Error saving unavailable range:', error);
      toast.error('Failed to save unavailable range');
    } finally {
      setLoading(false);
    }
  };

  // Create Outlook event for range
  const createOutlookRangeEvent = async (range: UnavailableRange): Promise<string> => {
    const account = instance.getActiveAccount();
    if (!account) {
      throw new Error('No active account');
    }

    const accessToken = await instance.acquireTokenSilent({
      scopes: ['https://graph.microsoft.com/calendars.readwrite'],
      account: account
    });

    const [startYear, startMonth, startDay] = range.startDate.split('-').map(Number);
    const [endYear, endMonth, endDay] = range.endDate.split('-').map(Number);

    const startDateTime = new Date(startYear, startMonth - 1, startDay, 0, 0, 0, 0);
    const endDateTime = new Date(endYear, endMonth - 1, endDay, 23, 59, 59, 999);

    const event = {
      subject: `Unavailable - ${range.reason}`,
      body: {
        contentType: 'text',
        content: `Marked as unavailable: ${range.reason}`
      },
      start: {
        dateTime: startDateTime.toISOString(),
        timeZone: 'UTC'
      },
      end: {
        dateTime: endDateTime.toISOString(),
        timeZone: 'UTC'
      },
      isAllDay: false,
      showAs: 'busy'
    };

    const response = await fetch('https://graph.microsoft.com/v1.0/me/events', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(event)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Outlook API error:', response.status, errorText);
      throw new Error(`Failed to create Outlook event: ${response.status} - ${errorText}`);
    }

    const eventData = await response.json();
    return eventData.id;
  };

  // Delete unavailable range (from new table only)
  const deleteUnavailableRange = async (rangeId: string) => {
    // Check if it's from the new table (starts with "reason-")
    if (rangeId.startsWith('reason-')) {
      const reasonId = rangeId.replace('reason-', '');
      setLoading(true);
      try {
        const { error } = await supabase
          .from('employee_unavailability_reasons')
          .delete()
          .eq('id', reasonId);

        if (error) {
          console.error('Error deleting unavailability reason:', error);
          toast.error('Failed to delete unavailability');
          return;
        }

        toast.success('Unavailable range deleted successfully');

        // Refresh unavailable times
        await fetchUnavailableTimes();

        // Trigger refresh of team availability
        if (onAvailabilityChange) {
          onAvailabilityChange();
        }
      } catch (error) {
        console.error('Error deleting unavailable range:', error);
        toast.error('Failed to delete unavailable range');
      } finally {
        setLoading(false);
      }
    } else {
      // Legacy entry - just show a message that it can't be deleted from here
      toast.error('Legacy unavailability entries cannot be deleted from this interface');
    }
  };

  useImperativeHandle(ref, () => ({
    openAddRangeModal: () => {
      setShowAddRangeModal(true);
    }
  }));

  useEffect(() => {
    fetchUnavailableTimes();
  }, [currentMonth, currentYear]);

  const calendarDays = generateCalendarDays();
  const monthNames = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ];

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <div className="w-full">
      {/* Month Navigation */}
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={() => {
            const newMonth = new Date(currentYear, currentMonth - 1, 1);
            setCurrentDate(newMonth);
          }}
          className="btn btn-xs btn-ghost btn-circle"
        >
          <ChevronLeftIcon className="w-4 h-4" />
        </button>
        <span className="text-sm font-semibold text-gray-700">
          {monthNames[currentMonth]} {currentYear}
        </span>
        <button
          onClick={() => {
            const newMonth = new Date(currentYear, currentMonth + 1, 1);
            setCurrentDate(newMonth);
          }}
          className="btn btn-xs btn-ghost btn-circle"
        >
          <ChevronRightIcon className="w-4 h-4" />
        </button>
      </div>

      {/* Day Headers */}
      <div className="grid grid-cols-7 gap-1 mb-1">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, idx) => (
          <div key={idx} className="text-center text-xs font-medium text-gray-500 py-1">
            {day}
          </div>
        ))}
      </div>

      {/* Calendar Grid */}
      <div className="grid grid-cols-7 gap-1">
        {calendarDays.map((day, idx) => {
          if (!day.isCurrentMonth) {
            return <div key={idx} className="aspect-square"></div>;
          }

          const isPast = day.date < today;
          const isUnavailable = day.unavailableTimes.length > 0 || day.isInUnavailableRange;

          // Only show green if not unavailable (red takes precedence)
          const showGreen = day.hasMeeting && !isUnavailable;

          return (
            <button
              key={idx}
              onClick={async () => {
                if (!isPast) {
                  setSelectedDate(day.date);
                  setShowAddModal(true);

                  // Fetch existing unavailabilities for this date
                  if (currentEmployeeId) {
                    const existing = await fetchExistingUnavailabilitiesForDate(day.date);
                    setExistingUnavailabilities(existing);
                  }

                  // Fetch meetings for this date
                  const { data: { user } } = await supabase.auth.getUser();
                  if (user?.id) {
                    const { data: userData } = await supabase
                      .from('users')
                      .select('full_name')
                      .eq('auth_id', user.id)
                      .maybeSingle();

                    const { data: employeeData } = await supabase
                      .from('tenants_employee')
                      .select('id')
                      .eq('user_id', user.id)
                      .maybeSingle();

                    const meetings = await fetchMeetingsForDate(
                      day.date,
                      userData?.full_name || '',
                      employeeData?.id
                    );
                    setSelectedDateMeetings(meetings);
                  }
                }
              }}
              disabled={isPast}
              className={`
                aspect-square text-xs font-medium rounded transition-all
                ${isPast ? 'text-gray-300 cursor-not-allowed' : 'cursor-pointer hover:bg-gray-200'}
                ${day.isToday ? 'ring-2 ring-primary bg-primary/10' : ''}
                ${showGreen ? 'bg-green-100 text-green-700 font-semibold' : ''}
                ${isUnavailable ? 'bg-red-100 text-red-700 font-semibold' : ''}
                ${!isUnavailable && !showGreen && !isPast ? 'text-gray-700 hover:bg-gray-200' : ''}
                ${!isUnavailable && !showGreen && isPast ? 'text-gray-300' : ''}
              `}
              title={showGreen ? 'You have a meeting on this day' : (isUnavailable ? 'Unavailable' : '')}
            >
              {day.date.getDate()}
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 mt-3 text-xs text-gray-600 flex-wrap">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-red-100"></div>
          <span>Unavailable</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-green-100"></div>
          <span>Meeting</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded ring-2 ring-primary bg-primary/10"></div>
          <span>Today</span>
        </div>
      </div>

      {/* Add Unavailable Time Modal */}
      {showAddModal && selectedDate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Add Unavailable Time</h3>
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setSelectedDate(null);
                  setNewUnavailableTime({ startTime: '09:00', endTime: '17:00', reason: '', unavailabilityType: 'general', documentFile: null });
                  setSelectedDateMeetings([]);
                  setExistingUnavailabilities([]);
                }}
                className="btn btn-ghost btn-sm btn-circle"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="label">
                  <span className="label-text">Date</span>
                </label>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  value={selectedDate.toLocaleDateString()}
                  disabled
                />
              </div>

              {/* Existing Unavailabilities on this date */}
              {existingUnavailabilities.length > 0 && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <div className="text-sm font-semibold text-blue-800 mb-2">
                    Existing Unavailabilities on this day:
                  </div>
                  <div className="space-y-2">
                    {existingUnavailabilities.map((unav: any, idx: number) => (
                      <div key={idx} className="bg-white rounded p-2 border border-blue-200">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="text-sm font-medium text-blue-900">
                              {unav.isAllDay ? (
                                <span>All Day</span>
                              ) : (
                                <span>{normalizeTime(unav.startTime)} - {normalizeTime(unav.endTime)}</span>
                              )}
                            </div>
                            <div className="text-xs text-blue-700 mt-1">
                              {unav.reason}
                            </div>
                            <div className="text-xs text-blue-600 mt-1 capitalize">
                              Type: {unav.type === 'sick_days' ? 'Sick day/s' : unav.type === 'vacation' ? 'Vacation' : 'General'}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Meetings on this date */}
              {selectedDateMeetings.length > 0 && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                  <div className="text-sm font-semibold text-yellow-800 mb-2">
                    Meetings on this day:
                  </div>
                  <div className="space-y-2">
                    {selectedDateMeetings.map((meeting, idx) => (
                      <div key={idx} className="text-sm text-yellow-700">
                        <div className="font-medium">
                          {meeting.time && (
                            <span className="text-yellow-900">{meeting.time}</span>
                          )} {meeting.time && meeting.leadNumber && ' - '}
                          {meeting.leadNumber && (
                            <span className="text-yellow-900">Lead #{meeting.leadNumber}</span>
                          )} {meeting.leadNumber && meeting.clientName && ' - '}
                          {meeting.clientName && (
                            <span className="text-yellow-900">{meeting.clientName}</span>
                          )} {meeting.clientName && meeting.role && ' - '}
                          {meeting.role && (
                            <span className="text-yellow-800 italic">({meeting.role})</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">
                    <span className="label-text">Start Time</span>
                  </label>
                  <input
                    type="time"
                    className="input input-bordered w-full"
                    value={newUnavailableTime.startTime}
                    onChange={(e) => setNewUnavailableTime({ ...newUnavailableTime, startTime: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">
                    <span className="label-text">End Time</span>
                  </label>
                  <input
                    type="time"
                    className="input input-bordered w-full"
                    value={newUnavailableTime.endTime}
                    onChange={(e) => setNewUnavailableTime({ ...newUnavailableTime, endTime: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label className="label">
                  <span className="label-text">Type</span>
                </label>
                <select
                  className="select select-bordered w-full"
                  value={newUnavailableTime.unavailabilityType}
                  onChange={(e) => setNewUnavailableTime({
                    ...newUnavailableTime,
                    unavailabilityType: e.target.value as 'sick_days' | 'vacation' | 'general',
                    documentFile: e.target.value !== 'sick_days' ? null : newUnavailableTime.documentFile
                  })}
                >
                  <option value="general">General</option>
                  <option value="sick_days">Sick day/s</option>
                  <option value="vacation">Vacation</option>
                </select>
              </div>

              <div>
                <label className="label">
                  <span className="label-text">Reason</span>
                </label>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  value={newUnavailableTime.reason}
                  onChange={(e) => setNewUnavailableTime({ ...newUnavailableTime, reason: e.target.value })}
                  placeholder={newUnavailableTime.unavailabilityType === 'sick_days' ? 'e.g., Flu, Doctor appointment' : newUnavailableTime.unavailabilityType === 'vacation' ? 'e.g., Family vacation' : 'e.g., Personal appointment'}
                />
              </div>

              {/* Document Upload for Sick Days */}
              {newUnavailableTime.unavailabilityType === 'sick_days' && (
                <div>
                  <label className="label">
                    <span className="label-text">Doctors Documents</span>
                  </label>
                  <div
                    className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${newUnavailableTime.documentFile
                      ? 'border-primary bg-primary/5'
                      : 'border-gray-300 hover:border-primary/50'
                      }`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const file = e.dataTransfer.files[0];
                      if (file) {
                        const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
                        if (allowedTypes.includes(file.type)) {
                          if (file.size <= 10 * 1024 * 1024) { // 10MB
                            setNewUnavailableTime({ ...newUnavailableTime, documentFile: file });
                          } else {
                            toast.error('File size must be less than 10MB');
                          }
                        } else {
                          toast.error('Invalid file type. Please upload images or documents (PDF, Word)');
                        }
                      }
                    }}
                  >
                    {newUnavailableTime.documentFile ? (
                      <div className="space-y-2">
                        <DocumentArrowUpIcon className="w-8 h-8 mx-auto text-primary" />
                        <p className="text-sm font-medium text-gray-700">{newUnavailableTime.documentFile.name}</p>
                        <button
                          type="button"
                          className="btn btn-xs btn-ghost"
                          onClick={() => setNewUnavailableTime({ ...newUnavailableTime, documentFile: null })}
                        >
                          Remove
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <DocumentArrowUpIcon className="w-8 h-8 mx-auto text-gray-400" />
                        <p className="text-sm text-gray-600">
                          Drag and drop a document here, or{' '}
                          <label className="text-primary cursor-pointer hover:underline">
                            click to browse
                            <input
                              type="file"
                              className="hidden"
                              accept="image/*,.pdf,.doc,.docx"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
                                  if (allowedTypes.includes(file.type)) {
                                    if (file.size <= 10 * 1024 * 1024) { // 10MB
                                      setNewUnavailableTime({ ...newUnavailableTime, documentFile: file });
                                    } else {
                                      toast.error('File size must be less than 10MB');
                                    }
                                  } else {
                                    toast.error('Invalid file type. Please upload images or documents (PDF, Word)');
                                  }
                                }
                              }}
                            />
                          </label>
                        </p>
                        <p className="text-xs text-gray-500">PDF, Word, or Images (max 10MB)</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="flex gap-2 justify-end">
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    setShowAddModal(false);
                    setSelectedDate(null);
                    setNewUnavailableTime({ startTime: '09:00', endTime: '17:00', reason: '', unavailabilityType: 'general', documentFile: null });
                    setSelectedDateMeetings([]);
                    setExistingUnavailabilities([]);
                  }}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  onClick={saveUnavailableTime}
                  disabled={loading || uploadingDocument}
                >
                  {loading || uploadingDocument ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Unavailable Range Modal */}
      {showAddRangeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Add Unavailable Range</h3>
              <button
                onClick={() => {
                  setShowAddRangeModal(false);
                  setNewUnavailableRange({ startDate: '', endDate: '', reason: '', unavailabilityType: 'general', documentFile: null });
                  setRangeMeetings(new Map());
                }}
                className="btn btn-ghost btn-sm btn-circle"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="label">
                  <span className="label-text">Start Date</span>
                </label>
                <input
                  type="date"
                  className="input input-bordered w-full"
                  value={newUnavailableRange.startDate}
                  onChange={async (e) => {
                    setNewUnavailableRange({ ...newUnavailableRange, startDate: e.target.value });

                    // Fetch meetings for the range when dates change
                    if (e.target.value && newUnavailableRange.endDate) {
                      const { data: { user } } = await supabase.auth.getUser();
                      if (user?.id) {
                        const { data: userData } = await supabase
                          .from('users')
                          .select('full_name')
                          .eq('auth_id', user.id)
                          .maybeSingle();

                        const { data: employeeData } = await supabase
                          .from('tenants_employee')
                          .select('id')
                          .eq('user_id', user.id)
                          .maybeSingle();

                        const meetingsMap = new Map<string, any[]>();
                        const startDate = new Date(e.target.value);
                        const endDate = new Date(newUnavailableRange.endDate);
                        const currentDate = new Date(startDate);

                        while (currentDate <= endDate) {
                          const meetings = await fetchMeetingsForDate(
                            new Date(currentDate),
                            userData?.full_name || '',
                            employeeData?.id
                          );
                          if (meetings.length > 0) {
                            const dateString = currentDate.toISOString().split('T')[0];
                            meetingsMap.set(dateString, meetings);
                          }
                          currentDate.setDate(currentDate.getDate() + 1);
                        }

                        setRangeMeetings(meetingsMap);
                      }
                    }
                  }}
                />
              </div>

              <div>
                <label className="label">
                  <span className="label-text">End Date</span>
                </label>
                <input
                  type="date"
                  className="input input-bordered w-full"
                  value={newUnavailableRange.endDate}
                  onChange={async (e) => {
                    setNewUnavailableRange({ ...newUnavailableRange, endDate: e.target.value });

                    // Fetch meetings for the range when dates change
                    if (newUnavailableRange.startDate && e.target.value) {
                      const { data: { user } } = await supabase.auth.getUser();
                      if (user?.id) {
                        const { data: userData } = await supabase
                          .from('users')
                          .select('full_name')
                          .eq('auth_id', user.id)
                          .maybeSingle();

                        const { data: employeeData } = await supabase
                          .from('tenants_employee')
                          .select('id')
                          .eq('user_id', user.id)
                          .maybeSingle();

                        const meetingsMap = new Map<string, any[]>();
                        const startDate = new Date(newUnavailableRange.startDate);
                        const endDate = new Date(e.target.value);
                        const currentDate = new Date(startDate);

                        while (currentDate <= endDate) {
                          const meetings = await fetchMeetingsForDate(
                            new Date(currentDate),
                            userData?.full_name || '',
                            employeeData?.id
                          );
                          if (meetings.length > 0) {
                            const dateString = currentDate.toISOString().split('T')[0];
                            meetingsMap.set(dateString, meetings);
                          }
                          currentDate.setDate(currentDate.getDate() + 1);
                        }

                        setRangeMeetings(meetingsMap);
                      }
                    }
                  }}
                />
              </div>

              {/* Meetings in this date range */}
              {rangeMeetings.size > 0 && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 max-h-48 overflow-y-auto">
                  <div className="text-sm font-semibold text-yellow-800 mb-2">
                    Meetings in this date range:
                  </div>
                  <div className="space-y-3">
                    {Array.from(rangeMeetings.entries()).map(([date, meetings]) => (
                      <div key={date}>
                        <div className="text-xs font-semibold text-yellow-700 mb-1">
                          {new Date(date).toLocaleDateString()}
                        </div>
                        <div className="space-y-1 ml-2">
                          {meetings.map((meeting, idx) => (
                            <div key={idx} className="text-sm text-yellow-700">
                              <div className="font-medium">
                                {meeting.time && (
                                  <span className="text-yellow-900">{meeting.time}</span>
                                )} {meeting.time && meeting.leadNumber && ' - '}
                                {meeting.leadNumber && (
                                  <span className="text-yellow-900">Lead #{meeting.leadNumber}</span>
                                )} {meeting.leadNumber && meeting.clientName && ' - '}
                                {meeting.clientName && (
                                  <span className="text-yellow-900">{meeting.clientName}</span>
                                )} {meeting.clientName && meeting.role && ' - '}
                                {meeting.role && (
                                  <span className="text-yellow-800 italic">({meeting.role})</span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className="label">
                  <span className="label-text">Type</span>
                </label>
                <select
                  className="select select-bordered w-full"
                  value={newUnavailableRange.unavailabilityType}
                  onChange={(e) => setNewUnavailableRange({
                    ...newUnavailableRange,
                    unavailabilityType: e.target.value as 'sick_days' | 'vacation' | 'general',
                    documentFile: e.target.value !== 'sick_days' ? null : newUnavailableRange.documentFile
                  })}
                >
                  <option value="general">General</option>
                  <option value="sick_days">Sick day/s</option>
                  <option value="vacation">Vacation</option>
                </select>
              </div>

              <div>
                <label className="label">
                  <span className="label-text">Reason</span>
                </label>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  value={newUnavailableRange.reason}
                  onChange={(e) => setNewUnavailableRange({ ...newUnavailableRange, reason: e.target.value })}
                  placeholder={newUnavailableRange.unavailabilityType === 'sick_days' ? 'e.g., Flu, Doctor appointment' : newUnavailableRange.unavailabilityType === 'vacation' ? 'e.g., Family vacation' : 'e.g., Personal appointment'}
                />
              </div>

              {/* Document Upload for Sick Days */}
              {newUnavailableRange.unavailabilityType === 'sick_days' && (
                <div>
                  <label className="label">
                    <span className="label-text">Doctors Documents</span>
                  </label>
                  <div
                    className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${newUnavailableRange.documentFile
                      ? 'border-primary bg-primary/5'
                      : 'border-gray-300 hover:border-primary/50'
                      }`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const file = e.dataTransfer.files[0];
                      if (file) {
                        const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
                        if (allowedTypes.includes(file.type)) {
                          if (file.size <= 10 * 1024 * 1024) { // 10MB
                            setNewUnavailableRange({ ...newUnavailableRange, documentFile: file });
                          } else {
                            toast.error('File size must be less than 10MB');
                          }
                        } else {
                          toast.error('Invalid file type. Please upload images or documents (PDF, Word)');
                        }
                      }
                    }}
                  >
                    {newUnavailableRange.documentFile ? (
                      <div className="space-y-2">
                        <DocumentArrowUpIcon className="w-8 h-8 mx-auto text-primary" />
                        <p className="text-sm font-medium text-gray-700">{newUnavailableRange.documentFile.name}</p>
                        <button
                          type="button"
                          className="btn btn-xs btn-ghost"
                          onClick={() => setNewUnavailableRange({ ...newUnavailableRange, documentFile: null })}
                        >
                          Remove
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <DocumentArrowUpIcon className="w-8 h-8 mx-auto text-gray-400" />
                        <p className="text-sm text-gray-600">
                          Drag and drop a document here, or{' '}
                          <label className="text-primary cursor-pointer hover:underline">
                            click to browse
                            <input
                              type="file"
                              className="hidden"
                              accept="image/*,.pdf,.doc,.docx"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
                                  if (allowedTypes.includes(file.type)) {
                                    if (file.size <= 10 * 1024 * 1024) { // 10MB
                                      setNewUnavailableRange({ ...newUnavailableRange, documentFile: file });
                                    } else {
                                      toast.error('File size must be less than 10MB');
                                    }
                                  } else {
                                    toast.error('Invalid file type. Please upload images or documents (PDF, Word)');
                                  }
                                }
                              }}
                            />
                          </label>
                        </p>
                        <p className="text-xs text-gray-500">PDF, Word, or Images (max 10MB)</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="flex gap-2 justify-end">
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    setShowAddRangeModal(false);
                    setNewUnavailableRange({ startDate: '', endDate: '', reason: '', unavailabilityType: 'general', documentFile: null });
                    setRangeMeetings(new Map());
                  }}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  onClick={saveUnavailableRange}
                  disabled={loading || uploadingDocument}
                >
                  {loading || uploadingDocument ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

CompactAvailabilityCalendar.displayName = 'CompactAvailabilityCalendar';

export default CompactAvailabilityCalendar;

