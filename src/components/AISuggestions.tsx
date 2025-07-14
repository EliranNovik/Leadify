import React, { useState, forwardRef, useImperativeHandle } from 'react';
import { SparklesIcon, ArrowRightIcon, CheckCircleIcon, ExclamationCircleIcon, ClockIcon, XMarkIcon, FunnelIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';

interface Suggestion {
  id: string;
  type: 'urgent' | 'important' | 'reminder';
  message: string;
  action: string;
  dueDate?: string;
  context?: string;
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
  // New reminder card
  {
    id: '11',
    type: 'reminder',
    message: 'Do an archival research for client David Lee (L122325) as the meeting is tomorrow',
    action: 'Start Research',
    dueDate: 'Today',
    context: 'Meeting scheduled for tomorrow'
  },
  // New urgent card
  {
    id: '12',
    type: 'urgent',
    message: 'Archival research done for client Emma Wilson (L122326). Contact client today',
    action: 'Contact Client',
    dueDate: 'Today',
    context: 'Update client with research results'
  },
  // Extra card 1
  {
    id: '13',
    type: 'important',
    message: 'Send onboarding documents to new client Michael Green (L122329)',
    action: 'Send Documents',
    dueDate: 'Tomorrow',
    context: 'Client signed agreement today'
  },
  // Extra card 2
  {
    id: '14',
    type: 'reminder',
    message: 'Schedule follow-up call with Sarah Cohen (L122330)',
    action: 'Schedule Call',
    dueDate: 'This week',
    context: 'Initial consultation completed'
  },
  // Extra card 3
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
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [filterType, setFilterType] = useState<'all' | 'urgent' | 'important' | 'reminder'>('all');
  const [searchTerm, setSearchTerm] = useState('');

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

  const filteredSuggestions = allSuggestions.filter(suggestion => {
    const matchesType = filterType === 'all' || suggestion.type === filterType;
    const matchesSearch = suggestion.message.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         suggestion.context?.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesType && matchesSearch;
  });

  const getTypeColor = (type: Suggestion['type']) => {
    switch (type) {
      case 'urgent': return 'border-red-500';
      case 'important': return 'border-yellow-500';
      case 'reminder': return 'border-green-500';
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


  const SuggestionCard = ({ suggestion }: { suggestion: Suggestion }) => (
    <div className="relative flex flex-col bg-white rounded-2xl shadow-md transition-transform duration-200 hover:shadow-xl hover:scale-[1.025] p-5 h-[280px] w-full">
        <div className="flex items-start justify-between mb-2 flex-shrink-0">
          <div className="flex items-center gap-2">
            {getTypeIcon(suggestion.type)}
            <span className="font-semibold text-sm capitalize text-gray-700">{suggestion.type}</span>
          </div>
          {/* Due date removed from small version */}
        </div>
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="font-bold text-lg text-gray-900 mb-1 leading-snug line-clamp-3">{suggestion.message}</div>
          {suggestion.context && (
            <div className="text-sm text-gray-500 mb-2 line-clamp-3 flex-1">{suggestion.context}</div>
          )}
        </div>
        <div className="flex justify-start mt-auto flex-shrink-0">
          <button className="btn btn-sm px-4 bg-gradient-to-r from-[#3b28c7] to-[#6a5cff] text-white font-semibold shadow-none border-none hover:from-[#2a1e8a] hover:to-[#3b28c7] transition-all">
            {suggestion.action}
            <ArrowRightIcon className="w-4 h-4 ml-1" />
          </button>
        </div>
      </div>
  );

  useImperativeHandle(ref, () => ({
    openModal: () => setIsModalOpen(true),
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
        /* Mobile: Allow normal scrolling while maintaining horizontal card scrolling */
        @media (max-width: 768px) {
          .ai-suggestions-container {
            touch-action: pan-x !important;
            overflow-x: auto !important;
            overflow-y: visible !important;
          }
          .ai-suggestions-container > div {
            touch-action: manipulation !important;
            pointer-events: auto !important;
          }
        }
        /* Desktop: allow normal interactions */
        @media (min-width: 769px) {
          .ai-suggestions-container > div {
            pointer-events: auto !important;
          }
        }
      `}</style>
      <div ref={containerRef}>
        <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <SparklesIcon className="w-6 h-6" style={{ color: '#3b28c7' }} />
          <div className="text-2xl font-bold">RMQ AI</div>
        </div>
        <button className="btn btn-sm btn-outline" style={{ borderColor: '#3b28c7', color: '#3b28c7' }} onClick={() => setIsModalOpen(true)}>View All</button>
      </div>
      <div
        className="overflow-x-auto md:overflow-y-auto md:overflow-x-visible grid grid-flow-col auto-cols-[calc(50%-0.5rem)] md:grid-flow-row md:grid-cols-1 gap-4 mt-0 scrollbar-none ai-suggestions-container"
        draggable="false"
        style={{ 
          maxHeight: '1200px', 
          scrollbarWidth: 'none', 
          msOverflowStyle: 'none',
          touchAction: 'pan-x', // Only allow horizontal panning on mobile
          WebkitOverflowScrolling: 'touch' // Smooth scrolling on iOS
        }}
      >
        {/* Hide scrollbar for Webkit browsers */}
        <style>{`
          .scrollbar-none::-webkit-scrollbar { display: none; }
        `}</style>
        {mockSuggestions.map((suggestion) => (
          <SuggestionCard key={suggestion.id} suggestion={suggestion} />
        ))}
      </div>

      {/* Modal for View All */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[80vh] overflow-hidden border border-gray-200">
            <div className="p-4 border-b border-gray-200 flex items-center justify-between bg-white">
              <h3 className="text-xl font-semibold flex items-center gap-2 text-gray-900">
                <SparklesIcon className="w-6 h-6" style={{ color: '#3b28c7' }} />
                All AI Suggestions
              </h3>
              <button 
                className="btn btn-ghost btn-sm btn-circle text-gray-700 hover:bg-gray-100"
                onClick={() => setIsModalOpen(false)}
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
              <div className="flex md:grid flex-row md:grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                {filteredSuggestions.map((suggestion) => (
                  <div key={suggestion.id} className="w-[calc(50%-0.5rem)] md:w-full flex-shrink-0">
                    <div className="relative flex flex-col bg-white rounded-2xl shadow-md transition-transform duration-200 hover:shadow-xl hover:scale-[1.025] p-5 h-[280px] w-full">
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
                        <button className="btn btn-sm px-4 bg-gradient-to-r from-[#3b28c7] to-[#6a5cff] text-white font-semibold shadow-none border-none hover:from-[#2a1e8a] hover:to-[#3b28c7] transition-all">
                          {suggestion.action}
                          <ArrowRightIcon className="w-4 h-4 ml-1" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
    </>
  );
});

export default AISuggestions; 