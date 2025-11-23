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

interface CalendarDay {
  date: Date;
  isCurrentMonth: boolean;
  isToday: boolean;
  unavailableTimes: UnavailableTime[];
}

const EmployeeAvailability: React.FC = () => {
  const { instance } = useMsal();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [unavailableTimes, setUnavailableTimes] = useState<UnavailableTime[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newUnavailableTime, setNewUnavailableTime] = useState({
    startTime: '09:00',
    endTime: '17:00',
    reason: ''
  });
  const [loading, setLoading] = useState(false);
  const [outlookSyncEnabled, setOutlookSyncEnabled] = useState(false);
  const [showAllUnavailableTimes, setShowAllUnavailableTimes] = useState(false);

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
        unavailableTimes: []
      });
    }
    
    // Add current month's days
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(currentYear, currentMonth, day);
      const dateString = date.toISOString().split('T')[0];
      const dayUnavailableTimes = unavailableTimes.filter(ut => ut.date === dateString);
      
      days.push({
        date,
        isCurrentMonth: true,
        isToday: date.toDateString() === new Date().toDateString(),
        unavailableTimes: dayUnavailableTimes
      });
    }
    
    // Add next month's leading days
    const remainingDays = 42 - days.length; // 6 weeks * 7 days
    for (let day = 1; day <= remainingDays; day++) {
      const date = new Date(currentYear, currentMonth + 1, day);
      days.push({
        date,
        isCurrentMonth: false,
        isToday: false,
        unavailableTimes: []
      });
    }
    
    return days;
  };

  // Fetch user's unavailable times
  const fetchUnavailableTimes = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) return;

      const { data: employeeData, error } = await supabase
        .from('tenants_employee')
        .select('unavailable_times, outlook_calendar_sync')
        .eq('user_id', user.id)
        .single();

      if (error) {
        console.error('Error fetching unavailable times:', error);
        return;
      }

      if (employeeData) {
        setUnavailableTimes(employeeData.unavailable_times || []);
        setOutlookSyncEnabled(employeeData.outlook_calendar_sync || false);
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

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) {
        toast.error('User not authenticated');
        return;
      }

      const newTime: UnavailableTime = {
        id: Date.now().toString(),
        date: selectedDate.toISOString().split('T')[0],
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
        .eq('user_id', user.id);

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

    const startDateTime = new Date(`${unavailableTime.date}T${unavailableTime.startTime}:00`);
    const endDateTime = new Date(`${unavailableTime.date}T${unavailableTime.endTime}:00`);

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
      if (!user?.email) {
        toast.error('User not authenticated');
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
        .eq('user_id', user.id);

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

  // Toggle Outlook sync
  const toggleOutlookSync = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) {
        toast.error('User not authenticated');
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
        .eq('user_id', user.id);

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
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-primary/10 rounded-xl">
            <CalendarIcon className="w-8 h-8 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">Calendar & Availability</h1>
            <p className="text-base-content/70">Manage your unavailable times and sync with Outlook</p>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="toggle toggle-primary"
              checked={outlookSyncEnabled}
              onChange={toggleOutlookSync}
              disabled={loading}
            />
            <span className="text-sm font-medium">Sync with Outlook</span>
          </label>
        </div>
      </div>

      {/* Calendar */}
      <div className="bg-base-100 rounded-xl shadow-lg p-6 mb-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold">
            {monthNames[currentMonth]} {currentYear}
          </h2>
          <div className="flex gap-2">
            <button
              className="btn btn-outline btn-sm"
              onClick={() => setCurrentDate(new Date(currentYear, currentMonth - 1, 1))}
            >
              Previous
            </button>
            <button
              className="btn btn-outline btn-sm"
              onClick={() => setCurrentDate(new Date())}
            >
              Today
            </button>
            <button
              className="btn btn-outline btn-sm"
              onClick={() => setCurrentDate(new Date(currentYear, currentMonth + 1, 1))}
            >
              Next
            </button>
          </div>
        </div>

        {/* Calendar Grid */}
        <div className="grid grid-cols-7 gap-1">
          {/* Day headers */}
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
            <div key={day} className="p-2 text-center font-semibold text-base-content/70">
              {day}
            </div>
          ))}
          
          {/* Calendar days */}
          {calendarDays.map((day, index) => (
            <div
              key={index}
              className={`
                p-2 min-h-[80px] border border-base-200 rounded-lg cursor-pointer transition-all duration-200
                ${day.isCurrentMonth ? 'bg-base-100 hover:bg-base-200' : 'bg-base-200/50 text-base-content/50'}
                ${day.isToday ? 'ring-2 ring-primary' : ''}
                ${day.unavailableTimes.length > 0 ? 'bg-error/10 border-error/30' : ''}
              `}
              onClick={() => {
                if (day.isCurrentMonth) {
                  setSelectedDate(day.date);
                  setShowAddModal(true);
                }
              }}
            >
              <div className="text-sm font-medium mb-1">
                {day.date.getDate()}
              </div>
              {day.unavailableTimes.length > 0 && (
                <div className="space-y-1">
                  {day.unavailableTimes.slice(0, 2).map(time => (
                    <div
                      key={time.id}
                      className="text-xs bg-error/20 text-error rounded px-1 py-0.5 truncate"
                      title={`${time.startTime}-${time.endTime}: ${time.reason}`}
                    >
                      {time.startTime}-{time.endTime}
                    </div>
                  ))}
                  {day.unavailableTimes.length > 2 && (
                    <div className="text-xs text-error/70">
                      +{day.unavailableTimes.length - 2} more
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Unavailable Times List */}
      <div className="bg-base-100 rounded-xl shadow-lg p-6">
        <h3 className="text-xl font-bold mb-4">Your Unavailable Times</h3>
        {unavailableTimes.length === 0 ? (
          <p className="text-base-content/70 text-center py-8">
            No unavailable times set. Click on a calendar day to add one.
          </p>
        ) : (
          <div className="space-y-3">
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
                  className="flex items-center justify-between p-4 bg-white rounded-lg shadow-[0_4px_6px_rgba(0,0,0,0.1),0_2px_4px_rgba(0,0,0,0.06),0_0_0_1px_rgba(0,0,0,0.05)]"
                  style={{
                    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05), 0 0 0 1px rgba(0, 0, 0, 0.05), 0 20px 25px -5px rgba(0, 0, 0, 0.1)'
                  }}
                >
                  <div className="flex items-center gap-4">
                    <div className="text-sm font-medium">
                      {new Date(time.date).toLocaleDateString()}
                    </div>
                    <div className="text-sm text-base-content/70">
                      {time.startTime} - {time.endTime}
                    </div>
                    <div className="text-sm">
                      {time.reason}
                    </div>
                    {time.outlookEventId && (
                      <div className="flex items-center gap-1 text-xs text-success">
                        <CheckIcon className="w-4 h-4" />
                        Synced
                      </div>
                    )}
                  </div>
                  <button
                    className="btn btn-ghost btn-sm text-error hover:bg-error/10"
                    onClick={() => deleteUnavailableTime(time.id)}
                    disabled={loading}
                  >
                    <TrashIcon className="w-4 h-4" />
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

      {/* Add Unavailable Time Modal */}
      {showAddModal && selectedDate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-base-100 rounded-xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">Add Unavailable Time</h3>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setShowAddModal(false)}
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
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">
                    <span className="label-text">Start Time</span>
                  </label>
                  <input
                    type="time"
                    className="input input-bordered w-full"
                    value={newUnavailableTime.startTime}
                    onChange={(e) => setNewUnavailableTime(prev => ({ ...prev, startTime: e.target.value }))}
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
                    onChange={(e) => setNewUnavailableTime(prev => ({ ...prev, endTime: e.target.value }))}
                  />
                </div>
              </div>
              
              <div>
                <label className="label">
                  <span className="label-text">Reason</span>
                </label>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  placeholder="e.g., Personal appointment, Vacation, etc."
                  value={newUnavailableTime.reason}
                  onChange={(e) => setNewUnavailableTime(prev => ({ ...prev, reason: e.target.value }))}
                />
              </div>
            </div>
            
            <div className="flex gap-3 mt-6">
              <button
                className="btn btn-primary flex-1"
                onClick={saveUnavailableTime}
                disabled={loading}
              >
                {loading ? 'Saving...' : 'Save'}
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => setShowAddModal(false)}
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
