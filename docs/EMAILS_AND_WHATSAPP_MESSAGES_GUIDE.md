# CRM Emails & WhatsApp Messages Guide

**Audience:** External firms / integrations using this CRM backend (Supabase REST)  
**Scope:** Only `public.emails` and `public.whatsapp_messages` for **new leads** (`public.leads`, UUID ids)  
**Style match:** Same documentation pattern as `docs/CRM_LEAD_INTAKE_FIELDS_AND_STAGE_GUIDE.md` and `docs/PEX_MANUAL_INTERACTIONS_GUIDE.md`  
**Excludes:** Legacy leads, sending via Microsoft Graph or Meta WhatsApp Cloud API (CRM UI/backend does that). This guide covers **reading and writing the database rows** so messages appear on the lead timeline.

**Last updated from codebase:** August 2026

---

## 1. Executive summary

| Topic | How it works |
| ----- | ------------ |
| **Lead table** | `public.leads` only (`id` is `uuid`, `lead_number` like `L12345`) |
| **Email table** | `public.emails` — mailbox sync + manually saved outgoing mail |
| **WhatsApp table** | `public.whatsapp_messages` — inbound webhooks + outbound CRM sends |
| **Lead link** | `emails.client_id` / `whatsapp_messages.lead_id` = `leads.id` (`uuid`) |
| **Contact link** | Both tables: optional `contact_id` → `leads_contact.id` (`bigint`) |
| **Stage impact** | Inserts can trigger `evaluate_and_update_stage` (stages 11 / 15) when linked to a lead |
| **Direction naming** | **Different per table** — see §1.1 |

### 1.1 Direction values (important)

| Table | Outbound (we → client) | Inbound (client → us) |
| ----- | ---------------------- | --------------------- |
| `emails` | `outgoing` | `incoming` |
| `whatsapp_messages` | `out` | `in` |

Do **not** mix these. Wrong values fail check constraints or break the timeline UI.

### 1.2 Finding a lead first

Same pattern as the PEX guide:

```http
GET /rest/v1/leads?lead_number=eq.L12345&select=id,name,lead_number,email,phone
```

Use returned `id` as:

- `emails.client_id`
- `whatsapp_messages.lead_id`

Optional contact:

```http
GET /rest/v1/lead_leadcontact?newlead_id=eq.<lead-uuid>&select=contact_id,main
```

---

## 2. Table reference — `emails`

Stores one CRM email row per **(message × lead/contact match)**. The same Graph `message_id` may appear more than once if it matches multiple leads/contacts.

Linked to the lead via **`emails.client_id`** (`uuid`) = **`leads.id`** (`uuid`).

### 2.1 Columns

| Column | Type | Nullable | Purpose |
| ------ | ---- | -------- | ------- |
| `id` | `bigint` (serial) | No | Primary key |
| `message_id` | `text` | Yes\* | Stable external id (Graph message id, or `optimistic_<ms>` for CRM-saved sends). Prefer unique per lead/contact combo. |
| `thread_id` | `text` | Yes | Graph conversation / thread id |
| `user_id` | `uuid` | Yes | Mailbox owner / CRM user (`users.id`) when known |
| `sender_name` | `text` | Yes | Display name of sender |
| `sender_email` | `text` | Yes\* | Sender address (required for useful timeline matching) |
| `recipient_list` | `text` | Yes | Comma-separated To/Cc addresses |
| `subject` | `text` | Yes | Subject line |
| `body_html` | `text` | Yes | Full HTML body |
| `body_preview` | `text` | Yes | Short plain/HTML preview (often first ~500 chars) |
| `sent_at` | `timestamptz` | Yes | When the message was sent/received |
| `direction` | `text` | Yes\* | **`incoming`** or **`outgoing`** only |
| `attachments` | `jsonb` | Yes | Attachment metadata array, or `null` |
| `client_id` | `uuid` | Yes\* | FK → `leads.id` — **required for partner inserts** |
| `contact_id` | `bigint` | Yes | FK → `leads_contact.id` |
| `body_cached` | `boolean` | Yes | `true` when full `body_html` has been fetched/stored |
| `is_read` | `boolean` | Yes | CRM read state (`true` / `false` / `null`) |
| `related_meeting_id` | `bigint` | Yes | Optional link to a meeting (when used) |

\*Practically required for partner inserts so the CRM timeline and stage logic work.

### 2.2 Lead linking rules

| Situation | Set these |
| --------- | --------- |
| Lead-scoped email | `client_id` = `leads.id` (UUID) |
| Contact-scoped | Also set `contact_id` when known |
| Unmatched / office-only | `client_id` null (rarely useful for partners) |

Always set **`client_id`** for emails that should appear on a lead’s timeline.

### 2.3 How to add an email (Supabase REST)

**Endpoint**

```http
POST /rest/v1/emails
Content-Type: application/json
Prefer: return=representation
```

#### Required / strongly recommended fields

| Field | Rule |
| ----- | ---- |
| `message_id` | Unique string per insert, e.g. `partner_<timestamp_ms>` or your system’s message id |
| `direction` | `outgoing` or `incoming` |
| `sent_at` | ISO datetime, e.g. `2026-08-09T12:30:00.000Z` |
| `client_id` | Lead UUID from `leads.id` |
| `sender_email` | From address |
| `recipient_list` | To/Cc as comma-separated string |
| `subject` | Subject text |
| `body_preview` | Short preview (or first 500 chars of body) |

#### Recommended fields

| Field | Rule |
| ----- | ---- |
| `sender_name` | Human-readable sender |
| `body_html` | Full HTML body for the email modal |
| `contact_id` | `leads_contact.id` when the mail is for a specific contact |
| `body_cached` | `true` if you already stored full `body_html` |
| `attachments` | `null` or JSON array of `{ id, name, contentType, size, … }` |
| `is_read` | `false` for new inbound mail you want unread |

#### Example: outbound email (partner → logged on lead)

```json
{
  "message_id": "partner_1723200000000",
  "thread_id": null,
  "client_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "contact_id": 12345,
  "sender_name": "Partner Firm Desk",
  "sender_email": "desk@partner-firm.example",
  "recipient_list": "client@example.com",
  "subject": "Follow-up regarding your file",
  "body_html": "<p>Hello, following up on our conversation.</p>",
  "body_preview": "Hello, following up on our conversation.",
  "sent_at": "2026-08-09T12:30:00.000Z",
  "direction": "outgoing",
  "attachments": null,
  "body_cached": true,
  "is_read": true
}
```

#### Example: inbound email (client → us)

```json
{
  "message_id": "partner_in_1723200001000",
  "client_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "sender_name": "John Smith",
  "sender_email": "client@example.com",
  "recipient_list": "desk@partner-firm.example",
  "subject": "Re: Follow-up regarding your file",
  "body_html": "<p>Thanks, I can meet next week.</p>",
  "body_preview": "Thanks, I can meet next week.",
  "sent_at": "2026-08-09T13:05:00.000Z",
  "direction": "incoming",
  "body_cached": true,
  "is_read": false
}
```

#### JavaScript (Supabase client)

```javascript
const now = new Date();

const { data: lead } = await supabase
  .from("leads")
  .select("id, name, email")
  .eq("lead_number", "L12345")
  .single();

await supabase.from("emails").insert({
  message_id: `partner_${now.getTime()}`,
  client_id: lead.id,
  sender_name: "Partner Firm Desk",
  sender_email: "desk@partner-firm.example",
  recipient_list: lead.email,
  subject: "Follow-up",
  body_html: "<p>Follow-up message</p>",
  body_preview: "Follow-up message",
  sent_at: now.toISOString(),
  direction: "outgoing",
  body_cached: true,
  is_read: true,
});
```

### 2.4 How to read emails

#### By lead UUID

```http
GET /rest/v1/emails?client_id=eq.<lead-uuid>&select=id,message_id,subject,sent_at,direction,sender_email,recipient_list,body_preview,body_html,attachments,contact_id,client_id,is_read&order=sent_at.desc&limit=50
```

#### By contact

```http
GET /rest/v1/emails?contact_id=eq.12345&order=sent_at.desc
```

#### By Graph / partner message id

```http
GET /rest/v1/emails?message_id=eq.partner_1723200000000&select=*
```

#### Useful select (matches CRM timeline)

```
id, message_id, subject, sent_at, direction, sender_email, recipient_list, body_html, body_preview, attachments, contact_id, client_id, is_read
```

### 2.5 Common mistakes (`emails`)

| Mistake | Fix |
| ------- | --- |
| Using `direction: "out"` / `"in"` | Use `outgoing` / `incoming` |
| Omitting `client_id` | Always set `client_id` = `leads.id` (UUID) |
| Using a numeric lead id | New leads use UUID only — look up via `leads.lead_number` |
| Omitting `message_id` | Always set a unique string |
| Duplicate `(message_id, client_id, …)` | Generate a new `message_id` or update the existing row |
| Expecting one row per Graph message globally | Same `message_id` can exist once per lead/contact match |

---

## 3. Table reference — `whatsapp_messages`

Stores WhatsApp chat rows for the CRM WhatsApp inbox and lead Interactions timeline.

Linked to the lead via **`whatsapp_messages.lead_id`** (`uuid`) = **`leads.id`** (`uuid`).

### 3.1 Columns

| Column | Type | Nullable | Purpose |
| ------ | ---- | -------- | ------- |
| `id` | `integer` / `bigint` (serial) | No | Primary key |
| `lead_id` | `uuid` | Yes\* | FK → `leads.id` — **required for partner inserts on a known lead** |
| `contact_id` | `integer` / `bigint` | Yes | FK → `leads_contact.id` |
| `phone_number` | `text` | Yes | E.164-style WhatsApp phone (also used for unknown chats) |
| `sender_id` | `uuid` | Yes | FK → `users.id` (CRM user who sent outbound) |
| `sender_name` | `text` | Yes\* | Display name (client name inbound; agent/“You” outbound) |
| `direction` | `text` | No\* | **`in`** or **`out`** only |
| `message` | `text` | Yes\* | Message body / caption fallback / template filled text |
| `sent_at` | `timestamptz` | Yes | When sent/received (default `now()`) |
| `message_type` | `varchar(20)` | Yes | See §3.2 (default `text`) |
| `media_url` | `text` | Yes | Stored file name / URL for media |
| `media_id` | `varchar(255)` | Yes | WhatsApp media id |
| `media_filename` | `varchar(255)` | Yes | Original filename (documents) |
| `media_mime_type` | `varchar(100)` | Yes | MIME type |
| `media_size` | `integer` | Yes | Size in bytes |
| `caption` | `text` | Yes | Media caption |
| `whatsapp_message_id` | `varchar(255)` | Yes | Meta wamid (for status updates / dedupe) |
| `whatsapp_status` | `varchar(50)` | Yes | `pending` \| `sent` \| `delivered` \| `read` \| `failed` |
| `whatsapp_timestamp` | `timestamptz` | Yes | Provider timestamp |
| `error_message` | `text` | Yes | Send/delivery error text |
| `template_id` | `integer` | Yes | FK → WhatsApp templates catalog (outbound templates) |
| `profile_picture_url` | `text` | Yes | Contact WhatsApp avatar URL |
| `voice_note` | `boolean` | Yes | `true` when audio is a voice note |
| `is_read` | `boolean` | Yes | CRM unread flag for inbound |
| `read_at` | `timestamptz` | Yes | When marked read in CRM |
| `read_by` | `uuid` | Yes | FK → `users.id` who marked read |
| `created_at` | `timestamptz` | Yes | Row created |
| `updated_at` | `timestamptz` | Yes | Row updated |

\*Practically required for partner inserts.

### 3.2 Allowed `message_type` values

Use only values accepted by the DB check constraint:

`text`, `image`, `document`, `audio`, `video`, `location`, `contact`, `button_response`, `list_response`

Notes:

- Outbound **templates** are still stored as `message_type: "text"` with optional `template_id`.
- Stickers are usually stored as `image` (or text fallback).

### 3.3 Lead linking rules

| Situation | Set these |
| --------- | --------- |
| Known lead | `lead_id` = `leads.id` (UUID) |
| Known contact | Also set `contact_id` |
| Unknown WhatsApp number | `lead_id` / `contact_id` null; set `phone_number` |

Always set **`phone_number`** when you have it — the WhatsApp UI groups by phone/contact.

### 3.4 How to add a WhatsApp message (Supabase REST)

**Endpoint**

```http
POST /rest/v1/whatsapp_messages
Content-Type: application/json
Prefer: return=representation
```

#### Required / strongly recommended fields

| Field | Rule |
| ----- | ---- |
| `direction` | `out` or `in` |
| `sender_name` | Who appears in the chat bubble |
| `message` | Text body (or placeholder for media) |
| `sent_at` | ISO datetime |
| `lead_id` | Lead UUID from `leads.id` |
| `phone_number` | Client WhatsApp number |
| `message_type` | Usually `text` |
| `whatsapp_status` | e.g. `sent` / `delivered` for historical imports; `pending` if still sending |

#### Recommended fields

| Field | Rule |
| ----- | ---- |
| `contact_id` | When known |
| `whatsapp_message_id` | Your provider message id (helps dedupe/status) |
| `template_id` | Only for template sends that map to CRM templates |
| `is_read` | `false` for new inbound; `true` for outbound you logged yourself |

#### Example: outbound WhatsApp

```json
{
  "lead_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "contact_id": 12345,
  "phone_number": "972501234567",
  "sender_name": "Partner Firm Desk",
  "direction": "out",
  "message": "Hi, following up on your citizenship inquiry.",
  "message_type": "text",
  "sent_at": "2026-08-09T12:30:00.000Z",
  "whatsapp_message_id": "partner_wamid_1723200000000",
  "whatsapp_status": "sent",
  "whatsapp_timestamp": "2026-08-09T12:30:00.000Z",
  "is_read": true
}
```

#### Example: inbound WhatsApp

```json
{
  "lead_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "phone_number": "972501234567",
  "sender_name": "John Smith",
  "direction": "in",
  "message": "Thanks, can we speak tomorrow?",
  "message_type": "text",
  "sent_at": "2026-08-09T13:10:00.000Z",
  "whatsapp_message_id": "partner_wamid_1723200001000",
  "whatsapp_status": "delivered",
  "is_read": false
}
```

#### JavaScript (Supabase client)

```javascript
const now = new Date();

const { data: lead } = await supabase
  .from("leads")
  .select("id, name, phone")
  .eq("lead_number", "L12345")
  .single();

await supabase.from("whatsapp_messages").insert({
  lead_id: lead.id,
  phone_number: lead.phone,
  sender_name: "Partner Firm Desk",
  direction: "out",
  message: "WhatsApp follow-up sent.",
  message_type: "text",
  sent_at: now.toISOString(),
  whatsapp_status: "sent",
  is_read: true,
});
```

### 3.5 How to read WhatsApp messages

#### By lead UUID

```http
GET /rest/v1/whatsapp_messages?lead_id=eq.<lead-uuid>&select=id,lead_id,contact_id,phone_number,sender_name,direction,message,message_type,sent_at,whatsapp_status,whatsapp_message_id,media_url,caption,voice_note,is_read,template_id&order=sent_at.asc&limit=200
```

#### By phone number

```http
GET /rest/v1/whatsapp_messages?phone_number=eq.972501234567&order=sent_at.asc
```

#### By contact

```http
GET /rest/v1/whatsapp_messages?contact_id=eq.12345&order=sent_at.asc
```

#### Unread inbound for a lead

```http
GET /rest/v1/whatsapp_messages?lead_id=eq.<lead-uuid>&direction=eq.in&is_read=eq.false&select=id,message,sent_at,phone_number
```

#### Useful select (matches CRM chat helpers)

```
id, lead_id, contact_id, phone_number, sender_name, direction, message, message_type, caption, voice_note, media_url, media_filename, sent_at, whatsapp_status, whatsapp_message_id, template_id, is_read
```

### 3.6 Common mistakes (`whatsapp_messages`)

| Mistake | Fix |
| ------- | --- |
| Using `direction: "outgoing"` / `"incoming"` | Use `out` / `in` |
| Omitting `lead_id` | Always set `lead_id` = `leads.id` (UUID) for a known lead |
| Using a numeric lead id | New leads use UUID only — look up via `leads.lead_number` |
| `message_type: "template"` | Use `text` + optional `template_id` |
| Missing `phone_number` | Set it so the WhatsApp inbox can group the chat |
| Using email-style `client_id` column | WhatsApp uses **`lead_id`**, not `client_id` |

---

## 4. Side effects & permissions notes

| Topic | Detail |
| ----- | ------ |
| **Stage auto-update** | Rows linked to a lead (`emails.client_id` / `whatsapp_messages.lead_id`) can feed `evaluate_and_update_stage` (precommunication / communication started). |
| **RLS / grants (PEX)** | Run `sql/pex_agent_emails_whatsapp_access.sql` (also included in `sql/pex_agent_integration.sql`). Grants `anon` **SELECT + INSERT** on `emails` and `whatsapp_messages`. Inserts must link to an existing `leads.id` UUID; no UPDATE/DELETE. |
| **Sending vs logging** | Inserting a row **logs** the message in CRM. It does **not** by itself send via Meta WhatsApp or Microsoft Graph. |
| **Manual interactions alternative** | If you only need a timeline summary (not full mail/chat bodies), see `docs/PEX_MANUAL_INTERACTIONS_GUIDE.md` (`lead_manual_interactions`). |

---

## 5. Quick cheat sheet

| Action | Table | Key filter / field |
| ------ | ----- | ------------------ |
| Read emails for a lead | `emails` | `client_id=eq.<uuid>` |
| Insert email | `emails` | `client_id` + `direction` = `outgoing` \| `incoming` |
| Read WhatsApp for a lead | `whatsapp_messages` | `lead_id=eq.<uuid>` |
| Insert WhatsApp | `whatsapp_messages` | `lead_id` + `direction` = `out` \| `in` |
| Resolve lead UUID | `leads` | `lead_number=eq.L…` → `id` |

---

## 6. Related docs

| Doc | Use when |
| --- | -------- |
| `docs/CRM_LEAD_INTAKE_FIELDS_AND_STAGE_GUIDE.md` | Lead fields, stages, meetings |
| `docs/PEX_MANUAL_INTERACTIONS_GUIDE.md` | Lightweight outreach logging without full email/WhatsApp bodies |
| `docs/PARTNER_MEETING_WEBHOOK.md` | Partner meeting booking webhook |
