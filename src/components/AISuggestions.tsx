import React, { useState, forwardRef, useImperativeHandle, useEffect } from 'react';
import { SparklesIcon, ArrowRightIcon, CheckCircleIcon, ExclamationCircleIcon, ClockIcon, ArrowPathIcon, MegaphoneIcon } from '@heroicons/react/24/outline';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

interface Suggestion {
  id: string;
  type: 'urgent' | 'important' | 'reminder';
  message: string;
  action: string;
  dueDate?: string;
  context?: string;
  leadId?: string;
  leadNumber?: string;
  clientName?: string;
}

interface PublicMessage {
  id: string;
  title?: string;
  content: string;
  start_date: string;
  end_date: string;
  created_at: string;
  updated_at: string;
  is_active: boolean;
}

// Initial suggestions shown on dashboard
const mockSuggestions: Suggestion[] = [
  {
    id: '1',
    type: 'urgent',
    message: 'Contract for David Lee (L122324) needs immediate review',
    action: 'Review Contract',
    dueDate: 'Today',
    context: 'Client meeting scheduled for tomorrow'
  },
  {
    id: '2',
    type: 'important',
    message: 'Follow up with Emma Wilson about the Service Agreement proposal',
    action: 'Send Follow-up',
    dueDate: 'Within 24 hours',
    context: 'Last contact was 5 days ago'
  },
  {
    id: '3',
    type: 'reminder',
    message: "Prepare documentation for John Smith's software implementation meeting",
    action: 'Prepare Docs',
    dueDate: 'Before 10:00 AM',
    context: 'Meeting scheduled for today'
  },
  {
    id: '4',
    type: 'important',
    message: 'Update client profile with new information from recent meeting',
    action: 'Update Profile',
    dueDate: 'Today',
    context: 'Meeting notes available'
  },
  {
    id: '11',
    type: 'reminder',
    message: 'Do an archival research for client David Lee (L122325) as the meeting is tomorrow',
    action: 'Start Research',
    dueDate: 'Today',
    context: 'Meeting scheduled for tomorrow'
  },
  {
    id: '12',
    type: 'urgent',
    message: 'Archival research done for client Emma Wilson (L122326). Contact client today',
    action: 'Contact Client',
    dueDate: 'Today',
    context: 'Update client with research results'
  },
  {
    id: '13',
    type: 'important',
    message: 'Send onboarding documents to new client Michael Green (L122329)',
    action: 'Send Documents',
    dueDate: 'Tomorrow',
    context: 'Client signed agreement today'
  },
  {
    id: '14',
    type: 'reminder',
    message: 'Schedule follow-up call with Sarah Cohen (L122330)',
    action: 'Schedule Call',
    dueDate: 'This week',
    context: 'Initial consultation completed'
  },
  {
    id: '15',
    type: 'urgent',
    message: 'Review payment status for Tom Anderson (L122331)',
    action: 'Check Payment',
    dueDate: 'Today',
    context: 'Payment overdue by 2 days'
  }
];

// Extended list for the modal view
const allSuggestions: Suggestion[] = [
  ...mockSuggestions,
  {
    id: '5',
    type: 'urgent',
    message: 'Critical deadline approaching for Sarah Parker case review',
    action: 'Review Case',
    dueDate: 'Tomorrow',
    context: 'Documents submitted last week pending review'
  },
  {
    id: '6',
    type: 'important',
    message: 'Schedule quarterly review meeting with Tom Anderson',
    action: 'Schedule Meeting',
    dueDate: 'This week',
    context: 'Last review was 3 months ago'
  },
  {
    id: '7',
    type: 'reminder',
    message: 'Update team availability calendar for next month',
    action: 'Update Calendar',
    dueDate: 'By Friday',
    context: 'Required for resource planning'
  },
  {
    id: '8',
    type: 'urgent',
    message: 'Respond to urgent inquiry from Rachel Green regarding contract terms',
    action: 'Respond',
    dueDate: 'Today',
    context: 'Client awaiting response for 24 hours'
  },
  {
    id: '9',
    type: 'important',
    message: 'Review and approve new marketing materials for upcoming campaign',
    action: 'Review Materials',
    dueDate: 'Next 48 hours',
    context: 'Campaign launch scheduled next week'
  },
  {
    id: '10',
    type: 'reminder',
    message: 'Complete monthly performance reports for team members',
    action: 'Complete Reports',
    dueDate: 'End of month',
    context: 'Required for performance reviews'
  }
];

const AISuggestions = forwardRef((props, ref) => {
  const navigate = useNavigate();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [aiMessage, setAiMessage] = useState('');
  const [isSummaryOpen, setIsSummaryOpen] = useState(false);
  const [publicMessages, setPublicMessages] = useState<PublicMessage[]>([]);
  const [isLoadingPublicMessages, setIsLoadingPublicMessages] = useState(true);

  const getTypeIcon = (type: Suggestion['type']) => {
    switch (type) {
      case 'urgent':
        return <ExclamationCircleIcon className="w-5 h-5 text-error" />;
      case 'important':
        return <CheckCircleIcon className="w-5 h-5 text-warning" />;
      case 'reminder':
        return <ClockIcon className="w-5 h-5 text-info" />;
      default:
        return null;
    }
  };

  

  const getTypeColor = (type: Suggestion['type']) => {
    switch (type) {
      case 'urgent': return 'border-red-500';
      case 'important': return 'border-yellow-500';
      case 'reminder': return 'border-green-500';
      default: return 'border-gray-300';
    }
  };

  // Fetch public messages from the database
  const fetchPublicMessages = async () => {
    setIsLoadingPublicMessages(true);
    try {
      const today = new Date().toISOString().split('T')[0]; // Get current date in YYYY-MM-DD format
      
      const { data, error } = await supabase
        .from('public_messages')
        .select('id, title, content, start_date, end_date, created_at, updated_at, is_active')
        .eq('is_active', true)
        .lte('start_date', today) // start_date <= today
        .gte('end_date', today)   // end_date >= today
        .order('created_at', { ascending: false }); // Order by created_at (newest first)

      if (error) {
        console.error('Error fetching public messages:', error);
        setPublicMessages([]);
      } else {
        setPublicMessages(data || []);
      }
    } catch (error) {
      console.error('Error fetching public messages:', error);
      setPublicMessages([]);
    } finally {
      setIsLoadingPublicMessages(false);
    }
  };

  // Fetch notifications from the edge function
  const fetchNotifications = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-notifications`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify({ action: 'get_notifications' })
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch notifications: ${response.status}`);
      }

      const data = await response.json();
      
      // Convert notifications to suggestions format
      const newSuggestions: Suggestion[] = data.notifications.map((notification: any) => ({
        id: notification.id,
        type: notification.type,
        message: notification.message,
        action: notification.action,
        dueDate: notification.dueDate,
        context: notification.context,
        leadId: notification.leadId,
        leadNumber: notification.leadNumber,
        clientName: notification.clientName
      }));

      setSuggestions(newSuggestions);
      setAiMessage(data.aiMessage);
    } catch (error) {
      console.error('Error fetching notifications:', error);
      // Fallback to mock data if API fails
      setSuggestions(mockSuggestions);
      setAiMessage('Using fallback data due to connection issues.');
    } finally {
      setIsLoading(false);
    }
  };

  // Helper function to remove seconds from time strings (HH:MM:SS -> HH:MM)
  const formatTimeWithoutSeconds = (text: string): string => {
    // Match time patterns like "16:30:00", "09:15:30", etc.
    return text.replace(/(\d{1,2}:\d{2}):\d{2}/g, '$1');
  };

  // Auto-refresh notifications every 5 minutes
  useEffect(() => {
    fetchNotifications();
    fetchPublicMessages();
    
    const interval = setInterval(fetchNotifications, 5 * 60 * 1000); // 5 minutes
    const publicMessagesInterval = setInterval(fetchPublicMessages, 10 * 60 * 1000); // 10 minutes
    
    return () => {
      clearInterval(interval);
      clearInterval(publicMessagesInterval);
    };
  }, []);
  const getDueColor = (type: Suggestion['type']) => {
    switch (type) {
      case 'urgent': return 'bg-red-100 text-red-700';
      case 'important': return 'bg-yellow-100 text-yellow-800';
      case 'reminder': return 'bg-green-100 text-green-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  // Navigation function to handle button clicks
  const handleActionClick = (suggestion: Suggestion) => {
    if (suggestion.leadNumber) {
      // Navigate to the specific client page
      navigate(`/clients/${suggestion.leadNumber}`);
    } else {
      // For actions without specific lead, navigate to appropriate page based on action
      switch (suggestion.action.toLowerCase()) {
        case 'review contract':
        case 'check payment':
        case 'contact client':
        case 'send follow-up':
        case 'update profile':
        case 'send documents':
        case 'schedule call':
        case 'start research':
          // Navigate to clients page
          navigate('/clients');
          break;
        case 'prepare docs':
          // Navigate to expert page
          navigate('/expert');
          break;
        case 'review case':
          // Navigate to pipeline
          navigate('/pipeline');
          break;
        default:
          // Default to clients page
          navigate('/clients');
          break;
      }
    }
  };

  const SuggestionCard = ({ suggestion }: { suggestion: Suggestion }) => (
    <div 
      className="relative flex flex-col bg-white rounded-2xl shadow-md transition-transform duration-200 md:hover:shadow-xl md:hover:scale-[1.025] p-5 h-[280px] w-full suggestion-card cursor-pointer"
      draggable={false}
      onDragStart={(e) => e.preventDefault()}
      onTouchStart={(e) => {
        // Disable any transform on touch
        e.currentTarget.style.transform = 'none';
      }}
      onTouchMove={(e) => {
        // Keep transform disabled during touch
        e.currentTarget.style.transform = 'none';
      }}
      onTouchEnd={(e) => {
        // Reset transform
        e.currentTarget.style.transform = 'none';
      }}
      onContextMenu={(e) => e.preventDefault()}
      style={{ touchAction: 'auto' }}
      onClick={() => handleActionClick(suggestion)}
    >
        <div className="flex items-start justify-between mb-2 flex-shrink-0">
          <div className="flex items-center gap-2">
            {getTypeIcon(suggestion.type)}
            <span className="font-semibold text-sm capitalize text-gray-700">{suggestion.type}</span>
          </div>
        </div>
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="font-bold text-lg text-gray-900 mb-1 leading-snug line-clamp-3">
            {formatTimeWithoutSeconds(suggestion.message)}
          </div>
          {suggestion.context && (
            <div className="text-sm text-gray-500 mb-2 line-clamp-3 flex-1">
              {formatTimeWithoutSeconds(suggestion.context)}
            </div>
          )}
        </div>
        <div className="flex justify-start mt-auto flex-shrink-0">
          <button 
            className="btn btn-sm px-4 bg-gradient-to-r from-[#3b28c7] to-[#6a5cff] text-white font-semibold shadow-none border-none hover:from-[#2a1e8a] hover:to-[#3b28c7] transition-all cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              handleActionClick(suggestion);
            }}
          >
            {suggestion.action}
            <ArrowRightIcon className="w-4 h-4 ml-1" />
          </button>
        </div>
      </div>
  );

  useImperativeHandle(ref, () => ({
    scrollIntoView: (options?: ScrollIntoViewOptions) => {
      containerRef.current?.scrollIntoView(options);
    }
  }));

  const containerRef = React.useRef<HTMLDivElement>(null);

  return (
    <>
      <style>{`
        .line-clamp-2 {
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .line-clamp-3 {
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        /* Disable hover effects on mobile */
        @media (max-width: 768px) {
          .suggestion-card {
            transform: none !important;
            transition: none !important;
          }
          .suggestion-card:hover {
            transform: none !important;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06) !important;
          }
          .suggestion-card:active {
            transform: none !important;
          }
        }
      `}</style>
      <div ref={containerRef}>
        <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <SparklesIcon className="w-6 h-6" style={{ color: '#3b28c7' }} />
          <div className="text-2xl font-bold">RMQ AI</div>
        </div>
        <div className="flex items-center gap-2">
          <button 
            className="btn btn-sm btn-ghost" 
            onClick={() => {
              fetchNotifications();
              fetchPublicMessages();
            }}
            disabled={isLoading || isLoadingPublicMessages}
            title="Refresh notifications and announcements"
          >
            <ArrowPathIcon className={`w-4 h-4 ${(isLoading || isLoadingPublicMessages) ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>
      
      {/* Public Messages Section */}
      {publicMessages.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-3">
            <MegaphoneIcon className="w-5 h-5 text-gray-700" />
            <span className="text-sm font-semibold text-gray-800">Public Announcements</span>
          </div>
          <div className="space-y-3">
            {publicMessages.map((message) => {
              // Detect Hebrew text for RTL support
              const hasHebrew = /[\u0590-\u05FF]/.test(
                (message.title || '') + (message.content || '')
              );
              const isRTL = hasHebrew ? 'rtl' : 'ltr';
              const textAlign = hasHebrew ? 'right' : 'left';
              
              return (
                <div 
                  key={message.id} 
                  className="bg-white rounded-xl p-4 text-sm text-gray-900 shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1"
                  style={{
                    boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04), 0 0 0 1px rgba(0, 0, 0, 0.05)'
                  }}
                >
                  {message.title && (
                    <div className="font-semibold text-base mb-2 text-gray-900" dir={isRTL} style={{ textAlign }}>
                      {message.title}
                    </div>
                  )}
                  <div 
                    className="whitespace-pre-wrap leading-relaxed"
                    dir={isRTL}
                    style={{ textAlign }}
                  >
                    {message.content}
                  </div>
                  <div className="text-xs text-gray-500 mt-2 pt-2 border-t border-gray-100">
                    {new Date(message.start_date).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric'
                    })} - {new Date(message.end_date).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric'
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      
      <div 
        className="overflow-x-auto md:overflow-y-auto md:overflow-x-visible md:max-h-[1200px] bg-white"
        style={{ 
          scrollbarWidth: 'none', 
          msOverflowStyle: 'none',
          WebkitOverflowScrolling: 'touch'
        }}
      >
        <style>{`
          .scrollbar-none::-webkit-scrollbar { display: none; }
        `}</style>
        <div className="flex md:grid flex-row md:grid-cols-1 gap-4">
          {isLoading ? (
            <div className="w-full flex items-center justify-center py-8">
              <div className="loading loading-spinner loading-lg text-primary"></div>
            </div>
          ) : suggestions.length > 0 ? (
            suggestions.map((suggestion) => (
              <div key={suggestion.id} className="w-[calc(50%-0.5rem)] md:w-full flex-shrink-0">
                <SuggestionCard suggestion={suggestion} />
              </div>
            ))
          ) : (
            <div className="w-full text-center py-8 text-gray-500">
              <SparklesIcon className="w-12 h-12 mx-auto mb-4 text-gray-300" />
              <p className="text-lg font-medium">No notifications at this time</p>
              <p className="text-sm">All systems are running smoothly!</p>
            </div>
          )}
        </div>
      </div>

      {/* AI Message - Commented out temporarily */}
      {/* {aiMessage && (
        <div className="mt-4 relative flex flex-col bg-white rounded-2xl shadow-md p-5 w-full">
          <div className="flex items-start justify-between mb-2 flex-shrink-0">
            <div className="flex items-center gap-2">
              <SparklesIcon className="w-5 h-5" style={{ color: '#3b28c7' }} />
              <span className="font-semibold text-sm capitalize text-gray-700">Summary</span>
            </div>
            <button 
              className="btn btn-sm btn-ghost text-gray-600 hover:text-gray-800"
              onClick={() => setIsSummaryOpen(!isSummaryOpen)}
            >
              {isSummaryOpen ? 'Hide' : 'Show'}
            </button>
          </div>
          {isSummaryOpen && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">{aiMessage}</div>
            </div>
          )}
        </div>
      )} */}


    </div>
    </>
  );
});

export default AISuggestions;