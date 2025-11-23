import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useMsal } from '@azure/msal-react';
import { 
  CalendarIcon, 
  PlusIcon, 
  TrashIcon, 
  ClockIcon,
  CheckIcon,
  XMarkIcon,
  ChevronDownIcon,
  ChevronUpIcon
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
}

const EmployeeAvailability: React.FC = () => {
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
    reason: ''
  });
  const [newUnavailableRange, setNewUnavailableRange] = useState({
    startDate: '',
    endDate: '',
    reason: ''
  });
  const [loading, setLoading] = useState(false);
  const [outlookSyncEnabled, setOutlookSyncEnabled] = useState(false);
  const [showAllUnavailableTimes, setShowAllUnavailableTimes] = useState(false);
  const [showAllUnavailableRanges, setShowAllUnavailableRanges] = useState(false);

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
        isInUnavailableRange: false
      });
    }
    
    // Add current month's days
    for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
      const date = new Date(currentYear, currentMonth, dayNum);
      // Format date as YYYY-MM-DD in local timezone to match saved format
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const dateString = `${year}-${month}-${day}`;
      const dayUnavailableTimes = unavailableTimes.filter(ut => ut.date === dateString);
      
      // Check if this date is in any unavailable range
      const rangeInfo = unavailableRanges.find(range => {
        // Compare date strings directly to avoid timezone issues
        const isInRange = dateString >= range.startDate && dateString <= range.endDate;
        
        // Debug logging for first few days
        if (dayNum <= 3 && unavailableRanges.length > 0) {
          console.log('🔍 Date range check:', {
            checkDate: dateString,
            startDate: range.startDate,
            endDate: range.endDate,
            isInRange,
            rangeReason: range.reason
          });
        }
        
        return isInRange;
      });
      
      days.push({
        date,
        isCurrentMonth: true,
        isToday: date.toDateString() === new Date().toDateString(),
        unavailableTimes: dayUnavailableTimes,
        isInUnavailableRange: !!rangeInfo,
        unavailableRangeReason: rangeInfo?.reason
      });
    }
    
    // Add next month's leading days
    const remainingDays = 42 - days.length; // 6 weeks * 7 days
    for (let dayNum = 1; dayNum <= remainingDays; dayNum++) {
      const date = new Date(currentYear, currentMonth + 1, dayNum);
      days.push({
        date,
        isCurrentMonth: false,
        isToday: false,
        unavailableTimes: [],
        isInUnavailableRange: false
      });
    }
    
    return days;
  };

  // Fetch user's unavailable times
  const fetchUnavailableTimes = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) return;

      // First, get the user's full_name from users table
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('full_name')
        .eq('auth_id', user.id)
        .single();

      if (userError || !userData?.full_name) {
        console.error('Error getting user full name:', userError);
        return;
      }

      // Then find the employee record using display_name
      const { data: employeeData, error } = await supabase
        .from('tenants_employee')
        .select('unavailable_times, outlook_calendar_sync')
        .eq('display_name', userData.full_name)
        .single();

      if (error) {
        console.error('Error fetching unavailable times:', error);
        return;
      }

      if (employeeData) {
        setUnavailableTimes(employeeData.unavailable_times || []);
        setUnavailableRanges([]); // Initialize as empty array for now
        setOutlookSyncEnabled(employeeData.outlook_calendar_sync || false);
      }

      // Try to fetch unavailable_ranges separately (in case column doesn't exist yet)
      try {
        const { data: rangesData, error: rangesError } = await supabase
          .from('tenants_employee')
          .select('unavailable_ranges')
          .eq('display_name', userData.full_name)
          .single();

        if (!rangesError && rangesData?.unavailable_ranges) {
          setUnavailableRanges(rangesData.unavailable_ranges);
        }
      } catch (rangesError) {
        console.log('unavailable_ranges column not found, using empty array');
        setUnavailableRanges([]);
      }
    } catch (error) {
      console.error('Error fetching unavailable times:', error);
    }
  };

  // Save unavailable time
  const saveUnavailableTime = async () => {
    if (!selectedDate || !newUnavailableTime.reason.trim()) {
      toast.error('Please select a date and provide a reason');
      return;
    }

    // Check if the selected date is in the past
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (selectedDate < today) {
      toast.error('Cannot add unavailable times for past dates');
      return;
    }

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) {
        toast.error('User not authenticated');
        return;
      }

      // Get the user's full_name from users table
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('full_name')
        .eq('auth_id', user.id)
        .single();

      if (userError || !userData?.full_name) {
        toast.error('Could not get user information');
        return;
      }

      // Format date as YYYY-MM-DD in local timezone to avoid UTC conversion issues
      const year = selectedDate.getFullYear();
      const month = String(selectedDate.getMonth() + 1).padStart(2, '0');
      const day = String(selectedDate.getDate()).padStart(2, '0');
      const dateString = `${year}-${month}-${day}`;

      const newTime: UnavailableTime = {
        id: Date.now().toString(),
        date: dateString,
        startTime: newUnavailableTime.startTime,
        endTime: newUnavailableTime.endTime,
        reason: newUnavailableTime.reason
      };

      // If Outlook sync is enabled, create event in Outlook
      if (outlookSyncEnabled) {
        try {
          const outlookEventId = await createOutlookEvent(newTime);
          newTime.outlookEventId = outlookEventId;
        } catch (error) {
          console.error('Error creating Outlook event:', error);
          toast.error('Failed to sync with Outlook calendar');
        }
      }

      const updatedTimes = [...unavailableTimes, newTime];
      setUnavailableTimes(updatedTimes);

      // Save to database
      const { error } = await supabase
        .from('tenants_employee')
        .update({ 
          unavailable_times: updatedTimes,
          last_sync_date: new Date().toISOString()
        })
        .eq('display_name', userData.full_name);

      if (error) {
        console.error('Error saving unavailable time:', error);
        toast.error('Failed to save unavailable time');
        return;
      }

      toast.success('Unavailable time saved successfully');
      setShowAddModal(false);
      setNewUnavailableTime({ startTime: '09:00', endTime: '17:00', reason: '' });
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

    // Create dates in local timezone to avoid UTC conversion issues
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

  // Delete unavailable time
  const deleteUnavailableTime = async (timeId: string) => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) {
        toast.error('User not authenticated');
        return;
      }

      // Get the user's full_name from users table
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('full_name')
        .eq('auth_id', user.id)
        .single();

      if (userError || !userData?.full_name) {
        toast.error('Could not get user information');
        return;
      }

      const timeToDelete = unavailableTimes.find(ut => ut.id === timeId);
      if (!timeToDelete) return;

      // Delete from Outlook if synced
      if (timeToDelete.outlookEventId && outlookSyncEnabled) {
        try {
          await deleteOutlookEvent(timeToDelete.outlookEventId);
        } catch (error) {
          console.error('Error deleting Outlook event:', error);
        }
      }

      const updatedTimes = unavailableTimes.filter(ut => ut.id !== timeId);
      setUnavailableTimes(updatedTimes);

      // Save to database
      const { error } = await supabase
        .from('tenants_employee')
        .update({ 
          unavailable_times: updatedTimes,
          last_sync_date: new Date().toISOString()
        })
        .eq('display_name', userData.full_name);

      if (error) {
        console.error('Error deleting unavailable time:', error);
        toast.error('Failed to delete unavailable time');
        return;
      }

      toast.success('Unavailable time deleted successfully');
    } catch (error) {
      console.error('Error deleting unavailable time:', error);
      toast.error('Failed to delete unavailable time');
    } finally {
      setLoading(false);
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

    // Check if start date is before end date
    if (new Date(newUnavailableRange.startDate) > new Date(newUnavailableRange.endDate)) {
      toast.error('Start date must be before end date');
      return;
    }

    // Check if the start date is in the past
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

      // Get the user's full_name from users table
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('full_name')
        .eq('auth_id', user.id)
        .single();

      if (userError || !userData?.full_name) {
        toast.error('Could not get user information');
        return;
      }

      const newRange: UnavailableRange = {
        id: Date.now().toString(),
        startDate: newUnavailableRange.startDate,
        endDate: newUnavailableRange.endDate,
        reason: newUnavailableRange.reason
      };

      console.log('🔍 Saving unavailable range:', {
        startDate: newRange.startDate,
        endDate: newRange.endDate,
        reason: newRange.reason,
        startDateObj: new Date(newRange.startDate),
        endDateObj: new Date(newRange.endDate)
      });

      // If Outlook sync is enabled, create event in Outlook
      if (outlookSyncEnabled) {
        try {
          const outlookEventId = await createOutlookRangeEvent(newRange);
          newRange.outlookEventId = outlookEventId;
        } catch (error) {
          console.error('Error creating Outlook event:', error);
          toast.error('Failed to sync with Outlook calendar');
        }
      }

      const updatedRanges = [...unavailableRanges, newRange];
      setUnavailableRanges(updatedRanges);

      // Save to database - try to update unavailable_ranges column
      try {
        const { error } = await supabase
          .from('tenants_employee')
          .update({ 
            unavailable_ranges: updatedRanges,
            last_sync_date: new Date().toISOString()
          })
          .eq('display_name', userData.full_name);

        if (error) {
          // If column doesn't exist, show warning but continue
          if (error.code === '42703') {
            console.log('unavailable_ranges column not found, saving locally only');
            toast.success('Unavailable range saved locally (database column not available yet)');
            return;
          }
          throw error;
        }
      } catch (columnError) {
        console.error('Error saving unavailable ranges:', columnError);
        toast.error('Failed to save unavailable range - database column not available');
        return;
      }

      toast.success('Unavailable range saved successfully');
      setShowAddRangeModal(false);
      setNewUnavailableRange({ startDate: '', endDate: '', reason: '' });
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

    // Create dates in local timezone to avoid UTC conversion issues
    const [startYear, startMonth, startDay] = range.startDate.split('-').map(Number);
    const [endYear, endMonth, endDay] = range.endDate.split('-').map(Number);
    
    const startDateTime = new Date(startYear, startMonth - 1, startDay, 0, 0, 0, 0);
    const endDateTime = new Date(endYear, endMonth - 1, endDay, 23, 59, 59, 999);

    // For all-day events, use date format instead of dateTime
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
      isAllDay: false, // Changed to false for better compatibility
      showAs: 'busy'
    };

    console.log('Creating Outlook event:', event);

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

  // Delete unavailable range
  const deleteUnavailableRange = async (rangeId: string) => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) {
        toast.error('User not authenticated');
        return;
      }

      // Get the user's full_name from users table
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('full_name')
        .eq('auth_id', user.id)
        .single();

      if (userError || !userData?.full_name) {
        toast.error('Could not get user information');
        return;
      }

      const rangeToDelete = unavailableRanges.find(r => r.id === rangeId);
      if (!rangeToDelete) return;

      // Delete from Outlook if synced
      if (rangeToDelete.outlookEventId && outlookSyncEnabled) {
        try {
          await deleteOutlookEvent(rangeToDelete.outlookEventId);
        } catch (error) {
          console.error('Error deleting Outlook event:', error);
        }
      }

      const updatedRanges = unavailableRanges.filter(r => r.id !== rangeId);
      setUnavailableRanges(updatedRanges);

      // Save to database - try to update unavailable_ranges column
      try {
        const { error } = await supabase
          .from('tenants_employee')
          .update({ 
            unavailable_ranges: updatedRanges,
            last_sync_date: new Date().toISOString()
          })
          .eq('display_name', userData.full_name);

        if (error) {
          // If column doesn't exist, show warning but continue
          if (error.code === '42703') {
            console.log('unavailable_ranges column not found, deleting locally only');
            toast.success('Unavailable range deleted locally (database column not available yet)');
            return;
          }
          throw error;
        }
      } catch (columnError) {
        console.error('Error deleting unavailable ranges:', columnError);
        toast.error('Failed to delete unavailable range - database column not available');
        return;
      }

      toast.success('Unavailable range deleted successfully');
    } catch (error) {
      console.error('Error deleting unavailable range:', error);
      toast.error('Failed to delete unavailable range');
    } finally {
      setLoading(false);
    }
  };

  // Toggle Outlook sync
  const toggleOutlookSync = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) {
        toast.error('User not authenticated');
        return;
      }

      // Get the user's full_name from users table
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('full_name')
        .eq('auth_id', user.id)
        .single();

      if (userError || !userData?.full_name) {
        toast.error('Could not get user information');
        return;
      }

      const newSyncStatus = !outlookSyncEnabled;
      setOutlookSyncEnabled(newSyncStatus);

      const { error } = await supabase
        .from('tenants_employee')
        .update({ 
          outlook_calendar_sync: newSyncStatus,
          last_sync_date: new Date().toISOString()
        })
        .eq('display_name', userData.full_name);

      if (error) {
        console.error('Error updating sync status:', error);
        toast.error('Failed to update sync status');
        setOutlookSyncEnabled(!newSyncStatus);
        return;
      }

      toast.success(`Outlook sync ${newSyncStatus ? 'enabled' : 'disabled'}`);
    } catch (error) {
      console.error('Error updating sync status:', error);
      toast.error('Failed to update sync status');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUnavailableTimes();
  }, []);

  const calendarDays = generateCalendarDays();
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  return (
    <div className="p-3 sm:p-8">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 sm:gap-0 mb-6 sm:mb-8">
        <div className="flex items-center gap-3 sm:gap-4">
          <div className="p-2 sm:p-3 bg-primary/10 rounded-xl">
            <CalendarIcon className="w-6 h-6 sm:w-8 sm:h-8 text-primary" />
          </div>
          <div>
            <h1 className="text-xl sm:text-3xl font-bold">Calendar & Availability</h1>
            <p className="text-sm sm:text-base text-base-content/70">Manage your unavailable times and sync with Outlook</p>
          </div>
        </div>
        
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4 w-full sm:w-auto">
          <button
            onClick={() => setShowAddRangeModal(true)}
            className="btn btn-primary btn-sm w-full sm:w-auto"
            disabled={loading}
          >
            <PlusIcon className="w-4 h-4 mr-2" />
            Add Range
          </button>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="toggle toggle-primary"
              checked={outlookSyncEnabled}
              onChange={toggleOutlookSync}
              disabled={loading}
            />
            <span className="text-xs sm:text-sm font-medium">Sync with Outlook</span>
          </label>
        </div>
      </div>

      {/* Calendar */}
      <div className="bg-base-100 rounded-xl shadow-lg p-3 sm:p-6 mb-4 sm:mb-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0 mb-4 sm:mb-6">
          <h2 className="text-lg sm:text-2xl font-bold">
            {monthNames[currentMonth]} {currentYear}
          </h2>
          <div className="flex gap-1 sm:gap-2 w-full sm:w-auto">
            <button
              className="btn btn-outline btn-xs sm:btn-sm flex-1 sm:flex-none"
              onClick={() => setCurrentDate(new Date(currentYear, currentMonth - 1, 1))}
            >
              <span className="hidden sm:inline">Previous</span>
              <span className="sm:hidden">Prev</span>
            </button>
            <button
              className="btn btn-outline btn-xs sm:btn-sm flex-1 sm:flex-none"
              onClick={() => setCurrentDate(new Date())}
            >
              Today
            </button>
            <button
              className="btn btn-outline btn-xs sm:btn-sm flex-1 sm:flex-none"
              onClick={() => setCurrentDate(new Date(currentYear, currentMonth + 1, 1))}
            >
              Next
            </button>
          </div>
        </div>

        {/* Calendar Grid */}
        <div className="grid grid-cols-7 gap-0.5 sm:gap-1">
          {/* Day headers */}
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, index) => (
            <div key={day} className="p-1 sm:p-2 text-center font-semibold text-base-content/70 text-xs sm:text-sm">
              <span className="hidden sm:inline">{day}</span>
              <span className="sm:hidden">{day.slice(0, 1)}</span>
            </div>
          ))}
          
          {/* Calendar days */}
          {calendarDays.map((day, index) => {
            const today = new Date();
            today.setHours(0, 0, 0, 0); // Reset time to start of day
            const isPastDate = day.date < today;
            const isClickable = day.isCurrentMonth && !isPastDate;
            
            return (
              <div
                key={index}
                className={`
                  p-1 sm:p-2 min-h-[60px] sm:min-h-[80px] border border-base-200 rounded transition-all duration-200
                  ${day.isCurrentMonth ? 'bg-base-100' : 'bg-base-200/50 text-base-content/50'}
                  ${isClickable ? 'cursor-pointer hover:bg-base-200' : 'cursor-not-allowed opacity-60'}
                  ${day.isToday ? 'ring-1 sm:ring-2 ring-primary' : ''}
                  ${day.unavailableTimes.length > 0 ? 'bg-error/10 border-error/30' : ''}
                  ${day.isInUnavailableRange ? 'bg-warning/10 border-warning/30' : ''}
                  ${isPastDate ? 'bg-gray-100 text-gray-400' : ''}
                `}
                onClick={() => {
                  if (isClickable) {
                    setSelectedDate(day.date);
                    setShowAddModal(true);
                  }
                }}
                title={isPastDate ? 'Cannot add unavailable times for past dates' : ''}
              >
              <div className="text-xs sm:text-sm font-medium mb-1">
                {day.date.getDate()}
              </div>
              {day.isInUnavailableRange && (
                <div className="text-[10px] sm:text-xs bg-warning/20 text-warning rounded px-0.5 sm:px-1 py-0.5 truncate mb-1"
                     title={day.unavailableRangeReason}>
                  <span className="hidden sm:inline">Range: {day.unavailableRangeReason}</span>
                  <span className="sm:hidden">R</span>
                </div>
              )}
              {day.unavailableTimes.length > 0 && (
                <div className="space-y-0.5 sm:space-y-1">
                  {day.unavailableTimes.slice(0, window.innerWidth < 640 ? 1 : 2).map(time => (
                    <div
                      key={time.id}
                      className="text-[10px] sm:text-xs bg-error/20 text-error rounded px-0.5 sm:px-1 py-0.5 truncate"
                      title={`${time.startTime}-${time.endTime}: ${time.reason}`}
                    >
                      <span className="hidden sm:inline">{time.startTime}-{time.endTime}</span>
                      <span className="sm:hidden">•</span>
                    </div>
                  ))}
                  {day.unavailableTimes.length > (window.innerWidth < 640 ? 1 : 2) && (
                    <div className="text-[10px] sm:text-xs text-error/70">
                      <span className="hidden sm:inline">+{day.unavailableTimes.length - 2} more</span>
                      <span className="sm:hidden">+{day.unavailableTimes.length - 1}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
            );
          })}
        </div>
      </div>

      {/* Unavailable Times List */}
      <div className="bg-base-100 rounded-xl shadow-lg p-3 sm:p-6 mb-4 sm:mb-6">
        <h3 className="text-lg sm:text-xl font-bold mb-3 sm:mb-4">Your Unavailable Times</h3>
        {unavailableTimes.length === 0 ? (
          <p className="text-base-content/70 text-center py-6 sm:py-8 text-sm sm:text-base">
            No unavailable times set. Click on a calendar day to add one.
          </p>
        ) : (
          <div className="space-y-2 sm:space-y-3">
            {unavailableTimes
              .sort((a, b) => {
                // Sort by date first (newest first)
                const dateCompare = new Date(b.date).getTime() - new Date(a.date).getTime();
                if (dateCompare !== 0) return dateCompare;
                // If same date, sort by start time (newest first)
                return b.startTime.localeCompare(a.startTime);
              })
              .slice(0, showAllUnavailableTimes ? unavailableTimes.length : 2)
              .map(time => (
                <div 
                  key={time.id} 
                  className="flex items-center justify-between gap-2 p-3 sm:p-4 bg-white rounded-lg"
                  style={{
                    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05), 0 0 0 1px rgba(0, 0, 0, 0.05), 0 20px 25px -5px rgba(0, 0, 0, 0.1)'
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4">
                      <div className="text-sm font-medium">
                        {new Date(time.date).toLocaleDateString()}
                      </div>
                      <div className="flex items-center gap-2 sm:gap-4">
                        <div className="text-xs sm:text-sm text-base-content/70">
                          {time.startTime} - {time.endTime}
                        </div>
                        {time.outlookEventId && (
                          <div className="flex items-center gap-1 text-xs text-success">
                            <CheckIcon className="w-3 h-3 sm:w-4 sm:h-4" />
                            <span>Synced</span>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="text-xs sm:text-sm text-base-content/80 mt-1 truncate">
                      {time.reason}
                    </div>
                  </div>
                  <button
                    className="btn btn-ghost btn-xs sm:btn-sm text-error hover:bg-error/10 flex-shrink-0"
                    onClick={() => deleteUnavailableTime(time.id)}
                    disabled={loading}
                  >
                    <TrashIcon className="w-3 h-3 sm:w-4 sm:h-4" />
                  </button>
                </div>
              ))}
            {unavailableTimes.length > 2 && (
              <button
                className="w-full flex items-center justify-center gap-2 p-3 text-sm font-medium text-primary hover:bg-primary/10 rounded-lg transition-colors"
                onClick={() => setShowAllUnavailableTimes(!showAllUnavailableTimes)}
              >
                {showAllUnavailableTimes ? (
                  <>
                    <ChevronUpIcon className="w-5 h-5" />
                    Show Less
                  </>
                ) : (
                  <>
                    <ChevronDownIcon className="w-5 h-5" />
                    Show All ({unavailableTimes.length})
                  </>
                )}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Unavailable Ranges List */}
      <div className="bg-base-100 rounded-xl shadow-lg p-3 sm:p-6">
        <h3 className="text-lg sm:text-xl font-bold mb-3 sm:mb-4">Your Unavailable Ranges</h3>
        {unavailableRanges.length === 0 ? (
          <p className="text-base-content/70 text-center py-6 sm:py-8 text-sm sm:text-base">
            No unavailable ranges set. Click "Add Range" to create one.
          </p>
        ) : (
          <div className="space-y-2 sm:space-y-3">
            {unavailableRanges
              .sort((a, b) => {
                // Sort by start date first (newest first)
                const dateCompare = new Date(b.startDate).getTime() - new Date(a.startDate).getTime();
                if (dateCompare !== 0) return dateCompare;
                // If same start date, sort by end date (newest first)
                return new Date(b.endDate).getTime() - new Date(a.endDate).getTime();
              })
              .slice(0, showAllUnavailableRanges ? unavailableRanges.length : 2)
              .map(range => (
                <div 
                  key={range.id} 
                  className="flex items-center justify-between gap-2 p-3 sm:p-4 bg-white rounded-lg"
                  style={{
                    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05), 0 0 0 1px rgba(0, 0, 0, 0.05), 0 20px 25px -5px rgba(0, 0, 0, 0.1)'
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4">
                      <div className="text-sm font-medium">
                        {new Date(range.startDate).toLocaleDateString()} - {new Date(range.endDate).toLocaleDateString()}
                      </div>
                      {range.outlookEventId && (
                        <div className="flex items-center gap-1 text-xs text-success">
                          <CheckIcon className="w-3 h-3 sm:w-4 sm:h-4" />
                          <span>Synced</span>
                        </div>
                      )}
                    </div>
                    <div className="text-xs sm:text-sm text-base-content/80 mt-1 truncate">
                      {range.reason}
                    </div>
                  </div>
                  <button
                    className="btn btn-ghost btn-xs sm:btn-sm text-error hover:bg-error/10 flex-shrink-0"
                    onClick={() => deleteUnavailableRange(range.id)}
                    disabled={loading}
                  >
                    <TrashIcon className="w-3 h-3 sm:w-4 sm:h-4" />
                  </button>
                </div>
              ))}
            {unavailableRanges.length > 2 && (
              <button
                className="w-full flex items-center justify-center gap-2 p-3 text-sm font-medium text-primary hover:bg-primary/10 rounded-lg transition-colors"
                onClick={() => setShowAllUnavailableRanges(!showAllUnavailableRanges)}
              >
                {showAllUnavailableRanges ? (
                  <>
                    <ChevronUpIcon className="w-5 h-5" />
                    Show Less
                  </>
                ) : (
                  <>
                    <ChevronDownIcon className="w-5 h-5" />
                    Show All ({unavailableRanges.length})
                  </>
                )}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Add Unavailable Time Modal */}
      {showAddModal && selectedDate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-base-100 rounded-xl p-4 sm:p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-3 sm:mb-4">
              <h3 className="text-base sm:text-lg font-bold">Add Unavailable Time</h3>
              <button
                className="btn btn-ghost btn-xs sm:btn-sm"
                onClick={() => setShowAddModal(false)}
              >
                <XMarkIcon className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
            </div>
            
            <div className="space-y-3 sm:space-y-4">
              <div>
                <label className="label">
                  <span className="label-text text-sm">Date</span>
                </label>
                <input
                  type="text"
                  className="input input-bordered input-sm sm:input-md w-full"
                  value={selectedDate.toLocaleDateString()}
                  disabled
                />
              </div>
              
              <div className="grid grid-cols-2 gap-2 sm:gap-4">
                <div>
                  <label className="label">
                    <span className="label-text text-sm">Start Time</span>
                  </label>
                  <input
                    type="time"
                    className="input input-bordered input-sm sm:input-md w-full"
                    value={newUnavailableTime.startTime}
                    onChange={(e) => setNewUnavailableTime(prev => ({ ...prev, startTime: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label">
                    <span className="label-text text-sm">End Time</span>
                  </label>
                  <input
                    type="time"
                    className="input input-bordered input-sm sm:input-md w-full"
                    value={newUnavailableTime.endTime}
                    onChange={(e) => setNewUnavailableTime(prev => ({ ...prev, endTime: e.target.value }))}
                  />
                </div>
              </div>
              
              <div>
                <label className="label">
                  <span className="label-text text-sm">Reason</span>
                </label>
                <input
                  type="text"
                  className="input input-bordered input-sm sm:input-md w-full"
                  placeholder="e.g., Personal appointment, Vacation, etc."
                  value={newUnavailableTime.reason}
                  onChange={(e) => setNewUnavailableTime(prev => ({ ...prev, reason: e.target.value }))}
                />
              </div>
            </div>
            
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 mt-4 sm:mt-6">
              <button
                className="btn btn-primary btn-sm sm:btn-md flex-1"
                onClick={saveUnavailableTime}
                disabled={loading}
              >
                {loading ? 'Saving...' : 'Save'}
              </button>
              <button
                className="btn btn-ghost btn-sm sm:btn-md"
                onClick={() => setShowAddModal(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Unavailable Range Modal */}
      {showAddRangeModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-base-100 rounded-xl p-4 sm:p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-3 sm:mb-4">
              <h3 className="text-base sm:text-lg font-bold">Add Unavailable Range</h3>
              <button
                className="btn btn-ghost btn-xs sm:btn-sm"
                onClick={() => setShowAddRangeModal(false)}
              >
                <XMarkIcon className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
            </div>
            
            <div className="space-y-3 sm:space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-4">
                <div>
                  <label className="label">
                    <span className="label-text text-sm">Start Date</span>
                  </label>
                  <input
                    type="date"
                    className="input input-bordered input-sm sm:input-md w-full"
                    value={newUnavailableRange.startDate}
                    onChange={(e) => setNewUnavailableRange(prev => ({ ...prev, startDate: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label">
                    <span className="label-text text-sm">End Date</span>
                  </label>
                  <input
                    type="date"
                    className="input input-bordered input-sm sm:input-md w-full"
                    value={newUnavailableRange.endDate}
                    onChange={(e) => setNewUnavailableRange(prev => ({ ...prev, endDate: e.target.value }))}
                  />
                </div>
              </div>
              
              <div>
                <label className="label">
                  <span className="label-text text-sm">Reason</span>
                </label>
                <input
                  type="text"
                  className="input input-bordered input-sm sm:input-md w-full"
                  placeholder="e.g., Vacation, Sick Leave, Conference"
                  value={newUnavailableRange.reason}
                  onChange={(e) => setNewUnavailableRange(prev => ({ ...prev, reason: e.target.value }))}
                />
              </div>
            </div>
            
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 mt-4 sm:mt-6">
              <button
                className="btn btn-primary btn-sm sm:btn-md flex-1"
                onClick={saveUnavailableRange}
                disabled={loading}
              >
                {loading ? 'Saving...' : 'Save Range'}
              </button>
              <button
                className="btn btn-ghost btn-sm sm:btn-md"
                onClick={() => setShowAddRangeModal(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EmployeeAvailability;
