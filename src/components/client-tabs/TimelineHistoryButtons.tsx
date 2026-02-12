import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ClockIcon, ArchiveBoxIcon } from '@heroicons/react/24/outline';
import { ClientTabProps } from '../../types/client';

interface TimelineHistoryButtonsProps {
  client: ClientTabProps['client'];
}

const TimelineHistoryButtons: React.FC<TimelineHistoryButtonsProps> = ({ client }) => {
  const navigate = useNavigate();

  // Get the lead identifier - use actual ID for legacy leads, lead_number for new leads
  const getLeadIdentifier = () => {
    if (!client) return null;
    
    const isLegacy = client.lead_type === 'legacy' || client.id?.toString().startsWith('legacy_');
    if (isLegacy) {
      // For legacy leads, use the actual numeric ID from leads_lead table
      const clientId = client.id?.toString();
      
      // Check if client has a direct numeric ID property (not legacy_ prefixed)
      const directId = (client as any).id;
      if (typeof directId === 'number') {
        return directId.toString();
      }
      
      if (clientId && clientId.startsWith('legacy_')) {
        // Extract the numeric ID from "legacy_<id>"
        const numericId = clientId.replace('legacy_', '');
        return numericId;
      }
      // If it's already numeric, use it directly
      return clientId;
    }
    // For new leads, use lead_number
    const leadNumber = client.lead_number || (client as any).manual_id;
    return leadNumber;
  };

  const leadIdentifier = getLeadIdentifier();

  const handleTimelineClick = () => {
    if (!leadIdentifier) {
      console.error('TimelineHistoryButtons: No lead identifier found for timeline navigation');
      return;
    }
    // Properly encode the lead identifier for URL (handles sub-leads with /)
    const encodedIdentifier = encodeURIComponent(String(leadIdentifier));
    navigate(`/clients/${encodedIdentifier}/timeline`);
  };

  const handleHistoryClick = () => {
    if (!leadIdentifier) {
      console.error('No lead identifier found for history navigation');
      return;
    }
    // Properly encode the lead identifier for URL (handles sub-leads with /)
    const encodedIdentifier = encodeURIComponent(String(leadIdentifier));
    navigate(`/clients/${encodedIdentifier}/history`);
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

  if (!client) {
    return null;
  }

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
            <ArchiveBoxIcon className="w-4 h-4" />
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