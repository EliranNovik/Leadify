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
  onUpdate
}) => {
  const { instance, accounts } = useMsal();
  const [isLoading, setIsLoading] = useState(false);
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
      const { data, error } = await supabase
        .from('tenants_employee')
        .select('id, display_name')
        .not('display_name', 'is', null)
        .order('display_name');

      if (error) throw error;
      
      // Process the data to construct email addresses like TeamsMeetingModal does
      const processedEmployees = (data || []).map(emp => ({
        id: emp.id,
        display_name: emp.display_name,
        email: `${emp.display_name.toLowerCase().replace(/\s+/g, '.')}@lawoffice.org.il`
      }));
      
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
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="btn btn-ghost"
              disabled={isLoading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={isLoading}
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
        </form>
      </div>
    </div>
  );
};

export default StaffMeetingEditModal;
