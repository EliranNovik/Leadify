import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { supabase } from '../_shared/supabase-client.ts';

console.log(`Function "chat" up and running!`);

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

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
  {
    type: "function",
    function: {
      name: "query_executor",
      description: "Run dynamic, secure database queries on CRM data. For filtering by lead creator, use the created_by column. For citizenship queries, use the 'category' column (e.g., 'German Citizenship', 'Austrian Citizenship').",
      parameters: {
        type: "object",
        properties: {
          table: {
            type: "string",
            description: "Allowed values: 'leads', 'meetings', 'interactions', 'experts', 'schedulers', 'users', 'created_by', 'created_at', 'updated_at', 'deleted_at'"
          },
          operation: {
            type: "string",
            enum: ["count", "avg", "sum", "min", "max", "distinct", "select"],
            description: "The type of data query to run"
          },
          column: {
            type: "string",
            description: "Column name to perform operation on (required for avg, sum, etc.)"
          },
          filters: {
            type: "array",
            items: {
              type: "object",
              properties: {
                column: { type: "string" },
                operator: {
                  type: "string",
                  enum: ["=", "!=", "<", "<=", ">", ">=", "like"]
                },
                value: { type: "string" }
              },
              required: ["column", "operator", "value"]
            },
            description: "Filter conditions for rows"
          },
          group_by: {
            type: "string",
            description: "Column to group results by (optional)"
          },
          limit: {
            type: "integer",
            description: "Max number of rows to return (for select operations)"
          },
          offset: {
            type: "integer",
            description: "Row offset (for paginated select operations)"
          }
        },
        required: ["table", "operation"]
      }
    }
  }
];

async function openaiChat({ model, messages, tools, tool_choice }) {
  const body = {
    model,
    messages,
    ...(tools ? { tools } : {}),
    ...(tool_choice ? { tool_choice } : {}),
  };
  const res = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`${res.status} ${err.error?.message || res.statusText}`);
  }
  return await res.json();
}

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

    // Detect if any message contains an image_url (OpenAI Vision format)
    const hasImage = messages.some((msg: any) =>
      Array.isArray(msg.content) && msg.content.some((item: any) => item.type === 'image_url')
    );
    const model = hasImage ? 'gpt-image-1' : 'gpt-4-turbo-preview';

    // 1. Send user/assistant messages to OpenAI (via fetch)
    const response = await openaiChat({
      model,
      messages,
      tools,
      tool_choice: "auto",
    });

    let responseMessage = response.choices[0].message;
    if (!responseMessage.content) {
      responseMessage.content = "";
    }

    // 2. If the response contains tool_calls, handle them
    if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
      const toolCallMsg = {
        role: "assistant",
        content: responseMessage.content,
        tool_calls: responseMessage.tool_calls
      };
      const newMessages = [...messages, toolCallMsg];
      for (const toolCall of responseMessage.tool_calls) {
        let toolResult;
        if (toolCall.function && toolCall.function.name === 'query_executor') {
          toolResult = { result: toolCall.function.arguments };
        } else {
          toolResult = { result: `Mock result for tool: ${toolCall.function.name}` };
        }
        newMessages.push({
          tool_call_id: toolCall.id,
          role: "tool",
          name: toolCall.function.name,
          content: JSON.stringify(toolResult)
        });
      }
      const followup = await openaiChat({
        model: "gpt-4-turbo-preview",
        messages: newMessages,
        tools,
        tool_choice: "auto"
      });
      responseMessage = followup.choices[0].message;
      if (!responseMessage.content) {
        responseMessage.content = "";
      }
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