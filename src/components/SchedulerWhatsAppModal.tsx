import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { XMarkIcon, PaperAirplaneIcon, FaceSmileIcon, PaperClipIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { FaWhatsapp } from 'react-icons/fa';
import EmojiPicker from 'emoji-picker-react';
import { toast } from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import { buildApiUrl } from '../lib/api';

interface SchedulerWhatsAppModalProps {
  isOpen: boolean;
  onClose: () => void;
  client?: {
    id: string;
    name: string;
    lead_number: string;
    phone?: string;
    mobile?: string;
    lead_type?: string;
  };
  onClientUpdate?: () => Promise<void>;
}

const SchedulerWhatsAppModal: React.FC<SchedulerWhatsAppModalProps> = ({ isOpen, onClose, client, onClientUpdate }) => {
  const [whatsAppInput, setWhatsAppInput] = useState("");
  const [whatsAppMessages, setWhatsAppMessages] = useState<any[]>([]);
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);
  const [whatsAppError, setWhatsAppError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [whatsAppMessages]);

  // Fetch WhatsApp messages from DB when modal opens or client changes
  useEffect(() => {
    async function fetchWhatsAppMessages() {
      if (!client?.id) return;
      
      const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
      let query = supabase.from('whatsapp_messages').select('*');
      
      if (isLegacyLead) {
        const legacyId = parseInt(client.id.replace('legacy_', ''));
        query = query.eq('legacy_id', legacyId);
      } else {
        query = query.eq('lead_id', client.id);
      }
      
      const { data, error } = await query.order('sent_at', { ascending: true });
      if (!error && data) {
        console.log('📱 WhatsApp messages fetched:', data);
        console.log('📱 Message details:', data.map(msg => ({
          id: msg.id,
          message: msg.message,
          message_type: msg.message_type,
          media_url: msg.media_url,
          direction: msg.direction,
          sent_at: msg.sent_at
        })));
        setWhatsAppMessages(data);
      } else {
        console.error('❌ Error fetching WhatsApp messages:', error);
        setWhatsAppMessages([]);
      }
    }
    if (isOpen) {
      fetchWhatsAppMessages();
    }
  }, [isOpen, client?.id]);

  // Periodically check status of pending messages
  useEffect(() => {
    if (!isOpen || !client?.id) return;

    const interval = setInterval(async () => {
      // Check if there are any pending messages
      const hasPendingMessages = whatsAppMessages.some(msg => msg.whatsapp_status === 'pending');
      
      if (hasPendingMessages) {
        // Refetch messages to get updated statuses
        const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
        let query = supabase.from('whatsapp_messages').select('*');
        
        if (isLegacyLead) {
          const legacyId = parseInt(client.id.replace('legacy_', ''));
          query = query.eq('legacy_id', legacyId);
        } else {
          query = query.eq('lead_id', client.id);
        }
        
        const { data, error } = await query.order('sent_at', { ascending: true });
        if (!error && data) {
          setWhatsAppMessages(data);
        }
      }
    }, 3000); // Check every 3 seconds

    return () => clearInterval(interval);
  }, [isOpen, client?.id, whatsAppMessages]);

  const isEmojiOnly = (text: string): boolean => {
    const emojiRegex = /^[\p{Emoji}\s]+$/u;
    return emojiRegex.test(text.trim());
  };

  const renderMessageStatus = (status?: string, errorMessage?: string) => {
    if (errorMessage) {
      return (
        <div className="flex items-center gap-1 text-red-500">
          <ExclamationTriangleIcon className="w-3 h-3" />
          <span className="text-xs">Failed</span>
        </div>
      );
    }
    
    switch (status) {
      case 'sent':
        return <span className="text-xs text-gray-400">✓</span>;
      case 'delivered':
        return <span className="text-xs text-gray-400">✓✓</span>;
      case 'read':
        return <span className="text-xs text-blue-500">✓✓</span>;
      case 'pending':
        return <span className="text-xs text-yellow-500">⏳</span>;
      default:
        return <span className="text-xs text-gray-400">✓</span>;
    }
  };

  const handleSendWhatsApp = async () => {
    if (!whatsAppInput.trim()) {
      toast.error('Please enter a message');
      return;
    }

    if (!client?.phone && !client?.mobile) {
      toast.error('No phone number available for this client');
      return;
    }

    setIsLoading(true);
    setWhatsAppError(null);

    try {
      const phoneNumber = client.phone || client.mobile;
      const messageData = {
        to: phoneNumber,
        message: whatsAppInput.trim(),
        clientId: client.id,
        leadNumber: client.lead_number,
        clientName: client.name,
        attachments: selectedFile ? [selectedFile.name] : []
      };

      const response = await fetch(`${buildApiUrl('')}/whatsapp/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(messageData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to send WhatsApp message');
      }

      const result = await response.json();
      
      if (result.success) {
        toast.success('WhatsApp message sent successfully!');
        setWhatsAppInput('');
        setSelectedFile(null);
        
        // Add the message to local state immediately
        const newMessage = {
          id: Date.now(),
          content: whatsAppInput.trim(),
          direction: 'out',
          sent_at: new Date().toISOString(),
          whatsapp_status: 'pending',
          sender_name: 'You',
          recipient: phoneNumber,
        };

        setWhatsAppMessages(prev => [...prev, newMessage]);
        
        // Refresh messages from server
        if (onClientUpdate) {
          await onClientUpdate();
        }
      } else {
        throw new Error(result.error || 'Failed to send WhatsApp message');
      }
    } catch (error) {
      console.error('Error sending WhatsApp message:', error);
      setWhatsAppError(error instanceof Error ? error.message : 'Failed to send WhatsApp message');
      toast.error('Failed to send WhatsApp message');
    } finally {
      setIsLoading(false);
    }
  };

  const handleEmojiClick = (emojiData: any) => {
    setWhatsAppInput(prev => prev + emojiData.emoji);
    setIsEmojiPickerOpen(false);
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 bg-white z-[9999]">
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 md:p-6 border-b border-gray-200">
          <div className="flex items-center gap-2 md:gap-4 min-w-0 flex-1">
            <FaWhatsapp className="w-6 h-6 md:w-8 md:h-8 text-green-600 flex-shrink-0" />
            <h2 className="text-lg md:text-2xl font-bold text-gray-900">WhatsApp</h2>
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse flex-shrink-0"></div>
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm md:text-lg font-semibold text-gray-900 truncate">
                  {client?.name}
                </span>
                <span className="text-xs md:text-sm text-gray-500 font-mono flex-shrink-0">
                  ({client?.lead_number})
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="btn btn-ghost btn-circle flex-shrink-0"
          >
            <XMarkIcon className="w-5 h-5 md:w-6 md:h-6" />
          </button>
        </div>

        {/* Messages - Scrollable */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {whatsAppMessages.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <FaWhatsapp className="w-12 h-12 mx-auto mb-4 text-gray-300" />
              <p className="text-lg font-medium">No messages yet</p>
              <p className="text-sm">Start the conversation with {client?.name}</p>
            </div>
          ) : (
            whatsAppMessages.map((message, index) => {
              const isOutgoing = message.direction === 'out' || message.direction === 'outgoing';
              const messageContent = message.message || message.content || message.text || '';
              const messageTime = message.sent_at || message.timestamp || message.date;
              
              // Debug logging for image messages
              if (messageContent.toLowerCase().includes('image') || message.message_type === 'image') {
                console.log('🖼️ Image message detected:', {
                  id: message.id,
                  message_type: message.message_type,
                  media_url: message.media_url,
                  message: messageContent,
                  hasMediaUrl: !!message.media_url
                });
              }
              
              return (
                <div
                  key={message.id || index}
                  className={`flex flex-col ${isOutgoing ? 'items-end' : 'items-start'}`}
                >
                  {isOutgoing && (
                    <span className="text-xs text-gray-500 mb-1 mr-2">
                      {message.sender_name || 'You'}
                    </span>
                  )}
                  {!isOutgoing && (
                    <span className="text-xs text-gray-500 mb-1 ml-2">
                      {message.sender_name || client?.name}
                    </span>
                  )}
                  
                  <div
                    className={`max-w-[85%] md:max-w-[70%] rounded-2xl px-4 py-2 shadow-sm ${
                      isOutgoing
                        ? isEmojiOnly(messageContent)
                          ? 'bg-white text-gray-900'
                          : 'bg-green-600 text-white'
                        : 'bg-white text-gray-900 border border-gray-200'
                    }`}
                  >
                    {/* Message content based on type */}
                    {message.message_type === 'text' && messageContent && !message.media_url && (
                      <p className={`break-words ${
                        isEmojiOnly(messageContent) ? 'text-6xl leading-tight' : 'text-base'
                      }`}>
                        {messageContent}
                      </p>
                    )}
                    
                    {/* Image messages - check both message_type and media_url */}
                    {(message.message_type === 'image' || message.media_url) && (
                      <div>
                        {message.media_url && (
                          <div className="relative inline-block">
                            <img
                              src={message.media_url.startsWith('http') ? message.media_url : buildApiUrl(`/api/whatsapp/media/${message.media_url}`)}
                              alt="WhatsApp image"
                              className="max-w-[500px] max-h-[500px] object-cover rounded-lg cursor-pointer"
                              onClick={() => {
                                const url = message.media_url.startsWith('http') ? message.media_url : buildApiUrl(`/api/whatsapp/media/${message.media_url}`);
                                window.open(url, '_blank');
                              }}
                              onError={(e) => {
                                console.error('🖼️ Image failed to load:', message.media_url);
                                e.currentTarget.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgdmlld0JveD0iMCAwIDIwMCAyMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIyMDAiIGhlaWdodD0iMjAwIiBmaWxsPSIjRjNGNEY2Ii8+CjxwYXRoIGQ9Ik01MCAxMDAgTDEwMCA1MCBMMTUwIDEwMCBMMTAwIDE1MCBMNTAgMTAwWiIgZmlsbD0iI0QxRDVEMCIvPgo8dGV4dCB4PSIxMDAiIHk9IjExMCIgZm9udC1mYW1pbHk9IkFyaWFsIiBmb250LXNpemU9IjE0IiBmaWxsPSIjNjc3NDhCIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj5JbWFnZSBVbmF2YWlsYWJsZTwvdGV4dD4KPC9zdmc+';
                                e.currentTarget.style.border = '1px solid #e5e7eb';
                                e.currentTarget.style.borderRadius = '0.5rem';
                              }}
                            />
                            {messageContent && messageContent !== 'WhatsApp image' && (
                              <p className="mt-2 text-sm break-words">{messageContent}</p>
                            )}
                          </div>
                        )}
                        {/* Show text if no media_url but message_type is image */}
                        {!message.media_url && message.message_type === 'image' && messageContent && (
                          <p className="text-base break-words text-red-500">
                            {messageContent} (Image not available)
                          </p>
                        )}
                      </div>
                    )}
                    
                    {message.message_type === 'video' && (
                      <div>
                        {message.media_url && (
                          <video
                            src={message.media_url.startsWith('http') ? message.media_url : buildApiUrl(`/api/whatsapp/media/${message.media_url}`)}
                            controls
                            className="max-w-[500px] max-h-[500px] object-cover rounded-lg"
                            onError={(e) => {
                              console.error('🎥 Video failed to load:', message.media_url);
                              e.currentTarget.style.display = 'none';
                            }}
                          />
                        )}
                        {messageContent && (
                          <p className="mt-2 text-sm break-words">{messageContent}</p>
                        )}
                      </div>
                    )}
                    
                    {message.message_type === 'audio' && (
                      <div>
                        {message.media_url && (
                          <audio
                            src={message.media_url.startsWith('http') ? message.media_url : buildApiUrl(`/api/whatsapp/media/${message.media_url}`)}
                            controls
                            className="w-full"
                            onError={(e) => {
                              console.error('🎵 Audio failed to load:', message.media_url);
                              e.currentTarget.style.display = 'none';
                            }}
                          />
                        )}
                        {messageContent && (
                          <p className="mt-2 text-sm break-words">{messageContent}</p>
                        )}
                      </div>
                    )}
                    
                    {message.message_type === 'document' && (
                      <div className="flex items-center gap-2 p-2 bg-gray-100 rounded">
                        <div className="w-8 h-8 bg-blue-500 rounded flex items-center justify-center">
                          <span className="text-white text-xs font-bold">DOC</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{message.file_name || 'Document'}</p>
                          <p className="text-xs text-gray-500">{message.file_size || ''}</p>
                        </div>
                        {message.media_url && (
                          <a
                            href={message.media_url.startsWith('http') ? message.media_url : buildApiUrl(`/api/whatsapp/media/${message.media_url}`)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-500 hover:text-blue-700"
                          >
                            Download
                          </a>
                        )}
                      </div>
                    )}
                    
                    {/* Fallback for messages without message_type */}
                    {!message.message_type && messageContent && !message.media_url && (
                      <p className="text-base break-words">{messageContent}</p>
                    )}
                    
                    {/* Debug info for messages with media but no proper type */}
                    {message.media_url && !message.message_type && (
                      <div className="text-xs text-gray-500 p-2 bg-yellow-100 rounded">
                        Debug: Media URL found but no message_type set: {message.media_url}
                      </div>
                    )}
                    
                    {/* Message status and time */}
                    <div className="flex items-center gap-1 mt-1 text-xs opacity-70 justify-end">
                      <span>
                        {messageTime ? new Date(messageTime).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit'
                        }) : 'No time'}
                      </span>
                      {isOutgoing && (
                        <span className="inline-block align-middle text-current">
                          {renderMessageStatus(message.whatsapp_status, message.error_message)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="border-t border-gray-200 p-4 bg-gray-50">
          {whatsAppError && (
            <div className="mb-3 p-2 bg-red-100 border border-red-300 rounded text-red-700 text-sm">
              {whatsAppError}
            </div>
          )}
          
          <div className="flex items-end gap-2">
            <div className="flex-1 relative">
              <textarea
                value={whatsAppInput}
                onChange={(e) => setWhatsAppInput(e.target.value)}
                placeholder="Type a message..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-green-500"
                rows={1}
                onKeyPress={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendWhatsApp();
                  }
                }}
              />
              
              {/* Emoji Picker */}
              {isEmojiPickerOpen && (
                <div className="absolute bottom-full right-0 mb-2 emoji-picker-container">
                  <EmojiPicker onEmojiClick={handleEmojiClick} />
                </div>
              )}
            </div>
            
            <div className="flex items-center gap-1">
              <button
                onClick={() => setIsEmojiPickerOpen(!isEmojiPickerOpen)}
                className="btn btn-ghost btn-sm"
              >
                <FaceSmileIcon className="w-5 h-5" />
              </button>
              
              <label className="btn btn-ghost btn-sm cursor-pointer">
                <PaperClipIcon className="w-5 h-5" />
                <input
                  type="file"
                  onChange={handleFileSelect}
                  className="hidden"
                  accept="image/*,video/*,audio/*,.pdf,.doc,.docx"
                />
              </label>
              
              <button
                onClick={handleSendWhatsApp}
                disabled={isLoading || !whatsAppInput.trim()}
                className="btn btn-primary btn-sm"
              >
                {isLoading ? (
                  <div className="loading loading-spinner loading-xs"></div>
                ) : (
                  <PaperAirplaneIcon className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>
          
          {selectedFile && (
            <div className="mt-2 flex items-center gap-2 text-sm text-gray-600">
              <PaperClipIcon className="w-4 h-4" />
              <span>{selectedFile.name}</span>
              <button
                onClick={() => setSelectedFile(null)}
                className="text-red-500 hover:text-red-700"
              >
                ×
              </button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};

export default SchedulerWhatsAppModal;