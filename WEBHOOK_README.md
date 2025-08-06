# Webhook API Documentation

## Overview

This webhook endpoint allows you to receive form data from external sources and automatically create new leads in your CRM system.

## Endpoints

### POST `/api/hook/catch`

Receives form data and creates a new lead.

**URL:** `http://localhost:3001/api/hook/catch`

**Method:** `POST`

**Content-Type:** `application/json`

### GET `/api/hook/health`

Health check endpoint for the webhook.

**URL:** `http://localhost:3001/api/hook/health`

**Method:** `GET`

## Request Format

### Required Fields

- `name` (string): The lead's full name
- `email` (string): The lead's email address

### Optional Fields

- `phone` (string): Phone number
- `mobile` (string): Mobile number
- `company` (string): Company name
- `position` (string): Job position
- `topic` (string): Topic/category (e.g., "German Citizenship", "Austrian Citizenship")
- `category` (string): Alternative to topic
- `country` (string): Country
- `city` (string): City
- `address` (string): Full address
- `comments` (string): Additional comments or message
- `message` (string): Alternative to comments
- `source` (string): Lead source (defaults to "Web Form")
- `custom_fields` (object): Any additional custom fields
- `utm_source` (string): UTM source parameter
- `utm_medium` (string): UTM medium parameter
- `utm_campaign` (string): UTM campaign parameter
- `utm_term` (string): UTM term parameter
- `utm_content` (string): UTM content parameter
- `referral_source` (string): Referral source
- `referral_code` (string): Referral code

## Response Format

### Success Response (201 Created)

```json
{
  "success": true,
  "message": "Lead created successfully",
  "data": {
    "lead_number": "L2025001",
    "id": 123,
    "name": "John Doe",
    "email": "john@example.com",
    "created_at": "2025-01-04T14:30:00.000Z"
  }
}
```

### Error Response (400 Bad Request)

```json
{
  "success": false,
  "error": "Missing required fields: name and email are required"
}
```

### Error Response (500 Internal Server Error)

```json
{
  "success": false,
  "error": "Failed to create lead",
  "details": "Database error message"
}
```

## Example Usage

### JavaScript/Fetch

```javascript
const formData = {
  name: "John Doe",
  email: "john@example.com",
  phone: "+1234567890",
  topic: "German Citizenship",
  company: "ABC Corp",
  comments: "Interested in German citizenship process",
};

fetch("http://localhost:3001/api/hook/catch", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify(formData),
})
  .then((response) => response.json())
  .then((data) => {
    if (data.success) {
      console.log("Lead created:", data.data.lead_number);
    } else {
      console.error("Error:", data.error);
    }
  });
```

### cURL

```bash
curl -X POST http://localhost:3001/api/hook/catch \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Doe",
    "email": "john@example.com",
    "phone": "+1234567890",
    "topic": "German Citizenship"
  }'
```

### HTML Form

```html
<form action="http://localhost:3001/api/hook/catch" method="POST">
  <input type="text" name="name" placeholder="Name" required />
  <input type="email" name="email" placeholder="Email" required />
  <input type="tel" name="phone" placeholder="Phone" />
  <select name="topic">
    <option value="German Citizenship">German Citizenship</option>
    <option value="Austrian Citizenship">Austrian Citizenship</option>
  </select>
  <textarea name="comments" placeholder="Comments"></textarea>
  <button type="submit">Submit</button>
</form>
```

## Lead Number Generation

The system automatically generates lead numbers in the format: `L{year}{sequential_number}`

Examples:

- `L2025001` (First lead of 2025)
- `L2025002` (Second lead of 2025)
- `L2025003` (Third lead of 2025)

## Testing

1. Start your backend server:

   ```bash
   cd backend
   npm start
   ```

2. Open `test-webhook.html` in your browser to test the webhook functionality.

3. Fill out the form and submit to create a test lead.

## Security Considerations

- The webhook endpoint is currently open and doesn't require authentication
- Consider adding API key authentication for production use
- Implement rate limiting to prevent abuse
- Add input validation and sanitization
- Use HTTPS in production

## Database Schema

The webhook creates leads in the `leads` table with the following structure:

```sql
CREATE TABLE leads (
  id SERIAL PRIMARY KEY,
  lead_number VARCHAR(20) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(50),
  mobile VARCHAR(50),
  topic VARCHAR(100),
  stage VARCHAR(50) DEFAULT 'created',
  status VARCHAR(50) DEFAULT 'new',
  source VARCHAR(100) DEFAULT 'Web Form',
  company VARCHAR(255),
  position VARCHAR(255),
  country VARCHAR(100),
  city VARCHAR(100),
  address TEXT,
  comments TEXT,
  custom_fields JSONB,
  utm_source VARCHAR(100),
  utm_medium VARCHAR(100),
  utm_campaign VARCHAR(100),
  utm_term VARCHAR(100),
  utm_content VARCHAR(100),
  referral_source VARCHAR(100),
  referral_code VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

## Troubleshooting

1. **Server not running**: Make sure your backend server is running on port 3001
2. **CORS issues**: The server is configured to accept requests from `http://localhost:5173`
3. **Database connection**: Ensure your Supabase credentials are correctly configured in `.env`
4. **Missing fields**: Check that required fields (name, email) are provided
5. **Lead number conflicts**: The system automatically handles lead number generation

## Logs

The webhook logs all incoming requests and responses. Check your server console for:

- 📥 Incoming webhook requests
- ✅ Successful lead creation
- ❌ Error messages and details
