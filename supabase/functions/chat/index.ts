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

// System message with lead creation template
const SYSTEM_MESSAGE = {
  role: "system",
  content: `You are an AI assistant for Leadify CRM. When a user uploads an image (such as a document, form, or screenshot) and asks about it, you should:

- Immediately analyze the image and extract all relevant details, such as names, dates, places, and any structured or biographical information.
- Provide a clear, concise, and user-friendly summary of the document or image content.
- Always use the following structure for your response:

Summary:
- [One or two sentence summary of the document]

Key Details:
- Name: [value]
- Birth Date: [value]
- Occupation: [value]
- Languages: [value]
- Family Members: [value]
- Emigration Details: [value]
- Economic Situation: [value]
- Citizenship: [value]
- Country of Residence: [value]
- Country of Origin: [value]
- Residency from: [value]
- Address: [value]
- City: [value]
- Country: [value]
- Date of arrival: [value]
- Date of departure: [value]
- Parents
- Partner's names: [value]
- Children's names: [value
- Religion: [value]
- Gender: [value]
- Marital Status: [value]
- Education: [value]
- Other Details: [value]


If a section is not present, omit it. Do not use asterisks, markdown, or code blocks. Use plain text and clear labels. Each key detail should be on its own line.

- If the user asks for a summary, give a brief overview of the main points and key facts.
- If the image contains a historical or biographical document, summarize the person's details, important dates, locations, and any notable events in a natural, conversational way.
- Do NOT refuse to answer unless the content is clearly inappropriate or violates privacy in a way not expected in a CRM context.
- Always be helpful, professional, and concise.

If the user asks a follow-up question about the image, use the information you extracted to answer as specifically as possible.

LEAD CREATION TEMPLATE:
When a user wants to create a lead, follow this step-by-step process:
1. Ask for the client's full name first
2. Once you have the name, ask for their topic of interest (e.g., "German Citizenship", "Austrian Citizenship", "Investment Visa", etc.)
3. Once you have the required information (name and topic), use the create_lead function to create the lead

Example conversation flow:
User: "create a lead"
Assistant: "I'll help you create a new lead. What's the client's full name?"
User: "John Smith"
Assistant: "Great! What topic is John Smith interested in? (e.g., German Citizenship, Austrian Citizenship, etc.)"
User: "German Citizenship"
Assistant: [Creates the lead using create_lead function]

Always be friendly and professional. If the user provides multiple pieces of information at once, collect them all before creating the lead.`
};

async function openaiChat({ model, messages, tools, tool_choice }) {
  const body = {
    model,
    messages: [SYSTEM_MESSAGE, ...messages],
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
    const { messages, images } = await req.json();
    if (!messages) {
      throw new Error("No messages provided");
    }

    // Process messages to handle images properly
    let processedMessages = [...messages];
    
    if (images && images.length > 0) {
      // Convert the last user message to include image data
      const lastMessage = processedMessages[processedMessages.length - 1];
      if (lastMessage.role === 'user') {
        const content = [];
        
        // Add text content if present
        if (typeof lastMessage.content === 'string' && lastMessage.content.trim()) {
          content.push({ type: 'text', text: lastMessage.content });
        }
        
        // Add images as base64 data URLs
        for (const image of images) {
          content.push({ 
            type: 'image_url', 
            image_url: { 
              url: image.data,
              detail: 'high' // Use high detail for better image analysis
            } 
          });
        }
        
        processedMessages[processedMessages.length - 1] = {
          ...lastMessage,
          content
        };
      }
    }

    // Detect if any message contains images
    const hasImage = processedMessages.some((msg: any) =>
      Array.isArray(msg.content) && msg.content.some((item: any) => item.type === 'image_url')
    );
    
    // Use GPT-4o for vision support, fallback to GPT-4-turbo for text-only
    const model = hasImage ? 'gpt-4o' : 'gpt-4-turbo-preview';

    // Send messages to OpenAI
    const response = await openaiChat({
      model,
      messages: processedMessages,
      tools,
      tool_choice: "auto",
    });

    let responseMessage = response.choices[0].message;
    if (!responseMessage.content) {
      responseMessage.content = "";
    }

    // Handle tool calls if present
    if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
      const toolCallMsg = {
        role: "assistant",
        content: responseMessage.content,
        tool_calls: responseMessage.tool_calls
      };
      const newMessages = [...processedMessages, toolCallMsg];
      
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
        model: hasImage ? 'gpt-4o' : 'gpt-4-turbo-preview',
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