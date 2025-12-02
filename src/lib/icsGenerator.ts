/**
 * Generates an ICS (iCalendar) file content for meeting invitations
 * This helps with timezone handling when sending calendar invites
 */

export interface ICSMeetingDetails {
  subject: string;
  startDateTime: string; // ISO string (YYYY-MM-DDTHH:mm:ss)
  endDateTime: string;   // ISO string
  location: string;
  description?: string;
  organizerEmail?: string;
  organizerName?: string;
  attendeeEmail: string;
  attendeeName?: string;
  teamsJoinUrl?: string;
  timeZone?: string; // Defaults to 'Asia/Jerusalem' if not provided
}

/**
 * Converts a date and time (interpreted in a specific timezone) to UTC Date object
 * 
 * Simple approach: Create a date representing the local time, then use Intl API
 * to find what UTC time corresponds to that local time in the target timezone.
 */
function convertToUTCDate(date: string, time: string, timeZone: string = 'Asia/Jerusalem'): Date {
  // Parse date and time components
  const [year, month, day] = date.split('-').map(Number);
  const [hours = 0, minutes = 0, seconds = 0] = time.split(':').map(Number);
  
  // Create a date string in ISO format
  const dateTimeStr = `${date}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  
  // The key insight: We need to find a UTC time that, when displayed in the target timezone,
  // shows our desired local time.
  // 
  // Method: Use a date in the approximate range and calculate the offset
  
  // Create a date object - this will be interpreted as local browser time
  // But we want it to represent a time in the target timezone
  // So we'll use Intl to calculate the offset
  
  // Step 1: Create a UTC date assuming our time is UTC
  const assumedUTC = Date.UTC(year, month - 1, day, hours, minutes, seconds);
  const testDate = new Date(assumedUTC);
  
  // Step 2: Format this UTC time in the target timezone to see what it displays as
  const tzFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  
  const tzDisplay = tzFormatter.format(testDate); // Format: "YYYY-MM-DD,HH:mm:ss"
  const [tzDateStr, tzTimeStr] = tzDisplay.split(',');
  const [tzHour, tzMin, tzSec] = tzTimeStr.split(':').map(Number);
  
  // Step 3: Calculate the difference
  // If 9am UTC displays as 11am in Jerusalem (UTC+2), we need to go back 2 hours
  // to get 9am in Jerusalem (which is 7am UTC)
  // We use the original date components, just compare the times
  const displayedTime = Date.UTC(year, month - 1, day, tzHour, tzMin, tzSec);
  const desiredTime = Date.UTC(year, month - 1, day, hours, minutes, seconds);
  
  // Step 4: Calculate offset and adjust
  // offset = displayedTime - desiredTime (positive if displayed > desired)
  // We subtract this offset from assumedUTC to get the correct UTC time
  const offset = displayedTime - desiredTime;
  const correctUTC = assumedUTC - offset;
  
  return new Date(correctUTC);
}

/**
 * Formats a date-time string to ICS format (UTC)
 * ICS format: YYYYMMDDTHHmmssZ
 * 
 * Can accept:
 * - Full ISO string with timezone (e.g., "2025-01-15T14:30:00Z")
 * - ISO string without timezone (will be interpreted in timeZone parameter)
 * - date and time as separate strings (will be interpreted in timeZone parameter)
 */
function formatToICSDateTime(dateTimeStringOrDate: string, timeStringOrTimeZone?: string, timeZone: string = 'Asia/Jerusalem'): string {
  let date: Date;
  
  // If timeStringOrTimeZone is provided and doesn't look like a timezone, it's a time string
  if (timeStringOrTimeZone && /^\d{1,2}:\d{2}/.test(timeStringOrTimeZone)) {
    // date and time provided separately
    date = convertToUTCDate(dateTimeStringOrDate, timeStringOrTimeZone, timeZone);
  } else {
    // Single date-time string provided
    const dateTimeString = dateTimeStringOrDate;
    const tz = timeStringOrTimeZone || timeZone;
    
    // Check if the string already has timezone info
    if (dateTimeString.endsWith('Z') || dateTimeString.match(/[+-]\d{2}:\d{2}$/)) {
      // Already has timezone info, parse directly
      date = new Date(dateTimeString);
    } else {
      // No timezone info - extract date and time and convert
      const [datePart, timePart] = dateTimeString.includes('T')
        ? dateTimeString.split('T')
        : [dateTimeString.split(' ')[0], dateTimeString.split(' ')[1] || '00:00:00'];
      
      date = convertToUTCDate(datePart, timePart, tz);
    }
  }
  
  // Format as YYYYMMDDTHHmmssZ (UTC)
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const seconds = String(date.getUTCSeconds()).padStart(2, '0');
  
  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

/**
 * Generates a unique ID for the calendar event
 */
function generateUID(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 9);
  return `meeting-${timestamp}-${random}@rmq2.0`;
}

/**
 * Escapes special characters in ICS text fields
 */
function escapeICS(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '');
}

/**
 * Converts a date string (YYYY-MM-DD) and time string (HH:mm) to ISO string in specified timezone
 * This helper function is used when you only have date and time separately
 */
function convertToISODateTime(date: string, time: string, timeZone: string = 'Asia/Jerusalem'): string {
  // Create a date string in ISO format (local time, no timezone)
  const dateTimeStr = `${date}T${time}:00`;
  
  // Create a date object - JavaScript will interpret this as local time
  const localDate = new Date(dateTimeStr);
  
  // Get the timezone offset for the specified timezone at this date/time
  // We need to convert the local time to UTC for ICS format
  // Since we're treating the input as being in the specified timezone,
  // we need to calculate what that time is in UTC
  
  // Method: Create two dates - one interpreted as UTC, one as local
  // and find the difference to determine the offset
  const utcTime = Date.UTC(
    localDate.getFullYear(),
    localDate.getMonth(),
    localDate.getDate(),
    localDate.getHours(),
    localDate.getMinutes(),
    localDate.getSeconds()
  );
  
  // Now get what this UTC time represents in the target timezone
  const tzFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  
  const tzParts = tzFormatter.formatToParts(new Date(utcTime));
  const tzTime = new Date(
    parseInt(tzParts.find(p => p.type === 'year')?.value || '0'),
    parseInt(tzParts.find(p => p.type === 'month')?.value || '1') - 1,
    parseInt(tzParts.find(p => p.type === 'day')?.value || '1'),
    parseInt(tzParts.find(p => p.type === 'hour')?.value || '0'),
    parseInt(tzParts.find(p => p.type === 'minute')?.value || '0'),
    parseInt(tzParts.find(p => p.type === 'second')?.value || '0')
  );
  
  // Calculate the offset
  const offset = utcTime - tzTime.getTime();
  
  // Apply offset to get the correct UTC time
  const correctUTCTime = new Date(utcTime - offset);
  
  return correctUTCTime.toISOString();
}

/**
 * Gets timezone offset in minutes for a specific date in a timezone
 */
function getTimezoneOffset(date: Date, timeZone: string): number {
  // Create two formatters: one for UTC, one for the target timezone
  const utcFormatter = new Intl.DateTimeFormat('en', {
    timeZone: 'UTC',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  
  const tzFormatter = new Intl.DateTimeFormat('en', {
    timeZone: timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  
  // Format the same UTC date in both timezones
  const utcTime = utcFormatter.format(date);
  const tzTime = tzFormatter.format(date);
  
  // Calculate difference
  const [utcHour, utcMin] = utcTime.split(':').map(Number);
  const [tzHour, tzMin] = tzTime.split(':').map(Number);
  
  const utcMinutes = utcHour * 60 + utcMin;
  const tzMinutes = tzHour * 60 + tzMin;
  
  // Return offset in minutes (positive means timezone is ahead of UTC)
  return tzMinutes - utcMinutes;
}

/**
 * Generates ICS file content for a meeting invitation
 */
export function generateICS(details: ICSMeetingDetails): string {
  const {
    subject,
    startDateTime,
    endDateTime,
    location,
    description = '',
    organizerEmail = 'noreply@lawoffice.org.il',
    organizerName = 'Law Office',
    attendeeEmail,
    attendeeName,
    teamsJoinUrl,
    timeZone = 'Asia/Jerusalem'
  } = details;

  // Convert start and end times to UTC for ICS format
  // If startDateTime/endDateTime are ISO strings, use them directly
  // Otherwise, they should be date strings and we need separate time
  const startUTC = formatToICSDateTime(startDateTime, undefined, timeZone);
  const endUTC = formatToICSDateTime(endDateTime, undefined, timeZone);
  
  const uid = generateUID();
  const now = formatToICSDateTime(new Date().toISOString());
  
  // Build description with Teams link if available
  let fullDescription = description;
  if (teamsJoinUrl) {
    fullDescription += (fullDescription ? '\\n\\n' : '') + `Join Teams Meeting: ${teamsJoinUrl}`;
  }
  
  // Parse the start date to get timezone info
  const startDate = new Date(startDateTime.includes('Z') || startDateTime.match(/[+-]\d{2}:\d{2}$/) 
    ? startDateTime 
    : `${startDateTime}Z`);
  
  // Get timezone offset for this date (accounts for DST)
  const tzOffsetMinutes = getTimezoneOffset(startDate, timeZone);
  const tzOffsetHours = Math.floor(Math.abs(tzOffsetMinutes) / 60);
  const tzOffsetMins = Math.abs(tzOffsetMinutes) % 60;
  const tzOffsetSign = tzOffsetMinutes >= 0 ? '+' : '-';
  const tzOffsetStr = `${tzOffsetSign}${String(tzOffsetHours).padStart(2, '0')}${String(tzOffsetMins).padStart(2, '0')}`;
  
  // Build ICS content with proper timezone handling
  // Use floating time (no timezone) or UTC, but we'll use UTC for maximum compatibility
  const icsLines = [
    'BEGIN:VCALENDAR',
    'PRODID:-//RMQ 2.0//Meeting Invitation//EN',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `DTSTART:${startUTC}`,
    `DTEND:${endUTC}`,
    `SUMMARY:${escapeICS(subject)}`,
    `LOCATION:${escapeICS(location)}`,
    ...(fullDescription ? [`DESCRIPTION:${escapeICS(fullDescription)}`] : []),
    `ORGANIZER;CN="${escapeICS(organizerName)}":MAILTO:${organizerEmail}`,
    `ATTENDEE;CN="${escapeICS(attendeeName || attendeeEmail)}";RSVP=TRUE:MAILTO:${attendeeEmail}`,
    'STATUS:CONFIRMED',
    'SEQUENCE:0',
    ...(teamsJoinUrl ? [`URL:${teamsJoinUrl}`, `X-MICROSOFT-SKYPETEAMSMEETINGURL:${teamsJoinUrl}`] : []),
    'END:VEVENT',
    'END:VCALENDAR'
  ];
  
  return icsLines.join('\r\n') + '\r\n';
}

/**
 * Converts a date (YYYY-MM-DD) and time (HH:mm) to ISO date-time string
 * This is a helper for converting meeting date/time to ISO format
 * The date/time is interpreted in the specified timezone
 */
export function dateTimeToISO(date: string, time: string, durationMinutes: number = 60, timeZone: string = 'Asia/Jerusalem'): { start: string; end: string } {
  // Parse time components
  const [hours, minutes] = time.split(':').map(Number);
  const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
  
  // Convert to UTC Date objects
  const startDate = convertToUTCDate(date, timeStr, timeZone);
  const endDate = new Date(startDate.getTime() + durationMinutes * 60 * 1000);
  
  // Format as ISO strings
  const formatISO = (d: Date) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    const s = String(d.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day}T${h}:${m}:${s}`;
  };
  
  return {
    start: formatISO(startDate),
    end: formatISO(endDate)
  };
}

/**
 * Generates ICS file for a meeting with separate date and time strings
 * This is a convenience function for the common use case
 */
export function generateICSFromDateTime(details: {
  subject: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  durationMinutes?: number;
  location: string;
  description?: string;
  organizerEmail?: string;
  organizerName?: string;
  attendeeEmail: string;
  attendeeName?: string;
  teamsJoinUrl?: string;
  timeZone?: string;
}): string {
  const { date, time, durationMinutes = 60, timeZone = 'Asia/Jerusalem' } = details;
  const { start, end } = dateTimeToISO(date, time, durationMinutes, timeZone);
  
  return generateICS({
    ...details,
    startDateTime: start,
    endDateTime: end,
    timeZone
  });
}

