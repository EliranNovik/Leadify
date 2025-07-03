import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useMsal } from '@azure/msal-react';
import { loginRequest } from '../msalConfig';
import { format } from 'date-fns';
import { MagnifyingGlassIcon, PaperAirplaneIcon } from '@heroicons/react/24/outline';
import { ChatBubbleLeftRightIcon } from '@heroicons/react/24/outline';

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

  return (
    <div className="flex flex-col md:flex-row h-[calc(100vh-5rem)] min-h-[500px] w-full bg-base-100">
      {/* Sidebar */}
      <aside className="w-full md:w-80 max-w-xs bg-base-100 border-r border-base-300 flex flex-col">
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
        <div className="flex items-center gap-4 p-4 border-b border-base-300 bg-base-100">
          {selectedContact && (
            <>
              <div className="avatar">
                <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ backgroundColor: '#3b28c7' }}>
                  <span className="block w-full text-center text-xl font-bold text-white">{getInitials(selectedContact.displayName)}</span>
                </div>
              </div>
              <div>
                <div className="font-bold text-lg text-base-content">{selectedContact.displayName}</div>
                <div className="text-xs text-base-content/50">{selectedContact.email || selectedContact.userPrincipalName || ''}</div>
              </div>
            </>
          )}
        </div>
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
  );
};

export default TeamsPage; 