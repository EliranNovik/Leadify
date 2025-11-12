import React, { useEffect, useMemo, useRef, useState } from 'react';
import { InteractionRequiredAuthError, IPublicClientApplication } from '@azure/msal-browser';
import toast from 'react-hot-toast';
import { sendEmail } from '../lib/graph';
import { supabase } from '../lib/supabase';
import { updateLeadStageWithHistory } from '../lib/leadStageManager';
import { PaperAirplaneIcon, PlusIcon, XMarkIcon, ChevronDownIcon } from '@heroicons/react/24/outline';
import { fetchStageNames, normalizeStageName } from '../lib/stageUtils';

interface SendPriceOfferModalProps {
  isOpen: boolean;
  onClose: () => void;
  client: any;
  msalInstance: IPublicClientApplication;
  loginRequest: any;
  onOfferSent: () => Promise<void>;
}

type RecipientType = 'to' | 'cc';

type EmailTemplate = {
  id: number;
  name: string;
  subject: string | null;
  content: string;
  rawContent: string;
  languageId: string | null;
};

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function fetchCurrentUserFullName() {
  const { data: { user } } = await supabase.auth.getUser();
  if (user && user.email) {
    const { data, error } = await supabase
      .from('users')
      .select('full_name')
      .eq('email', user.email)
      .single();
    if (!error && data?.full_name) {
      return data.full_name;
    }
  }
  return null;
}

const normaliseAddressList = (value: string | null | undefined) => {
  if (!value) return [] as string[];
  return value
    .split(/[;,]+/)
    .map(item => item.trim())
    .filter(item => item.length > 0);
};

const updateOfferBodyWithTotal = (body: string, _total: string, _currency: string) => {
  if (!body) return body;
  return body
    .split('\n')
    .filter(line => !line.trim().toLowerCase().startsWith('total cost of the offer:'))
    .join('\n');
};

const parseTemplateContent = (rawContent: string | null | undefined): string => {
  if (!rawContent) return '';

  const sanitizeTemplateText = (text: string) => {
    if (!text) return '';

    const withoutTotal = text
      .split('\n')
      .filter(line => !/^total\s+cost\s+of\s+the\s+offer/i.test(line.trim()))
      .map(line => line.replace(/\s+$/g, ''));

    return withoutTotal
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+\n/g, '\n')
      .trim();
  };

  const tryParseDelta = (input: string) => {
    try {
      const parsed = JSON.parse(input);
      const ops = parsed?.delta?.ops || parsed?.ops;
      if (Array.isArray(ops)) {
        const text = ops
          .map((op: any) => (typeof op?.insert === 'string' ? op.insert : ''))
          .join('');
        return sanitizeTemplateText(text);
      }
    } catch (error) {
      // ignore
    }
    return null;
  };

  const cleanHtml = (input: string) => {
    let text = input;

    const htmlMatch = text.match(/html\s*:\s*(.*)/is);
    if (htmlMatch) {
      text = htmlMatch[1];
    }

    text = text
      .replace(/^{?delta\s*:\s*\{.*?\},?/is, '')
      .replace(/^{|}$/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\r/g, '')
      .replace(/\\/g, '\\');

    return sanitizeTemplateText(text);
  };

  // First attempt: raw JSON
  let text = tryParseDelta(rawContent);
  if (text !== null) {
    return text;
  }

  // Second attempt: sometimes the JSON is double-encoded as a string
  text = tryParseDelta(
    rawContent
      .replace(/^"|"$/g, '')
      .replace(/\\"/g, '"')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
  );
  if (text !== null) {
    return text;
  }

  // Fallback: extract insert values manually
  const normalised = rawContent
    .replace(/\\"/g, '"')
    .replace(/\r/g, '')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t');
  const insertRegex = /"?insert"?\s*:\s*"([^"\n]*)"/g;
  const inserts: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = insertRegex.exec(normalised))) {
    inserts.push(match[1]);
  }
  if (inserts.length > 0) {
    const combined = inserts.join('');
    const decoded = combined.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
    return sanitizeTemplateText(decoded);
  }

  // Final fallback: treat as HTML / plain text string or html: section
  return sanitizeTemplateText(cleanHtml(rawContent));
};

const manualStageIdFallbacks: Record<string, number> = {
  created: 0,
  schedulerassigned: 10,
  precommunication: 11,
  communicationstarted: 15,
  meetingscheduled: 20,
  meetingcomplete: 30,
  meetingirrelevant: 35,
  waitingformtngsum: 40,
  mtngsumagreementsent: 50,
  clientdeclinedpriceoffer: 51,
  clientdeclined: 51,
  anothermeeting: 55,
  clientsignedagreement: 60,
  paymentrequestsent: 70,
  droppedspamirrelevant: 91,
  success: 100,
  handlerset: 105,
  handlerstarted: 110,
  applicationsubmitted: 150,
  caseclosed: 200,
};

const resolveStageId = async (stage: string | number | null | undefined): Promise<number | null> => {
  if (stage === null || stage === undefined) {
    return null;
  }

  if (typeof stage === 'number') {
    return Number.isFinite(stage) ? stage : null;
  }

  const str = String(stage).trim();
  if (!str) {
    return null;
  }

  const numericDirect = Number(str);
  if (!Number.isNaN(numericDirect) && Number.isFinite(numericDirect)) {
    return numericDirect;
  }

  const normalized = normalizeStageName(str);
  if (normalized && manualStageIdFallbacks[normalized] !== undefined) {
    return manualStageIdFallbacks[normalized];
  }

  try {
    const stageNames = await fetchStageNames();
    for (const [id, name] of Object.entries(stageNames)) {
      if (!name) continue;
      const normalizedId = normalizeStageName(String(id));
      const normalizedName = normalizeStageName(name);
      if (normalizedId === normalized || normalizedName === normalized) {
        const numeric = Number(id);
        if (!Number.isNaN(numeric)) {
          return numeric;
        }
      }
    }
  } catch (error) {
    console.error('Failed to fetch stage names while resolving stage id:', error);
  }

  return manualStageIdFallbacks[normalized] ?? null;
};

const SendPriceOfferModal: React.FC<SendPriceOfferModalProps> = ({
  isOpen,
  onClose,
  client,
  msalInstance,
  loginRequest,
  onOfferSent,
}) => {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [total, setTotal] = useState('');
  const [currency, setCurrency] = useState('₪');
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [templateSearch, setTemplateSearch] = useState('');
  const [showTemplateDropdown, setShowTemplateDropdown] = useState(false);
  const templateDropdownRef = useRef<HTMLDivElement | null>(null);
  const filteredTemplates = useMemo(() => {
    const query = templateSearch.trim().toLowerCase();
    if (!query) {
      return templates;
    }
    return templates.filter(template => template.name.toLowerCase().includes(query));
  }, [templates, templateSearch]);

  const [toRecipients, setToRecipients] = useState<string[]>([]);
  const [ccRecipients, setCcRecipients] = useState<string[]>([]);
  const [toInput, setToInput] = useState('');
  const [ccInput, setCcInput] = useState('');
  const [recipientError, setRecipientError] = useState<string | null>(null);
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [linkLabel, setLinkLabel] = useState('');
  const [linkUrl, setLinkUrl] = useState('');

  const defaultSubject = useMemo(() => {
    if (!client) return '';
    const leadNumber = client?.lead_number ? `[${client.lead_number}]` : '';
    const namePart = client?.name ? ` - ${client.name}` : '';
    const topicPart = client?.topic ? ` - ${client.topic}` : '';
    return `${leadNumber}${namePart}${topicPart}`.replace(/^\s*-\s*/, '');
  }, [client]);

  useEffect(() => {
    if (!isOpen || !client) return;

    const initialRecipients = normaliseAddressList(client.email);
    setToRecipients(initialRecipients.length > 0 ? initialRecipients : []);
    setCcRecipients([]);
    setToInput('');
    setCcInput('');
    setRecipientError(null);
    setShowLinkForm(false);
    setLinkLabel('');
    setLinkUrl('');

    setSubject(defaultSubject);
    setBody('');
    setTotal(
      client?.proposal_total !== null && client?.proposal_total !== undefined
        ? String(client.proposal_total)
        : ''
    );
    setCurrency(client?.proposal_currency || '₪');
    setSelectedTemplateId(null);
    setTemplateSearch('');
    setShowTemplateDropdown(false);
  }, [isOpen, client, defaultSubject]);

  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    const loadTemplates = async () => {
      setTemplatesLoading(true);
      try {
        const { data, error } = await supabase
          .from('misc_emailtemplate')
          .select('*')
          .eq('active', 't')
          .order('name', { ascending: true });

        if (error) throw error;
        if (!isMounted) return;

        const parsed = (data || []).map((template: any) => ({
          id: typeof template.id === 'number' ? template.id : Number(template.id),
          name: template.name || `Template ${template.id}`,
          subject: typeof template.subject === 'string' ? template.subject : null,
          content: parseTemplateContent(template.content),
          rawContent: template.content || '',
          languageId: template.language_id ?? null,
        }));

        setTemplates(parsed);
      } catch (error) {
        if (isMounted) {
          console.error('Failed to fetch email templates:', error);
          toast.error('Failed to load email templates.');
          setTemplates([]);
        }
      } finally {
        if (isMounted) {
          setTemplatesLoading(false);
        }
      }
    };

    loadTemplates();
    return () => {
      isMounted = false;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!showTemplateDropdown) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (templateDropdownRef.current && !templateDropdownRef.current.contains(event.target as Node)) {
        setShowTemplateDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showTemplateDropdown]);

  useEffect(() => {
    if (!isOpen || selectedTemplateId === null) return;
    setBody(prev => updateOfferBodyWithTotal(prev, total, currency));
  }, [total, currency, selectedTemplateId, isOpen]);

  if (!isOpen) return null;

  const closeModal = () => {
    if (sending) return;
    onClose();
  };

  const normaliseUrl = (value: string) => {
    if (!value) return '';
    let url = value.trim();
    if (!url) return '';
    if (!/^https?:\/\//i.test(url)) {
      url = `https://${url}`;
    }
    try {
      const parsed = new URL(url);
      return parsed.toString();
    } catch (error) {
      return '';
    }
  };

  const handleCancelLink = () => {
    setShowLinkForm(false);
    setLinkLabel('');
    setLinkUrl('');
  };

  const handleInsertLink = () => {
    const formattedUrl = normaliseUrl(linkUrl);
    if (!formattedUrl) {
      toast.error('Please provide a valid URL (including the domain).');
      return;
    }

    const label = linkLabel.trim();
    setBody(prev => {
      const existing = prev || '';
      const trimmedExisting = existing.replace(/\s*$/, '');
      const linkLine = label ? `${label}: ${formattedUrl}` : formattedUrl;
      return trimmedExisting ? `${trimmedExisting}\n\n${linkLine}` : linkLine;
    });

    handleCancelLink();
  };

  const convertBodyToHtml = (text: string) => {
    if (!text) return '';
    const urlRegex = /(https?:\/\/[^\s]+)/gi;
    const escaped = text.replace(urlRegex, url => {
      const safeUrl = url.replace(/"/g, '&quot;');
      return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${url}</a>`;
    });
    return escaped.replace(/\n/g, '<br>');
  };

  const addRecipient = (type: RecipientType, rawValue: string) => {
    const value = rawValue.trim().replace(/[;,]+$/, '');
    if (!value) return;
    if (!emailRegex.test(value)) {
      setRecipientError('Please enter a valid email address.');
      return;
    }

    setRecipientError(null);
    if (type === 'to') {
      if (!toRecipients.includes(value)) {
        setToRecipients(prev => [...prev, value]);
      }
      setToInput('');
    } else {
      if (!ccRecipients.includes(value)) {
        setCcRecipients(prev => [...prev, value]);
      }
      setCcInput('');
    }
  };

  const handleRecipientKeyDown = (type: RecipientType) => (event: React.KeyboardEvent<HTMLInputElement>) => {
    const keys = ['Enter', ',', ';'];
    const value = type === 'to' ? toInput : ccInput;
    if (keys.includes(event.key)) {
      event.preventDefault();
      if (value.trim()) {
        addRecipient(type, value);
      }
    } else if (event.key === 'Backspace' && !value) {
      if (type === 'to' && toRecipients.length > 0) {
        setToRecipients(prev => prev.slice(0, -1));
      }
      if (type === 'cc' && ccRecipients.length > 0) {
        setCcRecipients(prev => prev.slice(0, -1));
      }
    }
  };

  const removeRecipient = (type: RecipientType, email: string) => {
    if (type === 'to') {
      setToRecipients(prev => prev.filter(item => item !== email));
    } else {
      setCcRecipients(prev => prev.filter(item => item !== email));
    }
  };

  const pushRecipient = (list: string[], address: string) => {
    const normalized = address.trim();
    if (!normalized) return;
    if (!emailRegex.test(normalized)) {
      throw new Error('Please enter a valid email address.');
    }
    if (!list.some(item => item.toLowerCase() === normalized.toLowerCase())) {
      list.push(normalized);
    }
  };

  const handleTemplateSelect = (templateId: number) => {
    if (!client) return;

    const template = templates.find(item => item.id === templateId);
    if (!template) return;

    const clientName = client?.name || 'Client';
    const leadNumber = client?.lead_number ? String(client.lead_number) : '';

    setSelectedTemplateId(templateId);

    if (template.subject && template.subject.trim()) {
      const subjectWithTokens = template.subject
        .replace(/\{client_name\}/gi, clientName)
        .replace(/\{lead_number\}/gi, leadNumber);
      setSubject(subjectWithTokens.trim());
    }

    const templatedBody = template.content
      .replace(/\{client_name\}/gi, clientName)
      .replace(/\{lead_number\}/gi, leadNumber);

    setBody(templatedBody || template.content || template.rawContent);
    setTemplateSearch(template.name);
    setShowTemplateDropdown(false);
  };

  const handleSendOffer = async () => {
    const finalToRecipients = [...toRecipients];
    const finalCcRecipients = [...ccRecipients];

    try {
      if (toInput.trim()) {
        pushRecipient(finalToRecipients, toInput.trim());
      }
      if (ccInput.trim()) {
        pushRecipient(finalCcRecipients, ccInput.trim());
      }
    } catch (error) {
      setRecipientError((error as Error).message || 'Please enter a valid email address.');
      return;
    }

    if (finalToRecipients.length === 0) {
      setRecipientError('Please add at least one recipient.');
      return;
    }

    setRecipientError(null);
    if (toInput.trim()) {
      setToRecipients(finalToRecipients);
      setToInput('');
    }
    if (ccInput.trim()) {
      setCcRecipients(finalCcRecipients);
      setCcInput('');
    }

    if (!client) {
      toast.error('Client data is unavailable.');
      return;
    }

    setSending(true);
    try {
      const account = msalInstance.getAllAccounts()[0];
      if (!account) {
        toast.error('You must be signed in to send an email.');
        setSending(false);
        return;
      }

      let accessToken;
      try {
        const response = await msalInstance.acquireTokenSilent({ ...loginRequest, account });
        accessToken = response.accessToken;
      } catch (error) {
        if (error instanceof InteractionRequiredAuthError) {
          const response = await msalInstance.loginPopup(loginRequest);
          accessToken = response.accessToken;
        } else {
          throw error;
        }
      }

      const closerName = (await fetchCurrentUserFullName()) || 'Current User';

      const htmlBody = convertBodyToHtml(body);

      await sendEmail(accessToken, {
        to: finalToRecipients,
        cc: finalCcRecipients,
        subject,
        body: htmlBody,
      });

      let parsedTotal: number | null = null;
      if (total !== null && total !== undefined && String(total).trim() !== '') {
        const numericTotal = Number(total);
        parsedTotal = Number.isNaN(numericTotal) ? null : numericTotal;
      }

      let stageId = await resolveStageId('Mtng sum+Agreement sent');
      if (stageId === null) {
        stageId = 50;
      }

      await updateLeadStageWithHistory({
        lead: client,
        stage: stageId,
        additionalFields: {
          proposal_text: body,
          proposal_total: parsedTotal,
          proposal_currency: currency,
          closer: closerName,
          balance: parsedTotal,
          balance_currency: currency,
        },
      });

      const now = new Date();
      const recipientListForLog = [...finalToRecipients, ...finalCcRecipients].join(', ');
      const messageId = `offer_${client?.id}_${now.getTime()}`;
      const isLegacyLead = typeof client?.id === 'string' && client.id.startsWith('legacy_');
      const legacyNumericId = isLegacyLead
        ? Number.parseInt(String(client.id).replace('legacy_', ''), 10)
        : null;
      const plainBody = body;

      const emailRecord: Record<string, any> = {
        message_id: messageId,
        thread_id: null,
        sender_name: closerName,
        sender_email: account.username || account.homeAccountId || null,
        recipient_list: recipientListForLog,
        subject,
        body_preview: plainBody,
        body_html: htmlBody,
        sent_at: now.toISOString(),
        direction: 'outgoing',
        attachments: null,
      };

      if (isLegacyLead) {
        emailRecord.legacy_id = Number.isNaN(legacyNumericId) ? null : legacyNumericId;
      } else {
        emailRecord.client_id = client.id;
      }

      await supabase.from('emails').upsert([emailRecord], { onConflict: 'message_id' });

      toast.success('Offer email sent!');
      await onOfferSent();
      onClose();
    } catch (error: any) {
      console.error('Error sending offer email:', error);
      if (error?.message && error.message.includes('category')) {
        toast.error('Please set a category for this client before performing this action.', {
          duration: 4000,
          style: {
            background: '#fee2e2',
            color: '#dc2626',
            border: '1px solid #fecaca',
          },
        });
      } else {
        toast.error('Failed to send offer email.');
      }
    }
    setSending(false);
  };

  const renderRecipients = (type: RecipientType) => {
    const items = type === 'to' ? toRecipients : ccRecipients;
    const value = type === 'to' ? toInput : ccInput;
    const setValue = type === 'to' ? setToInput : setCcInput;
    const placeholder = type === 'to' ? 'Add recipient and press Enter' : 'Add CC and press Enter';

    return (
      <div className="border border-base-300 rounded-lg px-3 py-2 flex flex-wrap gap-2">
        {items.map(email => (
          <span
            key={`${type}-${email}`}
            className="bg-primary/10 text-primary px-2 py-1 rounded-full text-sm flex items-center gap-1"
          >
            {email}
            <button
              type="button"
              onClick={() => removeRecipient(type, email)}
              className="text-primary hover:text-primary-focus"
            >
              <XMarkIcon className="w-4 h-4" />
            </button>
          </span>
        ))}
        <input
          className="flex-1 min-w-[160px] outline-none bg-transparent"
          value={value}
          onChange={event => {
            setValue(event.target.value);
            if (recipientError) {
              setRecipientError(null);
            }
          }}
          onKeyDown={handleRecipientKeyDown(type)}
          placeholder={placeholder}
        />
        <button
          type="button"
          className="btn btn-xs btn-outline"
          onClick={() => addRecipient(type, value)}
          disabled={!value.trim()}
        >
          <PlusIcon className="w-3 h-3" />
        </button>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[70]">
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative z-10 flex flex-col h-full bg-base-100">
        <header className="px-6 py-4 border-b border-base-200 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-bold">Send Price Offer</h2>
            <p className="text-sm text-base-content/60">Create and send a customized price offer to the client.</p>
          </div>
          <div className="flex items-center gap-3" ref={templateDropdownRef}>
            <label className="text-sm font-semibold">Templates</label>
            <div className="relative w-56">
              <input
                type="text"
                className="input input-bordered w-full pr-8"
                placeholder={templatesLoading ? 'Loading templates...' : 'Search templates...'}
                value={templateSearch}
                onChange={event => {
                  setTemplateSearch(event.target.value);
                  if (!showTemplateDropdown) {
                    setShowTemplateDropdown(true);
                  }
                }}
                onFocus={() => {
                  if (!templatesLoading) {
                    setShowTemplateDropdown(true);
                  }
                }}
                disabled={templatesLoading || sending}
              />
              <ChevronDownIcon className="absolute right-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              {showTemplateDropdown && !templatesLoading && (
                <div className="absolute z-20 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-56 overflow-y-auto">
                  {filteredTemplates.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-gray-500">No templates found</div>
                  ) : (
                    filteredTemplates.map(template => (
                      <div
                        key={template.id}
                        className="px-3 py-2 hover:bg-gray-100 cursor-pointer text-sm"
                        onClick={() => handleTemplateSelect(template.id)}
                      >
                        {template.name}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
            {selectedTemplateId !== null && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setSelectedTemplateId(null);
                  setBody('');
                  setSubject(defaultSubject);
                  setTemplateSearch('');
                  setShowTemplateDropdown(false);
                }}
                disabled={sending}
              >
                Clear
              </button>
            )}
          </div>
          <button className="btn btn-ghost" onClick={closeModal} disabled={sending}>
            <XMarkIcon className="w-6 h-6" />
          </button>
        </header>

        <main className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
          <section className="space-y-2">
            <label className="font-semibold text-sm">To</label>
            {renderRecipients('to')}
          </section>

          <section className="space-y-2">
            <label className="font-semibold text-sm">CC</label>
            {renderRecipients('cc')}
          </section>

          {recipientError && <p className="text-sm text-error">{recipientError}</p>}

          <section className="space-y-2">
            <label className="font-semibold text-sm">Subject</label>
            <input
              type="text"
              className="input input-bordered w-full"
              value={subject}
              onChange={event => setSubject(event.target.value)}
            />
          </section>

          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="font-semibold text-sm">Body</label>
              <button
                type="button"
                className="btn btn-xs btn-outline"
                onClick={() => setShowLinkForm(prev => !prev)}
                disabled={sending}
              >
                {showLinkForm ? 'Hide Link Form' : 'Add Link'}
              </button>
            </div>

            {showLinkForm && (
              <div className="flex flex-col gap-3 md:flex-row md:items-end bg-base-200/70 border border-base-300 rounded-lg p-3">
                <div className="flex-1 flex flex-col gap-2 md:flex-row md:items-center">
                  <input
                    type="text"
                    className="input input-bordered w-full md:flex-1"
                    placeholder="Link label (optional)"
                    value={linkLabel}
                    onChange={event => setLinkLabel(event.target.value)}
                  />
                  <input
                    type="url"
                    className="input input-bordered w-full md:flex-1"
                    placeholder="https://example.com"
                    value={linkUrl}
                    onChange={event => setLinkUrl(event.target.value)}
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={handleInsertLink}
                    disabled={sending || !linkUrl.trim()}
                  >
                    Insert Link
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={handleCancelLink}
                    disabled={sending}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <textarea
              className="textarea textarea-bordered w-full min-h-[240px]"
              value={body}
              onChange={event => setBody(event.target.value)}
            />
          </section>
        </main>

        <footer className="px-6 py-4 border-t border-base-200 flex items-center justify-end gap-3">
          <button className="btn btn-ghost" onClick={closeModal} disabled={sending}>
            Cancel
          </button>
          <button
            className="btn btn-primary min-w-[140px] flex items-center gap-2"
            onClick={handleSendOffer}
            disabled={sending}
          >
            {sending ? (
              <span className="loading loading-spinner loading-sm" />
            ) : (
              <>
                <PaperAirplaneIcon className="w-4 h-4" />
                Send Offer
              </>
            )}
          </button>
        </footer>
      </div>
    </div>
  );
};

export default SendPriceOfferModal;
