import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { toast } from 'react-hot-toast';
import websocketService, { MessageData, TypingData } from '../lib/websocket';

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
  ArrowPathIcon
} from '@heroicons/react/24/outline';
import { format, isToday, isYesterday, formatDistanceToNow } from 'date-fns';

interface User {
  id: string;
  full_name: string;
  email: string;
  employee_id?: number;
  is_active?: boolean;
  tenants_employee?: {
    display_name: string;
    bonuses_role: string;
    department_id: number;
    photo_url?: string;
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
  const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [newGroupTitle, setNewGroupTitle] = useState('');
  const [newGroupDescription, setNewGroupDescription] = useState('');
  
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
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const desktopMessagesContainerRef = useRef<HTMLDivElement>(null);
  const mobileMessagesContainerRef = useRef<HTMLDivElement>(null);
  const mobileToolsRef = useRef<HTMLDivElement>(null);
  const desktopToolsRef = useRef<HTMLDivElement>(null);
  
  // Auto-scroll state
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);

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
    borderClass = 'border-2 border-white',
    gradientClass = 'from-[#3E28CD] to-blue-500',
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
          className={`${sizeClass} rounded-full object-cover ${borderClass} bg-gray-200`}
          onError={() => handleAvatarError(fallbackKey)}
        />
      );
    }

    return (
      <div
        className={`${sizeClass} rounded-full bg-gradient-to-br ${gradientClass} flex items-center justify-center text-white font-bold ${textClass} ${borderClass}`}
      >
        {getInitials(name)}
      </div>
    );
  };

  // Helper function to detect if message contains only emojis
  const isEmojiOnly = (text: string): boolean => {
    // Simple approach: check if the text length is very short and contains emoji-like characters
    const cleanText = text.trim();
    if (cleanText.length === 0) return false;
    
    // Check if the message is very short (likely emoji-only) and contains non-ASCII characters
    const hasNonAscii = /[^\x00-\x7F]/.test(cleanText);
    const isShort = cleanText.length <= 5; // Most emojis are 1-3 characters
    
    return hasNonAscii && isShort;
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

      if (leadsError) console.error('Error searching leads:', leadsError);
      if (legacyError) console.error('Error searching legacy leads:', legacyError);

      // Combine and deduplicate results
      const allLeads = [...(leadsData || []), ...(legacyLeadsData || [])];
      const uniqueLeads = allLeads.filter((lead, index, self) => 
        index === self.findIndex(l => l.id === lead.id && l.lead_number === lead.lead_number)
      );

      setLeadSearchResults(uniqueLeads.slice(0, 10));
    } catch (error) {
      console.error('Error in lead search:', error);
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
      console.error('Error starting voice recording:', error);
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
        console.error('Error cancelling voice session:', error);
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
        console.warn('Could not calculate audio duration or waveform, using recording duration:', error);
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
      console.error('Error uploading voice message:', error);
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
      console.error('Error marking messages as read:', error);
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
      // Two green checkmarks
      return (
        <div className="flex items-center -space-x-1">
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20" style={{ color: '#4ade80' }}>
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20" style={{ color: '#4ade80' }}>
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
      console.warn('Error generating waveform, using fallback:', error);
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
        console.log('First chunk data format:', {
          type: typeof firstChunk.chunk_data,
          startsWithX: chunkDataPreview.startsWith('x'),
          startsWith0x: chunkDataPreview.startsWith('0x'),
          preview: chunkDataPreview
        });
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
                  console.log('Detected base64-encoded hex data, decoded successfully');
                } catch (base64Error) {
                  // If base64 decode fails, use the hex bytes as-is
                  console.warn('Base64 decode of hex data failed, using hex bytes directly');
                }
              }
            } catch (hexError) {
              console.error('Hex decode failed for PostgreSQL BYTEA format:', hexError, 'Data preview:', data.substring(0, 100));
              throw new Error(`Failed to decode PostgreSQL BYTEA hex data: ${hexError instanceof Error ? hexError.message : 'Unknown error'}`);
            }
          } else if (has0xPrefix) {
            // Standard hex format with 0x prefix
            try {
              bytes = hexToBytes(data);
            } catch (hexError) {
              // Try base64 as fallback
              console.warn('Hex decode failed for 0x format, trying base64 for chunk', chunk.chunk_number);
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
              console.warn('Base64 decode failed, trying hex format for chunk', chunk.chunk_number);
              try {
                bytes = hexToBytes(originalData);
              } catch (hexError) {
                throw new Error(`Neither base64 nor hex decoding worked. Base64 error: ${base64Error instanceof Error ? base64Error.message : 'Unknown'}, Hex error: ${hexError instanceof Error ? hexError.message : 'Unknown'}`);
              }
            }
          }
          
          return bytes;
        } catch (chunkError) {
          console.error('Error processing chunk:', chunkError, 'Chunk number:', chunk.chunk_number, 'Data preview:', (chunk.chunk_data || '').toString().substring(0, 100));
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
        console.log('First bytes of combined audio data:', firstBytes);
      }
      
      if (!hasWebMHeader && combinedArray.length > 0) {
        console.warn('Audio data does not have WebM header. First bytes:', 
          Array.from(combinedArray.slice(0, 4)).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' '),
          'Expected: 0x1a 0x45 0xdf 0xa3'
        );
        // Try with different MIME type - maybe it's not WebM
        console.warn('Attempting to play with audio/webm type anyway');
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
          console.error('Audio metadata loading timeout. Blob size:', audioBlob.size, 'bytes');
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
          console.error('Error playing audio:', playError);
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
        console.error('Audio playback error:', e, 'Blob size:', audioBlob.size, 'bytes');
        const errorMessage = audio.error 
          ? `Audio error code: ${audio.error.code} (${audio.error.message || 'Unknown error'})`
          : 'Unknown audio playback error';
        console.error('Audio error details:', errorMessage);
        toast.error('Failed to play voice message. The audio file may be corrupted or in an unsupported format.');
        setPlayingVoiceId(null);
        setVoiceAudio(null);
        URL.revokeObjectURL(audioUrl);
      };

    } catch (error) {
      console.error('Error playing voice message:', error);
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
      console.error('Error adding reaction:', error);
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
      console.error('Error removing reaction:', error);
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
    return messages.filter((message) => isImageMessage(message));
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

  const getConversationTitle = (conversation: Conversation): string => {
    // If it has a custom title, use it
    if (conversation.title && conversation.title.trim() !== '') {
      return conversation.title;
    }
    
    // For direct conversations (exactly 2 participants)
    if (conversation.type === 'direct' && conversation.participants && conversation.participants.length === 2) {
      const otherParticipant = conversation.participants.find(p => p.user_id !== currentUser?.id);
      if (otherParticipant?.user) {
        const name = otherParticipant.user.tenants_employee?.display_name || 
                     otherParticipant.user.full_name || 
                     'Unknown User';
        return name;
      }
    }
    
    // For group conversations or if direct chat logic fails
    const participantCount = conversation.participants?.length || 0;
    return `Group Chat (${participantCount} members)`;
  };

  const getConversationAvatar = (conversation: Conversation): JSX.Element => {
    if (conversation.type === 'direct' && conversation.participants && conversation.participants.length === 2) {
      const otherParticipant = conversation.participants.find(p => p.user_id !== currentUser?.id);
      if (otherParticipant?.user) {
        const name =
          otherParticipant.user.tenants_employee?.display_name ||
          otherParticipant.user.full_name ||
          'Unknown User';
        const photoUrl = otherParticipant.user.tenants_employee?.photo_url;
        const avatarKey = otherParticipant.user.id || otherParticipant.user_id;
        return renderUserAvatar({
          userId: avatarKey,
          name,
          photoUrl,
          sizeClass: 'w-14 h-14',
          borderClass: 'border-2 border-white shadow-md',
          textClass: 'text-base',
        });
      }
    }

    return (
      <div className="w-14 h-14 rounded-full bg-gradient-to-br from-green-500 to-teal-500 flex items-center justify-center text-white border-2 border-white shadow-md">
        <UserGroupIcon className="w-7 h-7" />
      </div>
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
          console.error('Error fetching user data:', error);
          return;
        }

        setCurrentUser(userData as unknown as User);
        
        // Set chat background image URL if available
        const backgroundUrl = (userData as any)?.tenants_employee?.chat_background_image_url;
        setChatBackgroundImageUrl(backgroundUrl || null);
        
        // Wait for data to be loaded before connecting WebSocket
        console.log('✅ User data loaded, initializing WebSocket connection...');
        
        // Initialize WebSocket connection after user data is set
        if (userData && isOpen) {
          websocketService.connect(userData.id);

          websocketService.onConnect(() => {
            console.log('🔌 WebSocket connected');
          });

          websocketService.onDisconnect(() => {
            console.log('🔌 WebSocket disconnected');
          });
        }
      } catch (error) {
        console.error('Error in initializeMessaging:', error);
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
        console.error('Error fetching user conversations:', convError);
        return [];
      }

      const conversationIds = userConversations?.map(c => c.conversation_id) || [];
      
      if (conversationIds.length === 0) {
        return [];
      }

      // Then, get full conversation data with ALL participants
      const { data: conversationsData, error } = await supabase
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
                bonuses_role,
                department_id,
                photo_url,
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

      if (error) {
        console.error('Error fetching conversations:', error);
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
      console.error('Error in getUpdatedConversations:', error);
      return [];
    }
  };

  // Fetch conversations
  const fetchConversations = useCallback(async () => {
    if (!currentUser) return;

    try {
      // First, get conversations where the current user participates
      const { data: userConversations, error: convError } = await supabase
        .from('conversation_participants')
        .select('conversation_id')
        .eq('user_id', currentUser.id)
        .eq('is_active', true);

      if (convError) {
        console.error('Error fetching user conversations:', convError);
        toast.error('Failed to load conversations');
        return;
      }

      const conversationIds = userConversations?.map(c => c.conversation_id) || [];
      
      if (conversationIds.length === 0) {
        setConversations([]);
        return;
      }

      // Then, get full conversation data with ALL participants
      const { data: conversationsData, error } = await supabase
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
                bonuses_role,
                department_id,
                photo_url,
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

      if (error) {
        console.error('Error fetching conversations:', error);
        toast.error('Failed to load conversations');
        return;
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

          const processedConv = {
            ...conv,
            participants: uniqueParticipants,
            unread_count: unreadCount
          };

          return processedConv;
        })
      );

      setConversations(processedConversations);
    } catch (error) {
      console.error('Error in fetchConversations:', error);
      toast.error('Failed to load conversations');
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
        console.error('Error fetching messages:', error);
        toast.error('Failed to load messages');
        return;
      }

      // Fetch read receipts for all messages
      if (messagesData && messagesData.length > 0 && currentUser) {
        const messageIds = messagesData.map(m => m.id);
        const { data: readReceiptsData } = await supabase
          .from('message_read_receipts')
          .select('message_id, user_id, read_at')
          .in('message_id', messageIds);

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
      
      // Force scroll to bottom after messages are loaded (works for both desktop and mobile)
      const attemptScroll = () => {
        // Find the visible container (desktop or mobile)
        let container: HTMLDivElement | null = null;
        
        if (desktopMessagesContainerRef.current && desktopMessagesContainerRef.current.offsetWidth > 0) {
          container = desktopMessagesContainerRef.current;
        } else if (mobileMessagesContainerRef.current && mobileMessagesContainerRef.current.offsetWidth > 0) {
          container = mobileMessagesContainerRef.current;
        }
        
        if (container) {
          container.scrollTop = container.scrollHeight;
          scrollToBottom('instant');
        }
      };
      
      // Try multiple times to catch when container becomes visible
      setTimeout(attemptScroll, 0);
      setTimeout(attemptScroll, 50);
      setTimeout(attemptScroll, 100);
      setTimeout(attemptScroll, 200);
      
      // Also try after render completes
      requestAnimationFrame(() => {
        setTimeout(attemptScroll, 100);
        setTimeout(attemptScroll, 300);
      });
    } catch (error) {
      console.error('Error in fetchMessages:', error);
      toast.error('Failed to load messages');
    }
  }, [currentUser]);

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
        console.error('Error fetching users:', error);
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
    } catch (error) {
      console.error('Error in fetchAllUsers:', error);
      toast.error('Failed to load contacts');
    }
  }, [currentUser]);

  // File upload functionality
  const uploadFile = async (file: File): Promise<string | null> => {
    try {
      setIsUploadingFile(true);
      setUploadProgress(0);
      
      // Validate file size (max 16MB)
      if (file.size > 16 * 1024 * 1024) {
        toast.error('File size must be less than 16MB');
        return null;
      }
      
      // Validate file type
      const allowedTypes = [
        'image/jpeg', 'image/png', 'image/gif', 'image/webp',
        'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain', 'application/zip', 'application/x-rar-compressed'
      ];
      
      if (!allowedTypes.includes(file.type)) {
        toast.error('File type not supported. Please upload images, documents, or text files.');
        return null;
      }
      
      // Generate unique filename
      const fileExt = file.name.split('.').pop();
      const fileName = `rmq_${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
      
      // Upload to Supabase storage
      const { data, error } = await supabase.storage
        .from('RMQ-MESSAGES')
        .upload(fileName, file);
      
      if (error) {
        console.error('Error uploading file:', error);
        toast.error('Failed to upload file');
        return null;
      }
      
      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('RMQ-MESSAGES')
        .getPublicUrl(fileName);
      
      setUploadProgress(100);
      toast.success('File uploaded successfully');
      return publicUrl;
      
    } catch (error) {
      console.error('Error uploading file:', error);
      toast.error('Failed to upload file');
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
      
      console.log('📤 Uploading chat background image:', { fileName, fileSize: file.size, fileType: file.type });
      
      // Upload file to Supabase storage
      const { data, error } = await supabase.storage
        .from('My-Profile')
        .upload(fileName, file, {
          cacheControl: '3600',
          upsert: false,
          contentType: file.type
        });
      
      if (error) {
        console.error('Error uploading chat background image:', error);
        toast.error('Failed to upload background image');
        return null;
      }
      
      console.log('✅ Upload successful:', data);
      
      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('My-Profile')
        .getPublicUrl(fileName);
      
      console.log('🔗 Public URL generated:', publicUrl);
      
      // Update database
      const { error: updateError } = await supabase
        .from('tenants_employee')
        .update({ chat_background_image_url: publicUrl })
        .eq('id', currentUser.employee_id);
      
      if (updateError) {
        console.error('Error updating chat background URL:', updateError);
        toast.error('Failed to save background image URL');
        return null;
      }
      
      // Update local state
      setChatBackgroundImageUrl(publicUrl);
      toast.success('Background image uploaded successfully');
      
      return publicUrl;
    } catch (error) {
      console.error('Error uploading chat background image:', error);
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
        console.error('Error resetting chat background:', updateError);
        toast.error('Failed to reset background');
        return;
      }
      
      // Update local state
      setChatBackgroundImageUrl(null);
      toast.success('Background reset to default');
    } catch (error) {
      console.error('Error resetting chat background:', error);
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
        console.log('📤 Sending attachment via WebSocket to conversation:', selectedConversation.id);
        
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
          console.error('Error sending RMQ push notification:', pushError);
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
      console.error('Error sending attachment:', error);
      toast.error('Failed to send attachment');
    } finally {
      setIsSending(false);
    }
  };

  // Send message
  const handleMessageKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (newMessage.trim() && !isSending) {
        sendMessage();
      }
    }
    // Shift+Enter will allow default behavior (new line)
  };

  const sendMessage = async () => {
    if (!selectedConversation || !currentUser || !newMessage.trim()) return;
    
    setIsSending(true);
    try {
      // Send via WebSocket for real-time delivery
      if (websocketService.isSocketConnected()) {
        console.log('📤 Sending message via WebSocket to conversation:', selectedConversation.id);
        console.log('📤 Message content:', newMessage.trim());
        
        websocketService.sendMessage(selectedConversation.id, newMessage.trim(), 'text');
      } else {
        console.log('⚠️ WebSocket not connected, message will only be saved to database');
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
          console.error('Error sending RMQ push notification:', pushError);
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
      
      // Only update conversation list if WebSocket is NOT connected
      // If WebSocket is connected, the conversation update will come through the WebSocket handler
      if (!websocketService.isSocketConnected()) {
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
      }

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
      console.error('Error sending message:', error);
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
        console.error('Error creating direct conversation:', error);
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
          console.error('🔍 Could not find created conversation, trying again...');
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
      console.error('Error creating conversation:', error);
      toast.error('Failed to start conversation');
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
      
      console.log('🗑️ Deleting problematic conversations:', conversationsToDelete.map(c => ({ id: c.id, type: c.type, participants: c.participants?.length || 0 })));
      
      for (const conv of conversationsToDelete) {
        // Delete conversation (cascade will handle participants and messages)
        const { error } = await supabase
          .from('conversations')
          .delete()
          .eq('id', conv.id);
          
        if (error) {
          console.error('Error deleting conversation:', conv.id, error);
        } else {
          console.log('✅ Deleted conversation:', conv.id);
        }
      }
      
      // Refresh conversations list
      await fetchConversations();
      setSelectedConversation(null);
      
      toast.success(`Deleted ${conversationsToDelete.length} problematic conversations`);
      
    } catch (error) {
      console.error('Error deleting conversations:', error);
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
      console.error('Error creating group conversation:', error);
      toast.error('Failed to create group conversation');
    }
  };

  // Add members to group conversation
  const addMembersToGroup = async (conversationId: number, userIds: string[]) => {
    if (!currentUser || userIds.length === 0) return;

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
      console.error('Error adding members:', error);
      if (error.code === '23505') {
        toast.error('One or more users are already in the group');
      } else {
        toast.error('Failed to add members to the group');
      }
    }
  };

  // Remove member from group conversation
  const removeMemberFromGroup = async (conversationId: number, userId: string) => {
    if (!currentUser) return;

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
      console.error('Error removing member:', error);
      toast.error('Failed to remove member from the group');
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
    
    // If user scrolls to bottom, enable auto-scroll
    if (nearBottom) {
      setShouldAutoScroll(true);
      setIsUserScrolling(false);
    } else {
      // If user scrolls up, disable auto-scroll temporarily
      setShouldAutoScroll(false);
      setIsUserScrolling(true);
    }
  }, []);

  // Auto-scroll to bottom when new messages arrive (only if should auto-scroll)
  useEffect(() => {
    if (shouldAutoScroll && messages.length > 0 && selectedConversation) {
      // Use requestAnimationFrame to ensure DOM is updated
      requestAnimationFrame(() => {
        // Check if container is visible before scrolling
        if (messagesContainerRef.current) {
          const container = messagesContainerRef.current;
          const isVisible = container.offsetWidth > 0 && container.offsetHeight > 0;
          if (isVisible) {
            scrollToBottom('smooth');
          } else {
            // If not visible, try again after a short delay
            setTimeout(() => {
              if (messagesContainerRef.current) {
                const retryContainer = messagesContainerRef.current;
                const retryVisible = retryContainer.offsetWidth > 0 && retryContainer.offsetHeight > 0;
                if (retryVisible) {
                  scrollToBottom('smooth');
                }
              }
            }, 100);
          }
        }
      });
    }
  }, [messages.length, shouldAutoScroll, selectedConversation?.id]);

  // Scroll to bottom when conversation is first selected or changes
  useEffect(() => {
    if (selectedConversation) {
      // Reset auto-scroll state when conversation changes
      setShouldAutoScroll(true);
      setIsUserScrolling(false);
      
      // Wait for messages to load and DOM to render, then scroll
      const scrollAfterLoad = () => {
        if (messagesContainerRef.current) {
          const container = messagesContainerRef.current;
          
          // Check if container is visible before scrolling
          const isVisible = container.offsetWidth > 0 && container.offsetHeight > 0;
          
          if (isVisible) {
            // Try multiple times to ensure it works
            container.scrollTop = container.scrollHeight;
            
            // Also try after a delay
            setTimeout(() => {
              if (messagesContainerRef.current) {
                const delayedContainer = messagesContainerRef.current;
                const delayedVisible = delayedContainer.offsetWidth > 0 && delayedContainer.offsetHeight > 0;
                if (delayedVisible) {
                  delayedContainer.scrollTop = delayedContainer.scrollHeight;
                }
              }
              scrollToBottom('instant');
            }, 100);
            
            // One more attempt after render
            requestAnimationFrame(() => {
              setTimeout(() => {
                scrollToBottom('instant');
              }, 200);
            });
          }
        }
      };
      
      // Try immediately and after delays with multiple attempts
      scrollAfterLoad();
      setTimeout(scrollAfterLoad, 50);
      setTimeout(scrollAfterLoad, 200);
      setTimeout(scrollAfterLoad, 400);
    }
  }, [selectedConversation?.id]);

  useEffect(() => {
    resetInputHeights();
  }, [selectedConversation?.id]);

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
        console.log('📊 Loading conversations and users data...');
        // Load conversations and users in parallel for faster initial load
        await Promise.all([
          fetchConversations(),
          fetchAllUsers()
        ]);
        console.log('✅ All data loaded successfully');
      }
    };
    
    loadData();
  }, [currentUser, fetchConversations, fetchAllUsers]);

  // Select initial conversation when modal opens
  useEffect(() => {
    if (isOpen && initialConversationId && conversations.length > 0) {
      const conversation = conversations.find(c => c.id === initialConversationId);
      if (conversation) {
        setSelectedConversation(conversation);
        fetchMessages(conversation.id);
        setShowMobileConversations(false);
        setActiveTab('chats');
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
    const newHeight = Math.min(textarea.scrollHeight, maxHeight);
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
  };

  // Handle emoji selection
  const handleEmojiClick = (emojiObject: any) => {
    const emoji = emojiObject.emoji;
    console.log('🎭 Adding emoji to message:', emoji);
    
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
      console.log('📨 WebSocket message received:', message);
      console.log('📨 Current selected conversation:', selectedConversation?.id);
      console.log('📨 Message is for conversation:', message.conversation_id);
      console.log('📨 Message sender:', message.sender_id);
      
      // Add message if it's for the currently selected conversation
      if (selectedConversation && message.conversation_id === selectedConversation.id) {
        console.log('📨 Adding message to current conversation');
        
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
            console.log('📨 Message already exists, skipping');
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
          
          console.log('📨 Adding enhanced message:', enhancedMessage);
          return [...prev, enhancedMessage];
        });
        
        // Mark message as read if current user is viewing the conversation
        if (message.id && message.sender_id !== currentUser.id) {
          await markMessagesAsRead([message.id], selectedConversation.id);
        }
      } else {
        console.log('📨 Message not for current conversation, updating conversation list only');
      }
      
      // Update conversation preview for all conversations
      setConversations(prev => 
        prev.map(conv => 
          conv.id === message.conversation_id
            ? {
                ...conv,
                last_message_at: message.sent_at,
                last_message_preview: message.content.substring(0, 100),
                unread_count: conv.id === selectedConversation?.id ? 0 : (conv.unread_count || 0) + 1
              }
            : conv
        ).sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime())
      );
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
      console.log('🔌 Joining conversation room:', selectedConversation.id);
      websocketService.joinConversation(selectedConversation.id);
      websocketService.markAsRead(selectedConversation.id, currentUser.id);
    }
    
    return () => {
      if (selectedConversation && currentUser) {
        console.log('🔌 Leaving conversation room:', selectedConversation.id);
        websocketService.leaveConversation(selectedConversation.id);
      }
    };
  }, [selectedConversation?.id, currentUser?.id]); // Only depend on IDs to prevent constant re-joining

  // Periodically refresh read receipts for messages in current conversation
  useEffect(() => {
    if (!selectedConversation || !currentUser || messages.length === 0) return;

    const refreshReadReceipts = async () => {
      const messageIds = messages
        .filter(msg => msg.sender_id === currentUser.id) // Only refresh for own messages
        .map(msg => msg.id);
      
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
      <div className="fixed inset-0 z-50 bg-gradient-to-br" style={{ background: 'linear-gradient(to bottom right, rgba(62, 40, 205, 0.05), rgba(59, 130, 246, 0.05))' }}>
        <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="loading loading-spinner loading-lg text-primary mb-4"></div>
          <p className="text-gray-600 font-medium">Loading RMQ Messages...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-gradient-to-br flex overflow-hidden" style={{ background: 'linear-gradient(to bottom right, rgba(62, 40, 205, 0.05), rgba(59, 130, 246, 0.05))' }}>
      {/* Sidebar - Desktop */}
      <div className="hidden lg:flex w-96 bg-white border-r border-gray-200 flex-col shadow-lg">
        {/* Header */}
        <div className="p-6 border-b border-gray-200/50" style={{ backgroundColor: 'transparent' }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {activeTab === 'groups' && (
                <button
                  onClick={() => setShowCreateGroupModal(true)}
                  className="btn btn-ghost btn-circle text-gray-500 hover:bg-gray-100"
                  title="Create Group"
                >
                  <PlusIcon className="w-6 h-6" style={{ color: '#3E28CD' }} />
                </button>
              )}
              <ChatBubbleLeftRightIcon className="w-8 h-8" style={{ color: '#3E28CD' }} />
              <div>
                <h1 className="text-xl font-bold text-gray-900">RMQ Messages</h1>
                <p className="text-gray-500 text-sm">Internal Communications</p>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs - Modern Style */}
        <div className="flex gap-2 p-2 bg-white rounded-lg mx-4 my-3">
          <button
            onClick={() => setActiveTab('chats')}
            className={`flex-1 py-2.5 px-4 font-medium text-sm transition-all rounded-md ${
              activeTab === 'chats'
                ? 'text-white shadow-md'
                : 'text-gray-600 hover:text-gray-900 hover:bg-white/50'
            }`}
            style={activeTab === 'chats' ? { backgroundColor: '#3E28CD' } : {}}
          >
            Chats
            <span className={`ml-2 text-xs ${
              activeTab === 'chats' ? 'text-white/80' : 'text-gray-400'
            }`}>
              {allUsers.length}
            </span>
          </button>
          <button
            onClick={() => setActiveTab('groups')}
            className={`flex-1 py-2.5 px-4 font-medium text-sm transition-all rounded-md ${
              activeTab === 'groups'
                ? 'text-white shadow-md'
                : 'text-gray-600 hover:text-gray-900 hover:bg-white/50'
            }`}
            style={activeTab === 'groups' ? { backgroundColor: '#3E28CD' } : {}}
          >
            Groups
            {filteredGroupConversations.length > 0 && (
              <span className={`ml-2 text-xs rounded-full px-2 py-0.5 ${
                activeTab === 'groups' 
                  ? 'bg-white/20 text-white' 
                  : 'bg-gray-200 text-gray-600'
              }`}>
                {filteredGroupConversations.length}
              </span>
            )}
          </button>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-gray-100">
          <div className="relative">
            <MagnifyingGlassIcon className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
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
        <div className="flex-1 overflow-y-auto">
          {activeTab === 'chats' ? (
            contactsWithLastMessage.length === 0 ? (
              <div className="p-6 text-center text-gray-500">
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

                return (
                  <div
                    key={user.id}
                    onClick={() => startDirectConversation(user.id)}
                    className="p-4 border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {renderUserAvatar({
                        userId: user.id,
                        name: userName,
                        photoUrl: userPhoto,
                        sizeClass: 'w-14 h-14',
                        borderClass: 'border-2 border-gray-200',
                        textClass: 'text-base',
                      })}
                    
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-gray-900 truncate">
                          {userName || `User ${user.id.slice(-4)}`}
                          {!hasCompleteInfo && (
                            <span className="ml-2 text-xs text-orange-500 bg-orange-100 px-2 py-1 rounded-full">
                              Incomplete Profile
                            </span>
                          )}
                        </div>
                        <div className="flex items-center justify-between">
                          <p className="text-sm text-gray-500 truncate">
                            {userRole}
                            {!hasCompleteInfo && !user.tenants_employee?.bonuses_role && !user.tenants_employee?.tenant_departement?.name && (
                              <span className="text-orange-500"> Profile setup needed</span>
                            )}
                          </p>
                          <span className="text-xs text-gray-400 ml-2 whitespace-nowrap">
                            {lastMessageAt ? formatMessageTime(lastMessageAt) : ''}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 mt-1">
                          <p className="text-sm text-gray-600 truncate flex-1">
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
                        <ChatBubbleLeftRightIcon className="w-5 h-5 text-gray-400" />
                        {unreadCount > 0 ? (
                          <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: '#3E28CD' }}>
                            {unreadCount > 99 ? '99+' : unreadCount}
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400 font-medium">0</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )
          ) : (
            filteredGroupConversations.length === 0 ? (
              <div className="p-6 text-center text-gray-500">
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
                  className={`p-4 border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors ${
                    selectedConversation?.id === conversation.id ? 'border-l-4' : ''
                  }`}
                  style={selectedConversation?.id === conversation.id ? { backgroundColor: 'rgba(62, 40, 205, 0.05)', borderLeftColor: '#3E28CD' } : {}}
                >
                  <div className="flex items-center gap-3">
                    {getConversationAvatar(conversation)}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <h3 className="font-semibold text-gray-900 truncate">
                          {getConversationTitle(conversation)}
                        </h3>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-500">
                            {formatMessageTime(conversation.last_message_at)}
                          </span>
                          {(conversation.unread_count || 0) > 0 && (
                            <div className="w-5 h-5 text-white rounded-full flex items-center justify-center text-xs font-bold" style={{ backgroundColor: '#3E28CD' }}>
                              {conversation.unread_count}
                            </div>
                          )}
                        </div>
                      </div>
                      <p className="text-sm text-gray-600 truncate mt-1">
                        {conversation.last_message_preview || 'No messages yet'}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
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
      <div className={`lg:hidden ${showMobileConversations ? 'block' : 'hidden'} w-full bg-white flex flex-col`}>
        {/* Mobile Header */}
        <div className="p-4 border-b border-gray-200/50" style={{ backgroundColor: 'transparent' }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {activeTab === 'groups' && (
                  <button
                    onClick={() => setShowCreateGroupModal(true)}
                    className="btn btn-ghost btn-circle text-gray-500 hover:bg-gray-100"
                    title="Create Group"
                  >
                    <PlusIcon className="w-5 h-5" style={{ color: '#3E28CD' }} />
                  </button>
                )}
                <ChatBubbleLeftRightIcon className="w-7 h-7" style={{ color: '#3E28CD' }} />
                <div>
                  <h1 className="text-lg font-bold text-gray-900">Messages</h1>
                  <p className="text-gray-500 text-xs">Internal Communications</p>
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
        <div className="flex gap-2 p-2 bg-white rounded-lg mx-4 my-3">
          <button
            onClick={() => setActiveTab('chats')}
            className={`flex-1 py-2.5 px-4 font-medium text-sm transition-all rounded-md ${
              activeTab === 'chats'
                ? 'text-white shadow-md'
                : 'text-gray-600 hover:text-gray-900 hover:bg-white/50'
            }`}
            style={activeTab === 'chats' ? { backgroundColor: '#3E28CD' } : {}}
          >
            Chats
            <span className={`ml-2 text-xs ${
              activeTab === 'chats' ? 'text-white/80' : 'text-gray-400'
            }`}>
              {allUsers.length}
            </span>
          </button>
          <button
            onClick={() => setActiveTab('groups')}
            className={`flex-1 py-2.5 px-4 font-medium text-sm transition-all rounded-md ${
              activeTab === 'groups'
                ? 'text-white shadow-md'
                : 'text-gray-600 hover:text-gray-900 hover:bg-white/50'
            }`}
            style={activeTab === 'groups' ? { backgroundColor: '#3E28CD' } : {}}
          >
            Groups
            {filteredGroupConversations.length > 0 && (
              <span className={`ml-2 text-xs rounded-full px-2 py-0.5 ${
                activeTab === 'groups' 
                  ? 'bg-white/20 text-white' 
                  : 'bg-gray-200 text-gray-600'
              }`}>
                {filteredGroupConversations.length}
              </span>
            )}
          </button>
        </div>

        {/* Mobile Search */}
        <div className="p-4 border-b border-gray-100">
          <div className="relative">
            <MagnifyingGlassIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
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
        <div className="flex-1 overflow-y-auto">
          {activeTab === 'chats' ? (
            contactsWithLastMessage.length === 0 ? (
              <div className="p-6 text-center text-gray-500">
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

                return (
                  <div
                    key={user.id}
                    onClick={() => startDirectConversation(user.id)}
                    className="p-4 border-b border-gray-100 cursor-pointer hover:bg-gray-50 active:bg-gray-100"
                  >
                    <div className="flex items-center gap-3">
                      {renderUserAvatar({
                        userId: user.id,
                        name: userName,
                        photoUrl: userPhoto,
                        sizeClass: 'w-14 h-14',
                        borderClass: 'border-2 border-gray-200',
                        textClass: 'text-base',
                      })}
                    
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-gray-900 truncate">
                          {userName || `User ${user.id.slice(-4)}`}
                          {!hasCompleteInfo && (
                            <span className="ml-1 text-xs text-orange-500 bg-orange-100 px-1 py-0.5 rounded">
                              Incomplete
                            </span>
                          )}
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm text-gray-500 truncate">
                            {userRole}
                            {!hasCompleteInfo && !user.tenants_employee?.bonuses_role && !user.tenants_employee?.tenant_departement?.name && (
                              <span className="text-orange-500"> Setup needed</span>
                            )}
                          </p>
                          <span className="text-xs text-gray-400 whitespace-nowrap">
                            {lastMessageAt ? formatMessageTime(lastMessageAt) : ''}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 mt-1">
                          <p className="text-xs text-gray-600 truncate flex-1">
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
                        <ChatBubbleLeftRightIcon className="w-5 h-5 text-gray-400" />
                        {unreadCount > 0 ? (
                          <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: '#3E28CD' }}>
                            {unreadCount > 99 ? '99+' : unreadCount}
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400 font-medium">0</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )
          ) : (
            filteredGroupConversations.length === 0 ? (
              <div className="p-6 text-center text-gray-500">
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
                  className="p-4 border-b border-gray-100 cursor-pointer hover:bg-gray-50 active:bg-gray-100"
                >
                  <div className="flex items-center gap-3">
                    {getConversationAvatar(conversation)}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <h3 className="font-semibold text-gray-900 truncate">
                          {getConversationTitle(conversation)}
                        </h3>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-500">
                            {formatMessageTime(conversation.last_message_at)}
                          </span>
                          {(conversation.unread_count || 0) > 0 && (
                            <div className="w-5 h-5 text-white rounded-full flex items-center justify-center text-xs font-bold" style={{ backgroundColor: '#3E28CD' }}>
                              {conversation.unread_count}
                            </div>
                          )}
                        </div>
                      </div>
                      <p className="text-sm text-gray-600 truncate mt-1">
                        {conversation.last_message_preview || 'No messages yet'}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
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
              className="p-4 border-b border-white/30 absolute top-0 left-0 right-0 z-20"
              style={{ 
                backgroundColor: 'rgba(255, 255, 255, 0.6)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
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
                  {getConversationAvatar(selectedConversation)}
                  <div>
                    <h2 className="font-semibold text-gray-900" style={{ textShadow: '0 1px 2px rgba(255, 255, 255, 0.8)' }}>
                      {getConversationTitle(selectedConversation)}
                    </h2>
                    <p className="text-sm text-gray-700" style={{ textShadow: '0 1px 2px rgba(255, 255, 255, 0.8)' }}>
                      {selectedConversation.type === 'direct' ? (
                        (() => {
                          const otherParticipant = selectedConversation.participants?.find(p => p.user_id !== currentUser?.id);
                          if (otherParticipant?.user?.tenants_employee) {
                            const role = getRoleDisplayName(otherParticipant.user.tenants_employee.bonuses_role || '');
                            const department = otherParticipant.user.tenants_employee.tenant_departement?.name || '';
                            return `${role}${department ? ` • ${department}` : ''}`;
                          }
                          return 'Direct message';
                        })()
                      ) : (
                        `${selectedConversation.participants?.length || 0} members`
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {/* Background Image Upload Button */}
                  <button
                    onClick={() => backgroundImageInputRef.current?.click()}
                    disabled={isUploadingBackground}
                    className="btn btn-ghost btn-sm btn-circle text-gray-500 hover:bg-gray-100"
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
                      className="btn btn-ghost btn-sm btn-circle text-gray-500 hover:bg-gray-100"
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
                      <button
                        onClick={() => setShowAddMemberModal(true)}
                        className="btn btn-ghost btn-sm btn-circle text-gray-500 hover:bg-gray-100"
                        title="Add Members"
                      >
                        <PlusIcon className="w-5 h-5" />
                      </button>
                      <button
                        onClick={() => setShowRemoveMemberModal(true)}
                        className="btn btn-ghost btn-sm btn-circle text-gray-500 hover:bg-gray-100"
                        title="Remove Members"
                      >
                        <UserIcon className="w-5 h-5" />
                      </button>
                    </>
                  )}
                  <button 
                    onClick={onClose}
                    className="btn btn-ghost btn-circle text-gray-500 hover:bg-gray-100"
                    title="Close Messages"
                  >
                    <XMarkIcon className="w-7 h-7" />
                  </button>
                </div>
              </div>
              
              {/* Group Members List */}
              {selectedConversation.type === 'group' && selectedConversation.participants && selectedConversation.participants.length > 0 && (
                <div className="mt-3 pt-3 border-t border-white/30">
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
                              borderClass: 'border-2 border-gray-200',
                              textClass: 'text-sm',
                            })}
                            <span className="text-xs font-medium text-center max-w-[80px] truncate" style={{ color: '#111827', textShadow: '0 1px 2px rgba(255, 255, 255, 0.9)' }}>{userName}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Messages Area */}
            <div 
              ref={desktopMessagesContainerRef}
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto p-4 pb-24 space-y-4 relative"
              style={{
                paddingTop: selectedConversation?.type === 'group' && selectedConversation.participants && selectedConversation.participants.length > 0 ? '180px' : '120px',
                backgroundImage: chatBackgroundImageUrl ? `url(${chatBackgroundImageUrl})` : 'none',
                backgroundColor: chatBackgroundImageUrl ? 'transparent' : 'white',
                backgroundSize: chatBackgroundImageUrl ? 'cover' : 'auto',
                backgroundPosition: chatBackgroundImageUrl ? 'center' : 'auto',
                backgroundRepeat: chatBackgroundImageUrl ? 'no-repeat' : 'repeat',
                backgroundAttachment: chatBackgroundImageUrl ? 'fixed' : 'scroll'
              }}
            >
              {messages.length === 0 ? (
                <div className="text-center py-12">
                  <ChatBubbleLeftRightIcon className="w-16 h-16 mx-auto text-gray-300 mb-4" />
                  <p className="text-gray-500 font-medium">No messages yet</p>
                  <p className="text-gray-400 text-sm">Start the conversation!</p>
                </div>
              ) : (
                messages.map((message, index) => {
                  const isOwn = message.sender_id === currentUser?.id;
                  const senderName = message.sender?.tenants_employee?.display_name || 
                                   message.sender?.full_name || 
                                   'Unknown User';
                  const senderPhoto = message.sender?.tenants_employee?.photo_url;

                  // Check if we need to show a date separator
                  const showDateSeparator = index === 0 || 
                    !isSameDay(new Date(message.sent_at), new Date(messages[index - 1].sent_at));

                  return (
                    <div key={message.id} className="relative">
                      {/* Date Separator */}
                      {showDateSeparator && (
                        <div className="flex items-center justify-center my-4">
                          <div className="bg-green-500 text-white px-3 py-1 rounded-full text-sm font-medium shadow-md">
                            {formatDateSeparator(message.sent_at)}
                          </div>
                        </div>
                      )}
                      
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
                            borderClass: 'border border-gray-200',
                            textClass: 'text-xs',
                            loading: 'lazy',
                          })}
                        </div>
                      )}
                      
                      <div className={`max-w-xs sm:max-w-md ${isOwn ? 'items-end' : 'items-start'} flex flex-col`}>
                        {!isOwn && selectedConversation.type !== 'direct' && (
                          <span className="text-xs text-gray-500 mb-1 px-3">
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
                                  ? 'bg-white text-gray-900 rounded-br-md'
                                  : 'text-white rounded-br-md'
                                : 'bg-white text-gray-900 border border-gray-200 rounded-bl-md'
                            }`}
                            style={isOwn && !isEmojiOnly(message.content) ? { backgroundColor: '#3e2bcd' } : {}}
                          >
                          {/* Message content */}
                          {message.content && (
                            <p className="break-words">
                              <span 
                                className="emoji-message" 
                                style={{ 
                                  fontSize: isEmojiOnly(message.content) ? '4em' : '1.1em',
                                  lineHeight: isEmojiOnly(message.content) ? '1.2' : 'normal'
                                }}
                              >
                                {renderMessageContent(message.content, isOwn)}
                              </span>
                            </p>
                          )}
                          
                          {/* File attachment */}
                          {message.attachment_url && (
                            <div className={`mt-2 rounded-lg border ${
                              isOwn 
                                ? 'bg-white/10 border-white/20' 
                                : 'bg-gray-50 border-gray-200'
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
                                        borderClass: 'border border-gray-200',
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
                                  <div className="flex-1">
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
                                                    : (isActive ? '#3E28CD' : 'rgba(62, 40, 205, 0.5)')
                                                }}
                                              />
                                            );
                                          });
                                        })()}
                                      </div>
                                      <span className={`text-sm font-mono whitespace-nowrap ${
                                        isOwn ? 'text-white/80' : 'text-gray-600'
                                      }`}>
                                        {formatVoiceDuration(message.voice_duration)}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              ) : isImageMessage(message) ? (
                                // Image preview
                                <div className="space-y-2">
                                  <div 
                                    className="relative cursor-pointer group"
                                    onClick={() => openMediaModal(message)}
                                  >
                                    <img
                                      src={message.attachment_url}
                                      alt={message.attachment_name}
                                      className="max-w-full max-h-80 rounded-lg object-cover w-full transition-transform group-hover:scale-105"
                                    />
                                    <div className="absolute inset-0 bg-black/20 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                      <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
                                      </svg>
                                    </div>
                                  </div>
                                  <div className="flex items-center justify-between text-xs opacity-75 px-2 pb-2">
                                    <div className="flex items-center gap-2">
                                      <span className="truncate">{message.attachment_name}</span>
                                      <span>({Math.round((message.attachment_size || 0) / 1024)} KB)</span>
                                    </div>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const link = document.createElement('a');
                                        link.href = message.attachment_url!;
                                        link.download = message.attachment_name || 'download';
                                        link.click();
                                      }}
                                      className="p-1 hover:bg-white/20 rounded transition-colors"
                                      title="Download image"
                                    >
                                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                      </svg>
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                // File attachment
                                <div className="flex items-center gap-3 p-3">
                                  <div className={`p-3 rounded-lg ${
                                    isOwn ? 'bg-white/20' : 'bg-gray-200'
                                  }`}>
                                    <PaperClipIcon className={`w-5 h-5 ${
                                      isOwn ? 'text-white' : 'text-gray-600'
                                    }`} />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <button
                                      onClick={() => window.open(message.attachment_url, '_blank')}
                                      className="text-sm font-medium hover:underline truncate block"
                                    >
                                      {message.attachment_name}
                                    </button>
                                    <p className="text-xs opacity-75">
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
                              isOwn ? 'text-white/70' : 'text-gray-500'
                            }`}>
                              {formatMessageTime(message.sent_at)}
                            </span>
                            {isOwn && renderReadReceipts(message)}
                          </div>
                          </div>
                          
                          {/* Reaction picker */}
                          {showReactionPicker === message.id && (
                            <div className={`absolute ${isOwn ? 'bottom-6 right-0' : 'bottom-6 left-0'} bg-white border border-gray-200 rounded-lg shadow-lg p-2 flex gap-1 z-50`}>
                              {['👍', '❤️', '😂', '😮', '😢', '😡', '👏'].map((emoji) => (
                                <button
                                  key={emoji}
                                  onClick={() => handleAddReaction(message.id, emoji)}
                                  className="p-2 hover:bg-gray-100 rounded transition-colors"
                                  title={`React with ${emoji}`}
                                >
                                  <span className="text-lg">{emoji}</span>
                                </button>
                              ))}
                            </div>
                          )}
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
                    </div>
                  );
                })
              )}
              
              {/* Typing indicators removed */}
              
              {/* New messages indicator when user is scrolled up */}
              {isUserScrolling && !shouldAutoScroll && (
                <div className="fixed bottom-20 right-4 z-10">
                  <button
                    onClick={() => {
                      setShouldAutoScroll(true);
                      scrollToBottom('smooth');
                    }}
                    className="bg-green-500 hover:bg-green-600 text-white rounded-full p-3 shadow-lg transition-colors"
                    title="New messages - click to scroll down"
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
              <div className="flex items-end gap-3 relative pointer-events-auto">
                {/* Consolidated Tools Button */}
                <div className="relative" ref={desktopToolsRef}>
                  {!isRecording ? (
                    <button
                      onClick={() => setShowDesktopTools(prev => !prev)}
                      disabled={isSending}
                      className="btn btn-circle w-12 h-12 text-white disabled:opacity-50 shadow-lg hover:shadow-xl transition-shadow"
                      style={{ backgroundColor: '#3E28CD', borderColor: '#3E28CD' }}
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
                        className="btn btn-circle btn-sm bg-gray-500 hover:bg-gray-600 text-white"
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
                    <div className="absolute bottom-12 left-0 z-50 bg-white border border-gray-200 rounded-lg shadow-lg min-w-[180px]">
                      <button
                        onClick={() => handleDesktopToolSelect('lead')}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-left transition-colors"
                      >
                        <PlusIcon className="w-5 h-5 text-green-600" />
                        <span className="text-sm text-gray-700">Attach Lead</span>
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
                        <span className="text-sm text-gray-700">Attach File</span>
                      </button>
                      <button
                        onClick={() => handleDesktopToolSelect('emoji')}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-left transition-colors"
                      >
                        <FaceSmileIcon className="w-5 h-5" style={{ color: '#3E28CD' }} />
                        <span className="text-sm text-gray-700">Add Emoji</span>
                      </button>
                      <button
                        onClick={() => handleDesktopToolSelect('voice')}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-left transition-colors"
                      >
                        <MicrophoneIcon className="w-5 h-5 text-red-600" />
                        <span className="text-sm text-gray-700">Voice Message</span>
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
                    <div className="absolute bottom-12 left-0 z-50 bg-white border border-gray-200 rounded-lg shadow-lg w-80 max-h-96 overflow-hidden lead-search-dropdown">
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
                      
                      <div className="max-h-64 overflow-y-auto">
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
                
                <div className="flex-1">
                  <textarea
                    ref={messageInputRef}
                    value={newMessage}
                    onChange={handleMessageInputChange}
                    onKeyDown={handleMessageKeyDown}
                    placeholder="Type a message..."
                    className="textarea w-full resize-none min-h-[44px] max-h-32 border border-white/30 rounded-2xl focus:border-white/50 focus:outline-none"
                    rows={1}
                    disabled={isSending}
                    style={{ 
                      backgroundColor: 'rgba(255, 255, 255, 0.8)', 
                      backdropFilter: 'blur(10px)',
                      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)' 
                    }}
                  />
                </div>
                
                <button
                  onClick={!newMessage.trim() ? startVoiceRecording : sendMessage}
                  disabled={isSending}
                  className="btn btn-primary btn-circle w-12 h-12 shadow-lg hover:shadow-xl transition-shadow"
                  style={{ backgroundColor: '#3E28CD', borderColor: '#3E28CD' }}
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
                  className="btn btn-ghost btn-circle text-gray-500 hover:bg-gray-100"
                  title="Close Messages"
                >
                  <XMarkIcon className="w-7 h-7" />
                </button>
              </div>
            </div>
            <div 
              className="flex-1 flex items-center justify-center relative"
              style={{
                backgroundImage: chatBackgroundImageUrl ? `url(${chatBackgroundImageUrl})` : 'none',
                backgroundColor: chatBackgroundImageUrl ? 'transparent' : 'white',
                backgroundSize: chatBackgroundImageUrl ? 'cover' : 'auto',
                backgroundPosition: chatBackgroundImageUrl ? 'center' : 'auto',
                backgroundRepeat: chatBackgroundImageUrl ? 'no-repeat' : 'repeat',
                backgroundAttachment: chatBackgroundImageUrl ? 'fixed' : 'scroll'
              }}
            >
              <div className="text-center relative z-10">
                <ChatBubbleLeftRightIcon className="w-12 h-12 mx-auto mb-6" style={{ color: '#3E28CD' }} />
                <h3 className="text-xl font-bold text-gray-900 mb-2">Welcome to RMQ Messages</h3>
                <p className="text-gray-600 mb-6 max-w-md">
                  Pick your <span className="font-semibold" style={{ color: '#3E28CD' }}>Employee</span> that you want to chat with.
                </p>
                <div className="flex items-center justify-center gap-4 text-sm text-gray-500">
                  <div className="flex items-center gap-2">
                    
                    
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
              className="p-4 border-b border-white/30 absolute top-0 left-0 right-0 z-20"
              style={{ 
                backgroundColor: 'rgba(255, 255, 255, 0.6)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)'
              }}
            >
              <div className="flex items-center gap-3 mb-3">
                <button
                  onClick={() => setShowMobileConversations(true)}
                  className="btn btn-ghost btn-sm btn-circle text-gray-500 hover:bg-gray-100"
                >
                  <ArrowLeftIcon className="w-5 h-5" />
                </button>
                {getConversationAvatar(selectedConversation)}
                <div className="flex-1 min-w-0">
                  <h2 className="font-semibold text-gray-900 truncate" style={{ textShadow: '0 1px 2px rgba(255, 255, 255, 0.8)' }}>
                    {getConversationTitle(selectedConversation)}
                  </h2>
                  <p className="text-sm text-gray-700" style={{ textShadow: '0 1px 2px rgba(255, 255, 255, 0.8)' }}>
                    {selectedConversation.type === 'direct' ? (
                      (() => {
                        const otherParticipant = selectedConversation.participants?.find(p => p.user_id !== currentUser?.id);
                        if (otherParticipant?.user?.tenants_employee) {
                          const role = getRoleDisplayName(otherParticipant.user.tenants_employee.bonuses_role || '');
                          const department = otherParticipant.user.tenants_employee.tenant_departement?.name || '';
                          return `${role}${department ? ` • ${department}` : ''}`;
                        }
                        return 'Direct message';
                      })()
                    ) : (
                      `${selectedConversation.participants?.length || 0} members`
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  {/* Background Image Upload Button - Mobile */}
                  <button
                    onClick={() => backgroundImageInputRef.current?.click()}
                    disabled={isUploadingBackground}
                    className="btn btn-ghost btn-sm btn-circle text-gray-500 hover:bg-gray-100"
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
                      className="btn btn-ghost btn-sm btn-circle text-gray-500 hover:bg-gray-100"
                      title="Reset to default white background"
                    >
                      <ArrowPathIcon className="w-5 h-5" />
                    </button>
                  )}
                  {/* Add/Remove Member Buttons for Group Chats - Mobile */}
                  {selectedConversation.type === 'group' && (
                    <>
                      <button
                        onClick={() => setShowAddMemberModal(true)}
                        className="btn btn-ghost btn-sm btn-circle text-gray-500 hover:bg-gray-100"
                        title="Add Members"
                      >
                        <PlusIcon className="w-5 h-5" />
                      </button>
                      <button
                        onClick={() => setShowRemoveMemberModal(true)}
                        className="btn btn-ghost btn-sm btn-circle text-gray-500 hover:bg-gray-100"
                        title="Remove Members"
                      >
                        <UserIcon className="w-5 h-5" />
                      </button>
                    </>
                  )}
                  <button 
                    onClick={onClose}
                    className="btn btn-ghost btn-circle text-gray-500 hover:bg-gray-100"
                    title="Close Messages"
                  >
                    <XMarkIcon className="w-7 h-7" />
                  </button>
                </div>
              </div>
              
              {/* Group Members List - Mobile (Collapsible) */}
              {selectedConversation.type === 'group' && selectedConversation.participants && selectedConversation.participants.length > 0 && (
                <div className="border-t border-white/30">
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
                                  borderClass: 'border-2 border-gray-200',
                                  textClass: 'text-sm',
                                })}
                                <span className="text-xs font-medium text-center max-w-[80px] truncate" style={{ color: '#111827', textShadow: '0 1px 2px rgba(255, 255, 255, 0.9)' }}>{userName}</span>
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

            {/* Mobile Messages */}
            <div 
              ref={mobileMessagesContainerRef}
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto p-4 pb-24 space-y-4 min-h-0 overscroll-contain relative"
              style={{ 
                paddingTop: selectedConversation?.type === 'group' && selectedConversation.participants && selectedConversation.participants.length > 0 ? '180px' : '120px',
                WebkitOverflowScrolling: 'touch',
                backgroundImage: chatBackgroundImageUrl ? `url(${chatBackgroundImageUrl})` : 'none',
                backgroundColor: chatBackgroundImageUrl ? 'transparent' : 'white',
                backgroundSize: chatBackgroundImageUrl ? 'cover' : 'auto',
                backgroundPosition: chatBackgroundImageUrl ? 'center' : 'auto',
                backgroundRepeat: chatBackgroundImageUrl ? 'no-repeat' : 'repeat',
                backgroundAttachment: chatBackgroundImageUrl ? 'fixed' : 'scroll'
              }}
            >
              {                messages.map((message, index) => {
                  const isOwn = message.sender_id === currentUser?.id;
                  const senderName = message.sender?.tenants_employee?.display_name || 
                                   message.sender?.full_name || 
                                   'Unknown User';
                  const senderPhoto = message.sender?.tenants_employee?.photo_url;

                  // Check if we need to show a date separator
                  const showDateSeparator = index === 0 || 
                    !isSameDay(new Date(message.sent_at), new Date(messages[index - 1].sent_at));

                return (
                  <div key={message.id}>
                    {/* Date Separator */}
                    {showDateSeparator && (
                      <div className="flex items-center justify-center my-4">
                        <div className="bg-green-500 text-white px-3 py-1 rounded-full text-sm font-medium shadow-md">
                          {formatDateSeparator(message.sent_at)}
                        </div>
                      </div>
                    )}
                    
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
                        <span className="text-xs text-gray-500 mb-1 px-3">
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
                          className={`px-4 py-3 rounded-2xl text-base cursor-pointer hover:shadow-md transition-shadow relative ${
                            isOwn
                              ? isEmojiOnly(message.content) 
                                ? 'bg-white text-gray-900 rounded-br-md'
                                : 'text-white rounded-br-md'
                              : 'bg-white text-gray-900 border border-gray-200 rounded-bl-md'
                          }`}
                          style={isOwn && !isEmojiOnly(message.content) ? { backgroundColor: '#3e2bcd' } : {}}
                        >
                        {/* Message content */}
                        {message.content && (
                          <p className="break-words">
                            <span 
                              className="emoji-message" 
                                style={{ 
                                  fontSize: isEmojiOnly(message.content) ? '4em' : '1.1em',
                                  lineHeight: isEmojiOnly(message.content) ? '1.2' : 'normal'
                                }}
                            >
                              {renderMessageContent(message.content, isOwn)}
                            </span>
                          </p>
                        )}
                        
                        {/* File attachment */}
                        {message.attachment_url && (
                          <div className={`mt-2 rounded-lg border ${
                            isOwn 
                              ? 'bg-white/10 border-white/20' 
                              : 'bg-gray-50 border-gray-200'
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
                                      borderClass: 'border border-gray-200',
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
                                                  : (isActive ? '#3E28CD' : 'rgba(62, 40, 205, 0.5)')
                                              }}
                                            />
                                          );
                                        });
                                      })()}
                                    </div>
                                    <span className={`text-xs font-mono whitespace-nowrap ${
                                      isOwn ? 'text-white/80' : 'text-gray-600'
                                    }`}>
                                      {formatVoiceDuration(message.voice_duration)}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            ) : isImageMessage(message) ? (
                              // Image preview
                              <div className="space-y-2">
                                <div 
                                  className="relative cursor-pointer group"
                                  onClick={() => openMediaModal(message)}
                                >
                                  <img
                                    src={message.attachment_url}
                                    alt={message.attachment_name}
                                    className="max-w-full max-h-80 rounded-lg object-cover w-full transition-transform group-hover:scale-105"
                                  />
                                  <div className="absolute inset-0 bg-black/20 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                    <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
                                    </svg>
                                  </div>
                                </div>
                                <div className="flex items-center justify-between text-xs opacity-75 px-2 pb-2">
                                  <div className="flex items-center gap-2">
                                    <span className="truncate">{message.attachment_name}</span>
                                    <span>({Math.round((message.attachment_size || 0) / 1024)} KB)</span>
                                  </div>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const link = document.createElement('a');
                                      link.href = message.attachment_url!;
                                      link.download = message.attachment_name || 'download';
                                      link.click();
                                    }}
                                    className="p-1 hover:bg-white/20 rounded transition-colors"
                                    title="Download image"
                                  >
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                    </svg>
                                  </button>
                                </div>
                              </div>
                            ) : (
                              // File attachment
                              <div className="flex items-center gap-2 p-3">
                                <div className={`p-2 rounded ${
                                  isOwn ? 'bg-white/20' : 'bg-gray-200'
                                }`}>
                                  <PaperClipIcon className={`w-4 h-4 ${
                                    isOwn ? 'text-white' : 'text-gray-600'
                                  }`} />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <button
                                    onClick={() => window.open(message.attachment_url, '_blank')}
                                    className="text-xs font-medium hover:underline truncate block"
                                  >
                                    {message.attachment_name}
                                  </button>
                                  <p className="text-xs opacity-75">
                                    {Math.round((message.attachment_size || 0) / 1024)} KB
                                  </p>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                        
                        {/* Timestamp inside message bubble - Mobile */}
                        <div className={`flex items-center gap-1 mt-1 pt-1 ${isOwn ? 'justify-end' : 'justify-start'}`}>
                          <span className={`text-xs ${
                            isOwn ? 'text-white/70' : 'text-gray-500'
                          }`}>
                            {formatMessageTime(message.sent_at)}
                          </span>
                          {isOwn && renderReadReceipts(message)}
                        </div>
                        </div>
                        
                        {/* Reaction picker - Mobile */}
                        {showReactionPicker === message.id && (
                          <div className={`absolute ${isOwn ? 'bottom-6 right-0' : 'bottom-6 left-0'} bg-white border border-gray-200 rounded-lg shadow-lg p-2 flex gap-1 z-50`}>
                            {['👍', '❤️', '😂', '😮', '😢', '😡', '👏'].map((emoji) => (
                              <button
                                key={emoji}
                                onClick={() => handleAddReaction(message.id, emoji)}
                                className="p-2 hover:bg-gray-100 rounded transition-colors"
                                title={`React with ${emoji}`}
                              >
                                <span className="text-lg">{emoji}</span>
                              </button>
                            ))}
                          </div>
                        )}
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
                  </div>
                );
              })}
              
              {/* Mobile Typing indicators removed */}
              
              <div ref={messagesEndRef} />
            </div>

            {/* Mobile Message Input - Mobile Only */}
            <div className="lg:hidden absolute bottom-0 left-0 right-0 p-3 z-30 pointer-events-none">
              <div className="relative space-y-2 pointer-events-auto">
                <div className="flex items-center gap-2">
                  <div className="relative" ref={mobileToolsRef}>
                    <button
                      onClick={() => setShowMobileTools(prev => !prev)}
                      className="btn btn-circle w-12 h-12 text-white shadow-lg hover:shadow-xl transition-shadow"
                      style={{ backgroundColor: '#3E28CD', borderColor: '#3E28CD' }}
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
                      className="textarea w-full resize-none text-sm min-h-[36px] max-h-40 border border-white/30 rounded-2xl focus:border-white/50 focus:outline-none"
                      rows={1}
                      disabled={isSending}
                      style={{ 
                        lineHeight: '1.4', 
                        backgroundColor: 'rgba(255, 255, 255, 0.8)', 
                        backdropFilter: 'blur(10px)',
                        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)' 
                      }}
                    />
                  </div>
                  
                  <button
                    onClick={!newMessage.trim() ? startVoiceRecording : sendMessage}
                    disabled={isSending}
                    className="btn btn-primary btn-circle w-12 h-12 shadow-lg hover:shadow-xl transition-shadow"
                    style={{ backgroundColor: '#3E28CD', borderColor: '#3E28CD' }}
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
                <MagnifyingGlassIcon className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
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

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept="image/*,.pdf,.doc,.docx,.txt,.zip,.rar"
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
            {conversationMedia[selectedMediaIndex]?.message_type === 'image' ? (
              <img
                src={conversationMedia[selectedMediaIndex]?.attachment_url}
                alt={conversationMedia[selectedMediaIndex]?.attachment_name}
                className="max-w-full max-h-full object-contain"
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
    </div>
  );
};

export default RMQMessagesPage;
