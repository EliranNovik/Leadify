import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { toast } from 'react-hot-toast';
import websocketService, { MessageData, TypingData } from '../lib/websocket';
import { motion, AnimatePresence } from 'framer-motion';

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
  BriefcaseIcon,
  BuildingOfficeIcon,
  ClockIcon,
  TrashIcon,
  ArrowRightIcon,
  LockClosedIcon,
  LockOpenIcon
} from '@heroicons/react/24/outline';
import { format, isToday, isYesterday, formatDistanceToNow } from 'date-fns';
import EmployeeModal from '../components/EmployeeModal';

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
  message_type: 'text' | 'file' | 'image' | 'system' | 'voice';
  sent_at: string;
  edited_at?: string;
  is_deleted: boolean;
  attachment_url?: string;
  attachment_name?: string;
  attachment_type?: string;
  attachment_size?: number;
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

interface MessagingModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialConversationId?: number;
  initialUserId?: string;
  initialMessage?: string;
  initialLeadNumber?: string;
  initialLeadName?: string;
}

const RMQMessagesPage: React.FC<MessagingModalProps> = ({ isOpen, onClose, initialConversationId, initialUserId, initialMessage, initialLeadNumber, initialLeadName }) => {
  // State management
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [activeTab, setActiveTab] = useState<'chats' | 'groups'>('chats');
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
  const [selectedEmployee, setSelectedEmployee] = useState<any>(null);
  
  // Employee availability state
  const [isEmployeeUnavailable, setIsEmployeeUnavailable] = useState(false);
  const [unavailabilityReason, setUnavailabilityReason] = useState<string | null>(null);
  const [unavailabilityTimePeriod, setUnavailabilityTimePeriod] = useState<string | null>(null);
  
  // Forward message state
  const [showForwardModal, setShowForwardModal] = useState(false);
  const [messageToForward, setMessageToForward] = useState<Message | null>(null);
  const [forwardSearchQuery, setForwardSearchQuery] = useState('');
  
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
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const desktopMessagesContainerRef = useRef<HTMLDivElement>(null);
  const mobileMessagesContainerRef = useRef<HTMLDivElement>(null);
  const mobileToolsRef = useRef<HTMLDivElement>(null);
  const desktopToolsRef = useRef<HTMLDivElement>(null);
  
  // Auto-scroll state
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const [newMessagesCount, setNewMessagesCount] = useState(0);
  const [showFloatingDate, setShowFloatingDate] = useState(false);
  const [floatingDate, setFloatingDate] = useState<string | null>(null);
  const [floatingDateOpacity, setFloatingDateOpacity] = useState(0);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const floatingDateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isScrollingForDateRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const lastDateRef = useRef<string | null>(null);
  const opacityRef = useRef(0);
  const isFadingOutRef = useRef(false);
  const lastScrollPositionRef = useRef<number>(0);
  const scrollPositionCheckRef = useRef<NodeJS.Timeout | null>(null);

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

  // Helper function to render clickable links in messages
  const renderMessageContent = (content: string, isOwn: boolean = false) => {
    // Check if content contains markdown-style links
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    const parts = [];
    let lastIndex = 0;
    let match;

    while ((match = linkRegex.exec(content)) !== null) {
      // Add text before the link
      if (match.index > lastIndex) {
        parts.push(content.slice(lastIndex, match.index));
      }
      
      // Add the clickable link with appropriate styling based on message ownership
      parts.push(
        <a
          key={match.index}
          href={match[2]}
          target="_blank"
          rel="noopener noreferrer"
          className={isOwn ? "text-white hover:text-gray-200 underline" : "text-blue-600 hover:text-blue-800 underline"}
        >
          {match[1]}
        </a>
      );
      
      lastIndex = match.index + match[0].length;
    }
    
    // Add remaining text after the last link
    if (lastIndex < content.length) {
      parts.push(content.slice(lastIndex));
    }
    
    // If no links found, return original content
    return parts.length > 0 ? parts : content;
  };

  const isImageMessage = (message: Message): boolean => {
    if (!message.attachment_url) return false;
    if (message.message_type === 'image') return true;
    if (message.attachment_type && message.attachment_type.startsWith('image/')) return true;
    return false;
  };

  const isVideoMessage = (message: Message): boolean => {
    if (!message.attachment_url) return false;
    if (message.attachment_type && message.attachment_type.startsWith('video/')) return true;
    return false;
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

  // Render read receipt checkmarks (WhatsApp-style)
  const renderReadReceipts = (message: Message) => {
    const status = getReadReceiptStatus(message);
    
    if (status === 'sent') {
      // One white checkmark
      return (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20" style={{ color: 'rgba(255, 255, 255, 0.7)' }}>
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
      );
    } else if (status === 'delivered') {
      // Two white checkmarks
      return (
        <div className="flex items-center -space-x-1">
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20" style={{ color: 'rgba(255, 255, 255, 0.7)' }}>
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20" style={{ color: 'rgba(255, 255, 255, 0.7)' }}>
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
        </div>
      );
    } else {
      // Two bright green checkmarks
      return (
        <div className="flex items-center -space-x-1">
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20" style={{ color: '#10ff88' }}>
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20" style={{ color: '#10ff88' }}>
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
        </div>
      );
    }
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
    const now = new Date();
    
    if (isToday(date)) {
      return format(date, 'HH:mm');
    } else if (isYesterday(date)) {
      // Show actual time instead of "Yesterday"
      return format(date, 'HH:mm');
    } else {
      // Always show day of week and time for older messages
      return format(date, 'EEE HH:mm'); // Day of week + time (e.g., "Mon 14:30")
    }
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

  // Media gallery functions
  const getConversationMedia = (): Message[] => {
    if (!selectedConversation) return [];
    return messages.filter((message) => isImageMessage(message) || isVideoMessage(message));
  };

  const openMediaModal = (message: Message) => {
    const media = getConversationMedia();
    const index = media.findIndex(m => m.id === message.id);
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
            setShowEmployeeInfoModal(true);
          }
        };
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
          sizeClass: 'w-14 h-14',
              borderClass: '',
          textClass: 'text-lg',
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
          setSelectedConversation(conversation);
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
      const iconSize = size === 'xlarge' ? 'w-16 h-16' : size === 'large' ? 'w-14 h-14' : 'w-10 h-10';
      const iconInnerSize = size === 'xlarge' ? 'w-8 h-8' : size === 'large' ? 'w-7 h-7' : 'w-5 h-5';
      
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
          .single();

        if (error) {
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
            console.log('⌨️ Typing event received:', data);
            const { conversation_id, user_id, user_name, is_typing } = data;
            
            // Don't show typing indicator for own messages
            if (user_id === currentUser?.id) {
              console.log('⌨️ Ignoring own typing event');
              return;
            }
            
            if (is_typing) {
              console.log('⌨️ User is typing:', user_name);
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
              console.log('⌨️ User stopped typing:', user_name);
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
              if (allUsers.length > 0 && websocketService.isSocketConnected()) {
                const userIds = allUsers.map(u => String(u.id));
                console.log('📤 Requesting online status for', userIds.length, 'users');
                websocketService.requestOnlineStatus(userIds);
              } else {
                console.warn('⚠️ Cannot request online status:', {
                  allUsersLength: allUsers.length,
                  isConnected: websocketService.isSocketConnected()
                });
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
      }
    };
  }, [isOpen, selectedConversation?.id]);

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
  const fetchConversations = useCallback(async (showErrors = true) => {
    if (!currentUser) return;

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

      // Process conversations and calculate unread counts
      const processedConversations = await Promise.all(
        (conversationsData || []).map(async (conv: any) => {
          // Check if aborted during processing
          if (abortController.signal.aborted) {
            return null;
          }

          try {
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

  // Fetch messages for selected conversation
  const fetchMessages = useCallback(async (conversationId: number) => {
    try {
      const { data: messagesData, error } = await supabase
        .from('messages')
        .select(`
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
          ),
          reply_to_message:messages!reply_to_message_id(
            id,
            content,
            sender:users!sender_id(
              id,
              full_name,
              is_active,
              tenants_employee!users_employee_id_fkey(display_name)
            )
          )
        `)
        .eq('conversation_id', conversationId)
        .eq('is_deleted', false)
        .order('sent_at', { ascending: true });

      if (error) {
        toast.error('Failed to load messages');
        return;
      }

      // Fetch read receipts for all messages
      if (messagesData && messagesData.length > 0 && currentUser) {
        const messageIds = messagesData.map(m => m.id);
        // Filter out undefined/null message IDs
        const validMessageIds = messageIds.filter(id => id != null && id !== undefined);
        
        if (validMessageIds.length === 0) {
          setMessages(messagesData as unknown as Message[]);
          return;
        }

        const { data: readReceiptsData } = await supabase
          .from('message_read_receipts')
          .select('message_id, user_id, read_at')
          .in('message_id', validMessageIds);

        // Attach read receipts to messages
        const messagesWithReceipts = messagesData.map((msg: any) => ({
          ...msg,
          read_receipts: readReceiptsData?.filter(rr => rr.message_id === msg.id) || []
        }));

        setMessages(messagesWithReceipts as unknown as Message[]);
        
        // Mark messages as read for current user when viewing conversation
        await markMessagesAsRead(messageIds, conversationId);
      } else {
        setMessages((messagesData || []) as unknown as Message[]);
      }
      
      // Mark conversation as read
      if (currentUser) {
        await supabase.rpc('mark_conversation_as_read', {
          conv_id: conversationId,
          user_uuid: currentUser.id
        });
        
        // Update local unread count
        setConversations(prev => 
          prev.map(conv => 
            conv.id === conversationId 
              ? { ...conv, unread_count: 0 }
              : conv
          )
        );
      }
      
      // Ensure auto-scroll is enabled
      setShouldAutoScroll(true);
      setIsUserScrolling(false);
      setNewMessagesCount(0);
      
      // Force scroll to bottom after messages are loaded (works for both desktop and mobile)
      // Use multiple attempts to ensure scroll happens after DOM updates
      setTimeout(() => {
          scrollToBottom('instant');
        setTimeout(() => {
          scrollToBottom('instant');
        }, 200);
        setTimeout(() => {
          scrollToBottom('smooth');
        }, 400);
      }, 100);
    } catch (error) {
      toast.error('Failed to load messages');
    }
  }, [currentUser]);

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
        .neq('id', currentUser.id)
        .order('full_name', { ascending: true });

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
      
      // Validate file size - videos have higher limit (200MB), other files 15MB
      // NOTE: Supabase Free tier has a 50MB limit. Pro tier allows up to 5GB per file.
      // If you get upload errors, reduce the video limit to match your Supabase plan.
      const isVideo = file.type.startsWith('video/');
      const maxSize = isVideo ? 200 * 1024 * 1024 : 15 * 1024 * 1024; // 200MB for videos, 15MB for others
      const maxSizeMB = isVideo ? 200 : 15;
      
      if (file.size > maxSize) {
        toast.error(`File size must be less than ${maxSizeMB}MB`);
        return null;
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
        
        // Provide more specific error messages
        if (error.message?.includes('Bucket not found') || error.message?.includes('does not exist')) {
          toast.error('Storage bucket not found. Please check bucket configuration.');
        } else if (error.message?.includes('new row violates row-level security') || error.message?.includes('permission')) {
          toast.error('Permission denied. Please check bucket policies.');
        } else if (error.message?.includes('NetworkError') || error.message?.includes('Failed to fetch')) {
          toast.error('Network error. Please check your connection and try again.');
        } else if (error.message?.includes('File size') || error.message?.includes('too large')) {
          toast.error(`File is too large. ${isVideo ? 'Videos must be less than 100MB.' : 'Files must be less than 15MB.'}`);
        } else {
          toast.error(`Failed to upload file: ${error.message || 'Unknown error'}`);
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

  // Handle file input change
  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const fileUrl = await uploadFile(file);
    if (fileUrl) {
      // Send message with attachment
      await sendMessageWithAttachment(file, fileUrl);
    }
    
    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
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
      let messageType: 'text' | 'file' | 'image' | 'system' = 'text';
      if (messageToForward.message_type === 'image' || (messageToForward.attachment_type && messageToForward.attachment_type.startsWith('image/'))) {
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
        } else {
          websocketService.sendMessage(
            targetConversationId,
            forwardContent,
            messageType,
            messageToForward.attachment_url || undefined,
            messageToForward.attachment_type || undefined,
            messageToForward.attachment_size || undefined
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
          attachment_size: messageToForward.attachment_size || null
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

  // Send message with attachment
  const sendMessageWithAttachment = async (file: File, fileUrl: string) => {
    if (!selectedConversation || !currentUser) return;
    
    setIsSending(true);
    try {
      // Determine message type based on file type
      let messageType: 'text' | 'file' | 'image' | 'system' = 'file';
      if (file.type.startsWith('image/')) {
        messageType = 'image';
      }
      
      // Send via WebSocket for real-time delivery
      if (websocketService.isSocketConnected()) {
        websocketService.sendMessage(
          selectedConversation.id, 
          file.name, 
          messageType, 
          fileUrl, 
          file.type, 
          file.size
        );
      }
      
      // Save to database with attachment
      const { data: messageData, error } = await supabase
        .from('messages')
        .insert({
          conversation_id: selectedConversation.id,
          sender_id: currentUser.id,
          content: file.name,
          message_type: messageType,
          attachment_url: fileUrl,
          attachment_name: file.name,
          attachment_type: file.type,
          attachment_size: file.size
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
              content: file.name,
              messageType: messageType,
              attachmentName: file.name,
            }),
          });
        } catch (pushError) {
          // Don't throw - this is a background operation
        }
      }
      
      // Only add message to local state if WebSocket is NOT connected
      if (!websocketService.isSocketConnected()) {
        setMessages(prev => [...prev, messageData as unknown as Message]);
      }
      
      // Always scroll to bottom when user sends a message
      setTimeout(() => scrollToBottom('smooth'), 100);
      
      // Only update conversation list if WebSocket is NOT connected
      if (!websocketService.isSocketConnected()) {
        setConversations(prev => 
          prev.map(conv => 
            conv.id === selectedConversation.id
              ? {
                  ...conv,
                  last_message_at: messageData.sent_at,
                  last_message_preview: `📎 ${file.name}`
                }
              : conv
          ).sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime())
        );
      }
      
    } catch (error) {
      toast.error('Failed to send attachment');
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
      // On desktop, send message on Enter
      if (newMessage.trim() && !isSending) {
        sendMessage();
      }
    }
    // Shift+Enter will allow default behavior (new line)
  };

  const sendMessage = async () => {
    if (!selectedConversation || !currentUser || !newMessage.trim()) return;
    
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
        websocketService.sendMessage(selectedConversation.id, newMessage.trim(), 'text');
      } else {
      }

      // Also save to database
      const { data: messageData, error } = await supabase
        .from('messages')
        .insert({
          conversation_id: selectedConversation.id,
          sender_id: currentUser.id,
          content: newMessage.trim(),
          message_type: 'text'
        })
        .select(`
          id,
          conversation_id,
          sender_id,
          content,
          message_type,
          sent_at,
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
              content: newMessage.trim(),
              messageType: 'text',
            }),
          });
        } catch (pushError) {
          // Don't throw - this is a background operation
        }
      }

      // Only add message to local state if WebSocket is NOT connected
      // If WebSocket is connected, the message will come through the WebSocket handler
      if (!websocketService.isSocketConnected()) {
        setMessages(prev => [...prev, messageData as unknown as Message]);
      }
      
      setNewMessage('');
      resetInputHeights();
      
      // Always scroll to bottom when user sends a message
      setTimeout(() => scrollToBottom('smooth'), 100);
      
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
        setSelectedConversation(existingConv);
        fetchMessages(existingConv.id);
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
          setSelectedConversation(newConv);
          fetchMessages(newConv.id);
          setShowMobileConversations(false);
          setActiveTab('chats');
          toast.success('Direct conversation started');
        } else {
          // Try one more time after a longer delay
          setTimeout(async () => {
            const retryConversations = await getUpdatedConversations();
            const retryConv = retryConversations.find(c => c.id === conversationId);
            if (retryConv) {
              setSelectedConversation(retryConv);
              fetchMessages(retryConv.id);
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
      setSelectedConversation(null);
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
      setSelectedConversation(null);
      
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
          setSelectedConversation(newConversation);
          fetchMessages(newConversation.id);
        } else {
          // Fallback: create a temporary conversation object with participants
          const tempConversation = {
            ...conversationData,
            participants: [
              { user_id: currentUser.id, user: currentUser },
              ...selectedUsers.map(userId => ({ user_id: userId }))
            ]
          };
          setSelectedConversation(tempConversation);
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
        setSelectedConversation(updatedConversation);
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
          setSelectedConversation(updatedConversation);
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
        setSelectedConversation(updatedConversation);
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
        setSelectedConversation(updatedConversation);
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

  // Smart auto-scroll logic - scrolls the visible container (desktop or mobile)
  const scrollToBottom = (behavior: 'smooth' | 'instant' = 'smooth') => {
    // Try desktop container first
    let container: HTMLDivElement | null = null;
    
    if (desktopMessagesContainerRef.current) {
      const desktopContainer = desktopMessagesContainerRef.current;
      // Check if desktop container is visible (has dimensions)
      if (desktopContainer.offsetWidth > 0 && desktopContainer.offsetHeight > 0) {
        container = desktopContainer;
      }
    }
    
    // If desktop not visible, try mobile container
    if (!container && mobileMessagesContainerRef.current) {
      const mobileContainer = mobileMessagesContainerRef.current;
      // Check if mobile container is visible (has dimensions)
      if (mobileContainer.offsetWidth > 0 && mobileContainer.offsetHeight > 0) {
        container = mobileContainer;
      }
    }
    
    // Fallback to original ref if separate refs don't work
    if (!container && messagesContainerRef.current) {
      const fallbackContainer = messagesContainerRef.current;
      if (fallbackContainer.offsetWidth > 0 && fallbackContainer.offsetHeight > 0) {
        container = fallbackContainer;
      }
    }
    
    // Scroll the visible container
    if (container) {
      const targetScroll = container.scrollHeight;
      
      if (behavior === 'instant') {
        container.scrollTop = targetScroll;
      } else {
        container.scrollTo({
          top: targetScroll,
          behavior: 'smooth'
        });
      }
    }
    
    // Method 2: Use scrollIntoView on the end ref (backup)
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ 
        behavior: behavior === 'instant' ? 'auto' : behavior,
        block: 'end',
        inline: 'nearest'
      });
    }
  };

  // Check if user is near bottom of messages
  const isNearBottom = () => {
    // Check desktop container first
    let container: HTMLDivElement | null = null;
    
    if (desktopMessagesContainerRef.current && desktopMessagesContainerRef.current.offsetWidth > 0) {
      container = desktopMessagesContainerRef.current;
    } else if (mobileMessagesContainerRef.current && mobileMessagesContainerRef.current.offsetWidth > 0) {
      container = mobileMessagesContainerRef.current;
    } else if (messagesContainerRef.current && messagesContainerRef.current.offsetWidth > 0) {
      container = messagesContainerRef.current;
    }
    
    if (!container) return true;
    const { scrollTop, scrollHeight, clientHeight } = container;
    const threshold = 100; // 100px from bottom
    return scrollHeight - scrollTop - clientHeight < threshold;
  };

  // Handle scroll events to detect user scrolling
  const handleScroll = useCallback(() => {
    const nearBottom = isNearBottom();
    
    // Get current scroll position to detect if scrolling has actually stopped
    let container: HTMLDivElement | null = null;
    if (mobileMessagesContainerRef.current && mobileMessagesContainerRef.current.offsetWidth > 0) {
      container = mobileMessagesContainerRef.current;
    } else if (desktopMessagesContainerRef.current && desktopMessagesContainerRef.current.offsetWidth > 0) {
      container = desktopMessagesContainerRef.current;
    } else if (messagesContainerRef.current && messagesContainerRef.current.offsetWidth > 0) {
      container = messagesContainerRef.current;
    }
    
    const currentScrollPosition = container ? container.scrollTop : 0;
    const scrollPositionChanged = Math.abs(currentScrollPosition - lastScrollPositionRef.current) > 1;
    lastScrollPositionRef.current = currentScrollPosition;
    
    // If we're fading out, completely ignore all scroll events for a period
    if (isFadingOutRef.current) {
      return;
    }
    
    // Only process if position actually changed
    if (!scrollPositionChanged) {
      return;
    }
    
    // Mark that we're scrolling
    isScrollingForDateRef.current = true;
    
    // Clear any existing floating date timeout
    if (floatingDateTimeoutRef.current) {
      clearTimeout(floatingDateTimeoutRef.current);
      floatingDateTimeoutRef.current = null;
    }
    
    // Clear scroll position check timeout
    if (scrollPositionCheckRef.current) {
      clearTimeout(scrollPositionCheckRef.current);
      scrollPositionCheckRef.current = null;
    }
    
    // Don't clear hideTimeoutRef if we're fading out - let it complete
    if (hideTimeoutRef.current && !nearBottom && !isFadingOutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    } else if (hideTimeoutRef.current && isFadingOutRef.current) {
      isScrollingForDateRef.current = false;
    }
    
    // If user scrolls to bottom, enable auto-scroll and reset count
    if (nearBottom) {
      setShouldAutoScroll(true);
      setIsUserScrolling(false);
      setNewMessagesCount(0);
      isScrollingForDateRef.current = false;
      isFadingOutRef.current = false;
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
        hideTimeoutRef.current = null;
      }
      opacityRef.current = 0;
      setFloatingDateOpacity(0);
      hideTimeoutRef.current = setTimeout(() => {
        setShowFloatingDate(false);
        setFloatingDate(null);
        lastDateRef.current = null;
        opacityRef.current = 0;
        isFadingOutRef.current = false;
        hideTimeoutRef.current = null;
      }, 200);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }
    
      // If user scrolls up, disable auto-scroll temporarily
      setShouldAutoScroll(false);
      setIsUserScrolling(true);
    
    // Cancel any pending RAF and schedule a new one to batch updates
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
    }
    
    rafRef.current = requestAnimationFrame(() => {
      // Don't update date if we're fading out
      if (isFadingOutRef.current) {
        rafRef.current = null;
        return;
      }
      
      // Calculate which date is visible at the top when scrolling
      let container: HTMLDivElement | null = null;
      if (mobileMessagesContainerRef.current && mobileMessagesContainerRef.current.offsetWidth > 0) {
        container = mobileMessagesContainerRef.current;
      } else if (desktopMessagesContainerRef.current && desktopMessagesContainerRef.current.offsetWidth > 0) {
        container = desktopMessagesContainerRef.current;
      } else if (messagesContainerRef.current && messagesContainerRef.current.offsetWidth > 0) {
        container = messagesContainerRef.current;
      }
      
      if (container && messages.length > 0) {
        const containerRect = container.getBoundingClientRect();
        const containerTop = containerRect.top;
        
        let visibleDate: string | null = null;
        let closestDistance = Infinity;
        const messageElements = container.querySelectorAll('[data-message-id]');
        
        for (let i = 0; i < messageElements.length; i++) {
          const element = messageElements[i] as HTMLElement;
          const elementRect = element.getBoundingClientRect();
          
          const isVisible = elementRect.top < containerRect.bottom && elementRect.bottom > containerTop;
          
          if (isVisible) {
            const distanceFromTop = elementRect.top - containerTop;
            
            if (distanceFromTop >= -50 && distanceFromTop < 200) {
              const messageId = element.getAttribute('data-message-id');
              if (messageId) {
                const message = messages.find(m => String(m.id) === messageId);
                if (message) {
                  if (distanceFromTop < closestDistance) {
                    visibleDate = message.sent_at;
                    closestDistance = distanceFromTop;
                  }
                }
              }
            }
          }
        }
        
        if (visibleDate) {
          if (lastDateRef.current !== visibleDate) {
            lastDateRef.current = visibleDate;
            setFloatingDate(visibleDate);
            setShowFloatingDate(true);
            if (opacityRef.current !== 1 && !isFadingOutRef.current) {
              opacityRef.current = 1;
              setFloatingDateOpacity(1);
            }
          } else if (opacityRef.current < 0.5 && !isFadingOutRef.current) {
            opacityRef.current = 1;
            setFloatingDateOpacity(1);
          }
        } else if (messageElements.length > 0) {
          for (let i = 0; i < messageElements.length; i++) {
            const element = messageElements[i] as HTMLElement;
            const elementRect = element.getBoundingClientRect();
            
            if (elementRect.top < containerRect.bottom && elementRect.bottom > containerTop) {
              const messageId = element.getAttribute('data-message-id');
              if (messageId) {
                const message = messages.find(m => String(m.id) === messageId);
                if (message && lastDateRef.current !== message.sent_at) {
                  lastDateRef.current = message.sent_at;
                  setFloatingDate(message.sent_at);
                  setShowFloatingDate(true);
                  if (opacityRef.current !== 1 && !isFadingOutRef.current) {
                    opacityRef.current = 1;
                    setFloatingDateOpacity(1);
                  }
                  break;
                }
              }
            }
          }
        }
      }
      
      rafRef.current = null;
    });
    
    // Set timeout to hide floating date after scrolling stops
    if (floatingDateTimeoutRef.current) {
      clearTimeout(floatingDateTimeoutRef.current);
    }
    
    floatingDateTimeoutRef.current = setTimeout(() => {
      const checkContainer: HTMLDivElement | null = 
        (mobileMessagesContainerRef.current && mobileMessagesContainerRef.current.offsetWidth > 0) ? mobileMessagesContainerRef.current :
        (desktopMessagesContainerRef.current && desktopMessagesContainerRef.current.offsetWidth > 0) ? desktopMessagesContainerRef.current :
        (messagesContainerRef.current && messagesContainerRef.current.offsetWidth > 0) ? messagesContainerRef.current : null;
      
      const checkScrollPosition = checkContainer ? checkContainer.scrollTop : 0;
      const positionStillSame = Math.abs(checkScrollPosition - lastScrollPositionRef.current) <= 1;
      
      if (positionStillSame && !isFadingOutRef.current) {
        isScrollingForDateRef.current = false;
        isFadingOutRef.current = true;
        
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        
        opacityRef.current = 0;
        setFloatingDateOpacity(0);
        
        if (hideTimeoutRef.current) {
          clearTimeout(hideTimeoutRef.current);
        }
        hideTimeoutRef.current = setTimeout(() => {
          if (!isScrollingForDateRef.current) {
            setShowFloatingDate(false);
            setFloatingDate(null);
            lastDateRef.current = null;
            opacityRef.current = 0;
            isFadingOutRef.current = true;
            setTimeout(() => {
              isFadingOutRef.current = false;
            }, 300);
          } else {
            isFadingOutRef.current = false;
          }
          hideTimeoutRef.current = null;
        }, 200);
      }
      floatingDateTimeoutRef.current = null;
    }, 400);
  }, [messages, isNearBottom]);

  // Track previous message count to detect new messages
  const prevMessageCountRef = useRef(0);
  const isScrollingRef = useRef(false);

  // Auto-scroll to bottom when new messages arrive (only if should auto-scroll)
  useEffect(() => {
    // Clear any pending scroll attempts
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = null;
    }

    if (shouldAutoScroll && messages.length > 0 && selectedConversation && !isScrollingRef.current) {
      // Reset new messages count when auto-scrolling
      setNewMessagesCount(0);
      
      // Use a single controlled scroll attempt after DOM updates
      isScrollingRef.current = true;
      scrollTimeoutRef.current = setTimeout(() => {
        scrollToBottom('smooth');
        // Reset scrolling flag after scroll completes
              setTimeout(() => {
          isScrollingRef.current = false;
        }, 300);
      }, 100);
    } else if (!shouldAutoScroll && messages.length > prevMessageCountRef.current && selectedConversation) {
      // User is scrolled up and new messages arrived - increment count
      const newCount = messages.length - prevMessageCountRef.current;
      setNewMessagesCount(prev => prev + newCount);
    }
    
    // Update previous message count
    prevMessageCountRef.current = messages.length;

    // Cleanup timeout on unmount
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, [messages.length, shouldAutoScroll, selectedConversation?.id]);

  // Scroll to bottom when conversation is first selected or changes
  useEffect(() => {
    if (selectedConversation) {
      // Reset auto-scroll state when conversation changes
      setShouldAutoScroll(true);
      setIsUserScrolling(false);
      setNewMessagesCount(0);
      prevMessageCountRef.current = 0;
      
      // Wait for messages to load and DOM to render, then scroll
      if (!isScrollingRef.current) {
        isScrollingRef.current = true;
        setTimeout(() => {
          scrollToBottom('instant');
          setTimeout(() => {
            isScrollingRef.current = false;
          }, 100);
        }, 100);
      }
    }
  }, [selectedConversation?.id]);

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
        setSelectedConversation(conversation);
        fetchMessages(conversation.id);
        setShowMobileConversations(false);
        // Set the correct tab based on conversation type
        if (conversation.type === 'group' || conversation.type === 'announcement') {
          setActiveTab('groups');
        } else {
          setActiveTab('chats');
        }
      }
    }
  }, [isOpen, initialConversationId, conversations, fetchMessages]);

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

  // Auto-scroll to bottom when conversation changes or messages are loaded
  useEffect(() => {
    if (selectedConversation && messages.length > 0) {
      // Reset scroll state
      setShouldAutoScroll(true);
      setIsUserScrolling(false);
      setNewMessagesCount(0);
      
      // Scroll to bottom with multiple attempts to ensure it works
      // Use requestAnimationFrame for better timing with DOM updates
      requestAnimationFrame(() => {
        setTimeout(() => {
          scrollToBottom('instant');
          requestAnimationFrame(() => {
            setTimeout(() => {
              scrollToBottom('instant');
              setTimeout(() => {
                scrollToBottom('smooth');
              }, 200);
            }, 200);
          });
        }, 100);
      });
    }
  }, [selectedConversation?.id, messages.length]); // Trigger when conversation ID or message count changes

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
    const minHeight = 48; // Match button height (h-12 = 48px)
    const newHeight = Math.max(minHeight, Math.min(textarea.scrollHeight, maxHeight));
    textarea.style.height = `${newHeight}px`;
  };

  const resetInputHeights = () => {
    requestAnimationFrame(() => {
      adjustTextareaHeight(messageInputRef.current);
      adjustTextareaHeight(mobileMessageInputRef.current);
    });
  };

  // Handle message input change
  const handleMessageInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setNewMessage(value);
    adjustTextareaHeight(e.target);
    if (e.target !== messageInputRef.current) {
      adjustTextareaHeight(messageInputRef.current);
    }
    if (e.target !== mobileMessageInputRef.current) {
      adjustTextareaHeight(mobileMessageInputRef.current);
    }

    // Send typing indicator
    if (selectedConversation && currentUser && websocketService.isSocketConnected()) {
      const userName = currentUser.full_name || currentUser.email || 'User';
      
      // Send typing started
      console.log('⌨️ Sending typing indicator: true');
      websocketService.sendTyping(
        selectedConversation.id,
        currentUser.id,
        userName,
        true
      );

      // Clear existing timeout
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }

      // Set timeout to stop typing after 2 seconds of inactivity
      typingTimeoutRef.current = setTimeout(() => {
        if (selectedConversation && currentUser && websocketService.isSocketConnected()) {
          console.log('⌨️ Sending typing indicator: false');
          websocketService.sendTyping(
            selectedConversation.id,
            currentUser.id,
            userName,
            false
          );
        }
      }, 2000);
    } else {
      console.warn('⌨️ Cannot send typing indicator:', {
        hasConversation: !!selectedConversation,
        hasUser: !!currentUser,
        isConnected: websocketService.isSocketConnected()
      });
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
        
        // Check if click is inside reaction picker or on a message bubble
        const isInsideReactionPicker = target.closest('button[title^="React with"]') ||
                                      target.closest('[data-message-id]');
        
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
        
        setMessages(prev => {
          // Check if message already exists to avoid duplicates
          const exists = prev.some(m => m.id === message.id || 
            (m.conversation_id === message.conversation_id && 
             m.sender_id === message.sender_id && 
             m.content === message.content && 
             Math.abs(new Date(m.sent_at).getTime() - new Date(message.sent_at).getTime()) < 1000));
          if (exists) {
            return prev;
          }
          
          // Enhance WebSocket message with real user data from conversation participants
          const enhancedMessage = { 
            ...message,
            read_receipts: readReceipts,
            delivery_status: 'sent'
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
          return [...prev, enhancedMessage];
        });
        
        // Scroll to bottom when new message arrives
        setTimeout(() => {
          setShouldAutoScroll(true);
          scrollToBottom('smooth');
        }, 100);
        
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
        if (message.message_type === 'file' || message.message_type === 'image') {
          previewText = message.attachment_name || `📎 ${message.message_type === 'image' ? 'Image' : 'File'}`;
        } else if (message.content && message.content.trim()) {
          previewText = message.content.substring(0, 100);
        } else {
          previewText = 'New message';
        }
        
        return prev.map(conv => 
          conv.id === message.conversation_id
            ? {
                ...conv,
                last_message_at: message.sent_at,
                last_message_preview: previewText,
                unread_count: conv.id === selectedConversation?.id ? 0 : (conv.unread_count || 0) + 1
              }
            : conv
        ).sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime());
      });
    };

    websocketService.onMessage(handleWebSocketMessage);

    // Cleanup
    return () => {
      // Note: websocketService doesn't have an offMessage method, so we can't clean up
      // This is fine as the handler will be replaced on next render
    };
  }, [selectedConversation, currentUser]);

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

  // Periodically refresh read receipts for messages in current conversation
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

      if (receipts) {
        // Group receipts by message_id
        const receiptsByMessage = receipts.reduce((acc: any, receipt: any) => {
          if (!acc[receipt.message_id]) {
            acc[receipt.message_id] = [];
          }
          acc[receipt.message_id].push({
            user_id: receipt.user_id,
            read_at: receipt.read_at
          });
          return acc;
        }, {});

        // Update messages with new read receipts
        setMessages(prev => prev.map(msg => ({
          ...msg,
          read_receipts: receiptsByMessage[msg.id] || msg.read_receipts || []
        })));
      }
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
      });
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

        const aName = (a.user.tenants_employee?.display_name || a.user.full_name || '').toLowerCase();
        const bName = (b.user.tenants_employee?.display_name || b.user.full_name || '').toLowerCase();
        return aName.localeCompare(bName);
      });
  }, [filteredUsers, conversations, currentUser, messages]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const totalUnread = conversations.reduce((sum, conv) => sum + (conv.unread_count || 0), 0);
    window.dispatchEvent(new CustomEvent('rmq:unread-count', { detail: { count: totalUnread } }));
  }, [conversations]);

  // Don't render if not open
  if (!isOpen) return null;

  if (isLoading) {
    return (
      <div className="fixed inset-0 z-50 bg-gray-100 dark:bg-gradient-to-br dark:from-[rgba(62,40,205,0.05)] dark:to-[rgba(59,130,246,0.05)]">
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
    <div className="fixed inset-0 z-50 bg-gray-100 dark:bg-gradient-to-br dark:from-[rgba(62,40,205,0.05)] dark:to-[rgba(59,130,246,0.05)] flex overflow-hidden">
      {/* Sidebar - Desktop */}
      <div className="hidden lg:flex w-96 bg-base-100 border-r border-base-300 flex-col shadow-lg">
        {/* Header */}
        <div className="p-6 bg-base-100">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {activeTab === 'groups' && (
                <button
                  onClick={() => setShowCreateGroupModal(true)}
                  className="btn btn-ghost btn-circle text-base-content/70 hover:bg-base-200"
                  title="Create Group"
                >
                  <PlusIcon className="w-6 h-6" style={{ color: '#3E28CD' }} />
                </button>
              )}
              <ChatBubbleLeftRightIcon className="w-8 h-8" style={{ color: '#3E28CD' }} />
              <div>
                <h1 className="text-xl font-bold text-base-content">RMQ Messages</h1>
                <p className="text-sm text-base-content/70">Internal Communications</p>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs - Modern Style */}
        <div className="flex gap-2 p-2 bg-base-100 rounded-lg mx-4 mt-3 mb-0">
          <button
            onClick={() => setActiveTab('chats')}
            className={`flex-1 py-2.5 px-4 font-medium text-sm transition-all rounded-md ${
              activeTab === 'chats'
                ? 'text-white shadow-md'
                : 'text-base-content/80 hover:text-base-content hover:bg-base-200/50'
            }`}
            style={activeTab === 'chats' ? { background: 'linear-gradient(to bottom right, #059669, #0d9488)' } : {}}
          >
            Chats
            <span className={`ml-2 text-xs ${
              activeTab === 'chats' ? 'text-white/80' : 'text-base-content/60'
            }`}>
              {allUsers.length}
            </span>
          </button>
          <button
            onClick={() => setActiveTab('groups')}
            className={`flex-1 py-2.5 px-4 font-medium text-sm transition-all rounded-md ${
              activeTab === 'groups'
                ? 'text-white shadow-md'
                : 'text-base-content/80 hover:text-base-content hover:bg-base-200/50'
            }`}
            style={activeTab === 'groups' ? { background: 'linear-gradient(to bottom right, #059669, #0d9488)' } : {}}
          >
            Groups
            {filteredGroupConversations.length > 0 && (
              <span className={`ml-2 text-xs rounded-full px-2 py-0.5 ${
                activeTab === 'groups' 
                  ? 'bg-white/20 text-white' 
                  : 'bg-base-200 text-base-content/80'
              }`}>
                {filteredGroupConversations.length}
              </span>
            )}
          </button>
        </div>

        {/* Search */}
        <div className="px-4 pt-1 pb-2 border-b border-base-300 bg-base-100">
          <div className="relative">
            <MagnifyingGlassIcon className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-base-content/60" />
            <input
              type="text"
              placeholder={activeTab === 'chats' ? 'Search contacts...' : 'Search groups...'}
              className="input input-bordered w-full pl-10 input-sm"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto bg-base-100">
          {activeTab === 'chats' ? (
            contactsWithLastMessage.length === 0 ? (
              <div className="p-6 text-center text-base-content/70">
                <UserIcon className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="font-medium">No contacts found</p>
                <p className="text-sm">Try adjusting your search</p>
              </div>
            ) : (
              contactsWithLastMessage.map(({ user, lastMessageAt, lastMessagePreview, lastMessageReadStatus, unreadCount }) => {
                const rawDisplayName = user.tenants_employee?.display_name || user.full_name;
                const userName = (rawDisplayName && rawDisplayName.trim().length > 1) 
                  ? rawDisplayName.trim() 
                  : `User ${user.id.slice(-4)}`;
                
                const rawRole = getRoleDisplayName(user.tenants_employee?.bonuses_role || '');
                const userRole = rawRole && rawRole.trim().length > 0 ? rawRole.trim() : 'Employee';
                const userPhoto = user.tenants_employee?.photo_url;
                const hasCompleteInfo = user.tenants_employee && user.tenants_employee.display_name;
                const isUnavailable = contactAvailabilityMap[user.tenants_employee?.display_name || ''] || false;
                const isOnline = onlineUsers.has(String(user.id));

                return (
                  <div
                    key={user.id}
                    onClick={() => startDirectConversation(user.id)}
                    className="p-4 border-b border-base-300 cursor-pointer hover:bg-base-200 transition-colors bg-base-100"
                  >
                    <div className="flex items-center gap-3">
                      <div className="relative">
                      {renderUserAvatar({
                        userId: user.id,
                        name: userName,
                        photoUrl: userPhoto,
                        sizeClass: 'w-14 h-14',
                          borderClass: '',
                        textClass: 'text-base',
                      })}
                        {isUnavailable && (
                          <div className="absolute -top-0.5 -right-0.5 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center border-2 border-base-100">
                            <ClockIcon className="w-3 h-3 text-white" />
                          </div>
                        )}
                        {!isUnavailable && isOnline && (
                          <div className="absolute bottom-0 right-0 w-4 h-4 bg-green-500 rounded-full border-2 border-base-100 flex items-center justify-center">
                            <span className="w-2 h-2 bg-base-100 rounded-full"></span>
                          </div>
                        )}
                      </div>
                    
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-base-content truncate flex items-center gap-2 flex-wrap">
                          {userName || `User ${user.id.slice(-4)}`}
                          {!hasCompleteInfo && (
                            <span className="text-xs text-orange-500 dark:text-orange-400 bg-orange-100 dark:bg-orange-900/30 px-2 py-1 rounded-full">
                              Incomplete Profile
                            </span>
                          )}
                          {isOnline && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 border border-green-200">
                              <span className="relative flex h-1.5 w-1.5">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500"></span>
                              </span>
                              Online
                            </span>
                          )}
                        </div>
                        <div className="flex items-center justify-between">
                          <p className="text-sm text-base-content/70 truncate">
                            {userRole}
                            {!hasCompleteInfo && !user.tenants_employee?.bonuses_role && !user.tenants_employee?.tenant_departement?.name && (
                              <span className="text-orange-500"> Profile setup needed</span>
                            )}
                          </p>
                          <span className="text-xs text-base-content/60 ml-2 whitespace-nowrap">
                            {lastMessageAt ? formatMessageTime(lastMessageAt) : ''}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 mt-1">
                          <p className="text-sm text-base-content/80 truncate flex-1">
                            {lastMessagePreview || 'No messages yet'}
                          </p>
                          {lastMessageReadStatus && lastMessageReadStatus !== 'sent' && (
                            <div className="flex-shrink-0">
                              {lastMessageReadStatus === 'read' ? (
                                <div className="flex items-center -space-x-1">
                                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20" style={{ color: '#4ade80' }}>
                                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                  </svg>
                                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20" style={{ color: '#4ade80' }}>
                                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                  </svg>
                                </div>
                              ) : (
                                <div className="flex items-center -space-x-1">
                                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20" style={{ color: 'rgba(156, 163, 175, 0.7)' }}>
                                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                  </svg>
                                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20" style={{ color: 'rgba(156, 163, 175, 0.7)' }}>
                                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                  </svg>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-1">
                        <ChatBubbleLeftRightIcon className="w-5 h-5 text-base-content/60" />
                        {unreadCount > 0 ? (
                          <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: '#3E28CD' }}>
                            {unreadCount > 99 ? '99+' : unreadCount}
                          </div>
                        ) : (
                          <span className="text-xs text-base-content/60 font-medium">0</span>
                        )}
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
              filteredGroupConversations.map((conversation) => (
                <div
                  key={conversation.id}
                  onClick={() => {
                    setSelectedConversation(conversation);
                    fetchMessages(conversation.id);
                    setShowMobileConversations(false);
                  }}
                  className={`p-4 border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors bg-white ${
                    selectedConversation?.id === conversation.id ? 'border-l-4' : ''
                  }`}
                  style={selectedConversation?.id === conversation.id ? { backgroundColor: 'rgba(62, 40, 205, 0.05)', borderLeftColor: '#3E28CD' } : {}}
                >
                  <div className="flex items-center gap-3">
                    {getConversationAvatar(conversation, 'large')}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <h3 className="font-semibold text-base-content truncate">
                          {getConversationTitle(conversation)}
                        </h3>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-base-content/70">
                            {formatMessageTime(conversation.last_message_at)}
                          </span>
                          {(conversation.unread_count || 0) > 0 && (
                            <div className="w-5 h-5 text-white rounded-full flex items-center justify-center text-xs font-bold" style={{ backgroundColor: '#3E28CD' }}>
                              {conversation.unread_count}
                            </div>
                          )}
                        </div>
                      </div>
                      <p className="text-sm text-base-content/80 truncate mt-1">
                        {conversation.last_message_preview || 'No messages yet'}
                      </p>
                      <p className="text-xs text-base-content/60 mt-1">
                        {conversation.participants?.length || 0} members
                      </p>
                    </div>
                  </div>
                </div>
              ))
            )
          )}
        </div>
      </div>

      {/* Mobile Sidebar */}
      <div className={`lg:hidden ${showMobileConversations ? 'block' : 'hidden'} w-full bg-base-100 flex flex-col`}>
        {/* Mobile Header */}
        <div className="p-4 bg-white">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {activeTab === 'groups' && (
                  <button
                    onClick={() => setShowCreateGroupModal(true)}
                    className="btn btn-ghost btn-circle text-base-content/70 hover:bg-base-200"
                    title="Create Group"
                  >
                    <PlusIcon className="w-5 h-5" style={{ color: '#3E28CD' }} />
                  </button>
                )}
                <ChatBubbleLeftRightIcon className="w-7 h-7" style={{ color: '#3E28CD' }} />
                <div>
                  <h1 className="text-lg font-bold text-base-content">Messages</h1>
                  <p className="text-xs text-base-content/70">Internal Communications</p>
                </div>
              </div>
            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="btn btn-ghost btn-circle text-gray-500 hover:bg-gray-100"
                title="Close Messages"
              >
                <XMarkIcon className="w-7 h-7" />
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Tabs */}
        <div className="flex gap-2 p-2 bg-base-100 rounded-lg mx-4 mt-3 mb-0">
          <button
            onClick={() => setActiveTab('chats')}
            className={`flex-1 py-2.5 px-4 font-medium text-sm transition-all rounded-md ${
              activeTab === 'chats'
                ? 'text-white shadow-md'
                : 'text-base-content/80 hover:text-base-content hover:bg-base-200/50'
            }`}
            style={activeTab === 'chats' ? { background: 'linear-gradient(to bottom right, #059669, #0d9488)' } : {}}
          >
            Chats
            <span className={`ml-2 text-xs ${
              activeTab === 'chats' ? 'text-white/80' : 'text-base-content/60'
            }`}>
              {allUsers.length}
            </span>
          </button>
          <button
            onClick={() => setActiveTab('groups')}
            className={`flex-1 py-2.5 px-4 font-medium text-sm transition-all rounded-md ${
              activeTab === 'groups'
                ? 'text-white shadow-md'
                : 'text-base-content/80 hover:text-base-content hover:bg-base-200/50'
            }`}
            style={activeTab === 'groups' ? { background: 'linear-gradient(to bottom right, #059669, #0d9488)' } : {}}
          >
            Groups
            {filteredGroupConversations.length > 0 && (
              <span className={`ml-2 text-xs rounded-full px-2 py-0.5 ${
                activeTab === 'groups' 
                  ? 'bg-white/20 text-white' 
                  : 'bg-base-200 text-base-content/80'
              }`}>
                {filteredGroupConversations.length}
              </span>
            )}
          </button>
        </div>

        {/* Mobile Search */}
        <div className="px-4 pt-1 pb-2 border-b border-base-300 bg-base-100">
          <div className="relative">
            <MagnifyingGlassIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-base-content/60" />
            <input
              type="text"
              placeholder={activeTab === 'chats' ? 'Search contacts...' : 'Search groups...'}
              className="input input-bordered w-full pl-9 input-sm"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Mobile Content */}
        <div className="flex-1 overflow-y-auto bg-base-100">
          {activeTab === 'chats' ? (
            contactsWithLastMessage.length === 0 ? (
              <div className="p-6 text-center text-base-content/70">
                <UserIcon className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="font-medium">No contacts found</p>
                <p className="text-sm">Try adjusting your search</p>
              </div>
            ) : (
              contactsWithLastMessage.map(({ user, lastMessageAt, lastMessagePreview, lastMessageReadStatus, unreadCount }) => {
                const rawDisplayName = user.tenants_employee?.display_name || user.full_name;
                const userName = (rawDisplayName && rawDisplayName.trim().length > 1) 
                  ? rawDisplayName.trim() 
                  : `User ${user.id.slice(-4)}`;
                
                const rawRole = getRoleDisplayName(user.tenants_employee?.bonuses_role || '');
                const userRole = rawRole && rawRole.trim().length > 0 ? rawRole.trim() : 'Employee';
                const userPhoto = user.tenants_employee?.photo_url;
                const hasCompleteInfo = user.tenants_employee && user.tenants_employee.display_name;
                const isUnavailable = contactAvailabilityMap[user.tenants_employee?.display_name || ''] || false;
                const isOnline = onlineUsers.has(String(user.id));

                return (
                  <div
                    key={user.id}
                    onClick={() => startDirectConversation(user.id)}
                    className="p-4 border-b border-base-300 cursor-pointer hover:bg-base-200 active:bg-base-200 bg-base-100"
                  >
                    <div className="flex items-center gap-3">
                      <div className="relative">
                      {renderUserAvatar({
                        userId: user.id,
                        name: userName,
                        photoUrl: userPhoto,
                        sizeClass: 'w-14 h-14',
                          borderClass: '',
                        textClass: 'text-base',
                      })}
                        {isUnavailable && (
                          <div className="absolute -top-0.5 -right-0.5 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center border-2 border-base-100">
                            <ClockIcon className="w-3 h-3 text-white" />
                          </div>
                        )}
                        {!isUnavailable && isOnline && (
                          <div className="absolute bottom-0 right-0 w-4 h-4 bg-green-500 rounded-full border-2 border-base-100 flex items-center justify-center">
                            <span className="w-2 h-2 bg-base-100 rounded-full"></span>
                          </div>
                        )}
                      </div>
                    
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-base-content truncate flex items-center gap-2 flex-wrap">
                          {userName || `User ${user.id.slice(-4)}`}
                          {!hasCompleteInfo && (
                            <span className="text-xs text-orange-500 dark:text-orange-400 bg-orange-100 dark:bg-orange-900/30 px-1 py-0.5 rounded">
                              Incomplete
                            </span>
                          )}
                          {isOnline && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 border border-green-200">
                              <span className="relative flex h-1.5 w-1.5">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500"></span>
                              </span>
                              Online
                            </span>
                          )}
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm text-base-content/70 truncate">
                            {userRole}
                            {!hasCompleteInfo && !user.tenants_employee?.bonuses_role && !user.tenants_employee?.tenant_departement?.name && (
                              <span className="text-orange-500"> Setup needed</span>
                            )}
                          </p>
                          <span className="text-xs text-base-content/60 whitespace-nowrap">
                            {lastMessageAt ? formatMessageTime(lastMessageAt) : ''}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 mt-1">
                          <p className="text-xs text-base-content/80 truncate flex-1">
                            {lastMessagePreview || 'No messages yet'}
                          </p>
                          {lastMessageReadStatus && lastMessageReadStatus !== 'sent' && (
                            <div className="flex-shrink-0">
                              {lastMessageReadStatus === 'read' ? (
                                <div className="flex items-center -space-x-1">
                                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20" style={{ color: '#4ade80' }}>
                                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                  </svg>
                                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20" style={{ color: '#4ade80' }}>
                                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                  </svg>
                                </div>
                              ) : (
                                <div className="flex items-center -space-x-1">
                                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20" style={{ color: 'rgba(156, 163, 175, 0.7)' }}>
                                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                  </svg>
                                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20" style={{ color: 'rgba(156, 163, 175, 0.7)' }}>
                                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                  </svg>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-1">
                        <ChatBubbleLeftRightIcon className="w-5 h-5 text-base-content/60" />
                        {unreadCount > 0 ? (
                          <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: '#3E28CD' }}>
                            {unreadCount > 99 ? '99+' : unreadCount}
                          </div>
                        ) : (
                          <span className="text-xs text-base-content/60 font-medium">0</span>
                        )}
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
              filteredGroupConversations.map((conversation) => (
                <div
                  key={conversation.id}
                  onClick={() => {
                    setSelectedConversation(conversation);
                    fetchMessages(conversation.id);
                    setShowMobileConversations(false);
                  }}
                  className="p-4 border-b border-gray-100 cursor-pointer hover:bg-gray-50 active:bg-gray-100 bg-white"
                >
                  <div className="flex items-center gap-3">
                    {getConversationAvatar(conversation, 'large')}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <h3 className="font-semibold text-base-content truncate">
                          {getConversationTitle(conversation)}
                        </h3>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-base-content/70">
                            {formatMessageTime(conversation.last_message_at)}
                          </span>
                          {(conversation.unread_count || 0) > 0 && (
                            <div className="w-5 h-5 text-white rounded-full flex items-center justify-center text-xs font-bold" style={{ backgroundColor: '#3E28CD' }}>
                              {conversation.unread_count}
                            </div>
                          )}
                        </div>
                      </div>
                      <p className="text-sm text-base-content/80 truncate mt-1">
                        {conversation.last_message_preview || 'No messages yet'}
                      </p>
                      <p className="text-xs text-base-content/60 mt-1">
                        {conversation.participants?.length || 0} members
                      </p>
                    </div>
                  </div>
                </div>
              ))
            )
          )}
        </div>
      </div>

      {/* Chat Area - Desktop Only */}
      <div className="hidden lg:flex flex-1 flex-col relative">
        {selectedConversation ? (
          <>
            {/* Chat Header */}
            <div 
              className="p-4 border-b border-base-300 bg-base-100 absolute top-0 left-0 right-0 z-20"
              style={{ 
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)'
              }}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setShowMobileConversations(true)}
                    className="lg:hidden btn btn-ghost btn-sm btn-circle"
                  >
                    <ArrowLeftIcon className="w-5 h-5" />
                  </button>
                  {getConversationAvatar(selectedConversation, 'xlarge')}
                  <div className="flex-1">
                      {selectedConversation.type === 'direct' ? (
                        (() => {
                          const otherParticipant = selectedConversation.participants?.find(p => p.user_id !== currentUser?.id);
                        if (otherParticipant?.user) {
                          const employee = otherParticipant.user.tenants_employee;
                          const role = employee ? getRoleDisplayName(employee.bonuses_role || '') : '';
                          const department = employee?.tenant_departement?.name || '';
                          
                          const otherUserId = otherParticipant.user.id ? String(otherParticipant.user.id) : null;
                          const isOnline = otherUserId ? onlineUsers.has(otherUserId) : false;
                          if (otherUserId && process.env.NODE_ENV === 'development') {
                          }
                          
                          return (
                            <>
                              <div className="flex flex-wrap items-center gap-3 text-base-content">
                                <h2 className="font-semibold">
                                  {getConversationTitle(selectedConversation)}
                                </h2>
                                {role && (
                                    <div className="inline-flex items-center gap-1.5 text-base font-medium text-base-content/90">
                                    <BriefcaseIcon className="w-4 h-4" style={{ color: '#059669' }} />
                                    <span>{role}</span>
                                  </div>
                                )}
                                {department && (
                                    <div className="inline-flex items-center gap-1.5 text-base font-medium text-base-content/90">
                                    <BuildingOfficeIcon className="w-4 h-4" style={{ color: '#059669' }} />
                                    <span>{department}</span>
                                  </div>
                                )}
                              </div>
                              {isOnline ? (
                                <div className="flex items-center gap-1.5 mt-1">
                                  <span className="relative flex h-2 w-2">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                                  </span>
                                  <span className="text-xs font-medium text-green-600">Online</span>
                                </div>
                              ) : !isEmployeeUnavailable ? (
                                <div className="flex items-center gap-1.5 mt-1">
                                  <span className="relative flex h-2 w-2">
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-gray-400"></span>
                                  </span>
                                  <span className="text-xs font-medium text-base-content/70">
                                    {otherUserId && lastOnlineTimes.has(otherUserId) 
                                      ? `Last online: ${formatLastOnlineTime(lastOnlineTimes.get(otherUserId)!)}`
                                      : 'Offline'
                                    }
                                  </span>
                                </div>
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
                            <h2 className="font-semibold text-base-content">
                              {getConversationTitle(selectedConversation)}
                            </h2>
                            <p className="text-sm text-base-content/90">Direct message</p>
                          </>
                        );
                        })()
                      ) : (
                      <>
                        <h2 className="font-semibold text-gray-900">
                          {getConversationTitle(selectedConversation)}
                        </h2>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
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
                          className={`btn btn-ghost btn-sm btn-circle ${
                            isGroupLocked(selectedConversation)
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
              
              {/* Group Members List - Desktop (Collapsible) */}
              {selectedConversation.type === 'group' && selectedConversation.participants && selectedConversation.participants.length > 0 && (
                <div className="mt-3 border-t border-base-300">
                  <button
                    onClick={() => setShowDesktopGroupMembers(!showDesktopGroupMembers)}
                    className="w-full flex items-center justify-between p-3 hover:bg-base-200 transition-colors"
                  >
                    <span className="text-sm font-medium text-base-content/90">
                      {selectedConversation.participants.length} {selectedConversation.participants.length === 1 ? 'member' : 'members'}
                    </span>
                    {showDesktopGroupMembers ? (
                      <ChevronUpIcon className="w-5 h-5 text-base-content/70" />
                    ) : (
                      <ChevronDownIcon className="w-5 h-5 text-base-content/70" />
                    )}
                  </button>
                  {showDesktopGroupMembers && (
                    <div className="px-3 pb-3">
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
                  )}
                </div>
              )}
            </div>

            {/* Messages Area */}
            <div 
              ref={desktopMessagesContainerRef}
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto p-4 pb-24 space-y-4 relative rmq-messages-area"
              style={{
                paddingTop: selectedConversation?.type === 'group' && selectedConversation.participants && selectedConversation.participants.length > 0 ? '180px' : '120px',
                backgroundImage: chatBackgroundImageUrl ? `url(${chatBackgroundImageUrl})` : 'none',
                backgroundColor: chatBackgroundImageUrl ? 'transparent' : (document.documentElement.classList.contains('dark') ? 'transparent' : '#ffffff'),
                backgroundSize: chatBackgroundImageUrl ? 'cover' : 'auto',
                backgroundPosition: chatBackgroundImageUrl ? 'center' : 'auto',
                backgroundRepeat: chatBackgroundImageUrl ? 'no-repeat' : 'repeat',
                backgroundAttachment: chatBackgroundImageUrl ? 'fixed' : 'scroll'
              }}
            >
              {/* Floating Date Indicator - Desktop */}
              <div 
                className="fixed top-20 left-1/2 -translate-x-1/2 z-50 pointer-events-none"
                style={{ 
                  opacity: showFloatingDate && floatingDate ? floatingDateOpacity : 0,
                  visibility: showFloatingDate && floatingDate ? 'visible' : 'hidden',
                  transition: 'opacity 200ms cubic-bezier(0.4, 0, 0.2, 1)',
                  willChange: 'opacity'
                }}
              >
                {floatingDate && (
                  <div className="text-white px-3 py-1 rounded-full text-sm font-medium shadow-lg" style={{ backgroundColor: '#3E17C3' }}>
                    {formatDateSeparator(floatingDate)}
                  </div>
                )}
              </div>
              {messages.length === 0 ? (
                <div className="text-center py-12">
                  <ChatBubbleLeftRightIcon className="w-16 h-16 mx-auto mb-4" style={{ color: chatBackgroundImageUrl ? 'rgba(255, 255, 255, 0.7)' : '#d1d5db' }} />
                  <p className="font-medium" style={{ color: chatBackgroundImageUrl ? 'white' : '#6b7280' }}>No messages yet</p>
                  <p className="text-sm" style={{ color: chatBackgroundImageUrl ? 'rgba(255, 255, 255, 0.8)' : '#9ca3af' }}>Start the conversation!</p>
                </div>
              ) : (
                <AnimatePresence initial={false}>
                  {messages.map((message, index) => {
                  const isOwn = message.sender_id === currentUser?.id;
                  const senderName = message.sender?.tenants_employee?.display_name || 
                                   message.sender?.full_name || 
                                   'Unknown User';
                  const senderPhoto = message.sender?.tenants_employee?.photo_url;

                    // Check if we need to show a date separator (removed - using floating indicator instead)
                    const showDateSeparator = false; // Disabled inline separators

                  return (
                      <motion.div
                        key={message.id}
                        initial={{ opacity: 0, y: 20, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        transition={{ 
                          duration: 0.3,
                          ease: [0.4, 0, 0.2, 1]
                        }}
                        className="relative"
                        data-message-id={message.id}
                      >
                      {/* Date Separator - Removed inline separators */}
                      
                      {/* Image, video and emoji messages - render outside bubble */}
                      {isImageMessage(message) ? (
                        <div className={`flex flex-col ${isOwn ? 'items-end ml-auto' : 'items-start'} max-w-xs sm:max-w-md`}>
                          <div 
                            className="relative cursor-pointer group"
                            onClick={() => openMediaModal(message)}
                          >
                            <img
                              src={message.attachment_url}
                              alt={message.attachment_name}
                              className="max-w-full max-h-80 md:max-h-[600px] rounded-lg object-cover transition-transform group-hover:scale-105"
                            />
                            <div className="absolute inset-0 bg-black/20 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
                              </svg>
                            </div>
                          </div>
                          {/* Timestamp and read receipts at bottom of image */}
                          <div className={`flex items-center gap-1 mt-1 ${isOwn ? 'justify-end' : 'justify-start'}`}>
                            <span className="text-xs text-base-content/70" style={{ 
                              textShadow: chatBackgroundImageUrl ? '0 1px 2px rgba(255, 255, 255, 0.8)' : 'none'
                            }}>
                              {formatMessageTime(message.sent_at)}
                            </span>
                            {isOwn && renderReadReceipts(message)}
                          </div>
                        </div>
                      ) : isVideoMessage(message) ? (
                        <div className={`flex flex-col ${isOwn ? 'items-end ml-auto' : 'items-start'} max-w-xs sm:max-w-md`}>
                          <div 
                            className="relative cursor-pointer group"
                            onClick={() => openMediaModal(message)}
                          >
                            <video
                              src={message.attachment_url}
                              className="max-w-full max-h-80 md:max-h-[600px] rounded-lg object-cover transition-transform group-hover:scale-105"
                              controls
                              preload="metadata"
                            />
                            <div className="absolute inset-0 bg-black/20 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
                              </svg>
                            </div>
                          </div>
                          {/* Timestamp and read receipts at bottom of video */}
                          <div className={`flex items-center gap-1 mt-1 ${isOwn ? 'justify-end' : 'justify-start'}`}>
                            <span className="text-xs text-base-content/70" style={{ 
                              textShadow: chatBackgroundImageUrl ? '0 1px 2px rgba(255, 255, 255, 0.8)' : 'none'
                            }}>
                              {formatMessageTime(message.sent_at)}
                            </span>
                            {isOwn && renderReadReceipts(message)}
                          </div>
                        </div>
                      ) : isEmojiOnly(message.content || '') ? (
                        <div 
                          className={`flex flex-col ${isOwn ? 'items-end ml-auto' : 'items-start'} max-w-xs sm:max-w-md`}
                          dir={containsHebrew(message.content || '') ? 'rtl' : 'ltr'}
                        >
                          <div className="text-6xl">
                            {renderMessageContent(message.content || '', isOwn)}
                          </div>
                          {/* Timestamp and read receipts at bottom of emoji */}
                          <div className={`flex items-center gap-1 mt-1 ${isOwn ? 'justify-end' : 'justify-start'}`}>
                            <span className="text-xs text-base-content/70" style={{ 
                              textShadow: chatBackgroundImageUrl ? '0 1px 2px rgba(255, 255, 255, 0.8)' : 'none'
                            }}>
                              {formatMessageTime(message.sent_at)}
                            </span>
                            {isOwn && renderReadReceipts(message)}
                          </div>
                        </div>
                      ) : (
                        <div
                          className={`flex gap-3 group ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}
                        >
                          
                          {/* Avatar for group chats */}
                          {!isOwn && selectedConversation.type !== 'direct' && (
                            <div className="flex-shrink-0">
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
                          )}
                          
                          <div className={`max-w-xs sm:max-w-md ${isOwn ? 'items-end' : 'items-start'} flex flex-col`}>
                            {!isOwn && selectedConversation.type !== 'direct' && (
                              <span 
                                className="text-xs font-medium mb-1 px-2 py-0.5 rounded-full inline-block"
                                style={{
                                  backgroundColor: 'rgba(255, 255, 255, 0.7)',
                                  backdropFilter: 'blur(10px)',
                                  WebkitBackdropFilter: 'blur(10px)',
                                  color: '#374151',
                                  border: '1px solid rgba(255, 255, 255, 0.3)',
                                  textShadow: '0 1px 2px rgba(255, 255, 255, 0.8)'
                                }}
                              >
                                {senderName}
                              </span>
                            )}
                            
                            <div className={`flex items-end gap-2 ${isOwn ? 'flex-row-reverse' : 'flex-row'} relative`}>
                              <div
                                data-message-id={message.id}
                                onClick={() => {
                                  setShowReactionPicker(showReactionPicker === message.id ? null : message.id);
                                  setReactingMessageId(message.id);
                                }}
                                className={`px-4 py-3 rounded-2xl shadow-sm cursor-pointer hover:shadow-md transition-shadow relative ${
                                  isOwn
                                    ? isEmojiOnly(message.content) 
                                      ? 'bg-base-100 text-base-content rounded-br-md'
                                      : 'text-white rounded-br-md'
                                    : 'border rounded-bl-md bg-white border-gray-200 text-base-content shadow-sm'
                                }`}
                              style={isOwn && !isEmojiOnly(message.content) 
                                ? { background: 'linear-gradient(to bottom right, #059669, #0d9488)' } 
                                : {}
                              }
                              >
                              {/* Message content */}
                              {message.content && (
                                <p 
                                  className="break-words text-base"
                                  dir={containsHebrew(message.content) ? 'rtl' : 'ltr'}
                                  style={{ 
                                    textAlign: containsHebrew(message.content) ? 'right' : 'left',
                                    direction: containsHebrew(message.content) ? 'rtl' : 'ltr',
                                    fontSize: '1rem',
                                    lineHeight: '1.5',
                                    wordBreak: 'break-word',
                                    overflowWrap: 'break-word'
                                  }}
                                >
                                  {renderMessageContent(message.content, isOwn)}
                                </p>
                              )}
                              
                              {/* File attachment */}
                              {message.attachment_url && (
                                <div className={`mt-2 rounded-lg ${
                                  `border ${isOwn ? 'bg-white/10 border-white/20' : 'bg-gray-50 border-gray-200'}`
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
                                    className={`p-2 rounded-full transition-all flex-shrink-0 ${
                                      isOwn ? 'bg-white/20 text-white hover:bg-white/30' : 'text-white hover:opacity-80'
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
                                        <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
                                      </svg>
                                    ) : (
                                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                                        <path d="M8 5v14l11-7z"/>
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
                                  <div className={`p-3 rounded-lg ${
                                    isOwn ? 'bg-white/20' : chatBackgroundImageUrl ? 'bg-white/10' : 'bg-gray-100'
                                  }`}>
                                    <PaperClipIcon className={`w-5 h-5 ${
                                      isOwn ? 'text-white' : chatBackgroundImageUrl ? 'text-white' : 'text-gray-600'
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
                          
                              {/* Timestamp inside message bubble */}
                              <div className={`flex items-center gap-1 mt-1 pt-1 ${isOwn ? 'justify-end' : 'justify-start'}`}>
                                <span className={`text-xs ${
                                  isOwn 
                                    ? '' 
                                    : 'text-base-content/60'
                                }`}
                                style={isOwn ? { color: 'rgba(255, 255, 255, 0.7)' } : {}}
                                >
                                  {formatMessageTime(message.sent_at)}
                                </span>
                                {isOwn && renderReadReceipts(message)}
                              </div>
                              </div>
                            </div>
                          
                          {/* Reaction picker */}
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
                          
                          {/* Forward button - appears on message hover */}
                          <div className={`absolute ${isOwn ? 'top-2 right-2' : 'top-2 left-2'} opacity-0 group-hover:opacity-100 transition-opacity z-10`}>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setMessageToForward(message);
                                setShowForwardModal(true);
                              }}
                              className="p-1.5 rounded-full bg-white/90 hover:bg-white shadow-md border border-gray-200 transition-colors"
                              title="Forward message"
                            >
                              <ArrowRightIcon className="w-4 h-4 text-gray-700" />
                            </button>
                          </div>
                          
                          {/* Reactions */}
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
                                  className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs border transition-colors ${
                                    hasUserReacted(message.reactions, emoji)
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
                <div className="flex items-center gap-2 px-4 py-2">
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
                      setShouldAutoScroll(true);
                      setNewMessagesCount(0);
                      scrollToBottom('smooth');
                    }}
                    className="text-white rounded-full p-3 shadow-lg transition-all"
                    style={{ backgroundColor: '#3C00B8' }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = '#4a00d4';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = '#3C00B8';
                    }}
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

            {/* Message Input - Desktop Only */}
            <div className="hidden lg:block absolute bottom-0 left-0 right-0 p-4 z-30 pointer-events-none">
              <div className="flex items-center gap-3 relative pointer-events-auto">
                {/* Consolidated Tools Button */}
                <div className="relative flex-shrink-0" ref={desktopToolsRef}>
                  {!isRecording ? (
                    <button
                      onClick={() => setShowDesktopTools(prev => !prev)}
                      disabled={isSending}
                      className="btn btn-circle w-12 h-12 text-white disabled:opacity-50 shadow-lg hover:shadow-xl transition-shadow flex-shrink-0"
                      style={{ background: 'linear-gradient(to bottom right, #059669, #0d9488)', borderColor: 'transparent' }}
                      title="Message tools"
                    >
                      <Squares2X2Icon className="w-6 h-6" />
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
                      <button
                        onClick={() => handleDesktopToolSelect('lead')}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-base-200 text-left transition-colors"
                      >
                        <PlusIcon className="w-5 h-5 text-green-600" />
                        <span className="text-sm text-base-content/90">Attach Lead</span>
                      </button>
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
                
                <div className="flex-1">
                  <textarea
                    ref={messageInputRef}
                    value={newMessage}
                    onChange={handleMessageInputChange}
                    onKeyDown={handleMessageKeyDown}
                    placeholder="Type a message..."
                    className="textarea w-full resize-none max-h-32 border border-white/30 rounded-2xl focus:border-white/50 focus:outline-none"
                    rows={1}
                    disabled={isSending}
                    style={{ 
                      height: '48px',
                      minHeight: '48px',
                      backgroundColor: 'rgba(255, 255, 255, 0.8)', 
                      backdropFilter: 'blur(10px)',
                      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
                      padding: '12px 16px',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>
                
                <button
                  onClick={!newMessage.trim() ? startVoiceRecording : sendMessage}
                  disabled={isSending}
                  className="btn btn-circle w-12 h-12 text-gray-600 shadow-lg hover:shadow-xl transition-shadow flex-shrink-0"
                  style={{ 
                    backgroundColor: 'rgba(255, 255, 255, 0.8)',
                    backdropFilter: 'blur(10px)',
                    WebkitBackdropFilter: 'blur(10px)',
                    borderColor: 'rgba(255, 255, 255, 0.3)',
                    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)'
                  }}
                  title={!newMessage.trim() ? 'Record voice message' : 'Send message'}
                >
                  {isSending ? (
                    <div className="loading loading-spinner loading-sm"></div>
                  ) : !newMessage.trim() ? (
                    <MicrophoneIcon className="w-5 h-5" />
                  ) : (
                    <PaperAirplaneIcon className="w-5 h-5" />
                  )}
                </button>
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

      {/* Mobile Full Screen Chat */}
      <div className={`lg:hidden ${!showMobileConversations && selectedConversation ? 'flex' : 'hidden'} flex-col w-full fixed inset-0 z-40 overflow-hidden relative`}>
        {selectedConversation && (
          <>
            {/* Mobile Chat Header */}
            <div 
              className={`absolute top-0 left-0 right-0 z-30 ${selectedConversation.type === 'group' ? 'p-4 bg-base-100 border-b border-base-300' : 'p-3 pointer-events-none'}`}
              style={selectedConversation.type === 'group' ? { boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)' } : {}}
            >
              {selectedConversation.type === 'direct' ? (
                /* New Layout for Direct Chats - 4 Parts Separately Hovering */
                <div className="flex items-center justify-between pointer-events-auto">
                  {/* Left: Back Button - Separate Floating Box */}
                  <div className="flex-shrink-0">
                    <button
                      onClick={() => setShowMobileConversations(true)}
                      className="btn btn-circle w-12 h-12 text-gray-600 shadow-lg hover:shadow-xl transition-shadow"
                      style={{ 
                        backgroundColor: 'rgba(255, 255, 255, 0.8)',
                        backdropFilter: 'blur(10px)',
                        WebkitBackdropFilter: 'blur(10px)',
                        borderColor: 'rgba(255, 255, 255, 0.3)',
                        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)'
                      }}
                    >
                      <ArrowLeftIcon className="w-5 h-5" />
                    </button>
                  </div>
                  
                  {/* Center: Profile Image with Name - Separate Floating Box */}
                  <div className="flex-1 flex flex-col items-center justify-center min-w-0 px-2 pointer-events-auto">
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
                            setShowEmployeeInfoModal(true);
                          }
                        };
                        return (
                          <div
                            className="flex flex-col items-center px-4 py-2 rounded-2xl shadow-lg hover:shadow-xl transition-shadow cursor-pointer"
                            onClick={handleAvatarClick}
                            style={{ 
                              backgroundColor: 'rgba(255, 255, 255, 0.8)',
                              backdropFilter: 'blur(10px)',
                              WebkitBackdropFilter: 'blur(10px)',
                              borderColor: 'rgba(255, 255, 255, 0.3)',
                              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)'
                            }}
                            title={`View ${name}'s profile`}
                          >
                            {/* Avatar with Online/Offline Indicator */}
                            <div className="relative">
                              {renderUserAvatar({
                                userId: avatarKey,
                                name,
                                photoUrl,
                                sizeClass: 'w-12 h-12',
                                borderClass: '',
                                textClass: 'text-base',
                              })}
                              {/* Online/Offline Indicator Circle */}
                              <div 
                                className="absolute -top-1 -right-1 w-4 h-4 rounded-full border-2 border-white shadow-sm"
                                style={{
                                  backgroundColor: isOnline ? '#10b981' : '#9ca3af'
                                }}
                              />
                            </div>
                            <h2 className="font-semibold text-sm text-gray-900 truncate w-full text-center mt-2" style={{ textShadow: '0 1px 2px rgba(255, 255, 255, 0.8)' }}>
                              {name}
                            </h2>
                          </div>
                        );
                      }
                      return null;
                    })()}
                  </div>
                  
                  {/* Right: Image Button and Exit Button - Separate Floating Boxes */}
                  <div className="flex-shrink-0 flex items-center gap-2 pointer-events-auto">
                    {/* Background Image Upload Button - Separate Floating Box */}
                    <button
                      onClick={() => backgroundImageInputRef.current?.click()}
                      disabled={isUploadingBackground}
                      className="btn btn-circle w-12 h-12 text-gray-600 shadow-lg hover:shadow-xl transition-shadow"
                      style={{ 
                        backgroundColor: 'rgba(255, 255, 255, 0.8)',
                        backdropFilter: 'blur(10px)',
                        WebkitBackdropFilter: 'blur(10px)',
                        borderColor: 'rgba(255, 255, 255, 0.3)',
                        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)'
                      }}
                      title="Upload chat background image"
                    >
                      {isUploadingBackground ? (
                        <div className="loading loading-spinner loading-sm"></div>
                      ) : (
                        <PhotoIcon className="w-5 h-5" />
                      )}
                    </button>
                    {/* Exit Button - Separate Floating Box */}
                    <button 
                      onClick={onClose}
                      className="btn btn-circle w-12 h-12 text-gray-600 shadow-lg hover:shadow-xl transition-shadow"
                      style={{ 
                        backgroundColor: 'rgba(255, 255, 255, 0.8)',
                        backdropFilter: 'blur(10px)',
                        WebkitBackdropFilter: 'blur(10px)',
                        borderColor: 'rgba(255, 255, 255, 0.3)',
                        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)'
                      }}
                      title="Close Messages"
                    >
                      <XMarkIcon className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              ) : (
                /* Original Layout for Group Chats */
                <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setShowMobileConversations(true)}
                    className="btn btn-ghost btn-sm btn-circle text-base-content/70 hover:bg-base-200"
                  >
                    <ArrowLeftIcon className="w-5 h-5" />
                  </button>
                  {getConversationAvatar(selectedConversation)}
                  <div className="flex-1 min-w-0">
                    <h2 className="font-semibold text-gray-900 truncate">
                      {getConversationTitle(selectedConversation)}
                    </h2>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={onClose}
                    className="btn btn-ghost btn-circle text-base-content/70 hover:bg-base-200"
                    title="Close Messages"
                  >
                    <XMarkIcon className="w-7 h-7" />
                  </button>
                </div>
              </div>
              )}
              
              {/* Group Members List - Mobile (Collapsible) */}
              {selectedConversation.type === 'group' && selectedConversation.participants && selectedConversation.participants.length > 0 && (
                <div className="mt-3 border-t border-gray-200">
                  <button
                    onClick={() => setShowMobileGroupMembers(!showMobileGroupMembers)}
                    className="w-full flex items-center justify-between p-3 hover:bg-gray-50 transition-colors"
                  >
                    <span className="text-sm font-medium text-gray-700">
                      {selectedConversation.participants.length} {selectedConversation.participants.length === 1 ? 'member' : 'members'}
                    </span>
                    {showMobileGroupMembers ? (
                      <ChevronUpIcon className="w-5 h-5 text-gray-500" />
                    ) : (
                      <ChevronDownIcon className="w-5 h-5 text-gray-500" />
                    )}
                  </button>
                  {showMobileGroupMembers && (
                    <div className="px-3 pb-3">
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
                              className={`btn btn-ghost btn-sm ${
                                isGroupLocked(selectedConversation)
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
                </div>
              )}
            </div>

            {/* Top Blur Overlay - Mobile - At top edge of screen */}
            <div 
              className="fixed left-0 right-0 top-0 pointer-events-none"
              style={{
                height: '40px',
                zIndex: 5,
                background: 'linear-gradient(to bottom, rgba(255, 255, 255, 0.95) 0%, rgba(255, 255, 255, 0.85) 50%, rgba(255, 255, 255, 0) 100%)',
                backdropFilter: 'blur(8px) saturate(150%)',
                WebkitBackdropFilter: 'blur(8px) saturate(150%)'
              }}
            />
            {/* Bottom Blur Overlay - Mobile - At bottom edge of screen */}
            <div 
              className="fixed left-0 right-0 bottom-0 pointer-events-none"
              style={{
                height: '25px',
                zIndex: 15,
                background: 'linear-gradient(to top, rgba(255, 255, 255, 0.75) 0%, rgba(255, 255, 255, 0.6) 50%, rgba(255, 255, 255, 0) 100%)',
                backdropFilter: 'blur(4px) saturate(150%)',
                WebkitBackdropFilter: 'blur(4px) saturate(150%)'
              }}
            />

            {/* Mobile Messages */}
            <div 
              ref={mobileMessagesContainerRef}
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto p-4 pb-24 space-y-4 min-h-0 overscroll-contain relative rmq-messages-area"
              style={{ 
                paddingTop: selectedConversation?.type === 'group' && selectedConversation.participants && selectedConversation.participants.length > 0 ? '180px' : '120px',
                WebkitOverflowScrolling: 'touch',
                backgroundImage: chatBackgroundImageUrl ? `url(${chatBackgroundImageUrl})` : 'none',
                backgroundColor: chatBackgroundImageUrl ? 'transparent' : (document.documentElement.classList.contains('dark') ? 'transparent' : '#ffffff'),
                backgroundSize: chatBackgroundImageUrl ? 'cover' : 'auto',
                backgroundPosition: chatBackgroundImageUrl ? 'center' : 'auto',
                backgroundRepeat: chatBackgroundImageUrl ? 'no-repeat' : 'repeat',
                backgroundAttachment: chatBackgroundImageUrl ? 'fixed' : 'scroll'
              }}
            >
              {/* Floating Date Indicator - Mobile */}
              <div 
                className="fixed top-32 left-1/2 -translate-x-1/2 z-[60] pointer-events-none"
                style={{ 
                  opacity: showFloatingDate && floatingDate ? floatingDateOpacity : 0,
                  visibility: showFloatingDate && floatingDate ? 'visible' : 'hidden',
                  transition: 'opacity 200ms cubic-bezier(0.4, 0, 0.2, 1)',
                  willChange: 'opacity'
                }}
              >
                {floatingDate && (
                  <div className="text-white px-3 py-1 rounded-full text-sm font-medium shadow-lg" style={{ backgroundColor: '#3E17C3' }}>
                    {formatDateSeparator(floatingDate)}
                  </div>
                )}
              </div>
              <AnimatePresence initial={false}>
                {messages.map((message, index) => {
                  const isOwn = message.sender_id === currentUser?.id;
                  const senderName = message.sender?.tenants_employee?.display_name || 
                                   message.sender?.full_name || 
                                   'Unknown User';
                  const senderPhoto = message.sender?.tenants_employee?.photo_url;

                  // Date separators removed - using floating indicator instead

                return (
                    <motion.div
                      key={message.id}
                      initial={{ opacity: 0, y: 20, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ 
                        duration: 0.3,
                        ease: [0.4, 0, 0.2, 1]
                      }}
                      data-message-id={message.id}
                    >
                    {/* Date Separator - Removed inline separators */}
                    
                    {/* Image, video and emoji messages - render outside bubble - Mobile */}
                    {isImageMessage(message) ? (
                      <div className={`flex flex-col ${isOwn ? 'items-end' : 'items-start'} max-w-[75%]`}>
                        <div 
                          className="relative cursor-pointer group"
                          onClick={() => openMediaModal(message)}
                        >
                          <img
                            src={message.attachment_url}
                            alt={message.attachment_name}
                            className="max-w-full max-h-80 md:max-h-[600px] rounded-lg object-cover transition-transform group-hover:scale-105"
                          />
                          <div className="absolute inset-0 bg-black/20 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
                            </svg>
                          </div>
                        </div>
                        {/* Timestamp and read receipts at bottom of image - Mobile */}
                        <div className={`flex items-center gap-1 mt-1 ${isOwn ? 'justify-end' : 'justify-start'}`}>
                          <span className="text-xs text-gray-500" style={{ 
                            textShadow: chatBackgroundImageUrl ? '0 1px 2px rgba(255, 255, 255, 0.8)' : 'none'
                          }}>
                            {formatMessageTime(message.sent_at)}
                          </span>
                          {isOwn && renderReadReceipts(message)}
                        </div>
                      </div>
                    ) : isVideoMessage(message) ? (
                      <div className={`flex flex-col ${isOwn ? 'items-end' : 'items-start'} max-w-[75%]`}>
                        <div 
                          className="relative cursor-pointer group"
                          onClick={() => openMediaModal(message)}
                        >
                          <video
                            src={message.attachment_url}
                            className="max-w-full max-h-80 md:max-h-[600px] rounded-lg object-cover transition-transform group-hover:scale-105"
                            controls
                            preload="metadata"
                          />
                          <div className="absolute inset-0 bg-black/20 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
                            </svg>
                          </div>
                        </div>
                        {/* Timestamp and read receipts at bottom of video - Mobile */}
                        <div className={`flex items-center gap-1 mt-1 ${isOwn ? 'justify-end' : 'justify-start'}`}>
                          <span className="text-xs text-gray-500" style={{ 
                            textShadow: chatBackgroundImageUrl ? '0 1px 2px rgba(255, 255, 255, 0.8)' : 'none'
                          }}>
                            {formatMessageTime(message.sent_at)}
                          </span>
                          {isOwn && renderReadReceipts(message)}
                        </div>
                      </div>
                    ) : isEmojiOnly(message.content || '') ? (
                      <div 
                        className={`flex flex-col ${isOwn ? 'items-end' : 'items-start'} max-w-[75%]`}
                        dir={containsHebrew(message.content || '') ? 'rtl' : 'ltr'}
                      >
                        <div className="text-6xl">
                          {renderMessageContent(message.content || '', isOwn)}
                        </div>
                        {/* Timestamp and read receipts at bottom of emoji - Mobile */}
                        <div className={`flex items-center gap-1 mt-1 ${isOwn ? 'justify-end' : 'justify-start'}`}>
                          <span className="text-xs text-gray-500" style={{ 
                            textShadow: chatBackgroundImageUrl ? '0 1px 2px rgba(255, 255, 255, 0.8)' : 'none'
                          }}>
                            {formatMessageTime(message.sent_at)}
                          </span>
                          {isOwn && renderReadReceipts(message)}
                        </div>
                      </div>
                    ) : (
                      <div
                        className={`flex gap-2 group ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}
                      >
                        
                        {/* Avatar for group chats - Mobile */}
                        {!isOwn && selectedConversation.type !== 'direct' && (
                          <div className="flex-shrink-0">
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
                        )}
                        
                        <div className={`max-w-[75%] ${isOwn ? 'items-end' : 'items-start'} flex flex-col`}>
                          {!isOwn && selectedConversation.type !== 'direct' && (
                            <span 
                              className="text-xs font-medium mb-1 px-2 py-0.5 rounded-full inline-block"
                              style={{
                                backgroundColor: 'rgba(255, 255, 255, 0.7)',
                                backdropFilter: 'blur(10px)',
                                WebkitBackdropFilter: 'blur(10px)',
                                color: '#374151',
                                border: '1px solid rgba(255, 255, 255, 0.3)',
                                textShadow: '0 1px 2px rgba(255, 255, 255, 0.8)'
                              }}
                            >
                              {senderName}
                            </span>
                          )}
                          <div className={`flex items-end gap-2 ${isOwn ? 'flex-row-reverse' : 'flex-row'} relative group`}>
                            <div
                              data-message-id={message.id}
                              onClick={() => {
                                setShowReactionPicker(showReactionPicker === message.id ? null : message.id);
                                setReactingMessageId(message.id);
                              }}
                              className={`px-4 py-3 rounded-2xl text-base cursor-pointer hover:shadow-md transition-shadow relative ${
                                isOwn
                                  ? isEmojiOnly(message.content) 
                                    ? 'bg-base-100 text-base-content rounded-br-md'
                                    : 'text-white rounded-br-md'
                                  : 'border rounded-bl-md bg-white border-gray-200 text-base-content shadow-sm'
                              }`}
                              style={isOwn && !isEmojiOnly(message.content) 
                                ? { background: 'linear-gradient(to bottom right, #059669, #0d9488)' } 
                                : {}
                              }
                            >
                            {/* Message content */}
                            {message.content && (
                              <p 
                                className="break-words text-base"
                                dir={containsHebrew(message.content) ? 'rtl' : 'ltr'}
                                style={{ 
                                  textAlign: containsHebrew(message.content) ? 'right' : 'left',
                                  direction: containsHebrew(message.content) ? 'rtl' : 'ltr',
                                  fontSize: '1rem',
                                  lineHeight: '1.5',
                                  wordBreak: 'break-word',
                                  overflowWrap: 'break-word'
                                }}
                              >
                                {renderMessageContent(message.content, isOwn)}
                              </p>
                            )}
                            
                            {/* File attachment */}
                            {message.attachment_url && (
                              <div className={`mt-2 rounded-lg ${
                                `border ${isOwn ? 'bg-white/10 border-white/20' : 'bg-gray-50 border-gray-200'}`
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
                                  className={`p-2 rounded-full transition-all flex-shrink-0 ${
                                    isOwn ? 'bg-white/20 text-white hover:bg-white/30' : 'text-white hover:opacity-80'
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
                                      <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
                                    </svg>
                                  ) : (
                                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                      <path d="M8 5v14l11-7z"/>
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
                                <div className={`p-2 rounded ${
                                    isOwn ? 'bg-white/20' : chatBackgroundImageUrl ? 'bg-white/10' : 'bg-gray-100'
                                }`}>
                                  <PaperClipIcon className={`w-4 h-4 ${
                                      isOwn ? 'text-white' : chatBackgroundImageUrl ? 'text-white' : 'text-gray-600'
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
                        
                            {/* Timestamp inside message bubble - Mobile */}
                            <div className={`flex items-center gap-1 mt-1 pt-1 ${isOwn ? 'justify-end' : 'justify-start'}`}>
                              <span className="text-xs" style={{
                                color: isOwn 
                                  ? 'rgba(255, 255, 255, 0.7)' 
                                  : '#6b7280'
                              }}>
                                {formatMessageTime(message.sent_at)}
                              </span>
                              {isOwn && renderReadReceipts(message)}
                            </div>
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
                          
                          {/* Forward button - Mobile - appears on message hover */}
                          <div className={`absolute ${isOwn ? 'top-2 right-2' : 'top-2 left-2'} opacity-0 group-hover:opacity-100 transition-opacity z-10`}>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setMessageToForward(message);
                                setShowForwardModal(true);
                              }}
                              className="p-1.5 rounded-full bg-white/90 hover:bg-white shadow-md border border-gray-200 transition-colors"
                              title="Forward message"
                            >
                              <ArrowRightIcon className="w-4 h-4 text-gray-700" />
                            </button>
                          </div>
                          
                          {/* Reactions - Mobile */}
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
                                  className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs border transition-colors ${
                                    hasUserReacted(message.reactions, emoji)
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
                          </div>
                        </div>
                      )}
                      </motion.div>
                );
              })}
                </AnimatePresence>
              
              {/* New messages indicator when user is scrolled up - Mobile */}
              {isUserScrolling && !shouldAutoScroll && (
                <div className="fixed bottom-20 right-4 z-50">
                  <button
                    onClick={() => {
                      setShouldAutoScroll(true);
                      setNewMessagesCount(0);
                      scrollToBottom('smooth');
                    }}
                    className="text-white rounded-full p-3 shadow-lg transition-all relative"
                    style={{ background: 'linear-gradient(to bottom right, #10b981, #14b8a6)' }}
                    title={newMessagesCount > 0 ? `${newMessagesCount} new message${newMessagesCount > 1 ? 's' : ''} - click to scroll down` : "New messages - click to scroll down"}
                  >
                    {newMessagesCount > 0 && (
                      <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center shadow-lg">
                        {newMessagesCount > 99 ? '99+' : newMessagesCount}
                      </span>
                    )}
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
                    <span className="text-sm text-gray-500 italic" style={{ textShadow: '0 1px 2px rgba(255, 255, 255, 0.8)' }}>
                      {typingUsers.get(selectedConversation.id)?.userName} is typing...
                    </span>
                  </div>
                </div>
              )}
              
              <div ref={messagesEndRef} />
            </div>

            {/* Mobile Message Input - Mobile Only */}
            <div className="lg:hidden absolute bottom-0 left-0 right-0 p-3 z-30 pointer-events-none">
              <div className="relative space-y-2 pointer-events-auto">
                <div className="flex items-center gap-2">
                  <div className="relative flex-shrink-0" ref={mobileToolsRef}>
                    <button
                      onClick={() => setShowMobileTools(prev => !prev)}
                      className="btn btn-circle w-12 h-12 text-white shadow-lg hover:shadow-xl transition-shadow flex-shrink-0"
                      style={{ background: 'linear-gradient(to bottom right, #059669, #0d9488)', borderColor: 'transparent' }}
                      title="Message tools"
                    >
                      <Squares2X2Icon className="w-6 h-6" />
                    </button>
                    {showMobileTools && (
                      <div className="absolute bottom-12 left-0 z-50 bg-white border border-gray-200 rounded-xl shadow-xl w-64 divide-y divide-gray-100">
                        <button
                          onClick={() => handleMobileToolSelect('lead')}
                          className="w-full text-left px-4 py-3 text-sm hover:bg-gray-50 flex items-center gap-2"
                        >
                          <PlusIcon className="w-4 h-4" style={{ color: '#3E28CD' }} />
                          Attach lead
                        </button>
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
                      </div>
                    )}
                  </div>
                  
                  <div className="flex-1">
                    <textarea
                      ref={mobileMessageInputRef}
                      value={newMessage}
                      onChange={handleMessageInputChange}
                      onKeyDown={handleMessageKeyDown}
                      placeholder="Type a message..."
                      className="textarea w-full resize-none text-sm max-h-40 border border-white/30 rounded-2xl focus:border-white/50 focus:outline-none"
                      rows={1}
                      disabled={isSending}
                      style={{ 
                        height: '48px',
                        minHeight: '48px',
                        lineHeight: '1.4', 
                        backgroundColor: 'rgba(255, 255, 255, 0.8)', 
                        backdropFilter: 'blur(10px)',
                        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
                        padding: '12px 16px',
                        boxSizing: 'border-box'
                      }}
                    />
                  </div>
                  
                  <button
                    onClick={!newMessage.trim() ? startVoiceRecording : sendMessage}
                    disabled={isSending}
                    className="btn btn-circle w-12 h-12 text-gray-600 shadow-lg hover:shadow-xl transition-shadow flex-shrink-0"
                    style={{ 
                      backgroundColor: 'rgba(255, 255, 255, 0.8)',
                      backdropFilter: 'blur(10px)',
                      WebkitBackdropFilter: 'blur(10px)',
                      borderColor: 'rgba(255, 255, 255, 0.3)',
                      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)'
                    }}
                    title={!newMessage.trim() ? 'Record voice message' : 'Send message'}
                  >
                    {isSending ? (
                      <div className="loading loading-spinner loading-sm"></div>
                    ) : !newMessage.trim() ? (
                      <MicrophoneIcon className="w-5 h-5" />
                    ) : (
                      <PaperAirplaneIcon className="w-5 h-5" />
                    )}
                  </button>
                </div>

                {isRecording && (
                  <div className="flex items-center gap-2 text-xs text-red-600">
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
                        className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all border-2 ${
                          isSelected 
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
                      className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors border-2 ${
                        isSelected ? '' : 'hover:bg-gray-50 border-transparent'
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
        accept="image/*,video/*,.pdf,.doc,.docx,.txt,.zip,.rar"
        onChange={handleFileInputChange}
      />

      {/* WhatsApp-style Media Modal */}
      {isMediaModalOpen && conversationMedia.length > 0 && (
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
          <div className="flex-1 flex items-center justify-center relative">
            {conversationMedia[selectedMediaIndex]?.message_type === 'image' || 
             (conversationMedia[selectedMediaIndex]?.attachment_type && 
              conversationMedia[selectedMediaIndex]?.attachment_type.startsWith('image/')) ? (
              <img
                src={conversationMedia[selectedMediaIndex]?.attachment_url}
                alt={conversationMedia[selectedMediaIndex]?.attachment_name}
                className="max-w-full max-h-full object-contain"
              />
            ) : conversationMedia[selectedMediaIndex]?.attachment_type?.startsWith('video/') ? (
              <video
                src={conversationMedia[selectedMediaIndex]?.attachment_url}
                controls
                className="max-w-full max-h-full"
                autoPlay
              />
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

          {/* Bottom Media Thumbnails Panel */}
          <div className="bg-black/50 p-4">
            <div className="flex gap-2 overflow-x-auto">
              {conversationMedia.map((media, index) => (
                <div
                  key={media.id}
                  onClick={() => setSelectedMediaIndex(index)}
                  className={`flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden cursor-pointer border-2 transition-all ${
                    index === selectedMediaIndex 
                      ? 'border-blue-500 scale-110' 
                      : 'border-transparent hover:border-white/30'
                  }`}
                >
                  {media.message_type === 'image' ? (
                    <img
                      src={media.attachment_url}
                      alt={media.attachment_name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full bg-white/10 flex items-center justify-center">
                      <PaperClipIcon className="w-6 h-6 text-white" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

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
