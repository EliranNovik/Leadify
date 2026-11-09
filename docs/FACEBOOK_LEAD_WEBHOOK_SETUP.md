# Facebook Lead Ads → CRM webhook

## What to configure in Meta

| Item                        | Value                                                                    |
| --------------------------- | ------------------------------------------------------------------------ |
| Callback URL                | `https://leadify-crm-backend.onrender.com/api/hook/facebook`             |
| Verify token                | The exact string the CRM team sends you. It is not written in this file. |
| Webhook field               | `leadgen` on the **Page** object                                         |
| Graph version the CRM calls | `v21.0` (unless the CRM team says otherwise)                             |

Do not use `/api/hook/catch`. That address is a different form webhook and will not read a Facebook lead.

## 1. App and webhook

1. Open [Meta for Developers](https://developers.facebook.com/) and use the Meta app that belongs to the same Business Manager as the Facebook Page.
2. Add the **Webhooks** product if it is not already there.
3. Open **Webhooks**, choose the **Page** object, and click **Edit subscription** (or **Subscribe to this object**).
4. Set:
   - **Callback URL:** `https://leadify-crm-backend.onrender.com/api/hook/facebook`
   - **Verify token:** the token from the CRM team, character for character.
5. Save. Meta sends a GET request. The CRM answers with the challenge only when the token matches. A wrong token comes back as `403 Verification failed`.
6. On the Page webhook, subscribe to the field **`leadgen`**. Leave other fields unsubscribed unless the CRM team asks for them.

The CRM does not check Meta’s `X-Hub-Signature`. You do not need to send the app secret to the CRM. You still keep an app secret in Meta; Meta uses it on its side.

## 2. Subscribe the Facebook Page

The app webhook is not enough. The Page itself must be subscribed to this app for `leadgen`, or new leads never leave Facebook.

Use a **Page** access token (not a user token) for the Page that owns the lead form:

```http
POST https://graph.facebook.com/v21.0/{PAGE_ID}/subscribed_apps
  ?subscribed_fields=leadgen
  &access_token={PAGE_ACCESS_TOKEN}
```

A successful response is `{ "success": true }`.

Confirm it:

```http
GET https://graph.facebook.com/v21.0/{PAGE_ID}/subscribed_apps?access_token={PAGE_ACCESS_TOKEN}
```

`leadgen` must appear in `subscribed_fields` for this app.

In Business Manager, the app (or the system user that owns the token) also needs access to that Page’s leads:

- Business Settings → Accounts → Pages → the Page → assign the app or system user.
- Lead Access Manager for that Page: the same app or system user must be allowed to read leads.

## 3. Page access token the CRM must store

After Meta notifies the CRM, the server loads the form answers with:

`GET https://graph.facebook.com/v21.0/{leadgen_id}?fields=field_data,created_time,ad_id,form_id,page_id`

That call uses a token stored on the CRM, chosen in this order:

1. `FB_PAGE_ACCESS_TOKEN_{PAGE_ID}` when that page has its own token
2. otherwise `FB_PAGE_ACCESS_TOKEN`

Send the CRM team, over a private channel (not email if you can avoid it, not this document):

- The numeric **Page ID**
- A **long-lived Page access token** for that Page
- Each **Instant Form ID** that should land in a specific CRM source (see section 5)

Token permissions:

- `leads_retrieval` (required to read the lead)
- `pages_manage_metadata` (required to subscribe the Page)
- `pages_show_list`
- `pages_read_engagement`

Create it from a system user in Business Settings so it does not expire with a person’s login:

1. Business Settings → Users → System users → add an admin system user.
2. Add assets: this Facebook Page, and the ad account that runs the lead ads.
3. Generate a token with the permissions above.
4. Exchange it for a long-lived token if Meta still shows a short-lived one.
5. Send that token and the Page ID to the CRM team. They add it as `FB_PAGE_ACCESS_TOKEN_{PAGE_ID}` and restart the API.

If this token is missing or cannot read the Page, Meta still gets `{ "received": true }` and **no lead is created**.

## 4. Instant Form questions

Use Facebook’s built-in question types. The CRM reads `field_data[].name` exactly.

| Form question                                                           | Facebook field name       | Required in the CRM                              |
| ----------------------------------------------------------------------- | ------------------------- | ------------------------------------------------ |
| Full name                                                               | `full_name`               | Yes, unless first and last name are both present |
| First name + last name                                                  | `first_name`, `last_name` | Together they replace full name                  |
| Email                                                                   | `email`                   | Yes                                              |
| Phone                                                                   | `phone_number`            | No                                               |
| A custom question whose key is `about`, `additional_info`, or `message` | those names               | No. Saved as the lead topic                      |

Name and email are both required. If either is empty, the CRM logs the lead and drops it. Meta has already been told the webhook succeeded, so Facebook will not retry.

Custom questions only work when their field key is one of the names above. A label such as “Your email address” does not map. Prefer the standard Full name, Email, and Phone fields.

Language on these leads is stored as English (`EN`). Source is stored as Facebook. The creator is `facebook@webhook`.

## 5. Which CRM source the lead is filed under

Every lead needs a numeric CRM source code (`misc_leadsource.code`). The CRM picks the first match:

1. A form answer whose field name is `source_code`, `source code`, `source-code`, `sourceCode`, or `source_code_value`, and whose value is a whole number.
2. A mapping the CRM team stores for this **form id** (`FACEBOOK_FORM_SOURCE_CODES`).
3. The form id itself, if it is already that integer code.
4. The CRM’s default Facebook source (`FACEBOOK_DEFAULT_SOURCE_CODE`), if one is set.

If none of these exist, the lead is skipped.

Send the CRM team each form id and the source code they should use, for example form `123456789012345` → source code `101`. They store that map. You do not put the map in Meta, unless you also add a hidden or custom `source_code` question with the integer.

## 6. What Meta sends, and what the CRM answers

Meta `POST`s JSON like this:

```json
{
  "object": "page",
  "entry": [
    {
      "id": "PAGE_ID",
      "time": 1710000000,
      "changes": [
        {
          "field": "leadgen",
          "value": {
            "leadgen_id": "LEAD_ID",
            "page_id": "PAGE_ID",
            "form_id": "FORM_ID",
            "ad_id": "AD_ID",
            "created_time": 1710000000
          }
        }
      ]
    }
  ]
}
```

When the CRM webhook is switched on, the HTTP answer is always:

```json
{ "received": true }
```

with status `200`. That answer is sent before the lead is saved. A later failure (bad token, missing email, unknown source code) does **not** change this response and does **not** make Facebook retry.

If the CRM webhook switch is off, the answer is `503` and no lead is saved. Ask the CRM team to turn `webhook_settings` back on.

The CRM reads only the first change in the first `entry`. One test lead per request is the normal Meta payload. Do not batch several leads into one call.

## 7. Test from Meta

1. In Meta, open Lead Ads Testing Tool (or the form’s **Test lead** / **Track status** tools) and send a test lead for this Page and form.
2. Use a real-looking name and email. An empty email will be dropped.
3. Ask the CRM team to confirm a new lead from `facebook@webhook` with that email.

You can also fire a leadgen test from the Webhooks dashboard (**Test** button on the `leadgen` field). That checks that Meta can reach the callback. It does not by itself prove the Page token can read form answers. A real or tool-generated test lead does.

Manual check that the callback is public:

```bash
curl -s "https://leadify-crm-backend.onrender.com/api/hook/facebook?hub.mode=subscribe&hub.verify_token=THE_TOKEN_FROM_THE_CRM&hub.challenge=12345"
```

A correct token returns `12345`. A wrong token returns `Verification failed`.

## 8. Checklist to send back to the CRM

- Page name and numeric Page ID
- Long-lived Page access token for that Page ID
- Each Instant Form ID, plus the CRM source code it should use
- Confirmation that the Page subscription includes `leadgen`
- Confirmation that Lead Access Manager allows this app or system user to read leads
- A test lead email you submitted, so the CRM can find the row

## If a test lead does not appear

| What you see                                    | What it means                                                                                                                                                                                   |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Meta says the callback could not be verified    | The verify token does not match the CRM, or the URL is not exactly `/api/hook/facebook`.                                                                                                        |
| Meta shows the webhook delivery failed with 503 | The CRM webhook switch is off.                                                                                                                                                                  |
| Meta shows HTTP 200, and the CRM has no lead    | The Page token is missing or cannot read `leadgen_id`, or the form has no name and email, or no source code could be resolved. Send the CRM the Page ID, form ID, and leadgen ID from the test. |
| The lead is on the wrong source                 | Send the form id so the CRM can map it, or put the integer in a `source_code` answer.                                                                                                           |
