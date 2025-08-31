import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import OpenAI from 'https://esm.sh/openai@4.20.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Microsoft Graph API configuration
const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0';
const REQUIRED_SCOPES = [
  'OnlineMeetingArtifact.Read.All',
  'Files.Read.All',
  'User.Read',
  'Calendars.Read'
];

// Language detection function
function detectLanguage(text: string): 'he' | 'en' | 'mixed' {
  // Check for Hebrew characters
  if (/[\u0590-\u05FF]/.test(text)) {
    // If also contains English, it's mixed
    if (/[a-zA-Z]/.test(text)) {
      return 'mixed';
    }
    return 'he';
  }
  
  // Check for English
  if (/[a-zA-Z]/.test(text)) {
    return 'en';
  }
  
  // Default to mixed if unclear
  return 'mixed';
}

// Convert VTT to plain text
function vttToPlainText(vttContent: string): string {
  const lines = vttContent.split('\n');
  const textLines: string[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Skip timestamp lines and empty lines
    if (line === '' || line.includes('-->') || line.match(/^\d+$/) || line.startsWith('WEBVTT')) {
      continue;
    }
    
    // Add non-empty text lines
    if (line.length > 0) {
      textLines.push(line);
    }
  }
  
  return textLines.join(' ').replace(/\s+/g, ' ').trim();
}

// Get access token using service credentials (for Graph API access)
async function getServiceToken(): Promise<string | null> {
  try {
    const clientId = Deno.env.get('AZURE_CLIENT_ID');
    const clientSecret = Deno.env.get('AZURE_CLIENT_SECRET');
    const tenantId = Deno.env.get('AZURE_TENANT_ID');

    if (!clientId || !clientSecret || !tenantId) {
      console.error('Missing Azure AD configuration');
      return null;
    }

    const tokenResponse = await fetch(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          scope: 'https://graph.microsoft.com/.default',
          grant_type: 'client_credentials',
        }),
      }
    );

    if (!tokenResponse.ok) {
      console.error('Failed to get access token:', tokenResponse.status);
      return null;
    }

    const tokenData = await tokenResponse.json();
    return tokenData.access_token;
  } catch (error) {
    console.error('Error getting service token:', error);
    return null;
  }
}

// Get access token from Supabase auth (fallback for user-specific access)
async function getAccessToken(userId: string): Promise<string | null> {
  try {
    const { data: { user }, error } = await supabase.auth.admin.getUserById(userId);
    if (error || !user) {
      console.error('Error getting user:', error);
      return null;
    }

    // Get the access token from user metadata or session
    const accessToken = user.user_metadata?.microsoft_access_token;
    if (!accessToken) {
      console.error('No Microsoft access token found for user');
      return null;
    }

    return accessToken;
  } catch (error) {
    console.error('Error getting access token:', error);
    return null;
  }
}

// Fetch Teams meeting transcript using Graph API
async function fetchTeamsTranscript(meetingId: string, accessToken: string): Promise<string | null> {
  try {

    
    // First, get meeting artifacts
    const artifactsResponse = await fetch(`${GRAPH_API_BASE}/communications/callRecords/${meetingId}/artifacts`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!artifactsResponse.ok) {
      console.error('Failed to fetch meeting artifacts:', artifactsResponse.status, artifactsResponse.statusText);
      return null;
    }

    const artifacts = await artifactsResponse.json();


    // Find transcript artifact
    const transcriptArtifact = artifacts.value?.find((artifact: any) => 
      artifact.type === 'transcript' || 
      artifact.resourceId?.includes('transcript') ||
      artifact.resourceId?.includes('vtt')
    );

    if (!transcriptArtifact) {
      return null;
    }

    // Download the transcript file
    const transcriptResponse = await fetch(`${GRAPH_API_BASE}/communications/callRecords/${meetingId}/artifacts/${transcriptArtifact.id}/content`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!transcriptResponse.ok) {
      console.error('Failed to fetch transcript content:', transcriptResponse.status, transcriptResponse.statusText);
      return null;
    }

    const transcriptContent = await transcriptResponse.text();
    
    return transcriptContent;
  } catch (error) {
    console.error('Error fetching Teams transcript:', error);
    return null;
  }
}

// Get meeting details from Graph API
async function getMeetingDetails(meetingId: string, accessToken: string): Promise<any> {
  try {
    const response = await fetch(`${GRAPH_API_BASE}/communications/callRecords/${meetingId}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      console.error('Failed to fetch meeting details:', response.status, response.statusText);
      return null;
    }

    const meetingDetails = await response.json();
    
    return meetingDetails;
  } catch (error) {
    console.error('Error fetching meeting details:', error);
    return null;
  }
}

// OpenAI prompt for meeting summary
const SYSTEM_PROMPT = `You are a meticulous CRM note-taker for a citizenship law office specializing in citizenship restoration for persecuted individuals and their descendants. 
Return ONLY valid JSON. If information is missing, use null or [].

Rules:
- If transcript is Hebrew, do internal translation for the English summary (do NOT output the raw translation).
- Keep names, dates, and amounts exact.
- No hallucinations. If unsure, use null.
- Be concise but comprehensive in summaries.
- Focus on legal implications, deadlines, and action items.
- Pay special attention to genealogical data and persecution history.
- Extract ALL available information about family members (parents, grandparents, great-grandparents).
- Document precise dates, places, and persecution details.
- Note any mention of entry/exit from Germany or Austria with specific dates.
- Capture full names, birth dates, birth places, countries of origin, and emigration details.
- Document persecution types, dates, and locations mentioned.
- Extract any mention of documents, certificates, or official records.`;

const USER_PROMPT_TEMPLATE = (transcriptText: string, questionnaire: any) => `
Transcript (may be Hebrew, English, or mixed):
"""${transcriptText}"""

Questionnaire schema (fill every field; use null/[] if unknown):
${JSON.stringify(questionnaire, null, 2)}

IMPORTANT: Extract ALL genealogical and persecution data mentioned in the transcript:

1. PERSECUTED PERSON DATA:
   - Full name (exact spelling)
   - Birth date and place
   - Country of origin
   - Type of persecution suffered
   - Dates and locations of persecution
   - Entry dates to Germany/Austria
   - Exit dates from Germany/Austria
   - Emigration destination and date

2. FAMILY MEMBERS (parents, grandparents, great-grandparents):
   - Full names
   - Birth dates and places
   - Countries of origin
   - Any persecution details
   - Emigration details

3. DOCUMENTS MENTIONED:
   - Birth certificates
   - Marriage certificates
   - Death certificates
   - Passports
   - Immigration papers
   - Any other official documents

4. PERSECUTION DETAILS:
   - Specific events mentioned
   - Locations (cities, camps, etc.)
   - Dates (exact or approximate)
   - Types of persecution

Produce this JSON exactly:
{
  "language_detected": "he" | "en" | "mixed",
  "summary_he": "string (natural Hebrew; concise but complete)",
  "summary_en": "string (accurate English; matches the Hebrew meaning)",
  "answers": { ... same keys as questionnaire ... },
  "action_items": [
    { "owner": "string|null", "task": "string", "due_date": "YYYY-MM-DD|null" }
  ],
  "risks": [ "string" ]
}`;

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: Deno.env.get('OPENAI_API_KEY'),
});

// Initialize Supabase
const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

interface MeetingSummaryRequest {
  meetingId: string;
  clientId: string;
  userId?: string; // User ID for Graph API access
  callRecordId?: string; // Call record ID from Graph webhook
  transcriptText?: string; // Optional - will fetch from Teams if not provided
  transcriptUrl?: string;
  meetingSubject?: string;
  meetingStartTime?: string;
  meetingEndTime?: string;
  autoFetchTranscript?: boolean; // Whether to automatically fetch from Teams
  processCallRecord?: boolean; // Whether this is a call record processing request
}

interface MeetingSummaryResponse {
  success: boolean;
  meetingId?: string;
  summaryId?: string;
  error?: string;
  transcriptSource?: 'manual' | 'teams' | 'none';
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { 
      meetingId, 
      clientId, 
      userId,
      callRecordId,
      transcriptText, 
      transcriptUrl, 
      autoFetchTranscript = true,
      processCallRecord = false
    }: MeetingSummaryRequest = await req.json()
    
    let meetingSubject = req.body?.meetingSubject;
    let meetingStartTime = req.body?.meetingStartTime;
    let meetingEndTime = req.body?.meetingEndTime;

    // If this is a call record processing request, use the call record ID as meeting ID
    const effectiveMeetingId = processCallRecord && callRecordId ? callRecordId : meetingId;

    if (!effectiveMeetingId || !clientId) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Missing required fields: meetingId/callRecordId, clientId' 
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400 
        }
      )
    }

    let finalTranscriptText = transcriptText;
    let transcriptSource: 'manual' | 'teams' | 'none' = 'manual';

    // Auto-fetch transcript from Teams if enabled and no transcript provided
    if (autoFetchTranscript && !transcriptText) {
  
      
      // Try to get service token first (for app-level access)
      let accessToken = await getServiceToken();
      
      // If no service token, try user token as fallback
      if (!accessToken && userId) {

        accessToken = await getAccessToken(userId);
      }
      
      if (!accessToken) {

        transcriptSource = 'none';
      } else {
        // Get meeting details
        const meetingDetails = await getMeetingDetails(effectiveMeetingId, accessToken);
        if (meetingDetails) {
          meetingSubject = meetingDetails.subject || meetingSubject;
          meetingStartTime = meetingDetails.startDateTime || meetingStartTime;
          meetingEndTime = meetingDetails.endDateTime || meetingEndTime;
        }

        // Fetch transcript
        const teamsTranscript = await fetchTeamsTranscript(effectiveMeetingId, accessToken);
        if (teamsTranscript) {
          finalTranscriptText = teamsTranscript;
          transcriptSource = 'teams';
          transcriptSource = 'teams';
        } else {
          transcriptSource = 'none';
        }
      }
    }

    if (!finalTranscriptText) {
      
      // Create a placeholder transcript for meetings without transcripts
      finalTranscriptText = `Meeting held on ${meetingStartTime || 'unknown date'}. No transcript available. Please add manual notes.`;
      transcriptSource = 'none';
    }

    // Convert VTT to plain text if needed
    const cleanText = finalTranscriptText.includes('-->') ? vttToPlainText(finalTranscriptText) : finalTranscriptText;
    
    // Detect language
    const detectedLanguage = detectLanguage(cleanText);
    
    // Default questionnaire structure with genealogical and persecution data
    const questionnaire = {
      meeting_type: null,
      participants: [],
      key_facts: [],
      eligibility_points: [],
      action_items: [],
      deadlines: [],
      next_steps_owner: null,
      client_concerns: [],
      legal_implications: [],
      required_documents: [],
      // Genealogical data for persecuted person
      persecuted_person: {
        full_name: null,
        birth_date: null,
        birth_place: null,
        country_of_origin: null,
        persecution_type: null,
        persecution_dates: null,
        persecution_location: null,
        entry_germany_date: null,
        entry_austria_date: null,
        left_germany_date: null,
        left_austria_date: null,
        emigration_destination: null,
        emigration_date: null
      },
      // Family members data
      family_members: {
        parents: [],
        grandparents: [],
        great_grandparents: []
      },
      // Document mentions
      documents_mentioned: [],
      // Additional persecution details
      persecution_details: {
        specific_events: [],
        locations: [],
        dates: [],
        types: []
      }
    };

    // Generate AI summary
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: USER_PROMPT_TEMPLATE(cleanText, questionnaire) }
      ],
    });

    const aiResponse = JSON.parse(completion.choices[0].message.content);

    // Save meeting record
    const { data: meetingData, error: meetingError } = await supabase
      .from('meetings')
      .upsert({
        teams_id: effectiveMeetingId || null, // Use effective meeting ID or null if not provided
        client_id: clientId,
        meeting_subject: meetingSubject || `Call Record: ${effectiveMeetingId || 'Unknown'}`,
        started_at: meetingStartTime,
        ended_at: meetingEndTime,
        transcript_url: transcriptUrl,
        status: 'completed'
      }, { onConflict: 'teams_id' })
      .select()
      .single();

    if (meetingError) {
      console.error('Error saving meeting:', meetingError);
      throw new Error('Failed to save meeting record');
    }

    // Save transcript
    const { error: transcriptError } = await supabase
      .from('meeting_transcripts')
      .insert({
        meeting_id: meetingData.id,
        text: cleanText,
        source: transcriptSource,
        language: detectedLanguage,
        raw_transcript: finalTranscriptText
      });

    if (transcriptError) {
      console.error('Error saving transcript:', transcriptError);
      throw new Error('Failed to save transcript');
    }

    // Save AI summary
    const { data: summaryData, error: summaryError } = await supabase
      .from('meeting_summaries')
      .insert({
        meeting_id: meetingData.id,
        summary_he: aiResponse.summary_he,
        summary_en: aiResponse.summary_en,
        model: 'gpt-4o-mini',
        tokens_used: completion.usage?.total_tokens || 0,
        language_detected: aiResponse.language_detected,
        action_items: aiResponse.action_items,
        risks: aiResponse.risks
      })
      .select()
      .single();

    if (summaryError) {
      console.error('Error saving summary:', summaryError);
      throw new Error('Failed to save summary');
    }

    // Save questionnaire answers
    const { error: questionnaireError } = await supabase
      .from('meeting_questionnaires')
      .insert({
        meeting_id: meetingData.id,
        payload: aiResponse.answers,
        version: '1.0'
      });

    if (questionnaireError) {
      console.error('Error saving questionnaire:', questionnaireError);
      // Don't throw here as the main summary is saved
    }

    // Check if auto-email is enabled for this client
    const { data: clientData } = await supabase
      .from('leads')
      .select('auto_email_meeting_summary, language_preference, email')
      .eq('id', clientId)
      .single();

    if (clientData?.auto_email_meeting_summary && clientData?.email) {
      // Send auto-email (implement email sending logic here)
      const preferredLanguage = clientData.language_preference || 'en';
      const summaryText = preferredLanguage === 'he' ? aiResponse.summary_he : aiResponse.summary_en;
      
      // Log the auto-email communication
      await supabase
        .from('emails')
        .insert({
          client_id: clientId,
          subject: 'סיכום הפגישה | Meeting Summary',
          body_preview: summaryText.substring(0, 200) + '...',
          direction: 'outgoing',
          sent_at: new Date().toISOString(),
          related_meeting_id: meetingData.id
        });
    }

    const response: MeetingSummaryResponse = {
      success: true,
      meetingId: meetingData.id,
      summaryId: summaryData.id,
      transcriptSource
    };

    return new Response(
      JSON.stringify(response),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    )

  } catch (error) {
    console.error('Error processing meeting summary:', error);
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message || 'Internal server error' 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    )
  }
})
