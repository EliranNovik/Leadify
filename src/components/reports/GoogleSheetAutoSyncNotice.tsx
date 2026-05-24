import React from 'react';
import { ClockIcon } from '@heroicons/react/24/outline';

type GoogleSheetAutoSyncNoticeProps = {
  reportLabel: string;
};

const GoogleSheetAutoSyncNotice: React.FC<GoogleSheetAutoSyncNoticeProps> = ({ reportLabel }) => (
  <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-base-content/80">
    <ClockIcon className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
    <div>
      <p className="font-medium text-base-content">{reportLabel} syncs automatically</p>
      <p className="mt-0.5 text-base-content/70">
        New matching leads are exported to Google Sheets every hour.
        Use <span className="font-medium">Sync now</span> below only for an immediate manual run.
      </p>
    </div>
  </div>
);

export default GoogleSheetAutoSyncNotice;
