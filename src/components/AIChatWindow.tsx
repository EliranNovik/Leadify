import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { XMarkIcon, PaperAirplaneIcon, MagnifyingGlassIcon, ClockIcon, ChatBubbleLeftRightIcon } from '@heroicons/react/24/solid';
import { ArrowDownTrayIcon, ArrowPathIcon, CalendarDaysIcon, ChatBubbleLeftRightIcon as ChatOutlineIcon, CheckIcon, ClockIcon as ClockOutlineIcon, DocumentArrowUpIcon, DocumentCheckIcon, DocumentTextIcon, EnvelopeIcon, MicrophoneIcon, MoonIcon, PencilSquareIcon, PhotoIcon, PlusIcon, SparklesIcon, Square2StackIcon, SunIcon, TrashIcon } from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';
import { toast } from 'react-hot-toast';
import { RmqAiLogo, RMQ_AI_HEADER_LOGO_SRC } from './RmqAiLogo';
import RmqAiIntroModal from './RmqAiIntroModal';
import { executeRmqAiTool, RMQ_AI_SYSTEM_PROMPT, RMQ_AI_TOOLS } from '../lib/rmqAiChatTools';
import { beginRmqAiTurn } from '../lib/rmqAiRoutingLog';
import {
  hydrateRmqAiRoleNames,
  describeCurrentLeadForPrompt,
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
  ChatMeetingCards,
  parseCalendarDayCards,
  parseClientMeetingCard,
  type ChatCalendarDayData,
  type ChatMeetingCardData,
} from './ChatMeetingCard';
import { resolveLeadShareClientRoute } from '../lib/calendarClientRoute';
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
  role: 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: any[];
  tool_call_id?: string;
  attachments?: RmqAiChatFile[];
  draftAction?: RmqAiDraftMeta;
  meetingCard?: ChatMeetingCardData;
  calendarMeetings?: ChatCalendarDayData;
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

const READY_ASKS = [
  {
    label: 'My day',
    hint: 'Meetings, follow-ups, waiting on you',
    prompt:
      'Show my sales day. Call list_my_sales_day. List my meetings today/tomorrow, overdue and today follow-ups, and my leads in stages 21, 40, and 50. Number each item with a lead number and the next action.',
    Icon: CalendarDaysIcon,
    badge: 'bg-amber-100 text-amber-800',
  },
  {
    label: 'Next meeting',
    hint: 'This client’s upcoming meeting + brief',
    prompt:
      'What is the next meeting scheduled for this client? Call list_client_meetings. Give the next upcoming date, time, location, and quote summary, brief, and caseBrief from the tool.',
    Icon: CalendarDaysIcon,
    badge: 'bg-sky-100 text-sky-700',
  },
  {
    label: 'Prep next meeting',
    hint: 'Brief, facts, last comms',
    prompt: 'Prep my next meeting. Call prep_meeting. Give time, who they are, stage, last comms, and 3 questions.',
    Icon: DocumentCheckIcon,
    badge: 'bg-indigo-100 text-indigo-700',
  },
  {
    label: 'Draft follow-up',
    hint: 'Detailed email or WhatsApp from the case file',
    prompt:
      'Draft a detailed professional follow-up for this client. Call draft_client_message with intent follow_up. Read the full case file (meetings, last messages, contracts, payments, next steps) and write 4–7 short paragraphs in the client language — not a short check-in. Reply with only the ready-to-send draft. Stop after Best regards / בברכה. Do not add a signature.',
    Icon: EnvelopeIcon,
    badge: 'bg-emerald-100 text-emerald-700',
  },
  {
    label: "Who hasn't answered",
    hint: 'Stale deals to chase',
    prompt:
      'Who has not answered me? Call list_stale_sales_leads. List lead numbers, last touch, and one chase action each.',
    Icon: ChatOutlineIcon,
    badge: 'bg-rose-100 text-rose-700',
  },
  {
    label: 'After no-show',
    hint: 'What to say',
    prompt:
      'Draft a detailed professional no-show follow-up for this client. Call draft_client_message with intent no_show. Use the case file and write 4–7 short paragraphs in the client language. Reply with only the draft. Stop after Best regards / בברכה. Do not add a signature.',
    Icon: ClockOutlineIcon,
    badge: 'bg-violet-100 text-violet-700',
  },
  {
    label: 'Signed today',
    hint: 'Closed deals from today',
    prompt: 'List signed contracts today with lead numbers, names, amounts, and closers.',
    Icon: DocumentCheckIcon,
    badge: 'bg-emerald-100 text-emerald-700',
  },
  {
    label: 'Meetings today',
    hint: 'Your meetings as manager, helper, guest, or participant',
    prompt:
      'List my meetings today. Call list_calendar_day with scope=mine. For each meeting use two lines: first time + lead number + name; second Meeting manager, Helper, Guests, Participants. Only include meetings where I am meeting manager, helper, guest, or a participant.',
    Icon: CalendarDaysIcon,
    badge: 'bg-sky-100 text-sky-700',
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
      'Give me an overview of this open client. Use CRM tools. Include stage, assigned roles, next meeting, last communication, and the next action. Be concise. Do not greet.',
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
    prompt: 'List signed contracts today with lead numbers, names, amounts, and closers.',
    Icon: DocumentCheckIcon,
  },
];

const WELCOME_LEAD_QUESTIONS = [
  'When is the next meeting with this lead?',
  "What's the status of the contract?",
  'Show me the last email we sent.',
];

const WELCOME_GENERAL_QUESTIONS = [...RMQ_AI_DASHBOARD_ASKS];

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

const isThinkingMessage = (content: Message['content']) =>
  content === 'AI is thinking...' || content === 'Looking up CRM data...';

function ChatThinkingIndicator({ lookingUp }: { lookingUp: boolean }) {
  return (
    <div className="ai-thinking" role="status" aria-live="polite">
      <span className="ai-thinking-ring" aria-hidden />
      <span className="ai-thinking-dots" aria-hidden>
        <span />
        <span />
        <span />
      </span>
      <span className="ai-thinking-label">
        {lookingUp ? 'Looking up CRM' : 'Thinking'}
      </span>
    </div>
  );
}

function ChatWelcomeHome({
  hasLead,
  disabled,
  onAction,
}: {
  hasLead: boolean;
  disabled?: boolean;
  onAction: (prompt: string) => void;
}) {
  const actions = hasLead ? WELCOME_LEAD_ACTIONS : WELCOME_GENERAL_ACTIONS;
  const questions = hasLead ? WELCOME_LEAD_QUESTIONS : WELCOME_GENERAL_QUESTIONS;
  return (
    <div className="ai-welcome-home mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center px-1 py-6">
      <div className="ai-welcome-orb mb-5">
        <RmqAiLogo className="h-[5.25rem] w-[5.25rem]" />
      </div>
      <h2 className="ai-welcome-title text-center text-2xl font-bold tracking-tight">
        {hasLead ? 'How can I help with this lead?' : 'How can I help you?'}
      </h2>
      <p className="ai-welcome-sub mt-2 max-w-md text-center text-sm">
        {hasLead
          ? 'Ask about meetings, follow-ups, contracts or communication.'
          : 'Ask about your day, meetings, follow-ups or signed deals.'}
      </p>
      <div className="mt-7 grid w-full grid-cols-1 gap-2.5 sm:grid-cols-2">
        {actions.map(({ label, hint, prompt, Icon }) => (
          <button
            key={label}
            type="button"
            className="ai-welcome-card"
            disabled={disabled}
            onClick={() => onAction(prompt)}
          >
            <span className="ai-welcome-card-icon">
              <Icon className="h-6 w-6" />
            </span>
            <span className="min-w-0 text-left leading-snug">
              <span className="ai-welcome-card-title block text-sm font-semibold">{label}</span>
              <span className="ai-welcome-card-hint mt-0.5 block text-xs">{hint}</span>
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
            <SparklesIcon className="h-5 w-5 shrink-0" />
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
    if (
      message.content === 'AI is thinking...' ||
      message.content === 'Looking up CRM data...'
    ) {
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
  const attachMenuRef = useRef<HTMLDivElement>(null);
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
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historySelecting, setHistorySelecting] = useState(false);
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<string[]>([]);
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

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(scrollToBottom, [messages]);

  useEffect(() => {
    if (!attachMenuOpen) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (attachMenuRef.current?.contains(target)) return;
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
      if (message.content === 'AI is thinking...' || message.content === 'Looking up CRM data...') continue;
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
  const handleQuickAction = (action: string) => {
    handleSend(action);
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
    let normalized = content
      .replace(/^[-]{2,}/gm, '')
      .replace(/[-]{3,}/g, '—')
      .replace(/\[(?:#)?([LC]\d+(?:\/\d+)?)\]\((?:#|javascript:[^)]*)?\)/gi, '$1')
      .replace(/\n{2,}(?=\s*\d+[.)]\s)/g, '\n');
    
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
      <ChatStageBadgeText text={value} stages={stages} employees={employees} onOpen={onClose} />
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

  const completeAssistantTurn = async (
    conversationMessages: Message[],
    imagesData: Array<{ name: string; data: string }> = [],
    extraApiMessages: Message[] = [],
  ) => {
    await syncOpenClient();
    const lastUser = [...conversationMessages].reverse().find((message) => message.role === 'user');
    beginRmqAiTurn({
      userMessage: String(lastUser?.content || '').slice(0, 240),
      availableTools: RMQ_AI_TOOLS.map((tool) => tool.function.name),
      pageType: location.pathname.startsWith('/clients')
        ? 'client'
        : location.pathname.split('/').filter(Boolean)[0] || 'app',
    });
    const messagesForApi = sanitizeMessages([...conversationMessages, ...extraApiMessages]).map(
      ({
        attachments: _attachments,
        meetingCard: _meetingCard,
        calendarMeetings: _calendarMeetings,
        draftAction: _draftAction,
        ...message
      }) => message,
    );

    const callChat = async (payloadMessages: Message[], includeImages = false) => {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify({
          messages: [{
            role: 'system',
            content: [RMQ_AI_SYSTEM_PROMPT, describeCurrentLeadForPrompt()].filter(Boolean).join(' '),
          }, ...payloadMessages],
          images: includeImages ? imagesData : [],
          tools: RMQ_AI_TOOLS,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || `Request failed with status ${response.status}`);
      }
      return data as Message;
    };

    try {
      let conversation = messagesForApi;
      let aiResponseMessage: Message | null = null;
      const createdFiles: RmqAiChatFile[] = [];
      const appMapLinks: string[] = [];
      let meetingCard: ChatMeetingCardData | undefined;
      let calendarMeetings: ChatCalendarDayData | undefined;
      let documentLinks: FollowupDocumentLinks = {
        contractSigningUrl: null,
        poaUrl: null,
        invoiceUrl: null,
      };
      for (let round = 0; round < 6; round += 1) {
        const reply = await callChat(conversation, round === 0);
        if (reply.tool_calls?.length) {
          conversation = [
            ...conversation,
            { role: 'assistant', content: reply.content || '', tool_calls: reply.tool_calls },
          ];
          setMessages((prev) => [
            ...prev.slice(0, -1),
            { role: 'assistant', content: 'Looking up CRM data...' },
          ]);
          for (const toolCall of reply.tool_calls) {
            const toolResult = await executeRmqAiTool(toolCall);
            const fnName = toolCall?.function?.name;
            createdFiles.push(...takeRmqAiToolFiles());
            if (fnName === 'get_lead_case_file' || fnName === 'draft_client_message') {
              const parsed = parseFollowupDocumentLinks(String(toolResult));
              documentLinks = {
                contractSigningUrl: parsed.contractSigningUrl || documentLinks.contractSigningUrl,
                poaUrl: parsed.poaUrl || documentLinks.poaUrl,
                invoiceUrl: parsed.invoiceUrl || documentLinks.invoiceUrl,
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
            if (fnName === 'create_excel_sheet' && !String(toolResult).startsWith('Could not') && !String(toolResult).startsWith('create_excel_sheet')) {
              toast.success('Excel file ready to download');
            }
            if (fnName === 'list_client_meetings') {
              meetingCard = parseClientMeetingCard(toolResult) || meetingCard;
            }
            if (fnName === 'list_calendar_day' || fnName === 'list_meetings') {
              calendarMeetings = parseCalendarDayCards(toolResult) || calendarMeetings;
            }
            conversation = [
              ...conversation,
              { role: 'tool', content: toolResult, tool_call_id: toolCall.id },
            ];
          }
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
      setMessages((prev) => [
        ...prev.slice(0, -1),
        {
          role: 'assistant',
          content: storedContent,
          attachments: createdFiles.length ? createdFiles : undefined,
          draftAction,
          meetingCard,
          calendarMeetings,
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
          };
        }
        return updated;
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSend = async (customInput?: string) => {
    const messageToSend = customInput || input;
    if (!messageToSend.trim() && images.length === 0) return;
    await syncOpenClient();
    setIsLoading(true);

    let userMessage: any;
    if (images.length > 0 && imagePreviews.length > 0) {
      userMessage = {
        role: 'user',
        content: [
          ...(messageToSend.trim() ? [{ type: 'text', text: messageToSend.trim() }] : []),
          ...imagePreviews.map(url => ({ type: 'image_url', image_url: { url } }))
        ]
      };
    } else {
      userMessage = { role: 'user', content: messageToSend.trim() };
    }
    const priorMessages = messages.filter((message) => !isWelcomeMessage(message));
    const newMessages = [...priorMessages, userMessage];
    const imagesData = images.map((file, index) => ({
      name: file.name,
      data: imagePreviews[index],
    }));

    if (!customInput) {
      setInput('');
      setCaret(0);
      setSuggestDismissed(true);
    }
    setImages([]);
    setImagePreviews([]);
    if (fileInputRef.current) fileInputRef.current.value = '';

    setMessages([...newMessages, { role: 'assistant', content: 'AI is thinking...' }]);
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
    setMessages([...trimmed, { role: 'assistant', content: 'AI is thinking...' }]);
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

  const saveCurrentChat = async () => {
    if (messages.length <= 1) return; // Don't save if only greeting message
    
    try {
      const messagesToSave = messages.filter(
        (msg) =>
          isVisibleChatMessage(msg) &&
          msg.content !== '...' &&
          msg.content !== 'AI is thinking...' &&
          msg.content !== 'Looking up CRM data...',
      );
      const user = (await supabase.auth.getUser()).data.user;
      if (!user) throw new Error('User not authenticated');
      
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
            p_messages: messagesToSave
          });
          if (error) throw error;
          setCurrentChatId(data);
        } catch (rpcError) {
          // Fallback to direct insert
          const title = messagesToSave.find(msg => msg.role === 'user')?.content?.substring(0, 50) || 'New Conversation';
          const { data, error } = await supabase
            .from('ai_chat_history')
            .insert({
              user_id: user.id,
              title: title,
              messages: messagesToSave,
              message_count: messagesToSave.length
            })
            .select('id')
            .single();
          if (error) throw error;
          setCurrentChatId(data.id);
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
      setCurrentChatId(chatId);
      setShowHistoryPanel(false);
      toast.success(`Loaded: ${data.title}`);
    } catch (error) {
      console.error('Error loading chat:', error);
      toast.error('Failed to load chat');
    }
  };

  const startNewChat = () => {
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

  // Load chat history when component opens
  useEffect(() => {
    if (isOpen) {
      loadChatHistory();
    }
  }, [isOpen]);

  // Auto-save chat when messages change
  useEffect(() => {
    if (messages.length > 1 && !isLoading) {
      const saveTimeout = setTimeout(saveCurrentChat, 2000); // Save after 2 seconds of inactivity
      return () => clearTimeout(saveTimeout);
    }
  }, [messages, isLoading]);

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
    panelResizeRef.current = {
      pointerId: event.pointerId,
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
    const right = resize.origLeft + resize.origWidth;
    const bottom = resize.origTop + resize.origHeight;
    const nextSize = clampPanelSize({
      width: right - (resize.origLeft + (event.clientX - resize.startX)),
      height: bottom - (resize.origTop + (event.clientY - resize.startY)),
    });
    const nextPos = clampPanelPos(
      { left: right - nextSize.width, top: bottom - nextSize.height },
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

  if (!isOpen) return null;

  return (
    <>
    <div
      ref={panelRef}
      className={`${isPlacedPanel || isMovingPanel || isResizingPanel || hasCustomSize ? '' : `ai-drawer-enter ${isFloatingPanel ? 'ai-drawer-enter-float' : 'ai-drawer-enter-sheet'}`} fixed z-[10050] flex flex-col overflow-hidden ${isDragActive ? 'ring-4 ring-primary/40' : ''} ${
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
        .ai-resize-nw {
          position: absolute;
          top: 0;
          left: 0;
          z-index: 45;
          width: 32px;
          height: 32px;
          padding: 0;
          border: 0;
          background: transparent;
          cursor: nwse-resize;
          touch-action: none;
        }
        .ai-resize-nw::before {
          content: '';
          position: absolute;
          top: 8px;
          left: 8px;
          width: 11px;
          height: 11px;
          border-top: 2px solid currentColor;
          border-left: 2px solid currentColor;
          border-radius: 3px 0 0 0;
          opacity: 0.62;
        }
        .ai-resize-nw:hover::before,
        .ai-resize-nw:focus-visible::before {
          opacity: 0.8;
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
            font-size: 1.125rem !important;
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
          min-height: 1.5rem;
        }
        .ai-thinking-ring {
          width: 1.15rem;
          height: 1.15rem;
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
          .ai-send-thinking {
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
        
        /* Mobile input focus styles */
        @media (max-width: 768px) {
          .contract-ai-input-area textarea:focus {
            font-size: 16px;
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
          padding-top: calc(4.1rem + max(1rem, env(safe-area-inset-top, 0px)));
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
      {(canResizePanel || isFullPage) && !isMobile ? (
        <button
          type="button"
          className={`ai-resize-nw ${isDarkTheme ? 'text-zinc-300' : 'text-gray-500'}`}
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
          aria-label={isFullPage ? 'Double-click to exit full page' : 'Resize chat from the top-left corner. Double-click for full page.'}
        />
      ) : null}
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
          className="ai-chat-header absolute inset-x-0 top-0 z-30 flex items-center pb-3 pt-[max(1rem,env(safe-area-inset-top))]"
          onPointerDown={beginPanelMove}
          onPointerMove={movePanel}
          onPointerUp={endPanelMove}
          onPointerCancel={endPanelMove}
          title="Hold and drag to move"
        >
          <div
            className={`flex items-center ${
              showHistoryPanel ? 'w-72 shrink-0 pl-5 pr-2 md:w-96' : 'pl-5'
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
                <RmqAiLogo src={RMQ_AI_HEADER_LOGO_SRC} className="h-11 w-11" />
              </button>
              <div className="flex min-w-0 flex-col justify-center leading-tight">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    className={`text-base font-bold ${isDarkTheme ? 'text-zinc-100' : 'text-gray-900'}`}
                    onClick={() => setShowRmqAiIntroModal(true)}
                    aria-haspopup="dialog"
                    aria-expanded={showRmqAiIntroModal}
                    aria-label="About RMQ AI"
                    title="About RMQ AI"
                  >
                    RMQ AI
                  </button>
                  <span
                    className={`inline-flex h-4 shrink-0 -translate-y-1 items-center rounded-full px-1.5 text-[9px] font-bold uppercase leading-none tracking-wide ${
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
                showHistoryPanel ? 'left-72 right-0 md:left-96' : 'inset-x-0'
              } top-[max(1rem,env(safe-area-inset-top))] bottom-3`}
            >
              <span
                className={`pointer-events-auto max-w-[11rem] truncate rounded-full px-2.5 py-1 text-[11px] font-medium ${
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
              onClick={onClose}
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
          {showHistoryPanel && (
            <div className="ai-chat-under-header flex w-72 shrink-0 flex-col overflow-hidden bg-white md:w-96">
              <div className="bg-white p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="font-semibold text-gray-900">
                    Chat History
                  </h3>
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
                      onClick={startNewChat}
                      className="ai-send-btn inline-flex h-9 items-center gap-1.5 rounded-full border-0 px-4 text-sm font-semibold text-white shadow-sm transition"
                      title="Start New Chat"
                    >
                      <PlusIcon className="h-4 w-4" strokeWidth={2.5} />
                      New
                    </button>
                  </div>
                </div>
                <div className="relative">
                  <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search conversations..."
                    value={historySearchTerm}
                    onChange={(e) => {
                      setHistorySearchTerm(e.target.value);
                      loadChatHistory(e.target.value);
                    }}
                    className="w-full rounded-xl border-0 bg-gray-100 py-2 pl-10 pr-4 text-sm text-gray-900 placeholder:text-gray-500 outline-none ring-0 focus:border-0 focus:outline-none focus:ring-0"
                  />
                </div>
              </div>
              <div className="ai-history-scroll flex-1 overflow-y-auto bg-white p-3">
                {isLoadingHistory ? (
                  <div className="flex h-32 items-center justify-center">
                    <div className="loading loading-spinner loading-md text-violet-600"></div>
                  </div>
                ) : chatHistory.length === 0 ? (
                  <div className="rounded-2xl bg-white p-8 text-center text-gray-500">
                    <ChatBubbleLeftRightIcon className="mx-auto mb-4 h-12 w-12 text-gray-300" />
                    <p className="text-lg font-medium">No conversations yet</p>
                    <p className="text-sm">Start chatting to see your history here</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {chatHistory.map((chat) => {
                      const isSelected = selectedHistoryIds.includes(chat.id);
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
                            <h4 className="truncate text-sm font-medium text-gray-900">
                              {chat.title}
                            </h4>
                            <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                              <ClockIcon className="h-3 w-3" />
                              <span>{new Date(chat.updated_at).toLocaleDateString()}</span>
                              <span>•</span>
                              <span>{chat.message_count} messages</span>
                            </div>
                            {chat.summary && (
                              <p className="mt-1 line-clamp-2 text-xs text-gray-600">
                                {chat.summary}
                              </p>
                            )}
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
            </div>
          )}
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-gray-50">
            {/* Messages */}
            <div 
              className="ai-chat-under-header ai-messages-scroll scrollbar-hide flex min-h-0 flex-1 flex-col overflow-y-auto bg-gray-50 px-4 pb-28 md:px-5 md:pb-32"
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
                />
              ) : (
              <div className="space-y-4">
              {messages.filter((msg) => isVisibleChatMessage(msg) && !isWelcomeMessage(msg)).map((msg, idx) => {
                const bubbleKey = `${idx}-${msg.role}`;
                const thinking = isThinkingMessage(msg.content);
                const asEmailDraft =
                  Boolean(msg.draftAction) || looksLikeEmailDraft(plainTextFromMessage(msg));
                const assistantText = asEmailDraft
                  ? stripAiEmailSignature(String(msg.content || ''))
                  : msg.calendarMeetings
                    ? calendarDayIntro(String(msg.content || ''))
                    : String(msg.content || '');
                const canCopy =
                  msg.role === 'assistant' &&
                  !thinking &&
                  !isWelcomeMessage(msg) &&
                  Boolean(plainTextFromMessage(msg));
                return (
                <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={
                      msg.role === 'user'
                        ? 'ai-bubble-user max-w-[85%] rounded-2xl px-5 py-4'
                        : `ai-bubble-assistant ${msg.calendarMeetings ? 'max-w-full' : 'max-w-[92%]'} ${thinking ? 'ai-bubble-thinking' : ''}`
                    }
                    style={{ fontSize: '0.9375rem', lineHeight: 1.6 }}
                  >
                    {Array.isArray(msg.content) ? (
                      msg.content.map((item, i) => {
                        if (item.type === 'text') {
                          return (
                            <div key={i} className={`ai-chat-msg-text max-w-none ${msg.role === 'user' ? 'text-white' : 'text-gray-800'} ${asEmailDraft ? '' : 'prose'}`}>
                              {formatMessageContent(
                                asEmailDraft ? stripAiEmailSignature(item.text) : item.text,
                                {
                                  employeePhotos: !isWelcomeMessage(msg),
                                  asEmailDraft,
                                  stageBadges: msg.role === 'assistant' && !asEmailDraft,
                                },
                              )}
                            </div>
                          );
                        }
                        if (item.type === 'image_url') {
                          return <img key={i} src={item.image_url.url} alt="uploaded" className="my-2 max-w-xs rounded-xl" />;
                        }
                        return null;
                      })
                    ) : thinking ? (
                      <ChatThinkingIndicator lookingUp={msg.content === 'Looking up CRM data...'} />
                    ) : assistantText ? (
                      <div className={`ai-chat-msg-text max-w-none ${msg.role === 'user' ? 'text-white' : 'text-gray-800'} ${asEmailDraft ? '' : 'prose'}`}>
                        {formatMessageContent(
                          assistantText,
                          {
                            employeePhotos: !isWelcomeMessage(msg),
                            asEmailDraft,
                            stageBadges: msg.role === 'assistant' && !asEmailDraft,
                          },
                        )}
                      </div>
                    ) : null}
                    {msg.role === 'assistant' && msg.meetingCard ? (
                      <ChatMeetingCards data={msg.meetingCard} />
                    ) : null}
                    {msg.role === 'assistant' && msg.calendarMeetings ? (
                      <ChatCalendarMeetingCards data={msg.calendarMeetings} employees={chatEmployees} />
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
                            onClick={() => openDraftInEmail(msg)}
                            title="Open in Email"
                            aria-label="Open draft in Email"
                          >
                            <EnvelopeIcon className="h-5 w-5" strokeWidth={1.75} />
                          </button>
                        ) : null}
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
                      className="btn btn-ghost btn-circle btn-sm h-10 w-10 text-slate-500 hover:bg-gray-100"
                      onClick={() => setAttachMenuOpen((open) => !open)}
                      disabled={isLoading}
                      aria-expanded={attachMenuOpen}
                      aria-haspopup="menu"
                      title="Add"
                      aria-label="Add"
                    >
                      <PlusIcon className="h-5 w-5" />
                    </button>
                    {attachMenuOpen ? (
                      <div
                        role="menu"
                        className="absolute bottom-full left-0 z-50 mb-2 w-80 rounded-2xl border border-gray-100 bg-white py-1.5 shadow-lg"
                      >
                        <button
                          type="button"
                          role="menuitem"
                          className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50"
                          onClick={() => {
                            setAttachMenuOpen(false);
                            fileInputRef.current?.click();
                          }}
                        >
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-600">
                            <PhotoIcon className="h-4 w-4" />
                          </span>
                          <span className="min-w-0 leading-snug">
                            <span className="text-sm font-medium text-gray-900">Images</span>
                            {' '}
                            <span className="text-xs text-gray-500">Attach photos to this chat</span>
                          </span>
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50"
                          onClick={() => {
                            setAttachMenuOpen(false);
                            onClose();
                            navigate('/documents');
                          }}
                        >
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
                            <DocumentArrowUpIcon className="h-4 w-4" />
                          </span>
                          <span className="min-w-0 leading-snug">
                            <span className="text-sm font-medium text-gray-900">Documents</span>
                            {' '}
                            <span className="text-xs text-gray-500">Open the documents folder</span>
                          </span>
                        </button>
                        <div className="my-1 border-t border-gray-100" />
                        <p className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                          Client links
                        </p>
                        <button
                          type="button"
                          role="menuitem"
                          className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50"
                          onClick={() => void insertCrmDocumentLink('contract')}
                        >
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
                            <DocumentCheckIcon className="h-4 w-4" />
                          </span>
                          <span className="min-w-0 leading-snug">
                            <span className="text-sm font-medium text-gray-900">Contract</span>
                            {' '}
                            <span className="text-xs text-gray-500">Insert this client’s signing link</span>
                          </span>
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50"
                          onClick={() => void insertCrmDocumentLink('poa')}
                        >
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-700">
                            <DocumentTextIcon className="h-4 w-4" />
                          </span>
                          <span className="min-w-0 leading-snug">
                            <span className="text-sm font-medium text-gray-900">POA</span>
                            {' '}
                            <span className="text-xs text-gray-500">Insert this client’s POA link</span>
                          </span>
                        </button>
                        <div className="my-1 border-t border-gray-100" />
                        <p className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                          Quick asks
                        </p>
                        {READY_ASKS.map(({ label, hint, prompt, Icon, badge }) => (
                          <button
                            key={label}
                            type="button"
                            role="menuitem"
                            className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50"
                            onClick={() => {
                              setAttachMenuOpen(false);
                              handleQuickAction(prompt);
                            }}
                          >
                            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${badge}`}>
                              <Icon className="h-4 w-4" />
                            </span>
                            <span className="min-w-0 leading-snug">
                              <span className="text-sm font-medium text-gray-900">{label}</span>
                              {' '}
                              <span className="text-xs text-gray-500">{hint}</span>
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : null}
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
                        className="pointer-events-none absolute inset-0 flex items-center overflow-hidden pl-1 pr-2 text-start text-base leading-6 text-gray-400"
                      >
                        <span className="invisible whitespace-pre-wrap break-words">{input}</span>
                        <span className="whitespace-pre-wrap break-words">{ghostSuffix}</span>
                      </div>
                    ) : null}
                    <textarea
                      ref={textareaRef}
                      rows={1}
                      dir={inputIsRtl ? 'rtl' : 'ltr'}
                      className="relative min-h-0 min-w-0 w-full resize-none border-0 bg-transparent py-0 pl-1 pr-2 text-start text-base leading-6 placeholder:text-gray-500 focus:outline-none focus:ring-0"
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
                      className={`btn btn-circle btn-sm h-10 w-10 border-0 ${
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
                      className="ai-send-btn btn btn-circle btn-sm h-10 w-10 shrink-0 border-0 text-white disabled:opacity-60"
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