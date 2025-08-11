import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { supabase } from '../_shared/supabase-client.ts';

console.log(`Function "ai-notifications" up and running!`);

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

interface NotificationData {
  id: string;
  type: 'urgent' | 'important' | 'reminder';
  message: string;
  action: string;
  dueDate?: string;
  context?: string;
  leadId: string;
  leadNumber: string;
  clientName: string;
  date: string;
  priority: 'high' | 'medium' | 'low';
}

async function getNotifications(): Promise<NotificationData[]> {
  const notifications: NotificationData[] = [];
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  const todayStr = today.toISOString().split('T')[0];
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  try {
    // 1. Check for meetings today/tomorrow without expert assessment
    const { data: meetings, error: meetingsError } = await supabase
      .from('meetings')
      .select(`
        id,
        meeting_date,
        meeting_time,
        meeting_brief,
        leads!inner(
          id,
          lead_number,
          name,
          expert_eligibility_assessed
        )
      `)
      .in('meeting_date', [todayStr, tomorrowStr])
      .eq('leads.expert_eligibility_assessed', false);

    if (meetingsError) throw meetingsError;

    meetings?.forEach((meeting, index) => {
      const meetingDate = new Date(meeting.meeting_date);
      const isToday = meetingDate.toISOString().split('T')[0] === todayStr;
      const timeStr = meeting.meeting_time ? ` at ${meeting.meeting_time}` : '';
      
      notifications.push({
        id: `meeting-${index}`,
        type: 'urgent',
        message: `${isToday ? 'Today' : 'Tomorrow'} meeting with ${meeting.leads.name} (${meeting.leads.lead_number}) ${timeStr}`,
        action: 'Assess Eligibility',
        dueDate: isToday ? 'Today' : 'Tomorrow',
        context: `Expert opinion missing. Meeting Brief: ${meeting.meeting_brief || 'No brief provided'}`,
        leadId: meeting.leads.id,
        leadNumber: meeting.leads.lead_number,
        clientName: meeting.leads.name,
        date: meeting.meeting_date,
        priority: 'high'
      });
    });

    // 2. Check for follow-ups due today/tomorrow
    const { data: followups, error: followupsError } = await supabase
      .from('leads')
      .select('id, lead_number, name, next_followup')
      .in('next_followup', [todayStr, tomorrowStr]);

    if (followupsError) throw followupsError;

    followups?.forEach((lead, index) => {
      const followupDate = new Date(lead.next_followup);
      const isToday = followupDate.toISOString().split('T')[0] === todayStr;
      
      notifications.push({
        id: `followup-${index}`,
        type: 'important',
        message: `Follow up with ${lead.name} (${lead.lead_number})`,
        action: 'Send Follow-up',
        dueDate: isToday ? 'Today' : 'Tomorrow',
        context: `Follow-up scheduled for ${lead.next_followup}`,
        leadId: lead.id,
        leadNumber: lead.lead_number,
        clientName: lead.name,
        date: lead.next_followup,
        priority: 'medium'
      });
    });

    // 3. Check for payments due today/tomorrow from payment_plans table
    const { data: payments, error: paymentsError } = await supabase
      .from('payment_plans')
      .select(`
        id,
        due_date,
        leads!inner(
          id,
          lead_number,
          name
        )
      `)
      .in('due_date', [todayStr, tomorrowStr])
      .not('due_date', 'is', null);

    if (paymentsError) throw paymentsError;

    payments?.forEach((payment, index) => {
      const paymentDate = new Date(payment.due_date);
      const isToday = paymentDate.toISOString().split('T')[0] === todayStr;
      
      notifications.push({
        id: `payment-${index}`,
        type: 'urgent',
        message: `Payment due ${isToday ? 'today' : 'tomorrow'} (${payment.due_date}), follow up with client`,
        action: 'Check Payment',
        dueDate: isToday ? 'Today' : 'Tomorrow',
        context: `Client: ${payment.leads.name} (${payment.leads.lead_number})`,
        leadId: payment.leads.id,
        leadNumber: payment.leads.lead_number,
        clientName: payment.leads.name,
        date: payment.due_date,
        priority: 'high'
      });
    });

    // 4. Check for documents uploaded today
    const { data: documents, error: documentsError } = await supabase
      .from('leads')
      .select('id, lead_number, name, documents_uploaded_date')
      .gte('documents_uploaded_date', todayStr)
      .lt('documents_uploaded_date', tomorrowStr)
      .not('documents_uploaded_date', 'is', null);

    if (documentsError) throw documentsError;

    documents?.forEach((lead, index) => {
      notifications.push({
        id: `documents-${index}`,
        type: 'important',
        message: `New documents uploaded for ${lead.name} (${lead.lead_number}), check it out now`,
        action: 'Review Documents',
        dueDate: 'Today',
        context: `Documents uploaded on ${lead.documents_uploaded_date}`,
        leadId: lead.id,
        leadNumber: lead.lead_number,
        clientName: lead.name,
        date: lead.documents_uploaded_date,
        priority: 'medium'
      });
    });

    // 5. Check for expert eligibility assessments completed today
    const { data: assessments, error: assessmentsError } = await supabase
      .from('leads')
      .select('id, lead_number, name, expert_eligibility_date, expert_eligibility_assessed_by')
      .gte('expert_eligibility_date', todayStr)
      .lt('expert_eligibility_date', tomorrowStr)
      .eq('expert_eligibility_assessed', true)
      .not('expert_eligibility_date', 'is', null);

    if (assessmentsError) throw assessmentsError;

    assessments?.forEach((lead, index) => {
      notifications.push({
        id: `assessment-${index}`,
        type: 'reminder',
        message: `Express check done for ${lead.name} (${lead.lead_number})`,
        action: 'Contact Client',
        dueDate: 'Today',
        context: `Assessed by ${lead.expert_eligibility_assessed_by || 'Unknown'} on ${lead.expert_eligibility_date}`,
        leadId: lead.id,
        leadNumber: lead.lead_number,
        clientName: lead.name,
        date: lead.expert_eligibility_date,
        priority: 'low'
      });
    });

  } catch (error) {
    console.error('Error fetching notifications:', error);
    throw error;
  }

  return notifications.sort((a, b) => {
    // Sort by priority first, then by date
    const priorityOrder = { high: 3, medium: 2, low: 1 };
    const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
    if (priorityDiff !== 0) return priorityDiff;
    return new Date(a.date).getTime() - new Date(b.date).getTime();
  });
}

async function generateAIMessage(notifications: NotificationData[]): Promise<string> {
  if (notifications.length === 0) {
    return "All clear - No urgent notifications";
  }

  const systemPrompt = `You are an AI assistant for Leadify CRM. Generate a clear, structured summary with key points only.

Guidelines:
- Keep it under 100 words
- Use clean bullet points (no emojis or symbols)
- Focus only on the most critical information
- Use clear, professional language
- Group by category (Meetings, Payment due, etc.)
- No verbose explanations
- Make it scannable and actionable

Format:
Key point
- detail
- detail

Key point
- detail
- detail`;

  const userPrompt = `Create a clear, structured summary for these notifications:

${notifications.map((notification, index) => `
${index + 1}. ${notification.message} (${notification.priority} priority)
`).join('\n')}

Generate a structured list grouped by category with key details only.`;

  try {
    const response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4-turbo-preview',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: 150,
        temperature: 0.7
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error) {
    console.error('Error generating AI message:', error);
    // Fallback message
    return `${notifications.length} notification${notifications.length > 1 ? 's' : ''} require attention`;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { action } = await req.json();
    
    if (action === 'get_notifications') {
      const notifications = await getNotifications();
      const aiMessage = await generateAIMessage(notifications);
      
      return new Response(JSON.stringify({
        notifications,
        aiMessage,
        count: notifications.length
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });

  } catch (error) {
    console.error('Error in ai-notifications function:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
