import React from 'react';
import { ChartBarIcon } from '@heroicons/react/24/outline';

interface ProgressFollowupBoxProps {
  selectedClient: any;
  getEmployeeDisplayName: (employeeId: string | null | undefined) => string;
}

const ProgressFollowupBox: React.FC<ProgressFollowupBoxProps> = ({ selectedClient, getEmployeeDisplayName }) => {
  return (
    <div className="rounded-2xl cursor-pointer transition-all duration-200 hover:shadow-xl shadow-lg bg-white border border-gray-200 text-black relative overflow-hidden p-4 h-full">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 flex items-center justify-center">
          <ChartBarIcon className="w-5 h-5 text-white" />
        </div>
        <span className="text-base font-semibold text-gray-900">Progress & Follow-up</span>
      </div>

      <div className="space-y-3">
        {/* Probability */}
        <div className="pb-2 border-b border-gray-200 last:border-b-0">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium uppercase tracking-wide bg-gradient-to-r from-purple-500 to-purple-600 text-transparent bg-clip-text">Probability</p>
            <span className="text-sm font-semibold text-gray-900">{selectedClient?.probability || 0}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div 
              className="bg-[#3b28c7] h-2 rounded-full transition-all duration-300" 
              style={{ width: `${selectedClient?.probability || 0}%` }}
            ></div>
          </div>
        </div>

        {/* Next Follow-up */}
        <div className="flex justify-between items-center pb-2 border-b border-gray-200 last:border-b-0">
          <p className="text-sm font-medium uppercase tracking-wide bg-gradient-to-r from-purple-500 to-purple-600 text-transparent bg-clip-text">Next Follow-up</p>
          <p className="text-sm text-gray-900 text-right">
            {selectedClient?.next_followup ? (
              new Date(selectedClient.next_followup).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
              })
            ) : (
              'Not scheduled'
            )}
          </p>
        </div>

        {/* Closer */}
        <div className="flex justify-between items-center pb-2 border-b border-gray-200 last:border-b-0">
          <p className="text-sm font-medium uppercase tracking-wide bg-gradient-to-r from-purple-500 to-purple-600 text-transparent bg-clip-text">Closer</p>
          <p className="text-sm text-gray-900 text-right">
            {getEmployeeDisplayName(selectedClient?.closer)}
          </p>
        </div>

        {/* Handler (if applicable) */}
        {selectedClient?.stage === 'handler_assigned' && (
          <div className="flex justify-between items-center pb-2 border-b border-gray-200 last:border-b-0">
            <p className="text-sm font-medium uppercase tracking-wide bg-gradient-to-r from-purple-500 to-purple-600 text-transparent bg-clip-text">Handler</p>
            <p className="text-sm text-gray-900 text-right">
              {getEmployeeDisplayName(selectedClient?.handler)}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ProgressFollowupBox;
