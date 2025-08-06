# WhatsApp Integration Setup Guide

## Prerequisites

1. **WhatsApp Business API Account**

   - Sign up for WhatsApp Business API
   - Get your Phone Number ID and Access Token
   - Set up webhook verification

2. **Environment Variables**
   Add these to your `.env` file:

```env
# WhatsApp API Configuration
WHATSAPP_API_URL=https://graph.facebook.com/v18.0
PHONE_NUMBER_ID=your_phone_number_id
VERIFY_TOKEN=your_webhook_verify_token
WHATSAPP_ACCESS_TOKEN=your_whatsapp_access_token

# Supabase Configuration (already exists)
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
```

## Database Setup

Run the SQL script to update the `whatsapp_messages` table:

```sql
-- Run this in your Supabase SQL editor
-- File: sql/update_whatsapp_messages_table.sql
```

## Backend Setup

1. **Install Dependencies**

   ```bash
   cd backend
   npm install axios form-data multer
   ```

2. **Create Uploads Directory**

   ```bash
   mkdir -p backend/uploads
   ```

3. **Add File Upload Middleware**
   Add this to your `backend/server.js`:

```javascript
const multer = require("multer");
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 16 * 1024 * 1024 }, // 16MB limit
});

// Add this route for file uploads
app.post(
  "/api/whatsapp/upload-media",
  upload.single("file"),
  whatsappController.uploadMedia
);

// Serve uploaded files
app.use("/api/uploads", express.static(path.join(__dirname, "uploads")));
```

## WhatsApp Webhook Configuration

1. **Set Webhook URL**

   - URL: `https://your-domain.com/api/whatsapp/webhook`
   - Verify Token: Use the same value as `VERIFY_TOKEN` in your `.env`

2. **Webhook Fields**
   - `messages` - for incoming messages
   - `message_status` - for delivery status updates

## Frontend Integration

The WhatsApp page has been updated with:

- Real WhatsApp API integration
- Media file upload and sending
- Message status indicators
- Support for images, documents, audio, video, location, and contacts

## Testing

1. **Test Webhook Verification**

   ```bash
   curl "https://your-domain.com/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=your_token&hub.challenge=test"
   ```

2. **Test Message Sending**

   - Go to WhatsApp page
   - Select a client with a phone number
   - Send a text message
   - Check if it appears in WhatsApp

3. **Test Media Sending**
   - Click the paperclip icon
   - Select an image or document
   - Add a caption (optional)
   - Send the media

## Troubleshooting

### Common Issues

1. **Webhook Verification Fails**

   - Check that `VERIFY_TOKEN` matches your webhook configuration
   - Ensure the webhook URL is accessible

2. **Messages Not Sending**

   - Verify `WHATSAPP_ACCESS_TOKEN` is correct
   - Check `PHONE_NUMBER_ID` is valid
   - Ensure phone numbers are in international format (+1234567890)

3. **Media Not Uploading**

   - Check file size limits (16MB max)
   - Verify supported file types
   - Check uploads directory permissions

4. **Database Errors**
   - Run the SQL script to update table schema
   - Check RLS policies are correct
   - Verify Supabase connection

### Debug Logs

Check backend console for:

- Webhook verification logs
- Message processing logs
- Media upload logs
- Database operation logs

## Security Considerations

1. **Environment Variables**

   - Never commit `.env` files to version control
   - Use strong, unique tokens
   - Rotate tokens regularly

2. **File Uploads**

   - Validate file types and sizes
   - Scan uploaded files for malware
   - Implement proper access controls

3. **Webhook Security**
   - Use HTTPS for webhook URLs
   - Validate webhook signatures
   - Implement rate limiting

## API Endpoints

### Backend Endpoints

- `GET /api/whatsapp/webhook` - Webhook verification
- `POST /api/whatsapp/webhook` - Receive messages
- `POST /api/whatsapp/send-message` - Send text message
- `POST /api/whatsapp/send-media` - Send media message
- `POST /api/whatsapp/upload-media` - Upload media file
- `GET /api/whatsapp/message-status/:messageId` - Get message status
- `GET /api/whatsapp/conversation/:leadId` - Get conversation history

### Frontend Integration

The WhatsApp page now:

- Sends real WhatsApp messages
- Receives incoming messages via webhook
- Supports all media types
- Shows message delivery status
- Stores all messages in database

## Next Steps

1. **Production Deployment**

   - Deploy to production server
   - Set up SSL certificates
   - Configure production environment variables

2. **Monitoring**

   - Set up error monitoring
   - Monitor webhook delivery
   - Track message success rates

3. **Features**
   - Add message templates
   - Implement quick replies
   - Add conversation analytics
   - Set up automated responses
