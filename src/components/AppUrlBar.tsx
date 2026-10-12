import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  ArrowUpOnSquareIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  MagnifyingGlassIcon,
  Square2StackIcon,
} from '@heroicons/react/24/outline';

import { appPageTitle, searchAppPages } from '../lib/appPages';

/** Drives `--rmq-urlbar-h` in index.css, which offsets the fixed header and the scroll region. */
const ACTIVE_CLASS = 'rmq-url-bar-active';
const HISTORY_STORAGE_KEY = 'rmq-urlbar-history';
const HISTORY_LIMIT = 25;
const RESULT_LIMIT = 7;

type BarMode = 'idle' | 'edit' | 'search' | 'history';
type HistoryEntry = { to: string; label: string };

/**
 * True only where the browser gives us no navigation chrome of its own. Desktop installs run
 * display:minimal-ui and already have Chrome's bar, so they are deliberately excluded.
 */
function useIsChromelessInstall(): boolean {
  const [chromeless, setChromeless] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(display-mode: standalone)');
    const update = () => {
      const iosStandalone =
        (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
      setChromeless(query.matches || iosStandalone);
    };
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return chromeless;
}

/**
 * React Router keeps its position in `history.state.idx`. There is no API for "can I go forward",
 * so comparing the current index against the furthest one reached is the only way to know.
 */
function historyIndex(): number | null {
  const state = window.history.state as { idx?: number } | null;
  return typeof state?.idx === 'number' ? state.idx : null;
}

function readStoredHistory(): HistoryEntry[] {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(HISTORY_STORAGE_KEY) ?? 'null');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is HistoryEntry =>
        typeof entry?.to === 'string' && typeof entry?.label === 'string',
    );
  } catch {
    return [];
  }
}

/** Anything with a dot and no leading slash — "example.com/x" — is meant as an external site. */
const BARE_DOMAIN = /^[\w-]+(\.[\w-]+)+(\/|$)/;
const HAS_SCHEME = /^[a-z][a-z\d+.-]*:/i;

type TypedTarget = { internal: string } | { external: string };

/** Interpret whatever the user typed into the URL field. */
function resolveTypedTarget(raw: string): TypedTarget | null {
  const value = raw.trim();
  if (!value) return null;
  if (value.startsWith('/')) return { internal: value };

  if (HAS_SCHEME.test(value)) {
    try {
      const url = new URL(value);
      // Same-origin links stay in the SPA so navigation does not reload the whole app.
      if (url.origin === window.location.origin) {
        return { internal: `${url.pathname}${url.search}${url.hash}` };
      }
      return { external: url.href };
    } catch {
      return null;
    }
  }

  if (BARE_DOMAIN.test(value)) return { external: `https://${value}` };
  // Bare words are treated as app paths, so typing "clients" goes to /clients.
  return { internal: `/${value}` };
}

const ICON_BUTTON_CLASS =
  'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-base-content/60 '
  + 'transition-colors hover:bg-base-200 hover:text-base-content '
  + 'disabled:pointer-events-none disabled:opacity-30';

const ICON_CLASS = 'h-[1.125rem] w-[1.125rem]';

/**
 * Shared by the address, the editor and the search field so the centre slot never jumps.
 * `rmq-urlbar-field` carries the engraved grey surface — see index.css.
 */
const CENTRE_FIELD_CLASS =
  'rmq-urlbar-field w-full min-w-0 rounded-lg px-3 py-1 text-xs font-medium text-base-content';

const AppUrlBar: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const chromeless = useIsChromelessInstall();
  // The entry kiosk is intentionally immersive — never put a URL bar on it.
  const visible = chromeless && !location.pathname.startsWith('/entry-kiosk');

  const [mode, setMode] = useState<BarMode>('idle');
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [activeResult, setActiveResult] = useState(0);
  const [index, setIndex] = useState<number | null>(() => historyIndex());
  const [furthest, setFurthest] = useState(() => historyIndex() ?? 0);
  const [visited, setVisited] = useState<HistoryEntry[]>(() => readStoredHistory());

  const containerRef = useRef<HTMLDivElement | null>(null);
  const editInputRef = useRef<HTMLInputElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const here = `${location.pathname}${location.search}`;
  const results = useMemo(() => searchAppPages(query, RESULT_LIMIT), [query]);

  // Track where we are: forward availability, the visited list, and closing any open panel.
  useEffect(() => {
    const current = historyIndex();
    setIndex(current);
    if (current !== null) setFurthest((prev) => Math.max(prev, current));
    setMode('idle');

    setVisited((prev) => {
      const entry: HistoryEntry = { to: here, label: appPageTitle(location.pathname) };
      const next = [entry, ...prev.filter((item) => item.to !== here)].slice(0, HISTORY_LIMIT);
      try {
        sessionStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Private mode or a full quota — the in-memory list still works.
      }
      return next;
    });
  }, [location.key, here, location.pathname]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle(ACTIVE_CLASS, visible);
    return () => root.classList.remove(ACTIVE_CLASS);
  }, [visible]);

  useEffect(() => {
    if (mode === 'edit') editInputRef.current?.select();
    if (mode === 'search') searchInputRef.current?.focus();
  }, [mode]);

  // Clicking or tapping anywhere else puts the bar back to its resting state.
  useEffect(() => {
    if (mode === 'idle') return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setMode('idle');
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [mode]);

  const go = useCallback(
    (to: string) => {
      setMode('idle');
      setQuery('');
      navigate(to);
    },
    [navigate],
  );

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success('Link copied');
    } catch {
      toast.error('Could not copy the link');
    }
  }, []);

  const shareLink = useCallback(async () => {
    try {
      await navigator.share({ title: document.title, url: window.location.href });
    } catch (error) {
      // Dismissing the share sheet rejects with AbortError; that is not a failure.
      if ((error as DOMException | undefined)?.name !== 'AbortError') void copyLink();
    }
  }, [copyLink]);

  const submitDraft = useCallback(() => {
    const target = resolveTypedTarget(draft);
    if (!target) {
      setMode('idle');
      return;
    }
    if ('external' in target) {
      setMode('idle');
      window.location.assign(target.external);
      return;
    }
    go(target.internal);
  }, [draft, go]);

  const openEditor = useCallback(() => {
    setDraft(here);
    setMode('edit');
  }, [here]);

  const toggleMode = useCallback((next: BarMode) => {
    setMode((prev) => (prev === next ? 'idle' : next));
    setQuery('');
    setActiveResult(0);
  }, []);

  if (!visible) return null;

  const canGoBack = index === null || index > 0;
  const canGoForward = index !== null && index < furthest;
  const recent = visited.filter((entry) => entry.to !== here);

  return (
    <div
      ref={containerRef}
      className="fixed inset-x-0 top-0 z-[60] bg-white dark:bg-base-100"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
    >
      <div className="flex h-9 items-center gap-1 px-1.5">
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => window.history.back()}
            disabled={!canGoBack}
            className={ICON_BUTTON_CLASS}
            aria-label="Go back"
          >
            <ChevronLeftIcon className={ICON_CLASS} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => window.history.forward()}
            disabled={!canGoForward}
            className={ICON_BUTTON_CLASS}
            aria-label="Go forward"
          >
            <ChevronRightIcon className={ICON_CLASS} aria-hidden="true" />
          </button>
        </div>

        {/* Search sits inside the centre cluster so it stays beside the address at any width. */}
        <div className="flex min-w-0 flex-1 items-center justify-center gap-1">
          <button
            type="button"
            onClick={() => toggleMode('search')}
            className={ICON_BUTTON_CLASS}
            aria-label="Search pages"
            aria-expanded={mode === 'search'}
          >
            <MagnifyingGlassIcon className={ICON_CLASS} aria-hidden="true" />
          </button>
          <div className={`min-w-0 ${mode === 'idle' ? 'w-[min(100%,15rem)]' : 'w-[min(100%,22rem)]'}`}>
            {mode === 'search' ? (
              <input
                ref={searchInputRef}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActiveResult(0);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setMode('idle');
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    setActiveResult((prev) => Math.min(prev + 1, Math.max(results.length - 1, 0)));
                  }
                  if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    setActiveResult((prev) => Math.max(prev - 1, 0));
                  }
                  if (event.key === 'Enter' && results[activeResult]) go(results[activeResult].path);
                }}
                placeholder="Search pages…"
                className={`${CENTRE_FIELD_CLASS} text-center outline-none placeholder:text-base-content/40`}
                aria-label="Search pages"
              />
            ) : mode === 'edit' ? (
              <input
                ref={editInputRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setMode('idle');
                  if (event.key === 'Enter') submitDraft();
                }}
                onBlur={() => setMode('idle')}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                className={`${CENTRE_FIELD_CLASS} text-center outline-none`}
                aria-label="Page address"
              />
            ) : (
              <button
                type="button"
                onClick={openEditor}
                className={`${CENTRE_FIELD_CLASS} block truncate text-center tracking-tight text-base-content/70 transition-colors`}
                title="Edit this address to navigate"
              >
                {window.location.host}
                {here}
              </button>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => toggleMode('history')}
            className={ICON_BUTTON_CLASS}
            aria-label="Recently visited pages"
            aria-expanded={mode === 'history'}
          >
            <ClockIcon className={ICON_CLASS} aria-hidden="true" />
          </button>
          <button type="button" onClick={copyLink} className={ICON_BUTTON_CLASS} aria-label="Copy link">
            <Square2StackIcon className={ICON_CLASS} aria-hidden="true" />
          </button>
          {/* Always rendered: where the share sheet is unavailable this falls back to copying. */}
          <button type="button" onClick={shareLink} className={ICON_BUTTON_CLASS} aria-label="Share link">
            <ArrowUpOnSquareIcon className={ICON_CLASS} aria-hidden="true" />
          </button>
        </div>
      </div>

      {mode === 'search' && (
        <div className="absolute left-1/2 top-full mt-1 w-72 -translate-x-1/2 overflow-hidden rounded-xl border border-base-300/60 bg-white shadow-xl dark:bg-base-100">
          {results.length === 0 ? (
            <p className="px-3 py-2.5 text-xs text-base-content/50">
              {query ? `No page matches “${query}”` : 'Type to find a page'}
            </p>
          ) : (
            <ul className="max-h-[60vh] overflow-y-auto py-1">
              {results.map((page, position) => (
                <li key={page.path}>
                  <button
                    type="button"
                    onClick={() => go(page.path)}
                    onMouseEnter={() => setActiveResult(position)}
                    className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors active:bg-base-300 ${
                      position === activeResult ? 'bg-base-200' : 'hover:bg-base-200'
                    }`}
                  >
                    <span className="truncate text-xs font-medium text-base-content">{page.label}</span>
                    <span className="shrink-0 text-[10px] text-base-content/40">
                      {page.group ?? page.path}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {mode === 'history' && (
        <div className="absolute right-1.5 top-full mt-1 w-56 overflow-hidden rounded-xl border border-base-300/60 bg-white shadow-xl dark:bg-base-100">
          {recent.length === 0 ? (
            <p className="px-3 py-2.5 text-xs text-base-content/50">No pages visited yet</p>
          ) : (
            <ul className="max-h-[60vh] overflow-y-auto py-1">
              {recent.map((entry) => (
                <li key={entry.to}>
                  <button
                    type="button"
                    onClick={() => go(entry.to)}
                    className="block w-full truncate px-3 py-2 text-left text-xs font-medium text-base-content transition-colors hover:bg-base-200 active:bg-base-300"
                  >
                    {entry.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

export default AppUrlBar;
