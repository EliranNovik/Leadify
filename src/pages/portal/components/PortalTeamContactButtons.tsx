import React from 'react';
import { PhoneIcon } from '@heroicons/react/24/solid';
import { FaWhatsapp } from 'react-icons/fa';
import type { PortalTeamContact } from '../../../lib/portalApi';

function buildWhatsAppUrl(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits ? `https://wa.me/${digits}` : '';
}

export function pickTeamCallNumber(contact: PortalTeamContact): string | null {
  const mobile = contact.mobile?.trim();
  if (mobile) return mobile;
  const phone = contact.phone?.trim();
  return phone || null;
}

export function pickTeamMobileDisplay(contact: PortalTeamContact): string | null {
  const mobile = contact.mobile?.trim();
  if (mobile) return mobile;
  return contact.phone?.trim() || null;
}

function OutlookIcon({ className = 'h-[18px] w-[18px]' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#0078D4" d="M22 6.5v11c0 .83-.67 1.5-1.5 1.5H17V5h3.5c.83 0 1.5.67 1.5 1.5z" />
      <path fill="#0078D4" d="M16 5H4.5C3.67 5 3 5.67 3 6.5v11c0 .83.67 1.5 1.5 1.5H16V5z" />
      <path fill="#28A8EA" d="M15 12.5 8.5 7.25v10.5L15 12.5z" />
      <ellipse fill="#0078D4" cx="9.5" cy="12.5" rx="3.5" ry="4" />
    </svg>
  );
}

type ContactKind = 'email' | 'call' | 'whatsapp';

type ContactItem = {
  href: string;
  label: string;
  kind: ContactKind;
  external: boolean;
};

const BUTTON_BASE_CLASS =
  'inline-flex h-9 w-9 items-center justify-center rounded-full transition-all duration-[180ms] hover:-translate-y-px';

const BUTTON_CLASS_BY_KIND: Record<ContactKind, string> = {
  whatsapp:
    'bg-[#25D366] text-white shadow-[0_4px_12px_rgba(37,211,102,0.35)] hover:bg-[#20BD5A] hover:shadow-[0_6px_16px_rgba(37,211,102,0.4)]',
  email:
    'border border-[#C7E0F4] bg-[#EAF3FC] shadow-sm hover:bg-[#D6EBFA] hover:shadow-md',
  call:
    'border border-[rgba(15,23,42,0.08)] bg-[#f6f5fa] text-[#16161d] hover:bg-[#ececef]',
};

type Props = {
  contact: PortalTeamContact | null | undefined;
};

const PortalTeamContactButtons: React.FC<Props> = ({ contact }) => {
  if (!contact) return null;

  const email = contact.email?.trim() || null;
  const callNumber = pickTeamCallNumber(contact);
  const whatsAppNumber = pickTeamMobileDisplay(contact);
  const whatsAppUrl = whatsAppNumber ? buildWhatsAppUrl(whatsAppNumber) : null;

  if (!email && !callNumber && !whatsAppUrl) return null;

  const items = [
    email
      ? {
          href: `mailto:${email}`,
          label: 'Email',
          kind: 'email' as const,
          external: false,
        }
      : null,
    callNumber
      ? {
          href: `tel:${callNumber}`,
          label: 'Call',
          kind: 'call' as const,
          external: false,
        }
      : null,
    whatsAppUrl
      ? {
          href: whatsAppUrl,
          label: 'WhatsApp',
          kind: 'whatsapp' as const,
          external: true,
        }
      : null,
  ].filter(Boolean) as ContactItem[];

  return (
    <div className="flex items-center justify-start gap-2.5">
      {items.map(({ href, label, kind, external }) => (
        <a
          key={label}
          href={href}
          target={external ? '_blank' : undefined}
          rel={external ? 'noopener noreferrer' : undefined}
          className={`${BUTTON_BASE_CLASS} ${BUTTON_CLASS_BY_KIND[kind]}`}
          aria-label={label}
        >
          {kind === 'email' ? <OutlookIcon /> : null}
          {kind === 'call' ? <PhoneIcon className="h-[18px] w-[18px] text-[#16161d]" /> : null}
          {kind === 'whatsapp' ? <FaWhatsapp className="h-[18px] w-[18px]" /> : null}
        </a>
      ))}
    </div>
  );
};

export default PortalTeamContactButtons;
