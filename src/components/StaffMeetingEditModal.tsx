import React, { useState, useEffect } from 'react';
import { XMarkIcon, CalendarIcon, ClockIcon, UserGroupIcon, PencilIcon } from '@heroicons/react/24/outline';
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
  id: string;
  display_name: string;
  email: string;
}

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
  const [formData, setFormData] = useState({
    subject: '',
    date: '',
    time: '',
    duration: '60',
    attendees: [] as string[],
    description: '',
    location: 'Teams Meeting'
  });

  // Fetch employees and meeting data when modal opens
  useEffect(() => {
    if (isOpen) {
      console.log('Modal opened with meeting data:', meeting);
      fetchEmployees();
      fetchMeetingData();
    }
  }, [isOpen, meeting]);

  const fetchMeetingData = async () => {
    if (!meeting?.teams_meeting_id) {
      // If no teams_meeting_id, use calendar data directly
      if (meeting) {
        console.log('Using calendar data directly:', meeting);
        console.log('Meeting attendees from calendar:', meeting.attendees);
        setFormData({
          subject: meeting.lead?.name || meeting.subject || '',
          date: meeting.meeting_date || '',
          time: meeting.meeting_time || '',
          duration: '60',
          attendees: meeting.attendees || [],
          description: meeting.description || '',
          location: meeting.meeting_location || 'Teams Meeting'
        });
      }
      return;
    }
    
    try {
      const { data, error } = await supabase
        .from('outlook_teams_meetings')
        .select('*')
        .eq('teams_meeting_id', meeting.teams_meeting_id)
        .maybeSingle(); // Use maybeSingle instead of single to handle no results

      if (error) throw error;
      
      if (data) {
        // Parse the start_date_time to get date and time
        const startDate = new Date(data.start_date_time);
        const date = startDate.toISOString().split('T')[0];
        const time = startDate.toTimeString().slice(0, 5);
        
        // Process attendees - handle both array of strings and array of objects
        let processedAttendees: string[] = [];
        if (data.attendees && Array.isArray(data.attendees)) {
          processedAttendees = data.attendees.map((attendee: any) => {
            // If attendee is an object with email property, extract the email
            if (typeof attendee === 'object' && attendee.email) {
              return attendee.email;
            }
            // If attendee is already a string, use it directly
            return attendee;
          });
        }
        
        console.log('Fetched meeting data:', data);
        console.log('Processed attendees:', processedAttendees);
        
        setFormData({
          subject: data.subject || '',
          date: date,
          time: time,
          duration: '60', // Default duration
          attendees: processedAttendees,
          description: data.description || '',
          location: data.location || 'Teams Meeting'
        });
      } else {
        // No data found in database, use calendar data
        if (meeting) {
          setFormData({
            subject: meeting.lead?.name || meeting.subject || '',
            date: meeting.meeting_date || '',
            time: meeting.meeting_time || '',
            duration: '60',
            attendees: meeting.attendees || [],
            description: meeting.description || '',
            location: meeting.meeting_location || 'Teams Meeting'
          });
        }
      }
    } catch (error) {
      console.error('Error fetching meeting data:', error);
      // Fallback to meeting data passed from calendar
      if (meeting) {
        setFormData({
          subject: meeting.lead?.name || meeting.subject || '',
          date: meeting.meeting_date || '',
          time: meeting.meeting_time || '',
          duration: '60',
          attendees: meeting.attendees || [],
          description: meeting.description || '',
          location: meeting.meeting_location || 'Teams Meeting'
        });
      }
    }
  };

  const fetchEmployees = async () => {
    try {
      console.log('🔍 Fetching employees for edit modal...');
      
      // Fetch employees and users separately for better reliability
      const { data: employeesData, error: employeesError } = await supabase
        .from('tenants_employee')
        .select('id, display_name')
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
          id: emp.id,
          display_name: emp.display_name,
          email: emailMap.get(emp.id)
        })) || [];
      
      console.log('🔍 Edit modal - Processed employees:', processedEmployees.length);
      
      setEmployees(processedEmployees);
    } catch (error) {
      console.error('Error fetching employees:', error);
      toast.error('Failed to fetch employees');
    }
  };

  const filteredEmployees = employees.filter(emp => 
    emp.display_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    emp.email?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleAddAttendee = (employee: Employee) => {
    if (!formData.attendees.includes(employee.email)) {
      setFormData(prev => ({
        ...prev,
        attendees: [...prev.attendees, employee.email]
      }));
    }
    setSearchTerm('');
    setShowEmployeeSearch(false);
  };

  const handleRemoveAttendee = (email: string) => {
    setFormData(prev => ({
      ...prev,
      attendees: prev.attendees.filter(att => att !== email)
    }));
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

      // Update the meeting in Outlook/Teams
      await updateOutlookMeeting(tokenResponse.accessToken, meeting.teams_meeting_id, {
        subject: formData.subject,
        startDateTime: new Date(`${formData.date}T${formData.time}`).toISOString(),
        endDateTime: new Date(`${formData.date}T${formData.time}`).toISOString(),
        attendees: formData.attendees.map(email => ({ email })),
        description: formData.description,
        location: formData.location
      });

      // Update the meeting in our database
      const { error: updateError } = await supabase
        .from('outlook_teams_meetings')
        .update({
          subject: formData.subject,
          start_date_time: new Date(`${formData.date}T${formData.time}`).toISOString(),
          end_date_time: new Date(`${formData.date}T${formData.time}`).toISOString(),
          attendees: formData.attendees,
          description: formData.description,
          location: formData.location,
          updated_at: new Date().toISOString()
        })
        .eq('teams_meeting_id', meeting.teams_meeting_id);

      if (updateError) throw updateError;

      toast.success('Staff meeting updated successfully!');
      onUpdate();
      onClose();
    } catch (error) {
      console.error('Error updating staff meeting:', error);
      toast.error('Failed to update staff meeting');
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

      // Delete from database
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

      toast.success('Staff meeting deleted successfully!');
      if (onDelete) onDelete();
      onClose();
    } catch (error) {
      console.error('Error deleting staff meeting:', error);
      toast.error('Failed to delete staff meeting');
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
        attendees: meetingDetails.attendees.map((att: any) => ({
          emailAddress: { address: att.email }
        })),
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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center">
              <PencilIcon className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">Edit Staff Meeting</h2>
              <p className="text-sm text-gray-500">Update meeting details and attendees</p>
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

          {/* Attendees */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <UserGroupIcon className="w-4 h-4 inline mr-1" />
              Attendees
            </label>
            
            {/* Current attendees */}
            {formData.attendees.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {formData.attendees.map((email) => {
                  const employee = employees.find(emp => emp.email === email);
                  return (
                    <div key={email} className="badge badge-primary gap-2">
                      {employee?.display_name || email}
                      <button
                        type="button"
                        onClick={() => handleRemoveAttendee(email)}
                        className="btn btn-ghost btn-xs"
                      >
                        <XMarkIcon className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Add attendee */}
            <div className="relative">
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setShowEmployeeSearch(true);
                }}
                onFocus={() => setShowEmployeeSearch(true)}
                className="input input-bordered w-full"
                placeholder="Search and add attendees..."
              />
              
              {/* Employee dropdown */}
              {showEmployeeSearch && searchTerm && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                  {filteredEmployees.map((employee) => (
                    <div
                      key={employee.id}
                      onClick={() => handleAddAttendee(employee)}
                      className="px-4 py-2 hover:bg-gray-100 cursor-pointer flex items-center justify-between"
                    >
                      <div>
                        <div className="font-medium">{employee.display_name}</div>
                        <div className="text-sm text-gray-500">{employee.email}</div>
                      </div>
                      {formData.attendees.includes(employee.email) && (
                        <span className="text-xs text-green-600">Added</span>
                      )}
                    </div>
                  ))}
                  {filteredEmployees.length === 0 && (
                    <div className="px-4 py-2 text-gray-500">No employees found</div>
                  )}
                </div>
              )}
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
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
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
