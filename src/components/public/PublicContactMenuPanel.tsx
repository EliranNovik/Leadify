import React from 'react';
import { PhoneIcon } from '@heroicons/react/24/outline';
import { FaWhatsapp, FaEnvelope } from 'react-icons/fa';
import { OFFICE_EMAIL, OFFICE_PHONE, WHATSAPP_URL } from './publicContactInfo';

type Props = {
  onItemClick?: () => void;
  contactUsLabel?: string;
  whatsappLabel?: string;
  emailLabel?: string;
  callLabel?: string;
};

const PublicContactMenuPanel: React.FC<Props> = ({
  onItemClick,
  contactUsLabel = 'Contact us',
  whatsappLabel = 'WhatsApp',
  emailLabel = 'Email',
  callLabel = 'Call',
}) => (
  <div className="bg-white border border-gray-200 rounded-2xl shadow-lg p-3 min-w-[200px]">
    <p className="text-xs text-gray-500 px-2 pb-2 border-b border-gray-100 mb-2">{contactUsLabel}</p>
    <div className="flex flex-col gap-1">
      <a
        href={WHATSAPP_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-gray-700 hover:bg-gray-50"
        onClick={onItemClick}
      >
        <FaWhatsapp className="w-4 h-4 text-green-600" />
        {whatsappLabel}
      </a>
      <a
        href={`mailto:${OFFICE_EMAIL}`}
        className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-gray-700 hover:bg-gray-50"
        onClick={onItemClick}
      >
        <FaEnvelope className="w-4 h-4 text-blue-600" />
        {emailLabel}
      </a>
      <a
        href={`tel:${OFFICE_PHONE}`}
        className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-gray-700 hover:bg-gray-50"
        onClick={onItemClick}
      >
        <PhoneIcon className="w-4 h-4 text-violet-600" />
        {callLabel}
      </a>
    </div>
  </div>
);

export default PublicContactMenuPanel;
