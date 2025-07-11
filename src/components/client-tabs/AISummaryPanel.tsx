import React, { useEffect, useState } from 'react';
import { 
  SparklesIcon, 
  ArrowPathIcon, 
  ChevronDownIcon, 
  ChevronUpIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  ClockIcon,
  StarIcon,
  BoltIcon,
  ChatBubbleLeftRightIcon,
  DocumentTextIcon,
  PlusIcon
} from '@heroicons/react/24/outline';

interface AISummaryMessage {
  type: string;
  direction: string;
  from: string;
  to: string;
  date: string;
  content: string;
  subject?: string;
}

interface AISummaryPanelProps {
  messages: AISummaryMessage[];
}

// TODO: Replace with your actual Supabase project ref
const SUPABASE_FUNCTION_URL = 'https://mtccyevuosqfrcaoztzt.functions.supabase.co/ai-timeline-summary';

function stripMarkdown(text: string): string {
  // Remove *, **, and markdown headers, but keep line breaks and bullets
  return text
    .replace(/\*\*/g, '') // Remove bold
    .replace(/\*/g, '') // Remove single asterisks
    .replace(/^#+\s?/gm, '') // Remove markdown headers
    .replace(/^- /gm, '• ') // Replace dash bullets with dot
    .replace(/\n{2,}/g, '\n') // Remove extra newlines
    .trim();
}

function renderSummaryText(text: string) {
  // Split into lines, treat lines starting with '•' as bullets, others as paragraphs
  const lines = stripMarkdown(text).split(/\n+/).filter(Boolean);
  const items = [];
  let bullets: string[] = [];
  lines.forEach((line, idx) => {
    if (line.trim().startsWith('•')) {
      bullets.push(line.replace(/^•\s*/, ''));
    } else {
      if (bullets.length) {
        items.push(<ul className="list-disc ml-6 mb-2" key={`ul-${idx}`}>{bullets.map((b, i) => <li className="mb-1" key={i}>{b}</li>)}</ul>);
        bullets = [];
      }
      // Bold section titles (lines ending with ':' or starting with 'Summary')
      if (/(:\s*$|^Summary\b)/i.test(line.trim())) {
        items.push(<p className="mb-3 font-bold" key={`p-bold-${idx}`}>{line}</p>);
      } else {
        items.push(<p className="mb-3" key={`p-${idx}`}>{line}</p>);
      }
    }
  });
  if (bullets.length) {
    items.push(<ul className="list-disc ml-6 mb-2" key={`ul-last`}>{bullets.map((b, i) => <li className="mb-1" key={i}>{b}</li>)}</ul>);
  }
  return items;
}

const AISummaryPanel: React.FC<AISummaryPanelProps> = ({ messages }) => {
  const [summary, setSummary] = useState('');
  const [actionItems, setActionItems] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summaryExpanded, setSummaryExpanded] = useState(true);
  const [actionItemsExpanded, setActionItemsExpanded] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchSummary = async () => {
    setLoading(true);
    setError(null);
    setSummary('');
    setActionItems('');
    try {
      const res = await fetch(SUPABASE_FUNCTION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'omit',
        body: JSON.stringify({ messages }),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(err);
      }
      const data = await res.json();
      setSummary(data.summary || 'No summary available.');
      setActionItems(data.actionItems || 'No action items found.');
      setLastUpdated(new Date());
    } catch (err: any) {
      setError(err.message || 'Failed to fetch summary.');
    }
    setLoading(false);
  };

  useEffect(() => {
    if (messages && messages.length > 0) {
      fetchSummary();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(messages)]);

  return (
    <aside className="sticky top-24 w-full max-w-sm">
      {/* Main AI Panel with Gradient Border */}
      <div className="rounded-3xl p-0.5 bg-gradient-to-br from-purple-500 via-blue-500 to-cyan-400 shadow-2xl">
        <div className="bg-white rounded-3xl h-full overflow-hidden">
          {/* Header Section */}
          <div className="bg-gradient-to-r from-purple-600 via-blue-600 to-cyan-500 p-6 text-white relative overflow-hidden">
            <div className="absolute inset-0 bg-white/10 backdrop-blur-sm"></div>
            <div className="relative z-10">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-white/20 backdrop-blur-sm">
                    <SparklesIcon className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold tracking-tight">AI Smart Recap</h2>
                    <p className="text-white/80 text-sm">Intelligent insights & recommendations</p>
                  </div>
                </div>
                <button
                  className="btn btn-sm bg-white/20 border-white/30 text-white hover:bg-white/30 hover:border-white/40 backdrop-blur-sm transition-all duration-200"
                  onClick={fetchSummary}
                  disabled={loading}
                  title="Regenerate summary"
                >
                  {loading ? (
                    <span className="loading loading-spinner loading-sm text-white" />
                  ) : (
                    <>
                      <ArrowPathIcon className="w-4 h-4" />
                      <span className="hidden sm:inline ml-1">Refresh</span>
                    </>
                  )}
                </button>
              </div>
              
              {/* Status Indicators */}
              <div className="flex items-center gap-4 text-sm">
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-green-300"></div>
                  <span className="text-white/90">{messages?.length || 0} interactions analyzed</span>
                </div>
                {lastUpdated && (
                  <div className="flex items-center gap-1">
                    <ClockIcon className="w-3 h-3 text-white/70" />
                    <span className="text-white/70">Updated {lastUpdated.toLocaleTimeString()}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Content Section */}
          <div className="p-6 space-y-6">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-12">
                <div className="relative">
                  <div className="w-16 h-16 rounded-full bg-gradient-to-r from-purple-400 to-blue-400 animate-pulse"></div>
                  <SparklesIcon className="w-8 h-8 text-white absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2" />
                </div>
                <span className="text-base-content/60 mt-4 font-medium">AI is analyzing conversations...</span>
                <span className="text-base-content/40 text-sm mt-1">This may take a few moments</span>
              </div>
            ) : error ? (
              <div className="bg-red-50 border border-red-200 rounded-2xl p-6">
                <div className="flex items-center gap-3 mb-2">
                  <ExclamationTriangleIcon className="w-6 h-6 text-red-500" />
                  <span className="font-semibold text-red-800">Analysis Failed</span>
                </div>
                <p className="text-red-600 text-sm leading-relaxed">{error}</p>
                <button 
                  className="btn btn-sm btn-outline border-red-300 text-red-600 hover:bg-red-50 mt-3"
                  onClick={fetchSummary}
                >
                  Try Again
                </button>
              </div>
            ) : (
              <>
                {/* Conversation Summary Section */}
                <div className="space-y-3">
                  <button
                    className="w-full flex items-center justify-between p-4 bg-gradient-to-r from-purple-50 to-blue-50 hover:from-purple-100 hover:to-blue-100 rounded-2xl transition-all duration-200 group"
                    onClick={() => setSummaryExpanded(!summaryExpanded)}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-r from-purple-500 to-blue-500 text-white">
                        <ChatBubbleLeftRightIcon className="w-5 h-5" />
                      </div>
                      <div className="text-left">
                        <h3 className="font-bold text-gray-800 text-lg">Conversation Summary</h3>
                        <p className="text-gray-600 text-sm">Key insights from interactions</p>
                      </div>
                    </div>
                    {summaryExpanded ? (
                      <ChevronUpIcon className="w-5 h-5 text-gray-500 group-hover:text-gray-700 transition-colors" />
                    ) : (
                      <ChevronDownIcon className="w-5 h-5 text-gray-500 group-hover:text-gray-700 transition-colors" />
                    )}
                  </button>
                  
                  {summaryExpanded && (
                    <div className="bg-gray-50 rounded-2xl p-5 border-l-4 border-purple-400 animate-fade-in">
                      <div className="text-gray-800 leading-relaxed space-y-2">
                        {renderSummaryText(summary)}
                      </div>
                    </div>
                  )}
                </div>

                {/* Action Items Section */}
                <div className="space-y-3">
                  <button
                    className="w-full flex items-center justify-between p-4 bg-gradient-to-r from-cyan-50 to-green-50 hover:from-cyan-100 hover:to-green-100 rounded-2xl transition-all duration-200 group"
                    onClick={() => setActionItemsExpanded(!actionItemsExpanded)}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-r from-cyan-500 to-green-500 text-white">
                        <BoltIcon className="w-5 h-5" />
                      </div>
                      <div className="text-left">
                        <h3 className="font-bold text-gray-800 text-lg">Action Items & Next Steps</h3>
                        <p className="text-gray-600 text-sm">AI recommendations & priorities</p>
                      </div>
                    </div>
                    {actionItemsExpanded ? (
                      <ChevronUpIcon className="w-5 h-5 text-gray-500 group-hover:text-gray-700 transition-colors" />
                    ) : (
                      <ChevronDownIcon className="w-5 h-5 text-gray-500 group-hover:text-gray-700 transition-colors" />
                    )}
                  </button>
                  
                  {actionItemsExpanded && (
                    <div className="bg-gray-50 rounded-2xl p-5 border-l-4 border-cyan-400 animate-fade-in">
                      <div className="text-gray-800 leading-relaxed space-y-2">
                        {renderSummaryText(actionItems)}
                      </div>
                      
                      {/* Quick Action Buttons */}
                      <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-gray-200">
                        <button className="btn btn-xs bg-green-100 border-green-200 text-green-700 hover:bg-green-200 hover:border-green-300">
                          <CheckCircleIcon className="w-3 h-3" />
                          Mark Complete
                        </button>
                        <button className="btn btn-xs bg-blue-100 border-blue-200 text-blue-700 hover:bg-blue-200 hover:border-blue-300">
                          <PlusIcon className="w-3 h-3" />
                          Add to Tasks
                        </button>
                        <button className="btn btn-xs bg-purple-100 border-purple-200 text-purple-700 hover:bg-purple-200 hover:border-purple-300">
                          <DocumentTextIcon className="w-3 h-3" />
                          Export
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* AI Confidence Indicator */}
                <div className="bg-gradient-to-r from-amber-50 to-orange-50 rounded-2xl p-4 border border-amber-200">
                  <div className="flex items-center gap-3">
                    <StarIcon className="w-5 h-5 text-amber-500" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-amber-800">AI Confidence Score</p>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="flex-1 bg-amber-200 rounded-full h-2">
                          <div className="bg-gradient-to-r from-amber-400 to-orange-400 h-2 rounded-full" style={{width: '85%'}}></div>
                        </div>
                        <span className="text-xs font-bold text-amber-700">85%</span>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
};

export default AISummaryPanel; 