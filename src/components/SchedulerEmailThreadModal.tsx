import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { XMarkIcon, PaperAirplaneIcon, PaperClipIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import { buildApiUrl } from '../lib/api';
import { useMsal } from '@azure/msal-react';

interface SchedulerEmailThreadModalProps {
  isOpen: boolean;
  onClose: () => void;
  client?: {
    id: string;
    name: string;
    lead_number: string;
    email?: string;
    lead_type?: string;
    topic?: string;
  };
  onClientUpdate?: () => Promise<void>;
}

const SchedulerEmailThreadModal: React.FC<SchedulerEmailThreadModalProps> = ({ isOpen, onClose, client, onClientUpdate }) => {
  const { instance, accounts } = useMsal();
  const [emails, setEmails] = useState<any[]>([]);
  const [emailsLoading, setEmailsLoading] = useState(false);
  const [emailSearchQuery, setEmailSearchQuery] = useState("");
  const [showCompose, setShowCompose] = useState(false);
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [composeAttachments, setComposeAttachments] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [currentUserFullName, setCurrentUserFullName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [emails]);

  // Fetch current user's full name
  useEffect(() => {
    const fetchCurrentUserFullName = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user?.email) {
          const { data: userData } = await supabase
            .from('users')
            .select('full_name')
            .eq('email', user.email)
            .single();
          if (userData?.full_name) {
            setCurrentUserFullName(userData.full_name);
          }
        }
      } catch (error) {
        console.error('Error fetching user full name:', error);
      }
    };
    fetchCurrentUserFullName();
  }, []);

  // Function to fetch emails from database for the modal
  const fetchEmailsForModal = useCallback(async () => {
    if (!client?.id) return;
    
    setEmailsLoading(true);
    try {
      // Fetch emails from database for this specific client
      const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
      let emailQuery;
      
      if (isLegacyLead) {
        const legacyId = parseInt(client.id.replace('legacy_', ''));
        emailQuery = supabase
          .from('emails')
          .select('id, message_id, sender_name, sender_email, recipient_list, subject, body_html, sent_at, direction, attachments')
          .eq('legacy_id', legacyId)
          .order('sent_at', { ascending: true });
      } else {
        emailQuery = supabase
          .from('emails')
          .select('id, message_id, sender_name, sender_email, recipient_list, subject, body_html, sent_at, direction, attachments')
          .eq('client_id', client.id)
          .order('sent_at', { ascending: true });
      }
      
      const { data: emailData, error: emailError } = await emailQuery;
      
      if (emailError) {
        console.error('Error fetching emails:', emailError);
        setEmails([]);
        return;
      }
      
      // Format emails for display
      const formattedEmailsForModal = (emailData || []).map((email: any) => ({
        id: email.id,
        message_id: email.message_id,
        subject: email.subject || 'No Subject',
        bodyPreview: email.body_html || '',
        from: email.sender_email || '',
        to: email.recipient_list || '',
        date: email.sent_at,
        direction: email.direction,
        attachments: email.attachments || []
      }));
      
      setEmails(formattedEmailsForModal);
    } catch (error) {
      console.error('❌ Error in fetchEmailsForModal:', error);
      setEmails([]);
    } finally {
      setEmailsLoading(false);
    }
  }, [client]);

  // Fetch emails when modal opens
  useEffect(() => {
    if (isOpen && client) {
      const defaultSubject = `[${client.lead_number}] - ${client.name} - ${client.topic || ''}`;
      setComposeSubject(prev => prev && prev.trim() ? prev : defaultSubject);
      
      // Fetch emails when modal opens
      console.log('📧 Email modal opened, fetching emails...');
      fetchEmailsForModal();
    }
  }, [isOpen, client, fetchEmailsForModal]);

  const handleAttachmentUpload = (files: FileList) => {
    const newFiles = Array.from(files);
    setComposeAttachments(prev => [...prev, ...newFiles]);
  };

  const handleSendEmail = async () => {
    if (!client?.email || !instance || !accounts[0]) return;
    setSending(true);

    try {
      const tokenResponse = await instance.acquireTokenSilent({
        scopes: ['https://graph.microsoft.com/Mail.Send'],
        account: accounts[0]
      });

      const emailData = {
        message: {
          subject: composeSubject,
          body: {
            contentType: 'HTML',
            content: composeBody.replace(/\n/g, '<br>')
          },
          toRecipients: [
            {
              emailAddress: {
                address: client.email
              }
            }
          ],
          attachments: await Promise.all(composeAttachments.map(async file => ({
            '@odata.type': '#microsoft.graph.fileAttachment',
            name: file.name,
            contentType: file.type,
            contentBytes: await fileToBase64(file)
          })))
        }
      };

      const response = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokenResponse.accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(emailData)
      });

      if (response.ok) {
        toast.success('Email sent successfully!');
        setComposeBody('');
        setComposeAttachments([]);
        setShowCompose(false);
        
        // Refresh emails
        await fetchEmailsForModal();
        if (onClientUpdate) {
          await onClientUpdate();
        }
      } else {
        throw new Error('Failed to send email');
      }
    } catch (error) {
      console.error('Error sending email:', error);
      toast.error('Failed to send email');
    } finally {
      setSending(false);
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64 = reader.result as string;
        resolve(base64.split(',')[1]);
      };
      reader.onerror = error => reject(error);
    });
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 bg-white z-[9999]">
      {/* CSS to ensure email content displays fully */}
      <style>{`
        .email-content .email-body {
          max-width: none !important;
          overflow: visible !important;
          word-wrap: break-word !important;
          white-space: pre-wrap !important;
        }
        .email-content .email-body * {
          max-width: none !important;
          overflow: visible !important;
        }
        .email-content .email-body img {
          max-width: 100% !important;
          height: auto !important;
        }
        .email-content .email-body table {
          width: 100% !important;
          border-collapse: collapse !important;
        }
        .email-content .email-body p, 
        .email-content .email-body div, 
        .email-content .email-body span {
          white-space: pre-wrap !important;
          word-wrap: break-word !important;
        }
      `}</style>
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 md:p-6 border-b border-gray-200">
          <div className="flex items-center gap-2 md:gap-4 min-w-0 flex-1">
            <h2 className="text-lg md:text-2xl font-bold text-gray-900">Email Thread</h2>
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-2 h-2 bg-green-500 rounded-full flex-shrink-0"></div>
              <span className="text-gray-600 text-sm md:text-base truncate">
                {client?.name} ({client?.lead_number})
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="btn btn-ghost btn-circle"
            >
              <XMarkIcon className="w-5 h-5 md:w-6 md:h-6" />
            </button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="px-4 md:px-6 py-3 border-b border-gray-200 bg-gray-50">
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <MagnifyingGlassIcon className="h-5 w-5 text-gray-400" />
            </div>
            <input
              type="text"
              className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
              placeholder="Search emails by keywords, sender name, or recipient..."
              value={emailSearchQuery}
              onChange={(e) => setEmailSearchQuery(e.target.value)}
            />
            {emailSearchQuery && (
              <button
                onClick={() => setEmailSearchQuery('')}
                className="absolute inset-y-0 right-0 pr-3 flex items-center"
              >
                <XMarkIcon className="h-5 w-5 text-gray-400 hover:text-gray-600" />
              </button>
            )}
          </div>
        </div>

        {/* Email Thread */}
        <div className="flex-1 overflow-y-auto p-3 md:p-6 bg-white">
          {emailsLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="loading loading-spinner loading-lg text-purple-500"></div>
            </div>
          ) : emails.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-500">
              <div className="text-center">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <p className="text-lg font-medium">No emails available</p>
                <p className="text-sm">No emails found for {client?.name}. Try syncing or send a new email.</p>
              </div>
            </div>
          ) : emails.filter((message) => {
            if (!emailSearchQuery.trim()) return true;
            
            const searchTerm = emailSearchQuery.toLowerCase();
            
            // Search in subject
            if (message.subject && message.subject.toLowerCase().includes(searchTerm)) return true;
            
            // Search in email body content
            if (message.bodyPreview && message.bodyPreview.toLowerCase().includes(searchTerm)) return true;
            
            // Search in sender name (from field)
            if (message.from && message.from.toLowerCase().includes(searchTerm)) return true;
            
            // Search in recipient (to field)
            if (message.to && message.to.toLowerCase().includes(searchTerm)) return true;
            
            // Search in sender name (display name)
            const senderName = message.direction === 'outgoing' ? (currentUserFullName || 'Team') : client?.name;
            if (senderName && senderName.toLowerCase().includes(searchTerm)) return true;
            
            return false;
          }).length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-500">
              <div className="text-center">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <MagnifyingGlassIcon className="w-8 h-8 text-gray-400" />
                </div>
                <p className="text-lg font-medium">No emails found</p>
                <p className="text-sm">No emails match your search for "{emailSearchQuery}". Try a different search term.</p>
                <button
                  onClick={() => setEmailSearchQuery('')}
                  className="mt-2 text-sm text-purple-600 hover:text-purple-800 underline"
                >
                  Clear search
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {[...emails]
                .filter((message) => {
                  if (!emailSearchQuery.trim()) return true;
                  
                  const searchTerm = emailSearchQuery.toLowerCase();
                  
                  // Search in subject
                  if (message.subject && message.subject.toLowerCase().includes(searchTerm)) return true;
                  
                  // Search in email body content
                  if (message.bodyPreview && message.bodyPreview.toLowerCase().includes(searchTerm)) return true;
                  
                  // Search in sender name (from field)
                  if (message.from && message.from.toLowerCase().includes(searchTerm)) return true;
                  
                  // Search in recipient (to field)
                  if (message.to && message.to.toLowerCase().includes(searchTerm)) return true;
                  
                  // Search in sender name (display name)
                  const senderName = message.direction === 'outgoing' ? (currentUserFullName || 'Team') : client?.name;
                  if (senderName && senderName.toLowerCase().includes(searchTerm)) return true;
                  
                  return false;
                })
                .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                .map((message, index) => (
                  <div key={message.id} className="space-y-2">
                    {/* Email Header */}
                    <div className="flex items-center gap-3">
                      <div className={`px-3 py-1 rounded-full text-xs font-semibold ${
                        message.direction === 'outgoing'
                          ? 'bg-blue-100 text-blue-700 border border-blue-200'
                          : 'bg-pink-100 text-pink-700 border border-pink-200'
                      }`}>
                        {message.direction === 'outgoing' ? 'Team' : 'Client'}
                      </div>
                      <div>
                        <div className="font-semibold text-gray-900 text-sm">
                          {message.direction === 'outgoing' ? (currentUserFullName || 'Team') : client?.name}
                        </div>
                        <div className="text-xs text-gray-500">
                          {new Date(message.date).toLocaleString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </div>
                      </div>
                    </div>
                    
                    {/* Complete Email Content */}
                    <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-lg hover:shadow-xl transition-shadow duration-300" style={{
                      boxShadow: '0 10px 25px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05), 0 0 0 1px rgba(0, 0, 0, 0.05)'
                    }}>
                      {/* Email Header */}
                      <div className="mb-4 pb-4 border-b border-gray-200">
                        <div className="text-sm text-gray-600 space-y-1">
                          <div><strong>From:</strong> {message.direction === 'outgoing' ? (currentUserFullName || 'Team') : client?.name} &lt;{message.from}&gt;</div>
                          <div><strong>To:</strong> {message.to || (message.direction === 'outgoing' ? `${client?.name} <${client?.email}>` : `eliran@lawoffice.org.il`)}</div>
                          <div><strong>Date:</strong> {new Date(message.date).toLocaleString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}</div>
                          <div><strong>Subject:</strong> {message.subject}</div>
                        </div>
                      </div>
                      
                      {/* Email Body */}
                      <div className="email-content">
                        <div 
                          className="email-body prose max-w-none text-gray-800 leading-relaxed"
                          dangerouslySetInnerHTML={{ __html: message.bodyPreview }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>

        {/* Compose Email Section */}
        <div className="border-t border-gray-200 p-4 md:p-6 bg-gray-50">
          {showCompose ? (
            <div className="space-y-4">
              <input
                type="text"
                placeholder="Subject"
                value={composeSubject}
                onChange={(e) => setComposeSubject(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
              <textarea
                placeholder="Type your message..."
                value={composeBody}
                onChange={(e) => setComposeBody(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"
                rows={4}
              />
              
              {/* Attachments */}
              {composeAttachments.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {composeAttachments.map((file, index) => (
                    <div key={index} className="flex items-center gap-2 bg-gray-100 px-3 py-1 rounded-lg">
                      <PaperClipIcon className="w-4 h-4 text-gray-500" />
                      <span className="text-sm">{file.name}</span>
                      <button
                        onClick={() => setComposeAttachments(prev => prev.filter((_, i) => i !== index))}
                        className="text-red-500 hover:text-red-700"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
              
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="btn btn-ghost btn-sm"
                  >
                    <PaperClipIcon className="w-4 h-4" />
                    <span className="hidden sm:inline">Attach</span>
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    onChange={(e) => e.target.files && handleAttachmentUpload(e.target.files)}
                    className="hidden"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowCompose(false)}
                    className="btn btn-outline btn-sm flex-1 sm:flex-none"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSendEmail}
                    disabled={sending || !composeBody.trim()}
                    className="btn btn-primary btn-sm flex-1 sm:flex-none"
                  >
                    {sending ? (
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
      </div>
    </div>,
    document.body
  );
};

export default SchedulerEmailThreadModal;