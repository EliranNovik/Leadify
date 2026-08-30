import React, { useCallback, useEffect, useRef } from 'react';
import { SparklesIcon } from '@heroicons/react/24/solid';
import { ArrowPathIcon } from '@heroicons/react/24/outline';

const HEBREW_RE = /[\u0590-\u05FF]/;

export function isUsableAiDraft(suggestion: string): boolean {
  const text = suggestion.trim();
  if (!text) return false;
  if (/^sorry[,.]/i.test(text)) return false;
  return true;
}

export function useComposeAiTypewriter(
  setBody: (value: string) => void,
  setRtl?: (rtl: boolean) => void,
) {
  const cancelRef = useRef<(() => void) | null>(null);

  const cancel = useCallback(() => {
    cancelRef.current?.();
    cancelRef.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  const typewrite = useCallback(
    (text: string) => {
      cancel();
      const source = text.trim();
      if (!source) return;

      let index = 0;
      let cancelled = false;
      let timer = 0;

      const tick = () => {
        if (cancelled) return;
        const remaining = source.length - index;
        const chunk = remaining > 80 ? 4 : remaining > 20 ? 3 : 2;
        index = Math.min(source.length, index + chunk);
        const next = source.slice(0, index);
        setBody(next);
        setRtl?.(HEBREW_RE.test(next));
        if (index < source.length) {
          timer = window.setTimeout(tick, 10 + Math.random() * 12);
        } else {
          cancelRef.current = null;
        }
      };

      cancelRef.current = () => {
        cancelled = true;
        window.clearTimeout(timer);
      };
      tick();
    },
    [cancel, setBody, setRtl],
  );

  return { typewrite, cancel };
}

type ComposeAiEmptyPromptProps = {
  visible: boolean;
  loading: boolean;
  disabled?: boolean;
  onClick: () => void;
};

export const ComposeAiEmptyPrompt: React.FC<ComposeAiEmptyPromptProps> = ({
  visible,
  loading,
  disabled,
  onClick,
}) => {
  if (!visible && !loading) return null;

  return (
    <div className="pointer-events-none absolute left-4 top-3 z-[1] flex max-w-[min(100%-2rem,40rem)] items-center gap-2.5">
      <style>{`
        @keyframes compose-ai-orbit {
          to { transform: rotate(360deg); }
        }
        @keyframes compose-ai-dot {
          0%, 80%, 100% { opacity: 0.25; transform: translateY(0); }
          40% { opacity: 1; transform: translateY(-2px); }
        }
        @keyframes compose-ai-caret {
          0%, 40% { opacity: 1; }
          60%, 100% { opacity: 0; }
        }
        .compose-ai-orbit {
          animation: compose-ai-orbit 1.15s linear infinite;
        }
        .compose-ai-dot {
          animation: compose-ai-dot 1s ease-in-out infinite;
        }
        .compose-ai-caret {
          animation: compose-ai-caret 0.9s steps(1, end) infinite;
        }
      `}</style>
      {loading ? (
        <div className="pointer-events-none inline-flex items-center gap-2.5 rounded-full border border-[#4218CC]/15 bg-white/90 px-3 py-1.5 shadow-[0_8px_24px_rgba(66,24,204,0.1)] backdrop-blur-sm">
          <span className="relative flex h-6 w-6 items-center justify-center">
            <span className="compose-ai-orbit absolute inset-0 rounded-full border-2 border-[#4218CC]/15 border-t-[#4218CC]" />
            <SparklesIcon className="h-3.5 w-3.5 text-[#4218CC]" />
          </span>
          <span className="text-sm font-semibold tracking-tight text-slate-700">
            AI is writing
            <span className="ml-0.5 inline-flex w-6 justify-start">
              <span className="compose-ai-dot">.</span>
              <span className="compose-ai-dot" style={{ animationDelay: '0.15s' }}>.</span>
              <span className="compose-ai-dot" style={{ animationDelay: '0.3s' }}>.</span>
            </span>
            <span className="compose-ai-caret ml-0.5 inline-block h-4 w-[2px] translate-y-[2px] bg-[#4218CC] align-middle" />
          </span>
        </div>
      ) : (
        <>
          <span className="invisible select-none text-sm leading-5">Type your message...&nbsp;</span>
          <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className="pointer-events-auto inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[#4218CC] bg-white px-3 py-1.5 text-xs font-semibold text-[#4218CC] hover:bg-[#4218CC]/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4218CC]/40 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <SparklesIcon className="h-3.5 w-3.5" />
            Create email with AI
          </button>
        </>
      )}
    </div>
  );
};

export default ComposeAiEmptyPrompt;

type ComposeAiRedoButtonProps = {
  disabled?: boolean;
  onClick: () => void;
};

export const ComposeAiRedoButton: React.FC<ComposeAiRedoButtonProps> = ({
  disabled,
  onClick,
}) => {
  return (
    <div className="px-4 pb-2">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-[#4218CC]/30 hover:bg-[#4218CC]/5 hover:text-[#4218CC] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4218CC]/30 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <ArrowPathIcon className="h-3.5 w-3.5" />
        Redo
      </button>
    </div>
  );
};
