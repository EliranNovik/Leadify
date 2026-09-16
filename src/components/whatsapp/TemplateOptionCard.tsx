import React from 'react';
import type { WhatsAppTemplate } from '../../lib/whatsappTemplates';

interface TemplateOptionCardProps {
  template: WhatsAppTemplate;
  isSelected?: boolean;
  onClick: () => void;
}

const containsRTL = (text?: string | null): boolean => {
  if (!text) return false;
  return /[\u0590-\u05FF]/.test(text);
};

const TemplateOptionCard: React.FC<TemplateOptionCardProps> = ({
  template,
  isSelected = false,
  onClick,
}) => {
  const hasParams = template.params !== '0' && Number(template.params) > 0;
  const contentHasHebrew = containsRTL(template.content);
  const titleHasHebrew = containsRTL(template.title || template.name360);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full p-3.5 rounded-2xl bg-white text-left transition-shadow ${
        isSelected ? 'shadow-md' : 'shadow-none hover:shadow-sm'
      }`}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${
            template.active === 't'
              ? 'bg-emerald-50 text-emerald-700'
              : 'bg-amber-50 text-amber-700'
          }`}
        >
          {template.active === 't' ? 'Active' : 'Pending'}
        </span>
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 text-gray-500">
          {template.language || 'en'}
        </span>
        {hasParams && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-orange-50 text-orange-700">
            {template.params} Parameter{Number(template.params) !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      <div
        className="mt-2 font-semibold text-gray-900 text-sm"
        dir={titleHasHebrew ? 'rtl' : 'ltr'}
        style={{ textAlign: titleHasHebrew ? 'right' : 'left' }}
      >
        {template.title || template.name360 || 'Untitled'}
      </div>

      {template.content && template.content.trim() && (
        <div
          className="mt-1 text-sm text-gray-500 line-clamp-4 whitespace-pre-wrap"
          dir={contentHasHebrew ? 'rtl' : 'ltr'}
          style={{ textAlign: contentHasHebrew ? 'right' : 'left' }}
        >
          {template.content}
        </div>
      )}
    </button>
  );
};

export default TemplateOptionCard;
