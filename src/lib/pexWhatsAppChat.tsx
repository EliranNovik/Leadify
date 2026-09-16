import { useState } from 'react';
import { createPortal } from 'react-dom';
import { DocumentTextIcon, LockClosedIcon, LockOpenIcon, XMarkIcon } from '@heroicons/react/24/outline';
import {
  AI_AGENT_DISPLAY_NAME,
  AI_AGENT_EMPLOYEE_ID,
  isAiAgentEmail,
} from './aiAgentMailbox';

/** PEX / partner inserts use these prefixes (see docs/EMAILS_AND_WHATSAPP_MESSAGES_GUIDE.md). */
export const PEX_WHATSAPP_MESSAGE_ID_RE = /^(partner_|pex_|pexagent_)/i;

/** Sender names PEX has used on inserted rows. */
export const PEX_WHATSAPP_SENDER_RE = /\b(pex|partner firm)\b/i;

export type PexWhatsAppMessageSignal = {
  whatsapp_message_id?: string | null;
  sender_name?: string | null;
};

export function isPexWhatsAppMessageId(id?: string | null): boolean {
  return typeof id === 'string' && PEX_WHATSAPP_MESSAGE_ID_RE.test(id.trim());
}

export function isPexWhatsAppSenderName(name?: string | null): boolean {
  return typeof name === 'string' && PEX_WHATSAPP_SENDER_RE.test(name);
}

/** CRM staff replies saved for PEX to send (see buildPexCrmMessageId). */
export function isPexCrmStaffReplyMessageId(id?: string | null): boolean {
  return typeof id === 'string' && /^(crm_|pex_crm_)/i.test(id.trim());
}

/** Rows PEX itself inserted (not a CRM staff reply routed through PEX). */
export function isPexAgentInsertedMessageId(id?: string | null): boolean {
  return isPexWhatsAppMessageId(id) && !isPexCrmStaffReplyMessageId(id);
}

function parseEmployeeId(value?: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Outgoing WhatsApp attribution:
 * - Real employees keep their name and photo.
 * - PEX-agent / partner inserts (and employee 177) show as AI Agent with 177's photo.
 */
export function resolveWhatsAppOutgoingSenderUi(
  message: {
    sender_name?: string | null;
    whatsapp_message_id?: string | null;
  },
  lookedUpEmployeeId?: unknown,
): { label: string; employeeId: number | null } {
  const senderName = String(message.sender_name || '').trim();
  const looked = parseEmployeeId(lookedUpEmployeeId);

  if (looked != null && looked !== AI_AGENT_EMPLOYEE_ID) {
    return { label: senderName, employeeId: looked };
  }

  const looksLikePexAgent =
    looked === AI_AGENT_EMPLOYEE_ID ||
    isAiAgentEmail(senderName) ||
    senderName.toLowerCase() === AI_AGENT_DISPLAY_NAME.toLowerCase() ||
    isPexWhatsAppSenderName(senderName) ||
    isPexAgentInsertedMessageId(message.whatsapp_message_id);

  if (looksLikePexAgent) {
    return { label: AI_AGENT_DISPLAY_NAME, employeeId: AI_AGENT_EMPLOYEE_ID };
  }

  return { label: senderName, employeeId: looked };
}

/**
 * A thread is PEX WhatsApp when PEX already wrote the 24h window on the lead,
 * or any existing row looks partner-originated.
 */
export function isPexWhatsAppThread(input: {
  messages?: PexWhatsAppMessageSignal[] | null;
  waWindowExpiresAt?: string | null;
}): boolean {
  if (input.waWindowExpiresAt) return true;
  const messages = input.messages;
  if (!Array.isArray(messages) || messages.length === 0) return false;
  return messages.some(
    (m) => isPexWhatsAppMessageId(m.whatsapp_message_id) || isPexWhatsAppSenderName(m.sender_name),
  );
}

export function whatsAppSendSuccessToast(via?: string | null): string {
  return via === 'pex' ? 'Reply saved — PEX will send it' : 'Message sent via WhatsApp!';
}

type WhatsAppSendApiResult = {
  error?: string;
  details?: string | null;
  code?: string;
  messageId?: string;
  saved?: boolean;
  warning?: string;
  via?: string | null;
};

/** Meta already accepted the message; CRM insert timed out (57014) after send. */
export function whatsAppSendSaveTimedOut(result?: WhatsAppSendApiResult | null): boolean {
  const error = String(result?.error || '');
  const details = String(result?.details || result?.warning || '');
  return (
    error === 'Failed to save message' &&
    /timeout|canceling statement/i.test(details)
  );
}

/** HTTP 200, or WhatsApp sent and only the CRM save timed out. */
export function whatsAppDispatchSucceeded(
  responseOk: boolean,
  result?: WhatsAppSendApiResult | null,
): boolean {
  return responseOk || whatsAppSendSaveTimedOut(result);
}

export function whatsAppSendResultToast(result?: WhatsAppSendApiResult | null): string {
  return whatsAppSendSuccessToast(result?.via);
}

export function WhatsAppChannelBadge({
  isPex,
  compact = false,
  className = '',
}: {
  isPex: boolean;
  compact?: boolean;
  className?: string;
}) {
  if (!isPex) return null;

  return (
    <span
      className={`inline-flex items-center rounded-full bg-violet-100 px-2 py-0.5 font-semibold uppercase tracking-wide text-violet-800 ${
        compact ? 'text-[9px]' : 'text-[10px]'
      } ${className}`}
      title="This chat is on PEX WhatsApp. Staff replies are saved here and sent by PEX, not our Business number."
    >
      PEX WhatsApp
    </span>
  );
}

export function WhatsAppPexComposerHint({ className = '' }: { className?: string }) {
  return (
    <p className={`text-[11px] text-violet-700 ${className}`}>
      PEX WhatsApp — your reply is saved here and sent by PEX, not our Business number.
    </p>
  );
}

export const PEX_TEMPLATES_UNAVAILABLE_SHORT = 'Templates unavailable in this chat';

export const PEX_TEMPLATES_UNAVAILABLE =
  'PEX agent is taking over this chat. Templates are unavailable at the moment.';

export function whatsAppWindowLockLabel(isPex: boolean): string {
  return isPex ? '24-Hours rule' : '24-Hours rule - use templates';
}

export function whatsAppComposerLocked(windowLocked: boolean, adminUnlocked: boolean): boolean {
  return windowLocked && !adminUnlocked;
}

export function templateNeedsParamInput(template: { params?: string | number | null } | null | undefined): boolean {
  return String(template?.params ?? '') === '1';
}

/** Free-text stays locked; an approved template can still be sent after the 24h window. */
export function whatsAppSendBlockedByWindow(
  inputLocked: boolean,
  selectedTemplate: unknown,
  isPexChat = false,
): boolean {
  if (!inputLocked) return false;
  if (isPexChat) return true;
  return !selectedTemplate;
}

/** Lock typing in the composer, except when a template still needs a parameter. */
export function whatsAppComposerTextDisabled(
  inputLocked: boolean,
  selectedTemplate: { params?: string | number | null } | null | undefined,
): boolean {
  if (templateNeedsParamInput(selectedTemplate)) return false;
  return inputLocked;
}

export function WhatsAppWindowLockBanner({
  isPex,
  windowLocked,
  adminUnlocked,
  className = 'mb-2 pointer-events-auto',
}: {
  isPex: boolean;
  windowLocked: boolean;
  adminUnlocked?: boolean;
  className?: string;
}) {
  if (!windowLocked) return null;

  if (adminUnlocked) {
    return (
      <div className={className}>
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-50 border border-violet-200 rounded-lg shadow-md whitespace-nowrap w-fit">
          <LockOpenIcon className="w-4 h-4 text-violet-700 flex-shrink-0" />
          <span className="text-xs font-medium text-violet-800">24-hour window unlocked (admin test)</span>
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 border border-red-200 rounded-lg shadow-md whitespace-nowrap w-fit">
        <LockClosedIcon className="w-4 h-4 text-red-600 flex-shrink-0" />
        <span className="text-xs font-medium text-red-700">{whatsAppWindowLockLabel(isPex)}</span>
      </div>
    </div>
  );
}

export function WhatsAppPexUnlockMenuItem({
  isPex,
  isSuperuser,
  windowLocked,
  unlocked,
  onToggle,
  onClose,
  compact = false,
}: {
  isPex: boolean;
  isSuperuser: boolean;
  windowLocked: boolean;
  unlocked: boolean;
  onToggle: () => void;
  onClose?: () => void;
  compact?: boolean;
}) {
  if (!isPex || !isSuperuser || (!windowLocked && !unlocked)) return null;

  return (
    <button
      type="button"
      role="menuitem"
      title={unlocked ? 'Re-lock the 24-hour window' : 'Unlock the 24-hour window to send a test message'}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
        onClose?.();
      }}
      className={
        compact
          ? 'w-full text-left px-4 py-3 text-sm hover:bg-violet-50 flex items-center gap-2'
          : 'w-full flex items-center gap-3 px-4 py-3 hover:bg-violet-50 text-left transition-colors'
      }
    >
      {unlocked ? (
        <LockClosedIcon className={`${compact ? 'w-4 h-4' : 'w-5 h-5'} text-gray-600`} />
      ) : (
        <LockOpenIcon className={`${compact ? 'w-4 h-4' : 'w-5 h-5'} text-violet-700`} />
      )}
      {compact ? (
        unlocked ? 'Re-lock 24-hour window' : 'Unlock 24-hour window'
      ) : (
        <span className="text-sm text-gray-700">
          {unlocked ? 'Re-lock 24-hour window' : 'Unlock 24-hour window'}
        </span>
      )}
    </button>
  );
}

export function whatsAppLockedPlaceholder(isPex: boolean, noMessages: boolean): string {
  if (isPex) {
    return noMessages
      ? 'No messages yet — PEX agent is handling this chat'
      : 'Window expired — PEX agent is handling this chat';
  }
  return noMessages
    ? 'No messages yet - use templates to start conversation'
    : 'Window expired - use templates';
}

export function WhatsAppPexTemplatesModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  if (!isOpen || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[20000] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pex-templates-unavailable-title"
        className="relative z-10 w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h3 id="pex-templates-unavailable-title" className="text-lg font-semibold text-gray-900">
            Templates unavailable
          </h3>
          <button type="button" className="btn btn-ghost btn-sm btn-circle" onClick={onClose}>
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
        <p className="text-sm leading-relaxed text-gray-700">
          PEX agent is taking over this chat, so WhatsApp templates cannot be sent from here right now.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-gray-700">
          Templates in connection with the PEX agent will be available soon.
        </p>
        <div className="mt-5 flex justify-end">
          <button type="button" className="btn btn-neutral btn-sm" onClick={onClose}>
            Got it
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function WhatsAppTemplateMenuItem({
  isPex,
  onOpen,
  compact = false,
}: {
  isPex: boolean;
  onOpen: () => void;
  compact?: boolean;
}) {
  const [showPexModal, setShowPexModal] = useState(false);

  return (
    <>
      <div
        className={isPex ? 'tooltip tooltip-right w-full' : 'w-full'}
        data-tip={isPex ? PEX_TEMPLATES_UNAVAILABLE_SHORT : undefined}
      >
        <button
          type="button"
          title={isPex ? PEX_TEMPLATES_UNAVAILABLE_SHORT : 'Templates'}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (isPex) {
              setShowPexModal(true);
              return;
            }
            onOpen();
          }}
          className={
            compact
              ? 'w-full text-left px-4 py-3 text-sm hover:bg-gray-50 flex items-center gap-2'
              : 'w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-left transition-colors'
          }
        >
          <DocumentTextIcon className={`${compact ? 'w-4 h-4' : 'w-5 h-5'} ${isPex ? 'text-gray-400' : 'text-green-600'}`} />
          {compact ? 'Template' : <span className="text-sm text-gray-700">Template</span>}
        </button>
      </div>
      <WhatsAppPexTemplatesModal isOpen={showPexModal} onClose={() => setShowPexModal(false)} />
    </>
  );
}
