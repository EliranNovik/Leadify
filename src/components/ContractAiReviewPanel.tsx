import React, { useRef, useEffect } from 'react';
import { PaperAirplaneIcon, SparklesIcon } from '@heroicons/react/24/solid';
import MobileBottomSheet from './MobileBottomSheet';

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
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && textareaRef.current) {
      const timer = setTimeout(() => textareaRef.current?.focus(), 250);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [isOpen, initialSummary, messages, isApplying]);

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
        <p className={`whitespace-pre-wrap text-sm ${msg.role === 'user' ? 'text-white' : 'text-gray-800'}`}>
          {msg.content}
        </p>
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
          border-top: 1px solid #e5e7eb;
        }
      `}</style>

      <MobileBottomSheet
        open={isOpen}
        onClose={onClose}
        title={
          <span className="flex items-center gap-2">
            <SparklesIcon className="h-5 w-5 shrink-0 text-violet-600" />
            <span>AI Contract Review</span>
          </span>
        }
        subtitle="Ask questions or request contract changes"
        desktopLayout="drawer-right"
        mobileFullHeight
        zIndex={70}
        sheetClassName="print-hide md:max-w-md"
        overlayClassName="md:bg-transparent md:pointer-events-none"
        scrollLock="mobile"
        contentClassName="!p-0 bg-gray-50/50"
        footer={
          <div className="contract-ai-input-area p-4" data-sheet-no-drag>
            <div className="flex flex-col gap-3">
              <textarea
                ref={textareaRef}
                className="textarea textarea-bordered min-h-[88px] w-full resize-none border-gray-200 bg-white text-base focus:border-violet-300 focus:outline-none"
                placeholder="Ask a question (e.g. what else can be improved?) or request a change…"
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
              <button
                type="button"
                className="btn w-full gap-2 rounded-xl border-0 bg-gradient-to-r from-violet-600 to-indigo-600 font-semibold text-white shadow-md hover:from-violet-700 hover:to-indigo-700 disabled:opacity-60 max-md:min-h-12"
                onClick={onApplyRemarks}
                disabled={isApplying || !remarks.trim()}
              >
                {isApplying ? (
                  <span className="loading loading-spinner loading-sm" />
                ) : (
                  <PaperAirplaneIcon className="h-4 w-4" />
                )}
                Send
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
                <p className="whitespace-pre-wrap text-sm text-gray-800">{initialSummary}</p>
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
              <div className="contract-ai-bubble-assistant max-w-[85%] rounded-2xl px-5 py-4 opacity-80 shadow-sm">
                <div className="flex items-center gap-2 text-sm italic text-gray-500">
                  <span className="loading loading-spinner loading-sm" />
                  <span>Thinking…</span>
                </div>
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
