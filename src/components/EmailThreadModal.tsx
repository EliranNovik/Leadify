import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { XMarkIcon, MagnifyingGlassIcon, PaperAirplaneIcon, PaperClipIcon } from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';
import { useMsal } from '@azure/msal-react';
import { loginRequest } from '../msalConfig';
import { appendEmailSignature } from '../lib/emailSignature';

interface Contact {
  id: number;
  name: string;
  email: string;
  lead_number: string;
  phone?: string;
  created_at: string;
  topic?: string | null;
  last_message_time?: string;
  unread_count?: number;
  lead_type?: 'legacy' | 'new';
}

interface EmailMessage {
  id: string;
  subject: string;
  body_html: string;
  sender_name: string;
  sender_email: string;
  recipient_list?: string;
  sent_at: string;
  direction: 'incoming' | 'outgoing';
  attachments?: {
    id?: string;
    name: string;
    contentType?: string;
    size?: number;
    contentBytes?: string;
    isInline?: boolean;
  }[];
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
  const [showContactSelector, setShowContactSelector] = useState(false);
  const [allContacts, setAllContacts] = useState<Contact[]>([]);
  const [searchAllContacts, setSearchAllContacts] = useState('');
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // MSAL for email sending
  const { instance, accounts } = useMsal();

  // Helper function to strip signatures and quoted text from emails
  const stripSignatureAndQuotedTextPreserveHtml = (html: string): string => {
    if (!html) return '';
    
    // Remove common signature patterns while preserving HTML structure
    let processed = html
      .replace(/<div[^>]*class="[^"]*signature[^"]*"[^>]*>.*?<\/div>/gis, '')
      .replace(/<div[^>]*id="[^"]*signature[^"]*"[^>]*>.*?<\/div>/gis, '')
      .replace(/<p[^>]*class="[^"]*signature[^"]*"[^>]*>.*?<\/p>/gis, '')
      .replace(/<p[^>]*id="[^"]*signature[^"]*"[^>]*>.*?<\/p>/gis, '')
      .replace(/<br\s*\/?>\s*<br\s*\/?>\s*<br\s*\/?>/gi, '<br><br>'); // Reduce excessive line breaks
    
    return processed;
  };

  // Helper function to clean up Microsoft diagnostic emails
  const cleanMicrosoftDiagnosticEmail = (html: string): string => {
    if (!html) return html;
    
    // Check if this is a Microsoft diagnostic email
    const isMicrosoftDiagnostic = html.includes('Delivery has failed') || 
                                 html.includes('Diagnostic information for administrators') ||
                                 html.includes('MicrosoftExchange') ||
                                 html.includes('Undeliverable');
    
    if (!isMicrosoftDiagnostic) return html;
    
    // Extract only the useful information from Microsoft diagnostic emails
    let cleaned = html;
    
    // Remove diagnostic information section
    cleaned = cleaned.replace(/<b>Diagnostic information for administrators:<\/b>.*?(?=<b>|$)/gis, '');
    
    // Remove server information
    cleaned = cleaned.replace(/Generating server:.*?<br\s*\/?>/gi, '');
    cleaned = cleaned.replace(/Receiving server:.*?<br\s*\/?>/gi, '');
    
    // Remove timestamped entries
    cleaned = cleaned.replace(/\d+\/\d+\/\d+ \d+:\d+:\d+ (AM|PM).*?<br\s*\/?>/gi, '');
    
    // Remove error codes and technical details
    cleaned = cleaned.replace(/\d+\.\d+\.\d+.*?<br\s*\/?>/gi, '');
    cleaned = cleaned.replace(/DNS.*?<br\s*\/?>/gi, '');
    
    // Remove "Original message headers" section
    cleaned = cleaned.replace(/Original message headers:.*$/gis, '');
    
    // Clean up excessive line breaks
    cleaned = cleaned.replace(/(<br\s*\/?>){3,}/gi, '<br><br>');
    
    // Add a summary if it's a delivery failure
    if (html.includes('Delivery has failed')) {
      const failureReason = html.match(/Your message couldn't be delivered\.([^<]+)/i);
      if (failureReason) {
        cleaned = `<div style="background-color: #fee2e2; border: 1px solid #fca5a5; border-radius: 8px; padding: 16px; margin: 16px 0;">
          <h3 style="color: #dc2626; margin: 0 0 8px 0; font-size: 16px;">📧 Delivery Failed</h3>
          <p style="color: #7f1d1d; margin: 0;">${failureReason[1].trim()}</p>
        </div>` + cleaned;
      }
    }
    
    return cleaned;
  };

  // Microsoft Graph API: Fetch ALL emails from lawoffice.org.il and sync to DB
  const syncAllEmails = async (token: string) => {
    console.log('🔄 Starting comprehensive email sync from Microsoft Graph...');
    
    try {
      // Fetch ALL emails from the lawoffice.org.il group (last 7 days for testing)
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      
      console.log('📅 Fetching emails from:', sevenDaysAgo.toISOString());
      
      // Get all emails (both sent and received) - simplified query
      const url = `https://graph.microsoft.com/v1.0/me/messages?$select=id,subject,from,toRecipients,ccRecipients,receivedDateTime,body,conversationId,hasAttachments&$expand=attachments&$filter=receivedDateTime ge ${sevenDaysAgo.toISOString()}&$top=50&$orderby=receivedDateTime desc`;
      
      console.log('🌐 Fetching from URL:', url);
      
      const res = await fetch(url, { 
        headers: { 
          Authorization: `Bearer ${token}`
        } 
      });
      
      if (!res.ok) {
        const errorText = await res.text();
        console.error("❌ Microsoft Graph API error:", res.status, errorText);
        throw new Error(`Failed to fetch from Microsoft Graph: ${res.status}`);
      }

      const json = await res.json();
      const allMessages = json.value || [];
      
      console.log(`📧 Fetched ${allMessages.length} total emails from Microsoft Graph`);
      
      // Log first few emails for debugging
      if (allMessages.length > 0) {
        console.log('📧 Sample emails:', allMessages.slice(0, 3).map((msg: any) => ({
          id: msg.id,
          subject: msg.subject,
          from: msg.from?.emailAddress?.address,
          to: (msg.toRecipients || []).map((r: any) => r.emailAddress.address),
          received: msg.receivedDateTime
        })));
      }

      // Filter messages that involve lawoffice.org.il (either from or to)
      const lawOfficeMessages = allMessages.filter((msg: any) => {
        const fromEmail = msg.from?.emailAddress?.address?.toLowerCase() || '';
        const toEmails = (msg.toRecipients || []).map((r: any) => r.emailAddress.address.toLowerCase());
        const ccEmails = (msg.ccRecipients || []).map((r: any) => r.emailAddress.address.toLowerCase());
        
        const involvesLawOffice = fromEmail.includes('lawoffice.org.il') || 
               toEmails.some((email: string) => email.includes('lawoffice.org.il')) ||
               ccEmails.some((email: string) => email.includes('lawoffice.org.il'));
        
        if (involvesLawOffice) {
          console.log('🏢 Found lawoffice.org.il email:', {
            subject: msg.subject,
            from: fromEmail,
            to: toEmails,
            cc: ccEmails
          });
        }
        
        return involvesLawOffice;
      });

      console.log(`🏢 Found ${lawOfficeMessages.length} emails involving lawoffice.org.il`);

      if (lawOfficeMessages.length === 0) {
        console.log("❌ No emails involving lawoffice.org.il found.");
        return;
      }

      // Sort messages by date
      lawOfficeMessages.sort((a: any, b: any) => new Date(b.receivedDateTime).getTime() - new Date(a.receivedDateTime).getTime());

      // Now we need to match these emails to clients
      // First, get all contacts to match against - handle both new and legacy leads
      console.log('👥 Fetching contacts for email matching...');
      
      // Fetch new leads from 'leads' table
      let newLeads: any[] = [];
      let newLeadsError: any = null;
      
      try {
        const result = await supabase
          .from('leads')
          .select('id, name, email, lead_number');
        newLeads = result.data || [];
        newLeadsError = result.error;
      } catch (error) {
        console.error('❌ Network error fetching new leads:', error);
        newLeadsError = error;
      }
      
      if (newLeadsError) {
        console.error('❌ Error fetching new leads:', newLeadsError);
        // Continue with empty array instead of failing completely
      }

      // Fetch legacy leads from 'leads_lead' table with contact info
      let legacyLeads: any[] = [];
      let legacyLeadsError: any = null;
      
      try {
        const result = await supabase
          .from('leads_lead')
          .select(`
            id, 
            name, 
            email
          `);
        legacyLeads = result.data || [];
        legacyLeadsError = result.error;
      } catch (error) {
        console.error('❌ Network error fetching legacy leads:', error);
        legacyLeadsError = error;
      }
      
      if (legacyLeadsError) {
        console.error('❌ Error fetching legacy leads:', legacyLeadsError);
        // Continue with empty array instead of failing completely
      }

      // Combine all contacts
      const allContacts = [
        ...(newLeads || []).map(lead => ({
          id: lead.id,
          name: lead.name,
          email: lead.email,
          lead_number: lead.lead_number,
          lead_type: 'new'
        })),
        ...(legacyLeads || []).map(lead => ({
          id: lead.id,
          name: lead.name,
          email: lead.email,
          lead_number: lead.id?.toString(), // Use id as lead_number for legacy leads
          lead_type: 'legacy'
        }))
      ];

      console.log(`👥 Found ${allContacts?.length || 0} total contacts to match against`);
      console.log(`   - New leads: ${newLeads?.length || 0}`);
      console.log(`   - Legacy leads: ${legacyLeads?.length || 0}`);
      
      // Log sample contacts for debugging
      if (allContacts && allContacts.length > 0) {
        console.log('👥 Sample contacts:', allContacts.slice(0, 5).map((contact: any) => ({
          id: contact.id,
          name: contact.name,
          email: contact.email,
          lead_number: contact.lead_number,
          lead_type: contact.lead_type
        })));
        
        // Look specifically for Frederick Manser
        const frederick = allContacts.find((contact: any) => 
          contact.name && contact.name.toLowerCase().includes('frederick') ||
          contact.email && contact.email.toLowerCase().includes('eliran.novik@gmail.com')
        );
        if (frederick) {
          console.log('✅ Found Frederick Manser:', frederick);
        } else {
          console.log('❌ Frederick Manser not found in contacts');
        }
      } else {
        console.log('❌ No contacts found at all!');
      }

      // Process each email and try to match it to a client
      const emailsToUpsert: any[] = [];
      
      console.log('🔄 Processing emails for client matching...');
      
      for (const msg of lawOfficeMessages) {
        const isOutgoing = msg.from?.emailAddress?.address?.toLowerCase().includes('lawoffice.org.il');
        const originalBody = msg.body?.content || '';
        let processedBody = !isOutgoing ? stripSignatureAndQuotedTextPreserveHtml(originalBody) : originalBody;
        
        // Clean Microsoft diagnostic emails
        processedBody = cleanMicrosoftDiagnosticEmail(processedBody);

        console.log(`📧 Processing email: "${msg.subject}" from ${msg.from?.emailAddress?.address}`);

        // Try to find matching client(s) for this email
        const matchingContacts = allContacts?.filter((contact: any) => {
          if (!contact || !contact.email || !contact.lead_number) return false;
          
          const contactEmail = contact.email.toLowerCase();
          const leadNumber = contact.lead_number;
          const subject = msg.subject || '';
          
          // Check if this email involves this contact
          const fromEmail = msg.from?.emailAddress?.address?.toLowerCase() || '';
          const toEmails = (msg.toRecipients || []).map((r: any) => r.emailAddress?.address?.toLowerCase() || '').filter(Boolean);
          const ccEmails = (msg.ccRecipients || []).map((r: any) => r.emailAddress?.address?.toLowerCase() || '').filter(Boolean);
          
          const matches = (
            // Direct email match
            fromEmail === contactEmail ||
            toEmails.includes(contactEmail) ||
            ccEmails.includes(contactEmail) ||
            // Lead number in subject
            subject.includes(leadNumber) ||
            // Lead number with L prefix
            subject.includes(`L${leadNumber}`) ||
            // Lead number with # prefix
            subject.includes(`#${leadNumber}`) ||
            subject.includes(`#L${leadNumber}`)
          );
          
          if (matches) {
            console.log(`✅ Email matches contact ${contact.name} (${contact.email}, L${leadNumber})`);
          }
          
          return matches;
        }) || [];

        // If we found matching contacts, create email records for each
        if (matchingContacts.length > 0) {
          console.log(`📝 Creating ${matchingContacts.length} email record(s) for this email`);
          for (const contact of matchingContacts) {
            const emailRecord = {
              message_id: msg.id,
              client_id: contact.id,
              thread_id: msg.conversationId,
              sender_name: msg.from?.emailAddress?.name,
              sender_email: msg.from?.emailAddress?.address,
              recipient_list: (msg.toRecipients || []).map((r: any) => r.emailAddress.address).join(', '),
              subject: msg.subject,
              body_html: processedBody,
              sent_at: msg.receivedDateTime,
              direction: isOutgoing ? 'outgoing' : 'incoming',
              attachments: msg.attachments ? msg.attachments.map((att: any) => ({
                id: att.id,
                name: att.name,
                contentType: att.contentType,
                size: att.size,
                contentBytes: att.contentBytes, // Base64 encoded content
                isInline: att.isInline
              })) : null,
            };
            
            console.log('📝 Email record:', {
              message_id: emailRecord.message_id,
              client_id: emailRecord.client_id,
              subject: emailRecord.subject,
              direction: emailRecord.direction,
              sender: emailRecord.sender_email,
              recipient: emailRecord.recipient_list
            });
            
            emailsToUpsert.push(emailRecord);
          }
        } else {
          console.log(`❌ No matching contacts found for email: "${msg.subject}"`);
        }
      }

      console.log(`📝 Prepared ${emailsToUpsert.length} email records for database`);

      // Upsert into database
      if (emailsToUpsert.length > 0) {
        console.log('💾 Inserting emails into database...');
        console.log('📊 Sample email record:', emailsToUpsert[0]);
        
        const { data: insertData, error: syncError } = await supabase
          .from('emails')
          .upsert(emailsToUpsert, { onConflict: 'message_id' })
          .select();
          
        if (syncError) {
          console.error('❌ Error syncing emails to database:', syncError);
          console.error('❌ Failed email records:', emailsToUpsert);
          throw new Error(`Failed to sync emails to database: ${syncError.message}`);
        }
        
        console.log(`✅ Successfully synced ${emailsToUpsert.length} emails to database`);
        console.log('📊 Insert result:', insertData?.length || 0, 'records inserted/updated');
      } else {
        console.log('📧 No emails to sync to database');
      }
      
    } catch (error: any) {
      console.error('❌ Error in syncAllEmails:', error);
      throw error;
    }
  };

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
        // Fetch new leads from 'leads' table
        const { data: newLeads, error: newLeadsError } = await supabase
          .from('leads')
          .select('id, name, email, lead_number, phone, created_at, topic');
        
        if (newLeadsError) {
          console.error('❌ Error fetching new leads:', newLeadsError);
        }

        // Fetch legacy leads from 'leads_lead' table
        let legacyLeads: any[] = [];
        let legacyLeadsError: any = null;
        
        try {
          const result = await supabase
            .from('leads_lead')
            .select('id, name, email, phone, cdate, category_id');
          legacyLeads = result.data || [];
          legacyLeadsError = result.error;
        } catch (error) {
          console.error('❌ Network error fetching legacy leads:', error);
          legacyLeadsError = error;
        }
        
        if (legacyLeadsError) {
          console.error('❌ Error fetching legacy leads:', legacyLeadsError);
          // Continue with empty array
        }

        // Combine all contacts
        const allContacts: Contact[] = [
          ...(newLeads || []).map(lead => ({
            ...lead,
            lead_type: 'new' as const
          })),
          ...(legacyLeads || []).map(lead => ({
            ...lead,
            lead_number: lead.id?.toString(), // Use lead ID as lead_number for legacy leads
            created_at: lead.cdate, // Use cdate as created_at for legacy leads
            topic: null, // Legacy leads don't have topic in this table
            lead_type: 'legacy' as const
          }))
        ];

        console.log(`👥 Fetched ${allContacts.length} total contacts (${newLeads?.length || 0} new + ${legacyLeads?.length || 0} legacy)`);
        
        const data = allContacts;
        
        // Fetch last message time and unread status for each contact
        // Only include contacts that have emails in the emails table
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
            
            // Only include contacts that have at least one email
            if (!lastMessage) {
              return null; // Filter out contacts without emails
            }
            
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

        // Filter out null contacts (those without emails)
        const contactsWithEmails = contactsWithLastMessage.filter(contact => contact !== null);
        
         // Sort contacts: unread first, then by last message time (newest first)
         const sortedContacts = contactsWithEmails.sort((a, b) => {
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
        
        console.log(`📧 Showing ${sortedContacts.length} contacts with emails (filtered from ${allContacts.length} total contacts)`);
        
        // Store all contacts for contact selector
        setAllContacts(allContacts);
        setFilteredAllContacts(allContacts); // Initialize filtered all contacts
        // Show only contacts with emails in main list
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
        contact.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        contact.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        contact.lead_number?.toLowerCase().includes(searchQuery.toLowerCase())
      );
      setFilteredContacts(filtered);
    }
  }, [searchQuery, contacts]);

  // Filter all contacts for contact selector
  const [filteredAllContacts, setFilteredAllContacts] = useState<Contact[]>([]);
  
  useEffect(() => {
    if (!searchAllContacts.trim()) {
      setFilteredAllContacts(allContacts);
    } else {
      const filtered = allContacts.filter(contact =>
        contact.name?.toLowerCase().includes(searchAllContacts.toLowerCase()) ||
        contact.email?.toLowerCase().includes(searchAllContacts.toLowerCase()) ||
        contact.lead_number?.toLowerCase().includes(searchAllContacts.toLowerCase())
      );
      setFilteredAllContacts(filtered);
    }
  }, [searchAllContacts, allContacts]);

  // Fetch email thread for selected contact
  useEffect(() => {
    const fetchEmailThread = async () => {
      if (!selectedContact) {
        setEmailThread([]);
        setIsLoading(false);
        return;
      }

      console.log(`🔄 Fetching email thread for contact: ${selectedContact.name} (ID: ${selectedContact.id})`);
      
      // Clear email thread immediately when contact changes
      setEmailThread([]);
      setIsLoading(true);
      
      try {
        // First, sync with Microsoft Graph to get latest emails (only if we have a selected contact)
        if (selectedContact && instance && accounts[0]) {
          try {
            let tokenResponse;
            try {
              tokenResponse = await instance.acquireTokenSilent({ ...loginRequest, account: accounts[0] });
            } catch (error) {
              tokenResponse = await instance.acquireTokenPopup({ ...loginRequest, account: accounts[0] });
            }
            
            console.log('🔄 Syncing all emails from Microsoft Graph...');
            await syncAllEmails(tokenResponse.accessToken);
            console.log('✅ Graph sync completed');
          } catch (syncError) {
            console.warn('Graph sync failed, continuing with database fetch:', syncError);
            // Continue with database fetch even if sync fails
          }
        }

        // Then fetch from database - ONLY emails for this specific contact
        console.log(`📧 Fetching emails from database for client_id: ${selectedContact.id}`);
        const { data, error } = await supabase
          .from('emails')
          .select('id, message_id, sender_name, sender_email, recipient_list, subject, body_html, sent_at, direction, attachments')
          .eq('client_id', selectedContact.id)
          .order('sent_at', { ascending: true });

        if (error) throw error;
        
        // Debug: Log the email data to see what we're getting
        console.log(`📧 Found ${data?.length || 0} emails for contact ${selectedContact.name} (ID: ${selectedContact.id})`);
        if (data && data.length > 0) {
          console.log('📧 Sample email:', {
            id: data[0].id,
            subject: data[0].subject,
            sender: data[0].sender_email,
            direction: data[0].direction,
            date: data[0].sent_at
          });
        } else {
          console.log('📧 No emails found for this contact');
        }
        
        setEmailThread(data || []);
      } catch (error) {
        console.error(`❌ Error fetching email thread for ${selectedContact.name}:`, error);
        // Only show toast for actual errors, not when no emails found
        if (error && typeof error === 'object' && 'message' in error) {
          toast.error(`Failed to load emails for ${selectedContact.name}`);
        }
        setEmailThread([]); // Clear thread on error
      } finally {
        setIsLoading(false);
      }
    };

    fetchEmailThread();
  }, [selectedContact, instance, accounts]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [emailThread]);

  const handleContactSelect = (contact: Contact) => {
    console.log(`👤 Selecting contact: ${contact.name} (ID: ${contact.id})`);
    
    // Clear previous contact's data immediately
    setEmailThread([]);
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

  const handleContactSelectForNewEmail = (contact: Contact) => {
    console.log(`📧 Selecting contact for new email: ${contact.name} (ID: ${contact.id})`);
    
    // Set the selected contact
    setSelectedContact(contact);
    
    // Set default subject format: Lead number - client name - Category
    const category = contact.topic || 'General';
    setSubject(`${contact.lead_number} - ${contact.name} - ${category}`);
    
    // Clear compose form
    setNewMessage('');
    setAttachments([]);
    
    // Close contact selector and open compose
    setShowContactSelector(false);
    setShowCompose(true);
    
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

      // Prepare email content with signature for database storage
      const baseEmailContent = newMessage;
      const emailContentWithSignature = await appendEmailSignature(baseEmailContent);
      
      // Create email record in database
      const { data: emailRecord, error: dbError } = await supabase
        .from('emails')
        .insert({
          client_id: selectedContact.id,
          message_id: `email_${Date.now()}`,
          sender_name: senderName,
          sender_email: senderEmail,
          recipient_list: selectedContact.email,
          subject: subject,
          body_html: emailContentWithSignature,
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

      // Send email via Microsoft Graph API
      try {
        if (!instance || !accounts[0]) {
          throw new Error('Not authenticated with Microsoft Graph');
        }

        // Acquire access token
        let tokenResponse;
        try {
          tokenResponse = await instance.acquireTokenSilent({ ...loginRequest, account: accounts[0] });
        } catch (error) {
          tokenResponse = await instance.acquireTokenPopup({ ...loginRequest, account: accounts[0] });
        }
        const accessToken = tokenResponse.accessToken;

        // Convert attachments to base64 if any
        const emailAttachments = [];
        for (const file of attachments) {
          const base64 = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => {
              const base64String = (reader.result as string).split(',')[1];
              resolve(base64String);
            };
            reader.readAsDataURL(file);
          });
          
          emailAttachments.push({
            '@odata.type': '#microsoft.graph.fileAttachment',
            name: file.name,
            contentType: file.type,
            contentBytes: base64,
          });
        }

        // Prepare email message with signature
        const baseEmailBody = `<p>${newMessage.replace(/\n/g, '<br>')}</p>`;
        const emailBodyWithSignature = await appendEmailSignature(baseEmailBody);
        
        const draftMessage = {
          subject: subject,
          body: { contentType: 'HTML', content: emailBodyWithSignature },
          toRecipients: [{ emailAddress: { address: selectedContact.email } }],
          attachments: emailAttachments,
        };

        // Create draft
        const draftRes = await fetch('https://graph.microsoft.com/v1.0/me/messages', {
          method: 'POST',
          headers: { 
            Authorization: `Bearer ${accessToken}`, 
            'Content-Type': 'application/json' 
          },
          body: JSON.stringify(draftMessage),
        });

        if (!draftRes.ok) {
          const errorText = await draftRes.text();
          console.error('Draft creation failed:', errorText);
          throw new Error('Failed to create email draft');
        }

        const createdDraft = await draftRes.json();
        const messageId = createdDraft.id;
        
        if (!messageId) {
          throw new Error('Could not get message ID from draft');
        }

        // Send draft
        const sendRes = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${messageId}/send`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (!sendRes.ok) {
          const errorText = await sendRes.text();
          console.error('Email sending failed:', errorText);
          throw new Error('Failed to send email');
        }

        console.log('Email successfully sent to:', selectedContact.email);
        console.log('Subject:', subject);
        console.log('Body:', newMessage);
        
      } catch (emailError) {
        console.error('Email sending error:', emailError);
        // Even if email sending fails, we still save to database
        toast.error('Email saved to database but sending failed. Please try again.');
      }

      // Add the new email to the thread
      const newEmail: EmailMessage = {
        id: emailRecord.id.toString(),
        subject: subject,
        body_html: emailContentWithSignature,
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
      toast.success('Email sent successfully and saved to database');
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

  const downloadAttachment = (attachment: any) => {
    try {
      if (!attachment.contentBytes) {
        toast.error('Attachment content not available');
        return;
      }

      // Convert base64 to blob
      const byteCharacters = atob(attachment.contentBytes);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: attachment.contentType || 'application/octet-stream' });

      // Create download link
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = attachment.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toast.success(`Downloaded ${attachment.name}`);
    } catch (error) {
      console.error('Error downloading attachment:', error);
      toast.error('Failed to download attachment');
    }
  };

  if (!isOpen) return null;

  return (
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
          <div className={`${isMobile ? (showChat ? 'hidden' : 'w-full') : 'w-80'} border-r border-gray-200 flex flex-col`}>
            {/* Mobile Contacts Header */}
            {isMobile && !showChat && (
              <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-white">
                <h2 className="text-lg font-semibold text-gray-900">Contacts</h2>
                {selectedContact && (
                  <button
                    onClick={() => setShowChat(true)}
                    className="btn btn-outline btn-sm"
                    title="View email thread"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    Chat
                  </button>
                )}
              </div>
            )}
            
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

            {/* New Email Button */}
            <div className="p-3 md:p-4 border-t border-gray-200 bg-gray-50">
              <button
                onClick={() => setShowContactSelector(true)}
                className="w-full btn btn-outline btn-primary btn-sm"
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                New Email
              </button>
            </div>
          </div>

          {/* Right Panel - Email Thread */}
          <div className={`${isMobile ? (showChat ? 'w-full' : 'hidden') : 'flex-1'} flex flex-col`}>
            {selectedContact ? (
              <>
                {/* Mobile Chat Header - Only visible on mobile when in chat */}
                {isMobile && (
                  <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-white">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setShowChat(false)}
                        className="btn btn-ghost btn-circle btn-sm"
                        title="Back to contacts"
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

                {/* Desktop Chat Header */}
                {!isMobile && (
                  <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-white">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-semibold">
                        {selectedContact.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900">
                          {selectedContact.name}
                        </h3>
                        <p className="text-sm text-gray-500">
                          {selectedContact.lead_number}
                        </p>
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
                        <p className="text-lg font-medium">No emails available</p>
                        <p className="text-sm">No emails found for {selectedContact.name}. Try syncing or send a new email.</p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-8">
                      {emailThread.map((message, index) => (
                        <div key={message.id} className="border-b border-gray-200 pb-6 last:border-b-0">
                          {/* Email Header with Label */}
                          <div className="flex items-center justify-between mb-4">
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
                                  {message.direction === 'outgoing' ? message.sender_name : selectedContact.name}
                                </div>
                                <div className="text-xs text-gray-500">
                                  {formatDate(message.sent_at)}
                                </div>
                              </div>
                            </div>
                          </div>
                          
                          {/* Complete Email Content */}
                          <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
                            {/* Email Header */}
                            <div className="mb-4 pb-4 border-b border-gray-200">
                              <div className="text-sm text-gray-600 space-y-1">
                                <div><strong>From:</strong> {message.sender_name} &lt;{message.sender_email}&gt;</div>
                                <div><strong>To:</strong> {message.recipient_list || (message.direction === 'outgoing' ? `${selectedContact.name} <${selectedContact.email}>` : `eliran@lawoffice.org.il`)}</div>
                                <div><strong>Date:</strong> {formatDate(message.sent_at)}</div>
                                {message.subject && (
                                  <div><strong>Subject:</strong> {message.subject}</div>
                                )}
                              </div>
                            </div>
                            
                            {/* Complete Email Body - Full Content */}
                            <div className="email-content">
                              {message.body_html ? (
                                <div 
                                  dangerouslySetInnerHTML={{ __html: cleanMicrosoftDiagnosticEmail(message.body_html) }}
                                  className="prose prose-sm max-w-none email-body"
                                  style={{
                                    fontFamily: 'inherit',
                                    lineHeight: '1.6',
                                    color: '#374151'
                                  }}
                                />
                              ) : (
                                <div className="text-gray-500 italic p-4 bg-gray-50 rounded">
                                  No email content available
                                </div>
                              )}
                            </div>
                            
                            {/* Attachments */}
                            {message.attachments && message.attachments.length > 0 && (
                              <div className="mt-6 pt-4 border-t border-gray-200">
                                <div className="text-sm font-medium text-gray-700 mb-3">Attachments:</div>
                                <div className="space-y-2">
                                  {message.attachments.map((attachment, idx) => (
                                    <div key={idx} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                                      <PaperClipIcon className="w-5 h-5 text-gray-400" />
                                      <div className="flex-1">
                                        <div className="font-medium text-gray-900">{attachment.name}</div>
                                        {attachment.size && (
                                          <div className="text-sm text-gray-500">
                                            {(attachment.size / 1024).toFixed(1)} KB
                                          </div>
                                        )}
                                        {attachment.contentType && (
                                          <div className="text-xs text-gray-400">
                                            {attachment.contentType}
                                          </div>
                                        )}
                                      </div>
                                      {attachment.contentBytes && (
                                        <button
                                          onClick={() => downloadAttachment(attachment)}
                                          className="btn btn-sm btn-outline btn-primary"
                                          title="Download attachment"
                                        >
                                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                          </svg>
                                          Download
                                        </button>
                                      )}
                                    </div>
                                  ))}
                                </div>
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

      {/* Contact Selector Modal */}
      {showContactSelector && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[10000]">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4 max-h-[80vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Select Contact</h2>
              <button
                onClick={() => setShowContactSelector(false)}
                className="btn btn-ghost btn-sm btn-circle"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Search */}
            <div className="p-4 border-b border-gray-200">
              <input
                type="text"
                placeholder="Search contacts..."
                className="input input-bordered w-full"
                value={searchAllContacts}
                onChange={(e) => setSearchAllContacts(e.target.value)}
              />
            </div>

            {/* Contacts List */}
            <div className="flex-1 overflow-y-auto p-4">
              {filteredAllContacts.length === 0 ? (
                <div className="text-center text-gray-500 py-8">
                  <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  </div>
                  <p className="text-lg font-medium">No contacts found</p>
                  <p className="text-sm">Try a different search term</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredAllContacts.map((contact) => (
                    <div
                      key={contact.id}
                      onClick={() => handleContactSelectForNewEmail(contact)}
                      className="p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-semibold">
                          {contact.name?.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-gray-900 truncate">
                            {contact.name}
                          </div>
                          <div className="text-sm text-gray-500 truncate">
                            {contact.email || 'No email'}
                          </div>
                          <div className="text-xs text-gray-400">
                            Lead: {contact.lead_number}
                          </div>
                        </div>
                        <div className="text-xs text-gray-400">
                          {contact.lead_type === 'legacy' ? 'Legacy' : 'New'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-gray-200">
              <button
                onClick={() => setShowContactSelector(false)}
                className="w-full btn btn-outline"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EmailThreadModal; 