import React, { useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { PaperAirplaneIcon, SparklesIcon } from '@heroicons/react/24/solid';
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
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

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
            <p className="whitespace-pre-wrap rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-800">
              {match[2]}
            </p>
          </div>
        );
      }
      return (
        <p key={`summary-${index}`} className={`whitespace-pre-wrap text-sm text-gray-800 ${index > 0 ? 'mt-3' : ''}`}>
          {section}
        </p>
      );
    });
  };

  const renderBubble = (msg: ContractAiReviewMessage, idx: number) => (
    <div
      key={`${msg.role}-${idx}-${msg.content.slice(0, 24)}`}
      className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
    >
      <div
        className={`max-w-[85%] rounded-2xl px-5 py-4 shadow-sm ${
          msg.role === 'user' ? 'contract-ai-bubble-user' : 'contract-ai-bubble-assistant'
        }`}
        style={{ fontSize: '1rem', lineHeight: 1.7 }}
      >
        {msg.role === 'assistant' ? (
          <p className="mb-2 text-sm font-semibold text-violet-700">
            {msg.kind === 'answer' ? 'Suggestion' : 'What changed'}
          </p>
        ) : null}
        {msg.role === 'assistant' && msg.kind === 'change' ? (
          <div>{renderChangeContent(msg.content)}</div>
        ) : (
          <p className={`whitespace-pre-wrap text-sm ${msg.role === 'user' ? 'text-white' : 'text-gray-800'}`}>
            {msg.content}
          </p>
        )}
      </div>
    </div>
  );

  return (
    <>
      <style>{`
        .contract-ai-bubble-assistant {
          background: rgba(255,255,255,0.95);
          color: #1f2937;
          border-bottom-left-radius: 2rem !important;
          border-top-right-radius: 2rem !important;
          border: 1px solid #e5e7eb;
          box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.05);
        }
        .contract-ai-bubble-user {
          background: linear-gradient(90deg, #6366f1 0%, #38bdf8 100%);
          color: #fff;
          border-bottom-right-radius: 2rem !important;
          border-top-left-radius: 2rem !important;
        }
        .contract-ai-input-area {
          background: #fff;
          box-shadow: 0 -2px 12px 0 rgba(31,38,135,0.06);
        }
        .contract-ai-input-shell {
          border-radius: 9999px;
          background: #f9fafb;
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
        desktopLayout="drawer-right"
        mobileFullHeight
        zIndex={70}
        sheetClassName="print-hide md:max-w-md"
        overlayClassName="md:bg-transparent md:pointer-events-none"
        scrollLock="mobile"
        contentClassName="!p-0 bg-gray-50/50"
        footerClassName="border-t-0"
        footer={
          <div className="contract-ai-input-area p-4 pt-3" data-sheet-no-drag>
            <div className="flex items-end gap-2">
              <div className="contract-ai-input-shell min-w-0 flex-1 overflow-hidden">
                <textarea
                  ref={textareaRef}
                  rows={1}
                  className="min-h-[3rem] w-full resize-none border-0 bg-transparent px-5 py-3 text-base leading-relaxed text-gray-900 placeholder:text-gray-500 focus:outline-none focus:ring-0"
                  placeholder={placeholder}
                  value={remarks}
                  onChange={(e) => onRemarksChange(e.target.value)}
                  disabled={isApplying}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      onApplyRemarks();
                    }
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
        <div className="space-y-4 p-4 md:p-5">
          {initialSummary ? (
            <div className="flex justify-start">
              <div
                className="contract-ai-bubble-assistant max-w-[85%] rounded-2xl px-5 py-4 shadow-sm"
                style={{ fontSize: '1rem', lineHeight: 1.7 }}
              >
                <p className="mb-2 text-sm font-semibold text-violet-700">What changed</p>
                {renderChangeContent(initialSummary)}
              </div>
            </div>
          ) : null}

          {!initialSummary && messages.length === 0 && !isApplying ? (
            <div className="flex justify-start">
              <div className="contract-ai-bubble-assistant max-w-[85%] rounded-2xl px-5 py-4 text-sm text-gray-600">
                Add a question or change request below.
              </div>
            </div>
          ) : null}

          {messages.map(renderBubble)}

          {isApplying ? (
            <div className="flex justify-start">
              <div className="contract-ai-bubble-assistant max-w-[85%] rounded-2xl px-5 py-4 shadow-sm">
                <p className="mb-2 text-sm font-semibold text-violet-700">Working…</p>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-600">
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
