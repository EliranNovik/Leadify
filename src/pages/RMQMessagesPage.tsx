import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { toast } from 'react-hot-toast';
import websocketService, { MessageData, TypingData } from '../lib/websocket';
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
  StopIcon
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
}

interface MessagingModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialConversationId?: number;
}

const RMQMessagesPage: React.FC<MessagingModalProps> = ({ isOpen, onClose, initialConversationId }) => {
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
  const [activeTab, setActiveTab] = useState<'chats' | 'contacts'>('chats');
  const [showMobileConversations, setShowMobileConversations] = useState(true);
  const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [newGroupTitle, setNewGroupTitle] = useState('');
  const [newGroupDescription, setNewGroupDescription] = useState('');
  
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
  
  // Typing indicators removed - causing too many issues
  
  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  
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
      
      // Finalize voice message
      const duration = recordingDuration;
      const { data: finalizeData, error: finalizeError } = await supabase.rpc('finalize_voice_message', {
        p_session_token: sessionToken,
        p_duration: duration,
        p_waveform_data: null // We can add waveform generation later
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
      const { data: chunksData, error } = await supabase.rpc('get_voice_message_chunks', {
        p_message_id: messageId,
        p_user_id: currentUser.id
      });

      if (error) throw error;

      if (!chunksData || chunksData.length === 0) {
        toast.error('Voice message not found or access denied');
        return;
      }

      // Sort chunks by chunk_number and combine them
      const sortedChunks = chunksData.sort((a: any, b: any) => a.chunk_number - b.chunk_number);
      
      // Convert base64 chunks back to binary data
      const binaryChunks = sortedChunks.map((chunk: any) => {
        const binaryString = atob(chunk.chunk_data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes;
      });

      // Combine all chunks into a single Uint8Array
      const totalLength = binaryChunks.reduce((sum: number, chunk: Uint8Array) => sum + chunk.length, 0);
      const combinedArray = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of binaryChunks) {
        combinedArray.set(chunk, offset);
        offset += chunk.length;
      }

      // Create blob from combined data
      const audioBlob = new Blob([combinedArray], { type: 'audio/webm' });
      const audioUrl = URL.createObjectURL(audioBlob);

      // Create audio element and play
      const audio = new Audio(audioUrl);
      audio.preload = 'metadata';
      
      audio.onloadedmetadata = () => {
        setPlayingVoiceId(messageId);
        setVoiceAudio(audio);
        audio.play();
      };

      audio.onplay = () => {
        setPlayingVoiceId(messageId);
      };

      audio.onpause = () => {
        setPlayingVoiceId(null);
      };

      audio.onended = () => {
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
        console.error('Audio playback error:', e);
        toast.error('Failed to play voice message');
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
    const diffInDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    
    if (isToday(date)) {
      return format(date, 'HH:mm');
    } else if (isYesterday(date)) {
      // Show actual time instead of "Yesterday"
      return format(date, 'HH:mm');
    } else if (diffInDays <= 7) {
      // Show day of week for messages within the last week
      return format(date, 'EEEE HH:mm');
    } else {
      // Show date and time for older messages
      return format(date, 'MMM d, yyyy HH:mm');
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
    return messages.filter(message => 
      message.attachment_url && 
      (message.message_type === 'image' || message.message_type === 'file')
    );
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
    // For direct conversations with exactly 2 participants
    if (conversation.type === 'direct' && conversation.participants && conversation.participants.length === 2) {
      const otherParticipant = conversation.participants.find(p => p.user_id !== currentUser?.id);
      
      if (otherParticipant?.user) {
        const name = otherParticipant.user.tenants_employee?.display_name || 
                     otherParticipant.user.full_name || 
                   'Unknown User';
        const photoUrl = otherParticipant.user.tenants_employee?.photo_url;
      
        // Show photo if available, otherwise show colored circle with initials
      if (photoUrl && photoUrl.trim() !== '') {
        return (
          <img 
            src={photoUrl} 
            alt={name}
            className="w-12 h-12 rounded-full object-cover border-2 border-white shadow-md"
            onError={(e) => {
              // If image fails to load, replace with colored circle
              const target = e.target as HTMLImageElement;
              const parent = target.parentElement;
              if (parent) {
                parent.innerHTML = `
                  <div class="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white font-bold text-sm border-2 border-white shadow-md">
                    ${getInitials(name)}
                  </div>
                `;
              }
            }}
          />
        );
      }
      
        // Default: colored circle with initials for direct chat
      return (
        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white font-bold text-sm border-2 border-white shadow-md">
          {getInitials(name)}
        </div>
      );
      }
    }
    
    // Group chat avatar or fallback
      return (
        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-green-500 to-teal-500 flex items-center justify-center text-white border-2 border-white shadow-md">
          <UserGroupIcon className="w-6 h-6" />
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

          console.log('🔍 Conversation participants filtered:', {
            conversationId: conv.id,
            totalParticipants: conv.conversation_participants?.length || 0,
            activeParticipants: activeParticipants.length,
            uniqueParticipants: uniqueParticipants.length,
            sampleParticipant: activeParticipants[0] ? {
              user_id: activeParticipants[0].user_id,
              name: activeParticipants[0].user?.full_name || activeParticipants[0].user?.tenants_employee?.display_name,
              is_active: activeParticipants[0].user?.is_active
            } : null
          });

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
          console.log('🔍 Processing conversation:', {
            id: conv.id,
            type: conv.type,
            participantCount: conv.conversation_participants?.length,
            participants: conv.conversation_participants?.map((p: ConversationParticipant) => ({
              user_id: p.user_id,
              name: p.user?.tenants_employee?.display_name || p.user?.full_name
            }))
          });
          
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

          console.log('🔍 Conversation participants filtered:', {
            conversationId: conv.id,
            totalParticipants: conv.conversation_participants?.length || 0,
            activeParticipants: activeParticipants.length,
            uniqueParticipants: uniqueParticipants.length,
            sampleParticipant: activeParticipants[0] ? {
              user_id: activeParticipants[0].user_id,
              name: activeParticipants[0].user?.full_name || activeParticipants[0].user?.tenants_employee?.display_name,
              is_active: activeParticipants[0].user?.is_active
            } : null
          });

          const processedConv = {
            ...conv,
            participants: uniqueParticipants,
            unread_count: unreadCount
          };
          
          console.log('🔍 Processed conversation:', {
            id: processedConv.id,
            type: processedConv.type,
            participantCount: processedConv.participants?.length,
            isDirect: processedConv.type === 'direct' && processedConv.participants?.length === 2,
            participantIds: processedConv.participants?.map((p: ConversationParticipant) => p.user_id)
          });

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

      setMessages((messagesData || []) as unknown as Message[]);
      
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

      // Debug: Log all users to see what we're getting
      console.log('🔍 RMQ Messages - Raw users data:', {
        totalUsers: usersData?.length || 0,
        sampleUsers: usersData?.slice(0, 3).map(user => ({
          id: user.id,
          full_name: user.full_name,
          is_active: (user as any).is_active,
          hasEmployee: !!user.tenants_employee
        })) || []
      });

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
        
        console.log('🔍 User filter check:', {
          id: user.id,
          full_name: user.full_name,
          hasName: !!hasName,
          isValidName: isValidName,
          isActive: isActive,
          isNotExplicitlyInactive: isNotExplicitlyInactive,
          hasEmployee: !!user.tenants_employee,
          passes: shouldInclude,
          reason: shouldInclude ? 'user has valid name and not explicitly inactive' : 
                  !isValidName ? 'user name is too short' : 
                  !isNotExplicitlyInactive ? 'user is explicitly marked as inactive' : 
                  'other filtering criteria'
        });
        
        return shouldInclude;
      });

      console.log('🔍 RMQ Messages - Users loaded:', {
        totalUsers: usersData?.length || 0,
        activeUsers: uniqueUsers.length,
        sampleUser: uniqueUsers[0] ? {
          id: uniqueUsers[0].id,
          name: uniqueUsers[0].full_name,
          is_active: (uniqueUsers[0] as any).is_active
        } : null
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

      // Only add message to local state if WebSocket is NOT connected
      // If WebSocket is connected, the message will come through the WebSocket handler
      if (!websocketService.isSocketConnected()) {
        setMessages(prev => [...prev, messageData as unknown as Message]);
      }
      
      setNewMessage('');
      
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
      console.log('🔍 Starting direct conversation with userId:', userId);
      
      // First check if a direct conversation already exists
      const existingConv = conversations.find(c => 
        c.type === 'direct' && 
        c.participants?.length === 2 &&
        c.participants.some(p => p.user_id === userId) &&
        c.participants.some(p => p.user_id === currentUser.id)
      );
      
      if (existingConv) {
        console.log('🔍 Found existing direct conversation:', existingConv.id);
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
      
      console.log('🔍 Created new conversation with ID:', conversationId);

      // Wait a bit for the database to be consistent, then refresh conversations
      setTimeout(async () => {
        // Fetch conversations and get the updated list
        const updatedConversations = await getUpdatedConversations();
        console.log('🔍 Looking for new conversation with ID:', conversationId);
        console.log('🔍 Available conversations:', updatedConversations.map(c => ({ id: c.id, type: c.type, participants: c.participants?.length || 0 })));
        
        // Find the newly created conversation in the updated list
        const newConv = updatedConversations.find(c => c.id === conversationId);
          
        if (newConv) {
          console.log('🔍 Found new conversation:', newConv);
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

  // Smart auto-scroll logic
  const scrollToBottom = (behavior: 'smooth' | 'instant' = 'smooth') => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior });
    }
  };

  // Check if user is near bottom of messages
  const isNearBottom = () => {
    if (!messagesContainerRef.current) return true;
    const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
    const threshold = 100; // 100px from bottom
    return scrollHeight - scrollTop - clientHeight < threshold;
  };

  // Handle scroll events to detect user scrolling
  const handleScroll = useCallback(() => {
    if (!messagesContainerRef.current) return;
    
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
    if (shouldAutoScroll && messages.length > 0) {
      scrollToBottom('smooth');
    }
  }, [messages, shouldAutoScroll]);

  // Scroll to bottom when conversation is first selected
  useEffect(() => {
    if (selectedConversation && messages.length > 0) {
      // Reset auto-scroll state when conversation changes
      setShouldAutoScroll(true);
      setIsUserScrolling(false);
      // Scroll to bottom after a short delay to ensure messages are rendered
      setTimeout(() => scrollToBottom('instant'), 100);
    }
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

  // Fetch conversations and users when user is loaded
  useEffect(() => {
    const loadData = async () => {
    if (currentUser) {
        console.log('📊 Loading conversations and users data...');
        await fetchConversations();
        await fetchAllUsers();
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

  // Initial loading
  useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), 1000);
    return () => clearTimeout(timer);
  }, []);

  // Handle Enter key for sending messages
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Handle message input change
  const handleMessageInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setNewMessage(value);
  };

  // Handle emoji selection
  const handleEmojiClick = (emojiObject: any) => {
    const emoji = emojiObject.emoji;
    console.log('🎭 Adding emoji to message:', emoji);
    
    // Add emoji to message
    setNewMessage(prev => prev + emoji);
    
    // Close picker after a small delay to ensure emoji is added first
    setTimeout(() => {
      setIsEmojiPickerOpen(false);
      
      // Focus back on the message input
      if (messageInputRef.current) {
        messageInputRef.current.focus();
      }
    }, 50);
  };

  // Close emoji picker, lead search, and reaction picker when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (isEmojiPickerOpen) {
        const target = event.target as Element;
        
        // Check if click is inside emoji picker or emoji button
        const isInsideEmojiPicker = target.closest('[class*="EmojiPicker"]') || 
                                   target.closest('[class*="epr-"]') ||
                                   target.closest('button[title="Add emoji"]');
        
        if (!isInsideEmojiPicker) {
          setIsEmojiPickerOpen(false);
        }
      }
      
      if (isLeadSearchOpen) {
        const target = event.target as Element;
        
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
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isEmojiPickerOpen, isLeadSearchOpen, showReactionPicker]);

  // WebSocket message handler - separate from initialization
  useEffect(() => {
    if (!currentUser) return;

    const handleWebSocketMessage = (message: MessageData) => {
      console.log('📨 WebSocket message received:', message);
      console.log('📨 Current selected conversation:', selectedConversation?.id);
      console.log('📨 Message is for conversation:', message.conversation_id);
      console.log('📨 Message sender:', message.sender_id);
      
      // Add message if it's for the currently selected conversation
      if (selectedConversation && message.conversation_id === selectedConversation.id) {
        console.log('📨 Adding message to current conversation');
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
          const enhancedMessage = { ...message } as unknown as Message;
          
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

  // Typing indicators removed - no cleanup needed

  // Filter conversations and users based on search and active tab
  const filteredConversations = conversations.filter(conv => {
    const title = getConversationTitle(conv).toLowerCase();
    const preview = conv.last_message_preview?.toLowerCase() || '';
    const query = searchQuery.toLowerCase();
    return title.includes(query) || preview.includes(query);
  });

  const filteredUsers = allUsers.filter(user => {
    const userName = (user.tenants_employee?.display_name || user.full_name || '').toLowerCase();
    const userRole = (user.tenants_employee?.bonuses_role || '').toLowerCase();
    const userDept = (user.tenants_employee?.tenant_departement?.name || '').toLowerCase();
    const query = searchQuery.toLowerCase();
    return userName.includes(query) || userRole.includes(query) || userDept.includes(query);
  });

  // Don't render if not open
  if (!isOpen) return null;

  if (isLoading) {
    return (
      <div className="fixed inset-0 z-50 bg-gradient-to-br from-purple-50 to-blue-50">
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
    <div className="fixed inset-0 z-50 bg-gradient-to-br from-purple-50 to-blue-50 flex overflow-hidden">
      {/* Sidebar - Desktop */}
      <div className="hidden lg:flex w-80 bg-white border-r border-gray-200 flex-col shadow-lg">
        {/* Header */}
        <div className="p-6 border-b border-gray-200 bg-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center">
                <ChatBubbleLeftRightIcon className="w-6 h-6 text-purple-600" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">RMQ Messages</h1>
                <p className="text-gray-500 text-sm">Internal Communications</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {activeTab === 'contacts' && (
                <button
                  onClick={() => setShowCreateGroupModal(true)}
                  className="btn btn-sm bg-purple-100 text-purple-700 border-purple-200 hover:bg-purple-200 gap-2"
                >
                  <UserGroupIcon className="w-4 h-4" />
                  Create Group
                </button>
              )}
                <button
                onClick={onClose}
                className="btn btn-ghost btn-sm btn-circle text-gray-500 hover:bg-gray-100"
                title="Close Messages"
              >
                <XMarkIcon className="w-5 h-5" />
                </button>
            </div>
          </div>
        </div>

        {/* Tabs - WhatsApp Style */}
        <div className="flex border-b border-gray-200">
          <button
            onClick={() => setActiveTab('chats')}
            className={`flex-1 py-3 px-4 font-medium text-sm transition-colors ${
              activeTab === 'chats'
                ? 'text-purple-600 border-b-2 border-purple-600 bg-purple-50'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
            }`}
          >
            Chats
            {conversations.reduce((total, conv) => total + (conv.unread_count || 0), 0) > 0 && (
              <span className="ml-2 bg-purple-500 text-white text-xs rounded-full px-2 py-1">
                {conversations.reduce((total, conv) => total + (conv.unread_count || 0), 0)}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('contacts')}
            className={`flex-1 py-3 px-4 font-medium text-sm transition-colors ${
              activeTab === 'contacts'
                ? 'text-purple-600 border-b-2 border-purple-600 bg-purple-50'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
            }`}
          >
            Contacts
            <span className="ml-2 text-xs text-gray-400">
              {allUsers.length}
            </span>
          </button>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-gray-100">
          <div className="relative">
            <MagnifyingGlassIcon className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder={activeTab === 'chats' ? 'Search conversations...' : 'Search contacts...'}
              className="input input-bordered w-full pl-10 input-sm"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === 'chats' ? (
            // Conversations List
            filteredConversations.length === 0 ? (
              <div className="p-6 text-center text-gray-500">
                <ChatBubbleLeftRightIcon className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="font-medium">No conversations yet</p>
                <p className="text-sm">Click on a contact to start chatting</p>
              </div>
            ) : (
              filteredConversations.map((conversation) => (
                <div
                  key={conversation.id}
                  onClick={() => {
                    setSelectedConversation(conversation);
                    fetchMessages(conversation.id);
                    setShowMobileConversations(false);
                  }}
                  className={`p-4 border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors ${
                    selectedConversation?.id === conversation.id ? 'bg-purple-50 border-l-4 border-purple-500' : ''
                  }`}
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
                            <div className="w-5 h-5 bg-purple-500 text-white rounded-full flex items-center justify-center text-xs font-bold">
                              {conversation.unread_count}
                            </div>
                          )}
                        </div>
                      </div>
                      <p className="text-sm text-gray-600 truncate mt-1">
                        {conversation.last_message_preview || 'No messages yet'}
                      </p>
                      {conversation.type === 'group' && (
                        <p className="text-xs text-gray-400 mt-1">
                          {conversation.participants?.length || 0} members
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )
          ) : (
            // Contacts List
            filteredUsers.length === 0 ? (
              <div className="p-6 text-center text-gray-500">
                <UserIcon className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="font-medium">No contacts found</p>
                <p className="text-sm">Try adjusting your search</p>
              </div>
            ) : (
              filteredUsers.map((user) => {
                // More robust name handling
                const rawDisplayName = user.tenants_employee?.display_name || user.full_name;
                const userName = (rawDisplayName && rawDisplayName.trim().length > 1) 
                  ? rawDisplayName.trim() 
                  : `User ${user.id.slice(-4)}`;
                
                const rawRole = getRoleDisplayName(user.tenants_employee?.bonuses_role || '');
                const userRole = rawRole && rawRole.trim().length > 0 ? rawRole.trim() : 'Employee';
                const userDept = user.tenants_employee?.tenant_departement?.name || '';
                const userPhoto = user.tenants_employee?.photo_url;
                const hasCompleteInfo = user.tenants_employee && user.tenants_employee.display_name;

                // Debug logging to help identify the issue
                console.log('🔍 Contact rendering:', {
                  userId: user.id,
                  userName: userName,
                  userRole: userRole,
                  userDept: userDept,
                  hasEmployee: !!user.tenants_employee,
                  displayName: user.tenants_employee?.display_name,
                  fullName: user.full_name,
                  hasPhoto: !!userPhoto,
                  initials: getInitials(userName)
                });

                return (
                  <div
                    key={user.id}
                    onClick={() => startDirectConversation(user.id)}
                    className="p-4 border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {userPhoto && userPhoto.trim() !== '' ? (
                        <div className="w-12 h-12 rounded-full border-2 border-gray-200 overflow-hidden">
                          <img
                            src={userPhoto}
                            alt={userName}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              // Replace with colored circle if image fails to load
                              const target = e.target as HTMLImageElement;
                              const container = target.parentElement;
                              if (container) {
                                container.innerHTML = `
                                  <div class="w-full h-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white font-bold text-sm">
                                    ${getInitials(userName)}
                                  </div>
                                `;
                              }
                            }}
                          />
                        </div>
                      ) : (
                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white font-bold text-sm border-2 border-gray-200">
                          {getInitials(userName)}
                        </div>
                      )}
                      
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-gray-900 truncate">
                          {userName || `User ${user.id.slice(-4)}`}
                          {!hasCompleteInfo && (
                            <span className="ml-2 text-xs text-orange-500 bg-orange-100 px-2 py-1 rounded-full">
                              Incomplete Profile
                            </span>
                          )}
                        </div>
                        <div className="text-sm text-gray-500 truncate">
                          {userRole} {userDept && `• ${userDept}`}
                          {!hasCompleteInfo && !user.tenants_employee?.bonuses_role && !user.tenants_employee?.tenant_departement?.name && (
                            <span className="text-orange-500">Profile setup needed</span>
                          )}
                        </div>
                      </div>
                      
                      <div className="text-gray-400">
                        <ChatBubbleLeftRightIcon className="w-5 h-5" />
                      </div>
                    </div>
                  </div>
                );
              })
            )
          )}
        </div>
      </div>

      {/* Mobile Sidebar */}
      <div className={`lg:hidden ${showMobileConversations ? 'block' : 'hidden'} w-full bg-white flex flex-col`}>
        {/* Mobile Header */}
        <div className="p-4 border-b border-gray-200 bg-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center">
                <ChatBubbleLeftRightIcon className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-gray-900">Messages</h1>
                <p className="text-gray-500 text-xs">Internal Communications</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {activeTab === 'contacts' && (
                <button
                  onClick={() => setShowCreateGroupModal(true)}
                  className="btn btn-sm bg-purple-100 text-purple-700 border-purple-200 hover:bg-purple-200"
                  title="Create Group"
                >
                  <UserGroupIcon className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Mobile Tabs */}
        <div className="flex border-b border-gray-200">
          <button
            onClick={() => setActiveTab('chats')}
            className={`flex-1 py-3 px-4 font-medium text-sm transition-colors ${
              activeTab === 'chats'
                ? 'text-purple-600 border-b-2 border-purple-600 bg-purple-50'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
            }`}
          >
            Chats
            {conversations.reduce((total, conv) => total + (conv.unread_count || 0), 0) > 0 && (
              <span className="ml-2 bg-purple-500 text-white text-xs rounded-full px-2 py-1">
                {conversations.reduce((total, conv) => total + (conv.unread_count || 0), 0)}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('contacts')}
            className={`flex-1 py-3 px-4 font-medium text-sm transition-colors ${
              activeTab === 'contacts'
                ? 'text-purple-600 border-b-2 border-purple-600 bg-purple-50'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
            }`}
          >
            Contacts
            <span className="ml-2 text-xs text-gray-400">
              {allUsers.length}
            </span>
          </button>
        </div>

        {/* Mobile Search */}
        <div className="p-4 border-b border-gray-100">
          <div className="relative">
            <MagnifyingGlassIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder={activeTab === 'chats' ? 'Search conversations...' : 'Search contacts...'}
              className="input input-bordered w-full pl-9 input-sm"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Mobile Content */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === 'chats' ? (
            // Mobile Conversations
            filteredConversations.length === 0 ? (
              <div className="p-6 text-center text-gray-500">
                <ChatBubbleLeftRightIcon className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="font-medium">No conversations yet</p>
                <p className="text-sm">Click on a contact to start chatting</p>
              </div>
            ) : (
              filteredConversations.map((conversation) => (
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
                            <div className="w-5 h-5 bg-purple-500 text-white rounded-full flex items-center justify-center text-xs font-bold">
                              {conversation.unread_count}
                            </div>
                          )}
                        </div>
                      </div>
                      <p className="text-sm text-gray-600 truncate mt-1">
                        {conversation.last_message_preview || 'No messages yet'}
                      </p>
                    </div>
                  </div>
                </div>
              ))
            )
          ) : (
            // Mobile Contacts
            filteredUsers.length === 0 ? (
              <div className="p-6 text-center text-gray-500">
                <UserIcon className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="font-medium">No contacts found</p>
                <p className="text-sm">Try adjusting your search</p>
              </div>
            ) : (
              filteredUsers.map((user) => {
                // More robust name handling
                const rawDisplayName = user.tenants_employee?.display_name || user.full_name;
                const userName = (rawDisplayName && rawDisplayName.trim().length > 1) 
                  ? rawDisplayName.trim() 
                  : `User ${user.id.slice(-4)}`;
                
                const rawRole = getRoleDisplayName(user.tenants_employee?.bonuses_role || '');
                const userRole = rawRole && rawRole.trim().length > 0 ? rawRole.trim() : 'Employee';
                const userDept = user.tenants_employee?.tenant_departement?.name || '';
                const userPhoto = user.tenants_employee?.photo_url;
                const hasCompleteInfo = user.tenants_employee && user.tenants_employee.display_name;

                return (
                  <div
                    key={user.id}
                    onClick={() => startDirectConversation(user.id)}
                    className="p-4 border-b border-gray-100 cursor-pointer hover:bg-gray-50 active:bg-gray-100"
                  >
                    <div className="flex items-center gap-3">
                      {userPhoto && userPhoto.trim() !== '' ? (
                        <div className="w-12 h-12 rounded-full border-2 border-gray-200 overflow-hidden">
                          <img
                            src={userPhoto}
                            alt={userName}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              // Replace with colored circle if image fails to load
                              const target = e.target as HTMLImageElement;
                              const container = target.parentElement;
                              if (container) {
                                container.innerHTML = `
                                  <div class="w-full h-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white font-bold text-sm">
                                    ${getInitials(userName)}
                                  </div>
                                `;
                              }
                            }}
                          />
                        </div>
                      ) : (
                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white font-bold text-sm border-2 border-gray-200">
                          {getInitials(userName)}
                        </div>
                      )}
                      
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-gray-900 truncate">
                          {userName || `User ${user.id.slice(-4)}`}
                          {!hasCompleteInfo && (
                            <span className="ml-1 text-xs text-orange-500 bg-orange-100 px-1 py-0.5 rounded">
                              Incomplete
                            </span>
                          )}
                        </div>
                        <div className="text-sm text-gray-500 truncate">
                          {userRole} {userDept && `• ${userDept}`}
                          {!hasCompleteInfo && !user.tenants_employee?.bonuses_role && !user.tenants_employee?.tenant_departement?.name && (
                            <span className="text-orange-500">Setup needed</span>
                          )}
                        </div>
                      </div>
                      
                      <div className="text-gray-400">
                        <ChatBubbleLeftRightIcon className="w-5 h-5" />
                      </div>
                    </div>
                  </div>
                );
              })
            )
          )}
        </div>
      </div>

      {/* Chat Area - Desktop Only */}
      <div className="hidden lg:flex flex-1 flex-col bg-white">
        {selectedConversation ? (
          <>
            {/* Chat Header */}
            <div className="p-4 border-b border-gray-200 bg-white shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setShowMobileConversations(true)}
                    className="lg:hidden btn btn-ghost btn-sm btn-circle"
                  >
                    <ArrowLeftIcon className="w-5 h-5" />
                  </button>
                  {getConversationAvatar(selectedConversation)}
                  <div>
                    <h2 className="font-semibold text-gray-900">
                      {getConversationTitle(selectedConversation)}
                    </h2>
                    <p className="text-sm text-gray-500">
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
                <button 
                  onClick={onClose}
                  className="btn btn-ghost btn-sm btn-circle text-gray-500 hover:bg-gray-100"
                  title="Close Messages"
                >
                  <XMarkIcon className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Messages Area */}
            <div 
              ref={messagesContainerRef}
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto p-4 space-y-4 bg-white"
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
                    <div key={message.id}>
                      {/* Date Separator */}
                      {showDateSeparator && (
                        <div className="flex items-center justify-center my-4">
                          <div className="bg-gray-100 text-gray-600 px-3 py-1 rounded-full text-sm font-medium border-b border-gray-300">
                            {formatDateSeparator(message.sent_at)}
                          </div>
                        </div>
                      )}
                      
                      <div
                        className={`flex gap-3 group ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}
                      >
                      
                      <div className={`max-w-xs sm:max-w-md ${isOwn ? 'items-end' : 'items-start'} flex flex-col`}>
                        {!isOwn && selectedConversation.type !== 'direct' && (
                          <span className="text-xs text-gray-500 mb-1 px-3">
                            {senderName}
                          </span>
                        )}
                        
                        <div className={`flex items-end gap-2 ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}>
                          <div
                            data-message-id={message.id}
                            onClick={() => {
                              setShowReactionPicker(showReactionPicker === message.id ? null : message.id);
                              setReactingMessageId(message.id);
                            }}
                            className={`px-4 py-3 rounded-2xl shadow-sm cursor-pointer hover:shadow-md transition-shadow ${
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
                                  <button
                                    onClick={() => playVoiceMessage(message.id)}
                                    className={`p-2 rounded-full transition-all ${
                                      isOwn ? 'bg-white/20 text-white hover:bg-white/30' : 'bg-purple-100 text-purple-600 hover:bg-purple-200'
                                    }`}
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
                                      <div className={`flex-1 h-2 rounded-full ${
                                        isOwn ? 'bg-white/30' : 'bg-gray-200'
                                      }`}>
                                        <div 
                                          className={`h-full rounded-full transition-all duration-100 ${
                                            isOwn ? 'bg-white' : 'bg-purple-500'
                                          }`}
                                          style={{ width: `${voiceProgress[message.id] || 0}%` }}
                                        ></div>
                                      </div>
                                      <span className={`text-sm font-mono ${
                                        isOwn ? 'text-white/80' : 'text-gray-600'
                                      }`}>
                                        {message.voice_duration ? `${message.voice_duration}s` : '0s'}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              ) : message.message_type === 'image' ? (
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
                        
                        <span className={`text-xs text-gray-400 mt-1 px-2 ${isOwn ? 'text-right' : 'text-left'}`}>
                          {formatMessageTime(message.sent_at)}
                        </span>
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
                    className="bg-blue-500 hover:bg-blue-600 text-white rounded-full p-3 shadow-lg transition-colors"
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
            <div className="hidden lg:block p-4 border-t border-gray-200 bg-white">
              <div className="flex items-end gap-3 relative">
                <button
                  onClick={() => setIsLeadSearchOpen(!isLeadSearchOpen)}
                  className="btn btn-ghost btn-circle btn-sm text-gray-500 hover:text-green-600"
                  title="Attach Lead"
                >
                  <PlusIcon className="w-5 h-5" />
                </button>
                
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploadingFile || isSending}
                  className="btn btn-ghost btn-circle btn-sm text-gray-500 hover:text-purple-600 disabled:opacity-50"
                  title={isUploadingFile ? 'Uploading file...' : 'Attach file'}
                >
                  {isUploadingFile ? (
                    <div className="loading loading-spinner loading-sm"></div>
                  ) : (
                    <PaperClipIcon className="w-5 h-5" />
                  )}
                </button>
                
                <div className="relative">
                <button
                  onClick={() => setIsEmojiPickerOpen(!isEmojiPickerOpen)}
                  disabled={isSending}
                  className="btn btn-ghost btn-circle btn-sm text-gray-500 hover:text-purple-600 disabled:opacity-50"
                  title="Add emoji"
                >
                  <FaceSmileIcon className="w-5 h-5" />
                </button>
                
                {/* Voice Recording Button */}
                {!isRecording ? (
                  <button
                    onClick={startVoiceRecording}
                    disabled={isSending}
                    className="btn btn-ghost btn-circle btn-sm text-gray-500 hover:text-red-600 disabled:opacity-50"
                    title="Record voice message"
                  >
                    <MicrophoneIcon className="w-5 h-5" />
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
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
                    onKeyPress={handleKeyPress}
                    placeholder="Type a message..."
                    className="textarea textarea-bordered w-full resize-none min-h-[44px] max-h-32"
                    rows={1}
                    disabled={isSending}
                  />
                </div>
                
                <button
                  onClick={sendMessage}
                  disabled={!newMessage.trim() || isSending}
                  className="btn btn-primary btn-circle"
                >
                  {isSending ? (
                    <div className="loading loading-spinner loading-sm"></div>
                  ) : (
                    <PaperAirplaneIcon className="w-5 h-5" />
                  )}
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center bg-white">
            <div className="text-center">
              <div className="w-24 h-24 bg-gradient-to-br from-purple-100 to-blue-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <ChatBubbleLeftRightIcon className="w-12 h-12 text-purple-500" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">Welcome to RMQ Messages</h3>
              <p className="text-gray-600 mb-6 max-w-md">
                Click on the <span className="font-semibold text-purple-600">Contacts</span> tab to view all employees and start a conversation, or select an existing chat from your conversations.
              </p>
              <div className="flex items-center justify-center gap-4 text-sm text-gray-500">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-purple-500 rounded-full"></div>
                  <span>Chats: {conversations.length}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                  <span>Contacts: {allUsers.length}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Mobile Full Screen Chat */}
      <div className={`lg:hidden ${!showMobileConversations && selectedConversation ? 'flex' : 'hidden'} flex-col w-full bg-white`}>
        {selectedConversation && (
          <>
            {/* Mobile Chat Header */}
            <div className="p-4 border-b border-gray-200 bg-white">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setShowMobileConversations(true)}
                  className="btn btn-ghost btn-sm btn-circle text-gray-500 hover:bg-gray-100"
                >
                  <ArrowLeftIcon className="w-5 h-5" />
                </button>
                {getConversationAvatar(selectedConversation)}
                <div className="flex-1 min-w-0">
                  <h2 className="font-semibold text-gray-900 truncate">
                    {getConversationTitle(selectedConversation)}
                  </h2>
                  <p className="text-sm text-gray-500">
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
                <button 
                  onClick={onClose}
                  className="btn btn-ghost btn-sm btn-circle text-gray-500 hover:bg-gray-100"
                  title="Close Messages"
                >
                  <XMarkIcon className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Mobile Messages */}
            <div 
              ref={messagesContainerRef}
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto p-4 space-y-4 bg-white"
            >
              {messages.map((message, index) => {
                  const isOwn = message.sender_id === currentUser?.id;
                  const senderName = message.sender?.tenants_employee?.display_name || 
                                   message.sender?.full_name || 
                                   'Unknown User';

                  // Check if we need to show a date separator
                  const showDateSeparator = index === 0 || 
                    !isSameDay(new Date(message.sent_at), new Date(messages[index - 1].sent_at));

                return (
                  <div key={message.id}>
                    {/* Date Separator */}
                    {showDateSeparator && (
                      <div className="flex items-center justify-center my-4">
                        <div className="bg-gray-100 text-gray-600 px-3 py-1 rounded-full text-sm font-medium border-b border-gray-300">
                          {formatDateSeparator(message.sent_at)}
                        </div>
                      </div>
                    )}
                    
                    <div
                      className={`flex gap-2 group ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}
                    >
                    
                    <div className={`max-w-[75%] ${isOwn ? 'items-end' : 'items-start'} flex flex-col`}>
                      <div className={`flex items-end gap-2 ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}>
                        <div
                          data-message-id={message.id}
                          onClick={() => {
                            setShowReactionPicker(showReactionPicker === message.id ? null : message.id);
                            setReactingMessageId(message.id);
                          }}
                          className={`px-4 py-3 rounded-2xl text-base cursor-pointer hover:shadow-md transition-shadow ${
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
                                <button
                                  onClick={() => playVoiceMessage(message.id)}
                                  className={`p-2 rounded-full transition-all ${
                                    isOwn ? 'bg-white/20 text-white hover:bg-white/30' : 'bg-purple-100 text-purple-600 hover:bg-purple-200'
                                  }`}
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
                                    <div className={`flex-1 h-2 rounded-full ${
                                      isOwn ? 'bg-white/30' : 'bg-gray-200'
                                    }`}>
                                      <div 
                                        className={`h-full rounded-full transition-all duration-100 ${
                                          isOwn ? 'bg-white' : 'bg-purple-500'
                                        }`}
                                        style={{ width: `${voiceProgress[message.id] || 0}%` }}
                                      ></div>
                                    </div>
                                    <span className={`text-xs font-mono ${
                                      isOwn ? 'text-white/80' : 'text-gray-600'
                                    }`}>
                                      {message.voice_duration ? `${message.voice_duration}s` : '0s'}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            ) : message.message_type === 'image' ? (
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
                      
                      <span className="text-xs text-gray-400 mt-1 px-2">
                        {formatMessageTime(message.sent_at)}
                      </span>
                    </div>
                    </div>
                  </div>
                );
              })}
              
              {/* Mobile Typing indicators removed */}
              
              <div ref={messagesEndRef} />
            </div>

            {/* Mobile Message Input - Mobile Only */}
            <div className="lg:hidden p-3 border-t border-gray-200 bg-white">
              <div className="flex items-center gap-2 relative">
                <button
                  onClick={() => setIsLeadSearchOpen(!isLeadSearchOpen)}
                  className="btn btn-ghost btn-circle btn-sm text-gray-500 hover:text-green-600"
                  title="Attach Lead"
                >
                  <PlusIcon className="w-5 h-5" />
                </button>
                
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploadingFile || isSending}
                  className="btn btn-ghost btn-circle btn-sm text-gray-500 disabled:opacity-50"
                  title={isUploadingFile ? 'Uploading file...' : 'Attach file'}
                >
                  {isUploadingFile ? (
                    <div className="loading loading-spinner loading-sm"></div>
                  ) : (
                    <PaperClipIcon className="w-5 h-5" />
                  )}
                </button>
                
                <div className="relative">
                  <button
                    onClick={() => setIsEmojiPickerOpen(!isEmojiPickerOpen)}
                    disabled={isSending}
                    className="btn btn-circle btn-sm bg-white border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                    title="Add emoji"
                  >
                    <FaceSmileIcon className="w-5 h-5" />
                  </button>
                  
                  {/* Mobile Voice Recording Button */}
                  {!isRecording ? (
                    <button
                      onClick={startVoiceRecording}
                      disabled={isSending}
                      className="btn btn-circle btn-sm bg-white border border-gray-200 text-gray-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                      title="Record voice message"
                    >
                      <MicrophoneIcon className="w-5 h-5" />
                    </button>
                  ) : (
                    <div className="flex items-center gap-1">
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
                      <span className="text-xs text-red-600 font-mono min-w-[30px]">
                        {formatRecordingDuration(recordingDuration)}
                      </span>
                    </div>
                  )}
                  
                  
                  {/* Mobile Emoji Picker */}
                  {isEmojiPickerOpen && (
                    <div className="absolute bottom-12 left-0 z-50">
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
                    <div className="absolute bottom-12 left-0 z-50 bg-white border border-gray-200 rounded-lg shadow-lg w-72 max-h-80 overflow-hidden lead-search-dropdown">
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
                
                <div className="flex-1">
                  <textarea
                    value={newMessage}
                    onChange={handleMessageInputChange}
                    onKeyPress={handleKeyPress}
                    placeholder="Type a message..."
                    className="textarea textarea-bordered w-full resize-none text-sm min-h-[36px] max-h-20"
                    rows={1}
                    disabled={isSending}
                  />
                </div>
                
                <button
                  onClick={sendMessage}
                  disabled={!newMessage.trim() || isSending}
                  className="btn btn-primary btn-circle btn-sm"
                >
                  <PaperAirplaneIcon className="w-5 h-5" />
                </button>
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
                        className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all ${
                          isSelected 
                            ? 'bg-purple-50 border-2 border-purple-200' 
                            : 'hover:bg-gray-50 border-2 border-transparent'
                        }`}
                      >
                        <div className="relative">
                          {userPhoto && userPhoto.trim() !== '' ? (
                            <img
                              src={userPhoto}
                              alt={userName}
                              className="w-10 h-10 rounded-full object-cover"
                              onError={(e) => {
                                // Replace with colored circle if image fails to load
                                const target = e.target as HTMLImageElement;
                                const parent = target.parentElement;
                                if (parent) {
                                  parent.innerHTML = `
                                    <div class="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white font-bold text-sm">
                                      ${getInitials(userName)}
                                    </div>
                                  `;
                                }
                              }}
                            />
                          ) : (
                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white font-bold text-sm">
                              {getInitials(userName)}
                            </div>
                          )}
                          {isSelected && (
                            <div className="absolute -top-1 -right-1 w-5 h-5 bg-purple-500 rounded-full flex items-center justify-center">
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
