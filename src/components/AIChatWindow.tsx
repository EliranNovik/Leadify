import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { XMarkIcon, PaperAirplaneIcon, MagnifyingGlassIcon, ClockIcon, ChatBubbleLeftRightIcon, ArrowsPointingOutIcon, ArrowsPointingInIcon } from '@heroicons/react/24/solid';
import { ArrowDownTrayIcon, CalendarDaysIcon, CheckIcon, ClockIcon as ClockOutlineIcon, DocumentArrowUpIcon, DocumentCheckIcon, PhotoIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';
import { toast } from 'react-hot-toast';
import { FaRobot } from 'react-icons/fa';
import { executeRmqAiTool, RMQ_AI_SYSTEM_PROMPT, RMQ_AI_TOOLS } from '../lib/rmqAiChatTools';
import { ChatLeadNumberText, parseChatLeadNumber } from './ChatLeadNumberText';
import { resolveLeadShareClientRoute } from '../lib/calendarClientRoute';
import {
  applyAiInputSuggestion,
  extractConversationHints,
  ghostSuffixFor,
  loadAutocompleteEmployeeNames,
  scoreRmqAiInputSuggestions,
  type AiInputSuggestion,
} from '../lib/rmqAiInputAutocomplete';
import { isInternalAppPath } from '../lib/crmAppMap';
import {
  isRmqExcelHref,
  rememberRmqAiFile,
  resolveRmqExcelFile,
  takeRmqAiToolFiles,
  triggerBrowserDownload,
  type RmqAiChatFile,
} from '../lib/rmqAiExcel';

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
  attachments?: RmqAiChatFile[];
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

const READY_ASKS = [
  {
    label: 'Signed today',
    hint: 'Closed deals from today',
    prompt: 'List signed contracts today with lead numbers, names, amounts, and closers.',
    Icon: DocumentCheckIcon,
    badge: 'bg-emerald-100 text-emerald-700',
  },
  {
    label: 'Clocked in now',
    hint: 'Who is at the office',
    prompt: 'Who is clocked in right now, and where?',
    Icon: ClockOutlineIcon,
    badge: 'bg-violet-100 text-violet-700',
  },
  {
    label: 'Meetings today',
    hint: 'Your meetings as manager, helper, guest, or participant',
    prompt:
      'List my meetings today. Call list_meetings with scope=mine. Only include meetings where I am meeting manager, helper, guest, or a participant. Show time, lead number, and my role.',
    Icon: CalendarDaysIcon,
    badge: 'bg-sky-100 text-sky-700',
  },
] as const;

const isVisibleChatMessage = (message: Message) => {
  if (message.role === 'tool') return false;
  if (message.role === 'assistant' && message.tool_calls?.length && !message.content) return false;
  return true;
};

const sanitizeMessages = (messages: Message[]) => {
  const sanitized: Message[] = [];
  if (!messages || messages.length === 0) return [];

  for (const message of messages) {
    if (
      message.content === 'AI is thinking...' ||
      message.content === 'Looking up CRM data...'
    ) {
      continue;
    }
    if (message.role === 'assistant' && !message.content && !message.tool_calls?.length) {
      continue;
    }

    const lastMessage = sanitized.length > 0 ? sanitized[sanitized.length - 1] : null;
    const canCollapse =
      lastMessage &&
      lastMessage.role === message.role &&
      message.role !== 'tool' &&
      !lastMessage.tool_calls?.length &&
      !message.tool_calls?.length;

    if (canCollapse) {
      sanitized[sanitized.length - 1] = message;
    } else {
      sanitized.push(message);
    }
  }
  return sanitized;
};

const AIChatWindow: React.FC<AIChatWindowProps> = ({ isOpen, onClose, onClientUpdate, userName, isFullPage = false, onToggleFullPage }) => {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [caret, setCaret] = useState(0);
  const [employeeNames, setEmployeeNames] = useState<string[]>([]);
  const [suggestDismissed, setSuggestDismissed] = useState(false);
  const [images, setImages] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
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
  const [historySelecting, setHistorySelecting] = useState(false);
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<string[]>([]);
  
  const messagesEndRef = useRef<null | HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(scrollToBottom, [messages]);

  useEffect(() => {
    if (!attachMenuOpen) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (attachMenuRef.current?.contains(target)) return;
      setAttachMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAttachMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [attachMenuOpen]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    void loadAutocompleteEmployeeNames().then((names) => {
      if (!cancelled) setEmployeeNames(names);
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const conversationHints = useMemo(() => extractConversationHints(messages), [messages]);
  const lastAssistant = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (message.role !== 'assistant' || !message.content) continue;
      if (message.content === 'AI is thinking...' || message.content === 'Looking up CRM data...') continue;
      return typeof message.content === 'string' ? message.content : '';
    }
    return '';
  }, [messages]);
  const suggestions = useMemo(
    () =>
      scoreRmqAiInputSuggestions({
        input,
        caret,
        employees: employeeNames,
        conversationLeads: conversationHints.leads,
        conversationNames: conversationHints.names,
        historyTitles: chatHistory
          .map((chat) => chat.title)
          .filter((title) => title && title.length > 8 && !/^new conversation/i.test(title))
          .slice(0, 20),
        lastAssistant,
      }),
    [input, caret, employeeNames, conversationHints, chatHistory, lastAssistant],
  );
  const visibleSuggestions = suggestDismissed || attachMenuOpen ? [] : suggestions;
  const activeSuggestion =
    visibleSuggestions.find((item) => ghostSuffixFor(input, caret, item)) || null;
  const ghostSuffix = ghostSuffixFor(input, caret, activeSuggestion);

  const applySuggestion = (suggestion: AiInputSuggestion) => {
    const currentCaret = textareaRef.current?.selectionStart ?? caret;
    const { next, caret: nextCaret } = applyAiInputSuggestion(input, currentCaret, suggestion);
    setInput(next);
    setCaret(nextCaret);
    setSuggestDismissed(false);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(nextCaret, nextCaret);
    });
  };
  
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
        content: `${greeting} I can look up any lead, summarize the case, and pull CRM numbers from the database.`
      }]);
    }
  }, [isOpen, messages.length, userName]);

  // Quick action handlers
  const handleQuickAction = (action: string) => {
    handleSend(action);
  };

  const addImageFiles = (files: File[]) => {
    const imageFiles = files.filter((file) => file.type.startsWith('image/'));
    if (!imageFiles.length) return 0;
    if (imageFiles.length + images.length > 10) {
      toast.error('You can upload up to 10 images.');
      return 0;
    }
    setImages((prev) => [...prev, ...imageFiles]);
    imageFiles.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setImagePreviews((prev) => [...prev, ev.target?.result as string]);
      };
      reader.readAsDataURL(file);
    });
    return imageFiles.length;
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    addImageFiles(Array.from(e.target.files || []));
  };

  // Remove selected image by index
  const handleRemoveImage = (idx: number) => {
    setImages(prev => prev.filter((_, i) => i !== idx));
    setImagePreviews(prev => prev.filter((_, i) => i !== idx));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Format text with smart line breaks and lists
  const formatMessageContent = (content: string): React.ReactNode => {
    if (!content) return null;
    
    // First, normalize excessive dashes (replace multiple dashes with proper formatting)
    let normalized = content
      .replace(/^[-]{2,}/gm, '')
      .replace(/[-]{3,}/g, '—')
      .replace(/\[(?:#)?([LC]\d+(?:\/\d+)?)\]\((?:#|javascript:[^)]*)?\)/gi, '$1');
    
    // Split by double newlines for paragraphs, but preserve single newlines within paragraphs
    const blocks = normalized.split(/\n\n+/).filter(p => p.trim());
    
    return blocks.map((block, bIdx) => {
      const trimmed = block.trim();
      const lines = trimmed.split('\n').filter(l => l.trim());
      
      // Check if all lines are list items
      const allListItems = lines.every(line => /^[-*•]\s/.test(line.trim()) || /^\d+[.)]\s/.test(line.trim()));
      
      if (allListItems && lines.length > 1) {
        // Check if it's a numbered list
        const isNumbered = lines[0].trim().match(/^\d+[.)]\s/);
        
        if (isNumbered) {
          return (
            <ol key={bIdx} className="list-decimal list-inside my-3 space-y-1.5 ml-2">
              {lines.map((line, idx) => {
                const cleanItem = line.trim().replace(/^\d+[.)]\s/, '').trim();
                const formatted = formatInlineText(cleanItem);
                return <li key={idx} className="text-sm leading-relaxed pl-1">{formatted}</li>;
              })}
            </ol>
          );
        } else {
          return (
            <ul key={bIdx} className="list-disc list-inside my-3 space-y-1.5 ml-2">
              {lines.map((line, idx) => {
                const cleanItem = line.trim().replace(/^[-*•]\s/, '').trim();
                const formatted = formatInlineText(cleanItem);
                return <li key={idx} className="text-sm leading-relaxed pl-1">{formatted}</li>;
              })}
            </ul>
          );
        }
      }
      
      // Regular paragraph - join lines with proper spacing
      const paragraphText = lines.join(' ').trim();
      return (
        <p key={bIdx} className="my-2.5 text-sm leading-relaxed">
          {formatInlineText(paragraphText)}
        </p>
      );
    });
  };

  // Format inline text (bold, italic, code, links)
  const formatInlineText = (text: string): React.ReactNode => {
    if (!text) return null;
    
    const parts: React.ReactNode[] = [];
    let keyCounter = 0;
    
    // Pattern for **bold**, *italic*, `code`, and [links](url)
    const patterns = [
      { 
        regex: /\*\*([^*]+)\*\*/g, 
        render: (match: string) => (
          <strong key={`format-${keyCounter++}`} className="font-semibold">
            <ChatLeadNumberText text={match} onOpen={onClose} />
          </strong>
        )
      },
      { 
        regex: /\*([^*]+)\*/g, 
        render: (match: string) => (
          <em key={`format-${keyCounter++}`} className="italic">
            <ChatLeadNumberText text={match} onOpen={onClose} />
          </em>
        )
      },
      { 
        regex: /`([^`]+)`/g, 
        render: (match: string) => (
          <code key={`format-${keyCounter++}`} className="bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded text-sm font-mono text-gray-800 dark:text-gray-200">
            {match}
          </code>
        ) 
      },
      { 
        regex: /\[([^\]]+)\]\(([^)]+)\)/g, 
        render: (match: string, url: string) => {
          const excelFile = isRmqExcelHref(url) ? resolveRmqExcelFile(url) : null;
          const isExcel =
            Boolean(excelFile) ||
            /\.xlsx(\?|#|$)/i.test(url) ||
            url.startsWith('data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
          if (isExcel) {
            const file = excelFile || { filename: match.replace(/^Download\s+/i, '').trim() || 'export.xlsx', url };
            return (
              <button
                key={`format-${keyCounter++}`}
                type="button"
                onClick={() => {
                  if (!file.url) {
                    toast.error('This Excel file is no longer available. Ask me to create it again.');
                    return;
                  }
                  triggerBrowserDownload(file);
                }}
                className="inline-flex items-center gap-1 font-semibold text-blue-600 underline hover:text-blue-800"
              >
                <ArrowDownTrayIcon className="h-4 w-4" />
                {match}
              </button>
            );
          }
          const leadFromLabel = parseChatLeadNumber(match);
          const leadFromUrl = parseChatLeadNumber(url.replace(/^\/clients\/?/i, ''));
          const leadNumber = leadFromLabel || leadFromUrl;
          const to = isInternalAppPath(url)
            ? url
            : leadNumber
              ? resolveLeadShareClientRoute({ leadNumber })
              : '';
          if (to) {
            return (
              <Link
                key={`format-${keyCounter++}`}
                to={to}
                onClick={(event) => {
                  event.stopPropagation();
                  onClose();
                }}
                className="font-semibold text-violet-700 underline hover:text-violet-900"
                title={leadNumber ? `Open client ${leadNumber}` : match}
              >
                {leadNumber || match}
              </Link>
            );
          }
          return (
            <a 
              key={`format-${keyCounter++}`} 
              href={url} 
              target="_blank" 
              rel="noopener noreferrer" 
              className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 underline"
            >
              {match}
            </a>
          );
        }
      },
    ];
    
    // Find all matches with their positions
    const allMatches: Array<{ index: number; length: number; type: number; match: RegExpExecArray }> = [];
    patterns.forEach(({ regex }, typeIndex) => {
      let match;
      regex.lastIndex = 0;
      while ((match = regex.exec(text)) !== null) {
        allMatches.push({
          index: match.index,
          length: match[0].length,
          type: typeIndex,
          match: match
        });
      }
    });
    
    // Sort matches by index
    allMatches.sort((a, b) => a.index - b.index);
    
    // Remove overlapping matches (keep first)
    const nonOverlapping: typeof allMatches = [];
    allMatches.forEach(match => {
      const overlaps = nonOverlapping.some(existing => 
        (match.index >= existing.index && match.index < existing.index + existing.length) ||
        (existing.index >= match.index && existing.index < match.index + match.length)
      );
      if (!overlaps) {
        nonOverlapping.push(match);
      }
    });
    
    // Build parts
    let currentIndex = 0;
    nonOverlapping.forEach((matchInfo) => {
      if (matchInfo.index > currentIndex) {
        const plainText = text.substring(currentIndex, matchInfo.index);
        if (plainText) {
          parts.push(
            <span key={`text-${keyCounter++}`}>
              <ChatLeadNumberText text={plainText} onOpen={onClose} />
            </span>,
          );
        }
      }
      
      const pattern = patterns[matchInfo.type];
      const match = matchInfo.match;
      if (match[2]) {
        // Link pattern with URL
        parts.push(pattern.render(match[1], match[2]));
      } else {
        // Other patterns (bold, italic, code)
        parts.push(pattern.render(match[1], ''));
      }
      
      currentIndex = matchInfo.index + matchInfo.length;
    });
    
    if (currentIndex < text.length) {
      const remaining = text.substring(currentIndex);
      if (remaining) {
        parts.push(
          <span key={`text-${keyCounter++}`}>
            <ChatLeadNumberText text={remaining} onOpen={onClose} />
          </span>,
        );
      }
    }
    
    return parts.length > 0 ? <>{parts}</> : <ChatLeadNumberText text={text} onOpen={onClose} />;
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
    const imagesData = images.map((file, index) => ({
      name: file.name,
      data: imagePreviews[index],
    }));

    setMessages(newMessages);
    if (!customInput) {
      setInput('');
      setCaret(0);
      setSuggestDismissed(true);
    }
    setImages([]);
    setImagePreviews([]);
    if (fileInputRef.current) fileInputRef.current.value = '';

    // Add a loading message
    setMessages(prev => [...prev, { role: 'assistant', content: 'AI is thinking...' }]);
    
    const messagesForApi = sanitizeMessages(newMessages).map(({ attachments: _attachments, ...message }) => message);

    const callChat = async (payloadMessages: Message[], includeImages = false) => {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify({
          messages: [{ role: 'system', content: RMQ_AI_SYSTEM_PROMPT }, ...payloadMessages],
          images: includeImages ? imagesData : [],
          tools: RMQ_AI_TOOLS,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || `Request failed with status ${response.status}`);
      }
      return data as Message;
    };

    try {
      let conversation = messagesForApi;
      let aiResponseMessage: Message | null = null;
      const createdFiles: RmqAiChatFile[] = [];
      const appMapLinks: string[] = [];
      for (let round = 0; round < 6; round += 1) {
        const reply = await callChat(conversation, round === 0);
        if (reply.tool_calls?.length) {
          conversation = [
            ...conversation,
            { role: 'assistant', content: reply.content || '', tool_calls: reply.tool_calls },
          ];
          setMessages((prev) => [
            ...prev.slice(0, -1),
            { role: 'assistant', content: 'Looking up CRM data...' },
          ]);
          for (const toolCall of reply.tool_calls) {
            const toolResult = await executeRmqAiTool(toolCall);
            const fnName = toolCall?.function?.name;
            createdFiles.push(...takeRmqAiToolFiles());
            if (fnName === 'find_app_page') {
              for (const line of String(toolResult).split('\n')) {
                const match = line.match(/\[([^\]]+)\]\((\/[^)]+)\)/);
                if (match) appMapLinks.push(`[${match[1]}](${match[2]})`);
              }
            }
            if (fnName === 'create_lead' || fnName === 'create_meeting') {
              if (!String(toolResult).startsWith('Error')) {
                toast.success(toolResult);
                onClientUpdate?.();
              } else {
                toast.error(toolResult);
              }
            }
            if (fnName === 'create_excel_sheet' && !String(toolResult).startsWith('Could not') && !String(toolResult).startsWith('create_excel_sheet')) {
              toast.success('Excel file ready to download');
            }
            conversation = [
              ...conversation,
              { role: 'tool', content: toolResult, tool_call_id: toolCall.id },
            ];
          }
          continue;
        }
        aiResponseMessage = reply;
        break;
      }

      const replyContent = aiResponseMessage?.content || '';
      const missingFileLinks = createdFiles.filter((file) => !replyContent.includes(`rmq-excel://${file.id}`));
      const missingMapLinks = appMapLinks.filter((link) => !replyContent.includes(link.slice(link.indexOf(']('))));
      const extraLinks = [
        ...missingFileLinks.map((file) => `[Download ${file.filename}](rmq-excel://${file.id})`),
        ...missingMapLinks,
      ];
      const withLinks = extraLinks.length
        ? `${replyContent}${replyContent ? '\n\n' : ''}${extraLinks.join('\n')}`
        : replyContent;

      setMessages((prev) => [
        ...prev.slice(0, -1),
        {
          role: 'assistant',
          content:
            withLinks ||
            'I looked up the CRM data but could not finish a reply. Please try again.',
          attachments: createdFiles.length ? createdFiles : undefined,
        },
      ]);

    } catch (error) {
      console.error('Error in handleSend:', error);
      const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";
      setMessages(prev => {
        const updated = [...prev];
        const lastIndex = updated.length - 1;
        if (lastIndex >= 0 && updated[lastIndex].role === 'assistant') {
          updated[lastIndex] = { 
            ...updated[lastIndex], 
            content: `Sorry, an error occurred: ${errorMessage}`
          };
        }
        return updated;
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
    addImageFiles(Array.from(e.dataTransfer.files));
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
      const messagesToSave = messages.filter(
        (msg) =>
          isVisibleChatMessage(msg) &&
          msg.content !== '...' &&
          msg.content !== 'AI is thinking...' &&
          msg.content !== 'Looking up CRM data...',
      );
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
      
      const loaded = (data.messages || []) as Message[];
      for (const message of loaded) {
        for (const file of message.attachments || []) {
          if (file?.id && file.url) rememberRmqAiFile(file);
        }
      }
      setMessages(loaded);
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
      content: userName
        ? `Hi ${userName}, how can I help you? I can look up any lead, summarize the case, and pull CRM numbers from the database.`
        : 'Hello! How can I help you? I can look up any lead, summarize the case, and pull CRM numbers from the database.',
    }]);
    setCurrentChatId(null);
    setShowHistoryPanel(false);
    setHistorySelecting(false);
    setSelectedHistoryIds([]);
  };

  const toggleHistorySelection = (chatId: string) => {
    setSelectedHistoryIds((prev) =>
      prev.includes(chatId) ? prev.filter((id) => id !== chatId) : [...prev, chatId],
    );
  };

  const handleHistoryDeleteClick = () => {
    if (!historySelecting) {
      setHistorySelecting(true);
      setSelectedHistoryIds([]);
      return;
    }
    if (selectedHistoryIds.length === 0) {
      setHistorySelecting(false);
      return;
    }
    const count = selectedHistoryIds.length;
    if (!confirm(`Delete ${count} conversation${count === 1 ? '' : 's'}? This cannot be undone.`)) {
      return;
    }
    void deleteChats(selectedHistoryIds);
  };

  const deleteChats = async (chatIds: string[]) => {
    if (chatIds.length === 0) return;
    try {
      const { error } = await supabase.from('ai_chat_history').delete().in('id', chatIds);
      if (error) throw error;
      if (currentChatId && chatIds.includes(currentChatId)) {
        startNewChat();
      }
      setHistorySelecting(false);
      setSelectedHistoryIds([]);
      loadChatHistory(historySearchTerm);
      toast.success(chatIds.length === 1 ? 'Chat deleted' : `${chatIds.length} chats deleted`);
    } catch (error) {
      console.error('Error deleting chats:', error);
      toast.error('Failed to delete chats');
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
          : `right-0 top-0 bottom-0 w-full ${showHistoryPanel ? 'max-w-5xl' : 'max-w-2xl'}`
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
        .ai-glass,
        .ai-glass-fullpage {
          background: #f9fafb;
          box-shadow: none;
          border-radius: 0;
        }
        .ai-bubble-user {
          background: linear-gradient(90deg, #6366f1 0%, #38bdf8 100%);
          color: #fff;
          border-bottom-right-radius: 2rem !important;
          border-top-left-radius: 2rem !important;
        }
        .ai-bubble-assistant {
          background: #fff;
          color: #1f2937;
          border-bottom-left-radius: 2rem !important;
          border-top-right-radius: 2rem !important;
          border: none;
          box-shadow: none;
          outline: none;
        }
        
        .ai-bubble-assistant .prose {
          color: #1f2937;
        }
        .ai-bubble-user .prose,
        .ai-bubble-user .prose p,
        .ai-bubble-user .prose li,
        .ai-bubble-user .prose strong {
          color: #fff;
        }
        .ai-bubble-user .chat-lead-number-link {
          color: #fff !important;
          text-decoration: underline;
        }
        .ai-bubble-assistant .chat-lead-number-link {
          color: #3b28c7;
        }
        
        .ai-bubble-assistant .prose p {
          margin-top: 0.75rem;
          margin-bottom: 0.75rem;
        }
        
        .ai-bubble-assistant .prose ul,
        .ai-bubble-assistant .prose ol {
          margin-top: 0.5rem;
          margin-bottom: 0.5rem;
          padding-left: 1.5rem;
        }
        
        .ai-bubble-assistant .prose li {
          margin-top: 0.25rem;
          margin-bottom: 0.25rem;
        }
        
        .ai-bubble-assistant .prose strong {
          font-weight: 600;
          color: #111827;
        }
        
        .ai-bubble-assistant .prose code {
          background-color: #f3f4f6;
          padding: 0.125rem 0.375rem;
          border-radius: 0.25rem;
          font-size: 0.875em;
          font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
        }
        .ai-quick-btn {
          border-radius: 9999px;
          font-weight: 600;
          padding: 0.25rem 1.1rem;
          font-size: 0.95rem;
          transition: background 0.2s, color 0.2s;
        }

        .contract-ai-input-area {
          background: transparent;
          box-shadow: none;
        }
        .contract-ai-input-shell {
          border-radius: 9999px;
          background: #fff;
          border: none;
          box-shadow: 0 10px 32px rgba(15, 23, 42, 0.1);
        }
        .contract-ai-input-shell:focus-within {
          outline: none;
          box-shadow: none;
        }
        .contract-ai-input-area textarea {
          overflow-y: auto;
          scrollbar-width: none;
          -ms-overflow-style: none;
          outline: none;
          box-shadow: none;
        }
        .contract-ai-input-area textarea:focus {
          outline: none;
          box-shadow: none;
        }
        .contract-ai-input-area textarea::-webkit-scrollbar {
          display: none;
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
          .contract-ai-input-area textarea:focus {
            font-size: 16px;
          }
        }
        
        /* Line clamp utility */
        .line-clamp-2 {
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .ai-chat-header {
          background: rgba(255, 255, 255, 0.42);
          border-bottom: 1px solid rgba(255, 255, 255, 0.45);
          box-shadow: 0 8px 32px rgba(15, 23, 42, 0.04);
          backdrop-filter: blur(22px) saturate(1.6);
          -webkit-backdrop-filter: blur(22px) saturate(1.6);
        }
        .ai-chat-under-header {
          padding-top: calc(3.35rem + max(1rem, env(safe-area-inset-top, 0px)));
        }
      `}</style>
      <div 
        className={`${isFullPage ? 'ai-glass-fullpage' : 'ai-glass'} relative flex h-full w-full flex-col`}
        style={{
          ...(isMobile && {
            height: '100dvh',
            minHeight: '100dvh'
          })
        }}
      >
        {/* Header */}
        <div className="ai-chat-header absolute inset-x-0 top-0 z-30 flex items-center justify-between px-5 pb-3 pt-[max(1rem,env(safe-area-inset-top))]">
          <div className="flex items-center gap-2.5">
            <button
              className={`focus:outline-none ${aiIconAnim ? 'animate-ai-pulse' : ''}`}
              style={{ background: 'none', border: 'none', padding: 0, margin: 0, cursor: 'pointer' }}
              onClick={handleAiIconClick}
              tabIndex={0}
              aria-label="AI Icon"
            >
              <FaRobot className="h-7 w-7 text-violet-600" />
            </button>
            <h3 className="text-lg font-semibold text-gray-900">RMQ AI</h3>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowHistoryPanel(!showHistoryPanel)}
              className={`btn btn-ghost btn-sm btn-square ${showHistoryPanel ? 'text-violet-700' : 'text-base-content/60'}`}
              title="Chat History"
            >
              <ChatBubbleLeftRightIcon className="h-5 w-5" />
            </button>
            {onToggleFullPage && (
              <button 
                className="btn btn-ghost btn-sm btn-square text-base-content/60"
                onClick={onToggleFullPage}
                title={isFullPage ? "Exit full page" : "Enter full page"}
              >
                {isFullPage ? (
                  <ArrowsPointingInIcon className="h-5 w-5" />
                ) : (
                  <ArrowsPointingOutIcon className="h-5 w-5" />
                )}
              </button>
            )}
            <button className="btn btn-ghost btn-sm btn-square text-base-content/60" onClick={onClose} aria-label="Close">
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {showHistoryPanel && (
            <div className="ai-chat-under-header flex w-72 shrink-0 flex-col overflow-hidden rounded-r-3xl border-r border-gray-200/70 bg-white md:w-96">
              <div className="border-b border-gray-100 bg-white p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="font-semibold text-gray-900">Chat History</h3>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleHistoryDeleteClick}
                      className={`inline-flex h-9 items-center justify-center rounded-full px-3 text-sm font-semibold shadow-sm transition ${
                        historySelecting
                          ? selectedHistoryIds.length > 0
                            ? 'bg-red-600 text-white hover:bg-red-700'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                          : 'bg-gray-100 text-red-500 hover:bg-red-50'
                      }`}
                      title={
                        historySelecting
                          ? selectedHistoryIds.length > 0
                            ? `Delete ${selectedHistoryIds.length} selected`
                            : 'Cancel selection'
                          : 'Select chats to delete'
                      }
                      aria-label={
                        historySelecting
                          ? selectedHistoryIds.length > 0
                            ? 'Confirm delete'
                            : 'Cancel selection'
                          : 'Delete chats'
                      }
                    >
                      <TrashIcon className="h-5 w-5" />
                      {historySelecting && selectedHistoryIds.length > 0 ? (
                        <span className="ml-1">{selectedHistoryIds.length}</span>
                      ) : null}
                    </button>
                    <button
                      type="button"
                      onClick={startNewChat}
                      className="inline-flex h-9 items-center gap-1.5 rounded-full bg-violet-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-700"
                      title="Start New Chat"
                    >
                      <PlusIcon className="h-4 w-4" strokeWidth={2.5} />
                      New
                    </button>
                  </div>
                </div>
                <div className="relative">
                  <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search conversations..."
                    value={historySearchTerm}
                    onChange={(e) => {
                      setHistorySearchTerm(e.target.value);
                      loadChatHistory(e.target.value);
                    }}
                    className="w-full rounded-xl border-0 bg-gray-100 py-2 pl-10 pr-4 text-sm text-gray-900 placeholder:text-gray-500 outline-none ring-0 focus:border-0 focus:outline-none focus:ring-0"
                  />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto bg-white p-3">
                {isLoadingHistory ? (
                  <div className="flex h-32 items-center justify-center">
                    <div className="loading loading-spinner loading-md text-violet-600"></div>
                  </div>
                ) : chatHistory.length === 0 ? (
                  <div className="rounded-2xl bg-white p-8 text-center text-gray-500">
                    <ChatBubbleLeftRightIcon className="mx-auto mb-4 h-12 w-12 text-gray-300" />
                    <p className="text-lg font-medium">No conversations yet</p>
                    <p className="text-sm">Start chatting to see your history here</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {chatHistory.map((chat) => {
                      const isSelected = selectedHistoryIds.includes(chat.id);
                      return (
                      <div
                        key={chat.id}
                        className={`cursor-pointer rounded-l-xl rounded-r-3xl bg-white p-4 ring-1 transition-colors ${
                          historySelecting && isSelected
                            ? 'ring-2 ring-red-400'
                            : currentChatId === chat.id
                              ? 'ring-2 ring-violet-400'
                              : 'ring-gray-100 hover:ring-gray-200'
                        }`}
                        onClick={() =>
                          historySelecting ? toggleHistorySelection(chat.id) : loadChat(chat.id)
                        }
                      >
                        <div className="flex items-start gap-3">
                          {historySelecting ? (
                            <span
                              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                                isSelected
                                  ? 'border-red-500 bg-red-500 text-white'
                                  : 'border-gray-300 bg-white'
                              }`}
                              aria-hidden
                            >
                              {isSelected ? <CheckIcon className="h-3.5 w-3.5" strokeWidth={3} /> : null}
                            </span>
                          ) : null}
                          <div className="min-w-0 flex-1">
                            <h4 className="truncate text-sm font-medium text-gray-900">
                              {chat.title}
                            </h4>
                            <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                              <ClockIcon className="h-3 w-3" />
                              <span>{new Date(chat.updated_at).toLocaleDateString()}</span>
                              <span>•</span>
                              <span>{chat.message_count} messages</span>
                            </div>
                            {chat.summary && (
                              <p className="mt-1 line-clamp-2 text-xs text-gray-600">
                                {chat.summary}
                              </p>
                            )}
                            {chat.tags && chat.tags.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {chat.tags.slice(0, 3).map((tag, idx) => (
                                  <span
                                    key={idx}
                                    className="rounded-full bg-violet-100 px-2 py-1 text-xs text-violet-700"
                                  >
                                    {tag}
                                  </span>
                                ))}
                                {chat.tags.length > 3 && (
                                  <span className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-600">
                                    +{chat.tags.length - 3}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-gray-50">
            {/* Messages */}
            <div 
              className="ai-chat-under-header min-h-0 flex-1 space-y-4 overflow-y-auto bg-gray-50 px-4 pb-28 md:px-5 md:pb-32"
              style={{
                ...(isMobile && keyboardOpen && {
                  paddingBottom: '120px'
                })
              }}
            >
              {messages.filter(isVisibleChatMessage).map((msg, idx) => (
                <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[85%] rounded-2xl px-5 py-4 ai-bubble-${msg.role} ${
                      msg.content === 'AI is thinking...' || msg.content === 'Looking up CRM data...' ? 'opacity-80' : ''
                    }`}
                    style={{ fontSize: '1rem', lineHeight: 1.7 }}
                  >
                    {Array.isArray(msg.content) ? (
                      msg.content.map((item, i) => {
                        if (item.type === 'text') {
                          return (
                            <div key={i} className={`prose prose-sm max-w-none ${msg.role === 'user' ? 'text-white' : 'text-gray-800'}`}>
                              {formatMessageContent(item.text)}
                            </div>
                          );
                        }
                        if (item.type === 'image_url') {
                          return <img key={i} src={item.image_url.url} alt="uploaded" className="my-2 max-w-xs rounded-xl" />;
                        }
                        return null;
                      })
                    ) : msg.content === 'AI is thinking...' || msg.content === 'Looking up CRM data...' ? (
                      <p className="flex items-center gap-2 text-sm leading-relaxed text-gray-600">
                        <span className="loading loading-spinner loading-sm" />
                        <span>{msg.content === 'Looking up CRM data...' ? 'Looking up CRM data…' : 'Starting…'}</span>
                      </p>
                    ) : (
                      <div className={`prose prose-sm max-w-none ${msg.role === 'user' ? 'text-white' : 'text-gray-800'}`}>
                        {formatMessageContent(msg.content)}
                      </div>
                    )}
                    {msg.role === 'assistant' && msg.attachments?.length ? (
                      <div className="mt-3 flex flex-col gap-2">
                        {msg.attachments.map((file) => (
                          <button
                            key={file.id}
                            type="button"
                            onClick={() => {
                              const live = resolveRmqExcelFile(file.id) || file;
                              if (!live.url) {
                                toast.error('This Excel file is no longer available. Ask me to create it again.');
                                return;
                              }
                              triggerBrowserDownload(live);
                            }}
                            className="inline-flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-left text-sm font-semibold text-violet-800 hover:bg-violet-100"
                          >
                            <ArrowDownTrayIcon className="h-4 w-4 shrink-0" />
                            <span className="min-w-0 truncate">Download {file.filename}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            <div
              className={`contract-ai-input-area pointer-events-none absolute inset-x-0 bottom-0 z-20 px-4 pb-4 pt-2 md:px-5 ${isMobile && keyboardOpen ? 'pb-safe' : ''}`}
              style={{
                ...(isMobile && keyboardOpen && {
                  position: 'fixed',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  zIndex: 60,
                  backgroundColor: 'transparent',
                  paddingBottom: 'env(safe-area-inset-bottom, 1rem)'
                })
              }}
            >
              {imagePreviews.length > 0 && (
                <div className="pointer-events-auto mb-2 flex gap-2 overflow-x-auto">
                  {imagePreviews.map((preview, idx) => (
                    <div key={idx} className="relative">
                      <img src={preview} alt="preview" className="h-16 w-16 rounded-xl object-cover shadow-md" />
                      <button
                        type="button"
                        onClick={() => handleRemoveImage(idx)}
                        className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-white text-xs text-gray-600 shadow-sm"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="pointer-events-auto flex items-end gap-2">
                <div className="contract-ai-input-shell relative flex min-w-0 flex-1 items-end overflow-visible">
                  <div className="relative shrink-0 self-center pl-1.5" ref={attachMenuRef}>
                    <button
                      type="button"
                      className="btn btn-ghost btn-circle btn-sm h-10 w-10 text-slate-500 hover:bg-gray-100"
                      onClick={() => setAttachMenuOpen((open) => !open)}
                      disabled={isLoading}
                      aria-expanded={attachMenuOpen}
                      aria-haspopup="menu"
                      title="Add"
                      aria-label="Add"
                    >
                      <PlusIcon className="h-5 w-5" />
                    </button>
                    {attachMenuOpen ? (
                      <div
                        role="menu"
                        className="absolute bottom-full left-0 z-50 mb-2 w-80 rounded-2xl border border-gray-100 bg-white py-1.5 shadow-lg"
                      >
                        <button
                          type="button"
                          role="menuitem"
                          className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50"
                          onClick={() => {
                            setAttachMenuOpen(false);
                            fileInputRef.current?.click();
                          }}
                        >
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-600">
                            <PhotoIcon className="h-4 w-4" />
                          </span>
                          <span className="min-w-0 leading-snug">
                            <span className="text-sm font-medium text-gray-900">Images</span>
                            {' '}
                            <span className="text-xs text-gray-500">Attach photos to this chat</span>
                          </span>
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50"
                          onClick={() => {
                            setAttachMenuOpen(false);
                            onClose();
                            navigate('/documents');
                          }}
                        >
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
                            <DocumentArrowUpIcon className="h-4 w-4" />
                          </span>
                          <span className="min-w-0 leading-snug">
                            <span className="text-sm font-medium text-gray-900">Documents</span>
                            {' '}
                            <span className="text-xs text-gray-500">Open the documents folder</span>
                          </span>
                        </button>
                        <div className="my-1 border-t border-gray-100" />
                        <p className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                          Quick asks
                        </p>
                        {READY_ASKS.map(({ label, hint, prompt, Icon, badge }) => (
                          <button
                            key={label}
                            type="button"
                            role="menuitem"
                            className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50"
                            onClick={() => {
                              setAttachMenuOpen(false);
                              handleQuickAction(prompt);
                            }}
                          >
                            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${badge}`}>
                              <Icon className="h-4 w-4" />
                            </span>
                            <span className="min-w-0 leading-snug">
                              <span className="text-sm font-medium text-gray-900">{label}</span>
                              {' '}
                              <span className="text-xs text-gray-500">{hint}</span>
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="relative min-w-0 flex-1">
                    {ghostSuffix ? (
                      <div
                        aria-hidden
                        className="pointer-events-none absolute inset-0 overflow-hidden py-3 pl-1 pr-5 text-base leading-relaxed text-gray-400"
                      >
                        <span className="invisible whitespace-pre-wrap break-words">{input}</span>
                        <span className="whitespace-pre-wrap break-words">{ghostSuffix}</span>
                      </div>
                    ) : null}
                    <textarea
                      ref={textareaRef}
                      rows={1}
                      className="relative min-h-[3rem] min-w-0 w-full resize-none border-0 bg-transparent py-3 pl-1 pr-5 text-base leading-relaxed text-gray-900 placeholder:text-gray-500 focus:outline-none focus:ring-0"
                      placeholder="Ask anything..."
                      value={input}
                      onChange={(e) => {
                        setInput(e.target.value);
                        setCaret(e.target.selectionStart ?? e.target.value.length);
                        setSuggestDismissed(false);
                      }}
                      onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? input.length)}
                      onClick={(e) => setCaret(e.currentTarget.selectionStart ?? input.length)}
                      disabled={isLoading}
                      onPaste={(e) => {
                        const pasted = Array.from(e.clipboardData?.files || []).filter((file) =>
                          file.type.startsWith('image/'),
                        );
                        if (!pasted.length) return;
                        e.preventDefault();
                        addImageFiles(pasted);
                      }}
                      onKeyDown={(e) => {
                        const atEnd = (e.currentTarget.selectionStart ?? 0) >= input.length;
                        if (activeSuggestion && ghostSuffix) {
                          if (e.key === 'Tab' || (e.key === 'ArrowRight' && !e.shiftKey && atEnd)) {
                            e.preventDefault();
                            applySuggestion(activeSuggestion);
                            return;
                          }
                          if (e.key === 'Escape') {
                            e.preventDefault();
                            setSuggestDismissed(true);
                            return;
                          }
                        }
                        if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
                        e.preventDefault();
                        if (!isLoading && (input.trim() || images.length > 0)) handleSend();
                      }}
                    />
                  </div>
                </div>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  ref={fileInputRef}
                  onChange={handleImageChange}
                  multiple
                />
                <button
                  type="button"
                  className="btn btn-circle h-12 w-12 shrink-0 border-0 bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-lg hover:from-violet-700 hover:to-indigo-700 disabled:opacity-60"
                  onClick={() => handleSend()}
                  disabled={isLoading || (!input.trim() && images.length === 0)}
                  aria-label="Send"
                  title="Send"
                >
                  {isLoading ? (
                    <span className="loading loading-spinner loading-sm" />
                  ) : (
                    <PaperAirplaneIcon className="h-5 w-5" />
                  )}
                </button>
              </div>
            </div>
          </div>
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