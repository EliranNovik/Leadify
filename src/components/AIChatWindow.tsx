import React, { useState, useRef, useEffect } from 'react';
import { SparklesIcon, XMarkIcon, PaperAirplaneIcon } from '@heroicons/react/24/solid';
import { supabase } from '../lib/supabase';
import { toast } from 'react-hot-toast';

interface AIChatWindowProps {
  isOpen: boolean;
  onClose: () => void;
  onClientUpdate?: () => void;
  userName?: string;
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
    } else if (functionName === 'query_executor') {
      result = await executeDynamicQuery(args);
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

// Whitelist of allowed tables and columns for security
const allowedTables = {
  leads: ["id", "lead_number", "name", "email", "phone", "topic", "category", "stage", "created_at", "expert", "closer", "proposal_total", "proposal_currency", "balance", "balance_currency", "date_signed", "next_followup"],
  meetings: ["id", "client_id", "meeting_date", "meeting_time", "meeting_brief", "meeting_amount", "meeting_currency", "created_at"],
  interactions: ["id", "client_id", "interaction_type", "interaction_date", "interaction_notes", "created_at"]
};

// Allowed operations
const allowedOperations = ["count", "avg", "sum", "min", "max", "distinct", "select"];

// Allowed operators for filters
const allowedOperators = ["=", "!=", "<", "<=", ">", ">=", "like"];

// Execute dynamic query with security validation
const executeDynamicQuery = async (args: any): Promise<string> => {
  const { table, operation, column, filters = [], group_by, limit, offset } = args;

  // Security validation
  if (!allowedTables[table as keyof typeof allowedTables]) {
    throw new Error(`Table '${table}' is not allowed. Allowed tables: ${Object.keys(allowedTables).join(', ')}`);
  }

  if (!allowedOperations.includes(operation)) {
    throw new Error(`Operation '${operation}' is not allowed. Allowed operations: ${allowedOperations.join(', ')}`);
  }

  // Validate column exists in allowed columns
  if (column && !allowedTables[table as keyof typeof allowedTables].includes(column)) {
    throw new Error(`Column '${column}' is not allowed for table '${table}'. Allowed columns: ${allowedTables[table as keyof typeof allowedTables].join(', ')}`);
  }

  // Validate group_by column
  if (group_by && !allowedTables[table as keyof typeof allowedTables].includes(group_by)) {
    throw new Error(`Group by column '${group_by}' is not allowed for table '${table}'. Allowed columns: ${allowedTables[table as keyof typeof allowedTables].join(', ')}`);
  }

  // Validate filters
  for (const filter of filters) {
    if (!allowedTables[table as keyof typeof allowedTables].includes(filter.column)) {
      throw new Error(`Filter column '${filter.column}' is not allowed for table '${table}'. Allowed columns: ${allowedTables[table as keyof typeof allowedTables].join(', ')}`);
    }
    if (!allowedOperators.includes(filter.operator)) {
      throw new Error(`Filter operator '${filter.operator}' is not allowed. Allowed operators: ${allowedOperators.join(', ')}`);
    }
  }

  // For aggregate operations, use RPC
  if (['avg', 'sum', 'min', 'max', 'distinct'].includes(operation)) {
    return await executeAggregateQuery(table, operation, column, filters, group_by);
  }

  // For count and select operations, use a simpler approach
  try {
    if (operation === 'count') {
      const { count, error } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true });
      
      if (error) throw error;
      return `Found ${count || 0} records in ${table}`;
    } else if (operation === 'select') {
      const selectColumns = column ? [column] : allowedTables[table as keyof typeof allowedTables];
      
      const { data, error } = await supabase
        .from(table)
        .select(selectColumns.join(','));
      
      if (error) throw error;

      if (!data || data.length === 0) {
        return `No records found in ${table} matching the criteria.`;
      }
      
      const records = data.slice(0, 10); // Limit display to 10 records
      const displayData = records.map((record: any) => {
        if (column) {
          return record[column];
        }
        return Object.entries(record)
          .map(([key, value]) => `${key}: ${value}`)
          .join(', ');
      });
      
      let result = `Found ${data.length} records in ${table}:\n`;
      result += displayData.map((item: string, index: number) => `${index + 1}. ${item}`).join('\n');
      
      if (data.length > 10) {
        result += `\n... and ${data.length - 10} more records`;
      }
      
      return result;
    }
  } catch (error: any) {
    throw new Error(`Query execution failed: ${error.message}`);
  }

  throw new Error(`Unsupported operation: ${operation}`);
};

// Execute aggregate queries using RPC
const executeAggregateQuery = async (table: string, operation: string, column: string, filters: any[], group_by?: string): Promise<string> => {
  // Build filter conditions for RPC
  const filterConditions = filters.map(filter => ({
    column: filter.column,
    operator: filter.operator,
    value: filter.value
  }));

  const { data, error } = await supabase.rpc('execute_aggregate_query', {
    p_table: table,
    p_operation: operation,
    p_column: column,
    p_filters: filterConditions,
    p_group_by: group_by
  });

  if (error) throw error;

  // Format the result
  if (operation === 'avg') {
    return `Average ${column} in ${table}: ${data?.result || 0}`;
  } else if (operation === 'sum') {
    return `Sum of ${column} in ${table}: ${data?.result || 0}`;
  } else if (operation === 'min') {
    return `Minimum ${column} in ${table}: ${data?.result || 0}`;
  } else if (operation === 'max') {
    return `Maximum ${column} in ${table}: ${data?.result || 0}`;
  } else if (operation === 'distinct') {
    return `Distinct values of ${column} in ${table}: ${data?.result || 0}`;
  }

  return JSON.stringify(data);
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

const AIChatWindow: React.FC<AIChatWindowProps> = ({ isOpen, onClose, onClientUpdate, userName }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [images, setImages] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  
  const messagesEndRef = useRef<null | HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(scrollToBottom, [messages]);
  
  useEffect(() => {
    if (isOpen && messages.length === 0) {
      const greeting = userName ? `Hi ${userName}, how can I help you?` : "Hello! How can I help you?";
      
      setMessages([{ 
        role: 'assistant', 
        content: greeting
      }]);
    }
  }, [isOpen, messages.length, userName]);

  // Quick action handlers
  const handleQuickAction = (action: string) => {
    handleSend(action);
  };

  // Handle image selection (multi-image)
  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length + images.length > 10) {
      alert('You can upload up to 10 images.');
      return;
    }
    setImages(prev => [...prev, ...files]);
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setImagePreviews(prev => [...prev, ev.target?.result as string]);
      };
      reader.readAsDataURL(file);
    });
  };

  // Remove selected image by index
  const handleRemoveImage = (idx: number) => {
    setImages(prev => prev.filter((_, i) => i !== idx));
    setImagePreviews(prev => prev.filter((_, i) => i !== idx));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSend = async (customInput?: string) => {
    const messageToSend = customInput || input;
    if (!messageToSend.trim() && images.length === 0) return;
    setIsLoading(true);
    let userMessage: any;
    if (images.length > 0 && imagePreviews.length > 0) {
      userMessage = {
        role: 'user',
        content: [
          ...(messageToSend.trim() ? [{ type: 'text', text: messageToSend.trim() }] : []),
          ...imagePreviews.map(url => ({ type: 'image_url', image_url: { url } }))
        ]
      };
    } else {
      userMessage = { role: 'user', content: messageToSend.trim() };
    }
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    if (!customInput) {
      setInput('');
    }
    setImages([]);
    setImagePreviews([]);
    if (fileInputRef.current) fileInputRef.current.value = '';

    // Add a placeholder for the assistant's response
    setMessages(prev => [...prev, { role: 'assistant', content: '...' }]);
    
    const messagesForApi = sanitizeMessages(newMessages);

    // Prepare images data for upload
    const imagesData = images.map((file, index) => ({
      name: file.name,
      data: imagePreviews[index]
    }));

    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify({ 
          messages: messagesForApi,
          images: imagesData
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Request failed with status ${response.status}`);
      }
      
      const aiResponseMessage = await response.json();
      
      // Replace placeholder with actual response (which could be a question or a tool call)
      setMessages(prev => [...prev.slice(0, -1), aiResponseMessage]);

    } catch (error) {
      console.error('Error in handleSend:', error);
      const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";
      setMessages(prev => {
        const lastMessage = prev[prev.length - 1];
        const updatedLastMessage = { ...lastMessage, content: `Sorry, an error occurred: ${errorMessage}` };
        return [...prev.slice(0, -1), updatedLastMessage];
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    if (files.length + images.length > 10) {
      alert('You can upload up to 10 images.');
      return;
    }
    setImages(prev => [...prev, ...files]);
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setImagePreviews(prev => [...prev, ev.target?.result as string]);
      };
      reader.readAsDataURL(file);
    });
  };

  if (!isOpen) return null;

  return (
    <div
      className={`fixed z-50 right-0 top-0 bottom-0 w-full max-w-2xl bg-base-100 shadow-2xl border-l border-base-200 transition-all duration-300 ${isOpen ? 'translate-y-0' : 'translate-y-full'} flex flex-col ${isDragActive ? 'ring-4 ring-primary/40' : ''}`}
      style={{ height: '100vh', minHeight: '100vh', maxHeight: '100vh', borderTopLeftRadius: 0, borderTopRightRadius: 0 }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Header */}
      <div className="p-4 border-b border-base-300 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <SparklesIcon className="h-6 w-6 text-primary" />
          <h3 className="font-bold text-lg">AI Assistant</h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleQuickAction('create a lead')}
            className="btn btn-xs btn-primary"
            disabled={isLoading}
            title="Create a new lead"
          >
            📝 Lead
          </button>
          <button
            onClick={() => handleQuickAction('show me today\'s statistics')}
            className="btn btn-xs btn-secondary"
            disabled={isLoading}
            title="Today's statistics"
          >
            📊 Stats
          </button>
          <button
            onClick={() => handleQuickAction('how many leads were created this week?')}
            className="btn btn-xs btn-accent"
            disabled={isLoading}
            title="Weekly leads"
          >
            📈 Weekly
          </button>
        </div>
        <button className="btn btn-sm btn-ghost btn-circle" onClick={onClose}>
          <XMarkIcon className="w-6 h-6" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, idx) => (
          <div key={idx} className={`chat ${msg.role === 'user' ? 'chat-end' : 'chat-start'}`}> 
            <div className={`chat-bubble ${msg.role === 'user' ? 'bg-primary text-primary-content' : 'bg-base-200 text-base-content'}`}> 
              {/* Render message content, supporting OpenAI Vision format */}
              {Array.isArray(msg.content) ? (
                msg.content.map((item, i) => {
                  if (item.type === 'text') {
                    return <span key={i}>{item.text}</span>;
                  } else if (item.type === 'image_url') {
                    return <img key={i} src={item.image_url.url} alt="uploaded" className="max-w-xs my-2 rounded-lg border border-base-300" />;
                  } else {
                    return null;
                  }
                })
              ) : (
                <span>{msg.content}</span>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Image previews above input */}
      {imagePreviews.length > 0 && (
        <div className="flex gap-2 px-4 pt-2 pb-1 overflow-x-auto border-t border-base-200 bg-base-100">
          {imagePreviews.map((preview, idx) => (
            <div key={idx} className="relative">
              <img src={preview} alt="preview" className="w-20 h-20 object-cover rounded-lg border border-base-300" />
              <button onClick={() => handleRemoveImage(idx)} className="absolute top-0 right-0 bg-base-100 rounded-full p-1 shadow hover:bg-error hover:text-white transition-colors">
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="p-4 border-t border-base-200 flex items-end gap-2">
        <input
          type="text"
          className="input input-bordered flex-1"
          placeholder="Type your message..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
        />
        <input
          type="file"
          accept="image/*"
          className="hidden"
          ref={fileInputRef}
          onChange={handleImageChange}
          multiple
        />
        <button
          className="btn btn-ghost btn-circle"
          onClick={() => fileInputRef.current?.click()}
          title="Upload images"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5V19a2.003 2.003 0 002 2h14a2.003 2.003 0 002-2v-2.5M16.5 12.5l-4.5 4.5-4.5-4.5M12 3v13.5" />
          </svg>
        </button>
        <button className="btn btn-primary ml-2" onClick={() => handleSend()} disabled={isLoading || (!input.trim() && images.length === 0)}>
          Send
        </button>
      </div>

      {isDragActive && (
        <div className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none">
          <div className="bg-primary/80 text-white px-8 py-6 rounded-2xl shadow-xl text-2xl font-bold border-4 border-white/60 animate-pulse">
            Drop images to upload
          </div>
        </div>
      )}
    </div>
  );
};

export default AIChatWindow; 