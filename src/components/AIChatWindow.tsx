import React, { useState, useRef, useEffect } from 'react';
import { XMarkIcon, PaperAirplaneIcon, MagnifyingGlassIcon, ClockIcon, ChatBubbleLeftRightIcon, ArrowsPointingOutIcon, ArrowsPointingInIcon } from '@heroicons/react/24/solid';
import { supabase } from '../lib/supabase';
import { toast } from 'react-hot-toast';
import { FaRobot } from 'react-icons/fa';
import { useMsal } from '@azure/msal-react';

interface AIChatWindowProps {
  isOpen: boolean;
  onClose: () => void;
  onClientUpdate?: () => void;
  userName?: string;
  isFullPage?: boolean;
  onToggleFullPage?: () => void;
}

interface Message {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: any[];
  tool_call_id?: string;
}

interface ChatHistory {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  summary?: string;
  tags: string[];
}

interface NewLeadResult {
  id: string; // This will be a UUID string
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
      // Get current user info from MSAL
      const { instance } = useMsal();
      const account = instance?.getAllAccounts()[0];
      let currentUserEmail = account?.username || null;
      
      const { data, error } = await supabase.rpc('create_new_lead_v3', {
        p_lead_name: args.name,
        p_lead_email: args.email || null,
        p_lead_phone: args.phone || null,
        p_lead_topic: args.topic,
        p_lead_language: args.language || 'English',
        p_created_by: currentUserEmail,
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

const AIChatWindow: React.FC<AIChatWindowProps> = ({ isOpen, onClose, onClientUpdate, userName, isFullPage = false, onToggleFullPage }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [images, setImages] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const [aiIconAnim, setAiIconAnim] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  
  // Chat history state
  const [chatHistory, setChatHistory] = useState<ChatHistory[]>([]);
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const [historySearchTerm, setHistorySearchTerm] = useState('');
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  
  const messagesEndRef = useRef<null | HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(scrollToBottom, [messages]);
  
  // Mobile detection and keyboard handling
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    
    const handleResize = () => {
      checkMobile();
      // Reset keyboard state on resize
      setKeyboardOpen(false);
    };
    
    const handleVisualViewportChange = () => {
      if (isMobile) {
        const visualViewport = window.visualViewport;
        if (visualViewport) {
          const keyboardHeight = window.innerHeight - visualViewport.height;
          setKeyboardOpen(keyboardHeight > 150); // Consider keyboard open if height difference > 150px
        }
      }
    };
    
    checkMobile();
    window.addEventListener('resize', handleResize);
    
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleVisualViewportChange);
    }
    
    return () => {
      window.removeEventListener('resize', handleResize);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', handleVisualViewportChange);
      }
    };
  }, [isMobile]);
  
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

  const handleAiIconClick = () => {
    setAiIconAnim(true);
    setTimeout(() => setAiIconAnim(false), 600);
  };

  // Chat history functions
  const loadChatHistory = async (searchTerm = '') => {
    setIsLoadingHistory(true);
    try {
      // Try RPC function first, fallback to direct query
      let data, error;
      
      try {
        const result = await supabase.rpc('search_ai_chat_history', { p_search_term: searchTerm || '' });
        data = result.data;
        error = result.error;
      } catch (rpcError) {
        // Fallback to direct query if RPC function doesn't exist
        const result = await supabase
          .from('ai_chat_history')
          .select('id, title, created_at, updated_at, message_count, summary, tags')
          .eq('user_id', (await supabase.auth.getUser()).data.user?.id)
          .eq('is_archived', false)
          .order('updated_at', { ascending: false });
        data = result.data;
        error = result.error;
      }
      
      if (error) throw error;
      setChatHistory(data || []);
    } catch (error) {
      console.error('Error loading chat history:', error);
      toast.error('Failed to load chat history');
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const saveCurrentChat = async () => {
    if (messages.length <= 1) return; // Don't save if only greeting message
    
    try {
      const messagesToSave = messages.filter(msg => msg.content !== '...'); // Remove placeholder
      const user = (await supabase.auth.getUser()).data.user;
      if (!user) throw new Error('User not authenticated');
      
      if (currentChatId) {
        // Update existing chat
        try {
          const { error } = await supabase.rpc('update_ai_chat_history', {
            p_chat_id: currentChatId,
            p_messages: messagesToSave
          });
          if (error) throw error;
        } catch (rpcError) {
          // Fallback to direct update
          const { error } = await supabase
            .from('ai_chat_history')
            .update({
              messages: messagesToSave,
              message_count: messagesToSave.length,
              last_message_at: new Date().toISOString()
            })
            .eq('id', currentChatId)
            .eq('user_id', user.id);
          if (error) throw error;
        }
      } else {
        // Create new chat
        try {
          const { data, error } = await supabase.rpc('save_ai_chat_history', {
            p_title: null, // Will be auto-generated
            p_messages: messagesToSave
          });
          if (error) throw error;
          setCurrentChatId(data);
        } catch (rpcError) {
          // Fallback to direct insert
          const title = messagesToSave.find(msg => msg.role === 'user')?.content?.substring(0, 50) || 'New Conversation';
          const { data, error } = await supabase
            .from('ai_chat_history')
            .insert({
              user_id: user.id,
              title: title,
              messages: messagesToSave,
              message_count: messagesToSave.length
            })
            .select('id')
            .single();
          if (error) throw error;
          setCurrentChatId(data.id);
        }
      }
      
      // Refresh history
      loadChatHistory(historySearchTerm);
    } catch (error) {
      console.error('Error saving chat:', error);
      toast.error('Failed to save chat');
    }
  };

  const loadChat = async (chatId: string) => {
    try {
      const { data, error } = await supabase
        .from('ai_chat_history')
        .select('messages, title')
        .eq('id', chatId)
        .single();
      
      if (error) throw error;
      
      setMessages(data.messages);
      setCurrentChatId(chatId);
      setShowHistoryPanel(false);
      toast.success(`Loaded: ${data.title}`);
    } catch (error) {
      console.error('Error loading chat:', error);
      toast.error('Failed to load chat');
    }
  };

  const startNewChat = () => {
    setMessages([{ 
      role: 'assistant', 
      content: userName ? `Hi ${userName}, how can I help you?` : "Hello! How can I help you?"
    }]);
    setCurrentChatId(null);
    setShowHistoryPanel(false);
  };

  const deleteChat = async (chatId: string) => {
    if (!confirm('Are you sure you want to delete this chat?')) return;
    
    try {
      const { error } = await supabase
        .from('ai_chat_history')
        .delete()
        .eq('id', chatId);
      
      if (error) throw error;
      
      if (currentChatId === chatId) {
        startNewChat();
      }
      
      loadChatHistory(historySearchTerm);
      toast.success('Chat deleted');
    } catch (error) {
      console.error('Error deleting chat:', error);
      toast.error('Failed to delete chat');
    }
  };

  // Load chat history when component opens
  useEffect(() => {
    if (isOpen) {
      loadChatHistory();
    }
  }, [isOpen]);

  // Auto-save chat when messages change
  useEffect(() => {
    if (messages.length > 1 && !isLoading) {
      const saveTimeout = setTimeout(saveCurrentChat, 2000); // Save after 2 seconds of inactivity
      return () => clearTimeout(saveTimeout);
    }
  }, [messages, isLoading]);

  if (!isOpen) return null;

  return (
    <div
      className={`fixed z-50 flex flex-col transition-all duration-300 ${isOpen ? 'translate-y-0' : 'translate-y-full'} ${isDragActive ? 'ring-4 ring-primary/40' : ''} ${
        isFullPage 
          ? 'left-0 top-0 w-full h-full' 
          : 'right-0 top-0 bottom-0 w-full max-w-2xl'
      }`}
      style={{ 
        height: '100dvh', 
        minHeight: '100dvh', 
        maxHeight: '100dvh', 
        borderTopLeftRadius: isFullPage ? 0 : 0, 
        borderTopRightRadius: 0,
        borderBottomLeftRadius: isFullPage ? 0 : '2rem',
        borderBottomRightRadius: isFullPage ? 0 : '2rem'
      }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <style>{`
        .ai-glass {
          background: rgba(255,255,255,0.85);
          backdrop-filter: blur(18px) saturate(1.2);
          -webkit-backdrop-filter: blur(18px) saturate(1.2);
          border-left: 1.5px solid rgba(120,120,180,0.10);
          box-shadow: 0 8px 32px 0 rgba(31,38,135,0.10);
          border-top-left-radius: 2rem;
          border-bottom-left-radius: 2rem;
        }
        .ai-glass-fullpage {
          background: rgba(255,255,255,0.95);
          backdrop-filter: blur(18px) saturate(1.2);
          -webkit-backdrop-filter: blur(18px) saturate(1.2);
          box-shadow: 0 8px 32px 0 rgba(31,38,135,0.10);
          border-radius: 0;
        }
        .ai-header-gradient {
          background: linear-gradient(90deg, #7c3aed 0%, #38bdf8 100%);
        }
        .ai-bubble-user {
          background: linear-gradient(90deg, #6366f1 0%, #38bdf8 100%);
          color: #fff;
          border-bottom-right-radius: 2rem !important;
          border-top-left-radius: 2rem !important;
        }
        .ai-bubble-assistant {
          background: rgba(255,255,255,0.85);
          color: #222;
          border-bottom-left-radius: 2rem !important;
          border-top-right-radius: 2rem !important;
          border: 1px solid #e0e7ef;
        }
        .ai-quick-btn {
          border-radius: 9999px;
          font-weight: 600;
          padding: 0.25rem 1.1rem;
          font-size: 0.95rem;
          transition: background 0.2s, color 0.2s;
        }

        .ai-input-area {
          background: rgba(255,255,255,0.95);
          box-shadow: 0 2px 12px 0 rgba(31,38,135,0.07);
          border-radius: 1.5rem;
          border: 1px solid #e0e7ef;
        }
        @keyframes ai-pulse {
          0% { transform: scale(1) rotate(0deg); filter: drop-shadow(0 0 0 #fff); }
          30% { transform: scale(1.18) rotate(-10deg); filter: drop-shadow(0 0 8px #a5b4fc); }
          60% { transform: scale(0.95) rotate(8deg); filter: drop-shadow(0 0 12px #38bdf8); }
          100% { transform: scale(1) rotate(0deg); filter: drop-shadow(0 0 0 #fff); }
        }
        .animate-ai-pulse {
          animation: ai-pulse 0.6s cubic-bezier(.4,0,.2,1);
        }
        
        /* Mobile keyboard fixes */
        @supports (height: 100dvh) {
          .mobile-dvh {
            height: 100dvh;
            min-height: 100dvh;
          }
        }
        
        /* Safe area support for mobile */
        .pb-safe {
          padding-bottom: env(safe-area-inset-bottom, 1rem);
        }
        
        /* Mobile input focus styles */
        @media (max-width: 768px) {
          .ai-input-area input:focus {
            font-size: 16px; /* Prevents zoom on iOS */
          }
        }
        
        /* Line clamp utility */
        .line-clamp-2 {
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
      `}</style>
      <div 
        className={`${isFullPage ? 'ai-glass-fullpage' : 'ai-glass'} flex flex-col h-full w-full`}
        style={{
          ...(isMobile && {
            height: '100dvh',
            minHeight: '100dvh'
          })
        }}
      >
        {/* Header */}
        <div className={`ai-header-gradient sticky top-0 z-20 p-4 flex items-center justify-between ${isFullPage ? 'rounded-none' : 'rounded-tl-2xl'}`} style={{boxShadow:'0 2px 12px 0 rgba(31,38,135,0.07)'}}>
          <div className="flex items-center gap-3">
            <button
              className={`focus:outline-none ${aiIconAnim ? 'animate-ai-pulse' : ''}`}
              style={{ background: 'none', border: 'none', padding: 0, margin: 0, cursor: 'pointer' }}
              onClick={handleAiIconClick}
              tabIndex={0}
              aria-label="AI Icon"
            >
              <FaRobot className="h-9 w-9 text-white drop-shadow" />
            </button>
            <h3 className="font-extrabold text-xl text-white tracking-tight drop-shadow">RMQ AI</h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowHistoryPanel(!showHistoryPanel)}
              className={`ai-quick-btn ${showHistoryPanel ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'}`}
              title="Chat History"
            >
              <ChatBubbleLeftRightIcon className="w-4 h-4" />
            </button>
          </div>
          <div className="flex items-center gap-2">
            {onToggleFullPage && (
              <button 
                className="btn btn-sm btn-ghost btn-circle hover:bg-white/20 text-white" 
                onClick={onToggleFullPage}
                title={isFullPage ? "Exit full page" : "Enter full page"}
              >
                {isFullPage ? (
                  <ArrowsPointingInIcon className="w-5 h-5" />
                ) : (
                  <ArrowsPointingOutIcon className="w-5 h-5" />
                )}
              </button>
            )}
            <button className="btn btn-sm btn-ghost btn-circle hover:bg-white/20 text-white" onClick={onClose}>
              <XMarkIcon className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex flex-1 overflow-hidden">
          {/* Chat Area */}
          <div className={`flex flex-col ${showHistoryPanel ? 'w-2/3' : 'w-full'} transition-all duration-300`}>
            {/* Messages */}
            <div 
              className="flex-1 overflow-y-auto p-6 space-y-6"
              style={{
                ...(isMobile && keyboardOpen && {
                  paddingBottom: '120px' // Add space for fixed input
                })
              }}
            >
              {messages.map((msg, idx) => (
                <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[70%] px-5 py-3 rounded-2xl shadow ai-bubble-${msg.role} mb-2`} style={{fontSize:'1.05rem', lineHeight:1.6}}>
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
            <div 
              className={`ai-input-area p-4 flex items-end gap-2 border-t border-base-200 ${
                isMobile && keyboardOpen ? 'pb-safe' : ''
              }`}
              style={{
                ...(isMobile && keyboardOpen && {
                  position: 'fixed',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  zIndex: 60,
                  backgroundColor: 'rgba(255,255,255,0.95)',
                  backdropFilter: 'blur(18px) saturate(1.2)',
                  borderTop: '1px solid #e0e7ef',
                  paddingBottom: 'env(safe-area-inset-bottom, 1rem)'
                })
              }}
            >
              <input
                type="text"
                className="input input-bordered flex-1 bg-white/80 focus:bg-white/95 rounded-full px-5 py-3 text-base shadow-sm border border-base-200"
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
                className="btn btn-ghost btn-circle hover:bg-primary/10"
                onClick={() => fileInputRef.current?.click()}
                title="Upload images"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5V19a2.003 2.003 0 002 2h14a2.003 2.003 0 002-2v-2.5M16.5 12.5l-4.5 4.5-4.5-4.5M12 3v13.5" />
                </svg>
              </button>
              <button className="btn btn-primary ml-2 px-6 py-2 rounded-full shadow-lg text-base font-semibold transition-all duration-150 hover:scale-105 hover:bg-primary/90" onClick={() => handleSend()} disabled={isLoading || (!input.trim() && images.length === 0)}>
                Send
              </button>
            </div>
          </div>

          {/* Chat History Panel */}
          {showHistoryPanel && (
            <div className="w-1/3 border-l border-gray-200 bg-gray-50 flex flex-col">
              {/* History Header */}
              <div className="p-4 border-b border-gray-200 bg-white">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-gray-900">Chat History</h3>
                  <button
                    onClick={startNewChat}
                    className="btn btn-sm btn-primary"
                    title="Start New Chat"
                  >
                    New
                  </button>
                </div>
                
                {/* Search Bar */}
                <div className="relative">
                  <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search conversations..."
                    value={historySearchTerm}
                    onChange={(e) => {
                      setHistorySearchTerm(e.target.value);
                      loadChatHistory(e.target.value);
                    }}
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                  />
                </div>
              </div>

              {/* History List */}
              <div className="flex-1 overflow-y-auto">
                {isLoadingHistory ? (
                  <div className="flex items-center justify-center h-32">
                    <div className="loading loading-spinner loading-md text-blue-600"></div>
                  </div>
                ) : chatHistory.length === 0 ? (
                  <div className="p-8 text-center text-gray-500">
                    <ChatBubbleLeftRightIcon className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                    <p className="text-lg font-medium">No conversations yet</p>
                    <p className="text-sm">Start chatting to see your history here</p>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-200">
                    {chatHistory.map((chat) => (
                      <div
                        key={chat.id}
                        className={`p-4 hover:bg-gray-100 cursor-pointer transition-colors ${
                          currentChatId === chat.id ? 'bg-blue-50 border-r-2 border-blue-500' : ''
                        }`}
                        onClick={() => loadChat(chat.id)}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <h4 className="font-medium text-gray-900 truncate text-sm">
                              {chat.title}
                            </h4>
                            <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                              <ClockIcon className="w-3 h-3" />
                              <span>{new Date(chat.updated_at).toLocaleDateString()}</span>
                              <span>•</span>
                              <span>{chat.message_count} messages</span>
                            </div>
                            {chat.summary && (
                              <p className="text-xs text-gray-600 mt-1 line-clamp-2">
                                {chat.summary}
                              </p>
                            )}
                            {chat.tags && chat.tags.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-2">
                                {chat.tags.slice(0, 3).map((tag, idx) => (
                                  <span
                                    key={idx}
                                    className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded-full"
                                  >
                                    {tag}
                                  </span>
                                ))}
                                {chat.tags.length > 3 && (
                                  <span className="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded-full">
                                    +{chat.tags.length - 3}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteChat(chat.id);
                            }}
                            className="btn btn-ghost btn-xs text-red-500 hover:bg-red-50 ml-2 opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Delete chat"
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {isDragActive && (
          <div className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none">
            <div className="bg-primary/80 text-white px-8 py-6 rounded-2xl shadow-xl text-2xl font-bold border-4 border-white/60 animate-pulse">
              Drop images to upload
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AIChatWindow; 