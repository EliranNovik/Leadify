import React, { forwardRef } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import AISuggestions from './AISuggestions';

export interface AIAssistantBoxProps {
  /** Fixed height (e.g. to match adjacent content). Omit for natural height. */
  height?: number;
  /** Called when the user clicks the close button. */
  onClose: () => void;
  /** Signed-in user's employee ID. When set, only leads where this user has a role are shown. */
  currentUserEmployeeId?: number | null;
  /** Signed-in user's display name (for matching text role fields on new leads). */
  currentUserDisplayName?: string;
}

/** Shell around `AISuggestions`. Other GPT features use the same pattern: Supabase Edge + `OPENAI_API_KEY` (`ai-notifications`, `ai-lead-summary`, `case-document-summarize`). */
const AIAssistantBox = forwardRef<HTMLDivElement, AIAssistantBoxProps>(
  function AIAssistantBox({ height, onClose, currentUserEmployeeId, currentUserDisplayName }, ref) {
    return (
      <div
        ref={ref}
        className="bg-white border border-gray-200 rounded-2xl p-4 shadow-lg flex flex-col transition-all duration-500 ease-in-out w-full md:w-1/5 opacity-100 md:overflow-hidden"
        style={height != null ? { height: `${height}px`, minHeight: `${height}px`, maxHeight: `${height}px` } : undefined}
      >
        <div className="flex justify-between items-center mb-4 flex-shrink-0">
          <h3 className="text-lg font-semibold text-gray-900">AI Assistant</h3>
          <button
            onClick={onClose}
            className="btn btn-ghost btn-sm text-gray-500 hover:text-gray-700 transition-colors"
            title="Close AI Assistant"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>
        <div className="md:flex-1 md:overflow-y-auto md:min-h-0 scrollbar-hide" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
          <style>{`
            .scrollbar-hide::-webkit-scrollbar {
              display: none;
            }
          `}</style>
          <AISuggestions
            currentUserEmployeeId={currentUserEmployeeId}
            currentUserDisplayName={currentUserDisplayName}
          />
        </div>
      </div>
    );
  }
);

export default AIAssistantBox;
