import React from 'react';
import {
  BanknotesIcon,
  Cog6ToothIcon,
  EnvelopeIcon,
  PhoneIcon,
  SparklesIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { FaWhatsapp } from 'react-icons/fa';
import type { PipelineActionLead, PipelineRailAction } from './pipelineActions';

type Props = {
  armedAction: PipelineRailAction | null;
  selectedLead: PipelineActionLead | null;
  settingsOpen: boolean;
  onToggleSettings: () => void;
  onAction: (action: PipelineRailAction) => void;
  children?: React.ReactNode;
};

const ACTIONS: Array<{
  id: PipelineRailAction;
  label: string;
  icon: React.ReactNode;
}> = [
  {
    id: 'ai',
    label: 'AI summary',
    icon: <SparklesIcon className="h-6 w-6" />,
  },
  {
    id: 'email',
    label: 'Email',
    icon: <EnvelopeIcon className="h-6 w-6" />,
  },
  {
    id: 'call',
    label: 'Call',
    icon: <PhoneIcon className="h-6 w-6" />,
  },
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    icon: <FaWhatsapp className="h-6 w-6" />,
  },
  {
    id: 'finance',
    label: 'Finance',
    icon: <BanknotesIcon className="h-6 w-6" />,
  },
];

const PipelineActionSidebar: React.FC<Props> = ({
  armedAction,
  settingsOpen,
  onToggleSettings,
  onAction,
  children,
}) => {
  return (
    <>
      <div className="w-16 shrink-0" aria-hidden />
      <aside className="fixed inset-y-0 left-0 z-[51] flex h-[100dvh] w-16 flex-col border-r border-gray-200 bg-[#f9fafb]">
      <div className="flex flex-1 flex-col items-center gap-2 px-2 pt-[calc(env(safe-area-inset-top,0px)+5rem)] md:pt-20">
        {ACTIONS.map((action, index) => {
          const armed = armedAction === action.id;
          return (
            <React.Fragment key={action.id}>
              {index === 1 ? <div className="h-px w-8 bg-gray-200" /> : null}
              <button
                type="button"
                onClick={() => onAction(action.id)}
                title={action.label}
                aria-label={action.label}
                aria-pressed={armed}
                className={`flex h-11 w-11 items-center justify-center rounded-xl transition ${
                  armed
                    ? 'bg-white text-gray-900 ring-2 ring-primary'
                    : 'text-gray-700 hover:bg-white hover:text-gray-900'
                } ${action.id === 'ai' ? 'text-violet-700' : ''} ${
                  action.id === 'whatsapp' && !armed ? 'text-green-700' : ''
                }`}
              >
                {action.icon}
              </button>
            </React.Fragment>
          );
        })}
      </div>

      <div className="flex flex-col items-center px-2 pb-6">
        <button
          type="button"
          onClick={onToggleSettings}
          title="Settings"
          aria-label="Settings"
          aria-pressed={settingsOpen}
          className={`flex h-11 w-11 items-center justify-center rounded-xl transition ${
            settingsOpen
              ? 'bg-white text-gray-900 ring-2 ring-primary'
              : 'text-gray-700 hover:bg-white hover:text-gray-900'
          }`}
        >
          <Cog6ToothIcon className="h-6 w-6" />
        </button>
      </div>

      {settingsOpen ? (
        <div className="absolute left-full top-0 z-30 h-full w-80 max-w-[calc(100vw-4rem)] border-r border-gray-200 bg-white shadow-xl">
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-gray-900">Pipeline settings</h2>
              <button
                type="button"
                className="rounded-lg p-1 text-gray-500 hover:bg-gray-100"
                onClick={onToggleSettings}
                aria-label="Close settings"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-4 text-sm text-gray-700">
              {children}
            </div>
          </div>
        </div>
      ) : null}
    </aside>
    </>
  );
};

export default PipelineActionSidebar;
