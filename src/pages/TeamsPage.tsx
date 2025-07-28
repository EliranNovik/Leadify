import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useMsal } from '@azure/msal-react';
import { loginRequest } from '../msalConfig';
import { format } from 'date-fns';
import { MagnifyingGlassIcon, PaperAirplaneIcon } from '@heroicons/react/24/outline';
import { ChatBubbleLeftRightIcon } from '@heroicons/react/24/outline';
import { teamsCallingApi } from '../lib/teamsCallingApi';
import toast from 'react-hot-toast';

const placeholderAvatar = 'https://ui-avatars.com/api/?name=User&background=random';

// Emoji mapping for common Teams emoji IDs
const teamsEmojiMap: Record<string, string> = {
  '1f600_grinning': '😀',
  '1f601_grin': '😁',
  '1f602_joy': '😂',
  '1f603_smile': '😃',
  '1f604_smileeyes': '😄',
  '1f605_sweat_smile': '😅',
  '1f606_laughing': '😆',
  '1f609_wink': '😉',
  '1f60a_blush': '😊',
  '1f60b_yum': '😋',
  '1f60d_heart_eyes': '😍',
  '1f618_facethrowingakiss': '😘',
  '1f617_kissing': '😗',
  '1f619_kissing_smiling_eyes': '😙',
  '1f61a_kissing_closed_eyes': '😚',
  '1f642_slight_smile': '🙂',
  '1f643_upside_down': '🙃',
  // Add more as needed
};

// Utility to strip <p> tags and decode basic HTML entities from Teams messages
function cleanTeamsMessage(html: string): string {
  if (!html) return '';
  // Replace <emoji id="..."> with Unicode emoji
  let text = html.replace(/<emoji[^>]*id=["']([^"']+)["'][^>]*>(.*?)<\/emoji>/gi, (match, id) => {
    return teamsEmojiMap[id] || '';
  });
  // Remove <p> and </p>
  text = text.replace(/<\/?p[^>]*>/gi, '');
  // Remove <br> tags
  text = text.replace(/<br\s*\/?\s*>/gi, '\n');
  // Remove <systemEventMessage> and similar
  text = text.replace(/<[^>]+>/g, '');
  // Decode basic HTML entities
  text = text.replace(/&nbsp;/g, ' ')
             .replace(/&amp;/g, '&')
             .replace(/&lt;/g, '<')
             .replace(/&gt;/g, '>')
             .replace(/&quot;/g, '"')
             .replace(/&#39;/g, "'");
  // Remove leading/trailing whitespace
  return text.trim();
}

// Utility to get initials from a display name (English only)
function getInitials(name: string): string {
  if (!name) return '';
  // Split by space and filter for English words only
  const words = name.trim().split(' ').filter(w => /^[A-Za-z]/.test(w));
  if (words.length === 0) return name[0].toUpperCase();
  if (words.length === 1) return words[0][0].toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

// Utility to determine if a message is a real user message
function isRealUserMessage(msg: any) {
  // Must have a user sender, not a system/bot
  const isUser = msg.from && msg.from.user && typeof msg.from.user.id === 'string';
  // Must have a valid timestamp (not in the future, not 1970, not empty)
  const ts = new Date(msg.createdDateTime);
  const now = new Date();
  const isValidTime = ts > new Date('1971-01-01T00:00:00Z') && ts < new Date(now.getTime() + 5 * 60 * 1000); // not 1970, not in the future
  // Optionally, filter out known test/placeholder content
  const isNotPlaceholder = !(msg.body && typeof msg.body.content === 'string' && msg.body.content.toLowerCase().includes('test'));
  return isUser && isValidTime && isNotPlaceholder;
}

const TeamsPage: React.FC = () => {
  const { instance, accounts } = useMsal();
  const [contacts, setContacts] = useState<any[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedContact, setSelectedContact] = useState<any>(null);
  const [messageInput, setMessageInput] = useState('');
  const [chatId, setChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [contactLastActivity, setContactLastActivity] = useState<Record<string, string>>({});
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const hasAutoSelected = useRef(false);
  const [activityLoaded, setActivityLoaded] = useState(false);
  
  // Calling state
  const [currentCall, setCurrentCall] = useState<any>(null);
  const [isInitiatingCall, setIsInitiatingCall] = useState(false);
  const [isCallActive, setIsCallActive] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  // Auto-scroll to bottom of messages
  const scrollToBottom = () => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  };

  // Scroll to bottom when messages change or contact changes
  useEffect(() => {
    // Small delay to ensure DOM is updated
    const timer = setTimeout(scrollToBottom, 100);
    return () => clearTimeout(timer);
  }, [messages, selectedContact]);

  // Helper to get last activity timestamp for a contact
  const getContactLastActivity = (contactId: string): string => {
    const stored = localStorage.getItem(`teams_contact_${contactId}_last_activity`);
    return stored || '1970-01-01T00:00:00Z';
  };

  // Helper to check if there's any meaningful activity data
  const hasAnyActivity = (): boolean => {
    return contacts.some(contact => {
      const activity = getContactLastActivity(contact.userId || contact.id);
      return activity !== '1970-01-01T00:00:00Z';
    });
  };

  // Helper to update contact's last activity
  const updateContactLastActivity = (contactId: string, timestamp: string) => {
    localStorage.setItem(`teams_contact_${contactId}_last_activity`, timestamp);
    setContactLastActivity(prev => ({ ...prev, [contactId]: timestamp }));
  };

  // Sort contacts by most recent activity
  const sortedContacts = useMemo(() => {
    return contacts
      .filter(contact => {
        const contactNameLower = contact.displayName?.toLowerCase() || '';
        const contactEmailLower = contact.mail?.toLowerCase() || '';
        const contactUpnLower = contact.userPrincipalName?.toLowerCase() || '';
        const searchLower = searchQuery.toLowerCase();
        return contactNameLower.includes(searchLower) || 
               contactEmailLower.includes(searchLower) || 
               contactUpnLower.includes(searchLower);
      })
      .sort((a, b) => {
        const aLastActivity = getContactLastActivity(a.userId || a.id);
        const bLastActivity = getContactLastActivity(b.userId || b.id);
        return new Date(bLastActivity).getTime() - new Date(aLastActivity).getTime();
      });
  }, [contacts, searchQuery, contactLastActivity]);

  // Fetch contacts (team members)
  useEffect(() => {
    const fetchTeamsContacts = async () => {
      setLoadingContacts(true);
      setError(null);
      try {
        if (!instance || !accounts[0]) throw new Error('Not authenticated');
        const tokenResponse = await instance.acquireTokenSilent({ ...loginRequest, account: accounts[0] });
        const accessToken = tokenResponse.accessToken;
        // Hardcoded team ID (replace with your actual team ID)
        const teamId = 'bbe4a9c2-4aba-4a62-ad15-151ca0376c85';
        const membersRes = await fetch(`https://graph.microsoft.com/v1.0/teams/${teamId}/members`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        const membersJson = await membersRes.json();
        if (!membersJson.value) throw new Error('No members found');
        setContacts(membersJson.value);
        setSelectedContact(membersJson.value[0]);
      } catch (err: any) {
        setError(err.message || 'Failed to fetch contacts');
      }
      setLoadingContacts(false);
    };
    fetchTeamsContacts();
    // eslint-disable-next-line
  }, []);

  // Fetch or create chat and load messages when contact changes
  useEffect(() => {
    const fetchOrCreateChat = async () => {
      setMessages([]);
      setChatId(null);
      setChatError(null);
      if (!selectedContact) return;
      setLoadingMessages(true);
      try {
        if (!instance || !accounts[0]) throw new Error('Not authenticated');
        const tokenResponse = await instance.acquireTokenSilent({ ...loginRequest, account: accounts[0] });
        const accessToken = tokenResponse.accessToken;
        // 1. Find existing 1:1 chat with this user
        const chatsRes = await fetch("https://graph.microsoft.com/v1.0/me/chats?$filter=chatType eq 'oneOnOne'", {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        const chatsJson = await chatsRes.json();
        let chat = null;
        if (chatsJson.value && Array.isArray(chatsJson.value)) {
          for (const c of chatsJson.value) {
            // Fetch chat members for each chat
            const membersRes = await fetch(`https://graph.microsoft.com/v1.0/chats/${c.id}/members`, {
              headers: { Authorization: `Bearer ${accessToken}` }
            });
            const membersJson = await membersRes.json();
            if (membersJson.value && membersJson.value.some((m: any) => m.email === selectedContact.email || m.userId === selectedContact.userId)) {
              chat = c;
              break;
            }
          }
        }
        // 2. If not found, create a new chat
        if (!chat) {
          // Ensure both the signed-in user and the selected contact are included
          const currentUserGraphId = accounts[0]?.idTokenClaims?.oid;
          const contactUserId = selectedContact.userId || selectedContact.id;
          const members = [
            {
              '@odata.type': '#microsoft.graph.aadUserConversationMember',
              roles: ['owner'],
              'user@odata.bind': `https://graph.microsoft.com/v1.0/users('${contactUserId}')`
            },
            {
              '@odata.type': '#microsoft.graph.aadUserConversationMember',
              roles: ['owner'],
              'user@odata.bind': `https://graph.microsoft.com/v1.0/users('${currentUserGraphId}')`
            }
          ];
          const chatBody = {
            chatType: 'oneOnOne',
            members
          };
          console.log('Creating chat with body:', JSON.stringify(chatBody, null, 2));
          const createRes = await fetch('https://graph.microsoft.com/v1.0/chats', {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(chatBody)
          });
          if (!createRes.ok) {
            const errorText = await createRes.text();
            console.error('Failed to create chat:', errorText);
            setChatError('Failed to create chat: ' + errorText);
            setLoadingMessages(false);
            return;
          }
          chat = await createRes.json();
        }
        if (!chat.id) {
          setChatError('No chat ID returned from Microsoft Graph.');
          setLoadingMessages(false);
          return;
        }
        setChatId(chat.id);
        // 3. Fetch messages
        const messagesRes = await fetch(`https://graph.microsoft.com/v1.0/chats/${chat.id}/messages`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        const messagesJson = await messagesRes.json();
        setMessages(messagesJson.value || []);
      } catch (err: any) {
        setChatError(err.message || 'Failed to load chat');
      }
      setLoadingMessages(false);
    };
    fetchOrCreateChat();
    // eslint-disable-next-line
  }, [selectedContact]);

  // Helper to fetch all paginated messages
  async function fetchAllMessages(url: string, token: string, all: any[] = []) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    const combined = [...all, ...(data.value || [])];
    if (data['@odata.nextLink']) {
      return fetchAllMessages(data['@odata.nextLink'], token, combined);
    }
    return combined;
  }

  // Poll for new messages every 3 seconds when a chat is open, only if window is focused
  useEffect(() => {
    if (!chatId || !instance || !accounts[0]) return;
    let isMounted = true;
    let interval: NodeJS.Timeout;
    const myUserId = accounts[0]?.idTokenClaims?.oid;

    const fetchMessages = async () => {
      try {
        if (document.visibilityState !== 'visible') return;
        const tokenResponse = await instance.acquireTokenSilent({ ...loginRequest, account: accounts[0] });
        const accessToken = tokenResponse.accessToken;
        console.log('[Teams] Polling messages for chatId:', chatId, 'selectedContact:', selectedContact);
        const allMessages = await fetchAllMessages(`https://graph.microsoft.com/v1.0/chats/${chatId}/messages`, accessToken);
        // Sort chronologically
        const sorted = allMessages.sort((a, b) =>
          new Date(a.createdDateTime).getTime() - new Date(b.createdDateTime).getTime()
        );
        if (isMounted) setMessages(sorted);
        console.log('[Teams] Fetched', sorted.length, 'messages at', new Date().toISOString());
        
        // Log all messages for inspection
        if (sorted.length > 0) {
          console.log('[Teams] --- Message Dump for Inspection ---');
          sorted.forEach((msg: any, idx: number) => {
            console.log(`Msg #${idx + 1}: id=${msg.id}, from=${msg.from?.user?.id || msg.from?.application?.displayName || 'SYSTEM'}, time=${msg.createdDateTime}, content="${msg.body?.content?.slice(0, 100)}"`);
          });
          console.log('[Teams] --- End Message Dump ---');
        }
        
        // Update contact's last activity using only real user messages
        if (sorted.length > 0 && selectedContact) {
          const realMessages = sorted.filter(isRealUserMessage);
          if (realMessages.length > 0) {
            const lastRealMsg = realMessages[realMessages.length - 1];
            const contactId = selectedContact.userId || selectedContact.id;
            updateContactLastActivity(contactId, lastRealMsg.createdDateTime);
          }
        }
        
        if (Array.isArray(sorted)) {
          console.log('[Teams] Message IDs and timestamps:');
          sorted.forEach((msg: any) => {
            console.log(`  - id: ${msg.id}, created: ${msg.createdDateTime}, from: ${msg.from?.user?.id}`);
          });
        }
      } catch (err) {
        console.error('[Teams] Polling error:', err);
      }
    };

    // Initial fetch
    fetchMessages();
    // Poll every 3 seconds, only if window is focused
    interval = setInterval(fetchMessages, 3000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [chatId, instance, accounts, selectedContact]);

  // Send a message
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageInput.trim() || !chatId) return;
    setSending(true);
    setChatError(null);
    try {
      if (!instance || !accounts[0]) throw new Error('Not authenticated');
      const tokenResponse = await instance.acquireTokenSilent({ ...loginRequest, account: accounts[0] });
      const accessToken = tokenResponse.accessToken;
      const res = await fetch(`https://graph.microsoft.com/v1.0/chats/${chatId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: { contentType: 'html', content: messageInput }
        })
      });
      const sentMsg = await res.json();
      console.log('[Teams] Sent message to chatId:', chatId, sentMsg);
      if (!res.ok) {
        console.error('[Teams] Error sending message:', sentMsg);
        setChatError(sentMsg.error?.message || 'Failed to send message');
      } else {
        // Update contact's last activity when sending a message
        if (selectedContact) {
          const contactId = selectedContact.userId || selectedContact.id;
          updateContactLastActivity(contactId, new Date().toISOString());
        }
      }
      setMessageInput('');
      // Do not optimistically add message; rely on polling
    } catch (err: any) {
      setChatError(err.message || 'Failed to send message');
      console.error('[Teams] Send message error:', err);
    }
    setSending(false);
  };

  // Calling functions
  const handleInitiateCall = async (contact: any, callType: 'audio' | 'video' = 'audio') => {
    if (!contact || !instance || !accounts[0]) return;
    
    setIsInitiatingCall(true);
    try {
      const targetUserId = contact.userId || contact.id;
      
      if (!targetUserId) {
        toast.error('Unable to get user ID for calling');
        return;
      }

      const callResult = await teamsCallingApi.initiateCall(targetUserId, callType);
      setCurrentCall(callResult.data);
      setIsCallActive(true);
      toast.success(`Initiating ${callType} call with ${contact.displayName}...`);
    } catch (err: any) {
      console.error('[Teams] Call initiation error:', err);
      toast.error(err.message || 'Failed to initiate call');
    } finally {
      setIsInitiatingCall(false);
    }
  };

  const handleEndCall = async () => {
    if (!currentCall || !instance || !accounts[0]) return;
    
    try {
      await teamsCallingApi.endCall(currentCall.id);
      setCurrentCall(null);
      setIsCallActive(false);
      setIsMuted(false);
      toast.success('Call ended');
    } catch (err: any) {
      toast.error(err.message || 'Failed to end call');
      console.error('[Teams] End call error:', err);
    }
  };

  const handleToggleMute = async () => {
    if (!currentCall || !instance || !accounts[0]) return;
    
    try {
      await teamsCallingApi.muteCall(currentCall.id, !isMuted);
      setIsMuted(!isMuted);
      toast.success(isMuted ? 'Unmuted' : 'Muted');
    } catch (err: any) {
      toast.error(err.message || 'Failed to toggle mute');
      console.error('[Teams] Toggle mute error:', err);
    }
  };

  // Load contact last activity from localStorage on component mount
  useEffect(() => {
    const loadContactActivity = () => {
      const activity: Record<string, string> = {};
      contacts.forEach(contact => {
        const contactId = contact.userId || contact.id;
        const stored = localStorage.getItem(`teams_contact_${contactId}_last_activity`);
        if (stored) {
          activity[contactId] = stored;
        }
      });
      setContactLastActivity(activity);
      setActivityLoaded(true);
    };
    
    if (contacts.length > 0) {
      loadContactActivity();
    }
  }, [contacts]);

  // Simple auto-selection: always select the first contact from sortedContacts
  useEffect(() => {
    if (sortedContacts.length > 0 && !selectedContact && !loadingContacts && !hasAutoSelected.current) {
      // Check if the first contact has actual activity (not the default 1970 timestamp)
      const firstContact = sortedContacts[0];
      const firstContactActivity = getContactLastActivity(firstContact.userId || firstContact.id);
      const hasActualActivity = new Date(firstContactActivity) > new Date('1970-01-01T00:00:00Z');
      
      if (hasActualActivity) {
        console.log(`[Teams] Auto-selecting first contact with activity: ${firstContact.displayName} (${firstContactActivity})`);
        setSelectedContact(firstContact);
      } else {
        console.log('[Teams] No contacts have recent activity - not auto-selecting any contact');
      }
      
      hasAutoSelected.current = true;
    }
  }, [sortedContacts, selectedContact, loadingContacts]);

  // Remove the MSAL instance setting since we're using backend client credentials

  return (
    <div className="flex flex-col md:flex-row h-[calc(100vh-5rem)] min-h-[500px] w-full bg-base-100">
      {/* Mobile: Contact List View */}
      <div className={`md:hidden ${selectedContact ? 'hidden' : 'block'} w-full h-full bg-base-100`}>
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="bg-primary text-white p-4 shadow-lg">
            <div className="flex items-center justify-between">
              <h1 className="text-xl font-bold">Teams</h1>
              <div className="flex items-center gap-2">
                <button className="btn btn-ghost btn-sm text-white">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </button>
                <button className="btn btn-ghost btn-sm text-white">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
          
          {/* Search */}
          <div className="p-4 border-b border-base-200">
            <div className="relative">
              <input
                type="text"
                placeholder="Search team..."
                className="input input-bordered w-full pl-10 bg-base-200"
                disabled={loadingContacts}
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
              <svg className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-base-content/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>
          
          {/* Contact List */}
          <div className="flex-1 overflow-y-auto">
            {loadingContacts && (
              <div className="flex items-center justify-center h-32">
                <div className="loading loading-spinner loading-md"></div>
              </div>
            )}
            {error && (
              <div className="p-6 text-center text-error">
                <svg className="w-12 h-12 mx-auto mb-4 text-error/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                <p className="text-sm">{error}</p>
              </div>
            )}
            {!loadingContacts && !error && sortedContacts.map(contact => (
              <button
                key={contact.id}
                className="flex items-center gap-4 w-full px-4 py-4 hover:bg-base-200/50 transition-colors border-b border-base-200/30"
                onClick={() => setSelectedContact(contact)}
              >
                <div className="avatar">
                  <div className="w-14 h-14 rounded-full flex items-center justify-center bg-gradient-to-br from-primary to-primary/80">
                    <span className="text-lg font-bold text-white">{getInitials(contact.displayName)}</span>
                  </div>
                </div>
                <div className="flex-1 text-left">
                  <div className="font-semibold text-base-content text-lg">{contact.displayName}</div>
                  <div className="text-sm text-base-content/60 mt-1">{contact.email || contact.userPrincipalName || ''}</div>
                </div>
                <div className="flex flex-col items-end">
                  <svg className="w-5 h-5 text-base-content/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Mobile: Chat View */}
      <div className={`md:hidden ${selectedContact ? 'block' : 'hidden'} w-full h-full bg-base-100 flex flex-col`}>
        {/* Chat Header */}
        <div className="bg-primary text-white p-4 shadow-lg">
          <div className="flex items-center gap-3">
            <button 
              className="btn btn-ghost btn-sm text-white"
              onClick={() => setSelectedContact(null)}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            {selectedContact && (
              <>
                <div className="avatar">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center bg-white/20">
                    <span className="text-sm font-bold text-white">{getInitials(selectedContact.displayName)}</span>
                  </div>
                </div>
                <div className="flex-1">
                  <div className="font-bold text-lg">{selectedContact.displayName}</div>
                  <div className="text-xs text-white/80">{selectedContact.email || selectedContact.userPrincipalName || ''}</div>
                </div>
              </>
            )}
                         <div className="flex items-center gap-2">
               {isCallActive ? (
                 <>
                   <button 
                     className="btn btn-ghost btn-sm text-white"
                     onClick={handleToggleMute}
                     title={isMuted ? 'Unmute' : 'Mute'}
                   >
                     <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={isMuted ? "M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" : "M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"} />
                     </svg>
                   </button>
                   <button 
                     className="btn btn-error btn-sm text-white"
                     onClick={handleEndCall}
                     title="End Call"
                   >
                     <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                     </svg>
                   </button>
                 </>
               ) : (
                 <>
                   <button 
                     className="btn btn-ghost btn-sm text-white"
                     onClick={() => handleInitiateCall(selectedContact, 'audio')}
                     disabled={isInitiatingCall}
                     title="Audio Call"
                   >
                     {isInitiatingCall ? (
                       <div className="loading loading-spinner loading-xs"></div>
                     ) : (
                       <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                         <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                       </svg>
                     )}
                   </button>
                   <button 
                     className="btn btn-ghost btn-sm text-white"
                     onClick={() => handleInitiateCall(selectedContact, 'video')}
                     disabled={isInitiatingCall}
                     title="Video Call"
                   >
                     {isInitiatingCall ? (
                       <div className="loading loading-spinner loading-xs"></div>
                     ) : (
                       <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                         <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                       </svg>
                     )}
                   </button>
                 </>
               )}
             </div>
          </div>
        </div>
        
        {/* Call Status Indicator */}
        {isCallActive && (
          <div className="bg-primary/10 border-b border-primary/20 p-3">
            <div className="flex items-center justify-center gap-2 text-primary">
              <div className="w-2 h-2 bg-primary rounded-full animate-pulse"></div>
              <span className="text-sm font-medium">Call in progress with {selectedContact?.displayName}</span>
              {isMuted && <span className="text-xs opacity-70">(Muted)</span>}
            </div>
          </div>
        )}
        
        {/* Chat Messages */}
        <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4 space-y-3 bg-base-100">
          {loadingMessages && (
            <div className="flex items-center justify-center h-32">
              <div className="loading loading-spinner loading-md"></div>
            </div>
          )}
          {chatError && (
            <div className="text-error text-center mt-8 p-4">
              <svg className="w-12 h-12 mx-auto mb-4 text-error/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              <p className="text-sm">{chatError}</p>
            </div>
          )}
          {!loadingMessages && !chatError && (() => {
            const realMessages = messages.filter(isRealUserMessage);
            if (realMessages.length === 0) {
              return (
                <div className="text-center mt-12 p-4">
                  <div className="w-16 h-16 bg-base-200 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8 text-base-content/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  </div>
                  <p className="text-base-content/60 text-lg font-medium">Start a conversation</p>
                  <p className="text-base-content/40 text-sm mt-2">Send a message to {selectedContact?.displayName || 'this contact'}</p>
                </div>
              );
            }
            let lastDate: string | null = null;
            return realMessages.map((msg, idx) => {
              const myUserId = accounts[0]?.idTokenClaims?.oid;
              const isMe = msg.from && msg.from.user && myUserId && (msg.from.user.id === myUserId);
              const msgDateObj = new Date(msg.createdDateTime || msg.lastModifiedDateTime || msg.id);
              const msgDateStr = format(msgDateObj, 'MMMM d, yyyy');
              const showDate = lastDate !== msgDateStr;
              lastDate = msgDateStr;
              return (
                <React.Fragment key={msg.id}>
                  {showDate && (
                    <div className="w-full flex justify-center my-4">
                      <span className="bg-base-200 text-base-content/70 px-3 py-1 rounded-full text-xs font-medium">{msgDateStr}</span>
                    </div>
                  )}
                  <div className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}> 
                    <div
                      className={`max-w-[75%] px-4 py-3 rounded-2xl shadow-sm ${isMe ? 'bg-primary text-white rounded-br-md' : 'bg-base-200 text-base-content rounded-bl-md'}`}
                      style={{ wordBreak: 'break-word' }}
                    >
                      <p className="text-sm leading-relaxed">{cleanTeamsMessage(msg.body?.content || msg.body || '')}</p>
                      <div className="flex items-center justify-end mt-1">
                        <span className="text-xs opacity-70">{msgDateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                    </div>
                  </div>
                </React.Fragment>
              );
            });
          })()}
        </div>
        
        {/* Message Input */}
        <div className="p-4 border-t border-base-200 bg-base-100">
          <form className="flex gap-3" onSubmit={handleSendMessage}>
            <input
              type="text"
              className="input input-bordered flex-1 bg-base-200 border-0 focus:bg-white"
              placeholder="Type a message..."
              value={messageInput}
              onChange={e => setMessageInput(e.target.value)}
              disabled={!selectedContact || sending}
            />
            <button 
              className="btn btn-primary btn-circle" 
              type="submit" 
              disabled={!selectedContact || sending || !messageInput.trim()}
            >
              {sending ? (
                <div className="loading loading-spinner loading-sm"></div>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              )}
            </button>
          </form>
        </div>
      </div>

      {/* Desktop: Original Layout */}
      <div className="hidden md:flex w-full h-full">
        {/* Sidebar */}
        <aside className="w-80 max-w-xs bg-base-100 border-r border-base-300 flex flex-col">
          <div className="p-4 border-b border-base-300">
            <input
              type="text"
              placeholder="Search team..."
              className="input input-bordered w-full"
              disabled={loadingContacts}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="flex-1 overflow-y-auto">
            {loadingContacts && <div className="p-6 text-center text-base-content/60">Loading contacts...</div>}
            {error && <div className="p-6 text-center text-error">{error}</div>}
            {!loadingContacts && !error && sortedContacts
              .map(contact => (
                <button
                  key={contact.id}
                  className={`flex items-center gap-3 w-full px-4 py-3 hover:bg-primary/10 transition text-left ${selectedContact && selectedContact.id === contact.id ? 'bg-primary/10' : ''}`}
                  onClick={() => setSelectedContact(contact)}
                >
                  <div className="avatar">
                    <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ backgroundColor: '#3b28c7' }}>
                      <span className="block w-full text-center text-xl font-bold text-white">{getInitials(contact.displayName)}</span>
                    </div>
                  </div>
                  <div>
                    <div className="font-semibold text-base-content">{contact.displayName}</div>
                    <div className="text-xs text-base-content/50">{contact.email || contact.userPrincipalName || ''}</div>
                  </div>
                </button>
              ))}
          </div>
        </aside>
        {/* Main Chat Area */}
        <main className="flex-1 flex flex-col bg-base-100 h-full">
          {/* Chat Header */}
          <div className="flex items-center justify-between p-4 border-b border-base-300 bg-base-100">
            {selectedContact && (
              <>
                <div className="flex items-center gap-4">
                  <div className="avatar">
                    <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ backgroundColor: '#3b28c7' }}>
                      <span className="block w-full text-center text-xl font-bold text-white">{getInitials(selectedContact.displayName)}</span>
                    </div>
                  </div>
                  <div>
                    <div className="font-bold text-lg text-base-content">{selectedContact.displayName}</div>
                    <div className="text-xs text-base-content/50">{selectedContact.email || selectedContact.userPrincipalName || ''}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {isCallActive ? (
                    <>
                      <button 
                        className="btn btn-ghost btn-sm"
                        onClick={handleToggleMute}
                        title={isMuted ? 'Unmute' : 'Mute'}
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={isMuted ? "M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" : "M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"} />
                        </svg>
                      </button>
                      <button 
                        className="btn btn-error btn-sm"
                        onClick={handleEndCall}
                        title="End Call"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </>
                  ) : (
                    <>
                      <button 
                        className="btn btn-ghost btn-sm"
                        onClick={() => handleInitiateCall(selectedContact, 'audio')}
                        disabled={isInitiatingCall}
                        title="Audio Call"
                      >
                        {isInitiatingCall ? (
                          <div className="loading loading-spinner loading-xs"></div>
                        ) : (
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                          </svg>
                        )}
                      </button>
                      <button 
                        className="btn btn-ghost btn-sm"
                        onClick={() => handleInitiateCall(selectedContact, 'video')}
                        disabled={isInitiatingCall}
                        title="Video Call"
                      >
                        {isInitiatingCall ? (
                          <div className="loading loading-spinner loading-xs"></div>
                        ) : (
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        )}
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
          {/* Call Status Indicator */}
          {isCallActive && (
            <div className="bg-primary/10 border-b border-primary/20 p-3">
              <div className="flex items-center justify-center gap-2 text-primary">
                <div className="w-2 h-2 bg-primary rounded-full animate-pulse"></div>
                <span className="text-sm font-medium">Call in progress with {selectedContact?.displayName}</span>
                {isMuted && <span className="text-xs opacity-70">(Muted)</span>}
              </div>
            </div>
          )}
          
          {/* Chat History */}
          <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4 space-y-4">
            {loadingMessages && <div className="text-base-content/50 text-center mt-12">Loading messages...</div>}
            {chatError && <div className="text-error text-center mt-12">{chatError}</div>}
            {!loadingMessages && !chatError && (() => {
              // Only show real user messages
              const realMessages = messages.filter(isRealUserMessage);
              if (realMessages.length === 0) {
                return (
                  <div className="text-base-content/50 text-center mt-12">
                    Start to chat with {selectedContact?.displayName || 'this contact'}
                  </div>
                );
              }
              let lastDate: string | null = null;
              return realMessages.map((msg, idx) => {
                const myUserId = accounts[0]?.idTokenClaims?.oid;
                const isMe = msg.from && msg.from.user && myUserId && (msg.from.user.id === myUserId);
                const msgDateObj = new Date(msg.createdDateTime || msg.lastModifiedDateTime || msg.id);
                const msgDateStr = format(msgDateObj, 'MMMM d, yyyy');
                const showDate = lastDate !== msgDateStr;
                lastDate = msgDateStr;
                return (
                  <React.Fragment key={msg.id}>
                    {showDate && (
                      <div className="w-full flex justify-center my-4">
                        <span className="bg-base-200 text-base-content/70 px-4 py-1 rounded-full text-sm font-semibold shadow">{msgDateStr}</span>
                      </div>
                    )}
                    <div className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}> 
                      <div
                        className={`max-w-[60%] px-7 py-4 rounded-2xl shadow text-lg relative ${isMe ? 'bg-primary text-white rounded-br-md ml-auto' : 'bg-base-200 text-gray-900 rounded-bl-md mr-auto border border-base-200'}`}
                        style={{ wordBreak: 'break-word', fontSize: '1.25rem', lineHeight: '1.7' }}
                      >
                        {cleanTeamsMessage(msg.body?.content || msg.body || '')}
                        <div className="flex items-center gap-1 mt-1 text-[12px] opacity-70 justify-end">
                          <span>{msgDateObj.toLocaleTimeString()}</span>
                        </div>
                      </div>
                    </div>
                  </React.Fragment>
                );
              });
            })()}
          </div>
          {/* Message Input */}
          <form className="p-4 border-t border-base-300 flex gap-2 bg-base-100" onSubmit={handleSendMessage}>
            <input
              type="text"
              className="input input-bordered flex-1"
              placeholder="Type a message..."
              value={messageInput}
              onChange={e => setMessageInput(e.target.value)}
              disabled={!selectedContact || sending}
            />
            <button className="btn btn-primary" type="submit" disabled={!selectedContact || sending || !messageInput.trim()}>{sending ? 'Sending...' : 'Send'}</button>
          </form>
        </main>
      </div>
    </div>
  );
};

export default TeamsPage; 