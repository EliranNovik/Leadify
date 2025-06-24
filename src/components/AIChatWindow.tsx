import React, { useState, useRef, useEffect } from 'react';
import { SparklesIcon, XMarkIcon, PaperAirplaneIcon } from '@heroicons/react/24/solid';
import { supabase } from '../lib/supabase';
import { toast } from 'react-hot-toast';

interface AIChatWindowProps {
  isOpen: boolean;
  onClose: () => void;
  onClientUpdate?: () => void;
}

interface Message {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: any[];
  tool_call_id?: string;
}

interface NewLeadResult {
  id: string;
  lead_number: string;
  name: string;
  email: string;
}

// Functions that the AI can call
const executeTool = async (tool_call: any, onClientUpdate?: () => void) => {
  const functionName = tool_call.function.name;
  const args = JSON.parse(tool_call.function.arguments);
  let result;

  try {
    if (functionName === 'create_lead') {
      const { data, error } = await supabase.rpc('create_new_lead_v2', {
        lead_name: args.name,
        lead_email: args.email || null,
        lead_phone: args.phone || null,
        lead_topic: args.topic,
        lead_language: args.language || 'English',
      });
      
      if (error) throw error;
      // The RPC function returns an array, so we take the first element
      const newLead = data?.[0] as NewLeadResult;
      if (!newLead) throw new Error("No data returned from lead creation.");

      result = `Successfully created lead ${newLead.name} with Lead Number ${newLead.lead_number}.`;
      if (onClientUpdate) onClientUpdate(); // Refresh the main client list
    } else if (functionName === 'create_meeting') {
      const { data, error } = await supabase
        .from('leads')
        .update({
          meeting_date: args.meeting_date,
          meeting_time: args.meeting_time,
          meeting_brief: args.meeting_brief,
        })
        .eq('lead_number', args.lead_number)
        .select()
        .single();
      if (error) throw error;
      result = `Successfully scheduled meeting for lead ${data.name} (${data.lead_number}).`;
       if (onClientUpdate) onClientUpdate(); // Refresh the main client list
    } else {
      result = `Unknown function: ${functionName}`;
    }
    toast.success(result);
    return result;
  } catch (error: any) {
    const errorMessage = `Error executing ${functionName}: ${error.message}`;
    toast.error(errorMessage);
    return errorMessage;
  }
};

const sanitizeMessages = (messages: Message[]) => {
  const sanitized: Message[] = [];
  if (!messages || messages.length === 0) return [];

  for (const message of messages) {
    const lastMessage = sanitized.length > 0 ? sanitized[sanitized.length - 1] : null;

    // Skip empty assistant messages that might be leftover placeholders
    if (message.role === 'assistant' && !message.content && !message.tool_calls) {
      continue;
    }

    if (lastMessage && lastMessage.role === message.role) {
      // If two messages in a row have the same role, replace the last one.
      // This is a simple way to recover from conversational errors.
      sanitized[sanitized.length - 1] = message;
    } else {
      sanitized.push(message);
    }
  }
  return sanitized;
};

const AIChatWindow: React.FC<AIChatWindowProps> = ({ isOpen, onClose, onClientUpdate }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  
  const messagesEndRef = useRef<null | HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(scrollToBottom, [messages]);
  
  useEffect(() => {
    if (isOpen && messages.length === 0) {
      setMessages([{ role: 'assistant', content: "Hello! I can help you create leads and schedule meetings. How can I help?" }]);
    }
  }, [isOpen, messages.length]);

  const handleSend = async () => {
    if (input.trim() === '') return;
    
    const userMessage: Message = { role: 'user', content: input };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');

    // Add a placeholder for the assistant's response
    setMessages(prev => [...prev, { role: 'assistant', content: '...' }]);
    
    const messagesForApi = sanitizeMessages(newMessages);

    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify({ messages: messagesForApi }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Request failed with status ${response.status}`);
      }
      
      const aiResponseMessage = await response.json();
      
      // Replace placeholder with actual response (which could be a question or a tool call)
      setMessages(prev => [...prev.slice(0, -1), aiResponseMessage]);

      if (aiResponseMessage.tool_calls) {
        setMessages(prev => [...prev, { role: 'assistant', content: '...' }]);

        const toolResults = await Promise.all(
          aiResponseMessage.tool_calls.map((tool_call: any) => executeTool(tool_call, onClientUpdate))
        );
        
        const toolResponseMessage: Message = {
          role: 'tool',
          tool_call_id: aiResponseMessage.tool_calls[0].id,
          content: toolResults.join('\n'),
        };

        const finalMessages = [...messagesForApi, aiResponseMessage, toolResponseMessage];
        const finalMessagesForApi = sanitizeMessages(finalMessages);
        
        const finalResponse = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
          },
          body: JSON.stringify({ messages: finalMessagesForApi }),
        });
        
        if (!finalResponse.ok) {
          const errorData = await finalResponse.json();
          throw new Error(errorData.error || `Request failed with status ${finalResponse.status}`);
        }
        
        const finalAiMessage = await finalResponse.json();
        setMessages(prev => [...prev.slice(0, -1), finalAiMessage]);
      }
    } catch (error) {
      console.error('Error in handleSend:', error);
      const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";
      setMessages(prev => {
        const lastMessage = prev[prev.length - 1];
        const updatedLastMessage = { ...lastMessage, content: `Sorry, an error occurred: ${errorMessage}` };
        return [...prev.slice(0, -1), updatedLastMessage];
      });
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 md:inset-auto md:top-0 md:right-0 md:h-full md:w-[32rem] bg-base-100 shadow-2xl flex flex-col z-50 md:border-l-2 border-base-300 animate-slideInRight">
      {/* Header */}
      <div className="p-4 border-b border-base-300 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <SparklesIcon className="h-6 w-6 text-primary" />
          <h3 className="font-bold text-lg">AI Assistant</h3>
        </div>
        <button className="btn btn-sm btn-ghost btn-circle" onClick={onClose}>
          <XMarkIcon className="w-6 h-6" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 p-4 overflow-y-auto">
        <div className="space-y-4">
          {messages.map((message, index) => (
            <div key={index} className={`chat ${message.role === 'user' ? 'chat-end' : 'chat-start'}`}>
              <div className={`chat-bubble ${message.role === 'user' ? 'chat-bubble-primary' : 'bg-base-200'}`}>
                {message.content}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="p-4 border-t border-base-300">
        <div className="join w-full">
          <input
            type="text"
            className="input input-bordered join-item w-full"
            placeholder="Ask me anything..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSend()}
          />
          <button className="btn btn-primary join-item" onClick={handleSend}>
            <PaperAirplaneIcon className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default AIChatWindow; 