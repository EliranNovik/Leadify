# Lead Webhook API Documentation

## Endpoint

```
POST https://leadify-crm-backend.onrender.com/api/hook/catch
```

## Overview

This webhook endpoint accepts lead data and creates new leads in the CRM system. It automatically detects duplicates and handles lead creation with source validation.

## Request Format

### HTTP Method

`POST`

### Content-Type

`application/json`

### Headers

```
Content-Type: application/json
```

## Request Body Schema

### Required Fields

- `name` (string) - Lead's full name
- `email` (string) - Lead's email address

### Optional Fields

- `phone` (string) - Lead's phone number
- `topic` (string) - Lead topic/subject
- `facts` (string) - Additional information/description about the lead (also accepts `desc` as alias)
- `source` (string) - Source of the lead (defaults to "webhook" if not provided)
- `language` (string) - Lead's language preference (defaults to "English" if not provided)
- `source_code` (integer) - Numeric source code that must match an existing source in `misc_leadsource.code` (also accepts `lead_source` as alias)

## Field Aliases

The API accepts alternative field names for some fields:

- `source_code` OR `lead_source` - Both map to the same source code field
- `facts` OR `desc` - Both map to the same facts/description field

## Example Request

### Minimal Request (Required Fields Only)

```json
{
  "name": "John Doe",
  "email": "john.doe@example.com"
}
```

### Complete Request (All Fields)

```json
{
  "name": "John Doe",
  "email": "john.doe@example.com",
  "phone": "050-1234567",
  "topic": "Immigration Services",
  "facts": "Interested in visa application for USA",
  "source": "Website Contact Form",
  "language": "English",
  "source_code": 101
}
```

### Using Field Aliases

```json
{
  "name": "Jane Smith",
  "email": "jane.smith@example.com",
  "phone": "054-9876543",
  "topic": "Legal Consultation",
  "desc": "Need advice on contract review",
  "lead_source": 102,
  "source": "Partner Portal"
}
```

## Response Format

### Success Response (201 Created)

```json
{
  "success": true,
  "message": "Lead created successfully",
  "data": {
    "lead_number": "L123456",
    "id": "uuid-here",
    "name": "John Doe",
    "email": "john.doe@example.com",
    "source_id": 101,
    "source_name": "Website Contact Form",
    "final_topic": "Immigration Services",
    "final_category_id": 5,
    "created_at": "2025-12-14T10:00:00.000Z"
  }
}
```

### Duplicate Lead Response (200 OK)

If a duplicate lead is detected (matching email, phone, or name):

```json
{
  "success": true,
  "duplicate": true,
  "message": "Potential duplicate detected. Lead stored for review.",
  "existing_lead_id": "uuid-of-existing-lead",
  "duplicate_fields": ["email", "phone"]
}
```

### Error Response (400 Bad Request)

```json
{
  "error": "Missing required fields: name and email are required"
}
```

### Error Response (500 Internal Server Error)

```json
{
  "error": "Failed to create lead",
  "details": "Error message details here"
}
```

## Duplicate Detection

The system automatically checks for duplicates based on:

- **Email** - Exact match (case-insensitive)
- **Phone** - Exact match
- **Name** - Exact match (case-insensitive, trimmed)

If a duplicate is found:

1. The lead data is stored in the `double_leads` table for manual review
2. A response is returned indicating the duplicate
3. The original lead ID is included in the response

## Source Code Validation

The `source_code` field must be a valid 32-bit integer (between -2,147,483,648 and 2,147,483,647) that exists in the `misc_leadsource` table's `code` column.

- Valid: `101`, `"101"` (will be converted to integer)
- Invalid: `null`, `""`, `"abc"`, values outside 32-bit integer range

If an invalid source code is provided, it will be stored as `null` and the lead will still be created with the default source handling.

## Language Handling

The `language` field accepts any string value. Common values:

- `"English"` (default)
- `"Hebrew"` / `"עברית"`
- `"Russian"` / `"Русский"`
- Any other language identifier

## Testing

### Using cURL

```bash
curl -X POST https://leadify-crm-backend.onrender.com/api/hook/catch \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Lead",
    "email": "test@example.com",
    "phone": "050-1234567",
    "topic": "Test Topic",
    "facts": "This is a test lead from webhook"
  }'
```

### Using JavaScript (fetch)

```javascript
fetch("https://leadify-crm-backend.onrender.com/api/hook/catch", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    name: "Test Lead",
    email: "test@example.com",
    phone: "050-1234567",
    topic: "Test Topic",
    facts: "This is a test lead from webhook",
  }),
})
  .then((response) => response.json())
  .then((data) => console.log("Success:", data))
  .catch((error) => console.error("Error:", error));
```

### Using Python (requests)

```python
import requests

url = 'https://leadify-crm-backend.onrender.com/api/hook/catch'
payload = {
    'name': 'Test Lead',
    'email': 'test@example.com',
    'phone': '050-1234567',
    'topic': 'Test Topic',
    'facts': 'This is a test lead from webhook'
}

response = requests.post(url, json=payload)
print(response.json())
```

## Rate Limiting

There are no explicit rate limits on this endpoint. However, please be reasonable with request frequency. If you need to send multiple leads, consider batching them or spacing requests appropriately.

## Security

- The endpoint accepts requests from any origin (no authentication required)
- All input is validated before processing
- Duplicate detection prevents spam/duplicate entries
- Invalid data is rejected with appropriate error messages

## Best Practices

1. **Always include email** - This is the primary identifier for duplicate detection
2. **Normalize phone numbers** - Remove formatting for consistent matching
3. **Use descriptive source values** - Helps track where leads come from
4. **Handle duplicate responses** - Check for `duplicate: true` in responses
5. **Include facts/description** - Provides context about the lead's needs
6. **Validate source_code** - Ensure it exists in your system before sending

## Support

For issues or questions about this webhook API, please contact your CRM administrator.
