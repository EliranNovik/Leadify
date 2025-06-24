import React, { useEffect, useState } from 'react';
import { Calendar, momentLocalizer, Views } from 'react-big-calendar';
import { useMsal } from '@azure/msal-react';
import moment from 'moment';
import { PlusIcon, TrashIcon, PencilIcon, CheckIcon, XMarkIcon, ClockIcon, UserIcon, MapPinIcon, VideoCameraIcon, CalendarIcon } from '@heroicons/react/24/outline';
import 'react-big-calendar/lib/css/react-big-calendar.css';

const localizer = momentLocalizer(moment);

interface SharedMailbox {
  id: string;
  email: string;
  color: string;
  label: string;
}

interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  resource: any;
  color: string;
  group: string;
  mailbox: string;
  location?: string;
  attendees?: any[];
  description?: string;
}

const DEFAULT_MAILBOXES: SharedMailbox[] = [
  { id: '1', email: 'shared-staffcalendar@lawoffice.org.il', color: '#6366f1', label: 'Staff' },
  { id: '2', email: 'shared-newclients@lawoffice.org.il', color: '#10b981', label: 'New Clients' },
  { id: '3', email: 'shared-potentialclients@lawoffice.org.il', color: '#f59e42', label: 'Potential Clients' },
];

const OutlookCalendarPage: React.FC = () => {
  const { instance, accounts } = useMsal();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [sharedMailboxes, setSharedMailboxes] = useState<SharedMailbox[]>(DEFAULT_MAILBOXES);
  const [showAddMailbox, setShowAddMailbox] = useState(false);
  const [newMailbox, setNewMailbox] = useState({ email: '', label: '', color: '#6366f1' });
  const [editingMailbox, setEditingMailbox] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [showEventModal, setShowEventModal] = useState(false);
  const [view, setView] = useState(Views.MONTH);

  // Load saved mailboxes from localStorage on component mount
  useEffect(() => {
    const savedMailboxes = localStorage.getItem('outlook-shared-mailboxes');
    if (savedMailboxes) {
      try {
        setSharedMailboxes(JSON.parse(savedMailboxes));
      } catch (error) {
        console.error('Error loading saved mailboxes:', error);
      }
    }
  }, []);

  // Save mailboxes to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('outlook-shared-mailboxes', JSON.stringify(sharedMailboxes));
  }, [sharedMailboxes]);

  useEffect(() => {
    const fetchEvents = async () => {
      if (!accounts[0] || sharedMailboxes.length === 0) return;
      
      setLoading(true);
      try {
        const account = accounts[0];
        const tokenResponse = await instance.acquireTokenSilent({
          scopes: [
            'Calendars.Read',
            'Calendars.Read.Shared',
            'Calendars.ReadWrite',
            'Calendars.ReadWrite.Shared'
          ],
          account,
        });
        console.log('Access token acquired for calendar events');

        // Fetch events for each shared mailbox using /users/{email}/calendar/events
        let allEvents: CalendarEvent[] = [];
        for (const mailbox of sharedMailboxes) {
          try {
            console.log(`Fetching events for mailbox: ${mailbox.email}`);
            const res = await fetch(
              `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox.email)}/calendar/events?$top=100&$orderby=start/dateTime&$select=id,subject,start,end,isAllDay,location,attendees,body,organizer`,
              { 
                headers: { 
                  Authorization: `Bearer ${tokenResponse.accessToken}`,
                  'Content-Type': 'application/json'
                } 
              }
            );
            
            if (!res.ok) {
              const errorText = await res.text();
              console.error(`Error fetching events for ${mailbox.email}:`, errorText);
              continue; // Skip this mailbox and continue with others
            }
            
            const data = await res.json();
            console.log(`Events fetched for ${mailbox.email}:`, data.value?.length || 0, 'events');
            
            if (data.value) {
              const mailboxEvents: CalendarEvent[] = data.value.map((event: any) => ({
                id: event.id,
                title: event.subject || 'No Subject',
                start: new Date(event.start.dateTime || event.start.date),
                end: new Date(event.end.dateTime || event.end.date),
                allDay: event.isAllDay || false,
                resource: event,
                color: mailbox.color,
                group: mailbox.label,
                mailbox: mailbox.email,
                location: event.location?.displayName,
                attendees: event.attendees,
                description: event.body?.content,
              }));
              allEvents = allEvents.concat(mailboxEvents);
            }
          } catch (error) {
            console.error(`Error processing mailbox ${mailbox.email}:`, error);
          }
        }
        
        setEvents(allEvents);
        console.log(`Total events loaded: ${allEvents.length}`);
      } catch (err) {
        console.error('Error fetching calendar events:', err);
      }
      setLoading(false);
    };
    
    fetchEvents();
  }, [instance, accounts, sharedMailboxes]);

  const handleAddMailbox = () => {
    if (newMailbox.email && newMailbox.label) {
      const mailbox: SharedMailbox = {
        id: Date.now().toString(),
        email: newMailbox.email.trim(),
        label: newMailbox.label.trim(),
        color: newMailbox.color,
      };
      setSharedMailboxes([...sharedMailboxes, mailbox]);
      setNewMailbox({ email: '', label: '', color: '#6366f1' });
      setShowAddMailbox(false);
    }
  };

  const handleDeleteMailbox = (id: string) => {
    setSharedMailboxes(sharedMailboxes.filter(m => m.id !== id));
  };

  const handleEditMailbox = (mailbox: SharedMailbox) => {
    setEditingMailbox(mailbox.id);
    setNewMailbox({ email: mailbox.email, label: mailbox.label, color: mailbox.color });
  };

  const handleSaveEdit = () => {
    if (editingMailbox && newMailbox.email && newMailbox.label) {
      setSharedMailboxes(sharedMailboxes.map(m => 
        m.id === editingMailbox 
          ? { ...m, email: newMailbox.email.trim(), label: newMailbox.label.trim(), color: newMailbox.color }
          : m
      ));
      setNewMailbox({ email: '', label: '', color: '#6366f1' });
      setEditingMailbox(null);
    }
  };

  const handleCancelEdit = () => {
    setNewMailbox({ email: '', label: '', color: '#6366f1' });
    setEditingMailbox(null);
  };

  const handleEventClick = (event: CalendarEvent) => {
    setSelectedEvent(event);
    setShowEventModal(true);
  };

  const closeEventModal = () => {
    setShowEventModal(false);
    setSelectedEvent(null);
  };

  // Custom event style getter for color-coding
  const eventStyleGetter = (event: CalendarEvent) => {
    return {
      style: {
        backgroundColor: event.color,
        borderRadius: '6px',
        color: 'white',
        border: 'none',
        display: 'block',
        fontSize: '12px',
        padding: '2px 4px',
        cursor: 'pointer',
        fontWeight: '500',
      },
    };
  };

  // Custom event component for month view to show time
  const MonthEventComponent = ({ event }: { event: CalendarEvent }) => {
    const formatTime = (date: Date) => moment(date).format('HH:mm');
    const isAllDay = event.allDay;
    const timeText = isAllDay ? 'All Day' : `${formatTime(event.start)} - ${formatTime(event.end)}`;
    return (
      <div 
        className="event-item cursor-pointer hover:opacity-80 transition-opacity"
        onClick={() => handleEventClick(event)}
        title={`${event.title} (${event.group})`}
      >
        <div className="font-medium text-xs mb-1">{event.title}</div>
        <div className="text-xs opacity-90 flex items-center gap-1">
          <ClockIcon className="w-3 h-3" />
          {timeText}
        </div>
        {event.location && (
          <div className="text-xs opacity-90 flex items-center gap-1 mt-1">
            <MapPinIcon className="w-3 h-3" />
            {event.location}
          </div>
        )}
      </div>
    );
  };

  // Custom event component for week/day/agenda views: just the title
  const TitleOnlyEventComponent = ({ event }: { event: CalendarEvent }) => (
    <div
      className="event-item cursor-pointer hover:opacity-80 transition-opacity"
      onClick={() => handleEventClick(event)}
      title={`${event.title} (${event.group})`}
    >
      <span className="font-medium text-xs">{event.title}</span>
    </div>
  );

  // Custom event component for agenda view: modern card style
  const AgendaEventComponent = ({ event }: { event: CalendarEvent }) => {
    const teamsLink = event.resource?.onlineMeeting?.joinUrl || event.resource?.teamsMeetingUrl;
    return (
      <div className="bg-base-100 rounded-lg shadow p-4 mb-4 flex flex-col md:flex-row md:items-center gap-4 border border-base-200">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <CalendarIcon className="w-5 h-5 text-primary" />
            <span className="font-bold text-lg text-black" style={{ color: '#222' }}>{event.title}</span>
            <span
              className="ml-2 px-2 py-1 rounded text-xs font-semibold border"
              style={{ background: '#fff', borderColor: event.color, color: '#222' }}
            >
              {event.group}
            </span>
          </div>
          <div className="flex flex-wrap gap-4 text-sm text-base-content/80 mb-2">
            <div className="flex items-center gap-1">
              <span className="font-semibold text-black" style={{ color: '#222' }}>When:</span>
              <span className="text-black" style={{ color: '#222' }}>
                {event.allDay
                  ? 'All Day'
                  : `${moment(event.start).format('MMM D, YYYY h:mm A')} - ${moment(event.end).format('h:mm A')}`}
              </span>
            </div>
            {event.location && (
              <div className="flex items-center gap-1">
                <MapPinIcon className="w-4 h-4" />
                <span>{event.location}</span>
              </div>
            )}
            <div className="flex items-center gap-1">
              <span className="font-semibold">Mailbox:</span>
              <span>{event.mailbox}</span>
            </div>
          </div>
          {event.attendees && event.attendees.length > 0 && (
            <div className="flex items-center gap-2 mb-2">
              <UserIcon className="w-4 h-4" />
              <span className="font-semibold">Attendees:</span>
              <span>{event.attendees.map((a: any) => a.emailAddress?.name || a.emailAddress?.address).join(', ')}</span>
            </div>
          )}
        </div>
        {teamsLink && (
          <a
            href={teamsLink}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary flex items-center gap-2 self-start md:self-center"
          >
            <VideoCameraIcon className="w-5 h-5" />
            Join Meeting
          </a>
        )}
      </div>
    );
  };

  // Custom toolbar with view switcher
  const CustomToolbar = (toolbar: any) => {
    const goToToday = () => {
      toolbar.onNavigate('TODAY');
    };

    const goToPrev = () => {
      toolbar.onNavigate('PREV');
    };

    const goToNext = () => {
      toolbar.onNavigate('NEXT');
    };

    const viewNames = {
      [Views.MONTH]: 'Month',
      [Views.WEEK]: 'Week',
      [Views.DAY]: 'Day',
      [Views.AGENDA]: 'Agenda',
    };

    return (
      <div className="flex justify-between items-center mb-4 p-4 bg-base-200 rounded-lg">
        <div className="flex items-center gap-2">
          <button className="btn btn-sm btn-outline" onClick={goToToday}>
            Today
          </button>
          <div className="flex gap-1">
            <button className="btn btn-sm btn-outline" onClick={goToPrev}>
              ‹
            </button>
            <button className="btn btn-sm btn-outline" onClick={goToNext}>
              ›
            </button>
          </div>
          <h2 className="text-lg font-semibold ml-4">
            {toolbar.label}
          </h2>
        </div>
        
        <div className="flex gap-1">
          {Object.entries(viewNames).map(([viewKey, viewName]) => (
            <button
              key={viewKey}
              className={`btn btn-sm ${toolbar.view === viewKey ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => toolbar.onView(viewKey)}
            >
              {viewName}
            </button>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Outlook Calendar</h1>
        <button 
          className="btn btn-primary btn-sm gap-2"
          onClick={() => setShowAddMailbox(true)}
        >
          <PlusIcon className="w-4 h-4" />
          Add Mailbox
        </button>
      </div>

      {/* Shared Mailboxes Management */}
      <div className="bg-base-100 rounded-lg shadow-lg p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4">Shared Mailboxes</h2>
        
        {/* Add/Edit Mailbox Form */}
        {(showAddMailbox || editingMailbox) && (
          <div className="bg-base-200 rounded-lg p-4 mb-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
              <div>
                <label className="label">
                  <span className="label-text">Email Address</span>
                </label>
                <input
                  type="email"
                  className="input input-bordered w-full"
                  placeholder="shared-calendar@domain.com"
                  value={newMailbox.email}
                  onChange={(e) => setNewMailbox({ ...newMailbox, email: e.target.value })}
                />
              </div>
              <div>
                <label className="label">
                  <span className="label-text">Display Name</span>
                </label>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  placeholder="Calendar Name"
                  value={newMailbox.label}
                  onChange={(e) => setNewMailbox({ ...newMailbox, label: e.target.value })}
                />
              </div>
              <div>
                <label className="label">
                  <span className="label-text">Color</span>
                </label>
                <input
                  type="color"
                  className="input input-bordered w-full h-12"
                  value={newMailbox.color}
                  onChange={(e) => setNewMailbox({ ...newMailbox, color: e.target.value })}
                />
              </div>
              <div className="flex gap-2">
                <button 
                  className="btn btn-success btn-sm gap-2"
                  onClick={editingMailbox ? handleSaveEdit : handleAddMailbox}
                >
                  <CheckIcon className="w-4 h-4" />
                  {editingMailbox ? 'Save' : 'Add'}
                </button>
                <button 
                  className="btn btn-ghost btn-sm gap-2"
                  onClick={editingMailbox ? handleCancelEdit : () => setShowAddMailbox(false)}
                >
                  <XMarkIcon className="w-4 h-4" />
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Mailboxes List */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sharedMailboxes.map((mailbox) => (
            <div 
              key={mailbox.id}
              className="flex items-center justify-between p-3 bg-base-200 rounded-lg"
            >
              <div className="flex items-center gap-3">
                <span 
                  style={{ background: mailbox.color, width: 16, height: 16, borderRadius: 4, display: 'inline-block' }}
                />
                <div>
                  <div className="font-medium">{mailbox.label}</div>
                  <div className="text-sm text-base-content/70">{mailbox.email}</div>
                </div>
              </div>
              <div className="flex gap-1">
                <button 
                  className="btn btn-ghost btn-xs"
                  onClick={() => handleEditMailbox(mailbox)}
                >
                  <PencilIcon className="w-3 h-3" />
                </button>
                <button 
                  className="btn btn-ghost btn-xs text-error"
                  onClick={() => handleDeleteMailbox(mailbox.id)}
                >
                  <TrashIcon className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Calendar */}
      <div className="bg-base-100 rounded-lg shadow-lg p-8">
        <div className="mb-4 flex flex-wrap gap-4">
          {sharedMailboxes.map(mailbox => (
            <span key={mailbox.id} className="inline-flex items-center gap-2 text-sm">
              <span 
                style={{ background: mailbox.color, width: 16, height: 16, borderRadius: 4, display: 'inline-block' }}
              />
              {mailbox.label}
            </span>
          ))}
        </div>
        
        {loading ? (
          <div className="flex items-center justify-center h-96">
            <span className="loading loading-spinner loading-lg"></span>
            <span className="ml-3">Loading calendar events...</span>
          </div>
        ) : (
          <Calendar
            localizer={localizer}
            events={events}
            startAccessor="start"
            endAccessor="end"
            style={{ height: 700 }}
            eventPropGetter={eventStyleGetter}
            onSelectEvent={handleEventClick}
            components={{
              toolbar: CustomToolbar,
              month: { event: MonthEventComponent },
              week: { event: TitleOnlyEventComponent },
              day: { event: TitleOnlyEventComponent },
              agenda: { event: AgendaEventComponent },
            }}
            views={['month', 'week', 'day', 'agenda']}
            defaultView={Views.MONTH}
            step={60}
            timeslots={1}
            selectable
            popup
            tooltipAccessor={(event) => `${event.title} (${event.group})`}
          />
        )}
      </div>

      {/* Event Details Modal */}
      {showEventModal && selectedEvent && (
        <div className="modal modal-open">
          <div className="modal-box max-w-2xl">
            <div className="flex justify-between items-start mb-4">
              <h3 className="font-bold text-lg">{selectedEvent.title}</h3>
              <button 
                className="btn btn-sm btn-circle btn-ghost"
                onClick={closeEventModal}
              >
                ✕
              </button>
            </div>
            
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <span 
                  style={{ background: selectedEvent.color, width: 16, height: 16, borderRadius: 4, display: 'inline-block' }}
                />
                <span className="text-sm font-medium">{selectedEvent.group}</span>
              </div>
              
              <div className="flex items-center gap-2">
                <ClockIcon className="w-5 h-5 text-base-content/70" />
                <div>
                  <div className="font-medium">
                    {selectedEvent.allDay ? 'All Day' : 
                      `${moment(selectedEvent.start).format('MMM D, YYYY h:mm A')} - ${moment(selectedEvent.end).format('h:mm A')}`
                    }
                  </div>
                  <div className="text-sm text-base-content/70">
                    {selectedEvent.mailbox}
                  </div>
                </div>
              </div>
              
              {selectedEvent.location && (
                <div className="flex items-center gap-2">
                  <MapPinIcon className="w-5 h-5 text-base-content/70" />
                  <span>{selectedEvent.location}</span>
                </div>
              )}
              
              {selectedEvent.attendees && selectedEvent.attendees.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <UserIcon className="w-5 h-5 text-base-content/70" />
                    <span className="font-medium">Attendees</span>
                  </div>
                  <div className="space-y-1">
                    {selectedEvent.attendees.map((attendee: any, index: number) => (
                      <div key={index} className="text-sm text-base-content/80">
                        {attendee.emailAddress?.name || attendee.emailAddress?.address}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              {selectedEvent.description && (
                <div>
                  <div className="font-medium mb-2">Description</div>
                  <div 
                    className="text-sm text-base-content/80 prose prose-sm max-w-none"
                    dangerouslySetInnerHTML={{ __html: selectedEvent.description }}
                  />
                </div>
              )}
            </div>
            
            <div className="modal-action">
              <button className="btn" onClick={closeEventModal}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OutlookCalendarPage; 