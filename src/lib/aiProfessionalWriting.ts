/** Shared writing rules for client outreach and meeting summaries. */

export const DETAILED_CLIENT_OUTREACH_INSTRUCTION =
  'Read the full case file before writing: meetings and briefs, last WhatsApp and email, contracts/POA/invoices and whether they are signed, eligibility, proposal/payments, and the open next step. ' +
  'Write a detailed, professional message — never a short “just checking in”. ' +
  'Use 4–7 short paragraphs: greeting; why you are writing, grounded in real case facts; what was last discussed or agreed; current status (unsigned documents, payments, next meeting) only if those facts exist; a clear call to action. ' +
  'Do not invent facts, dates, amounts, or URLs. Do not write a one-paragraph note.';

export const DETAILED_MEETING_SUMMARY_INSTRUCTION =
  'Read the full case file and any staff notes, then write a detailed professional meeting summary — not a 2-line recap. ' +
  'Cover: who the client is and what they want; what was said in the meeting; eligibility/documents/money status that was actually discussed or is on file; objections or open questions; the agreed or recommended next step. ' +
  'Use 4–8 short paragraphs. Keep the staff’s own notes. Never invent facts. No CRM field labels, markdown, or URLs unless the staff asked for a link.';

export type EmailAiQuickAction = {
  id: 'follow_up' | 'meeting_summary' | 'summarize_lead';
  label: string;
  hint: string;
  prompt: string;
};

export const EMAIL_AI_QUICK_ACTIONS: EmailAiQuickAction[] = [
  {
    id: 'follow_up',
    label: 'Create follow up',
    hint: 'Detailed email from the case file',
    prompt:
      'Write a detailed professional follow-up email for this client. Read the full case file (meetings, last messages, contracts/POA, payments, next steps) and write 4–7 short paragraphs — not a short check-in. Put the email in the draft. Stop after Best regards,',
  },
  {
    id: 'meeting_summary',
    label: 'Create meeting summary',
    hint: 'Put the meeting recap in the email',
    prompt:
      'Write a detailed professional meeting summary for this client from the case file and meeting notes, then put that summary in the email body. Cover what was discussed, case status, and the next step. Not a 2-line recap. Do not invent facts.',
  },
  {
    id: 'summarize_lead',
    label: 'Summarize lead',
    hint: 'Case overview in the chat',
    prompt:
      'IMPORTANT: This is a chat-only question. Do not draft, rewrite, or change the email. Ignore any instruction to write an email. Summarize this lead from the CRM case file: who they are, what they want, stage, last meeting and communication, contract/POA/invoice status, and the next step. Write a detailed professional summary in the chat.',
  },
];
