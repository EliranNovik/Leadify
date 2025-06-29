import React, { useEffect, useState } from 'react';
import { Calendar, momentLocalizer, Views } from 'react-big-calendar';
import { useMsal } from '@azure/msal-react';
import moment from 'moment';
import { PlusIcon, TrashIcon, PencilIcon, CheckIcon, XMarkIcon, ClockIcon, UserIcon, MapPinIcon, VideoCameraIcon, CalendarIcon, FunnelIcon, ChevronDownIcon, DocumentArrowUpIcon, FolderIcon, ChevronLeftIcon, ChevronRightIcon, CurrencyDollarIcon } from '@heroicons/react/24/outline';
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
  const sharedMailboxes = DEFAULT_MAILBOXES;
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [showEventModal, setShowEventModal] = useState(false);
  const [view, setView] = useState(Views.MONTH);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [selectedMailbox, setSelectedMailbox] = useState('');
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [isDocumentModalOpen, setIsDocumentModalOpen] = useState(false);
  const [totalAmount, setTotalAmount] = useState(0);
  const [viewMode, setViewMode] = useState<'list' | 'month'>('list');
  const [monthModalDay, setMonthModalDay] = useState<Date | null>(null);
  const [monthModalEvents, setMonthModalEvents] = useState<CalendarEvent[]>([]);

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

  // Date navigation
  const goToPreviousDay = () => {
    const currentDate = new Date(selectedDate);
    currentDate.setDate(currentDate.getDate() - 1);
    setSelectedDate(currentDate.toISOString().split('T')[0]);
  };
  const goToNextDay = () => {
    const currentDate = new Date(selectedDate);
    currentDate.setDate(currentDate.getDate() + 1);
    setSelectedDate(currentDate.toISOString().split('T')[0]);
  };
  const goToToday = () => {
    setSelectedDate(new Date().toISOString().split('T')[0]);
  };

  // Filter events by date and mailbox
  const filteredEvents = events.filter(ev => {
    const eventDate = ev.start.toISOString().split('T')[0];
    const dateMatch = eventDate === selectedDate;
    const mailboxMatch = selectedMailbox ? ev.mailbox === selectedMailbox : true;
    return dateMatch && mailboxMatch;
  });

  useEffect(() => {
    // Calculate total amount (mock: use event.resource.amount or 0)
    const total = filteredEvents.reduce((acc, ev) => acc + (ev.resource?.amount || 0), 0);
    setTotalAmount(total);
  }, [filteredEvents]);

  // Render event row (like renderMeetingRow in CalendarPage)
  const renderEventRow = (event: CalendarEvent) => {
    const isExpanded = expandedEventId === event.id;
    return (
      <React.Fragment key={event.id}>
        <tr className="hover:bg-base-200/50">
          <td className="font-bold flex items-center gap-2">
            <span style={{ background: event.color, width: 12, height: 12, borderRadius: 6, display: 'inline-block' }} />
            {event.title}
          </td>
          <td>{event.start.toLocaleDateString()} at {event.start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
          <td>{event.group}</td>
          <td>{event.mailbox}</td>
          <td>${event.resource?.amount?.toLocaleString() || '0'}</td>
          <td><span className="badge badge-success">{event.resource?.status || 'Scheduled'}</span></td>
          <td>
            <button 
              className="btn btn-primary btn-sm gap-2"
              onClick={() => {
                if (event.resource?.teamsMeetingUrl) {
                  window.open(event.resource.teamsMeetingUrl, '_blank');
                } else {
                  alert('No meeting URL available');
                }
              }}
            >
              <VideoCameraIcon className="w-4 h-4" />
              Join Meeting
            </button>
          </td>
        </tr>
        {/* Expanded Details Row */}
        {isExpanded && (
          <tr>
            <td colSpan={7} className="p-0">
              <div className="bg-base-100/50 p-4 border-t border-base-200">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-base-200/50 p-4 rounded-lg">
                    <h5 className="font-semibold text-base-content/90 mb-2">Description</h5>
                    <div className="text-sm text-base-content/90 whitespace-pre-wrap">{event.description ? stripHtml(event.description) : 'No description.'}</div>
                  </div>
                  <div className="bg-base-200/50 p-4 rounded-lg">
                    <h5 className="font-semibold text-base-content/90 mb-2">Attendees</h5>
                    <div className="space-y-2">
                      {event.attendees && event.attendees.length > 0 ? (
                        event.attendees.map((a: any, idx: number) => (
                          <div key={idx} className="flex items-center gap-2 text-sm">
                            <UserIcon className="w-4 h-4" />
                            {a.emailAddress?.name || a.emailAddress?.address}
                          </div>
                        ))
                      ) : (
                        <span className="text-base-content/70">No attendees.</span>
                      )}
                    </div>
                  </div>
                  <div className="md:col-span-2 flex justify-center">
                    <button
                      onClick={() => {
                        setSelectedEvent(event);
                        setIsDocumentModalOpen(true);
                      }}
                      className="btn btn-outline btn-primary flex items-center gap-2 px-4 py-2 text-base font-semibold rounded-lg shadow hover:bg-primary hover:text-white transition-colors"
                    >
                      <FolderIcon className="w-5 h-5" />
                      Documents
                    </button>
                  </div>
                </div>
              </div>
            </td>
          </tr>
        )}
        {/* Toggle Row */}
        <tr>
          <td colSpan={7} className="p-0">
            <div
              className="bg-base-200 hover:bg-base-300 cursor-pointer transition-colors p-2 text-center"
              onClick={() => setExpandedEventId(expandedEventId === event.id ? null : event.id)}
            >
              <div className="flex items-center justify-center gap-2 text-sm font-medium text-primary">
                <span>{expandedEventId === event.id ? 'Show Less' : 'Show More'}</span>
                <ChevronDownIcon className={`w-5 h-5 transition-transform ${expandedEventId === event.id ? 'rotate-180' : ''}`} />
              </div>
            </div>
          </td>
        </tr>
      </React.Fragment>
    );
  };

  // Helper: get all days in current month
  const getMonthDays = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const days: Date[] = [];
    for (let d = 1; d <= lastDay.getDate(); d++) {
      days.push(new Date(year, month, d));
    }
    return days;
  };
  // Helper: get events for a given day
  const getEventsForDay = (day: Date) => {
    const dayStr = day.toISOString().split('T')[0];
    return events.filter(ev => ev.start.toISOString().split('T')[0] === dayStr);
  };
  // Month view state
  const [monthViewDate, setMonthViewDate] = useState(() => {
    const d = new Date(selectedDate);
    d.setDate(1);
    return d;
  });
  // Month navigation
  const goToPrevMonth = () => {
    setMonthViewDate(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  };
  const goToNextMonth = () => {
    setMonthViewDate(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  };
  // Month grid rendering
  const renderMonthGrid = () => {
    const days = getMonthDays(monthViewDate);
    const firstDayOfWeek = new Date(monthViewDate.getFullYear(), monthViewDate.getMonth(), 1).getDay();
    const blanks = Array.from({ length: firstDayOfWeek }, (_, i) => <div key={'blank-' + i}></div>);
    return (
      <div>
        <div className="flex items-center justify-between mb-4">
          <button className="btn btn-circle btn-outline btn-primary" onClick={goToPrevMonth}><ChevronLeftIcon className="w-6 h-6" /></button>
          <span className="text-lg font-semibold">
            {monthViewDate.toLocaleString('en-US', { month: 'long', year: 'numeric' })}
          </span>
          <button className="btn btn-circle btn-outline btn-primary" onClick={goToNextMonth}><ChevronRightIcon className="w-6 h-6" /></button>
        </div>
        <div className="grid grid-cols-7 gap-2 mb-2 text-center text-base-content/70 font-semibold">
          <div>Sun</div><div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div>Sat</div>
        </div>
        <div className="grid grid-cols-7 gap-2">
          {blanks}
          {days.map(day => {
            const evs = getEventsForDay(day);
            const isToday = day.toDateString() === new Date().toDateString();
            return (
              <div
                key={day.toISOString()}
                className={`card cursor-pointer transition-all hover:shadow-lg p-2 min-h-[80px] flex flex-col items-start ${isToday ? 'border-2 border-primary' : 'border border-base-200'}`}
                onClick={() => {
                  setMonthModalDay(day);
                  setMonthModalEvents(evs);
                }}
              >
                <div className="font-bold text-base-content/80 mb-1">{day.getDate()}</div>
                <div className="flex flex-wrap gap-1">
                  {evs.slice(0, 3).map(ev => (
                    <span key={ev.id} className="badge badge-xs" style={{ background: ev.color }} title={ev.title}></span>
                  ))}
                  {evs.length > 3 && <span className="badge badge-xs bg-base-200">+{evs.length - 3}</span>}
                </div>
              </div>
            );
          })}
        </div>
        {/* Modal for day events */}
        {monthModalDay && (
          <div className="modal modal-open">
            <div className="modal-box max-w-lg">
              <div className="flex items-center justify-between mb-4">
                <div className="text-lg font-bold">
                  {monthModalDay.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                </div>
                <button className="btn btn-sm btn-circle btn-ghost" onClick={() => setMonthModalDay(null)}>✕</button>
              </div>
              {monthModalEvents.length === 0 ? (
                <div className="text-base-content/60">No events for this day.</div>
              ) : (
                <div className="space-y-4">
                  {monthModalEvents.map(ev => (
                    <div key={ev.id} className="card bg-base-100 shadow p-3 flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="badge badge-xs" style={{ background: ev.color }}></span>
                        <span className="font-semibold">{ev.title}</span>
                      </div>
                      <div className="text-xs text-base-content/70">
                        {ev.start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - {ev.end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                      <div className="text-xs text-base-content/60">{ev.group} • {ev.mailbox}</div>
                      {ev.location && (
                        <div className="text-xs text-base-content/70 mt-1"><span className="font-medium">Location:</span> {ev.location}</div>
                      )}
                      <div className="text-xs text-base-content/70 mt-1">
                        <span className="font-medium">Description:</span> {ev.description ? stripHtml(ev.description) : 'No description'}
                      </div>
                      <div className="flex gap-2 mt-1">
                        <button className="btn btn-xs btn-outline btn-primary" onClick={() => window.open(ev.resource?.teamsMeetingUrl, '_blank')}>Join</button>
                        <button className="btn btn-xs btn-outline" onClick={() => setSelectedEvent(ev)}>Details</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  // Add a helper function to strip HTML tags
  function stripHtml(html?: string): string {
    if (!html) return '';
    const tmp = document.createElement('DIV');
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || '';
  }

  return (
    <div className="p-4 md:p-6 lg:p-8">
      {/* Removed Outlook Calendar title */}

      {/* Date Navigation */}
      <div className="mb-6 flex items-center justify-center gap-4">
        <button
          onClick={goToPreviousDay}
          className="btn btn-circle btn-outline btn-primary"
          title="Previous Day"
        >
          <ChevronLeftIcon className="w-6 h-6" />
        </button>
        <div className="flex items-center gap-3">
          <span className="text-lg font-semibold">
            {new Date(selectedDate).toLocaleDateString('en-US', { 
              weekday: 'long', 
              year: 'numeric', 
              month: 'long', 
              day: 'numeric' 
            })}
          </span>
          <button
            onClick={goToToday}
            className="btn btn-sm btn-primary"
            title="Go to Today"
          >
            Today
          </button>
        </div>
        <button
          onClick={goToNextDay}
          className="btn btn-circle btn-outline btn-primary"
          title="Next Day"
        >
          <ChevronRightIcon className="w-6 h-6" />
        </button>
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-col md:flex-row justify-between items-center gap-4">
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <CalendarIcon className="w-8 h-8 text-primary" />
          Outlook Calendar
        </h1>
        <div className="flex flex-col md:flex-row gap-4 w-full md:w-auto">
          <div className="flex items-center gap-2">
            <FunnelIcon className="w-5 h-5 text-gray-500" />
            <input 
              type="date" 
              className="input input-bordered w-full md:w-auto"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <UserIcon className="w-5 h-5 text-gray-500" />
            <select 
              className="select select-bordered w-full md:w-auto"
              value={selectedMailbox}
              onChange={(e) => setSelectedMailbox(e.target.value)}
            >
              <option value="">All Calendars</option>
              {sharedMailboxes.map(mb => <option key={mb.email} value={mb.email}>{mb.label}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* View Toggle */}
      <div className="flex justify-end mb-4">
        <div className="btn-group">
          <button className={`btn btn-sm ${viewMode === 'list' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setViewMode('list')}>List View</button>
          <button className={`btn btn-sm ${viewMode === 'month' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setViewMode('month')}>Month View</button>
        </div>
      </div>

      {viewMode === 'month' ? (
        renderMonthGrid()
      ) : (
        <div className="bg-base-100 rounded-lg shadow-lg overflow-x-auto">
          <table className="table w-full">
            <thead>
              <tr className="bg-base-200">
                <th>Title</th>
                <th>Date & Time</th>
                <th>Group</th>
                <th>Mailbox</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="text-center p-8">Loading events...</td></tr>
              ) : filteredEvents.length > 0 ? (
                filteredEvents.map(renderEventRow)
              ) : (
                <tr><td colSpan={7} className="text-center p-8">No events found for the selected filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Total Amount */}
      <div className="mt-6 flex justify-end">
        <div className="card bg-primary text-primary-content p-4 shadow-lg">
          <div className="flex items-center gap-3">
            <CurrencyDollarIcon className="w-7 h-7" />
            <div>
              <div className="text-lg font-bold">Total Balance</div>
              <div className="text-2xl font-extrabold">${totalAmount.toLocaleString()}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Document Modal */}
      {isDocumentModalOpen && selectedEvent && (
        <div className="modal modal-open">
          <div className="modal-box max-w-2xl">
            <div className="flex justify-between items-start mb-4">
              <h3 className="font-bold text-lg">{selectedEvent.title}</h3>
              <button 
                className="btn btn-sm btn-circle btn-ghost"
                onClick={() => setIsDocumentModalOpen(false)}
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
                      `${selectedEvent.start.toLocaleDateString()} ${selectedEvent.start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${selectedEvent.end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                    }
                  </div>
                  <div className="text-sm text-base-content/70">
                    {selectedEvent.mailbox}
                  </div>
                </div>
              </div>
              {selectedEvent.location && (
                <div className="flex items-center gap-2">
                  <span className="font-medium">Location:</span>
                  <span>{selectedEvent.location}</span>
                </div>
              )}
              {selectedEvent.attendees && selectedEvent.attendees.length > 0 && (
                <div>
                  <div className="font-medium mb-2">Attendees</div>
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
                  <div className="text-sm text-base-content/80 prose prose-sm max-w-none">
                    {selectedEvent.description}
                  </div>
                </div>
              )}
            </div>
            <div className="modal-action">
              <button className="btn" onClick={() => setIsDocumentModalOpen(false)}>
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