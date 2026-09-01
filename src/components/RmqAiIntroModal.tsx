import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  CalendarDaysIcon,
  ChatBubbleLeftRightIcon,
  EnvelopeIcon,
  MicrophoneIcon,
  SparklesIcon,
  UserIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { RmqAiLogo, RMQ_AI_HEADER_LOGO_SRC } from './RmqAiLogo';

type RmqAiIntroModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onTry?: () => void;
  isDarkTheme?: boolean;
  isMobile?: boolean;
};

const FEATURES = [
  {
    title: 'Knows the open client',
    body: 'On a lead page, RMQ AI already has that client in context. Ask about stage, notes, or next steps without repeating the name.',
    Icon: UserIcon,
  },
  {
    title: 'Meetings & calendar',
    body: 'See today’s meetings, the next one on a file, and a short prep brief before you join.',
    Icon: CalendarDaysIcon,
  },
  {
    title: 'Draft follow-ups',
    body: 'Get a ready-to-send email or WhatsApp in the client’s language, then open it in compose.',
    Icon: EnvelopeIcon,
  },
  {
    title: 'Your sales day',
    body: 'Who hasn’t answered, what signed today, and what still needs a follow-up.',
    Icon: ChatBubbleLeftRightIcon,
  },
  {
    title: 'Voice',
    body: 'Tap the mic and speak. RMQ AI turns it into a question or a draft.',
    Icon: MicrophoneIcon,
  },
  {
    title: 'CRM actions',
    body: 'Look up leads, create a lead or meeting, and keep chat history for later.',
    Icon: SparklesIcon,
  },
] as const;

const RmqAiIntroModal: React.FC<RmqAiIntroModalProps> = ({
  isOpen,
  onClose,
  onTry,
  isDarkTheme = false,
  isMobile = false,
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen, onClose]);

  if (!isOpen || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={`fixed inset-0 z-[10080] flex backdrop-blur-sm ${
        isMobile ? 'items-end justify-center' : 'items-center justify-center p-4'
      } ${isDarkTheme ? 'bg-black/65' : 'bg-black/50'}`}
      onClick={onClose}
    >
      {isMobile ? (
        <style>{`
          @keyframes rmq-ai-intro-sheet-in {
            from { transform: translateY(100%); }
            to { transform: translateY(0); }
          }
        `}</style>
      ) : null}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="rmq-ai-intro-title"
        className={`relative overflow-y-auto shadow-2xl ${
          isMobile
            ? 'w-full max-h-[92dvh] rounded-t-3xl pb-[max(1rem,env(safe-area-inset-bottom))]'
            : 'max-h-[min(36rem,calc(100vh-2rem))] w-full max-w-lg rounded-2xl'
        } ${isDarkTheme ? 'bg-[#1c1e22] text-[#f0f0f2]' : 'bg-white text-gray-900'}`}
        style={isMobile ? { animation: 'rmq-ai-intro-sheet-in 340ms cubic-bezier(0.32, 0.72, 0, 1) both' } : undefined}
        onClick={(event) => event.stopPropagation()}
      >
        {isMobile ? (
          <div className="flex justify-center pt-2.5 pb-1" aria-hidden>
            <span
              className={`h-1 w-10 rounded-full ${isDarkTheme ? 'bg-[#5c5f66]' : 'bg-gray-300'}`}
            />
          </div>
        ) : null}
        <button
          type="button"
          className={`btn btn-ghost btn-circle btn-sm absolute right-3 z-10 ${
            isMobile ? 'top-3.5' : 'top-3'
          } ${isDarkTheme ? 'text-zinc-300 hover:bg-[#2a2c32]' : ''}`}
          onClick={onClose}
          aria-label="Close"
        >
          <XMarkIcon className="h-5 w-5" />
        </button>

        <div className={`flex flex-col items-center px-6 pb-4 text-center ${isMobile ? 'pt-4' : 'pt-8'}`}>
          <RmqAiLogo src={RMQ_AI_HEADER_LOGO_SRC} className="h-20 w-20" />
          <div className="mt-3 flex items-center justify-center gap-2">
            <h2
              id="rmq-ai-intro-title"
              className={`text-2xl font-bold tracking-tight ${isDarkTheme ? 'text-[#f0f0f2]' : 'text-gray-900'}`}
            >
              RMQ AI
            </h2>
            <span
              className={`inline-flex h-6 items-center rounded-full px-2.5 text-xs font-bold uppercase leading-none tracking-wide ${
                isDarkTheme ? 'bg-[#3a3d45] text-[#c4b5fd]' : 'bg-gray-100 text-[#3b28c7]'
              }`}
            >
              Beta
            </span>
          </div>
          <p
            className={`mt-2 max-w-sm text-sm leading-relaxed ${
              isDarkTheme ? 'text-[#9a9da6]' : 'text-gray-600'
            }`}
          >
            Your in-app assistant for leads, meetings, and follow-ups. Ask in plain language and it
            looks up CRM data instead of sending you hunting through tabs.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-2.5 px-5 sm:grid-cols-2">
          {FEATURES.map(({ title, body, Icon }) => (
            <div
              key={title}
              className={`flex flex-col rounded-xl p-3 text-left ${
                isDarkTheme ? 'bg-[#26282e]' : 'bg-gray-50'
              }`}
            >
              <div className="flex items-center gap-3">
                <span
                  className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${
                    isDarkTheme ? 'bg-[#3a3d45] text-[#c4b5fd]' : 'bg-gray-100 text-[#3b28c7]'
                  }`}
                >
                  <Icon className="h-6 w-6" />
                </span>
                <p
                  className={`min-w-0 text-sm font-semibold ${
                    isDarkTheme ? 'text-[#f0f0f2]' : 'text-gray-900'
                  }`}
                >
                  {title}
                </p>
              </div>
              <p
                className={`mt-2 text-xs leading-relaxed ${
                  isDarkTheme ? 'text-[#9a9da6]' : 'text-gray-600'
                }`}
              >
                {body}
              </p>
            </div>
          ))}
        </div>

        <div
          className={`mx-5 mt-4 overflow-hidden rounded-xl text-left ${
            isDarkTheme ? 'bg-[#2a2438]' : 'bg-violet-50'
          }`}
        >
          <div
            className={`relative aspect-[16/9] w-full overflow-hidden ${
              isDarkTheme
                ? 'bg-gradient-to-r from-[#3b2a55] via-[#2a2438] to-[#1e3a4c]'
                : 'bg-gradient-to-r from-[#e9d5ff] via-[#ede9fe] to-[#bae6fd]'
            }`}
          >
            <img
              src="/rmq-ai-beta-banner.jpg"
              alt=""
              className="h-full w-full object-contain object-center"
            />
          </div>
          <div className="px-4 pb-3.5 pt-1">
            <p
              className={`text-sm font-semibold ${
                isDarkTheme ? 'text-[#c4b5fd]' : 'text-[#3b28c7]'
              }`}
            >
              Beta — feedback needed
            </p>
            <p
              className={`mt-1 text-xs leading-relaxed ${
                isDarkTheme ? 'text-[#c4b5fd]/80' : 'text-violet-900/80'
              }`}
            >
              This is an early version. Answers can miss or need a check. Please tell us what worked,
              what felt wrong, and what you still want it to do.
            </p>
          </div>
        </div>

        <div className="flex gap-3 px-5 py-5">
          <button
            type="button"
            className={`btn btn-ghost flex-1 border-0 ${isDarkTheme ? 'text-[#f0f0f2] hover:bg-[#2a2c32]' : ''}`}
            onClick={onClose}
          >
            Close
          </button>
          {typeof onTry === 'function' ? (
            <button
              type="button"
              className="btn flex-1 rounded-full border-0 text-white"
              style={{ backgroundColor: '#3b28c7' }}
              onClick={() => {
                onClose();
                onTry();
              }}
            >
              Try RMQ AI
            </button>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  );
};

export default RmqAiIntroModal;
