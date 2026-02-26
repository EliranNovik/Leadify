import React, { useState, useEffect } from 'react';
import { SparklesIcon, ArrowRightIcon, CheckCircleIcon, ExclamationCircleIcon, ClockIcon, XMarkIcon, FunnelIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useTheme } from '../hooks/useTheme';

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

interface AISuggestionsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const AISuggestionsModal: React.FC<AISuggestionsModalProps> = ({ isOpen, onClose }) => {
  const navigate = useNavigate();
  const { isAltTheme } = useTheme();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [aiMessage, setAiMessage] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'urgent' | 'important' | 'reminder'>('all');
  const [searchTerm, setSearchTerm] = useState('');

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
      setSuggestions([]);
      setAiMessage('Error loading notifications');
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch notifications when modal opens
  useEffect(() => {
    if (isOpen) {
      fetchNotifications();
    }
  }, [isOpen]);

  const getTypeIcon = (type: Suggestion['type']) => {
    switch (type) {
      case 'urgent':
        return <ExclamationCircleIcon className="w-5 h-5 text-red-500" />;
      case 'important':
        return <ClockIcon className="w-5 h-5 text-yellow-500" />;
      case 'reminder':
        return <CheckCircleIcon className="w-5 h-5 text-green-500" />;
      default:
        return <SparklesIcon className="w-5 h-5 text-gray-500" />;
    }
  };

  const getTypeColor = (type: Suggestion['type']) => {
    switch (type) {
      case 'urgent': return 'border-red-300 bg-red-50';
      case 'important': return 'border-yellow-300 bg-yellow-50';
      case 'reminder': return 'border-green-300 bg-green-50';
      default: return 'border-gray-300';
    }
  };

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
    onClose(); // Close modal when navigating
    
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
      className="relative flex flex-col bg-white rounded-2xl shadow-md transition-transform duration-200 md:hover:shadow-xl md:hover:scale-[1.025] p-5 h-[280px] w-full cursor-pointer"
      onClick={() => handleActionClick(suggestion)}
    >
      <div className="flex items-start justify-between mb-2 flex-shrink-0">
        <div className="flex items-center gap-2">
          {getTypeIcon(suggestion.type)}
          <span className="font-semibold text-sm capitalize text-gray-700">{suggestion.type}</span>
        </div>
      </div>
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="font-bold text-lg text-gray-900 mb-1 leading-snug line-clamp-3">{suggestion.message}</div>
        {suggestion.context && (
          <div className="text-sm text-gray-500 mb-2 line-clamp-3 flex-1">{suggestion.context}</div>
        )}
      </div>
      <div className="flex justify-start mt-auto flex-shrink-0">
        <button 
          className={`btn btn-sm px-4 bg-gradient-to-r ${isAltTheme ? 'from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700' : 'from-[#3b28c7] to-[#6a5cff] hover:from-[#2a1e8a] hover:to-[#3b28c7]'} text-white font-semibold shadow-none border-none transition-all cursor-pointer`}
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

  const filteredSuggestions = suggestions.filter(suggestion => {
    const matchesType = filterType === 'all' || suggestion.type === filterType;
    const matchesSearch = suggestion.message.toLowerCase().includes(searchTerm.toLowerCase()) ||
      suggestion.context?.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesType && matchesSearch;
  });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[80vh] overflow-hidden border border-gray-200">
        <div className="p-4 border-b border-gray-200 flex items-center justify-between bg-white">
          <h3 className="text-xl font-semibold flex items-center gap-2 text-gray-900">
            <SparklesIcon className="w-6 h-6" style={{ color: '#3b28c7' }} />
            AI Suggestions ({suggestions.length})
          </h3>
          <button 
            className="btn btn-ghost btn-sm btn-circle text-gray-700 hover:bg-gray-100"
            onClick={onClose}
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 border-b border-gray-200 bg-white">
          <div className="flex gap-4 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search suggestions..."
                  className="input input-bordered w-full pl-10 bg-white text-gray-900 border-gray-300 placeholder-gray-400"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
                <MagnifyingGlassIcon className="w-5 h-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <FunnelIcon className="w-5 h-5 text-gray-700" />
              <select
                className="select select-bordered bg-white text-gray-900 border-gray-300"
                value={filterType}
                onChange={(e) => setFilterType(e.target.value as any)}
              >
                <option value="all">All Types</option>
                <option value="urgent">Urgent</option>
                <option value="important">Important</option>
                <option value="reminder">Reminder</option>
              </select>
            </div>
          </div>
        </div>

        <div className="p-4 overflow-x-auto md:overflow-y-auto md:overflow-x-visible max-h-[calc(80vh-200px)] bg-white">
          {isLoading ? (
            <div className="w-full flex items-center justify-center py-8">
              <div className="loading loading-spinner loading-lg text-primary"></div>
            </div>
          ) : filteredSuggestions.length > 0 ? (
            <div className="flex md:grid flex-row md:grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredSuggestions.map((suggestion) => (
                <div key={suggestion.id} className="w-[calc(50%-0.5rem)] md:w-full flex-shrink-0">
                  <SuggestionCard suggestion={suggestion} />
                </div>
              ))}
            </div>
          ) : (
            <div className="w-full text-center py-8 text-gray-500">
              <SparklesIcon className="w-12 h-12 mx-auto mb-4 text-gray-300" />
              <p className="text-lg font-medium">No notifications found</p>
              <p className="text-sm">Try adjusting your search or filter criteria</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AISuggestionsModal;
