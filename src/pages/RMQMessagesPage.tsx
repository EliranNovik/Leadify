import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, startTransition } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../lib/supabase';
import { toast } from 'react-hot-toast';
import websocketService, { MessageData, TypingData, RmqMediaAttachmentItem } from '../lib/websocket';
import { motion, AnimatePresence } from 'framer-motion';
import { usePersistedState } from '../hooks/usePersistedState';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
import EmojiPicker from 'emoji-picker-react';
import {
  ChatBubbleLeftRightIcon,
  PaperAirplaneIcon,
  UserGroupIcon,
  PlusIcon,
  MagnifyingGlassIcon,
  EllipsisVerticalIcon,
  UserIcon,
  XMarkIcon,
  PaperClipIcon,
  FaceSmileIcon,
  ArrowLeftIcon,
  CheckIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  MicrophoneIcon,
  StopIcon,
  Squares2X2Icon,
  ChevronDownIcon,
  ChevronUpIcon,
  PhotoIcon,
  ArrowPathIcon,
  PhoneIcon,
  DevicePhoneMobileIcon,
  EnvelopeIcon,
  ClockIcon,
  TrashIcon,
  ArrowRightIcon,
  LockClosedIcon,
  LockOpenIcon,
  ChatBubbleBottomCenterTextIcon,
  PencilIcon,
  SparklesIcon,
  BookmarkIcon,
  ChevronRightIcon,
  ArrowUturnLeftIcon,
  FlagIcon
} from '@heroicons/react/24/outline';
import { format, isToday, isYesterday, isSameWeek, formatDistanceToNow } from 'date-fns';
import EmployeeModal from '../components/EmployeeModal';
import RmqMessageFlagLeadModal, { type LeadPick } from '../components/RmqMessageFlagLeadModal';
import {
  fetchRmqMessageFlagsForConversation,
  insertRmqMessageLeadFlag,
  deleteRmqMessageLeadFlag,
  rmqFlaggerDisplayName,
  type RmqMessageLeadFlagRow,
} from '../lib/rmqMessageLeadFlags';
import { fetchFlagTypes, flagTypeLabel, type FlagTypeRow } from '../lib/userContentFlags';
import { useExternalUser } from '../hooks/useExternalUser';

interface User {
  id: string;
  full_name: string;
  email: string;
  employee_id?: number;
  is_active?: boolean;
  tenants_employee?: {
    display_name: string;
    official_name?: string;
    bonuses_role: string;
    department_id: number;
    photo_url?: string;
    mobile?: string;
    phone?: string;
    phone_ext?: string;
    mobile_ext?: string;
    tenant_departement?: {
      name: string;
    };
  };
}

interface Conversation {
  id: number;
  title?: string;
  type: 'direct' | 'group' | 'announcement';
  created_by: string;
  created_at: string;
  updated_at: string;
  last_message_at: string;
  last_message_preview?: string;
  is_active: boolean;
  description?: string;
  notes?: string;
  icon_url?: string;
  is_locked?: boolean;
  participants: ConversationParticipant[];
  unread_count?: number;
}

interface ConversationParticipant {
  id: number;
  user_id: string;
  joined_at: string;
  last_read_at: string;
  is_active: boolean;
  role: 'admin' | 'member' | 'moderator';
  user: User;
}

interface MessageReaction {
  user_id: string;
  emoji: string;
  timestamp: string;
}

interface Message {
  id: number;
  conversation_id: number;
  sender_id: string;
  content: string;
  message_type: 'text' | 'file' | 'image' | 'system' | 'voice' | 'album';
  sent_at: string;
  edited_at?: string;
  is_deleted: boolean;
  attachment_url?: string;
  attachment_name?: string;
  attachment_type?: string;
  attachment_size?: number;
  media_attachments?: RmqMediaAttachmentItem[];
  reply_to_message_id?: number;
  reactions: MessageReaction[];
  sender: User;
  reply_to_message?: Message;
  voice_duration?: number;
  voice_waveform?: any;
  is_voice_message?: boolean;
  delivery_status?: string;
  read_receipts?: Array<{
    user_id: string;
    read_at: string;
  }>;
}

type RmqPersistedMessageBundle = {
  messages: Message[];
  lastFetched: number;
  lastMessageId: number | null;
  oldestMessageId?: number | null;
  hasMoreOlder?: boolean;
};

/** Supabase select fragment for full message rows (matches fetchMessages / loadOlderMessages). */
const RMQ_MESSAGE_LIST_SELECT = `
  id,
  conversation_id,
  sender_id,
  content,
  message_type,
  sent_at,
  edited_at,
  is_deleted,
  attachment_url,
  attachment_name,
  attachment_type,
  attachment_size,
  media_attachments,
  reply_to_message_id,
  reactions,
  voice_duration,
  voice_waveform,
  is_voice_message,
  delivery_status,
  sender:users!sender_id(
    id,
    full_name,
    email,
    employee_id,
    is_active,
    tenants_employee!users_employee_id_fkey(
      display_name,
      bonuses_role,
      photo_url
    )
  )
`;

type RmqPinnedRow = {
  pinRowId: number;
  message: Message;
  pinned_at: string;
};

/** Row from public.rmq_message_comments */
type RmqMessageComment = {
  id: number;
  message_id: number;
  conversation_id: number;
  user_id: string;
  body: string;
  created_at: string;
  sender?: User;
};

interface MessagingModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialConversationId?: number;
  /** When opening from CRM “flagged RMQ message”, scroll this chat to this message id. */
  initialScrollToMessageId?: number;
  initialUserId?: string;
  initialMessage?: string;
  initialLeadNumber?: string;
  initialLeadName?: string;
}

/** RMQ chat UI tokens — restrained radius; bubble column capped for readability, aligned to thread edges (not centered). */
const RMQ_CHAT = {
  bubbleR: 'rounded-[10px]',
  bubblePad: 'px-3 py-2',
  /** Sent bubble fill — purple aligned with RMQ header/chat icon (#4829CC). */
  sentBg: '#4829CC',
  /** Links in received message text (olive; not tied to sent bubble color). */
  recvLinkColor: '#4F5C47',
  /** Links inside own (sent) bubbles — same sky as “Leave a Comment” on group messages (`text-sky-200`). */
  linkOwn: 'underline font-semibold text-sky-200 hover:text-sky-100',
  recv: 'bg-[#F5F5F5] text-[#111827]',
  /** Per-message column width cap — full width of chat pane up to ~48rem; own msgs stay right-aligned, others left. */
  bubbleMax: 'w-full min-w-0 max-w-[min(100%,48rem)]',
  /** Single image/video: shrink-wrap to media width (still capped). */
  mediaColumn: 'w-fit min-w-0 max-w-[min(100%,48rem)]',
  /** Media bubble: use full column width (bubbleMax), not a fixed ~220px strip. */
  image: 'w-full min-w-0 max-w-full',
  imageR: 'rounded-[10px]',
} as const;

/** Group consecutive messages from the same sender (Slack-style) if within this gap. */
const RMQ_GROUP_GAP_MS = 5 * 60 * 1000;

/** WhatsApp-style tick path — shared by chat bubbles and sidebar read previews. */
const RMQ_READ_RECEIPT_CHECK_D =
  'M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z';

/** Chats/Groups segmented control — active pill: standard white raised tab. */
const RMQ_TAB_ACTIVE =
  'rmq-tab-pill bg-white text-base-content shadow-[0_1px_2px_rgba(0,0,0,0.1)] dark:bg-base-100 dark:shadow-[0_1px_4px_rgba(0,0,0,0.3)]';
const RMQ_TAB_ACTIVE_COUNT =
  'bg-neutral-200/90 text-base-content/70 dark:bg-base-300/80';
/** Selected contact or group row — brand lavender (separate from tab pill). */
const RMQ_SEL_ROW =
  'rmq-thread-selected bg-[#EDE9F8] text-[#3E28CD] shadow-[0_1px_2px_rgba(62,40,205,0.14)] dark:bg-[#3E28CD]/22 dark:text-[#e8e2ff] dark:shadow-[0_1px_4px_rgba(0,0,0,0.32)]';
const RMQ_SEL_TITLE = 'text-[#3E28CD] dark:text-[#e8e2ff]';
const RMQ_SEL_TIME = 'text-[#3E28CD]/60 dark:text-[#e8e2ff]/65';
const RMQ_SEL_PREVIEW = 'text-[#3E28CD]/78 dark:text-[#e8e2ff]/78';
const RMQ_SEL_META = 'text-[#3E28CD]/58 dark:text-[#e8e2ff]/58';

const RMQMessagesPage: React.FC<MessagingModalProps> = ({
  isOpen,
  onClose,
  initialConversationId,
  initialScrollToMessageId,
  initialUserId,
  initialMessage,
  initialLeadNumber,
  initialLeadName,
}) => {
  // Check if user is external
  const { isExternalUser } = useExternalUser();

  // State management
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  // Persisted state for conversations and messages (survives modal close/reopen and tab switches)
  const [persistedConversations, setPersistedConversations] = usePersistedState<Conversation[]>('rmq_conversations', [], {
    storage: 'sessionStorage',
  });
  const [persistedMessages, setPersistedMessages] = usePersistedState<Record<number, RmqPersistedMessageBundle>>('rmq_messages', {}, {
    storage: 'sessionStorage',
  });
  const [persistedSelectedConversationId, setPersistedSelectedConversationId] = usePersistedState<number | null>('rmq_selectedConversationId', null, {
    storage: 'sessionStorage',
  });
  const [persistedActiveTab, setPersistedActiveTab] = usePersistedState<'chats' | 'groups'>('rmq_activeTab', 'chats', {
    storage: 'sessionStorage',
  });

  // Local state (synced with persisted state)
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [activeTab, setActiveTab] = useState<'chats' | 'groups'>('chats');
  const [isLoadingOlderMessages, setIsLoadingOlderMessages] = useState(false);
  const [hasMoreOlderMessages, setHasMoreOlderMessages] = useState(false);
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [isDesktopLayout, setIsDesktopLayout] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1024);
  const [rmqAiSuggestions, setRmqAiSuggestions] = useState<string[]>([]);
  const [showRmqAiPanel, setShowRmqAiPanel] = useState(false);
  const [rmqAiLoading, setRmqAiLoading] = useState(false);
  const [rmqPinnedRows, setRmqPinnedRows] = useState<RmqPinnedRow[]>([]);
  const [rmqPinnedLoading, setRmqPinnedLoading] = useState(false);
  const [rmqMessageCommentCounts, setRmqMessageCommentCounts] = useState<Record<number, number>>({});
  const [rmqMessageCommentsModal, setRmqMessageCommentsModal] = useState<Message | null>(null);
  const [rmqMessageCommentsList, setRmqMessageCommentsList] = useState<RmqMessageComment[]>([]);
  const [rmqMessageCommentsLoading, setRmqMessageCommentsLoading] = useState(false);
  const [rmqNewCommentText, setRmqNewCommentText] = useState('');
  const [rmqSubmittingComment, setRmqSubmittingComment] = useState(false);

  // Cache timestamps and flags
  const conversationsLastFetchedRef = useRef<number>(0);
  // Use a very long cache duration for persisted state (sessionStorage persists across modal close/open)
  const MESSAGE_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours - messages cache duration (persisted in sessionStorage)
  const CONVERSATION_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours - conversations cache duration
  const MESSAGE_PAGE_SIZE = 80;
  const MAX_PRELOAD_IMAGE_URLS = 300;
  const VIRTUAL_MSG_THRESHOLD = 60;
  const hasRestoredFromCacheRef = useRef<boolean>(false);
  const fetchMessagesInFlightRef = useRef<Map<number, Promise<void>>>(new Map());
  /** Ignore stale pin fetches when switching conversations quickly. */
  const pinnedMessagesLoadSeqRef = useRef(0);
  const persistedMessagesRef = useRef(persistedMessages);
  const currentUserForSocketRef = useRef<User | null>(null);
  const allUsersForSocketRef = useRef<User[]>([]);
  const lastLoadOlderAtRef = useRef<number>(0);

  // Helper function to select conversation (updates both local and persisted state)
  const selectConversation = useCallback((conversation: Conversation | null) => {
    setSelectedConversation(conversation);
    if (conversation) {
      setPersistedSelectedConversationId(conversation.id);
    } else {
      setPersistedSelectedConversationId(null);
    }
  }, []);

  useEffect(() => {
    persistedMessagesRef.current = persistedMessages;
  }, [persistedMessages]);

  useEffect(() => {
    currentUserForSocketRef.current = currentUser;
  }, [currentUser]);

  useEffect(() => {
    allUsersForSocketRef.current = allUsers;
  }, [allUsers]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(min-width: 1024px)');
    const fn = () => setIsDesktopLayout(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  const [showMobileConversations, setShowMobileConversations] = useState(true);
  const [showMobileGroupMembers, setShowMobileGroupMembers] = useState(false);
  const [showDesktopGroupMembers, setShowDesktopGroupMembers] = useState(false);
  const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [newGroupTitle, setNewGroupTitle] = useState('');
  const [newGroupDescription, setNewGroupDescription] = useState('');
  const [isSuperUser, setIsSuperUser] = useState(false);
  const [showDeleteGroupModal, setShowDeleteGroupModal] = useState(false);
  const [showGroupInfoModal, setShowGroupInfoModal] = useState(false);
  const [groupTitle, setGroupTitle] = useState('');
  const [groupDescription, setGroupDescription] = useState('');
  const [groupNotes, setGroupNotes] = useState('');
  const [groupIconUrl, setGroupIconUrl] = useState<string | null>(null);
  const [isUpdatingGroupInfo, setIsUpdatingGroupInfo] = useState(false);
  const [isUploadingIcon, setIsUploadingIcon] = useState(false);
  const groupIconInputRef = useRef<HTMLInputElement>(null);
  const [isFetchingConversations, setIsFetchingConversations] = useState(false);
  const fetchConversationsAbortControllerRef = useRef<AbortController | null>(null);

  // Chat background image state
  const [chatBackgroundImageUrl, setChatBackgroundImageUrl] = useState<string | null>(null);
  const [isUploadingBackground, setIsUploadingBackground] = useState(false);
  const backgroundImageInputRef = useRef<HTMLInputElement>(null);

  // File attachment state
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Drag and drop state
  const [isDragOver, setIsDragOver] = useState(false);

  /** WhatsApp-style: local preview before upload/send; caption uses main composer (`newMessage`) */
  type PendingMediaItem = { file: File; previewUrl: string };
  const [pendingMediaDraft, setPendingMediaDraft] = useState<PendingMediaItem[] | null>(null);

  // Media gallery state
  const [isMediaModalOpen, setIsMediaModalOpen] = useState(false);
  const [selectedMediaIndex, setSelectedMediaIndex] = useState(0);
  const [conversationMedia, setConversationMedia] = useState<Message[]>([]);

  // Emoji picker state
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);

  // Lead search state
  const [isLeadSearchOpen, setIsLeadSearchOpen] = useState(false);
  const [leadSearchQuery, setLeadSearchQuery] = useState('');
  const [leadSearchResults, setLeadSearchResults] = useState<any[]>([]);

  // Employee modal state
  const [showEmployeeInfoModal, setShowEmployeeInfoModal] = useState(false);
  const [showEmployeeProfileModal, setShowEmployeeProfileModal] = useState(false);
  const [showBusinessCardModal, setShowBusinessCardModal] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<any>(null);

  // Employee availability state
  const [isEmployeeUnavailable, setIsEmployeeUnavailable] = useState(false);
  const [unavailabilityReason, setUnavailabilityReason] = useState<string | null>(null);
  const [unavailabilityTimePeriod, setUnavailabilityTimePeriod] = useState<string | null>(null);

  // Forward message state
  const [showForwardModal, setShowForwardModal] = useState(false);
  const [messageToForward, setMessageToForward] = useState<Message | null>(null);
  const [forwardSearchQuery, setForwardSearchQuery] = useState('');

  /** Flag message → lead (same flag_types as CRM) */
  const [rmqMessageFlagTypes, setRmqMessageFlagTypes] = useState<FlagTypeRow[]>([]);
  const [rmqMessageLeadFlags, setRmqMessageLeadFlags] = useState<RmqMessageLeadFlagRow[]>([]);
  const [rmqMessageLeadFlagsLoading, setRmqMessageLeadFlagsLoading] = useState(false);
  const [showRmqFlagLeadModal, setShowRmqFlagLeadModal] = useState(false);
  const [messageToFlag, setMessageToFlag] = useState<Message | null>(null);
  const [flagLeadSearchBusy, setFlagLeadSearchBusy] = useState(false);

  const rmqFlaggedMessageIds = useMemo(
    () => new Set(rmqMessageLeadFlags.map(f => f.message_id)),
    [rmqMessageLeadFlags]
  );

  // Message actions state (reply, edit, delete)
  const [messageToReply, setMessageToReply] = useState<Message | null>(null);
  const [messageToEdit, setMessageToEdit] = useState<Message | null>(null);
  const [editingMessageText, setEditingMessageText] = useState('');
  const [messageActionMenu, setMessageActionMenu] = useState<number | null>(null);
  /** Viewport anchor for desktop message ⋯ menu (portal + fixed; avoids scroll/overflow clipping). */
  const [messageMenuAnchor, setMessageMenuAnchor] = useState<{
    left: number;
    right: number;
    top: number;
    isOwn: boolean;
  } | null>(null);
  const messageActionMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const [mobileMessageActionMessage, setMobileMessageActionMessage] = useState<Message | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressMessageRef = useRef<Message | null>(null);
  const longPressHandledRef = useRef<boolean>(false);

  const closeMessageActionMenu = useCallback(() => {
    setMessageActionMenu(null);
    setMessageMenuAnchor(null);
    messageActionMenuButtonRef.current = null;
  }, []);

  // Online status state
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const [lastOnlineTimes, setLastOnlineTimes] = useState<Map<string, Date>>(new Map());
  const [typingUsers, setTypingUsers] = useState<Map<number, { userId: string; userName: string }>>(new Map());

  // Contact availability map (for sidebar)
  const [contactAvailabilityMap, setContactAvailabilityMap] = useState<{ [key: string]: boolean }>({});
  const [isSearchingLeads, setIsSearchingLeads] = useState(false);
  const [selectedLead, setSelectedLead] = useState<any>(null);
  const [showMobileTools, setShowMobileTools] = useState(false);
  const [showDesktopTools, setShowDesktopTools] = useState(false);

  // Group member management state
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  const [showRemoveMemberModal, setShowRemoveMemberModal] = useState(false);
  const [membersToAdd, setMembersToAdd] = useState<string[]>([]);
  const [memberSearchQuery, setMemberSearchQuery] = useState('');

  // Reactions state
  const [showReactionPicker, setShowReactionPicker] = useState<number | null>(null);
  const [reactingMessageId, setReactingMessageId] = useState<number | null>(null);

  // Voice recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [audioChunks, setAudioChunks] = useState<Blob[]>([]);
  const [voiceSessionToken, setVoiceSessionToken] = useState<string | null>(null);
  const [recordingStartTime, setRecordingStartTime] = useState<number | null>(null);

  // Voice playback state
  const [playingVoiceId, setPlayingVoiceId] = useState<number | null>(null);
  const [voiceAudio, setVoiceAudio] = useState<HTMLAudioElement | null>(null);
  const [voiceProgress, setVoiceProgress] = useState<{ [key: number]: number }>({});
  const [failedPhotoIds, setFailedPhotoIds] = useState<Record<string, boolean>>({});

  // Typing indicators removed - causing too many issues

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const mobileMessageInputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastTypingSentAtRef = useRef<number>(0);
  const TYPING_INDICATOR_THROTTLE_MS = 500;
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const desktopMessagesContainerRef = useRef<HTMLDivElement>(null);
  const mobileMessagesContainerRef = useRef<HTMLDivElement>(null);
  const mobileToolsRef = useRef<HTMLDivElement>(null);
  const desktopToolsRef = useRef<HTMLDivElement>(null);

  /** Scroll the visible chat pane to a message. Must query inside the active container — both desktop and mobile trees render [data-message-id], and document.querySelector picks the hidden one first on phone. */
  const scrollToMessage = useCallback((messageId: number, behavior: 'smooth' | 'instant' = 'instant') => {
    const sel = `[data-message-id="${messageId}"]`;
    const isMobileViewport = typeof window !== 'undefined' && window.innerWidth < 1024;
    const ordered: (HTMLDivElement | null)[] = isMobileViewport
      ? [mobileMessagesContainerRef.current, desktopMessagesContainerRef.current, messagesContainerRef.current]
      : [desktopMessagesContainerRef.current, mobileMessagesContainerRef.current, messagesContainerRef.current];

    let container: HTMLElement | null = null;
    let messageElement: Element | null = null;
    for (const c of ordered) {
      if (!c || !c.offsetParent) continue;
      const el = c.querySelector(sel);
      if (el) {
        container = c;
        messageElement = el;
        break;
      }
    }

    if (!messageElement || !container) {
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const messageRect = messageElement.getBoundingClientRect();
    const relativeTop = messageRect.top - containerRect.top + container.scrollTop - 8;

    if (behavior === 'instant') {
      container.scrollTop = relativeTop;
    } else {
      container.scrollTo({
        top: Math.max(0, relativeTop),
        behavior: 'smooth',
      });
    }
  }, []);

  // Auto-scroll state
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const initialLoadRef = useRef<number | null>(null);
  /** Avoid repeating smooth-scroll when CRM reopens the same flagged message. */
  const rmqLeadScrollDoneRef = useRef<string | null>(null);
  const firstUnreadMessageIdRef = useRef<number | null>(null);
  const lastScrollPositionRef = useRef<number>(0);
  const scrollPositionCheckRef = useRef<NodeJS.Timeout | null>(null);
  const userJustScrolledToBottomRef = useRef<boolean>(false);
  const lastResizeMessageCountRef = useRef<number>(0);
  const shouldAutoScrollRef = useRef<boolean>(true);
  const isUserScrollingRef = useRef<boolean>(false);
  // After opening a chat, ignore layout-driven scroll for a while so media loading doesn't cause jump
  const scrollStabilizationUntilRef = useRef<number>(0);
  const initialScrollTimeoutRef = useRef<number | null>(null);

  // Loading state for messages
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  // Track if images are being preloaded (to prevent scroll jumping)
  const [isPreloadingImages, setIsPreloadingImages] = useState(false);

  // Video loading optimization - track which videos are ready to play
  const videoReadyRef = useRef<Set<number>>(new Set());
  const imagesLoadedRef = useRef<Set<string>>(new Set());
  // Track which videos are currently loading
  const [loadingVideos, setLoadingVideos] = useState<Set<number>>(new Set());
  // Track which videos have been loaded/attempted - persisted across modal close/open
  // Store as array in sessionStorage, convert to Set when needed
  const [loadedVideosArray, setLoadedVideosArray] = usePersistedState<number[]>('rmq_loadedVideos', [], {
    storage: 'sessionStorage',
  });
  const loadedVideos = useMemo(() => new Set(loadedVideosArray), [loadedVideosArray]);
  const loadedVideosRef = useRef<Set<number>>(loadedVideos);

  // Sync ref with state
  useEffect(() => {
    loadedVideosRef.current = loadedVideos;
  }, [loadedVideos]);

  // Helper to update loaded videos
  const addLoadedVideo = useCallback((messageId: number) => {
    setLoadedVideosArray(prev => {
      if (!prev.includes(messageId)) {
        return [...prev, messageId];
      }
      return prev;
    });
  }, [setLoadedVideosArray]);

  // Helper functions
  const getRoleDisplayName = (role: string): string => {
    const roleMap: { [key: string]: string } = {
      'pm': 'Project Manager',
      'p': 'Partner',
      'se': 'Secretary',
      'dv': 'Developer',
      'dm': 'Department Manager',
      'b': 'Book Keeper',
      'f': 'Finance',
      'h': 'Handler',
      'e': 'Expert',
      'm': 'Manager',
      'l': 'Lawyer',
      'a': 'Administrator',
      's': 'Scheduler',
      'c': 'Closer',
      'adv': 'Advocate',
      'advocate': 'Advocate',
      'handler': 'Handler',
      'expert': 'Expert',
      'manager': 'Manager',
      'lawyer': 'Lawyer',
      'admin': 'Administrator',
      'coordinator': 'Coordinator',
      'scheduler': 'Scheduler',
      'n': 'Employee', // Common abbreviation for 'No Role' or 'New'
      'ma': 'Marketing Assistant', // Marketing Assistant
      'department manager': 'Department Manager',
      'book keeper': 'Book Keeper',
      'marketing': 'Marketing',
      'sales': 'Sales'
    };

    if (!role || role.trim() === '') return 'Employee';

    const cleanRole = role.toLowerCase().trim();
    return roleMap[cleanRole] || role || 'Employee';
  };

  const getInitials = (name: string | null | undefined): string => {
    if (!name || name.trim() === '') return 'U';
    const cleanName = name.trim();
    const parts = cleanName.split(' ').filter(part => part.length > 0);
    if (parts.length === 0) return 'U';
    if (parts.length === 1) return parts[0][0].toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  interface AvatarOptions {
    userId?: string | number | null;
    name: string;
    photoUrl?: string | null;
    sizeClass?: string;
    borderClass?: string;
    gradientClass?: string;
    textClass?: string;
    loading?: 'eager' | 'lazy';
  }

  const handleAvatarError = useCallback((userIdKey: string) => {
    setFailedPhotoIds(prev => (prev[userIdKey] ? prev : { ...prev, [userIdKey]: true }));
  }, []);

  // Distinct colors for group chat sender names (stable per sender_id)
  const SENDER_NAME_COLORS = ['#059669', '#2563eb', '#7c3aed', '#c026d3', '#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#0891b2', '#4f46e5'];
  const getSenderColor = useCallback((senderId: string | number | undefined) => {
    if (senderId == null) return SENDER_NAME_COLORS[0];
    const s = String(senderId);
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h) + s.charCodeAt(i) | 0;
    return SENDER_NAME_COLORS[Math.abs(h) % SENDER_NAME_COLORS.length];
  }, []);

  const renderUserAvatar = ({
    userId,
    name,
    photoUrl,
    sizeClass = 'w-12 h-12',
    borderClass = 'border border-green-200',
    gradientClass = '',
    textClass = 'text-sm',
    loading = 'eager'
  }: AvatarOptions) => {
    const fallbackKey = userId ? String(userId) : name || 'unknown';
    if (photoUrl && !failedPhotoIds[fallbackKey]) {
      return (
        <img
          src={photoUrl}
          alt={name}
          loading={loading}
          decoding="async"
          className={`${sizeClass} rounded-full object-cover ${borderClass} bg-base-200`}
          onError={() => handleAvatarError(fallbackKey)}
        />
      );
    }

    return (
      <div
        className={`${sizeClass} rounded-full bg-green-100 dark:bg-green-900/30 ${gradientClass ? `bg-gradient-to-br ${gradientClass}` : ''} flex items-center justify-center text-green-700 dark:text-green-400 font-bold ${textClass} ${borderClass} shadow-[0_4px_12px_rgba(16,185,129,0.2)]`}
      >
        {getInitials(name)}
      </div>
    );
  };

  // Helper function to detect if message contains only emojis
  const containsHebrew = (text: string): boolean => {
    if (!text) return false;
    return /[\u0590-\u05FF]/.test(text);
  };

  // Helper function to clean markdown syntax from text
  const cleanMarkdown = (text: string): string => {
    if (!text) return '';
    // Remove markdown bold syntax (**text**)
    return text.replace(/\*\*(.*?)\*\*/g, '$1');
  };

  // Helper function to determine text direction for mixed content
  const getTextDirection = (content: string): 'ltr' | 'rtl' | 'auto' => {
    if (!content) return 'ltr';
    // Check if content contains Hebrew characters
    const hasHebrew = /[\u0590-\u05FF]/.test(content);
    // Check if content contains English/Latin characters
    const hasLatin = /[a-zA-Z]/.test(content);

    // If both Hebrew and Latin are present, use 'auto' to let browser handle bidirectional text
    // This allows the browser's Unicode bidirectional algorithm to correctly handle mixed content
    if (hasHebrew && hasLatin) {
      return 'auto';
    }

    // If only Hebrew, use RTL
    if (hasHebrew) {
      return 'rtl';
    }

    // Default to LTR for English and other languages
    return 'ltr';
  };

  /** Sidebar rows: always visually left-aligned with the name; direction set for Hebrew bidi. */
  const contactSidebarTextStyle = (dir: 'ltr' | 'rtl' | 'auto', text?: string): React.CSSProperties => {
    const hasHebrew = text ? /[\u0590-\u05FF]/.test(text) : false;
    let direction: 'ltr' | 'rtl' = 'ltr';
    if (dir === 'rtl') direction = 'rtl';
    else if (dir === 'ltr') direction = 'ltr';
    else if (dir === 'auto' && hasHebrew) direction = 'rtl';
    return {
      textAlign: 'left' as const,
      unicodeBidi: 'plaintext' as const,
      direction,
    };
  };

  const isEmojiOnly = (text: string): boolean => {
    // Simple approach: check if the text length is very short and contains emoji-like characters
    const cleanText = text.trim();
    if (cleanText.length === 0) return false;

    // Exclude Hebrew text (Unicode range \u0590-\u05FF) - it should not be treated as emoji
    const hasHebrew = /[\u0590-\u05FF]/.test(cleanText);
    if (hasHebrew) return false;

    // Check if the message is very short (likely emoji-only) and contains non-ASCII characters
    const hasNonAscii = /[^\x00-\x7F]/.test(cleanText);
    const isShort = cleanText.length <= 5; // Most emojis are 1-3 characters

    // Emoji detection: check for emoji Unicode ranges
    const emojiRegex = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]/u;
    const hasEmoji = emojiRegex.test(cleanText);

    return hasEmoji && isShort && !hasHebrew;
  };

  // Helper: turn plain text into nodes, with raw URLs (https://...) made into clickable links
  const linkifyRawUrls = (text: string, isOwn: boolean, lineIndex: number, keyPrefix: string): React.ReactNode[] => {
    if (!text) return [];
    const rawUrlRegex = /https?:\/\/[^\s<>"\']+/g;
    const nodes: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;
    let key = 0;
    while ((match = rawUrlRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        nodes.push(text.slice(lastIndex, match.index));
      }
      const url = match[0].replace(/[.,;:!?)]+$/, ''); // trim trailing punctuation from href
      nodes.push(
        <a
          key={`${keyPrefix}-${lineIndex}-${key++}`}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className={isOwn ? RMQ_CHAT.linkOwn : 'underline font-semibold hover:opacity-90'}
          style={isOwn ? undefined : { color: RMQ_CHAT.recvLinkColor }}
        >
          {match[0]}
        </a>
      );
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) {
      nodes.push(text.slice(lastIndex));
    }
    return nodes.length > 0 ? nodes : [text];
  };

  // Helper function to render clickable links and line breaks in messages
  const renderMessageContent = (content: string, isOwn: boolean = false) => {
    if (!content) return '';

    // Clean markdown syntax first
    const cleanedContent = cleanMarkdown(content);

    // First, split by line breaks to preserve them
    const lines = cleanedContent.split('\n');
    const result: React.ReactNode[] = [];

    lines.forEach((line, lineIndex) => {
      // Add line break before each line except the first
      if (lineIndex > 0) {
        result.push(<br key={`br-${lineIndex}`} />);
      }

      // Process each line: markdown-style links [text](url) and raw URLs (https://...)
      const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
      const parts: React.ReactNode[] = [];
      let lastIndex = 0;
      let match;
      let linkKey = 0;

      while ((match = linkRegex.exec(line)) !== null) {
        // Text before this markdown link may contain raw URLs
        if (match.index > lastIndex) {
          const segment = line.slice(lastIndex, match.index);
          parts.push(...linkifyRawUrls(segment, isOwn, lineIndex, `raw`));
        }

        // Add the clickable markdown link
        parts.push(
          <a
            key={`link-${lineIndex}-${linkKey++}`}
            href={match[2]}
            target="_blank"
            rel="noopener noreferrer"
            className={isOwn ? RMQ_CHAT.linkOwn : 'underline font-semibold hover:opacity-90'}
            style={isOwn ? undefined : { color: RMQ_CHAT.recvLinkColor }}
          >
            {match[1]}
          </a>
        );

        lastIndex = match.index + match[0].length;
      }

      // Remaining text after the last markdown link may contain raw URLs
      if (lastIndex < line.length) {
        const segment = line.slice(lastIndex);
        parts.push(...linkifyRawUrls(segment, isOwn, lineIndex, `raw`));
      }

      // If no links found in this line, still run linkify on the whole line (for raw URLs only)
      if (parts.length === 0) {
        parts.push(...linkifyRawUrls(line, isOwn, lineIndex, `raw`));
      }

      // Add all parts for this line to the result
      result.push(
        <React.Fragment key={`line-${lineIndex}`}>
          {parts}
        </React.Fragment>
      );
    });

    return result.length > 0 ? result : cleanedContent;
  };

  const isAlbumMessage = (message: Message): boolean =>
    message.message_type === 'album' &&
    Array.isArray(message.media_attachments) &&
    message.media_attachments.length > 0;

  const isImageMessage = (message: Message): boolean => {
    if (message.message_type === 'album') return false;
    if (!message.attachment_url) return false;
    if (message.message_type === 'image') return true;
    if (message.attachment_type && message.attachment_type.startsWith('image/')) return true;
    return false;
  };

  // Preload images for faster display when conversation opens
  // Preload images in background (non-blocking)
  const preloadImages = useCallback(async (messages: any[], waitForCritical: boolean = false): Promise<void> => {
    const imageUrls: string[] = [];
    for (const m of messages) {
      if (m.message_type === 'album' && m.media_attachments?.length) {
        for (const a of m.media_attachments) {
          if (a.type.startsWith('image/')) imageUrls.push(a.url);
        }
      } else if (isImageMessage(m) && m.attachment_url) {
        imageUrls.push(m.attachment_url);
      }
    }

    if (imageUrls.length === 0) {
      return;
    }

    // Don't set loading state - this runs in background and shouldn't block UI
    // Keep prior URL entries to avoid redundant network fetches when switching chats
    if (imagesLoadedRef.current.size > MAX_PRELOAD_IMAGE_URLS) {
      const urls = Array.from(imagesLoadedRef.current);
      imagesLoadedRef.current = new Set(urls.slice(-MAX_PRELOAD_IMAGE_URLS));
    }

    // For critical loading, only wait for the last 5 images (most recent messages)
    const criticalImages = waitForCritical ? imageUrls.slice(-5) : [];
    const otherImages = waitForCritical ? imageUrls.slice(0, -5) : imageUrls;

    // Preload critical images first and wait for them
    const criticalPromises = criticalImages.map(url => {
      return new Promise<void>((resolve) => {
        if (imagesLoadedRef.current.has(url)) {
          resolve();
          return;
        }
        const img = new Image();
        img.onload = () => {
          imagesLoadedRef.current.add(url);
          resolve();
        };
        img.onerror = () => {
          imagesLoadedRef.current.add(url); // Mark as attempted even if failed
          resolve();
        };
        img.src = url;
      });
    });

    // Wait for critical images if needed
    if (waitForCritical && criticalPromises.length > 0) {
      await Promise.all(criticalPromises);
    }

    // Preload other images in background (don't wait)
    const batchSize = 10;
    for (let i = 0; i < otherImages.length; i += batchSize) {
      const batch = otherImages.slice(i, i + batchSize);
      batch.forEach(url => {
        if (!imagesLoadedRef.current.has(url)) {
          const img = new Image();
          img.onload = () => imagesLoadedRef.current.add(url);
          img.onerror = () => imagesLoadedRef.current.add(url);
          img.src = url;
        }
      });
    }
  }, []);

  const isVideoMessage = (message: Message): boolean => {
    if (message.message_type === 'album') return false;
    if (!message.attachment_url) return false;
    if (message.attachment_type && message.attachment_type.startsWith('video/')) return true;
    return false;
  };

  /** List key: real DB ids stay stable; optimistic rows (large temp ids) use content-based key until merged */
  const getMessageListKey = (m: Message) => {
    if (m.id != null && m.id < 1_000_000_000_000) return `db-${m.id}`;
    return `tmp-${m.conversation_id}-${m.sender_id}-${(m.content || '').slice(0, 120)}-${m.message_type}-${m.attachment_url || ''}-${Array.isArray(m.media_attachments) ? m.media_attachments.map(x => x.url).join('|') : ''}`;
  };

  /** Album `content` is caption, or auto-joined filenames when no caption — only show real captions */
  const getAlbumUserCaption = (message: Message): string | null => {
    if (!isAlbumMessage(message) || !message.media_attachments?.length) return null;
    const raw = (message.content || '').trim();
    if (!raw) return null;
    const autoJoin = message.media_attachments.map(a => a.name).join(', ');
    if (raw === autoJoin) return null;
    return raw;
  };

  /** Single attachment: hide content when it duplicates attachment filename (legacy default) */
  const getAttachmentCaption = (message: Message): string | null => {
    if (!message.attachment_url) return null;
    const raw = (message.content || '').trim();
    if (!raw) return null;
    const fname = (message.attachment_name || '').trim();
    if (fname && raw === fname) return null;
    return raw;
  };

  // Lead search functionality
  const searchLeads = async (query: string) => {
    if (!query.trim() || query.length < 2) {
      setLeadSearchResults([]);
      return;
    }

    setIsSearchingLeads(true);
    try {
      // Search in both leads and leads_lead tables
      const { data: leadsData, error: leadsError } = await supabase
        .from('leads')
        .select(`
          id,
          lead_number,
          name,
          email,
          phone,
          stage
        `)
        .or(`lead_number.ilike.%${query}%,name.ilike.%${query}%,email.ilike.%${query}%`)
        .limit(10);

      const { data: legacyLeadsData, error: legacyError } = await supabase
        .from('leads_lead')
        .select(`
          id,
          lead_number,
          name,
          email,
          phone,
          stage
        `)
        .or(`lead_number.ilike.%${query}%,name.ilike.%${query}%,email.ilike.%${query}%`)
        .limit(10);

      // Combine and deduplicate results
      const allLeads = [...(leadsData || []), ...(legacyLeadsData || [])];
      const uniqueLeads = allLeads.filter((lead, index, self) =>
        index === self.findIndex(l => l.id === lead.id && l.lead_number === lead.lead_number)
      );

      setLeadSearchResults(uniqueLeads.slice(0, 10));
    } catch (error) {
      setLeadSearchResults([]);
    } finally {
      setIsSearchingLeads(false);
    }
  };

  // Handle lead selection
  const handleLeadSelect = (lead: any) => {
    setSelectedLead(lead);
    setIsLeadSearchOpen(false);
    setLeadSearchQuery('');
    setLeadSearchResults([]);

    // Add lead link to message - use deployed domain
    const deployedDomain = 'https://leadify-crm.onrender.com';
    const leadLink = `[Lead #${lead.lead_number} - ${lead.name}](${deployedDomain}/clients/${lead.lead_number})`;
    setNewMessage(prev => prev + leadLink + ' ');
    resetInputHeights();
  };

  // Voice recording functions
  const startVoiceRecording = async () => {
    if (!selectedConversation || !currentUser) return;

    try {
      // Request microphone permission
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Create voice message session
      const { data: sessionData, error: sessionError } = await supabase.rpc('create_voice_message_session', {
        p_user_id: currentUser.id,
        p_conversation_id: selectedConversation.id
      });

      if (sessionError) throw sessionError;

      setVoiceSessionToken(sessionData.session_token);

      // Create MediaRecorder
      const recorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      });

      const chunks: Blob[] = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      recorder.onstop = async () => {
        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());

        if (chunks.length > 0) {
          await uploadVoiceMessage(chunks, sessionData.session_token);
        }
      };

      recorder.start(1000); // Record in 1-second chunks
      setMediaRecorder(recorder);
      setAudioChunks(chunks);
      setIsRecording(true);
      setRecordingStartTime(Date.now());
      setRecordingDuration(0);

      // Start duration timer
      const timer = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);

      // Store timer reference for cleanup
      (recorder as any).timer = timer;

    } catch (error) {
      toast.error('Failed to start recording. Please check microphone permissions.');
    }
  };

  const stopVoiceRecording = () => {
    if (mediaRecorder && isRecording) {
      mediaRecorder.stop();
      setIsRecording(false);

      // Clear timer
      if ((mediaRecorder as any).timer) {
        clearInterval((mediaRecorder as any).timer);
      }
    }
  };

  const cancelVoiceRecording = async () => {
    if (mediaRecorder && isRecording) {
      mediaRecorder.stop();
      setIsRecording(false);

      // Clear timer
      if ((mediaRecorder as any).timer) {
        clearInterval((mediaRecorder as any).timer);
      }
    }

    // Cancel session if we have a token
    if (voiceSessionToken) {
      try {
        await supabase.rpc('cancel_voice_message_session', {
          p_session_token: voiceSessionToken
        });
      } catch (error) {
      }
    }

    // Reset state
    setAudioChunks([]);
    setVoiceSessionToken(null);
    setRecordingDuration(0);
    setRecordingStartTime(null);
  };

  const uploadVoiceMessage = async (chunks: Blob[], sessionToken: string) => {
    try {
      setIsSending(true);

      // Combine chunks into single audio blob
      const audioBlob = new Blob(chunks, { type: 'audio/webm' });

      // Calculate actual duration and generate waveform from audio blob
      let actualDuration = recordingDuration;
      let waveformData: number[] | null = null;

      try {
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);

        // Get duration
        await new Promise((resolve, reject) => {
          audio.onloadedmetadata = () => {
            actualDuration = Math.round(audio.duration);
            URL.revokeObjectURL(audioUrl);
            resolve(actualDuration);
          };
          audio.onerror = () => {
            URL.revokeObjectURL(audioUrl);
            resolve(recordingDuration);
          };
          setTimeout(() => {
            URL.revokeObjectURL(audioUrl);
            resolve(recordingDuration);
          }, 2000);
        });

        // Generate waveform
        waveformData = await generateWaveform(audioBlob);
      } catch (error) {
        actualDuration = recordingDuration;
        // Generate a simple fallback waveform
        waveformData = Array(50).fill(0).map(() => Math.random() * 0.5 + 0.3);
      }

      // Upload chunks to database
      const chunkSize = 64 * 1024; // 64KB chunks
      const totalChunks = Math.ceil(audioBlob.size / chunkSize);

      for (let i = 0; i < totalChunks; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, audioBlob.size);
        const chunk = audioBlob.slice(start, end);

        // Convert blob to base64 for database storage
        const arrayBuffer = await chunk.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        const base64 = btoa(String.fromCharCode(...uint8Array));

        const { error } = await supabase.rpc('upload_voice_chunk', {
          p_session_token: sessionToken,
          p_chunk_number: i,
          p_chunk_data: base64,
          p_chunk_size: chunk.size
        });

        if (error) throw error;
      }

      // Finalize voice message with actual duration and waveform
      const { data: finalizeData, error: finalizeError } = await supabase.rpc('finalize_voice_message', {
        p_session_token: sessionToken,
        p_duration: actualDuration,
        p_waveform_data: waveformData ? { waveform: waveformData } : null
      });

      if (finalizeError) throw finalizeError;

      // Send via WebSocket for real-time delivery
      if (websocketService.isSocketConnected()) {
        websocketService.sendMessage(
          selectedConversation!.id,
          'Voice message',
          'file', // Use 'file' type for WebSocket compatibility
          `voice_message_${finalizeData.message_id}.webm`,
          'audio/webm',
          audioBlob.size
        );
      }

      toast.success('Voice message sent!');

      // Refresh messages to get the updated message with correct duration
      if (selectedConversation) {
        await fetchMessages(selectedConversation.id);
      }

      // Reset state
      setAudioChunks([]);
      setVoiceSessionToken(null);
      setRecordingDuration(0);
      setRecordingStartTime(null);

    } catch (error) {
      toast.error('Failed to send voice message');
    } finally {
      setIsSending(false);
    }
  };

  const formatRecordingDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatVoiceDuration = (seconds: number | null | undefined) => {
    if (!seconds || seconds === 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Mark messages as read for current user (when viewing conversation)
  const markMessagesAsRead = async (messageIds: number[], conversationId: number) => {
    if (!currentUser || messageIds.length === 0) return;

    try {
      // For each message, check if we need to create read receipts
      // This marks that the current user has read these messages
      const receiptsToInsert = [];

      for (const messageId of messageIds) {
        // Check if read receipt already exists
        const { data: existingReceipt } = await supabase
          .from('message_read_receipts')
          .select('id')
          .eq('message_id', messageId)
          .eq('user_id', currentUser.id)
          .maybeSingle();

        // Only create if it doesn't exist
        if (!existingReceipt) {
          receiptsToInsert.push({
            message_id: messageId,
            user_id: currentUser.id,
            read_at: new Date().toISOString()
          });
        }
      }

      // Batch insert all new read receipts
      if (receiptsToInsert.length > 0) {
        await supabase
          .from('message_read_receipts')
          .insert(receiptsToInsert);
      }
    } catch (error) {
    }
  };

  // Get read receipt status for a message (WhatsApp-style)
  const getReadReceiptStatus = (message: Message): 'sent' | 'delivered' | 'read' => {
    if (!currentUser || !selectedConversation) return 'sent';

    // Only show read receipts for messages sent by current user
    if (message.sender_id !== currentUser.id) return 'sent';

    // For direct conversations
    if (selectedConversation.type === 'direct') {
      const otherParticipant = selectedConversation.participants?.find(
        p => p.user_id !== currentUser.id
      );

      if (!otherParticipant) return 'sent';

      // Check if the other participant has read this message
      const hasRead = message.read_receipts?.some(
        rr => rr.user_id === otherParticipant.user_id
      );

      return hasRead ? 'read' : 'delivered';
    }

    // For group conversations
    if (selectedConversation.type === 'group') {
      const otherParticipants = selectedConversation.participants?.filter(
        p => p.user_id !== currentUser.id && p.is_active
      ) || [];

      if (otherParticipants.length === 0) return 'sent';

      // Check if all participants have read
      const readCount = message.read_receipts?.filter(rr =>
        otherParticipants.some(p => p.user_id === rr.user_id)
      ).length || 0;

      if (readCount === otherParticipants.length) {
        return 'read';
      } else if (readCount > 0) {
        return 'delivered';
      }

      return 'delivered'; // Assume delivered when sent
    }

    return 'sent';
  };

  // Render read receipt checkmarks (WhatsApp-style: single icon with one or two hooks)
  /** `inline`: smaller ticks aligned with timestamp text (same row as time). */
  const renderReadReceipts = (message: Message, opts?: { inline?: boolean }) => {
    const status = getReadReceiptStatus(message);
    const inline = opts?.inline;
    const singleClass = inline ? 'h-4 w-4 flex-shrink-0' : 'h-7 w-7 flex-shrink-0';
    const doubleClass = inline ? 'h-4 w-5 flex-shrink-0' : 'h-7 w-7 flex-shrink-0';
    const singleCheck = <path fillRule="evenodd" d={RMQ_READ_RECEIPT_CHECK_D} clipRule="evenodd" />;
    const secondTick = (
      <path fillRule="evenodd" d={RMQ_READ_RECEIPT_CHECK_D} clipRule="evenodd" transform="translate(5, 0)" />
    );

    if (status === 'sent') {
      return (
        <svg className={singleClass} fill="currentColor" viewBox="0 0 20 20" style={{ color: 'rgba(255, 255, 255, 0.7)' }}>
          {singleCheck}
        </svg>
      );
    }
    if (status === 'delivered') {
      return (
        <svg className={doubleClass} fill="currentColor" viewBox="0 0 25 20" style={{ color: 'rgba(255, 255, 255, 0.7)' }}>
          {singleCheck}
          {secondTick}
        </svg>
      );
    }
    return (
      <svg className={doubleClass} fill="currentColor" viewBox="0 0 25 20" style={{ color: '#39ff14' }}>
        {singleCheck}
        {secondTick}
      </svg>
    );
  };

  /** Same tick geometry as `renderReadReceipts`, sized/colored for contact list (light/dark + selected row). */
  const renderSidebarReadReceipts = (
    status: 'sent' | 'delivered' | 'read',
    isSelectedRow: boolean,
    sizeClass: string
  ) => {
    const singleCheck = <path fillRule="evenodd" d={RMQ_READ_RECEIPT_CHECK_D} clipRule="evenodd" />;
    const secondTick = (
      <path fillRule="evenodd" d={RMQ_READ_RECEIPT_CHECK_D} clipRule="evenodd" transform="translate(5, 0)" />
    );
    const muted = isSelectedRow ? 'rgba(62, 40, 205, 0.65)' : 'rgba(100, 116, 139, 0.88)';

    if (status === 'sent') {
      return (
        <svg className={`${sizeClass} flex-shrink-0`} fill="currentColor" viewBox="0 0 20 20" style={{ color: muted }}>
          {singleCheck}
        </svg>
      );
    }
    if (status === 'delivered') {
      return (
        <svg className={`${sizeClass} flex-shrink-0`} fill="currentColor" viewBox="0 0 25 20" style={{ color: muted }}>
          {singleCheck}
          {secondTick}
        </svg>
      );
    }
    return (
      <svg className={`${sizeClass} flex-shrink-0`} fill="currentColor" viewBox="0 0 25 20" style={{ color: '#39ff14' }}>
        {singleCheck}
        {secondTick}
      </svg>
    );
  };

  // Generate waveform data from audio blob (similar to WhatsApp)
  const generateWaveform = async (audioBlob: Blob): Promise<number[]> => {
    try {
      const arrayBuffer = await audioBlob.arrayBuffer();
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      const rawData = audioBuffer.getChannelData(0); // Get first channel
      const samples = 50; // Number of bars in waveform (like WhatsApp)
      const blockSize = Math.floor(rawData.length / samples);
      const filteredData: number[] = [];

      for (let i = 0; i < samples; i++) {
        const blockStart = blockSize * i;
        let sum = 0;
        for (let j = 0; j < blockSize; j++) {
          sum += Math.abs(rawData[blockStart + j] || 0);
        }
        filteredData.push(sum / blockSize);
      }

      // Normalize to 0-1 range
      const max = Math.max(...filteredData);
      if (max > 0) {
        return filteredData.map(value => value / max);
      }

      return filteredData;
    } catch (error) {
      // Return a simple animated waveform as fallback
      return Array(50).fill(0).map(() => Math.random() * 0.5 + 0.3);
    }
  };

  // Voice playback functions
  const playVoiceMessage = async (messageId: number) => {
    if (!currentUser) return;

    try {
      // If already playing this message, pause it
      if (playingVoiceId === messageId && voiceAudio) {
        voiceAudio.pause();
        setPlayingVoiceId(null);
        setVoiceAudio(null);
        return;
      }

      // If playing a different message, stop it first
      if (voiceAudio) {
        voiceAudio.pause();
        setPlayingVoiceId(null);
        setVoiceAudio(null);
      }

      // Get voice message chunks from database
      // Note: BYTEA columns are returned as hex strings with 'x' prefix by PostgreSQL/Supabase
      const { data: chunksData, error } = await supabase.rpc('get_voice_message_chunks', {
        p_message_id: messageId,
        p_user_id: currentUser.id
      });

      // Log first chunk data format for debugging
      if (chunksData && chunksData.length > 0) {
        const firstChunk = chunksData[0];
        const chunkDataPreview = (firstChunk.chunk_data || '').toString().substring(0, 100);
      }

      if (error) throw error;

      if (!chunksData || chunksData.length === 0) {
        toast.error('Voice message not found or access denied');
        return;
      }

      // Sort chunks by chunk_number and combine them
      const sortedChunks = chunksData.sort((a: any, b: any) => a.chunk_number - b.chunk_number);

      // Convert chunks back to binary data (supports both base64 and hex)
      const binaryChunks = sortedChunks.map((chunk: any) => {
        try {
          // Get chunk data
          let data = chunk.chunk_data || '';

          // Handle different data formats
          if (typeof data !== 'string') {
            // If it's already binary/array, return as is
            if (data instanceof Uint8Array) {
              return data;
            }
            // Try to convert to string
            data = String(data);
          }

          // Clean the data (preserve original for fallback)
          const originalData = data;
          data = data.trim().replace(/\s/g, '');

          // Validate data exists
          if (!data || data.length === 0) {
            throw new Error('Empty chunk data');
          }

          // Helper function to convert hex to bytes
          // PostgreSQL BYTEA returns hex with 'x' prefix (e.g., 'x476b5866...')
          const hexToBytes = (hexStr: string): Uint8Array => {
            if (!hexStr || typeof hexStr !== 'string') {
              throw new Error('Invalid hex string input');
            }

            // PostgreSQL BYTEA hex format starts with 'x' followed by hex digits
            // Remove the 'x' prefix if present
            let hexData = hexStr.trim();

            // Handle PostgreSQL BYTEA hex format (starts with 'x')
            if (hexData.startsWith('x') || hexData.startsWith('\\x')) {
              hexData = hexData.substring(hexData.startsWith('\\x') ? 2 : 1);
            } else if (hexData.startsWith('0x')) {
              hexData = hexData.substring(2);
            }

            // Remove any non-hex characters (spaces, newlines, etc.)
            hexData = hexData.replace(/[^0-9a-fA-F]/g, '');

            if (hexData.length === 0) {
              throw new Error('No valid hex data after cleaning');
            }

            // Ensure even length for hex pairs
            if (hexData.length % 2 !== 0) {
              // Pad with leading zero
              hexData = '0' + hexData;
            }

            // Convert hex to binary
            const bytes = new Uint8Array(hexData.length / 2);
            for (let i = 0; i < hexData.length; i += 2) {
              const hexPair = hexData.substr(i, 2);
              const byteValue = parseInt(hexPair, 16);
              if (isNaN(byteValue) || byteValue < 0 || byteValue > 255) {
                throw new Error(`Invalid hex byte "${hexPair}" at position ${i}`);
              }
              bytes[i / 2] = byteValue;
            }

            return bytes;
          };

          // PostgreSQL BYTEA returns hex with 'x' prefix, so prioritize hex detection
          // Check for 'x' prefix first (PostgreSQL BYTEA hex format)
          const hasHexPrefix = data.startsWith('x') || data.startsWith('\\x');
          const has0xPrefix = data.startsWith('0x');

          let bytes: Uint8Array;

          // If it starts with 'x' or '\\x', it's definitely PostgreSQL BYTEA hex format
          if (hasHexPrefix) {
            try {
              bytes = hexToBytes(data);

              // Check if the decoded bytes are actually a base64 string
              // (This happens when base64 was stored as text in BYTEA, then retrieved as hex)
              const decodedString = String.fromCharCode(...bytes.slice(0, Math.min(100, bytes.length)));
              const looksLikeBase64 = /^[A-Za-z0-9+/=\s]*$/.test(decodedString) && decodedString.length > 10;

              if (looksLikeBase64) {
                // The hex data is actually a base64 string encoded as hex
                // Decode hex to get base64 string, then decode base64 to get actual bytes
                const base64String = String.fromCharCode(...bytes);
                const base64Cleaned = base64String.replace(/[^A-Za-z0-9+/=]/g, '');
                const padding = base64Cleaned.length % 4;
                const base64Padded = padding ? base64Cleaned + '='.repeat(4 - padding) : base64Cleaned;

                try {
                  const binaryString = atob(base64Padded);
                  bytes = new Uint8Array(binaryString.length);
                  for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                  }
                } catch (base64Error) {
                  // If base64 decode fails, use the hex bytes as-is
                }
              }
            } catch (hexError) {
              throw new Error(`Failed to decode PostgreSQL BYTEA hex data: ${hexError instanceof Error ? hexError.message : 'Unknown error'}`);
            }
          } else if (has0xPrefix) {
            // Standard hex format with 0x prefix
            try {
              bytes = hexToBytes(data);
            } catch (hexError) {
              // Try base64 as fallback
              const base64Data = originalData.replace(/[^A-Za-z0-9+/=]/g, '');
              const padding = base64Data.length % 4;
              const paddedBase64 = padding ? base64Data + '='.repeat(4 - padding) : base64Data;
              try {
                const binaryString = atob(paddedBase64);
                bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                  bytes[i] = binaryString.charCodeAt(i);
                }
              } catch (base64Error) {
                throw new Error(`Both hex and base64 decoding failed. Hex: ${hexError instanceof Error ? hexError.message : 'Unknown'}, Base64: ${base64Error instanceof Error ? base64Error.message : 'Unknown'}`);
              }
            }
          } else {
            // Try base64 first (original format)
            let base64Data = data.replace(/[^A-Za-z0-9+/=]/g, '');

            // Ensure proper padding
            const padding = base64Data.length % 4;
            if (padding) {
              base64Data += '='.repeat(4 - padding);
            }

            try {
              const binaryString = atob(base64Data);
              bytes = new Uint8Array(binaryString.length);
              for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
              }
            } catch (base64Error) {
              // If base64 fails, try hex as fallback (might be hex without prefix)
              try {
                bytes = hexToBytes(originalData);
              } catch (hexError) {
                throw new Error(`Neither base64 nor hex decoding worked. Base64 error: ${base64Error instanceof Error ? base64Error.message : 'Unknown'}, Hex error: ${hexError instanceof Error ? hexError.message : 'Unknown'}`);
              }
            }
          }

          return bytes;
        } catch (chunkError) {
          throw new Error(`Failed to process chunk ${chunk.chunk_number}: ${chunkError instanceof Error ? chunkError.message : 'Unknown error'}`);
        }
      });

      // Combine all chunks into a single Uint8Array
      const totalLength = binaryChunks.reduce((sum: number, chunk: Uint8Array) => sum + chunk.length, 0);

      if (totalLength === 0) {
        throw new Error('No valid audio data found in chunks');
      }

      const combinedArray = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of binaryChunks) {
        if (chunk && chunk.length > 0) {
          combinedArray.set(chunk, offset);
          offset += chunk.length;
        }
      }

      // Validate the audio data - check for WebM header (starts with 0x1A 0x45 0xDF 0xA3)
      const hasWebMHeader = combinedArray.length >= 4 &&
        combinedArray[0] === 0x1A &&
        combinedArray[1] === 0x45 &&
        combinedArray[2] === 0xDF &&
        combinedArray[3] === 0xA3;

      // Log first bytes for debugging
      if (combinedArray.length > 0) {
        const firstBytes = Array.from(combinedArray.slice(0, 16))
          .map(b => '0x' + b.toString(16).padStart(2, '0'))
          .join(' ');
      }

      if (!hasWebMHeader && combinedArray.length > 0) {
        // Try with different MIME type - maybe it's not WebM
      }

      // Create blob from combined data
      const audioBlob = new Blob([combinedArray], { type: 'audio/webm' });

      // Validate blob size
      if (audioBlob.size === 0) {
        throw new Error('Created audio blob is empty');
      }

      const audioUrl = URL.createObjectURL(audioBlob);

      // Create audio element and play
      const audio = new Audio(audioUrl);
      audio.preload = 'metadata';

      // Set a timeout to detect if metadata loading fails
      const metadataTimeout = setTimeout(() => {
        if (!audio.readyState || audio.readyState < 2) {
          toast.error('Voice message appears to be corrupted or in an unsupported format');
          setPlayingVoiceId(null);
          setVoiceAudio(null);
          URL.revokeObjectURL(audioUrl);
        }
      }, 5000);

      audio.onloadedmetadata = () => {
        clearTimeout(metadataTimeout);
        setPlayingVoiceId(messageId);
        setVoiceAudio(audio);
        audio.play().catch((playError) => {
          toast.error('Failed to play voice message. The audio file may be corrupted.');
          setPlayingVoiceId(null);
          setVoiceAudio(null);
          URL.revokeObjectURL(audioUrl);
        });
      };

      audio.onplay = () => {
        clearTimeout(metadataTimeout);
        setPlayingVoiceId(messageId);
      };

      audio.onpause = () => {
        setPlayingVoiceId(null);
      };

      audio.onended = () => {
        clearTimeout(metadataTimeout);
        setPlayingVoiceId(null);
        setVoiceAudio(null);
        setVoiceProgress(prev => ({ ...prev, [messageId]: 0 }));
        URL.revokeObjectURL(audioUrl);
      };

      audio.ontimeupdate = () => {
        if (audio.duration) {
          const progress = (audio.currentTime / audio.duration) * 100;
          setVoiceProgress(prev => ({ ...prev, [messageId]: progress }));
        }
      };

      audio.onerror = (e) => {
        clearTimeout(metadataTimeout);
        const errorMessage = audio.error
          ? `Audio error code: ${audio.error.code} (${audio.error.message || 'Unknown error'})`
          : 'Unknown audio playback error';
        toast.error('Failed to play voice message. The audio file may be corrupted or in an unsupported format.');
        setPlayingVoiceId(null);
        setVoiceAudio(null);
        URL.revokeObjectURL(audioUrl);
      };

    } catch (error) {
      toast.error('Failed to play voice message');
    }
  };

  const pauseVoiceMessage = () => {
    if (voiceAudio) {
      voiceAudio.pause();
      setPlayingVoiceId(null);
      setVoiceAudio(null);
    }
  };

  // Reaction functions
  const handleAddReaction = async (messageId: number, emoji: string) => {
    if (!currentUser) return;

    try {
      const { data, error } = await supabase.rpc('update_message_reaction', {
        message_id_param: messageId,
        user_id_param: currentUser.id,
        emoji_param: emoji,
        action_param: 'add'
      });

      if (error) throw error;

      // Update local message state
      setMessages(prev =>
        prev.map(msg =>
          msg.id === messageId
            ? { ...msg, reactions: data }
            : msg
        )
      );

      setShowReactionPicker(null);
      setReactingMessageId(null);
    } catch (error) {
      toast.error('Failed to add reaction');
    }
  };

  const handleRemoveReaction = async (messageId: number, emoji: string) => {
    if (!currentUser) return;

    try {
      const { data, error } = await supabase.rpc('update_message_reaction', {
        message_id_param: messageId,
        user_id_param: currentUser.id,
        emoji_param: emoji,
        action_param: 'remove'
      });

      if (error) throw error;

      // Update local message state
      setMessages(prev =>
        prev.map(msg =>
          msg.id === messageId
            ? { ...msg, reactions: data }
            : msg
        )
      );
    } catch (error) {
      toast.error('Failed to remove reaction');
    }
  };

  // Get reactions grouped by emoji
  const getReactionsByEmoji = (reactions: MessageReaction[]) => {
    const grouped: { [emoji: string]: MessageReaction[] } = {};
    reactions.forEach(reaction => {
      if (!grouped[reaction.emoji]) {
        grouped[reaction.emoji] = [];
      }
      grouped[reaction.emoji].push(reaction);
    });
    return grouped;
  };

  // Check if current user has reacted with specific emoji
  const hasUserReacted = (reactions: MessageReaction[], emoji: string) => {
    return reactions.some(reaction =>
      reaction.user_id === currentUser?.id && reaction.emoji === emoji
    );
  };

  const formatMessageTime = (timestamp: string): string => {
    const date = new Date(timestamp);
    return format(date, 'HH:mm');
  };

  /** Sidebar list: today = clock; same calendar week (not today) = weekday; older = date. */
  const formatSidebarConversationTime = (timestamp: string | null | undefined): string => {
    if (!timestamp) return '';
    const d = new Date(timestamp);
    if (Number.isNaN(d.getTime())) return '';
    const now = new Date();
    if (isToday(d)) return format(d, 'HH:mm');
    if (isSameWeek(d, now, { weekStartsOn: 0 })) return format(d, 'EEEE');
    return format(d, 'MMM d, yyyy');
  };

  /** Flag row in header dropdown: when the flag was created (not internal message id). */
  const formatRmqFlagCreatedAt = (iso: string | undefined): string => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return format(d, 'MMM d, yyyy · HH:mm');
  };

  // Helper function to check if two dates are on the same day
  const isSameDay = (date1: Date, date2: Date): boolean => {
    return date1.getFullYear() === date2.getFullYear() &&
      date1.getMonth() === date2.getMonth() &&
      date1.getDate() === date2.getDate();
  };

  // Helper function to format date separator
  const formatDateSeparator = (timestamp: string): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffInDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

    if (isToday(date)) {
      return 'Today';
    } else if (isYesterday(date)) {
      return 'Yesterday';
    } else if (diffInDays <= 7) {
      // Show day of week for messages within the last week
      return format(date, 'EEEE');
    } else {
      // Show full date for older messages
      return format(date, 'MMMM d, yyyy');
    }
  };

  // Media gallery functions (flattens album messages into one entry per file)
  const getConversationMedia = (): Message[] => {
    if (!selectedConversation) return [];
    const result: Message[] = [];
    for (const message of messages) {
      if (message.message_type === 'album' && message.media_attachments?.length) {
        for (const item of message.media_attachments) {
          const isVid = item.type.startsWith('video/');
          result.push({
            ...message,
            attachment_url: item.url,
            attachment_name: item.name,
            attachment_type: item.type,
            attachment_size: item.size,
            message_type: isVid ? 'file' : 'image',
          } as Message);
        }
      } else if (isImageMessage(message) || isVideoMessage(message)) {
        result.push(message);
      }
    }
    return result;
  };

  const openMediaModal = (message: Message, itemUrl?: string) => {
    const media = getConversationMedia();
    const index = itemUrl
      ? media.findIndex(m => m.id === message.id && m.attachment_url === itemUrl)
      : media.findIndex(m => m.id === message.id && m.attachment_url === message.attachment_url);
    setConversationMedia(media);
    setSelectedMediaIndex(index >= 0 ? index : 0);
    setIsMediaModalOpen(true);
  };

  const closeMediaModal = () => {
    setIsMediaModalOpen(false);
    setSelectedMediaIndex(0);
    setConversationMedia([]);
  };

  const navigateMedia = (direction: 'prev' | 'next') => {
    const newIndex = direction === 'next'
      ? (selectedMediaIndex + 1) % conversationMedia.length
      : (selectedMediaIndex - 1 + conversationMedia.length) % conversationMedia.length;
    setSelectedMediaIndex(newIndex);
  };

  /** WhatsApp/Telegram-style grid inside one bubble */
  const renderAlbumMessageContent = (message: Message, messageListIndex: number) => {
    const items = message.media_attachments!;
    const n = items.length;
    const cellClass =
      'relative overflow-hidden bg-gray-100 dark:bg-gray-800 min-h-[64px] max-md:min-h-[56px] md:min-h-[72px]';

    const cell = (item: RmqMediaAttachmentItem, i: number, extraClass: string) => {
      const isVid = item.type.startsWith('video/');
      return (
        <button
          type="button"
          key={`${message.id}-album-${i}`}
          className={`${cellClass} ${extraClass} block w-full p-0 border-0 cursor-pointer`}
          onClick={(e) => {
            e.stopPropagation();
            openMediaModal(message, item.url);
          }}
        >
          {isVid ? (
            <video
              src={item.url}
              className="absolute inset-0 w-full h-full object-cover pointer-events-none"
              muted
              playsInline
              preload="metadata"
            />
          ) : (
            <img
              src={item.url}
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
              loading={messageListIndex >= messages.length - 10 ? 'eager' : 'lazy'}
            />
          )}
          {isVid && (
            <span className="absolute bottom-1 left-1 text-[10px] font-medium text-white drop-shadow bg-black/45 px-1 rounded pointer-events-none">
              ▶
            </span>
          )}
        </button>
      );
    };

    if (n === 1) {
      return (
        <div className="w-full max-w-full">
          {cell(
            items[0],
            0,
            'aspect-video max-h-[min(36vh,13rem)] md:max-h-80'
          )}
        </div>
      );
    }
    if (n === 2) {
      return (
        <div className="grid grid-cols-2 gap-0.5 p-0.5">
          {items.map((it, i) =>
            cell(it, i, 'aspect-square max-h-[min(42vw,9.5rem)] md:max-h-none')
          )}
        </div>
      );
    }
    if (n === 3) {
      return (
        <div className="grid grid-cols-2 gap-0.5 p-0.5">
          {cell(items[0], 0, 'aspect-square max-h-[min(42vw,9.5rem)] md:max-h-none')}
          {cell(items[1], 1, 'aspect-square max-h-[min(42vw,9.5rem)] md:max-h-none')}
          <div className="col-span-2">
            {cell(items[2], 2, 'aspect-video max-h-[10rem] md:max-h-56 lg:max-h-48')}
          </div>
        </div>
      );
    }
    if (n === 4) {
      return (
        <div className="grid grid-cols-2 gap-0.5 p-0.5">
          {items.map((it, i) =>
            cell(it, i, 'aspect-square max-h-[min(42vw,9.5rem)] md:max-h-none')
          )}
        </div>
      );
    }
    const [first, ...rest] = items;
    return (
      <div className="flex flex-col gap-0.5 p-0.5">
        <div className="w-full">
          {cell(
            first,
            0,
            'aspect-video max-h-[min(32vh,11rem)] md:max-h-72'
          )}
        </div>
        <div className="grid grid-cols-3 gap-0.5">
          {rest.map((it, i) =>
            cell(it, i + 1, 'aspect-square max-h-[min(30vw,7rem)] md:max-h-none')
          )}
        </div>
      </div>
    );
  };

  /** Full chat-style preview of the message at the top of the “Message comments” modal */
  const renderCommentModalOriginalPreview = (message: Message) => {
    const isOwn = message.sender_id === currentUser?.id;
    const senderName =
      message.sender?.tenants_employee?.display_name ||
      message.sender?.full_name ||
      'Unknown';
    const isGroup = selectedConversation?.type !== 'direct';

    const nameHeaderInMediaCard =
      isGroup && (
        <div className={`px-2 py-1 border-b border-base-300 ${isOwn ? 'text-right' : ''}`}>
          <span
            className="text-sm font-medium"
            style={{ color: isOwn ? undefined : getSenderColor(message.sender_id) }}
          >
            {isOwn
              ? currentUser?.tenants_employee?.display_name || currentUser?.full_name || 'You'
              : senderName}
          </span>
        </div>
      );

    const timeRow = (
      <div className={`flex items-center gap-1 mt-1 pt-1 ${isOwn ? 'justify-end' : 'justify-start'}`}>
        <span
          className={`text-xs ${isOwn ? '' : 'text-gray-500'}`}
          style={isOwn ? { color: 'rgba(255, 255, 255, 0.7)' } : {}}
        >
          {formatMessageTime(message.sent_at)}
        </span>
      </div>
    );

    if (isAlbumMessage(message)) {
      return (
        <div className={`flex w-full ${isOwn ? 'justify-end' : 'justify-start'}`}>
          <div
            className={`${RMQ_CHAT.bubbleR} border border-base-300/80 overflow-hidden w-full max-w-full sm:max-w-md ${
              isOwn ? 'bg-white dark:bg-base-100' : 'bg-gray-50 dark:bg-base-100'
            }`}
          >
            {nameHeaderInMediaCard}
            <div className="relative w-full">
              {renderAlbumMessageContent(message, 0)}
              <span className="absolute bottom-2 right-2 text-xs font-medium text-white drop-shadow-md pointer-events-none z-10">
                {formatMessageTime(message.sent_at)}
              </span>
            </div>
            {getAlbumUserCaption(message) && (
              <div
                className="px-2.5 py-2 border-t border-base-300 text-sm text-base-content whitespace-pre-wrap break-words"
                dir={getTextDirection(getAlbumUserCaption(message)!) as 'ltr' | 'rtl' | 'auto'}
              >
                {renderMessageContent(getAlbumUserCaption(message)!, isOwn)}
              </div>
            )}
          </div>
        </div>
      );
    }

    if (isImageMessage(message) && message.attachment_url) {
      return (
        <div className={`flex w-full ${isOwn ? 'justify-end' : 'justify-start'}`}>
          <div
            className={`${RMQ_CHAT.bubbleR} w-fit max-w-full min-w-0 overflow-hidden border border-base-300/80 ${
              isOwn ? 'bg-white dark:bg-base-100' : 'bg-gray-50 dark:bg-base-100'
            }`}
          >
            {nameHeaderInMediaCard}
            <div
              className="relative w-fit min-h-0 max-w-full cursor-pointer transition-transform duration-150 hover:scale-[1.02]"
              onClick={() => openMediaModal(message)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  openMediaModal(message);
                }
              }}
            >
              <img
                src={message.attachment_url}
                alt={message.attachment_name || ''}
                className={`${RMQ_CHAT.imageR} h-auto w-auto max-w-full max-h-[min(48vh,18rem)] object-contain object-center block bg-gray-100 dark:bg-gray-800`}
                loading="lazy"
                decoding="async"
              />
              <span className="absolute bottom-2 right-2 text-xs font-medium text-white drop-shadow-md pointer-events-none">
                {formatMessageTime(message.sent_at)}
              </span>
            </div>
          </div>
        </div>
      );
    }

    if (isVideoMessage(message) && message.attachment_url) {
      return (
        <div className={`flex w-full ${isOwn ? 'justify-end' : 'justify-start'}`}>
          <div
            className={`${RMQ_CHAT.bubbleR} w-fit max-w-full min-w-0 overflow-hidden border border-base-300/80 ${
              isOwn ? 'bg-white dark:bg-base-100' : 'bg-gray-50 dark:bg-base-100'
            }`}
          >
            {nameHeaderInMediaCard}
            <div
              className="relative w-fit max-w-full cursor-pointer transition-transform duration-150 hover:scale-[1.02]"
              onClick={() => openMediaModal(message)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  openMediaModal(message);
                }
              }}
            >
              <video
                src={message.attachment_url}
                className={`${RMQ_CHAT.imageR} h-auto w-auto max-w-full max-h-[min(48vh,18rem)] object-contain bg-gray-100 dark:bg-gray-800 relative z-10 pointer-events-none`}
                muted
                playsInline
                preload="metadata"
              />
              <span className="absolute bottom-2 right-2 z-10 text-xs font-medium text-white drop-shadow-md pointer-events-none">
                {formatMessageTime(message.sent_at)}
              </span>
            </div>
          </div>
        </div>
      );
    }

    const contentStr = message.content || '';
    const emojiOnly = contentStr.trim().length > 0 && isEmojiOnly(contentStr);
    const bubbleRole = isOwn ? (emojiOnly ? '' : ' rmq-bubble-sent') : ' rmq-bubble-recv';
    const bubbleBase = `overflow-hidden ${RMQ_CHAT.bubblePad} ${RMQ_CHAT.bubbleR} shadow-none border-0 w-full max-w-full${bubbleRole} ${
      isOwn
        ? emojiOnly
          ? 'bg-base-100 text-base-content'
          : 'text-white border-0'
        : `${RMQ_CHAT.recv} border-0 dark:bg-base-200/80 dark:text-base-content`
    }`;
    const bubbleStyle: React.CSSProperties | undefined =
      isOwn && !emojiOnly ? { background: RMQ_CHAT.sentBg } : undefined;

    const textBlock =
      contentStr.trim().length > 0 &&
      (emojiOnly ? (
        <div className="text-5xl sm:text-6xl leading-none text-center py-1" dir={getTextDirection(contentStr) as 'ltr' | 'rtl' | 'auto'}>
          {renderMessageContent(contentStr, isOwn)}
        </div>
      ) : (
        <div
          className="break-words text-sm whitespace-pre-wrap leading-[1.4]"
          dir={getTextDirection(contentStr) as 'ltr' | 'rtl' | 'auto'}
          style={{
            textAlign: getTextDirection(contentStr) === 'rtl' ? 'right' : getTextDirection(contentStr) === 'auto' ? 'start' : 'left',
            ...(getTextDirection(contentStr) !== 'auto' && { direction: getTextDirection(contentStr) as 'ltr' | 'rtl' }),
            lineHeight: 1.4,
            wordBreak: 'break-word',
            overflowWrap: 'break-word',
            whiteSpace: 'pre-wrap',
            unicodeBidi: 'plaintext',
          }}
        >
          {renderMessageContent(contentStr, isOwn)}
        </div>
      ));

    const voiceBlock =
      (message.message_type === 'voice' || message.is_voice_message) && message.attachment_url ? (
        <div
          className={`mt-2 rounded-lg border flex items-center gap-3 p-3 ${
            isOwn ? 'bg-white/10 border-white/20' : 'bg-gray-50 border-gray-200 dark:bg-base-200/50 dark:border-base-300'
          }`}
        >
          <div className={`p-2 rounded-full flex-shrink-0 ${isOwn ? 'bg-white/20 text-white' : ''}`} style={!isOwn ? { backgroundColor: '#3E28CD' } : {}}>
            <MicrophoneIcon className="w-5 h-5 text-white" />
          </div>
          <span className={`text-sm ${isOwn ? 'text-white/90' : 'text-base-content'}`}>
            {formatVoiceDuration(message.voice_duration)}
          </span>
        </div>
      ) : null;

    const fileBlock =
      message.attachment_url &&
      !isImageMessage(message) &&
      !isVideoMessage(message) &&
      !(message.message_type === 'voice' || message.is_voice_message) ? (
        <div
          className={`mt-2 rounded-lg border p-3 flex items-center gap-3 ${
            isOwn ? 'bg-white/10 border-white/20' : 'bg-gray-50 border-gray-200 dark:bg-base-200/50 dark:border-base-300'
          }`}
        >
          <div className={`p-3 rounded-lg ${isOwn ? 'bg-white/20' : 'bg-gray-100 dark:bg-base-300/40'}`}>
            <PaperClipIcon className={`w-5 h-5 ${isOwn ? 'text-white' : 'text-gray-600'}`} />
          </div>
          <div className="min-w-0 flex-1">
            <a
              href={message.attachment_url}
              target="_blank"
              rel="noopener noreferrer"
              className={`text-sm font-medium hover:underline truncate block ${isOwn ? 'text-emerald-100' : 'text-primary'}`}
              onClick={(e) => e.stopPropagation()}
            >
              {message.attachment_name || 'Attachment'}
            </a>
            {message.attachment_size != null && (
              <p className={`text-xs opacity-75 ${isOwn ? 'text-white/80' : ''}`}>
                {Math.round(message.attachment_size / 1024)} KB
              </p>
            )}
          </div>
        </div>
      ) : null;

    const hasBody = Boolean(textBlock) || Boolean(voiceBlock) || Boolean(fileBlock);

    if (!hasBody) {
      return (
        <div className="rounded-lg border border-base-300 bg-base-200/40 px-3 py-2 text-sm text-base-content/70">
          Message preview unavailable
        </div>
      );
    }

    return (
      <div className={`flex w-full ${isOwn ? 'justify-end' : 'justify-start'}`}>
        <div className={bubbleBase} style={bubbleStyle}>
          {!isOwn && isGroup && (
            <div className="text-sm font-semibold mb-1 flex flex-wrap gap-1.5" style={{ color: getSenderColor(message.sender_id) }}>
              <span>{senderName}</span>
              {message.edited_at && <span className="text-xs font-normal opacity-70 italic">(edited)</span>}
            </div>
          )}
          {isOwn && message.edited_at && <div className="text-xs opacity-70 italic mb-1">(edited)</div>}
          {textBlock}
          {voiceBlock}
          {fileBlock}
          {timeRow}
        </div>
      </div>
    );
  };

  // Helper function to format last online time
  const formatLastOnlineTime = (lastOnlineDate: Date): string => {
    const now = new Date();
    const diffMs = now.getTime() - lastOnlineDate.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) {
      return 'just now';
    } else if (diffMins < 60) {
      return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
    } else if (diffHours < 24) {
      return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
    } else if (diffDays < 7) {
      return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
    } else {
      // For longer periods, show the actual date/time
      return lastOnlineDate.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    }
  };

  // Function to check if employee is currently unavailable
  const checkEmployeeAvailability = useCallback(async (employeeDisplayName: string) => {
    try {
      const today = new Date();
      const todayYear = today.getFullYear();
      const todayMonth = String(today.getMonth() + 1).padStart(2, '0');
      const todayDay = String(today.getDate()).padStart(2, '0');
      const todayString = `${todayYear}-${todayMonth}-${todayDay}`;

      const { data: employeeData, error } = await supabase
        .from('tenants_employee')
        .select('unavailable_times, unavailable_ranges')
        .eq('display_name', employeeDisplayName)
        .single();

      if (error || !employeeData) {
        setIsEmployeeUnavailable(false);
        setUnavailabilityReason(null);
        return;
      }

      const unavailableTimes = employeeData.unavailable_times || [];
      const unavailableRanges = employeeData.unavailable_ranges || [];

      const now = new Date();
      const currentTime = now.getHours() * 60 + now.getMinutes();

      // Check for specific time slots on today's date
      const todayTimes = unavailableTimes.filter((time: any) => time.date === todayString);

      // Check if current time is within any unavailable time slot
      for (const time of todayTimes) {
        const startTime = parseInt(time.startTime.split(':')[0]) * 60 + parseInt(time.startTime.split(':')[1]);
        const endTime = parseInt(time.endTime.split(':')[0]) * 60 + parseInt(time.endTime.split(':')[1]);

        if (currentTime >= startTime && currentTime <= endTime) {
          setIsEmployeeUnavailable(true);
          setUnavailabilityReason(time.reason || 'Unavailable');
          setUnavailabilityTimePeriod(`${time.startTime} - ${time.endTime}`);
          return;
        }
      }

      // Check for date ranges that include today
      const todayRanges = unavailableRanges.filter((range: any) =>
        todayString >= range.startDate && todayString <= range.endDate
      );

      if (todayRanges.length > 0) {
        setIsEmployeeUnavailable(true);
        setUnavailabilityReason(todayRanges[0].reason || 'Unavailable');
        const startDate = new Date(todayRanges[0].startDate);
        const endDate = new Date(todayRanges[0].endDate);
        const startDateStr = startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const endDateStr = endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        setUnavailabilityTimePeriod(startDateStr === endDateStr ? startDateStr : `${startDateStr} - ${endDateStr}`);
        return;
      }

      // Employee is available
      setIsEmployeeUnavailable(false);
      setUnavailabilityReason(null);
      setUnavailabilityTimePeriod(null);
    } catch (error) {
      setIsEmployeeUnavailable(false);
      setUnavailabilityReason(null);
      setUnavailabilityTimePeriod(null);
    }
  }, []);

  // Function to check availability for all contacts
  const checkAllContactsAvailability = useCallback(async () => {
    try {
      const today = new Date();
      const todayYear = today.getFullYear();
      const todayMonth = String(today.getMonth() + 1).padStart(2, '0');
      const todayDay = String(today.getDate()).padStart(2, '0');
      const todayString = `${todayYear}-${todayMonth}-${todayDay}`;

      const now = new Date();
      const currentTime = now.getHours() * 60 + now.getMinutes();

      const availabilityMap: { [key: string]: boolean } = {};

      // Get all employees with unavailable times
      const { data: employees, error } = await supabase
        .from('tenants_employee')
        .select('display_name, unavailable_times, unavailable_ranges')
        .not('unavailable_times', 'is', null);

      if (error || !employees) {
        setContactAvailabilityMap({});
        return;
      }

      employees.forEach(employee => {
        const unavailableTimes = employee.unavailable_times || [];
        const unavailableRanges = employee.unavailable_ranges || [];

        // Check for specific time slots on today's date
        const todayTimes = unavailableTimes.filter((time: any) => time.date === todayString);

        // Check if current time is within any unavailable time slot
        for (const time of todayTimes) {
          const startTime = parseInt(time.startTime.split(':')[0]) * 60 + parseInt(time.startTime.split(':')[1]);
          const endTime = parseInt(time.endTime.split(':')[0]) * 60 + parseInt(time.endTime.split(':')[1]);

          if (currentTime >= startTime && currentTime <= endTime) {
            availabilityMap[employee.display_name] = true;
            return;
          }
        }

        // Check for date ranges that include today
        const todayRanges = unavailableRanges.filter((range: any) =>
          todayString >= range.startDate && todayString <= range.endDate
        );

        if (todayRanges.length > 0) {
          availabilityMap[employee.display_name] = true;
        }
      });

      setContactAvailabilityMap(availabilityMap);
    } catch (error) {
      setContactAvailabilityMap({});
    }
  }, []);

  const getConversationTitle = (conversation: Conversation): string => {
    // If it has a custom title, use it
    if (conversation.title && conversation.title.trim() !== '') {
      return conversation.title;
    }

    // For direct conversations (exactly 2 participants)
    if (conversation.type === 'direct' && conversation.participants && conversation.participants.length === 2) {
      const otherParticipant = conversation.participants.find(p => p.user_id !== currentUser?.id);
      if (otherParticipant?.user) {
        const name = otherParticipant.user.tenants_employee?.official_name ||
          otherParticipant.user.tenants_employee?.display_name ||
          otherParticipant.user.full_name ||
          'Unknown User';
        return name;
      }
    }

    // For group conversations or if direct chat logic fails
    const participantCount = conversation.participants?.length || 0;
    return `Group Chat (${participantCount} members)`;
  };

  // Helper function to check if conversation is locked
  const isGroupLocked = (conversation: Conversation | null): boolean => {
    if (!conversation) return false;
    return conversation.type === 'group' && conversation.is_locked === true;
  };

  const getConversationAvatar = (conversation: Conversation, size: 'small' | 'large' | 'xlarge' = 'small'): JSX.Element => {
    if (conversation.type === 'direct' && conversation.participants && conversation.participants.length === 2) {
      const otherParticipant = conversation.participants.find(p => p.user_id !== currentUser?.id);
      if (otherParticipant?.user) {
        const name =
          otherParticipant.user.tenants_employee?.display_name ||
          otherParticipant.user.full_name ||
          'Unknown User';
        const photoUrl = otherParticipant.user.tenants_employee?.photo_url;
        const avatarKey = otherParticipant.user.id || otherParticipant.user_id;
        const handleAvatarClick = async () => {
          const employee = otherParticipant.user?.tenants_employee;
          if (employee) {
            // Fetch background photo from tenants_employee table
            let backgroundPhoto = null;
            if (otherParticipant.user.employee_id) {
              try {
                const { data } = await supabase
                  .from('tenants_employee')
                  .select('photo')
                  .eq('id', otherParticipant.user.employee_id)
                  .maybeSingle();
                if (data?.photo) {
                  backgroundPhoto = data.photo;
                }
              } catch (error) {
                console.error('Error fetching employee background photo:', error);
              }
            }

            setSelectedEmployee({
              id: otherParticipant.user.employee_id?.toString() || '',
              display_name: employee.display_name || name,
              official_name: employee.official_name || employee.display_name || name,
              email: otherParticipant.user.email || '',
              bonuses_role: employee.bonuses_role || '',
              department: employee.tenant_departement?.name || '',
              photo_url: photoUrl,
              photo: backgroundPhoto,
              mobile: employee.mobile,
              phone: employee.phone,
              phone_ext: employee.phone_ext,
              mobile_ext: employee.mobile_ext,
              is_active: otherParticipant.user.is_active,
              user: otherParticipant.user
            });
            setShowBusinessCardModal(true);
          }
        };
        const sizeClass = size === 'xlarge' ? 'w-14 h-14' : size === 'large' ? 'w-11 h-11' : 'w-10 h-10';
        const textClass = size === 'xlarge' ? 'text-lg' : size === 'large' ? 'text-base' : 'text-sm';
        return (
          <button
            onClick={handleAvatarClick}
            className="cursor-pointer hover:opacity-80 transition-opacity"
            title={`View ${name}'s profile`}
          >
            {renderUserAvatar({
              userId: avatarKey,
              name,
              photoUrl,
              sizeClass,
              borderClass: '',
              textClass,
            })}
          </button>
        );
      }
    }

    const handleGroupIconClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (conversation && conversation.type === 'group') {
        // Check if group is locked and user is not superuser
        if (isGroupLocked(conversation) && !isSuperUser) {
          toast.error('This group is locked. Only superusers can edit locked groups.');
          return;
        }
        // Set the conversation as selected first if not already
        if (conversation.id !== selectedConversation?.id) {
          selectConversation(conversation);
        }
        setGroupTitle(conversation.title || '');
        setGroupDescription(conversation.description || '');
        setGroupNotes(conversation.notes || '');
        setGroupIconUrl(conversation.icon_url || null);
        setShowGroupInfoModal(true);
      }
    };

    // Render group icon - use custom image if available, otherwise default gradient
    const renderGroupIcon = () => {
      const iconSize = size === 'xlarge' ? 'w-14 h-14' : size === 'large' ? 'w-11 h-11' : 'w-10 h-10';
      const iconInnerSize = size === 'xlarge' ? 'w-7 h-7' : size === 'large' ? 'w-6 h-6' : 'w-5 h-5';

      if (conversation.icon_url) {
        return (
          <img
            src={conversation.icon_url}
            alt={conversation.title || 'Group'}
            className={`${iconSize} rounded-full object-cover border-2 border-white shadow-md`}
            onError={(e) => {
              // Fallback to default if image fails to load
              const target = e.target as HTMLImageElement;
              target.style.display = 'none';
              if (target.parentElement) {
                target.parentElement.innerHTML = `
                  <div class="${iconSize} rounded-full bg-gradient-to-br from-green-500 to-teal-500 flex items-center justify-center text-white border-2 border-white shadow-md">
                    <svg class="${iconInnerSize}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"></path>
                    </svg>
                  </div>
                `;
              }
            }}
          />
        );
      }
      return (
        <div className={`${iconSize} rounded-full bg-gradient-to-br from-green-500 to-teal-500 flex items-center justify-center text-white border-2 border-white shadow-md`}>
          <UserGroupIcon className={iconInnerSize} />
        </div>
      );
    };

    // Check if group is locked and user is not superuser - disable click
    const isLocked = isGroupLocked(conversation);
    const canEdit = !isLocked || isSuperUser;

    return (
      <button
        onClick={handleGroupIconClick}
        className={`${canEdit ? 'cursor-pointer hover:opacity-80' : 'cursor-not-allowed opacity-50'} transition-opacity`}
        title={canEdit ? "Edit group info" : "This group is locked. Only superusers can edit locked groups."}
        disabled={!canEdit}
      >
        {renderGroupIcon()}
      </button>
    );
  };

  // Initialize and load data first, then connect WebSocket
  useEffect(() => {
    const initializeMessaging = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        // Look up user by auth_id (matching Dashboard.tsx pattern)
        const { data: userData, error } = await supabase
          .from('users')
          .select(`
            id,
            full_name,
            email,
            employee_id,
            is_superuser,
            tenants_employee!users_employee_id_fkey(
              display_name,
              bonuses_role,
              department_id,
              photo_url,
              chat_background_image_url,
              tenant_departement!tenants_employee_department_id_fkey(
                name
              )
            )
          `)
          .eq('auth_id', user.id)
          .maybeSingle();

        if (error || !userData) {
          console.error('❌ [RMQMessagesPage] Failed to load user data:', {
            error,
            authId: user.id,
            hasUserData: !!userData
          });
          toast.error('Failed to load user information. Please ensure your account is properly configured.');
          return;
        }

        setCurrentUser(userData as unknown as User);

        // Set superuser status (check for true, 'true', or 1)
        const superuserStatus = (userData as any).is_superuser === true || (userData as any).is_superuser === 'true' || (userData as any).is_superuser === 1;
        setIsSuperUser(superuserStatus);
        // Set chat background image URL if available
        const backgroundUrl = (userData as any)?.tenants_employee?.chat_background_image_url;
        setChatBackgroundImageUrl(backgroundUrl || null);

        // Wait for data to be loaded before connecting WebSocket
        // Initialize WebSocket connection after user data is set
        if (userData && isOpen) {
          // Set up handlers BEFORE connecting
          // Online status handlers - MUST be set up before connecting
          websocketService.onUserOnline((userId: string) => {
            const userIdStr = String(userId);
            setOnlineUsers(prev => {
              const newSet = new Set(prev);
              newSet.add(userIdStr);
              return newSet;
            });
            // Clear last online time when user comes back online
            setLastOnlineTimes(prev => {
              const newMap = new Map(prev);
              newMap.delete(userIdStr);
              return newMap;
            });
          });

          websocketService.onUserOffline((userId: string) => {
            const userIdStr = String(userId);
            setOnlineUsers(prev => {
              const newSet = new Set(prev);
              newSet.delete(userIdStr);
              return newSet;
            });
            // Record the time when user went offline
            setLastOnlineTimes(prev => {
              const newMap = new Map(prev);
              newMap.set(userIdStr, new Date());
              return newMap;
            });
          });

          // Typing indicator handler
          websocketService.onTyping((data) => {
            const { conversation_id, user_id, user_name, is_typing } = data;
            if (user_id === currentUserForSocketRef.current?.id) return;

            if (is_typing) {
              setTypingUsers(prev => {
                const newMap = new Map(prev);
                newMap.set(conversation_id, { userId: user_id, userName: user_name });
                return newMap;
              });

              // Clear typing indicator after 3 seconds
              setTimeout(() => {
                setTypingUsers(prev => {
                  const newMap = new Map(prev);
                  if (newMap.get(conversation_id)?.userId === user_id) {
                    newMap.delete(conversation_id);
                  }
                  return newMap;
                });
              }, 3000);
            } else {
              setTypingUsers(prev => {
                const newMap = new Map(prev);
                if (newMap.get(conversation_id)?.userId === user_id) {
                  newMap.delete(conversation_id);
                }
                return newMap;
              });
            }
          });

          websocketService.onConnect(() => {
            console.log('✅ WebSocket connected, requesting online status...');
            // Add current user to online users when they connect
            if (userData?.id) {
              setOnlineUsers(prev => {
                const newSet = new Set(prev);
                newSet.add(String(userData.id));
                return newSet;
              });
            }
            // Request online status for all contacts after connection is established
            // Use a longer delay to ensure the connection is fully established
            setTimeout(() => {
              const users = allUsersForSocketRef.current;
              if (users.length > 0 && websocketService.isSocketConnected()) {
                const userIds = users.map(u => String(u.id));
                websocketService.requestOnlineStatus(userIds);
              }
            }, 2000);
          });

          websocketService.onDisconnect(() => {
          });

          // Online status response handler - MUST be set up before connecting
          websocketService.onOnlineStatusResponse((onlineUserIds: string[]) => {
            console.log('📊 Online status response received:', onlineUserIds.length, 'online users');
            const onlineSet = new Set(onlineUserIds.map(id => String(id)));
            setOnlineUsers(onlineSet);
          });

          // Now connect after handlers are set up
          websocketService.connect(userData.id);
        }
      } catch (error) {
      }
    };

    if (isOpen) {
      initializeMessaging();
    }

    // Cleanup WebSocket on unmount or close
    return () => {
      if (!isOpen) {
        websocketService.disconnect();
        // Don't reset state - keep it in cache for next open
        // Only reset initialLoadRef
        initialLoadRef.current = null;
      }
    };
  }, [isOpen]);

  // Restore state from cache when modal opens
  useEffect(() => {
    if (!isOpen || !currentUser || hasRestoredFromCacheRef.current) return;

    // Mark as restored to prevent multiple restorations
    hasRestoredFromCacheRef.current = true;

    // Restore conversations from cache if available
    if (persistedConversations.length > 0) {
      setConversations(persistedConversations);
      console.log('[RMQ] Restored conversations from cache on modal open');
    }

    // Restore active tab
    if (persistedActiveTab) {
      setActiveTab(persistedActiveTab);
    }

    // Restore selected conversation if available
    if (persistedSelectedConversationId) {
      const cachedConv = persistedConversations.find(c => c.id === persistedSelectedConversationId);
      if (cachedConv) {
        selectConversation(cachedConv);

        // Restore messages from cache if available
        const cachedMessages = persistedMessages[cachedConv.id];
        if (cachedMessages && cachedMessages.messages.length > 0) {
          setMessages(cachedMessages.messages);
          console.log(`[RMQ] Restored ${cachedMessages.messages.length} messages from cache for conversation ${cachedConv.id}`);
          // fetchMessages runs from selectedConversation effect (deduped in-flight)
        }
        // No message cache: selectedConversation effect loads messages
      }
    }

    // Fetch conversations in background to update cache (non-blocking)
    setTimeout(() => {
      fetchConversations(false, false).catch(console.error);
    }, 200);
  }, [isOpen, currentUser]);

  // Reset restoration flag when modal closes
  useEffect(() => {
    if (!isOpen) {
      hasRestoredFromCacheRef.current = false;
    }
  }, [isOpen]);

  // Sync local state with persisted state when it changes
  useEffect(() => {
    if (selectedConversation) {
      setPersistedSelectedConversationId(selectedConversation.id);
    }
  }, [selectedConversation?.id, setPersistedSelectedConversationId]);

  useEffect(() => {
    setPersistedActiveTab(activeTab);
  }, [activeTab, setPersistedActiveTab]);

  // Helper function to get updated conversations without setting state
  const getUpdatedConversations = async (): Promise<Conversation[]> => {
    if (!currentUser) return [];

    try {
      // First, get conversations where the current user participates
      const { data: userConversations, error: convError } = await supabase
        .from('conversation_participants')
        .select('conversation_id')
        .eq('user_id', currentUser.id)
        .eq('is_active', true);

      if (convError) {
        return [];
      }

      const conversationIds = userConversations?.map(c => c.conversation_id) || [];

      if (conversationIds.length === 0) {
        return [];
      }

      // Then, get full conversation data with ALL participants
      // Try with icon_url first, fallback without it if column doesn't exist
      let conversationsData: any = null;
      let error: any = null;

      // First attempt: try with icon_url
      const queryWithIcon = supabase
        .from('conversations')
        .select(`
          id,
          title,
          type,
          created_by,
          created_at,
          updated_at,
          last_message_at,
          last_message_preview,
          is_active,
          description,
          notes,
          icon_url,
          is_locked,
          conversation_participants(
            id,
            user_id,
            joined_at,
            last_read_at,
            is_active,
            role,
            user:users!user_id(
              id,
              full_name,
              email,
              employee_id,
              is_active,
              tenants_employee!users_employee_id_fkey(
                display_name,
                official_name,
                bonuses_role,
                department_id,
                photo_url,
                mobile,
                phone,
                tenant_departement!tenants_employee_department_id_fkey(
                  name
                )
              )
            )
          )
        `)
        .in('id', conversationIds)
        .eq('is_active', true)
        .order('last_message_at', { ascending: false });

      const resultWithIcon = await queryWithIcon;
      conversationsData = resultWithIcon.data;
      error = resultWithIcon.error;

      // If error is about missing icon_url column, retry without it
      if (error && error.code === '42703' && error.message && error.message.includes('icon_url')) {
        const queryWithoutIcon = supabase
          .from('conversations')
          .select(`
            id,
            title,
            type,
            created_by,
            created_at,
            updated_at,
            last_message_at,
            last_message_preview,
            is_active,
            description,
            notes,
            is_locked,
            conversation_participants(
              id,
              user_id,
              joined_at,
              last_read_at,
              is_active,
              role,
              user:users!user_id(
                id,
                full_name,
                email,
                employee_id,
                is_active,
                tenants_employee!users_employee_id_fkey(
                  display_name,
                  official_name,
                  bonuses_role,
                  department_id,
                  photo_url,
                  mobile,
                  phone,
                  tenant_departement!tenants_employee_department_id_fkey(
                    name
                  )
                )
              )
            )
          `)
          .in('id', conversationIds)
          .eq('is_active', true)
          .order('last_message_at', { ascending: false });

        const resultWithoutIcon = await queryWithoutIcon;
        conversationsData = resultWithoutIcon.data;
        error = resultWithoutIcon.error;

        // Add icon_url as null for all conversations if column doesn't exist
        if (conversationsData) {
          conversationsData = conversationsData.map((conv: any) => ({
            ...conv,
            icon_url: null
          }));
        }
      }

      if (error) {
        return [];
      }

      // Process conversations and calculate unread counts
      const processedConversations = await Promise.all(
        (conversationsData || []).map(async (conv: any) => {
          // Get unread count for this conversation
          const userParticipant = conv.conversation_participants.find(
            (p: ConversationParticipant) => p.user_id === currentUser.id
          );

          let unreadCount = 0;
          if (userParticipant) {
            const { data: unreadMessages } = await supabase
              .from('messages')
              .select('id')
              .eq('conversation_id', conv.id)
              .gt('sent_at', userParticipant.last_read_at)
              .neq('sender_id', currentUser.id)
              .eq('is_deleted', false);

            unreadCount = unreadMessages?.length || 0;
          }

          // Remove duplicate participants and filter only active ones (both participant and user must be active)
          const activeParticipants = conv.conversation_participants.filter((participant: any) => {
            const user = participant.user;
            const hasValidName = (user?.full_name || user?.tenants_employee?.display_name) &&
              (user?.full_name || user?.tenants_employee?.display_name).length > 1;
            const isNotExplicitlyInactive = user?.is_active !== false;
            return participant.is_active &&
              isNotExplicitlyInactive &&
              hasValidName;
          });
          const uniqueParticipants = activeParticipants.filter(
            (participant: any, index: number, self: any[]) =>
              index === self.findIndex(p => p.user_id === participant.user_id)
          );

          return {
            ...conv,
            participants: uniqueParticipants,
            unread_count: unreadCount
          };
        })
      );

      return processedConversations;
    } catch (error) {
      return [];
    }
  };

  // Fetch conversations
  const fetchConversations = useCallback(async (showErrors = true, forceRefresh = false) => {
    if (!currentUser) return;

    // Check cache first (unless forced refresh)
    const now = Date.now();
    const cacheAge = now - conversationsLastFetchedRef.current;
    const hasCachedData = persistedConversations.length > 0;
    const isCacheValid = hasCachedData && cacheAge < CONVERSATION_CACHE_DURATION && !forceRefresh;

    if (isCacheValid) {
      // Restore from cache
      setConversations(persistedConversations);
      console.log('[RMQ] Restored conversations from cache');

      // Fetch in background to update cache (non-blocking)
      setTimeout(() => {
        fetchConversations(showErrors, true).catch(console.error);
      }, 100);
      return;
    }

    // Prevent duplicate concurrent calls
    if (isFetchingConversations) {
      return;
    }

    // Cancel any ongoing fetch
    if (fetchConversationsAbortControllerRef.current) {
      fetchConversationsAbortControllerRef.current.abort();
    }

    // Create new abort controller
    const abortController = new AbortController();
    fetchConversationsAbortControllerRef.current = abortController;

    setIsFetchingConversations(true);

    try {
      // First, get conversations where the current user participates
      const { data: userConversations, error: convError } = await supabase
        .from('conversation_participants')
        .select('conversation_id')
        .eq('user_id', currentUser.id)
        .eq('is_active', true);

      // Check if aborted
      if (abortController.signal.aborted) {
        return;
      }

      if (convError) {
        console.error('Error fetching conversation participants:', convError);
        // Only show error if explicitly requested (e.g., user-initiated refresh)
        if (showErrors) {
          // Check error type - don't show for network errors that might be temporary
          if (convError.code !== 'PGRST116' && convError.message && !convError.message.includes('timeout')) {
            toast.error('Failed to load conversations');
          }
        }
        return;
      }

      const conversationIds = userConversations?.map(c => c.conversation_id) || [];

      if (conversationIds.length === 0) {
        setConversations([]);
        return;
      }

      // Then, get full conversation data with ALL participants
      // Try with icon_url first, fallback without it if column doesn't exist
      let conversationsData: any = null;
      let error: any = null;

      // First attempt: try with icon_url
      const queryWithIcon = supabase
        .from('conversations')
        .select(`
          id,
          title,
          type,
          created_by,
          created_at,
          updated_at,
          last_message_at,
          last_message_preview,
          is_active,
          description,
          notes,
          icon_url,
          is_locked,
          conversation_participants(
            id,
            user_id,
            joined_at,
            last_read_at,
            is_active,
            role,
            user:users!user_id(
              id,
              full_name,
              email,
              employee_id,
              is_active,
              tenants_employee!users_employee_id_fkey(
                display_name,
                official_name,
                bonuses_role,
                department_id,
                photo_url,
                mobile,
                phone,
                tenant_departement!tenants_employee_department_id_fkey(
                  name
                )
              )
            )
          )
        `)
        .in('id', conversationIds)
        .eq('is_active', true)
        .order('last_message_at', { ascending: false });

      const resultWithIcon = await queryWithIcon;
      conversationsData = resultWithIcon.data;
      error = resultWithIcon.error;

      // If error is about missing icon_url column, retry without it
      if (error && error.code === '42703' && error.message && error.message.includes('icon_url')) {
        console.log('icon_url column not found, retrying without it...');
        const queryWithoutIcon = supabase
          .from('conversations')
          .select(`
            id,
            title,
            type,
            created_by,
            created_at,
            updated_at,
            last_message_at,
            last_message_preview,
            is_active,
            description,
            notes,
            is_locked,
            conversation_participants(
              id,
              user_id,
              joined_at,
              last_read_at,
              is_active,
              role,
              user:users!user_id(
                id,
                full_name,
                email,
                employee_id,
                is_active,
                tenants_employee!users_employee_id_fkey(
                  display_name,
                  official_name,
                  bonuses_role,
                  department_id,
                  photo_url,
                  mobile,
                  phone,
                  tenant_departement!tenants_employee_department_id_fkey(
                    name
                  )
                )
              )
            )
          `)
          .in('id', conversationIds)
          .eq('is_active', true)
          .order('last_message_at', { ascending: false });

        const resultWithoutIcon = await queryWithoutIcon;
        conversationsData = resultWithoutIcon.data;
        error = resultWithoutIcon.error;

        // Add icon_url as null for all conversations if column doesn't exist
        if (conversationsData) {
          conversationsData = conversationsData.map((conv: any) => ({
            ...conv,
            icon_url: null
          }));
        }
      }

      // Check if aborted
      if (abortController.signal.aborted) {
        return;
      }

      if (error) {
        console.error('Error fetching conversations:', error);
        // Only show error if explicitly requested and it's not a transient error
        if (showErrors) {
          if (error.code !== 'PGRST116' && error.message && !error.message.includes('timeout')) {
            toast.error('Failed to load conversations');
          }
        }
        return;
      }

      // Unread counts: single RPC (falls back to per-conversation queries if RPC missing / fails)
      let useRpcUnread = true;
      const rpcUnreadMap = new Map<number, number>();
      try {
        const { data: rpcRows, error: rpcErr } = await supabase.rpc('rmq_unread_counts_for_user');
        if (rpcErr || !Array.isArray(rpcRows)) {
          throw rpcErr || new Error('rmq_unread_counts_for_user failed');
        }
        rpcRows.forEach((r: any) => {
          rpcUnreadMap.set(Number(r.conversation_id), Number(r.unread_count) || 0);
        });
      } catch (e) {
        console.warn('[RMQ] Unread RPC failed, using per-conversation counts', e);
        useRpcUnread = false;
      }

      const processedConversations = await Promise.all(
        (conversationsData || []).map(async (conv: any) => {
          // Check if aborted during processing
          if (abortController.signal.aborted) {
            return null;
          }

          try {
            const userParticipant = conv.conversation_participants.find(
              (p: ConversationParticipant) => p.user_id === currentUser.id
            );

            let unreadCount = 0;
            if (useRpcUnread) {
              unreadCount = rpcUnreadMap.get(conv.id) ?? 0;
            } else if (userParticipant) {
              const { data: unreadMessages } = await supabase
                .from('messages')
                .select('id')
                .eq('conversation_id', conv.id)
                .gt('sent_at', userParticipant.last_read_at)
                .neq('sender_id', currentUser.id)
                .eq('is_deleted', false);

              unreadCount = unreadMessages?.length || 0;
            }

            // Remove duplicate participants and filter only active ones (both participant and user must be active)
            const activeParticipants = conv.conversation_participants.filter((participant: any) => {
              const user = participant.user;
              const hasValidName = (user?.full_name || user?.tenants_employee?.display_name) &&
                (user?.full_name || user?.tenants_employee?.display_name).length > 1;
              const isNotExplicitlyInactive = user?.is_active !== false;
              return participant.is_active &&
                isNotExplicitlyInactive &&
                hasValidName;
            });
            const uniqueParticipants = activeParticipants.filter(
              (participant: any, index: number, self: any[]) =>
                index === self.findIndex(p => p.user_id === participant.user_id)
            );

            const processedConv = {
              ...conv,
              participants: uniqueParticipants,
              unread_count: unreadCount
            };

            return processedConv;
          } catch (err) {
            console.error('Error processing conversation:', conv.id, err);
            // Return null for failed conversations, will be filtered out
            return null;
          }
        })
      );

      // Check if aborted before setting state
      if (!abortController.signal.aborted) {
        // Filter out any null values from failed processing
        const validConversations = processedConversations.filter((conv): conv is Conversation => conv !== null);
        setConversations(validConversations);
        // Update persisted cache
        setPersistedConversations(validConversations);
        conversationsLastFetchedRef.current = Date.now();
        console.log('[RMQ] Updated conversations cache');
      }
    } catch (error: any) {
      // Only show error for non-abort errors and if explicitly requested
      if (!error?.name?.includes('Abort') && showErrors) {
        console.error('Error in fetchConversations:', error);
        // Don't show toast for abort errors or network timeouts
        if (error.message && !error.message.includes('timeout') && !error.message.includes('aborted')) {
          toast.error('Failed to load conversations');
        }
      }
    } finally {
      // Only clear the flag if this was the active fetch
      if (fetchConversationsAbortControllerRef.current === abortController) {
        setIsFetchingConversations(false);
        fetchConversationsAbortControllerRef.current = null;
      }
    }
  }, [currentUser]);

  /** Attach reply previews + read receipts to a raw message batch (same shape as main fetch). */
  const enrichRawMessages = useCallback(async (rawList: any[], _conversationId: number): Promise<Message[]> => {
    let processedMessages = (rawList || []).map((msg: any) => {
      msg.reply_to_message = null;
      if (msg.reply_to_message_id) msg._needs_reply_fetch = true;
      return msg;
    });
    const messageIds = processedMessages.map(m => m.id).filter(id => id != null && id !== undefined);
    const messagesNeedingReplyFetch = processedMessages.filter((msg: any) => msg._needs_reply_fetch && msg.reply_to_message_id);
    const replyMessageIds = messagesNeedingReplyFetch.map((msg: any) => msg.reply_to_message_id);
    const uniqueReplyIds = [...new Set(replyMessageIds.filter(id => id != null))];
    const [repliesResult, receiptsResult] = await Promise.all([
      uniqueReplyIds.length > 0 ? supabase
        .from('messages')
        .select(`
            id,
            content,
            message_type,
            attachment_url,
            attachment_name,
            attachment_type,
            sender:users!sender_id(
              id,
              full_name,
              is_active,
              tenants_employee!users_employee_id_fkey(display_name)
            )
          `)
        .in('id', uniqueReplyIds) : Promise.resolve({ data: [], error: null }),
      messageIds.length > 0 && currentUser ? supabase
        .from('message_read_receipts')
        .select('message_id, user_id, read_at')
        .in('message_id', messageIds) : Promise.resolve({ data: [], error: null })
    ]);
    if (repliesResult.data && repliesResult.data.length > 0) {
      const replyMap = new Map(repliesResult.data.map((reply: any) => [reply.id, reply]));
      processedMessages = processedMessages.map((msg: any) => {
        if (msg._needs_reply_fetch && msg.reply_to_message_id) {
          const fetchedReply = replyMap.get(msg.reply_to_message_id);
          if (fetchedReply) msg.reply_to_message = fetchedReply;
        }
        delete msg._needs_reply_fetch;
        return msg;
      });
    }
    const readReceiptsData = receiptsResult.data || [];
    const finalMessages = processedMessages.map((msg: any) => {
      let replyMessage = msg.reply_to_message;
      if (replyMessage && Array.isArray(replyMessage)) {
        replyMessage = replyMessage.length > 0 ? replyMessage[0] : null;
      }
      let media = msg.media_attachments;
      if (media != null && typeof media === 'string') {
        try {
          media = JSON.parse(media);
        } catch {
          media = undefined;
        }
      }
      return {
        ...msg,
        media_attachments: Array.isArray(media) ? media : msg.media_attachments,
        reply_to_message: replyMessage,
        read_receipts: readReceiptsData.filter((rr: any) => rr.message_id === msg.id) || []
      };
    });
    return finalMessages as unknown as Message[];
  }, [currentUser]);

  const loadRmqPinnedMessages = useCallback(
    async (conversationId: number) => {
      if (!currentUser?.id) {
        setRmqPinnedRows([]);
        return;
      }
      const seq = ++pinnedMessagesLoadSeqRef.current;
      setRmqPinnedLoading(true);
      try {
        const { data: pins, error: pe } = await supabase
          .from('rmq_user_pinned_messages')
          .select('id, message_id, pinned_at')
          .eq('user_id', currentUser.id)
          .eq('conversation_id', conversationId)
          .order('pinned_at', { ascending: false });
        if (seq !== pinnedMessagesLoadSeqRef.current) return;
        if (pe) {
          console.warn('[RMQ] pin fetch:', pe.message);
          setRmqPinnedRows([]);
          return;
        }
        if (!pins?.length) {
          setRmqPinnedRows([]);
          return;
        }
        const ids = pins.map(p => p.message_id);
        const { data: rawMsgs, error: me } = await supabase
          .from('messages')
          .select(RMQ_MESSAGE_LIST_SELECT)
          .in('id', ids)
          .eq('conversation_id', conversationId)
          .eq('is_deleted', false);
        if (seq !== pinnedMessagesLoadSeqRef.current) return;
        if (me || !rawMsgs?.length) {
          setRmqPinnedRows([]);
          return;
        }
        const enriched = await enrichRawMessages(rawMsgs as any[], conversationId);
        if (seq !== pinnedMessagesLoadSeqRef.current) return;
        const byId = new Map(enriched.map(m => [m.id, m]));
        const rows: RmqPinnedRow[] = [];
        for (const pin of pins) {
          const msg = byId.get(pin.message_id);
          if (msg) rows.push({ pinRowId: pin.id, message: msg, pinned_at: pin.pinned_at });
        }
        setRmqPinnedRows(rows);
      } finally {
        if (seq === pinnedMessagesLoadSeqRef.current) {
          setRmqPinnedLoading(false);
        }
      }
    },
    [currentUser?.id, enrichRawMessages]
  );

  const togglePinMessage = useCallback(
    async (message: Message) => {
      if (!selectedConversation || !currentUser?.id) return;
      const convId = selectedConversation.id;
      const existing = rmqPinnedRows.find(r => r.message.id === message.id);
      try {
        if (existing) {
          const { error } = await supabase.from('rmq_user_pinned_messages').delete().eq('id', existing.pinRowId);
          if (error) throw error;
          toast.success('Unpinned');
        } else {
          const { error } = await supabase.from('rmq_user_pinned_messages').insert({
            user_id: currentUser.id,
            conversation_id: convId,
            message_id: message.id,
          });
          if (error) throw error;
          toast.success('Pinned');
        }
        await loadRmqPinnedMessages(convId);
      } catch (e: any) {
        console.error(e);
        toast.error(
          e?.message?.includes('relation') || e?.code === '42P01'
            ? 'Pinned messages require the DB migration (sql/rmq_user_pinned_messages.sql).'
            : 'Could not update pin'
        );
      }
    },
    [selectedConversation, currentUser?.id, rmqPinnedRows, loadRmqPinnedMessages]
  );

  const loadRmqMessageLeadFlags = useCallback(async (conversationId: number) => {
    setRmqMessageLeadFlagsLoading(true);
    try {
      const rows = await fetchRmqMessageFlagsForConversation(supabase, conversationId);
      const newIds = [...new Set(rows.map(r => r.new_lead_id).filter(Boolean))] as string[];
      const legIds = [...new Set(rows.map(r => r.legacy_lead_id).filter((x): x is number => x != null))];
      const num = new Map<string, string>();
      if (newIds.length) {
        const { data } = await supabase.from('leads').select('id, lead_number').in('id', newIds);
        (data || []).forEach((l: { id: string; lead_number?: string | number | null }) =>
          num.set(`n:${l.id}`, String(l.lead_number ?? ''))
        );
      }
      if (legIds.length) {
        const { data } = await supabase.from('leads_lead').select('id, lead_number').in('id', legIds);
        (data || []).forEach((l: { id: number; lead_number?: string | number | null }) =>
          num.set(`l:${l.id}`, String(l.lead_number ?? ''))
        );
      }
      const enriched = rows.map(r => ({
        ...r,
        _leadNum:
          r.new_lead_id != null
            ? num.get(`n:${r.new_lead_id}`)
            : r.legacy_lead_id != null
              ? num.get(`l:${r.legacy_lead_id}`)
              : undefined,
      }));
      setRmqMessageLeadFlags(enriched);
    } finally {
      setRmqMessageLeadFlagsLoading(false);
    }
  }, []);

  const searchLeadsForFlagModal = useCallback(async (query: string): Promise<LeadPick[]> => {
    setFlagLeadSearchBusy(true);
    try {
      const q = query.replace(/%/g, '');
      const { data: leadsData } = await supabase
        .from('leads')
        .select('id, lead_number, name, email')
        .or(`lead_number.ilike.%${q}%,name.ilike.%${q}%,email.ilike.%${q}%`)
        .limit(10);
      const { data: legacyLeadsData } = await supabase
        .from('leads_lead')
        .select('id, lead_number, name, email')
        .or(`lead_number.ilike.%${q}%,name.ilike.%${q}%,email.ilike.%${q}%`)
        .limit(10);
      const a: LeadPick[] = (leadsData || []).map(l => ({ ...l, isLegacy: false }));
      const b: LeadPick[] = (legacyLeadsData || []).map(l => ({ ...l, isLegacy: true }));
      return [...a, ...b].slice(0, 12);
    } finally {
      setFlagLeadSearchBusy(false);
    }
  }, []);

  const submitRmqMessageFlag = useCallback(
    async (lead: LeadPick, flagTypeId: number) => {
      if (!messageToFlag || !selectedConversation || !currentUser?.id) return;
      const { error } = await insertRmqMessageLeadFlag(supabase, {
        userId: currentUser.id,
        messageId: messageToFlag.id,
        conversationId: selectedConversation.id,
        newLeadId: lead.isLegacy ? null : String(lead.id),
        legacyLeadId: lead.isLegacy ? Number(lead.id) : null,
        flagTypeId,
      });
      if (error) {
        const code = 'code' in error ? (error as { code?: string }).code : undefined;
        const dup =
          code === '23505' ||
          error.message.includes('duplicate') ||
          error.message.includes('unique');
        toast.error(dup ? 'You already flagged this message' : error.message);
        throw error;
      }
      toast.success('Message flagged to lead');
      setMessageToFlag(null);
      await loadRmqMessageLeadFlags(selectedConversation.id);
    },
    [messageToFlag, selectedConversation, currentUser?.id, loadRmqMessageLeadFlags]
  );

  const removeRmqMessageLeadFlagRow = useCallback(
    async (flagId: string) => {
      const { error } = await deleteRmqMessageLeadFlag(supabase, flagId);
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success('Flag removed');
      if (selectedConversation?.id) await loadRmqMessageLeadFlags(selectedConversation.id);
    },
    [selectedConversation?.id, loadRmqMessageLeadFlags]
  );

  useEffect(() => {
    void fetchFlagTypes(supabase).then(setRmqMessageFlagTypes);
  }, []);

  const scrollToMessageInChat = useCallback(
    (messageId: number) => {
      scrollToMessage(messageId, 'smooth');
    },
    [scrollToMessage]
  );

  const loadRmqMessageCommentCounts = useCallback(async (conversationId: number) => {
    try {
      const { data, error } = await supabase
        .from('rmq_message_comments')
        .select('message_id')
        .eq('conversation_id', conversationId);
      if (error) {
        if (error.code === '42P01' || String(error.message || '').includes('relation')) {
          setRmqMessageCommentCounts({});
          return;
        }
        console.warn('[RMQ] comment counts:', error.message);
        return;
      }
      const map: Record<number, number> = {};
      (data || []).forEach((row: { message_id: number }) => {
        map[row.message_id] = (map[row.message_id] || 0) + 1;
      });
      setRmqMessageCommentCounts(map);
    } catch (e) {
      console.warn('[RMQ] comment counts', e);
    }
  }, []);

  const openRmqMessageCommentsModal = useCallback(
    async (message: Message) => {
      setRmqMessageCommentsModal(message);
      setRmqNewCommentText('');
      setRmqMessageCommentsLoading(true);
      setRmqMessageCommentsList([]);
      try {
        const { data, error } = await supabase
          .from('rmq_message_comments')
          .select('id, message_id, conversation_id, user_id, body, created_at')
          .eq('message_id', message.id)
          .order('created_at', { ascending: true });
        if (error) throw error;
        const rows = (data || []) as Omit<RmqMessageComment, 'sender'>[];
        const enriched: RmqMessageComment[] = rows.map(row => ({
          ...row,
          sender:
            allUsers.find(u => u.id === row.user_id) ||
            (currentUser?.id === row.user_id ? currentUser : undefined) ||
            ({
              id: row.user_id,
              full_name: 'User',
              email: '',
            } as User),
        }));
        setRmqMessageCommentsList(enriched);
      } catch (e: unknown) {
        const err = e as { message?: string; code?: string };
        console.error(e);
        toast.error(
          err?.message?.includes('relation') || err?.code === '42P01'
            ? 'Comments require sql/rmq_message_comments.sql in the database.'
            : 'Could not load comments'
        );
        setRmqMessageCommentsList([]);
      } finally {
        setRmqMessageCommentsLoading(false);
      }
    },
    [allUsers, currentUser]
  );

  const submitRmqMessageComment = useCallback(async () => {
    if (!rmqMessageCommentsModal || !selectedConversation || !currentUser?.id) return;
    const text = rmqNewCommentText.trim();
    if (!text) {
      toast.error('Write a comment');
      return;
    }
    setRmqSubmittingComment(true);
    try {
      const { data, error } = await supabase
        .from('rmq_message_comments')
        .insert({
          conversation_id: selectedConversation.id,
          message_id: rmqMessageCommentsModal.id,
          user_id: currentUser.id,
          body: text,
        })
        .select('id, message_id, conversation_id, user_id, body, created_at')
        .single();
      if (error) throw error;
      setRmqNewCommentText('');
      const row = data as Omit<RmqMessageComment, 'sender'>;
      const newComment: RmqMessageComment = {
        ...row,
        sender: currentUser,
      };
      setRmqMessageCommentsList(prev => [...prev, newComment]);
      setRmqMessageCommentCounts(prev => ({
        ...prev,
        [rmqMessageCommentsModal.id]: (prev[rmqMessageCommentsModal.id] || 0) + 1,
      }));
      toast.success('Comment added');
    } catch (e: unknown) {
      const err = e as { message?: string; code?: string };
      console.error(e);
      toast.error(
        err?.message?.includes('relation') || err?.code === '42P01'
          ? 'Comments require the DB migration (sql/rmq_message_comments.sql).'
          : 'Could not save comment'
      );
    } finally {
      setRmqSubmittingComment(false);
    }
  }, [rmqMessageCommentsModal, selectedConversation, currentUser, rmqNewCommentText]);

  const deleteRmqMessageComment = useCallback(
    async (commentId: number) => {
      try {
        const { error } = await supabase.from('rmq_message_comments').delete().eq('id', commentId);
        if (error) throw error;
        setRmqMessageCommentsList(prev => prev.filter(c => c.id !== commentId));
        if (rmqMessageCommentsModal) {
          setRmqMessageCommentCounts(prev => {
            const next = { ...prev };
            const mid = rmqMessageCommentsModal.id;
            next[mid] = Math.max(0, (next[mid] || 0) - 1);
            if (next[mid] === 0) delete next[mid];
            return next;
          });
        }
        toast.success('Comment removed');
      } catch (e) {
        console.error(e);
        toast.error('Could not remove comment');
      }
    },
    [rmqMessageCommentsModal]
  );

  /** Desktop: same ellipsis menu for every message (Reply, Forward, Pin; Edit/Delete for own). Menu is portaled to body (fixed) so it is not clipped by overflow. */
  const renderDesktopMessageDropdown = (message: Message, isOwn: boolean) => {
    const isPinned = rmqPinnedRows.some(r => r.message.id === message.id);
    const focusComposer = () => {
      setTimeout(() => {
        messageInputRef.current?.focus();
        mobileMessageInputRef.current?.focus();
      }, 100);
    };
    const menuPanel =
      messageActionMenu === message.id && messageMenuAnchor ? (
        <div
          className="message-action-menu fixed bg-white border border-gray-200 rounded-lg shadow-lg min-w-[140px] z-[10000]"
          style={
            messageMenuAnchor.isOwn
              ? {
                  left: messageMenuAnchor.left,
                  top: messageMenuAnchor.top - 4,
                  transform: 'translateY(-100%)',
                }
              : {
                  left: messageMenuAnchor.right,
                  top: messageMenuAnchor.top - 4,
                  transform: 'translate(-100%, -100%)',
                }
          }
        >
          <button
            type="button"
            onClick={e => {
              e.stopPropagation();
              setMessageToReply(message);
              closeMessageActionMenu();
              focusComposer();
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors text-left"
          >
            <ChatBubbleBottomCenterTextIcon className="w-4 h-4" />
            Reply
          </button>
          <button
            type="button"
            onClick={e => {
              e.stopPropagation();
              setMessageToForward(message);
              setShowForwardModal(true);
              closeMessageActionMenu();
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors text-left"
          >
            <ArrowRightIcon className="w-4 h-4" />
            Forward
          </button>
          <button
            type="button"
            onClick={e => {
              e.stopPropagation();
              togglePinMessage(message);
              closeMessageActionMenu();
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors text-left"
          >
            <BookmarkIcon className={`w-4 h-4 ${isPinned ? 'text-amber-500' : ''}`} />
            {isPinned ? 'Unpin message' : 'Pin message'}
          </button>
          <button
            type="button"
            onClick={e => {
              e.stopPropagation();
              setMessageToFlag(message);
              setShowRmqFlagLeadModal(true);
              closeMessageActionMenu();
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors text-left"
          >
            <FlagIcon className="w-4 h-4 text-amber-600" />
            Flag to lead…
          </button>
          {isOwn && (
            <>
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation();
                  setMessageToEdit(message);
                  setEditingMessageText(message.content || '');
                  closeMessageActionMenu();
                  focusComposer();
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors text-left"
              >
                <PencilIcon className="w-4 h-4" />
                Edit
              </button>
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation();
                  handleDeleteMessage(message.id);
                  closeMessageActionMenu();
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors text-left"
              >
                <TrashIcon className="w-4 h-4" />
                Delete
              </button>
            </>
          )}
        </div>
      ) : null;

    return (
      <div
        className={`absolute ${isOwn ? '-left-8 top-1/2 -translate-y-1/2' : '-right-8 top-1/2 -translate-y-1/2'} opacity-0 group-hover:opacity-100 transition-opacity z-10`}
      >
        <div className="relative message-action-menu">
          <button
            type="button"
            ref={el => {
              if (messageActionMenu === message.id) {
                messageActionMenuButtonRef.current = el;
              }
            }}
            onClick={e => {
              e.stopPropagation();
              if (messageActionMenu === message.id) {
                closeMessageActionMenu();
              } else {
                const r = e.currentTarget.getBoundingClientRect();
                setMessageMenuAnchor({
                  left: r.left,
                  right: r.right,
                  top: r.top,
                  isOwn,
                });
                setMessageActionMenu(message.id);
              }
            }}
            className="p-1.5 rounded-full bg-white/90 hover:bg-white shadow-md border border-gray-200 transition-colors"
            title="Message options"
          >
            <EllipsisVerticalIcon className="w-4 h-4 text-gray-700" />
          </button>
          {menuPanel && createPortal(menuPanel, document.body)}
        </div>
      </div>
    );
  };

  /** Mobile: long-press / context menu to open the same actions as desktop (used on all message types). */
  const getMobileMessageActionHandlers = (message: Message) => ({
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setMobileMessageActionMessage(message);
      longPressHandledRef.current = true;
    },
    onTouchStart: () => {
      longPressMessageRef.current = message;
      longPressTimerRef.current = setTimeout(() => {
        setMobileMessageActionMessage(message);
        longPressHandledRef.current = true;
        if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }
      }, 400);
    },
    onTouchEnd: () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      longPressMessageRef.current = null;
    },
    onTouchCancel: () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      longPressMessageRef.current = null;
    },
    onMouseDown: () => {
      longPressMessageRef.current = message;
      longPressTimerRef.current = setTimeout(() => {
        setMobileMessageActionMessage(message);
        longPressHandledRef.current = true;
        if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }
      }, 400);
    },
    onMouseUp: () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      longPressMessageRef.current = null;
    },
    onMouseLeave: () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      longPressMessageRef.current = null;
    },
  });

  // Fetch messages for selected conversation
  const fetchMessages = useCallback(async (conversationId: number, forceRefresh = false) => {
    const existing = fetchMessagesInFlightRef.current.get(conversationId);
    if (existing) {
      await existing;
      return;
    }
    const run = (async () => {
    try {
      // Check cache first (unless forced refresh)
      const cachedData = persistedMessagesRef.current[conversationId];
      const now = Date.now();
      const cacheAge = cachedData ? now - cachedData.lastFetched : Infinity;
      // For persisted state in sessionStorage, use longer cache or ignore age if data exists
      const isCacheValid = cachedData && cachedData.messages.length > 0 && (cacheAge < MESSAGE_CACHE_DURATION || !forceRefresh);

      if (isCacheValid && cachedData.messages.length > 0) {
        // Restore from cache immediately
        setMessages(cachedData.messages);
        setIsLoadingMessages(false);
        setHasMoreOlderMessages(!!cachedData.hasMoreOlder);
        console.log(`[RMQ] Restored ${cachedData.messages.length} messages from cache for conversation ${conversationId}`);

        // Mark as read when entering chat (even when using cache) so read status and unread badge stay in sync
        const cachedMessageIds = cachedData.messages.map((m: Message) => m.id).filter((id: number) => id != null);
        if (cachedMessageIds.length > 0 && currentUser) {
          markMessagesAsRead(cachedMessageIds, conversationId).catch(console.error);
        }

        // Check for new messages in background (non-blocking)
        setTimeout(async () => {
          try {
            // Fetch only messages newer than the last cached message
            const lastMessageId = cachedData.lastMessageId;
            const { data: newMessagesData, error: newError } = await supabase
              .from('messages')
              .select(RMQ_MESSAGE_LIST_SELECT)
              .eq('conversation_id', conversationId)
              .eq('is_deleted', false)
              .gt('id', lastMessageId || 0)
              .order('sent_at', { ascending: true });

            if (!newError && newMessagesData && newMessagesData.length > 0) {
              const enrichedNew = await enrichRawMessages(newMessagesData as any[], conversationId);
              const allMessages = [...cachedData.messages, ...enrichedNew];
              setMessages(allMessages);

              const lastMessage = allMessages[allMessages.length - 1];
              setPersistedMessages(prev => ({
                ...prev,
                [conversationId]: {
                  messages: allMessages,
                  lastFetched: Date.now(),
                  lastMessageId: lastMessage?.id || lastMessageId,
                  oldestMessageId: cachedData.oldestMessageId ?? allMessages[0]?.id ?? null,
                  hasMoreOlder: cachedData.hasMoreOlder
                }
              }));
              console.log(`[RMQ] Added ${newMessagesData.length} new messages to conversation ${conversationId}`);
            }
          } catch (err) {
            console.error('[RMQ] Error checking for new messages:', err);
          }
        }, 100);

        // Preload images and videos in background
        preloadImages(cachedData.messages, false);

        // Load newest videos
        setTimeout(() => {
          const videoMessages = cachedData.messages.filter(m => isVideoMessage(m));
          if (videoMessages.length > 0) {
            const videosToLoad = videoMessages.slice(-5).reverse();
            videosToLoad.forEach((msg, index) => {
              setTimeout(() => {
                const videoElement = document.querySelector(`video[data-message-id="${msg.id}"]`) as HTMLVideoElement;
                // Only check readyState - never use persisted IDs as a gate for fresh DOM elements
                if (videoElement && videoElement.readyState === 0) {
                  videoElement.load();
                }
              }, index * 200);
            });
          }
        }, 100);

        return;
      }

      setIsLoadingMessages(true);
      const { data: messagesDesc, error } = await supabase
        .from('messages')
        .select(RMQ_MESSAGE_LIST_SELECT)
        .eq('conversation_id', conversationId)
        .eq('is_deleted', false)
        .order('sent_at', { ascending: false })
        .limit(MESSAGE_PAGE_SIZE);

      if (error) {
        toast.error('Failed to load messages');
        setIsLoadingMessages(false);
        return;
      }

      const ascRaw = (messagesDesc || []).slice().reverse();
      const hasMoreOlder = (messagesDesc?.length || 0) === MESSAGE_PAGE_SIZE;
      const finalMessages = await enrichRawMessages(ascRaw, conversationId);
      const messageIds = finalMessages.map(m => m.id).filter(id => id != null && id !== undefined);

      setMessages(finalMessages as unknown as Message[]);
      setIsLoadingMessages(false);
      setHasMoreOlderMessages(hasMoreOlder);

      const lastMessage = finalMessages[finalMessages.length - 1];
      const firstMessage = finalMessages[0];
      setPersistedMessages(prev => ({
        ...prev,
        [conversationId]: {
          messages: finalMessages as unknown as Message[],
          lastFetched: Date.now(),
          lastMessageId: lastMessage?.id || null,
          oldestMessageId: firstMessage?.id ?? null,
          hasMoreOlder
        }
      }));
      console.log(`[RMQ] Updated messages cache for conversation ${conversationId}`);

      // Preload images in background (non-blocking)
      preloadImages(finalMessages, false);

      // Load newest videos first (from bottom of chat)
      setTimeout(() => {
        const videoMessages = finalMessages.filter(m => isVideoMessage(m));
        if (videoMessages.length > 0) {
          // Start from the last (newest) videos and work backwards
          const videosToLoad = videoMessages.slice(-5).reverse(); // Last 5 videos, newest first
          videosToLoad.forEach((msg, index) => {
            setTimeout(() => {
              const videoElement = document.querySelector(`video[data-message-id="${msg.id}"]`) as HTMLVideoElement;
              // Only check readyState - never use persisted IDs as a gate for fresh DOM elements
              if (videoElement && videoElement.readyState === 0) {
                videoElement.load();
              }
            }, index * 200); // Stagger loading by 200ms
          });
        }
      }, 100);

      // Mark messages as read for current user when viewing conversation (async, don't wait)
      if (messageIds.length > 0) {
        markMessagesAsRead(messageIds, conversationId).catch(console.error);
      }

      // Mark conversation as read (async, don't wait)
      if (currentUser) {
        void Promise.resolve(
          supabase.rpc('mark_conversation_as_read', {
            conv_id: conversationId,
            user_uuid: currentUser.id
          })
        )
          .then(() => {
            setConversations(prev =>
              prev.map(conv =>
                conv.id === conversationId ? { ...conv, unread_count: 0 } : conv
              )
            );
          })
          .catch(console.error);
      }

      // Ensure auto-scroll is enabled
      shouldAutoScrollRef.current = true;
      isUserScrollingRef.current = false;
      setShouldAutoScroll(true);
      setIsUserScrolling(false);
    } catch (error) {
      toast.error('Failed to load messages');
      setIsLoadingMessages(false);
    }
    })();
    fetchMessagesInFlightRef.current.set(conversationId, run);
    try {
      await run;
    } finally {
      fetchMessagesInFlightRef.current.delete(conversationId);
    }
  }, [currentUser, enrichRawMessages]);

  const loadOlderMessages = useCallback(async () => {
    if (!selectedConversation || !currentUser || isLoadingOlderMessages || !hasMoreOlderMessages) return;
    const oldestId = messages[0]?.id;
    if (!oldestId) return;
    const now = Date.now();
    if (now - lastLoadOlderAtRef.current < 800) return;
    lastLoadOlderAtRef.current = now;

    setIsLoadingOlderMessages(true);
    let container: HTMLDivElement | null = null;
    if (mobileMessagesContainerRef.current?.offsetParent) container = mobileMessagesContainerRef.current;
    else if (desktopMessagesContainerRef.current?.offsetParent) container = desktopMessagesContainerRef.current;
    const prevScrollHeight = container?.scrollHeight ?? 0;

    try {
      const { data: olderDesc, error } = await supabase
        .from('messages')
        .select(RMQ_MESSAGE_LIST_SELECT)
        .eq('conversation_id', selectedConversation.id)
        .eq('is_deleted', false)
        .lt('id', oldestId)
        .order('sent_at', { ascending: false })
        .limit(MESSAGE_PAGE_SIZE);

      if (error) {
        toast.error('Failed to load older messages');
        return;
      }

      const ascRaw = (olderDesc || []).slice().reverse();
      if (ascRaw.length === 0) {
        setHasMoreOlderMessages(false);
        setPersistedMessages(prev => ({
          ...prev,
          [selectedConversation.id]: {
            ...prev[selectedConversation.id],
            messages: prev[selectedConversation.id]?.messages ?? messages,
            hasMoreOlder: false
          }
        }));
        return;
      }

      const enriched = await enrichRawMessages(ascRaw, selectedConversation.id);
      const hasMore = (olderDesc?.length || 0) === MESSAGE_PAGE_SIZE;
      setMessages(prev => [...enriched, ...prev]);
      setHasMoreOlderMessages(hasMore);
      setPersistedMessages(prev => {
        const cur = prev[selectedConversation.id];
        const merged = [...enriched, ...(cur?.messages ?? [])];
        return {
          ...prev,
          [selectedConversation.id]: {
            messages: merged,
            lastFetched: Date.now(),
            lastMessageId: merged[merged.length - 1]?.id ?? cur?.lastMessageId ?? null,
            oldestMessageId: merged[0]?.id ?? cur?.oldestMessageId ?? null,
            hasMoreOlder: hasMore
          } as RmqPersistedMessageBundle
        };
      });

      requestAnimationFrame(() => {
        const c = mobileMessagesContainerRef.current?.offsetParent ? mobileMessagesContainerRef.current : desktopMessagesContainerRef.current;
        if (c) {
          c.scrollTop += c.scrollHeight - prevScrollHeight;
        }
      });
    } finally {
      setIsLoadingOlderMessages(false);
    }
  }, [selectedConversation, currentUser, messages, isLoadingOlderMessages, hasMoreOlderMessages, enrichRawMessages, setPersistedMessages]);

  // Helper function to request online status for all users
  const requestOnlineStatusForUsers = useCallback(() => {
    if (allUsers.length > 0 && websocketService.isSocketConnected()) {
      const userIds = allUsers.map(u => String(u.id));
      websocketService.requestOnlineStatus(userIds);
    }
  }, [allUsers]);

  // Fetch all users for contacts
  const fetchAllUsers = useCallback(async () => {
    if (!currentUser) return;

    try {
      const { data: usersData, error } = await supabase
        .from('users')
        .select(`
          id,
          full_name,
          email,
          employee_id,
          is_active,
          tenants_employee!employee_id(
            display_name,
            bonuses_role,
            department_id,
            photo_url,
            tenant_departement!department_id(
              name
            )
          )
        `)
        .not('employee_id', 'is', null)
        .neq('id', currentUser.id);

      if (error) {
        toast.error('Failed to load contacts');
        return;
      }


      // Remove duplicates and filter out users without basic info
      const uniqueUsers = (usersData || []).filter((user, index, self) => {
        // Check if user has either full_name or display_name from employee
        const empData = user.tenants_employee ?
          (Array.isArray(user.tenants_employee) ? user.tenants_employee[0] : user.tenants_employee) :
          null;
        const hasName = user.full_name || empData?.display_name;
        const isActive = (user as any).is_active === true;

        // Include users with proper names, but exclude those explicitly marked as inactive
        const isValidName = hasName && hasName.length > 1; // Filter out single-letter names
        const isNotExplicitlyInactive = (user as any).is_active !== false; // Include if not explicitly false
        const shouldInclude = user.id && isValidName && isNotExplicitlyInactive && index === self.findIndex(u => u.id === user.id);

        return shouldInclude;
      });

      setAllUsers(uniqueUsers as unknown as User[]);

      // Request online status for all users if WebSocket is already connected
      if (websocketService.isSocketConnected() && uniqueUsers.length > 0) {
        const userIds = uniqueUsers.map(u => String(u.id));
        websocketService.requestOnlineStatus(userIds);
      } else {
      }
    } catch (error) {
      toast.error('Failed to load contacts');
    }
  }, [currentUser]);

  // File upload functionality
  const uploadFile = async (file: File): Promise<string | null> => {
    try {
      setIsUploadingFile(true);
      setUploadProgress(0);

      // Validate file type first
      const allowedTypes = [
        'image/jpeg', 'image/png', 'image/gif', 'image/webp',
        'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain', 'application/zip', 'application/x-rar-compressed',
        'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska'
      ];

      if (!allowedTypes.includes(file.type)) {
        toast.error('File type not supported. Please upload images, videos, documents, or text files.');
        return null;
      }

      // Validate file size - no restriction for videos, other files 15MB
      const isVideo = file.type.startsWith('video/');

      // Only check size for non-video files
      if (!isVideo) {
        const maxSize = 15 * 1024 * 1024; // 15MB for non-video files
        if (file.size > maxSize) {
          toast.error('File size must be less than 15MB');
          return null;
        }
      }

      // Generate unique filename
      const fileExt = file.name.split('.').pop();
      const fileName = `rmq_${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;

      // Upload to Supabase storage
      const { data, error } = await supabase.storage
        .from('RMQ-MESSAGES')
        .upload(fileName, file, {
          cacheControl: '3600',
          upsert: false,
          contentType: file.type
        });

      if (error) {
        console.error('Error uploading file:', error);

        // Check for 413 Payload too large error (type-safe check)
        const errorObj = error as any;
        const isPayloadTooLarge =
          errorObj.statusCode === '413' ||
          errorObj.statusCode === 413 ||
          errorObj.error === 'Payload too large' ||
          error.message?.includes('exceeded the maximum allowed size') ||
          error.message?.includes('Payload too large');

        // Provide more specific error messages
        if (isPayloadTooLarge) {
          toast.error(`File is too large for the storage bucket. ${isVideo ? 'Please check your Supabase bucket file size limit settings.' : 'Files must be less than 15MB.'}`);
        } else if (error.message?.includes('Bucket not found') || error.message?.includes('does not exist')) {
          toast.error('Storage bucket not found. Please check bucket configuration.');
        } else if (error.message?.includes('new row violates row-level security') || error.message?.includes('permission')) {
          toast.error('Permission denied. Please check bucket policies.');
        } else if (error.message?.includes('NetworkError') || error.message?.includes('Failed to fetch')) {
          toast.error('Network error. Please check your connection and try again.');
        } else if (error.message?.includes('File size') || error.message?.includes('too large')) {
          toast.error(`File is too large. ${isVideo ? 'Please check your Supabase bucket settings.' : 'Files must be less than 15MB.'}`);
        } else {
          toast.error(`Failed to upload file: ${error.message || errorObj.error || 'Unknown error'}`);
        }
        return null;
      }

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('RMQ-MESSAGES')
        .getPublicUrl(fileName);

      setUploadProgress(100);
      toast.success('File uploaded successfully');
      return publicUrl;

    } catch (error: any) {
      console.error('Unexpected error uploading file:', error);
      toast.error(`Failed to upload file: ${error?.message || 'Unknown error'}`);
      return null;
    } finally {
      setIsUploadingFile(false);
      setUploadProgress(0);
    }
  };

  // Upload chat background image
  const uploadChatBackgroundImage = async (file: File): Promise<string | null> => {
    if (!currentUser?.employee_id) {
      toast.error('Unable to upload: Employee ID not found');
      return null;
    }

    try {
      setIsUploadingBackground(true);

      // Generate unique filename
      const fileExt = file.name.split('.').pop();
      const fileName = `chat_bg_${currentUser.employee_id}_${Date.now()}.${fileExt}`;
      // Upload file to Supabase storage
      const { data, error } = await supabase.storage
        .from('My-Profile')
        .upload(fileName, file, {
          cacheControl: '3600',
          upsert: false,
          contentType: file.type
        });

      if (error) {
        toast.error('Failed to upload background image');
        return null;
      }
      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('My-Profile')
        .getPublicUrl(fileName);
      // Update database
      const { error: updateError } = await supabase
        .from('tenants_employee')
        .update({ chat_background_image_url: publicUrl })
        .eq('id', currentUser.employee_id);

      if (updateError) {
        toast.error('Failed to save background image URL');
        return null;
      }

      // Update local state
      setChatBackgroundImageUrl(publicUrl);
      toast.success('Background image uploaded successfully');

      return publicUrl;
    } catch (error) {
      toast.error('Failed to upload background image');
      return null;
    } finally {
      setIsUploadingBackground(false);
    }
  };

  // Handle background image input change
  const handleBackgroundImageInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast.error('Please upload an image file');
      return;
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      toast.error('Image size must be less than 10MB');
      return;
    }

    await uploadChatBackgroundImage(file);

    // Reset input
    if (backgroundImageInputRef.current) {
      backgroundImageInputRef.current.value = '';
    }
  };

  // Reset background to default (white)
  const resetBackgroundToDefault = async () => {
    if (!currentUser?.employee_id) {
      toast.error('Unable to reset: Employee ID not found');
      return;
    }

    try {
      setIsUploadingBackground(true);

      // Update database to set chat_background_image_url to null
      const { error: updateError } = await supabase
        .from('tenants_employee')
        .update({ chat_background_image_url: null })
        .eq('id', currentUser.employee_id);

      if (updateError) {
        toast.error('Failed to reset background');
        return;
      }

      // Update local state
      setChatBackgroundImageUrl(null);
      toast.success('Background reset to default');
    } catch (error) {
      toast.error('Failed to reset background');
    } finally {
      setIsUploadingBackground(false);
    }
  };

  const clearPendingMediaDraft = () => {
    setPendingMediaDraft(prev => {
      if (prev) prev.forEach(p => URL.revokeObjectURL(p.previewUrl));
      return null;
    });
  };

  const queueFilesForMediaPreview = (files: File[]) => {
    if (files.length === 0) return;
    setPendingMediaDraft(prev => {
      if (prev) prev.forEach(p => URL.revokeObjectURL(p.previewUrl));
      return files.map(file => ({
        file,
        previewUrl: URL.createObjectURL(file),
      }));
    });
  };

  const removePendingMediaItem = (index: number) => {
    setPendingMediaDraft(prev => {
      if (!prev) return null;
      const next = [...prev];
      const [removed] = next.splice(index, 1);
      URL.revokeObjectURL(removed.previewUrl);
      if (next.length === 0) return null;
      return next;
    });
  };

  const cancelPendingMediaDraft = () => {
    clearPendingMediaDraft();
    setNewMessage('');
  };

  // Handle file input change — queue preview (WhatsApp-style); upload happens on Send
  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    queueFilesForMediaPreview(files);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Handle paste event for images and videos — queue preview instead of immediate send
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!selectedConversation || !currentUser) return;

    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      if (item.type.indexOf('image') !== -1) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          const imageFile = file.name ? file : new File([file], `pasted-image-${Date.now()}.png`, { type: file.type });
          queueFilesForMediaPreview([imageFile]);
        }
        return;
      }

      if (item.type.indexOf('video') !== -1) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          const videoFile = file.name ? file : new File([file], `pasted-video-${Date.now()}.mp4`, { type: file.type });
          queueFilesForMediaPreview([videoFile]);
        }
        return;
      }
    }
  };

  // Handle drag and drop for images and videos
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();

    // Only show drag indicator if we have a selected conversation
    if (selectedConversation && currentUser) {
      setIsDragOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();

    // Only hide drag indicator if we're actually leaving the main container
    // Check if we're actually leaving (not just entering a child element)
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;

    // Check if mouse is outside the container bounds
    if (x <= rect.left || x >= rect.right || y <= rect.top || y >= rect.bottom) {
      setIsDragOver(false);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    if (!selectedConversation || !currentUser) return;

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    const mediaFiles = files.filter(file =>
      file.type.startsWith('image/') || file.type.startsWith('video/')
    );

    if (mediaFiles.length === 0) {
      toast.error('Please drop only images or videos');
      return;
    }

    queueFilesForMediaPreview(mediaFiles);
  };

  // Forward message to another conversation
  const forwardMessage = async (targetConversationId: number) => {
    if (!messageToForward || !currentUser) return;

    setIsSending(true);
    try {
      // Prepare message content - include original sender info if forwarding
      const originalSender = messageToForward.sender?.tenants_employee?.display_name ||
        messageToForward.sender?.full_name ||
        'Unknown';
      const forwardContent = messageToForward.content
        ? `Forwarded from ${originalSender}: ${messageToForward.content}`
        : `Forwarded from ${originalSender}`;

      // Determine message type
      let messageType: 'text' | 'file' | 'image' | 'system' | 'album' = 'text';
      if (messageToForward.message_type === 'album' && messageToForward.media_attachments?.length) {
        messageType = 'album';
      } else if (messageToForward.message_type === 'image' || (messageToForward.attachment_type && messageToForward.attachment_type.startsWith('image/'))) {
        messageType = 'image';
      } else if (messageToForward.message_type === 'file' || (messageToForward.attachment_url && messageToForward.message_type !== 'voice')) {
        messageType = 'file';
      } else if (messageToForward.message_type === 'text') {
        messageType = 'text';
      } else if (messageToForward.message_type === 'voice') {
        messageType = 'text'; // Voice messages can't be forwarded as voice, convert to text
      }

      // Send via WebSocket for real-time delivery
      if (websocketService.isSocketConnected()) {
        // Only send attachment if it's not a voice message
        if (messageToForward.message_type === 'voice') {
          websocketService.sendMessage(targetConversationId, forwardContent, 'text');
        } else if (messageType === 'album' && messageToForward.media_attachments?.length) {
          websocketService.sendMessage(
            targetConversationId,
            forwardContent,
            'album',
            messageToForward.attachment_url || undefined,
            messageToForward.attachment_type || undefined,
            messageToForward.attachment_size || undefined,
            undefined,
            messageToForward.media_attachments,
          );
        } else {
          websocketService.sendMessage(
            targetConversationId,
            forwardContent,
            messageType,
            messageToForward.attachment_url || undefined,
            messageToForward.attachment_type || undefined,
            messageToForward.attachment_size || undefined,
            undefined,
            undefined,
            messageToForward.attachment_name || undefined
          );
        }
      }

      // Save to database
      const { data: messageData, error } = await supabase
        .from('messages')
        .insert({
          conversation_id: targetConversationId,
          sender_id: currentUser.id,
          content: forwardContent,
          message_type: messageType,
          attachment_url: messageToForward.attachment_url || null,
          attachment_name: messageToForward.attachment_name || null,
          attachment_type: messageToForward.attachment_type || null,
          attachment_size: messageToForward.attachment_size || null,
          media_attachments:
            messageType === 'album' && messageToForward.media_attachments?.length
              ? (messageToForward.media_attachments as unknown as Record<string, unknown>)
              : null,
        })
        .select(`
          id,
          conversation_id,
          sender_id,
          content,
          message_type,
          sent_at,
          attachment_url,
          attachment_name,
          attachment_type,
          attachment_size,
          sender:users!sender_id(
            id,
            full_name,
            email,
            employee_id,
            is_active,
            tenants_employee!users_employee_id_fkey(
              display_name,
              bonuses_role,
              photo_url
            )
          )
        `)
        .single();

      if (error) throw error;

      // If WebSocket is not connected, trigger push notifications
      if (!websocketService.isSocketConnected()) {
        try {
          await fetch(`${BACKEND_URL}/api/push/rmq/send`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              conversationId: targetConversationId,
              senderId: currentUser.id,
              content: forwardContent,
              messageType: messageType,
              attachmentName: messageToForward.attachment_name,
            }),
          });
        } catch (pushError) {
          // Don't throw - this is a background operation
        }
      }

      // Update the target conversation's last_message_at if we're viewing it
      if (selectedConversation?.id === targetConversationId) {
        // Refresh messages for the target conversation
        await fetchMessages(targetConversationId);
      }

      toast.success('Message forwarded successfully');
      setShowForwardModal(false);
      setMessageToForward(null);
    } catch (error: any) {
      console.error('Error forwarding message:', error);
      toast.error(`Failed to forward message: ${error?.message || 'Unknown error'}`);
    } finally {
      setIsSending(false);
    }
  };

  // Send message with attachment (optional caption = message body text; optional reply)
  const sendMessageWithAttachment = async (
    file: File,
    fileUrl: string,
    caption?: string,
    options?: { skipLoadingState?: boolean; replyToMessageId?: number | null }
  ) => {
    if (!selectedConversation || !currentUser) return;

    const skipLoading = options?.skipLoadingState ?? false;
    const replyToId = options?.replyToMessageId;
    const contentText = caption?.trim() ? caption.trim() : file.name;

    if (!skipLoading) setIsSending(true);
    try {
      let messageType: 'text' | 'file' | 'image' | 'system' = 'file';
      if (file.type.startsWith('image/')) {
        messageType = 'image';
      }

      if (websocketService.isSocketConnected()) {
        websocketService.sendMessage(
          selectedConversation.id,
          contentText,
          messageType,
          fileUrl,
          file.type,
          file.size,
          replyToId ?? undefined,
          undefined,
          file.name
        );
      }

      const { data: messageData, error } = await supabase
        .from('messages')
        .insert({
          conversation_id: selectedConversation.id,
          sender_id: currentUser.id,
          content: contentText,
          message_type: messageType,
          attachment_url: fileUrl,
          attachment_name: file.name,
          attachment_type: file.type,
          attachment_size: file.size,
          reply_to_message_id: replyToId ?? null,
        })
        .select(`
          id,
          conversation_id,
          sender_id,
          content,
          message_type,
          sent_at,
          attachment_url,
          attachment_name,
          attachment_type,
          attachment_size,
          sender:users!sender_id(
            id,
            full_name,
            email,
            employee_id,
            is_active,
            tenants_employee!users_employee_id_fkey(
              display_name,
              bonuses_role,
              photo_url
            )
          )
        `)
        .single();

      if (error) throw error;

      // If WebSocket is not connected, trigger push notifications via backend API
      if (!websocketService.isSocketConnected()) {
        try {
          await fetch(`${BACKEND_URL}/api/push/rmq/send`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              conversationId: selectedConversation.id,
              senderId: currentUser.id,
              content: contentText,
              messageType: messageType,
              attachmentName: file.name,
            }),
          });
        } catch (pushError) {
          // Don't throw - this is a background operation
        }
      }

      // Only add message optimistically if WebSocket is NOT connected
      // If WebSocket IS connected, let the WebSocket handler add it to avoid duplicates
      if (!websocketService.isSocketConnected()) {
        const enhancedMessage: Message = {
          ...messageData as unknown as Message,
          read_receipts: [],
          delivery_status: 'sent',
          is_deleted: false,
          reactions: [],
          edited_at: undefined,
          reply_to_message_id: undefined,
          reply_to_message: undefined,
          voice_duration: undefined,
          voice_waveform: undefined,
          is_voice_message: false,
        };

        setMessages(prev => {
          // Check if message already exists (shouldn't happen, but safety check)
          const exists = prev.some(m => m.id === enhancedMessage.id);
          if (exists) {
            // Update existing message
            const updated = prev.map(msg => msg.id === enhancedMessage.id ? enhancedMessage : msg);
            // Sort by sent_at to ensure correct chronological order
            return updated.sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime());
          }
          // Add new message and sort by sent_at to ensure correct chronological order
          const updated = [...prev, enhancedMessage];
          return updated.sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime());
        });
      }

      if (!isLoadingMessages && !isPreloadingImages) {
        bumpScrollAfterOutgoingSend();
      }

      // Update conversation list immediately
      setConversations(prev =>
        prev.map(conv =>
          conv.id === selectedConversation.id
            ? {
              ...conv,
              last_message_at: messageData.sent_at,
              last_message_preview:
                contentText.length > 48 ? `${contentText.slice(0, 45)}…` : contentText
            }
            : conv
        ).sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime())
      );

    } catch (error) {
      toast.error('Failed to send attachment');
    } finally {
      if (!skipLoading) setIsSending(false);
    }
  };

  /** Multiple images/videos in one message (grid layout). Requires DB column media_attachments — see sql/rmq_messages_media_attachments.sql */
  const sendMediaAlbum = async (
    files: File[],
    urls: string[],
    caption?: string,
    options?: { skipLoadingState?: boolean; replyToMessageId?: number | null }
  ) => {
    if (!selectedConversation || !currentUser || files.length === 0) return;
    if (files.length !== urls.length) return;
    const skipLoading = options?.skipLoadingState ?? false;
    const replyToId = options?.replyToMessageId;

    if (files.length === 1) {
      await sendMessageWithAttachment(files[0], urls[0], caption, { skipLoadingState: skipLoading, replyToMessageId: replyToId });
      return;
    }

    const media_attachments: RmqMediaAttachmentItem[] = files.map((f, i) => ({
      url: urls[i]!,
      name: f.name,
      type: f.type,
      size: f.size,
    }));
    const first = files[0]!;
    const contentLabel = caption?.trim()
      ? caption.trim()
      : files.map(f => f.name).join(', ');

    if (!skipLoading) setIsSending(true);
    try {
      if (websocketService.isSocketConnected()) {
        websocketService.sendMessage(
          selectedConversation.id,
          contentLabel,
          'album',
          urls[0],
          first.type,
          first.size,
          replyToId ?? undefined,
          media_attachments,
        );
      }

      const { data: messageData, error } = await supabase
        .from('messages')
        .insert({
          conversation_id: selectedConversation.id,
          sender_id: currentUser.id,
          content: contentLabel,
          message_type: 'album',
          attachment_url: urls[0],
          attachment_name: first.name,
          attachment_type: first.type,
          attachment_size: first.size,
          media_attachments: media_attachments as unknown as Record<string, unknown>,
          reply_to_message_id: replyToId ?? null,
        })
        .select(RMQ_MESSAGE_LIST_SELECT)
        .single();

      if (error) throw error;

      if (!websocketService.isSocketConnected()) {
        try {
          await fetch(`${BACKEND_URL}/api/push/rmq/send`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              conversationId: selectedConversation.id,
              senderId: currentUser.id,
              content: contentLabel,
              messageType: 'album',
              attachmentName: first.name,
            }),
          });
        } catch (pushError) {
          // Don't throw
        }
      }

      const enhancedAlbumMessage: Message = {
        ...messageData as unknown as Message,
        read_receipts: [],
        delivery_status: 'sent',
        is_deleted: false,
        reactions: Array.isArray((messageData as { reactions?: unknown }).reactions)
          ? ((messageData as { reactions: MessageReaction[] }).reactions)
          : [],
        edited_at: undefined,
        reply_to_message_id: undefined,
        reply_to_message: undefined,
        voice_duration: undefined,
        voice_waveform: undefined,
        is_voice_message: false,
      };

      setMessages(prev => {
        const byId = prev.findIndex(m => m.id === enhancedAlbumMessage.id);
        if (byId >= 0) {
          const next = [...prev];
          next[byId] = { ...next[byId], ...enhancedAlbumMessage };
          return next.sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime());
        }
        const ghostIdx = prev.findIndex(
          m =>
            m.sender_id === currentUser.id &&
            m.conversation_id === selectedConversation.id &&
            m.content === contentLabel &&
            Math.abs(new Date(m.sent_at).getTime() - new Date(enhancedAlbumMessage.sent_at).getTime()) < 20000
        );
        if (ghostIdx >= 0) {
          const next = [...prev];
          next[ghostIdx] = enhancedAlbumMessage;
          return next.sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime());
        }
        return [...prev, enhancedAlbumMessage].sort(
          (a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime()
        );
      });

      if (!isLoadingMessages && !isPreloadingImages) {
        bumpScrollAfterOutgoingSend();
      }

      setConversations(prev =>
        prev.map(conv =>
          conv.id === selectedConversation.id
            ? {
              ...conv,
              last_message_at: messageData.sent_at,
              last_message_preview: `🖼️ ${files.length} media`,
            }
            : conv
        ).sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime())
      );
    } catch (error) {
      console.error(error);
      toast.error('Failed to send media album. If this persists, apply sql/rmq_messages_media_attachments.sql to your database.');
    } finally {
      if (!skipLoading) setIsSending(false);
    }
  };

  /** Upload queued files and send with caption from composer (`newMessage`) */
  const submitPendingMediaSend = async () => {
    if (!selectedConversation || !currentUser || !pendingMediaDraft?.length) return;

    const items = [...pendingMediaDraft];
    const caption = newMessage.trim();
    const replyToId = messageToReply?.id ?? null;

    const mediaItems = items.filter(
      i => i.file.type.startsWith('image/') || i.file.type.startsWith('video/')
    );
    const docItems = items.filter(
      i => !i.file.type.startsWith('image/') && !i.file.type.startsWith('video/')
    );

    if (mediaItems.length > 0 && docItems.length > 0) {
      toast.error('Send photos/videos and documents separately.');
      return;
    }

    setIsSending(true);
    try {
      let remainingCaption = caption;

      const takeCaption = () => {
        const c = remainingCaption;
        remainingCaption = '';
        return c;
      };

      if (mediaItems.length > 0) {
        const urls = await Promise.all(mediaItems.map(i => uploadFile(i.file)));
        if (urls.some(u => !u)) {
          toast.error('Failed to upload some files');
          return;
        }
        if (mediaItems.length === 1) {
          await sendMessageWithAttachment(mediaItems[0].file, urls[0]!, takeCaption(), {
            skipLoadingState: true,
            replyToMessageId: replyToId,
          });
        } else {
          await sendMediaAlbum(
            mediaItems.map(i => i.file),
            urls as string[],
            takeCaption(),
            { skipLoadingState: true, replyToMessageId: replyToId },
          );
        }
      } else {
        for (let i = 0; i < docItems.length; i++) {
          const url = await uploadFile(docItems[i].file);
          if (!url) {
            toast.error('Failed to upload file');
            return;
          }
          await sendMessageWithAttachment(docItems[i].file, url, i === 0 ? takeCaption() : '', {
            skipLoadingState: true,
            replyToMessageId: i === 0 ? replyToId : null,
          });
        }
      }

      clearPendingMediaDraft();
      setNewMessage('');
      setMessageToReply(null);
      if (!isLoadingMessages && !isPreloadingImages) {
        bumpScrollAfterOutgoingSend();
      }
    } catch (e) {
      console.error(e);
      toast.error('Failed to send');
    } finally {
      setIsSending(false);
    }
  };

  // Send message
  const handleMessageKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Check if mobile (window width < 1024px for lg breakpoint)
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 1024;

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      // On mobile, only allow new line, don't send message
      if (isMobile) {
        return;
      }
      // On desktop: pending media sends on Enter (caption optional); else send text
      if (!isSending) {
        if (pendingMediaDraft && pendingMediaDraft.length > 0) {
          void submitPendingMediaSend();
        } else if (newMessage.trim()) {
          sendMessage();
        }
      }
    }
    // Shift+Enter will allow default behavior (new line)
  };

  // Delete message function
  const handleDeleteMessage = async (messageId: number) => {
    if (!currentUser || !selectedConversation) return;

    try {
      // Update message in database to mark as deleted
      const { error } = await supabase
        .from('messages')
        .update({ is_deleted: true })
        .eq('id', messageId);

      if (error) throw error;

      // Update local state
      setMessages(prev => prev.map(msg =>
        msg.id === messageId ? { ...msg, is_deleted: true, content: 'This message was deleted' } : msg
      ));

      toast.success('Message deleted');
    } catch (error) {
      console.error('Error deleting message:', error);
      toast.error('Failed to delete message');
    }
  };

  // Edit message function
  const handleEditMessage = async () => {
    if (!messageToEdit || !editingMessageText.trim() || !currentUser) return;

    try {
      // Update message in database
      const { error } = await supabase
        .from('messages')
        .update({
          content: editingMessageText.trim(),
          edited_at: new Date().toISOString()
        })
        .eq('id', messageToEdit.id);

      if (error) throw error;

      // Update local state
      setMessages(prev => {
        const updated = prev.map(msg =>
          msg.id === messageToEdit.id
            ? { ...msg, content: editingMessageText.trim(), edited_at: new Date().toISOString() }
            : msg
        );

        // Update persisted cache
        if (selectedConversation) {
          setPersistedMessages(prevCache => ({
            ...prevCache,
            [selectedConversation.id]: {
              messages: updated,
              lastFetched: prevCache[selectedConversation.id]?.lastFetched || Date.now(),
              lastMessageId: prevCache[selectedConversation.id]?.lastMessageId || null
            }
          }));
        }

        return updated;
      });

      setMessageToEdit(null);
      setEditingMessageText('');
      toast.success('Message edited');
    } catch (error) {
      console.error('Error editing message:', error);
      toast.error('Failed to edit message');
    }
  };

  const sendMessage = async () => {
    // If editing, handle edit instead
    if (messageToEdit) {
      await handleEditMessage();
      return;
    }

    if (pendingMediaDraft && pendingMediaDraft.length > 0) {
      await submitPendingMediaSend();
      return;
    }

    if (!selectedConversation || !currentUser || !newMessage.trim()) return;

    // Debug: Log reply information
    console.log('🔍 [Reply Debug] Sending message with reply:', {
      hasReply: !!messageToReply,
      replyMessageId: messageToReply?.id,
      replyMessageContent: messageToReply?.content,
      replyMessageSender: messageToReply?.sender?.tenants_employee?.display_name || messageToReply?.sender?.full_name
    });

    // Stop typing indicator
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
    if (selectedConversation && currentUser && websocketService.isSocketConnected()) {
      const userName = currentUser.full_name || currentUser.email || 'User';
      websocketService.sendTyping(
        selectedConversation.id,
        currentUser.id,
        userName,
        false
      );
    }

    setIsSending(true);
    try {
      // Send via WebSocket for real-time delivery
      if (websocketService.isSocketConnected()) {
        console.log('🔍 [Reply Debug] Sending via WebSocket with reply_to_message_id:', messageToReply?.id);

        // Add optimistic update for ALL messages when WebSocket is connected so user sees their message immediately
        const optimisticMessage: Message = {
          id: Date.now(), // Temporary ID until real one arrives
          conversation_id: selectedConversation.id,
          sender_id: currentUser.id,
          sender: currentUser,
          content: newMessage.trim(),
          message_type: 'text',
          sent_at: new Date().toISOString(),
          edited_at: undefined,
          is_deleted: false,
          delivery_status: 'sending',
          read_receipts: [],
          reactions: [],
          reply_to_message_id: messageToReply?.id,
          reply_to_message: messageToReply || undefined, // Use the message being replied to directly
          attachment_url: undefined,
          attachment_name: undefined,
          attachment_type: undefined,
          attachment_size: undefined,
          voice_duration: undefined,
          voice_waveform: undefined,
          is_voice_message: false,
        };

        console.log('🔍 [Reply Debug] Adding optimistic message (WebSocket connected):', {
          messageId: optimisticMessage.id,
          replyToMessageId: optimisticMessage.reply_to_message_id,
          hasReplyToMessage: !!optimisticMessage.reply_to_message,
          replyContent: optimisticMessage.reply_to_message?.content?.substring(0, 50)
        });

        setMessages(prev => {
          const updated = [...prev, optimisticMessage];
          return updated.sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime());
        });

        websocketService.sendMessage(
          selectedConversation.id,
          newMessage.trim(),
          'text',
          undefined,
          undefined,
          undefined,
          messageToReply?.id
        );
      } else {
      }

      // Also save to database
      const replyToMessageId = messageToReply?.id || null;
      console.log('🔍 [Reply Debug] Inserting message to database with reply_to_message_id:', replyToMessageId);

      const { data: messageData, error } = await supabase
        .from('messages')
        .insert({
          conversation_id: selectedConversation.id,
          sender_id: currentUser.id,
          content: newMessage.trim(),
          message_type: 'text',
          reply_to_message_id: replyToMessageId
        })
        .select(`
          id,
          conversation_id,
          sender_id,
          content,
          message_type,
          sent_at,
          reply_to_message_id,
          sender:users!sender_id(
            id,
            full_name,
            email,
            employee_id,
            is_active,
            tenants_employee!users_employee_id_fkey(
              display_name,
              bonuses_role,
              photo_url
            )
          )
        `)
        .single();

      if (error) {
        console.error('🔍 [Reply Debug] Error inserting message:', error);
        throw error;
      }

      console.log('🔍 [Reply Debug] Message inserted successfully:', {
        messageId: messageData?.id,
        replyToMessageId: (messageData as any)?.reply_to_message_id,
        hasReplyToMessage: !!(messageData as any)?.reply_to_message,
        replyToMessageData: (messageData as any)?.reply_to_message
      });

      // If WebSocket IS connected, update the optimistic message with the real database ID
      if (websocketService.isSocketConnected()) {
        // Fetch reply message if this is a reply
        let processedReplyMessage: any = undefined;
        if ((messageData as any)?.reply_to_message_id) {
          const { data: replyData } = await supabase
            .from('messages')
            .select(`
              id,
              content,
              message_type,
              attachment_url,
              attachment_name,
              attachment_type,
              sender:users!sender_id(
                id,
                full_name,
                is_active,
                tenants_employee!users_employee_id_fkey(display_name)
              )
            `)
            .eq('id', (messageData as any)?.reply_to_message_id)
            .single();
          if (replyData) {
            processedReplyMessage = replyData;
          }
        }

        // Update the optimistic message with the real database message
        setMessages(prev => {
          // Find optimistic message by temporary ID or by content match
          const optimisticIndex = prev.findIndex(m =>
            (m.id && m.id > 1000000000000) || // Temporary ID (timestamp)
            (m.conversation_id === selectedConversation.id &&
              m.sender_id === currentUser.id &&
              m.content === newMessage.trim() &&
              m.delivery_status === 'sending')
          );

          if (optimisticIndex !== -1) {
            // Replace optimistic message with real message from database
            const enhancedMessage: Message = {
              ...messageData as unknown as Message,
              read_receipts: [],
              delivery_status: 'sent',
              is_deleted: false,
              reactions: [],
              edited_at: undefined,
              reply_to_message_id: (messageData as any).reply_to_message_id || undefined,
              reply_to_message: processedReplyMessage || undefined,
              attachment_url: undefined,
              attachment_name: undefined,
              attachment_type: undefined,
              attachment_size: undefined,
              voice_duration: undefined,
              voice_waveform: undefined,
              is_voice_message: false,
            };

            const updated = [...prev];
            updated[optimisticIndex] = enhancedMessage;
            return updated.sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime());
          }
          // If optimistic message not found, add the real message
          const enhancedMessage: Message = {
            ...messageData as unknown as Message,
            read_receipts: [],
            delivery_status: 'sent',
            is_deleted: false,
            reactions: [],
            edited_at: undefined,
            reply_to_message_id: (messageData as any).reply_to_message_id || undefined,
            reply_to_message: processedReplyMessage || undefined,
            attachment_url: undefined,
            attachment_name: undefined,
            attachment_type: undefined,
            attachment_size: undefined,
            voice_duration: undefined,
            voice_waveform: undefined,
            is_voice_message: false,
          };
          const updated = [...prev, enhancedMessage];
          return updated.sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime());
        });
      }

      // If WebSocket is not connected, trigger push notifications via backend API
      if (!websocketService.isSocketConnected()) {
        try {
          await fetch(`${BACKEND_URL}/api/push/rmq/send`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              conversationId: selectedConversation.id,
              senderId: currentUser.id,
              content: newMessage.trim(),
              messageType: 'text',
            }),
          });
        } catch (pushError) {
          // Don't throw - this is a background operation
        }
      }

      // Only add message optimistically if WebSocket is NOT connected
      // If WebSocket IS connected, let the WebSocket handler add it to avoid duplicates
      if (!websocketService.isSocketConnected()) {
        // Fetch reply message if this is a reply (since we removed it from the insert query)
        let processedReplyMessage: any = undefined;
        if ((messageData as any)?.reply_to_message_id) {
          console.log('🔍 [Reply Debug] Fetching reply message for optimistic update:', (messageData as any)?.reply_to_message_id);
          const { data: replyData } = await supabase
            .from('messages')
            .select(`
              id,
              content,
              message_type,
              attachment_url,
              attachment_name,
              attachment_type,
              sender:users!sender_id(
                id,
                full_name,
                is_active,
                tenants_employee!users_employee_id_fkey(display_name)
              )
            `)
            .eq('id', (messageData as any)?.reply_to_message_id)
            .single();

          if (replyData) {
            processedReplyMessage = replyData;
            console.log('🔍 [Reply Debug] ✅ Fetched reply for optimistic update:', {
              replyId: processedReplyMessage.id,
              replyContent: processedReplyMessage.content?.substring(0, 50)
            });
          }
        }

        console.log('🔍 [Reply Debug] Adding message optimistically (WebSocket not connected):', {
          messageId: (messageData as any)?.id,
          replyToMessageId: (messageData as any)?.reply_to_message_id,
          hasReplyMessage: !!processedReplyMessage
        });

        const enhancedMessage: Message = {
          ...messageData as unknown as Message,
          read_receipts: [],
          delivery_status: 'sent',
          is_deleted: false,
          reactions: [],
          edited_at: undefined,
          // Preserve reply data (fetched separately)
          reply_to_message_id: (messageData as any).reply_to_message_id || undefined,
          reply_to_message: processedReplyMessage || undefined,
          attachment_url: undefined,
          attachment_name: undefined,
          attachment_type: undefined,
          attachment_size: undefined,
          voice_duration: undefined,
          voice_waveform: undefined,
          is_voice_message: false,
        };

        console.log('🔍 [Reply Debug] Enhanced message with reply data:', {
          messageId: enhancedMessage.id,
          replyToMessageId: enhancedMessage.reply_to_message_id,
          hasReplyToMessage: !!enhancedMessage.reply_to_message,
          replyToMessageContent: enhancedMessage.reply_to_message?.content
        });

        setMessages(prev => {
          // Check if message already exists (shouldn't happen, but safety check)
          const exists = prev.some(m => m.id === enhancedMessage.id);
          if (exists) {
            // Update existing message
            const updated = prev.map(msg => msg.id === enhancedMessage.id ? enhancedMessage : msg);
            // Sort by sent_at to ensure correct chronological order
            return updated.sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime());
          }
          // Add new message and sort by sent_at to ensure correct chronological order
          const updated = [...prev, enhancedMessage];
          return updated.sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime());
        });
      }

      setNewMessage('');
      console.log('🔍 [Reply Debug] Clearing reply state after sending');
      setMessageToReply(null); // Clear reply after sending
      resetInputHeights();

      if (!isLoadingMessages && !isPreloadingImages) {
        bumpScrollAfterOutgoingSend();
      }

      // Update conversation list immediately for optimistic UI update
      // The WebSocket handler will also update it when the message comes back, but this ensures immediate feedback
      setConversations(prev =>
        prev.map(conv =>
          conv.id === selectedConversation.id
            ? {
              ...conv,
              last_message_at: messageData.sent_at,
              last_message_preview: messageData.content.substring(0, 100)
            }
            : conv
        ).sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime())
      );

      // Refresh read receipts for the new message after a short delay
      if (messageData.id) {
        setTimeout(async () => {
          const { data: receipts } = await supabase
            .from('message_read_receipts')
            .select('user_id, read_at')
            .eq('message_id', messageData.id);

          setMessages(prev => prev.map(msg =>
            msg.id === messageData.id
              ? { ...msg, read_receipts: receipts || [] }
              : msg
          ));
        }, 500);
      }

    } catch (error) {
      toast.error('Failed to send message');
    } finally {
      setIsSending(false);
    }
  };

  // Start direct conversation with a user
  const startDirectConversation = async (userId: string) => {
    if (!currentUser) return;

    try {
      // First check if a direct conversation already exists
      const existingConv = conversations.find(c =>
        c.type === 'direct' &&
        c.participants?.length === 2 &&
        c.participants.some(p => p.user_id === userId) &&
        c.participants.some(p => p.user_id === currentUser.id)
      );

      if (existingConv) {
        setMessages([]);
        setIsLoadingMessages(true);
        selectConversation(existingConv);
        fetchMessages(existingConv.id, false);
        setShowMobileConversations(false);
        setActiveTab('chats');
        return;
      }

      // Create new direct conversation
      const { data: conversationId, error } = await supabase.rpc(
        'create_direct_conversation',
        {
          user1_uuid: currentUser.id,
          user2_uuid: userId
        }
      );

      if (error) {
        throw error;
      }

      // Wait a bit for the database to be consistent, then refresh conversations
      setTimeout(async () => {
        // Fetch conversations and get the updated list
        const updatedConversations = await getUpdatedConversations();

        // Find the newly created conversation in the updated list
        const newConv = updatedConversations.find(c => c.id === conversationId);

        if (newConv) {
          setMessages([]);
          setIsLoadingMessages(true);
          selectConversation(newConv);
          fetchMessages(newConv.id, false);
          setShowMobileConversations(false);
          setActiveTab('chats');
          toast.success('Direct conversation started');
        } else {
          // Try one more time after a longer delay
          setTimeout(async () => {
            const retryConversations = await getUpdatedConversations();
            const retryConv = retryConversations.find(c => c.id === conversationId);
            if (retryConv) {
              setMessages([]);
              setIsLoadingMessages(true);
              selectConversation(retryConv);
              fetchMessages(retryConv.id, false);
              setShowMobileConversations(false);
              setActiveTab('chats');
              toast.success('Direct conversation started');
            } else {
              toast.error('Failed to find the created conversation');
            }
          }, 1000);
        }
      }, 500);

    } catch (error) {
      toast.error('Failed to start conversation');
    }
  };

  // Delete a single group chat (superuser only)
  const deleteGroupChat = async () => {
    if (!selectedConversation || !isSuperUser) {
      toast.error('Only superusers can delete group chats');
      return;
    }

    if (selectedConversation.type !== 'group') {
      toast.error('Can only delete group chats');
      return;
    }

    // Additional check for locked groups - only superusers can delete them
    if (isGroupLocked(selectedConversation) && !isSuperUser) {
      toast.error('This group is locked. Only superusers can delete locked groups.');
      return;
    }

    try {
      // Delete conversation (cascade will handle participants and messages)
      const { error } = await supabase
        .from('conversations')
        .delete()
        .eq('id', selectedConversation.id);

      if (error) {
        toast.error('Failed to delete group chat');
        return;
      }

      toast.success('Group chat deleted successfully');

      // Close the modal and refresh conversations
      setShowDeleteGroupModal(false);
      selectConversation(null);
      await fetchConversations();

    } catch (error) {
      toast.error('Failed to delete group chat');
    }
  };

  // Delete all group chats (for cleanup)
  const deleteAllGroupChats = async () => {
    if (!currentUser) return;

    try {
      // Get all conversations that are not working properly (showing as group chats with 1 member)
      const conversationsToDelete = conversations.filter(conv =>
        (conv.type === 'group' && (conv.participants?.length || 0) <= 2) ||
        (conv.type === 'direct' && (conv.participants?.length || 0) !== 2)
      );
      for (const conv of conversationsToDelete) {
        // Delete conversation (cascade will handle participants and messages)
        const { error } = await supabase
          .from('conversations')
          .delete()
          .eq('id', conv.id);

        if (error) {
        } else {
        }
      }

      // Refresh conversations list
      await fetchConversations();
      selectConversation(null);

      toast.success(`Deleted ${conversationsToDelete.length} problematic conversations`);

    } catch (error) {
      toast.error('Failed to delete conversations');
    }
  };

  // Create group conversation
  const createGroupConversation = async () => {
    if (!currentUser || selectedUsers.length < 1 || !newGroupTitle.trim()) {
      toast.error('Please select users and enter a group title');
      return;
    }

    try {
      // Create group conversation
      const { data: conversationData, error: convError } = await supabase
        .from('conversations')
        .insert({
          title: newGroupTitle.trim(),
          type: 'group',
          created_by: currentUser.id,
          description: newGroupDescription.trim() || null
        })
        .select()
        .single();

      if (convError) throw convError;

      // Add participants (including creator)
      const participantsToAdd = [
        { conversation_id: conversationData.id, user_id: currentUser.id, role: 'admin' },
        ...selectedUsers.map(userId => ({
          conversation_id: conversationData.id,
          user_id: userId,
          role: 'member' as const
        }))
      ];

      const { error: participantsError } = await supabase
        .from('conversation_participants')
        .insert(participantsToAdd);

      if (participantsError) throw participantsError;

      // Refresh conversations and wait for the state to update
      await fetchConversations();

      // Wait a moment for the conversations state to update, then find the new conversation
      setTimeout(async () => {
        await fetchConversations(); // Fetch again to get the updated state
        const updatedConversations = await getUpdatedConversations();
        const newConversation = updatedConversations.find(c => c.id === conversationData.id);

        if (newConversation && newConversation.participants) {
          selectConversation(newConversation);
          fetchMessages(newConversation.id, false);
        } else {
          // Fallback: create a temporary conversation object with participants
          const tempConversation = {
            ...conversationData,
            participants: [
              { user_id: currentUser.id, user: currentUser },
              ...selectedUsers.map(userId => ({ user_id: userId }))
            ]
          };
          selectConversation(tempConversation);
          fetchMessages(conversationData.id, false);
        }

        setShowMobileConversations(false);
        setActiveTab('chats');
      }, 100);

      // Reset form
      setShowCreateGroupModal(false);
      setSelectedUsers([]);
      setNewGroupTitle('');
      setNewGroupDescription('');

      toast.success('Group chat created successfully!');

    } catch (error) {
      toast.error('Failed to create group conversation');
    }
  };

  // Add members to group conversation
  const addMembersToGroup = async (conversationId: number, userIds: string[]) => {
    if (!currentUser || userIds.length === 0) return;

    // Check if group is locked and user is not superuser
    const conversation = conversations.find(c => c.id === conversationId);
    if (isGroupLocked(conversation || null) && !isSuperUser) {
      toast.error('This group is locked. Only superusers can add members to locked groups.');
      return;
    }

    try {
      const participantsToAdd = userIds.map(userId => ({
        conversation_id: conversationId,
        user_id: userId,
        role: 'member' as const
      }));

      const { error } = await supabase
        .from('conversation_participants')
        .insert(participantsToAdd);

      if (error) throw error;

      // Refresh conversations to get updated participant list
      await fetchConversations();

      // Update selected conversation
      const updatedConversations = await getUpdatedConversations();
      const updatedConversation = updatedConversations.find(c => c.id === conversationId);
      if (updatedConversation) {
        selectConversation(updatedConversation);
      }

      setShowAddMemberModal(false);
      setMembersToAdd([]);
      setMemberSearchQuery('');
      toast.success(`Added ${userIds.length} member(s) to the group`);
    } catch (error: any) {
      if (error.code === '23505') {
        toast.error('One or more users are already in the group');
      } else {
        toast.error('Failed to add members to the group');
      }
    }
  };

  // Toggle group lock status (superuser only)
  const toggleGroupLock = async (conversationId: number) => {
    if (!currentUser || !isSuperUser) {
      toast.error('Only superusers can lock/unlock groups');
      return;
    }

    let newLockStatus: boolean | undefined;
    try {
      const conversation = conversations.find(c => c.id === conversationId);
      if (!conversation || conversation.type !== 'group') {
        toast.error('Can only lock/unlock group chats');
        return;
      }

      // Handle null/undefined as false (unlocked)
      newLockStatus = !(conversation.is_locked === true);

      const { error } = await supabase
        .from('conversations')
        .update({
          is_locked: newLockStatus,
          updated_at: new Date().toISOString()
        })
        .eq('id', conversationId);

      if (error) throw error;

      // Update local state
      const updatedConversations = await getUpdatedConversations();
      setConversations(updatedConversations);

      // Update selected conversation if it's the one being locked/unlocked
      if (selectedConversation?.id === conversationId) {
        const updatedConversation = updatedConversations.find(c => c.id === conversationId);
        if (updatedConversation) {
          selectConversation(updatedConversation);
        }
      }

      toast.success(newLockStatus ? 'Group locked successfully' : 'Group unlocked successfully');
    } catch (error: any) {
      console.error('Error toggling group lock:', error);
      const action = newLockStatus !== undefined ? (newLockStatus ? 'lock' : 'unlock') : 'update';
      toast.error(`Failed to ${action} group: ${error?.message || 'Unknown error'}`);
    }
  };

  // Remove member from group conversation
  const removeMemberFromGroup = async (conversationId: number, userId: string) => {
    if (!currentUser) return;

    // Check if group is locked and user is not superuser
    const conversation = conversations.find(c => c.id === conversationId);
    if (isGroupLocked(conversation || null) && !isSuperUser) {
      toast.error('This group is locked. Only superusers can remove members from locked groups.');
      return;
    }

    try {
      const { error } = await supabase
        .from('conversation_participants')
        .update({ is_active: false })
        .eq('conversation_id', conversationId)
        .eq('user_id', userId);

      if (error) throw error;

      // Refresh conversations to get updated participant list
      await fetchConversations();

      // Update selected conversation
      const updatedConversations = await getUpdatedConversations();
      const updatedConversation = updatedConversations.find(c => c.id === conversationId);
      if (updatedConversation) {
        selectConversation(updatedConversation);
      }

      toast.success('Member removed from the group');
    } catch (error) {
      toast.error('Failed to remove member from the group');
    }
  };

  // Upload group icon image
  const uploadGroupIcon = async (file: File): Promise<string | null> => {
    if (!selectedConversation) return null;

    setIsUploadingIcon(true);
    try {
      // Validate file type
      if (!file.type.startsWith('image/')) {
        toast.error('Please select an image file');
        return null;
      }

      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        toast.error('Image size must be less than 5MB');
        return null;
      }

      // Generate unique filename
      const fileExt = file.name.split('.').pop();
      const fileName = `group_${selectedConversation.id}_${Date.now()}.${fileExt}`;

      // Upload to Supabase storage
      const { data, error } = await supabase.storage
        .from('RMQ-Groups')
        .upload(fileName, file, {
          cacheControl: '3600',
          upsert: false,
          contentType: file.type
        });

      if (error) {
        console.error('Error uploading icon:', error);

        // Provide more specific error messages
        if (error.message?.includes('Bucket not found') || error.message?.includes('does not exist')) {
          toast.error('Storage bucket not found. Please run the SQL migration to create the RMQ-Groups bucket.');
        } else if (error.message?.includes('new row violates row-level security')) {
          toast.error('Permission denied. Please check bucket policies.');
        } else if (error.message?.includes('NetworkError') || error.message?.includes('Failed to fetch')) {
          toast.error('Network error. Please check your connection and try again.');
        } else {
          toast.error(`Failed to upload icon: ${error.message || 'Unknown error'}`);
        }
        return null;
      }

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('RMQ-Groups')
        .getPublicUrl(fileName);

      return publicUrl;
    } catch (error: any) {
      console.error('Error uploading icon:', error);

      // Handle network errors and other exceptions
      if (error?.name === 'NetworkError' || error?.message?.includes('Failed to fetch') || error?.message?.includes('NetworkError')) {
        toast.error('Network error. Please check your connection and ensure the RMQ-Groups bucket exists.');
      } else if (error?.message) {
        toast.error(`Failed to upload icon: ${error.message}`);
      } else {
        toast.error('Failed to upload icon. Please ensure the storage bucket is configured.');
      }
      return null;
    } finally {
      setIsUploadingIcon(false);
    }
  };

  // Handle icon file selection
  const handleIconFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const url = await uploadGroupIcon(file);
    if (url) {
      setGroupIconUrl(url);
      toast.success('Icon uploaded successfully');
    }

    // Reset input
    if (groupIconInputRef.current) {
      groupIconInputRef.current.value = '';
    }
  };

  // Remove group icon
  const handleRemoveIcon = () => {
    setGroupIconUrl(null);
  };

  // Update group description and notes
  const updateGroupInfo = async (
    conversationId: number,
    title: string,
    description: string,
    notes: string,
    iconUrl: string | null
  ) => {
    if (!currentUser) return;

    setIsUpdatingGroupInfo(true);
    try {
      const updateData: any = {
        description: description.trim() || null,
        notes: notes.trim() || null,
        updated_at: new Date().toISOString()
      };

      // Only update title if it changed and is not empty
      const trimmedTitle = title.trim();
      if (trimmedTitle && trimmedTitle !== selectedConversation?.title) {
        updateData.title = trimmedTitle;
      }

      // Only update icon_url if it changed
      if (iconUrl !== (selectedConversation?.icon_url || null)) {
        updateData.icon_url = iconUrl;
      }

      const { error } = await supabase
        .from('conversations')
        .update(updateData)
        .eq('id', conversationId);

      if (error) throw error;

      // Refresh conversations
      await fetchConversations();

      // Update selected conversation
      const updatedConversations = await getUpdatedConversations();
      const updatedConversation = updatedConversations.find(c => c.id === conversationId);
      if (updatedConversation) {
        selectConversation(updatedConversation);
      }

      setShowGroupInfoModal(false);
      toast.success('Group info updated successfully');
    } catch (error) {
      console.error('Error updating group info:', error);
      toast.error('Failed to update group info');
    } finally {
      setIsUpdatingGroupInfo(false);
    }
  };

  // Find the first unread message
  // Works for both direct chats and group chats
  const findFirstUnreadMessage = useCallback((): Message | null => {
    if (!selectedConversation || !currentUser || messages.length === 0) return null;

    // Get the current user's participant info
    // This works for both direct chats (2 participants) and group chats (multiple participants)
    const userParticipant = selectedConversation.participants?.find(
      p => p.user_id === currentUser.id && p.is_active
    );

    if (!userParticipant) {
      // User is not a participant (shouldn't happen, but handle gracefully)
      return null;
    }

    if (!userParticipant.last_read_at) {
      // If no last_read_at, all messages are potentially unread
      // For group chats: return first message from any other participant
      // For direct chats: return first message from the other participant
      return messages.find(m => m.sender_id !== currentUser.id && !m.is_deleted) || null;
    }

    // Find the first message that:
    // 1. Was sent after the user's last_read_at
    // 2. Was not sent by the current user
    // 3. Is not deleted
    // This logic works for both direct and group chats
    const lastReadAt = new Date(userParticipant.last_read_at);

    for (const message of messages) {
      if (message.is_deleted) continue; // Skip deleted messages

      const messageSentAt = new Date(message.sent_at);
      // For group chats: any message from any participant after last_read_at is unread
      // For direct chats: any message from the other participant after last_read_at is unread
      if (messageSentAt > lastReadAt && message.sender_id !== currentUser.id) {
        return message;
      }
    }

    return null;
  }, [selectedConversation, currentUser, messages]);

  // Find the newest unread message (most recent unread)
  // Works for both direct chats and group chats
  const findNewestUnreadMessage = useCallback((): Message | null => {
    if (!selectedConversation || !currentUser || messages.length === 0) return null;

    // Get the current user's participant info
    const userParticipant = selectedConversation.participants?.find(
      p => p.user_id === currentUser.id && p.is_active
    );

    if (!userParticipant) {
      return null;
    }

    if (!userParticipant.last_read_at) {
      // If no last_read_at, find the newest message from any other participant
      const unreadMessages = messages
        .filter(m => m.sender_id !== currentUser.id && !m.is_deleted)
        .sort((a, b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime());
      return unreadMessages[0] || null;
    }

    // Find all unread messages (sent after last_read_at, not by current user, not deleted)
    const lastReadAt = new Date(userParticipant.last_read_at);
    const unreadMessages = messages
      .filter(m => {
        if (m.is_deleted) return false;
        const messageSentAt = new Date(m.sent_at);
        return messageSentAt > lastReadAt && m.sender_id !== currentUser.id;
      })
      .sort((a, b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime());

    // Return the newest unread message (most recent)
    return unreadMessages[0] || null;
  }, [selectedConversation, currentUser, messages]);

  /** In-chat thread replies: messages whose reply_to_message_id points to a parent; count + oldest reply id for “go to replies”. */
  const replyThreadStats = useMemo(() => {
    const countByParent: Record<number, number> = {};
    const firstReplyIdByParent: Record<number, number> = {};
    for (const m of messages) {
      if (m.is_deleted) continue;
      const pid = m.reply_to_message_id;
      if (!pid) continue;
      countByParent[pid] = (countByParent[pid] || 0) + 1;
      const t = new Date(m.sent_at).getTime();
      const existingId = firstReplyIdByParent[pid];
      if (!existingId) {
        firstReplyIdByParent[pid] = m.id;
      } else {
        const existingMsg = messages.find(x => x.id === existingId);
        if (existingMsg && t < new Date(existingMsg.sent_at).getTime()) {
          firstReplyIdByParent[pid] = m.id;
        }
      }
    }
    return { countByParent, firstReplyIdByParent };
  }, [messages]);

  /** Attached to the message bubble: optional thread-reply strip + (group chats only) “Leave a Comment”. */
  const renderMessageCommentFooter = useCallback(
    (message: Message, tone: 'media' | 'textOwn' | 'textOther') => {
      const isGroupChat = selectedConversation?.type === 'group';
      const count = rmqMessageCommentCounts[message.id] ?? 0;
      const replyCount = replyThreadStats.countByParent[message.id] ?? 0;
      const firstReplyId = replyThreadStats.firstReplyIdByParent[message.id];
      const toneClass =
        tone === 'textOwn'
          ? 'border-t border-white/20 bg-black/10 hover:bg-black/20'
          : tone === 'textOther'
            ? 'border-t border-base-300/70 bg-base-200/55 dark:bg-base-300/35 hover:bg-base-200/80 dark:hover:bg-base-300/50'
            : 'border-t border-base-300/70 bg-base-200/55 dark:bg-base-300/35 hover:bg-base-200/80 dark:hover:bg-base-300/50';
      /** Thread reply strip — same lavender / brand purple as tabs & sidebar selection (not mint). */
      const replyStripClass =
        tone === 'textOwn'
          ? 'border-t border-white/20 bg-white/10 hover:bg-white/16'
          : tone === 'textOther'
            ? 'rmq-thread-reply-strip border-t border-[#3E28CD]/12 bg-[#EDE9F8]/95 hover:bg-[#E2D8F5] dark:border-[#3E28CD]/25 dark:bg-[#3E28CD]/20 dark:hover:bg-[#3E28CD]/28'
            : 'rmq-thread-reply-strip border-t border-[#3E28CD]/12 bg-[#EDE9F8]/95 hover:bg-[#E2D8F5] dark:border-[#3E28CD]/25 dark:bg-[#3E28CD]/20 dark:hover:bg-[#3E28CD]/28';
      const labelClass =
        tone === 'textOwn'
          ? 'text-sky-200'
          : 'text-sky-600 dark:text-sky-400';
      const iconClass = tone === 'textOwn' ? 'text-sky-200' : 'text-sky-600 dark:text-sky-400';
      const chevronClass = tone === 'textOwn' ? 'text-sky-300/90' : 'text-sky-500/90 dark:text-sky-400/90';
      const replyLabelClass =
        tone === 'textOwn'
          ? 'text-sky-200'
          : 'text-[#3E28CD] dark:text-[#d4ccff]';
      const replyIconClass =
        tone === 'textOwn' ? 'text-sky-200' : 'text-[#3E28CD] dark:text-[#c9b8ff]';

      const replyStrip =
        replyCount > 0 ? (
          <button
            type="button"
            className={`flex w-full items-center gap-2 px-3 py-2.5 text-left ${replyStripClass}`}
            onClick={e => {
              e.stopPropagation();
              if (firstReplyId) scrollToMessage(firstReplyId, 'smooth');
            }}
            title="Go to replies"
          >
            <ArrowUturnLeftIcon className={`h-5 w-5 shrink-0 ${replyIconClass}`} strokeWidth={2} />
            <span className={`text-sm font-semibold ${replyLabelClass}`}>
              {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
            </span>
          </button>
        ) : null;

      /** Same lavender / brand strip as “1 reply”, full-width at bottom of bubble. */
      const showLeadFlag = rmqFlaggedMessageIds.has(message.id);
      const flagStrip = showLeadFlag ? (
        <div
          role="status"
          className={`flex w-full items-center gap-2.5 px-3 py-2.5 ${replyStripClass}`}
        >
          <FlagIcon className={`h-6 w-6 shrink-0 ${replyIconClass}`} strokeWidth={2} />
          <span className={`text-sm font-semibold ${replyLabelClass}`}>Flagged to lead</span>
        </div>
      ) : null;

      if (!isGroupChat) {
        if (!replyStrip && !flagStrip) return null;
        return (
          <div className="flex w-full flex-col">
            {replyStrip}
            {flagStrip}
          </div>
        );
      }

      return (
        <div className="flex w-full flex-col">
          {replyStrip}
          <button
            type="button"
            className={`flex w-full items-center justify-between gap-3 px-3 py-3 text-left ${toneClass}`}
            onClick={e => {
              e.stopPropagation();
              openRmqMessageCommentsModal(message);
            }}
          >
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              <ChatBubbleLeftRightIcon className={`h-5 w-5 shrink-0 ${iconClass}`} strokeWidth={2} />
              <span className={`text-sm font-medium ${labelClass}`}>Leave a Comment</span>
              {count > 0 ? (
                <span
                  className={`rounded-full border px-2 py-0.5 text-xs font-semibold tabular-nums ${
                    tone === 'textOwn'
                      ? 'border-white/25 bg-white/10 text-white/90'
                      : 'border-base-300/60 bg-base-100/90 text-base-content/80 dark:bg-base-100/30'
                  }`}
                >
                  {count}
                </span>
              ) : null}
            </div>
            <ChevronRightIcon className={`h-5 w-5 shrink-0 ${chevronClass}`} />
          </button>
          {flagStrip}
        </div>
      );
    },
    [
      rmqMessageCommentCounts,
      openRmqMessageCommentsModal,
      replyThreadStats,
      scrollToMessage,
      selectedConversation?.type,
      rmqFlaggedMessageIds,
    ]
  );

  // Smart auto-scroll logic - scrolls the visible container (desktop or mobile)
  const scrollToBottom = useCallback((behavior: 'smooth' | 'instant' = 'smooth') => {
    // Don't scroll if still loading or preloading images
    if (isLoadingMessages || isPreloadingImages) {
      return;
    }

    // Prefer the container that is visible: on mobile viewport use mobile first, on desktop use desktop first
    const isMobileViewport = typeof window !== 'undefined' && window.innerWidth < 1024;
    let container: HTMLDivElement | null = null;

    if (isMobileViewport && mobileMessagesContainerRef.current && mobileMessagesContainerRef.current.offsetParent) {
      container = mobileMessagesContainerRef.current;
    } else if (!isMobileViewport && desktopMessagesContainerRef.current && desktopMessagesContainerRef.current.offsetParent) {
      container = desktopMessagesContainerRef.current;
    }
    if (!container && desktopMessagesContainerRef.current && desktopMessagesContainerRef.current.offsetParent) {
      container = desktopMessagesContainerRef.current;
    }
    if (!container && mobileMessagesContainerRef.current && mobileMessagesContainerRef.current.offsetParent) {
      container = mobileMessagesContainerRef.current;
    }
    if (!container && messagesContainerRef.current && messagesContainerRef.current.offsetParent) {
      container = messagesContainerRef.current;
    }

    if (!container) return;

    if (behavior === 'instant') {
      // Force immediate scroll to bottom
      container.scrollTop = container.scrollHeight;

      // On mobile skip the follow-up rAF always (layout shifts cause jump). On desktop skip only during stabilization.
      const inStabilization = Date.now() < scrollStabilizationUntilRef.current;
      const skipFollowUp = isMobileViewport || inStabilization;
      if (!skipFollowUp) {
        requestAnimationFrame(() => {
          if (container && !isLoadingMessages && !isPreloadingImages && shouldAutoScrollRef.current && !isUserScrollingRef.current) {
            container.scrollTop = container.scrollHeight;
          }
        });
      }
    } else {
      // Smooth scroll
      container.scrollTo({
        top: container.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, [isLoadingMessages, isPreloadingImages]);

  /** After sending: jump to bottom immediately (double rAF so layout includes new bubble) */
  const bumpScrollAfterOutgoingSend = useCallback(() => {
    shouldAutoScrollRef.current = true;
    setShouldAutoScroll(true);
    isUserScrollingRef.current = false;
    setIsUserScrolling(false);
    scrollStabilizationUntilRef.current = Date.now() + 450;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollToBottom('instant');
      });
    });
  }, [scrollToBottom]);

  // Check if user is near bottom of messages
  const isNearBottom = useCallback(() => {
    // Check desktop container first
    let container: HTMLDivElement | null = null;

    if (desktopMessagesContainerRef.current && desktopMessagesContainerRef.current.offsetParent) {
      container = desktopMessagesContainerRef.current;
    } else if (mobileMessagesContainerRef.current && mobileMessagesContainerRef.current.offsetParent) {
      container = mobileMessagesContainerRef.current;
    } else if (messagesContainerRef.current && messagesContainerRef.current.offsetParent) {
      container = messagesContainerRef.current;
    }

    if (!container) return true;

    const { scrollTop, scrollHeight, clientHeight } = container;
    // Tolerance of 100px
    return scrollHeight - scrollTop - clientHeight < 100;
  }, []);

  // Handle scroll events to detect user scrolling
  const handleScroll = useCallback(() => {
    let container: HTMLDivElement | null = null;
    if (mobileMessagesContainerRef.current && mobileMessagesContainerRef.current.offsetParent) {
      container = mobileMessagesContainerRef.current;
    } else if (desktopMessagesContainerRef.current && desktopMessagesContainerRef.current.offsetParent) {
      container = desktopMessagesContainerRef.current;
    } else if (messagesContainerRef.current && messagesContainerRef.current.offsetParent) {
      container = messagesContainerRef.current;
    }

    if (container && container.scrollTop < 120 && hasMoreOlderMessages && !isLoadingOlderMessages && selectedConversation) {
      loadOlderMessages();
    }

    const nearBottom = isNearBottom();

    const currentScrollPosition = container ? container.scrollTop : 0;
    const scrollPositionChanged = Math.abs(currentScrollPosition - lastScrollPositionRef.current) > 1;
    lastScrollPositionRef.current = currentScrollPosition;

    if (!scrollPositionChanged) return;

    // If user scrolls to bottom, enable auto-scroll and reset count (and skip ResizeObserver scroll for a short time to prevent "pull up" animation)
    if (nearBottom) {
      shouldAutoScrollRef.current = true;
      isUserScrollingRef.current = false;
      setShouldAutoScroll(true);
      setIsUserScrolling(false);
      userJustScrolledToBottomRef.current = true;
      if (scrollPositionCheckRef.current) {
        clearTimeout(scrollPositionCheckRef.current);
      }
      scrollPositionCheckRef.current = setTimeout(() => {
        userJustScrolledToBottomRef.current = false;
        scrollPositionCheckRef.current = null;
      }, 600);
      return;
    }

    // If user scrolls up, disable auto-scroll (refs updated first so ResizeObserver/callbacks see it immediately)
    shouldAutoScrollRef.current = false;
    isUserScrollingRef.current = true;
    setShouldAutoScroll(false);
    setIsUserScrolling(true);

    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = null;
    }
  }, [messages, isNearBottom, hasMoreOlderMessages, isLoadingOlderMessages, selectedConversation?.id, loadOlderMessages]);

  // Track previous message count to detect new messages
  const prevMessageCountRef = useRef(0);
  const isScrollingRef = useRef(false);

  // Auto-scroll to newest unread message or bottom when new messages arrive (only if should auto-scroll AND user is near bottom)
  useEffect(() => {
    // Clear any pending scroll attempts
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = null;
    }

    // Check if this is the initial load of the conversation
    const isInitialLoad = selectedConversation && initialLoadRef.current !== selectedConversation.id;

    // Skip this useEffect for initial load - useLayoutEffect handles initial scroll
    if (isInitialLoad) {
      prevMessageCountRef.current = messages.length;
      return;
    }

    // Use refs so we don't scroll when user has scrolled up (state may not have updated yet)
    const userIsNearBottom = isNearBottom();
    const isNewMessageFromMe = messages.length > 0 && messages[messages.length - 1].sender_id === currentUser?.id;
    const hasNewMessages = messages.length > prevMessageCountRef.current;

    // For subsequent message updates, scroll only when NEW messages arrived and (user is near bottom OR new message is from current user)
    const shouldScroll = ((shouldAutoScrollRef.current && userIsNearBottom && !isUserScrollingRef.current) || isNewMessageFromMe) && hasNewMessages;

    if (shouldScroll && messages.length > 0 && selectedConversation && !isScrollingRef.current) {
      // Delayed scroll for subsequent message updates to allow rendering
      isScrollingRef.current = true;

      // Use efficient single RAF for rendering updates - no double RAF to prevent interference
      requestAnimationFrame(() => {
        if (messages.length > 0 && !isUserScrolling && !isLoadingMessages && !isPreloadingImages) {
          scrollToBottom(isNewMessageFromMe ? 'instant' : 'smooth');
          isScrollingRef.current = false;
        }
      });

    } else if (shouldAutoScroll && !userIsNearBottom && hasNewMessages && selectedConversation) {
      // User is scrolled up and new messages arrived - disable auto-scroll
      shouldAutoScrollRef.current = false;
      setShouldAutoScroll(false);
    }

    // Update previous message count
    prevMessageCountRef.current = messages.length;

    // Cleanup timeout on unmount
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, [messages.length, shouldAutoScroll, selectedConversation?.id, currentUser?.id, scrollToBottom, isNearBottom]);

  // Track if we've scrolled for this conversation to prevent duplicate scrolls
  const hasScrolledForConversationRef = useRef<number | null>(null);

  // SINGLE RELIABLE SCROLL on initial load - use useLayoutEffect for synchronous execution
  useLayoutEffect(() => {
    // Check if this is initial load (conversation changed or messages just loaded)
    const isInitialLoad = selectedConversation && initialLoadRef.current !== selectedConversation.id;
    const hasMessages = messages.length > 0;

    // Only scroll on resize when NEW MESSAGES were added; ignore resize from images/videos loading (same message count)
    lastResizeMessageCountRef.current = messages.length;

    // Use ResizeObserver only to scroll when new messages arrive - NOT when media loads (prevents jumpy scroll)
    let resizeObserver: ResizeObserver | null = null;

    // Find the active container
    const container = desktopMessagesContainerRef.current?.offsetParent ? desktopMessagesContainerRef.current :
      mobileMessagesContainerRef.current?.offsetParent ? mobileMessagesContainerRef.current :
        messagesContainerRef.current;

    if (container) {
      let resizeScrollTimeout: NodeJS.Timeout | null = null;
      let lastScrollTime = 0;
      const SCROLL_THROTTLE_MS = 200;
      const initialLoadTime = isInitialLoad ? Date.now() : 0;
      const isMobileViewport = typeof window !== 'undefined' && window.innerWidth < 1024;
      const INITIAL_LOAD_GRACE_PERIOD = isMobileViewport ? 6000 : 2000;

      resizeObserver = new ResizeObserver(() => {
        if (isInitialLoad && Date.now() - initialLoadTime < INITIAL_LOAD_GRACE_PERIOD) return;
        if (userJustScrolledToBottomRef.current) return;
        // During stabilization (e.g. media still loading), don't scroll on resize to prevent jump
        if (Date.now() < scrollStabilizationUntilRef.current) return;

        // Only scroll when message count increased (new messages). Do NOT scroll when only images/videos load (same count).
        const currentCount = messages.length;
        if (currentCount <= lastResizeMessageCountRef.current) return;

        // Use refs so we never scroll when user has scrolled up (state may not have updated yet)
        if (!shouldAutoScrollRef.current || isUserScrollingRef.current) return;

        if (resizeScrollTimeout) {
          clearTimeout(resizeScrollTimeout);
          resizeScrollTimeout = null;
        }

        const now = Date.now();
        if (now - lastScrollTime < SCROLL_THROTTLE_MS) return;

        resizeScrollTimeout = setTimeout(() => {
          if (!shouldAutoScrollRef.current || isUserScrollingRef.current || isLoadingMessages || isPreloadingImages || userJustScrolledToBottomRef.current) {
            resizeScrollTimeout = null;
            return;
          }
          lastScrollTime = Date.now();
          lastResizeMessageCountRef.current = currentCount;
          requestAnimationFrame(() => {
            if (!shouldAutoScrollRef.current || isUserScrollingRef.current) return;
            scrollToBottom('instant');
          });
          resizeScrollTimeout = null;
        }, 150);
      });

      resizeObserver.observe(container);
      // Do not observe firstElementChild - it causes extra resize events as every image loads and triggers scroll jump
    }

    // Only scroll if:
    // 1. It's an initial load (conversation changed)
    // 2. We have messages
    if (isInitialLoad && hasMessages && selectedConversation) {

      // Mark as loaded and scrolled IMMEDIATELY to prevent duplicate attempts
      initialLoadRef.current = selectedConversation.id;
      hasScrolledForConversationRef.current = selectedConversation.id;

      // Set refs first so ResizeObserver/callbacks never override user scroll; then state
      shouldAutoScrollRef.current = true;
      isUserScrollingRef.current = false;
      setShouldAutoScroll(true);
      setIsUserScrolling(false);

      // Single scroll to bottom after one delay; stabilization period prevents further programmatic scroll when media loads
      if (!isLoadingMessages && !isPreloadingImages) {
        const isMobileViewport = typeof window !== 'undefined' && window.innerWidth < 1024;
        const STABILIZATION_MS = isMobileViewport ? 9000 : 5000;
        const INITIAL_SCROLL_DELAY_MS = isMobileViewport ? 500 : 250;
        scrollStabilizationUntilRef.current = Date.now() + STABILIZATION_MS;
        const tid = window.setTimeout(() => {
          scrollToBottom('instant');
          initialScrollTimeoutRef.current = null;
        }, INITIAL_SCROLL_DELAY_MS);
        initialScrollTimeoutRef.current = tid as number;
      }
    }

    // Cleanup observer and any pending initial scroll on effect re-run or unmount
    return () => {
      if (initialScrollTimeoutRef.current) {
        clearTimeout(initialScrollTimeoutRef.current);
        initialScrollTimeoutRef.current = null;
      }
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, [messages.length, selectedConversation?.id, scrollToBottom]);

  // Reset scroll tracking and fetch messages when conversation changes
  useEffect(() => {
    if (selectedConversation && isOpen) {
      // ALWAYS reset flags when conversation changes - this ensures scroll happens for new conversation
      initialLoadRef.current = null;
      hasScrolledForConversationRef.current = null;

      // Check persisted state first - restore immediately if available
      const cachedData = persistedMessages[selectedConversation.id];
      if (cachedData && cachedData.messages.length > 0) {
        // Restore messages immediately without showing loading
        setMessages(cachedData.messages);
        setIsLoadingMessages(false);
        setHasMoreOlderMessages(!!cachedData.hasMoreOlder);
        console.log(`[RMQ] Immediately restored ${cachedData.messages.length} messages from persisted state for conversation ${selectedConversation.id}`);

        // Fetch new messages in background (non-blocking)
        fetchMessages(selectedConversation.id, false);
      } else {
        // No cached data, clear and fetch normally
        setMessages([]);
        setIsLoadingMessages(true);
        fetchMessages(selectedConversation.id);
      }
    } else {
      // No conversation selected, reset the flags and clear messages
      initialLoadRef.current = null;
      hasScrolledForConversationRef.current = null;
      setMessages([]);
      setIsLoadingMessages(false);
    }
  }, [selectedConversation?.id, isOpen, fetchMessages]);

  useEffect(() => {
    resetInputHeights();
  }, [selectedConversation?.id]);

  // Check employee availability when conversation is selected
  useEffect(() => {
    if (selectedConversation?.type === 'direct' && selectedConversation.participants) {
      const otherParticipant = selectedConversation.participants.find(p => p.user_id !== currentUser?.id);
      if (otherParticipant?.user?.tenants_employee?.display_name) {
        checkEmployeeAvailability(otherParticipant.user.tenants_employee.display_name);
      } else {
        setIsEmployeeUnavailable(false);
        setUnavailabilityReason(null);
        setUnavailabilityTimePeriod(null);
      }
    } else {
      setIsEmployeeUnavailable(false);
      setUnavailabilityReason(null);
      setUnavailabilityTimePeriod(null);
    }
  }, [selectedConversation?.id, currentUser?.id, checkEmployeeAvailability]);

  // Check availability for all contacts when they are loaded
  useEffect(() => {
    if (allUsers.length > 0) {
      checkAllContactsAvailability();
    }
  }, [allUsers.length, checkAllContactsAvailability]);

  // Cleanup audio when conversation changes or component unmounts
  useEffect(() => {
    return () => {
      if (voiceAudio) {
        voiceAudio.pause();
        setPlayingVoiceId(null);
        setVoiceAudio(null);
      }
    };
  }, [selectedConversation?.id]);

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (voiceAudio) {
        voiceAudio.pause();
      }
    };
  }, []);

  // Fetch conversations and users when user is loaded (in parallel for faster loading)
  useEffect(() => {
    const loadData = async () => {
      if (currentUser) {
        // Load conversations and users in parallel for faster initial load
        await Promise.all([
          fetchConversations(),
          fetchAllUsers()
        ]);
      }
    };

    loadData();
  }, [currentUser, fetchConversations, fetchAllUsers]);

  // Request online status when both WebSocket is connected and users are loaded
  useEffect(() => {
    if (isOpen && websocketService.isSocketConnected() && allUsers.length > 0) {
      // Add a small delay to ensure socket is fully ready
      const timeoutId = setTimeout(() => {
        const userIds = allUsers.map(u => String(u.id));
        websocketService.requestOnlineStatus(userIds);
      }, 500);

      return () => clearTimeout(timeoutId);
    }
  }, [isOpen, allUsers.length]);

  // Select initial conversation when modal opens
  useEffect(() => {
    if (isOpen && initialConversationId && conversations.length > 0) {
      const conversation = conversations.find(c => c.id === initialConversationId);
      if (conversation) {
        selectConversation(conversation);
        fetchMessages(conversation.id, false);
        setShowMobileConversations(false);
        // Set the correct tab based on conversation type
        if (conversation.type === 'group' || conversation.type === 'announcement') {
          setActiveTab('groups');
        } else {
          setActiveTab('chats');
        }
      }
    }
  }, [isOpen, initialConversationId, conversations]);

  // Handle initialUserId - start direct conversation when modal opens
  useEffect(() => {
    if (isOpen && initialUserId && currentUser && !selectedConversation && conversations.length > 0) {
      // Start direct conversation with the initial user
      const startConv = async () => {
        await startDirectConversation(initialUserId);
      };
      startConv();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialUserId, currentUser?.id, selectedConversation?.id, conversations.length]);

  // Auto-scroll to newest unread message or bottom when conversation changes (initial load only)
  // Only scroll when messages are loaded AND not preloading images to prevent jumping
  useEffect(() => {
    if (selectedConversation && messages.length > 0 && !isLoadingMessages && !isPreloadingImages) {
      const isInitialLoad = initialLoadRef.current !== selectedConversation.id;

      if (isInitialLoad) {
        // This is the initial load - use instant scroll only
        initialLoadRef.current = selectedConversation.id;

        // Reset scroll state (refs first so async code sees intent immediately)
        shouldAutoScrollRef.current = true;
        isUserScrollingRef.current = false;
        setShouldAutoScroll(true);
        setIsUserScrolling(false);

        // Wait a bit for DOM to settle after images load
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            // Find newest unread message (works for both direct chats and group chats)
            const newestUnreadMessage = findNewestUnreadMessage();
            firstUnreadMessageIdRef.current = newestUnreadMessage?.id || null;

            // Scroll to newest unread message if it exists, otherwise scroll to bottom
            if (newestUnreadMessage) {
              scrollToMessage(newestUnreadMessage.id, 'instant');
            } else {
              scrollToBottom('instant');
            }
          });
        });
      }
    }
  }, [selectedConversation?.id, messages.length, isLoadingMessages, isPreloadingImages, findNewestUnreadMessage, scrollToMessage, scrollToBottom]);

  useEffect(() => {
    if (!isOpen) rmqLeadScrollDoneRef.current = null;
  }, [isOpen]);

  /** Opened from CRM “Flagged” modal: scroll to the flagged chat message after the thread loads. */
  useEffect(() => {
    if (!isOpen || initialScrollToMessageId == null || initialConversationId == null) return;
    if (selectedConversation?.id !== initialConversationId) return;
    if (isLoadingMessages) return;
    if (!messages.some(m => m.id === initialScrollToMessageId)) return;
    const key = `${initialConversationId}-${initialScrollToMessageId}`;
    if (rmqLeadScrollDoneRef.current === key) return;
    const tid = window.setTimeout(() => {
      scrollToMessage(initialScrollToMessageId, 'smooth');
      rmqLeadScrollDoneRef.current = key;
    }, 650);
    return () => clearTimeout(tid);
  }, [
    isOpen,
    initialScrollToMessageId,
    initialConversationId,
    selectedConversation?.id,
    messages,
    isLoadingMessages,
    scrollToMessage,
  ]);

  // Set initial message when conversation is selected and initialMessage/lead info is provided
  useEffect(() => {
    if (selectedConversation && (initialMessage || (initialLeadNumber && initialLeadName)) && newMessage === '') {
      // Small delay to ensure conversation is fully loaded
      setTimeout(() => {
        let messageToSet = '';

        // Use initialMessage if provided, otherwise construct from lead info
        if (initialMessage) {
          messageToSet = initialMessage;
        } else if (initialLeadNumber && initialLeadName) {
          messageToSet = 'The finance plan is not ready for this lead. Please create the payment plan.';
        }

        // Add lead link if we have lead information
        if (initialLeadNumber && initialLeadName) {
          const deployedDomain = 'https://leadify-crm.onrender.com';
          const leadLink = `[Lead #${initialLeadNumber} - ${initialLeadName}](${deployedDomain}/clients/${initialLeadNumber})`;
          messageToSet = messageToSet ? `${messageToSet}\n\n${leadLink}` : leadLink;
        }

        if (messageToSet) {
          setNewMessage(messageToSet);
          resetInputHeights();
        }
      }, 200);
    }
  }, [selectedConversation?.id, initialMessage, initialLeadNumber, initialLeadName, newMessage]);

  // Initial loading - reduce timeout for faster perceived loading
  useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), 300);
    return () => clearTimeout(timer);
  }, []);

  const adjustTextareaHeight = (textarea: HTMLTextAreaElement | null, maxHeight = 200) => {
    if (!textarea) return;
    textarea.style.height = 'auto';
    const minHeight = 40; // Match compact button height
    const newHeight = Math.max(minHeight, Math.min(textarea.scrollHeight, maxHeight));
    textarea.style.height = `${newHeight}px`;
  };

  const resetInputHeights = () => {
    requestAnimationFrame(() => {
      adjustTextareaHeight(messageInputRef.current);
      adjustTextareaHeight(mobileMessageInputRef.current);
    });
  };

  // Handle message input change — keep state update non-blocking and throttle typing indicator for fast typing
  const handleMessageInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    // Defer state update so the input stays responsive (avoids blocking the main thread on every keystroke)
    startTransition(() => setNewMessage(value));
    adjustTextareaHeight(e.target);
    if (e.target !== messageInputRef.current) {
      adjustTextareaHeight(messageInputRef.current);
    }
    if (e.target !== mobileMessageInputRef.current) {
      adjustTextareaHeight(mobileMessageInputRef.current);
    }

    // Send typing indicator (throttled: at most once per TYPING_INDICATOR_THROTTLE_MS to avoid slow typing)
    if (selectedConversation && currentUser && websocketService.isSocketConnected()) {
      const now = Date.now();
      if (now - lastTypingSentAtRef.current >= TYPING_INDICATOR_THROTTLE_MS) {
        lastTypingSentAtRef.current = now;
        const userName = currentUser.full_name || currentUser.email || 'User';
        websocketService.sendTyping(
          selectedConversation.id,
          currentUser.id,
          userName,
          true
        );
      }

      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      typingTimeoutRef.current = setTimeout(() => {
        if (selectedConversation && currentUser && websocketService.isSocketConnected()) {
          const userName = currentUser.full_name || currentUser.email || 'User';
          websocketService.sendTyping(
            selectedConversation.id,
            currentUser.id,
            userName,
            false
          );
        }
      }, 2000);
    }
  };

  // Handle emoji selection
  const handleEmojiClick = (emojiObject: any) => {
    const emoji = emojiObject.emoji;
    // Add emoji to message
    setNewMessage(prev => prev + emoji);
    resetInputHeights();

    // Close picker after a small delay to ensure emoji is added first
    setTimeout(() => {
      setIsEmojiPickerOpen(false);

      // Focus back on the message input
      if (messageInputRef.current) {
        messageInputRef.current.focus();
      }
    }, 50);
  };

  const handleMobileToolSelect = (tool: 'lead' | 'file' | 'emoji' | 'voice') => {
    setShowMobileTools(false);
    switch (tool) {
      case 'lead':
        setIsLeadSearchOpen(prev => !prev);
        break;
      case 'file':
        fileInputRef.current?.click();
        break;
      case 'emoji':
        setIsEmojiPickerOpen(prev => !prev);
        break;
      case 'voice':
        if (!isRecording) {
          startVoiceRecording();
        }
        break;
      default:
        break;
    }
  };

  const handleDesktopToolSelect = (tool: 'lead' | 'file' | 'emoji' | 'voice') => {
    setShowDesktopTools(false);
    switch (tool) {
      case 'lead':
        setIsLeadSearchOpen(prev => !prev);
        break;
      case 'file':
        fileInputRef.current?.click();
        break;
      case 'emoji':
        setIsEmojiPickerOpen(prev => !prev);
        break;
      case 'voice':
        if (!isRecording) {
          startVoiceRecording();
        }
        break;
      default:
        break;
    }
  };

  // Keep portaled message ⋯ menu aligned with its button on scroll/resize
  useLayoutEffect(() => {
    if (messageActionMenu === null) return;

    const updatePosition = () => {
      const btn = messageActionMenuButtonRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      setMessageMenuAnchor(prev =>
        prev ? { ...prev, left: r.left, right: r.right, top: r.top } : null
      );
    };

    updatePosition();
    const scrollArea = document.querySelector('.rmq-messages-area');
    scrollArea?.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      scrollArea?.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [messageActionMenu]);

  // Close message action menu when clicking outside (includes portaled menu; .message-action-menu on button + panel)
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (messageActionMenu !== null) {
        const target = event.target as HTMLElement;
        if (!target.closest('.message-action-menu')) {
          closeMessageActionMenu();
        }
      }
    };

    if (messageActionMenu !== null) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [messageActionMenu, closeMessageActionMenu]);

  // Close message ⋯ menu on Escape
  useEffect(() => {
    if (messageActionMenu === null) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMessageActionMenu();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [messageActionMenu, closeMessageActionMenu]);

  // Close emoji picker, lead search, and reaction picker when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
      if (isEmojiPickerOpen) {

        // Check if click is inside emoji picker or emoji button
        const isInsideEmojiPicker = target.closest('[class*="EmojiPicker"]') ||
          target.closest('[class*="epr-"]') ||
          target.closest('button[title="Add emoji"]');

        if (!isInsideEmojiPicker) {
          setIsEmojiPickerOpen(false);
        }
      }

      if (isLeadSearchOpen) {

        // Check if click is inside lead search dropdown or plus button
        const isInsideLeadSearch = target.closest('.lead-search-dropdown') ||
          target.closest('button[title="Attach Lead"]');

        if (!isInsideLeadSearch) {
          setIsLeadSearchOpen(false);
          setLeadSearchQuery('');
          setLeadSearchResults([]);
        }
      }

      if (showReactionPicker) {
        const target = event.target as Element;

        // Check if click is inside the reaction picker buttons/container only
        // Don't check for message bubble - clicking on message bubble should close the picker
        const isInsideReactionPicker = target.closest('button[title^="React with"]') ||
          target.closest('.reaction-picker-container');

        if (!isInsideReactionPicker) {
          setShowReactionPicker(null);
          setReactingMessageId(null);
        }
      }

      if (showMobileTools) {
        const insideTools = mobileToolsRef.current?.contains(target);
        if (!insideTools) {
          setShowMobileTools(false);
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isEmojiPickerOpen, isLeadSearchOpen, showReactionPicker]);

  // WebSocket message handler - separate from initialization
  useEffect(() => {
    if (!currentUser) return;

    const handleWebSocketMessage = async (message: MessageData) => {
      // Add message if it's for the currently selected conversation
      if (selectedConversation && message.conversation_id === selectedConversation.id) {
        // Fetch read receipts for the new message
        let readReceipts: Array<{ user_id: string; read_at: string }> = [];
        if (message.id) {
          const { data: receipts } = await supabase
            .from('message_read_receipts')
            .select('user_id, read_at')
            .eq('message_id', message.id);
          readReceipts = receipts || [];
        }

        // Fetch reply message data if this message is a reply
        let replyToMessage: Message | undefined = undefined;
        if (message.reply_to_message_id) {
          console.log('🔍 [Reply Debug] WebSocket message has reply_to_message_id:', message.reply_to_message_id);
          const { data: replyData, error: replyError } = await supabase
            .from('messages')
            .select(`
              id,
              content,
              message_type,
              attachment_url,
              attachment_name,
              attachment_type,
              sender:users!sender_id(
                id,
                full_name,
                is_active,
                tenants_employee!users_employee_id_fkey(display_name)
              )
            `)
            .eq('id', message.reply_to_message_id)
            .single();

          if (replyError) {
            console.error('🔍 [Reply Debug] Error fetching reply message:', replyError);
          } else if (replyData) {
            replyToMessage = replyData as unknown as Message;
            console.log('🔍 [Reply Debug] Fetched reply message data:', {
              replyId: replyToMessage.id,
              replyContent: replyToMessage.content,
              replySender: replyToMessage.sender?.tenants_employee?.display_name || replyToMessage.sender?.full_name
            });
          } else {
            console.warn('🔍 [Reply Debug] No reply data found for reply_to_message_id:', message.reply_to_message_id);
          }
        } else {
          console.log('🔍 [Reply Debug] WebSocket message has no reply_to_message_id');
        }

        setMessages(prev => {
          // Check if message already exists to avoid duplicates
          // First check by exact ID match (if message from DB already exists)
          if (message.id) {
            const existingById = prev.find(m => m.id === message.id);
            if (existingById) {
              // Message already exists with this ID, update it with WebSocket data
              const updated = prev.map(m => {
                if (m.id === message.id) {
                  // Handle reply_to_message - might be array or object
                  let processedReplyMessage = replyToMessage || m.reply_to_message;
                  if (processedReplyMessage && Array.isArray(processedReplyMessage)) {
                    processedReplyMessage = processedReplyMessage.length > 0 ? processedReplyMessage[0] : undefined;
                  }

                  return {
                    ...m,
                    ...message,
                    read_receipts: readReceipts,
                    delivery_status: 'sent',
                    reply_to_message_id: message.reply_to_message_id || m.reply_to_message_id,
                    reply_to_message: processedReplyMessage
                  } as unknown as Message;
                }
                return m;
              });
              // Sort by sent_at to ensure correct chronological order
              return updated.sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime());
            }
          }

          // Check if this is a duplicate by content, sender, and timing (for messages sent by current user)
          // This prevents duplicates when WebSocket broadcasts back a message we just sent
          const isCurrentUserMessage = message.sender_id === currentUser?.id;
          if (isCurrentUserMessage && message.content) {
            const duplicateByContent = prev.find(m =>
              m.conversation_id === message.conversation_id &&
              m.sender_id === message.sender_id &&
              m.content === message.content &&
              Math.abs(new Date(m.sent_at).getTime() - new Date(message.sent_at).getTime()) < 3000);
            if (duplicateByContent) {
              console.log('🔍 [Reply Debug] Found duplicate message by content, updating with reply data:', {
                duplicateId: duplicateByContent.id,
                newMessageId: message.id,
                replyToMessageId: message.reply_to_message_id,
                hasReplyToMessage: !!replyToMessage,
                duplicateHasReply: !!duplicateByContent.reply_to_message_id
              });

              // Handle reply_to_message - ensure it's an object, not an array
              let processedReplyMessage = replyToMessage;
              if (processedReplyMessage && Array.isArray(processedReplyMessage)) {
                processedReplyMessage = processedReplyMessage.length > 0 ? processedReplyMessage[0] : undefined;
              }

              // Always update the duplicate with the latest data from WebSocket, including reply data
              const updated = prev.map(m => {
                if (m.id === duplicateByContent.id) {
                  const updatedMessage = {
                    ...m,
                    id: message.id || m.id, // Use new ID if available
                    read_receipts: readReceipts,
                    delivery_status: 'sent' as const,
                    // Always update reply data if available from WebSocket message
                    reply_to_message_id: message.reply_to_message_id || m.reply_to_message_id,
                    reply_to_message: processedReplyMessage || m.reply_to_message
                  } as Message;

                  console.log('🔍 [Reply Debug] Updated duplicate message with reply data:', {
                    messageId: updatedMessage.id,
                    replyToMessageId: updatedMessage.reply_to_message_id,
                    hasReplyToMessage: !!updatedMessage.reply_to_message,
                    replyContent: updatedMessage.reply_to_message?.content?.substring(0, 50)
                  });

                  return updatedMessage;
                }
                return m;
              });

              return updated.sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime());
            }
          }

          // Enhance WebSocket message with real user data from conversation participants
          // Handle reply_to_message - ensure it's an object, not an array
          let processedReplyMessage = replyToMessage;
          if (processedReplyMessage && Array.isArray(processedReplyMessage)) {
            processedReplyMessage = processedReplyMessage.length > 0 ? processedReplyMessage[0] : undefined;
          }

          const enhancedMessage = {
            ...message,
            read_receipts: readReceipts,
            delivery_status: 'sent',
            reply_to_message_id: message.reply_to_message_id || undefined,
            reply_to_message: processedReplyMessage || undefined
          } as unknown as Message;

          // Find the sender in the conversation participants to get real user data
          const senderParticipant = selectedConversation.participants.find(p => p.user_id === message.sender_id);
          if (senderParticipant && senderParticipant.user) {
            // Ensure the sender has the correct id field
            const senderUser = {
              ...senderParticipant.user,
              id: (senderParticipant.user as any).id || (senderParticipant.user as any).ids
            } as User;
            enhancedMessage.sender = senderUser;
          }

          // Ensure attachment fields are properly set
          if (message.attachment_url && !enhancedMessage.attachment_url) {
            enhancedMessage.attachment_url = message.attachment_url;
            enhancedMessage.attachment_name = message.attachment_name;
            enhancedMessage.attachment_type = message.attachment_type;
            enhancedMessage.attachment_size = message.attachment_size;
          }
          // Add message and sort by sent_at to ensure correct chronological order
          const updated = [...prev, enhancedMessage];
          const sorted = updated.sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime());

          // Update persisted cache with new message
          if (selectedConversation) {
            setPersistedMessages(prevCache => {
              const lastMessage = sorted[sorted.length - 1];
              return {
                ...prevCache,
                [selectedConversation.id]: {
                  messages: sorted,
                  lastFetched: Date.now(),
                  lastMessageId: lastMessage?.id || null
                }
              };
            });
          }

          return sorted;
        });

        if (!isLoadingMessages && !isPreloadingImages) {
          shouldAutoScrollRef.current = true;
          setShouldAutoScroll(true);
          requestAnimationFrame(() => {
            requestAnimationFrame(() => scrollToBottom('instant'));
          });
        }

        // Mark message as read if current user is viewing the conversation
        if (message.id && message.sender_id !== currentUser.id) {
          await markMessagesAsRead([message.id], selectedConversation.id);
        }
      } else {
      }

      // Update conversation preview for all conversations
      setConversations(prev => {
        // Format preview text based on message type
        let previewText = '';
        if (message.message_type === 'album' && message.media_attachments && message.media_attachments.length > 0) {
          previewText = `🖼️ ${message.media_attachments.length} media`;
        } else if (message.message_type === 'file' || message.message_type === 'image') {
          previewText = message.attachment_name || `📎 ${message.message_type === 'image' ? 'Image' : 'File'}`;
        } else if (message.content && message.content.trim()) {
          previewText = message.content.substring(0, 100);
        } else {
          previewText = 'New message';
        }

        const updated = prev.map(conv =>
          conv.id === message.conversation_id
            ? {
              ...conv,
              last_message_at: message.sent_at,
              last_message_preview: previewText,
              unread_count: conv.id === selectedConversation?.id ? 0 : (conv.unread_count || 0) + 1
            }
            : conv
        ).sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime());

        // Update persisted conversations cache
        setPersistedConversations(updated);

        return updated;
      });
    };

    websocketService.onMessage(handleWebSocketMessage);

    // Cleanup
    return () => {
      // Note: websocketService doesn't have an offMessage method, so we can't clean up
      // This is fine as the handler will be replaced on next render
    };
  }, [selectedConversation, currentUser, isLoadingMessages, isPreloadingImages]);

  // Join conversation room when conversation is selected
  useEffect(() => {
    if (selectedConversation && currentUser) {
      websocketService.joinConversation(selectedConversation.id);
      websocketService.markAsRead(selectedConversation.id, currentUser.id);
    }

    return () => {
      if (selectedConversation && currentUser) {
        websocketService.leaveConversation(selectedConversation.id);
      }
    };
  }, [selectedConversation?.id, currentUser?.id]); // Only depend on IDs to prevent constant re-joining

  // When entering a chat: mark as read and clear unread badge immediately (no need to leave/refresh)
  useEffect(() => {
    if (!selectedConversation || !currentUser) return;
    const convId = selectedConversation.id;
    // Clear unread count in UI immediately so sidepanel badge disappears
    setConversations(prev =>
      prev.map(conv => (conv.id === convId ? { ...conv, unread_count: 0 } : conv))
    );
    setPersistedConversations(prev =>
      prev.map(conv => (conv.id === convId ? { ...conv, unread_count: 0 } : conv))
    );
    // Persist read state in backend
    void supabase
      .rpc('mark_conversation_as_read', { conv_id: convId, user_uuid: currentUser.id })
      .then(() => {}, console.error);
  }, [selectedConversation?.id, currentUser?.id]);

  // Periodically refresh read receipts for messages in current conversation.
  // Only call setMessages when at least one message's read_receipts actually changed, to avoid
  // replacing the entire list with new object references every 3s (which caused blinking/flickering for some users).
  useEffect(() => {
    if (!selectedConversation || !currentUser || messages.length === 0) return;

    const refreshReadReceipts = async () => {
      const messageIds = messages
        .filter(msg => msg.sender_id === currentUser.id && msg.id != null) // Only refresh for own messages with valid IDs
        .map(msg => msg.id)
        .filter(id => id != null && id !== undefined); // Filter out any undefined/null values

      if (messageIds.length === 0) return;

      const { data: receipts } = await supabase
        .from('message_read_receipts')
        .select('message_id, user_id, read_at')
        .in('message_id', messageIds);

      if (!receipts || receipts.length === 0) return;

      // Group receipts by message_id (key by number for message ids)
      const receiptsByMessage: Record<number, Array<{ user_id: string; read_at: string }>> = receipts.reduce((acc: Record<number, Array<{ user_id: string; read_at: string }>>, receipt: any) => {
        const mid = receipt.message_id as number;
        if (!acc[mid]) acc[mid] = [];
        acc[mid].push({ user_id: receipt.user_id, read_at: receipt.read_at });
        return acc;
      }, {});

      const serializeReceipts = (arr: Array<{ user_id: string; read_at: string }>) =>
        [...(arr || [])].sort((a, b) => (a.user_id + a.read_at).localeCompare(b.user_id + b.read_at)).map(r => `${r.user_id}:${r.read_at}`).join(',');

      setMessages(prev => {
        let hasChange = false;
        const next = prev.map(msg => {
          const newReceipts = receiptsByMessage[msg.id] || msg.read_receipts || [];
          const prevReceipts = msg.read_receipts || [];
          const same = serializeReceipts(prevReceipts) === serializeReceipts(newReceipts);
          if (!same) hasChange = true;
          return same ? msg : { ...msg, read_receipts: newReceipts };
        });
        return hasChange ? next : prev;
      });
    };

    // Refresh immediately
    refreshReadReceipts();

    // Refresh every 3 seconds
    const interval = setInterval(refreshReadReceipts, 3000);

    return () => clearInterval(interval);
  }, [selectedConversation?.id, currentUser?.id, messages.length]);

  // Typing indicators removed - no cleanup needed

  // Filter conversations and users based on search and active tab
  const filteredGroupConversations = useMemo(() => {
    const query = searchQuery.toLowerCase();
    return conversations
      .filter(conv => conv.type === 'group')
      .filter(conv => {
        if (!query) return true;
        const title = getConversationTitle(conv).toLowerCase();
        const preview = conv.last_message_preview?.toLowerCase() || '';
        return title.includes(query) || preview.includes(query);
      })
      .sort(
        (a, b) =>
          new Date(b.last_message_at || 0).getTime() - new Date(a.last_message_at || 0).getTime()
      );
  }, [conversations, searchQuery, currentUser]);

  const filteredUsers = allUsers.filter(user => {
    const userName = (user.tenants_employee?.display_name || user.full_name || '').toLowerCase();
    const userRole = (user.tenants_employee?.bonuses_role || '').toLowerCase();
    const userDept = (user.tenants_employee?.tenant_departement?.name || '').toLowerCase();
    const query = searchQuery.toLowerCase();
    return userName.includes(query) || userRole.includes(query) || userDept.includes(query);
  });

  const contactsWithLastMessage = useMemo(() => {
    return filteredUsers
      .map(user => {
        if (!currentUser) {
          return {
            user,
            lastMessageAt: null as string | null,
            lastMessagePreview: '',
            lastMessageId: null as number | null,
            lastMessageReadStatus: null as 'sent' | 'delivered' | 'read' | null,
            unreadCount: 0,
          };
        }

        const directConversation = conversations.find(conv =>
          conv.type === 'direct' &&
          conv.participants?.some(p => p.user_id === currentUser.id) &&
          conv.participants?.some(p => p.user_id === user.id)
        );

        // Find the last message in this conversation that was sent by current user
        // Sort messages by sent_at descending and find the first one sent by current user
        const lastOwnMessage = messages
          .filter(msg =>
            msg.conversation_id === directConversation?.id &&
            msg.sender_id === currentUser.id &&
            !msg.is_deleted
          )
          .sort((a, b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime())[0];

        let lastMessageReadStatus: 'sent' | 'delivered' | 'read' | null = null;
        if (lastOwnMessage && directConversation) {
          // Check read status for the last message
          const otherParticipant = directConversation.participants?.find(
            p => p.user_id !== currentUser.id
          );

          if (otherParticipant) {
            const hasRead = lastOwnMessage.read_receipts?.some(
              rr => rr.user_id === otherParticipant.user_id
            );
            lastMessageReadStatus = hasRead ? 'read' : 'delivered';
          } else {
            lastMessageReadStatus = 'sent';
          }
        }

        return {
          user,
          lastMessageAt: directConversation?.last_message_at || null,
          lastMessagePreview: directConversation?.last_message_preview || '',
          lastMessageId: lastOwnMessage?.id || null,
          lastMessageReadStatus,
          unreadCount: directConversation?.unread_count || 0,
        };
      })
      .sort((a, b) => {
        if (a.lastMessageAt && b.lastMessageAt) {
          return new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime();
        }
        if (a.lastMessageAt) return -1;
        if (b.lastMessageAt) return 1;
        return 0;
      });
  }, [filteredUsers, conversations, currentUser, messages]);

  const displayMessages = useMemo(() => {
    const q = chatSearchQuery.trim().toLowerCase();
    if (!q) return messages;
    return messages.filter(m => {
      const t = (m.content || '').toLowerCase();
      const a = (m.attachment_name || '').toLowerCase();
      return t.includes(q) || a.includes(q);
    });
  }, [messages, chatSearchQuery]);

  const sidebarContactRowsUnread = useMemo(
    () => contactsWithLastMessage.filter(c => c.unreadCount > 0),
    [contactsWithLastMessage]
  );
  const sidebarContactRowsRecent = useMemo(
    () => contactsWithLastMessage.filter(c => c.unreadCount === 0),
    [contactsWithLastMessage]
  );
  const sidebarGroupsUnread = useMemo(
    () => filteredGroupConversations.filter(c => (c.unread_count || 0) > 0),
    [filteredGroupConversations]
  );
  const sidebarGroupsRecent = useMemo(
    () => filteredGroupConversations.filter(c => (c.unread_count || 0) === 0),
    [filteredGroupConversations]
  );

  type SidebarContactRow = (typeof contactsWithLastMessage)[number];
  const sidebarContactFlat = useMemo(() => {
    const items: Array<{ kind: 'section'; title: string } | { kind: 'row'; data: SidebarContactRow }> = [];
    if (sidebarContactRowsUnread.length) {
      items.push({ kind: 'section', title: 'Unread' });
      sidebarContactRowsUnread.forEach(r => items.push({ kind: 'row', data: r }));
    }
    if (sidebarContactRowsRecent.length) {
      items.push({ kind: 'section', title: 'Recent' });
      sidebarContactRowsRecent.forEach(r => items.push({ kind: 'row', data: r }));
    }
    return items;
  }, [sidebarContactRowsUnread, sidebarContactRowsRecent]);

  const sidebarGroupsFlat = useMemo(() => {
    const items: Array<{ kind: 'section'; title: string } | { kind: 'row'; conversation: Conversation }> = [];
    if (sidebarGroupsUnread.length) {
      items.push({ kind: 'section', title: 'Unread' });
      sidebarGroupsUnread.forEach(c => items.push({ kind: 'row', conversation: c }));
    }
    if (sidebarGroupsRecent.length) {
      items.push({ kind: 'section', title: 'Recent' });
      sidebarGroupsRecent.forEach(c => items.push({ kind: 'row', conversation: c }));
    }
    return items;
  }, [sidebarGroupsUnread, sidebarGroupsRecent]);

  useEffect(() => {
    if (!selectedConversation?.id || !currentUser?.id) {
      pinnedMessagesLoadSeqRef.current += 1;
      setRmqPinnedRows([]);
      setRmqPinnedLoading(false);
      return;
    }
    // Clear immediately so the strip does not show the previous chat’s pins while loading.
    setRmqPinnedRows([]);
    loadRmqPinnedMessages(selectedConversation.id);
  }, [selectedConversation?.id, currentUser?.id, loadRmqPinnedMessages]);

  useEffect(() => {
    if (!selectedConversation?.id) {
      setRmqMessageLeadFlags([]);
      return;
    }
    void loadRmqMessageLeadFlags(selectedConversation.id);
  }, [selectedConversation?.id, loadRmqMessageLeadFlags]);

  useEffect(() => {
    if (!selectedConversation?.id) {
      setRmqMessageCommentCounts({});
      return;
    }
    loadRmqMessageCommentCounts(selectedConversation.id);
  }, [selectedConversation?.id, loadRmqMessageCommentCounts]);

  useEffect(() => {
    setRmqMessageCommentsModal(null);
  }, [selectedConversation?.id]);

  useEffect(() => {
    setPendingMediaDraft(prev => {
      if (prev) prev.forEach(p => URL.revokeObjectURL(p.previewUrl));
      return null;
    });
  }, [selectedConversation?.id]);

  /** Wrapper only when there are pins to show (no empty loading strip while switching chats). */
  const hasPinnedMessagesStrip = rmqPinnedRows.length > 0;

  const renderPinnedMessagesStrip = (opts?: { forMobile?: boolean }) => {
    if (!rmqPinnedLoading && rmqPinnedRows.length === 0) return null;
    // Avoid an empty “Pinned messages” strip + spinner when switching chats (load is in-flight, rows cleared).
    if (rmqPinnedLoading && rmqPinnedRows.length === 0) return null;
    const forMobile = opts?.forMobile;
    const textMuted = chatBackgroundImageUrl ? 'text-white/85' : 'text-base-content/75';
    const boxBg = chatBackgroundImageUrl
      ? 'bg-black/30 backdrop-blur-md border border-white/25'
      : forMobile
        ? 'bg-white/95 border border-gray-200 shadow-sm'
        : 'bg-base-200/95 border border-base-300';
    return (
      <div className={`w-full px-3 py-2 rounded-xl shadow-sm ${boxBg}`}>
        <div className="flex items-center gap-2 mb-1.5">
          <BookmarkIcon className="w-4 h-4 shrink-0 text-amber-500" />
          <span className={`text-xs font-semibold uppercase tracking-wide ${textMuted}`}>Pinned messages</span>
          {rmqPinnedLoading && <span className="loading loading-spinner loading-xs" />}
        </div>
        <div className="flex flex-col gap-1.5 max-h-36 overflow-y-auto">
          {rmqPinnedRows.map(row => {
            const sender =
              row.message.sender?.tenants_employee?.display_name ||
              row.message.sender?.full_name ||
              'User';
            const preview = (() => {
              const t = (row.message.content || '').trim();
              if (t) return t.length > 120 ? `${t.slice(0, 120)}…` : t;
              if (row.message.message_type === 'album' && row.message.media_attachments?.length) {
                return `🖼️ ${row.message.media_attachments.length} media`;
              }
              if (row.message.message_type === 'image') return '📷 Image';
              if (row.message.message_type === 'voice') return '🎤 Voice message';
              if (row.message.attachment_name) return `📎 ${row.message.attachment_name}`;
              return 'Message';
            })();
            return (
              <div
                key={row.pinRowId}
                className={`flex items-start gap-2 rounded-lg px-2 py-1.5 ${
                  chatBackgroundImageUrl ? 'bg-white/10' : forMobile ? 'bg-gray-100' : 'bg-base-100'
                }`}
              >
                <button
                  type="button"
                  className="flex-1 text-left min-w-0"
                  onClick={() => {
                    scrollToMessageInChat(row.message.id);
                  }}
                >
                  <span className={`text-xs font-medium ${textMuted}`}>{sender}</span>
                  <p
                    className={`text-sm line-clamp-2 ${
                      chatBackgroundImageUrl ? 'text-white' : 'text-base-content'
                    }`}
                  >
                    {preview}
                  </p>
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs btn-circle shrink-0"
                  title="Unpin"
                  onClick={() => togglePinMessage(row.message)}
                >
                  <XMarkIcon className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const handleRmqAiSuggestions = useCallback(async () => {
    if (!selectedConversation || !currentUser || rmqAiLoading) return;
    setRmqAiLoading(true);
    setShowRmqAiPanel(true);
    try {
      const requestType = newMessage.trim() ? 'improve' : 'suggest';
      const history = messages.slice(-12).map(msg => ({
        id: msg.id,
        sender_name: msg.sender?.tenants_employee?.display_name || msg.sender?.full_name || 'User',
        content: msg.content || '',
        sent_at: msg.sent_at,
        is_own: msg.sender_id === currentUser.id
      }));
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/rmq-ai-suggestions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          currentMessage: newMessage.trim(),
          conversationHistory: history,
          requestType,
        }),
      });
      const result = await response.json();
      if (result.success && result.suggestion) {
        setRmqAiSuggestions([String(result.suggestion).trim()]);
      } else {
        if (result.code === 'OPENAI_QUOTA') {
          toast.error('AI quota exceeded.');
          setRmqAiSuggestions(['AI is temporarily unavailable (quota).']);
        } else {
          throw new Error(result.error || 'AI failed');
        }
      }
    } catch (e) {
      console.error(e);
      toast.error('AI suggestions unavailable.');
      setRmqAiSuggestions(['AI suggestions are not available right now.']);
    } finally {
      setRmqAiLoading(false);
    }
  }, [selectedConversation, currentUser, rmqAiLoading, newMessage, messages]);

  const applyRmqAiSuggestion = useCallback((text: string) => {
    setNewMessage(text);
    setShowRmqAiPanel(false);
    setRmqAiSuggestions([]);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const totalUnread = conversations.reduce((sum, conv) => sum + (conv.unread_count || 0), 0);
    window.dispatchEvent(new CustomEvent('rmq:unread-count', { detail: { count: totalUnread } }));
  }, [conversations]);

  // Show contact/group list boxes only during initial page load (conversations loading).
  // Once the list has been shown once, keep it visible — do not show loading again on background refetch or when switching chats.
  const isSidebarReady = useMemo(
    () => !isLoading && !isFetchingConversations,
    [isLoading, isFetchingConversations]
  );
  const [hasSidebarBeenReady, setHasSidebarBeenReady] = useState(false);
  useEffect(() => {
    if (isSidebarReady) setHasSidebarBeenReady(true);
  }, [isSidebarReady]);
  useEffect(() => {
    if (!isOpen) setHasSidebarBeenReady(false);
  }, [isOpen]);
  const showSidebarList = hasSidebarBeenReady || isSidebarReady;

  // Global styles for glassy white video controls
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      /* Glassy white video controls styling */
      video::-webkit-media-controls-panel {
        background: rgba(255, 255, 255, 0.15) !important;
        backdrop-filter: blur(15px) saturate(180%) !important;
        -webkit-backdrop-filter: blur(15px) saturate(180%) !important;
        border-radius: 12px !important;
        padding: 10px 12px !important;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1) !important;
      }
      
      video::-webkit-media-controls-play-button,
      video::-webkit-media-controls-mute-button,
      video::-webkit-media-controls-fullscreen-button {
        filter: brightness(0) invert(1) !important;
        color: white !important;
        opacity: 0.95 !important;
      }
      
      video::-webkit-media-controls-timeline {
        background: rgba(255, 255, 255, 0.3) !important;
        border-radius: 2px !important;
        height: 4px !important;
      }
      
      video::-webkit-media-controls-timeline::-webkit-slider-thumb {
        background: white !important;
        border: 2px solid rgba(255, 255, 255, 0.8) !important;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2) !important;
      }
      
      video::-webkit-media-controls-current-time-display,
      video::-webkit-media-controls-time-remaining-display {
        color: white !important;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3) !important;
        font-weight: 500 !important;
      }
      
      video::-webkit-media-controls-volume-slider {
        background: rgba(255, 255, 255, 0.3) !important;
      }
      
      video::-webkit-media-controls-volume-slider::-webkit-slider-thumb {
        background: white !important;
        border: 2px solid rgba(255, 255, 255, 0.8) !important;
      }
      
      /* Firefox video controls */
      video::-moz-media-controls {
        background: rgba(255, 255, 255, 0.15) !important;
        backdrop-filter: blur(15px) saturate(180%) !important;
        border-radius: 12px !important;
      }
      
      /* Ensure controls are always visible when video is hovered or playing */
      video:hover::-webkit-media-controls-panel,
      video:focus::-webkit-media-controls-panel {
        opacity: 1 !important;
      }
    `;
    document.head.appendChild(style);
    return () => {
      document.head.removeChild(style);
    };
  }, []);

  // Don't render if not open
  if (!isOpen) return null;

  if (isLoading) {
    return (
      <div className="fixed inset-0 z-[300] bg-white dark:bg-gradient-to-br dark:from-[rgba(62,40,205,0.05)] dark:to-[rgba(59,130,246,0.05)]">
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <div className="loading loading-spinner loading-lg text-primary mb-4"></div>
            <p className="text-gray-600 dark:text-gray-300 font-medium">Loading RMQ Messages...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`fixed inset-0 z-[300] bg-white dark:bg-gradient-to-br dark:from-[rgba(62,40,205,0.05)] dark:to-[rgba(59,130,246,0.05)] flex overflow-hidden transition-all duration-200 ${isDragOver ? 'bg-blue-50/50 dark:bg-blue-900/20' : ''
        }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Sidebar - Desktop */}
      <div className="hidden lg:flex w-96 bg-base-100 border-r border-base-300 flex-col shadow-lg">
        {/* Header + Chats / Groups segmented control (grey, inset track + raised active pill) */}
        <div className="bg-base-100 px-4 pt-4 pb-3 border-b border-base-300/60">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-3">
              {activeTab === 'groups' && (
                <button
                  type="button"
                  onClick={() => setShowCreateGroupModal(true)}
                  className="btn btn-ghost btn-circle btn-sm shrink-0 text-base-content/70 hover:bg-base-200"
                  title="Create Group"
                >
                  <PlusIcon className="w-6 h-6" style={{ color: '#3E28CD' }} />
                </button>
              )}
              <ChatBubbleLeftRightIcon className="h-8 w-8 shrink-0" style={{ color: '#3E28CD' }} />
              <h1 className="min-w-0 truncate text-xl font-bold text-base-content">RMQ Messages</h1>
            </div>
          </div>
          <div
            className="flex gap-0.5 rounded-lg border border-base-300/80 bg-[#e8e8ea] p-0.5 shadow-[inset_0_1px_3px_rgba(0,0,0,0.08)] dark:border-base-content/10 dark:bg-base-300/60 dark:shadow-[inset_0_2px_5px_rgba(0,0,0,0.22)]"
            role="tablist"
            aria-label="Conversation type"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'chats'}
              onClick={() => setActiveTab('chats')}
              className={`flex min-h-[2rem] flex-1 items-center justify-center gap-1 rounded-md px-2 text-xs font-medium transition-all duration-200 ${
                activeTab === 'chats' ? RMQ_TAB_ACTIVE : 'text-base-content/50 hover:text-base-content/75'
              }`}
            >
              <span>Chats</span>
              <span
                className={`rounded px-1 py-px text-[10px] font-semibold tabular-nums ${
                  activeTab === 'chats' ? RMQ_TAB_ACTIVE_COUNT : 'bg-black/[0.06] text-base-content/45 dark:bg-white/10'
                }`}
              >
                {allUsers.length}
              </span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'groups'}
              onClick={() => setActiveTab('groups')}
              className={`flex min-h-[2rem] flex-1 items-center justify-center gap-1 rounded-md px-2 text-xs font-medium transition-all duration-200 ${
                activeTab === 'groups' ? RMQ_TAB_ACTIVE : 'text-base-content/50 hover:text-base-content/75'
              }`}
            >
              <span>Groups</span>
              {filteredGroupConversations.length > 0 ? (
                <span
                  className={`rounded px-1 py-px text-[10px] font-semibold tabular-nums ${
                    activeTab === 'groups' ? RMQ_TAB_ACTIVE_COUNT : 'bg-black/[0.06] text-base-content/45 dark:bg-white/10'
                  }`}
                >
                  {filteredGroupConversations.length}
                </span>
              ) : null}
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="px-4 pt-1 pb-2 border-b border-base-300 bg-base-100">
          <div className="relative">
            <MagnifyingGlassIcon
              className="pointer-events-none absolute left-3 top-1/2 z-10 h-5 w-5 -translate-y-1/2 text-base-content/60"
              strokeWidth={2}
              aria-hidden
            />
            <input
              type="search"
              placeholder="Search"
              className="input input-bordered relative z-0 w-full pl-10 input-sm"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search"
            />
          </div>
        </div>

        {/* Content Area - boxes show only when ready */}
        <div className="flex-1 overflow-y-auto bg-base-100">
          {!showSidebarList ? (
            <div className="p-6 flex flex-col items-center justify-center text-base-content/60 gap-3 min-h-[200px]">
              <span className="loading loading-spinner loading-md" />
              <p className="text-sm">Loading...</p>
            </div>
          ) : (
          <>
          {activeTab === 'chats' ? (
            contactsWithLastMessage.length === 0 ? (
              <div className="p-6 text-center text-base-content/70">
                <UserIcon className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="font-medium">No contacts found</p>
                <p className="text-sm">Try adjusting your search</p>
              </div>
            ) : (
              sidebarContactFlat.map((item) => {
                if (item.kind === 'section') {
                  return (
                    <div
                      key={`rmq-sec-${item.title}`}
                      className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-base-content/45"
                    >
                      {item.title}
                    </div>
                  );
                }
                const { user, lastMessageAt, lastMessagePreview, lastMessageReadStatus, unreadCount } = item.data;
                const rawDisplayName = user.tenants_employee?.display_name || user.full_name;
                const userName = (rawDisplayName && rawDisplayName.trim().length > 1)
                  ? rawDisplayName.trim()
                  : `User ${user.id.slice(-4)}`;

                const userPhoto = user.tenants_employee?.photo_url;
                const hasCompleteInfo = user.tenants_employee && user.tenants_employee.display_name;
                const isUnavailable = contactAvailabilityMap[user.tenants_employee?.display_name || ''] || false;
                const isOnline = onlineUsers.has(String(user.id));
                const isSelectedContact = selectedConversation?.type === 'direct' && selectedConversation.participants?.some(p => p.user_id === user.id);

                const contactListTitle =
                  !hasCompleteInfo && !user.tenants_employee?.bonuses_role && !user.tenants_employee?.tenant_departement?.name
                    ? `${userName} · Profile incomplete`
                    : userName;
                const nameDir = getTextDirection(userName || '');
                const previewDir = getTextDirection(lastMessagePreview || '');
                return (
                  <div
                    key={user.id}
                    onClick={() => startDirectConversation(user.id)}
                    className={`min-h-[72px] px-4 py-3 cursor-pointer transition-all duration-150 ${
                      isSelectedContact
                        ? `${RMQ_SEL_ROW} hover:brightness-[0.99]`
                        : 'bg-base-100 hover:bg-base-200 hover:shadow-sm dark:hover:bg-base-300/55'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="relative shrink-0">
                        {renderUserAvatar({
                          userId: user.id,
                          name: userName,
                          photoUrl: userPhoto,
                          sizeClass: 'w-12 h-12',
                          borderClass: '',
                          textClass: 'text-sm',
                        })}
                        {isUnavailable && (
                            <div className={`absolute -top-0.5 -right-0.5 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center border-2 ${isSelectedContact ? 'border-[#EDE9F8] dark:border-[#3E28CD]/40' : 'border-base-100'}`}>
                              <ClockIcon className="w-3 h-3 text-white" />
                            </div>
                          )}
                        {!isUnavailable && isOnline && (
                          <div className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 bg-emerald-500 ${isSelectedContact ? 'border-[#EDE9F8] dark:border-[#3E28CD]/50' : 'border-base-100'}`} title="Online" />
                        )}
                      </div>

                      <div className="min-w-0 flex-1 py-0.5">
                        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-0.5">
                          <span
                            className={`min-w-0 truncate text-sm font-semibold ${isSelectedContact ? RMQ_SEL_TITLE : 'text-base-content'}`}
                            title={contactListTitle}
                            dir={nameDir}
                            style={contactSidebarTextStyle(nameDir, userName || '')}
                          >
                            {userName || `User ${user.id.slice(-4)}`}
                          </span>
                          <span
                            className={`shrink-0 text-right text-[11px] tabular-nums whitespace-nowrap ${isSelectedContact ? RMQ_SEL_TIME : 'text-base-content/45'}`}
                            dir="ltr"
                          >
                            {lastMessageAt ? formatSidebarConversationTime(lastMessageAt) : ''}
                          </span>
                          {!hasCompleteInfo && (
                            <span className={`col-span-2 inline-block rounded px-1.5 py-0.5 text-[10px] w-fit ${isSelectedContact ? 'bg-[#3E28CD]/12 text-orange-900 dark:bg-white/10 dark:text-orange-200' : 'text-orange-600 dark:text-orange-400'}`}>
                              Incomplete
                            </span>
                          )}
                          <p
                            className={`min-w-0 truncate text-sm leading-snug ${isSelectedContact ? RMQ_SEL_PREVIEW : 'text-base-content/70'}`}
                            dir={previewDir}
                            style={contactSidebarTextStyle(previewDir, lastMessagePreview || '')}
                          >
                            {lastMessagePreview || ''}
                          </p>
                          <div className="flex shrink-0 flex-col items-end justify-start gap-0.5">
                            {unreadCount > 0 ? (
                              <span
                                className="flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-[10px] font-semibold text-white"
                                style={{ backgroundColor: '#3E28CD' }}
                                title={`${unreadCount} unread`}
                              >
                                {unreadCount > 99 ? '99+' : unreadCount}
                              </span>
                            ) : null}
                            {lastMessageReadStatus ? (
                              <div className="flex-shrink-0">{renderSidebarReadReceipts(lastMessageReadStatus, isSelectedContact, 'h-3.5 w-3.5')}</div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )
          ) : (
            filteredGroupConversations.length === 0 ? (
              <div className="p-6 text-center text-base-content/70">
                <UserGroupIcon className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="font-medium">No group chats yet</p>
                <p className="text-sm">Use the button above to create one</p>
              </div>
            ) : (
              sidebarGroupsFlat.map((item) => {
                if (item.kind === 'section') {
                  return (
                    <div
                      key={`rmq-grp-${item.title}`}
                      className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-base-content/45"
                    >
                      {item.title}
                    </div>
                  );
                }
                const conversation = item.conversation;
                const isSelectedGroup = selectedConversation?.id === conversation.id;
                const groupTitleText = getConversationTitle(conversation);
                const groupTitleDir = getTextDirection(groupTitleText);
                const groupPreviewText = conversation.last_message_preview || '';
                const groupPreviewDir = getTextDirection(groupPreviewText);
                return (
                <div
                  key={conversation.id}
                  onClick={() => {
                    setMessages([]);
                    setIsLoadingMessages(true);
                    selectConversation(conversation);
                    fetchMessages(conversation.id, false);
                    setShowMobileConversations(false);
                  }}
                  className={`p-4 cursor-pointer transition-all duration-150 ${
                    isSelectedGroup
                      ? `${RMQ_SEL_ROW} hover:brightness-[0.99]`
                      : 'bg-base-100 hover:bg-base-200 hover:shadow-sm dark:hover:bg-base-300/55'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {getConversationAvatar(conversation, 'large')}
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 items-start">
                        <h3
                          className={`min-w-0 truncate font-semibold ${isSelectedGroup ? RMQ_SEL_TITLE : 'text-base-content'}`}
                          dir={groupTitleDir}
                          style={contactSidebarTextStyle(groupTitleDir, groupTitleText)}
                        >
                          {groupTitleText}
                        </h3>
                        <span className={`shrink-0 text-right text-xs tabular-nums whitespace-nowrap ${isSelectedGroup ? RMQ_SEL_TIME : 'text-base-content/70'}`} dir="ltr">
                          {formatSidebarConversationTime(conversation.last_message_at)}
                        </span>
                        <p
                          className={`min-w-0 truncate text-sm ${isSelectedGroup ? RMQ_SEL_PREVIEW : 'text-base-content/80'}`}
                          dir={groupPreviewDir}
                          style={contactSidebarTextStyle(groupPreviewDir, groupPreviewText)}
                        >
                          {groupPreviewText}
                        </p>
                        <div className="flex flex-col items-end justify-start gap-0.5 shrink-0">
                          {(conversation.unread_count || 0) > 0 && (
                            <div className="flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1 text-xs font-bold text-white" style={{ backgroundColor: '#3E28CD' }}>
                              {conversation.unread_count}
                            </div>
                          )}
                        </div>
                      </div>
                      <p className={`text-xs ${isSelectedGroup ? RMQ_SEL_META : 'text-base-content/60'}`} dir="ltr">
                        {conversation.participants?.length || 0} members
                      </p>
                    </div>
                  </div>
                </div>
              ); })
            )
          )}
          </>
          )}
        </div>
      </div>

      {/* Mobile Sidebar: header + search stay fixed; tabs + list scroll together */}
      <div className={`lg:hidden ${showMobileConversations ? 'flex' : 'hidden'} flex-1 min-h-0 w-full flex-col bg-base-100`}>
        <div className="shrink-0 border-b border-base-300/60 bg-white px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              {activeTab === 'groups' && (
                <button
                  type="button"
                  onClick={() => setShowCreateGroupModal(true)}
                  className="btn btn-ghost btn-circle btn-sm shrink-0 text-base-content/70 hover:bg-base-200"
                  title="Create Group"
                >
                  <PlusIcon className="h-5 w-5" style={{ color: '#3E28CD' }} />
                </button>
              )}
              <ChatBubbleLeftRightIcon className="h-7 w-7 shrink-0" style={{ color: '#3E28CD' }} />
              <h1 className="min-w-0 truncate text-lg font-bold text-base-content">Messages</h1>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="btn btn-ghost btn-circle btn-sm shrink-0 text-base-content/60 hover:bg-base-200"
              title="Close Messages"
            >
              <XMarkIcon className="h-7 w-7" />
            </button>
          </div>
        </div>

        <div className="shrink-0 border-b border-base-300 bg-base-100 px-4 pt-1 pb-2">
          <div className="relative">
            <MagnifyingGlassIcon
              className="pointer-events-none absolute left-3 top-1/2 z-10 h-5 w-5 -translate-y-1/2 text-base-content/60"
              strokeWidth={2}
              aria-hidden
            />
            <input
              type="search"
              placeholder="Search"
              className="input input-bordered input-md relative z-0 w-full pl-10 text-base"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-base-100">
          <div
            className="border-b border-base-300/50 bg-base-100 px-4 pb-2 pt-2"
            role="tablist"
            aria-label="Conversation type"
          >
            <div className="flex gap-0.5 rounded-lg border border-base-300/80 bg-[#e8e8ea] p-0.5 shadow-[inset_0_1px_3px_rgba(0,0,0,0.08)] dark:border-base-content/10 dark:bg-base-300/60 dark:shadow-[inset_0_2px_5px_rgba(0,0,0,0.22)]">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'chats'}
                onClick={() => setActiveTab('chats')}
                className={`flex min-h-[2.25rem] flex-1 items-center justify-center gap-1 rounded-md px-2 text-sm font-medium transition-all duration-200 ${
                  activeTab === 'chats' ? RMQ_TAB_ACTIVE : 'text-base-content/50 hover:text-base-content/75'
                }`}
              >
                <span>Chats</span>
                <span
                  className={`rounded px-1 py-px text-[11px] font-semibold tabular-nums ${
                    activeTab === 'chats' ? RMQ_TAB_ACTIVE_COUNT : 'bg-black/[0.06] text-base-content/45 dark:bg-white/10'
                  }`}
                >
                  {allUsers.length}
                </span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'groups'}
                onClick={() => setActiveTab('groups')}
                className={`flex min-h-[2.25rem] flex-1 items-center justify-center gap-1 rounded-md px-2 text-sm font-medium transition-all duration-200 ${
                  activeTab === 'groups' ? RMQ_TAB_ACTIVE : 'text-base-content/50 hover:text-base-content/75'
                }`}
              >
                <span>Groups</span>
                {filteredGroupConversations.length > 0 ? (
                  <span
                    className={`rounded px-1 py-px text-[11px] font-semibold tabular-nums ${
                      activeTab === 'groups' ? RMQ_TAB_ACTIVE_COUNT : 'bg-black/[0.06] text-base-content/45 dark:bg-white/10'
                    }`}
                  >
                    {filteredGroupConversations.length}
                  </span>
                ) : null}
              </button>
            </div>
          </div>

          {/* Mobile Content - boxes show only when ready */}
          {!showSidebarList ? (
            <div className="p-6 flex flex-col items-center justify-center text-base-content/60 gap-3 min-h-[200px]">
              <span className="loading loading-spinner loading-md" />
              <p className="text-sm">Loading...</p>
            </div>
          ) : (
          <>
          {activeTab === 'chats' ? (
            contactsWithLastMessage.length === 0 ? (
              <div className="p-6 text-center text-base-content/70">
                <UserIcon className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="font-medium">No contacts found</p>
                <p className="text-sm">Try adjusting your search</p>
              </div>
            ) : (
              sidebarContactFlat.map((item) => {
                if (item.kind === 'section') {
                  return (
                    <div
                      key={`rmq-m-sec-${item.title}`}
                      className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-base-content/45"
                    >
                      {item.title}
                    </div>
                  );
                }
                const { user, lastMessageAt, lastMessagePreview, lastMessageReadStatus, unreadCount } = item.data;
                const rawDisplayName = user.tenants_employee?.display_name || user.full_name;
                const userName = (rawDisplayName && rawDisplayName.trim().length > 1)
                  ? rawDisplayName.trim()
                  : `User ${user.id.slice(-4)}`;

                const userPhoto = user.tenants_employee?.photo_url;
                const hasCompleteInfo = user.tenants_employee && user.tenants_employee.display_name;
                const isUnavailable = contactAvailabilityMap[user.tenants_employee?.display_name || ''] || false;
                const isOnline = onlineUsers.has(String(user.id));
                const isSelectedContact = selectedConversation?.type === 'direct' && selectedConversation.participants?.some(p => p.user_id === user.id);

                const contactListTitle =
                  !hasCompleteInfo && !user.tenants_employee?.bonuses_role && !user.tenants_employee?.tenant_departement?.name
                    ? `${userName} · Profile incomplete`
                    : userName;
                const nameDirM = getTextDirection(userName || '');
                const previewDirM = getTextDirection(lastMessagePreview || '');
                return (
                  <div
                    key={user.id}
                    onClick={() => startDirectConversation(user.id)}
                    className={`min-h-[84px] px-4 py-3.5 cursor-pointer transition-colors ${
                      isSelectedContact ? `${RMQ_SEL_ROW} hover:brightness-[0.99]` : 'bg-base-100 hover:bg-base-200/70 active:bg-base-200'
                    }`}
                  >
                    <div className="flex items-start gap-3.5">
                      <div className="relative shrink-0">
                        {renderUserAvatar({
                          userId: user.id,
                          name: userName,
                          photoUrl: userPhoto,
                          sizeClass: 'w-14 h-14',
                          borderClass: '',
                          textClass: 'text-base',
                        })}
                        {isUnavailable && (
                          <div className={`absolute -top-0.5 -right-0.5 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center border-2 ${isSelectedContact ? 'border-[#EDE9F8] dark:border-[#3E28CD]/40' : 'border-base-100'}`}>
                            <ClockIcon className="w-3.5 h-3.5 text-white" />
                          </div>
                        )}
                        {!isUnavailable && isOnline && (
                          <div className={`absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 bg-emerald-500 ${isSelectedContact ? 'border-[#EDE9F8] dark:border-[#3E28CD]/50' : 'border-base-100'}`} title="Online" />
                        )}
                      </div>

                      <div className="min-w-0 flex-1 py-0.5">
                        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-0.5">
                          <span
                            className={`min-w-0 truncate text-base font-semibold leading-tight ${isSelectedContact ? RMQ_SEL_TITLE : 'text-base-content'}`}
                            title={contactListTitle}
                            dir={nameDirM}
                            style={contactSidebarTextStyle(nameDirM, userName || '')}
                          >
                            {userName || `User ${user.id.slice(-4)}`}
                          </span>
                          <span
                            className={`shrink-0 text-right text-xs tabular-nums whitespace-nowrap ${isSelectedContact ? RMQ_SEL_TIME : 'text-base-content/45'}`}
                            dir="ltr"
                          >
                            {lastMessageAt ? formatSidebarConversationTime(lastMessageAt) : ''}
                          </span>
                          {!hasCompleteInfo && (
                            <span className={`col-span-2 inline-block rounded px-1.5 py-0.5 text-xs w-fit ${isSelectedContact ? 'bg-[#3E28CD]/12 text-orange-900 dark:bg-white/10 dark:text-orange-200' : 'text-orange-600 dark:text-orange-400'}`}>
                              Incomplete
                            </span>
                          )}
                          <p
                            className={`min-w-0 truncate text-sm leading-snug ${isSelectedContact ? RMQ_SEL_PREVIEW : 'text-base-content/70'}`}
                            dir={previewDirM}
                            style={contactSidebarTextStyle(previewDirM, lastMessagePreview || '')}
                          >
                            {lastMessagePreview || ''}
                          </p>
                          <div className="flex shrink-0 flex-col items-end justify-start gap-0.5">
                            {unreadCount > 0 ? (
                              <span
                                className="flex h-6 min-w-[1.5rem] items-center justify-center rounded-full px-1.5 text-xs font-semibold text-white"
                                style={{ backgroundColor: '#3E28CD' }}
                                title={`${unreadCount} unread`}
                              >
                                {unreadCount > 99 ? '99+' : unreadCount}
                              </span>
                            ) : null}
                            {lastMessageReadStatus ? (
                              <div className="flex-shrink-0">{renderSidebarReadReceipts(lastMessageReadStatus, isSelectedContact, 'h-4 w-4')}</div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )
          ) : (
            filteredGroupConversations.length === 0 ? (
              <div className="p-6 text-center text-base-content/70">
                <UserGroupIcon className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="font-medium">No group chats yet</p>
                <p className="text-sm">Use the button above to create one</p>
              </div>
            ) : (
              sidebarGroupsFlat.map((item) => {
                if (item.kind === 'section') {
                  return (
                    <div
                      key={`rmq-m-grp-${item.title}`}
                      className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-base-content/45"
                    >
                      {item.title}
                    </div>
                  );
                }
                const conversation = item.conversation;
                const isSelectedGroup = selectedConversation?.id === conversation.id;
                const groupTitleTextM = getConversationTitle(conversation);
                const groupTitleDirM = getTextDirection(groupTitleTextM);
                const groupPreviewTextM = conversation.last_message_preview || '';
                const groupPreviewDirM = getTextDirection(groupPreviewTextM);
                return (
                <div
                  key={conversation.id}
                  onClick={() => {
                    setMessages([]);
                    setIsLoadingMessages(true);
                    selectConversation(conversation);
                    fetchMessages(conversation.id, false);
                    setShowMobileConversations(false);
                  }}
                  className={`px-4 py-4 cursor-pointer transition-colors ${
                    isSelectedGroup ? `${RMQ_SEL_ROW} hover:brightness-[0.99]` : 'bg-base-100 hover:bg-base-200/70 active:bg-base-200'
                  }`}
                >
                  <div className="flex items-center gap-3.5">
                    {getConversationAvatar(conversation, 'xlarge')}
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 items-start">
                        <h3
                          className={`min-w-0 truncate text-lg font-semibold leading-tight ${isSelectedGroup ? RMQ_SEL_TITLE : 'text-base-content'}`}
                          dir={groupTitleDirM}
                          style={contactSidebarTextStyle(groupTitleDirM, groupTitleTextM)}
                        >
                          {groupTitleTextM}
                        </h3>
                        <span className={`shrink-0 text-right text-sm tabular-nums whitespace-nowrap ${isSelectedGroup ? RMQ_SEL_TIME : 'text-base-content/70'}`} dir="ltr">
                          {formatSidebarConversationTime(conversation.last_message_at)}
                        </span>
                        <p
                          className={`min-w-0 truncate text-base leading-snug ${isSelectedGroup ? RMQ_SEL_PREVIEW : 'text-base-content/80'}`}
                          dir={groupPreviewDirM}
                          style={contactSidebarTextStyle(groupPreviewDirM, groupPreviewTextM)}
                        >
                          {groupPreviewTextM}
                        </p>
                        <div className="flex flex-col items-end justify-start gap-0.5 shrink-0">
                          {(conversation.unread_count || 0) > 0 && (
                            <div className="flex min-w-[1.5rem] h-6 items-center justify-center rounded-full px-1 text-xs font-bold text-white" style={{ backgroundColor: '#3E28CD' }}>
                              {conversation.unread_count}
                            </div>
                          )}
                        </div>
                      </div>
                      <p className={`text-sm ${isSelectedGroup ? RMQ_SEL_META : 'text-base-content/60'}`} dir="ltr">
                        {conversation.participants?.length || 0} members
                      </p>
                    </div>
                  </div>
                </div>
              ); })
            )
          )}
          </>
          )}
        </div>
      </div>

      {/* Chat Area - Desktop Only - min-h-0 so messages area can shrink and scroll above input */}
      <div className="hidden lg:flex flex-1 flex-col relative min-h-0">
        {selectedConversation ? (
          <>
            {/* Chat Header */}
            {(() => {
              return (
            <div className="relative z-20 w-full flex-shrink-0 border-b border-base-200/90 bg-base-100 py-1.5 px-2 shadow-sm">
              <div className="relative grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1">
                <div className="flex items-center gap-2 min-w-0 justify-self-start">
                  <button
                    onClick={() => setShowMobileConversations(true)}
                    className="lg:hidden btn btn-ghost btn-sm btn-circle"
                  >
                    <ArrowLeftIcon className="w-5 h-5" />
                  </button>
                  {getConversationAvatar(selectedConversation, 'large')}
                  <div className="flex-1 min-w-0">
                    {selectedConversation.type === 'direct' ? (
                      (() => {
                        const op = selectedConversation.participants?.find(p => p.user_id !== currentUser?.id);
                        if (op?.user) {
                          const otherUserId = op.user.id ? String(op.user.id) : null;
                          const isOnline = otherUserId ? onlineUsers.has(otherUserId) : false;
                          if (otherUserId && process.env.NODE_ENV === 'development') {
                          }

                          const peerRole = getRoleDisplayName(op.user.tenants_employee?.bonuses_role || '');
                          return (
                            <>
                              <div className="flex flex-wrap items-center gap-2 text-base-content">
                                <h2 className="font-semibold text-sm">
                                  {getConversationTitle(selectedConversation)}
                                </h2>
                              </div>
                              {!isEmployeeUnavailable ? (
                                <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-base-content/65">
                                  <span className={isOnline ? 'font-medium text-emerald-600' : 'text-base-content/50'}>
                                    {isOnline ? '● Online' : '● Offline'}
                                  </span>
                                  <span className="text-base-content/30" aria-hidden>
                                    ·
                                  </span>
                                  <span className="text-base-content/75">{peerRole || 'Member'}</span>
                                  {!isOnline && otherUserId && lastOnlineTimes.has(otherUserId) && (
                                    <>
                                      <span className="text-base-content/30" aria-hidden>
                                        ·
                                      </span>
                                      <span className="text-base-content/55">
                                        Last {formatLastOnlineTime(lastOnlineTimes.get(otherUserId)!)}
                                      </span>
                                    </>
                                  )}
                                </p>
                              ) : null}
                              {isEmployeeUnavailable && (
                                <div className="flex items-center gap-1.5 px-2 py-1 bg-orange-100 dark:bg-orange-900/30 rounded-full mt-1 w-fit" title={unavailabilityReason || 'Currently unavailable'}>
                                  <ClockIcon className="w-4 h-4 text-orange-600 dark:text-orange-400" />
                                  <span className="text-sm font-medium text-orange-700 dark:text-orange-400">
                                    Unavailable{unavailabilityTimePeriod ? ` (${unavailabilityTimePeriod})` : ''}
                                  </span>
                                </div>
                              )}
                            </>
                          );
                        }
                        return (
                          <>
                            <h2 className="font-semibold text-sm text-base-content">
                              {getConversationTitle(selectedConversation)}
                            </h2>
                            <p className="text-xs text-base-content/90">Direct message</p>
                          </>
                        );
                      })()
                    ) : (
                      <>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h2 className="font-semibold text-sm text-gray-900">
                            {getConversationTitle(selectedConversation)}
                          </h2>
                          {selectedConversation.participants && selectedConversation.participants.length > 0 && (
                            <button
                              onClick={() => setShowDesktopGroupMembers(!showDesktopGroupMembers)}
                              className="flex items-center gap-1 px-1.5 py-0.5 rounded-lg text-xs font-medium text-gray-700 hover:bg-base-200 transition-colors"
                              title={showDesktopGroupMembers ? 'Hide members' : 'Show members'}
                            >
                              <span>{selectedConversation.participants.length} {selectedConversation.participants.length === 1 ? 'member' : 'members'}</span>
                              {showDesktopGroupMembers ? (
                                <ChevronUpIcon className="w-4 h-4" />
                              ) : (
                                <ChevronDownIcon className="w-4 h-4" />
                              )}
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
                <div className="relative w-[min(240px,36vw)] min-w-[160px] max-w-[min(320px,50vw)] justify-self-center px-1">
                  <MagnifyingGlassIcon
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-base-content/35"
                    aria-hidden
                  />
                  <input
                    type="search"
                    placeholder="Search in chat"
                    value={chatSearchQuery}
                    onChange={e => setChatSearchQuery(e.target.value)}
                    aria-label="Search messages in this chat"
                    className="w-full rounded-full border border-base-300/50 bg-base-200/35 py-1.5 pl-9 pr-3 text-sm text-base-content shadow-none outline-none ring-0 transition-[background-color,box-shadow,border-color] placeholder:text-base-content/40 placeholder:text-sm focus:border-primary/35 focus:bg-base-100/80 focus:shadow-[inset_0_0_0_1px_rgba(62,40,205,0.12)] dark:bg-base-300/25 dark:focus:bg-base-200/50"
                  />
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end justify-self-end min-w-0">
                  <div className="dropdown dropdown-end">
                    <label tabIndex={0} className="btn btn-ghost btn-sm btn-circle relative text-amber-700 hover:bg-amber-500/15" title="Flags on this chat">
                      <FlagIcon className="w-5 h-5" />
                      {rmqMessageLeadFlags.length > 0 && (
                        <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-amber-600 px-1 text-[10px] font-bold text-white">
                          {rmqMessageLeadFlags.length > 99 ? '99+' : rmqMessageLeadFlags.length}
                        </span>
                      )}
                    </label>
                    <ul
                      tabIndex={0}
                      className="dropdown-content z-[300] menu max-h-72 min-w-[14rem] overflow-y-auto rounded-box border border-base-300 bg-base-100 p-2 shadow-lg"
                    >
                      {rmqMessageLeadFlagsLoading ? (
                        <li className="px-2 py-1 text-sm text-base-content/60">Loading…</li>
                      ) : rmqMessageLeadFlags.length === 0 ? (
                        <li className="px-2 py-1 text-sm text-base-content/60">No message flags yet</li>
                      ) : (
                        rmqMessageLeadFlags.map(f => (
                          <li key={f.id} className="py-1">
                            <div className="flex flex-col gap-1 rounded-lg px-2 py-1.5 hover:bg-base-200">
                              <button
                                type="button"
                                className="text-left text-sm"
                                onClick={() => scrollToMessage(f.message_id, 'smooth')}
                              >
                                <span className="font-semibold text-base-content">
                                  {flagTypeLabel(f.flag_type, rmqMessageFlagTypes)} · #{f._leadNum || '—'}
                                </span>
                                <span className="block text-[11px] text-base-content/55">
                                  {rmqFlaggerDisplayName(f)} · {formatRmqFlagCreatedAt(f.created_at)}
                                </span>
                              </button>
                              {currentUser?.id === f.user_id && (
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-xs text-error self-start"
                                  onClick={() => void removeRmqMessageLeadFlagRow(f.id)}
                                >
                                  Remove my flag
                                </button>
                              )}
                            </div>
                          </li>
                        ))
                      )}
                    </ul>
                  </div>
                  {/* Background Image Upload Button */}
                  <button
                    onClick={() => backgroundImageInputRef.current?.click()}
                    disabled={isUploadingBackground}
                    className="btn btn-ghost btn-sm btn-circle text-base-content/70 hover:bg-base-200"
                    title="Upload chat background image"
                  >
                    {isUploadingBackground ? (
                      <div className="loading loading-spinner loading-sm"></div>
                    ) : (
                      <PhotoIcon className="w-5 h-5" />
                    )}
                  </button>
                  {chatBackgroundImageUrl && (
                    <button
                      onClick={resetBackgroundToDefault}
                      disabled={isUploadingBackground}
                      className="btn btn-ghost btn-sm btn-circle text-base-content/70 hover:bg-base-200"
                      title="Reset to default white background"
                    >
                      <ArrowPathIcon className="w-5 h-5" />
                    </button>
                  )}
                  <input
                    ref={backgroundImageInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleBackgroundImageInputChange}
                    className="hidden"
                  />
                  {/* Add/Remove Member Buttons for Group Chats */}
                  {selectedConversation.type === 'group' && (
                    <>
                      {/* Lock/Unlock button - only visible to superusers */}
                      {isSuperUser && (
                        <button
                          onClick={() => toggleGroupLock(selectedConversation.id)}
                          className={`btn btn-ghost btn-sm btn-circle ${isGroupLocked(selectedConversation)
                            ? 'text-yellow-600 hover:bg-yellow-500/20'
                            : 'text-base-content/70 hover:bg-base-200'
                            }`}
                          title={isGroupLocked(selectedConversation) ? "Unlock Group" : "Lock Group"}
                        >
                          {isGroupLocked(selectedConversation) ? (
                            <LockClosedIcon className="w-5 h-5" />
                          ) : (
                            <LockOpenIcon className="w-5 h-5" />
                          )}
                        </button>
                      )}
                      {/* Only show Add/Remove buttons if group is not locked, or if superuser for locked groups */}
                      {(!isGroupLocked(selectedConversation) || isSuperUser) && (
                        <>
                          <button
                            onClick={() => setShowAddMemberModal(true)}
                            className="btn btn-ghost btn-sm btn-circle text-base-content/70 hover:bg-base-200"
                            title="Add Members"
                          >
                            <PlusIcon className="w-5 h-5" />
                          </button>
                          <button
                            onClick={() => setShowRemoveMemberModal(true)}
                            className="btn btn-ghost btn-sm btn-circle text-base-content/70 hover:bg-base-200"
                            title="Remove Members"
                          >
                            <UserIcon className="w-5 h-5" />
                          </button>
                        </>
                      )}
                      {/* Delete button only for superusers */}
                      {isSuperUser && (
                        <button
                          onClick={() => setShowDeleteGroupModal(true)}
                          className="btn btn-ghost btn-sm btn-circle text-red-500 hover:bg-red-500/20"
                          title="Delete Group Chat"
                        >
                          <TrashIcon className="w-5 h-5" />
                        </button>
                      )}
                    </>
                  )}
                  <button
                    onClick={onClose}
                    className="btn btn-ghost btn-circle text-base-content/70 hover:bg-base-200"
                    title="Close Messages"
                  >
                    <XMarkIcon className="w-7 h-7" />
                  </button>
                </div>
              </div>

              {/* Group Members List - Desktop (collapsed by default, toggled via header "X members" dropdown) */}
              {selectedConversation.type === 'group' && selectedConversation.participants && selectedConversation.participants.length > 0 && showDesktopGroupMembers && (
                <div className="mt-2 border-t border-base-300 pt-2">
                  <div className="px-2 pb-2">
                      <div className="overflow-x-auto scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100">
                        <div className="flex gap-4 pb-2 min-w-max">
                          {selectedConversation.participants.map((participant) => {
                            const userName = participant.user?.tenants_employee?.display_name ||
                              participant.user?.full_name ||
                              `User ${participant.user_id?.slice(-4)}`;
                            const userPhoto = participant.user?.tenants_employee?.photo_url;
                            const isCurrentUser = participant.user_id === currentUser?.id;

                            return (
                              <div
                                key={participant.id}
                                onClick={() => !isCurrentUser && startDirectConversation(participant.user_id)}
                                className={`flex flex-col items-center gap-1 flex-shrink-0 ${!isCurrentUser ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
                              >
                                {renderUserAvatar({
                                  userId: participant.user_id,
                                  name: userName,
                                  photoUrl: userPhoto,
                                  sizeClass: 'w-14 h-14',
                                  borderClass: 'border-2 border-base-300',
                                  textClass: 'text-sm',
                                })}
                                <span className="text-xs font-medium text-center max-w-[80px] truncate text-base-content" style={{ textShadow: '0 1px 2px rgba(255, 255, 255, 0.9)' }}>{userName}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                </div>
              )}
            </div>
            ); })()}

            {/* Pinned messages sit directly under the header and do not scroll with the thread */}
            {hasPinnedMessagesStrip && (
              <div className="flex-shrink-0 z-[19] border-b border-base-300/80 bg-base-100">
                <div className="px-2 sm:px-4 py-2">{renderPinnedMessagesStrip()}</div>
              </div>
            )}

            {/* Wrapper so messages scroll above input (input is flex sibling, not absolute) */}
            <div className="flex-1 flex flex-col min-h-0">
            {/* Messages Area - min-h-0 so it scrolls and last message stays above input */}
            <div
              ref={desktopMessagesContainerRef}
              onScroll={handleScroll}
              className="flex-1 min-h-0 overflow-y-auto p-2 sm:p-4 pb-4 space-y-2 relative rmq-messages-area"
              style={{
                backgroundImage: chatBackgroundImageUrl ? `url(${chatBackgroundImageUrl})` : 'none',
                backgroundColor: chatBackgroundImageUrl ? 'transparent' : (document.documentElement.classList.contains('dark') ? 'transparent' : '#ffffff'),
                backgroundSize: chatBackgroundImageUrl ? 'cover' : 'auto',
                backgroundPosition: chatBackgroundImageUrl ? 'center' : 'auto',
                backgroundRepeat: chatBackgroundImageUrl ? 'no-repeat' : 'repeat',
                backgroundAttachment: chatBackgroundImageUrl ? 'fixed' : 'scroll'
              }}
            >
              {isLoadingMessages ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center min-h-[200px] bg-base-100/80 dark:bg-base-300/50 z-10">
                  <div className="loading loading-spinner loading-lg mb-4" style={{ color: chatBackgroundImageUrl ? 'rgba(255, 255, 255, 0.9)' : '#3E28CD' }} />
                  <p className="font-medium text-base-content/90">Loading messages...</p>
                </div>
              ) : displayMessages.length === 0 ? (
                <div className="text-center py-12">
                  <ChatBubbleLeftRightIcon className="w-16 h-16 mx-auto mb-4" style={{ color: chatBackgroundImageUrl ? 'rgba(255, 255, 255, 0.7)' : '#d1d5db' }} />
                  {messages.length > 0 && chatSearchQuery.trim() ? (
                    <p className="font-medium" style={{ color: chatBackgroundImageUrl ? 'white' : '#6b7280' }}>
                      No messages match your search
                    </p>
                  ) : null}
                  {!(messages.length > 0 && chatSearchQuery.trim()) && (
                    <p className="text-sm" style={{ color: chatBackgroundImageUrl ? 'rgba(255, 255, 255, 0.8)' : '#9ca3af' }}>Start the conversation!</p>
                  )}
                </div>
              ) : (
                <AnimatePresence initial={false}>
                  {hasMoreOlderMessages && (
                    <div className="flex justify-center py-2">
                      <button
                        type="button"
                        className="btn btn-sm btn-outline border-base-300"
                        onClick={() => loadOlderMessages()}
                        disabled={isLoadingOlderMessages}
                      >
                        {isLoadingOlderMessages ? 'Loading…' : 'Load earlier messages'}
                      </button>
                    </div>
                  )}
                  {displayMessages.map((message, index) => {
                    const isOwn = message.sender_id === currentUser?.id;
                    const senderName = message.sender?.tenants_employee?.display_name ||
                      message.sender?.full_name ||
                      'Unknown User';
                    const senderPhoto = message.sender?.tenants_employee?.photo_url;

                    const showDateSeparator = index === 0 ||
                      new Date(message.sent_at).toDateString() !== new Date(displayMessages[index - 1].sent_at).toDateString();

                    const prevMessage = index > 0 ? displayMessages[index - 1] : null;
                    const isMessageClusterContinuation =
                      !!prevMessage &&
                      prevMessage.sender_id === message.sender_id &&
                      new Date(message.sent_at).getTime() - new Date(prevMessage.sent_at).getTime() < RMQ_GROUP_GAP_MS &&
                      !showDateSeparator;

                    return (
                      <motion.div
                        key={getMessageListKey(message)}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
                        className={`relative [content-visibility:auto] ${isMessageClusterContinuation ? '!mt-1' : ''}`}
                        data-message-id={message.id}
                      >
                        {showDateSeparator && (
                          <div className="flex justify-center my-4 px-2">
                            <span
                              className={`text-[11px] font-medium tracking-wide text-base-content/45 ${chatBackgroundImageUrl ? 'bg-white/15 text-white/90' : 'bg-base-200/70 dark:bg-base-300/50'} rounded-full px-3 py-1`}
                            >
                              {formatDateSeparator(message.sent_at)}
                            </span>
                          </div>
                        )}
                        {/* Unread messages indicator - Desktop */}
                        {firstUnreadMessageIdRef.current === message.id && (
                          <div className="flex items-center gap-3 my-4 px-2">
                            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-blue-500 to-transparent"></div>
                            <div className="flex items-center gap-2 px-3 py-1 bg-blue-500/10 rounded-full border border-blue-500/30">
                              <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                              <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">New messages</span>
                            </div>
                            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-blue-500 to-transparent"></div>
                          </div>
                        )}

                        {/* Image, video and emoji messages - render outside bubble */}
                        {isAlbumMessage(message) ? (
                          <div className={`flex ${isOwn ? 'flex-col items-end ml-auto' : selectedConversation.type !== 'direct' ? 'flex-row items-end gap-3' : 'flex-col items-start'} ${RMQ_CHAT.bubbleMax} w-full group`}>
                            {!isOwn && selectedConversation.type !== 'direct' &&
                              (isMessageClusterContinuation ? (
                                <div className="w-8 flex-shrink-0 self-end" aria-hidden />
                              ) : (
                                <div className="flex-shrink-0 self-end">
                                  {renderUserAvatar({ userId: message.sender_id, name: senderName, photoUrl: senderPhoto, sizeClass: 'w-8 h-8', borderClass: 'border border-base-300', textClass: 'text-xs', loading: 'lazy' })}
                                </div>
                              ))}
                            <div className={`flex flex-col ${isOwn ? 'items-end' : 'items-start'} w-full min-w-0`}>
                              <div className={`flex items-end gap-2 ${isOwn ? 'flex-row-reverse' : 'flex-row'} relative w-full`}>
                                {renderDesktopMessageDropdown(message, isOwn)}
                                <div className={`${RMQ_CHAT.bubbleR} border border-base-300/80 overflow-hidden min-w-0 flex-1 max-w-full ${isOwn ? 'bg-white dark:bg-base-100' : 'bg-gray-50 dark:bg-base-100'}`}>
                                  {selectedConversation.type !== 'direct' && !isMessageClusterContinuation && (
                                    <div className={`px-2 py-1 border-b border-base-300 ${isOwn ? 'text-right' : ''}`}>
                                      <span className="text-sm font-medium" style={{ color: isOwn ? undefined : getSenderColor(message.sender_id) }}>
                                        {isOwn ? (currentUser?.tenants_employee?.display_name || currentUser?.full_name || 'You') : senderName}
                                      </span>
                                    </div>
                                  )}
                                  <div className="relative w-full">
                                    {renderAlbumMessageContent(message, index)}
                                    <span className="absolute bottom-2 right-2 z-10 text-xs font-medium text-white drop-shadow-md pointer-events-none">
                                      {formatMessageTime(message.sent_at)}
                                    </span>
                                  </div>
                                  {getAlbumUserCaption(message) && (
                                    <div
                                      className="px-2.5 py-2 border-t border-base-300 text-sm text-base-content whitespace-pre-wrap break-words"
                                      dir={getTextDirection(getAlbumUserCaption(message)!) as 'ltr' | 'rtl' | 'auto'}
                                    >
                                      {renderMessageContent(getAlbumUserCaption(message)!, isOwn)}
                                    </div>
                                  )}
                                  {renderMessageCommentFooter(message, 'media')}
                                </div>
                              </div>
                              {isOwn && (
                                <div className="flex items-center gap-1 mt-1 justify-end">
                                  {renderReadReceipts(message, { inline: true })}
                                </div>
                              )}
                            </div>
                          </div>
                        ) : isImageMessage(message) ? (
                          <div className={`flex ${isOwn ? 'flex-col items-end ml-auto' : selectedConversation.type !== 'direct' ? 'flex-row items-end gap-3' : 'flex-col items-start'} ${RMQ_CHAT.mediaColumn} group`}>
                            {/* Group received: avatar below on left; name on top of media */}
                            {!isOwn && selectedConversation.type !== 'direct' &&
                              (isMessageClusterContinuation ? (
                                <div className="w-8 flex-shrink-0 self-end" aria-hidden />
                              ) : (
                                <div className="flex-shrink-0 self-end">
                                  {renderUserAvatar({
                                    userId: message.sender_id,
                                    name: senderName,
                                    photoUrl: senderPhoto,
                                    sizeClass: 'w-8 h-8',
                                    borderClass: 'border border-base-300',
                                    textClass: 'text-xs',
                                    loading: 'lazy',
                                  })}
                                </div>
                              ))}
                            <div className={`flex flex-col ${isOwn ? 'items-end' : 'items-start'} w-fit min-w-0`}>
                              <div className={`flex items-end gap-2 ${isOwn ? 'flex-row-reverse' : 'flex-row'} relative w-fit`}>
                                {renderDesktopMessageDropdown(message, isOwn)}
                                <div
                                  className={`${RMQ_CHAT.bubbleR} border border-base-300/80 overflow-hidden min-w-0 w-fit max-w-full ${
                                    isOwn ? 'bg-white dark:bg-base-100' : 'bg-gray-50 dark:bg-base-100'
                                  }`}
                                >
                                {selectedConversation.type !== 'direct' && !isMessageClusterContinuation && (
                                  <div className={`px-2 py-1 border-b border-base-300 ${isOwn ? 'text-right' : ''}`}>
                                    <span className="text-sm font-medium" style={{ color: isOwn ? undefined : getSenderColor(message.sender_id) }}>
                                      {isOwn ? (currentUser?.tenants_employee?.display_name || currentUser?.full_name || 'You') : senderName}
                                    </span>
                                  </div>
                                )}
                                <div className="relative cursor-pointer w-fit min-h-0 max-w-full transition-transform duration-150 hover:scale-[1.02]" onClick={() => openMediaModal(message)}>
                                  <img
                                    src={message.attachment_url}
                                    alt={message.attachment_name}
                                    className={`${RMQ_CHAT.imageR} h-auto w-auto max-w-full max-h-[min(48vh,18rem)] object-contain object-center block bg-gray-100 dark:bg-gray-800`}
                                    loading={index >= displayMessages.length - 10 ? "eager" : "lazy"}
                                    decoding="async"
                                    onLoad={(e) => {
                                      const img = e.target as HTMLImageElement;
                                      img.style.opacity = '1';
                                      img.style.display = 'block';
                                    }}
                                    onError={(e) => {
                                      const img = e.target as HTMLImageElement;
                                      img.style.opacity = '0.5';
                                    }}
                                    style={{ opacity: 1, transition: 'opacity 0.2s ease-in-out' }}
                                  />
                                  <span className="absolute bottom-2 right-2 z-10 text-xs font-medium text-white drop-shadow-md">
                                    {formatMessageTime(message.sent_at)}
                                  </span>
                                </div>
                                {getAttachmentCaption(message) && (
                                  <div
                                    className="px-2.5 py-2 border-t border-base-300 text-sm text-base-content whitespace-pre-wrap break-words"
                                    dir={getTextDirection(getAttachmentCaption(message)!) as 'ltr' | 'rtl' | 'auto'}
                                  >
                                    {renderMessageContent(getAttachmentCaption(message)!, isOwn)}
                                  </div>
                                )}
                                  {renderMessageCommentFooter(message, 'media')}
                              </div>
                              </div>
                              {isOwn && (
                                <div className="flex items-center gap-1 mt-1 justify-end">
                                  {renderReadReceipts(message, { inline: true })}
                                </div>
                              )}
                            </div>
                          </div>
                        ) : isVideoMessage(message) ? (
                          <div className={`flex ${isOwn ? 'flex-col items-end ml-auto' : selectedConversation.type !== 'direct' ? 'flex-row items-end gap-3' : 'flex-col items-start'} ${RMQ_CHAT.mediaColumn} group`}>
                            {/* Group received: avatar below on left; name on top of media */}
                            {!isOwn && selectedConversation.type !== 'direct' &&
                              (isMessageClusterContinuation ? (
                                <div className="w-8 flex-shrink-0 self-end" aria-hidden />
                              ) : (
                                <div className="flex-shrink-0 self-end">
                                  {renderUserAvatar({
                                    userId: message.sender_id,
                                    name: senderName,
                                    photoUrl: senderPhoto,
                                    sizeClass: 'w-8 h-8',
                                    borderClass: 'border border-base-300',
                                    textClass: 'text-xs',
                                    loading: 'lazy',
                                  })}
                                </div>
                              ))}
                            <div className={`flex flex-col ${isOwn ? 'items-end' : 'items-start'} w-fit min-w-0`}>
                              <div className={`flex items-end gap-2 ${isOwn ? 'flex-row-reverse' : 'flex-row'} relative w-fit`}>
                                {renderDesktopMessageDropdown(message, isOwn)}
                                <div
                                  className={`${RMQ_CHAT.bubbleR} border border-base-300/80 overflow-hidden min-w-0 w-fit max-w-full ${
                                    isOwn ? 'bg-white dark:bg-base-100' : 'bg-gray-50 dark:bg-base-100'
                                  }`}
                                >
                                {selectedConversation.type !== 'direct' && !isMessageClusterContinuation && (
                                  <div className={`px-2 py-1 border-b border-base-300 ${isOwn ? 'text-right' : ''}`}>
                                    <span className="text-sm font-medium" style={{ color: isOwn ? undefined : getSenderColor(message.sender_id) }}>
                                      {isOwn ? (currentUser?.tenants_employee?.display_name || currentUser?.full_name || 'You') : senderName}
                                    </span>
                                  </div>
                                )}
                            <div
                              className="relative cursor-pointer w-fit min-h-[100px] max-w-full transition-transform duration-150 hover:scale-[1.01]"
                              onClick={() => openMediaModal(message)}
                              role="button"
                              tabIndex={0}
                              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMediaModal(message); } }}
                            >
                              <video
                                data-message-id={message.id}
                                src={message.attachment_url}
                                crossOrigin="anonymous"
                                className={`${RMQ_CHAT.imageR} h-auto w-auto max-w-full max-h-[min(48vh,18rem)] min-h-[100px] object-contain bg-gray-100 dark:bg-gray-800 relative z-10 pointer-events-none`}
                                preload="metadata"
                                playsInline
                                onLoadedMetadata={(e) => {
                                  const video = e.target as HTMLVideoElement;
                                  addLoadedVideo(message.id);
                                  // Hide loading immediately
                                  setLoadingVideos(prev => {
                                    const next = new Set(prev);
                                    next.delete(message.id);
                                    return next;
                                  });
                                  video.setAttribute('data-ready', 'true');
                                }}
                                onLoadedData={(e) => {
                                  const video = e.target as HTMLVideoElement;
                                  addLoadedVideo(message.id);
                                  setLoadingVideos(prev => {
                                    const next = new Set(prev);
                                    next.delete(message.id);
                                    return next;
                                  });
                                }}
                                onCanPlay={(e) => {
                                  addLoadedVideo(message.id);
                                  setLoadingVideos(prev => {
                                    const next = new Set(prev);
                                    next.delete(message.id);
                                    return next;
                                  });
                                }}
                                onPlay={(e) => {
                                  // Hide loading immediately when play starts
                                  setLoadingVideos(prev => {
                                    const next = new Set(prev);
                                    next.delete(message.id);
                                    return next;
                                  });
                                }}
                                onPlaying={(e) => {
                                  // Ensure loading is hidden
                                  setLoadingVideos(prev => {
                                    const next = new Set(prev);
                                    next.delete(message.id);
                                    return next;
                                  });
                                }}
                                onError={(e) => {
                                  console.error('Video load error:', e);
                                  const video = e.target as HTMLVideoElement;
                                  video.style.display = 'none';
                                  setLoadingVideos(prev => {
                                    const next = new Set(prev);
                                    next.delete(message.id);
                                    return next;
                                  });
                                }}
                                onMouseEnter={(e) => {
                                  // Start loading full video data on hover for instant playback (lazy videos only)
                                  const video = e.target as HTMLVideoElement;
                                  if (index < displayMessages.length - 3 && video.preload !== 'auto') {
                                    video.preload = 'auto';
                                    // Force reload to start downloading
                                    if (video.readyState >= 1) {
                                      video.load();
                                    }
                                  }
                                }}
                                onTouchStart={(e) => {
                                  // Start loading full video data on touch for mobile (lazy videos only)
                                  const video = e.target as HTMLVideoElement;
                                  if (index < displayMessages.length - 3 && video.preload !== 'auto') {
                                    video.preload = 'auto';
                                    // Force reload to start downloading
                                    if (video.readyState >= 1) {
                                      video.load();
                                    }
                                  }
                                }}
                              />
                              {loadingVideos.has(message.id) && (
                                <div className="absolute inset-0 bg-gray-100 dark:bg-gray-800 rounded-lg flex items-center justify-center pointer-events-none z-0">
                                  <div className="loading loading-spinner loading-lg" style={{ color: '#3E28CD' }}></div>
                                </div>
                              )}
                              <span className="absolute bottom-2 right-2 z-10 text-xs font-medium text-white drop-shadow-md">
                                {formatMessageTime(message.sent_at)}
                              </span>
                            </div>
                            {getAttachmentCaption(message) && (
                              <div
                                className="px-2.5 py-2 border-t border-base-300 text-sm text-base-content whitespace-pre-wrap break-words"
                                dir={getTextDirection(getAttachmentCaption(message)!) as 'ltr' | 'rtl' | 'auto'}
                              >
                                {renderMessageContent(getAttachmentCaption(message)!, isOwn)}
                              </div>
                            )}
                            {renderMessageCommentFooter(message, 'media')}
                              </div>
                              </div>
                              {isOwn && (
                                <div className="flex items-center gap-1 mt-1 justify-end">
                                  {renderReadReceipts(message, { inline: true })}
                                </div>
                              )}
                            </div>
                          </div>
                        ) : isEmojiOnly(message.content || '') ? (
                          <div
                            className={`flex gap-3 group ${isOwn ? 'flex-row-reverse' : 'flex-row'} items-end ${RMQ_CHAT.bubbleMax} w-full`}
                            dir={getTextDirection(message.content || '')}
                          >
                            {renderDesktopMessageDropdown(message, isOwn)}
                            <div className={`flex flex-col ${isOwn ? 'items-end' : 'items-start'} min-w-0`}>
                            <div className="text-6xl leading-none inline-block text-left">
                              {renderMessageContent(message.content || '', isOwn)}
                              {isOwn ? (
                                <span className="inline-flex items-center gap-1 ml-2 align-middle">
                                  <span className="text-xs sm:text-[11px] font-medium tabular-nums" style={{ color: 'rgba(255, 255, 255, 0.65)' }}>
                                    {formatMessageTime(message.sent_at)}
                                  </span>
                                  {renderReadReceipts(message, { inline: true })}
                                </span>
                              ) : (
                                <span
                                  className="inline text-xs sm:text-[11px] font-medium tabular-nums ml-2 align-baseline text-gray-500"
                                  style={{ textShadow: chatBackgroundImageUrl ? '0 1px 2px rgba(255, 255, 255, 0.8)' : 'none' }}
                                >
                                  {formatMessageTime(message.sent_at)}
                                </span>
                              )}
                            </div>
                            <div className="mt-2 w-full min-w-0 overflow-hidden rounded-lg border border-base-300/70">
                              {renderMessageCommentFooter(message, isOwn ? 'textOwn' : 'textOther')}
                            </div>
                            </div>
                          </div>
                        ) : (
                          <div
                            className={`flex w-full min-w-0 gap-3 group ${isOwn ? 'flex-row-reverse' : 'flex-row'} ${!isOwn && selectedConversation.type !== 'direct' ? 'items-end' : ''}`}
                          >

                            {/* Avatar below message box on left (group chats, received only) */}
                            {!isOwn && selectedConversation.type !== 'direct' &&
                              (isMessageClusterContinuation ? (
                                <div className="w-8 flex-shrink-0 self-end" aria-hidden />
                              ) : (
                                <div className="flex-shrink-0 self-end">
                                  {renderUserAvatar({
                                    userId: message.sender_id,
                                    name: senderName,
                                    photoUrl: senderPhoto,
                                    sizeClass: 'w-8 h-8',
                                    borderClass: 'border border-base-300',
                                    textClass: 'text-xs',
                                    loading: 'lazy',
                                  })}
                                </div>
                              ))}

                            <div
                              className={`${RMQ_CHAT.bubbleMax} ${!isOwn && selectedConversation.type !== 'direct' ? 'flex-1 min-w-0' : 'w-full'} ${isOwn ? 'items-end ml-auto' : 'items-start'} flex flex-col`}
                            >
                              <div className={`flex items-end gap-2 ${isOwn ? 'flex-row-reverse' : 'flex-row'} relative`}>
                                {/* Message actions dropdown - positioned directly next to message box */}
                                {/* For sent messages (isOwn): left side, for received messages: right side */}
                                {renderDesktopMessageDropdown(message, isOwn)}

                                <div
                                  data-message-id={message.id}
                                  onClick={() => {
                                    setShowReactionPicker(showReactionPicker === message.id ? null : message.id);
                                    setReactingMessageId(message.id);
                                  }}
                                  className={`w-full max-w-full overflow-hidden ${RMQ_CHAT.bubblePad} ${RMQ_CHAT.bubbleR} cursor-pointer transition-opacity hover:opacity-[0.97] relative border-0 shadow-none ${isOwn
                                    ? isEmojiOnly(message.content)
                                      ? 'bg-base-100 text-base-content'
                                      : `text-white rmq-bubble-sent`
                                    : `${RMQ_CHAT.recv} dark:bg-base-200/80 dark:text-base-content rmq-bubble-recv`
                                    }`}
                                  style={isOwn && !isEmojiOnly(message.content)
                                    ? { background: RMQ_CHAT.sentBg }
                                    : {}
                                  }
                                >
                                  {/* Display name inside bubble (group chats, received only); (edited) next to name */}
                                  {!isOwn && selectedConversation.type !== 'direct' && !isMessageClusterContinuation && (
                                    <div className="text-sm font-semibold mb-1 flex items-baseline gap-1.5 flex-wrap" style={{ color: getSenderColor(message.sender_id) }}>
                                      <span>{senderName}</span>
                                      {message.edited_at && (
                                        <span className="text-xs font-normal opacity-70 italic">(edited)</span>
                                      )}
                                    </div>
                                  )}
                                  {!isOwn && selectedConversation.type !== 'direct' && isMessageClusterContinuation && message.edited_at && (
                                    <div className="text-xs opacity-70 italic mb-1">(edited)</div>
                                  )}
                                  {isOwn && message.edited_at && (
                                    <div className="text-xs opacity-70 italic mb-1">(edited)</div>
                                  )}
                                  {/* Reply preview — inline (Slack-style), no card */}
                                  {(() => {
                                    const hasReplyId = !!message.reply_to_message_id;

                                    // Handle both array and object cases from Supabase
                                    let replyMessage: Message | null = null;
                                    if (message.reply_to_message) {
                                      // Supabase might return it as an array or object
                                      if (Array.isArray(message.reply_to_message)) {
                                        replyMessage = message.reply_to_message.length > 0 ? message.reply_to_message[0] : null;
                                      } else {
                                        replyMessage = message.reply_to_message;
                                      }
                                    }

                                    const hasValidReplyData = replyMessage &&
                                      (replyMessage.sender || replyMessage.content || replyMessage.attachment_url);

                                    // Debug logging
                                    if (hasReplyId && !hasValidReplyData) {
                                      console.warn('🔍 [Reply Debug] Message has reply_to_message_id but invalid reply data:', {
                                        messageId: message.id,
                                        replyToMessageId: message.reply_to_message_id,
                                        replyToMessageRaw: message.reply_to_message,
                                        replyToMessageProcessed: replyMessage,
                                        isArray: Array.isArray(message.reply_to_message)
                                      });
                                    }

                                    return hasReplyId && hasValidReplyData && replyMessage ? (
                                      <button
                                        type="button"
                                        className={`mb-1.5 w-full border-0 bg-transparent p-0 pl-2 text-left shadow-none rounded-none border-l-2 transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3E28CD]/30 ${isOwn ? 'border-l-white/40' : 'border-[#3E28CD]/45 dark:border-[#3E28CD]/55'}`}
                                        onClick={e => {
                                          e.stopPropagation();
                                          if (replyMessage.id) scrollToMessage(replyMessage.id, 'smooth');
                                        }}
                                        title="Go to original message"
                                      >
                                        <div className={`text-[12px] font-medium leading-tight ${isOwn ? 'text-white/85' : 'text-[#6B7280] dark:text-base-content/60'}`}>
                                          {replyMessage.sender?.tenants_employee?.display_name ||
                                            replyMessage.sender?.full_name ||
                                            'Unknown'}
                                        </div>
                                        {replyMessage.content && (
                                          <div className={`text-[12px] line-clamp-2 leading-snug mt-0.5 ${isOwn ? 'text-white/75' : 'text-[#6B7280] dark:text-base-content/55'}`}>
                                            {replyMessage.content}
                                          </div>
                                        )}
                                        {!replyMessage.content && replyMessage.attachment_url && (
                                          <div className={`text-[12px] italic mt-0.5 ${isOwn ? 'text-white/70' : 'text-[#6B7280]'}`}>
                                            {replyMessage.message_type === 'album' ? '🖼️ Album' :
                                              replyMessage.message_type === 'image' ? '📷 Image' :
                                              replyMessage.message_type === 'voice' ? '🎤 Voice message' :
                                                replyMessage.message_type === 'file' ? '📎 File' : '📎 Attachment'}
                                          </div>
                                        )}
                                      </button>
                                    ) : null;
                                  })()}

                                  {/* Message text + time on last line (Telegram-style inline meta) */}
                                  {message.content && (
                                    <div
                                      className="break-words text-sm whitespace-pre-wrap"
                                      dir={getTextDirection(message.content) as 'ltr' | 'rtl' | 'auto'}
                                      style={{
                                        textAlign: getTextDirection(message.content) === 'rtl' ? 'right' :
                                          getTextDirection(message.content) === 'auto' ? 'start' : 'left',
                                        ...(getTextDirection(message.content) !== 'auto' && { direction: getTextDirection(message.content) as 'ltr' | 'rtl' }),
                                        lineHeight: '1.45',
                                        wordBreak: 'break-word',
                                        overflowWrap: 'break-word',
                                        whiteSpace: 'pre-wrap',
                                        unicodeBidi: 'plaintext',
                                      }}
                                    >
                                      {renderMessageContent(message.content, isOwn)}
                                      {isOwn ? (
                                        <span className="inline-flex items-center gap-1 ml-1.5 align-middle">
                                          <span
                                            className="text-[11px] sm:text-[11px] font-medium tabular-nums select-none whitespace-nowrap"
                                            style={{ color: 'rgba(255, 255, 255, 0.62)' }}
                                          >
                                            {formatMessageTime(message.sent_at)}
                                          </span>
                                          {renderReadReceipts(message, { inline: true })}
                                        </span>
                                      ) : (
                                        <span
                                          className={`inline text-[11px] sm:text-[11px] font-medium tabular-nums select-none whitespace-nowrap align-baseline ml-1.5 text-gray-500`}
                                          style={
                                            chatBackgroundImageUrl
                                              ? { textShadow: '0 1px 1px rgba(0,0,0,0.2)' }
                                              : undefined
                                          }
                                        >
                                          {formatMessageTime(message.sent_at)}
                                        </span>
                                      )}
                                    </div>
                                  )}

                                  {/* File attachment */}
                                  {message.attachment_url && (
                                    <div className={`mt-2 rounded-lg ${`border ${isOwn ? 'bg-white/10 border-white/20' : 'bg-gray-50 border-gray-200'}`
                                      }`}>
                                      {message.message_type === 'voice' ? (
                                        // Voice message player
                                        <div className="p-3 flex items-center gap-3">
                                          {/* Employee image for own messages (all conversation types) and group chats */}
                                          {(isOwn || selectedConversation.type !== 'direct') && (
                                            <div className="flex-shrink-0">
                                              {renderUserAvatar({
                                                userId: message.sender_id,
                                                name: isOwn ? (currentUser?.tenants_employee?.display_name || currentUser?.full_name || 'You') : senderName,
                                                photoUrl: isOwn ? (currentUser?.tenants_employee?.photo_url) : senderPhoto,
                                                sizeClass: 'w-8 h-8',
                                                borderClass: 'border border-base-300',
                                                textClass: 'text-xs',
                                                loading: 'lazy',
                                              })}
                                            </div>
                                          )}
                                          <button
                                            onClick={() => playVoiceMessage(message.id)}
                                            className={`p-2 rounded-full transition-all flex-shrink-0 ${isOwn ? 'bg-white/20 text-white hover:bg-white/30' : 'text-white hover:opacity-80'
                                              }`}
                                            style={!isOwn ? { backgroundColor: '#3E28CD' } : {}}
                                            onMouseEnter={(e) => {
                                              if (!isOwn) {
                                                e.currentTarget.style.opacity = '0.8';
                                              }
                                            }}
                                            onMouseLeave={(e) => {
                                              if (!isOwn) {
                                                e.currentTarget.style.opacity = '1';
                                              }
                                            }}
                                            title={playingVoiceId === message.id ? "Pause voice message" : "Play voice message"}
                                          >
                                            {playingVoiceId === message.id ? (
                                              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                                                <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                                              </svg>
                                            ) : (
                                              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                                                <path d="M8 5v14l11-7z" />
                                              </svg>
                                            )}
                                          </button>
                                          <div className="flex-1"></div>
                                          <div className="flex items-center gap-2">
                                            {/* Waveform visualization */}
                                            <div className="flex-1 flex items-end gap-0.5 h-8 px-1">
                                              {(() => {
                                                const waveform = message.voice_waveform?.waveform ||
                                                  (Array.isArray(message.voice_waveform) ? message.voice_waveform : null) ||
                                                  Array(50).fill(0).map(() => Math.random() * 0.5 + 0.3);
                                                const isPlaying = playingVoiceId === message.id;
                                                const progress = voiceProgress[message.id] || 0;

                                                return waveform.map((value: number, index: number) => {
                                                  const barHeight = Math.max(value * 100, 15); // Min 15% height
                                                  const isActive = isPlaying && (index / waveform.length) * 100 <= progress;

                                                  return (
                                                    <div
                                                      key={index}
                                                      className="transition-all duration-75"
                                                      style={{
                                                        width: '2px',
                                                        height: `${barHeight}%`,
                                                        minHeight: '3px',
                                                        borderRadius: '1px',
                                                        backgroundColor: isOwn
                                                          ? (isActive ? 'white' : 'rgba(255, 255, 255, 0.4)')
                                                          : chatBackgroundImageUrl
                                                            ? (isActive ? 'white' : 'rgba(255, 255, 255, 0.5)')
                                                            : (isActive ? '#3E28CD' : 'rgba(62, 40, 205, 0.5)')
                                                      }}
                                                    />
                                                  );
                                                });
                                              })()}
                                            </div>
                                            <span className="text-sm font-mono whitespace-nowrap" style={{
                                              color: isOwn
                                                ? 'rgba(255, 255, 255, 0.8)'
                                                : chatBackgroundImageUrl
                                                  ? 'rgba(255, 255, 255, 0.9)'
                                                  : '#4b5563'
                                            }}>
                                              {formatVoiceDuration(message.voice_duration)}
                                            </span>
                                          </div>
                                        </div>
                                      ) : (
                                        // File attachment
                                        <div className="flex items-center gap-3 p-3">
                                          <div className={`p-3 rounded-lg ${isOwn ? 'bg-white/20' : chatBackgroundImageUrl ? 'bg-white/10' : 'bg-gray-50'
                                            }`}>
                                            <PaperClipIcon className={`w-5 h-5 ${isOwn ? 'text-white' : chatBackgroundImageUrl ? 'text-white' : 'text-gray-600'
                                              }`} />
                                          </div>
                                          <div className="flex-1 min-w-0">
                                            <button
                                              onClick={() => window.open(message.attachment_url, '_blank')}
                                              className="text-sm font-medium hover:underline truncate block"
                                              style={{ color: chatBackgroundImageUrl ? 'white' : 'inherit' }}
                                            >
                                              {message.attachment_name}
                                            </button>
                                            <p className="text-xs opacity-75" style={{ color: chatBackgroundImageUrl ? 'rgba(255, 255, 255, 0.8)' : 'inherit' }}>
                                              {Math.round((message.attachment_size || 0) / 1024)} KB •
                                              {message.attachment_type?.split('/')[1]?.toUpperCase() || 'FILE'}
                                            </p>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  )}

                                  {/* Reactions inside bubble (above timestamp) */}
                                  {message.reactions && message.reactions.length > 0 && (
                                    <div className={`flex flex-wrap gap-1 mt-1 ${isOwn ? 'justify-end' : 'justify-start'}`}>
                                      {Object.entries(getReactionsByEmoji(message.reactions)).map(([emoji, reactions]) => (
                                        <button
                                          key={emoji}
                                          onClick={() => {
                                            if (hasUserReacted(message.reactions, emoji)) {
                                              handleRemoveReaction(message.id, emoji);
                                            } else {
                                              handleAddReaction(message.id, emoji);
                                            }
                                          }}
                                          className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs border transition-colors ${hasUserReacted(message.reactions, emoji)
                                            ? 'bg-blue-100 border-blue-300 text-blue-700'
                                            : 'bg-gray-100 border-gray-200 text-gray-600 hover:bg-gray-200'
                                            }`}
                                        >
                                          <span>{emoji}</span>
                                          <span>{reactions.length}</span>
                                        </button>
                                      ))}
                                    </div>
                                  )}

                                  {/* Time + receipts: separate row only when there is no text (media-only / empty body) */}
                                  {!(message.content && String(message.content).trim()) && (
                                    <div className={`flex items-center gap-1 mt-1 pt-1 ${isOwn ? 'justify-end' : 'justify-start'}`}>
                                      <span
                                        className={`text-sm sm:text-xs ${isOwn ? '' : 'text-gray-500'}`}
                                        style={isOwn ? { color: 'rgba(255, 255, 255, 0.7)' } : {}}
                                      >
                                        {formatMessageTime(message.sent_at)}
                                      </span>
                                      {isOwn && renderReadReceipts(message, { inline: true })}
                                    </div>
                                  )}

                                  {renderMessageCommentFooter(message, isOwn ? 'textOwn' : 'textOther')}
                                </div>
                              </div>

                              {/* Reaction picker */}
                              {showReactionPicker === message.id && (
                                <div className={`reaction-picker-container absolute ${isOwn ? 'bottom-6 right-0' : 'bottom-6 left-0'} bg-white border border-gray-200 rounded-lg shadow-lg p-2 flex gap-1 z-50`}>
                                  {['👍', '❤️', '😂', '😮', '😢', '😡', '👏'].map((emoji) => (
                                    <button
                                      key={emoji}
                                      onClick={() => handleAddReaction(message.id, emoji)}
                                      className="p-2 hover:bg-base-200 rounded transition-colors"
                                      title={`React with ${emoji}`}
                                    >
                                      <span className="text-lg">{emoji}</span>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              )}

              {/* Typing indicator */}
              {selectedConversation && typingUsers.has(selectedConversation.id) && (
                <div className="flex w-full items-center gap-2 px-4 py-2">
                  <div className="flex items-center gap-2">
                    <div className="flex gap-1">
                      <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                      <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                      <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                    </div>
                    <span className="text-sm text-base-content/70 italic">
                      {typingUsers.get(selectedConversation.id)?.userName} is typing...
                    </span>
                  </div>
                </div>
              )}

              {/* New messages indicator when user is scrolled up */}
              {isUserScrolling && !shouldAutoScroll && (
                <div className="fixed bottom-20 right-4 z-10">
                  <button
                    onClick={() => {
                      shouldAutoScrollRef.current = true;
                      setShouldAutoScroll(true);
                      scrollToBottom('smooth');
                    }}
                    className="rounded-full border border-base-300/90 bg-base-100/95 p-2.5 text-base-content/70 shadow-md backdrop-blur-sm transition-colors hover:bg-base-200 hover:text-base-content"
                    title="Scroll to bottom"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                    </svg>
                  </button>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Message Input - Desktop Only (flex sibling so messages area height = remaining space) */}
            <div className="hidden lg:flex flex-shrink-0 z-10 border-t border-base-200/80 bg-base-100/95 p-2">
              <div className="flex w-full min-w-0 items-center gap-2 relative">
                <button
                  type="button"
                  className="btn btn-ghost btn-circle w-10 h-10 min-h-0 flex-shrink-0 text-base-content hover:bg-base-200"
                  title="AI suggestion"
                  disabled={rmqAiLoading || !selectedConversation}
                  onClick={() => handleRmqAiSuggestions()}
                >
                  {rmqAiLoading ? (
                    <span className="loading loading-spinner loading-sm" />
                  ) : (
                    <SparklesIcon className="w-6 h-6 text-amber-600" />
                  )}
                </button>
                {/* Consolidated Tools Button */}
                <div className="relative flex-shrink-0" ref={desktopToolsRef}>
                  {!isRecording ? (
                    <button
                      onClick={() => setShowDesktopTools(prev => !prev)}
                      disabled={isSending}
                      className="btn btn-ghost btn-circle w-10 h-10 min-h-0 text-base-content disabled:opacity-50 flex-shrink-0 hover:bg-base-200"
                      title="Message tools"
                    >
                      <Squares2X2Icon className="w-7 h-7" />
                    </button>
                  ) : (
                    <div className="flex items-center gap-2 rounded-full px-3 py-2 shadow-lg border border-white/30" style={{ backgroundColor: 'rgba(255, 255, 255, 0.8)', backdropFilter: 'blur(10px)' }}>
                      <button
                        onClick={stopVoiceRecording}
                        className="btn btn-circle btn-sm bg-red-500 hover:bg-red-600 text-white"
                        title="Send voice message"
                      >
                        <StopIcon className="w-4 h-4" />
                      </button>
                      <button
                        onClick={cancelVoiceRecording}
                        className="btn btn-circle btn-sm bg-base-content/60 hover:bg-base-content/80 text-base-100"
                        title="Cancel recording"
                      >
                        <XMarkIcon className="w-4 h-4" />
                      </button>
                      <span className="text-sm text-red-600 font-mono min-w-[40px]">
                        {formatRecordingDuration(recordingDuration)}
                      </span>
                    </div>
                  )}

                  {/* Tools Dropdown Menu */}
                  {showDesktopTools && !isRecording && (
                    <div className="absolute bottom-12 left-0 z-50 bg-base-100 border border-base-300 rounded-lg shadow-lg min-w-[180px]">
                      {!isExternalUser && (
                        <button
                          onClick={() => handleDesktopToolSelect('lead')}
                          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-base-200 text-left transition-colors"
                        >
                          <PlusIcon className="w-5 h-5 text-green-600" />
                          <span className="text-sm text-base-content/90">Attach Lead</span>
                        </button>
                      )}
                      <button
                        onClick={() => handleDesktopToolSelect('file')}
                        disabled={isUploadingFile}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-left transition-colors disabled:opacity-50"
                      >
                        {isUploadingFile ? (
                          <div className="loading loading-spinner loading-xs"></div>
                        ) : (
                          <PaperClipIcon className="w-5 h-5" style={{ color: '#3E28CD' }} />
                        )}
                        <span className="text-sm text-base-content/90">Attach File</span>
                      </button>
                      <button
                        onClick={() => handleDesktopToolSelect('emoji')}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-base-200 text-left transition-colors"
                      >
                        <FaceSmileIcon className="w-5 h-5" style={{ color: '#3E28CD' }} />
                        <span className="text-sm text-base-content/90">Add Emoji</span>
                      </button>
                      <button
                        onClick={() => handleDesktopToolSelect('voice')}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-base-200 text-left transition-colors"
                      >
                        <MicrophoneIcon className="w-5 h-5 text-red-600" />
                        <span className="text-sm text-base-content/90">Voice Message</span>
                      </button>
                      <button
                        onClick={() => {
                          setShowDesktopTools(false);
                          handleRmqAiSuggestions();
                        }}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-base-200 text-left transition-colors"
                      >
                        <SparklesIcon className="w-5 h-5 text-amber-600" />
                        <span className="text-sm text-base-content/90">AI suggestion</span>
                      </button>
                    </div>
                  )}
                </div>

                <div className="relative">


                  {/* Emoji Picker */}
                  {isEmojiPickerOpen && (
                    <div className="absolute bottom-12 left-0 z-50">
                      <EmojiPicker
                        onEmojiClick={handleEmojiClick}
                        width={350}
                        height={400}
                        skinTonesDisabled={false}
                        searchDisabled={false}
                        previewConfig={{
                          showPreview: true,
                          defaultEmoji: '1f60a',
                          defaultCaption: 'Choose your emoji!'
                        }}
                        lazyLoadEmojis={false}
                      />
                    </div>
                  )}

                  {/* Lead Search Dropdown */}
                  {isLeadSearchOpen && (
                    <div className="absolute bottom-12 left-0 z-50 bg-base-100 border border-base-300 rounded-lg shadow-lg w-80 max-h-96 overflow-hidden lead-search-dropdown">
                      <div className="p-3 border-b border-base-300">
                        <h3 className="text-sm font-semibold text-base-content mb-2">Attach Lead</h3>
                        <div className="relative">
                          <input
                            type="text"
                            placeholder="Search by lead number, name, or email..."
                            className="input input-bordered w-full input-sm"
                            value={leadSearchQuery}
                            onChange={(e) => {
                              setLeadSearchQuery(e.target.value);
                              searchLeads(e.target.value);
                            }}
                            autoFocus
                          />
                          {isSearchingLeads && (
                            <div className="absolute right-3 top-1/2 -translate-y-1/2">
                              <div className="loading loading-spinner loading-xs"></div>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="max-h-64 overflow-y-auto">
                        {leadSearchResults.length > 0 ? (
                          leadSearchResults.map((lead) => (
                            <div
                              key={`${lead.id}-${lead.lead_number}`}
                              onClick={() => handleLeadSelect(lead)}
                              className="p-3 hover:bg-base-200 cursor-pointer border-b border-base-300 last:border-b-0"
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex-1 min-w-0">
                                  <div className="font-medium text-sm text-base-content truncate">
                                    #{lead.lead_number} - {lead.name}
                                  </div>
                                  <div className="text-xs text-base-content/70 truncate">
                                    {lead.email} • {lead.phone}
                                  </div>
                                </div>
                                <div className="text-xs text-base-content/60 ml-2">
                                  {lead.stage || 'Unknown'}
                                </div>
                              </div>
                            </div>
                          ))
                        ) : leadSearchQuery.length >= 2 ? (
                          <div className="p-3 text-center text-base-content/70 text-sm">
                            No leads found
                          </div>
                        ) : (
                          <div className="p-3 text-center text-base-content/60 text-sm">
                            Type at least 2 characters to search
                          </div>
                        )}
                      </div>

                      <div className="p-2 border-t border-base-300">
                        <button
                          onClick={() => {
                            setIsLeadSearchOpen(false);
                            setLeadSearchQuery('');
                            setLeadSearchResults([]);
                          }}
                          className="btn btn-ghost btn-xs w-full"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex-1 flex flex-col gap-2">
                  {pendingMediaDraft && pendingMediaDraft.length > 0 && (
                    <div className="rounded-xl border border-base-300 bg-base-200/50 dark:bg-base-300/30 p-2 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-base-content/80">
                          Preview — add a caption (optional), then send or cancel
                        </span>
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs shrink-0"
                          onClick={cancelPendingMediaDraft}
                        >
                          Cancel
                        </button>
                      </div>
                      <div className="flex gap-2 overflow-x-auto pb-1">
                        {pendingMediaDraft.map((item, idx) => (
                          <div
                            key={`${item.previewUrl}-${idx}`}
                            className="relative flex-shrink-0 w-20 h-20 rounded-lg overflow-hidden border border-base-300 bg-base-100"
                          >
                            {item.file.type.startsWith('image/') ? (
                              <img src={item.previewUrl} alt="" className="w-full h-full object-cover" />
                            ) : item.file.type.startsWith('video/') ? (
                              <video src={item.previewUrl} className="w-full h-full object-cover" muted playsInline />
                            ) : (
                              <div className="w-full h-full flex flex-col items-center justify-center p-1 text-[9px] text-center text-base-content/80 leading-tight">
                                <PaperClipIcon className="w-6 h-6 opacity-60 mx-auto shrink-0" />
                                <span className="line-clamp-2 break-all">{item.file.name}</span>
                              </div>
                            )}
                            <button
                              type="button"
                              className="absolute top-0.5 right-0.5 btn btn-xs btn-circle btn-ghost min-h-0 h-6 w-6 p-0 bg-base-100/90"
                              onClick={() => removePendingMediaItem(idx)}
                              aria-label="Remove"
                            >
                              <XMarkIcon className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Reply preview - Desktop */}
                  {(messageToReply || messageToEdit) && (
                    <div className="rmq-reply-preview flex items-start gap-2 p-2.5 rounded-lg border border-[#3E28CD]/15 bg-[#EDE9F8]/90 border-l-4 border-l-[#3E28CD] dark:border-[#3E28CD]/30 dark:bg-[#3E28CD]/15">
                      <div className="flex-1 min-w-0">
                        {messageToReply && (
                          <>
                            <div className="text-sm font-semibold text-[#3E28CD] dark:text-[#d4ccff] mb-1">
                              Replying to {messageToReply.sender?.tenants_employee?.display_name || messageToReply.sender?.full_name || 'Unknown'}
                            </div>
                            <div className="text-base text-base-content/85 truncate">
                              {messageToReply.content || 'Media'}
                            </div>
                          </>
                        )}
                        {messageToEdit && (
                          <>
                            <div className="text-sm font-semibold text-[#3E28CD] dark:text-[#d4ccff] mb-1">
                              Editing message
                            </div>
                            <div className="text-base text-base-content/85 truncate">
                              {messageToEdit.content}
                            </div>
                          </>
                        )}
                      </div>
                      <button
                        onClick={() => {
                          setMessageToReply(null);
                          setMessageToEdit(null);
                          setEditingMessageText('');
                        }}
                        className="flex-shrink-0 p-1 rounded transition-colors hover:bg-[#3E28CD]/10"
                      >
                        <XMarkIcon className="w-4 h-4 text-[#3E28CD]/70 dark:text-[#e8e2ff]/80" />
                      </button>
                    </div>
                  )}

                  <textarea
                    ref={messageInputRef}
                    value={messageToEdit ? editingMessageText : newMessage}
                    onChange={(e) => {
                      if (messageToEdit) {
                        setEditingMessageText(e.target.value);
                      } else {
                        handleMessageInputChange(e);
                      }
                    }}
                    onKeyDown={handleMessageKeyDown}
                    onPaste={handlePaste}
                    placeholder={
                      messageToEdit
                        ? 'Edit message...'
                        : pendingMediaDraft?.length
                          ? 'Add a caption…'
                          : 'Type a message...'
                    }
                    dir={containsHebrew(messageToEdit ? editingMessageText : newMessage) ? 'rtl' : 'ltr'}
                    className="textarea w-full resize-none max-h-28 rounded-2xl border border-[#E5E7EB] bg-white text-sm text-[#111827] outline-none ring-0 transition-colors placeholder:text-gray-500 focus:border-gray-300 focus:outline-none focus:ring-0"
                    rows={1}
                    disabled={isSending}
                    style={{
                      height: '44px',
                      minHeight: '44px',
                      fontSize: '0.9375rem',
                      padding: '12px 14px',
                      boxSizing: 'border-box',
                      backgroundColor: '#ffffff'
                    }}
                  />
                  {showRmqAiPanel && (
                    <div className="absolute bottom-full left-0 right-0 mb-1 p-2 bg-base-100 border border-base-300 rounded-lg shadow-lg z-30 max-h-36 overflow-y-auto">
                      <div className="flex justify-between items-center mb-1 gap-2">
                        <span className="text-xs font-medium text-base-content/80">AI suggestion</span>
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs btn-circle"
                          onClick={() => {
                            setShowRmqAiPanel(false);
                            setRmqAiSuggestions([]);
                          }}
                        >
                          <XMarkIcon className="w-4 h-4" />
                        </button>
                      </div>
                      {rmqAiLoading ? (
                        <p className="text-sm text-base-content/70">Generating…</p>
                      ) : rmqAiSuggestions[0] ? (
                        <button
                          type="button"
                          className="text-left text-sm w-full hover:bg-base-200 p-2 rounded"
                          onClick={() => applyRmqAiSuggestion(rmqAiSuggestions[0])}
                        >
                          {rmqAiSuggestions[0]}
                        </button>
                      ) : null}
                    </div>
                  )}
                </div>

                <button
                  onClick={() => {
                    if (messageToEdit) {
                      void sendMessage();
                      return;
                    }
                    if (pendingMediaDraft?.length) {
                      void submitPendingMediaSend();
                      return;
                    }
                    if (!newMessage.trim()) startVoiceRecording();
                    else void sendMessage();
                  }}
                  disabled={isSending}
                  className="btn btn-ghost btn-circle w-10 h-10 min-h-0 text-base-content disabled:opacity-50 flex-shrink-0 hover:bg-base-200"
                  title={
                    messageToEdit
                      ? 'Save edit'
                      : pendingMediaDraft?.length
                        ? 'Send media'
                        : !newMessage.trim() && !messageToEdit
                          ? 'Record voice message'
                          : 'Send message'
                  }
                >
                  {isSending ? (
                    <div className="loading loading-spinner loading-sm"></div>
                  ) : messageToEdit ? (
                    <CheckIcon className="w-6 h-6 text-green-600" />
                  ) : pendingMediaDraft?.length ? (
                    <PaperAirplaneIcon className="w-6 h-6 text-green-600" />
                  ) : !newMessage.trim() ? (
                    <MicrophoneIcon className="w-6 h-6" />
                  ) : (
                    <PaperAirplaneIcon className="w-6 h-6 text-green-600" />
                  )}
                </button>
              </div>
            </div>
            </div>
          </>
        ) : (
          <>
            {/* Chat Header - No Conversation Selected */}
            <div
              className="p-4 border-b border-white/30 sticky top-0 z-20"
              style={{
                backgroundColor: 'rgba(255, 255, 255, 0.6)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)'
              }}
            >
              <div className="flex items-center justify-end">
                <button
                  onClick={onClose}
                  className="btn btn-ghost btn-circle text-base-content/70 hover:bg-base-200"
                  title="Close Messages"
                >
                  <XMarkIcon className="w-7 h-7" />
                </button>
              </div>
            </div>
            <div
              className="flex-1 flex items-center justify-center relative rmq-messages-area"
              style={{
                backgroundImage: chatBackgroundImageUrl ? `url(${chatBackgroundImageUrl})` : 'none',
                backgroundColor: chatBackgroundImageUrl ? 'transparent' : undefined,
                backgroundSize: chatBackgroundImageUrl ? 'cover' : 'auto',
                backgroundPosition: chatBackgroundImageUrl ? 'center' : 'auto',
                backgroundRepeat: chatBackgroundImageUrl ? 'no-repeat' : 'repeat',
                backgroundAttachment: chatBackgroundImageUrl ? 'fixed' : 'scroll'
              }}
            >
              <div className="text-center relative z-10">
                <div
                  className="inline-block px-8 py-6 rounded-2xl backdrop-blur-md shadow-xl"
                  style={{
                    backgroundColor: 'rgba(255, 255, 255, 0.7)',
                    backdropFilter: 'blur(10px)',
                    WebkitBackdropFilter: 'blur(10px)',
                    border: '1px solid rgba(255, 255, 255, 0.3)'
                  }}
                >
                  <ChatBubbleLeftRightIcon className="w-12 h-12 mx-auto mb-6" style={{ color: '#3E28CD' }} />
                  <h3 className="text-xl font-bold text-base-content mb-2">Welcome to RMQ Messages</h3>
                  <p className="text-base-content/80 mb-6 max-w-md">
                    Pick your <span className="font-semibold" style={{ color: '#3E28CD' }}>Employee</span> that you want to chat with.
                  </p>
                  <div className="flex items-center justify-center gap-4 text-sm text-base-content/70">
                    <div className="flex items-center gap-2">


                    </div>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Mobile Full Screen Chat — solid fixed top bar + scrollable thread */}
      <div className={`lg:hidden ${!showMobileConversations && selectedConversation ? 'flex' : 'hidden'} flex-col w-full fixed inset-0 z-40 overflow-hidden bg-base-100`}>
        {selectedConversation && (
          <>
            <header className="flex-shrink-0 z-30 border-b border-base-300 bg-base-100 pt-[env(safe-area-inset-top)] shadow-sm">
              <div className="w-full px-2 sm:px-3">
              {selectedConversation.type === 'direct' ? (
                <div className="flex items-center gap-2 py-2 min-h-[3rem]">
                  <button
                    type="button"
                    onClick={() => setShowMobileConversations(true)}
                    className="btn btn-ghost btn-sm btn-circle text-base-content/80 hover:bg-base-200 flex-shrink-0"
                    aria-label="Back to conversations"
                  >
                    <ArrowLeftIcon className="w-5 h-5" />
                  </button>
                  <div className="flex-1 min-w-0 flex items-center justify-center">
                    {(() => {
                      const otherParticipant = selectedConversation.participants?.find(p => p.user_id !== currentUser?.id);
                      if (otherParticipant?.user) {
                        const name =
                          otherParticipant.user.tenants_employee?.display_name ||
                          otherParticipant.user.full_name ||
                          'Unknown User';
                        const photoUrl = otherParticipant.user.tenants_employee?.photo_url;
                        const avatarKey = otherParticipant.user.id || otherParticipant.user_id;
                        const otherUserId = otherParticipant.user.id ? String(otherParticipant.user.id) : null;
                        const isOnline = otherUserId ? onlineUsers.has(otherUserId) : false;
                        const handleAvatarClick = async () => {
                          const employee = otherParticipant.user?.tenants_employee;
                          if (employee) {
                            let backgroundPhoto = null;
                            if (otherParticipant.user.employee_id) {
                              try {
                                const { data } = await supabase
                                  .from('tenants_employee')
                                  .select('photo')
                                  .eq('id', otherParticipant.user.employee_id)
                                  .maybeSingle();
                                if (data?.photo) {
                                  backgroundPhoto = data.photo;
                                }
                              } catch (error) {
                                console.error('Error fetching employee background photo:', error);
                              }
                            }

                            setSelectedEmployee({
                              id: otherParticipant.user.employee_id?.toString() || '',
                              display_name: employee.display_name || name,
                              official_name: employee.official_name || employee.display_name || name,
                              email: otherParticipant.user.email || '',
                              bonuses_role: employee.bonuses_role || '',
                              department: employee.tenant_departement?.name || '',
                              photo_url: photoUrl,
                              photo: backgroundPhoto,
                              mobile: employee.mobile,
                              phone: employee.phone,
                              phone_ext: employee.phone_ext,
                              mobile_ext: employee.mobile_ext,
                              is_active: otherParticipant.user.is_active,
                              user: otherParticipant.user
                            });
                            setShowBusinessCardModal(true);
                          }
                        };
                        return (
                          <button
                            type="button"
                            onClick={handleAvatarClick}
                            className="flex max-w-full min-w-0 items-center gap-2.5 rounded-lg px-1 py-0.5 text-left hover:bg-base-200/90 transition-colors"
                            title={`View ${name}'s profile`}
                          >
                            <div className="relative flex-shrink-0">
                              {renderUserAvatar({
                                userId: avatarKey,
                                name,
                                photoUrl,
                                sizeClass: 'w-9 h-9',
                                borderClass: 'border border-base-300',
                                textClass: 'text-sm',
                              })}
                              <div
                                className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-base-100 shadow-sm"
                                style={{
                                  backgroundColor: isOnline ? '#10b981' : '#9ca3af'
                                }}
                              />
                            </div>
                            <h2 className="font-semibold text-sm text-base-content truncate">
                              {name}
                            </h2>
                          </button>
                        );
                      }
                      return null;
                    })()}
                  </div>
                  <button
                    type="button"
                    onClick={onClose}
                    className="btn btn-ghost btn-sm btn-circle text-base-content/80 hover:bg-base-200 flex-shrink-0"
                    title="Close Messages"
                    aria-label="Close messages"
                  >
                    <XMarkIcon className="w-5 h-5" />
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-1 py-2 min-h-[3rem] sm:gap-1.5">
                    <button
                      type="button"
                      onClick={() => setShowMobileConversations(true)}
                      className="btn btn-ghost btn-sm btn-circle shrink-0 text-base-content/80 hover:bg-base-200"
                      aria-label="Back to conversations"
                    >
                      <ArrowLeftIcon className="h-5 w-5" />
                    </button>
                    <div className="shrink-0">{getConversationAvatar(selectedConversation)}</div>
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate text-sm font-semibold leading-tight text-base-content">
                        {getConversationTitle(selectedConversation)}
                      </h2>
                    </div>
                    <div className="dropdown dropdown-end shrink-0">
                      <label tabIndex={0} className="btn btn-ghost btn-sm btn-circle relative h-9 min-h-9 text-amber-700">
                        <FlagIcon className="h-5 w-5" />
                        {rmqMessageLeadFlags.length > 0 && (
                          <span className="absolute -top-0.5 -right-0.5 flex h-3.5 min-w-[0.875rem] items-center justify-center rounded-full bg-amber-600 px-0.5 text-[9px] font-bold leading-none text-white">
                            {rmqMessageLeadFlags.length > 99 ? '99+' : rmqMessageLeadFlags.length}
                          </span>
                        )}
                      </label>
                      <ul
                        tabIndex={0}
                        className="dropdown-content z-[300] menu max-h-72 min-w-[13rem] overflow-y-auto rounded-box border border-base-300 bg-base-100 p-2 shadow-lg"
                      >
                        {rmqMessageLeadFlagsLoading ? (
                          <li className="px-2 py-1 text-xs text-base-content/60">Loading…</li>
                        ) : rmqMessageLeadFlags.length === 0 ? (
                          <li className="px-2 py-1 text-xs text-base-content/60">No message flags yet</li>
                        ) : (
                          rmqMessageLeadFlags.map(f => (
                            <li key={f.id} className="py-0.5">
                              <div className="flex flex-col gap-0.5 rounded-lg px-1 py-1">
                                <button
                                  type="button"
                                  className="text-left text-xs"
                                  onClick={() => scrollToMessage(f.message_id, 'smooth')}
                                >
                                  <span className="font-semibold">{flagTypeLabel(f.flag_type, rmqMessageFlagTypes)} · #{f._leadNum || '—'}</span>
                                  <span className="block text-[10px] text-base-content/55">
                                    {rmqFlaggerDisplayName(f)} · {formatRmqFlagCreatedAt(f.created_at)}
                                  </span>
                                </button>
                                {currentUser?.id === f.user_id && (
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-xs text-error min-h-0 h-7 px-1"
                                    onClick={() => void removeRmqMessageLeadFlagRow(f.id)}
                                  >
                                    Remove
                                  </button>
                                )}
                              </div>
                            </li>
                          ))
                        )}
                      </ul>
                    </div>
                    {selectedConversation.participants && selectedConversation.participants.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowMobileGroupMembers(!showMobileGroupMembers)}
                        className="btn btn-ghost btn-sm h-9 min-h-9 shrink-0 gap-0.5 rounded-lg px-1.5 text-base-content/80 hover:bg-base-200"
                        aria-expanded={showMobileGroupMembers}
                        aria-label={showMobileGroupMembers ? 'Hide members' : 'Show members'}
                      >
                        <span className="whitespace-nowrap text-[11px] font-medium sm:text-xs">
                          {selectedConversation.participants.length}{' '}
                          {selectedConversation.participants.length === 1 ? 'member' : 'members'}
                        </span>
                        {showMobileGroupMembers ? (
                          <ChevronUpIcon className="h-4 w-4 shrink-0 opacity-70" />
                        ) : (
                          <ChevronDownIcon className="h-4 w-4 shrink-0 opacity-70" />
                        )}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={onClose}
                      className="btn btn-ghost btn-sm btn-circle shrink-0 text-base-content/80 hover:bg-base-200"
                      title="Close Messages"
                      aria-label="Close messages"
                    >
                      <XMarkIcon className="h-5 w-5" />
                    </button>
                  </div>

                  {/* Group members strip + actions (only when expanded; toggle lives in header row above) */}
                  {selectedConversation.type === 'group' &&
                    selectedConversation.participants &&
                    selectedConversation.participants.length > 0 &&
                    showMobileGroupMembers && (
                    <div className="border-t border-base-300 bg-base-100 px-3 pb-3 pt-2">
                      <div className="overflow-x-auto scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100">
                        <div className="flex gap-4 pb-2 min-w-max">
                          {selectedConversation.participants.map((participant) => {
                            const userName = participant.user?.tenants_employee?.display_name ||
                              participant.user?.full_name ||
                              `User ${participant.user_id?.slice(-4)}`;
                            const userPhoto = participant.user?.tenants_employee?.photo_url;
                            const isCurrentUser = participant.user_id === currentUser?.id;

                            return (
                              <div
                                key={participant.id}
                                onClick={() => !isCurrentUser && startDirectConversation(participant.user_id)}
                                className={`flex flex-col items-center gap-1 flex-shrink-0 ${!isCurrentUser ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
                              >
                                {renderUserAvatar({
                                  userId: participant.user_id,
                                  name: userName,
                                  photoUrl: userPhoto,
                                  sizeClass: 'w-14 h-14',
                                  borderClass: 'border-2 border-base-300',
                                  textClass: 'text-sm',
                                })}
                                <span className="text-xs font-medium text-center max-w-[80px] truncate text-base-content" style={{ textShadow: '0 1px 2px rgba(255, 255, 255, 0.9)' }}>{userName}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      {/* Action Buttons - Mobile Only */}
                      <div className="mt-4 pt-4 border-t border-gray-200 space-y-2">
                        {/* Background Image Buttons */}
                        <div className="flex items-center justify-center gap-3">
                          <button
                            onClick={() => backgroundImageInputRef.current?.click()}
                            disabled={isUploadingBackground}
                            className="btn btn-ghost btn-sm text-gray-700 hover:bg-gray-100"
                            title="Upload chat background image"
                          >
                            {isUploadingBackground ? (
                              <div className="loading loading-spinner loading-sm mr-2"></div>
                            ) : (
                              <PhotoIcon className="w-5 h-5 mr-2" />
                            )}
                            Upload Background
                          </button>
                          {chatBackgroundImageUrl && (
                            <button
                              onClick={resetBackgroundToDefault}
                              disabled={isUploadingBackground}
                              className="btn btn-ghost btn-sm text-gray-700 hover:bg-gray-100"
                              title="Reset to default white background"
                            >
                              <ArrowPathIcon className="w-5 h-5 mr-2" />
                              Reset Background
                            </button>
                          )}
                        </div>
                        {/* Lock/Unlock button - only visible to superusers (Mobile) */}
                        {selectedConversation.type === 'group' && isSuperUser && (
                          <div className="flex items-center justify-center mb-3">
                            <button
                              onClick={() => toggleGroupLock(selectedConversation.id)}
                              className={`btn btn-ghost btn-sm ${isGroupLocked(selectedConversation)
                                ? 'text-yellow-600 hover:bg-yellow-500/20'
                                : 'text-gray-700 hover:bg-gray-100'
                                }`}
                              title={isGroupLocked(selectedConversation) ? "Unlock Group" : "Lock Group"}
                            >
                              {isGroupLocked(selectedConversation) ? (
                                <>
                                  <LockClosedIcon className="w-5 h-5 mr-2" />
                                  Unlock Group
                                </>
                              ) : (
                                <>
                                  <LockOpenIcon className="w-5 h-5 mr-2" />
                                  Lock Group
                                </>
                              )}
                            </button>
                          </div>
                        )}
                        {/* Add/Remove Member Buttons - Only show if group is not locked, or if superuser for locked groups */}
                        {selectedConversation.type === 'group' && (!isGroupLocked(selectedConversation) || isSuperUser) && (
                          <div className="flex items-center justify-center gap-3">
                            <button
                              onClick={() => setShowAddMemberModal(true)}
                              className="btn btn-ghost btn-sm text-gray-700 hover:bg-gray-100"
                              title="Add Members"
                            >
                              <PlusIcon className="w-5 h-5 mr-2" />
                              Add Member
                            </button>
                            <button
                              onClick={() => setShowRemoveMemberModal(true)}
                              className="btn btn-ghost btn-sm text-gray-700 hover:bg-gray-100"
                              title="Remove Members"
                            >
                              <UserIcon className="w-5 h-5 mr-2" />
                              Remove Member
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
            </header>

            <div
              ref={mobileMessagesContainerRef}
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto min-h-0 overscroll-contain relative rmq-messages-area pb-[calc(7.25rem+env(safe-area-inset-bottom,0px))] bg-white p-2 sm:p-4 space-y-2"
              style={{
                WebkitOverflowScrolling: 'touch',
                backgroundImage: chatBackgroundImageUrl ? `url(${chatBackgroundImageUrl})` : 'none',
                backgroundColor: chatBackgroundImageUrl ? 'transparent' : '#ffffff',
                backgroundSize: chatBackgroundImageUrl ? 'cover' : 'auto',
                backgroundPosition: chatBackgroundImageUrl ? 'center' : 'auto',
                backgroundRepeat: chatBackgroundImageUrl ? 'no-repeat' : 'repeat',
                backgroundAttachment: chatBackgroundImageUrl ? 'fixed' : 'scroll'
              }}
            >
            {hasPinnedMessagesStrip && (
              <div className="sticky top-0 z-20 -mx-2 sm:-mx-4 mb-2 border-b border-base-300 bg-base-100/95 px-2 sm:px-4 backdrop-blur-sm">
                <div className="py-2">{renderPinnedMessagesStrip({ forMobile: true })}</div>
              </div>
            )}
              {isLoadingMessages ? (
                <div className={`absolute inset-0 flex flex-col items-center justify-center min-h-[200px] z-10 ${chatBackgroundImageUrl ? 'bg-base-100/80 dark:bg-base-300/50' : 'bg-white/95'}`}>
                  <div className="loading loading-spinner loading-lg mb-4" style={{ color: chatBackgroundImageUrl ? 'rgba(255, 255, 255, 0.9)' : '#3E28CD' }} />
                  <p className="font-medium text-base-content/90">Loading messages...</p>
                </div>
              ) : displayMessages.length === 0 ? (
                <div className="text-center py-12">
                  <ChatBubbleLeftRightIcon className="w-16 h-16 mx-auto mb-4" style={{ color: chatBackgroundImageUrl ? 'rgba(255, 255, 255, 0.7)' : '#d1d5db' }} />
                  {messages.length > 0 && chatSearchQuery.trim() ? (
                    <p className="font-medium" style={{ color: chatBackgroundImageUrl ? 'white' : '#6b7280' }}>
                      No messages match your search
                    </p>
                  ) : null}
                  {!(messages.length > 0 && chatSearchQuery.trim()) && (
                    <p className="text-sm" style={{ color: chatBackgroundImageUrl ? 'rgba(255, 255, 255, 0.8)' : '#9ca3af' }}>Start the conversation!</p>
                  )}
                </div>
              ) : (
                <AnimatePresence initial={false}>
                  {hasMoreOlderMessages && (
                    <div className="flex justify-center py-2">
                      <button
                        type="button"
                        className="btn btn-sm btn-outline border-base-300"
                        onClick={() => loadOlderMessages()}
                        disabled={isLoadingOlderMessages}
                      >
                        {isLoadingOlderMessages ? 'Loading…' : 'Load earlier messages'}
                      </button>
                    </div>
                  )}
                  {displayMessages.map((message, index) => {
                    const isOwn = message.sender_id === currentUser?.id;
                    const senderName = message.sender?.tenants_employee?.display_name ||
                      message.sender?.full_name ||
                      'Unknown User';
                    const senderPhoto = message.sender?.tenants_employee?.photo_url;

                    const showDateSeparator = index === 0 ||
                      new Date(message.sent_at).toDateString() !== new Date(displayMessages[index - 1].sent_at).toDateString();

                    const prevMessage = index > 0 ? displayMessages[index - 1] : null;
                    const isMessageClusterContinuation =
                      !!prevMessage &&
                      prevMessage.sender_id === message.sender_id &&
                      new Date(message.sent_at).getTime() - new Date(prevMessage.sent_at).getTime() < RMQ_GROUP_GAP_MS &&
                      !showDateSeparator;

                    return (
                      <motion.div
                        key={getMessageListKey(message)}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
                        className={`[content-visibility:auto] ${isMessageClusterContinuation ? '!mt-1' : ''}`}
                        data-message-id={message.id}
                      >
                        {showDateSeparator && (
                          <div className="flex justify-center my-4 px-2">
                            <span
                              className={`text-[11px] font-medium tracking-wide text-base-content/45 ${chatBackgroundImageUrl ? 'bg-white/15 text-white/90' : 'bg-base-200/70 dark:bg-base-300/50'} rounded-full px-3 py-1`}
                            >
                              {formatDateSeparator(message.sent_at)}
                            </span>
                          </div>
                        )}
                        {/* Unread messages indicator - Mobile */}
                        {firstUnreadMessageIdRef.current === message.id && (
                          <div className="flex items-center gap-3 my-4 px-2">
                            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-blue-500 to-transparent"></div>
                            <div className="flex items-center gap-2 px-3 py-1 bg-blue-500/10 rounded-full border border-blue-500/30">
                              <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                              <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">New messages</span>
                            </div>
                            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-blue-500 to-transparent"></div>
                          </div>
                        )}

                        {/* Image, video and emoji messages - render outside bubble - Mobile */}
                        {isAlbumMessage(message) ? (
                          <div
                            className={`flex w-full min-w-0 max-w-none -mx-2 sm:-mx-4 ${
                              selectedConversation.type !== 'direct'
                                ? 'flex-row items-end gap-2'
                                : 'flex-col items-stretch'
                            }`}
                          >
                            {!isOwn && selectedConversation.type !== 'direct' &&
                              (isMessageClusterContinuation ? (
                                <div className="w-8 flex-shrink-0 self-end" aria-hidden />
                              ) : (
                                <div className="flex-shrink-0 self-end">
                                  {renderUserAvatar({ userId: message.sender_id, name: senderName, photoUrl: senderPhoto, sizeClass: 'w-8 h-8', borderClass: 'border border-base-300', textClass: 'text-xs', loading: 'lazy' })}
                                </div>
                              ))}
                            <div
                              className={`flex w-full min-w-0 flex-col ${isOwn ? 'items-end' : 'items-start'} ${selectedConversation.type !== 'direct' ? 'flex-1' : ''}`}
                              {...getMobileMessageActionHandlers(message)}
                            >
                              <div
                                className={`w-full max-w-full ${RMQ_CHAT.bubbleR} border border-base-300/80 overflow-hidden ${isOwn ? 'bg-white dark:bg-base-100' : 'bg-gray-50 dark:bg-base-100'}`}
                              >
                                {selectedConversation.type !== 'direct' && !isMessageClusterContinuation && (
                                  <div className={`px-2 py-1 border-b border-base-300 ${isOwn ? 'text-right' : ''}`}>
                                    <span className="text-sm font-medium" style={{ color: isOwn ? undefined : getSenderColor(message.sender_id) }}>
                                      {isOwn ? (currentUser?.tenants_employee?.display_name || currentUser?.full_name || 'You') : senderName}
                                    </span>
                                  </div>
                                )}
                                <div className="relative w-full">
                                  {renderAlbumMessageContent(message, index)}
                                  <span className="absolute bottom-2 right-2 z-10 text-xs font-medium text-white drop-shadow-md pointer-events-none">
                                    {formatMessageTime(message.sent_at)}
                                  </span>
                                </div>
                                {getAlbumUserCaption(message) && (
                                  <div
                                    className="px-2.5 py-2 border-t border-base-300 text-sm text-base-content whitespace-pre-wrap break-words"
                                    dir={getTextDirection(getAlbumUserCaption(message)!) as 'ltr' | 'rtl' | 'auto'}
                                  >
                                    {renderMessageContent(getAlbumUserCaption(message)!, isOwn)}
                                  </div>
                                )}
                                {renderMessageCommentFooter(message, 'media')}
                              </div>
                              {isOwn && (
                                <div className="flex items-center gap-1 mt-1 justify-end">
                                  {renderReadReceipts(message, { inline: true })}
                                </div>
                              )}
                            </div>
                          </div>
                        ) : isImageMessage(message) ? (
                          <div className={`flex ${isOwn ? 'flex-col items-end ml-auto' : selectedConversation.type !== 'direct' ? 'flex-row items-end gap-3' : 'flex-col items-start'} ${RMQ_CHAT.mediaColumn}`}>
                            {!isOwn && selectedConversation.type !== 'direct' &&
                              (isMessageClusterContinuation ? (
                                <div className="w-8 flex-shrink-0 self-end" aria-hidden />
                              ) : (
                                <div className="flex-shrink-0 self-end">
                                  {renderUserAvatar({
                                    userId: message.sender_id,
                                    name: senderName,
                                    photoUrl: senderPhoto,
                                    sizeClass: 'w-8 h-8',
                                    borderClass: 'border border-base-300',
                                    textClass: 'text-xs',
                                    loading: 'lazy',
                                  })}
                                </div>
                              ))}
                            <div
                              className={`flex w-fit min-w-0 flex-col ${isOwn ? 'items-end' : 'items-start'}`}
                              {...getMobileMessageActionHandlers(message)}
                            >
                              <div
                                className={`${RMQ_CHAT.bubbleR} w-fit max-w-full min-w-0 overflow-hidden border border-base-300/80 ${
                                  isOwn ? 'bg-white dark:bg-base-100' : 'bg-gray-50 dark:bg-base-100'
                                }`}
                              >
                                {selectedConversation.type !== 'direct' && !isMessageClusterContinuation && (
                                  <div className={`px-2 py-1 border-b border-base-300 ${isOwn ? 'text-right' : ''}`}>
                                    <span className="text-sm font-medium" style={{ color: isOwn ? undefined : getSenderColor(message.sender_id) }}>
                                      {isOwn ? (currentUser?.tenants_employee?.display_name || currentUser?.full_name || 'You') : senderName}
                                    </span>
                                  </div>
                                )}
                                <div
                              className="relative cursor-pointer group w-fit min-h-0 max-w-full transition-transform duration-150 hover:scale-[1.02]"
                              onClick={() => {
                                if (longPressHandledRef.current) {
                                  longPressHandledRef.current = false;
                                  return;
                                }
                                openMediaModal(message);
                              }}
                            >
                              <img
                                src={message.attachment_url}
                                alt={message.attachment_name}
                                className={`${RMQ_CHAT.imageR} h-auto w-auto max-w-full max-h-[min(48vh,18rem)] object-contain object-center block bg-gray-100 dark:bg-gray-800`}
                                loading={index >= displayMessages.length - 10 ? "eager" : "lazy"}
                                decoding="async"
                                onLoad={(e) => {
                                  const img = e.target as HTMLImageElement;
                                  img.style.opacity = '1';
                                  img.style.display = 'block';
                                }}
                                onError={(e) => {
                                  const img = e.target as HTMLImageElement;
                                  console.error('Image load error:', message.attachment_url);
                                  img.style.opacity = '0.5';
                                }}
                                style={{ opacity: 1, transition: 'opacity 0.2s ease-in-out' }}
                              />
                              <span className="absolute bottom-2 right-2 z-10 text-xs font-medium text-white drop-shadow-md">
                                {formatMessageTime(message.sent_at)}
                              </span>
                            </div>
                            {getAttachmentCaption(message) && (
                              <div
                                className="px-2.5 py-2 border-t border-base-300 text-sm text-base-content whitespace-pre-wrap break-words"
                                dir={getTextDirection(getAttachmentCaption(message)!) as 'ltr' | 'rtl' | 'auto'}
                              >
                                {renderMessageContent(getAttachmentCaption(message)!, isOwn)}
                              </div>
                            )}
                            {renderMessageCommentFooter(message, 'media')}
                              </div>
                              {isOwn && (
                                <div className="flex items-center gap-1 mt-1 justify-end">
                                  {renderReadReceipts(message, { inline: true })}
                                </div>
                              )}
                            </div>
                          </div>
                        ) : isVideoMessage(message) ? (
                          <div className={`flex ${isOwn ? 'flex-col items-end ml-auto' : selectedConversation.type !== 'direct' ? 'flex-row items-end gap-3' : 'flex-col items-start'} ${RMQ_CHAT.mediaColumn}`}>
                            {!isOwn && selectedConversation.type !== 'direct' &&
                              (isMessageClusterContinuation ? (
                                <div className="w-8 flex-shrink-0 self-end" aria-hidden />
                              ) : (
                                <div className="flex-shrink-0 self-end">
                                  {renderUserAvatar({
                                    userId: message.sender_id,
                                    name: senderName,
                                    photoUrl: senderPhoto,
                                    sizeClass: 'w-8 h-8',
                                    borderClass: 'border border-base-300',
                                    textClass: 'text-xs',
                                    loading: 'lazy',
                                  })}
                                </div>
                              ))}
                            <div
                              className={`flex w-fit min-w-0 flex-col ${isOwn ? 'items-end' : 'items-start'}`}
                              {...getMobileMessageActionHandlers(message)}
                            >
                              <div
                                className={`${RMQ_CHAT.bubbleR} w-fit max-w-full min-w-0 overflow-hidden border border-base-300/80 ${
                                  isOwn ? 'bg-white dark:bg-base-100' : 'bg-gray-50 dark:bg-base-100'
                                }`}
                              >
                                {selectedConversation.type !== 'direct' && !isMessageClusterContinuation && (
                                  <div className={`px-2 py-1 border-b border-base-300 ${isOwn ? 'text-right' : ''}`}>
                                    <span className="text-sm font-medium" style={{ color: isOwn ? undefined : getSenderColor(message.sender_id) }}>
                                      {isOwn ? (currentUser?.tenants_employee?.display_name || currentUser?.full_name || 'You') : senderName}
                                    </span>
                                  </div>
                                )}
                                <div
                                  className="relative cursor-pointer group w-fit min-h-[100px] max-w-full transition-transform duration-150 hover:scale-[1.01]"
                                  onClick={() => {
                                    if (longPressHandledRef.current) {
                                      longPressHandledRef.current = false;
                                      return;
                                    }
                                    openMediaModal(message);
                                  }}
                                  role="button"
                                  tabIndex={0}
                                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMediaModal(message); } }}
                                >
                              <video
                                data-message-id={message.id}
                                src={message.attachment_url}
                                crossOrigin="anonymous"
                                className={`${RMQ_CHAT.imageR} h-auto w-auto max-w-full max-h-[min(48vh,18rem)] min-h-[100px] object-contain bg-gray-100 dark:bg-gray-800 relative z-10 pointer-events-none`}
                                preload="metadata"
                                playsInline
                                onLoadedMetadata={(e) => {
                                  const video = e.target as HTMLVideoElement;
                                  addLoadedVideo(message.id);
                                  // Hide loading immediately
                                  setLoadingVideos(prev => {
                                    const next = new Set(prev);
                                    next.delete(message.id);
                                    return next;
                                  });
                                  video.setAttribute('data-ready', 'true');
                                }}
                                onLoadedData={() => {
                                  addLoadedVideo(message.id);
                                  setLoadingVideos(prev => {
                                    const next = new Set(prev);
                                    next.delete(message.id);
                                    return next;
                                  });
                                }}
                                onCanPlay={(e) => {
                                  addLoadedVideo(message.id);
                                  setLoadingVideos(prev => {
                                    const next = new Set(prev);
                                    next.delete(message.id);
                                    return next;
                                  });
                                }}
                                onPlay={(e) => {
                                  // Hide loading immediately when play starts
                                  setLoadingVideos(prev => {
                                    const next = new Set(prev);
                                    next.delete(message.id);
                                    return next;
                                  });
                                }}
                                onPlaying={(e) => {
                                  // Ensure loading is hidden
                                  setLoadingVideos(prev => {
                                    const next = new Set(prev);
                                    next.delete(message.id);
                                    return next;
                                  });
                                }}
                                onError={(e) => {
                                  console.error('Video load error:', e);
                                  const video = e.target as HTMLVideoElement;
                                  video.style.display = 'none';
                                  setLoadingVideos(prev => {
                                    const next = new Set(prev);
                                    next.delete(message.id);
                                    return next;
                                  });
                                }}
                                onMouseEnter={(e) => {
                                  // Start loading full video data on hover for instant playback (lazy videos only)
                                  const video = e.target as HTMLVideoElement;
                                  if (index < displayMessages.length - 3 && video.preload !== 'auto') {
                                    video.preload = 'auto';
                                    // Force reload to start downloading
                                    if (video.readyState >= 1) {
                                      video.load();
                                    }
                                  }
                                }}
                                onTouchStart={(e) => {
                                  // Start loading full video data on touch for mobile (lazy videos only)
                                  const video = e.target as HTMLVideoElement;
                                  if (index < displayMessages.length - 3 && video.preload !== 'auto') {
                                    video.preload = 'auto';
                                    // Force reload to start downloading
                                    if (video.readyState >= 1) {
                                      video.load();
                                    }
                                  }
                                }}
                              />
                              {loadingVideos.has(message.id) && (
                                <div className="absolute inset-0 bg-gray-100 dark:bg-gray-800 rounded-lg flex items-center justify-center pointer-events-none z-0">
                                  <div className="loading loading-spinner loading-lg" style={{ color: '#3E28CD' }}></div>
                                </div>
                              )}
                              <span className="absolute bottom-2 right-2 z-10 text-xs font-medium text-white drop-shadow-md">
                                {formatMessageTime(message.sent_at)}
                              </span>
                            </div>
                            {getAttachmentCaption(message) && (
                              <div
                                className="px-2.5 py-2 border-t border-base-300 text-sm text-base-content whitespace-pre-wrap break-words"
                                dir={getTextDirection(getAttachmentCaption(message)!) as 'ltr' | 'rtl' | 'auto'}
                              >
                                {renderMessageContent(getAttachmentCaption(message)!, isOwn)}
                              </div>
                            )}
                            {renderMessageCommentFooter(message, 'media')}
                              </div>
                              {isOwn && (
                                <div className="flex items-center gap-1 mt-1 justify-end">
                                  {renderReadReceipts(message, { inline: true })}
                                </div>
                              )}
                            </div>
                          </div>
                        ) : isEmojiOnly(message.content || '') ? (
                          <div
                            className={`flex flex-col ${isOwn ? 'items-end ml-auto' : 'items-start'} ${RMQ_CHAT.bubbleMax} w-full`}
                            dir={getTextDirection(message.content || '')}
                            {...getMobileMessageActionHandlers(message)}
                          >
                            <div className="text-6xl leading-none inline-block text-left">
                              {renderMessageContent(message.content || '', isOwn)}
                              {isOwn ? (
                                <span className="inline-flex items-center gap-1 ml-2 align-middle">
                                  <span className="text-xs font-medium tabular-nums" style={{ color: 'rgba(255, 255, 255, 0.65)' }}>
                                    {formatMessageTime(message.sent_at)}
                                  </span>
                                  {renderReadReceipts(message, { inline: true })}
                                </span>
                              ) : (
                                <span
                                  className="inline text-xs font-medium tabular-nums ml-2 align-baseline text-gray-500"
                                  style={{ textShadow: chatBackgroundImageUrl ? '0 1px 2px rgba(255, 255, 255, 0.8)' : 'none' }}
                                >
                                  {formatMessageTime(message.sent_at)}
                                </span>
                              )}
                            </div>
                            <div className="mt-2 w-full overflow-hidden rounded-lg border border-base-300/70">
                              {renderMessageCommentFooter(message, isOwn ? 'textOwn' : 'textOther')}
                            </div>
                          </div>
                        ) : (
                          <div
                            className={`flex w-full min-w-0 gap-2 group ${isOwn ? 'flex-row-reverse' : 'flex-row'} ${!isOwn && selectedConversation.type !== 'direct' ? 'items-end' : ''}`}
                          >

                            {/* Avatar below message box on left - Mobile group chats */}
                            {!isOwn && selectedConversation.type !== 'direct' &&
                              (isMessageClusterContinuation ? (
                                <div className="w-8 flex-shrink-0 self-end" aria-hidden />
                              ) : (
                                <div className="flex-shrink-0 self-end">
                                  {renderUserAvatar({
                                    userId: message.sender_id,
                                    name: senderName,
                                    photoUrl: message.sender?.tenants_employee?.photo_url,
                                    sizeClass: 'w-8 h-8',
                                    borderClass: 'border border-gray-200',
                                    textClass: 'text-xs',
                                    loading: 'lazy',
                                  })}
                                </div>
                              ))}

                            <div
                              className={`${RMQ_CHAT.bubbleMax} ${!isOwn && selectedConversation.type !== 'direct' ? 'flex-1 min-w-0' : 'w-full'} ${isOwn ? 'items-end ml-auto' : 'items-start'} flex flex-col`}
                            >
                              <div className={`flex items-end gap-2 ${isOwn ? 'flex-row-reverse' : 'flex-row'} relative group`}>
                                {/* Mobile: long-press on bubble opens action modal (no hover ellipsis) */}

                                <div
                                  data-message-id={message.id}
                                  {...getMobileMessageActionHandlers(message)}
                                  onClick={() => {
                                    if (longPressHandledRef.current) {
                                      longPressHandledRef.current = false;
                                      return;
                                    }
                                    setShowReactionPicker(showReactionPicker === message.id ? null : message.id);
                                    setReactingMessageId(message.id);
                                  }}
                                  className={`w-full max-w-full overflow-hidden ${RMQ_CHAT.bubblePad} ${RMQ_CHAT.bubbleR} text-sm cursor-pointer transition-opacity hover:opacity-[0.97] relative select-none border-0 shadow-none ${isOwn
                                    ? isEmojiOnly(message.content)
                                      ? 'bg-base-100 text-base-content'
                                      : `text-white rmq-bubble-sent`
                                    : `${RMQ_CHAT.recv} dark:bg-base-200/80 dark:text-base-content rmq-bubble-recv`
                                    }`}
                                  style={isOwn && !isEmojiOnly(message.content)
                                    ? { background: RMQ_CHAT.sentBg }
                                    : {}
                                  }
                                >
                                  {/* Display name inside bubble (group chats, received only); (edited) next to name - Mobile */}
                                  {!isOwn && selectedConversation.type !== 'direct' && !isMessageClusterContinuation && (
                                    <div className="text-sm font-semibold mb-1 flex items-baseline gap-1.5 flex-wrap" style={{ color: getSenderColor(message.sender_id) }}>
                                      <span>{senderName}</span>
                                      {message.edited_at && (
                                        <span className="text-xs font-normal opacity-70 italic">(edited)</span>
                                      )}
                                    </div>
                                  )}
                                  {!isOwn && selectedConversation.type !== 'direct' && isMessageClusterContinuation && message.edited_at && (
                                    <div className="text-xs opacity-70 italic mb-1">(edited)</div>
                                  )}
                                  {isOwn && message.edited_at && (
                                    <div className="text-xs opacity-70 italic mb-1">(edited)</div>
                                  )}
                                  {/* Reply preview — inline, Mobile */}
                                  {(() => {
                                    const hasReplyId = !!message.reply_to_message_id;

                                    // Handle both array and object cases from Supabase
                                    let replyMessage: Message | null = null;
                                    if (message.reply_to_message) {
                                      // Supabase might return it as an array or object
                                      if (Array.isArray(message.reply_to_message)) {
                                        replyMessage = message.reply_to_message.length > 0 ? message.reply_to_message[0] : null;
                                      } else {
                                        replyMessage = message.reply_to_message;
                                      }
                                    }

                                    const hasValidReplyData = replyMessage &&
                                      (replyMessage.sender || replyMessage.content || replyMessage.attachment_url);

                                    return hasReplyId && hasValidReplyData && replyMessage ? (
                                      <button
                                        type="button"
                                        className={`mb-1.5 w-full border-0 bg-transparent p-0 pl-2 text-left shadow-none rounded-none border-l-2 transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3E28CD]/30 ${isOwn ? 'border-l-white/40' : 'border-[#3E28CD]/45 dark:border-[#3E28CD]/55'}`}
                                        onClick={e => {
                                          e.stopPropagation();
                                          if (replyMessage.id) scrollToMessage(replyMessage.id, 'smooth');
                                        }}
                                        title="Go to original message"
                                      >
                                        <div className={`text-[12px] font-medium leading-tight ${isOwn ? 'text-white/85' : 'text-[#6B7280] dark:text-base-content/60'}`}>
                                          {replyMessage.sender?.tenants_employee?.display_name ||
                                            replyMessage.sender?.full_name ||
                                            'Unknown'}
                                        </div>
                                        {replyMessage.content && (
                                          <div className={`text-[12px] line-clamp-2 leading-snug mt-0.5 ${isOwn ? 'text-white/75' : 'text-[#6B7280] dark:text-base-content/55'}`}>
                                            {replyMessage.content}
                                          </div>
                                        )}
                                        {!replyMessage.content && replyMessage.attachment_url && (
                                          <div className={`text-[12px] italic mt-0.5 ${isOwn ? 'text-white/70' : 'text-[#6B7280]'}`}>
                                            {replyMessage.message_type === 'album' ? '🖼️ Album' :
                                              replyMessage.message_type === 'image' ? '📷 Image' :
                                              replyMessage.message_type === 'voice' ? '🎤 Voice message' :
                                                replyMessage.message_type === 'file' ? '📎 File' : '📎 Attachment'}
                                          </div>
                                        )}
                                      </button>
                                    ) : null;
                                  })()}

                                  {/* Message text + time on last line — Mobile */}
                                  {message.content && (
                                    <div
                                      className="break-words text-sm whitespace-pre-wrap"
                                      dir={getTextDirection(message.content) as 'ltr' | 'rtl' | 'auto'}
                                      style={{
                                        textAlign: getTextDirection(message.content) === 'rtl' ? 'right' :
                                          getTextDirection(message.content) === 'auto' ? 'start' : 'left',
                                        ...(getTextDirection(message.content) !== 'auto' && { direction: getTextDirection(message.content) as 'ltr' | 'rtl' }),
                                        fontSize: '1.125rem',
                                        lineHeight: '1.45',
                                        wordBreak: 'break-word',
                                        overflowWrap: 'break-word',
                                        whiteSpace: 'pre-wrap',
                                        unicodeBidi: 'plaintext',
                                      }}
                                    >
                                      {renderMessageContent(message.content, isOwn)}
                                      {isOwn ? (
                                        <span className="inline-flex items-center gap-1 ml-1.5 align-middle">
                                          <span
                                            className="text-[11px] font-medium tabular-nums"
                                            style={{ color: 'rgba(255, 255, 255, 0.62)' }}
                                          >
                                            {formatMessageTime(message.sent_at)}
                                          </span>
                                          {renderReadReceipts(message, { inline: true })}
                                        </span>
                                      ) : (
                                        <span className="inline text-[11px] font-medium tabular-nums ml-1.5 align-baseline text-gray-500">
                                          {formatMessageTime(message.sent_at)}
                                        </span>
                                      )}
                                    </div>
                                  )}

                                  {/* File attachment */}
                                  {message.attachment_url && (
                                    <div className={`mt-2 rounded-lg ${`border ${isOwn ? 'bg-white/10 border-white/20' : 'bg-gray-50 border-gray-200'}`
                                      }`}>
                                      {message.message_type === 'voice' ? (
                                        // Mobile voice message player
                                        <div className="p-2 flex items-center gap-2">
                                          {/* Employee image for own messages (all conversation types) and group chats */}
                                          {(isOwn || selectedConversation.type !== 'direct') && (
                                            <div className="flex-shrink-0">
                                              {renderUserAvatar({
                                                userId: message.sender_id,
                                                name: isOwn ? (currentUser?.tenants_employee?.display_name || currentUser?.full_name || 'You') : senderName,
                                                photoUrl: isOwn ? (currentUser?.tenants_employee?.photo_url) : senderPhoto,
                                                sizeClass: 'w-7 h-7',
                                                borderClass: 'border border-base-300',
                                                textClass: 'text-xs',
                                                loading: 'lazy',
                                              })}
                                            </div>
                                          )}
                                          <button
                                            onClick={() => playVoiceMessage(message.id)}
                                            className={`p-2 rounded-full transition-all flex-shrink-0 ${isOwn ? 'bg-white/20 text-white hover:bg-white/30' : 'text-white hover:opacity-80'
                                              }`}
                                            style={!isOwn ? { backgroundColor: '#3E28CD' } : {}}
                                            onMouseEnter={(e) => {
                                              if (!isOwn) {
                                                e.currentTarget.style.opacity = '0.8';
                                              }
                                            }}
                                            onMouseLeave={(e) => {
                                              if (!isOwn) {
                                                e.currentTarget.style.opacity = '1';
                                              }
                                            }}
                                            title={playingVoiceId === message.id ? "Pause voice message" : "Play voice message"}
                                          >
                                            {playingVoiceId === message.id ? (
                                              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                                <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                                              </svg>
                                            ) : (
                                              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                                <path d="M8 5v14l11-7z" />
                                              </svg>
                                            )}
                                          </button>
                                          <div className="flex-1">
                                            <div className="flex items-center gap-2">
                                              {/* Waveform visualization */}
                                              <div className="flex-1 flex items-end gap-0.5 h-6 px-1">
                                                {(() => {
                                                  const waveform = message.voice_waveform?.waveform ||
                                                    (Array.isArray(message.voice_waveform) ? message.voice_waveform : null) ||
                                                    Array(50).fill(0).map(() => Math.random() * 0.5 + 0.3);
                                                  const isPlaying = playingVoiceId === message.id;
                                                  const progress = voiceProgress[message.id] || 0;

                                                  return waveform.map((value: number, index: number) => {
                                                    const barHeight = Math.max(value * 100, 15); // Min 15% height
                                                    const isActive = isPlaying && (index / waveform.length) * 100 <= progress;

                                                    return (
                                                      <div
                                                        key={index}
                                                        className="transition-all duration-75"
                                                        style={{
                                                          width: '1.5px',
                                                          height: `${barHeight}%`,
                                                          minHeight: '2px',
                                                          borderRadius: '0.75px',
                                                          backgroundColor: isOwn
                                                            ? (isActive ? 'white' : 'rgba(255, 255, 255, 0.4)')
                                                            : chatBackgroundImageUrl
                                                              ? (isActive ? 'white' : 'rgba(255, 255, 255, 0.5)')
                                                              : (isActive ? '#3E28CD' : 'rgba(62, 40, 205, 0.5)')
                                                        }}
                                                      />
                                                    );
                                                  });
                                                })()}
                                              </div>
                                              <span className="text-xs font-mono whitespace-nowrap" style={{
                                                color: isOwn
                                                  ? 'rgba(255, 255, 255, 0.8)'
                                                  : chatBackgroundImageUrl
                                                    ? 'rgba(255, 255, 255, 0.9)'
                                                    : '#4b5563'
                                              }}>
                                                {formatVoiceDuration(message.voice_duration)}
                                              </span>
                                            </div>
                                          </div>
                                        </div>
                                      ) : (
                                        // File attachment
                                        <div className="flex items-center gap-2 p-3">
                                          <div className={`p-2 rounded ${isOwn ? 'bg-white/20' : chatBackgroundImageUrl ? 'bg-white/10' : 'bg-gray-50'
                                            }`}>
                                            <PaperClipIcon className={`w-4 h-4 ${isOwn ? 'text-white' : chatBackgroundImageUrl ? 'text-white' : 'text-gray-600'
                                              }`} />
                                          </div>
                                          <div className="flex-1 min-w-0">
                                            <button
                                              onClick={() => window.open(message.attachment_url, '_blank')}
                                              className="text-xs font-medium hover:underline truncate block"
                                              style={{ color: chatBackgroundImageUrl ? 'white' : 'inherit' }}
                                            >
                                              {message.attachment_name}
                                            </button>
                                            <p className="text-xs opacity-75" style={{ color: chatBackgroundImageUrl ? 'rgba(255, 255, 255, 0.8)' : 'inherit' }}>
                                              {Math.round((message.attachment_size || 0) / 1024)} KB
                                            </p>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  )}

                                  {/* Reactions inside bubble — Mobile */}
                                  {message.reactions && message.reactions.length > 0 && (
                                    <div className={`flex flex-wrap gap-1 mt-1 ${isOwn ? 'justify-end' : 'justify-start'}`}>
                                      {Object.entries(getReactionsByEmoji(message.reactions)).map(([emoji, reactions]) => (
                                        <button
                                          key={emoji}
                                          onClick={() => {
                                            if (hasUserReacted(message.reactions, emoji)) {
                                              handleRemoveReaction(message.id, emoji);
                                            } else {
                                              handleAddReaction(message.id, emoji);
                                            }
                                          }}
                                          className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs border transition-colors ${hasUserReacted(message.reactions, emoji)
                                            ? 'bg-blue-100 border-blue-300 text-blue-700'
                                            : 'bg-gray-100 border-gray-200 text-gray-600 hover:bg-gray-200'
                                            }`}
                                        >
                                          <span>{emoji}</span>
                                          <span>{reactions.length}</span>
                                        </button>
                                      ))}
                                    </div>
                                  )}

                                  {/* Time + receipts: separate row only when no text — Mobile */}
                                  {!(message.content && String(message.content).trim()) && (
                                    <div className={`flex items-center gap-1 mt-1 pt-1 ${isOwn ? 'justify-end' : 'justify-start'}`}>
                                      <span
                                        className="text-xs"
                                        style={{
                                          color: isOwn ? 'rgba(255, 255, 255, 0.7)' : '#6b7280',
                                        }}
                                      >
                                        {formatMessageTime(message.sent_at)}
                                      </span>
                                      {isOwn && renderReadReceipts(message, { inline: true })}
                                    </div>
                                  )}

                                  {renderMessageCommentFooter(message, isOwn ? 'textOwn' : 'textOther')}
                                </div>
                              </div>

                              {/* Reaction picker - Mobile */}
                              {showReactionPicker === message.id && (
                                <div className={`absolute ${isOwn ? 'bottom-6 right-0' : 'bottom-6 left-0'} bg-white border border-gray-200 rounded-lg shadow-lg p-2 flex gap-1 z-50`}>
                                  {['👍', '❤️', '😂', '😮', '😢', '😡', '👏'].map((emoji) => (
                                    <button
                                      key={emoji}
                                      onClick={() => handleAddReaction(message.id, emoji)}
                                      className="p-2 hover:bg-base-200 rounded transition-colors"
                                      title={`React with ${emoji}`}
                                    >
                                      <span className="text-lg">{emoji}</span>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              )}

              {/* Scroll to bottom button when user is scrolled up - Mobile */}
              {isUserScrolling && !shouldAutoScroll && (
                <div className="fixed bottom-20 right-4 z-50">
                  <button
                    onClick={() => {
                      shouldAutoScrollRef.current = true;
                      setShouldAutoScroll(true);
                      scrollToBottom('smooth');
                    }}
                    className="rounded-full border border-base-300/90 bg-base-100/95 p-2.5 text-base-content/70 shadow-md backdrop-blur-sm transition-colors hover:bg-base-200 hover:text-base-content"
                    title="Scroll to bottom"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                    </svg>
                  </button>
                </div>
              )}

              {/* Mobile Typing indicator */}
              {selectedConversation && typingUsers.has(selectedConversation.id) && (
                <div className="flex items-center gap-2 px-4 py-2">
                  <div className="flex items-center gap-2">
                    <div className="flex gap-1">
                      <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                      <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                      <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                    </div>
                    <span className={`text-sm italic ${chatBackgroundImageUrl ? 'text-gray-200' : 'text-gray-500'}`} style={chatBackgroundImageUrl ? { textShadow: '0 1px 2px rgba(0,0,0,0.35)' } : undefined}>
                      {typingUsers.get(selectedConversation.id)?.userName} is typing...
                    </span>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Mobile composer: fixed bar, unified with input (WhatsApp-style) */}
            <div className="lg:hidden fixed bottom-0 left-0 right-0 z-40 pointer-events-none pb-[env(safe-area-inset-bottom,0px)] bg-white border-t border-gray-200 shadow-[0_-4px_20px_rgba(0,0,0,0.08)]">
              <div className="relative px-2 pt-2 pb-2 pointer-events-auto space-y-1.5 max-w-[100vw]">
                <div className="flex items-end gap-1.5">
                  <div className="relative flex-shrink-0" ref={mobileToolsRef}>
                    <button
                      onClick={() => setShowMobileTools(prev => !prev)}
                      className="btn btn-ghost btn-circle w-11 h-11 min-h-0 flex-shrink-0 text-gray-600 hover:bg-gray-100 border-0"
                      title="Message tools"
                    >
                      <Squares2X2Icon className="w-6 h-6" />
                    </button>
                    {showMobileTools && (
                      <div className="absolute bottom-12 left-0 z-50 bg-white border border-gray-200 rounded-xl shadow-xl w-64 divide-y divide-gray-100">
                        {!isExternalUser && (
                          <button
                            onClick={() => handleMobileToolSelect('lead')}
                            className="w-full text-left px-4 py-3 text-sm hover:bg-gray-50 flex items-center gap-2"
                          >
                            <PlusIcon className="w-4 h-4" style={{ color: '#3E28CD' }} />
                            Attach lead
                          </button>
                        )}
                        <button
                          onClick={() => handleMobileToolSelect('file')}
                          className="w-full text-left px-4 py-3 text-sm hover:bg-gray-50 flex items-center gap-2"
                          disabled={isUploadingFile || isSending}
                        >
                          <PaperClipIcon className="w-4 h-4 text-gray-600" />
                          {isUploadingFile ? 'Uploading...' : 'Attach file'}
                        </button>
                        <button
                          onClick={() => handleMobileToolSelect('emoji')}
                          className="w-full text-left px-4 py-3 text-sm hover:bg-gray-50 flex items-center gap-2"
                        >
                          <FaceSmileIcon className="w-4 h-4 text-yellow-500" />
                          Add emojis
                        </button>
                        <button
                          onClick={() => handleMobileToolSelect('voice')}
                          className="w-full text-left px-4 py-3 text-sm hover:bg-gray-50 flex items-center gap-2 disabled:opacity-50"
                          disabled={isRecording}
                        >
                          <MicrophoneIcon className="w-4 h-4 text-red-500" />
                          {isRecording ? 'Recording...' : 'Record voice'}
                        </button>
                        <button
                          onClick={() => {
                            setShowMobileTools(false);
                            handleRmqAiSuggestions();
                          }}
                          className="w-full text-left px-4 py-3 text-sm hover:bg-gray-50 flex items-center gap-2 disabled:opacity-50"
                          disabled={rmqAiLoading}
                        >
                          {rmqAiLoading ? (
                            <span className="loading loading-spinner loading-xs" />
                          ) : (
                            <SparklesIcon className="w-4 h-4 text-amber-600" />
                          )}
                          AI suggestion
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="flex-1 flex flex-col gap-2 min-w-0">
                    {pendingMediaDraft && pendingMediaDraft.length > 0 && (
                      <div className="rounded-xl border border-gray-200 bg-gray-50 p-2 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium text-gray-700">
                            Preview — caption optional, then send or cancel
                          </span>
                          <button
                            type="button"
                            className="btn btn-ghost btn-xs shrink-0 text-gray-600"
                            onClick={cancelPendingMediaDraft}
                          >
                            Cancel
                          </button>
                        </div>
                        <div className="flex gap-2 overflow-x-auto pb-1">
                          {pendingMediaDraft.map((item, idx) => (
                            <div
                              key={`m-${item.previewUrl}-${idx}`}
                              className="relative flex-shrink-0 w-20 h-20 rounded-lg overflow-hidden border border-gray-200 bg-gray-100"
                            >
                              {item.file.type.startsWith('image/') ? (
                                <img src={item.previewUrl} alt="" className="w-full h-full object-cover" />
                              ) : item.file.type.startsWith('video/') ? (
                                <video src={item.previewUrl} className="w-full h-full object-cover" muted playsInline />
                              ) : (
                                <div className="w-full h-full flex flex-col items-center justify-center p-1 text-[9px] text-center text-gray-700 leading-tight">
                                  <PaperClipIcon className="w-6 h-6 opacity-80 mx-auto shrink-0" />
                                  <span className="line-clamp-2 break-all">{item.file.name}</span>
                                </div>
                              )}
                              <button
                                type="button"
                                className="absolute top-0.5 right-0.5 btn btn-xs btn-circle btn-ghost min-h-0 h-6 w-6 p-0 bg-black/60 text-white"
                                onClick={() => removePendingMediaItem(idx)}
                                aria-label="Remove"
                              >
                                <XMarkIcon className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {/* Reply preview - Mobile */}
                    {(messageToReply || messageToEdit) && (
                      <div className="rmq-reply-preview flex items-start gap-2 p-2.5 rounded-lg border border-[#3E28CD]/15 bg-[#EDE9F8]/90 border-l-4 border-l-[#3E28CD] dark:border-[#3E28CD]/30 dark:bg-[#3E28CD]/15">
                        <div className="flex-1 min-w-0">
                          {messageToReply && (
                            <>
                              <div className="text-sm font-semibold text-[#3E28CD] dark:text-[#d4ccff] mb-1">
                                Replying to {messageToReply.sender?.tenants_employee?.display_name || messageToReply.sender?.full_name || 'Unknown'}
                              </div>
                              {messageToReply.content && (
                                <div className="text-base text-base-content/85 truncate">
                                  {messageToReply.content}
                                </div>
                              )}
                              {!messageToReply.content && messageToReply.attachment_url && (
                                <div className="text-base text-base-content/85 italic">
                                  {messageToReply.message_type === 'image' ? '📷 Image' :
                                    messageToReply.message_type === 'voice' ? '🎤 Voice message' :
                                      messageToReply.message_type === 'file' ? '📎 File' : '📎 Attachment'}
                                </div>
                              )}
                            </>
                          )}
                          {messageToEdit && (
                            <>
                              <div className="text-sm font-semibold text-[#3E28CD] dark:text-[#d4ccff] mb-1">
                                Editing message
                              </div>
                              <div className="text-base text-base-content/85 truncate">
                                {messageToEdit.content}
                              </div>
                            </>
                          )}
                        </div>
                        <button
                          onClick={() => {
                            setMessageToReply(null);
                            setMessageToEdit(null);
                            setEditingMessageText('');
                          }}
                          className="flex-shrink-0 p-1 rounded transition-colors hover:bg-[#3E28CD]/10"
                        >
                          <XMarkIcon className="w-4 h-4 text-[#3E28CD]/70 dark:text-[#e8e2ff]/80" />
                        </button>
                      </div>
                    )}

                    <div className="relative w-full">
                      <textarea
                        ref={mobileMessageInputRef}
                        value={messageToEdit ? editingMessageText : newMessage}
                        onChange={(e) => {
                          if (messageToEdit) {
                            setEditingMessageText(e.target.value);
                          } else {
                            handleMessageInputChange(e);
                          }
                        }}
                        onKeyDown={handleMessageKeyDown}
                        onPaste={handlePaste}
                        placeholder={
                          messageToEdit
                            ? 'Edit message...'
                            : pendingMediaDraft?.length
                              ? 'Add a caption…'
                              : 'Type a message...'
                        }
                        dir={containsHebrew(messageToEdit ? editingMessageText : newMessage) ? 'rtl' : 'ltr'}
                        className="textarea w-full resize-none max-h-32 rounded-2xl border border-[#E5E7EB] bg-white text-sm text-[#111827] placeholder:text-gray-400 focus:border-gray-300 focus:outline-none focus:ring-0"
                        rows={1}
                        disabled={isSending}
                        style={{
                          height: '44px',
                          minHeight: '44px',
                          fontSize: '0.9375rem',
                          lineHeight: '1.45',
                          color: '#111827',
                          padding: '12px 14px',
                          boxSizing: 'border-box'
                        }}
                      />
                      {showRmqAiPanel && (
                        <div className="absolute bottom-full left-0 right-0 mb-1 p-2 bg-base-100 border border-base-300 rounded-lg shadow-lg z-40 max-h-36 overflow-y-auto">
                          <div className="flex justify-between items-center mb-1 gap-2">
                            <span className="text-xs font-medium text-base-content/80">AI suggestion</span>
                            <button
                              type="button"
                              className="btn btn-ghost btn-xs btn-circle"
                              onClick={() => {
                                setShowRmqAiPanel(false);
                                setRmqAiSuggestions([]);
                              }}
                            >
                              <XMarkIcon className="w-4 h-4" />
                            </button>
                          </div>
                          {rmqAiLoading ? (
                            <p className="text-sm text-base-content/70">Generating…</p>
                          ) : rmqAiSuggestions[0] ? (
                            <button
                              type="button"
                              className="text-left text-sm w-full hover:bg-base-200 p-2 rounded"
                              onClick={() => applyRmqAiSuggestion(rmqAiSuggestions[0])}
                            >
                              {rmqAiSuggestions[0]}
                            </button>
                          ) : null}
                        </div>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    className="btn btn-ghost btn-circle w-11 h-11 min-h-0 flex-shrink-0 disabled:opacity-50 text-amber-600 hover:bg-amber-50 border-0"
                    title="AI suggestion"
                    disabled={rmqAiLoading || !selectedConversation}
                    onClick={() => handleRmqAiSuggestions()}
                  >
                    {rmqAiLoading ? (
                      <span className="loading loading-spinner loading-sm" />
                    ) : (
                      <SparklesIcon className="w-6 h-6 text-amber-500" />
                    )}
                  </button>

                  <button
                    onClick={() => {
                      if (messageToEdit) {
                        void sendMessage();
                        return;
                      }
                      if (pendingMediaDraft?.length) {
                        void submitPendingMediaSend();
                        return;
                      }
                      if (!newMessage.trim()) startVoiceRecording();
                      else void sendMessage();
                    }}
                    disabled={isSending}
                    className="btn btn-ghost btn-circle w-11 h-11 min-h-0 disabled:opacity-50 flex-shrink-0 text-gray-700 hover:bg-gray-100 border-0"
                    title={
                      messageToEdit
                        ? 'Save edit'
                        : pendingMediaDraft?.length
                          ? 'Send media'
                          : !newMessage.trim() && !messageToEdit
                            ? 'Record voice message'
                            : 'Send message'
                    }
                  >
                    {isSending ? (
                      <div className="loading loading-spinner loading-sm"></div>
                    ) : messageToEdit ? (
                      <CheckIcon className="w-6 h-6 text-emerald-600" />
                    ) : pendingMediaDraft?.length ? (
                      <PaperAirplaneIcon className="w-6 h-6 text-emerald-600" />
                    ) : !newMessage.trim() ? (
                      <MicrophoneIcon className="w-6 h-6 text-gray-600" />
                    ) : (
                      <PaperAirplaneIcon className="w-6 h-6 text-emerald-600" />
                    )}
                  </button>
                </div>

                {isRecording && (
                  <div className="flex items-center gap-2 text-xs text-gray-700 px-1">
                    <span className="font-mono">{formatRecordingDuration(recordingDuration)}</span>
                    <button
                      onClick={stopVoiceRecording}
                      className="btn btn-xs btn-error text-white"
                    >
                      <StopIcon className="w-3 h-3 mr-1" />
                      Send
                    </button>
                    <button
                      onClick={cancelVoiceRecording}
                      className="btn btn-xs btn-ghost text-gray-600"
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {/* Mobile Emoji Picker */}
                {isEmojiPickerOpen && (
                  <div className="absolute bottom-16 left-0 z-50">
                    <EmojiPicker
                      onEmojiClick={handleEmojiClick}
                      width={300}
                      height={350}
                      skinTonesDisabled={false}
                      searchDisabled={false}
                      previewConfig={{
                        showPreview: true,
                        defaultEmoji: '1f60a',
                        defaultCaption: 'Choose your emoji!'
                      }}
                      lazyLoadEmojis={false}
                    />
                  </div>
                )}

                {/* Mobile Lead Search Dropdown */}
                {isLeadSearchOpen && (
                  <div className="absolute bottom-16 left-0 z-50 bg-white border border-gray-200 rounded-lg shadow-lg w-72 max-h-80 overflow-hidden lead-search-dropdown">
                    <div className="p-3 border-b border-gray-200">
                      <h3 className="text-sm font-semibold text-gray-900 mb-2">Attach Lead</h3>
                      <div className="relative">
                        <input
                          type="text"
                          placeholder="Search by lead number, name, or email..."
                          className="input input-bordered w-full input-sm"
                          value={leadSearchQuery}
                          onChange={(e) => {
                            setLeadSearchQuery(e.target.value);
                            searchLeads(e.target.value);
                          }}
                          autoFocus
                        />
                        {isSearchingLeads && (
                          <div className="absolute right-3 top-1/2 -translate-y-1/2">
                            <div className="loading loading-spinner loading-xs"></div>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="max-h-48 overflow-y-auto">
                      {leadSearchResults.length > 0 ? (
                        leadSearchResults.map((lead) => (
                          <div
                            key={`${lead.id}-${lead.lead_number}`}
                            onClick={() => handleLeadSelect(lead)}
                            className="p-3 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-sm text-gray-900 truncate">
                                  #{lead.lead_number} - {lead.name}
                                </div>
                                <div className="text-xs text-gray-500 truncate">
                                  {lead.email} • {lead.phone}
                                </div>
                              </div>
                              <div className="text-xs text-gray-400 ml-2">
                                {lead.stage || 'Unknown'}
                              </div>
                            </div>
                          </div>
                        ))
                      ) : leadSearchQuery.length >= 2 ? (
                        <div className="p-3 text-center text-gray-500 text-sm">
                          No leads found
                        </div>
                      ) : (
                        <div className="p-3 text-center text-gray-400 text-sm">
                          Type at least 2 characters to search
                        </div>
                      )}
                    </div>

                    <div className="p-2 border-t border-gray-200">
                      <button
                        onClick={() => {
                          setIsLeadSearchOpen(false);
                          setLeadSearchQuery('');
                          setLeadSearchResults([]);
                        }}
                        className="btn btn-ghost btn-xs w-full"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>


      {/* Create Group Modal */}
      {showCreateGroupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 max-h-[90vh] flex flex-col">
            {/* Modal Header */}
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold text-gray-900">Create Group Chat</h3>
                <button
                  onClick={() => {
                    setShowCreateGroupModal(false);
                    setSelectedUsers([]);
                    setNewGroupTitle('');
                    setNewGroupDescription('');
                  }}
                  className="btn btn-ghost btn-sm btn-circle"
                >
                  <XMarkIcon className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {/* Group Title */}
              <div className="mb-4">
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Group Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="Enter group name..."
                  className="input input-bordered w-full"
                  value={newGroupTitle}
                  onChange={(e) => setNewGroupTitle(e.target.value)}
                />
              </div>

              {/* Group Description */}
              <div className="mb-6">
                <label className="block text-sm font-semibold text-gray-700 mb-2">Description (Optional)</label>
                <textarea
                  placeholder="Describe the group purpose..."
                  className="textarea textarea-bordered w-full resize-none"
                  rows={2}
                  value={newGroupDescription}
                  onChange={(e) => setNewGroupDescription(e.target.value)}
                />
              </div>

              {/* User Selection */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-3">
                  Add Members <span className="text-red-500">*</span>
                </label>

                <div className="space-y-2 max-h-60 overflow-y-auto border border-gray-200 rounded-lg p-3">
                  {allUsers.map((user) => {
                    const isSelected = selectedUsers.includes(user.id);
                    const userName = user.tenants_employee?.display_name || user.full_name || 'Unknown User';
                    const userRole = getRoleDisplayName(user.tenants_employee?.bonuses_role || '');
                    const userDept = user.tenants_employee?.tenant_departement?.name;
                    const userPhoto = user.tenants_employee?.photo_url;

                    return (
                      <div
                        key={user.id}
                        onClick={() => {
                          setSelectedUsers(prev =>
                            isSelected
                              ? prev.filter(id => id !== user.id)
                              : [...prev, user.id]
                          );
                        }}
                        className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all border-2 ${isSelected
                          ? ''
                          : 'hover:bg-gray-50 border-transparent'
                          }`}
                        style={isSelected ? { backgroundColor: 'rgba(62, 40, 205, 0.05)', borderColor: 'rgba(62, 40, 205, 0.2)' } : {}}
                      >
                        <div className="relative">
                          {renderUserAvatar({
                            userId: user.id,
                            name: userName,
                            photoUrl: userPhoto,
                            sizeClass: 'w-10 h-10',
                            borderClass: '',
                            textClass: 'text-sm',
                          })}
                          {isSelected && (
                            <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center" style={{ backgroundColor: '#3E28CD' }}>
                              <CheckIcon className="w-3 h-3 text-white" />
                            </div>
                          )}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-gray-900 truncate">
                            {userName}
                          </div>
                          <div className="text-sm text-gray-500 truncate">
                            {userRole} {userDept && `• ${userDept}`}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {selectedUsers.length > 0 && (
                  <div className="mt-3 text-sm text-gray-600">
                    {selectedUsers.length} member{selectedUsers.length !== 1 ? 's' : ''} selected
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-6 border-t border-gray-200">
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => {
                    setShowCreateGroupModal(false);
                    setSelectedUsers([]);
                    setNewGroupTitle('');
                    setNewGroupDescription('');
                  }}
                  className="btn btn-outline"
                >
                  Cancel
                </button>
                <button
                  onClick={createGroupConversation}
                  disabled={selectedUsers.length === 0 || !newGroupTitle.trim()}
                  className="btn btn-primary"
                >
                  Create Group
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Forward Message Modal */}
      {showForwardModal && messageToForward && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 max-h-[90vh] flex flex-col">
            {/* Modal Header */}
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold text-gray-900">Forward Message</h3>
                <button
                  onClick={() => {
                    setShowForwardModal(false);
                    setMessageToForward(null);
                    setForwardSearchQuery('');
                  }}
                  className="btn btn-ghost btn-sm btn-circle"
                >
                  <XMarkIcon className="w-5 h-5" />
                </button>
              </div>
              {messageToForward.content && (
                <p className="text-sm text-gray-600 mt-2 line-clamp-2">
                  {messageToForward.content}
                </p>
              )}
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {/* Search */}
              <div className="mb-4">
                <div className="relative">
                  <MagnifyingGlassIcon className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search conversations..."
                    className="input input-bordered w-full pl-10"
                    value={forwardSearchQuery}
                    onChange={(e) => setForwardSearchQuery(e.target.value)}
                  />
                </div>
              </div>

              {/* Conversations List */}
              <div className="space-y-2">
                {conversations
                  .filter(conv => {
                    // Exclude current conversation
                    if (conv.id === selectedConversation?.id) return false;

                    // Filter by search query
                    if (forwardSearchQuery.trim()) {
                      const query = forwardSearchQuery.toLowerCase();
                      const title = getConversationTitle(conv).toLowerCase();
                      const preview = conv.last_message_preview?.toLowerCase() || '';
                      return title.includes(query) || preview.includes(query);
                    }
                    return true;
                  })
                  .map((conversation) => (
                    <button
                      key={conversation.id}
                      onClick={() => forwardMessage(conversation.id)}
                      disabled={isSending}
                      className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors border border-gray-200 text-left disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {getConversationAvatar(conversation, 'large')}
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-gray-900 truncate">
                          {getConversationTitle(conversation)}
                        </div>
                        <div className="text-sm text-gray-500 truncate">
                          {conversation.type === 'group' ? 'Group' : 'Direct chat'}
                        </div>
                      </div>
                      <ArrowRightIcon className="w-5 h-5 text-gray-400 flex-shrink-0" />
                    </button>
                  ))}

                {conversations.filter(conv => {
                  if (conv.id === selectedConversation?.id) return false;
                  if (forwardSearchQuery.trim()) {
                    const query = forwardSearchQuery.toLowerCase();
                    const title = getConversationTitle(conv).toLowerCase();
                    const preview = conv.last_message_preview?.toLowerCase() || '';
                    return title.includes(query) || preview.includes(query);
                  }
                  return true;
                }).length === 0 && (
                    <div className="text-center py-8 text-gray-500">
                      <p className="text-sm">No conversations found</p>
                      {forwardSearchQuery.trim() && (
                        <p className="text-xs mt-1">Try a different search term</p>
                      )}
                    </div>
                  )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-6 border-t border-gray-200">
              <button
                onClick={() => {
                  setShowForwardModal(false);
                  setMessageToForward(null);
                  setForwardSearchQuery('');
                }}
                className="btn btn-outline w-full"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showRmqFlagLeadModal && messageToFlag && (
        <RmqMessageFlagLeadModal
          open={showRmqFlagLeadModal}
          onClose={() => {
            setShowRmqFlagLeadModal(false);
            setMessageToFlag(null);
          }}
          messagePreview={(messageToFlag.content || '').slice(0, 280)}
          flagTypes={rmqMessageFlagTypes}
          searchLeads={searchLeadsForFlagModal}
          isSearching={flagLeadSearchBusy}
          onSubmit={submitRmqMessageFlag}
        />
      )}

      {/* Message comments (thread on a chat message) */}
      {rmqMessageCommentsModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-base-100 rounded-2xl shadow-2xl w-full max-w-xl max-h-[85vh] flex flex-col border border-base-300">
            <div className="p-4 border-b border-base-300 flex items-center justify-between gap-2 shrink-0">
              <h3 className="text-lg font-semibold text-base-content min-w-0">Message comments</h3>
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-circle shrink-0"
                onClick={() => setRmqMessageCommentsModal(null)}
                aria-label="Close"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto min-h-0 flex flex-col">
              <div className="px-4 pt-4 pb-3 border-b border-base-300 shrink-0">
                {renderCommentModalOriginalPreview(rmqMessageCommentsModal)}
              </div>
              <div className="p-4 space-y-3 flex-1 min-h-[120px]">
              {rmqMessageCommentsLoading ? (
                <div className="flex justify-center py-8">
                  <span className="loading loading-spinner loading-md" />
                </div>
              ) : rmqMessageCommentsList.length === 0 ? (
                <p className="text-sm text-base-content/60 text-center py-6">No comments yet. Add one below.</p>
              ) : (
                rmqMessageCommentsList.map(c => {
                  const name =
                    c.sender?.tenants_employee?.display_name || c.sender?.full_name || 'User';
                  const photoUrl = c.sender?.tenants_employee?.photo_url;
                  const isMine = currentUser?.id === c.user_id;
                  return (
                    <div
                      key={c.id}
                      className="rounded-lg border border-base-300 bg-base-200/30 dark:bg-base-300/20 p-3 text-sm"
                    >
                      <div className="flex items-start gap-2.5">
                        <div className="flex-shrink-0 pt-0.5">
                          {renderUserAvatar({
                            userId: c.user_id,
                            name,
                            photoUrl,
                            sizeClass: 'w-8 h-8',
                            borderClass: 'border border-base-300',
                            textClass: 'text-xs',
                            loading: 'lazy',
                          })}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                              <span className="font-semibold text-base-content">{name}</span>
                              <span className="text-xs text-base-content/50">
                                {format(new Date(c.created_at), 'MMM d, yyyy HH:mm')}
                              </span>
                            </div>
                            {isMine && (
                              <button
                                type="button"
                                className="btn btn-ghost btn-xs text-error shrink-0"
                                onClick={() => deleteRmqMessageComment(c.id)}
                              >
                                Delete
                              </button>
                            )}
                          </div>
                          <p className="mt-1.5 whitespace-pre-wrap break-words text-base-content">{c.body}</p>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              </div>
            </div>
            <div className="p-4 border-t border-base-300 space-y-2">
              <textarea
                className="textarea textarea-bordered w-full min-h-[80px] text-sm"
                placeholder="Write a comment…"
                value={rmqNewCommentText}
                onChange={e => setRmqNewCommentText(e.target.value)}
                maxLength={4000}
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => setRmqMessageCommentsModal(null)}
                >
                  Close
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={rmqSubmittingComment || !rmqNewCommentText.trim()}
                  onClick={() => submitRmqMessageComment()}
                >
                  {rmqSubmittingComment ? <span className="loading loading-spinner loading-xs" /> : 'Send'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Members Modal */}
      {showAddMemberModal && selectedConversation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4 max-h-[80vh] flex flex-col">
            <div className="p-4 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">Add Members</h3>
                <button
                  onClick={() => {
                    setShowAddMemberModal(false);
                    setMembersToAdd([]);
                    setMemberSearchQuery('');
                  }}
                  className="btn btn-ghost btn-sm btn-circle"
                >
                  <XMarkIcon className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-4 border-b border-gray-200">
              <div className="relative">
                <MagnifyingGlassIcon className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-base-content/60" />
                <input
                  type="text"
                  placeholder="Search users..."
                  className="input input-bordered w-full pl-10"
                  value={memberSearchQuery}
                  onChange={(e) => setMemberSearchQuery(e.target.value)}
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {allUsers
                .filter(user => {
                  // Filter out current user and already added members
                  if (user.id === currentUser?.id) return false;
                  const isAlreadyMember = selectedConversation.participants?.some(
                    p => p.user_id === user.id && p.is_active
                  );
                  if (isAlreadyMember) return false;

                  // Filter by search query
                  if (memberSearchQuery.trim()) {
                    const searchLower = memberSearchQuery.toLowerCase();
                    const name = user.tenants_employee?.display_name || user.full_name || '';
                    return name.toLowerCase().includes(searchLower) ||
                      user.email?.toLowerCase().includes(searchLower);
                  }
                  return true;
                })
                .map((user) => {
                  const userName = user.tenants_employee?.display_name || user.full_name || `User ${user.id.slice(-4)}`;
                  const userPhoto = user.tenants_employee?.photo_url;
                  const isSelected = membersToAdd.includes(user.id);

                  return (
                    <div
                      key={user.id}
                      onClick={() => {
                        if (isSelected) {
                          setMembersToAdd(membersToAdd.filter(id => id !== user.id));
                        } else {
                          setMembersToAdd([...membersToAdd, user.id]);
                        }
                      }}
                      className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors border-2 ${isSelected ? '' : 'hover:bg-gray-50 border-transparent'
                        }`}
                      style={isSelected ? { backgroundColor: 'rgba(62, 40, 205, 0.05)', borderColor: '#3E28CD' } : {}}
                    >
                      {renderUserAvatar({
                        userId: user.id,
                        name: userName,
                        photoUrl: userPhoto,
                        sizeClass: 'w-10 h-10',
                        borderClass: 'border-2 border-gray-200',
                        textClass: 'text-sm',
                      })}
                      <div className="flex-1">
                        <p className="font-medium text-gray-900">{userName}</p>
                        <p className="text-sm text-gray-500">{user.email}</p>
                      </div>
                      {isSelected && (
                        <CheckIcon className="w-5 h-5" style={{ color: '#3E28CD' }} />
                      )}
                    </div>
                  );
                })}
            </div>

            <div className="p-4 border-t border-gray-200 flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowAddMemberModal(false);
                  setMembersToAdd([]);
                  setMemberSearchQuery('');
                }}
                className="btn btn-ghost"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (membersToAdd.length > 0 && selectedConversation) {
                    addMembersToGroup(selectedConversation.id, membersToAdd);
                  }
                }}
                disabled={membersToAdd.length === 0}
                className="btn btn-primary"
              >
                Add {membersToAdd.length > 0 ? `${membersToAdd.length} ` : ''}Member{membersToAdd.length !== 1 ? 's' : ''}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Remove Members Modal */}
      {showRemoveMemberModal && selectedConversation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4 max-h-[80vh] flex flex-col">
            <div className="p-4 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">Remove Members</h3>
                <button
                  onClick={() => setShowRemoveMemberModal(false)}
                  className="btn btn-ghost btn-sm btn-circle"
                >
                  <XMarkIcon className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {selectedConversation.participants
                ?.filter(p => p.is_active && p.user_id !== currentUser?.id)
                .map((participant) => {
                  const userName = participant.user?.tenants_employee?.display_name ||
                    participant.user?.full_name ||
                    `User ${participant.user_id?.slice(-4)}`;
                  const userPhoto = participant.user?.tenants_employee?.photo_url;

                  return (
                    <div
                      key={participant.id}
                      className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 border-2 border-transparent"
                    >
                      {renderUserAvatar({
                        userId: participant.user_id,
                        name: userName,
                        photoUrl: userPhoto,
                        sizeClass: 'w-10 h-10',
                        borderClass: 'border-2 border-gray-200',
                        textClass: 'text-sm',
                      })}
                      <div className="flex-1">
                        <p className="font-medium text-gray-900">{userName}</p>
                        <p className="text-sm text-gray-500">{participant.user?.email}</p>
                      </div>
                      <button
                        onClick={() => {
                          if (selectedConversation) {
                            removeMemberFromGroup(selectedConversation.id, participant.user_id);
                            if (selectedConversation.participants?.filter(p => p.is_active && p.user_id !== currentUser?.id).length === 1) {
                              setShowRemoveMemberModal(false);
                            }
                          }
                        }}
                        className="btn btn-ghost btn-sm text-red-600 hover:bg-red-50"
                      >
                        Remove
                      </button>
                    </div>
                  );
                })}
              {selectedConversation.participants?.filter(p => p.is_active && p.user_id !== currentUser?.id).length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  <p>No members to remove</p>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-gray-200 flex justify-end">
              <button
                onClick={() => setShowRemoveMemberModal(false)}
                className="btn btn-ghost"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Group Chat Confirmation Modal */}
      {showDeleteGroupModal && selectedConversation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
                  <TrashIcon className="w-6 h-6 text-red-600" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Delete Group Chat</h3>
                  <p className="text-sm text-gray-500">This action cannot be undone</p>
                </div>
              </div>
              <p className="text-gray-700 mb-6">
                Are you sure you want to delete <strong>"{selectedConversation.title || 'this group chat'}"</strong>?
                All messages and participants will be permanently removed.
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowDeleteGroupModal(false)}
                  className="btn btn-ghost"
                >
                  Cancel
                </button>
                <button
                  onClick={deleteGroupChat}
                  className="btn btn-error text-white"
                >
                  Delete Group Chat
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        multiple
        accept="image/*,video/*,.pdf,.doc,.docx,.txt,.zip,.rar"
        onChange={handleFileInputChange}
      />

      {/* Drag and Drop Overlay */}
      {isDragOver && selectedConversation && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-none">
          <div className="bg-blue-500/20 backdrop-blur-sm border-4 border-dashed border-blue-500 rounded-2xl p-12 m-8 pointer-events-none">
            <div className="flex flex-col items-center gap-4 text-blue-600 dark:text-blue-400">
              <svg
                className="w-16 h-16"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                />
              </svg>
              <p className="text-2xl font-bold">Drop image or video here</p>
              <p className="text-lg">Release to preview — then Send or Cancel</p>
            </div>
          </div>
        </div>
      )}

      {/* WhatsApp-style Media Modal */}
      {isMediaModalOpen && conversationMedia.length > 0 && (() => {
        const currentMedia = conversationMedia[selectedMediaIndex];
        const mediaSender = currentMedia?.sender;
        const senderDisplayName = mediaSender?.tenants_employee?.display_name || mediaSender?.full_name || 'Unknown';
        const senderPhotoUrl = mediaSender?.tenants_employee?.photo_url;
        return (
        <div className="fixed inset-0 z-[60] bg-black bg-opacity-95 flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between p-4 bg-black/50 text-white">
            <div className="flex items-center gap-3">
              <button
                onClick={closeMediaModal}
                className="p-2 hover:bg-white/10 rounded-full transition-colors"
              >
                <XMarkIcon className="w-6 h-6" />
              </button>
              <div>
                <h3 className="font-semibold">
                  {conversationMedia[selectedMediaIndex]?.attachment_name}
                </h3>
                <p className="text-sm text-gray-300">
                  {selectedMediaIndex + 1} of {conversationMedia.length}
                </p>
              </div>
              {/* Employee who sent/received this media */}
              <div className="flex items-center gap-2 ml-2 pl-4 border-l border-white/20">
                {renderUserAvatar({
                  userId: mediaSender?.id,
                  name: senderDisplayName,
                  photoUrl: senderPhotoUrl,
                  sizeClass: 'w-8 h-8',
                  borderClass: 'border border-white/30',
                  textClass: 'text-xs',
                  loading: 'lazy',
                })}
                <span className="text-sm font-medium text-white/90">{senderDisplayName}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  const link = document.createElement('a');
                  link.href = conversationMedia[selectedMediaIndex]?.attachment_url || '';
                  link.download = conversationMedia[selectedMediaIndex]?.attachment_name || 'download';
                  link.click();
                }}
                className="p-2 hover:bg-white/10 rounded-full transition-colors"
                title="Download file"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </button>
              <button
                onClick={() => window.open(conversationMedia[selectedMediaIndex]?.attachment_url, '_blank')}
                className="p-2 hover:bg-white/10 rounded-full transition-colors"
                title="Open in new tab"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </button>
            </div>
          </div>

          {/* Main Media Display */}
          <div className="flex-1 flex items-center justify-center relative bg-black" style={{ minHeight: 0, overflow: 'hidden', width: '100%', height: 'calc(100vh - 120px)' }}>
            <style>{`
              /* Glassy video controls styling */
              video::-webkit-media-controls-panel {
                background: rgba(255, 255, 255, 0.1) !important;
                backdrop-filter: blur(10px) !important;
                -webkit-backdrop-filter: blur(10px) !important;
                border-radius: 12px !important;
                padding: 8px !important;
              }
              
              video::-webkit-media-controls-play-button,
              video::-webkit-media-controls-volume-slider,
              video::-webkit-media-controls-timeline,
              video::-webkit-media-controls-current-time-display,
              video::-webkit-media-controls-time-remaining-display,
              video::-webkit-media-controls-fullscreen-button {
                filter: brightness(0) invert(1) !important;
                color: white !important;
              }
              
              video::-webkit-media-controls-mute-button {
                filter: brightness(0) invert(1) !important;
              }
              
              /* Firefox video controls */
              video::-moz-media-controls {
                background: rgba(255, 255, 255, 0.1) !important;
                backdrop-filter: blur(10px) !important;
                border-radius: 12px !important;
              }
            `}</style>
            {conversationMedia[selectedMediaIndex]?.message_type === 'image' ||
              (conversationMedia[selectedMediaIndex]?.attachment_type &&
                conversationMedia[selectedMediaIndex]?.attachment_type.startsWith('image/')) ? (
              <img
                src={conversationMedia[selectedMediaIndex]?.attachment_url}
                alt={conversationMedia[selectedMediaIndex]?.attachment_name}
                className="max-w-full max-h-full object-contain"
                style={{ width: 'auto', height: 'auto', maxWidth: '100%', maxHeight: '100%' }}
              />
            ) : conversationMedia[selectedMediaIndex]?.attachment_type?.startsWith('video/') ? (
              <div style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#000',
                overflow: 'hidden',
              }}>
                <video
                  src={conversationMedia[selectedMediaIndex]?.attachment_url}
                  crossOrigin="anonymous"
                  controls={true}
                  autoPlay={true}
                  playsInline={true}
                  preload="auto"
                  style={{
                    objectFit: 'contain',
                    width: '100%',
                    height: '100%',
                    maxWidth: '100%',
                    maxHeight: '100%',
                    display: 'block',
                    backgroundColor: '#000',
                  }}
                  onError={(e) => {
                    console.error('Video load error in modal:', e);
                    const target = e.target as HTMLVideoElement;
                    target.style.display = 'none';
                  }}
                />
              </div>
            ) : (
              <div className="text-center text-white">
                <div className="w-32 h-32 mx-auto mb-4 bg-white/10 rounded-full flex items-center justify-center">
                  <PaperClipIcon className="w-16 h-16" />
                </div>
                <h3 className="text-xl font-semibold mb-2">
                  {conversationMedia[selectedMediaIndex]?.attachment_name}
                </h3>
                <p className="text-gray-300 mb-4">
                  {Math.round((conversationMedia[selectedMediaIndex]?.attachment_size || 0) / 1024)} KB
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      const link = document.createElement('a');
                      link.href = conversationMedia[selectedMediaIndex]?.attachment_url || '';
                      link.download = conversationMedia[selectedMediaIndex]?.attachment_name || 'download';
                      link.click();
                    }}
                    className="px-6 py-2 bg-green-600 hover:bg-green-700 rounded-lg transition-colors"
                  >
                    Download File
                  </button>
                  <button
                    onClick={() => window.open(conversationMedia[selectedMediaIndex]?.attachment_url, '_blank')}
                    className="px-6 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                  >
                    Open in New Tab
                  </button>
                </div>
              </div>
            )}

            {/* Navigation Arrows */}
            {conversationMedia.length > 1 && (
              <>
                <button
                  onClick={() => navigateMedia('prev')}
                  className="absolute left-4 top-1/2 -translate-y-1/2 p-3 bg-black/50 hover:bg-black/70 rounded-full text-white transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <button
                  onClick={() => navigateMedia('next')}
                  className="absolute right-4 top-1/2 -translate-y-1/2 p-3 bg-black/50 hover:bg-black/70 rounded-full text-white transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </>
            )}
          </div>

          {/* Bottom Media Thumbnails Panel - with sender name and image per item */}
          <div className="bg-black/50 p-4">
            <div className="flex gap-3 overflow-x-auto">
              {conversationMedia.map((media, index) => {
                const itemSender = media.sender;
                const itemSenderName = itemSender?.tenants_employee?.display_name || itemSender?.full_name || 'Unknown';
                const itemSenderPhoto = itemSender?.tenants_employee?.photo_url;
                return (
                  <div
                    key={`${media.id}-${index}-${media.attachment_url ?? ''}`}
                    onClick={() => setSelectedMediaIndex(index)}
                    className={`flex-shrink-0 flex flex-col items-center gap-1 cursor-pointer group ${index === selectedMediaIndex ? 'ring-2 ring-blue-500 rounded-lg' : ''}`}
                  >
                    <div
                      className={`w-16 h-16 rounded-lg overflow-hidden border-2 transition-all ${index === selectedMediaIndex
                        ? 'border-blue-500 scale-105'
                        : 'border-transparent group-hover:border-white/30'
                        }`}
                    >
                      {media.message_type === 'image' ||
                      (media.attachment_type && media.attachment_type.startsWith('image/')) ? (
                        <img
                          src={media.attachment_url}
                          alt={media.attachment_name}
                          className="w-full h-full object-cover"
                        />
                      ) : media.attachment_type?.startsWith('video/') ? (
                        <video
                          src={media.attachment_url}
                          className="w-full h-full object-cover"
                          muted
                          playsInline
                          preload="metadata"
                        />
                      ) : (
                        <div className="w-full h-full bg-white/10 flex items-center justify-center">
                          <PaperClipIcon className="w-6 h-6 text-white" />
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 min-w-0 max-w-[90px]">
                      {renderUserAvatar({
                        userId: itemSender?.id,
                        name: itemSenderName,
                        photoUrl: itemSenderPhoto,
                        sizeClass: 'w-5 h-5 flex-shrink-0',
                        borderClass: 'border border-white/20',
                        textClass: 'text-[10px]',
                        loading: 'lazy',
                      })}
                      <span className="text-xs text-white/80 truncate" title={itemSenderName}>{itemSenderName}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        );
      })()}

      {/* Employee Info Modal */}
      {showEmployeeInfoModal && selectedEmployee && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 max-h-[90vh] flex flex-col overflow-hidden">
            {/* Header with Background Image */}
            <div className="relative">
              {/* Background Image with Overlay */}
              {selectedEmployee.photo && (
                <div
                  className="absolute inset-0 bg-cover bg-center bg-no-repeat"
                  style={{ backgroundImage: `url(${selectedEmployee.photo})` }}
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-black/40 to-black/60"></div>
                </div>
              )}
              <div className={`relative z-10 p-6 ${selectedEmployee.photo ? 'text-white' : 'bg-white border-b border-gray-200'}`}>
                <div className="flex items-center justify-between mb-4">
                  <h3 className={`text-xl font-bold ${selectedEmployee.photo ? 'text-white drop-shadow-lg' : 'text-gray-900'}`}>Employee Information</h3>
                  <button
                    onClick={() => {
                      setShowEmployeeInfoModal(false);
                      setSelectedEmployee(null);
                    }}
                    className={`btn btn-ghost btn-sm btn-circle ${selectedEmployee.photo ? 'text-white hover:bg-white/20' : ''}`}
                  >
                    <XMarkIcon className="w-5 h-5" />
                  </button>
                </div>

                {/* Employee Avatar and Name */}
                <div className="flex flex-col items-center">
                  {/* Employee Avatar */}
                  {selectedEmployee.photo_url ? (
                    <div className="w-32 h-32 rounded-full overflow-hidden shadow-lg mb-4 ring-2 ring-white/30">
                      <img
                        src={selectedEmployee.photo_url}
                        alt={selectedEmployee.official_name || selectedEmployee.display_name}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  ) : (
                    <div className={`w-32 h-32 rounded-full flex items-center justify-center text-white text-4xl font-bold shadow-lg mb-4 ring-2 ring-white/30 ${selectedEmployee.photo ? 'bg-primary/80' : 'bg-gradient-to-br from-purple-500 to-blue-500'}`}>
                      {getInitials(selectedEmployee.official_name || selectedEmployee.display_name)}
                    </div>
                  )}

                  {/* Employee Name */}
                  <h2 className={`text-2xl font-bold mb-2 ${selectedEmployee.photo ? 'text-white drop-shadow-lg' : 'text-gray-900'}`}>
                    {selectedEmployee.official_name || selectedEmployee.display_name}
                  </h2>

                  {/* Employee Email */}
                  {selectedEmployee.email && (
                    <p className={`mb-3 ${selectedEmployee.photo ? 'text-white/90 drop-shadow-md' : 'text-gray-600'}`}>
                      <EnvelopeIcon className="w-4 h-4 inline mr-1" />
                      {selectedEmployee.email}
                    </p>
                  )}

                  {/* Contact Information */}
                  <div className="flex flex-wrap items-center gap-3 justify-center text-sm">
                    {selectedEmployee.phone && (
                      <div className={`flex items-center gap-1 ${selectedEmployee.photo ? 'text-white/90' : 'text-gray-700'}`}>
                        <PhoneIcon className="w-4 h-4" />
                        <span>{selectedEmployee.phone}</span>
                      </div>
                    )}
                    {selectedEmployee.mobile && (
                      <div className={`flex items-center gap-1 ${selectedEmployee.photo ? 'text-white/90' : 'text-gray-700'}`}>
                        <DevicePhoneMobileIcon className="w-4 h-4" />
                        <span>{selectedEmployee.mobile}</span>
                      </div>
                    )}
                    {selectedEmployee.phone_ext && (
                      <div className={`flex items-center gap-1 ${selectedEmployee.photo ? 'text-white/90' : 'text-gray-700'}`}>
                        <span className="text-xs opacity-75">Ext:</span>
                        <span>{selectedEmployee.phone_ext}</span>
                      </div>
                    )}
                    {selectedEmployee.mobile_ext && (
                      <div className={`flex items-center gap-1 ${selectedEmployee.photo ? 'text-white/90' : 'text-gray-700'}`}>
                        <span className="text-xs opacity-75">M.Ext:</span>
                        <span>{selectedEmployee.mobile_ext}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto p-6 bg-white">
              {/* Role and Department Badges */}
              <div className="flex items-center gap-3 justify-center mb-6">
                {selectedEmployee.bonuses_role && (
                  <div className="flex flex-col items-center">
                    <span className="badge badge-primary badge-lg px-4 py-2 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-0">
                      {getRoleDisplayName(selectedEmployee.bonuses_role)}
                    </span>
                  </div>
                )}
                {selectedEmployee.department && (
                  <div className="flex flex-col items-center">
                    <span className="badge badge-outline badge-lg px-4 py-2">
                      {selectedEmployee.department}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-6 border-t border-gray-200 flex gap-3 bg-white">
              <button
                onClick={() => {
                  setShowEmployeeInfoModal(false);
                  setSelectedEmployee(null);
                }}
                className="btn btn-outline flex-1"
              >
                Close
              </button>
              <button
                onClick={() => {
                  setShowEmployeeInfoModal(false);
                  setShowEmployeeProfileModal(true);
                }}
                className="btn btn-primary flex-1"
                style={{ backgroundColor: '#3E17C3', borderColor: '#3E17C3' }}
              >
                View Full Profile
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Business Card Modal - styled like PublicContractView */}
      {showBusinessCardModal && selectedEmployee && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={() => setShowBusinessCardModal(false)}
        >
          <div
            className="relative w-full max-w-md overflow-hidden bg-transparent rounded-2xl shadow-2xl min-h-[320px]"
            onClick={e => e.stopPropagation()}
          >
            <button
              onClick={() => setShowBusinessCardModal(false)}
              className="absolute top-3 right-3 z-[60] btn btn-circle btn-sm bg-black/60 text-white border-none hover:bg-black/80 backdrop-blur-md"
              aria-label="Close"
            >
              <XMarkIcon className="w-5 h-5" />
            </button>

            {/* Background image with overlay - same as PublicContractView */}
            <div
              className="absolute inset-0 bg-cover bg-center rounded-2xl"
              style={{
                backgroundImage: `url(${selectedEmployee.photo || 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?ixlib=rb-4.0.3&auto=format&fit=crop&w=2070&q=80'})`,
              }}
            >
              <div className="absolute inset-0 bg-gradient-to-br from-black/60 via-black/50 to-black/60 rounded-2xl" />
            </div>

            {/* Logo - top left */}
            <div className="absolute top-3 left-3 z-10">
              <img src="/DPLOGO1.png" alt="DPL Logo" className="h-7 drop-shadow-2xl" />
            </div>

            {/* Centered content */}
            <div className="relative z-10 flex flex-col items-center justify-center px-4 py-8 min-h-[320px] text-center text-white">
              {/* Avatar */}
              {selectedEmployee.photo_url ? (
                <div className="w-20 h-20 rounded-full shadow-2xl overflow-hidden mb-3">
                  <img
                    src={selectedEmployee.photo_url}
                    alt={selectedEmployee.official_name || selectedEmployee.display_name}
                    className="w-full h-full object-cover"
                  />
                </div>
              ) : (
                <div className="w-20 h-20 rounded-full shadow-2xl flex items-center justify-center text-xl font-bold bg-white/20 border border-white/30 mb-3">
                  {getInitials(selectedEmployee.official_name || selectedEmployee.display_name)}
                </div>
              )}

              <h1 className="text-xl font-bold mb-1 drop-shadow-2xl tracking-tight">
                {selectedEmployee.official_name || selectedEmployee.display_name}
              </h1>
              {selectedEmployee.department && (
                <p className="text-sm text-white/95 mb-1 drop-shadow-lg font-medium">
                  {selectedEmployee.department} Department
                </p>
              )}
              <p className="text-xs text-white/90 mb-4 drop-shadow-md font-semibold">
                Decker, Pex, Levi Law Offices
              </p>

              {/* Contact pills - same style as PublicContractView */}
              <div className="flex flex-col sm:flex-row items-center justify-center gap-2 w-full max-w-xs">
                {selectedEmployee.email && (
                  <a
                    href={`mailto:${selectedEmployee.email}`}
                    className="flex items-center gap-2 bg-white/10 backdrop-blur-md px-3 py-2 rounded-full border border-white/20 shadow-lg hover:bg-white/20 transition-all cursor-pointer w-full sm:w-auto justify-center"
                  >
                    <EnvelopeIcon className="w-4 h-4 text-white flex-shrink-0" />
                    <span className="text-xs font-medium break-all truncate max-w-[180px]">{selectedEmployee.email}</span>
                  </a>
                )}
                {selectedEmployee.mobile && (
                  <a
                    href={`tel:${selectedEmployee.mobile}`}
                    className="flex items-center gap-2 bg-white/10 backdrop-blur-md px-3 py-2 rounded-full border border-white/20 shadow-lg hover:bg-white/20 transition-all cursor-pointer w-full sm:w-auto justify-center"
                  >
                    <DevicePhoneMobileIcon className="w-4 h-4 text-white flex-shrink-0" />
                    <span className="text-xs font-medium">{selectedEmployee.mobile}</span>
                  </a>
                )}
                {selectedEmployee.phone && (
                  <a
                    href={`tel:${selectedEmployee.phone}`}
                    className="flex items-center gap-2 bg-white/10 backdrop-blur-md px-3 py-2 rounded-full border border-white/20 shadow-lg hover:bg-white/20 transition-all cursor-pointer w-full sm:w-auto justify-center"
                  >
                    <PhoneIcon className="w-4 h-4 text-white flex-shrink-0" />
                    <span className="text-xs font-medium">
                      {selectedEmployee.phone}
                      {selectedEmployee.phone_ext && <span className="ml-1 text-white/80">Ext: {selectedEmployee.phone_ext}</span>}
                    </span>
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mobile message actions modal - long-press on message */}
      {mobileMessageActionMessage && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileMessageActionMessage(null)}
        >
          <div
            className="w-full max-w-md bg-base-100 rounded-t-2xl shadow-2xl border-t border-base-300 pb-safe"
            onClick={e => e.stopPropagation()}
          >
            {/* Message box preview at top - same look as in chat */}
            <div className="p-4 border-b border-base-300">
              <p className="text-xs font-medium text-base-content/60 mb-2">Message</p>
              <div
                className={`inline-block max-w-full rounded-2xl px-3 py-2 shadow-sm ${
                  mobileMessageActionMessage.sender_id === currentUser?.id
                    ? 'text-white rounded-br-md'
                    : 'border rounded-bl-md bg-base-200 border-base-300 text-base-content'
                }`}
                style={
                  mobileMessageActionMessage.sender_id === currentUser?.id
                    ? { background: 'linear-gradient(to bottom right, #047857, #0f766e)' }
                    : {}
                }
              >
                {mobileMessageActionMessage.message_type === 'album' &&
                mobileMessageActionMessage.media_attachments &&
                mobileMessageActionMessage.media_attachments.length > 0 ? (
                  <div className="grid grid-cols-3 gap-1 w-full max-w-[min(100%,320px)]">
                    {mobileMessageActionMessage.media_attachments.slice(0, 9).map((a, i) =>
                      a.type.startsWith('video/') ? (
                        <div key={i} className="relative aspect-square rounded overflow-hidden bg-base-300">
                          <video src={a.url} className="w-full h-full object-cover" muted playsInline preload="metadata" />
                        </div>
                      ) : (
                        <img key={i} src={a.url} alt="" className="w-full aspect-square object-cover rounded" />
                      )
                    )}
                  </div>
                ) : mobileMessageActionMessage.content ? (
                  <p className="text-base whitespace-pre-wrap break-words max-h-32 overflow-y-auto">
                    {mobileMessageActionMessage.content}
                  </p>
                ) : mobileMessageActionMessage.attachment_url ? (
                  <div className="flex items-center gap-2">
                    {mobileMessageActionMessage.message_type === 'image' ? (
                      <img
                        src={mobileMessageActionMessage.attachment_url}
                        alt=""
                        className="max-h-24 max-w-full rounded-lg object-cover"
                      />
                    ) : mobileMessageActionMessage.message_type === 'voice' ? (
                      <span className="text-base">🎤 Voice message</span>
                    ) : (
                      <span className="text-base">
                        📎 {mobileMessageActionMessage.attachment_name || 'Attachment'}
                      </span>
                    )}
                  </div>
                ) : (
                  <p className="text-base opacity-70">Message</p>
                )}
              </div>
            </div>
            <div className="p-3 flex flex-col gap-1">
              <button
                onClick={() => {
                  setMessageToReply(mobileMessageActionMessage);
                  setMobileMessageActionMessage(null);
                  setTimeout(() => {
                    if (mobileMessageInputRef.current) mobileMessageInputRef.current.focus();
                  }, 100);
                }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-base font-medium text-base-content hover:bg-base-200 transition-colors text-left"
              >
                <ChatBubbleBottomCenterTextIcon className="w-5 h-5 text-base-content/70" />
                Reply
              </button>
              <button
                onClick={() => {
                  setMessageToForward(mobileMessageActionMessage);
                  setShowForwardModal(true);
                  setMobileMessageActionMessage(null);
                }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-base font-medium text-base-content hover:bg-base-200 transition-colors text-left"
              >
                <ArrowRightIcon className="w-5 h-5 text-base-content/70" />
                Forward
              </button>
              <button
                onClick={() => {
                  if (mobileMessageActionMessage) togglePinMessage(mobileMessageActionMessage);
                  setMobileMessageActionMessage(null);
                }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-base font-medium text-base-content hover:bg-base-200 transition-colors text-left"
              >
                <BookmarkIcon
                  className={`w-5 h-5 text-base-content/70 ${
                    mobileMessageActionMessage &&
                    rmqPinnedRows.some(r => r.message.id === mobileMessageActionMessage.id)
                      ? 'text-amber-500'
                      : ''
                  }`}
                />
                {mobileMessageActionMessage &&
                rmqPinnedRows.some(r => r.message.id === mobileMessageActionMessage.id)
                  ? 'Unpin message'
                  : 'Pin message'}
              </button>
              <button
                onClick={() => {
                  setMessageToFlag(mobileMessageActionMessage);
                  setShowRmqFlagLeadModal(true);
                  setMobileMessageActionMessage(null);
                }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-base font-medium text-base-content hover:bg-base-200 transition-colors text-left"
              >
                <FlagIcon className="w-5 h-5 text-amber-600" />
                Flag to lead…
              </button>
              {mobileMessageActionMessage.sender_id === currentUser?.id && (
                <>
                  <button
                    onClick={() => {
                      setMessageToEdit(mobileMessageActionMessage);
                      setEditingMessageText(mobileMessageActionMessage.content || '');
                      setMobileMessageActionMessage(null);
                      setTimeout(() => {
                        if (mobileMessageInputRef.current) mobileMessageInputRef.current.focus();
                      }, 100);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-base font-medium text-base-content hover:bg-base-200 transition-colors text-left"
                  >
                    <PencilIcon className="w-5 h-5 text-base-content/70" />
                    Edit
                  </button>
                  <button
                    onClick={() => {
                      handleDeleteMessage(mobileMessageActionMessage.id);
                      setMobileMessageActionMessage(null);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-base font-medium text-red-600 hover:bg-red-500/10 transition-colors text-left"
                  >
                    <TrashIcon className="w-5 h-5" />
                    Delete
                  </button>
                </>
              )}
              <button
                onClick={() => setMobileMessageActionMessage(null)}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-base font-medium text-base-content/70 hover:bg-base-200 transition-colors mt-2 border-t border-base-300"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Group Info Modal */}
      {showGroupInfoModal && selectedConversation && selectedConversation.type === 'group' && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            {/* Modal Header */}
            <div className="p-6 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-2xl font-bold text-gray-900">Edit Group Info</h2>
              <button
                onClick={() => setShowGroupInfoModal(false)}
                className="btn btn-ghost btn-sm btn-circle"
              >
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto p-6">
              <div className="space-y-6">
                {/* Group Icon */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Group Icon
                  </label>
                  <div className="flex items-center gap-4">
                    {/* Icon Preview */}
                    <div className="flex-shrink-0">
                      {groupIconUrl ? (
                        <div className="relative">
                          <img
                            src={groupIconUrl}
                            alt="Group icon"
                            className="w-20 h-20 rounded-full object-cover border-2 border-gray-200"
                          />
                          <button
                            onClick={handleRemoveIcon}
                            className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600 transition-colors"
                            title="Remove icon"
                          >
                            <XMarkIcon className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-green-500 to-teal-500 flex items-center justify-center text-white border-2 border-gray-200">
                          <UserGroupIcon className="w-10 h-10" />
                        </div>
                      )}
                    </div>

                    {/* Upload Button */}
                    <div className="flex-1">
                      <input
                        ref={groupIconInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleIconFileSelect}
                        className="hidden"
                      />
                      <button
                        onClick={() => groupIconInputRef.current?.click()}
                        disabled={isUploadingIcon}
                        className="btn btn-outline"
                      >
                        {isUploadingIcon ? (
                          <>
                            <span className="loading loading-spinner loading-sm mr-2"></span>
                            Uploading...
                          </>
                        ) : (
                          <>
                            <PhotoIcon className="w-5 h-5 mr-2" />
                            {groupIconUrl ? 'Change Icon' : 'Upload Icon'}
                          </>
                        )}
                      </button>
                      <p className="text-xs text-gray-500 mt-2">
                        Upload a custom icon for this group (max 5MB, JPG/PNG/GIF)
                      </p>
                    </div>
                  </div>
                </div>

                {/* Group Name */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Group Name *
                  </label>
                  <input
                    type="text"
                    value={groupTitle}
                    onChange={(e) => setGroupTitle(e.target.value)}
                    placeholder="Enter group name..."
                    className="input input-bordered w-full"
                    maxLength={255}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    The display name for this group
                  </p>
                </div>

                {/* Group Description */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Description
                  </label>
                  <textarea
                    value={groupDescription}
                    onChange={(e) => setGroupDescription(e.target.value)}
                    placeholder="Add a description for this group..."
                    className="textarea textarea-bordered w-full min-h-[100px]"
                    rows={4}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    A brief description of the group's purpose
                  </p>
                </div>

                {/* Group Notes */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Notes
                  </label>
                  <textarea
                    value={groupNotes}
                    onChange={(e) => setGroupNotes(e.target.value)}
                    placeholder="Add internal notes about this group..."
                    className="textarea textarea-bordered w-full min-h-[150px]"
                    rows={6}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Internal notes (visible to all group members)
                  </p>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-6 border-t border-gray-200 flex gap-3">
              <button
                onClick={() => setShowGroupInfoModal(false)}
                className="btn btn-outline flex-1"
                disabled={isUpdatingGroupInfo}
              >
                Cancel
              </button>
              <button
                onClick={() => updateGroupInfo(
                  selectedConversation.id,
                  groupTitle,
                  groupDescription,
                  groupNotes,
                  groupIconUrl
                )}
                className="btn btn-primary flex-1"
                disabled={isUpdatingGroupInfo || !groupTitle.trim()}
                style={{ backgroundColor: '#3E17C3', borderColor: '#3E17C3' }}
              >
                {isUpdatingGroupInfo ? (
                  <>
                    <span className="loading loading-spinner loading-sm mr-2"></span>
                    Saving...
                  </>
                ) : (
                  'Save Changes'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Employee Profile Modal */}
      {showEmployeeProfileModal && selectedEmployee && (
        <EmployeeModal
          employee={{
            id: selectedEmployee.id,
            display_name: selectedEmployee.official_name || selectedEmployee.display_name,
            email: selectedEmployee.email,
            bonuses_role: selectedEmployee.bonuses_role,
            department: selectedEmployee.department,
            is_active: selectedEmployee.is_active,
            photo_url: selectedEmployee.photo_url,
            mobile: selectedEmployee.mobile,
            phone: selectedEmployee.phone,
          }}
          allEmployees={allUsers
            .filter(user => user.tenants_employee)
            .map(user => ({
              id: user.employee_id?.toString() || '',
              display_name: user.tenants_employee?.official_name || user.tenants_employee?.display_name || user.full_name || '',
              email: user.email,
              bonuses_role: user.tenants_employee?.bonuses_role || '',
              department: user.tenants_employee?.tenant_departement?.name || '',
              is_active: user.is_active ?? true,
              photo_url: user.tenants_employee?.photo_url,
              mobile: user.tenants_employee?.mobile,
              phone: user.tenants_employee?.phone,
            }))}
          isOpen={showEmployeeProfileModal}
          onClose={() => {
            setShowEmployeeProfileModal(false);
            setSelectedEmployee(null);
          }}
        />
      )}
    </div>
  );
};

export default RMQMessagesPage;
