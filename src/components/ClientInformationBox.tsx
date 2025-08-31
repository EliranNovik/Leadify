import React from 'react';
import { UserIcon } from '@heroicons/react/24/outline';

interface ClientInformationBoxProps {
  selectedClient: any;
}

const ClientInformationBox: React.FC<ClientInformationBoxProps> = ({ selectedClient }) => {
  return (
    <div className="rounded-2xl cursor-pointer transition-all duration-200 hover:shadow-xl shadow-lg bg-white border border-gray-200 text-black relative overflow-hidden p-4 h-full">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 flex items-center justify-center">
          <UserIcon className="w-5 h-5 text-white" />
        </div>
        <span className="text-base font-semibold text-gray-900">Client Information</span>
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
