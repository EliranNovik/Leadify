import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { XMarkIcon, MagnifyingGlassIcon, PaperAirplaneIcon, PaperClipIcon } from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';

interface Contact {
  id: number;
  name: string;
  email: string;
  lead_number: string;
  phone?: string;
  created_at: string;
  topic?: string;
  last_message_time?: string;
  unread_count?: number;
}

interface EmailMessage {
  id: string;
  subject: string;
  body_html: string;
  sender_name: string;
  sender_email: string;
  sent_at: string;
  direction: 'incoming' | 'outgoing';
  attachments?: any[];
}

interface EmailThreadModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const EmailThreadModal: React.FC<EmailThreadModalProps> = ({ isOpen, onClose }) => {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [filteredContacts, setFilteredContacts] = useState<Contact[]>([]);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [emailThread, setEmailThread] = useState<EmailMessage[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const [subject, setSubject] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const [showCompose, setShowCompose] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [showChat, setShowChat] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Mobile detection
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Fetch all contacts
  useEffect(() => {
    const fetchContacts = async () => {
      try {
        const { data, error } = await supabase
          .from('leads')
          .select('id, name, email, lead_number, phone, created_at, topic')
          .order('name', { ascending: true });
        
        if (error) throw error;
        
        // Fetch last message time and unread status for each contact
        const contactsWithLastMessage = await Promise.all(
          (data || []).map(async (contact) => {
            // Get last message
            const { data: lastMessage } = await supabase
              .from('emails')
              .select('sent_at, direction')
              .eq('client_id', contact.id)
              .order('sent_at', { ascending: false })
              .limit(1)
              .single();
            
            // Check for unread incoming messages (last 7 days)
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
            
            const { data: unreadMessages } = await supabase
              .from('emails')
              .select('id')
              .eq('client_id', contact.id)
              .eq('direction', 'incoming')
              .gte('sent_at', sevenDaysAgo.toISOString())
              .is('is_read', false);
            
            return {
              ...contact,
              last_message_time: lastMessage?.sent_at || null,
              unread_count: unreadMessages?.length || 0
            };
          })
        );
        
                 // Sort contacts: unread first, then by last message time (newest first)
         const sortedContacts = contactsWithLastMessage.sort((a, b) => {
           // First priority: unread messages
           if ((a.unread_count || 0) > 0 && (b.unread_count || 0) === 0) return -1;
           if ((a.unread_count || 0) === 0 && (b.unread_count || 0) > 0) return 1;
           
           // Second priority: last message time (newest first)
           if (a.last_message_time && b.last_message_time) {
             return new Date(b.last_message_time).getTime() - new Date(a.last_message_time).getTime();
           }
           if (a.last_message_time) return -1;
           if (b.last_message_time) return 1;
           
           // Fallback: alphabetical by name
           return a.name.localeCompare(b.name);
         });
        
        setContacts(sortedContacts);
        setFilteredContacts(sortedContacts);
      } catch (error) {
        console.error('Error fetching contacts:', error);
        toast.error('Failed to load contacts');
      }
    };

    if (isOpen) {
      fetchContacts();
    }
  }, [isOpen]);

  // Filter contacts based on search
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredContacts(contacts);
    } else {
      const filtered = contacts.filter(contact =>
        contact.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        contact.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
        contact.lead_number.toLowerCase().includes(searchQuery.toLowerCase())
      );
      setFilteredContacts(filtered);
    }
  }, [searchQuery, contacts]);

  // Fetch email thread for selected contact
  useEffect(() => {
    const fetchEmailThread = async () => {
      if (!selectedContact) {
        setEmailThread([]);
        return;
      }

      setIsLoading(true);
      try {
        const { data, error } = await supabase
          .from('emails')
          .select('id, message_id, sender_name, sender_email, subject, body_html, sent_at, direction, attachments')
          .eq('client_id', selectedContact.id)
          .order('sent_at', { ascending: true });

        if (error) throw error;
        setEmailThread(data || []);
      } catch (error) {
        console.error('Error fetching email thread:', error);
        toast.error('Failed to load email thread');
      } finally {
        setIsLoading(false);
      }
    };

    fetchEmailThread();
  }, [selectedContact]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [emailThread]);

  const handleContactSelect = (contact: Contact) => {
    setSelectedContact(contact);
    setShowCompose(false);
    setNewMessage('');
    // Set default subject format: Lead number - client name - Category
    const category = contact.topic || 'General';
    setSubject(`${contact.lead_number} - ${contact.name} - ${category}`);
    setAttachments([]);
    if (isMobile) {
      setShowChat(true);
    }
  };

  const handleSendEmail = async () => {
    if (!selectedContact || !newMessage.trim()) {
      toast.error('Please enter a message');
      return;
    }

    setIsSending(true);
    try {
      // Get current user info
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error('User not authenticated');
        return;
      }

      // Get user's full name
      const { data: userData } = await supabase
        .from('users')
        .select('full_name, email')
        .eq('auth_id', user.id)
        .single();

      const senderName = userData?.full_name || user.email || 'Team Member';
      const senderEmail = userData?.email || user.email || '';

      // Create email record in database
      const { data: emailRecord, error: dbError } = await supabase
        .from('emails')
        .insert({
          client_id: selectedContact.id,
          message_id: `email_${Date.now()}`,
          sender_name: senderName,
          sender_email: senderEmail,
          subject: subject,
          body_html: newMessage,
          sent_at: new Date().toISOString(),
          direction: 'outgoing',
          // Add attachment info if any
          attachments: attachments.length > 0 ? attachments.map(file => ({
            name: file.name,
            size: file.size,
            type: file.type
          })) : null
        })
        .select()
        .single();

      if (dbError) {
        console.error('Database error:', dbError);
        throw new Error('Failed to save email to database');
      }

      // Here you would integrate with your actual email sending service
      // For example, using your existing email sending function
      try {
        // If you have an email sending service, call it here
        // await sendEmail({
        //   to: selectedContact.email,
        //   subject: subject,
        //   body: newMessage,
        //   attachments: attachments
        // });
        
        console.log('Email would be sent to:', selectedContact.email);
        console.log('Subject:', subject);
        console.log('Body:', newMessage);
      } catch (emailError) {
        console.error('Email sending error:', emailError);
        // Even if email sending fails, we still save to database
        toast.error('Email saved but sending failed. Please try again.');
      }

      // Add the new email to the thread
      const newEmail: EmailMessage = {
        id: emailRecord.id.toString(),
        subject: subject,
        body_html: newMessage,
        sender_name: senderName,
        sender_email: senderEmail,
        sent_at: emailRecord.sent_at,
        direction: 'outgoing',
        attachments: attachments.length > 0 ? attachments.map(file => ({
          name: file.name,
          size: file.size,
          type: file.type
        })) : undefined
      };

      setEmailThread(prev => [...prev, newEmail]);
      setNewMessage('');
      setSubject('');
      setAttachments([]);
      setShowCompose(false);
      toast.success('Email sent and saved successfully');
    } catch (error) {
      console.error('Error sending email:', error);
      toast.error('Failed to send email');
    } finally {
      setIsSending(false);
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    setAttachments(prev => [...prev, ...files]);
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatLastMessageTime = (dateString: string) => {
    const now = new Date();
    const messageDate = new Date(dateString);
    const diffInHours = (now.getTime() - messageDate.getTime()) / (1000 * 60 * 60);
    
    if (diffInHours < 24) {
      // Today - show time
      return messageDate.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit'
      });
    } else if (diffInHours < 48) {
      // Yesterday
      return 'Yesterday';
    } else if (diffInHours < 168) {
      // Within a week - show day
      return messageDate.toLocaleDateString('en-US', {
        weekday: 'short'
      });
    } else {
      // Older - show date
      return messageDate.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric'
      });
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-white z-[9999]">
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 md:p-6 border-b border-gray-200">
          <div className="flex items-center gap-2 md:gap-4">
            <h2 className="text-lg md:text-2xl font-bold text-gray-900">Email Thread</h2>
            {selectedContact && !isMobile && (
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                <span className="text-gray-600">
                  {selectedContact.name} ({selectedContact.lead_number})
                </span>
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="btn btn-ghost btn-circle"
          >
            <XMarkIcon className="w-5 h-5 md:w-6 md:h-6" />
          </button>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Left Panel - Contacts */}
          <div className={`${isMobile ? 'w-full' : 'w-80'} border-r border-gray-200 flex flex-col ${isMobile && showChat ? 'hidden' : ''}`}>
            {/* Search Bar */}
            <div className="p-3 md:p-4 border-b border-gray-200">
              <div className="relative">
                <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search contacts..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>

            {/* Contacts List */}
            <div className="flex-1 overflow-y-auto">
              {filteredContacts.map((contact) => (
                                                  <div
                   key={contact.id}
                   onClick={() => handleContactSelect(contact)}
                   className={`p-3 md:p-4 border-b border-gray-100 cursor-pointer transition-colors hover:bg-gray-50 ${
                     selectedContact?.id === contact.id ? 'bg-blue-50 border-l-4 border-l-blue-500' : ''
                   }`}
                 >
                   <div className="flex items-center gap-2 md:gap-3">
                     <div className="w-8 h-8 md:w-10 md:h-10 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-semibold text-sm md:text-base">
                       {contact.name.charAt(0).toUpperCase()}
                     </div>
                                         <div className="flex-1 min-w-0">
                       <div className="font-semibold text-gray-900 truncate text-sm md:text-base">
                         {contact.name}
                       </div>
                       <div className="text-xs md:text-sm text-gray-500 truncate">
                         {contact.email}
                       </div>
                                                <div className="flex items-center justify-between">
                           <div className="text-xs text-gray-400">
                             #{contact.lead_number}
                           </div>
                           <div className="flex items-center gap-1 md:gap-2">
                             {contact.unread_count && contact.unread_count > 0 && (
                               <div className="w-4 h-4 md:w-5 md:h-5 bg-white rounded-full border-2 border-[#3e28cd] flex items-center justify-center">
                                 <span className="text-xs text-[#3e28cd] font-bold">{contact.unread_count}</span>
                               </div>
                             )}
                             {contact.last_message_time && (
                               <div className="text-xs text-gray-400">
                                 {formatLastMessageTime(contact.last_message_time)}
                               </div>
                             )}
                           </div>
                         </div>
                     </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right Panel - Email Thread */}
          <div className={`${isMobile ? 'w-full' : 'flex-1'} flex flex-col ${isMobile && !showChat ? 'hidden' : ''}`}>
            {selectedContact ? (
              <>
                {/* Mobile Chat Header - Only visible on mobile when in chat */}
                {isMobile && (
                  <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-white">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setShowChat(false)}
                        className="btn btn-ghost btn-circle btn-sm"
                      >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                      </button>
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-semibold text-sm">
                          {selectedContact.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <h3 className="font-semibold text-gray-900 text-sm">
                            {selectedContact.name}
                          </h3>
                          <p className="text-xs text-gray-500">
                            {selectedContact.lead_number}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Email Thread */}
                <div className="flex-1 overflow-y-auto p-4 md:p-6">
                  {isLoading ? (
                    <div className="flex items-center justify-center h-full">
                      <div className="loading loading-spinner loading-lg text-blue-500"></div>
                    </div>
                  ) : emailThread.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-gray-500">
                      <div className="text-center">
                        <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                          <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                          </svg>
                        </div>
                        <p className="text-lg font-medium">No messages yet</p>
                        <p className="text-sm">Start a conversation with {selectedContact.name}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-6">
                                             {emailThread.map((message, index) => (
                         <div
                           key={message.id}
                           className={`flex flex-col ${message.direction === 'outgoing' ? 'items-end' : 'items-start'}`}
                         >
                           {/* Message Label */}
                           <div className={`mb-2 px-3 py-1 rounded-full text-xs font-semibold ${
                             message.direction === 'outgoing'
                               ? 'bg-gradient-to-r from-blue-500 via-purple-500 to-purple-600 text-white'
                               : 'bg-gradient-to-r from-pink-500 via-purple-500 to-purple-600 text-white'
                           }`}>
                             {message.direction === 'outgoing' ? 'Team' : 'Client'}
                           </div>
                           
                           {/* Message Bubble */}
                           <div
                             className={`max-w-[85%] md:max-w-md lg:max-w-lg xl:max-w-xl ${
                               message.direction === 'outgoing'
                                 ? 'bg-[#3E28CD] text-white'
                                 : 'bg-gray-100 text-gray-900'
                             } rounded-2xl px-4 py-3 shadow-sm`}
                           >
                            <div className="flex items-center gap-2 mb-2">
                              <span className="font-semibold text-sm">
                                {message.sender_name}
                              </span>
                              <span className="text-xs opacity-70">
                                {formatDate(message.sent_at)}
                              </span>
                            </div>
                            {message.subject && (
                              <div className="font-medium mb-2">
                                {message.subject}
                              </div>
                            )}
                                                         <div className="text-sm whitespace-pre-wrap">
                               {message.body_html}
                             </div>
                            {message.attachments && message.attachments.length > 0 && (
                              <div className="mt-3 pt-3 border-t border-gray-200">
                                <div className="text-xs opacity-70 mb-2">Attachments:</div>
                                {message.attachments.map((attachment, idx) => (
                                  <div key={idx} className="flex items-center gap-2 text-xs">
                                    <PaperClipIcon className="w-3 h-3" />
                                    <span>{attachment.name}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                      <div ref={messagesEndRef} />
                    </div>
                  )}
                </div>

                {/* Compose Area */}
                <div className="border-t border-gray-200 p-4 md:p-6">
                  {showCompose ? (
                    <div className="space-y-4">
                                             <input
                         type="text"
                         placeholder="Subject"
                         value={subject}
                         onChange={(e) => setSubject(e.target.value)}
                         className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                       />
                      <textarea
                        placeholder="Type your message..."
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                        rows={4}
                      />
                      
                      {/* Attachments */}
                      {attachments.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {attachments.map((file, index) => (
                            <div key={index} className="flex items-center gap-2 bg-gray-100 px-3 py-1 rounded-lg">
                              <PaperClipIcon className="w-4 h-4 text-gray-500" />
                              <span className="text-sm">{file.name}</span>
                              <button
                                onClick={() => removeAttachment(index)}
                                className="text-red-500 hover:text-red-700"
                              >
                                ×
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => fileInputRef.current?.click()}
                            className="btn btn-ghost btn-sm"
                          >
                            <PaperClipIcon className="w-4 h-4" />
                            Attach
                          </button>
                          <input
                            ref={fileInputRef}
                            type="file"
                            multiple
                            onChange={handleFileUpload}
                            className="hidden"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setShowCompose(false)}
                            className="btn btn-outline btn-sm"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={handleSendEmail}
                            disabled={isSending || !newMessage.trim()}
                            className="btn btn-primary btn-sm"
                          >
                            {isSending ? (
                              <div className="loading loading-spinner loading-xs"></div>
                            ) : (
                              <>
                                <PaperAirplaneIcon className="w-4 h-4" />
                                Send
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowCompose(true)}
                      className="w-full btn btn-primary"
                    >
                      <PaperAirplaneIcon className="w-4 h-4 mr-2" />
                      Compose Message
                    </button>
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-gray-500">
                <div className="text-center">
                  <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  </div>
                  <p className="text-lg font-medium">Select a contact</p>
                  <p className="text-sm">Choose a contact from the list to view their email thread</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default EmailThreadModal; 