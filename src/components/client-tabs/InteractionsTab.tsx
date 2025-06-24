import React, { useState, useEffect, useCallback } from 'react';
import { ClientTabProps } from '../../types/client';
import {
  ChatBubbleLeftRightIcon,
  EnvelopeIcon,
  PhoneIcon,
  ArrowUturnRightIcon,
  ArrowUturnLeftIcon,
  PencilSquareIcon,
  PaperClipIcon,
  XMarkIcon,
  UserIcon,
} from '@heroicons/react/24/outline';
import { FaWhatsapp } from 'react-icons/fa';
import { useMsal } from '@azure/msal-react';
import { loginRequest } from '../../msalConfig';
import { supabase } from '../../lib/supabase';
import { toast } from 'react-hot-toast';
import { InteractionRequiredAuthError, type IPublicClientApplication, type AccountInfo } from '@azure/msal-browser';
import { createPortal } from 'react-dom';

interface Attachment {
  id: string;
  name: string;
  contentType: string;
  sizeInBytes: number;
  isInline: boolean;
  contentUrl?: string; // For download
}

interface Interaction {
  id: string | number;
  date: string;
  time: string;
  raw_date: string;
  employee: string;
  direction: 'in' | 'out';
  kind: string;
  length: string;
  content: string;
  observation: string;
  editable: boolean;
}

const contactMethods = [
  { value: 'email', label: 'E-mail' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'call', label: 'Call' },
  { value: 'sms', label: 'SMS' },
  { value: 'office', label: 'In Office' },
];

const stripSignatureAndQuotedText = (html: string): string => {
  if (!html) return '';
  // This function looks for common markers of a reply/forward and truncates the email body there.
  const markers = [
    '<div id="divRplyFwdMsg"',
    'class="gmail_quote"',
    '<hr',
    '<strong>From:</strong>',
    '<b>From:</b>',
    'From:',
    'Sent:',
    'To:',
    'Cc:',
    'Subject:',
    'Best regards,',
    'Decker Pex Levi Law Offices',
  ];

  let earliestPos = -1;

  for (const marker of markers) {
    const pos = html.indexOf(marker);
    if (pos !== -1 && (earliestPos === -1 || pos < earliestPos)) {
      earliestPos = pos;
    }
  }

  return earliestPos !== -1 ? html.substring(0, earliestPos).trim() : html;
};

// Helper to acquire token, falling back to popup if needed
const acquireToken = async (instance: IPublicClientApplication, account: AccountInfo) => {
  try {
    return await instance.acquireTokenSilent({ ...loginRequest, account });
  } catch (error) {
    if (error instanceof InteractionRequiredAuthError) {
      toast('Your session has expired. Please sign in again.', { icon: '🔑' });
      return await instance.acquireTokenPopup({ ...loginRequest, account });
    }
    throw error;
  }
};

// Microsoft Graph API: Fetch emails for a client and sync to DB
async function syncClientEmails(token: string, client: ClientTabProps['client']) {
  if (!client.email || !client.lead_number) return;

  // Use $search for a more robust query. It searches across common fields.
  // The search term should be enclosed in quotes for Graph API.
  const searchQuery = `"${client.lead_number}" OR "${client.email}"`;
  
  const url = `https://graph.microsoft.com/v1.0/me/messages?$search=${encodeURIComponent(searchQuery)}&$top=50&$select=id,subject,from,toRecipients,ccRecipients,receivedDateTime,body,conversationId,hasAttachments`;
  
  const res = await fetch(url, { 
    headers: { 
      Authorization: `Bearer ${token}`,
      ConsistencyLevel: 'eventual' // Required for $search
    } 
  });
  if (!res.ok) {
    const errorText = await res.text();
    console.error("Microsoft Graph API error:", errorText);
    // Try to parse for a more specific error from Graph
    try {
      const errorJson = JSON.parse(errorText);
      if (errorJson?.error?.message) {
        throw new Error(`Graph API Error: ${errorJson.error.message}`);
      }
    } catch (e) {}
    throw new Error('Failed to fetch from Microsoft Graph');
  }

  const json = await res.json();
  const messages = json.value || [];

  // With a broad search, the client-side safeguard is even more important.
  const clientMessages = messages.filter((msg: any) => 
    (msg.subject && msg.subject.includes(client.lead_number!)) ||
    (msg.from?.emailAddress?.address.toLowerCase() === client.email!.toLowerCase()) ||
    (msg.toRecipients || []).some((r: any) => r.emailAddress.address.toLowerCase() === client.email!.toLowerCase()) ||
    (msg.ccRecipients || []).some((r: any) => r.emailAddress.address.toLowerCase() === client.email!.toLowerCase())
  );

  if (clientMessages.length === 0) {
    console.log("No relevant emails found after filtering.");
    return;
  }

  // Sort the messages by date on the client side.
  clientMessages.sort((a: any, b: any) => new Date(b.receivedDateTime).getTime() - new Date(a.receivedDateTime).getTime());

  // Fetch attachments for messages that have them
  for (const msg of clientMessages) {
    if (msg.hasAttachments) {
      const attachmentsUrl = `https://graph.microsoft.com/v1.0/me/messages/${msg.id}/attachments?$select=id,name,contentType,size,isInline`;
      const attachmentsRes = await fetch(attachmentsUrl, { headers: { Authorization: `Bearer ${token}` } });
      if (attachmentsRes.ok) {
        const attachmentsJson = await attachmentsRes.json();
        msg.attachments = (attachmentsJson.value || []).map((att: any) => ({
          ...att,
          sizeInBytes: att.size // Correcting the property name from sizeInBytes to size
        }));
      }
    }
  }

  // 4. Prepare data for Supabase (upsert to avoid duplicates)
  const emailsToUpsert = clientMessages.map((msg: any) => {
    const isOutgoing = msg.from?.emailAddress?.address.toLowerCase().includes('lawoffice.org.il');
    const originalBody = msg.body?.content || '';
    const processedBody = !isOutgoing ? stripSignatureAndQuotedText(originalBody) : originalBody;

    return {
      message_id: msg.id,
      client_id: client.id,
      thread_id: msg.conversationId,
      sender_name: msg.from?.emailAddress?.name,
      sender_email: msg.from?.emailAddress?.address,
      recipient_list: (msg.toRecipients || []).map((r: any) => r.emailAddress.address).join(', '),
      subject: msg.subject,
      body_preview: processedBody,
      sent_at: msg.receivedDateTime,
      direction: isOutgoing ? 'outgoing' : 'incoming',
      attachments: msg.attachments || null,
    };
  });

  // 5. Upsert into our database
  await supabase.from('emails').upsert(emailsToUpsert, { onConflict: 'message_id' });
}

// Microsoft Graph API: Send email (as a new message or reply)
async function sendClientEmail(token: string, subject: string, body: string, client: ClientTabProps['client'], senderName: string, attachments: { name: string; contentType: string; contentBytes: string }[]) {
  const signature = `<br><br>Best regards,<br>${senderName}<br>Decker Pex Levi Law Offices`;
  const fullBody = body + signature;

  const messageAttachments = attachments.map(att => ({
    '@odata.type': '#microsoft.graph.fileAttachment',
    name: att.name,
    contentType: att.contentType,
    contentBytes: att.contentBytes
  }));

  const draftMessage = {
    subject,
    body: { contentType: 'HTML', content: fullBody },
    toRecipients: [{ emailAddress: { address: client.email! } }],
    attachments: messageAttachments.length > 0 ? messageAttachments : undefined,
  };

  // 1. Create a draft message to get its ID
  const createDraftUrl = `https://graph.microsoft.com/v1.0/me/messages`;
  const draftRes = await fetch(createDraftUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(draftMessage),
  });

  if (!draftRes.ok) {
    console.error("Graph API Error creating draft:", await draftRes.text());
    throw new Error('Failed to create email draft.');
  }
  const createdDraft = await draftRes.json();
  const messageId = createdDraft.id;

  if (!messageId) {
    throw new Error('Could not get message ID from draft.');
  }

  // 2. Send the draft message
  const sendUrl = `https://graph.microsoft.com/v1.0/me/messages/${messageId}/send`;
  const sendRes = await fetch(sendUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!sendRes.ok) {
    console.error("Graph API Error sending draft:", await sendRes.text());
    throw new Error('Failed to send email.');
  }

  // 3. Return the created message object so we can save it to our DB.
  return createdDraft;
}

const emailTemplates = [
  {
    name: 'Document Reminder',
    subject: 'Reminder: Required Documents for Your Application',
    body: `Dear {client_name},\n\nAs part of your application process, we kindly remind you to upload the required documents to your client portal.\n\nThis will help us proceed without delays. If you need assistance or are unsure which documents are still needed, please contact us.\n\nYou can upload documents here: {upload_link}\n\nThank you for your cooperation.`,
  },
  {
    name: 'Application Submission Confirmation',
    subject: 'Confirmation: Your Application Has Been Submitted',
    body: `Dear {client_name},\n\nWe're pleased to inform you that your application has been successfully submitted to the relevant authorities.\n\nYou will be notified once there are any updates or additional requirements. Please note that processing times may vary depending on the case.\n\nIf you have any questions or wish to discuss the next steps, feel free to contact your case manager.`,
  },
];

const InteractionsTab: React.FC<ClientTabProps> = ({ client, onClientUpdate }) => {
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [editIndex, setEditIndex] = useState<number|null>(null);
  const [editData, setEditData] = useState({ date: '', time: '', content: '', observation: '', length: '' });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [contactDrawerOpen, setContactDrawerOpen] = useState(false);
  const [newContact, setNewContact] = useState({
    method: 'email',
    date: '',
    time: '',
    length: '',
    content: '',
    observation: '',
  });
  const { instance, accounts } = useMsal();
  const [emails, setEmails] = useState<any[]>([]);
  const [emailsLoading, setEmailsLoading] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [sending, setSending] = useState(false);
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);
  const [composeAttachments, setComposeAttachments] = useState<{ name: string; contentType: string; contentBytes: string }[]>([]);
  const [downloadingAttachments, setDownloadingAttachments] = useState<Record<string, boolean>>({});
  const [activeEmailId, setActiveEmailId] = useState<string | null>(null);

  // This function now ONLY syncs with Graph and then triggers a full refresh
  const runGraphSync = useCallback(async () => {
    if (!client.email || !instance || !accounts[0]) return;
    
    setEmailsLoading(true);

    try {
      const tokenResponse = await acquireToken(instance, accounts[0]);
      await syncClientEmails(tokenResponse.accessToken, client);
      if (onClientUpdate) {
        await onClientUpdate(); // Refresh all client data from parent
      }
    } catch (e) {
      console.error("Graph sync failed:", e);
      toast.error("Failed to sync new emails from server.");
    } finally {
      setEmailsLoading(false);
    }
  }, [client, instance, accounts, onClientUpdate]);

  // Effect to combine and sort interactions whenever client data changes
  useEffect(() => {
    const clientEmails = (client as any).emails || [];
    const emailInteractions = clientEmails.map((e: any) => {
      const emailDate = new Date(e.sent_at);
      return {
        id: e.message_id,
        date: emailDate.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' }),
        time: emailDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
        raw_date: e.sent_at,
        employee: e.direction === 'outgoing' ? (accounts[0]?.name || 'You') : client.name,
        direction: e.direction,
        kind: 'email',
        length: '',
        content: e.subject,
        observation: e.observation || '',
        editable: true,
      };
    });

    const manualInteractions = client.manual_interactions || [];
    const combined = [...manualInteractions, ...emailInteractions];
    const sorted = combined.sort((a, b) => new Date((b as any).raw_date).getTime() - new Date((a as any).raw_date).getTime());
    setInteractions(sorted as Interaction[]);
    
    // Also update the local emails state for the modal
    const formattedEmailsForModal = clientEmails.map((e: any) => ({
      id: e.message_id,
      subject: e.subject,
      from: e.sender_email,
      to: e.recipient_list,
      date: e.sent_at,
      bodyPreview: e.body_preview || e.subject,
      direction: e.direction,
      attachments: e.attachments,
    }));
    setEmails(formattedEmailsForModal);

  }, [client, accounts]);

  // Effect to run the slow sync only once when the component mounts
  useEffect(() => {
    runGraphSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run only once

  const handleSendEmail = async () => {
    if (!client.email || !instance || !accounts[0]) return;
    setSending(true);
    const account = accounts[0];

    try {
      const tokenResponse = await acquireToken(instance, account);
      const senderName = account?.name || 'Your Team';

      // 1. Send email via Graph API.
      await sendClientEmail(
        tokenResponse.accessToken, 
        composeSubject, 
        composeBody, 
        client, 
        senderName,
        composeAttachments
      );
      toast.success('Email sent and saved!');
      
      // After sending, trigger a sync to get the new email
      await runGraphSync();

    } catch (e) {
      console.error("Error in handleSendEmail:", e);
      toast.error(e instanceof Error ? e.message : "Failed to send email.");
    }
    setSending(false);
  };

  const handleDownloadAttachment = async (messageId: string, attachment: Attachment) => {
    if (downloadingAttachments[attachment.id]) return; // Don't download if already in progress

    setDownloadingAttachments(prev => ({ ...prev, [attachment.id]: true }));
    toast.loading(`Downloading ${attachment.name}...`, { id: attachment.id });

    try {
      const tokenResponse = await acquireToken(instance, accounts[0]);
      const url = `https://graph.microsoft.com/v1.0/me/messages/${messageId}/attachments/${attachment.id}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${tokenResponse.accessToken}` } });

      if (!res.ok) throw new Error('Failed to fetch attachment content.');
      
      const attachmentData = await res.json();
      const base64 = attachmentData.contentBytes;

      // Decode base64 and trigger download
      const byteCharacters = atob(base64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: attachmentData.contentType });

      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = attachment.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);

      toast.success(`${attachment.name} downloaded.`, { id: attachment.id });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Download failed.', { id: attachment.id });
    } finally {
      setDownloadingAttachments(prev => ({ ...prev, [attachment.id]: false }));
    }
  };

  const handleAttachmentUpload = async (files: FileList) => {
    if (!files || files.length === 0) return;
    
    for (const file of Array.from(files)) {
      if (file.size > 4 * 1024 * 1024) { // 4MB limit
        toast.error(`${file.name} is too large. Please choose files under 4MB.`);
        continue;
      }
      
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const content = e.target?.result as string;
          const base64Content = content.split(',')[1];
          if (!base64Content) throw new Error('Could not read file content.');

          setComposeAttachments(prev => [...prev, {
            name: file.name,
            contentType: file.type,
            contentBytes: base64Content
          }]);
          toast.success(`${file.name} attached.`);
        } catch (err) {
          toast.error(`Error processing ${file.name}.`);
        }
      };
      reader.onerror = () => {
        toast.error(`Failed to read ${file.name}.`);
      };
      reader.readAsDataURL(file);
    }
  };

  // Set the subject when the compose modal opens
  useEffect(() => {
    if (showCompose) {
      const subject = `[${client.lead_number}] - ${client.name} - ${client.topic}`;
      setComposeSubject(subject);
    }
  }, [showCompose, client]);

  const openEditDrawer = (idx: number) => {
    const row = interactions[idx];
    setEditIndex(idx);
    setEditData({
      date: row.date,
      time: row.time,
      content: row.content,
      observation: row.observation,
      length: (row.length || '').replace('m', ''),
    });
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    setEditIndex(null);
  };

  const handleEditChange = (field: string, value: string) => {
    setEditData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    if (editIndex === null) return;
    
    const interactionToUpdate = interactions[editIndex];
    const isManual = interactionToUpdate.id.toString().startsWith('manual_');

    // --- Optimistic Update ---
    const previousInteractions = [...interactions];
    const updatedInteractions = interactions.map((interaction, index) => {
      if (index === editIndex) {
        return {
          ...interaction,
          date: editData.date,
          time: editData.time,
          content: editData.content,
          observation: editData.observation,
          length: editData.length ? `${editData.length}m` : '',
        };
      }
      return interaction;
    });
    setInteractions(updatedInteractions);
    closeDrawer();
    // --- End Optimistic Update ---

    try {
      if (isManual) {
        const updatedManualInteraction = updatedInteractions[editIndex];
        const allManualInteractions = updatedInteractions.filter(i => i.id.toString().startsWith('manual_'));
        
        const { error } = await supabase
          .from('leads')
          .update({ manual_interactions: allManualInteractions })
          .eq('id', client.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('emails')
          .update({ observation: editData.observation })
          .eq('message_id', interactionToUpdate.id);
        if (error) throw error;
      }
      
      toast.success('Interaction updated!');
      if (onClientUpdate) await onClientUpdate(); // Silently refresh data
    } catch (error) {
      toast.error('Update failed. Reverting changes.');
      setInteractions(previousInteractions); // Revert on failure
      console.error(error);
    }
  };

  const openContactDrawer = () => {
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const date = `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear().toString().slice(-2)}`;
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    setNewContact({
      method: 'email',
      date,
      time,
      length: '',
      content: '',
      observation: '',
    });
    setContactDrawerOpen(true);
  };

  const closeContactDrawer = () => {
    setContactDrawerOpen(false);
  };

  const handleNewContactChange = (field: string, value: string) => {
    setNewContact((prev) => ({ ...prev, [field]: value }));
  };

  const handleSaveContact = async () => {
    if (!client) return;

    const now = new Date();
    const newInteraction: Interaction = {
      id: `manual_${now.getTime()}`,
      date: newContact.date || now.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' }),
      time: newContact.time || now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
      raw_date: now.toISOString(),
      employee: accounts[0]?.name || 'You',
      direction: 'out',
      kind: newContact.method,
      length: newContact.length ? `${newContact.length}m` : '',
      content: newContact.content,
      observation: newContact.observation,
      editable: true,
    };

    // --- Optimistic Update ---
    const previousInteractions = [...interactions];
    const newInteractions = [newInteraction, ...interactions].sort((a, b) => new Date(b.raw_date).getTime() - new Date(a.raw_date).getTime());
    setInteractions(newInteractions);
    closeContactDrawer();
    // --- End Optimistic Update ---

    try {
      const existingInteractions = client.manual_interactions || [];
      const updatedInteractions = [...existingInteractions, newInteraction];

      const { error: updateError } = await supabase
        .from('leads')
        .update({ manual_interactions: updatedInteractions })
        .eq('id', client.id);

      if (updateError) throw updateError;
      
      toast.success('Interaction saved!');
      if (onClientUpdate) await onClientUpdate(); // Silently refresh data

    } catch (error) {
      toast.error('Save failed. Reverting changes.');
      setInteractions(previousInteractions); // Revert on failure
      console.error(error);
    }
  };

  return (
    <div className="p-8">
      <h2 className="text-3xl font-bold mb-2">Interactions</h2>
      <div className="text-lg mb-4 text-base-content/80">
        <span className="font-semibold">Closer:</span> Hadar
      </div>
      {/* Action Buttons */}
      <div className="flex flex-wrap gap-2 mb-6">
        <button className="btn btn-neutral btn-md gap-2" onClick={() => setIsEmailModalOpen(true)}>
          <EnvelopeIcon className="w-5 h-5" />
          Emails
        </button>
        <button className="btn btn-success btn-md gap-2"><FaWhatsapp className="w-5 h-5" />Whatsapp</button>
        <button className="btn btn-primary btn-md gap-2" onClick={openContactDrawer}>Contact</button>
      </div>
      {/* Table */}
      <div className="overflow-x-auto rounded-xl shadow-lg border border-base-200 bg-base-100">
        <table className="table w-full">
          {/* head */}
          <thead>
            <tr className="text-left text-sm font-semibold uppercase text-base-content/60 bg-base-200">
              <th className="px-6 py-4">Details</th>
              <th className="px-6 py-4">Kind</th>
              <th className="px-6 py-4 max-w-sm">Content</th>
              <th className="px-6 py-4 max-w-sm">Observation</th>
              <th className="px-6 py-4"></th>
            </tr>
          </thead>
          <tbody>
            {interactions.map((row, idx) => (
              <tr key={idx} className="hover:bg-base-200/50 transition-colors duration-150 border-b border-base-200 last:border-b-0">
                {/* Details Column */}
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <span title={row.direction === 'out' ? 'Outgoing' : 'Incoming'}>
                      {row.direction === 'out' ? (
                        <ArrowUturnRightIcon className="w-5 h-5 text-primary" />
                      ) : (
                        <ArrowUturnLeftIcon className="w-5 h-5 text-neutral" />
                      )}
                    </span>
                    <div>
                      <div className="font-bold text-base">{row.employee}</div>
                      <div className="text-sm text-base-content/70">{row.date} at {row.time}</div>
                    </div>
                  </div>
                </td>

                {/* Kind Column */}
                <td className="px-6 py-4 align-middle">
                  <div className="flex flex-col items-center gap-1">
                    {row.kind === 'whatsapp' && <FaWhatsapp className="w-6 h-6 text-success" title="Whatsapp"/>}
                    {row.kind === 'call' && <PhoneIcon className="w-6 h-6 text-primary" title="Call"/>}
                    {row.kind === 'email' && 
                      <button 
                        className="btn btn-ghost btn-circle btn-sm"
                        onClick={() => {
                          setIsEmailModalOpen(true);
                          setActiveEmailId((row as any).id);
                        }}
                      >
                        <EnvelopeIcon className="w-6 h-6 text-neutral" title="Email"/>
                      </button>
                    }
                    {row.kind === 'sms' && <ChatBubbleLeftRightIcon className="w-6 h-6 text-info" title="SMS"/>}
                    {row.kind === 'office' && <UserIcon className="w-6 h-6 text-warning" title="In Office"/>}
                    {row.length && row.length !== 'm' && <span className="text-xs text-base-content/60">{row.length}</span>}
                  </div>
                </td>

                {/* Content Column */}
                <td className="px-6 py-4 align-middle max-w-sm">
                  {row.kind === 'email' ? (
                    <button 
                      className="btn btn-ghost btn-sm gap-2"
                      onClick={() => {
                        setIsEmailModalOpen(true);
                        setActiveEmailId((row as any).id);
                      }}
                    >
                      <ChatBubbleLeftRightIcon className="w-5 h-5" />
                      View Message
                    </button>
                  ) : (
                    <p className="text-base-content/90 whitespace-normal break-words">{row.content}</p>
                  )}
                </td>
                
                {/* Observation Column */}
                <td className="px-6 py-4 align-middle max-w-sm">
                   <p className="text-sm text-base-content/60 whitespace-normal break-words">{row.observation}</p>
                </td>
                
                {/* Actions Column */}
                <td className="px-6 py-4 align-middle text-right">
                  <button
                    className="btn btn-ghost btn-sm"
                    title="Edit Row"
                    onClick={() => openEditDrawer(idx)}
                  >
                    <PencilSquareIcon className="w-5 h-5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Email Thread Modal */}
      {isEmailModalOpen && createPortal(
        <div className="fixed inset-0 bg-black/50 z-[999] flex items-start justify-center p-4">
          <div className="bg-base-100 rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden mt-12">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-base-300">
              <h3 className="text-xl font-bold">Email Thread with {client.name}</h3>
              <div className="flex items-center gap-2">
                <button className="btn btn-primary btn-sm" onClick={() => setShowCompose(true)}>
                  Compose New Email
                </button>
                <button className="btn btn-ghost btn-sm btn-circle" onClick={() => setIsEmailModalOpen(false)}>
                  <XMarkIcon className="w-6 h-6" />
                </button>
              </div>
            </div>

            {/* Conversation Body */}
            <div ref={(el) => {
              if (el && activeEmailId) {
                const targetEmail = el.querySelector(`[data-email-id="${activeEmailId}"]`);
                if (targetEmail) {
                  targetEmail.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
                setActiveEmailId(null); // Reset after scrolling
              }
            }} className="flex-1 overflow-y-auto p-6 space-y-6">
              {emailsLoading ? (
                <div className="text-center p-8">Loading email history...</div>
              ) : emails.length === 0 ? (
                <div className="text-center p-8 text-base-content/70">No emails found for this client.</div>
              ) : (
                [...emails].reverse().map(email => (
                  <div 
                    key={email.id} 
                    data-email-id={email.id}
                    className={`flex items-end gap-3 ${email.direction === 'outgoing' ? 'flex-row-reverse' : ''}`}
                  >
                    <div className={`avatar placeholder ${email.direction === 'outgoing' ? 'hidden' : ''}`}>
                      <div className="bg-neutral-focus text-neutral-content rounded-full w-10 h-10">
                        <span>{client.name.charAt(0)}</span>
                      </div>
                    </div>
                    <div className={`chat-bubble max-w-2xl break-words ${email.direction === 'outgoing' ? 'chat-bubble-primary' : 'bg-base-200'}`}>
                      <div className="flex justify-between items-center text-xs opacity-70 mb-2">
                        <span className="font-bold">{email.from}</span>
                        <span>{new Date(email.date).toLocaleString()}</span>
                      </div>
                      <div className="font-bold mb-2">{email.subject}</div>
                      <div className="prose" dangerouslySetInnerHTML={{ __html: email.bodyPreview }} />
                      
                      {/* Incoming Attachments */}
                      {email.attachments && email.attachments.length > 0 && (
                        <div className="mt-4 pt-2 border-t border-black/10">
                          <h4 className="font-semibold text-xs mb-2">Attachments:</h4>
                          <div className="flex flex-wrap gap-2">
                            {email.attachments.map((att: Attachment) => (
                              <button 
                                key={att.id}
                                className="btn btn-outline btn-xs gap-1"
                                onClick={() => handleDownloadAttachment(email.id, att)}
                                disabled={downloadingAttachments[att.id]}
                              >
                                {downloadingAttachments[att.id] ? (
                                  <span className="loading loading-spinner loading-xs" />
                                ) : (
                                  <PaperClipIcon className="w-3 h-3" />
                                )}
                                {att.name} ({(att.sizeInBytes / 1024).toFixed(1)} KB)
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Compose Email Modal (Drawer style) */}
      {showCompose && createPortal(
        <div className="fixed inset-0 z-[999]">
          <div className="fixed inset-0 bg-black/30" onClick={() => setShowCompose(false)} />
          <div className="fixed inset-y-0 right-0 h-screen w-full max-w-md bg-base-100 shadow-2xl p-8 flex flex-col animate-slideInRight z-[999]">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-2xl font-bold">Compose Email</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowCompose(false)}>
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>
            <div className="flex flex-col gap-4 flex-1">
              <div>
                <label className="block font-semibold mb-1">To</label>
                <input type="text" className="input input-bordered w-full" value={client.email} disabled />
              </div>
              <div>
                <label className="block font-semibold mb-1">Subject</label>
                <input type="text" className="input input-bordered w-full" value={composeSubject} onChange={e => setComposeSubject(e.target.value)} />
              </div>
              <div>
                <label className="block font-semibold mb-2">Templates</label>
                <div className="flex flex-wrap gap-2">
                  {emailTemplates.map(template => (
                    <button
                      key={template.name}
                      className="btn btn-outline btn-xs"
                      onClick={() => {
                        const uploadLink = 'https://portal.example.com/upload'; // Placeholder
                        const processedBody = template.body
                            .replace(/{client_name}/g, client.name)
                            .replace(/{upload_link}/g, uploadLink);
                        
                        const newSubject = `[${client.lead_number}] - ${template.subject}`;
                        
                        setComposeBody(processedBody);
                        setComposeSubject(newSubject);
                      }}
                    >
                      {template.name}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block font-semibold mb-1">Body</label>
                <textarea className="textarea textarea-bordered w-full min-h-[120px]" value={composeBody} onChange={e => setComposeBody(e.target.value)} />
              </div>

              {/* Attachments Section */}
              <div>
                <label className="block font-semibold mb-1">Attachments</label>
                <div className="p-4 bg-base-200 rounded-lg">
                  <div className="flex flex-col gap-2 mb-2">
                    {composeAttachments.map((att, index) => (
                      <div key={index} className="flex items-center justify-between text-sm">
                        <span>{att.name}</span>
                        <button 
                          className="btn btn-ghost btn-xs"
                          onClick={() => setComposeAttachments(prev => prev.filter(a => a.name !== att.name))}
                        >
                          <XMarkIcon className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <label htmlFor="file-upload" className="btn btn-outline btn-sm w-full">
                    <PaperClipIcon className="w-4 h-4" /> Add Attachment
                  </label>
                  <input id="file-upload" type="file" className="hidden" onChange={(e) => e.target.files && handleAttachmentUpload(e.target.files)} />
                </div>
              </div>
            </div>
            <div className="mt-6 flex justify-end">
              <button className="btn btn-primary px-8" onClick={handleSendEmail} disabled={sending}>
                {sending ? 'Sending...' : 'Send'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Drawer for editing */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex">
          {/* Overlay */}
          <div
            className="fixed inset-0 bg-black/30"
            onClick={closeDrawer}
          />
          {/* Drawer */}
          <div className="ml-auto w-full max-w-md bg-base-100 h-full shadow-2xl p-8 flex flex-col animate-slideInRight z-50">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-2xl font-bold">Edit Interaction</h3>
              <button className="btn btn-ghost btn-sm" onClick={closeDrawer}>
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>
            <div className="flex flex-col gap-4 flex-1">
              <div>
                <label className="block font-semibold mb-1">Date</label>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  value={editData.date}
                  onChange={e => handleEditChange('date', e.target.value)}
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Time</label>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  value={editData.time}
                  onChange={e => handleEditChange('time', e.target.value)}
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Minutes</label>
                <input
                  type="number"
                  min="0"
                  className="input input-bordered w-full"
                  value={editData.length}
                  onChange={e => handleEditChange('length', e.target.value)}
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Content</label>
                <textarea
                  className="textarea textarea-bordered w-full min-h-[80px]"
                  value={editData.content}
                  onChange={e => handleEditChange('content', e.target.value)}
                  disabled={editIndex !== null && interactions[editIndex]?.kind === 'email'}
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Observation</label>
                <textarea
                  className="textarea textarea-bordered w-full min-h-[60px]"
                  value={editData.observation}
                  onChange={e => handleEditChange('observation', e.target.value)}
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end">
              <button className="btn btn-primary px-8" onClick={handleSave}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Contact Drawer */}
      {contactDrawerOpen && (
        <div className="fixed inset-0 z-50 flex">
          {/* Overlay */}
          <div
            className="fixed inset-0 bg-black/30"
            onClick={closeContactDrawer}
          />
          {/* Drawer */}
          <div className="ml-auto w-full max-w-md bg-base-100 h-full shadow-2xl p-8 flex flex-col animate-slideInRight z-50">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-2xl font-bold">Contact Client</h3>
              <button className="btn btn-ghost btn-sm" onClick={closeContactDrawer}>
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>
            <div className="flex flex-col gap-4 flex-1">
              <div>
                <label className="block font-semibold mb-1">How to contact</label>
                <select
                  className="select select-bordered w-full"
                  value={newContact.method}
                  onChange={e => handleNewContactChange('method', e.target.value)}
                >
                  {contactMethods.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">Date</label>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  value={newContact.date}
                  onChange={e => handleNewContactChange('date', e.target.value)}
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Time</label>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  value={newContact.time}
                  onChange={e => handleNewContactChange('time', e.target.value)}
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Minutes</label>
                <input
                  type="number"
                  min="0"
                  className="input input-bordered w-full"
                  value={newContact.length}
                  onChange={e => handleNewContactChange('length', e.target.value)}
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Content</label>
                <textarea
                  className="textarea textarea-bordered w-full min-h-[80px]"
                  value={newContact.content}
                  onChange={e => handleNewContactChange('content', e.target.value)}
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Observation</label>
                <textarea
                  className="textarea textarea-bordered w-full min-h-[60px]"
                  value={newContact.observation}
                  onChange={e => handleNewContactChange('observation', e.target.value)}
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end">
              <button className="btn btn-primary px-8" onClick={handleSaveContact}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default InteractionsTab; 