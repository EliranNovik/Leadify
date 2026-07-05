# Partner Meeting Webhook

External partners can schedule CRM meetings for existing client leads by calling a secured backend webhook. The flow mirrors the internal client booking system (`ClientBookingScheduler` / `bookMeeting`): it converts the partner's local date/time using a country-based timezone, stores the meeting in Israel office time, creates a Teams/shared-calendar event when Graph is configured, sends client notifications, and moves the lead to stage **20 (Meeting scheduled)**.

## Endpoint

| Method | URL |
|--------|-----|
| `POST` | `{BACKEND_BASE_URL}/api/hook/partner/meeting` |
| `GET`  | `{BACKEND_BASE_URL}/api/hook/partner/meeting/health` |

Example production base URL: `https://leadify-crm-backend.onrender.com`

Health check (no password):

```bash
curl -s "https://leadify-crm-backend.onrender.com/api/hook/partner/meeting/health"
```

## Authentication (required)

Every `POST` request must include the webhook password:

**Password:** `2KrVDK18qRr1YV8`

You can send it in any of these ways:

1. JSON body field `password`
2. JSON body field `webhook_password` or `secret`
3. Header `x-partner-webhook-secret: 2KrVDK18qRr1YV8`
4. Header `x-webhook-password: 2KrVDK18qRr1YV8`
5. Header `Authorization: Bearer 2KrVDK18qRr1YV8`

On the server, override via environment variable (recommended for production):

```env
PARTNER_MEETING_WEBHOOK_SECRET=2KrVDK18qRr1YV8
```

Missing or wrong password → `401 Unauthorized`.

## Required payload fields

| Field | Type | Description |
|-------|------|-------------|
| `password` | string | Webhook secret (or use header — see above) |
| `lead_ref` | string | Lead identifier: `L12345`, manual id, numeric legacy id, or new-lead UUID |
| `date` | string | Meeting date in the **client's local timezone**, format `YYYY-MM-DD` |
| `time` | string | Meeting time in the **client's local timezone**, format `HH:MM` (24-hour) |
| `country` | string | ISO 3166-1 alpha-2 country code (e.g. `US`, `DE`, `IL`) — used to resolve `client_booking_timezone` from `misc_country.timezone` |

Alternatively to `country`, you may send `client_timezone` (IANA name, e.g. `America/New_York`) when the country mapping is insufficient.

### Aliases accepted

| Primary | Also accepted |
|---------|----------------|
| `lead_ref` | `lead_number` |
| `date` | `meeting_date` |
| `time` | `meeting_time` |
| `country` | `ISO` |
| `client_timezone` | `timezone` |
| `contact_email` | `email` |
| `meeting_location` | `location` |
| `notes` | `brief`, `meeting_brief` |
| `partner_name` | `source` |

## Optional fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `contact_id` | number | main / only contact | CRM contact that receives confirmation |
| `contact_email` | string | — | Pick contact by email when `contact_id` is omitted |
| `meeting_location` | string | global booking default | `Teams` or `Ramat Gan Office` |
| `notes` | string | — | Stored in `meetings.meeting_brief` |
| `partner_name` | string | — | Shown in `meetings.scheduler` as `Partner webhook: {name}` |
| `skip_availability_check` | boolean | `false` | Skip slot/capacity validation |
| `send_notifications` | boolean | `true` | Email / WhatsApp / calendar invite to client |

## Example request

Partner in New York books a meeting for lead `L1042` on 10 July 2026 at 2:30 PM local time:

```bash
curl -X POST "https://leadify-crm-backend.onrender.com/api/hook/partner/meeting" \
  -H "Content-Type: application/json" \
  -H "x-partner-webhook-secret: 2KrVDK18qRr1YV8" \
  -d '{
    "lead_ref": "L1042",
    "date": "2026-07-10",
    "time": "14:30",
    "country": "US",
    "contact_email": "client@example.com",
    "meeting_location": "Teams",
    "notes": "Referred by Acme Immigration",
    "partner_name": "Acme Immigration"
  }'
```

## Example success response (`201`)

```json
{
  "success": true,
  "data": {
    "ok": true,
    "meeting": {
      "id": 9876,
      "date": "2026-07-10",
      "time": "21:30:00",
      "location": "Teams",
      "teams_meeting_url": "https://teams.microsoft.com/l/meetup-join/...",
      "subject": "[#L1042] John Doe - German Citizenship - Meeting (Partner booked)",
      "client_timezone": "America/New_York",
      "israel_date": "2026-07-10",
      "israel_time": "21:30:00"
    },
    "lead": {
      "lead_ref": "L1042",
      "display_name": "John Doe",
      "is_legacy": false
    },
    "warnings": []
  }
}
```

- `meeting.date` / `meeting.time` — stored values (Israel office / `Asia/Jerusalem` wall time).
- `meeting.client_timezone` — saved on the meeting row for portal display (same as client booking page).
- `warnings` — non-fatal issues (e.g. Graph calendar or notification failures); meeting is still created.

## Error responses

| HTTP | Typical cause |
|------|----------------|
| `401` | Wrong or missing password |
| `400` | Missing required field, lead not found, invalid time, slot unavailable, ambiguous contact |
| `500` | Database or unexpected server error |

Example:

```json
{
  "success": false,
  "error": "country (ISO code) or client_timezone is required for timezone conversion"
}
```

## How timezone handling works

1. Partner sends `date` + `time` in the **client's local** calendar.
2. `country` (e.g. `US`) is looked up in `misc_country` → IANA timezone (e.g. `America/New_York`).
3. Local time is converted to **Israel office time** (`Asia/Jerusalem`) for storage and shared calendar events.
4. `meetings.client_booking_timezone` is set so the client portal and booking UI show the correct local time.

If a country has multiple timezones and the default mapping is wrong, send `client_timezone` explicitly.

## What the webhook creates (same as staff booking)

1. **`meetings` row** linked to the lead (`client_id` or `legacy_lead_id`)
2. **Microsoft Teams / shared calendar event** (when `BOOKING_MAILBOX_USER_ID` or meeting manager mailbox is connected)
3. **Client notifications** (email, WhatsApp, calendar invite — per global booking settings)
4. **Lead stage → 20** (`Meeting scheduled`) with history in `leads_leadstage`

Booking configuration (duration, manager, host, notification flags, business hours) comes from:

- Per-lead `lead_meeting_booking_settings` (if present), merged with
- Global `meeting_booking_global_settings`

## Contact selection rules

1. If `contact_id` is sent → must exist on the lead and have email or phone.
2. Else if `contact_email` is sent → match by email (case-insensitive).
3. Else use the main contact, or the only contact with email/phone.
4. If multiple contacts qualify → `400` with message to pass `contact_id` or `contact_email`.

## Related code

| File | Role |
|------|------|
| `backend/src/routes/webhookRoutes.js` | Route registration |
| `backend/src/controllers/partnerMeetingWebhookController.js` | Auth + request parsing |
| `backend/src/services/clientBookingService.js` | `createPartnerMeeting()` — core logic |
| `src/components/client-booking/ClientBookingScheduler.tsx` | Client-facing equivalent UI |

## Deployment checklist

1. Deploy backend with the new route.
2. Set `PARTNER_MEETING_WEBHOOK_SECRET` in backend env (optional but recommended).
3. Ensure `BOOKING_MAILBOX_USER_ID` is set for Teams calendar + email.
4. Confirm global booking settings in CRM admin (`MeetingBookingManager`).
5. Share endpoint URL + password only with trusted partners over HTTPS.
