import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { OpenAI } from "https://deno.land/x/openai/mod.ts";
import { supabase } from '../_shared/supabase-client.ts';

console.log(`Function "chat" up and running!`);

const openAI = new OpenAI(Deno.env.get('OPENAI_API_KEY'));

const tools = [
  {
    type: "function",
    function: {
      name: "create_lead",
      description: "Creates a new lead in the CRM system.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "The full name of the lead." },
          email: { type: "string", description: "The email address of the lead." },
          phone: { type: "string", description: "The phone number of the lead." },
          topic: { type: "string", description: "The subject or topic of interest for the lead." },
          language: { type: "string", description: "The lead's primary language, e.g., 'English', 'German'." },
        },
        required: ["name", "topic"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_meeting",
      description: "Schedules a new meeting for a lead.",
      parameters: {
        type: "object",
        properties: {
          lead_number: { type: "string", description: "The lead number (e.g., L123) for whom the meeting is scheduled." },
          meeting_date: { type: "string", description: "The date of the meeting in YYYY-MM-DD format." },
          meeting_time: { type: "string", description: "The time of the meeting in 24-hour HH:MM format." },
          meeting_brief: { type: "string", description: "A brief description or agenda for the meeting." },
        },
        required: ["lead_number", "meeting_date", "meeting_time"],
      },
    },
  },
];

serve(async (req) => {
  // This is needed if you're planning to invoke your function from a browser.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { messages } = await req.json();
    if (!messages) {
      throw new Error("No messages provided");
    }

    const response = await openAI.chat.completions.create({
      model: "gpt-4-turbo-preview",
      messages,
      tools: tools,
      tool_choice: "auto", 
    });

    const responseMessage = response.choices[0].message;

    // Ensure content is not null if it's missing, which can happen with tool calls
    if (!responseMessage.content) {
      responseMessage.content = "";
    }

    return new Response(JSON.stringify(responseMessage), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
}); 