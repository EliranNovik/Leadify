import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { XMarkIcon, PaperAirplaneIcon, MagnifyingGlassIcon, ClockIcon, ChatBubbleLeftRightIcon, HandThumbDownIcon as HandThumbDownSolid, HandThumbUpIcon as HandThumbUpSolid } from '@heroicons/react/24/solid';
import { AcademicCapIcon, ArrowDownTrayIcon, ArrowPathIcon, CalendarDaysIcon, ChatBubbleLeftRightIcon as ChatOutlineIcon, CheckIcon, ClockIcon as ClockOutlineIcon, DocumentCheckIcon, DocumentTextIcon, EllipsisHorizontalIcon, EnvelopeIcon, HandThumbDownIcon, HandThumbUpIcon, LinkIcon, MicrophoneIcon, MoonIcon, PencilSquareIcon, PlusIcon, SparklesIcon, Square2StackIcon, SunIcon, TrashIcon } from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';
import { toast } from 'react-hot-toast';
import { RmqAiLogo, RMQ_AI_HEADER_LOGO_SRC } from './RmqAiLogo';
import RmqAiIntroModal from './RmqAiIntroModal';
import { executeRmqAiTool, RMQ_AI_SYSTEM_PROMPT, RMQ_AI_TOOLS } from '../lib/rmqAiChatTools';
import { streamRmqAiChat } from '../lib/rmqAiChatStream';
import { executeGetClientPortalAccess, parsePortalLinkFromToolResult } from '../lib/rmqAiPortalTools';
import {
  isThinkingContent,
  labelForTool,
  thinkingContent,
  thinkingLabelFromContent,
  thinkingPlanForAsk,
} from '../lib/rmqAiThinking';
import { beginRmqAiTurn } from '../lib/rmqAiRoutingLog';
import {
  beginAiTrace,
  buildLeadSignals,
  buildRmqAiSystemPrompt,
  classifyAnswerability,
  detectPossibleUserCorrection,
  detectQualityEvents,
  evidenceFromTools,
  filterToolsForRole,
  finishAiTrace,
  forgetUserMemory,
  inferFailureOrigin,
  ingestKnowledgeText,
  backfillMissingChatSummaries,
  isFirmWideLesson,
  isForgetMemoryRequest,
  isPreferenceCorrection,
  persistAnswerEvidence,
  persistFeedback,
  persistIncident,
  persistQualityEvents,
  persistRecommendation,
  persistStructuredChatSummary,
  formatChatHistoryPreview,
  proposeFirmLesson,
  recordRecommendationOutcome,
  resolveRmqAiRolePack,
  shouldRefreshChatSummary,
  subjectChanged,
  upsertUserMemory,
  type ChatSummary,
} from '../lib/rmqAiV1';
import {
  hydrateRmqAiRoleNames,
  getRmqAiCurrentLead,
  leadNumberFromClientsPath,
  setRmqAiCurrentLead,
  slimRmqAiCurrentLead,
  takeRmqAiDraftMeta,
  type RmqAiCurrentLead,
  type RmqAiDraftMeta,
} from '../lib/rmqAiChatContext';
import { stashRmqAiComposeDraft } from '../lib/rmqAiComposeDraft';
import { RMQ_AI_DASHBOARD_ASKS, RMQ_AI_OPEN_EVENT, takeRmqAiPendingPrompt } from '../lib/rmqAiPendingPrompt';
import { stripAiEmailSignature } from '../lib/emailComposeAiChat';
import {
  applyCrmDocumentLinksToEmailDraft,
  parseFollowupDocumentLinks,
  type FollowupDocumentLinks,
} from '../lib/leadFollowupAiApi';
import { fetchLeadContractPublicLink } from '../lib/leadContractLink';
import { fetchLeadPoaPublicLink } from '../lib/poaApi';
import { parseChatLeadNumber } from './ChatLeadNumberText';
import { loadChatEmployeeDirectory, type ChatEmployeeHit } from './ChatEmployeeNameText';
import { ChatStageBadgeText, buildChatStageHits, loadChatStageHits, type ChatStageHit } from './ChatStageBadgeText';
import {
  ChatCalendarMeetingCards,
  ChatEmployeePresenceTable,
  ChatExpensesTable,
  ChatLeadSummaryCards,
  ChatMeetingCards,
  ChatMissedCommsTable,
  ChatPaidPaymentsTable,
  ChatRisksBox,
  ChatSignedContractsTable,
  parseCalendarDayCards,
  parseClientMeetingCard,
  parseEmployeePresenceCard,
  parseExpensesCard,
  parseLeadSummaryCard,
  parseMissedCommsCard,
  parsePaidPaymentsCard,
  parseSignedContractsCard,
  splitLeadSummaryParts,
  type ChatCalendarDayData,
  type ChatEmployeePresenceData,
  type ChatExpensesData,
  type ChatLeadSummaryData,
  type ChatMeetingCardData,
  type ChatMissedCommsData,
  type ChatPaidPaymentsData,
  type ChatSignedContractsData,
  LEAD_SUMMARY_ROLES,
} from './ChatMeetingCard';
import { ChatWebSources } from './ChatWebSources';
import { parseWebSearchCard, type WebSearchCardData } from '../lib/rmqAiWebSearch';
import { resolveLeadShareClientRoute } from '../lib/calendarClientRoute';
import { formatChatCurrencyText } from '../lib/leadCurrencyDisplay';
import {
  applyAiInputSuggestion,
  extractConversationHints,
  ghostSuffixFor,
  loadAutocompleteEmployeeNames,
  scoreRmqAiInputSuggestions,
  type AiInputSuggestion,
} from '../lib/rmqAiInputAutocomplete';
import { isInternalAppPath } from '../lib/crmAppMap';
import {
  isRmqExcelHref,
  rememberRmqAiFile,
  resolveRmqExcelFile,
  takeRmqAiToolFiles,
  triggerBrowserDownload,
  type RmqAiChatFile,
} from '../lib/rmqAiExcel';
import { transcribeMeetingSummaryAudio } from '../lib/meetingSummaryNotesApi';
import { useLiveSpeechRecognition } from '../lib/useLiveSpeechRecognition';
import {
  useMeetingSummaryVoiceRecorder,
  voiceBlobToBase64,
  type VoiceRecordingResult,
} from '../lib/useMeetingSummaryVoiceRecorder';

interface AIChatWindowProps {
  isOpen: boolean;
  onClose: () => void;
  onClientUpdate?: () => void;
  userName?: string;
  isFullPage?: boolean;
  onToggleFullPage?: () => void;
  currentLead?: RmqAiCurrentLead | null;
  onOpenEmailCompose?: () => void;
  onOpenWhatsAppCompose?: () => void;
}

interface Message {
  id?: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: any[];
  tool_call_id?: string;
  attachments?: RmqAiChatFile[];
  draftAction?: RmqAiDraftMeta;
  meetingCard?: ChatMeetingCardData;
  calendarMeetings?: ChatCalendarDayData;
  signedContracts?: ChatSignedContractsData;
  paidPayments?: ChatPaidPaymentsData;
  missedComms?: ChatMissedCommsData;
  expenses?: ChatExpensesData;
  employeePresence?: ChatEmployeePresenceData;
  leadSummary?: ChatLeadSummaryData;
  webSources?: WebSearchCardData;
  researchRating?: 'useful' | 'wrong';
  researchSaved?: boolean;
  promptContent?: string;
  aiTraceId?: string;
  feedback?: 'up' | 'down';
  streaming?: boolean;
}

interface ChatHistory {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  summary?: string;
  tags: string[];
}

function PlusMenuImagesIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <rect x="7" y="3.25" width="13.25" height="10.5" rx="2.4" fill="#7dd3fc" />
      <rect x="3.5" y="6.75" width="14.25" height="13.5" rx="2.6" fill="#38bdf8" />
      <path
        d="M3.5 16.6 7.9 12.8a1.45 1.45 0 011.95.05l2.85 2.5 1.85-1.65a1.35 1.35 0 011.8.1L17.75 16.7v1A2.6 2.6 0 0115.15 20.25H6.1A2.6 2.6 0 013.5 17.65v-1.05z"
        fill="#0284c7"
      />
      <circle cx="7.35" cy="11.05" r="1.45" fill="#fde047" />
    </svg>
  );
}

function PlusMenuDocumentsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path
        d="M4 8.4c0-1.05.85-1.9 1.9-1.9h4.05c.42 0 .82.17 1.1.47l.85.9h6.2c1.05 0 1.9.85 1.9 1.9v1.35H4V8.4z"
        fill="#93c5fd"
      />
      <path
        d="M4 10.85h16v6.85c0 1.16-.94 2.1-2.1 2.1H6.1A2.1 2.1 0 014 17.7v-6.85z"
        fill="#3b82f6"
      />
    </svg>
  );
}

const READY_ASKS = [
  {
    label: 'My day',
    hint: 'Meetings, follow-ups, waiting on you',
    prompt:
      'Show my sales day. Call list_my_sales_day. List my meetings today/tomorrow, overdue and today follow-ups, and my leads in stages 21, 40, and 50. Number each item with a lead number and the next action.',
    Icon: CalendarDaysIcon,
  },
  {
    label: 'Next meeting',
    hint: 'This client’s upcoming meeting + brief',
    prompt:
      'What is the next meeting scheduled for this client? Call list_client_meetings. Give the next upcoming date, time, location, and quote summary, brief, and caseBrief from the tool.',
    Icon: CalendarDaysIcon,
  },
  {
    label: 'Prep next meeting',
    hint: 'Brief, facts, last comms',
    prompt: 'Prep my next meeting. Call prep_meeting. Give time, who they are, stage, last comms, and 3 questions.',
    Icon: DocumentCheckIcon,
  },
  {
    label: 'Draft follow-up',
    hint: 'Detailed email or WhatsApp from the case file',
    prompt:
      'Draft a detailed professional follow-up for this client. Call draft_client_message with intent follow_up. Read the full case file (meetings, last messages, contracts, payments, next steps) and write 4–7 short paragraphs in the client language — not a short check-in. Reply with only the ready-to-send draft. Stop after Best regards / בברכה. Do not add a signature.',
    Icon: EnvelopeIcon,
  },
  {
    label: "Who hasn't answered",
    hint: 'Stale deals to chase',
    prompt:
      'Who has not answered me? Call list_stale_sales_leads. List lead numbers, last touch, and one chase action each.',
    Icon: ChatOutlineIcon,
  },
  {
    label: 'After no-show',
    hint: 'What to say',
    prompt:
      'Draft a detailed professional no-show follow-up for this client. Call draft_client_message with intent no_show. Use the case file and write 4–7 short paragraphs in the client language. Reply with only the draft. Stop after Best regards / בברכה. Do not add a signature.',
    Icon: ClockOutlineIcon,
  },
  {
    label: 'Signed today',
    hint: 'Closed deals from today',
    prompt: 'Show signed contracts today. Call list_signed_contracts. Reply with one short sentence only — the UI shows the table.',
    Icon: DocumentCheckIcon,
  },
  {
    label: 'Meetings today',
    hint: 'Your meetings as manager, helper, guest, or participant',
    prompt:
      'List my meetings today. Call list_calendar_day with scope=mine. For each meeting use two lines: first time + lead number + name; second Meeting manager, Helper, Guests, Participants. Only include meetings where I am meeting manager, helper, guest, or a participant.',
    Icon: CalendarDaysIcon,
  },
] as const;

type WelcomeAction = {
  label: string;
  hint: string;
  prompt: string;
  Icon: typeof CalendarDaysIcon;
};

const WELCOME_LEAD_ACTIONS: WelcomeAction[] = [
  {
    label: 'Next meeting',
    hint: "What's coming up?",
    prompt:
      'What is the next meeting scheduled for this client? Call list_client_meetings. Give the next upcoming date, time, location, and quote summary, brief, and caseBrief from the tool.',
    Icon: CalendarDaysIcon,
  },
  {
    label: 'Lead summary',
    hint: 'Overview of this lead',
    prompt:
      'Create a summary of this lead. Call get_lead_case_file. Start with CASE ABOUT: a full paragraph of 5 to 8 sentences in plain text (no bullets) covering what the case is, what the client is inquiring about, the family or eligibility story, and the important points from emails, WhatsApp, calls, and notes. That paragraph must come first and must not be short. Then a short status summary as bullet points (- ) covering eligibility, value, meetings, last communication, follow-up. Then a line Risks: … with no bullet. Never skip CASE ABOUT or Risks. Do not list lead number, name, category, topic, stage, or team. Do not mention unsigned contract. Do not greet.',
    Icon: DocumentTextIcon,
  },
  {
    label: 'Last communication',
    hint: 'See recent messages',
    prompt:
      'Show the last communication with this client. Use CRM tools. Include channel, date, and a short snippet. Be concise. Do not greet.',
    Icon: ChatOutlineIcon,
  },
  {
    label: 'Draft follow-up',
    hint: 'Create a detailed message',
    prompt:
      'Draft a detailed professional follow-up for this client. Call draft_client_message with intent follow_up. Read the full case file (meetings, last messages, contracts, payments, next steps) and write 4–7 short paragraphs in the client language — not a short check-in. Reply with only the ready-to-send draft. Stop after Best regards / בברכה. Do not add a signature.',
    Icon: PencilSquareIcon,
  },
];

const WELCOME_GENERAL_ACTIONS: WelcomeAction[] = [
  {
    label: 'My day',
    hint: 'Meetings, follow-ups, waiting on you',
    prompt:
      'Show my sales day. Call list_my_sales_day. List my meetings today/tomorrow, overdue and today follow-ups, and my leads in stages 21, 40, and 50. Number each item with a lead number and the next action.',
    Icon: CalendarDaysIcon,
  },
  {
    label: 'Meetings today',
    hint: "What's on my calendar?",
    prompt:
      'List my meetings today. Call list_calendar_day with scope=mine. For each meeting use two lines: first time + lead number + name; second Meeting manager, Helper, Guests, Participants. Only include meetings where I am meeting manager, helper, guest, or a participant.',
    Icon: CalendarDaysIcon,
  },
  {
    label: "Who hasn't answered",
    hint: 'Stale deals to chase',
    prompt:
      'Who has not answered me? Call list_stale_sales_leads. List lead numbers, last touch, and one chase action each.',
    Icon: ChatOutlineIcon,
  },
  {
    label: 'Signed today',
    hint: 'Closed deals from today',
    prompt: 'Show signed contracts today. Call list_signed_contracts. Reply with one short sentence only — the UI shows the table.',
    Icon: DocumentCheckIcon,
  },
];

const WELCOME_LEAD_QUESTIONS = [
  'When is the next meeting with this lead?',
  "What's the status of the contract?",
  'Show me the last email we sent.',
];

const WELCOME_GENERAL_QUESTIONS = [...RMQ_AI_DASHBOARD_ASKS];

const CANNED_ASK_LABELS = new Map<string, string>(
  [
    ...READY_ASKS,
    ...WELCOME_LEAD_ACTIONS,
    ...WELCOME_GENERAL_ACTIONS,
    { label: 'Draft reminder', prompt: 'Draft a concise contract-signature reminder for this client.' },
    { label: 'Open client', prompt: 'Give me the contract and signing status for this client.' },
    { label: 'Draft follow-up', prompt: 'Draft a detailed professional follow-up for this client.' },
    { label: 'Wrap up meeting', prompt: 'Wrap up the latest meeting for this client.' },
    { label: 'Draft reply', prompt: 'Draft a reply to the latest client message.' },
    { label: 'Set new follow-up', prompt: 'Suggest a follow-up date and next action for this client.' },
    { label: 'Show roles', prompt: 'Who is the handler, expert, and closer on this client?' },
  ].map((row) => [row.prompt.trim(), row.label]),
);

function shortAskLabel(text: string): string | null {
  const key = String(text || '').trim();
  return key ? CANNED_ASK_LABELS.get(key) || null : null;
}

const AI_DRAWER_THEME_KEY = 'rmqAiDrawerTheme';
const AI_DRAWER_POS_KEY = 'rmqAiDrawerPos';
const AI_DRAWER_SIZE_KEY = 'rmqAiDrawerSize';
const PANEL_DRAG_THRESHOLD_PX = 6;
const PANEL_EDGE_MARGIN = 12;
const MIN_PANEL_WIDTH = 380;
const MIN_PANEL_HEIGHT = 420;
const HISTORY_SIDEBAR_WIDTH_MD = 384;
const HISTORY_SIDEBAR_WIDTH_SM = 288;
const VOICE_METER_BAR_COUNT = 42;

const voiceMeterBarHeight = (index: number, level: number): string => {
  const t = index / Math.max(1, VOICE_METER_BAR_COUNT - 1);
  const envelope = Math.pow(Math.sin(Math.PI * t), 2.6);
  const ripple = 0.62 + 0.38 * Math.abs(Math.sin(index * 0.9 + level * 10.5));
  const idle = 0.05 + 0.07 * envelope;
  const spoken = idle + (0.1 + level * 0.85) * envelope * ripple;
  return `${Math.round(Math.min(1, spoken) * 100)}%`;
};

type PanelPos = { left: number; top: number };
type PanelSize = { width: number; height: number };

const readSavedPanelPos = (): PanelPos | null => {
  try {
    const raw = localStorage.getItem(AI_DRAWER_POS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PanelPos>;
    if (typeof parsed?.left === 'number' && typeof parsed?.top === 'number') {
      return { left: parsed.left, top: parsed.top };
    }
  } catch {
    /* ignore */
  }
  return null;
};

const persistPanelPos = (pos: PanelPos) => {
  try {
    localStorage.setItem(AI_DRAWER_POS_KEY, JSON.stringify(pos));
  } catch {
    /* ignore */
  }
};

const readSavedPanelSize = (): PanelSize | null => {
  try {
    const raw = localStorage.getItem(AI_DRAWER_SIZE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PanelSize>;
    if (typeof parsed?.width === 'number' && typeof parsed?.height === 'number') {
      return { width: parsed.width, height: parsed.height };
    }
  } catch {
    /* ignore */
  }
  return null;
};

const persistPanelSize = (size: PanelSize) => {
  try {
    localStorage.setItem(AI_DRAWER_SIZE_KEY, JSON.stringify(size));
  } catch {
    /* ignore */
  }
};

const clampPanelSize = (size: PanelSize): PanelSize => {
  const maxWidth = Math.max(MIN_PANEL_WIDTH, window.innerWidth - PANEL_EDGE_MARGIN * 2);
  const maxHeight = Math.max(MIN_PANEL_HEIGHT, window.innerHeight - PANEL_EDGE_MARGIN * 2);
  return {
    width: Math.min(Math.max(MIN_PANEL_WIDTH, size.width), maxWidth),
    height: Math.min(Math.max(MIN_PANEL_HEIGHT, size.height), maxHeight),
  };
};

const clampPanelPos = (pos: PanelPos, width: number, height: number): PanelPos => {
  const minVisibleX = 80;
  const minVisibleY = 48;
  const maxLeft = Math.max(PANEL_EDGE_MARGIN, window.innerWidth - minVisibleX);
  const maxTop = Math.max(PANEL_EDGE_MARGIN, window.innerHeight - minVisibleY);
  return {
    left: Math.min(Math.max(PANEL_EDGE_MARGIN - Math.max(0, width - minVisibleX), pos.left), maxLeft),
    top: Math.min(Math.max(PANEL_EDGE_MARGIN, pos.top), maxTop),
  };
};

const AI_CHROME_DARK = '#121316';
const AI_CHROME_LIGHT = '#f9fafb';

const readAiDrawerDark = (): boolean => {
  try {
    const stored = localStorage.getItem(AI_DRAWER_THEME_KEY);
    if (stored === 'light') return false;
    if (stored === 'dark') return true;
  } catch {
    /* ignore */
  }
  return true;
};

const isThinkingMessage = (content: Message['content']) => isThinkingContent(content);

function ChatThinkingIndicator({ label }: { label: string }) {
  return (
    <div className="ai-thinking" role="status" aria-live="polite">
      <span className="ai-thinking-ring" aria-hidden />
      <span className="ai-thinking-dots" aria-hidden>
        <span />
        <span />
        <span />
      </span>
      <span className="ai-thinking-label" key={label}>
        {label}
      </span>
    </div>
  );
}

function ChatWelcomeHome({
  hasLead,
  disabled,
  onAction,
  signals = [],
}: {
  hasLead: boolean;
  disabled?: boolean;
  onAction: (prompt: string, label?: string) => void;
  signals?: Array<{ id: string; title: string; reason: string; actions: Array<{ label: string; prompt: string }> }>;
}) {
  const actions = hasLead ? WELCOME_LEAD_ACTIONS : WELCOME_GENERAL_ACTIONS;
  const questions = hasLead ? WELCOME_LEAD_QUESTIONS : WELCOME_GENERAL_QUESTIONS;
  return (
    <div className="ai-welcome-home mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center px-1 py-6">
      <div className="ai-welcome-orb mb-5 max-md:mb-6">
        <RmqAiLogo className="h-[5.25rem] w-[5.25rem] max-md:h-[6.25rem] max-md:w-[6.25rem]" />
      </div>
      <h2 className="ai-welcome-title text-center text-2xl font-bold tracking-tight max-md:text-[1.85rem]">
        {hasLead ? 'How can I help with this lead?' : 'How can I help you?'}
      </h2>
      <p className="ai-welcome-sub mt-2 max-w-md text-center text-sm max-md:mt-2.5 max-md:text-base">
        {hasLead
          ? 'Ask about meetings, follow-ups, contracts or communication.'
          : 'Ask about your day, meetings, follow-ups or signed deals.'}
      </p>
      {signals.length > 0 ? (
        <div className="mt-4 w-full space-y-2">
          {signals.map((signal) => (
            <div key={signal.id} className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-left">
              <p className="text-sm font-semibold text-amber-900">{signal.title}</p>
              <p className="mt-0.5 text-xs text-amber-800">{signal.reason}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {signal.actions.map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-amber-900 ring-1 ring-amber-200"
                    disabled={disabled}
                    onClick={() => onAction(action.prompt, action.label)}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <div className="mt-7 grid w-full grid-cols-1 gap-2.5 sm:grid-cols-2">
        {actions.map(({ label, hint, prompt, Icon }) => (
          <button
            key={label}
            type="button"
            className="ai-welcome-card"
            disabled={disabled}
            onClick={() => onAction(prompt, label)}
          >
            <span className="ai-welcome-card-icon">
              <Icon className="h-6 w-6 max-md:h-7 max-md:w-7" />
            </span>
            <span className="min-w-0 text-left leading-snug">
              <span className="ai-welcome-card-title block text-sm font-semibold max-md:text-base">{label}</span>
              <span className="ai-welcome-card-hint mt-0.5 block text-xs max-md:text-sm">{hint}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="ai-welcome-divider mt-8 w-full">
        <span>Suggested questions</span>
      </div>
      <div className="mt-4 flex w-full flex-wrap items-center justify-center gap-2">
        {questions.map((question) => (
          <button
            key={question}
            type="button"
            className="ai-welcome-ask"
            disabled={disabled}
            onClick={() => onAction(question)}
          >
            <SparklesIcon className="h-5 w-5 shrink-0 max-md:h-6 max-md:w-6" />
            {question}
          </button>
        ))}
      </div>
    </div>
  );
}

const isWelcomeMessage = (message: Message) =>
  /^(Hi .+?, |Hello! )how can I help you\?/i.test(plainTextFromMessage(message));

const looksLikeEmailDraft = (text: string) =>
  /^(Subject|נושא)\s*:/im.test(String(text || '').trim());

const textIsMostlyHebrew = (text: string): boolean => {
  const hebrew = (text.match(/[\u0590-\u05FF]/g) || []).length;
  if (!hebrew) return false;
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  return hebrew >= latin;
};

const combineLiveTranscript = (baseDraft: string, finalText: string, interimText: string): string => {
  const spoken = [finalText.trim(), interimText.trim()].filter(Boolean).join(' ').trim();
  if (!spoken) return baseDraft;
  if (!baseDraft.trim()) return spoken;
  return `${baseDraft.trim()}\n\n${spoken}`;
};

const chatSpeechLang = (leadLanguage?: string | null, sampleText = ''): 'he-IL' | 'en-US' => {
  const blob = `${leadLanguage || ''} ${sampleText}`.toLowerCase();
  if (textIsMostlyHebrew(sampleText) || /hebrew|עבר|\bhe\b/.test(blob)) return 'he-IL';
  if (/\benglish\b|\ben\b/.test(blob)) return 'en-US';
  if (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('he')) return 'he-IL';
  return 'he-IL';
};

const plainTextFromMessage = (message: Message): string => {
  if (Array.isArray(message.content)) {
    return message.content
      .filter((item: { type?: string; text?: string }) => item?.type === 'text' && item.text)
      .map((item: { text?: string }) => String(item.text || ''))
      .join('\n')
      .trim();
  }
  return String(message.content || '').trim();
};

const isVisibleChatMessage = (message: Message) => {
  if (message.role === 'tool') return false;
  if (message.role === 'assistant' && message.tool_calls?.length && !message.content) return false;
  return true;
};

function isLeadSummaryAsk(text: string): boolean {
  const t = String(text || '').toLowerCase();
  if (/meeting summary|communication summary|last communication/.test(t)) return false;
  return (
    /\boverview\b/.test(t) ||
    /\blead summary\b/.test(t) ||
    /\bgeneral summary\b/.test(t) ||
    /\bcase summary\b/.test(t) ||
    /create a summary/.test(t) ||
    /summar(?:y|ise|ize).{0,40}\b(lead|client|case)\b/.test(t) ||
    /\b(lead|client).{0,40}summar(?:y|ise|ize)\b/.test(t) ||
    /\bwhat (?:is|'s|was) (?:this|the) (?:lead|case) about\b/.test(t) ||
    /\bwhat (?:is|'s) this about\b/.test(t)
  );
}

function calendarDayIntro(text: string): string {
  const trimmed = String(text || '').trim();
  if (!trimmed) return '';
  const first = trimmed.split(/\n+/)[0].trim();
  if (/^\d+\.\s/.test(first) || /^\*\*\d{1,2}:\d{2}/.test(first)) return '';
  return first;
}

const sanitizeMessages = (messages: Message[]) => {
  const sanitized: Message[] = [];
  if (!messages || messages.length === 0) return [];

  for (const message of messages) {
    if (isThinkingContent(message.content)) {
      continue;
    }
    if (message.role === 'assistant' && !message.content && !message.tool_calls?.length) {
      continue;
    }

    const lastMessage = sanitized.length > 0 ? sanitized[sanitized.length - 1] : null;
    const canCollapse =
      lastMessage &&
      lastMessage.role === message.role &&
      message.role !== 'tool' &&
      !lastMessage.tool_calls?.length &&
      !message.tool_calls?.length;

    if (canCollapse) {
      sanitized[sanitized.length - 1] = message;
    } else {
      sanitized.push(message);
    }
  }
  return sanitized;
};

const AIChatWindow: React.FC<AIChatWindowProps> = ({ isOpen, onClose, onClientUpdate, userName, isFullPage = false, onToggleFullPage, currentLead = null, onOpenEmailCompose }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [caret, setCaret] = useState(0);
  const [employeeNames, setEmployeeNames] = useState<string[]>([]);
  const [chatEmployees, setChatEmployees] = useState<ChatEmployeeHit[]>([]);
  const [chatStages, setChatStages] = useState<ChatStageHit[]>(() => buildChatStageHits());
  const [suggestDismissed, setSuggestDismissed] = useState(false);
  const [images, setImages] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const teachFileInputRef = useRef<HTMLInputElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const plusMenuRef = useRef<HTMLDivElement>(null);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const [aiIconAnim, setAiIconAnim] = useState(false);
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth <= 768 : false
  );
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  
  // Chat history state
  const [chatHistory, setChatHistory] = useState<ChatHistory[]>([]);
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const [showRmqAiIntroModal, setShowRmqAiIntroModal] = useState(false);
  const [historySearchTerm, setHistorySearchTerm] = useState('');
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [messageFeedback, setMessageFeedback] = useState<Record<string, 'up' | 'down'>>({});
  const [thumbBurstAt, setThumbBurstAt] = useState<Record<string, number>>({});
  const lastSummarizedCountRef = useRef(0);
  const lastSummaryRef = useRef<ChatSummary | null>(null);
  const lastActivityAtRef = useRef(Date.now());
  const currentChatIdRef = useRef<string | null>(null);
  const messagesRef = useRef<Message[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historySelecting, setHistorySelecting] = useState(false);
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<string[]>([]);
  const [historyToolsOpen, setHistoryToolsOpen] = useState(false);
  const [isDarkTheme, setIsDarkTheme] = useState(readAiDrawerDark);
  const [panelPos, setPanelPos] = useState<PanelPos | null>(readSavedPanelPos);
  const [panelSize, setPanelSize] = useState<PanelSize | null>(readSavedPanelSize);
  const panelSizeRef = useRef(panelSize);
  panelSizeRef.current = panelSize;
  const historyBoostActiveRef = useRef(false);
  const sizeBeforeHistoryRef = useRef<PanelSize | null>(null);
  const [isMovingPanel, setIsMovingPanel] = useState(false);
  const [isResizingPanel, setIsResizingPanel] = useState(false);
  const [copiedBubbleKey, setCopiedBubbleKey] = useState<string | null>(null);
  const copiedBubbleTimerRef = useRef<number | null>(null);
  const [isVoiceBusy, setIsVoiceBusy] = useState(false);
  const voiceBaseInputRef = useRef('');
  const voiceFinishingRef = useRef(false);
  const liveSpeech = useLiveSpeechRecognition();
  const liveSpeechRef = useRef(liveSpeech);
  liveSpeechRef.current = liveSpeech;
  const finishVoiceRef = useRef<(payload: { recording?: VoiceRecordingResult | null; liveText: string }) => void>(
    () => {},
  );
  const {
    isSupported: voiceRecordingSupported,
    isRecording: isVoiceRecording,
    audioLevel: voiceAudioLevel,
    start: startVoiceRecording,
    stop: stopVoiceRecording,
    cancel: cancelVoiceRecording,
  } = useMeetingSummaryVoiceRecorder({
    onRecordingComplete: (result) => {
      const live = liveSpeechRef.current;
      const liveText = live.isListening ? live.stop() : '';
      finishVoiceRef.current({ recording: result, liveText });
    },
  });
  const { isSupported: liveSpeechSupported, isListening: isVoiceListening, start: startLiveSpeech, stop: stopLiveSpeech, cancel: cancelLiveSpeech } = liveSpeech;
  const isVoiceActive = isVoiceRecording || isVoiceListening || isVoiceBusy;
  const panelRef = useRef<HTMLDivElement>(null);
  const panelResizeRef = useRef<{
    pointerId: number;
    corner: 'nw' | 'ne' | 'se' | 'sw';
    startX: number;
    startY: number;
    origLeft: number;
    origTop: number;
    origWidth: number;
    origHeight: number;
  } | null>(null);
  const panelDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origLeft: number;
    origTop: number;
    moved: boolean;
    held: boolean;
    fromExpand: boolean;
  } | null>(null);
  const panelHoldTimerRef = useRef<number | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(AI_DRAWER_THEME_KEY, isDarkTheme ? 'dark' : 'light');
    } catch {
      /* ignore */
    }
  }, [isDarkTheme]);

  useEffect(() => {
    if (!isOpen || !isMobile) return;
    const html = document.documentElement;
    const body = document.body;
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    const color = isDarkTheme ? AI_CHROME_DARK : AI_CHROME_LIGHT;
    const cls = isDarkTheme ? 'rmq-ai-chat-dark' : 'rmq-ai-chat-light';
    const prevTheme = metaTheme?.getAttribute('content') ?? '#ffffff';
    const prevScheme = html.style.colorScheme;
    const prevHtmlBg = html.style.backgroundColor;
    const prevBodyBg = body.style.backgroundColor;

    html.classList.remove('rmq-ai-chat-dark', 'rmq-ai-chat-light');
    html.classList.add(cls);
    html.style.colorScheme = isDarkTheme ? 'dark' : 'light';
    html.style.backgroundColor = color;
    body.style.backgroundColor = color;
    metaTheme?.setAttribute('content', color);

    return () => {
      html.classList.remove('rmq-ai-chat-dark', 'rmq-ai-chat-light');
      html.style.colorScheme = prevScheme;
      html.style.backgroundColor = prevHtmlBg;
      body.style.backgroundColor = prevBodyBg;
      metaTheme?.setAttribute('content', prevTheme);
    };
  }, [isOpen, isMobile, isDarkTheme]);

  useEffect(() => {
    if (isOpen) return;
    cancelLiveSpeech();
    cancelVoiceRecording();
    setIsVoiceBusy(false);
  }, [isOpen, cancelLiveSpeech, cancelVoiceRecording]);

  const syncOpenClient = useCallback(async () => {
    const slim = slimRmqAiCurrentLead(currentLead);
    if (slim) {
      const hydrated = await hydrateRmqAiRoleNames(slim);
      setRmqAiCurrentLead(hydrated);
      return hydrated;
    }
    const fromPath = leadNumberFromClientsPath(location.pathname, location.search);
    if (fromPath) {
      const fromUrl = { lead_number: fromPath };
      setRmqAiCurrentLead(fromUrl);
      return fromUrl;
    }
    setRmqAiCurrentLead(null);
    return null;
  }, [currentLead, location.pathname, location.search]);

  useEffect(() => {
    void syncOpenClient();
  }, [syncOpenClient, isOpen]);

  const openClientChip = slimRmqAiCurrentLead(currentLead)
    || (leadNumberFromClientsPath(location.pathname, location.search)
      ? { lead_number: leadNumberFromClientsPath(location.pathname, location.search) }
      : getRmqAiCurrentLead());
  const onClientPage = Boolean(leadNumberFromClientsPath(location.pathname, location.search));
  const showWelcomeHome =
    !isLoading && messages.filter(isVisibleChatMessage).every(isWelcomeMessage);
  
  const messagesEndRef = useRef<null | HTMLDivElement>(null);
  const latestAnswerRef = useRef<HTMLDivElement | null>(null);
  const pinnedVisibleCountRef = useRef(0);

  useEffect(() => {
    const visible = messages.filter((msg) => isVisibleChatMessage(msg) && !isWelcomeMessage(msg));
    if (visible.length <= pinnedVisibleCountRef.current) return;
    pinnedVisibleCountRef.current = visible.length;
    const last = visible[visible.length - 1];
    if (last?.role !== 'assistant') return;
    requestAnimationFrame(() => {
      latestAnswerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
    });
  }, [messages]);

  useEffect(() => {
    if (!attachMenuOpen) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (attachMenuRef.current?.contains(target) || plusMenuRef.current?.contains(target)) return;
      setAttachMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAttachMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [attachMenuOpen]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = '0px';
    const next = Math.min(Math.max(el.scrollHeight, 24), 160);
    el.style.height = `${next}px`;
  }, [input, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    void loadAutocompleteEmployeeNames().then((names) => {
      if (!cancelled) setEmployeeNames(names);
    });
    void loadChatEmployeeDirectory().then((employees) => {
      if (!cancelled) setChatEmployees(employees);
    });
    void loadChatStageHits().then((stages) => {
      if (!cancelled) setChatStages(stages);
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const conversationHints = useMemo(() => extractConversationHints(messages), [messages]);
  const lastAssistant = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (message.role !== 'assistant' || !message.content) continue;
      if (isThinkingContent(message.content)) continue;
      return typeof message.content === 'string' ? message.content : '';
    }
    return '';
  }, [messages]);
  const suggestions = useMemo(
    () =>
      scoreRmqAiInputSuggestions({
        input,
        caret,
        employees: employeeNames,
        conversationLeads: conversationHints.leads,
        conversationNames: conversationHints.names,
        historyTitles: chatHistory
          .map((chat) => chat.title)
          .filter((title) => title && title.length > 8 && !/^new conversation/i.test(title))
          .slice(0, 20),
        lastAssistant,
      }),
    [input, caret, employeeNames, conversationHints, chatHistory, lastAssistant],
  );
  const visibleSuggestions = suggestDismissed || attachMenuOpen ? [] : suggestions;
  const activeSuggestion =
    visibleSuggestions.find((item) => ghostSuffixFor(input, caret, item)) || null;
  const ghostSuffix = ghostSuffixFor(input, caret, activeSuggestion);
  const inputIsRtl = textIsMostlyHebrew(input);

  const applySuggestion = (suggestion: AiInputSuggestion) => {
    const currentCaret = textareaRef.current?.selectionStart ?? caret;
    const { next, caret: nextCaret } = applyAiInputSuggestion(input, currentCaret, suggestion);
    setInput(next);
    setCaret(nextCaret);
    setSuggestDismissed(false);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(nextCaret, nextCaret);
    });
  };
  
  // Mobile detection and keyboard handling
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    
    const handleResize = () => {
      checkMobile();
      // Reset keyboard state on resize
      setKeyboardOpen(false);
    };
    
    const handleVisualViewportChange = () => {
      if (isMobile) {
        const visualViewport = window.visualViewport;
        if (visualViewport) {
          const keyboardHeight = window.innerHeight - visualViewport.height;
          setKeyboardOpen(keyboardHeight > 150); // Consider keyboard open if height difference > 150px
        }
      }
    };
    
    checkMobile();
    window.addEventListener('resize', handleResize);
    
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleVisualViewportChange);
    }
    
    return () => {
      window.removeEventListener('resize', handleResize);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', handleVisualViewportChange);
      }
    };
  }, [isMobile]);
  
  useEffect(() => {
    if (isOpen && messages.length === 0) {
      const greeting = userName ? `Hi ${userName}, how can I help you?` : "Hello! How can I help you?";
      
      setMessages([{ 
        role: 'assistant', 
        content: greeting
      }]);
    }
  }, [isOpen, messages.length, userName]);

  // Quick action handlers
  const handleQuickAction = (action: string, label?: string) => {
    handleSend(action, { display: label || shortAskLabel(action) || undefined });
  };

  const insertClientPortalLink = async () => {
    const lead = currentLead || getRmqAiCurrentLead();
    const leadId = lead?.id != null ? String(lead.id) : '';
    if (!leadId) {
      toast.error('Open a client first to insert this link.');
      return;
    }
    const isLegacy = lead?.lead_type === 'legacy' || leadId.toLowerCase().startsWith('legacy_');
    setAttachMenuOpen(false);
    try {
      const result = await executeGetClientPortalAccess({
        lead_id: leadId,
        is_legacy: isLegacy,
        query: lead?.lead_number != null ? String(lead.lead_number) : undefined,
      });
      const url = parsePortalLinkFromToolResult(result);
      if (!url) {
        toast.error('Portal link is not available yet. Ask the AI to enable the client portal.');
        return;
      }
      setInput((prev) => {
        const trimmed = prev.trimEnd();
        return trimmed ? `${trimmed}\n${url}` : url;
      });
      requestAnimationFrame(() => textareaRef.current?.focus());
      if (/password_generated:\s*no/i.test(result) || /portal_enabled:\s*no/i.test(result)) {
        toast.success('Portal link added — password is not ready yet');
      } else {
        toast.success('Portal link added');
      }
    } catch (err) {
      console.error(err);
      toast.error('Failed to add the portal link.');
    }
  };

  const insertCrmDocumentLink = async (kind: 'contract' | 'poa') => {
    const lead = currentLead || getRmqAiCurrentLead();
    const leadId = lead?.id != null ? String(lead.id) : '';
    if (!leadId) {
      toast.error('Open a client first to insert this link.');
      return;
    }
    const isLegacy = lead?.lead_type === 'legacy' || leadId.toLowerCase().startsWith('legacy_');
    setAttachMenuOpen(false);
    try {
      const url =
        kind === 'contract'
          ? (await fetchLeadContractPublicLink(leadId, isLegacy))?.url || null
          : await fetchLeadPoaPublicLink(leadId, isLegacy);
      if (!url) {
        toast.error(
          kind === 'contract'
            ? 'No agreement or contract link is available for this client.'
            : 'No POA link is available for this client.',
        );
        return;
      }
      setInput((prev) => {
        const trimmed = prev.trimEnd();
        return trimmed ? `${trimmed}\n${url}` : url;
      });
      requestAnimationFrame(() => textareaRef.current?.focus());
      toast.success(kind === 'contract' ? 'Contract link added' : 'POA link added');
    } catch (err) {
      console.error(err);
      toast.error('Failed to add the link.');
    }
  };

  const addImageFiles = (files: File[]) => {
    const imageFiles = files.filter((file) => file.type.startsWith('image/'));
    if (!imageFiles.length) return 0;
    if (imageFiles.length + images.length > 10) {
      toast.error('You can upload up to 10 images.');
      return 0;
    }
    setImages((prev) => [...prev, ...imageFiles]);
    imageFiles.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setImagePreviews((prev) => [...prev, ev.target?.result as string]);
      };
      reader.readAsDataURL(file);
    });
    return imageFiles.length;
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    addImageFiles(Array.from(e.target.files || []));
  };

  // Remove selected image by index
  const handleRemoveImage = (idx: number) => {
    setImages(prev => prev.filter((_, i) => i !== idx));
    setImagePreviews(prev => prev.filter((_, i) => i !== idx));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Format text with smart line breaks and lists
  const formatMessageContent = (content: string, opts?: {
    employeePhotos?: boolean;
    asEmailDraft?: boolean;
    stageBadges?: boolean;
  }): React.ReactNode => {
    if (!content) return null;
    const employees = opts?.employeePhotos === false ? [] : chatEmployees;
    const stages = opts?.stageBadges === false ? [] : chatStages;

    if (opts?.asEmailDraft) {
      const text = content.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
      const bodyForDir = text.replace(/^Subject:\s*/i, '');
      const rtl = textIsMostlyHebrew(bodyForDir);
      const display = rtl ? text.replace(/^Subject:\s*/i, 'נושא: ') : text;
      return (
        <div
          dir={rtl ? 'rtl' : 'ltr'}
          className={`ai-chat-msg-text whitespace-pre-line leading-[1.7] ${rtl ? 'text-right' : 'text-left'}`}
        >
          {formatInlineText(display, employees, stages)}
        </div>
      );
    }
    
    // First, normalize excessive dashes (replace multiple dashes with proper formatting)
    let normalized = formatChatCurrencyText(
      content
        .replace(/^[-]{2,}/gm, '')
        .replace(/[-]{3,}/g, '—')
        .replace(/\[(?:#)?([LC]\d+(?:\/\d+)?)\]\((?:#|javascript:[^)]*)?\)/gi, '$1')
        .replace(/\n{2,}(?=\s*\d+[.)]\s)/g, '\n'),
    );
    
    // Split by double newlines for paragraphs, but preserve single newlines within paragraphs
    const blocks = normalized.split(/\n\n+/).filter(p => p.trim());

    const stripListMarker = (line: string) =>
      line.trim().replace(/^\d+[.)]\s+/, '').replace(/^[-*•]\s+/, '').trim();
    const isNumberedLine = (line: string) => /^\d+[.)]\s/.test(line.trim());
    const isBulletLine = (line: string) => /^[-*•]\s/.test(line.trim());
    const isDetailLine = (line: string) => {
      const t = stripListMarker(line);
      return /^(added by|lead|meeting manager|helper|guests?|participants?|your role|kind|category|date|related|location|status)\b/i.test(t);
    };
    const groupListWithContinuations = (lines: string[]) => {
      const prefix: string[] = [];
      let i = 0;
      while (i < lines.length && !isNumberedLine(lines[i]) && !isBulletLine(lines[i])) {
        prefix.push(lines[i]);
        i += 1;
      }
      if (i >= lines.length) return null;
      const numbered = isNumberedLine(lines[i]);
      const items: Array<{ text: string; extra: string[] }> = [];
      for (; i < lines.length; i += 1) {
        const line = lines[i].trim();
        const numberedMatch = line.match(/^\d+[.)]\s+(.*)$/);
        const bulletMatch = line.match(/^[-*•]\s+(.*)$/);
        const asDetail = items.length > 0 && (isDetailLine(line) || (numbered && Boolean(bulletMatch)));
        if (asDetail) {
          items[items.length - 1].extra.push(stripListMarker(line));
          continue;
        }
        if (numberedMatch && numbered) {
          items.push({ text: numberedMatch[1], extra: [] });
          continue;
        }
        if (bulletMatch && !numbered) {
          items.push({ text: bulletMatch[1], extra: [] });
          continue;
        }
        if (items.length) items[items.length - 1].extra.push(stripListMarker(line));
        else prefix.push(lines[i]);
      }
      return { prefix, numbered, items };
    };
    
    const renderDirectedBlock = (text: string, key: string | number) => {
      const rtl = textIsMostlyHebrew(text);
      return (
        <p
          key={key}
          dir={rtl ? 'rtl' : 'ltr'}
          className={`ai-chat-msg-text my-2.5 leading-relaxed whitespace-pre-line last:mb-0 first:mt-0 ${rtl ? 'text-right' : 'text-left'}`}
        >
          {formatInlineText(text, employees, stages)}
        </p>
      );
    };

    return blocks.map((block, bIdx) => {
      const trimmed = block.trim();
      const lines = trimmed.split('\n').filter(l => l.trim());
      const grouped = groupListWithContinuations(lines);

      if (grouped && grouped.items.length) {
        const rtl = textIsMostlyHebrew(trimmed);
        const ListTag = grouped.numbered ? 'ol' : 'ul';
        return (
          <div key={bIdx}>
            {grouped.prefix.map((line, idx) => renderDirectedBlock(line.trim(), `${bIdx}-p-${idx}`))}
            <ListTag
              dir={rtl ? 'rtl' : 'ltr'}
              className={`my-3 space-y-3 list-outside pl-5 ${grouped.numbered ? 'list-decimal' : 'list-disc'} ${
                rtl ? 'text-right mr-2 ml-0' : 'text-left'
              }`}
            >
              {grouped.items.map((item, idx) => (
                <li key={idx} className="ai-chat-msg-text leading-relaxed pl-1">
                  <div>{formatInlineText(item.text, employees, stages)}</div>
                  {item.extra.map((extra, extraIdx) => (
                    <div key={extraIdx} className="mt-1 text-[13px] leading-snug opacity-80">
                      {formatInlineText(extra, employees, stages)}
                    </div>
                  ))}
                </li>
              ))}
            </ListTag>
          </div>
        );
      }

      const mixedLines = lines.length > 1 && lines.some(textIsMostlyHebrew) && lines.some((line) => !textIsMostlyHebrew(line));
      if (mixedLines) {
        return (
          <div key={bIdx}>
            {lines.map((line, idx) => renderDirectedBlock(line.trim(), `${bIdx}-${idx}`))}
          </div>
        );
      }

      return renderDirectedBlock(trimmed, bIdx);
    });
  };

  // Format inline text (bold, italic, code, links)
  const formatInlineText = (
    text: string,
    employees: ChatEmployeeHit[] = chatEmployees,
    stages: ChatStageHit[] = chatStages,
  ): React.ReactNode => {
    if (!text) return null;

    const renderRichInline = (value: string) => (
      <ChatStageBadgeText text={value} stages={stages} employees={employees} onOpen={onClose} dark={isDarkTheme} />
    );
    
    const parts: React.ReactNode[] = [];
    let keyCounter = 0;
    
    // Pattern for **bold**, *italic*, `code`, and [links](url)
    const patterns = [
      { 
        regex: /\*\*([^*]+)\*\*/g, 
        render: (match: string) => (
          <strong key={`format-${keyCounter++}`} className="font-semibold">
            {renderRichInline(match)}
          </strong>
        )
      },
      { 
        regex: /\*([^*]+)\*/g, 
        render: (match: string) => (
          <em key={`format-${keyCounter++}`} className="italic">
            {renderRichInline(match)}
          </em>
        )
      },
      { 
        regex: /`([^`]+)`/g, 
        render: (match: string) => (
          <code key={`format-${keyCounter++}`} className="bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded text-sm font-mono text-gray-800 dark:text-gray-200">
            {match}
          </code>
        ) 
      },
      { 
        regex: /\[([^\]]+)\]\(([^)]+)\)/g, 
        render: (match: string, url: string) => {
          const excelFile = isRmqExcelHref(url) ? resolveRmqExcelFile(url) : null;
          const isExcel =
            Boolean(excelFile) ||
            /\.xlsx(\?|#|$)/i.test(url) ||
            url.startsWith('data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
          if (isExcel) {
            const file = excelFile || { filename: match.replace(/^Download\s+/i, '').trim() || 'export.xlsx', url };
            return (
              <button
                key={`format-${keyCounter++}`}
                type="button"
                onClick={() => {
                  if (!file.url) {
                    toast.error('This Excel file is no longer available. Ask me to create it again.');
                    return;
                  }
                  triggerBrowserDownload(file);
                }}
                className="ai-chat-link inline-flex items-center gap-1 font-semibold underline"
              >
                <ArrowDownTrayIcon className="h-4 w-4" />
                {match}
              </button>
            );
          }
          const leadFromLabel = parseChatLeadNumber(match);
          const leadFromUrl = parseChatLeadNumber(url.replace(/^\/clients\/?/i, ''));
          const leadNumber = leadFromLabel || leadFromUrl;
          const to = isInternalAppPath(url)
            ? url
            : leadNumber
              ? resolveLeadShareClientRoute({ leadNumber })
              : '';
          if (to) {
            return (
              <Link
                key={`format-${keyCounter++}`}
                to={to}
                onClick={(event) => {
                  event.stopPropagation();
                  onClose();
                }}
                className="ai-chat-link font-semibold underline"
                title={leadNumber ? `Open client ${leadNumber}` : match}
              >
                {leadNumber || match}
              </Link>
            );
          }
          return (
            <a 
              key={`format-${keyCounter++}`} 
              href={url} 
              target="_blank" 
              rel="noopener noreferrer" 
              className="ai-chat-link underline"
            >
              {match}
            </a>
          );
        }
      },
    ];
    
    // Find all matches with their positions
    const allMatches: Array<{ index: number; length: number; type: number; match: RegExpExecArray }> = [];
    patterns.forEach(({ regex }, typeIndex) => {
      let match;
      regex.lastIndex = 0;
      while ((match = regex.exec(text)) !== null) {
        allMatches.push({
          index: match.index,
          length: match[0].length,
          type: typeIndex,
          match: match
        });
      }
    });
    
    // Sort matches by index
    allMatches.sort((a, b) => a.index - b.index);
    
    // Remove overlapping matches (keep first)
    const nonOverlapping: typeof allMatches = [];
    allMatches.forEach(match => {
      const overlaps = nonOverlapping.some(existing => 
        (match.index >= existing.index && match.index < existing.index + existing.length) ||
        (existing.index >= match.index && existing.index < match.index + match.length)
      );
      if (!overlaps) {
        nonOverlapping.push(match);
      }
    });
    
    // Build parts
    let currentIndex = 0;
    nonOverlapping.forEach((matchInfo) => {
      if (matchInfo.index > currentIndex) {
        const plainText = text.substring(currentIndex, matchInfo.index);
        if (plainText) {
          parts.push(
            <span key={`text-${keyCounter++}`}>
              {renderRichInline(plainText)}
            </span>,
          );
        }
      }
      
      const pattern = patterns[matchInfo.type];
      const match = matchInfo.match;
      if (match[2]) {
        // Link pattern with URL
        parts.push(pattern.render(match[1], match[2]));
      } else {
        // Other patterns (bold, italic, code)
        parts.push(pattern.render(match[1], ''));
      }
      
      currentIndex = matchInfo.index + matchInfo.length;
    });
    
    if (currentIndex < text.length) {
      const remaining = text.substring(currentIndex);
      if (remaining) {
        parts.push(
          <span key={`text-${keyCounter++}`}>
            {renderRichInline(remaining)}
          </span>,
        );
      }
    }
    
    return parts.length > 0 ? <>{parts}</> : renderRichInline(text);
  };

  const renderChatProse = (
    text: string,
    opts: { role: Message['role']; asEmailDraft?: boolean; welcome?: boolean },
  ) => {
    if (!text) return null;
    return (
      <div
        className={`ai-chat-msg-text max-w-none ${opts.role === 'user' ? 'text-white' : 'text-gray-800'} ${
          opts.asEmailDraft ? '' : 'prose'
        }`}
      >
        {formatMessageContent(text, {
          employeePhotos: !opts.welcome,
          asEmailDraft: opts.asEmailDraft,
          stageBadges: opts.role === 'assistant' && !opts.asEmailDraft,
        })}
      </div>
    );
  };

  const renderAssistantWithRisks = (
    text: string,
    opts: { role: Message['role']; asEmailDraft?: boolean; welcome?: boolean },
  ) => {
    if (!text) return null;
    if (opts.role !== 'assistant' || opts.asEmailDraft) return renderChatProse(text, opts);
    const parts = splitLeadSummaryParts(text);
    if (!parts.risks && !parts.caseAbout) return renderChatProse(text, opts);
    return (
      <div className="ai-meeting-stack">
        {parts.caseAbout ? (
          <div className="ai-lead-case-about">
            <div className="ai-meeting-card-title">General summary</div>
            {renderChatProse(parts.caseAbout, opts)}
          </div>
        ) : null}
        {parts.body ? renderChatProse(parts.body, opts) : null}
        <ChatRisksBox text={parts.risks} renderText={(risks) => renderChatProse(risks, opts)} />
      </div>
    );
  };

  const completeAssistantTurn = async (
    conversationMessages: Message[],
    imagesData: Array<{ name: string; data: string }> = [],
    extraApiMessages: Message[] = [],
  ) => {
    await syncOpenClient();
    const lastUser = [...conversationMessages].reverse().find((message) => message.role === 'user');
    const userText = String(lastUser?.promptContent || lastUser?.content || '');
    const pageType = location.pathname.startsWith('/clients')
      ? 'client'
      : location.pathname.split('/').filter(Boolean)[0] || 'app';
    const rolePack = await resolveRmqAiRolePack();
    const toolsForTurn = filterToolsForRole(RMQ_AI_TOOLS, rolePack);
    const systemPrompt = await buildRmqAiSystemPrompt(RMQ_AI_SYSTEM_PROMPT);
    const trace = beginAiTrace({
      conversationId: currentChatIdRef.current,
      userMessage: userText.slice(0, 240),
      pageType,
      activeLeadNumber: getRmqAiCurrentLead()?.lead_number
        ? String(getRmqAiCurrentLead()?.lead_number)
        : undefined,
    });
    beginRmqAiTurn({
      userMessage: userText.slice(0, 240),
      availableTools: toolsForTurn.map((tool) => tool.function.name),
      pageType,
    });
    const messagesForApi = sanitizeMessages([...conversationMessages, ...extraApiMessages]).map(
      ({
        attachments: _attachments,
        meetingCard: _meetingCard,
        calendarMeetings: _calendarMeetings,
        signedContracts: _signedContracts,
        paidPayments: _paidPayments,
        missedComms: _missedComms,
        expenses: _expenses,
        employeePresence: _employeePresence,
        leadSummary: _leadSummary,
        webSources: _webSources,
        draftAction: _draftAction,
        promptContent,
        streaming: _streaming,
        ...message
      }) => ({ ...message, content: promptContent || message.content }),
    );

    const thinkingPlan = thinkingPlanForAsk(userText);
    let thinkingStep = 0;
    let thinkingLocked = false;
    let pendingStreamText: string | null = null;
    let streamRaf = 0;
    const flushStream = () => {
      streamRaf = 0;
      if (pendingStreamText == null) return;
      const text = pendingStreamText;
      pendingStreamText = null;
      setMessages((prev) => {
        const next = [...prev];
        const lastIndex = next.length - 1;
        if (lastIndex < 0 || next[lastIndex].role !== 'assistant') return prev;
        next[lastIndex] = { ...next[lastIndex], content: text, streaming: true };
        return next;
      });
    };
    const applyStreamDelta = (text: string) => {
      if (!text) return;
      thinkingLocked = true;
      pendingStreamText = text;
      if (!streamRaf) streamRaf = window.requestAnimationFrame(flushStream);
    };
    const applyThinking = (label: string, force = false) => {
      setMessages((prev) => {
        const next = [...prev];
        const lastIndex = next.length - 1;
        if (lastIndex < 0 || next[lastIndex].role !== 'assistant') return prev;
        if (!force && !isThinkingContent(next[lastIndex].content)) return prev;
        next[lastIndex] = { ...next[lastIndex], content: thinkingContent(label), streaming: false };
        return next;
      });
    };
    const callChat = async (payloadMessages: Message[], includeImages = false) => {
      return streamRmqAiChat({
        messages: [{
          role: 'system',
          content: systemPrompt,
        }, ...payloadMessages],
        images: includeImages ? imagesData : [],
        tools: toolsForTurn,
        aiTraceId: trace.aiTraceId,
        onDelta: applyStreamDelta,
      });
    };
    const thinkingTimer = window.setInterval(() => {
      if (thinkingLocked) return;
      if (thinkingStep >= thinkingPlan.length - 1) return;
      thinkingStep += 1;
      applyThinking(thinkingPlan[thinkingStep]);
    }, 1500);

    try {
      let conversation = messagesForApi;
      let aiResponseMessage: Message | null = null;
      const createdFiles: RmqAiChatFile[] = [];
      const appMapLinks: string[] = [];
      let meetingCard: ChatMeetingCardData | undefined;
      let calendarMeetings: ChatCalendarDayData | undefined;
      let signedContracts: ChatSignedContractsData | undefined;
      let paidPayments: ChatPaidPaymentsData | undefined;
      let missedComms: ChatMissedCommsData | undefined;
      let expenses: ChatExpensesData | undefined;
      let employeePresence: ChatEmployeePresenceData | undefined;
      let leadSummary: ChatLeadSummaryData | undefined;
      let webSources: WebSearchCardData | undefined;
      const toolResults: Array<{ name: string; content: string }> = [];
      let toolExecutionMs = 0;
      const modelStarted = Date.now();
      let documentLinks: FollowupDocumentLinks = {
        contractSigningUrl: null,
        poaUrl: null,
        invoiceUrl: null,
        portalUrl: null,
      };
      for (let round = 0; round < 6; round += 1) {
        const reply = await callChat(conversation, round === 0);
        if (streamRaf) {
          window.cancelAnimationFrame(streamRaf);
          streamRaf = 0;
        }
        pendingStreamText = null;
        if (reply.tool_calls?.length) {
          conversation = [
            ...conversation,
            { role: 'assistant', content: reply.content || '', tool_calls: reply.tool_calls },
          ];
          thinkingLocked = true;
          const firstTool = reply.tool_calls[0];
          applyThinking(labelForTool(firstTool?.function?.name, firstTool?.function?.arguments), true);
          for (const toolCall of reply.tool_calls) {
            const fnName = toolCall?.function?.name;
            if (fnName) applyThinking(labelForTool(fnName, toolCall?.function?.arguments), true);
            const toolStarted = Date.now();
            const toolResult = await executeRmqAiTool(toolCall);
            toolExecutionMs += Date.now() - toolStarted;
            if (fnName) toolResults.push({ name: fnName, content: String(toolResult) });
            createdFiles.push(...takeRmqAiToolFiles());
            if (
              fnName === 'get_lead_case_file' ||
              fnName === 'draft_client_message' ||
              fnName === 'get_client_portal_access' ||
              fnName === 'setup_client_portal'
            ) {
              const parsed = parseFollowupDocumentLinks(String(toolResult));
              documentLinks = {
                contractSigningUrl: parsed.contractSigningUrl || documentLinks.contractSigningUrl,
                poaUrl: parsed.poaUrl || documentLinks.poaUrl,
                invoiceUrl: parsed.invoiceUrl || documentLinks.invoiceUrl,
                portalUrl: parsed.portalUrl || documentLinks.portalUrl,
              };
            }
            if (fnName === 'find_app_page') {
              for (const line of String(toolResult).split('\n')) {
                const match = line.match(/\[([^\]]+)\]\((\/[^)]+)\)/);
                if (match) appMapLinks.push(`[${match[1]}](${match[2]})`);
              }
            }
            if (fnName === 'create_lead' || fnName === 'create_meeting') {
              if (!String(toolResult).startsWith('Error')) {
                toast.success(toolResult);
                onClientUpdate?.();
              } else {
                toast.error(toolResult);
              }
            }
            if (fnName === 'setup_client_portal') {
              if (!String(toolResult).startsWith('Error')) {
                toast.success('Client portal saved');
                onClientUpdate?.();
              } else {
                toast.error(toolResult);
              }
            }
            if (fnName === 'create_excel_sheet' && !String(toolResult).startsWith('Could not') && !String(toolResult).startsWith('create_excel_sheet')) {
              toast.success('Excel file ready to download');
            }
            if (fnName === 'list_client_meetings') {
              meetingCard = parseClientMeetingCard(toolResult) || meetingCard;
            }
            if (fnName === 'list_calendar_day' || fnName === 'list_meetings') {
              calendarMeetings = parseCalendarDayCards(toolResult) || calendarMeetings;
            }
            if (fnName === 'list_signed_contracts') {
              signedContracts = parseSignedContractsCard(toolResult) || signedContracts;
            }
            if (fnName === 'list_paid_payments') {
              paidPayments = parsePaidPaymentsCard(toolResult) || paidPayments;
            }
            if (fnName === 'list_missed_client_comms') {
              missedComms = parseMissedCommsCard(toolResult) || missedComms;
            }
            if (fnName === 'list_expenses') {
              expenses = parseExpensesCard(toolResult) || expenses;
            }
            if (fnName === 'list_employee_presence') {
              employeePresence = parseEmployeePresenceCard(toolResult) || employeePresence;
            }
            if (fnName === 'web_search') {
              webSources = parseWebSearchCard(toolResult) || webSources;
            }
            if (fnName === 'get_lead_case_file' && isLeadSummaryAsk(userText)) {
              const parsed = parseLeadSummaryCard(toolResult);
              if (parsed) {
                const open = getRmqAiCurrentLead();
                const openTeam = [
                  { role: 'Handler', name: String(open?.handler || '') },
                  { role: 'Expert', name: String(open?.expert || '') },
                  { role: 'Manager', name: String(open?.manager || '') },
                  { role: 'Closer', name: String(open?.closer || '') },
                  { role: 'Scheduler', name: String(open?.scheduler || '') },
                ];
                const pickName = (...values: Array<string | null | undefined>) =>
                  values
                    .map((value) => String(value || '').trim())
                    .find((value) => value && value !== '—') || '';
                leadSummary = {
                  ...parsed,
                  team: LEAD_SUMMARY_ROLES.map((role) => ({
                    role,
                    name: pickName(
                      parsed.team?.find((row) => row.role === role)?.name,
                      openTeam.find((row) => row.role === role)?.name,
                    ),
                  })),
                };
              }
            }
            conversation = [
              ...conversation,
              { role: 'tool', content: toolResult, tool_call_id: toolCall.id },
            ];
          }
          applyThinking('Putting it together', true);
          continue;
        }
        aiResponseMessage = reply;
        break;
      }

      const replyContent = aiResponseMessage?.content || '';
      const missingFileLinks = createdFiles.filter((file) => !replyContent.includes(`rmq-excel://${file.id}`));
      const missingMapLinks = appMapLinks.filter((link) => !replyContent.includes(link.slice(link.indexOf(']('))));
      const extraLinks = [
        ...missingFileLinks.map((file) => `[Download ${file.filename}](rmq-excel://${file.id})`),
        ...missingMapLinks,
      ];
      const withLinks = extraLinks.length
        ? `${replyContent}${replyContent ? '\n\n' : ''}${extraLinks.join('\n')}`
        : replyContent;

      const draftAction = takeRmqAiDraftMeta() || undefined;
      const linkedContent = draftAction
        ? applyCrmDocumentLinksToEmailDraft(
            withLinks,
            documentLinks,
            String(lastUser?.content || ''),
            { previewHtml: false },
          )
        : withLinks;
      const storedContent =
        (draftAction ? stripAiEmailSignature(linkedContent) : linkedContent) ||
        'I looked up the CRM data but could not finish a reply. Please try again.';
      const answerId = `msg-${Date.now()}`;
      const selectedTools = toolResults.map((row) => row.name);
      const toolErrors = toolResults
        .filter((row) => String(row.content).startsWith('Error executing'))
        .map((row) => row.content);
      const answerability = classifyAnswerability({
        toolErrors,
        selectedTools,
        userMessage: userText,
      });
      const events = detectQualityEvents({
        userMessage: userText,
        selectedTools,
        toolErrors,
        toolResults,
        finalContent: storedContent,
        totalMs: Date.now() - modelStarted,
      });
      const finished = finishAiTrace({
        selectedTools,
        toolErrors,
        toolExecutionMs,
        finalModelMs: Date.now() - modelStarted,
        answerability,
      });
      void persistQualityEvents(events, { conversationId: currentChatIdRef.current, messageId: answerId });
      void persistAnswerEvidence(evidenceFromTools(answerId, toolResults, storedContent));
      if (draftAction) {
        void persistRecommendation({
          recommendationId: `draft-${answerId}`,
          actionType: `draft_${draftAction.channel}`,
          reason: draftAction.leadNumber
            ? `Draft ${draftAction.channel} for ${draftAction.leadNumber}`
            : `Draft ${draftAction.channel}`,
          executable: true,
          conversationId: currentChatIdRef.current,
        });
      }
      if (events.includes('resolver_mismatch')) {
        void persistIncident({
          title: 'Cross-client resolver mismatch',
          severity: 'critical',
          details: { events, tools: selectedTools, trace: finished },
        });
      }
      if (isLeadSummaryAsk(userText) && !leadSummary) {
        const prior = [...conversationMessages].reverse().find((message) => message.leadSummary);
        if (prior?.leadSummary) leadSummary = prior.leadSummary;
      }
      setMessages((prev) => [
        ...prev.slice(0, -1),
        {
          id: answerId,
          role: 'assistant',
          content: storedContent,
          attachments: createdFiles.length ? createdFiles : undefined,
          draftAction,
          meetingCard,
          calendarMeetings,
          signedContracts,
          paidPayments,
          missedComms,
          expenses,
          employeePresence,
          leadSummary,
          webSources,
          aiTraceId: trace.aiTraceId,
        },
      ]);
    } catch (error) {
      console.error('Error in handleSend:', error);
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
      setMessages((prev) => {
        const updated = [...prev];
        const lastIndex = updated.length - 1;
        if (lastIndex >= 0 && updated[lastIndex].role === 'assistant') {
          updated[lastIndex] = {
            ...updated[lastIndex],
            content: `Sorry, an error occurred: ${errorMessage}`,
            streaming: false,
          };
        }
        return updated;
      });
    } finally {
      window.clearInterval(thinkingTimer);
      if (streamRaf) window.cancelAnimationFrame(streamRaf);
      setIsLoading(false);
    }
  };

  const handleSend = async (customInput?: string, opts?: { display?: string }) => {
    const messageToSend = customInput || input;
    if (!messageToSend.trim() && images.length === 0) return;
    await syncOpenClient();
    setIsLoading(true);
    const sendText = messageToSend.trim();
    const shownText = opts?.display || shortAskLabel(sendText) || sendText;

    let userMessage: any;
    if (images.length > 0 && imagePreviews.length > 0) {
      userMessage = {
        role: 'user',
        content: [
          ...(shownText ? [{ type: 'text', text: shownText }] : []),
          ...imagePreviews.map(url => ({ type: 'image_url', image_url: { url } }))
        ],
        ...(shownText !== sendText ? { promptContent: sendText } : {}),
      };
    } else {
      userMessage = {
        role: 'user',
        content: shownText,
        ...(shownText !== sendText ? { promptContent: sendText } : {}),
      };
    }
    const priorMessages = messages.filter((message) => !isWelcomeMessage(message));
    const newMessages = [...priorMessages, userMessage];
    const imagesData = images.map((file, index) => ({
      name: file.name,
      data: imagePreviews[index],
    }));

    if (isForgetMemoryRequest(messageToSend)) {
      void forgetUserMemory(messageToSend).then((count) => {
        if (count > 0) toast.success('I will not keep that preference.');
      });
    }
    const preference = isPreferenceCorrection(messageToSend);
    if (preference) {
      void upsertUserMemory({
        fact: preference.fact,
        category: preference.category,
        sourceType: 'feedback',
        sourceConversationId: currentChatId || undefined,
        explicit: true,
      }).then((row) => {
        if (row) toast.success(row.reinforced ? 'Updated that preference.' : 'I’ll remember that.');
      });
    }
    const firmLesson = isFirmWideLesson(messageToSend);
    if (firmLesson) {
      void proposeFirmLesson(firmLesson);
    }
    if (detectPossibleUserCorrection(messageToSend)) {
      void persistQualityEvents(['possible_user_correction'], {
        conversationId: currentChatId,
      });
    }

    if (!customInput) {
      setInput('');
      setCaret(0);
      setSuggestDismissed(true);
    }
    setImages([]);
    setImagePreviews([]);
    if (fileInputRef.current) fileInputRef.current.value = '';

    setMessages([
      ...newMessages,
      { role: 'assistant', content: thinkingContent(thinkingPlanForAsk(messageToSend)[0] || 'Thinking') },
    ]);
    await completeAssistantTurn(newMessages, imagesData);
  };

  const handleSendRef = useRef(handleSend);
  handleSendRef.current = handleSend;

  useEffect(() => {
    if (!isOpen) return;
    const prompt = takeRmqAiPendingPrompt();
    if (!prompt) return;
    void handleSendRef.current(prompt);
  }, [isOpen]);

  useEffect(() => {
    const onOpen = () => {
      if (!isOpen) return;
      const prompt = takeRmqAiPendingPrompt();
      if (!prompt) return;
      void handleSendRef.current(prompt);
    };
    window.addEventListener(RMQ_AI_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(RMQ_AI_OPEN_EVENT, onOpen);
  }, [isOpen]);

  const finishVoiceToInput = async (payload: { recording?: VoiceRecordingResult | null; liveText: string }) => {
    if (voiceFinishingRef.current) return;
    voiceFinishingRef.current = true;
    setIsVoiceBusy(true);
    try {
      let transcript = '';
      if (payload.recording) {
        const audioBase64 = await voiceBlobToBase64(payload.recording.blob);
        const whisper = await transcribeMeetingSummaryAudio({
          audioBase64,
          mimeType: payload.recording.mimeType,
          language: 'auto',
          prompt:
            'Hebrew and English CRM chat. Accurately keep names, lead numbers, meetings, follow-ups, WhatsApp, and email.',
        });
        transcript = whisper.transcript.trim();
      }
      if (!transcript) {
        transcript = payload.liveText.trim();
      }
      const message = combineLiveTranscript(voiceBaseInputRef.current, transcript, '');
      voiceBaseInputRef.current = '';
      if (!message.trim()) {
        toast.error('No speech detected');
        setInput('');
        setCaret(0);
        return;
      }
      setInput(message);
      setCaret(message.length);
      setSuggestDismissed(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to transcribe voice');
    } finally {
      voiceFinishingRef.current = false;
      setIsVoiceBusy(false);
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
    }
  };
  finishVoiceRef.current = (payload) => {
    void finishVoiceToInput(payload);
  };

  const startVoiceInput = async () => {
    if (isLoading || isVoiceActive) return;
    if (!liveSpeechSupported && !voiceRecordingSupported) {
      toast.error('Voice input is not supported in this browser');
      return;
    }
    voiceBaseInputRef.current = input;
    voiceFinishingRef.current = false;
    try {
      if (voiceRecordingSupported) {
        await startVoiceRecording();
      } else if (liveSpeechSupported) {
        startLiveSpeech({
          lang: chatSpeechLang(currentLead?.language, input),
        });
      }
    } catch (err) {
      cancelLiveSpeech();
      cancelVoiceRecording();
      voiceBaseInputRef.current = '';
      toast.error(err instanceof Error ? err.message : 'Could not start microphone');
    }
  };

  const stopVoiceToInput = async () => {
    if (isVoiceBusy || voiceFinishingRef.current) return;
    try {
      const liveText = isVoiceListening ? stopLiveSpeech() : '';
      let recording: VoiceRecordingResult | null = null;
      try {
        recording = await stopVoiceRecording();
      } catch {
        cancelVoiceRecording();
      }
      await finishVoiceToInput({ recording, liveText });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to stop recording');
      voiceFinishingRef.current = false;
      setIsVoiceBusy(false);
    }
  };

  const cancelVoiceInput = () => {
    voiceFinishingRef.current = false;
    cancelLiveSpeech();
    cancelVoiceRecording();
    setInput(voiceBaseInputRef.current);
    voiceBaseInputRef.current = '';
    setIsVoiceBusy(false);
  };

  const toggleVoiceInput = () => {
    if (isVoiceBusy) return;
    if (isVoiceRecording || isVoiceListening) {
      void stopVoiceToInput();
      return;
    }
    void startVoiceInput();
  };

  const handleRetryAssistant = async (assistantMessage: Message) => {
    if (isLoading || assistantMessage.role !== 'assistant' || isWelcomeMessage(assistantMessage)) return;
    const fullAssistantIndex = messages.findIndex((row) => row === assistantMessage);
    if (fullAssistantIndex < 0) return;
    let userIndex = -1;
    for (let i = fullAssistantIndex - 1; i >= 0; i -= 1) {
      if (messages[i].role === 'user') {
        userIndex = i;
        break;
      }
    }
    if (userIndex < 0) {
      toast.error('Nothing to retry');
      return;
    }
    const trimmed = messages.slice(0, userIndex + 1);
    setIsLoading(true);
    setMessages([...trimmed, { role: 'assistant', content: thinkingContent('Trying again') }]);
    await completeAssistantTurn(trimmed, [], [
      {
        role: 'user',
        content:
          'Try again and rephrase your last answer. Keep the same facts and numbers. Do not greet. Be concise.',
      },
    ]);
  };

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
    addImageFiles(Array.from(e.dataTransfer.files));
  };

  const handleAiIconClick = () => {
    setAiIconAnim(true);
    setTimeout(() => setAiIconAnim(false), 600);
    setShowRmqAiIntroModal(true);
  };

  // Chat history functions
  const loadChatHistory = async (searchTerm = '') => {
    setIsLoadingHistory(true);
    try {
      // Try RPC function first, fallback to direct query
      let data, error;
      
      try {
        const result = await supabase.rpc('search_ai_chat_history', { p_search_term: searchTerm || '' });
        data = result.data;
        error = result.error;
      } catch (rpcError) {
        // Fallback to direct query if RPC function doesn't exist
        const result = await supabase
          .from('ai_chat_history')
          .select('id, title, created_at, updated_at, message_count, summary, tags')
          .eq('user_id', (await supabase.auth.getUser()).data.user?.id)
          .eq('is_archived', false)
          .order('updated_at', { ascending: false });
        data = result.data;
        error = result.error;
      }
      
      if (error) throw error;
      setChatHistory(data || []);
    } catch (error) {
      console.error('Error loading chat history:', error);
      toast.error('Failed to load chat history');
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const persistLeavingChat = async (chatId: string | null, snapshot: Message[]) => {
    const rows = snapshot.filter(
      (msg) =>
        isVisibleChatMessage(msg) &&
        msg.content !== '...' &&
        !isThinkingContent(msg.content),
    );
    if (rows.length < 2) return;
    try {
      const user = (await supabase.auth.getUser()).data.user;
      if (!user) return;
      const openLead = getRmqAiCurrentLead();
      const openLeadId =
        openLead?.id && !String(openLead.id).startsWith('legacy_') && String(openLead.id).includes('-')
          ? String(openLead.id)
          : null;
      let savedId = chatId;
      if (savedId) {
        const { error } = await supabase.rpc('update_ai_chat_history', {
          p_chat_id: savedId,
          p_messages: rows,
        });
        if (error) {
          await supabase
            .from('ai_chat_history')
            .update({ messages: rows, message_count: rows.length, last_message_at: new Date().toISOString() })
            .eq('id', savedId)
            .eq('user_id', user.id);
        }
      } else {
        const { data, error } = await supabase.rpc('save_ai_chat_history', {
          p_title: null,
          p_messages: rows,
          p_lead_id: openLeadId,
        });
        if (!error && data) savedId = data;
      }
      if (savedId) {
        await persistStructuredChatSummary(savedId, rows);
      }
    } catch (error) {
      console.error('Error flushing chat memory:', error);
    }
  };

  const saveCurrentChat = async () => {
    if (messages.length <= 1) return; // Don't save if only greeting message
    
    try {
      const messagesToSave = messages.filter(
        (msg) =>
          isVisibleChatMessage(msg) &&
          msg.content !== '...' &&
          !isThinkingContent(msg.content),
      );
      const user = (await supabase.auth.getUser()).data.user;
      if (!user) throw new Error('User not authenticated');
      const openLead = getRmqAiCurrentLead();
      const openLeadId =
        openLead?.id && !String(openLead.id).startsWith('legacy_') && String(openLead.id).includes('-')
          ? String(openLead.id)
          : null;
      
      let savedChatId = currentChatId;
      if (currentChatId) {
        // Update existing chat
        try {
          const { error } = await supabase.rpc('update_ai_chat_history', {
            p_chat_id: currentChatId,
            p_messages: messagesToSave
          });
          if (error) throw error;
        } catch (rpcError) {
          // Fallback to direct update
          const { error } = await supabase
            .from('ai_chat_history')
            .update({
              messages: messagesToSave,
              message_count: messagesToSave.length,
              last_message_at: new Date().toISOString()
            })
            .eq('id', currentChatId)
            .eq('user_id', user.id);
          if (error) throw error;
        }
      } else {
        // Create new chat
        try {
          const { data, error } = await supabase.rpc('save_ai_chat_history', {
            p_title: null, // Will be auto-generated
            p_messages: messagesToSave,
            p_lead_id: openLeadId,
          });
          if (error) throw error;
          savedChatId = data;
          setCurrentChatId(data);
          currentChatIdRef.current = data;
        } catch (rpcError) {
          // Fallback to direct insert
          const title = messagesToSave.find(msg => msg.role === 'user')?.content?.substring(0, 50) || 'New Conversation';
          const { data, error } = await supabase
            .from('ai_chat_history')
            .insert({
              user_id: user.id,
              title: title,
              messages: messagesToSave,
              message_count: messagesToSave.length,
              ...(openLeadId ? { lead_id: openLeadId } : {}),
            })
            .select('id')
            .single();
          if (error) throw error;
          savedChatId = data.id;
          setCurrentChatId(data.id);
          currentChatIdRef.current = data.id;
        }
      }

      if (savedChatId) {
        const summary = await persistStructuredChatSummary(savedChatId, messagesToSave);
        if (summary) {
          lastSummaryRef.current = summary;
          lastSummarizedCountRef.current = messagesToSave.length;
        }
      }
      
      // Refresh history
      loadChatHistory(historySearchTerm);
    } catch (error) {
      console.error('Error saving chat:', error);
      toast.error('Failed to save chat');
    }
  };

  const loadChat = async (chatId: string) => {
    void persistLeavingChat(currentChatIdRef.current, messagesRef.current);
    lastSummaryRef.current = null;
    lastSummarizedCountRef.current = 0;
    try {
      const { data, error } = await supabase
        .from('ai_chat_history')
        .select('messages, title')
        .eq('id', chatId)
        .single();
      
      if (error) throw error;
      
      const loaded = (data.messages || []) as Message[];
      for (const message of loaded) {
        for (const file of message.attachments || []) {
          if (file?.id && file.url) rememberRmqAiFile(file);
        }
      }
      setMessages(loaded);
      pinnedVisibleCountRef.current = loaded.filter(
        (msg) => isVisibleChatMessage(msg) && !isWelcomeMessage(msg),
      ).length;
      setCurrentChatId(chatId);
      setShowHistoryPanel(false);
      toast.success(`Loaded: ${data.title}`);
    } catch (error) {
      console.error('Error loading chat:', error);
      toast.error('Failed to load chat');
    }
  };

  const startNewChat = () => {
    void persistLeavingChat(currentChatIdRef.current, messagesRef.current);
    lastSummaryRef.current = null;
    lastSummarizedCountRef.current = 0;
    pinnedVisibleCountRef.current = 0;
    setMessages([{ 
      role: 'assistant', 
      content: userName
        ? `Hi ${userName}, how can I help you?`
        : 'Hello! How can I help you?',
    }]);
    setCurrentChatId(null);
    setShowHistoryPanel(false);
    setHistorySelecting(false);
    setSelectedHistoryIds([]);
  };

  const toggleHistorySelection = (chatId: string) => {
    setSelectedHistoryIds((prev) =>
      prev.includes(chatId) ? prev.filter((id) => id !== chatId) : [...prev, chatId],
    );
  };

  const handleHistoryDeleteClick = () => {
    if (!historySelecting) {
      setHistorySelecting(true);
      setSelectedHistoryIds([]);
      return;
    }
    if (selectedHistoryIds.length === 0) {
      setHistorySelecting(false);
      return;
    }
    const count = selectedHistoryIds.length;
    if (!confirm(`Delete ${count} conversation${count === 1 ? '' : 's'}? This cannot be undone.`)) {
      return;
    }
    void deleteChats(selectedHistoryIds);
  };

  const deleteChats = async (chatIds: string[]) => {
    if (chatIds.length === 0) return;
    try {
      const { error } = await supabase.from('ai_chat_history').delete().in('id', chatIds);
      if (error) throw error;
      if (currentChatId && chatIds.includes(currentChatId)) {
        startNewChat();
      }
      setHistorySelecting(false);
      setSelectedHistoryIds([]);
      loadChatHistory(historySearchTerm);
      toast.success(chatIds.length === 1 ? 'Chat deleted' : `${chatIds.length} chats deleted`);
    } catch (error) {
      console.error('Error deleting chats:', error);
      toast.error('Failed to delete chats');
    }
  };

  currentChatIdRef.current = currentChatId;
  messagesRef.current = messages;

  // Load chat history when component opens
  useEffect(() => {
    if (isOpen) {
      loadChatHistory();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isMobile || !showHistoryPanel) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowHistoryPanel(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isMobile, showHistoryPanel]);

  useEffect(() => {
    if (!showHistoryPanel) setHistoryToolsOpen(false);
  }, [showHistoryPanel]);

  // Auto-save chat when messages change
  useEffect(() => {
    if (messages.length > 1 && !isLoading) {
      lastActivityAtRef.current = Date.now();
      const saveTimeout = setTimeout(saveCurrentChat, 2000);
      return () => clearTimeout(saveTimeout);
    }
  }, [messages, isLoading]);

  const maybeRefreshSummary = useCallback(async (opts?: { closed?: boolean; force?: boolean }) => {
    const chatId = currentChatIdRef.current;
    const rows = messagesRef.current.filter(
      (msg) =>
        (msg.role === 'user' || msg.role === 'assistant') &&
        msg.content &&
        !isThinkingContent(msg.content),
    );
    if (!chatId || rows.length < 2) return;
    const idleMs = Date.now() - lastActivityAtRef.current;
    const changed = subjectChanged(lastSummaryRef.current, rows);
    if (
      !shouldRefreshChatSummary({
        visibleMessageCount: rows.length,
        lastSummarizedCount: lastSummarizedCountRef.current,
        idleMs,
        closed: opts?.closed,
        force: opts?.force,
        subjectChanged: changed,
      })
    ) {
      return;
    }
    const summary = await persistStructuredChatSummary(chatId, rows);
    if (summary) {
      lastSummaryRef.current = summary;
      lastSummarizedCountRef.current = rows.length;
    }
  }, []);

  useEffect(() => {
    if (isLoading || messages.length <= 1) return;
    const timer = window.setTimeout(() => {
      void maybeRefreshSummary({ force: true });
    }, 4_000);
    return () => window.clearTimeout(timer);
  }, [messages, isLoading, maybeRefreshSummary]);

  useEffect(() => {
    if (isOpen) return;
    void persistLeavingChat(currentChatIdRef.current, messagesRef.current);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    void backfillMissingChatSummaries(40).then((written) => {
      if (written > 0) loadChatHistory();
    });
  }, [isOpen]);

  useEffect(() => {
    if (!panelPos || isFullPage) return;
    const el = panelRef.current;
    const next = clampPanelPos(panelPos, el?.offsetWidth ?? 480, el?.offsetHeight ?? 360);
    if (next.left !== panelPos.left || next.top !== panelPos.top) {
      setPanelPos(next);
      persistPanelPos(next);
    }
  }, [showHistoryPanel, isFullPage]);

  useEffect(() => {
    if (isFullPage || isMobile) return;
    const extra = window.matchMedia('(min-width: 768px)').matches
      ? HISTORY_SIDEBAR_WIDTH_MD
      : HISTORY_SIDEBAR_WIDTH_SM;
    const el = panelRef.current;

    if (showHistoryPanel) {
      if (historyBoostActiveRef.current) return;
      historyBoostActiveRef.current = true;
      const current = panelSizeRef.current;
      sizeBeforeHistoryRef.current = current;
      const width = current?.width ?? el?.offsetWidth ?? 672;
      const height = current?.height ?? el?.offsetHeight ?? 600;
      const next = clampPanelSize({ width: width + extra, height });
      setPanelSize(next);
      setPanelPos((pos) => (pos ? clampPanelPos(pos, next.width, next.height) : pos));
      return;
    }

    if (!historyBoostActiveRef.current) return;
    historyBoostActiveRef.current = false;
    const previous = sizeBeforeHistoryRef.current;
    sizeBeforeHistoryRef.current = null;
    if (previous) {
      setPanelSize(previous);
      setPanelPos((pos) => (pos ? clampPanelPos(pos, previous.width, previous.height) : pos));
    } else {
      setPanelSize(null);
    }
  }, [showHistoryPanel, isFullPage, isMobile]);

  useEffect(() => {
    const onResize = () => {
      setPanelSize((current) => {
        if (!current) return current;
        const next = clampPanelSize(current);
        persistPanelSize(next);
        return next;
      });
      setPanelPos((current) => {
        if (!current) return current;
        const el = panelRef.current;
        const next = clampPanelPos(current, el?.offsetWidth ?? 480, el?.offsetHeight ?? 360);
        persistPanelPos(next);
        return next;
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const clearPanelHoldTimer = () => {
    if (panelHoldTimerRef.current != null) {
      window.clearTimeout(panelHoldTimerRef.current);
      panelHoldTimerRef.current = null;
    }
  };

  const beginPanelMove = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || isMobile) return;
    const fromExpand = event.currentTarget.hasAttribute('data-ai-expand');
    if (
      !fromExpand &&
      event.target instanceof Element &&
      event.target.closest('button, a, input, textarea, select, [role="button"]')
    ) {
      return;
    }
    const el = panelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    panelDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origLeft: panelPos?.left ?? rect.left,
      origTop: panelPos?.top ?? rect.top,
      moved: false,
      held: false,
      fromExpand,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    clearPanelHoldTimer();
    panelHoldTimerRef.current = window.setTimeout(() => {
      const drag = panelDragRef.current;
      if (!drag) return;
      drag.held = true;
      setIsMovingPanel(true);
      if (!panelPos && !isFullPage) {
        setPanelPos(clampPanelPos(
          { left: drag.origLeft, top: drag.origTop },
          panelRef.current?.offsetWidth ?? 480,
          panelRef.current?.offsetHeight ?? 360,
        ));
      }
    }, 160);
  }, [isFullPage, isMobile, panelPos]);

  const movePanel = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const drag = panelDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < PANEL_DRAG_THRESHOLD_PX) return;

    if (!drag.moved) {
      drag.moved = true;
      clearPanelHoldTimer();
      setIsMovingPanel(true);
      if (isFullPage) {
        const width = Math.min(window.innerWidth - PANEL_EDGE_MARGIN * 2, showHistoryPanel ? 1024 : 672);
        const next = clampPanelPos(
          { left: event.clientX - width + 40, top: event.clientY - 24 },
          width,
          window.innerHeight - PANEL_EDGE_MARGIN * 2,
        );
        drag.origLeft = next.left;
        drag.origTop = next.top;
        drag.startX = event.clientX;
        drag.startY = event.clientY;
        setPanelPos(next);
        onToggleFullPage?.();
        return;
      }
    }

    const el = panelRef.current;
    const next = clampPanelPos(
      { left: drag.origLeft + (event.clientX - drag.startX), top: drag.origTop + (event.clientY - drag.startY) },
      el?.offsetWidth ?? 480,
      el?.offsetHeight ?? 360,
    );
    setPanelPos(next);
  }, [isFullPage, onToggleFullPage, showHistoryPanel]);

  const endPanelMove = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const drag = panelDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    clearPanelHoldTimer();
    panelDragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* already released */
    }
    if (drag.moved || drag.held) {
      setPanelPos((current) => {
        if (current) persistPanelPos(current);
        return current;
      });
    }
    setIsMovingPanel(false);
  }, []);

  const beginPanelResize = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || isFullPage) return;
    event.preventDefault();
    event.stopPropagation();
    const el = panelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cornerAttr = event.currentTarget.getAttribute('data-ai-resize');
    const corner =
      cornerAttr === 'ne' || cornerAttr === 'se' || cornerAttr === 'sw' ? cornerAttr : 'nw';
    panelResizeRef.current = {
      pointerId: event.pointerId,
      corner,
      startX: event.clientX,
      startY: event.clientY,
      origLeft: panelPos?.left ?? rect.left,
      origTop: panelPos?.top ?? rect.top,
      origWidth: panelSize?.width ?? rect.width,
      origHeight: panelSize?.height ?? rect.height,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsResizingPanel(true);
    if (!panelPos) {
      setPanelPos(clampPanelPos(
        { left: rect.left, top: rect.top },
        rect.width,
        rect.height,
      ));
    }
    if (!panelSize) {
      setPanelSize(clampPanelSize({ width: rect.width, height: rect.height }));
    }
  }, [isFullPage, panelPos, panelSize]);

  const movePanelResize = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const resize = panelResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    const dx = event.clientX - resize.startX;
    const dy = event.clientY - resize.startY;
    const right = resize.origLeft + resize.origWidth;
    const bottom = resize.origTop + resize.origHeight;
    const fromWest = resize.corner === 'nw' || resize.corner === 'sw';
    const fromNorth = resize.corner === 'nw' || resize.corner === 'ne';
    const nextSize = clampPanelSize({
      width: fromWest ? resize.origWidth - dx : resize.origWidth + dx,
      height: fromNorth ? resize.origHeight - dy : resize.origHeight + dy,
    });
    const nextPos = clampPanelPos(
      {
        left: fromWest ? right - nextSize.width : resize.origLeft,
        top: fromNorth ? bottom - nextSize.height : resize.origTop,
      },
      nextSize.width,
      nextSize.height,
    );
    setPanelSize(nextSize);
    setPanelPos(nextPos);
  }, []);

  const endPanelResize = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const resize = panelResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    panelResizeRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* already released */
    }
    setPanelPos((current) => {
      if (current) persistPanelPos(current);
      return current;
    });
    setPanelSize((current) => {
      if (current) persistPanelSize(current);
      return current;
    });
    setIsResizingPanel(false);
  }, []);

  const isPlacedPanel = Boolean(panelPos) && !isFullPage && !isMobile;
  const hasCustomSize = Boolean(panelSize) && !isFullPage && !isMobile;
  const isFloatingPanel = !isFullPage && !isMobile;
  const canResizePanel = !isFullPage && (isFloatingPanel || isPlacedPanel);

  const copyAssistantMessage = useCallback(async (key: string, message: Message) => {
    const raw = plainTextFromMessage(message);
    const text =
      message.draftAction || looksLikeEmailDraft(raw) ? stripAiEmailSignature(raw) : raw;
    if (!text || isThinkingMessage(message.content)) return;
    try {
      await navigator.clipboard.writeText(text);
      if (copiedBubbleTimerRef.current != null) window.clearTimeout(copiedBubbleTimerRef.current);
      setCopiedBubbleKey(key);
      copiedBubbleTimerRef.current = window.setTimeout(() => {
        setCopiedBubbleKey((current) => (current === key ? null : current));
        copiedBubbleTimerRef.current = null;
      }, 1600);
    } catch {
      toast.error('Could not copy to clipboard');
    }
  }, []);

  const openDraftInEmail = useCallback((message: Message) => {
    const text = stripAiEmailSignature(plainTextFromMessage(message));
    if (!text) return;
    stashRmqAiComposeDraft({
      channel: 'email',
      text,
      leadNumber: message.draftAction?.leadNumber,
      leadId: message.draftAction?.leadId,
      email: message.draftAction?.email || currentLead?.email || undefined,
    });
    onClose();
    onOpenEmailCompose?.();
  }, [currentLead?.email, onClose, onOpenEmailCompose]);

  useEffect(() => {
    return () => {
      if (copiedBubbleTimerRef.current != null) window.clearTimeout(copiedBubbleTimerRef.current);
    };
  }, []);

  const historyFileInput = (
    <input
      ref={teachFileInputRef}
      type="file"
      accept=".txt,.md,.text"
      className="hidden"
      onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        void file.text().then(async (text) => {
          const result = await ingestKnowledgeText({ title: file.name, text, scope: 'user' });
          if (result?.chunks) toast.success(`Saved ${result.chunks} knowledge chunks`);
          else toast.error('Could not save knowledge file. Run the RMQ AI v1 SQL first.');
        });
      }}
    />
  );

  const renderChatHistoryPanel = (mobileDrawer: boolean) => (
    <>
      {mobileDrawer ? (
        <>
        <div className="ai-history-veil ai-history-veil-top" aria-hidden />
        <div className="ai-history-float-top">
          <div className="flex h-14 items-center gap-2.5">
            <RmqAiLogo src={RMQ_AI_HEADER_LOGO_SRC} className="h-12 w-12 shrink-0" />
            <span className="text-lg font-bold tracking-tight text-gray-900">RMQ AI</span>
          </div>
          <button
            type="button"
            className="ai-history-float-chip h-12 w-12 text-gray-600"
            onClick={() => setShowHistoryPanel(false)}
            aria-label="Close history"
            title="Close history"
          >
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>
        </>
      ) : (
      <div className="bg-white p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="font-semibold text-gray-900">Chat History</h3>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleHistoryDeleteClick}
              className={`inline-flex h-9 items-center justify-center rounded-full px-3 text-sm font-semibold shadow-sm transition ${
                historySelecting
                  ? selectedHistoryIds.length > 0
                    ? 'bg-red-600 text-white hover:bg-red-700'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  : 'bg-gray-100 text-red-500 hover:bg-red-50'
              }`}
              title={
                historySelecting
                  ? selectedHistoryIds.length > 0
                    ? `Delete ${selectedHistoryIds.length} selected`
                    : 'Cancel selection'
                  : 'Select chats to delete'
              }
              aria-label={
                historySelecting
                  ? selectedHistoryIds.length > 0
                    ? 'Confirm delete'
                    : 'Cancel selection'
                  : 'Delete chats'
              }
            >
              <TrashIcon className="h-5 w-5" />
              {historySelecting && selectedHistoryIds.length > 0 ? (
                <span className="ml-1">{selectedHistoryIds.length}</span>
              ) : null}
            </button>
            <button
              type="button"
              onClick={() => teachFileInputRef.current?.click()}
              className="inline-flex h-9 items-center justify-center rounded-full bg-gray-100 px-3 text-sm font-semibold text-gray-600 shadow-sm transition hover:bg-gray-200"
              title="Teach RMQ (txt playbook)"
              aria-label="Teach RMQ"
            >
              <AcademicCapIcon className="h-5 w-5" />
            </button>
            {historyFileInput}
            <button
              type="button"
              onClick={startNewChat}
              className="ai-send-btn inline-flex h-9 items-center gap-1.5 rounded-full border-0 px-4 text-sm font-semibold text-white shadow-sm transition"
              title="Start New Chat"
            >
              <PlusIcon className="h-4 w-4" strokeWidth={2.5} />
              New
            </button>
          </div>
        </div>
      </div>
      )}
      <div className={`ai-history-scroll flex-1 overflow-y-auto px-3 pb-3 ${mobileDrawer ? 'px-4 pt-[calc(4.4rem+env(safe-area-inset-top))] pb-24' : 'bg-white'}`}>
        <div className={`relative ${mobileDrawer ? 'mb-3' : 'mb-3 px-1'}`}>
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search conversations..."
            value={historySearchTerm}
            onChange={(e) => {
              setHistorySearchTerm(e.target.value);
              loadChatHistory(e.target.value);
            }}
            className="w-full rounded-xl border-0 bg-gray-100 py-2.5 pl-10 pr-4 text-sm text-gray-900 placeholder:text-gray-500 outline-none ring-0 focus:border-0 focus:outline-none focus:ring-0 max-md:py-3 max-md:text-base"
          />
        </div>
        {isLoadingHistory ? (
          <div className="flex h-32 items-center justify-center">
            <div className="loading loading-spinner loading-md text-violet-600"></div>
          </div>
        ) : chatHistory.length === 0 ? (
          <div className="rounded-2xl bg-white/70 p-8 text-center text-gray-500">
            <ChatBubbleLeftRightIcon className="mx-auto mb-4 h-12 w-12 text-gray-300" />
            <p className="text-lg font-medium">No conversations yet</p>
            <p className="text-sm">Start chatting to see your history here</p>
          </div>
        ) : (
          <div className="space-y-2">
            {chatHistory.map((chat) => {
              const isSelected = selectedHistoryIds.includes(chat.id);
              const historyPreview = formatChatHistoryPreview(chat.summary);
              return (
                <div
                  key={chat.id}
                  className={`ai-history-item cursor-pointer rounded-l-xl rounded-r-3xl bg-white p-4 ring-1 transition-colors ${
                    historySelecting && isSelected
                      ? 'ai-history-item-active ring-2 ring-red-400'
                      : currentChatId === chat.id
                        ? 'ai-history-item-active ring-2 ring-violet-400'
                        : 'ring-gray-100 hover:ring-gray-200'
                  }`}
                  onClick={() =>
                    historySelecting ? toggleHistorySelection(chat.id) : loadChat(chat.id)
                  }
                >
                  <div className="flex items-start gap-3">
                    {historySelecting ? (
                      <span
                        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                          isSelected
                            ? 'border-red-500 bg-red-500 text-white'
                            : 'border-gray-300 bg-white'
                        }`}
                        aria-hidden
                      >
                        {isSelected ? <CheckIcon className="h-3.5 w-3.5" strokeWidth={3} /> : null}
                      </span>
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <h4 className="truncate text-sm font-medium text-gray-900 max-md:text-base">
                        {formatChatHistoryPreview(chat.title) || chat.title}
                      </h4>
                      <div className="mt-1 flex items-center gap-2 text-xs text-gray-500 max-md:text-sm">
                        <ClockIcon className="h-3 w-3" />
                        <span>{new Date(chat.updated_at).toLocaleDateString()}</span>
                        <span>•</span>
                        <span>{chat.message_count} messages</span>
                      </div>
                      {historyPreview ? (
                        <p className="mt-1 line-clamp-2 text-xs text-gray-600 max-md:text-sm">
                          {historyPreview}
                        </p>
                      ) : null}
                      {chat.tags && chat.tags.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {chat.tags.slice(0, 3).map((tag, idx) => (
                            <span
                              key={idx}
                              className="rounded-full bg-violet-100 px-2 py-1 text-xs text-violet-700"
                            >
                              {tag}
                            </span>
                          ))}
                          {chat.tags.length > 3 && (
                            <span className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-600">
                              +{chat.tags.length - 3}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {mobileDrawer ? (
        <div className="ai-history-float-dock">
          <button
            type="button"
            onClick={startNewChat}
            className="ai-send-btn inline-flex h-12 items-center gap-1.5 rounded-full border-0 px-5 text-base font-semibold text-white shadow-lg"
            title="Start New Chat"
          >
            <PlusIcon className="h-5 w-5" strokeWidth={2.5} />
            New
          </button>
          <div className="ai-history-tools">
            {historyToolsOpen ? (
              <div className="ai-history-tools-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-3 px-3.5 py-3 text-left text-sm font-semibold text-red-600 hover:bg-red-50"
                  onClick={() => {
                    setHistoryToolsOpen(false);
                    handleHistoryDeleteClick();
                  }}
                >
                  <TrashIcon className="h-5 w-5" />
                  {historySelecting && selectedHistoryIds.length > 0
                    ? `Delete ${selectedHistoryIds.length}`
                    : historySelecting
                      ? 'Cancel delete'
                      : 'Delete chats'}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-3 px-3.5 py-3 text-left text-sm font-semibold text-gray-700 hover:bg-gray-50"
                  onClick={() => {
                    setHistoryToolsOpen(false);
                    teachFileInputRef.current?.click();
                  }}
                >
                  <AcademicCapIcon className="h-5 w-5" />
                  Teach RMQ
                </button>
              </div>
            ) : null}
            <button
              type="button"
              className={`ai-history-float-chip h-12 w-12 ${
                historySelecting ? 'text-red-600' : 'text-gray-700'
              }`}
              onClick={() => setHistoryToolsOpen((open) => !open)}
              aria-expanded={historyToolsOpen}
              aria-haspopup="menu"
              aria-label="History actions"
              title="More actions"
            >
              <EllipsisHorizontalIcon className="h-6 w-6" />
            </button>
            {historyFileInput}
          </div>
        </div>
      ) : null}
    </>
  );

  const plusMenuItems = (
    <>
      <button
        type="button"
        role="menuitem"
        className="ai-plus-item"
        onClick={() => {
          setAttachMenuOpen(false);
          fileInputRef.current?.click();
        }}
      >
        <PlusMenuImagesIcon className="ai-plus-icon" />
        <span className="ai-plus-copy">
          <span className="ai-plus-title">Images</span>
          <span className="ai-plus-hint">Attach photos to this chat</span>
        </span>
      </button>
      <button
        type="button"
        role="menuitem"
        className="ai-plus-item"
        onClick={() => {
          setAttachMenuOpen(false);
          onClose();
          navigate('/documents');
        }}
      >
        <PlusMenuDocumentsIcon className="ai-plus-icon" />
        <span className="ai-plus-copy">
          <span className="ai-plus-title">Documents</span>
          <span className="ai-plus-hint">Open the documents folder</span>
        </span>
      </button>
      <div className="ai-plus-divider" />
      <p className="ai-plus-section">Client links</p>
      <button
        type="button"
        role="menuitem"
        className="ai-plus-item"
        onClick={() => void insertCrmDocumentLink('contract')}
      >
        <DocumentCheckIcon className="ai-plus-icon ai-plus-icon-muted" />
        <span className="ai-plus-copy">
          <span className="ai-plus-title">Contract</span>
          <span className="ai-plus-hint">Insert this client’s signing link</span>
        </span>
      </button>
      <button
        type="button"
        role="menuitem"
        className="ai-plus-item"
        onClick={() => void insertCrmDocumentLink('poa')}
      >
        <DocumentTextIcon className="ai-plus-icon ai-plus-icon-muted" />
        <span className="ai-plus-copy">
          <span className="ai-plus-title">POA</span>
          <span className="ai-plus-hint">Insert this client’s POA link</span>
        </span>
      </button>
      <button
        type="button"
        role="menuitem"
        className="ai-plus-item"
        onClick={() => void insertClientPortalLink()}
      >
        <LinkIcon className="ai-plus-icon ai-plus-icon-muted" />
        <span className="ai-plus-copy">
          <span className="ai-plus-title">Portal</span>
          <span className="ai-plus-hint">Insert this client’s portal link</span>
        </span>
      </button>
      <div className="ai-plus-divider" />
      <p className="ai-plus-section">Quick asks</p>
      {READY_ASKS.map(({ label, hint, prompt, Icon }) => (
        <button
          key={label}
          type="button"
          role="menuitem"
          className="ai-plus-item"
          onClick={() => {
            setAttachMenuOpen(false);
            handleQuickAction(prompt, label);
          }}
        >
          <Icon className="ai-plus-icon ai-plus-icon-muted" />
          <span className="ai-plus-copy">
            <span className="ai-plus-title">{label}</span>
            <span className="ai-plus-hint">{hint}</span>
          </span>
        </button>
      ))}
    </>
  );

  if (!isOpen) return null;

  return (
    <>
    <div
      ref={panelRef}
      className={`ai-chat-panel ${isPlacedPanel || isMovingPanel || isResizingPanel || hasCustomSize ? '' : `ai-drawer-enter ${isFloatingPanel ? 'ai-drawer-enter-float' : 'ai-drawer-enter-sheet'}`} fixed z-[10050] flex flex-col overflow-hidden ${isDragActive ? 'ring-4 ring-primary/40' : ''} ${
          isFullPage || isMobile
          ? 'inset-0 h-[100dvh] w-full max-w-none'
          : hasCustomSize
            ? (isPlacedPanel ? '' : 'right-3 top-3')
          : isPlacedPanel
            ? `w-full ${showHistoryPanel ? 'max-w-5xl' : 'max-w-2xl'}`
          : isFloatingPanel
            ? `right-3 top-3 bottom-3 w-full ${showHistoryPanel ? 'max-w-5xl' : 'max-w-2xl'}`
            : `right-0 top-0 bottom-0 w-full ${showHistoryPanel ? 'max-w-5xl' : 'max-w-2xl'}`
      } ${isDarkTheme ? 'ai-drawer-dark' : 'ai-drawer-light'} ${isFullPage || isMobile ? 'ai-drawer-fullpage' : ''} ${isMovingPanel || isResizingPanel ? 'ai-drawer-moving' : ''}`}
      style={{ 
        height: isFullPage || isMobile
          ? '100dvh'
          : hasCustomSize && panelSize
          ? panelSize.height
          : isPlacedPanel ? 'calc(100dvh - 1.5rem)' : isFloatingPanel ? undefined : '100dvh', 
        minHeight: isFullPage || isMobile
          ? '100dvh'
          : isFloatingPanel && !hasCustomSize ? undefined : hasCustomSize ? undefined : '100dvh', 
        maxHeight: isFullPage || isMobile
          ? '100dvh'
          : hasCustomSize ? undefined : isFloatingPanel ? 'calc(100dvh - 1.5rem)' : '100dvh', 
        borderRadius: isFullPage || isMobile ? 0 : isFloatingPanel ? '1.5rem' : 0,
        width: isFullPage || isMobile ? '100%' : undefined,
        ...(hasCustomSize && panelSize && !isMobile ? { width: panelSize.width } : {}),
        ...(isPlacedPanel && panelPos
          ? { left: panelPos.left, top: panelPos.top, right: 'auto', bottom: 'auto' }
          : {}),
      }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <style>{`
        .ai-drawer-enter {
          will-change: transform, opacity;
          box-shadow: 0 28px 80px rgba(0, 0, 0, 0.38);
        }
        .ai-drawer-enter-float {
          animation: ai-drawer-float-in 420ms cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        .ai-drawer-enter-sheet {
          animation: ai-drawer-sheet-in 400ms cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        .ai-drawer-moving {
          box-shadow: 0 28px 80px rgba(0, 0, 0, 0.38);
          transition: none;
          user-select: none;
        }
        .ai-expand-drag {
          touch-action: none;
          cursor: grab;
        }
        .ai-expand-drag:active,
        .ai-drawer-moving .ai-expand-drag {
          cursor: grabbing;
        }
        .ai-resize-handle {
          position: absolute;
          z-index: 40;
          width: 44px;
          height: 44px;
          padding: 0;
          border: 0;
          background: transparent;
          touch-action: none;
        }
        .ai-resize-nw,
        .ai-resize-ne {
          z-index: 60;
          width: 18px;
          height: 18px;
        }
        .ai-resize-handle::before {
          content: '';
          position: absolute;
          width: 11px;
          height: 11px;
          border: 2px solid currentColor;
          opacity: 0;
          transition: opacity 120ms ease;
        }
        .ai-resize-handle:hover::before,
        .ai-resize-handle:active::before,
        .ai-resize-handle:focus-visible::before {
          opacity: 0.75;
        }
        .ai-resize-nw { top: 0; left: 0; cursor: nwse-resize; }
        .ai-resize-ne { top: 0; right: 0; cursor: nesw-resize; }
        .ai-resize-se { bottom: 0; right: 0; cursor: nwse-resize; }
        .ai-resize-sw { bottom: 0; left: 0; cursor: nesw-resize; }
        .ai-resize-nw::before {
          top: 5px;
          left: 5px;
          border-right: 0;
          border-bottom: 0;
          border-radius: 3px 0 0 0;
        }
        .ai-resize-ne::before {
          top: 5px;
          right: 5px;
          border-left: 0;
          border-bottom: 0;
          border-radius: 0 3px 0 0;
        }
        .ai-resize-se::before {
          bottom: 8px;
          right: 8px;
          border-left: 0;
          border-top: 0;
          border-radius: 0 0 3px 0;
        }
        .ai-resize-sw::before {
          bottom: 8px;
          left: 8px;
          border-right: 0;
          border-top: 0;
          border-radius: 0 0 0 3px;
        }
        .ai-messages-scroll {
          scrollbar-width: none;
          -ms-overflow-style: none;
          container-type: inline-size;
          container-name: ai-messages;
        }
        .ai-messages-scroll::-webkit-scrollbar {
          display: none;
        }
        @keyframes ai-drawer-float-in {
          from {
            opacity: 0;
            transform: translate3d(28px, 0, 0) scale(0.96);
          }
          to {
            opacity: 1;
            transform: translate3d(0, 0, 0) scale(1);
          }
        }
        @keyframes ai-drawer-sheet-in {
          from {
            opacity: 0.88;
            transform: translate3d(0, 18%, 0);
          }
          to {
            opacity: 1;
            transform: translate3d(0, 0, 0);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .ai-drawer-enter-float,
          .ai-drawer-enter-sheet {
            animation: none;
          }
        }
        .ai-plus-menu {
          top: calc(4.1rem + max(1rem, env(safe-area-inset-top, 0px)) + 0.35rem);
          max-height: calc(100% - 4.1rem - max(1rem, env(safe-area-inset-top, 0px)) - 6.4rem);
          overflow-y: auto;
          overscroll-behavior: contain;
          border: 0;
          outline: 0;
          box-shadow: none;
          scrollbar-width: thin;
        }
        .ai-plus-menu:focus,
        .ai-plus-menu:focus-visible {
          outline: 0;
          box-shadow: none;
        }
        .ai-plus-item {
          display: flex;
          width: 100%;
          align-items: center;
          gap: 0.75rem;
          padding: 0.65rem 0.75rem;
          text-align: left;
        }
        .ai-plus-item:hover {
          background: #f9fafb;
        }
        .ai-plus-icon {
          width: 1.25rem;
          height: 1.25rem;
          flex-shrink: 0;
        }
        .ai-plus-icon-muted {
          color: #6b7280;
        }
        .ai-plus-copy {
          min-width: 0;
          line-height: 1.35;
        }
        .ai-plus-title {
          font-size: 0.875rem;
          font-weight: 500;
          color: #111827;
        }
        .ai-plus-hint {
          margin-left: 0.25rem;
          font-size: 0.75rem;
          color: #6b7280;
        }
        .ai-plus-section {
          padding: 0.35rem 0.75rem 0.25rem;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: #9ca3af;
        }
        .ai-plus-divider {
          margin: 0.25rem 0;
          border-top: 1px solid #f3f4f6;
        }
        .ai-drawer-light {
          --ai-bg: #f9fafb;
          --ai-bg-raised: #ffffff;
          --ai-bg-overlay: #f3f4f6;
          --ai-bg-input: #ffffff;
          --ai-border: #e5e7eb;
          --ai-text: #111827;
          --ai-text-muted: #6b7280;
          --ai-bubble-user: linear-gradient(90deg, #6366f1 0%, #38bdf8 100%);
          --ai-bubble-user-text: #ffffff;
          --ai-bubble-ai: #ffffff;
          --ai-bubble-ai-text: #1f2937;
          --ai-send: linear-gradient(90deg, #6366f1 0%, #38bdf8 100%);
          --ai-send-from: #6366f1;
          --ai-send-to: #38bdf8;
          --ai-header-bg: rgba(255, 255, 255, 0.42);
          --ai-header-border: rgba(255, 255, 255, 0.45);
          box-shadow: 0 28px 80px rgba(0, 0, 0, 0.38);
          transition: width 220ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .ai-drawer-dark {
          --ai-bg: #121316;
          --ai-bg-raised: #1c1e22;
          --ai-bg-overlay: #26282e;
          --ai-bg-input: #2a2c32;
          --ai-border: #3a3d45;
          --ai-text: #f0f0f2;
          --ai-text-muted: #9a9da6;
          --ai-bubble-user: linear-gradient(90deg, #5b21b6 0%, #4f46e5 58%, #1d4ed8 100%);
          --ai-bubble-user-text: #ffffff;
          --ai-bubble-ai: #2a2c32;
          --ai-bubble-ai-text: #e6e7eb;
          --ai-send: linear-gradient(90deg, #7c3aed 0%, #4f46e5 100%);
          --ai-send-from: #7c3aed;
          --ai-send-to: #4f46e5;
          --ai-header-bg: rgba(42, 44, 50, 0.62);
          --ai-header-border: rgba(42, 44, 50, 0.35);
          border-left: 1px solid #2a2c32;
          box-shadow: 0 28px 80px rgba(0, 0, 0, 0.5);
          transition: width 220ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .ai-drawer-fullpage {
          box-shadow: none !important;
          border-left: none !important;
        }
        .ai-glass,
        .ai-glass-fullpage {
          background: var(--ai-bg);
          color: var(--ai-text);
          box-shadow: none;
          border-radius: inherit;
          overflow: hidden;
        }
        .ai-bubble-user {
          background: var(--ai-bubble-user);
          color: var(--ai-bubble-user-text);
          border-bottom-right-radius: 2rem !important;
          border-top-left-radius: 2rem !important;
        }
        .ai-bubble-assistant {
          background: transparent;
          color: var(--ai-bubble-ai-text);
          border: none;
          box-shadow: none;
          outline: none;
          border-radius: 0;
          padding: 0.15rem 0.15rem 0.25rem;
        }
        .ai-meeting-stack {
          display: flex;
          flex-direction: column;
          gap: 0.7rem;
          margin-top: 0.15rem;
        }
        .ai-meeting-card {
          border-radius: 1rem;
          padding: 0.95rem 1.05rem 1rem;
          text-align: left;
        }
        .ai-drawer-light .ai-meeting-card {
          background: #ffffff;
          border: 0;
          box-shadow: none;
        }
        .ai-drawer-dark .ai-meeting-card {
          background: #32343a;
          border: 0;
          box-shadow: none;
        }
        .ai-sources-box {
          margin-top: 0.75rem;
          border: 0;
          border-radius: 1rem;
          padding: 0.9rem 1rem 0.85rem;
          outline: none;
          box-shadow: none;
        }
        .ai-drawer-light .ai-sources-box {
          background: #ffffff;
          color: #1f2937;
        }
        .ai-drawer-dark .ai-sources-box {
          background: #32343a;
          color: #e6e7eb;
        }
        .ai-sources-kicker {
          margin-bottom: 0.55rem;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          opacity: 0.48;
        }
        .ai-sources-item {
          display: flex;
          align-items: flex-start;
          gap: 0.55rem;
          min-width: 0;
          text-decoration: none;
          color: inherit;
        }
        .ai-drawer-light a.ai-sources-item,
        .ai-drawer-light a.ai-sources-item .ai-sources-link {
          color: #1e3a8a;
        }
        .ai-drawer-dark a.ai-sources-item,
        .ai-drawer-dark a.ai-sources-item .ai-sources-link {
          color: #93c5fd;
        }
        .ai-sources-favicon {
          width: 1.75rem;
          height: 1.75rem;
          margin-top: 0.1rem;
          border-radius: 999px;
          object-fit: cover;
          flex-shrink: 0;
          background: rgba(15, 23, 42, 0.04);
          border: 1px solid rgba(15, 23, 42, 0.08);
        }
        .ai-drawer-dark .ai-sources-favicon {
          background: rgba(255, 255, 255, 0.06);
          border-color: rgba(255, 255, 255, 0.1);
        }
        .ai-sources-favicon.is-fallback {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: #6b7280;
        }
        .ai-drawer-dark .ai-sources-favicon.is-fallback {
          color: #c5c8d0;
        }
        .ai-sources-favicon.is-fallback svg {
          width: 1.05rem;
          height: 1.05rem;
        }
        .ai-sources-copy {
          min-width: 0;
          flex: 1;
        }
        .ai-sources-link {
          display: block;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 0.875rem;
          font-weight: 600;
          text-decoration: none;
          color: inherit;
        }
        .ai-sources-item:hover .ai-sources-link {
          text-decoration: underline;
        }
        .ai-sources-meta {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 11px;
          opacity: 0.5;
        }
        .ai-sources-actions {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 0.4rem;
          margin-top: 0.85rem;
        }
        .ai-sources-save-icon,
        .ai-sources-saved {
          margin-left: auto;
        }
        .ai-sources-saved {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          height: 2.15rem;
          font-size: 12px;
          font-weight: 650;
          line-height: 1;
          color: #9ca3af;
        }
        .ai-drawer-dark .ai-sources-saved {
          color: #8b8e96;
        }
        .ai-sources-saved svg {
          fill: currentColor;
        }
        .ai-sources-save-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 0.35rem;
          height: 2.15rem;
          padding: 0;
          border: 0;
          background: transparent;
          color: inherit;
          font-size: 12px;
          font-weight: 650;
          line-height: 1;
          opacity: 0.55;
          cursor: pointer;
        }
        .ai-sources-save-icon:hover {
          opacity: 0.9;
        }
        .ai-sources-save-icon.is-on {
          opacity: 1;
          color: var(--ai-send-from);
        }
        .ai-sources-save-icon.is-on svg,
        .ai-sources-save-icon.is-on svg path {
          fill: url(#ai-sources-send-grad);
        }
        .ai-sources-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          box-sizing: border-box;
          height: 2.15rem;
          min-height: 2.15rem;
          gap: 0.35rem;
          border: 0;
          border-radius: 999px;
          padding: 0 0.85rem;
          font-size: 12px;
          font-weight: 650;
          letter-spacing: 0.01em;
          line-height: 1;
          cursor: pointer;
          transition: transform 120ms ease, filter 120ms ease, background 120ms ease, color 120ms ease;
        }
        .ai-sources-btn-useful,
        .ai-sources-btn-wrong {
          background: transparent;
        }
        .ai-sources-btn-useful {
          color: #047857;
        }
        .ai-sources-btn-wrong {
          color: #be123c;
        }
        .ai-sources-btn-useful:hover,
        .ai-sources-btn-useful.is-on {
          background: rgba(16, 185, 129, 0.16);
        }
        .ai-sources-btn-useful.is-on {
          background: rgba(16, 185, 129, 0.2);
          color: #047857;
        }
        .ai-sources-btn-wrong:hover,
        .ai-sources-btn-wrong.is-on {
          background: rgba(244, 63, 94, 0.14);
        }
        .ai-sources-btn-wrong.is-on {
          background: rgba(244, 63, 94, 0.18);
          color: #be123c;
        }
        .ai-sources-form .ai-sources-btn-save {
          background: var(--ai-send);
          color: #fff;
        }
        .ai-drawer-dark .ai-sources-btn-useful {
          background: transparent;
          color: #6ee7b7;
        }
        .ai-drawer-dark .ai-sources-btn-wrong {
          background: transparent;
          color: #fda4af;
        }
        .ai-drawer-dark .ai-sources-btn-useful:hover,
        .ai-drawer-dark .ai-sources-btn-useful.is-on {
          background: rgba(52, 211, 153, 0.16);
        }
        .ai-drawer-dark .ai-sources-btn-useful.is-on {
          background: rgba(52, 211, 153, 0.22);
          color: #6ee7b7;
        }
        .ai-drawer-dark .ai-sources-btn-wrong:hover,
        .ai-drawer-dark .ai-sources-btn-wrong.is-on {
          background: rgba(251, 113, 133, 0.16);
        }
        .ai-drawer-dark .ai-sources-btn-wrong.is-on {
          background: rgba(251, 113, 133, 0.22);
          color: #fda4af;
        }
        .ai-sources-hint {
          margin-top: 0.55rem;
          font-size: 11px;
          opacity: 0.45;
        }
        .ai-sources-form {
          margin-top: 0.75rem;
          border: 0;
          border-radius: 0.85rem;
          padding: 0.75rem;
        }
        .ai-drawer-light .ai-sources-form {
          background: #ffffff;
        }
        .ai-drawer-dark .ai-sources-form {
          background: #26282e;
        }
        .ai-sources-form input,
        .ai-sources-form select {
          border: 0;
          border-radius: 0.65rem;
          background: rgba(0, 0, 0, 0.05);
        }
        .ai-drawer-dark .ai-sources-form input,
        .ai-drawer-dark .ai-sources-form select {
          background: #1c1e22;
          color: #e6e7eb;
        }
        .ai-meeting-card-head {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 0.75rem;
          margin-bottom: 0.7rem;
        }
        .ai-meeting-card-title {
          font-size: 0.72rem;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--ai-text-muted);
        }
        .ai-meeting-card-lead {
          display: inline-flex;
          align-items: center;
          gap: 0.4rem;
          min-width: 0;
          font-size: 0.8rem;
        }
        .ai-meeting-card-name {
          color: var(--ai-text-muted);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          max-width: 9rem;
        }
        .ai-meeting-body {
          display: flex;
          flex-direction: column;
          gap: 0.55rem;
        }
        .ai-meeting-when {
          display: flex;
          align-items: center;
          gap: 0.4rem;
          font-size: 0.95rem;
          font-weight: 600;
          color: var(--ai-text);
        }
        .ai-meeting-field-label {
          font-size: 0.68rem;
          font-weight: 700;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: var(--ai-text-muted);
          margin-bottom: 0.15rem;
        }
        .ai-meeting-field-value {
          font-size: 0.875rem;
          line-height: 1.5;
          color: var(--ai-text);
          white-space: pre-wrap;
        }
        .ai-meeting-field-rtl .ai-meeting-field-label,
        .ai-meeting-field-rtl .ai-meeting-field-value {
          text-align: right;
        }
        .ai-meeting-empty {
          margin: 0;
          font-size: 0.875rem;
          color: var(--ai-text-muted);
        }
        .ai-signed-card {
          overflow: hidden;
        }
        .ai-fullwidth-card-stack {
          width: 100%;
          max-width: none;
        }
        .ai-fullwidth-card-stack .ai-meeting-card {
          width: 100%;
        }
        .ai-signed-table td.ai-signed-paid,
        .ai-signed-table th.ai-signed-paid {
          padding-left: 1rem;
          white-space: nowrap;
          color: var(--ai-text-muted);
          font-variant-numeric: tabular-nums;
        }
        .ai-signed-table-wrap {
          overflow-x: auto;
          margin: 0 -0.15rem;
        }
        .ai-signed-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.875rem;
        }
        .ai-presence-employee {
          display: inline-flex;
          align-items: center;
          gap: 0.55rem;
          min-width: 0;
        }
        .ai-presence-photo {
          border-radius: 9999px;
          object-fit: cover;
        }
        .ai-signed-table th {
          font-size: 0.68rem;
          font-weight: 700;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: var(--ai-text-muted);
          text-align: left;
          padding: 0 0.65rem 0.5rem 0;
          white-space: nowrap;
        }
        .ai-signed-table td {
          padding: 0.5rem 0.65rem 0.5rem 0;
          color: var(--ai-text);
          vertical-align: middle;
          border-top: 1px solid rgba(148, 163, 184, 0.18);
        }
        .ai-drawer-dark .ai-signed-table td {
          border-top-color: rgba(255, 255, 255, 0.08);
        }
        .ai-signed-table th.ai-signed-value,
        .ai-signed-table td.ai-signed-value {
          text-align: right;
          padding-right: 0;
          white-space: nowrap;
          font-variant-numeric: tabular-nums;
        }
        .ai-signed-footer {
          display: flex;
          justify-content: space-between;
          gap: 0.75rem;
          margin-top: 0.7rem;
          font-size: 0.78rem;
          font-weight: 600;
          color: var(--ai-text-muted);
        }
        .ai-lead-roles-grid {
          display: grid !important;
          grid-template-columns: 1fr 1fr 1fr !important;
          gap: 0.7rem;
          width: 100%;
        }
        .ai-lead-role-cell.ai-meeting-card {
          display: flex;
          flex-direction: row;
          align-items: center;
          justify-content: space-between;
          gap: 0.65rem;
          min-width: 0;
          padding: 0.75rem 0.8rem 0.8rem;
        }
        .ai-lead-role-main {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 0.35rem;
          min-width: 0;
          flex: 1;
        }
        .ai-lead-role-photo,
        .ai-lead-role-photo-fallback {
          height: 2.85rem;
          width: 2.85rem;
          flex-shrink: 0;
          margin-left: auto;
          border-radius: 9999px;
          object-fit: cover;
        }
        .ai-lead-role-photo-fallback {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 0.72rem;
          font-weight: 700;
          color: #fff;
        }
        .ai-lead-role-title {
          display: inline-flex;
          align-items: center;
          gap: 0.45rem;
          width: auto;
          flex-shrink: 0;
          font-size: 0.68rem;
          font-weight: 700;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: var(--ai-text-muted);
        }
        .ai-lead-role-icon {
          height: 1.65rem;
          width: 1.65rem;
          flex-shrink: 0;
        }
        .ai-lead-role-name {
          min-width: 0;
          max-width: 100%;
          color: var(--ai-text);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .ai-lead-summary-text {
          font-size: 0.9375rem;
          line-height: 1.6;
        }
        .ai-lead-case-about {
          font-size: 1.0625rem;
          line-height: 1.75;
          padding: 0.15rem 0 0.35rem;
        }
        .ai-lead-summary-text .ai-chat-msg-text,
        .ai-lead-risks .ai-chat-msg-text,
        .ai-lead-case-about .ai-chat-msg-text {
          margin: 0;
        }
        .ai-lead-summary-text .ai-chat-msg-text > :first-child,
        .ai-lead-risks .ai-chat-msg-text > :first-child,
        .ai-lead-case-about .ai-chat-msg-text > :first-child {
          margin-top: 0;
        }
        .ai-lead-summary-text .ai-chat-msg-text > :last-child,
        .ai-lead-risks .ai-chat-msg-text > :last-child,
        .ai-lead-case-about .ai-chat-msg-text > :last-child {
          margin-bottom: 0;
        }
        .ai-lead-risks {
          border: 0;
          outline: 0;
          box-shadow: none;
          border-radius: 0.85rem;
          padding: 0.75rem 0.95rem;
          background: rgba(248, 113, 113, 0.16);
          color: var(--ai-text);
        }
        .ai-lead-risks .ai-meeting-card-title {
          margin-bottom: 0.45rem;
        }
        .ai-lead-case-about .ai-meeting-card-title {
          font-size: 0.8rem;
          letter-spacing: 0.07em;
          margin-bottom: 0.6rem;
        }
        .ai-drawer-light .ai-lead-risks {
          background: rgba(248, 113, 113, 0.14);
        }
        .ai-drawer-dark .ai-lead-risks {
          background: rgba(248, 113, 113, 0.18);
        }
        .ai-cal-meeting-stack {
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          gap: 0.55rem;
          margin-top: 0.45rem;
        }
        .ai-cal-meeting-row {
          display: flex;
          flex-direction: row;
          flex-wrap: nowrap;
          align-items: stretch;
          gap: 0.5rem;
          width: 100%;
          min-width: 0;
        }
        .ai-cal-meeting-row .ai-cal-meeting-card {
          flex: 1 1 0;
          min-width: 0;
          overflow: hidden;
        }
        .ai-cal-meeting-card {
          position: relative;
          display: flex;
          flex-direction: column;
          padding: 0.85rem 0.95rem 0.9rem;
          overflow: hidden;
        }
        .ai-cal-meeting-more {
          display: none;
        }
        .ai-cal-meeting-details {
          flex: 0 0 10.5rem;
          width: 10.5rem;
          min-width: 10.5rem;
          padding: 0.75rem 0.85rem;
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 0.55rem;
          overflow: hidden;
        }
        .ai-cal-meeting-detail {
          display: flex;
          flex-direction: column;
          gap: 0.08rem;
          min-width: 0;
        }
        .ai-cal-meeting-detail-label {
          font-size: 0.72rem !important;
          font-weight: 500;
          letter-spacing: 0.02em;
          color: var(--ai-text-muted);
          opacity: 0.72;
        }
        .ai-cal-meeting-detail-value {
          font-size: 0.9rem !important;
          font-weight: 600;
          line-height: 1.3;
          color: var(--ai-text);
          word-break: break-word;
        }
        .ai-cal-meeting-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.45rem 0.65rem;
          min-width: 0;
        }
        .ai-cal-meeting-when {
          display: flex;
          align-items: center;
          gap: 0.4rem;
          min-width: 0;
          flex: 1 1 auto;
        }
        .ai-cal-meeting-time {
          font-size: 1.15rem !important;
          font-weight: 700;
          letter-spacing: -0.02em;
          font-variant-numeric: tabular-nums;
          color: var(--ai-text);
          flex-shrink: 0;
        }
        .ai-cal-meeting-loc {
          display: inline-flex;
          align-items: center;
          gap: 0.28rem;
          min-width: 0;
          font-size: 0.9rem !important;
          font-weight: 500;
          color: var(--ai-text-muted);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .ai-cal-meeting-loc-icon {
          width: 1.25rem;
          height: 1.25rem;
          flex-shrink: 0;
        }
        .ai-cal-meeting-lead {
          font-size: 0.9rem !important;
          font-weight: 600;
          flex: 0 0 auto;
          white-space: nowrap;
        }
        .ai-cal-meeting-name {
          margin-top: 0.2rem;
          font-size: 1.05rem !important;
          font-weight: 600;
          line-height: 1.35;
          color: var(--ai-text);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .ai-cal-meeting-stage {
          margin-top: 0.28rem;
          display: flex;
          align-items: center;
          min-width: 0;
        }
        .ai-cal-meeting-stage-badge {
          max-width: 100%;
          font-weight: 600;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .ai-cal-meeting-footer {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 0.75rem;
          width: 100%;
          margin-top: auto;
          padding-top: 0.75rem;
        }
        .ai-cal-meeting-crew {
          flex: 0 1 auto;
          width: fit-content;
          max-width: 100%;
          min-width: 0;
          border: 0;
          border-radius: 0.8rem;
          padding: 0.45rem 0.6rem;
        }
        .ai-drawer-light .ai-cal-meeting-crew {
          background: #f7f8f9;
        }
        .ai-drawer-dark .ai-cal-meeting-crew {
          background: #2f3137;
        }
        .ai-cal-meeting-people {
          display: flex;
          flex-wrap: wrap;
          align-items: flex-start;
          gap: 0.7rem 1.15rem;
          min-width: 0;
          font-size: 0.9rem !important;
          color: var(--ai-text-muted);
        }
        .ai-cal-meeting-participants {
          display: grid;
          grid-template-columns: repeat(2, max-content);
          gap: 0.4rem 0.85rem;
          min-width: 0;
          font-size: 0.9rem !important;
          color: var(--ai-text-muted);
        }
        .ai-cal-meeting-participant {
          min-width: 0;
        }
        .ai-cal-meeting-person {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 0.18rem;
          min-width: 0;
        }
        .ai-cal-meeting-role {
          font-size: 0.7rem !important;
          font-weight: 500;
          letter-spacing: 0.02em;
          color: var(--ai-text-muted);
          opacity: 0.72;
        }
        .ai-cal-meeting-join {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 0.35rem;
          margin-left: auto;
          flex-shrink: 0;
          height: 2.35rem;
          padding: 0 1.05rem;
          border: 0;
          border-radius: 9999px;
          font-size: 0.875rem;
          font-weight: 700;
          color: #fff !important;
          text-decoration: none !important;
        }
        .ai-cal-meeting-join:hover {
          color: #fff !important;
          filter: brightness(1.08);
        }
        .ai-bubble-assistant .ai-cal-meeting-join,
        .ai-bubble-assistant .ai-cal-meeting-join:hover,
        .ai-drawer-dark .ai-bubble-assistant .ai-cal-meeting-join,
        .ai-drawer-dark .ai-bubble-assistant .ai-cal-meeting-join:hover {
          color: #fff !important;
          font-size: 0.875rem !important;
          line-height: 1 !important;
          text-decoration: none !important;
        }
        .ai-bubble-thinking {
          padding-top: 0.85rem;
          padding-bottom: 0.85rem;
        }
        .ai-bubble-copy {
          position: relative;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          margin-top: 0.45rem;
          width: 2.35rem;
          height: 2.35rem;
          border: 0;
          border-radius: 9999px;
          background: transparent;
          color: var(--ai-text-muted);
          cursor: pointer;
        }
        .ai-bubble-copy svg {
          width: 1.35rem;
          height: 1.35rem;
        }
        .ai-bubble-copy:hover {
          background: var(--ai-bg-overlay);
          color: var(--ai-text);
        }
        .ai-bubble-copy.is-liked {
          color: #059669;
        }
        .ai-bubble-copy.is-disliked {
          color: #e11d48;
        }
        .ai-bubble-copy.is-liked svg.thumb-main,
        .ai-bubble-copy.is-disliked svg.thumb-main {
          animation: ai-thumb-pop 0.38s cubic-bezier(0.22, 1.4, 0.36, 1);
        }
        @keyframes ai-thumb-pop {
          0% { transform: scale(0.55); }
          55% { transform: scale(1.28); }
          100% { transform: scale(1); }
        }
        .ai-thumb-burst {
          position: absolute;
          left: 50%;
          bottom: calc(100% - 0.15rem);
          margin: 0;
          pointer-events: none;
          animation: ai-thumb-float 0.7s ease-out forwards;
        }
        .ai-thumb-burst svg {
          width: 0.95rem;
          height: 0.95rem;
        }
        @keyframes ai-thumb-float {
          0% { opacity: 1; transform: translateX(-50%) translateY(6px) scale(0.55); }
          100% { opacity: 0; transform: translateX(-50%) translateY(-16px) scale(1.2); }
        }
        .ai-bubble-copy:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        
        .ai-bubble-user,
        .ai-bubble-assistant,
        .ai-chat-msg-text,
        .ai-bubble-user p,
        .ai-bubble-assistant p,
        .ai-bubble-user li,
        .ai-bubble-assistant li {
          font-size: 0.9375rem !important;
          line-height: 1.6 !important;
        }
        .ai-bubble-assistant .prose,
        .ai-bubble-user .prose {
          font-size: 0.9375rem !important;
          line-height: 1.6 !important;
        }
        @media (max-width: 768px) {
          .ai-bubble-user,
          .ai-bubble-assistant,
          .ai-chat-msg-text,
          .ai-bubble-user p,
          .ai-bubble-assistant p,
          .ai-bubble-user li,
          .ai-bubble-assistant li,
          .ai-bubble-assistant .prose,
          .ai-bubble-user .prose,
          .ai-bubble-assistant .prose p,
          .ai-bubble-user .prose p,
          .ai-bubble-assistant .prose li,
          .ai-bubble-user .prose li {
            font-size: 1.25rem !important;
            line-height: 1.65 !important;
          }
        }
        .ai-bubble-assistant .prose {
          color: var(--ai-bubble-ai-text);
        }
        .ai-bubble-user .prose,
        .ai-bubble-user .prose p,
        .ai-bubble-user .prose li,
        .ai-bubble-user .prose strong {
          color: var(--ai-bubble-user-text);
        }
        .ai-bubble-user .chat-lead-number-link {
          color: var(--ai-bubble-user-text) !important;
          text-decoration: underline;
        }
        .ai-bubble-assistant .chat-lead-number-link,
        .ai-bubble-assistant .ai-chat-link,
        .ai-bubble-assistant a {
          color: #0284c7;
        }
        .ai-bubble-assistant .ai-chat-link:hover,
        .ai-bubble-assistant a:hover {
          color: #0ea5e9;
        }
        .ai-drawer-dark .ai-bubble-assistant .chat-lead-number-link,
        .ai-drawer-dark .ai-bubble-assistant .ai-chat-link,
        .ai-drawer-dark .ai-bubble-assistant a {
          color: #0ea5e9;
        }
        .ai-drawer-dark .ai-bubble-assistant .ai-chat-link:hover,
        .ai-drawer-dark .ai-bubble-assistant a:hover {
          color: #38bdf8;
        }
        
        .ai-bubble-assistant .prose p {
          margin-top: 0.75rem;
          margin-bottom: 0.75rem;
        }
        
        .ai-bubble-assistant .prose ul,
        .ai-bubble-assistant .prose ol {
          margin-top: 0.5rem;
          margin-bottom: 0.5rem;
          padding-left: 1.5rem;
        }
        
        .ai-bubble-assistant .prose li {
          margin-top: 0.25rem;
          margin-bottom: 0.25rem;
        }
        
        .ai-bubble-assistant .prose strong {
          font-weight: 600;
          color: var(--ai-text);
        }
        
        .ai-bubble-assistant .prose code {
          background-color: var(--ai-bg-overlay);
          padding: 0.125rem 0.375rem;
          border-radius: 0.25rem;
          font-size: 0.875em;
          font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
        }
        .ai-quick-btn {
          border-radius: 9999px;
          font-weight: 600;
          padding: 0.25rem 1.1rem;
          font-size: 0.95rem;
          transition: background 0.2s, color 0.2s;
        }

        .contract-ai-input-area {
          background: transparent;
          box-shadow: none;
        }
        .ai-input-backdrop {
          pointer-events: none;
          position: absolute;
          left: 0;
          right: 0;
          bottom: 0;
          top: 1.15rem;
          z-index: 0;
          background: linear-gradient(
            to top,
            rgba(249, 250, 251, 0.28) 0%,
            rgba(249, 250, 251, 0.08) 62%,
            rgba(249, 250, 251, 0) 100%
          );
          -webkit-backdrop-filter: blur(2px);
          backdrop-filter: blur(2px);
          -webkit-mask-image: linear-gradient(to top, black 0%, black 62%, transparent 100%);
          mask-image: linear-gradient(to top, black 0%, black 62%, transparent 100%);
        }
        .ai-drawer-dark .ai-input-backdrop {
          background: linear-gradient(
            to top,
            rgba(18, 19, 22, 0.32) 0%,
            rgba(18, 19, 22, 0.1) 62%,
            rgba(18, 19, 22, 0) 100%
          );
        }
        .contract-ai-input-area > :not(.ai-input-backdrop) {
          position: relative;
          z-index: 1;
        }
        .contract-ai-input-shell {
          border-radius: 9999px;
          min-height: 3.25rem;
          background: var(--ai-bg-input);
          border: 1px solid var(--ai-border);
          box-shadow: 0 10px 32px rgba(15, 23, 42, 0.1);
        }
        .ai-drawer-dark .contract-ai-input-shell,
        .ai-drawer-dark .contract-ai-input-shell:focus-within {
          border: none;
          outline: none;
          background: var(--ai-bg-input);
          box-shadow: 0 10px 28px rgba(0, 0, 0, 0.35);
        }
        .ai-drawer-dark .contract-ai-input-area textarea,
        .ai-drawer-dark .contract-ai-input-area textarea:focus {
          outline: none;
          box-shadow: none;
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
          color: var(--ai-text);
          text-align: start;
          min-height: 1.5rem;
          height: 1.5rem;
          padding-top: 0;
          padding-bottom: 0;
          line-height: 1.5rem;
        }
        .contract-ai-input-area textarea::placeholder {
          text-align: start;
          line-height: 1.5rem;
        }
        .contract-ai-input-area textarea:focus {
          outline: none;
          box-shadow: none;
        }
        .contract-ai-input-area textarea::-webkit-scrollbar {
          display: none;
        }
        .ai-history-scroll {
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
        .ai-history-scroll::-webkit-scrollbar {
          display: none;
        }
        @keyframes ai-pulse {
          0% { transform: scale(1) rotate(0deg); filter: drop-shadow(0 0 0 #fff); }
          30% { transform: scale(1.18) rotate(-10deg); filter: drop-shadow(0 0 8px #a5b4fc); }
          60% { transform: scale(0.95) rotate(8deg); filter: drop-shadow(0 0 12px #38bdf8); }
          100% { transform: scale(1) rotate(0deg); filter: drop-shadow(0 0 0 #fff); }
        }
        .ai-drawer-dark .animate-ai-pulse {
          animation: ai-pulse 0.6s cubic-bezier(.4,0,.2,1);
        }
        .animate-ai-pulse {
          animation: ai-pulse 0.6s cubic-bezier(.4,0,.2,1);
        }
        .ai-thinking {
          display: inline-flex;
          align-items: center;
          gap: 0.7rem;
          min-height: 1.65rem;
        }
        .ai-thinking-ring {
          width: 1.4rem;
          height: 1.4rem;
          flex-shrink: 0;
          border-radius: 9999px;
          background: conic-gradient(from 90deg, #818cf8, #38bdf8, #c084fc, #818cf8);
          animation: ai-thinking-spin 0.9s linear infinite;
          -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 2.5px), #000 0);
          mask: radial-gradient(farthest-side, transparent calc(100% - 2.5px), #000 0);
        }
        .ai-thinking-dots {
          display: inline-flex;
          align-items: center;
          gap: 0.28rem;
        }
        .ai-thinking-dots span {
          width: 0.38rem;
          height: 0.38rem;
          border-radius: 9999px;
          background: linear-gradient(180deg, #818cf8 0%, #6366f1 100%);
          animation: ai-thinking-bounce 1.05s ease-in-out infinite;
        }
        .ai-thinking-dots span:nth-child(2) { animation-delay: 0.14s; }
        .ai-thinking-dots span:nth-child(3) { animation-delay: 0.28s; }
        .ai-thinking-label {
          font-size: 0.875rem;
          font-weight: 500;
          letter-spacing: 0.01em;
          color: var(--ai-text-muted);
          animation: ai-thinking-label-in 0.28s ease;
        }
        @keyframes ai-thinking-label-in {
          from { opacity: 0; transform: translateY(3px); }
          to { opacity: 1; transform: none; }
        }
        .ai-stream-caret {
          display: inline-block;
          width: 0.12em;
          height: 1em;
          margin-left: 0.08em;
          vertical-align: -0.12em;
          background: currentColor;
          animation: ai-stream-caret 0.9s steps(1) infinite;
        }
        @keyframes ai-stream-caret {
          0%, 49% { opacity: 1; }
          50%, 100% { opacity: 0; }
        }
        .ai-send-thinking {
          width: 1.05rem;
          height: 1.05rem;
          border-radius: 9999px;
          background: conic-gradient(from 90deg, #fff, rgba(255,255,255,0.15), #fff);
          animation: ai-thinking-spin 0.85s linear infinite;
          -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 2px), #000 0);
          mask: radial-gradient(farthest-side, transparent calc(100% - 2px), #000 0);
        }
        @keyframes ai-thinking-spin {
          to { transform: rotate(360deg); }
        }
        @keyframes ai-thinking-bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.35; }
          40% { transform: translateY(-4px); opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .ai-thinking-ring,
          .ai-thinking-dots span,
          .ai-thinking-label,
          .ai-send-thinking,
          .ai-stream-caret {
            animation: none;
          }
        }
        
        /* Mobile keyboard fixes */
        @supports (height: 100dvh) {
          .mobile-dvh {
            height: 100dvh;
            min-height: 100dvh;
          }
        }
        
        /* Safe area support for mobile */
        .pb-safe {
          padding-bottom: env(safe-area-inset-bottom, 1rem);
        }
        
        /* Mobile: larger header, welcome, composer (desktop unchanged). */
        @media (max-width: 768px) {
          .ai-chat-header {
            min-height: calc(3.7rem + max(0.5rem, env(safe-area-inset-top, 0px)));
            padding-bottom: 0.55rem;
            padding-top: max(0.5rem, env(safe-area-inset-top));
          }
          .ai-chat-under-header {
            padding-top: calc(6.5rem + env(safe-area-inset-top, 0px));
          }
          .ai-msg-anchor {
            scroll-margin-top: calc(5.85rem + env(safe-area-inset-top, 0px));
          }
          .ai-header-logo {
            height: 2.75rem !important;
            width: 2.75rem !important;
          }
          .ai-header-title {
            font-size: 1.2rem !important;
            line-height: 1.2 !important;
          }
          .ai-header-beta {
            height: 1.2rem;
            padding-left: 0.45rem;
            padding-right: 0.45rem;
            font-size: 0.65rem;
          }
          .ai-header-client {
            max-width: 13rem;
            padding: 0.3rem 0.7rem;
            font-size: 0.8125rem;
          }
          .ai-theme-switch {
            width: 4.1rem;
            height: 2.4rem;
          }
          .ai-theme-knob {
            height: 1.95rem;
            width: 1.95rem;
          }
          .ai-theme-knob.is-dark {
            transform: translateX(1.7rem);
          }
          .ai-theme-knob svg {
            height: 1.1rem;
            width: 1.1rem;
          }
          .ai-close-btn,
          .ai-history-header-btn {
            height: 2.75rem;
            width: 2.75rem;
          }
          .ai-close-btn svg,
          .ai-history-header-btn svg {
            height: 1.5rem;
            width: 1.5rem;
          }
          .ai-bubble-copy {
            width: 2.85rem;
            height: 2.85rem;
          }
          .ai-bubble-copy svg {
            width: 1.65rem;
            height: 1.65rem;
          }
          .ai-drawer-dark .ai-chat-header {
            background: #121316;
            backdrop-filter: none;
            -webkit-backdrop-filter: none;
          }
          .ai-drawer-light .ai-chat-header {
            background: #f9fafb;
            backdrop-filter: none;
            -webkit-backdrop-filter: none;
          }
          .ai-sources-box {
            padding: 1.1rem 1.1rem 1rem;
          }
          .ai-sources-kicker {
            font-size: 0.75rem;
            margin-bottom: 0.7rem;
          }
          .ai-sources-item {
            gap: 0.7rem;
            margin-bottom: 0.35rem;
          }
          .ai-sources-favicon {
            width: 2.15rem;
            height: 2.15rem;
          }
          .ai-sources-favicon.is-fallback svg {
            width: 1.2rem;
            height: 1.2rem;
          }
          .ai-sources-link {
            font-size: 1.0625rem;
          }
          .ai-sources-meta {
            font-size: 0.8125rem;
          }
          .ai-sources-actions {
            gap: 0.5rem;
            margin-top: 1rem;
          }
          .ai-sources-btn,
          .ai-sources-save-icon,
          .ai-sources-saved {
            height: 2.7rem;
            min-height: 2.7rem;
            font-size: 0.9375rem;
            padding: 0 1rem;
          }
          .ai-sources-btn svg,
          .ai-sources-save-icon svg,
          .ai-sources-saved svg {
            width: 1.35rem;
            height: 1.35rem;
          }
          .ai-sources-form {
            font-size: 0.9375rem;
          }
          .ai-sources-form input,
          .ai-sources-form select {
            font-size: 1rem;
            min-height: 2.6rem;
          }
          .ai-welcome-home {
            padding-top: 1.25rem;
            padding-bottom: 1.5rem;
          }
          .ai-welcome-title {
            font-size: 1.85rem !important;
            line-height: 1.2 !important;
          }
          .ai-welcome-sub {
            font-size: 1.0625rem !important;
            line-height: 1.5 !important;
          }
          .ai-welcome-card {
            gap: 0.95rem;
            padding: 1.05rem 1.1rem;
            border-radius: 1.1rem;
          }
          .ai-welcome-card-icon {
            height: 3.25rem;
            width: 3.25rem;
            border-radius: 0.95rem;
          }
          .ai-welcome-card-icon svg {
            height: 1.7rem;
            width: 1.7rem;
          }
          .ai-welcome-card-title {
            font-size: 1.0625rem !important;
          }
          .ai-welcome-card-hint {
            font-size: 0.9375rem !important;
            margin-top: 0.2rem;
          }
          .ai-welcome-divider {
            font-size: 0.8rem;
          }
          .ai-welcome-ask {
            gap: 0.5rem;
            padding: 0.65rem 1rem;
            font-size: 1rem;
          }
          .ai-welcome-ask svg {
            height: 1.25rem;
            width: 1.25rem;
          }
          .contract-ai-input-shell {
            min-height: 4.65rem;
          }
          .contract-ai-input-area {
            padding-left: 1rem;
            padding-right: 1rem;
            padding-bottom: 1.15rem;
          }
          .ai-composer-btn {
            height: 3.25rem !important;
            width: 3.25rem !important;
            min-height: 3.25rem !important;
            min-width: 3.25rem !important;
          }
          .ai-composer-btn svg {
            height: 1.65rem;
            width: 1.65rem;
          }
          .contract-ai-input-area textarea,
          .contract-ai-input-area textarea:focus {
            font-size: 1.25rem !important;
            line-height: 1.7rem !important;
            min-height: 1.7rem;
            height: auto;
          }
          .contract-ai-input-area textarea::placeholder {
            font-size: 1.25rem !important;
            line-height: 1.7rem;
          }
        }
        
        /* Line clamp utility */
        .line-clamp-2 {
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .ai-chat-header {
          z-index: 50;
          background: var(--ai-header-bg);
          border-bottom: 1px solid var(--ai-header-border);
          box-shadow: 0 8px 32px rgba(15, 23, 42, 0.04);
          backdrop-filter: blur(22px) saturate(1.6);
          -webkit-backdrop-filter: blur(22px) saturate(1.6);
          cursor: grab;
          touch-action: none;
          user-select: none;
        }
        .ai-chat-header button,
        .ai-chat-header a {
          cursor: pointer;
          touch-action: manipulation;
        }
        .ai-drawer-moving .ai-chat-header {
          cursor: grabbing;
        }
        .ai-drawer-dark .ai-chat-header {
          border-bottom: none;
          box-shadow: none;
          background: rgba(42, 44, 50, 0.62);
          backdrop-filter: blur(20px) saturate(1.35);
          -webkit-backdrop-filter: blur(20px) saturate(1.35);
        }
        .ai-chat-under-header {
          padding-top: calc(3.15rem + max(0.5rem, env(safe-area-inset-top, 0px)));
        }
        @media (max-width: 768px) {
          .ai-chat-under-header {
            padding-top: calc(6.5rem + env(safe-area-inset-top, 0px));
          }
          .ai-msg-anchor {
            scroll-margin-top: calc(5.85rem + env(safe-area-inset-top, 0px));
          }
        }
        .ai-theme-switch {
          position: relative;
          display: inline-flex;
          width: 3.5rem;
          height: 2rem;
          flex-shrink: 0;
          cursor: pointer;
          align-items: center;
          border: none;
          border-radius: 9999px;
          background: #e6e8ec;
          padding: 0.1875rem;
          box-shadow: inset 0 1px 3px rgba(15, 23, 42, 0.12);
          transition: background 0.25s ease, box-shadow 0.25s ease, transform 0.15s ease;
        }
        .ai-theme-switch:hover {
          transform: scale(1.04);
        }
        .ai-theme-switch:active {
          transform: scale(0.98);
        }
        .ai-drawer-dark .ai-theme-switch {
          background: #3a3d45;
          box-shadow: inset 0 1px 4px rgba(0, 0, 0, 0.35);
        }
        .ai-theme-knob {
          display: flex;
          height: 1.625rem;
          width: 1.625rem;
          align-items: center;
          justify-content: center;
          border-radius: 9999px;
          background: #fff;
          box-shadow: 0 2px 6px rgba(15, 23, 42, 0.18);
          transform: translateX(0);
          transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1), background 0.25s ease, box-shadow 0.25s ease;
        }
        .ai-theme-knob.is-dark {
          background: #5c5f66;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
          transform: translateX(1.5rem);
        }
        .ai-theme-knob svg {
          height: 0.9rem;
          width: 0.9rem;
        }
        .ai-close-btn {
          position: relative;
          z-index: 50;
          display: inline-flex;
          height: 2.25rem;
          width: 2.25rem;
          flex-shrink: 0;
          align-items: center;
          justify-content: center;
          border: 0;
          border-radius: 9999px;
          background: transparent;
          cursor: pointer;
          transition: background 0.15s ease, color 0.15s ease;
        }
        .ai-drawer-light .ai-close-btn {
          color: #6b7280;
        }
        .ai-drawer-light .ai-close-btn:hover,
        .ai-drawer-light .ai-close-btn:focus-visible {
          background: #f3f4f6;
          color: #111827;
        }
        .ai-drawer-dark .ai-close-btn {
          color: #a1a1aa;
        }
        .ai-drawer-dark .ai-close-btn:hover,
        .ai-drawer-dark .ai-close-btn:focus-visible {
          background: #2a2c32;
          color: #f0f0f2;
        }
        .ai-history-header-btn {
          display: inline-flex;
          height: 2.25rem;
          width: 2.25rem;
          flex-shrink: 0;
          align-items: center;
          justify-content: center;
          border: 0;
          border-radius: 9999px;
          background: transparent;
          padding: 0;
          cursor: pointer;
          transition: background 0.15s ease, color 0.15s ease;
        }
        .ai-drawer-light .ai-history-header-btn {
          color: #6b7280;
        }
        .ai-drawer-light .ai-history-header-btn:hover,
        .ai-drawer-light .ai-history-header-btn.is-open,
        .ai-drawer-light .ai-history-header-btn:focus-visible {
          background: #f3f4f6;
          color: #111827;
        }
        .ai-drawer-dark .ai-history-header-btn {
          color: #a1a1aa;
        }
        .ai-drawer-dark .ai-history-header-btn:hover,
        .ai-drawer-dark .ai-history-header-btn.is-open,
        .ai-drawer-dark .ai-history-header-btn:focus-visible {
          background: #2a2c32;
          color: #f0f0f2;
        }
        .ai-drawer-dark .bg-white { background-color: var(--ai-bg-raised) !important; }
        .ai-drawer-dark .ai-plus-menu {
          background: #32343a !important;
        }
        .ai-drawer-dark .ai-plus-item:hover {
          background: #3a3d45;
        }
        .ai-drawer-dark .ai-plus-title {
          color: var(--ai-text);
        }
        .ai-drawer-dark .ai-plus-hint,
        .ai-drawer-dark .ai-plus-icon-muted {
          color: var(--ai-text-muted);
        }
        .ai-drawer-dark .ai-plus-divider {
          border-color: var(--ai-border);
        }
        .ai-drawer-dark .bg-gray-50 { background-color: var(--ai-bg) !important; }
        .ai-drawer-dark .bg-gray-100 { background-color: var(--ai-bg-overlay) !important; }
        .ai-drawer-dark .text-gray-900,
        .ai-drawer-dark .text-gray-800 { color: var(--ai-text) !important; }
        .ai-drawer-dark .text-gray-600,
        .ai-drawer-dark .text-gray-500 { color: var(--ai-text-muted) !important; }
        .ai-drawer-dark .text-gray-400 { color: #7c7f87 !important; }
        .ai-drawer-dark .text-gray-300 { color: #5c5f66 !important; }
        .ai-drawer-dark .placeholder\\:text-gray-500::placeholder { color: #7c7f87 !important; }
        .ai-drawer-dark .border-gray-200\\/70,
        .ai-drawer-dark .border-gray-200,
        .ai-drawer-dark .border-gray-100 { border-color: var(--ai-border) !important; }
        .ai-drawer-dark .ring-gray-100 { --tw-ring-color: #2e3036; }
        .ai-drawer-dark .hover\\:ring-gray-200:hover { --tw-ring-color: #4a4d55; }
        .ai-drawer-dark .hover\\:bg-gray-50:hover,
        .ai-drawer-dark .hover\\:bg-gray-100:hover,
        .ai-drawer-dark .hover\\:bg-gray-200:hover { background-color: var(--ai-bg-overlay) !important; }
        .ai-drawer-dark .hover\\:bg-red-50:hover { background-color: #3a2e30 !important; }
        .ai-drawer-dark textarea { color: var(--ai-text); }
        .ai-drawer-dark .text-violet-600,
        .ai-drawer-dark .text-violet-700 { color: #c9cbd1 !important; }
        .ai-drawer-dark .bg-violet-600 { background-color: #4a4d55 !important; color: #f0f0f2 !important; }
        .ai-drawer-dark .hover\\:bg-violet-700:hover { background-color: #5a5d66 !important; }
        .ai-drawer-dark .bg-violet-50 { background-color: #2a2c32 !important; }
        .ai-drawer-dark .bg-violet-100 { background-color: #32343b !important; }
        .ai-drawer-dark .text-violet-800,
        .ai-drawer-dark .text-violet-700 { color: #e4e5e9 !important; }
        .ai-drawer-dark .border-violet-200 { border-color: #3f424a !important; }
        .ai-drawer-dark .hover\\:bg-violet-100:hover { background-color: #34363d !important; }
        .ai-drawer-dark .ring-violet-400 { --tw-ring-color: #6b6e76; }
        .ai-drawer-dark .ai-history-item {
          background-color: #23262b !important;
          box-shadow: none !important;
          outline: none;
          --tw-ring-inset: ;
          --tw-ring-offset-width: 0px;
          --tw-ring-offset-color: transparent;
          --tw-ring-color: transparent;
          --tw-ring-offset-shadow: 0 0 #0000;
          --tw-ring-shadow: 0 0 #0000;
        }
        .ai-drawer-dark .ai-history-item:hover {
          background-color: #2c2f35 !important;
        }
        .ai-drawer-dark .ai-history-item-active {
          background-color: #33363c !important;
        }
        .ai-drawer-dark .btn-ghost { color: #b4b7be; }
        .ai-drawer-dark .btn-ghost:hover { background-color: #2a2c32; color: #f0f0f2; }
        .ai-drawer-dark .text-slate-500 { color: #9a9da6 !important; }
        .ai-drawer-dark .bg-rose-100 { background-color: #3a3336 !important; }
        .ai-drawer-dark .text-rose-600 { color: #d4c4c8 !important; }
        .ai-drawer-dark .bg-amber-100 { background-color: #3a3730 !important; }
        .ai-drawer-dark .text-amber-700 { color: #d4cbb8 !important; }
        .ai-drawer-dark .bg-emerald-100 { background-color: #2e3330 !important; }
        .ai-drawer-dark .text-emerald-700 { color: #c5cdc8 !important; }
        .ai-drawer-dark .bg-sky-100 { background-color: #2e3238 !important; }
        .ai-drawer-dark .text-sky-700 { color: #c5ccd4 !important; }
        .ai-send-btn {
          background: var(--ai-send) !important;
        }
        .ai-send-btn:hover {
          filter: brightness(1.08);
        }
        .ai-plus-overlay,
        .ai-history-overlay {
          position: absolute;
          inset: 0;
          z-index: 45;
        }
        .ai-plus-overlay {
          z-index: 46;
        }
        .ai-plus-drawer {
          position: absolute;
          top: 0;
          bottom: 0;
          left: 0;
          display: flex;
          width: min(90vw, 24rem);
          height: 100%;
          flex-direction: column;
          overflow: hidden;
          background: rgba(255, 255, 255, 0.94);
          backdrop-filter: blur(26px) saturate(1.6);
          -webkit-backdrop-filter: blur(26px) saturate(1.6);
          border: 0;
          outline: none;
          border-top-right-radius: 1.85rem;
          border-bottom-right-radius: 1.85rem;
          box-shadow: 16px 0 48px rgba(15, 23, 42, 0.2);
          animation: ai-history-slide 0.34s cubic-bezier(0.22, 1, 0.36, 1);
        }
        .ai-plus-drawer-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: calc(0.85rem + env(safe-area-inset-top, 0px)) 1rem 0.75rem 1.15rem;
          font-size: 1.25rem;
          font-weight: 700;
          color: var(--ai-text);
        }
        .ai-plus-drawer-close {
          display: inline-flex;
          height: 2.75rem;
          width: 2.75rem;
          align-items: center;
          justify-content: center;
          border: 0;
          border-radius: 999px;
          background: transparent;
          color: #6b7280;
        }
        .ai-plus-drawer-body {
          flex: 1;
          min-height: 0;
          overflow-y: auto;
          overscroll-behavior: contain;
          padding: 0.25rem 0 1.25rem;
        }
        .ai-plus-drawer .ai-plus-item {
          gap: 1rem;
          padding: 0.95rem 1.15rem;
        }
        .ai-plus-drawer .ai-plus-icon {
          width: 1.85rem;
          height: 1.85rem;
        }
        .ai-plus-drawer .ai-plus-copy {
          display: flex;
          flex-direction: column;
          gap: 0.15rem;
        }
        .ai-plus-drawer .ai-plus-title {
          font-size: 1.125rem;
          font-weight: 600;
        }
        .ai-plus-drawer .ai-plus-hint {
          margin-left: 0;
          font-size: 0.9375rem;
        }
        .ai-plus-drawer .ai-plus-section {
          padding: 0.85rem 1.15rem 0.35rem;
          font-size: 0.8rem;
        }
        .ai-drawer-dark .ai-plus-drawer {
          background: rgba(24, 26, 30, 0.94);
          box-shadow: 16px 0 56px rgba(0, 0, 0, 0.5);
        }
        .ai-drawer-dark .ai-plus-drawer-close {
          color: #c5c8d0;
        }
        .ai-history-backdrop {
          position: absolute;
          inset: 0;
          border: 0;
          padding: 0;
          cursor: pointer;
          background: rgba(15, 23, 42, 0.4);
          backdrop-filter: blur(10px) saturate(1.2);
          -webkit-backdrop-filter: blur(10px) saturate(1.2);
          animation: ai-history-fade 0.22s ease;
        }
        .ai-history-drawer {
          position: absolute;
          top: 0;
          bottom: 0;
          left: 0;
          display: flex;
          width: min(86vw, 22.5rem);
          height: 100%;
          flex-direction: column;
          overflow: hidden;
          background: rgba(255, 255, 255, 0.86);
          backdrop-filter: blur(26px) saturate(1.6);
          -webkit-backdrop-filter: blur(26px) saturate(1.6);
          border: 0;
          outline: none;
          border-top-right-radius: 1.85rem;
          border-bottom-right-radius: 1.85rem;
          box-shadow: 16px 0 48px rgba(15, 23, 42, 0.2);
          animation: ai-history-slide 0.34s cubic-bezier(0.22, 1, 0.36, 1);
        }
        .ai-drawer-dark .ai-history-backdrop {
          background: rgba(0, 0, 0, 0.52);
        }
        .ai-drawer-dark .ai-history-drawer {
          background: rgba(24, 26, 30, 0.9);
          border: 0;
          outline: none;
          box-shadow: 16px 0 56px rgba(0, 0, 0, 0.5);
        }
        .ai-history-veil {
          position: absolute;
          left: 0;
          right: 0;
          z-index: 2;
          pointer-events: none;
        }
        .ai-history-veil-top {
          top: 0;
          height: calc(3.1rem + env(safe-area-inset-top));
          background: linear-gradient(
            to bottom,
            rgba(255, 255, 255, 0.28) 0%,
            rgba(255, 255, 255, 0.08) 70%,
            rgba(255, 255, 255, 0) 100%
          );
          backdrop-filter: blur(3px);
          -webkit-backdrop-filter: blur(3px);
          -webkit-mask-image: linear-gradient(to bottom, #000 0%, #000 55%, transparent 100%);
          mask-image: linear-gradient(to bottom, #000 0%, #000 55%, transparent 100%);
        }
        .ai-drawer-dark .ai-history-veil-top {
          background: linear-gradient(
            to bottom,
            rgba(24, 26, 30, 0.32) 0%,
            rgba(24, 26, 30, 0.1) 70%,
            rgba(24, 26, 30, 0) 100%
          );
        }
        .ai-history-float-top,
        .ai-history-float-dock {
          position: absolute;
          z-index: 3;
          display: flex;
          pointer-events: none;
        }
        .ai-history-float-top {
          top: 0;
          left: 0;
          right: 0;
          align-items: center;
          justify-content: space-between;
          padding: max(0.7rem, env(safe-area-inset-top)) 0.85rem 0;
        }
        .ai-history-float-dock {
          right: 0.85rem;
          bottom: max(0.85rem, env(safe-area-inset-bottom));
          left: 0.85rem;
          align-items: flex-end;
          justify-content: space-between;
        }
        .ai-history-float-top > *,
        .ai-history-float-dock > * {
          pointer-events: auto;
        }
        .ai-history-float-chip {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: 0;
          border-radius: 9999px;
          background: rgba(255, 255, 255, 0.78);
          box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
          backdrop-filter: blur(16px) saturate(1.4);
          -webkit-backdrop-filter: blur(16px) saturate(1.4);
        }
        .ai-drawer-dark .ai-history-float-chip {
          background: rgba(39, 41, 46, 0.82);
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
        }
        .ai-history-tools {
          position: relative;
        }
        .ai-history-tools-menu {
          position: absolute;
          right: 0;
          bottom: calc(100% + 0.55rem);
          min-width: 11.5rem;
          overflow: hidden;
          border-radius: 1.1rem;
          background: rgba(255, 255, 255, 0.94);
          box-shadow: 0 14px 36px rgba(15, 23, 42, 0.16);
          backdrop-filter: blur(18px);
          -webkit-backdrop-filter: blur(18px);
        }
        .ai-drawer-dark .ai-history-tools-menu {
          background: rgba(36, 38, 43, 0.94);
        }
        @keyframes ai-history-slide {
          from { transform: translateX(-104%); opacity: 0.55; }
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes ai-history-fade {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .ai-welcome-title {
          color: var(--ai-text);
        }
        .ai-welcome-sub {
          color: var(--ai-text-muted);
        }
        .ai-welcome-orb {
          line-height: 0;
        }
        .ai-welcome-card {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          border-radius: 0.85rem;
          border: none;
          background: #fff;
          padding: 0.85rem 0.9rem;
          text-align: left;
          transition: box-shadow 0.15s ease, background 0.15s ease;
        }
        .ai-welcome-card:hover {
          box-shadow: 0 8px 20px rgba(124, 58, 237, 0.08);
        }
        .ai-welcome-card:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }
        .ai-welcome-card-icon {
          display: flex;
          height: 2.85rem;
          width: 2.85rem;
          flex-shrink: 0;
          align-items: center;
          justify-content: center;
          border-radius: 0.8rem;
          background: #ede9fe;
          color: #7c3aed;
        }
        .ai-welcome-card-title {
          color: var(--ai-text);
        }
        .ai-welcome-card-hint {
          color: var(--ai-text-muted);
        }
        .ai-drawer-dark .ai-welcome-card {
          background: var(--ai-bg-input);
        }
        .ai-drawer-dark .ai-welcome-card:hover {
          background: #32343b;
        }
        .ai-drawer-dark .ai-welcome-card-icon {
          background: rgba(124, 58, 237, 0.22);
          color: #c4b5fd;
        }
        .ai-welcome-divider {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          color: #9ca3af;
          font-size: 0.68rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .ai-welcome-divider::before,
        .ai-welcome-divider::after {
          content: '';
          flex: 1;
          height: 1px;
          background: #e5e7eb;
        }
        .ai-drawer-dark .ai-welcome-divider {
          color: #7c7f87;
        }
        .ai-drawer-dark .ai-welcome-divider::before,
        .ai-drawer-dark .ai-welcome-divider::after {
          background: #3a3d45;
        }
        .ai-welcome-ask {
          display: inline-flex;
          align-items: center;
          gap: 0.4rem;
          border-radius: 9999px;
          border: none;
          background: #f3f4f6;
          padding: 0.45rem 0.85rem;
          font-size: 0.8125rem;
          font-weight: 500;
          color: #7c3aed;
          transition: background 0.15s ease;
        }
        .ai-welcome-ask:hover {
          background: #ede9fe;
        }
        .ai-welcome-ask:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }
        .ai-drawer-dark .ai-welcome-ask {
          background: var(--ai-bg-input);
          color: #c4b5fd;
        }
        .ai-drawer-dark .ai-welcome-ask:hover {
          background: #32343b;
        }
        .ai-voice-meter {
          display: flex;
          align-items: center;
          gap: 2.5px;
          width: 100%;
          height: 1.85rem;
        }
        .ai-voice-meter span {
          flex: 1 1 0;
          min-width: 2px;
          height: 12%;
          border-radius: 99px;
          background: var(--ai-send);
          transform-origin: center;
          transition: height 70ms ease-out;
        }
        .ai-voice-accept-btn {
          background: #10b981 !important;
          color: #fff !important;
        }
        .ai-voice-accept-btn:hover {
          filter: brightness(1.06);
        }
        .ai-drawer-dark .ai-voice-accept-btn {
          background: #059669 !important;
        }
      `}</style>
      {(canResizePanel || isFullPage) && !isMobile
        ? (['nw', 'ne', 'se', 'sw'] as const).map((corner) => (
            <button
              key={corner}
              type="button"
              data-ai-resize={corner}
              className={`ai-resize-handle ai-resize-${corner} ${isDarkTheme ? 'text-zinc-300' : 'text-gray-500'}`}
              onPointerDown={beginPanelResize}
              onPointerMove={movePanelResize}
              onPointerUp={endPanelResize}
              onPointerCancel={endPanelResize}
              onDoubleClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                panelResizeRef.current = null;
                setIsResizingPanel(false);
                onToggleFullPage?.();
              }}
              title={isFullPage ? 'Double-click to exit full page' : 'Drag to resize · double-click for full page'}
              aria-label={
                isFullPage
                  ? 'Double-click to exit full page'
                  : 'Resize chat. Double-click for full page.'
              }
            />
          ))
        : null}
      <div 
        className={`${isFullPage || isMobile ? 'ai-glass-fullpage' : 'ai-glass'} relative flex h-full w-full flex-col`}
        style={{
          ...(isMobile && {
            height: '100dvh',
            minHeight: '100dvh'
          })
        }}
      >
        {/* Header */}
        <div
              className="ai-chat-header absolute inset-x-0 top-0 z-50 flex items-center pb-1.5 pt-[max(0.5rem,env(safe-area-inset-top))]"
          onPointerDown={beginPanelMove}
          onPointerMove={movePanel}
          onPointerUp={endPanelMove}
          onPointerCancel={endPanelMove}
          title="Hold and drag to move"
        >
          <div
            className={`flex items-center ${
              showHistoryPanel && !isMobile ? 'w-72 shrink-0 pl-5 pr-2 md:w-96' : 'pl-5'
            }`}
          >
            <div className="flex items-center gap-1">
              <button
                className={`focus:outline-none ${aiIconAnim ? 'animate-ai-pulse' : ''}`}
                style={{ background: 'none', border: 'none', padding: 0, margin: 0, cursor: 'pointer' }}
                onClick={handleAiIconClick}
                tabIndex={0}
                aria-label="About RMQ AI"
              >
                <RmqAiLogo src={RMQ_AI_HEADER_LOGO_SRC} className="ai-header-logo h-9 w-9" />
              </button>
              <div className="flex min-w-0 flex-col justify-center leading-tight">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    className={`ai-header-title text-sm font-bold ${isDarkTheme ? 'text-zinc-100' : 'text-gray-900'}`}
                    onClick={() => setShowRmqAiIntroModal(true)}
                    aria-haspopup="dialog"
                    aria-expanded={showRmqAiIntroModal}
                    aria-label="About RMQ AI"
                    title="About RMQ AI"
                  >
                    RMQ AI
                  </button>
                  <span
                    className={`ai-header-beta inline-flex h-4 shrink-0 -translate-y-1 items-center rounded-full px-1.5 text-[9px] font-bold uppercase leading-none tracking-wide ${
                      isDarkTheme ? 'bg-[#3a3d45] text-[#c4b5fd]' : 'bg-gray-100 text-[#3b28c7]'
                    }`}
                  >
                    Beta
                  </span>
                </div>
              </div>
            </div>
          </div>
          {openClientChip && (openClientChip.lead_number || openClientChip.name) ? (
            <div
              className={`pointer-events-none absolute flex items-center justify-center ${
                showHistoryPanel && !isMobile ? 'left-72 right-0 md:left-96' : 'inset-x-0'
              } top-[max(0.5rem,env(safe-area-inset-top))] bottom-1.5`}
            >
              <span
                className={`ai-header-client pointer-events-auto max-w-[11rem] truncate rounded-full px-2.5 py-1 text-[11px] font-medium ${
                  isDarkTheme ? 'bg-violet-500/20 text-violet-200' : 'bg-violet-100 text-violet-800'
                }`}
                title="Questions about this client use the open lead automatically"
              >
                {openClientChip.lead_number || openClientChip.name}
              </span>
            </div>
          ) : null}
          <div className="flex min-w-0 flex-1 items-center justify-end px-5">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowHistoryPanel(!showHistoryPanel)}
              className={`ai-history-header-btn ${showHistoryPanel ? 'is-open' : ''}`}
              title="Chat History"
              aria-label="Chat History"
              aria-pressed={showHistoryPanel}
            >
              <ClockOutlineIcon className="h-5 w-5" />
            </button>
            <button
              type="button"
              className="ai-theme-switch"
              onClick={() => setIsDarkTheme((value) => !value)}
              title={isDarkTheme ? 'Switch to light theme' : 'Switch to dark theme'}
              aria-label={isDarkTheme ? 'Switch to light theme' : 'Switch to dark theme'}
              aria-pressed={isDarkTheme}
            >
              <span className={`ai-theme-knob ${isDarkTheme ? 'is-dark' : ''}`}>
                {isDarkTheme ? (
                  <MoonIcon className="text-white" />
                ) : (
                  <SunIcon className="text-amber-500" />
                )}
              </span>
            </button>
            <button
              type="button"
              className="ai-close-btn"
              onClick={() => {
                void persistLeavingChat(currentChatIdRef.current, messagesRef.current);
                onClose();
              }}
              aria-label="Close"
              title="Close"
            >
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {showHistoryPanel && !isMobile && (
            <div className="ai-chat-under-header flex w-72 shrink-0 flex-col overflow-hidden bg-white md:w-96">
              {renderChatHistoryPanel(false)}
            </div>
          )}
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-gray-50">
            {attachMenuOpen && !isMobile ? (
              <div
                ref={plusMenuRef}
                role="menu"
                className="ai-plus-menu absolute left-4 z-20 w-80 rounded-2xl bg-white py-1.5 md:left-5"
              >
                {plusMenuItems}
              </div>
            ) : null}
            <div 
              className="ai-chat-under-header ai-messages-scroll scrollbar-hide flex min-h-0 flex-1 flex-col overflow-y-auto bg-gray-50 px-4 pb-36 md:px-5 md:pb-32"
              style={{
                ...(isMobile && keyboardOpen && {
                  paddingBottom: '120px'
                })
              }}
            >
              {showWelcomeHome ? (
                <ChatWelcomeHome
                  hasLead={onClientPage}
                  disabled={isLoading}
                  onAction={handleQuickAction}
                  signals={
                    onClientPage && openClientChip?.id
                      ? buildLeadSignals({
                          noHandler: !openClientChip?.handler,
                        })
                      : []
                  }
                />
              ) : (
              <div className="space-y-4">
              {messages.filter((msg) => isVisibleChatMessage(msg) && !isWelcomeMessage(msg)).map((msg, idx, visibleMsgs) => {
                let lastAssistantIdx = -1;
                for (let i = visibleMsgs.length - 1; i >= 0; i -= 1) {
                  if (visibleMsgs[i].role === 'assistant') {
                    lastAssistantIdx = i;
                    break;
                  }
                }
                const isLatestAnswer = msg.role === 'assistant' && idx === lastAssistantIdx;
                const bubbleKey = `${idx}-${msg.role}`;
                const thinking = isThinkingMessage(msg.content);
                const asEmailDraft =
                  Boolean(msg.draftAction) || looksLikeEmailDraft(plainTextFromMessage(msg));
                const assistantText = asEmailDraft
                  ? stripAiEmailSignature(String(msg.content || ''))
                  : msg.calendarMeetings || msg.signedContracts || msg.paidPayments || msg.missedComms || msg.expenses || msg.employeePresence
                    ? calendarDayIntro(String(msg.content || ''))
                    : String(msg.content || '');
                const summaryText = msg.leadSummary ? String(msg.content || '') : '';
                const userVisible =
                  msg.role === 'user'
                    ? shortAskLabel(plainTextFromMessage(msg)) || plainTextFromMessage(msg)
                    : '';
                const canCopy =
                  msg.role === 'assistant' &&
                  !thinking &&
                  !msg.streaming &&
                  !isWelcomeMessage(msg) &&
                  Boolean(plainTextFromMessage(msg));
                return (
                <div
                  key={idx}
                  ref={isLatestAnswer ? latestAnswerRef : undefined}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} ${
                    msg.paidPayments || msg.signedContracts || msg.missedComms ? 'w-full' : ''
                    } ${isLatestAnswer ? 'ai-msg-anchor scroll-mt-3' : ''}`}
                >
                  <div
                    className={
                      msg.role === 'user'
                        ? 'ai-bubble-user max-w-[85%] rounded-2xl px-5 py-4'
                        : `ai-bubble-assistant ${
                            msg.paidPayments || msg.signedContracts || msg.missedComms
                              ? 'w-full max-w-full'
                              : msg.calendarMeetings || msg.expenses || msg.employeePresence || msg.leadSummary
                                ? 'max-w-full'
                                : 'max-w-[92%]'
                          } ${thinking ? 'ai-bubble-thinking' : ''}`
                    }
                    style={{ fontSize: '0.9375rem', lineHeight: 1.6 }}
                  >
                    {Array.isArray(msg.content) ? (
                      msg.content.map((item, i) => {
                        if (item.type === 'text') {
                          const text =
                            msg.role === 'user'
                              ? userVisible || item.text
                              : asEmailDraft
                                ? stripAiEmailSignature(item.text)
                                : item.text;
                          return (
                            <React.Fragment key={i}>
                              {renderAssistantWithRisks(text, {
                                role: msg.role,
                                asEmailDraft,
                                welcome: isWelcomeMessage(msg),
                              })}
                            </React.Fragment>
                          );
                        }
                        if (item.type === 'image_url') {
                          return <img key={i} src={item.image_url.url} alt="uploaded" className="my-2 max-w-xs rounded-xl" />;
                        }
                        return null;
                      })
                    ) : thinking ? (
                      <ChatThinkingIndicator label={thinkingLabelFromContent(msg.content)} />
                    ) : (msg.role === 'user' ? userVisible : assistantText) && !msg.leadSummary ? (
                      <>
                        {renderAssistantWithRisks(msg.role === 'user' ? userVisible : assistantText, {
                          role: msg.role,
                          asEmailDraft,
                          welcome: isWelcomeMessage(msg),
                        })}
                        {msg.streaming ? <span className="ai-stream-caret" aria-hidden /> : null}
                      </>
                    ) : null}
                    {msg.role === 'assistant' && msg.meetingCard ? (
                      <ChatMeetingCards data={msg.meetingCard} />
                    ) : null}
                    {msg.role === 'assistant' && msg.calendarMeetings ? (
                      <ChatCalendarMeetingCards data={msg.calendarMeetings} employees={chatEmployees} dark={isDarkTheme} />
                    ) : null}
                    {msg.role === 'assistant' && msg.signedContracts ? (
                      <ChatSignedContractsTable data={msg.signedContracts} employees={chatEmployees} />
                    ) : null}
                    {msg.role === 'assistant' && msg.paidPayments ? (
                      <ChatPaidPaymentsTable data={msg.paidPayments} />
                    ) : null}
                    {msg.role === 'assistant' && msg.missedComms ? (
                      <ChatMissedCommsTable data={msg.missedComms} />
                    ) : null}
                    {msg.role === 'assistant' && msg.expenses ? (
                      <ChatExpensesTable data={msg.expenses} employees={chatEmployees} />
                    ) : null}
                    {msg.role === 'assistant' && msg.employeePresence ? (
                      <ChatEmployeePresenceTable data={msg.employeePresence} employees={chatEmployees} />
                    ) : null}
                    {msg.role === 'assistant' && msg.webSources ? (
                      <ChatWebSources
                        data={msg.webSources}
                        conversationId={currentChatId}
                        messageId={msg.id || bubbleKey}
                        initialRating={msg.researchRating ?? null}
                        initialSaved={Boolean(msg.researchSaved)}
                        onStateChange={(next) => {
                          setMessages((prev) =>
                            prev.map((row) => {
                              const sameId = Boolean(msg.id) && row.id === msg.id;
                              const sameSources =
                                !msg.id &&
                                row.webSources &&
                                row.webSources.summary === msg.webSources?.summary &&
                                row.webSources.sources[0]?.url === msg.webSources.sources[0]?.url;
                              if (!sameId && !sameSources) return row;
                              const rating = next.rating === undefined ? row.researchRating : next.rating || undefined;
                              const saved = next.saved === undefined ? row.researchSaved : next.saved;
                              if (row.researchRating === rating && row.researchSaved === saved) return row;
                              return { ...row, researchRating: rating, researchSaved: saved };
                            }),
                          );
                        }}
                      />
                    ) : null}
                    {msg.role === 'assistant' && msg.leadSummary ? (
                      <ChatLeadSummaryCards
                        data={msg.leadSummary}
                        employees={chatEmployees}
                        dark={isDarkTheme}
                        summaryText={summaryText}
                        renderText={(text) => (
                          <div className="ai-chat-msg-text max-w-none text-gray-800 prose">
                            {formatMessageContent(text, {
                              employeePhotos: !isWelcomeMessage(msg),
                              stageBadges: true,
                            })}
                          </div>
                        )}
                      />
                    ) : null}
                    {msg.role === 'assistant' && msg.attachments?.length ? (
                      <div className="mt-3 flex flex-col gap-2">
                        {msg.attachments.map((file) => (
                          <button
                            key={file.id}
                            type="button"
                            onClick={() => {
                              const live = resolveRmqExcelFile(file.id) || file;
                              if (!live.url) {
                                toast.error('This Excel file is no longer available. Ask me to create it again.');
                                return;
                              }
                              triggerBrowserDownload(live);
                            }}
                            className="inline-flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-left text-sm font-semibold text-violet-800 hover:bg-violet-100"
                          >
                            <ArrowDownTrayIcon className="h-4 w-4 shrink-0" />
                            <span className="min-w-0 truncate">Download {file.filename}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {canCopy ? (
                      <div className="mt-1 flex justify-start gap-1">
                        <button
                          type="button"
                          className="ai-bubble-copy"
                          onClick={() => copyAssistantMessage(bubbleKey, msg)}
                          title={copiedBubbleKey === bubbleKey ? 'Copied' : 'Copy message'}
                          aria-label={copiedBubbleKey === bubbleKey ? 'Copied' : 'Copy message'}
                        >
                          {copiedBubbleKey === bubbleKey ? (
                            <CheckIcon className="h-5 w-5" strokeWidth={1.75} />
                          ) : (
                            <Square2StackIcon className="h-5 w-5" strokeWidth={1.75} />
                          )}
                        </button>
                        <button
                          type="button"
                          className="ai-bubble-copy"
                          onClick={() => handleRetryAssistant(msg)}
                          disabled={isLoading}
                          title="Try again"
                          aria-label="Try again and rephrase"
                        >
                          <ArrowPathIcon className="h-5 w-5" strokeWidth={1.75} />
                        </button>
                        {msg.draftAction ? (
                          <button
                            type="button"
                            className="ai-bubble-copy"
                            onClick={() => {
                              openDraftInEmail(msg);
                              void recordRecommendationOutcome(`draft-${msg.id || bubbleKey}`, 'accepted');
                            }}
                            title="Open in Email"
                            aria-label="Open draft in Email"
                          >
                            <EnvelopeIcon className="h-5 w-5" strokeWidth={1.75} />
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className={`ai-bubble-copy ${messageFeedback[msg.id || bubbleKey] === 'up' ? 'is-liked' : ''}`}
                          title="Good answer"
                          aria-label="Thumbs up"
                          onClick={() => {
                            const id = msg.id || bubbleKey;
                            setMessageFeedback((prev) => ({ ...prev, [id]: 'up' }));
                            setThumbBurstAt((prev) => ({ ...prev, [id]: Date.now() }));
                            void persistFeedback({
                              conversationId: currentChatId,
                              messageId: id,
                              rating: 'up',
                            });
                            if (msg.draftAction) {
                              void recordRecommendationOutcome(`draft-${id}`, 'accepted');
                            }
                          }}
                        >
                          {messageFeedback[msg.id || bubbleKey] === 'up' && thumbBurstAt[msg.id || bubbleKey] ? (
                            <span key={thumbBurstAt[msg.id || bubbleKey]} className="ai-thumb-burst" aria-hidden>
                              <HandThumbUpSolid />
                            </span>
                          ) : null}
                          {messageFeedback[msg.id || bubbleKey] === 'up' ? (
                            <HandThumbUpSolid className="thumb-main h-5 w-5" />
                          ) : (
                            <HandThumbUpIcon className="thumb-main h-5 w-5" strokeWidth={1.75} />
                          )}
                        </button>
                        <button
                          type="button"
                          className={`ai-bubble-copy ${messageFeedback[msg.id || bubbleKey] === 'down' ? 'is-disliked' : ''}`}
                          title="Needs improvement"
                          aria-label="Thumbs down"
                          onClick={() => {
                            const id = msg.id || bubbleKey;
                            setMessageFeedback((prev) => ({ ...prev, [id]: 'down' }));
                            setThumbBurstAt((prev) => ({ ...prev, [id]: Date.now() }));
                            void persistFeedback({
                              conversationId: currentChatId,
                              messageId: id,
                              rating: 'down',
                              reason: 'other',
                              failureOrigin: inferFailureOrigin('other'),
                            });
                          }}
                        >
                          {messageFeedback[msg.id || bubbleKey] === 'down' && thumbBurstAt[msg.id || bubbleKey] ? (
                            <span key={thumbBurstAt[msg.id || bubbleKey]} className="ai-thumb-burst" aria-hidden>
                              <HandThumbDownSolid />
                            </span>
                          ) : null}
                          {messageFeedback[msg.id || bubbleKey] === 'down' ? (
                            <HandThumbDownSolid className="thumb-main h-5 w-5" />
                          ) : (
                            <HandThumbDownIcon className="thumb-main h-5 w-5" strokeWidth={1.75} />
                          )}
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
                );
              })}
              </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <div
              className={`contract-ai-input-area pointer-events-none absolute inset-x-0 bottom-0 z-20 px-4 pb-4 pt-2 md:px-5 ${isMobile && keyboardOpen ? 'pb-safe' : ''}`}
              style={{
                ...(isMobile && keyboardOpen && {
                  position: 'fixed',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  zIndex: 60,
                  backgroundColor: 'transparent',
                  paddingBottom: 'env(safe-area-inset-bottom, 1rem)'
                })
              }}
            >
              <div className="ai-input-backdrop" aria-hidden="true" />
              {imagePreviews.length > 0 && (
                <div className="pointer-events-auto mb-2 flex gap-2 overflow-x-auto">
                  {imagePreviews.map((preview, idx) => (
                    <div key={idx} className="relative">
                      <img src={preview} alt="preview" className="h-16 w-16 rounded-xl object-cover shadow-md" />
                      <button
                        type="button"
                        onClick={() => handleRemoveImage(idx)}
                        className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-white text-xs text-gray-600 shadow-sm"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="pointer-events-auto flex items-end gap-2">
                <div className="contract-ai-input-shell relative flex min-w-0 flex-1 items-center overflow-visible">
                  <div className="relative shrink-0 self-center pl-1.5" ref={attachMenuRef}>
                    <button
                      type="button"
                      className="ai-composer-btn btn btn-ghost btn-circle btn-sm h-10 w-10 text-slate-500 hover:bg-gray-100"
                      onClick={() => setAttachMenuOpen((open) => !open)}
                      disabled={isLoading}
                      aria-expanded={attachMenuOpen}
                      aria-haspopup="menu"
                      title="Add"
                      aria-label="Add"
                    >
                      <PlusIcon className="h-5 w-5" />
                    </button>
                  </div>
                  <div className="relative flex min-h-[3.25rem] min-w-0 flex-1 items-center">
                    {isVoiceRecording || isVoiceListening || isVoiceBusy ? (
                      <div className="flex h-full w-full items-center gap-2.5 pl-1" aria-live="polite">
                        {isVoiceBusy ? (
                          <>
                            <span className="loading loading-spinner loading-xs text-violet-500" />
                            <span className={`text-sm font-medium ${isDarkTheme ? 'text-zinc-400' : 'text-gray-500'}`}>
                              Transcribing…
                            </span>
                          </>
                        ) : (
                          <div className="ai-voice-meter pr-1" aria-hidden={false} aria-label="Recording">
                            <span className="sr-only">Recording</span>
                            {Array.from({ length: VOICE_METER_BAR_COUNT }, (_, index) => (
                              <span
                                key={index}
                                style={{ height: voiceMeterBarHeight(index, voiceAudioLevel) }}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <>
                    {ghostSuffix ? (
                      <div
                        aria-hidden
                        dir={inputIsRtl ? 'rtl' : 'ltr'}
                        className="pointer-events-none absolute inset-0 flex items-center overflow-hidden pl-1 pr-2 text-start text-base leading-6 text-gray-400 max-md:text-lg max-md:leading-7"
                      >
                        <span className="invisible whitespace-pre-wrap break-words">{input}</span>
                        <span className="whitespace-pre-wrap break-words">{ghostSuffix}</span>
                      </div>
                    ) : null}
                    <textarea
                      ref={textareaRef}
                      rows={1}
                      dir={inputIsRtl ? 'rtl' : 'ltr'}
                      className="relative min-h-0 min-w-0 w-full resize-none border-0 bg-transparent py-0 pl-1 pr-2 text-start text-base leading-6 placeholder:text-gray-500 focus:outline-none focus:ring-0 max-md:text-lg max-md:leading-7"
                      placeholder="Ask anything..."
                      value={input}
                      onChange={(e) => {
                        setInput(e.target.value);
                        setCaret(e.target.selectionStart ?? e.target.value.length);
                        setSuggestDismissed(false);
                      }}
                      onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? input.length)}
                      onClick={(e) => setCaret(e.currentTarget.selectionStart ?? input.length)}
                      disabled={isLoading}
                      onPaste={(e) => {
                        const pasted = Array.from(e.clipboardData?.files || []).filter((file) =>
                          file.type.startsWith('image/'),
                        );
                        if (!pasted.length) return;
                        e.preventDefault();
                        addImageFiles(pasted);
                      }}
                      onKeyDown={(e) => {
                        const atEnd = (e.currentTarget.selectionStart ?? 0) >= input.length;
                        if (activeSuggestion && ghostSuffix) {
                          if (e.key === 'Tab' || (e.key === 'ArrowRight' && !e.shiftKey && atEnd)) {
                            e.preventDefault();
                            applySuggestion(activeSuggestion);
                            return;
                          }
                          if (e.key === 'Escape') {
                            e.preventDefault();
                            setSuggestDismissed(true);
                            return;
                          }
                        }
                        if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
                        e.preventDefault();
                        if (!isLoading && (input.trim() || images.length > 0)) handleSend();
                      }}
                    />
                      </>
                    )}
                  </div>
                  <div className="relative mr-1.5 shrink-0 self-center">
                    <button
                      type="button"
                      className={`ai-composer-btn btn btn-circle btn-sm h-10 w-10 border-0 ${
                        isVoiceRecording || isVoiceListening
                          ? 'ai-voice-accept-btn'
                          : 'btn-ghost text-slate-500 hover:bg-gray-100'
                      }`}
                      onClick={() => toggleVoiceInput()}
                      disabled={(isLoading && !isVoiceActive) || isVoiceBusy}
                      aria-pressed={isVoiceRecording || isVoiceListening}
                      aria-label={
                        isVoiceBusy
                          ? 'Transcribing'
                          : isVoiceRecording || isVoiceListening
                            ? 'Use recording'
                            : 'Voice input'
                      }
                      title={
                        isVoiceBusy
                          ? 'Transcribing'
                          : isVoiceRecording || isVoiceListening
                            ? 'Use recording'
                            : 'Voice input'
                      }
                    >
                      {isVoiceRecording || isVoiceListening ? (
                        <CheckIcon className="h-5 w-5" strokeWidth={2.5} />
                      ) : (
                        <MicrophoneIcon className="h-5 w-5" />
                      )}
                    </button>
                  </div>
                  <div className="relative shrink-0 self-center pr-1.5">
                    <button
                      type="button"
                      className="ai-send-btn ai-composer-btn btn btn-circle btn-sm h-10 w-10 shrink-0 border-0 text-white disabled:opacity-60"
                      onClick={() => handleSend()}
                      disabled={
                        isVoiceBusy ||
                        isVoiceRecording ||
                        isVoiceListening ||
                        isLoading ||
                        (!input.trim() && images.length === 0)
                      }
                      aria-label="Send"
                      title="Send"
                    >
                      {isLoading ? (
                        <span className="ai-send-thinking" aria-hidden />
                      ) : (
                        <PaperAirplaneIcon className="h-5 w-5" />
                      )}
                    </button>
                  </div>
                </div>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  ref={fileInputRef}
                  onChange={handleImageChange}
                  multiple
                />
              </div>
            </div>
          </div>
        </div>

        {attachMenuOpen && isMobile ? (
          <div className="ai-plus-overlay" role="dialog" aria-modal="true" aria-label="Add">
            <button
              type="button"
              className="ai-history-backdrop"
              onClick={() => setAttachMenuOpen(false)}
              aria-label="Close add menu"
            />
            <aside ref={plusMenuRef} className="ai-plus-drawer" role="menu">
              <div className="ai-plus-drawer-head">
                <span>Add</span>
                <button
                  type="button"
                  className="ai-plus-drawer-close"
                  onClick={() => setAttachMenuOpen(false)}
                  aria-label="Close"
                >
                  <XMarkIcon className="h-6 w-6" />
                </button>
              </div>
              <div className="ai-plus-drawer-body">{plusMenuItems}</div>
            </aside>
          </div>
        ) : null}

        {showHistoryPanel && isMobile ? (
          <div className="ai-history-overlay" role="dialog" aria-modal="true" aria-label="Chat history">
            <button
              type="button"
              className="ai-history-backdrop"
              onClick={() => setShowHistoryPanel(false)}
              aria-label="Close history"
            />
            <aside className="ai-history-drawer">{renderChatHistoryPanel(true)}</aside>
          </div>
        ) : null}

        {isDragActive && (
          <div className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none">
            <div className="bg-primary/80 text-white px-8 py-6 rounded-2xl shadow-xl text-2xl font-bold border-4 border-white/60 animate-pulse">
              Drop images to upload
            </div>
          </div>
        )}
      </div>
    </div>
    <RmqAiIntroModal
      isOpen={showRmqAiIntroModal}
      onClose={() => setShowRmqAiIntroModal(false)}
      isDarkTheme={isDarkTheme}
      isMobile={isMobile}
    />
    </>
  );
};

export default AIChatWindow; 