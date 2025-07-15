import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ClockIcon, DocumentTextIcon } from '@heroicons/react/24/outline';
import { ClientTabProps } from '../../types/client';

interface TimelineHistoryButtonsProps {
  client: ClientTabProps['client'];
}

const TimelineHistoryButtons: React.FC<TimelineHistoryButtonsProps> = ({ client }) => {
  const navigate = useNavigate();

  const handleTimelineClick = () => {
    navigate(`/clients/${client.lead_number}/timeline`);
  };

  const handleHistoryClick = () => {
    navigate(`/clients/${client.lead_number}/history`);
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="border-t border-gray-200 pt-4 mt-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        {/* Timeline and History Buttons */}
        <div className="flex gap-3">
          <button
            onClick={handleTimelineClick}
            className="btn btn-outline btn-sm flex items-center gap-2"
          >
            <ClockIcon className="w-4 h-4" />
            Timeline
          </button>
          <button
            onClick={handleHistoryClick}
            className="btn btn-outline btn-sm flex items-center gap-2"
          >
            <DocumentTextIcon className="w-4 h-4" />
            History
          </button>
        </div>

        {/* Timestamps */}
        <div className="flex flex-col sm:flex-row gap-4 text-sm text-gray-600">
          <div className="flex items-center gap-2">
            <span className="font-medium">Created:</span>
            <span>{formatDate(client.created_at)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-medium">Last updated:</span>
            <span>{formatDate(client.updated_at || client.created_at)}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TimelineHistoryButtons;