/**
 * ARCHIVE — not imported by `Dashboard.tsx`.
 *
 * Previously the dashboard showed:
 * - A left column `AIAssistantBox` (wraps `AISuggestions`: ai-notifications + public_messages)
 * - `AISuggestionsModal` when opening "Action Required"
 * - A mount-time fetch to `ai-notifications` for the Action Required count
 * - A floating button when the AI column was collapsed
 *
 * Restore: import pieces into `Dashboard.tsx`, set `DASHBOARD_AI_NOTIFICATIONS_FETCH_ENABLED`
 * to `true` in `src/lib/dashboardAiFeatureFlags.ts`, and wire state/refs as before.
 */
import React, { RefObject } from 'react';
import { ChatBubbleLeftRightIcon } from '@heroicons/react/24/outline';
import AIAssistantBox from '../AIAssistantBox';
import AISuggestionsModal from '../AISuggestionsModal';

export type ArchivedAiColumnProps = {
  aiRef: RefObject<HTMLDivElement | null>;
  aiHeight: number | undefined;
  onCloseAssistant: () => void;
  currentUserEmployeeId: number | null;
  currentUserDisplayName: string | undefined;
};

/** Left sidebar "AI Assistant" card (same props as former Dashboard usage). */
export function DashboardArchivedAiAssistantColumn(props: ArchivedAiColumnProps) {
  const { aiRef, aiHeight, onCloseAssistant, currentUserEmployeeId, currentUserDisplayName } = props;
  return (
    <AIAssistantBox
      ref={aiRef}
      height={aiHeight}
      onClose={onCloseAssistant}
      currentUserEmployeeId={currentUserEmployeeId ?? undefined}
      currentUserDisplayName={currentUserDisplayName}
    />
  );
}

export function DashboardArchivedAiFloatingOpenButton(props: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onOpen}
      className="fixed right-8 top-1/2 transform -translate-y-1/2 z-50 btn btn-circle btn-lg bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-110 border-none"
      title="Open AI Assistant"
    >
      <ChatBubbleLeftRightIcon className="w-6 h-6" />
    </button>
  );
}

export function DashboardArchivedAiSuggestionsModal(props: {
  isOpen: boolean;
  onClose: () => void;
}) {
  return <AISuggestionsModal isOpen={props.isOpen} onClose={props.onClose} />;
}

/**
 * Layout reference (former JSX structure):
 *
 * ```tsx
 * <div className="flex flex-col md:flex-row mb-6 md:mb-10 w-full relative transition-all duration-500 ease-in-out md:items-start gap-4 md:gap-0">
 *   {!aiContainerCollapsed && (
 *     <AIAssistantBox ref={aiRef} height={aiHeight} onClose={() => setAiContainerCollapsed(true)} ... />
 *   )}
 *   <div ref={performanceDashboardRef} className={`transition-all ... ${aiContainerCollapsed ? 'w-full' : 'w-full md:w-4/5'} ${aiContainerCollapsed ? 'ml-0' : 'md:ml-8'}`}>
 *     ... Performance Dashboard ...
 *   </div>
 * </div>
 * ```
 *
 * Height sync (`ResizeObserver` matching scoreboard height to `aiHeight`) lived in Dashboard `useEffect` deps `[aiContainerCollapsed]`.
 *
 * Mount fetch for Action Required count (when enabled):
 * ```ts
 * if (DASHBOARD_AI_NOTIFICATIONS_FETCH_ENABLED) {
 *   fetch(`${VITE_SUPABASE_URL}/functions/v1/ai-notifications`, { method: 'POST', body: JSON.stringify({ action: 'get_notifications' }), ... })
 *     .then(r => r.json()).then(data => setAIActions(data.count ?? 0));
 * }
 * ```
 */
