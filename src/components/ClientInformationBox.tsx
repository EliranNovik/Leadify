import React from 'react';
import { UserIcon } from '@heroicons/react/24/outline';

interface ClientInformationBoxProps {
  selectedClient: any;
}

const ClientInformationBox: React.FC<ClientInformationBoxProps> = ({ selectedClient }) => {
  return (
    <div className="text-black">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: '#391BC8' }}>
          <UserIcon className="w-5 h-5 text-white" />
        </div>
        <div className="flex flex-col flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold text-gray-900">
              {selectedClient ? (() => {
                // Use manual_id if available, otherwise use lead_number or id
                let displayNumber = selectedClient.manual_id || selectedClient.lead_number || selectedClient.id || '---';
                
                // Debug logging
                console.log('🔍 ClientInformationBox - Lead number logic:', {
                  id: selectedClient.id,
                  idString: selectedClient.id?.toString(),
                  isLegacy: selectedClient.id?.toString().startsWith('legacy_'),
                  stage: selectedClient.stage,
                  stageType: typeof selectedClient.stage,
                  manual_id: selectedClient.manual_id,
                  lead_number: selectedClient.lead_number,
                  displayNumber: displayNumber
                });
                
                // Add "C" prefix for legacy leads with stage "100" (Success) or higher (after stage 60)
                const isLegacyLead = selectedClient.id?.toString().startsWith('legacy_');
                const isSuccessStage = selectedClient.stage === '100' || selectedClient.stage === 100;
                
                if (isLegacyLead && isSuccessStage) {
                  console.log('🔍 Adding C prefix to:', displayNumber);
                  displayNumber = `C${displayNumber}`;
                }
                
                return displayNumber;
              })() : '---'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-2xl font-bold text-gray-700 truncate max-w-[200px]">
              {selectedClient ? (selectedClient.name || '---') : '---'}
            </span>
            {selectedClient?.language && (
              <span className="px-3 py-1 text-sm font-semibold text-white bg-gradient-to-r from-pink-500 via-purple-500 to-purple-600 rounded-full">
                {selectedClient.language}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {/* Email */}
        <div className="flex justify-between items-center pb-2 border-b border-gray-200 last:border-b-0">
          <p className="text-sm font-medium uppercase tracking-wide bg-gradient-to-r from-purple-500 to-purple-600 text-transparent bg-clip-text">Email</p>
          <a href={selectedClient ? `mailto:${selectedClient.email}` : undefined} className="text-sm text-gray-900 text-right break-all">
            {selectedClient ? selectedClient.email : '---'}
          </a>
        </div>

        {/* Phone */}
        <div className="flex justify-between items-center pb-2 border-b border-gray-200 last:border-b-0">
          <p className="text-sm font-medium uppercase tracking-wide bg-gradient-to-r from-purple-500 to-purple-600 text-transparent bg-clip-text">Phone</p>
          <a href={selectedClient ? `tel:${selectedClient.phone}` : undefined} className="text-sm text-gray-900 text-right">
            {selectedClient ? selectedClient.phone : '---'}
          </a>
        </div>

        {/* Category */}
        <div className="flex justify-between items-center pb-2 border-b border-gray-200 last:border-b-0">
          <p className="text-sm font-medium uppercase tracking-wide bg-gradient-to-r from-purple-500 to-purple-600 text-transparent bg-clip-text">Category</p>
          <p className="text-sm text-gray-900 text-right">
            {selectedClient ? (selectedClient.category || 'Not specified') : 'Not specified'}
          </p>
        </div>

        {/* Topic */}
        <div className="flex justify-between items-center pb-2 border-b border-gray-200 last:border-b-0">
          <p className="text-sm font-medium uppercase tracking-wide bg-gradient-to-r from-purple-500 to-purple-600 text-transparent bg-clip-text">Topic</p>
          <p className="text-sm text-gray-900 text-right">
            {selectedClient ? (selectedClient.topic || 'German Citizenship') : 'German Citizenship'}
          </p>
        </div>
      </div>
    </div>
  );
};

export default ClientInformationBox;
