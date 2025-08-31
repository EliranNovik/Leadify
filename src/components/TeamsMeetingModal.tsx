import React, { useState, useEffect } from 'react';
import { XMarkIcon, CalendarIcon, ClockIcon, UserIcon, VideoCameraIcon } from '@heroicons/react/24/outline';
import { createStaffTeamsMeeting } from '../lib/graph';
import { useMsal } from '@azure/msal-react';
import { InteractionRequiredAuthError } from '@azure/msal-browser';
import { loginRequest } from '../msalConfig';
import { toast } from 'react-hot-toast';
import { saveOutlookTeamsMeeting, type OutlookTeamsMeeting } from '../lib/outlookTeamsMeetingsApi';

interface TeamsMeetingModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedDate?: Date;
  selectedTime?: string;
}

interface MeetingFormData {
  subject: string;
  date: string;
  time: string;
  duration: string;
  attendees: string[];
  description: string;
  location: string;
}

// Shared calendar group emails
const SHARED_CALENDAR_EMAILS = [
  { email: 'shared-staffcalendar@lawoffice.org.il', name: 'Staff Calendar' },
  { email: 'shared-newclients@lawoffice.org.il', name: 'New Clients Calendar' },
  { email: 'shared-potentialclients@lawoffice.org.il', name: 'Potential Clients Calendar' },
  // Add more staff emails as needed
  { email: 'eliran@lawoffice.org.il', name: 'Eliran Novik' },
  { email: 'admin@lawoffice.org.il', name: 'Admin' },
];

const TeamsMeetingModal: React.FC<TeamsMeetingModalProps> = ({
  isOpen,
  onClose,
  selectedDate,
  selectedTime
}) => {
  const { instance, accounts } = useMsal();
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState<MeetingFormData>({
    subject: '',
    date: selectedDate ? selectedDate.toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
    time: selectedTime || '09:00',
    duration: '60',
    attendees: [],
    description: '',
    location: 'Teams Meeting'
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

  const handleInputChange = (field: keyof MeetingFormData, value: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.subject.trim()) {
      toast.error('Please enter a meeting subject');
      return;
    }

    setIsLoading(true);
    
    try {
      const account = accounts[0];
      if (!account) {
        toast.error('You must be signed in to create Teams meetings');
        return;
      }

      let accessToken;
      try {
        const response = await instance.acquireTokenSilent({
          ...loginRequest,
          account,
        });
        accessToken = response.accessToken;
      } catch (error) {
        if (error instanceof InteractionRequiredAuthError) {
          // If silent acquisition fails, prompt the user to log in
          const response = await instance.loginPopup(loginRequest);
          accessToken = response.accessToken;
        } else {
          console.error('Error acquiring token:', error);
          toast.error('Failed to get access token');
          return;
        }
      }

      // Calculate start and end times
      const startDateTime = new Date(`${formData.date}T${formData.time}`);
      const endDateTime = new Date(startDateTime.getTime() + parseInt(formData.duration) * 60000);

      const meetingDetails = {
        subject: formData.subject,
        startDateTime: startDateTime.toISOString(),
        endDateTime: endDateTime.toISOString(),
        attendees: formData.attendees.map(email => ({ email }))
      };

      const result = await createStaffTeamsMeeting(accessToken, meetingDetails);
      
      // Save meeting data to database
      const meetingData: OutlookTeamsMeeting = {
        teams_meeting_id: result.id,
        subject: formData.subject,
        start_date_time: startDateTime.toISOString(),
        end_date_time: endDateTime.toISOString(),
        teams_join_url: result.joinUrl,
        teams_meeting_url: result.onlineMeeting?.joinUrl || result.joinUrl,
        calendar_id: 'shared-staffcalendar@lawoffice.org.il',
        attendees: formData.attendees,
        description: formData.description,
        location: formData.location,
        created_by: account.username,
        is_online_meeting: true,
        online_meeting_provider: 'teamsForBusiness'
      };

      const { error: saveError } = await saveOutlookTeamsMeeting(meetingData);
      
      if (saveError) {
        console.error('Error saving meeting to database:', saveError);
        toast.error('Meeting created in Teams but failed to save to database');
      } else {
        toast.success('Teams meeting created successfully and saved to database!');
      }
      
      console.log('Meeting created:', result);
      console.log('Meeting saved to database:', meetingData);
      
      // Reset form and close modal
      setFormData({
        subject: '',
        date: new Date().toISOString().split('T')[0],
        time: '09:00',
        duration: '60',
        attendees: [],
        description: '',
        location: 'Teams Meeting'
      });
      onClose();
      
    } catch (error) {
      console.error('Error creating Teams meeting:', error);
      if (error instanceof Error) {
        toast.error(`Failed to create Teams meeting: ${error.message}`);
      } else {
        toast.error('Failed to create Teams meeting');
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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <VideoCameraIcon className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Create Teams Meeting</h2>
              <p className="text-sm text-gray-500">Schedule a meeting in Staff Calendar</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <XMarkIcon className="h-6 w-6 text-gray-400" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Subject */}
          <div>
            <label htmlFor="subject" className="block text-sm font-medium text-gray-700 mb-2">
              Meeting Subject *
            </label>
            <input
              type="text"
              id="subject"
              value={formData.subject}
              onChange={(e) => handleInputChange('subject', e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
              placeholder="Enter meeting subject..."
              required
            />
          </div>

          {/* Date and Time Row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Date */}
            <div>
              <label htmlFor="date" className="block text-sm font-medium text-gray-700 mb-2">
                <CalendarIcon className="h-4 w-4 inline mr-1" />
                Date
              </label>
              <input
                type="date"
                id="date"
                value={formData.date}
                onChange={(e) => handleInputChange('date', e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                required
              />
            </div>

            {/* Time */}
            <div>
              <label htmlFor="time" className="block text-sm font-medium text-gray-700 mb-2">
                <ClockIcon className="h-4 w-4 inline mr-1" />
                Start Time
              </label>
              <input
                type="time"
                id="time"
                value={formData.time}
                onChange={(e) => handleInputChange('time', e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                required
              />
            </div>

            {/* Duration */}
            <div>
              <label htmlFor="duration" className="block text-sm font-medium text-gray-700 mb-2">
                Duration
              </label>
              <select
                id="duration"
                value={formData.duration}
                onChange={(e) => handleInputChange('duration', e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
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
          <div>
            <label htmlFor="attendees" className="block text-sm font-medium text-gray-700 mb-2">
              <UserIcon className="h-4 w-4 inline mr-1" />
              Attendees
            </label>
            <div className="space-y-2">
              <select
                id="attendees"
                multiple
                value={formData.attendees}
                onChange={(e) => {
                  const selectedOptions = Array.from(e.target.selectedOptions, option => option.value);
                  setFormData(prev => ({
                    ...prev,
                    attendees: selectedOptions
                  }));
                }}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors min-h-[120px]"
              >
                {SHARED_CALENDAR_EMAILS.map((contact) => (
                  <option key={contact.email} value={contact.email}>
                    {contact.name} ({contact.email})
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500">
                Hold Ctrl/Cmd to select multiple attendees
              </p>
              {formData.attendees.length > 0 && (
                <div className="mt-2">
                  <p className="text-xs font-medium text-gray-700 mb-1">Selected attendees:</p>
                  <div className="flex flex-wrap gap-1">
                    {formData.attendees.map((email) => {
                      const contact = SHARED_CALENDAR_EMAILS.find(c => c.email === email);
                      return (
                        <span
                          key={email}
                          className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full"
                        >
                          {contact?.name || email}
                          <button
                            type="button"
                            onClick={() => {
                              setFormData(prev => ({
                                ...prev,
                                attendees: prev.attendees.filter(a => a !== email)
                              }));
                            }}
                            className="text-blue-600 hover:text-blue-800"
                          >
                            ×
                          </button>
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Description */}
          <div>
            <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-2">
              Description
            </label>
            <textarea
              id="description"
              value={formData.description}
              onChange={(e) => handleInputChange('description', e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
              placeholder="Enter meeting description..."
              rows={4}
            />
          </div>

          {/* Location */}
          <div>
            <label htmlFor="location" className="block text-sm font-medium text-gray-700 mb-2">
              Location
            </label>
            <input
              type="text"
              id="location"
              value={formData.location}
              onChange={(e) => handleInputChange('location', e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
              placeholder="Teams Meeting"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end space-x-3 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-3 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium transition-colors"
              disabled={isLoading}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading || !formData.subject.trim()}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center space-x-2"
            >
              {isLoading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  <span>Creating...</span>
                </>
              ) : (
                <>
                  <VideoCameraIcon className="h-4 w-4" />
                  <span>Create Meeting</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default TeamsMeetingModal;
