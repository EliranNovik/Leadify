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

  const SuggestionCard = ({ suggestion }: { suggestion: Suggestion }) => (
    <div className="card bg-white hover:bg-gray-50 transition-colors border border-gray-200">
      <div className="card-body p-4">
        <div className="flex items-start gap-3">
          {getTypeIcon(suggestion.type)}
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <span className="badge badge-sm bg-gray-100 text-gray-800 font-semibold border-none">
                {suggestion.type.charAt(0).toUpperCase() + suggestion.type.slice(1)}
              </span>
              {suggestion.dueDate && (
                <span className="text-sm text-gray-600">
                  Due: {suggestion.dueDate}
                </span>
              )}
            </div>
            <p className="mt-2 text-sm text-gray-900 font-semibold">{suggestion.message}</p>
            {suggestion.context && (
              <p className="mt-1 text-sm text-gray-700">
                {suggestion.context}
              </p>
            )}
            <button className="btn btn-primary btn-sm mt-3 gap-2">
              {suggestion.action}
              <ArrowRightIcon className="w-4 h-4" />
            </button>
          </div>
        </div>
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
    <div ref={containerRef}>
      <div className="bg-white rounded-xl shadow-lg p-4 w-full mb-6 border border-gray-200">
        <div className="flex items-center justify-between pb-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <SparklesIcon className="w-6 h-6 text-teal-500" />
            <h2 className="text-xl font-semibold text-gray-900">AI Assistant Suggestions</h2>
          </div>
          <button 
            className="btn btn-outline btn-sm text-gray-800 border-gray-300 bg-white hover:bg-gray-100"
            onClick={() => setIsModalOpen(true)}
          >
            View All
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          {mockSuggestions.slice(0, 2).map((suggestion) => (
            <SuggestionCard key={suggestion.id} suggestion={suggestion} />
          ))}
        </div>
      </div>

      {/* Modal for View All */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white/10 backdrop-blur-lg rounded-xl shadow-xl w-full max-w-4xl max-h-[80vh] overflow-hidden border border-white/20">
            <div className="p-4 border-b border-white/20 flex items-center justify-between">
              <h3 className="text-xl font-semibold flex items-center gap-2 text-white">
                <SparklesIcon className="w-6 h-6 text-white/90" />
                All AI Suggestions
              </h3>
              <button 
                className="btn btn-ghost btn-sm btn-circle text-white hover:bg-white/10"
                onClick={() => setIsModalOpen(false)}
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 border-b border-white/20">
              <div className="flex gap-4 flex-wrap">
                <div className="flex-1 min-w-[200px]">
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Search suggestions..."
                      className="input input-bordered w-full pl-10 bg-white/10 text-white border-white/30 placeholder-white/60"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                    />
                    <MagnifyingGlassIcon className="w-5 h-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-white/70" />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <FunnelIcon className="w-5 h-5 text-white/70" />
                  <select
                    className="select select-bordered bg-white/10 text-white border-white/30"
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

            <div className="p-4 overflow-y-auto max-h-[calc(80vh-200px)]">
              <div className="grid grid-cols-1 gap-4">
                {filteredSuggestions.map((suggestion) => (
                  <SuggestionCard key={suggestion.id} suggestion={suggestion} />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

export default AISuggestions; 