import React, { useState, useEffect, useRef } from 'react';
import { XMarkIcon, CalendarIcon, ClockIcon, UserIcon, VideoCameraIcon, ArrowPathIcon, MagnifyingGlassIcon, TrashIcon } from '@heroicons/react/24/outline';
import { createStaffTeamsMeeting, getAccessTokenWithFallback, AuthPopupBlockedError, triggerTokenRedirect } from '../lib/graph';
import { useMsal } from '@azure/msal-react';
import { InteractionRequiredAuthError } from '@azure/msal-browser';
import { loginRequest } from '../msalConfig';
import { toast } from 'react-hot-toast';
import { saveOutlookTeamsMeeting, type OutlookTeamsMeeting } from '../lib/outlookTeamsMeetingsApi';
import { supabase } from '../lib/supabase';

export interface StaffEmployeeForModal {
  id: number;
  display_name: string;
  photo_url?: string | null;
  photo?: string | null;
}

interface TeamsMeetingModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedDate?: Date;
  selectedTime?: string;
  /** When provided (e.g. from CalendarPage allEmployees), use this list for the dropdown (staff only). Emails are fetched on open. */
  staffEmployees?: StaffEmployeeForModal[];
}

interface MeetingFormData {
  subject: string;
  date: string;
  time: string;
  duration: string;
  attendees: string[];
  description: string;
  location: string;
  isRecurring: boolean;
  recurrencePattern: 'daily' | 'weekly' | 'monthly';
  recurrenceInterval: number;
  recurrenceEndDate: string;
}

// Staff calendar email
const STAFF_CALENDAR_EMAIL = 'shared-staffcalendar@lawoffice.org.il';

const getInitials = (name: string) => {
  if (!name) return '--';
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
};

const TeamsMeetingModal: React.FC<TeamsMeetingModalProps> = ({
  isOpen,
  onClose,
  selectedDate,
  selectedTime,
  staffEmployees: staffEmployeesProp
}) => {
  const { instance, accounts } = useMsal();
  const [isLoading, setIsLoading] = useState(false);
  const [employees, setEmployees] = useState<Array<{ id: number; display_name: string; email?: string | null; photo_url?: string | null; photo?: string | null }>>([]);
  const [filteredEmployees, setFilteredEmployees] = useState<typeof employees>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showEmployeeSearch, setShowEmployeeSearch] = useState(false);
  const [allStaffSelected, setAllStaffSelected] = useState(false);
  const employeeDropdownRef = useRef<HTMLDivElement | null>(null);
  const [avatarImageErrors, setAvatarImageErrors] = useState<Set<number>>(new Set());
  const [showAuthRedirectOption, setShowAuthRedirectOption] = useState(false);
  const authRedirectParamsRef = useRef<{ request: any; account: any } | null>(null);
  const [formData, setFormData] = useState<MeetingFormData>({
    subject: '',
    date: selectedDate ? selectedDate.toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
    time: selectedTime || '09:00',
    duration: '60',
    attendees: [],
    description: '',
    location: 'Teams Meeting',
    isRecurring: false,
    recurrencePattern: 'weekly',
    recurrenceInterval: 1,
    recurrenceEndDate: ''
  });

  useEffect(() => {
    if (selectedDate) {
      setFormData(prev => ({
        ...prev,
        date: selectedDate.toISOString().split('T')[0]
      }));
    }
    if (selectedTime) {
      setFormData(prev => ({
        ...prev,
        time: selectedTime
      }));
    }
  }, [selectedDate, selectedTime]);

  useEffect(() => {
    if (!isOpen) setAvatarImageErrors(new Set());
  }, [isOpen]);

  // When modal opens: use staffEmployees prop (from CalendarPage) or fetch with is_staff = true
  useEffect(() => {
    if (!isOpen) return;
    if (staffEmployeesProp && staffEmployeesProp.length > 0) {
      const ids = staffEmployeesProp.map((e) => e.id);
      supabase
        .from('users')
        .select('employee_id, email')
        .in('employee_id', ids)
        .eq('is_staff', true)
        .not('email', 'is', null)
        .then(({ data: usersData, error: usersError }) => {
          if (usersError) {
            toast.error('Failed to load staff emails');
            setEmployees([]);
            setFilteredEmployees([]);
            return;
          }
          const emailMap = new Map<number, string>();
          (usersData || []).forEach((u: { employee_id: number; email: string }) => {
            emailMap.set(u.employee_id, u.email);
          });
          const merged = staffEmployeesProp
            .filter((e) => emailMap.has(e.id))
            .map((e) => ({
              id: e.id,
              display_name: e.display_name,
              email: emailMap.get(e.id) ?? null,
              photo_url: e.photo_url ?? null,
              photo: e.photo ?? null
            }))
            .sort((a, b) => a.display_name.localeCompare(b.display_name));
          setEmployees(merged);
          setFilteredEmployees(merged);
        });
    } else {
      fetchEmployees();
    }
  }, [isOpen, staffEmployeesProp?.length]);

  // Filter employees based on search term
  useEffect(() => {
    if (searchTerm.trim() === '') {
      setFilteredEmployees(employees);
    } else {
      const filtered = employees.filter(emp => 
        emp.display_name?.toLowerCase().includes(searchTerm.toLowerCase())
      );
      setFilteredEmployees(filtered);
    }
  }, [searchTerm, employees]);

  // Handle clicking outside employee dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        employeeDropdownRef.current &&
        !employeeDropdownRef.current.contains(event.target as Node)
      ) {
        setShowEmployeeSearch(false);
      }
    };

    if (showEmployeeSearch) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showEmployeeSearch]);

  // Check if all staff are selected
  useEffect(() => {
    if (employees.length > 0 && formData.attendees.length > 0) {
      const allEmails = employees.map((emp) => emp.email).filter((e): e is string => Boolean(e));
      const allSelected =
        allEmails.length > 0 &&
        formData.attendees.length === allEmails.length &&
        allEmails.every((email) => formData.attendees.includes(email));
      setAllStaffSelected(allSelected);
    } else if (formData.attendees.length === 0) {
      setAllStaffSelected(false);
    }
  }, [formData.attendees, employees]);

  const fetchEmployees = async () => {
    try {
      const { data: employeesData, error: employeesError } = await supabase
        .from('tenants_employee')
        .select('id, display_name, photo_url, photo')
        .not('display_name', 'is', null)
        .order('display_name');

      if (employeesError) {
        toast.error('Failed to load employees');
        return;
      }

      const employeeIds = employeesData?.map((emp) => emp.id).filter(Boolean) || [];
      if (employeeIds.length === 0) {
        setEmployees([]);
        setFilteredEmployees([]);
        return;
      }

      const { data: usersData, error: usersError } = await supabase
        .from('users')
        .select('employee_id, email')
        .in('employee_id', employeeIds)
        .eq('is_staff', true)
        .eq('is_active', true)
        .not('email', 'is', null);

      if (usersError) {
        toast.error('Failed to load staff emails');
        return;
      }

      const emailMap = new Map<number, string>();
      (usersData || []).forEach((u: { employee_id: number; email: string }) => {
        emailMap.set(u.employee_id, u.email);
      });

      const processedEmployees = (employeesData || [])
        .filter((emp) => emailMap.has(emp.id))
        .map((emp) => ({
          id: emp.id,
          display_name: emp.display_name,
          email: emailMap.get(emp.id) ?? null,
          photo_url: emp.photo_url ?? null,
          photo: emp.photo ?? null
        }));

      setEmployees(processedEmployees);
      setFilteredEmployees(processedEmployees);
    } catch (error) {
      toast.error('Failed to load employees');
    }
  };

  const handleInputChange = (field: keyof MeetingFormData, value: string | boolean | number) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const addEmployeeToAttendees = (employee: any) => {
    const email = employee.email; // Use the actual email from the database
    if (!formData.attendees.includes(email)) {
      setFormData(prev => ({
        ...prev,
        attendees: [...prev.attendees, email]
      }));
      setAllStaffSelected(false);
    }
  };

  const removeEmployeeFromAttendees = (email: string) => {
    setFormData(prev => ({
      ...prev,
      attendees: prev.attendees.filter(a => a !== email)
    }));
    setAllStaffSelected(false);
  };

  const selectAllEmployees = () => {
    if (employees.length === 0) {
      toast.error('No employees available to select', { duration: 3000 });
      return;
    }
    const allEmails = employees.map((emp) => emp.email).filter((e): e is string => Boolean(e));
    setFormData((prev) => ({
      ...prev,
      attendees: allEmails
    }));
    setAllStaffSelected(true);
    setShowEmployeeSearch(false);
    setSearchTerm('');
    toast.success(`All ${allEmails.length} staff members selected`, { duration: 3000 });
  };

  const clearAllAttendees = () => {
    setFormData(prev => ({
      ...prev,
      attendees: []
    }));
    setAllStaffSelected(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    
    if (!formData.subject.trim()) {
      toast.error('Please enter a meeting subject', { duration: 5000 });
      return;
    }

    setIsLoading(true);
    
    try {
      // First, get the authenticated user from Supabase to get their email from database
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) {
        toast.error('Authentication error. Please refresh and try again.', { duration: 5000 });
        setIsLoading(false);
        return;
      }

      // Resolve user email from users table: auth_id first, then email fallback (so it never fails when user exists)
      let userEmail: string | null = null;
      try {
        let userData: { email: string } | null = null;
        const byAuth = await supabase
          .from('users')
          .select('email')
          .eq('auth_id', authUser.id)
          .maybeSingle();
        if (byAuth.data?.email) {
          userData = byAuth.data;
        } else if (authUser.email) {
          const byEmail = await supabase
            .from('users')
            .select('email')
            .eq('email', authUser.email)
            .maybeSingle();
          if (byEmail.data?.email) userData = byEmail.data;
        }
        if (userData?.email) userEmail = userData.email;
      } catch (dbError) {
        console.warn('TeamsMeetingModal: error resolving user email', dbError);
      }
      if (!userEmail && authUser.email) userEmail = authUser.email;

      // Find the MSAL account that matches the database/user email
      let account = accounts[0];

      if (userEmail && accounts.length > 0) {
        const matchingAccount = accounts.find(acc =>
          acc.username?.toLowerCase() === userEmail?.toLowerCase() ||
          acc.name?.toLowerCase() === userEmail?.toLowerCase()
        );
        if (matchingAccount) {
          account = matchingAccount;
        }
      }

      if (!account) {
        toast.error('You must be signed in to Microsoft to create Teams meetings. Please click the Microsoft sign in button in the header.', { duration: 8000 });
        setIsLoading(false);
        return;
      }

      const staffCalendarRequest = {
        ...loginRequest,
        scopes: ['https://graph.microsoft.com/Calendars.ReadWrite', 'https://graph.microsoft.com/OnlineMeetings.ReadWrite'],
        extraQueryParameters: { login_hint: STAFF_CALENDAR_EMAIL }
      };
      setShowAuthRedirectOption(false);
      authRedirectParamsRef.current = { request: staffCalendarRequest, account };

      const accessToken = await getAccessTokenWithFallback(
        instance,
        staffCalendarRequest,
        account,
        () => toast.loading('Authenticating with shared calendar...', { duration: 3000 })
      );

      if (!accessToken) {
        toast.error(
          'Redirecting to sign in… If the page did not redirect, allow popups or use "Sign in (this tab)" when the option appears.',
          { duration: 8000 }
        );
        setIsLoading(false);
        return;
      }
      

      // Calculate start and end times - create in local timezone
      const startDateTime = new Date(`${formData.date}T${formData.time}:00`);
      const endDateTime = new Date(startDateTime.getTime() + parseInt(formData.duration) * 60000);

      // Format dates for Microsoft Graph API - use simple ISO format without timezone
      // Microsoft Graph will interpret these as local time when timeZone is specified
      const formatDateTimeForGraph = (date: Date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');
        return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
      };

      const meetingDetails = {
        subject: formData.subject,
        startDateTime: formatDateTimeForGraph(startDateTime),
        endDateTime: formatDateTimeForGraph(endDateTime),
        attendees: formData.attendees.map(email => ({ email })),
        isRecurring: formData.isRecurring,
        recurrencePattern: formData.recurrencePattern,
        recurrenceInterval: formData.recurrenceInterval,
        recurrenceEndDate: formData.recurrenceEndDate ? formatDateTimeForGraph(new Date(formData.recurrenceEndDate)) : null
      };


      
      let result;
      try {
        result = await createStaffTeamsMeeting(accessToken, meetingDetails);
        
        if (!result || !result.id) {
          throw new Error('Teams meeting creation returned invalid result - no meeting ID');
        }
        
      } catch (outlookError) {
        throw outlookError; // Re-throw to be caught by outer catch block
      }
      
      // Get current user's auth ID for RLS policy compliance
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error('Authentication error. Please refresh and try again.', { duration: 5000 });
        setIsLoading(false);
        return;
      }

      // Save meeting data to database
      const meetingData: OutlookTeamsMeeting = {
        teams_meeting_id: result.id,
        subject: formData.subject,
        start_date_time: startDateTime.toISOString(),
        end_date_time: endDateTime.toISOString(),
        teams_join_url: result.joinUrl,
        teams_meeting_url: result.onlineMeeting?.joinUrl || result.joinUrl,
        calendar_id: STAFF_CALENDAR_EMAIL,
        attendees: formData.attendees,
        description: formData.description,
        location: formData.location,
        created_by: user.id, // Use Supabase auth user ID instead of email
        is_online_meeting: true,
        online_meeting_provider: 'teamsForBusiness'
      };

      // Only proceed with database save if Outlook meeting was created successfully
      if (!result || !result.id) {
        toast.error('Failed to create Teams meeting in Outlook. Please try again.', { duration: 8000 });
        setIsLoading(false);
        return;
      }
      const { error: saveError } = await saveOutlookTeamsMeeting(meetingData);
      
      if (saveError) {
        // Check if it's a policy/permission error
        if (saveError.code === 'PGRST301' || saveError.message?.includes('policy') || saveError.message?.includes('permission')) {
          toast.success('Teams meeting created successfully in Outlook! (Note: Database save failed due to permissions)', { duration: 8000 });
        } else {
          toast.error(`Meeting created in Teams but failed to save to database: ${saveError.message || 'Unknown error'}`, { duration: 8000 });
        }
      } else {
        // Format date and time for toast notification
        const meetingDate = new Date(`${formData.date}T${formData.time}:00`);
        const formattedDate = meetingDate.toLocaleDateString('en-US', {
          weekday: 'short',
          year: 'numeric',
          month: 'short',
          day: 'numeric'
        });
        const formattedTime = meetingDate.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        });

        toast.success(
          `Teams meeting created successfully! Scheduled for ${formattedDate} at ${formattedTime}`,
          { duration: 6000 }
        );
      }
      
      
      // Only reset form and close modal if everything was successful
      if (!saveError) {
        setFormData({
          subject: '',
          date: new Date().toISOString().split('T')[0],
          time: '09:00',
          duration: '60',
          attendees: [],
          description: '',
          location: 'Teams Meeting',
          isRecurring: false,
          recurrencePattern: 'weekly',
          recurrenceInterval: 1,
          recurrenceEndDate: ''
        });
        onClose();
      }
      
    } catch (error) {
      console.error('Teams meeting creation error:', error);

      if (error instanceof AuthPopupBlockedError) {
        setShowAuthRedirectOption(true);
        toast.error(error.message, { duration: 10000 });
      } else if (error instanceof Error) {
        if (error.message.includes('insufficient privileges') || error.message.includes('permission') || error.message.includes('Access Denied')) {
          toast.error('Permission denied: You do not have access to create meetings in the shared calendar. Please contact your administrator to grant you permissions.', { duration: 8000 });
        } else if (error.message.includes('authentication') || error.message.includes('token') || error.message.includes('login')) {
          toast.error('Authentication failed: Please ensure you are signed in with the correct Microsoft account and try again.', { duration: 8000 });
        } else if (error.message.includes('AADSTS') || error.message.includes('consent')) {
          toast.error('Microsoft authentication error: Please sign out and sign in again, then try creating the meeting.', { duration: 8000 });
        } else {
          toast.error(`Failed to create Teams meeting: ${error.message}`, { duration: 8000 });
        }
      } else {
        toast.error('Failed to create Teams meeting: Unknown error occurred. Please try again or contact support.', { duration: 8000 });
      }
    } finally {
      setIsLoading(false);
    }
  };

  const durationOptions = [
    { value: '15', label: '15 minutes' },
    { value: '30', label: '30 minutes' },
    { value: '45', label: '45 minutes' },
    { value: '60', label: '1 hour' },
    { value: '90', label: '1.5 hours' },
    { value: '120', label: '2 hours' },
    { value: '180', label: '3 hours' },
    { value: '240', label: '4 hours' }
  ];

  useEffect(() => {
    if (!isOpen) {
      setShowAuthRedirectOption(false);
      authRedirectParamsRef.current = null;
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSignInThisTab = async () => {
    const params = authRedirectParamsRef.current;
    if (!params) return;
    setShowAuthRedirectOption(false);
    toast.loading('Redirecting to Microsoft sign-in… Create the meeting again after you return.', { duration: 5000 });
    await triggerTokenRedirect(instance, params.request, params.account);
  };

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center ${isOpen ? '' : 'hidden'}`}>
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black bg-opacity-50 transition-opacity"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-3xl mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 p-6 rounded-t-2xl flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            <VideoCameraIcon className="h-6 w-6 text-gray-600" />
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Create Teams Meeting</h2>
              <p className="text-sm text-gray-500">Schedule a meeting in Staff Calendar</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="btn btn-sm btn-circle btn-ghost text-gray-600 hover:bg-gray-100"
            disabled={isLoading}
          >
            <XMarkIcon className="w-6 h-6" />
          </button>
        </div>

        {/* Popup blocked / redirect option */}
        {showAuthRedirectOption && (
          <div className="mx-6 mt-4 p-4 bg-amber-50 border border-amber-200 rounded-lg flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-amber-900">
              Sign-in window was blocked or could not open. Use the button to sign in in this tab (you can create the meeting again after you return).
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowAuthRedirectOption(false)}
                className="btn btn-ghost btn-sm"
              >
                Dismiss
              </button>
              <button
                type="button"
                onClick={handleSignInThisTab}
                className="btn btn-primary btn-sm"
              >
                Sign in (this tab)
              </button>
            </div>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Subject */}
          <div className="form-control">
            <label className="label">
              <span className="label-text font-semibold">Meeting Subject *</span>
            </label>
            <input
              type="text"
              id="subject"
              value={formData.subject}
              onChange={(e) => handleInputChange('subject', e.target.value)}
              className="input input-bordered w-full"
              placeholder="Enter meeting subject..."
              required
            />
          </div>

          {/* Date and Time Row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Date */}
            <div className="form-control">
              <label className="label">
                <span className="label-text font-semibold">
                <CalendarIcon className="h-4 w-4 inline mr-1" />
                Date
                </span>
              </label>
              <input
                type="date"
                id="date"
                value={formData.date}
                onChange={(e) => handleInputChange('date', e.target.value)}
                className="input input-bordered w-full"
                required
              />
            </div>

            {/* Time */}
            <div className="form-control">
              <label className="label">
                <span className="label-text font-semibold">
                <ClockIcon className="h-4 w-4 inline mr-1" />
                Start Time
                </span>
              </label>
              <input
                type="time"
                id="time"
                value={formData.time}
                onChange={(e) => handleInputChange('time', e.target.value)}
                className="input input-bordered w-full"
                required
              />
            </div>

            {/* Duration */}
            <div className="form-control">
              <label className="label">
                <span className="label-text font-semibold">Duration</span>
              </label>
              <select
                id="duration"
                value={formData.duration}
                onChange={(e) => handleInputChange('duration', e.target.value)}
                className="select select-bordered w-full"
              >
                {durationOptions.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Attendees */}
          <div className="form-control">
            <div className="flex flex-wrap items-center gap-3 gap-y-2">
              <span className="label-text font-semibold flex items-center gap-1">
                <UserIcon className="h-4 w-4" />
                Attendees
              </span>
              <button
                type="button"
                onClick={selectAllEmployees}
                className="btn btn-sm btn-outline btn-primary h-9 min-h-9"
              >
                Select All Staff
              </button>
              <button
                type="button"
                onClick={clearAllAttendees}
                className="btn btn-sm btn-ghost btn-circle h-9 min-h-9 w-9"
                title="Clear All"
              >
                <TrashIcon className="w-4 h-4" />
              </button>
              <div className="flex-1 min-w-[180px] flex items-center gap-2 h-9 relative" ref={employeeDropdownRef}>
                <input
                  type="text"
                  className="input input-bordered input-sm h-9 min-h-9 flex-1 w-full"
                  placeholder="Search staff..."
                    value={allStaffSelected ? 'All staff selected' : searchTerm}
                    onFocus={() => {
                      setShowEmployeeSearch(true);
                      if (allStaffSelected) {
                        setSearchTerm('');
                      }
                    }}
                    onChange={(e) => {
                      const value = e.target.value;
                      setSearchTerm(value);
                      setShowEmployeeSearch(true);
                      setAllStaffSelected(false);
                      }}
                    readOnly={allStaffSelected}
                  />
                  {showEmployeeSearch && !allStaffSelected && (
                    <div className="absolute z-30 mt-2 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-64 overflow-auto">
                      {filteredEmployees.length > 0 ? (
                        filteredEmployees.map((employee) => {
                          const email = employee.email;
                          const isSelected = email ? formData.attendees.includes(email) : false;
                          const photoUrl = employee.photo_url || employee.photo;
                          const showPhoto = photoUrl && !avatarImageErrors.has(employee.id);
                          const initials = getInitials(employee.display_name);
                          return (
                            <button
                              key={employee.id}
                              type="button"
                              className={`w-full text-left px-4 py-2.5 text-sm hover:bg-gray-100 flex items-center gap-3 ${isSelected ? 'bg-primary/10 text-primary' : ''}`}
                              onClick={() => {
                                if (!email) return;
                                if (isSelected) {
                                  removeEmployeeFromAttendees(email);
                                } else {
                                  addEmployeeToAttendees(employee);
                                }
                                setShowEmployeeSearch(false);
                                setSearchTerm('');
                              }}
                            >
                              <div className="flex-shrink-0 w-11 h-11 rounded-full overflow-hidden bg-green-100 text-green-700 flex items-center justify-center text-base font-semibold ring-1 ring-green-200">
                                {showPhoto ? (
                                  <img
                                    src={photoUrl}
                                    alt=""
                                    className="w-full h-full object-cover"
                                    onError={() => {
                                      setAvatarImageErrors((prev) => new Set(prev).add(employee.id));
                                    }}
                                  />
                                ) : (
                                  initials
                                )}
                              </div>
                              <span className="font-medium truncate">{employee.display_name}</span>
                            </button>
                          );
                        })
                      ) : (
                        <div className="px-4 py-3 text-sm text-gray-500">No matches</div>
                      )}
                    </div>
                  )}
                        </div>
              </div>

            {/* Selected Attendees */}
            {formData.attendees.length > 0 && (
                <div className="mt-3">
                  {allStaffSelected ? (
                    <div className="p-3 bg-primary/10 border border-primary/20 rounded-lg">
                      <p className="text-sm font-semibold text-primary">All staff selected ({formData.attendees.length} staff members)</p>
                    </div>
                  ) : (
                    <>
                  <p className="text-xs font-medium text-gray-700 mb-2">Selected attendees ({formData.attendees.length}):</p>
                      <div className="flex flex-wrap gap-2">
                    {formData.attendees.map((email) => {
                      const employee = employees.find(emp => emp.email === email);
                      return (
                            <div
                          key={email}
                              className="badge badge-primary badge-lg gap-2"
                        >
                          {employee?.display_name || email}
                          <button
                            type="button"
                            onClick={() => removeEmployeeFromAttendees(email)}
                                className="hover:opacity-70"
                          >
                            ×
                          </button>
                            </div>
                      );
                    })}
                  </div>
                    </>
                  )}
                </div>
              )}
          </div>

          {/* Description */}
          <div className="form-control">
            <label className="label">
              <span className="label-text font-semibold">Description</span>
            </label>
            <textarea
              id="description"
              value={formData.description}
              onChange={(e) => handleInputChange('description', e.target.value)}
              className="textarea textarea-bordered w-full h-24"
              placeholder="Enter meeting description..."
            />
          </div>

          {/* Location */}
          <div className="form-control">
            <label className="label">
              <span className="label-text font-semibold">Location</span>
            </label>
            <input
              type="text"
              id="location"
              value={formData.location}
              onChange={(e) => handleInputChange('location', e.target.value)}
              className="input input-bordered w-full"
              placeholder="Teams Meeting"
            />
          </div>

          {/* Recurring Meeting */}
          <div className="form-control">
            <label className="label cursor-pointer gap-2">
              <input
                type="checkbox"
                id="isRecurring"
                checked={formData.isRecurring}
                onChange={(e) => handleInputChange('isRecurring', e.target.checked)}
                className="checkbox checkbox-primary"
              />
              <span className="label-text font-semibold">
                <ArrowPathIcon className="h-4 w-4 inline mr-1" />
                Recurring Meeting
              </span>
              </label>

            {formData.isRecurring && (
              <div className="ml-7 space-y-4 p-4 bg-base-200 rounded-lg mt-2">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="form-control">
                    <label className="label">
                      <span className="label-text font-semibold">Recurrence Pattern</span>
                    </label>
                    <select
                      id="recurrencePattern"
                      value={formData.recurrencePattern}
                      onChange={(e) => handleInputChange('recurrencePattern', e.target.value as 'daily' | 'weekly' | 'monthly')}
                      className="select select-bordered w-full"
                    >
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                    </select>
                  </div>

                  <div className="form-control">
                    <label className="label">
                      <span className="label-text font-semibold">Repeat Every</span>
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        id="recurrenceInterval"
                        min="1"
                        max="99"
                        value={formData.recurrenceInterval}
                        onChange={(e) => handleInputChange('recurrenceInterval', parseInt(e.target.value) || 1)}
                        className="input input-bordered w-20"
                      />
                      <span className="text-sm text-gray-600">
                        {formData.recurrencePattern === 'daily' ? 'day(s)' :
                         formData.recurrencePattern === 'weekly' ? 'week(s)' : 'month(s)'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="form-control">
                  <label className="label">
                    <span className="label-text font-semibold">End Date (Optional)</span>
                  </label>
                  <input
                    type="date"
                    id="recurrenceEndDate"
                    value={formData.recurrenceEndDate}
                    onChange={(e) => handleInputChange('recurrenceEndDate', e.target.value)}
                    min={formData.date}
                    className="input input-bordered w-full"
                  />
                  <label className="label">
                    <span className="label-text-alt text-gray-500">Leave empty for no end date</span>
                  </label>
                </div>
              </div>
            )}
          </div>
        </form>

        {/* Footer */}
        <div className="sticky bottom-0 bg-gray-50 p-6 rounded-b-2xl flex justify-end gap-3 border-t">
            <button
              type="button"
              onClick={onClose}
            className="btn btn-ghost"
              disabled={isLoading}
            >
              Cancel
            </button>
            <button
            type="button"
            onClick={handleSubmit}
            className="btn btn-primary"
              disabled={isLoading || !formData.subject.trim()}
            >
              {isLoading ? (
                <>
                <span className="loading loading-spinner loading-sm"></span>
                Creating...
                </>
              ) : (
                <>
                <VideoCameraIcon className="w-5 h-5" />
                Create Meeting
                </>
              )}
            </button>
          </div>
      </div>
    </div>
  );
};

export default TeamsMeetingModal;
