import React from 'react';
import { UserIcon, ClipboardDocumentListIcon, AcademicCapIcon, ChatBubbleLeftRightIcon, InformationCircleIcon, DocumentTextIcon } from '@heroicons/react/24/outline';
import MobileBottomSheet from './MobileBottomSheet';

interface LeadSummaryDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  client: any;
}

const LeadSummaryDrawer: React.FC<LeadSummaryDrawerProps> = ({ isOpen, onClose, client }) => {
  if (!client) return null;
  return (
    <MobileBottomSheet
      open={isOpen}
      onClose={onClose}
      title="Lead Summary"
      desktopLayout="drawer-right"
      mobileFullHeight
      zIndex={50}
      sheetClassName="md:max-w-xl"
      contentClassName="flex flex-col min-h-0"
    >
        <div className="flex-1 overflow-y-auto space-y-8 pr-2 min-h-0">
          <section>
            <div className="flex items-center gap-2 mb-2">
              <InformationCircleIcon className="w-5 h-5 text-primary" />
              <h4 className="text-lg font-semibold">Lead Summary</h4>
            </div>
            <div className="grid grid-cols-2 gap-4 text-base-content/90">
              <div><span className="font-medium">Category:</span> {client.category || 'N/A'}</div>
              <div><span className="font-medium">Expert:</span> {client.expert || 'N/A'}</div>
              <div><span className="font-medium">Manager:</span> {client.manager || 'N/A'}</div>
              <div><span className="font-medium">Closer:</span> {client.closer || 'N/A'}</div>
              <div><span className="font-medium">Agreement:</span> {client.agreement || 'N/A'}</div>
              <div className="col-span-2"><span className="font-medium">Special Notes:</span> {client.special_notes || 'N/A'}</div>
            </div>
          </section>
          <section>
            <div className="flex items-center gap-2 mb-2">
              <UserIcon className="w-5 h-5 text-primary" />
              <h4 className="text-lg font-semibold">Client Details</h4>
            </div>
            <div className="grid grid-cols-2 gap-4 text-base-content/90">
              <div><span className="font-medium">Name:</span> {client.name || 'N/A'}</div>
              <div><span className="font-medium">Email:</span> {client.email || 'N/A'}</div>
              <div><span className="font-medium">Phone:</span> {client.phone || 'N/A'}</div>
            </div>
          </section>
          <section>
            <div className="flex items-center gap-2 mb-2">
              <AcademicCapIcon className="w-5 h-5 text-primary" />
              <h4 className="text-lg font-semibold">Expert</h4>
            </div>
            <div className="grid grid-cols-2 gap-4 text-base-content/90">
              <div className="col-span-2"><span className="font-medium">Status Eligibility:</span> {client.eligibility_status || 'N/A'}</div>
              <div className="col-span-2"><span className="font-medium">Expert Notes:</span> {client.expert_notes && client.expert_notes.length > 0 ? client.expert_notes.map((n: any, i: number) => (<div key={i} className="mb-1">- {n.content}</div>)) : 'N/A'}</div>
              <div className="col-span-2"><span className="font-medium">Handler Notes:</span> {client.handler_notes && client.handler_notes.length > 0 ? client.handler_notes.map((n: any, i: number) => (<div key={i} className="mb-1">- {n.content}</div>)) : 'N/A'}</div>
            </div>
          </section>
          <section>
            <div className="flex items-center gap-2 mb-2">
              <ChatBubbleLeftRightIcon className="w-5 h-5 text-primary" />
              <h4 className="text-lg font-semibold">Facts of Case</h4>
            </div>
            <div className="bg-base-200 rounded-lg p-4 text-base-content/90 min-h-[48px]">
              {client.facts_of_case || 'N/A'}
            </div>
          </section>
          <section>
            <div className="flex items-center gap-2 mb-2">
              <DocumentTextIcon className="w-5 h-5 text-primary" />
              <h4 className="text-lg font-semibold">Meeting Brief</h4>
            </div>
            <div className="bg-base-200 rounded-lg p-4 text-base-content/90 min-h-[48px]">
              {client.meeting_brief || 'N/A'}
            </div>
          </section>
        </div>
    </MobileBottomSheet>
  );
};

export default LeadSummaryDrawer;
