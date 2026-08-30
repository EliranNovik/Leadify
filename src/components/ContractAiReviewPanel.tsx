import React, { useRef, useEffect, useLayoutEffect, useCallback, useState } from 'react';
import { PaperAirplaneIcon, SparklesIcon, XMarkIcon } from '@heroicons/react/24/solid';
import MobileBottomSheet from './MobileBottomSheet';
import { formatAiThinkingDisplay } from '../lib/aiReviewStreaming';

export type ContractAiReviewMessage = {
  role: 'user' | 'assistant';
  content: string;
  kind?: 'answer' | 'change';
};

type ContractAiReviewPanelProps = {
  isOpen: boolean;
  onClose: () => void;
  initialSummary: string | null;
  messages: ContractAiReviewMessage[];
  remarks: string;
  onRemarksChange: (value: string) => void;
  onApplyRemarks: () => void;
  isApplying: boolean;
  thinkingText?: string | null;
  title?: React.ReactNode;
  subtitle?: string;
  placeholder?: string;
  /** Plain chat — no “What changed” / Suggestion labels or change-diff layout. */
  conversationOnly?: boolean;
  /** Sheet stacking order (compose overlays sit above 10000). */
  zIndex?: number;
  /** Extra sheet classes (e.g. narrower docked chat). */
  sheetClassName?: string;
  headerClassName?: string;
  contentClassName?: string;
  /** Desktop: sit flush against the left edge of this element. */
  dockToSelector?: string;
  closeIcon?: React.ReactNode;
  headerExtra?: React.ReactNode;
  inputDir?: 'ltr' | 'rtl';
};

const ContractAiReviewPanel: React.FC<ContractAiReviewPanelProps> = ({
  isOpen,
  onClose,
  initialSummary,
  messages,
  remarks,
  onRemarksChange,
  onApplyRemarks,
  isApplying,
  thinkingText = null,
  title = (
    <span className="flex items-center gap-2">
      <SparklesIcon className="h-5 w-5 shrink-0 text-violet-600" />
      <span>AI Contract Review</span>
    </span>
  ),
  subtitle = 'Ask questions or request contract changes',
  placeholder = 'Type text...',
  conversationOnly = false,
  zIndex,
  sheetClassName = '',
  headerClassName = '',
  contentClassName = '',
  dockToSelector,
  closeIcon,
  headerExtra,
  inputDir,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [dockRightPx, setDockRightPx] = useState<number | null>(null);

  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, []);

  useEffect(() => {
    if (isOpen && textareaRef.current) {
      const timer = setTimeout(() => textareaRef.current?.focus(), 250);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  useLayoutEffect(() => {
    if (isOpen) resizeTextarea();
  }, [isOpen, remarks, resizeTextarea]);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [isOpen, initialSummary, messages, isApplying, thinkingText]);

  useEffect(() => {
    if (!isOpen || !dockToSelector) {
      setDockRightPx(null);
      return;
    }

    let observer: ResizeObserver | null = null;
    const measure = () => {
      const target = document.querySelector(dockToSelector) as HTMLElement | null;
      if (!target || !window.matchMedia('(min-width: 768px)').matches) {
        setDockRightPx(null);
        return;
      }
      if (!observer) {
        observer = new ResizeObserver(measure);
        observer.observe(target);
      }
      setDockRightPx(Math.max(0, Math.round(window.innerWidth - target.getBoundingClientRect().left)));
    };

    measure();
    const raf = requestAnimationFrame(measure);
    const retry = window.setInterval(measure, 120);
    const stopRetry = window.setTimeout(() => window.clearInterval(retry), 2000);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(retry);
      window.clearTimeout(stopRetry);
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [isOpen, dockToSelector]);

  const panelDir = inputDir ?? 'ltr';

  const dirForText = (text: string): 'ltr' | 'rtl' => {
    if (/[\u0590-\u05FF]/.test(text)) return 'rtl';
    if (/[A-Za-z]/.test(text)) return 'ltr';
    return panelDir;
  };

  const alignFor = (dir: 'ltr' | 'rtl') => (dir === 'rtl' ? 'text-right' : 'text-left');

  const CHANGE_SECTION_RE =
    /^(Removed:|Added:|Inserted after:|Added at beginning:)\n?([\s\S]*)$/;

  const renderChangeContent = (content: string) => {
    const sections = content.split(/\n\n/);
    return sections.map((section, index) => {
      const match = section.match(CHANGE_SECTION_RE);
      if (match) {
        const label = match[1].replace(':', '');
        const isRemoved = label === 'Removed';
        return (
          <div key={`${label}-${index}`} className={index > 0 ? 'mt-3' : ''}>
            <p
              className={`mb-1 text-xs font-semibold uppercase tracking-wide ${
                isRemoved ? 'text-red-600' : 'text-emerald-700'
              }`}
            >
              {label}
            </p>
            <p dir={dirForText(match[2])} className={`whitespace-pre-wrap rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-800 ${alignFor(dirForText(match[2]))}`}>
              {match[2]}
            </p>
          </div>
        );
      }
      return (
        <p key={`summary-${index}`} dir={dirForText(section)} className={`whitespace-pre-wrap text-sm text-gray-800 ${alignFor(dirForText(section))} ${index > 0 ? 'mt-3' : ''}`}>
          {section}
        </p>
      );
    });
  };

  const renderBubble = (msg: ContractAiReviewMessage, idx: number) => {
    const bubbleDir = dirForText(msg.content);
    return (
    <div
      key={`${msg.role}-${idx}-${msg.content.slice(0, 24)}`}
      className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
    >
      <div
        className={`max-w-[85%] rounded-2xl px-5 py-4 ${
          msg.role === 'user' ? 'contract-ai-bubble-user' : 'contract-ai-bubble-assistant'
        }`}
        style={{ fontSize: '1rem', lineHeight: 1.7 }}
        dir={bubbleDir}
      >
        {!conversationOnly && msg.role === 'assistant' ? (
          <p className="mb-2 text-sm font-semibold text-violet-700">
            {msg.kind === 'answer' ? 'Suggestion' : 'What changed'}
          </p>
        ) : null}
        {!conversationOnly && msg.role === 'assistant' && msg.kind === 'change' ? (
          <div>{renderChangeContent(msg.content)}</div>
        ) : (
          <p className={`whitespace-pre-wrap text-sm ${alignFor(bubbleDir)} ${msg.role === 'user' ? 'text-white' : 'text-gray-800'}`}>
            {msg.content}
          </p>
        )}
      </div>
    </div>
    );
  };

  return (
    <>
      <style>{`
        .contract-ai-bubble-assistant {
          background: #fff;
          color: #1f2937;
          border-bottom-left-radius: 2rem !important;
          border-top-right-radius: 2rem !important;
          border: none;
          box-shadow: none;
          outline: none;
        }
        .contract-ai-bubble-user {
          background: linear-gradient(90deg, #6366f1 0%, #38bdf8 100%);
          color: #fff;
          border-bottom-right-radius: 2rem !important;
          border-top-left-radius: 2rem !important;
        }
        .contract-ai-input-area {
          background: #f9fafb;
          box-shadow: none;
        }
        .contract-ai-input-shell {
          border-radius: 9999px;
          background: #fff;
          border: none;
        }
        .contract-ai-input-shell:focus-within {
          outline: none;
          box-shadow: none;
        }
        .contract-ai-input-area textarea {
          overflow-y: auto;
          scrollbar-width: none;
          -ms-overflow-style: none;
          outline: none;
          box-shadow: none;
        }
        .contract-ai-input-area textarea:focus {
          outline: none;
          box-shadow: none;
        }
        .contract-ai-input-area textarea::-webkit-scrollbar {
          display: none;
        }
      `}</style>

      <MobileBottomSheet
        open={isOpen}
        onClose={onClose}
        title={title}
        subtitle={subtitle}
        headerRight={
          <div className="flex items-center gap-2">
            {headerExtra}
            <button
              type="button"
              className="btn btn-ghost btn-circle btn-sm text-base-content/60 hover:bg-base-200 hover:text-base-content"
              onClick={onClose}
              aria-label="Close AI sidebar"
              title="Close"
            >
              {closeIcon ?? <XMarkIcon className="h-5 w-5" />}
            </button>
          </div>
        }
        zIndex={zIndex ?? 70}
        desktopLayout="drawer-right"
        mobileFullHeight
        sheetClassName={`print-hide !bg-gray-50 !shadow-none md:max-w-md ${sheetClassName}`}
        sheetStyle={{
          boxShadow: 'none',
          ...(dockRightPx != null ? { marginRight: dockRightPx } : {}),
        }}
        overlayClassName="md:bg-transparent md:pointer-events-none"
        scrollLock="mobile"
        contentClassName={`!p-0 !bg-gray-50 ${contentClassName}`}
        headerClassName={`!bg-gray-50 border-gray-200/70 ${headerClassName}`}
        footerClassName="border-t-0 !bg-gray-50"
        footer={
          <div className="contract-ai-input-area p-4 pt-3" data-sheet-no-drag>
            <div className="flex items-end gap-2">
              <div className="contract-ai-input-shell min-w-0 flex-1 overflow-hidden">
                <textarea
                  ref={textareaRef}
                  rows={1}
                  className="min-h-[3rem] w-full resize-none border-0 bg-transparent px-5 py-3 text-base leading-relaxed text-gray-900 placeholder:text-gray-500 focus:outline-none focus:ring-0"
                  placeholder={placeholder}
                  dir={inputDir}
                  value={remarks}
                  onChange={(e) => onRemarksChange(e.target.value)}
                  disabled={isApplying}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
                    e.preventDefault();
                    if (!isApplying && remarks.trim()) onApplyRemarks();
                  }}
                />
              </div>
              <button
                type="button"
                className="btn btn-circle h-12 w-12 shrink-0 border-0 bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-md hover:from-violet-700 hover:to-indigo-700 disabled:opacity-60"
                onClick={onApplyRemarks}
                disabled={isApplying || !remarks.trim()}
                aria-label="Send"
                title="Send"
              >
                {isApplying ? (
                  <span className="loading loading-spinner loading-sm" />
                ) : (
                  <PaperAirplaneIcon className="h-5 w-5" />
                )}
              </button>
            </div>
          </div>
        }
      >
        <div className="min-h-full space-y-4 bg-gray-50 p-4 md:p-5">
          {initialSummary ? (
            <div className="flex justify-start">
              <div
                className="contract-ai-bubble-assistant max-w-[85%] rounded-2xl px-5 py-4"
                style={{ fontSize: '1rem', lineHeight: 1.7 }}
                dir={dirForText(initialSummary || '')}
              >
                {conversationOnly ? (
                  <p className={`whitespace-pre-wrap text-sm text-gray-800 ${alignFor(dirForText(initialSummary || ''))}`}>{initialSummary}</p>
                ) : (
                  <>
                    <p className="mb-2 text-sm font-semibold text-violet-700">What changed</p>
                    {renderChangeContent(initialSummary)}
                  </>
                )}
              </div>
            </div>
          ) : null}

          {!initialSummary && messages.length === 0 && !isApplying ? (
            <div className="flex justify-start">
              <div
                className={`contract-ai-bubble-assistant max-w-[85%] rounded-2xl px-5 py-4 text-sm text-gray-600 ${alignFor(panelDir)}`}
                dir={panelDir}
              >
                {conversationOnly
                  ? panelDir === 'rtl'
                    ? 'שאלו כל דבר על הפגישה, או תארו מה לכתוב בסיכום.'
                    : 'Ask anything about this document, or describe what you want written.'
                  : 'Add a question or change request below.'}
              </div>
            </div>
          ) : null}

          {messages.map(renderBubble)}

          {isApplying ? (
            <div className="flex justify-start">
              <div
                className="contract-ai-bubble-assistant max-w-[85%] rounded-2xl px-5 py-4"
                dir={dirForText(thinkingText || '')}
              >
                {conversationOnly ? null : (
                  <p className="mb-2 text-sm font-semibold text-violet-700">Working…</p>
                )}
                <p className={`whitespace-pre-wrap text-sm leading-relaxed text-gray-600 ${alignFor(dirForText(thinkingText || ''))}`}>
                  {formatAiThinkingDisplay(thinkingText || '') || 'Starting…'}
                </p>
              </div>
            </div>
          ) : null}

          <div ref={messagesEndRef} />
        </div>
      </MobileBottomSheet>
    </>
  );
};

export default ContractAiReviewPanel;
