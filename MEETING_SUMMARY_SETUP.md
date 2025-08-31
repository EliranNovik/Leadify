# Meeting Summary System Setup

## Overview

This system automatically transcribes Teams meetings, generates AI-powered summaries in Hebrew and English, and provides a seamless workflow for your citizenship law office.

## Features

- ✅ **Microsoft Graph API Integration**: Automatic Teams transcript fetching
- ✅ **Automatic Transcription**: Teams meetings are automatically transcribed
- ✅ **AI Summary Generation**: GPT-4 powered summaries in Hebrew and English
- ✅ **Genealogical Data Extraction**: Persecuted person, family members, documents
- ✅ **Action Items Extraction**: Automatic identification of tasks and deadlines
- ✅ **Risk Assessment**: AI identifies potential legal risks and concerns
- ✅ **Zero-Click Workflow**: Join call, hang up, summary is ready
- ✅ **Auto-Email**: Optional automatic email to clients
- ✅ **Bilingual Support**: Hebrew and English summaries
- ✅ **Questionnaire Data**: Structured extraction of meeting information

## Architecture

### 1. Database Tables

```sql
-- Meeting transcripts
meeting_transcripts (id, meeting_id, text, source, language, raw_transcript)

-- AI-generated summaries
meeting_summaries (id, meeting_id, summary_he, summary_en, model, tokens_used, action_items, risks)

-- Structured questionnaire data
meeting_questionnaires (id, meeting_id, payload, version)

-- Enhanced meetings table
meetings (teams_id, meeting_subject, started_at, ended_at, transcript_url)

-- Client preferences
leads (auto_email_meeting_summary, language_preference)
```

### 2. Edge Function

**Location**: `supabase/functions/meeting-summary/index.ts`

**Features**:

- Language detection (Hebrew/English/Mixed)
- VTT to plain text conversion
- OpenAI GPT-4 integration
- Automatic database storage
- Auto-email functionality

### 3. Frontend Components

- **MeetingSummaryComponent**: Displays summaries with language toggle
- **API Service**: `src/lib/meetingSummaryApi.ts`
- **Integration**: Embedded in MeetingTab

## Setup Instructions

### Step 1: Database Setup

Run the SQL script to create the required tables:

```bash
# Execute the SQL file
psql -d your_database -f sql/create_meeting_summary_tables.sql
```

### Step 2: Deploy Edge Function

```bash
# Deploy the meeting-summary function
supabase functions deploy meeting-summary
```

### Step 3: Environment Variables

Set these environment variables in your Supabase project:

```bash
OPENAI_API_KEY=your_openai_api_key
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

### Step 4: Microsoft Graph API Setup

#### Required Permissions

The system requires these Microsoft Graph API permissions:

**Application Permissions (Admin Consent Required):**

- `OnlineMeetingArtifact.Read.All` - Access meeting transcripts
- `Files.Read.All` - Access meeting files
- `User.Read.All` - Read user information
- `Calendars.Read.All` - Access meeting details

**Delegated Permissions (User Consent):**

- `OnlineMeetingArtifact.Read.All`
- `Files.Read.All`
- `User.Read`
- `Calendars.Read`

#### Azure AD App Registration

1. Create Azure AD application in [Azure Portal](https://portal.azure.com)
2. Configure API permissions for Microsoft Graph
3. Grant admin consent
4. Create client secret
5. Add environment variables:

```bash
AZURE_CLIENT_ID=your-application-id
AZURE_CLIENT_SECRET=your-client-secret
AZURE_TENANT_ID=your-tenant-id
```

**📋 Detailed setup guide**: See `MICROSOFT_GRAPH_SETUP.md`

### Step 5: Teams Configuration

#### Meeting Template Setup

1. Create a Teams meeting template named "Client Call (Auto-Summary)"
2. Enable transcription by default
3. Use subject pattern: `[#CLIENTID] Client Name – Topic`

#### Teams Admin Configuration

1. Go to **Microsoft Teams Admin Center**
2. Navigate to **Meetings** → **Meeting policies**
3. Enable **Allow transcription**
4. Set **Who can start transcription** to **Organizer and coorganizers**

### Step 5: Webhook Setup

Configure Graph webhooks to trigger the meeting summary processing:

```javascript
// Example webhook endpoint
POST /webhooks/graph
{
  "meetingId": "teams-meeting-id",
  "clientId": "client-id-from-subject",
  "transcriptText": "VTT transcript content",
  "transcriptUrl": "https://teams.com/transcript",
  "meetingSubject": "Meeting subject",
  "meetingStartTime": "2024-01-01T10:00:00Z",
  "meetingEndTime": "2024-01-01T11:00:00Z"
}
```

## Usage

### For Users

1. **Schedule Meeting**: Use the "Client Call (Auto-Summary)" template
2. **Join Call**: Normal Teams meeting with transcription enabled
3. **End Call**: Hang up normally
4. **View Summary**: Summary appears automatically in the client page

### For Administrators

#### Client Preferences

Set per-client preferences in the database:

```sql
UPDATE leads
SET auto_email_meeting_summary = true,
    language_preference = 'he'
WHERE id = 'client-id';
```

#### Manual Processing

If automatic processing fails, you can manually trigger:

```javascript
import { processMeetingSummary } from "../lib/meetingSummaryApi";

const result = await processMeetingSummary({
  meetingId: "teams-meeting-id",
  clientId: "client-id",
  transcriptText: "meeting transcript...",
});
```

## API Reference

### Edge Function

**Endpoint**: `POST /functions/v1/meeting-summary`

**Request Body**:

```typescript
{
  meetingId: string;        // Teams meeting ID
  clientId: string;         // Client ID from CRM
  transcriptText: string;   // VTT or plain text transcript
  transcriptUrl?: string;   // Optional transcript URL
  meetingSubject?: string;  // Meeting subject
  meetingStartTime?: string; // ISO timestamp
  meetingEndTime?: string;   // ISO timestamp
}
```

**Response**:

```typescript
{
  success: boolean;
  meetingId?: string;       // Database meeting ID
  summaryId?: string;       // Database summary ID
  error?: string;           // Error message if failed
}
```

### Frontend API

```typescript
// Get meeting summary
const summary = await getMeetingSummary(meetingId);

// Get all meeting data
const data = await getMeetingData(meetingId);

// Regenerate summary
const result = await regenerateMeetingSummary(meetingId);

// Send email to client
const success = await sendMeetingSummaryEmail(
  clientId,
  meetingId,
  summaryText,
  "he"
);
```

## AI Prompt Engineering

The system uses a carefully crafted prompt for legal meeting summaries:

### System Prompt

```
You are a meticulous CRM note-taker for a citizenship law office specializing in citizenship restoration for persecuted individuals and their descendants.
Return ONLY valid JSON. If information is missing, use null or [].

Rules:
- If transcript is Hebrew, do internal translation for the English summary
- Keep names, dates, and amounts exact
- No hallucinations. If unsure, use null
- Be concise but comprehensive in summaries
- Focus on legal implications, deadlines, and action items
- Pay special attention to genealogical data and persecution history
- Extract ALL available information about family members (parents, grandparents, great-grandparents)
- Document precise dates, places, and persecution details
- Note any mention of entry/exit from Germany or Austria with specific dates
- Capture full names, birth dates, birth places, countries of origin, and emigration details
- Document persecution types, dates, and locations mentioned
- Extract any mention of documents, certificates, or official records
```

### Output Format

```json
{
  "language_detected": "he" | "en" | "mixed",
  "summary_he": "Hebrew summary",
  "summary_en": "English summary",
  "answers": {
    "meeting_type": "string|null",
    "participants": ["string"],
    "key_facts": ["string"],
    "eligibility_points": ["string"],
    "action_items": ["string"],
    "deadlines": ["string"],
    "next_steps_owner": "string|null",
    "client_concerns": ["string"],
    "legal_implications": ["string"],
    "required_documents": ["string"],
    "persecuted_person": {
      "full_name": "string|null",
      "birth_date": "string|null",
      "birth_place": "string|null",
      "country_of_origin": "string|null",
      "persecution_type": "string|null",
      "persecution_dates": "string|null",
      "persecution_location": "string|null",
      "entry_germany_date": "string|null",
      "entry_austria_date": "string|null",
      "left_germany_date": "string|null",
      "left_austria_date": "string|null",
      "emigration_destination": "string|null",
      "emigration_date": "string|null"
    },
    "family_members": {
      "parents": ["object"],
      "grandparents": ["object"],
      "great_grandparents": ["object"]
    },
    "documents_mentioned": ["string"],
    "persecution_details": {
      "specific_events": ["string"],
      "locations": ["string"],
      "dates": ["string"],
      "types": ["string"]
    }
  },
  "action_items": [
    { "owner": "string|null", "task": "string", "due_date": "YYYY-MM-DD|null" }
  ],
  "risks": [ "string" ]
}
```

### Genealogical Data Extraction

The system now automatically extracts detailed genealogical and persecution data:

**Persecuted Person Information:**

- Full name, birth date, birth place, country of origin
- Persecution type, dates, and locations
- Entry/exit dates for Germany and Austria
- Emigration destination and date

**Family Members:**

- Parents, grandparents, and great-grandparents
- Names, birth dates, birth places
- Countries of origin and emigration details

**Documents Mentioned:**

- Birth certificates, marriage certificates, death certificates
- Passports, immigration papers, official records

**Persecution Details:**

- Specific events, locations, dates, and types of persecution

## Troubleshooting

### Common Issues

1. **No Summary Generated**

   - Check OpenAI API key
   - Verify transcript format
   - Check function logs

2. **Language Detection Issues**

   - Ensure Hebrew text contains Hebrew characters
   - Check transcript encoding

3. **Auto-Email Not Sending**
   - Verify client email exists
   - Check auto_email_meeting_summary setting
   - Review email permissions

### Debug Mode

Enable debug logging in the edge function:

```typescript
// Add to edge function
console.log("Processing meeting:", {
  meetingId,
  clientId,
  transcriptLength: transcriptText.length,
});
```

### Monitoring

Monitor function performance:

- Token usage per summary
- Processing time
- Error rates
- Language distribution

## Security Considerations

1. **Data Privacy**: Transcripts are processed by OpenAI
2. **Access Control**: RLS policies protect meeting data
3. **Token Management**: Monitor OpenAI usage
4. **Audit Trail**: All actions are logged

## Future Enhancements

1. **Custom Prompts**: Per-client or per-meeting-type prompts
2. **Multi-language Support**: Additional languages beyond Hebrew/English
3. **Integration**: Connect action items to task management systems
4. **Analytics**: Meeting insights and trends
5. **Voice Recognition**: Real-time transcription during calls

## Support

For issues or questions:

1. Check function logs in Supabase dashboard
2. Review OpenAI API usage and limits
3. Verify Teams transcription settings
4. Test with sample transcript data
