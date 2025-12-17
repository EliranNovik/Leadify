import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { XMarkIcon, EnvelopeIcon } from '@heroicons/react/24/outline';
import { FaWhatsapp } from 'react-icons/fa';

interface Message {
  id: string;
  type: 'email' | 'whatsapp';
  subject?: string;
  content: string;
  sender_name: string;
  sender_email?: string;
  direction: 'in' | 'out' | 'incoming' | 'outgoing' | 'inbound' | 'outbound';
  sent_at: string;
  attachments?: any[];
  lead_id?: string | number | null;
  lead_number?: string | null;
  lead_name?: string | null;
}

interface EmployeeMessagesModalProps {
  isOpen: boolean;
  onClose: () => void;
  employee: {
    id: number;
    display_name: string;
    email?: string | null;
  } | null;
  dateFrom: string;
  dateTo: string;
}

const EmployeeMessagesModal: React.FC<EmployeeMessagesModalProps> = ({
  isOpen,
  onClose,
  employee,
  dateFrom,
  dateTo
}) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const handleLeadClick = (leadId: string | number) => {
    onClose(); // Close the modal
    navigate(`/clients/${leadId}`);
  };

  // Clear messages when modal closes
  useEffect(() => {
    if (!isOpen) {
      setMessages([]);
    }
  }, [isOpen]);

  // Fetch messages when employee or dates change
  useEffect(() => {
    if (isOpen && employee) {
      fetchMessages();
    }
  }, [isOpen, employee?.id, dateFrom, dateTo]);

  const fetchMessages = async () => {
    if (!employee) return;

    setLoading(true);
    setMessages([]); // Clear previous messages
    try {
      const startDate = `${dateFrom}T00:00:00`;
      const endDate = `${dateTo}T23:59:59`;

      const allMessages: Message[] = [];

      // Get employee email
      let employeeEmail: string | null = null;
      if (employee.email) {
        employeeEmail = employee.email.toLowerCase();
      } else {
        const { data: userData } = await supabase
          .from('users')
          .select('email')
          .eq('employee_id', employee.id)
          .maybeSingle();
        if (userData?.email) {
          employeeEmail = userData.email.toLowerCase();
        }
      }

      // Fetch WhatsApp messages
      const { data: whatsappMessages } = await supabase
        .from('whatsapp_messages')
        .select('*')
        .eq('sender_name', employee.display_name)
        .gte('sent_at', startDate)
        .lte('sent_at', endDate)
        .order('sent_at', { ascending: true });

      // Get unique lead IDs from WhatsApp messages
      const whatsappLeadIds = [...new Set(
        whatsappMessages?.map((msg: any) => msg.lead_id).filter(Boolean) || []
      )];

      // Fetch lead data for WhatsApp messages
      let whatsappLeadsMap = new Map();
      if (whatsappLeadIds.length > 0) {
        const { data: whatsappLeads } = await supabase
          .from('leads')
          .select('id, lead_number, name')
          .in('id', whatsappLeadIds);
        
        whatsappLeads?.forEach((lead: any) => {
          whatsappLeadsMap.set(lead.id, lead);
        });
      }

      whatsappMessages?.forEach((msg: any) => {
        const leadData = msg.lead_id ? whatsappLeadsMap.get(msg.lead_id) : null;
        // Normalize direction to 'in' or 'out'
        let normalizedDirection: 'in' | 'out' = 'in';
        const dir = msg.direction?.toLowerCase();
        if (dir === 'out' || dir === 'outgoing' || dir === 'outbound') {
          normalizedDirection = 'out';
        }
        
        allMessages.push({
          id: `whatsapp_${msg.id}`,
          type: 'whatsapp',
          content: msg.message || msg.content || '',
          sender_name: msg.sender_name || employee.display_name,
          direction: normalizedDirection,
          sent_at: msg.sent_at,
          lead_id: msg.lead_id,
          lead_number: leadData?.lead_number || null,
          lead_name: leadData?.name || null,
        });
      });

      // Fetch emails if employee has email
      if (employeeEmail) {
        // Fetch outbound emails
        const { data: outboundEmails } = await supabase
          .from('emails')
          .select('*')
          .in('direction', ['outbound', 'out', 'outgoing'])
          .eq('sender_email', employeeEmail)
          .gte('sent_at', startDate)
          .lte('sent_at', endDate)
          .order('sent_at', { ascending: true });

        // Fetch inbound emails
        const { data: inboundEmails } = await supabase
          .from('emails')
          .select('*')
          .in('direction', ['inbound', 'in', 'incoming'])
          .ilike('recipient_list', `%${employeeEmail}%`)
          .gte('sent_at', startDate)
          .lte('sent_at', endDate)
          .order('sent_at', { ascending: true });

        // Combine all emails and get unique lead IDs
        const allEmails = [...(outboundEmails || []), ...(inboundEmails || [])];
        const emailLeadIds = [...new Set(
          allEmails.map((email: any) => email.lead_id).filter(Boolean)
        )];

        // Fetch lead data for emails
        let emailLeadsMap = new Map();
        if (emailLeadIds.length > 0) {
          const { data: emailLeads } = await supabase
            .from('leads')
            .select('id, lead_number, name')
            .in('id', emailLeadIds);
          
          emailLeads?.forEach((lead: any) => {
            emailLeadsMap.set(lead.id, lead);
          });
        }

        // Process outbound emails
        console.log(`📤 Processing ${outboundEmails?.length || 0} outbound emails for ${employee.display_name}`);
        outboundEmails?.forEach((email: any) => {
          // Skip internal emails
          const recipientList = email.recipient_list?.toLowerCase() || '';
          if (recipientList.includes('@lawoffice.org.il') && !recipientList.includes(employeeEmail)) {
            console.log(`⏭️ Skipping internal email to: ${recipientList}`);
            return;
          }

          const leadData = email.lead_id ? emailLeadsMap.get(email.lead_id) : null;
          const messageData: Message = {
            id: `email_out_${email.id}`,
            type: 'email' as const,
            subject: email.subject || '(No Subject)',
            content: email.body_preview || email.body_html || '',
            sender_name: email.sender_name || employee.display_name,
            sender_email: email.sender_email,
            direction: 'out' as const,
            sent_at: email.sent_at,
            attachments: email.attachments,
            lead_id: email.lead_id,
            lead_number: leadData?.lead_number || null,
            lead_name: leadData?.name || null,
          };
          console.log(`✅ Adding OUTBOUND email:`, { 
            id: messageData.id, 
            direction: messageData.direction, 
            subject: messageData.subject,
            sender: messageData.sender_name 
          });
          allMessages.push(messageData);
        });

        // Process inbound emails
        console.log(`📥 Processing ${inboundEmails?.length || 0} inbound emails for ${employee.display_name}`);
        inboundEmails?.forEach((email: any) => {
          // Skip internal emails
          const senderEmail = email.sender_email?.toLowerCase() || '';
          if (senderEmail.includes('@lawoffice.org.il') && senderEmail !== employeeEmail) {
            console.log(`⏭️ Skipping internal email from: ${senderEmail}`);
            return;
          }

          const leadData = email.lead_id ? emailLeadsMap.get(email.lead_id) : null;
          const messageData: Message = {
            id: `email_in_${email.id}`,
            type: 'email' as const,
            subject: email.subject || '(No Subject)',
            content: email.body_preview || email.body_html || '',
            sender_name: email.sender_name || 'Unknown',
            sender_email: email.sender_email,
            direction: 'in' as const,
            sent_at: email.sent_at,
            attachments: email.attachments,
            lead_id: email.lead_id,
            lead_number: leadData?.lead_number || null,
            lead_name: leadData?.name || null,
          };
          console.log(`✅ Adding INBOUND email:`, { 
            id: messageData.id, 
            direction: messageData.direction, 
            subject: messageData.subject,
            sender: messageData.sender_name 
          });
          allMessages.push(messageData);
        });
      }

      // Sort all messages by date
      allMessages.sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime());

      setMessages(allMessages);
    } catch (error) {
      console.error('Error fetching messages:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatDateSeparator = (dateString: string) => {
    const date = new Date(dateString);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
      return 'Today';
    } else if (date.toDateString() === yesterday.toDateString()) {
      return 'Yesterday';
    } else {
      return date.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    }
  };

  const isRTL = (text: string): boolean => {
    if (!text) return false;
    
    // Hebrew Unicode range: \u0590-\u05FF
    // Arabic Unicode range: \u0600-\u06FF
    const rtlChars = /[\u0590-\u05FF\u0600-\u06FF]/;
    
    // Check if text contains RTL characters
    return rtlChars.test(text);
  };

  const stripHtml = (html: string) => {
    if (!html) return '';
    
    // Create a temporary div to parse HTML
    const tmp = document.createElement('div');
    
    // First, convert common HTML breaks to newlines before stripping
    let processedHtml = html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<\/h[1-6]>/gi, '\n\n');
    
    tmp.innerHTML = processedHtml;
    
    // Remove script and style tags
    const scripts = tmp.getElementsByTagName('script');
    const styles = tmp.getElementsByTagName('style');
    
    for (let i = scripts.length - 1; i >= 0; i--) {
      scripts[i].parentNode?.removeChild(scripts[i]);
    }
    
    for (let i = styles.length - 1; i >= 0; i--) {
      styles[i].parentNode?.removeChild(styles[i]);
    }
    
    // Get text content
    let text = tmp.textContent || tmp.innerText || '';
    
    // Clean up excessive whitespace but preserve line breaks
    text = text
      .replace(/[ \t]+/g, ' ') // Replace multiple spaces/tabs with single space
      .replace(/\n\s+\n/g, '\n\n') // Clean up lines with only whitespace
      .replace(/\n{3,}/g, '\n\n') // Replace 3+ newlines with 2
      .trim();
    
    return text;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[10000] overflow-y-auto bg-black bg-opacity-50 flex items-center justify-center sm:p-4">
      <div className="bg-white sm:rounded-lg shadow-2xl w-full h-full sm:h-auto sm:max-w-4xl sm:max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">
              {employee?.display_name}'s Messages
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              {new Date(dateFrom).toLocaleDateString()} - {new Date(dateTo).toLocaleDateString()}
            </p>
          </div>
          <button
            onClick={onClose}
            className="btn btn-ghost btn-circle"
          >
            <XMarkIcon className="w-6 h-6" />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-gray-50">
          {loading ? (
            <div className="flex items-center justify-center h-full text-gray-500">
              <div className="flex flex-col items-center gap-3">
                <span className="loading loading-spinner loading-lg text-primary" />
                <p className="text-sm">Loading messages...</p>
              </div>
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <EnvelopeIcon className="w-12 h-12 mx-auto mb-4 text-gray-300" />
              <p className="text-lg font-medium">No messages found</p>
              <p className="text-sm">No emails or WhatsApp messages in this date range</p>
            </div>
          ) : (
            messages.map((message, index) => {
              const showDateSeparator = index === 0 || 
                new Date(message.sent_at).toDateString() !== new Date(messages[index - 1].sent_at).toDateString();
              
              // Check if message is outgoing (sent by employee)
              const isOutgoing = message.direction === 'out';
              
              console.log('Message direction:', message.direction, 'isOutgoing:', isOutgoing, 'type:', message.type);
              
              // Prepare display content
              let displayContent = '';
              if (message.type === 'email') {
                if (message.content && (message.content.includes('<') || message.content.includes('&lt;'))) {
                  displayContent = stripHtml(message.content);
                } else {
                  displayContent = message.content || '';
                }
              } else {
                displayContent = message.content || '';
              }
              
              // Truncate if too long
              if (displayContent.length > 500) {
                displayContent = displayContent.substring(0, 500) + '...';
              }
              
              // Detect if content is RTL
              const contentIsRTL = isRTL(displayContent);
              const subjectIsRTL = message.subject ? isRTL(message.subject) : false;

              return (
                <React.Fragment key={message.id}>
                  {showDateSeparator && (
                    <div className="flex justify-center my-4">
                      <div className="bg-white border border-gray-200 text-gray-600 text-sm font-medium px-3 py-1.5 rounded-full shadow-sm">
                        {formatDateSeparator(message.sent_at)}
                      </div>
                    </div>
                  )}

                  <div className={`flex flex-col ${isOutgoing ? 'items-end' : 'items-start'}`}>
                    {/* Sender name and type icon */}
                    <div className={`flex items-center gap-2 mb-1 ${isOutgoing ? 'flex-row-reverse' : 'flex-row'}`}>
                      <div className={`text-xs font-semibold ${isOutgoing ? 'text-blue-600' : 'text-gray-600'}`}>
                        {isOutgoing ? employee?.display_name : message.sender_name}
                      </div>
                      {message.type === 'whatsapp' ? (
                        <FaWhatsapp className="w-4 h-4 text-green-500" />
                      ) : (
                        <EnvelopeIcon className="w-4 h-4 text-blue-500" />
                      )}
                    </div>

                    {/* Message bubble */}
                    <div
                      className={`max-w-[75%] rounded-2xl px-4 py-3 shadow-md ${
                        isOutgoing
                          ? 'bg-blue-500 text-white rounded-tr-sm'
                          : 'bg-white text-gray-800 border border-gray-200 rounded-tl-sm'
                      }`}
                    >
                      {/* Lead Number - Clickable */}
                      {message.lead_number && (
                        <div 
                          className={`text-xs font-semibold mb-2 cursor-pointer hover:underline ${
                            isOutgoing ? 'text-blue-100 hover:text-white' : 'text-primary hover:text-primary-focus'
                          }`}
                          onClick={() => handleLeadClick(message.lead_id!)}
                          title={`Go to ${message.lead_name || 'lead'}`}
                        >
                          📋 Lead #{message.lead_number}
                          {message.lead_name && ` - ${message.lead_name}`}
                        </div>
                      )}

                      {/* Email subject */}
                      {message.type === 'email' && message.subject && (
                        <div 
                          className={`text-sm font-semibold mb-2 ${isOutgoing ? 'text-blue-100' : 'text-gray-900'}`}
                          dir={subjectIsRTL ? 'rtl' : 'ltr'}
                          style={{ textAlign: subjectIsRTL ? 'right' : 'left' }}
                        >
                          {message.subject}
                        </div>
                      )}

                      {/* Message content */}
                      <div 
                        className={`text-sm whitespace-pre-line break-words ${isOutgoing ? 'text-white' : 'text-gray-700'}`}
                        dir={contentIsRTL ? 'rtl' : 'ltr'}
                        style={{ textAlign: contentIsRTL ? 'right' : 'left' }}
                      >
                        {displayContent}
                      </div>

                      {/* Attachments indicator */}
                      {message.attachments && message.attachments.length > 0 && (
                        <div className={`text-xs mt-2 ${isOutgoing ? 'text-blue-100' : 'text-gray-500'}`}>
                          📎 {message.attachments.length} attachment{message.attachments.length > 1 ? 's' : ''}
                        </div>
                      )}

                      {/* Timestamp */}
                      <div className={`text-xs mt-2 ${isOutgoing ? 'text-blue-100' : 'text-gray-400'}`}>
                        {new Date(message.sent_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </div>
                </React.Fragment>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 bg-white text-center text-sm text-gray-500">
          Total: {messages.length} message{messages.length !== 1 ? 's' : ''} 
          ({messages.filter(m => m.type === 'email').length} emails, {messages.filter(m => m.type === 'whatsapp').length} WhatsApp)
        </div>
      </div>
    </div>
  );
};

export default EmployeeMessagesModal;

