import React from 'react';
import { PaperAirplaneIcon } from '@heroicons/react/24/outline';

type Props = {
  selectedCount: number;
  starting?: boolean;
  onSend: () => void;
  onCancel: () => void;
};

const PipelineFollowupBar: React.FC<Props> = ({
  selectedCount,
  starting = false,
  onSend,
  onCancel,
}) => {
  return (
    <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm md:flex-row md:items-center md:justify-between">
      <div>
        <p className="text-sm font-semibold text-gray-900">Follow up</p>
        <p className="text-xs text-gray-500">
          {selectedCount === 0
            ? 'Click rows to choose one or more leads'
            : `${selectedCount} lead${selectedCount === 1 ? '' : 's'} selected`}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn btn-primary btn-sm gap-2"
          disabled={selectedCount === 0 || starting}
          onClick={onSend}
        >
          {starting ? (
            <span className="loading loading-spinner loading-xs" />
          ) : (
            <PaperAirplaneIcon className="h-4 w-4" />
          )}
          Send follow up
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} disabled={starting}>
          Cancel
        </button>
      </div>
    </div>
  );
};

export default PipelineFollowupBar;
