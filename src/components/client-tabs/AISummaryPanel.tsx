import React, { useEffect, useState } from 'react';

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
    <aside className="sticky top-24 w-full max-w-sm bg-base-100 rounded-2xl shadow-xl border border-base-200 p-6 flex flex-col gap-6">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-2xl">🧠</span>
        <h2 className="text-xl font-bold tracking-tight">Smart Recap</h2>
        <button
          className="btn btn-xs btn-outline ml-auto"
          onClick={fetchSummary}
          disabled={loading}
          title="Regenerate summary"
        >
          {loading ? <span className="loading loading-spinner loading-xs" /> : 'Refresh'}
        </button>
      </div>
      {loading ? (
        <div className="flex flex-col items-center justify-center py-8">
          <span className="loading loading-spinner loading-lg mb-4" />
          <span className="text-base-content/60">Generating summary...</span>
        </div>
      ) : error ? (
        <div className="alert alert-error text-sm">
          <span>Error: {error}</span>
        </div>
      ) : (
        <>
          <div>
            <h3 className="font-semibold text-base-content/70 mb-2 uppercase tracking-wide text-xs flex items-center gap-1">Conversation Summary</h3>
            <div className="bg-base-200 rounded-lg p-4 text-base-content/90 text-sm leading-relaxed" style={{ minHeight: 60 }}>
              {renderSummaryText(summary)}
            </div>
          </div>
          <div className="my-4" />
          <div>
            <h3 className="font-semibold text-base-content/70 mb-2 uppercase tracking-wide text-xs flex items-center gap-1">Action Items & Suggestions</h3>
            <div className="bg-base-200 rounded-lg p-4 text-base-content/90 text-sm leading-relaxed" style={{ minHeight: 40 }}>
              {renderSummaryText(actionItems)}
            </div>
          </div>
        </>
      )}
    </aside>
  );
};

export default AISummaryPanel; 