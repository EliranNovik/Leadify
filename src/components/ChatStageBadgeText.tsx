import React from 'react';
import {
  areStagesEquivalent,
  fetchStageNames,
  getSoftStageBadgeStyle,
  getStageColour,
  getStageName,
  listLeadStages,
  normalizeStageName,
} from '../lib/stageUtils';
import { ChatEmployeeNameText, type ChatEmployeeHit } from './ChatEmployeeNameText';

export type ChatStageHit = {
  id: string;
  name: string;
  aliases: string[];
};

const KNOWN_STAGE_IDS = [
  '0', '10', '11', '15', '20', '21', '30', '35', '40', '50', '51', '55',
  '60', '70', '91', '100', '105', '110', '150', '200',
];

const GENERIC_UNQUOTED = new Set([
  'created',
  'success',
  'closed',
  'open',
  'new',
  'active',
  'contact',
  'lead',
  'signed',
  'finalized',
]);

const QUOTE_CHARS = `"“”'\u2018\u2019`;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function addAlias(hit: ChatStageHit, alias: string) {
  const trimmed = alias.trim();
  if (!trimmed) return;
  if (hit.aliases.some((existing) => existing.toLowerCase() === trimmed.toLowerCase())) return;
  hit.aliases.push(trimmed);
}

export function buildChatStageHits(): ChatStageHit[] {
  const byId = new Map<string, ChatStageHit>();

  const upsert = (id: string, name: string) => {
    const stageId = String(id || '').trim();
    const label = String(name || '').trim();
    if (!stageId || !label) return;
    const existing = byId.get(stageId);
    if (existing) {
      addAlias(existing, label);
      return;
    }
    byId.set(stageId, { id: stageId, name: label, aliases: [label] });
  };

  for (const row of listLeadStages()) {
    upsert(row.id, row.name);
  }
  for (const id of KNOWN_STAGE_IDS) {
    upsert(id, getStageName(id));
  }

  return [...byId.values()].sort((a, b) => {
    const longestA = Math.max(...a.aliases.map((alias) => alias.length));
    const longestB = Math.max(...b.aliases.map((alias) => alias.length));
    return longestB - longestA || a.name.localeCompare(b.name);
  });
}

export async function loadChatStageHits(): Promise<ChatStageHit[]> {
  await fetchStageNames();
  return buildChatStageHits();
}

function isDistinctiveStageName(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length < 6) return false;
  if (GENERIC_UNQUOTED.has(trimmed.toLowerCase())) return false;
  return trimmed.length >= 10 || /[\s+/()]/.test(trimmed);
}

function isJargonStageName(name: string): boolean {
  return /[+/()§]|mtng|precommunication|unactivat|spam\/irrelevant/i.test(name);
}

function isUnquotedStageContext(text: string, start: number, end: number): boolean {
  const before = text.slice(Math.max(0, start - 32), start);
  const after = text.slice(end, Math.min(text.length, end + 20));
  if (/\b(?:next|upcoming|following|previous|last|past|no|any|a|an|the)\s+$/i.test(before)) {
    return false;
  }
  if (/^\s+(?:for|on|at|with|to|by)\b/i.test(after)) {
    return false;
  }
  if (start === 0 && end >= text.trimEnd().length) return true;
  if (start === 0 && /^\s*[·•|]/.test(after)) return true;
  if (/[·•|]\s*$/.test(before) || /^\s*[·•|]/.test(after)) return true;
  if (/(?:^|\n)\s*(?:[-*•]|\d+[.)])\s*$/.test(before)) return true;
  if (/\bstage\s*:?\s*$/i.test(before)) return true;
  if (/\b(?:in|at|is|as|to)\s+$/i.test(before)) return true;
  return false;
}

function uniqueAliases(stages: ChatStageHit[], distinctiveOnly: boolean): string[] {
  const seen = new Set<string>();
  const aliases: string[] = [];
  for (const stage of stages) {
    for (const alias of stage.aliases) {
      if (distinctiveOnly && !isDistinctiveStageName(alias)) continue;
      const key = alias.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      aliases.push(alias);
    }
  }
  return aliases.sort((a, b) => b.length - a.length || a.localeCompare(b));
}

function resolveStage(
  stages: ChatStageHit[],
  raw: string,
): ChatStageHit | null {
  const value = String(raw || '').trim();
  if (!value) return null;
  const byId = stages.find((stage) => stage.id === value);
  if (byId) return byId;
  const lower = value.toLowerCase();
  const exact = stages.find((stage) =>
    stage.aliases.some((alias) => alias.toLowerCase() === lower) ||
    stage.name.toLowerCase() === lower,
  );
  if (exact) return exact;
  const normalized = normalizeStageName(value);
  if (normalized) {
    const byNormalized = stages.find((stage) =>
      normalizeStageName(stage.name) === normalized ||
      stage.aliases.some((alias) => normalizeStageName(alias) === normalized),
    );
    if (byNormalized) return byNormalized;
  }
  if (!isDistinctiveStageName(value)) return null;
  return stages.find((stage) =>
    areStagesEquivalent(stage.name, value) ||
    stage.aliases.some((alias) => areStagesEquivalent(alias, value)),
  ) || null;
}

function ChatStageBadge({ stage, dark = false }: { stage: ChatStageHit; dark?: boolean }) {
  const stageStr = stage.id;
  const stageName = getStageName(stageStr) || stage.name;
  const stageColour = getStageColour(stageStr);
  const softBadgeStyle = getSoftStageBadgeStyle(stageColour, stageStr, { dark });

  return (
    <span
      className="badge stage-badge mx-0.5 inline-block max-w-full shrink-0 rounded-full border-0 align-middle text-xs px-2.5 py-0.5 hover:opacity-90 transition-opacity duration-200"
      style={{
        backgroundColor: softBadgeStyle.backgroundColor,
        color: softBadgeStyle.color,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        verticalAlign: 'middle',
      }}
      title={stageName}
    >
      {stageName}
    </span>
  );
}

type TextHit = {
  start: number;
  end: number;
  stage: ChatStageHit;
};

function collectStageHits(text: string, stages: ChatStageHit[]): TextHit[] {
  if (!text || !stages.length) return [];

  const allAliases = uniqueAliases(stages, false);
  const distinctiveAliases = uniqueAliases(stages, true);
  if (!allAliases.length) return [];

  const aliasPattern = allAliases.map(escapeRegExp).join('|');
  const idPattern = [...new Set(stages.map((stage) => stage.id))]
    .sort((a, b) => b.length - a.length || a.localeCompare(b))
    .map(escapeRegExp)
    .join('|');
  const quotedValue = `(?:${aliasPattern}|${idPattern})`;
  const quoteClass = `[${QUOTE_CHARS}]`;
  const hits: TextHit[] = [];

  const pushHit = (start: number, end: number, raw: string) => {
    if (start < 0 || end <= start) return;
    const stage = resolveStage(stages, raw);
    if (!stage) return;
    hits.push({ start, end, stage });
  };

  const prefixRe = new RegExp(
    `(^|[^A-Za-z0-9\\u0590-\\u05FF])(?:\\bstage\\b\\s*:?\\s*)${quoteClass}?\\s*(${quotedValue})\\s*${quoteClass}?(?=[^A-Za-z0-9\\u0590-\\u05FF]|$)`,
    'gi',
  );
  let match: RegExpExecArray | null;
  while ((match = prefixRe.exec(text)) !== null) {
    const prefix = match[1] || '';
    const start = match.index + prefix.length;
    pushHit(start, start + match[0].length - prefix.length, match[2] || '');
  }

  const quotedRe = new RegExp(`${quoteClass}\\s*(${quotedValue})\\s*${quoteClass}`, 'gi');
  while ((match = quotedRe.exec(text)) !== null) {
    pushHit(match.index, match.index + match[0].length, match[1] || '');
  }

  if (distinctiveAliases.length) {
    const distinctivePattern = distinctiveAliases.map(escapeRegExp).join('|');
    const unquotedRe = new RegExp(
      `(^|[^A-Za-z0-9\\u0590-\\u05FF])(${distinctivePattern})(?=[^A-Za-z0-9\\u0590-\\u05FF]|$)`,
      'gi',
    );
    while ((match = unquotedRe.exec(text)) !== null) {
      const prefix = match[1] || '';
      const name = match[2] || '';
      const start = match.index + prefix.length;
      const end = start + name.length;
      if (!isJargonStageName(name) && !isUnquotedStageContext(text, start, end)) continue;
      pushHit(start, end, name);
    }
  }

  hits.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const kept: TextHit[] = [];
  for (const hit of hits) {
    const overlaps = kept.some((existing) => hit.start < existing.end && hit.end > existing.start);
    if (!overlaps) kept.push(hit);
  }
  return kept;
}

export function ChatStageBadgeText({
  text,
  stages,
  employees,
  onOpen,
  dark = false,
}: {
  text: string;
  stages: ChatStageHit[];
  employees: ChatEmployeeHit[];
  onOpen?: () => void;
  dark?: boolean;
}) {
  if (!text) return null;
  if (!stages.length) {
    return <ChatEmployeeNameText text={text} employees={employees} onOpen={onOpen} />;
  }

  const hits = collectStageHits(text, stages);
  if (!hits.length) {
    return <ChatEmployeeNameText text={text} employees={employees} onOpen={onOpen} />;
  }

  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;

  for (const hit of hits) {
    if (hit.start > lastIndex) {
      nodes.push(
        <ChatEmployeeNameText
          key={`t-${key++}`}
          text={text.slice(lastIndex, hit.start)}
          employees={employees}
          onOpen={onOpen}
        />,
      );
    }
    nodes.push(<ChatStageBadge key={`s-${key++}`} stage={hit.stage} dark={dark} />);
    lastIndex = hit.end;
  }

  if (lastIndex < text.length) {
    nodes.push(
      <ChatEmployeeNameText
        key={`t-${key++}`}
        text={text.slice(lastIndex)}
        employees={employees}
        onOpen={onOpen}
      />,
    );
  }

  return nodes.length > 0 ? <>{nodes}</> : <ChatEmployeeNameText text={text} employees={employees} onOpen={onOpen} />;
}
