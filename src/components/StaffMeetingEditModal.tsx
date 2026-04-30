import React, { useState, useEffect, useMemo, useRef } from 'react';
import { XMarkIcon, CalendarIcon, ClockIcon, UserGroupIcon, PencilIcon, UserIcon } from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';
import { useMsal } from '@azure/msal-react';
import { loginRequest } from '../msalConfig';
import { toast } from 'react-hot-toast';

interface StaffMeetingEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  meeting: any;
  onUpdate: () => void;
  onDelete?: () => void;
}

interface Employee {
  id: number;
  display_name: string;
  email: string;
  photo_url?: string | null;
  photo?: string | null;
}

type FirmContact = {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  profile_image_url?: string | null;
};

type FreeParticipant = {
  name: string;
  email?: string;
  phone?: string;
  notes?: string;
};

type InternalMeetingTypeRow = { id: number; code: string; label: string; sort_order: number | null };

const StaffMeetingEditModal: React.FC<StaffMeetingEditModalProps> = ({
  isOpen,
  onClose,
  meeting,
  onUpdate,
  onDelete
}) => {
  const { instance, accounts } = useMsal();
  const [isLoading, setIsLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showEmployeeSearch, setShowEmployeeSearch] = useState(false);
  const employeeDropdownRef = useRef<HTMLDivElement | null>(null);
  const firmContactDropdownRef = useRef<HTMLDivElement | null>(null);

  const [firmContacts, setFirmContacts] = useState<FirmContact[]>([]);
  const [firmContactSearch, setFirmContactSearch] = useState('');
  const [showFirmContactDropdown, setShowFirmContactDropdown] = useState(false);

  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<number[]>([]);
  const [selectedFirmContactIds, setSelectedFirmContactIds] = useState<string[]>([]);
  const [freeParticipants, setFreeParticipants] = useState<FreeParticipant[]>([]);
  const [freeDraft, setFreeDraft] = useState<FreeParticipant>({ name: '', email: '', phone: '', notes: '' });
  const [resolvedDbMeetingId, setResolvedDbMeetingId] = useState<number | null>(null);
  const [internalMeetingTypes, setInternalMeetingTypes] = useState<InternalMeetingTypeRow[]>([]);
  const [formData, setFormData] = useState({
    subject: '',
    date: '',
    time: '',
    duration: '60',
    description: '',
    location: 'Teams Meeting',
    internalMeetingTypeId: null as number | null,
  });

  // Fetch employees and meeting data when modal opens
  useEffect(() => {
    if (isOpen) {
      console.log('Modal opened with meeting data:', meeting);
      setResolvedDbMeetingId(null);
      setSelectedEmployeeIds([]);
      setSelectedFirmContactIds([]);
      setFreeParticipants([]);
      fetchEmployees();
      fetchFirmContacts();
      fetchInternalMeetingTypes();
      fetchMeetingData();
    }
  }, [isOpen, meeting]);

  const fetchInternalMeetingTypes = async () => {
    try {
      const { data, error } = await supabase
        .from('internal_meeting_types')
        .select('id, code, label, sort_order')
        .order('sort_order', { ascending: true });
      if (error) throw error;
      const rows = (data || []).map((r: any) => ({
        id: Number(r.id),
        code: String(r.code),
        label: String(r.label),
        sort_order: r.sort_order != null ? Number(r.sort_order) : null,
      })).filter((r) => Number.isFinite(r.id));
      setInternalMeetingTypes(rows);
    } catch {
      setInternalMeetingTypes([]);
    }
  };

  // close dropdowns on outside click
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (employeeDropdownRef.current && !employeeDropdownRef.current.contains(e.target as Node)) {
        setShowEmployeeSearch(false);
      }
      if (firmContactDropdownRef.current && !firmContactDropdownRef.current.contains(e.target as Node)) {
        setShowFirmContactDropdown(false);
      }
    };
    if (isOpen) document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [isOpen]);

  const fetchMeetingData = async () => {
    // Prefer meetings table fields (CalendarPage passes a meeting row for staff calendar)
    if (meeting) {
      const nestedRel = (meeting as any)?.internal_meeting_types;
      const nested = Array.isArray(nestedRel) ? nestedRel[0] : nestedRel;
      const typeIdRaw =
        meeting.internal_meeting_type_id ??
        nested?.id ??
        (meeting as any).internal_meeting_type?.id;
      const typeIdParsed = typeIdRaw != null && String(typeIdRaw).trim() !== '' ? Number(typeIdRaw) : null;
      setFormData({
        subject: meeting.meeting_subject || meeting.lead?.name || meeting.subject || '',
        date: meeting.meeting_date || '',
        time: meeting.meeting_time || '',
        duration: '60',
        description: meeting.meeting_brief || meeting.description || '',
        location: meeting.meeting_location || meeting.location || 'Teams Meeting',
        internalMeetingTypeId: Number.isFinite(typeIdParsed as number) ? (typeIdParsed as number) : null,
      });
    }
    
    try {
      const resolveOrCreateDbMeetingId = async (): Promise<number | null> => {
        if (!meeting) return null;
        if (typeof meeting.id === 'number') return meeting.id;
        if (typeof (meeting as any).meeting_id === 'number') return (meeting as any).meeting_id;

        // Best path: resolve by stored Outlook event id -> meetings.teams_id
        const outlookEventId = meeting?.teams_meeting_id || meeting?.teams_id || meeting?.outlook_event_id;
        if (outlookEventId) {
          const { data: byTeamsId, error: byTeamsErr } = await supabase
            .from('meetings')
            .select('id')
            .eq('teams_id', String(outlookEventId))
            .order('id', { ascending: false })
            .limit(1);
          if (!byTeamsErr) {
            const id = byTeamsId?.[0]?.id;
            if (typeof id === 'number') return id;
          }
        }

        // CalendarPage staff meetings currently pass id like "staff-<outlookEventId>" (not the integer meetings.id).
        // Resolve the meeting row by matching the staff meeting fields.
        const date = meeting.meeting_date || '';
        const time = meeting.meeting_time || '';
        const subject = meeting.meeting_subject || meeting.lead?.name || meeting.subject || '';
        const location = meeting.meeting_location || meeting.location || '';
        if (!date || !time || !subject) return null;

        const q = supabase
          .from('meetings')
          .select('id')
          .eq('calendar_type', 'staff')
          .eq('meeting_date', date)
          .eq('meeting_time', time)
          .eq('meeting_subject', subject)
          .order('id', { ascending: false })
          .limit(5);

        // location is not always stable (free text), so treat it as an optional filter
        const { data, error } = location ? await q.eq('meeting_location', location) : await q;
        if (error) throw error;
        const id = data?.[0]?.id;
        if (typeof id === 'number') return id;

        // Not found: create a meetings row so participants can attach to it.
        const { data: inserted, error: insErr } = await supabase
          .from('meetings')
          .insert({
            meeting_date: date,
            meeting_time: time,
            meeting_location: location || null,
            meeting_subject: subject,
            meeting_brief: (meeting.meeting_brief || meeting.description || '') || null,
            calendar_type: 'staff',
            internal_meeting_type_id:
              typeof meeting.internal_meeting_type_id === 'number' && Number.isFinite(meeting.internal_meeting_type_id)
                ? meeting.internal_meeting_type_id
                : null,
            teams_id: outlookEventId ? String(outlookEventId) : null,
            teams_meeting_url: meeting.teams_meeting_url || null,
            status: meeting.status || 'scheduled',
          })
          .select('id')
          .single();
        if (insErr) throw insErr;
        return typeof inserted?.id === 'number' ? inserted.id : null;
      };

      const dbMeetingId = await resolveOrCreateDbMeetingId();
      if (!dbMeetingId) return;
      setResolvedDbMeetingId(dbMeetingId);

      // Load participants from meeting_participants (staff / firm_contacts / free)
      const { data: partData, error: partErr } = await supabase
        .from('meeting_participants')
        .select('employee_id, firm_contact_id, free_name, free_email, free_phone, notes')
        .eq('meeting_id', dbMeetingId);

      if (partErr) throw partErr;

      // If no saved participants yet, prefill from meeting.attendees (staff emails -> staff; otherwise free).
      // IMPORTANT: do this ONLY when there are truly no participant rows.
      if (Array.isArray(partData) && partData.length === 0) {
        const attendees: any[] = Array.isArray((meeting as any).attendees) ? (meeting as any).attendees : [];
        if (attendees.length > 0) {
          const emailToEmployeeId = new Map<string, number>();
          employees.forEach((e) => {
            if (e.email) emailToEmployeeId.set(String(e.email).toLowerCase(), e.id);
          });

          const staffIds: number[] = [];
          const free: FreeParticipant[] = [];

          attendees.forEach((raw) => {
            const v = String(raw || '').trim();
            if (!v) return;
            const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
            if (isEmail) {
              const empId = emailToEmployeeId.get(v.toLowerCase());
              if (empId) {
                staffIds.push(empId);
              } else {
                // Unknown email → keep as free participant with email
                free.push({ name: v, email: v });
              }
            } else {
              free.push({ name: v });
            }
          });

          setSelectedEmployeeIds(Array.from(new Set(staffIds)));
          setSelectedFirmContactIds([]);
          setFreeParticipants(free);
        }
        return;
      }

      const employeeIds = (partData || [])
        .map((r: any) => (r.employee_id != null ? Number(r.employee_id) : null))
        .filter((n: any) => Number.isFinite(n) && n > 0) as number[];
      const firmIds = (partData || [])
        .map((r: any) => (r.firm_contact_id ? String(r.firm_contact_id) : null))
        .filter(Boolean) as string[];
      const frees: FreeParticipant[] = (partData || [])
        .filter((r: any) => r.free_name && String(r.free_name).trim() !== '')
        .map((r: any) => ({
          name: String(r.free_name),
          email: r.free_email ? String(r.free_email) : undefined,
          phone: r.free_phone ? String(r.free_phone) : undefined,
          notes: r.notes ? String(r.notes) : undefined
        }));

      setSelectedEmployeeIds(Array.from(new Set(employeeIds)));
      setSelectedFirmContactIds(Array.from(new Set(firmIds)));
      setFreeParticipants(frees);
    } catch (error) {
      console.error('Error fetching meeting data:', error);
      // keep meeting fields already set; participants stay empty
    }
  };

  const fetchEmployees = async () => {
    try {
      console.log('🔍 Fetching employees for edit modal...');
      
      // Fetch employees and users separately for better reliability
      const { data: employeesData, error: employeesError } = await supabase
        .from('tenants_employee')
        .select('id, display_name, photo_url, photo')
        .not('display_name', 'is', null)
        .order('display_name');

      if (employeesError) {
        console.error('Error fetching employees:', employeesError);
        toast.error('Failed to fetch employees');
        return;
      }
      
      console.log('🔍 Edit modal - Employees fetched:', employeesData?.length || 0);
      
      // Get all employee IDs
      const employeeIds = employeesData?.map(emp => emp.id) || [];
      
      if (employeeIds.length === 0) {
        console.log('⚠️ Edit modal - No employees found');
        setEmployees([]);
        return;
      }
      
      // Fetch emails from users table
      const { data: usersData, error: usersError } = await supabase
        .from('users')
        .select('employee_id, email')
        .in('employee_id', employeeIds)
        .not('email', 'is', null);
      
      if (usersError) {
        console.error('Error fetching user emails:', usersError);
        toast.error('Failed to fetch employee emails');
        return;
      }
      
      console.log('🔍 Edit modal - User emails fetched:', usersData?.length || 0);
      
      // Create a map of employee_id to email
      const emailMap = new Map();
      usersData?.forEach(user => {
        emailMap.set(user.employee_id, user.email);
      });
      
      // Combine employee data with emails
      const processedEmployees = employeesData
        ?.filter(emp => emailMap.has(emp.id)) // Only include employees with emails
        .map(emp => ({
          id: Number(emp.id),
          display_name: emp.display_name,
          email: emailMap.get(emp.id),
          photo_url: (emp as any).photo_url ?? null,
          photo: (emp as any).photo ?? null
        })) || [];
      
      console.log('🔍 Edit modal - Processed employees:', processedEmployees.length);
      
      setEmployees(processedEmployees);
    } catch (error) {
      console.error('Error fetching employees:', error);
      toast.error('Failed to fetch employees');
    }
  };

  const fetchFirmContacts = async () => {
    try {
      const { data, error } = await supabase
        .from('firm_contacts')
        .select('id, name, email, phone, profile_image_url')
        .eq('is_active', true)
        .order('name')
        .limit(500);
      if (error) throw error;
      setFirmContacts((data || []).map((c: any) => ({
        id: String(c.id),
        name: String(c.name || ''),
        email: c.email ? String(c.email) : null,
        phone: c.phone ? String(c.phone) : null,
        profile_image_url: c.profile_image_url ? String(c.profile_image_url) : null
      })).filter((c: FirmContact) => c.name.trim() !== ''));
    } catch (e) {
      console.warn('Failed to load firm contacts', e);
      setFirmContacts([]);
    }
  };

  const filteredEmployees = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return employees.slice(0, 50);
    return employees
      .filter(emp =>
        emp.display_name?.toLowerCase().includes(q) ||
        emp.email?.toLowerCase().includes(q)
      )
      .slice(0, 50);
  }, [employees, searchTerm]);

  const filteredFirmContacts = useMemo(() => {
    const q = firmContactSearch.trim().toLowerCase();
    if (!q) return firmContacts.slice(0, 50);
    return firmContacts
      .filter(c => c.name.toLowerCase().includes(q) || (c.email || '').toLowerCase().includes(q))
      .slice(0, 50);
  }, [firmContacts, firmContactSearch]);

  const addStaffParticipant = (employee: Employee) => {
    if (!selectedEmployeeIds.includes(employee.id)) {
      setSelectedEmployeeIds(prev => [...prev, employee.id]);
    }
    setSearchTerm('');
    setShowEmployeeSearch(false);
  };

  const removeStaffParticipant = (employeeId: number) => {
    setSelectedEmployeeIds(prev => prev.filter(id => id !== employeeId));
  };

  const addFirmContactParticipant = (contact: FirmContact) => {
    if (!selectedFirmContactIds.includes(contact.id)) {
      setSelectedFirmContactIds(prev => [...prev, contact.id]);
    }
    setFirmContactSearch('');
    setShowFirmContactDropdown(false);
  };

  const removeFirmContactParticipant = (contactId: string) => {
    setSelectedFirmContactIds(prev => prev.filter(id => id !== contactId));
  };

  const addExternParticipant = () => {
    const name = String(freeDraft.name || '').trim();
    if (!name) {
      toast.error('Extern participant name is required');
      return;
    }
    setFreeParticipants(prev => [...prev, { ...freeDraft, name }]);
    setFreeDraft({ name: '', email: '', phone: '', notes: '' });
    toast.success('Added extern participant');
  };

  const removeFreeParticipant = (idx: number) => {
    setFreeParticipants(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const account = accounts[0];
      if (!account) {
        throw new Error('No active account');
      }

      const tokenResponse = await instance.acquireTokenSilent({
        ...loginRequest,
        account
      });

      if (!tokenResponse) {
        throw new Error('Failed to acquire token');
      }

      // Update the meeting in Outlook (staff shared calendar)
      // Keep it best-effort (sometimes older rows won't have the event id).
      const outlookEventId = meeting?.teams_meeting_id || meeting?.teams_id || meeting?.outlook_event_id;
      if (outlookEventId) {
        await updateOutlookMeeting(tokenResponse.accessToken, String(outlookEventId), {
        subject: formData.subject,
        startDateTime: new Date(`${formData.date}T${formData.time}`).toISOString(),
        endDateTime: new Date(`${formData.date}T${formData.time}`).toISOString(),
        description: formData.description,
        location: formData.location
      });
      }

      // Update the meeting in our database tables
      const startIso = new Date(`${formData.date}T${formData.time}`).toISOString();
      const endIso = new Date(`${formData.date}T${formData.time}`).toISOString();

      const { error: metaUpdateError } = await supabase
        .from('outlook_teams_meetings')
        .update({
          subject: formData.subject,
          start_date_time: startIso,
          end_date_time: endIso,
          description: formData.description,
          location: formData.location,
          updated_at: new Date().toISOString()
        })
        .eq('teams_meeting_id', String(outlookEventId || meeting?.teams_meeting_id || ''));

      // If meta row doesn't exist, ignore (CalendarPage can still show meetings table entry).
      if (metaUpdateError && metaUpdateError.code !== 'PGRST116') {
        console.warn('Failed updating outlook_teams_meetings meta row', metaUpdateError);
      }

      // Resolve db meeting id (or create it) so participants can attach to it.
      let dbMeetingId: number | null = resolvedDbMeetingId;
      if (dbMeetingId == null) {
        const date = formData.date;
        const time = formData.time;
        const subject = formData.subject;
        const location = formData.location;
        if (date && time && subject) {
          const base = supabase
            .from('meetings')
            .select('id')
            .eq('calendar_type', 'staff')
            .eq('meeting_date', date)
            .eq('meeting_time', time)
            .eq('meeting_subject', subject)
            .order('id', { ascending: false })
            .limit(5);
          const res = location ? await base.eq('meeting_location', location) : await base;
          const id = res.data?.[0]?.id;
          dbMeetingId = typeof id === 'number' ? id : null;
          if (dbMeetingId == null) {
            const { data: inserted, error: insErr } = await supabase
              .from('meetings')
              .insert({
                meeting_date: date,
                meeting_time: time,
                meeting_location: location || null,
                meeting_subject: subject,
                meeting_brief: formData.description || null,
                calendar_type: 'staff',
                internal_meeting_type_id: formData.internalMeetingTypeId,
                teams_meeting_url: meeting?.teams_meeting_url || null,
                status: meeting?.status || 'scheduled',
              })
              .select('id')
              .single();
            if (insErr) throw insErr;
            dbMeetingId = typeof inserted?.id === 'number' ? inserted.id : null;
            setResolvedDbMeetingId(dbMeetingId);
          }
        }
      }

      if (dbMeetingId != null) {
        const { error: meetingUpdateError } = await supabase
          .from('meetings')
          .update({
            meeting_subject: formData.subject,
            meeting_date: formData.date,
            meeting_time: formData.time,
            meeting_location: formData.location,
            meeting_brief: formData.description || null,
            internal_meeting_type_id: formData.internalMeetingTypeId,
            last_edited_timestamp: new Date().toISOString(),
            ...(outlookEventId ? { teams_id: String(outlookEventId) } : {}),
          })
          .eq('id', dbMeetingId);
        if (meetingUpdateError) throw meetingUpdateError;

        // Replace participants (simple + reliable)
        const { error: delErr } = await supabase
          .from('meeting_participants')
          .delete()
          .eq('meeting_id', dbMeetingId);
        if (delErr) throw delErr;

        const rows: any[] = [];
        selectedEmployeeIds.forEach((employeeId) => rows.push({ meeting_id: dbMeetingId, employee_id: employeeId }));
        selectedFirmContactIds.forEach((firmContactId) => rows.push({ meeting_id: dbMeetingId, firm_contact_id: firmContactId }));
        // Include extern draft automatically if user filled it but didn't click "Add".
        const externDraftName = String(freeDraft?.name || '').trim();
        const externDraftToSave =
          externDraftName
            ? {
                name: externDraftName,
                email: String(freeDraft?.email || '').trim() || undefined,
                phone: String(freeDraft?.phone || '').trim() || undefined,
                notes: String(freeDraft?.notes || '').trim() || undefined,
              }
            : null;
        const effectiveExtern = [
          ...(freeParticipants || []),
          ...(externDraftToSave ? [externDraftToSave] : []),
        ].filter((p) => p && typeof (p as any).name === 'string' && String((p as any).name).trim() !== '');

        effectiveExtern.forEach((p) =>
          rows.push({
            meeting_id: dbMeetingId,
            free_name: String(p.name).trim(),
            free_email: p.email ? String(p.email).trim() : null,
            free_phone: p.phone ? String(p.phone).trim() : null,
            notes: p.notes ? String(p.notes).trim() : null,
          })
        );
        if (rows.length > 0) {
          console.groupCollapsed('[Edit Internal Meeting] meeting_participants replace');
          console.log('dbMeetingId:', dbMeetingId);
          console.log('rows:', rows);
          const { error: insErr } = await supabase.from('meeting_participants').insert(rows);
          console.log('insert error:', insErr);
          console.groupEnd();
          if (insErr) throw insErr;
        }
      } else {
        toast.error('Could not resolve internal meeting row in database (meeting id). Please refresh and try again.', {
          duration: 8000
        });
        return;
      }

      toast.success('Internal meeting updated successfully!');
      // Clear draft so it won't be re-added on next update.
      setFreeDraft({ name: '', email: '', phone: '', notes: '' });
      onUpdate();
      onClose();
    } catch (error) {
      console.error('Error updating staff meeting:', error);
      toast.error('Failed to update internal meeting');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);

    try {
      console.log('🗑️ Deleting meeting - full object:', meeting);
      console.log('🗑️ Meeting ID type:', typeof meeting.id, 'Value:', meeting.id);
      console.log('🗑️ Teams meeting ID:', meeting.teams_meeting_id);

      const account = accounts[0];
      if (!account) {
        throw new Error('No active account');
      }

      const tokenResponse = await instance.acquireTokenSilent({
        ...loginRequest,
        account: account,
      });

      // Delete from Outlook first (if it exists there)
      if (meeting.teams_meeting_id) {
        try {
          await deleteOutlookMeeting(tokenResponse.accessToken, meeting.teams_meeting_id);
        } catch (outlookError) {
          console.warn('Meeting not found in Outlook, continuing with database deletion:', outlookError);
          // Continue with database deletion even if Outlook deletion fails
        }
      }

      // Delete from database (both meta table and internal meetings table)
      // Extract the actual database ID (remove prefix if present)
      let dbId = meeting.id;
      if (typeof meeting.id === 'string' && meeting.id.includes('-')) {
        // If it's a prefixed ID like "staff-AAMk...", we need to find the actual database record
        console.log('🔍 Looking for database record with prefixed ID:', meeting.id);
        
        // Try to find by teams_meeting_id first
        if (meeting.teams_meeting_id) {
          const { data: existingMeeting, error: findError } = await supabase
            .from('outlook_teams_meetings')
            .select('id')
            .eq('teams_meeting_id', meeting.teams_meeting_id)
            .single();
          
          if (existingMeeting && !findError) {
            dbId = existingMeeting.id;
            console.log('✅ Found by teams_meeting_id:', dbId);
          }
        }
        
        // If still not found, try by subject and date
        if (dbId === meeting.id && formData.subject) {
          const meetingDate = formData.date;
          const { data: existingMeeting, error: findError } = await supabase
            .from('outlook_teams_meetings')
            .select('id')
            .eq('subject', formData.subject)
            .gte('start_date_time', `${meetingDate}T00:00:00`)
            .lte('start_date_time', `${meetingDate}T23:59:59`)
            .single();
          
          if (existingMeeting && !findError) {
            dbId = existingMeeting.id;
            console.log('✅ Found by subject and date:', dbId);
          }
        }
      }

      console.log('🗑️ Using database ID for deletion:', dbId);

      const { error: deleteError } = await supabase
        .from('outlook_teams_meetings')
        .delete()
        .eq('id', dbId);

      if (deleteError) throw deleteError;

      // Also delete the internal meeting row from public.meetings so it won't stay as a ghost in the UI.
      // Prefer matching by teams_id (Outlook event id), then fall back to date/time/subject/location.
      const outlookEventId = meeting?.teams_meeting_id || meeting?.teams_id || meeting?.outlook_event_id;
      let meetingsDbId: number | null = null;
      if (outlookEventId) {
        const byTeams = await supabase
          .from('meetings')
          .select('id')
          .eq('teams_id', String(outlookEventId))
          .order('id', { ascending: false })
          .limit(1);
        const id = byTeams.data?.[0]?.id;
        if (typeof id === 'number') meetingsDbId = id;
      }
      if (!meetingsDbId) {
        const date = formData.date;
        const time = formData.time;
        const subject = formData.subject;
        const location = formData.location;
        if (date && time && subject) {
          const base = supabase
            .from('meetings')
            .select('id')
            .eq('calendar_type', 'staff')
            .eq('meeting_date', date)
            .eq('meeting_time', time)
            .eq('meeting_subject', subject)
            .order('id', { ascending: false })
            .limit(3);
          const res = location ? await base.eq('meeting_location', location) : await base;
          const id = res.data?.[0]?.id;
          if (typeof id === 'number') meetingsDbId = id;
        }
      }
      if (meetingsDbId != null) {
        const { error: meetingsDelErr } = await supabase.from('meetings').delete().eq('id', meetingsDbId);
        if (meetingsDelErr) {
          console.warn('Failed deleting meetings row (non-fatal):', meetingsDelErr);
        }
      }

      toast.success('Internal meeting deleted successfully!');
      if (onDelete) onDelete();
      onClose();
    } catch (error) {
      console.error('Error deleting staff meeting:', error);
      toast.error('Failed to delete internal meeting');
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const deleteOutlookMeeting = async (accessToken: string, meetingId: string) => {
    const staffCalendarEmail = 'shared-staffcalendar@lawoffice.org.il';
    const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(staffCalendarEmail)}/calendar/events/${meetingId}`;
    
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('Meeting not found in Outlook calendar');
      }
      const error = await response.json();
      throw new Error(error.error?.message || `Failed to delete meeting: ${response.status}`);
    }
  };

  const updateOutlookMeeting = async (accessToken: string, meetingId: string, meetingDetails: any) => {
    // Update the meeting in the shared staff calendar, not the user's personal calendar
    const staffCalendarEmail = 'shared-staffcalendar@lawoffice.org.il';
    const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(staffCalendarEmail)}/calendar/events/${meetingId}`;
    console.log('🔧 Updating meeting in Outlook:', url);
    console.log('🔧 Meeting ID:', meetingId);
    console.log('🔧 Meeting details:', meetingDetails);
    
    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        subject: meetingDetails.subject,
        start: {
          dateTime: meetingDetails.startDateTime,
          timeZone: 'UTC'
        },
        end: {
          dateTime: meetingDetails.endDateTime,
          timeZone: 'UTC'
        },
        body: {
          content: meetingDetails.description,
          contentType: 'text'
        },
        location: {
          displayName: meetingDetails.location
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Outlook update failed:', response.status, response.statusText, errorText);
      throw new Error(`Failed to update meeting in Outlook: ${errorText}`);
    }

    return response.json();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black bg-opacity-50 p-0 md:items-center md:p-4">
      <div className="flex h-[100dvh] max-h-[100dvh] min-h-0 w-full max-w-none flex-col overflow-y-auto rounded-none bg-white shadow-none md:h-auto md:max-h-[90vh] md:max-w-2xl md:rounded-2xl md:shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center">
              <PencilIcon className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">Edit Internal Meeting</h2>
              <p className="text-sm text-gray-500">Update meeting details and participants</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="btn btn-ghost btn-circle"
          >
            <XMarkIcon className="w-6 h-6" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Subject */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Meeting Subject
            </label>
            <input
              type="text"
              value={formData.subject}
              onChange={(e) => setFormData(prev => ({ ...prev, subject: e.target.value }))}
              className="input input-bordered w-full"
              placeholder="Enter meeting subject"
              required
            />
          </div>

          {/* Date and Time */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <CalendarIcon className="w-4 h-4 inline mr-1" />
                Date
              </label>
              <input
                type="date"
                value={formData.date}
                onChange={(e) => setFormData(prev => ({ ...prev, date: e.target.value }))}
                className="input input-bordered w-full"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <ClockIcon className="w-4 h-4 inline mr-1" />
                Time
              </label>
              <input
                type="time"
                value={formData.time}
                onChange={(e) => setFormData(prev => ({ ...prev, time: e.target.value }))}
                className="input input-bordered w-full"
                required
              />
            </div>
          </div>

          {/* Location */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Location
            </label>
            <input
              type="text"
              value={formData.location}
              onChange={(e) => setFormData(prev => ({ ...prev, location: e.target.value }))}
              className="input input-bordered w-full"
              placeholder="Enter meeting location"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Internal meeting type
            </label>
            <select
              className="select select-bordered w-full"
              value={formData.internalMeetingTypeId != null ? String(formData.internalMeetingTypeId) : ''}
              onChange={(e) => {
                const v = e.target.value;
                setFormData((prev) => ({
                  ...prev,
                  internalMeetingTypeId: v === '' ? null : Number(v),
                }));
              }}
              disabled={internalMeetingTypes.length === 0}
            >
              <option value="">Not set</option>
              {internalMeetingTypes.map((t) => (
                <option key={t.id} value={String(t.id)}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          {/* Participants */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <UserGroupIcon className="w-4 h-4 inline mr-1" />
              Participants
            </label>

            {/* Selected participants badges */}
            {(selectedEmployeeIds.length > 0 || selectedFirmContactIds.length > 0 || freeParticipants.length > 0) && (
              <div className="flex flex-wrap gap-2 mb-3">
                {selectedEmployeeIds.map((id) => {
                  const emp = employees.find((e) => e.id === id);
                  return (
                    <div
                      key={`staff-${id}`}
                      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold ring-1 bg-sky-100 text-sky-800 ring-sky-200"
                    >
                      <UserIcon className="w-3.5 h-3.5" />
                      <span>Staff</span>
                      <span className="font-bold">{emp?.display_name || `#${id}`}</span>
                      <button type="button" onClick={() => removeStaffParticipant(id)} className="btn btn-ghost btn-xs -mr-1">
                        <XMarkIcon className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}
                {selectedFirmContactIds.map((id) => {
                  const fc = firmContacts.find((c) => c.id === id);
                  return (
                    <div
                      key={`firm-${id}`}
                      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold ring-1 bg-fuchsia-100 text-fuchsia-800 ring-fuchsia-200"
                    >
                      <UserGroupIcon className="w-3.5 h-3.5" />
                      <span>Firm</span>
                      <span className="font-bold">{fc?.name || 'Firm contact'}</span>
                      <button type="button" onClick={() => removeFirmContactParticipant(id)} className="btn btn-ghost btn-xs -mr-1">
                        <XMarkIcon className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}
                {freeParticipants.map((p, idx) => (
                  <div
                    key={`free-${idx}-${p.name}`}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold ring-1 bg-amber-100 text-amber-900 ring-amber-200"
                    title={[p.email ? `Email: ${p.email}` : '', p.phone ? `Phone: ${p.phone}` : '', p.notes ? `Notes: ${p.notes}` : '']
                      .filter(Boolean)
                      .join('\n')}
                  >
                    <UserIcon className="w-3.5 h-3.5" />
                    <span>Extern</span>
                    <span className="font-bold">{p.name}</span>
                    <button type="button" onClick={() => removeFreeParticipant(idx)} className="btn btn-ghost btn-xs -mr-1">
                      <XMarkIcon className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add staff + firm contacts */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="relative" ref={employeeDropdownRef}>
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setShowEmployeeSearch(true);
                  }}
                  onFocus={() => setShowEmployeeSearch(true)}
                  className="input input-bordered w-full"
                  placeholder="Add staff..."
                />
                {showEmployeeSearch && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                    {filteredEmployees.map((employee) => (
                      <div
                        key={employee.id}
                        onClick={() => addStaffParticipant(employee)}
                        className="px-4 py-2 hover:bg-gray-100 cursor-pointer flex items-center justify-between"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-8 h-8 rounded-full overflow-hidden bg-gray-100 ring-1 ring-gray-200 flex items-center justify-center flex-shrink-0">
                            {employee.photo_url ? (
                              <img src={employee.photo_url} alt={employee.display_name} className="w-full h-full object-cover" />
                            ) : (
                              <span className="text-xs font-semibold text-gray-600">
                                {String(employee.display_name || '?')
                                  .split(' ')
                                  .filter(Boolean)
                                  .slice(0, 2)
                                  .map((s) => s[0]?.toUpperCase())
                                  .join('') || '?'}
                              </span>
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="font-medium truncate">{employee.display_name}</div>
                            <div className="text-sm text-gray-500 truncate">{employee.email}</div>
                          </div>
                        </div>
                        {selectedEmployeeIds.includes(employee.id) && <span className="text-xs text-green-600">Added</span>}
                      </div>
                    ))}
                    {filteredEmployees.length === 0 && <div className="px-4 py-2 text-gray-500">No staff found</div>}
                  </div>
                )}
              </div>

              <div className="relative" ref={firmContactDropdownRef}>
                <input
                  type="text"
                  value={firmContactSearch}
                  onChange={(e) => {
                    setFirmContactSearch(e.target.value);
                    setShowFirmContactDropdown(true);
                  }}
                  onFocus={() => setShowFirmContactDropdown(true)}
                  className="input input-bordered w-full"
                  placeholder="Add firm contact..."
                />
                {showFirmContactDropdown && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                    {filteredFirmContacts.map((c) => (
                      <div
                        key={c.id}
                        onClick={() => addFirmContactParticipant(c)}
                        className="px-4 py-2 hover:bg-gray-100 cursor-pointer flex items-center justify-between"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-8 h-8 rounded-full overflow-hidden bg-gray-100 ring-1 ring-gray-200 flex items-center justify-center flex-shrink-0">
                            {c.profile_image_url ? (
                              <img src={c.profile_image_url} alt={c.name} className="w-full h-full object-cover" />
                            ) : (
                              <span className="text-xs font-semibold text-gray-600">
                                {String(c.name || '?')
                                  .split(' ')
                                  .filter(Boolean)
                                  .slice(0, 2)
                                  .map((s) => s[0]?.toUpperCase())
                                  .join('') || '?'}
                              </span>
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="font-medium truncate">{c.name}</div>
                            <div className="text-sm text-gray-500 truncate">{[c.email || '', c.phone || ''].filter(Boolean).join(' • ')}</div>
                          </div>
                        </div>
                        {selectedFirmContactIds.includes(c.id) && <span className="text-xs text-green-600">Added</span>}
                      </div>
                    ))}
                    {filteredFirmContacts.length === 0 && <div className="px-4 py-2 text-gray-500">No firm contacts found</div>}
                  </div>
                )}
              </div>
            </div>

            {/* Add free participant */}
            <div className="mt-3 p-3 rounded-xl border border-gray-200 bg-gray-50">
              <div className="text-sm font-semibold text-gray-700 mb-2">Add extern participant</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <input
                  className="input input-bordered input-sm w-full"
                  placeholder="Name *"
                  value={freeDraft.name || ''}
                  onChange={(e) => setFreeDraft((p) => ({ ...p, name: e.target.value }))}
                />
                <input
                  className="input input-bordered input-sm w-full"
                  placeholder="Email"
                  value={freeDraft.email || ''}
                  onChange={(e) => setFreeDraft((p) => ({ ...p, email: e.target.value }))}
                />
                <input
                  className="input input-bordered input-sm w-full"
                  placeholder="Phone"
                  value={freeDraft.phone || ''}
                  onChange={(e) => setFreeDraft((p) => ({ ...p, phone: e.target.value }))}
                />
                <textarea
                  className="textarea textarea-bordered textarea-sm w-full md:col-span-2 min-h-[88px] resize-y"
                  placeholder="Notes"
                  value={freeDraft.notes || ''}
                  onChange={(e) => setFreeDraft((p) => ({ ...p, notes: e.target.value }))}
                />
              </div>
              <div className="mt-2 flex justify-end">
                <button type="button" className="btn btn-sm btn-outline" onClick={addExternParticipant}>
                  Add extern participant
                </button>
              </div>
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Description
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              className="textarea textarea-bordered w-full h-24"
              placeholder="Enter meeting description..."
            />
          </div>

          {/* Actions */}
          <div className="flex justify-between pt-4 border-t border-gray-200">
            {/* Delete button on the left */}
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              className="btn btn-error btn-outline"
              disabled={isLoading || isDeleting}
            >
              {isDeleting ? (
                <>
                  <span className="loading loading-spinner loading-sm"></span>
                  Deleting...
                </>
              ) : (
                'Delete Meeting'
              )}
            </button>

            {/* Update and Cancel buttons on the right */}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="btn btn-ghost"
                disabled={isLoading || isDeleting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={isLoading || isDeleting}
              >
                {isLoading ? (
                  <>
                    <span className="loading loading-spinner loading-sm"></span>
                    Updating...
                  </>
                ) : (
                  'Update Meeting'
                )}
              </button>
            </div>
          </div>
        </form>

        {/* Delete Confirmation Modal */}
        {showDeleteConfirm && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black bg-opacity-50 p-4">
            <div className="mx-4 w-full max-w-md rounded-lg bg-white p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                Delete Meeting
              </h3>
              <p className="text-gray-600 mb-6">
                Are you sure you want to delete "{formData.subject}"? This action cannot be undone and will remove the meeting from both the calendar and database.
              </p>
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(false)}
                  className="btn btn-ghost"
                  disabled={isDeleting}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  className="btn btn-error"
                  disabled={isDeleting}
                >
                  {isDeleting ? (
                    <>
                      <span className="loading loading-spinner loading-sm"></span>
                      Deleting...
                    </>
                  ) : (
                    'Delete Meeting'
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default StaffMeetingEditModal;
