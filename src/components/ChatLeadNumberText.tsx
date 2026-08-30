import React from 'react';
import { Link } from 'react-router-dom';
import { resolveLeadShareClientRoute } from '../lib/calendarClientRoute';

const LEAD_NUMBER_RE =
  /\[(?:#)?([LC]\d+(?:\/\d+)?)\](?:\([^)]*\))?|\[#([^\]]+)\]|\b([LC]\d+(?:\/\d+)?)|\b(\d{4,}\/\d+)|\b(\d{5,7})\b/g;

export function parseChatLeadNumber(value: string): string | null {
  const text = String(value || '').trim();
  if (!text) return null;
  const wrapped = text.match(/^\[(?:#)?([LC]\d+(?:\/\d+)?)\](?:\([^)]*\))?$/i);
  if (wrapped?.[1]) return wrapped[1];
  const plain = text.match(/^([LC]\d+(?:\/\d+)?)$/i) || text.match(/^(\d{4,}\/\d+)$/) || text.match(/^(\d{5,7})$/);
  return plain?.[1] || null;
}

function extractLeadNumber(match: RegExpExecArray): string {
  return String(match[1] || match[2] || match[3] || match[4] || match[5] || match[0])
    .replace(/^\[#?/, '')
    .replace(/\](?:\([^)]*\))?$/, '')
    .trim();
}

export function ChatLeadNumberText({ text, onOpen }: { text: string; onOpen?: () => void }) {
  if (!text) return null;

  const nodes: React.ReactNode[] = [];
  const re = new RegExp(LEAD_NUMBER_RE.source, 'g');
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const leadNumber = extractLeadNumber(match);
    const to = resolveLeadShareClientRoute({ leadNumber });
    nodes.push(
      <Link
        key={`lead-${key++}`}
        to={to}
        className="chat-lead-number-link font-semibold hover:opacity-80"
        style={{ color: '#3b28c7' }}
        onClick={(e) => {
          e.stopPropagation();
          onOpen?.();
        }}
        title={`Open client ${leadNumber}`}
      >
        {leadNumber}
      </Link>,
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.length > 0 ? <>{nodes}</> : <>{text}</>;
}
