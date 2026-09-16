import { useMemo } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { filterTemplates, type WhatsAppTemplate } from '../../lib/whatsappTemplates';
import TemplateOptionCard from './TemplateOptionCard';

function normalizeLanguage(lang?: string | null): string {
  if (!lang) return 'en';
  const normalized = lang.toLowerCase();
  if (normalized === 'en_us' || normalized === 'en') return 'en';
  return normalized;
}

function getLanguageDisplayName(lang: string): string {
  const normalized = normalizeLanguage(lang);
  const langMap: Record<string, string> = {
    en: 'English',
    he: 'Hebrew',
    fr: 'French',
    ar: 'Arabic',
    ru: 'Russian',
    es: 'Spanish',
    de: 'German',
    it: 'Italian',
    pt: 'Portuguese',
    zh: 'Chinese',
    ja: 'Japanese',
    ko: 'Korean',
    tr: 'Turkish',
    pl: 'Polish',
    nl: 'Dutch',
    sv: 'Swedish',
    da: 'Danish',
    no: 'Norwegian',
    fi: 'Finnish',
  };
  return langMap[normalized] || lang.toUpperCase();
}

export type WhatsAppTemplatePickerProps = {
  templates: WhatsAppTemplate[];
  selectedTemplate?: WhatsAppTemplate | null;
  searchTerm: string;
  onSearchChange: (value: string) => void;
  selectedLanguage: string;
  onLanguageChange: (value: string) => void;
  isLoading?: boolean;
  onClose: () => void;
  onSelect: (template: WhatsAppTemplate) => void;
  className?: string;
};

export default function WhatsAppTemplatePicker({
  templates,
  selectedTemplate,
  searchTerm,
  onSearchChange,
  selectedLanguage,
  onLanguageChange,
  isLoading = false,
  onClose,
  onSelect,
  className = '',
}: WhatsAppTemplatePickerProps) {
  const languages = useMemo(
    () => Array.from(new Set(templates.map((t) => normalizeLanguage(t.language)))).sort(),
    [templates],
  );

  const filtered = useMemo(() => {
    let list = filterTemplates(templates, searchTerm);
    if (selectedLanguage) {
      list = list.filter((t) => normalizeLanguage(t.language) === selectedLanguage);
    }
    return list;
  }, [templates, searchTerm, selectedLanguage]);

  return (
    <div
      className={`flex flex-col overflow-hidden rounded-2xl bg-gray-200 shadow-[0_18px_50px_rgba(15,23,42,0.18)] ${className}`}
    >
      <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-2 flex-shrink-0">
        <h3 className="text-sm font-semibold text-gray-800">Templates</h3>
        <button
          type="button"
          onClick={onClose}
          className="btn btn-ghost btn-xs btn-circle text-gray-500 hover:bg-white/70"
          aria-label="Close templates"
        >
          <XMarkIcon className="w-4 h-4" />
        </button>
      </div>

      <div className="flex gap-2 px-3 pb-3 flex-shrink-0">
        <input
          type="text"
          placeholder="Search templates..."
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
          className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-white text-sm text-gray-800 placeholder:text-gray-400 outline-none ring-0 border-0"
        />
        <select
          value={selectedLanguage}
          onChange={(e) => onLanguageChange(e.target.value)}
          className="px-3 py-2 rounded-xl bg-white text-sm text-gray-700 outline-none ring-0 border-0 min-w-[7.5rem]"
        >
          <option value="">All languages</option>
          {languages.map((lang) => (
            <option key={lang} value={lang}>
              {getLanguageDisplayName(lang)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 space-y-2">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-gray-500">
            <div className="loading loading-spinner loading-sm" />
            Loading templates...
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-500">
            {searchTerm || selectedLanguage ? 'No templates match these filters.' : 'No templates available.'}
          </div>
        ) : (
          filtered.map((template) => (
            <TemplateOptionCard
              key={template.id}
              template={template}
              isSelected={selectedTemplate?.id === template.id}
              onClick={() => onSelect(template)}
            />
          ))
        )}
      </div>
    </div>
  );
}
