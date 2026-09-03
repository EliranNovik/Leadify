import React, { useEffect, useMemo, useState } from 'react';
import { BookmarkIcon as BookmarkOutlineIcon, CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/outline';
import { BookmarkIcon } from '@heroicons/react/24/solid';
import { toast } from 'react-hot-toast';
import {
  canPromoteFirmKnowledge,
  loadResearchCardState,
  persistFeedback,
  persistResearchFeedback,
  promoteWebResearchToKnowledge,
  resolveRmqAiRolePack,
  type KnowledgeKind,
  type KnowledgeTopicScope,
} from '../lib/rmqAiV1';
import { uniqueWebSources, type WebSearchCardData, type WebSearchCategory } from '../lib/rmqAiWebSearch';

function DefaultSourceIcon() {
  return (
    <span className="ai-sources-favicon is-fallback" aria-hidden>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
        <circle cx="12" cy="12" r="8.25" />
        <path d="M3.75 12h16.5" />
        <path d="M12 3.75c2.4 2.4 3.6 5.1 3.6 8.25s-1.2 5.85-3.6 8.25" />
        <path d="M12 3.75c-2.4 2.4-3.6 5.1-3.6 8.25s1.2 5.85 3.6 8.25" />
      </svg>
    </span>
  );
}

function faviconCandidates(host: string): string[] {
  const clean = host.replace(/^www\./i, '').split('/')[0];
  if (!clean) return [];
  return [
    `https://${clean}/favicon.ico`,
    `https://icons.duckduckgo.com/ip3/${clean}.ico`,
  ];
}

function SourceFavicon({ host }: { host: string }) {
  const candidates = useMemo(() => faviconCandidates(host), [host]);
  const [index, setIndex] = useState(0);
  const src = candidates[index];
  if (!src) return <DefaultSourceIcon />;
  return (
    <img
      className="ai-sources-favicon"
      src={src}
      alt=""
      onError={() => setIndex((current) => current + 1)}
    />
  );
}

function authorityLabel(level?: string): string {
  if (level === 'A' || level === 'B' || level === 'C') return 'Official';
  if (level === 'D') return 'Legal pub';
  if (level === 'E') return 'News';
  if (level === 'F' || level === 'X') return 'Unverified';
  return '';
}

function defaultsForCategory(category?: WebSearchCategory): {
  kind: KnowledgeKind;
  topicScope: KnowledgeTopicScope;
  reviewAfterDays: number;
} {
  if (category === 'archive' || category === 'address') {
    return { kind: 'fact', topicScope: 'authority', reviewAfterDays: 180 };
  }
  if (category === 'law' || category === 'government') {
    return { kind: 'fact', topicScope: 'country', reviewAfterDays: 180 };
  }
  if (category === 'news') {
    return { kind: 'fact', topicScope: 'global', reviewAfterDays: 30 };
  }
  return { kind: 'fact', topicScope: 'global', reviewAfterDays: 180 };
}

export function ChatWebSources({
  data,
  conversationId,
  messageId,
  initialRating = null,
  initialSaved = false,
  onStateChange,
}: {
  data: WebSearchCardData;
  conversationId?: string | null;
  messageId?: string;
  initialRating?: 'useful' | 'wrong' | null;
  initialSaved?: boolean;
  onStateChange?: (next: { rating?: 'useful' | 'wrong' | null; saved?: boolean }) => void;
}) {
  const sources = useMemo(() => uniqueWebSources(data.sources).slice(0, 8), [data.sources]);
  const sourceUrlKey = useMemo(() => sources.map((src) => src.url).join('\n'), [sources]);
  const initial = useMemo(() => defaultsForCategory(data.category), [data.category]);
  const [canPromote, setCanPromote] = useState(false);
  const [rating, setRating] = useState<'useful' | 'wrong' | null>(initialRating);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(initialSaved);
  const [openSave, setOpenSave] = useState(false);
  const [title, setTitle] = useState(data.sources[0]?.title || 'Verified public research');
  const [kind, setKind] = useState<KnowledgeKind>(initial.kind);
  const [topicScope, setTopicScope] = useState<KnowledgeTopicScope>(initial.topicScope);
  const [country, setCountry] = useState('');
  const [authority, setAuthority] = useState('');
  const [caseType, setCaseType] = useState('');
  const [reviewAfterDays, setReviewAfterDays] = useState(initial.reviewAfterDays);

  useEffect(() => {
    void resolveRmqAiRolePack().then((role) => setCanPromote(canPromoteFirmKnowledge(role)));
  }, []);

  useEffect(() => {
    if (initialRating) setRating(initialRating);
    if (initialSaved) setSaved(true);
  }, [initialRating, initialSaved]);

  useEffect(() => {
    let cancelled = false;
    void loadResearchCardState({
      conversationId,
      messageId,
      sourceUrls: sources.map((src) => src.url),
    }).then((next) => {
      if (cancelled) return;
      if (next.rating) setRating(next.rating);
      if (next.saved) setSaved(true);
      if (next.rating || next.saved) {
        onStateChange?.({
          rating: next.rating,
          saved: next.saved,
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [conversationId, messageId, sourceUrlKey]);

  if (!data.sources.length) return null;

  const mark = async (next: 'useful' | 'wrong') => {
    setRating(next);
    onStateChange?.({ rating: next });
    const ok = await persistResearchFeedback({
      conversationId,
      messageId,
      rating: next,
      summary: data.summary,
      sourceUrls: sources.map((src) => src.url),
    });
    void persistFeedback({
      conversationId,
      messageId: messageId || 'web-research',
      rating: next === 'useful' ? 'up' : 'down',
      reason: next === 'wrong' ? 'wrong_data' : undefined,
    });
    if (ok) toast.success(next === 'useful' ? 'Marked useful. Knowledge was not changed.' : 'Marked wrong. Knowledge was not changed.');
    else toast.error('Could not save feedback.');
  };

  const save = async () => {
    if (!title.trim() || !data.summary.trim()) {
      toast.error('Add a title and make sure there is a research summary.');
      return;
    }
    setSaving(true);
    const result = await promoteWebResearchToKnowledge({
      title: title.trim(),
      summary: data.summary,
      kind,
      topicScope,
      country,
      authority,
      caseType,
      reviewAfterDays,
      sources,
    });
    setSaving(false);
    if (!result) {
      toast.error('Could not save. Run sql/2026-09-03_rmq_ai_verified_knowledge.sql');
      return;
    }
    setSaved(true);
    setOpenSave(false);
    onStateChange?.({ saved: true });
    toast.success('Saved to firm knowledge. Next similar questions can use this instead of the web.');
  };

  return (
    <div className="ai-sources-box">
      <svg width="0" height="0" aria-hidden className="absolute overflow-hidden">
        <defs>
          <linearGradient id="ai-sources-send-grad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--ai-send-from)" />
            <stop offset="100%" stopColor="var(--ai-send-to)" />
          </linearGradient>
        </defs>
      </svg>
      <div className="ai-sources-kicker flex items-center justify-between gap-2">
        <span>Sources</span>
        {data.confidence === 'uncertain' ? (
          <span className="normal-case tracking-normal font-medium text-amber-600">Uncertain</span>
        ) : null}
      </div>
      <ul className="space-y-1.5">
        {sources.map((src) => {
          const host = src.domain || src.url.replace(/^https?:\/\//, '').split('/')[0];
          const badge = authorityLabel(src.authorityLevel);
          return (
            <li key={src.id || src.url} className="min-w-0">
              <a
                href={src.url}
                target="_blank"
                rel="noopener noreferrer"
                className="ai-sources-item"
              >
                <SourceFavicon host={host} />
                <span className="ai-sources-copy">
                  <span className="ai-sources-link">{src.title || host}</span>
                  <span className="ai-sources-meta">
                    {host}
                    {badge ? ` · ${badge}` : ''}
                  </span>
                </span>
              </a>
            </li>
          );
        })}
      </ul>

      <div className="ai-sources-actions">
        <button
          type="button"
          className={`ai-sources-btn ai-sources-btn-useful${rating === 'useful' ? ' is-on' : ''}`}
          onClick={() => void mark('useful')}
        >
          <CheckCircleIcon className="h-5 w-5" />
          Useful
        </button>
        <button
          type="button"
          className={`ai-sources-btn ai-sources-btn-wrong${rating === 'wrong' ? ' is-on' : ''}`}
          onClick={() => void mark('wrong')}
        >
          <XCircleIcon className="h-5 w-5" />
          Wrong
        </button>
        {canPromote && !saved ? (
          <button
            type="button"
            className={`ai-sources-save-icon${openSave ? ' is-on' : ''}`}
            onClick={() => setOpenSave((open) => !open)}
            title="Save"
            aria-label="Save"
          >
            {openSave ? (
              <BookmarkIcon className="h-5 w-5" />
            ) : (
              <BookmarkOutlineIcon className="h-5 w-5" />
            )}
            Save
          </button>
        ) : null}
        {saved ? (
          <span className="ai-sources-saved">
            <BookmarkIcon className="h-5 w-5" />
            Saved
          </span>
        ) : null}
      </div>

      {openSave && canPromote && !saved ? (
        <div className="ai-sources-form space-y-2">
          <p className="text-xs font-semibold opacity-80">Promote verified knowledge</p>
          <p className="text-[11px] opacity-50">
            Save official facts or office procedure. Do not save a legal opinion or a strategy for one client.
          </p>
          <label className="block text-[11px] font-medium opacity-70">
            Title
            <input
              className="mt-1 w-full px-2 py-1.5 text-sm"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-[11px] font-medium opacity-70">
              Kind
              <select
                className="mt-1 w-full px-2 py-1.5 text-sm"
                value={kind}
                onChange={(event) => setKind(event.target.value as KnowledgeKind)}
              >
                <option value="fact">Official fact</option>
                <option value="procedure">Office procedure</option>
              </select>
            </label>
            <label className="block text-[11px] font-medium opacity-70">
              Scope
              <select
                className="mt-1 w-full px-2 py-1.5 text-sm"
                value={topicScope}
                onChange={(event) => setTopicScope(event.target.value as KnowledgeTopicScope)}
              >
                <option value="global">Global</option>
                <option value="country">Country</option>
                <option value="authority">Authority</option>
                <option value="procedure">Procedure</option>
                <option value="case_type">Case type</option>
              </select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-[11px] font-medium opacity-70">
              Country
              <input
                className="mt-1 w-full px-2 py-1.5 text-sm"
                value={country}
                onChange={(event) => setCountry(event.target.value)}
                placeholder="Germany"
              />
            </label>
            <label className="block text-[11px] font-medium opacity-70">
              Authority
              <input
                className="mt-1 w-full px-2 py-1.5 text-sm"
                value={authority}
                onChange={(event) => setAuthority(event.target.value)}
                placeholder="BVA / MA35"
              />
            </label>
          </div>
          {topicScope === 'case_type' ? (
            <label className="block text-[11px] font-medium opacity-70">
              Case type
              <input
                className="mt-1 w-full px-2 py-1.5 text-sm"
                value={caseType}
                onChange={(event) => setCaseType(event.target.value)}
                placeholder="§15 StAG"
              />
            </label>
          ) : null}
          <label className="block text-[11px] font-medium opacity-70">
            Review after
            <select
              className="mt-1 w-full px-2 py-1.5 text-sm"
              value={reviewAfterDays}
              onChange={(event) => setReviewAfterDays(Number(event.target.value))}
            >
              <option value={90}>90 days</option>
              <option value={180}>6 months</option>
              <option value={365}>1 year</option>
            </select>
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              className="ai-sources-btn"
              style={{ background: 'transparent', opacity: 0.65 }}
              onClick={() => setOpenSave(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="ai-sources-btn ai-sources-btn-save disabled:opacity-60"
              disabled={saving}
              onClick={() => void save()}
            >
              {saving ? 'Saving…' : 'Save verified knowledge'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
