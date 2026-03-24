import React from 'react';
import { EnvelopeIcon, PhoneIcon, ChatBubbleLeftRightIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { FaWhatsapp } from 'react-icons/fa';

type LeadInteractionsModalProps = {
  isOpen: boolean;
  onClose: () => void;
  leadName: string;
  interactions: any[];
  isLoading: boolean;
};

const isHebrewText = (text: string): boolean => {
  if (!text) return false;
  return /[\u0590-\u05FF]/.test(text);
};

const LeadInteractionsModal: React.FC<LeadInteractionsModalProps> = ({
  isOpen,
  onClose,
  leadName,
  interactions,
  isLoading,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-4xl max-h-[85vh] overflow-hidden rounded-2xl bg-white shadow-2xl border border-gray-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 bg-gradient-to-r from-indigo-50 to-purple-50">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Latest Interactions</h3>
            <p className="text-sm text-gray-600 truncate max-w-[70vw]">{leadName || 'Lead'}</p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm btn-circle" onClick={onClose} aria-label="Close interactions modal">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto max-h-[calc(85vh-86px)]">
          {isLoading ? (
            <div className="flex justify-center py-10">
              <span className="loading loading-spinner loading-md" />
            </div>
          ) : interactions.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {interactions.map((interaction, idx) => {
                const interactionDate = interaction.date ? new Date(interaction.date) : null;
                const dateStr = interactionDate
                  ? interactionDate.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
                  : '';
                const timeStr = interactionDate
                  ? interactionDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
                  : '';

                let icon = <ChatBubbleLeftRightIcon className="w-4 h-4" />;
                let iconColor = 'text-gray-600';
                let typeLabel = interaction.type?.toUpperCase() || 'OTHER';
                if (interaction.type === 'email') {
                  icon = <EnvelopeIcon className="w-4 h-4" />;
                  iconColor = 'text-blue-600';
                  typeLabel = 'EMAIL';
                } else if (interaction.type === 'whatsapp') {
                  icon = <FaWhatsapp className="w-4 h-4" />;
                  iconColor = 'text-green-600';
                  typeLabel = 'WHATSAPP';
                } else if (interaction.type === 'call') {
                  icon = <PhoneIcon className="w-4 h-4" />;
                  iconColor = 'text-purple-600';
                  typeLabel = 'CALL';
                } else if (interaction.type === 'manual') {
                  icon = <ChatBubbleLeftRightIcon className="w-4 h-4" />;
                  iconColor = 'text-orange-600';
                  typeLabel = 'MANUAL';
                }

                const directionText = interaction.direction === 'in' ? 'Incoming' : 'Outgoing';

                let contentText = interaction.content || '';
                if (interaction.body && typeof interaction.body === 'string') {
                  contentText = interaction.body;
                }
                if (contentText && typeof contentText === 'string') {
                  // Preserve original line breaks from HTML/text bodies.
                  contentText = contentText
                    .replace(/<br\s*\/?>/gi, '\n')
                    .replace(/<\/p>/gi, '\n')
                    .replace(/<li>/gi, '\n- ')
                    .replace(/<[^>]*>/g, '')
                    .replace(/&nbsp;/g, ' ')
                    .replace(/\r\n/g, '\n')
                    .trim();
                }
                const contentPreview = contentText || 'No content';

                return (
                  <div key={interaction.id || idx} className="rounded-xl border border-gray-200 bg-white p-3 hover:bg-gray-50 transition-colors">
                    <div className="flex items-start gap-3">
                      <div className={`flex-shrink-0 ${iconColor}`}>
                        {icon}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center flex-wrap gap-1.5 text-xs text-gray-500 mb-4">
                          <span className="font-semibold text-gray-700">{typeLabel}</span>
                          <span>•</span>
                          <span>{directionText}</span>
                          {dateStr ? (
                            <>
                              <span>•</span>
                              <span>{dateStr} {timeStr}</span>
                            </>
                          ) : null}
                          {interaction.employee_name ? (
                            <>
                              <span>•</span>
                              <span className="font-medium">{interaction.direction === 'in' ? 'Received by' : 'Sent by'}: {interaction.employee_name}</span>
                            </>
                          ) : null}
                        </div>
                        <div
                          className={`text-sm text-gray-900 break-words whitespace-pre-wrap ${isHebrewText(contentPreview) ? 'text-right' : 'text-left'}`}
                          dir={isHebrewText(contentPreview) ? 'rtl' : 'ltr'}
                        >
                          {contentPreview}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="py-10 text-center text-gray-500">No interactions found</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LeadInteractionsModal;
