import React from 'react';
import { EnvelopeIcon, PhoneIcon } from '@heroicons/react/24/outline';
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
          icon: EnvelopeIcon,
          external: false,
        }
      : null,
    callNumber
      ? {
          href: `tel:${callNumber}`,
          label: 'Call',
          icon: PhoneIcon,
          external: false,
        }
      : null,
    whatsAppUrl
      ? {
          href: whatsAppUrl,
          label: 'WhatsApp',
          icon: FaWhatsapp,
          external: true,
        }
      : null,
  ].filter(Boolean) as Array<{
    href: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    external: boolean;
  }>;

  return (
    <div className="flex flex-wrap items-end justify-center gap-3 md:gap-4">
      {items.map(({ href, label, icon: Icon, external }) => (
        <a
          key={label}
          href={href}
          target={external ? '_blank' : undefined}
          rel={external ? 'noopener noreferrer' : undefined}
          className="inline-flex flex-col items-center text-neutral-900 transition-colors hover:text-primary"
          aria-label={label}
        >
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100 transition-colors hover:bg-neutral-200 md:h-14 md:w-14">
            <Icon className="h-6 w-6 md:h-7 md:w-7" />
          </span>
        </a>
      ))}
    </div>
  );
};

export default PortalTeamContactButtons;
