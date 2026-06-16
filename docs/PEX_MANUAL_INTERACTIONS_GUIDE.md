# PEX — Logging outreach in the CRM

Simple guide for inserting manual interactions via Supabase.

---

## Important change

**Do not** update `leads.manual_interactions` (JSON) anymore.

**Do** insert one row into:

**`lead_manual_interactions`**

The CRM syncs that row automatically to the lead timeline and stage logic.

---

## What you can read

| Table              | Purpose                                           |
| ------------------ | ------------------------------------------------- |
| `leads`            | Find leads (`id` is a UUID)                       |
| `misc_leadsource`  | Lead source lookup                                |
| `misc_language`    | Language lookup                                   |
| `tenants_employee` | Only employee **id = 177** (your service account) |

You can **SELECT** and **INSERT** on `lead_manual_interactions` only.  
You cannot change lead data, finances, or other tables.

---

## Service employee

All interactions must use:

**`employee_id`: `177`**

You do not need to send the employee name — the database fills `employee` from our staff directory.  
You may optionally read the name:

```
GET /rest/v1/tenants_employee?id=eq.177&select=id,display_name
```

---

## How to log an interaction

**Endpoint**

```
POST /rest/v1/lead_manual_interactions
Content-Type: application/json
Prefer: return=minimal
```

### Required fields

| Field         | Rule                                                               |
| ------------- | ------------------------------------------------------------------ |
| `id`          | Unique string: `manual_<timestamp_ms>` e.g. `manual_1717772400000` |
| `lead_id`     | UUID from `leads.id`                                               |
| `employee_id` | Always `177`                                                       |
| `kind`        | `email`, `whatsapp`, `call`, `sms`, or `office`                    |
| `direction`   | `out` (we contacted client) or `in` (client contacted us)          |
| `raw_date`    | ISO datetime, e.g. `2026-06-07T12:30:00.000Z`                      |

### Recommended fields

| Field              | Rule                                        |
| ------------------ | ------------------------------------------- |
| `interaction_date` | `DD/MM/YY` e.g. `07/06/26`                  |
| `interaction_time` | `HH:MM` 24h e.g. `14:30`                    |
| `recipient_name`   | Client name (use `leads.name` for outbound) |
| `content`          | Short summary of the outreach               |
| `observation`      | Optional internal note                      |
| `length`           | For calls: e.g. `"5m"`                      |
| `minutes`          | For calls: integer e.g. `5`                 |
| `editable`         | Use `false` for agent-created rows          |

### Outbound vs inbound names

**Outbound** (`direction: "out"`) — we contacted the client:

- `recipient_name` → client / lead name
- `employee` → auto-filled from employee 177

**Inbound** (`direction: "in"`) — client contacted us:

- `employee` → client / contact name (set explicitly)
- `recipient_name` → employee 177’s display name (from lookup above)

---

## Example: outbound email

```json
{
  "id": "manual_1717772400000",
  "lead_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "employee_id": 177,
  "kind": "email",
  "direction": "out",
  "interaction_date": "07/06/26",
  "interaction_time": "14:30",
  "raw_date": "2026-06-07T12:30:00.000Z",
  "recipient_name": "John Smith",
  "content": "Follow-up email sent regarding citizenship inquiry.",
  "observation": "",
  "editable": false
}
```

## Example: outbound call (over 2 minutes)

```json
{
  "id": "manual_1717772500000",
  "lead_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "employee_id": 177,
  "kind": "call",
  "direction": "out",
  "interaction_date": "07/06/26",
  "interaction_time": "14:35",
  "raw_date": "2026-06-07T12:35:00.000Z",
  "recipient_name": "John Smith",
  "content": "Outbound call – discussed next steps.",
  "length": "5m",
  "minutes": 5,
  "editable": false
}
```

---

## Finding a lead first

Example — get lead UUID by lead number:

```
GET /rest/v1/leads?lead_number=eq.L12345&select=id,name,lead_number
```

Use the returned `id` as `lead_id` in your insert.

---

## JavaScript (Supabase client)

```javascript
const now = new Date();

const { data: lead } = await supabase
  .from("leads")
  .select("id, name")
  .eq("lead_number", "L12345")
  .single();

await supabase.from("lead_manual_interactions").insert({
  id: `manual_${now.getTime()}`,
  lead_id: lead.id,
  employee_id: 177,
  kind: "whatsapp",
  direction: "out",
  interaction_date: now.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }),
  interaction_time: now.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }),
  raw_date: now.toISOString(),
  recipient_name: lead.name,
  content: "WhatsApp follow-up sent.",
  editable: false,
});
```

---

## Common mistakes

| Mistake                              | Fix                                                |
| ------------------------------------ | -------------------------------------------------- |
| Updating `leads.manual_interactions` | Insert into `lead_manual_interactions` only        |
| Missing or wrong `employee_id`       | Always use `177`                                   |
| Using numeric lead id                | Use UUID `leads.id`, not legacy tables             |
| Duplicate `id`                       | Generate a new `manual_<timestamp>` each time      |
| Invalid `kind`                       | Only: `email`, `whatsapp`, `call`, `sms`, `office` |
