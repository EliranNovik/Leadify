const { DateTime } = require('luxon');

function escapeICS(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\n|\r/g, '\\n');
}

function stripHtmlForIcs(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Google Calendar / generic clients — METHOD:REQUEST .ics attachment.
 */
function generateICSFromDateTime({
  subject,
  date,
  time,
  durationMinutes = 30,
  location,
  description = '',
  organizerEmail = 'office@lawoffice.org.il',
  organizerName = 'Decker, Pex, Levi Law Offices',
  attendeeEmail,
  attendeeName,
  teamsJoinUrl,
  timeZone = 'Asia/Jerusalem',
}) {
  const timeNorm = String(time || '').trim();
  const hhmm = timeNorm.length >= 5 ? timeNorm.substring(0, 5) : timeNorm;
  const start = DateTime.fromISO(`${date}T${hhmm}:00`, { zone: timeZone });
  if (!start.isValid) {
    throw new Error(`Invalid meeting date/time for ICS: ${date} ${time}`);
  }
  const end = start.plus({ minutes: durationMinutes });

  const fmt = (dt) => dt.toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");
  const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}@lawoffice.org.il`;
  const now = fmt(DateTime.utc());

  let fullDescription = description || '';
  if (teamsJoinUrl) {
    fullDescription += (fullDescription ? '\n\n' : '') + `Join Teams Meeting: ${teamsJoinUrl}`;
  }

  const locationField =
    teamsJoinUrl && String(location || '').toLowerCase().includes('teams')
      ? 'Microsoft Teams Meeting'
      : location || '';

  const lines = [
    'BEGIN:VCALENDAR',
    'PRODID:-//RMQ 2.0//Meeting Invitation//EN',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:${escapeICS(subject)}`,
    `LOCATION:${escapeICS(locationField)}`,
  ];

  if (fullDescription) {
    lines.push(`DESCRIPTION:${escapeICS(fullDescription)}`);
  }

  lines.push(
    `ORGANIZER;CN="${escapeICS(organizerName)}":MAILTO:${organizerEmail}`,
    `ATTENDEE;CN="${escapeICS(attendeeName || attendeeEmail)}";RSVP=TRUE;ROLE=REQ-PARTICIPANT:MAILTO:${attendeeEmail}`,
    'STATUS:CONFIRMED',
    'SEQUENCE:0',
  );

  if (teamsJoinUrl) {
    lines.push(`URL:${teamsJoinUrl}`);
  }

  lines.push('END:VEVENT', 'END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}

function buildIcsEmailAttachment(icsContent) {
  return {
    name: 'meeting-invite.ics',
    contentBytes: Buffer.from(icsContent, 'utf8').toString('base64'),
    contentType: 'text/calendar; charset=utf-8; method=REQUEST',
  };
}

module.exports = {
  generateICSFromDateTime,
  buildIcsEmailAttachment,
  stripHtmlForIcs,
};
