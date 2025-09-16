import React, { useState, useEffect } from 'react';
import { XMarkIcon, CalendarIcon, ClockIcon, UserIcon, VideoCameraIcon, ArrowPathIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { createStaffTeamsMeeting, getAccessTokenWithFallback } from '../lib/graph';
import { useMsal } from '@azure/msal-react';
import { InteractionRequiredAuthError } from '@azure/msal-browser';
import { loginRequest } from '../msalConfig';
import { toast } from 'react-hot-toast';
import { saveOutlookTeamsMeeting, type OutlookTeamsMeeting } from '../lib/outlookTeamsMeetingsApi';
import { supabase } from '../lib/supabase';

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
  isRecurring: boolean;
  recurrencePattern: 'daily' | 'weekly' | 'monthly';
  recurrenceInterval: number;
  recurrenceEndDate: string;
}

// Staff calendar email
const STAFF_CALENDAR_EMAIL = 'shared-staffcalendar@lawoffice.org.il';

const TeamsMeetingModal: React.FC<TeamsMeetingModalProps> = ({
  isOpen,
  onClose,
  selectedDate,
  selectedTime
}) => {
  const { instance, accounts } = useMsal();
  const [isLoading, setIsLoading] = useState(false);
  const [employees, setEmployees] = useState<any[]>([]);
  const [filteredEmployees, setFilteredEmployees] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showEmployeeSearch, setShowEmployeeSearch] = useState(false);
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

  // Fetch employees when modal opens
  useEffect(() => {
    if (isOpen) {
      fetchEmployees();
    }
  }, [isOpen]);

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

  const fetchEmployees = async () => {
    try {
      const { data, error } = await supabase
        .from('tenants_employee')
        .select('id, display_name')
        .not('display_name', 'is', null)
        .order('display_name');
      
      if (error) {
        console.error('Error fetching employees:', error);
        toast.error('Failed to load employees');
        return;
      }
      
      setEmployees(data || []);
      setFilteredEmployees(data || []);
    } catch (error) {
      console.error('Error fetching employees:', error);
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
    const email = `${employee.display_name.toLowerCase().replace(/\s+/g, '.')}@lawoffice.org.il`;
    if (!formData.attendees.includes(email)) {
      setFormData(prev => ({
        ...prev,
        attendees: [...prev.attendees, email]
      }));
    }
  };

  const removeEmployeeFromAttendees = (email: string) => {
    setFormData(prev => ({
      ...prev,
      attendees: prev.attendees.filter(a => a !== email)
    }));
  };

  const selectAllEmployees = () => {
    const allEmails = employees.map(emp => `${emp.display_name.toLowerCase().replace(/\s+/g, '.')}@lawoffice.org.il`);
    setFormData(prev => ({
      ...prev,
      attendees: allEmails
    }));
  };

  const clearAllAttendees = () => {
    setFormData(prev => ({
      ...prev,
      attendees: []
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

      const accessToken = await getAccessTokenWithFallback(
        instance, 
        loginRequest, 
        account,
        () => toast.loading('Opening Microsoft authentication popup...', { duration: 3000 })
      );
      if (!accessToken) {
        toast.error('Failed to authenticate with Microsoft. Please try again.');
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


      const result = await createStaffTeamsMeeting(accessToken, meetingDetails);
      
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
        location: 'Teams Meeting',
        isRecurring: false,
        recurrencePattern: 'weekly',
        recurrenceInterval: 1,
        recurrenceEndDate: ''
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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white w-full h-full max-w-none max-h-none overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200" style={{ backgroundColor: '#f3f0ff' }}>
          <div className="flex items-center space-x-3">
            {/* RMQ 2.0 Text */}
            <span className="text-lg font-bold" style={{ color: '#4418C4' }}>RMQ 2.0</span>
            <div className="h-6 w-px bg-gray-300"></div>
            <div className="p-2 rounded-lg" style={{ backgroundColor: '#e6dfff' }}>
              <VideoCameraIcon className="h-6 w-6" style={{ color: '#4418C4' }} />
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
        <form onSubmit={handleSubmit} className="p-8 space-y-8 max-w-4xl mx-auto">
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
              className="w-full px-4 py-3 border border-gray-300 rounded-lg transition-colors"
              style={{ 
                '--tw-ring-color': '#4418C4',
                '--tw-border-color': '#4418C4'
              } as React.CSSProperties}
              onFocus={(e) => {
                e.target.style.borderColor = '#4418C4';
                e.target.style.boxShadow = '0 0 0 2px #4418C4';
              }}
              onBlur={(e) => {
                e.target.style.borderColor = '#d1d5db';
                e.target.style.boxShadow = 'none';
              }}
              placeholder="Enter meeting subject..."
              required
            />
          </div>

          {/* Date and Time Row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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
                className="w-full px-4 py-3 border border-gray-300 rounded-lg transition-colors"
              style={{ 
                '--tw-ring-color': '#4418C4',
                '--tw-border-color': '#4418C4'
              } as React.CSSProperties}
              onFocus={(e) => {
                e.target.style.borderColor = '#4418C4';
                e.target.style.boxShadow = '0 0 0 2px #4418C4';
              }}
              onBlur={(e) => {
                e.target.style.borderColor = '#d1d5db';
                e.target.style.boxShadow = 'none';
              }}
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
                className="w-full px-4 py-3 border border-gray-300 rounded-lg transition-colors"
              style={{ 
                '--tw-ring-color': '#4418C4',
                '--tw-border-color': '#4418C4'
              } as React.CSSProperties}
              onFocus={(e) => {
                e.target.style.borderColor = '#4418C4';
                e.target.style.boxShadow = '0 0 0 2px #4418C4';
              }}
              onBlur={(e) => {
                e.target.style.borderColor = '#d1d5db';
                e.target.style.boxShadow = 'none';
              }}
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
                className="w-full px-4 py-3 border border-gray-300 rounded-lg transition-colors"
              style={{ 
                '--tw-ring-color': '#4418C4',
                '--tw-border-color': '#4418C4'
              } as React.CSSProperties}
              onFocus={(e) => {
                e.target.style.borderColor = '#4418C4';
                e.target.style.boxShadow = '0 0 0 2px #4418C4';
              }}
              onBlur={(e) => {
                e.target.style.borderColor = '#d1d5db';
                e.target.style.boxShadow = 'none';
              }}
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
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <UserIcon className="h-4 w-4 inline mr-1" />
              Attendees
            </label>
            <div className="space-y-3">
              {/* Quick Actions */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={selectAllEmployees}
                  className="px-3 py-1 text-xs rounded-md transition-colors"
                  style={{ 
                    backgroundColor: '#e6dfff', 
                    color: '#4418C4' 
                  }}
                  onMouseEnter={(e) => {
                    e.target.style.backgroundColor = '#d1c4f0';
                  }}
                  onMouseLeave={(e) => {
                    e.target.style.backgroundColor = '#e6dfff';
                  }}
                >
                  Select All Staff
                </button>
                <button
                  type="button"
                  onClick={clearAllAttendees}
                  className="px-3 py-1 text-xs bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors"
                >
                  Clear All
                </button>
                <button
                  type="button"
                  onClick={() => setShowEmployeeSearch(!showEmployeeSearch)}
                  className="px-3 py-1 text-xs rounded-md transition-colors"
                  style={{ 
                    backgroundColor: '#e6dfff', 
                    color: '#4418C4' 
                  }}
                  onMouseEnter={(e) => {
                    e.target.style.backgroundColor = '#d1c4f0';
                  }}
                  onMouseLeave={(e) => {
                    e.target.style.backgroundColor = '#e6dfff';
                  }}
                >
                  {showEmployeeSearch ? 'Hide Search' : 'Search Staff'}
                </button>
              </div>

              {/* Employee Search */}
              {showEmployeeSearch && (
                <div className="border border-gray-300 rounded-lg p-3 bg-gray-50">
                  <div className="relative mb-3">
                    <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Search staff by name..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg transition-colors"
                      onFocus={(e) => {
                        e.target.style.borderColor = '#4418C4';
                        e.target.style.boxShadow = '0 0 0 2px #4418C4';
                      }}
                      onBlur={(e) => {
                        e.target.style.borderColor = '#d1d5db';
                        e.target.style.boxShadow = 'none';
                      }}
                    />
                  </div>
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {filteredEmployees.map((employee) => {
                      const email = `${employee.display_name.toLowerCase().replace(/\s+/g, '.')}@lawoffice.org.il`;
                      const isSelected = formData.attendees.includes(email);
                      return (
                        <div
                          key={employee.id}
                          className={`flex items-center justify-between p-2 rounded-md cursor-pointer transition-colors ${
                            isSelected ? '' : 'hover:bg-gray-100'
                          }`}
                          style={isSelected ? { 
                            backgroundColor: '#e6dfff', 
                            color: '#4418C4' 
                          } : {}}
                          onClick={() => isSelected ? removeEmployeeFromAttendees(email) : addEmployeeToAttendees(employee)}
                        >
                          <div>
                            <div className="font-medium">{employee.display_name}</div>
                            <div className="text-xs text-gray-500">{email}</div>
                          </div>
                          {isSelected && (
                            <div className="w-5 h-5 text-white rounded-full flex items-center justify-center text-xs" style={{ backgroundColor: '#4418C4' }}>
                              ✓
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Selected Attendees */}
              {formData.attendees.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-700 mb-2">Selected attendees ({formData.attendees.length}):</p>
                  <div className="flex flex-wrap gap-1">
                    {formData.attendees.map((email) => {
                      const employee = employees.find(emp => 
                        `${emp.display_name.toLowerCase().replace(/\s+/g, '.')}@lawoffice.org.il` === email
                      );
                      return (
                        <span
                          key={email}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full"
                          style={{ backgroundColor: '#e6dfff', color: '#4418C4' }}
                        >
                          {employee?.display_name || email}
                          <button
                            type="button"
                            onClick={() => removeEmployeeFromAttendees(email)}
                            style={{ color: '#4418C4' }}
                            onMouseEnter={(e) => {
                              e.target.style.color = '#2d0f8a';
                            }}
                            onMouseLeave={(e) => {
                              e.target.style.color = '#4418C4';
                            }}
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
              className="w-full px-4 py-3 border border-gray-300 rounded-lg transition-colors"
              style={{ 
                '--tw-ring-color': '#4418C4',
                '--tw-border-color': '#4418C4'
              } as React.CSSProperties}
              onFocus={(e) => {
                e.target.style.borderColor = '#4418C4';
                e.target.style.boxShadow = '0 0 0 2px #4418C4';
              }}
              onBlur={(e) => {
                e.target.style.borderColor = '#d1d5db';
                e.target.style.boxShadow = 'none';
              }}
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
              className="w-full px-4 py-3 border border-gray-300 rounded-lg transition-colors"
              style={{ 
                '--tw-ring-color': '#4418C4',
                '--tw-border-color': '#4418C4'
              } as React.CSSProperties}
              onFocus={(e) => {
                e.target.style.borderColor = '#4418C4';
                e.target.style.boxShadow = '0 0 0 2px #4418C4';
              }}
              onBlur={(e) => {
                e.target.style.borderColor = '#d1d5db';
                e.target.style.boxShadow = 'none';
              }}
              placeholder="Teams Meeting"
            />
          </div>

          {/* Recurring Meeting */}
          <div>
            <div className="flex items-center space-x-3 mb-3">
              <input
                type="checkbox"
                id="isRecurring"
                checked={formData.isRecurring}
                onChange={(e) => handleInputChange('isRecurring', e.target.checked)}
                className="h-4 w-4 border-gray-300 rounded"
                style={{ 
                  accentColor: '#4418C4',
                  color: '#4418C4'
                }}
              />
              <label htmlFor="isRecurring" className="text-sm font-medium text-gray-700">
                <ArrowPathIcon className="h-4 w-4 inline mr-1" />
                Recurring Meeting
              </label>
            </div>

            {formData.isRecurring && (
              <div className="ml-7 space-y-4 p-4 bg-gray-50 rounded-lg">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label htmlFor="recurrencePattern" className="block text-sm font-medium text-gray-700 mb-2">
                      Recurrence Pattern
                    </label>
                    <select
                      id="recurrencePattern"
                      value={formData.recurrencePattern}
                      onChange={(e) => handleInputChange('recurrencePattern', e.target.value as 'daily' | 'weekly' | 'monthly')}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg transition-colors"
              style={{ 
                '--tw-ring-color': '#4418C4',
                '--tw-border-color': '#4418C4'
              } as React.CSSProperties}
              onFocus={(e) => {
                e.target.style.borderColor = '#4418C4';
                e.target.style.boxShadow = '0 0 0 2px #4418C4';
              }}
              onBlur={(e) => {
                e.target.style.borderColor = '#d1d5db';
                e.target.style.boxShadow = 'none';
              }}
                    >
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                    </select>
                  </div>

                  <div>
                    <label htmlFor="recurrenceInterval" className="block text-sm font-medium text-gray-700 mb-2">
                      Repeat Every
                    </label>
                    <div className="flex items-center space-x-2">
                      <input
                        type="number"
                        id="recurrenceInterval"
                        min="1"
                        max="99"
                        value={formData.recurrenceInterval}
                        onChange={(e) => handleInputChange('recurrenceInterval', parseInt(e.target.value) || 1)}
                        className="w-20 px-3 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                      />
                      <span className="text-sm text-gray-600">
                        {formData.recurrencePattern === 'daily' ? 'day(s)' :
                         formData.recurrencePattern === 'weekly' ? 'week(s)' : 'month(s)'}
                      </span>
                    </div>
                  </div>
                </div>

                <div>
                  <label htmlFor="recurrenceEndDate" className="block text-sm font-medium text-gray-700 mb-2">
                    End Date (Optional)
                  </label>
                  <input
                    type="date"
                    id="recurrenceEndDate"
                    value={formData.recurrenceEndDate}
                    onChange={(e) => handleInputChange('recurrenceEndDate', e.target.value)}
                    min={formData.date}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg transition-colors"
              style={{ 
                '--tw-ring-color': '#4418C4',
                '--tw-border-color': '#4418C4'
              } as React.CSSProperties}
              onFocus={(e) => {
                e.target.style.borderColor = '#4418C4';
                e.target.style.boxShadow = '0 0 0 2px #4418C4';
              }}
              onBlur={(e) => {
                e.target.style.borderColor = '#d1d5db';
                e.target.style.boxShadow = 'none';
              }}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Leave empty for no end date
                  </p>
                </div>
              </div>
            )}
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
              className="px-6 py-3 text-white rounded-lg font-medium disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center space-x-2"
              style={{ 
                backgroundColor: isLoading || !formData.subject.trim() ? '#d1d5db' : '#4418C4' 
              }}
              onMouseEnter={(e) => {
                if (!isLoading && formData.subject.trim()) {
                  e.target.style.backgroundColor = '#2d0f8a';
                }
              }}
              onMouseLeave={(e) => {
                if (!isLoading && formData.subject.trim()) {
                  e.target.style.backgroundColor = '#4418C4';
                }
              }}
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
