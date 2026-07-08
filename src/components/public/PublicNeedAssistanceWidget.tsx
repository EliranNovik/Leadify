import React, { useEffect, useRef, useState } from 'react';
import { LifebuoyIcon } from '@heroicons/react/24/outline';
import { PhoneIcon as PhoneIconSolid } from '@heroicons/react/24/solid';
import { FaWhatsapp, FaEnvelope } from 'react-icons/fa';
import { OFFICE_EMAIL, OFFICE_PHONE_TEL, WHATSAPP_URL } from './publicContactInfo';

const contactIconBtnClass =
  'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white shadow-lg transition-[transform,opacity,box-shadow] duration-300 ease-out hover:scale-110 hover:shadow-xl active:scale-95';

type ContactItem = {
  key: string;
  href: string;
  external?: boolean;
  className: string;
  title: string;
  ariaLabel: string;
  icon: React.ReactNode;
};

const CONTACT_ITEMS: ContactItem[] = [
  {
    key: 'whatsapp',
    href: WHATSAPP_URL,
    external: true,
    className: 'bg-green-500 hover:bg-green-600',
    title: 'Chat on WhatsApp',
    ariaLabel: 'WhatsApp',
    icon: <FaWhatsapp className="h-5 w-5" />,
  },
  {
    key: 'email',
    href: `mailto:${OFFICE_EMAIL}`,
    className: 'bg-blue-600 hover:bg-blue-700',
    title: 'Send Email',
    ariaLabel: 'Email',
    icon: <FaEnvelope className="h-5 w-5" />,
  },
  {
    key: 'phone',
    href: OFFICE_PHONE_TEL,
    className: 'bg-purple-600 hover:bg-purple-700',
    title: 'Call Office',
    ariaLabel: 'Phone',
    icon: <PhoneIconSolid className="h-5 w-5" />,
  },
];

const AnimatedContactLinks: React.FC<{
  open: boolean;
  layout?: 'row' | 'column';
  contactOptionsLabel: string;
  alignEnd?: boolean;
}> = ({ open, layout = 'column', contactOptionsLabel, alignEnd = true }) => (
  <div
    className={`flex gap-2.5 ${
      layout === 'column'
        ? `flex-col ${alignEnd ? 'items-end' : 'items-start'}`
        : 'flex-row items-center justify-center'
    } ${open ? 'pointer-events-auto' : 'pointer-events-none'}`}
    role="group"
    aria-label={contactOptionsLabel}
    aria-hidden={!open}
  >
    {CONTACT_ITEMS.map((item, index) => {
      const openDelay = (CONTACT_ITEMS.length - 1 - index) * 80;
      const closeDelay = index * 45;

      return (
        <a
          key={item.key}
          href={item.href}
          target={item.external ? '_blank' : undefined}
          rel={item.external ? 'noopener noreferrer' : undefined}
          className={`${contactIconBtnClass} ${item.className} ${
            open
              ? 'translate-y-0 scale-100 opacity-100'
              : 'translate-y-3 scale-75 opacity-0'
          }`}
          style={{
            transitionDelay: open ? `${openDelay}ms` : `${closeDelay}ms`,
          }}
          title={item.title}
          aria-label={item.ariaLabel}
          tabIndex={open ? 0 : -1}
        >
          {item.icon}
        </a>
      );
    })}
  </div>
);

type AssistanceLabels = {
  needAssistance: string;
  close: string;
  contactOptions: string;
};

const DEFAULT_LABELS: AssistanceLabels = {
  needAssistance: 'Need assistance?',
  close: 'Close',
  contactOptions: 'Contact options',
};

type Props = {
  closerSlot?: React.ReactNode;
  className?: string;
  dir?: 'ltr' | 'rtl';
  labels?: Partial<AssistanceLabels>;
};

const PublicNeedAssistanceWidget: React.FC<Props> = ({
  closerSlot,
  className = '',
  dir = 'ltr',
  labels: labelsProp,
}) => {
  const labels = { ...DEFAULT_LABELS, ...labelsProp };
  const isRtl = dir === 'rtl';
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  return (
    <div
      ref={rootRef}
      className={`print-hide fixed bottom-6 z-50 flex items-end gap-2 ${
        isRtl ? 'left-4 md:left-6' : 'right-4 md:right-6'
      } ${className}`}
      style={{ paddingBottom: 'max(0px, env(safe-area-inset-bottom))' }}
      dir={dir}
    >
      {closerSlot}
      <div className={`relative flex flex-col ${isRtl ? 'items-start' : 'items-end'}`}>
        <div
          className={`absolute bottom-full z-10 mb-3 ${isRtl ? 'left-0' : 'right-0'}`}
        >
          <AnimatedContactLinks
            open={open}
            layout="column"
            contactOptionsLabel={labels.contactOptions}
            alignEnd={!isRtl}
          />
        </div>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-label={open ? labels.close : labels.needAssistance}
          className={`inline-flex items-center gap-2.5 rounded-full border px-4 py-3 text-sm font-semibold shadow-md transition hover:shadow-lg active:scale-[0.98] ${
            open
              ? 'border-slate-300 bg-slate-700 text-white'
              : 'border-slate-200/80 bg-white text-slate-800 hover:border-slate-300 hover:bg-slate-50'
          }`}
        >
          <LifebuoyIcon className={`h-5 w-5 shrink-0 ${open ? 'text-white' : 'text-slate-600'}`} />
          <span className="whitespace-nowrap hidden sm:inline">
            {open ? labels.close : labels.needAssistance}
          </span>
        </button>
      </div>
    </div>
  );
};

export default PublicNeedAssistanceWidget;
