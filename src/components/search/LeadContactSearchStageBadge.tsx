import React from 'react';
import { getSoftStageBadgeStyle, getStageColour, getStageName } from '../../lib/stageUtils';
import type { CombinedLead } from '../../lib/legacyLeadsApi';
import { isLeadContactSearchInactive } from '../../lib/leadContactSearchUi';

type Props = {
  lead: CombinedLead;
};

const LeadContactSearchStageBadge: React.FC<Props> = ({ lead }) => {
  const inactive = isLeadContactSearchInactive(lead);
  const stageStr = lead.stage ? String(lead.stage).trim() : '';
  const stageName = stageStr
    ? /^\d+$/.test(stageStr)
      ? getStageName(stageStr)
      : stageStr
    : 'Contact';

  if (inactive) {
    return (
      <span className="stage-badge badge badge-sm shrink-0 border-0 bg-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600">
        {stageName}
      </span>
    );
  }

  if (!stageStr) {
    return (
      <span
        className="stage-badge badge badge-sm shrink-0 border-0 px-2.5 py-1.5 text-xs font-medium"
        style={{
          backgroundColor: 'rgba(59, 130, 246, 0.14)',
          color: '#2563eb',
        }}
      >
        {stageName}
      </span>
    );
  }

  const stageColour =
    (lead.stage_colour && lead.stage_colour.trim()) ||
    (/^\d+$/.test(stageStr) ? getStageColour(stageStr) : '') ||
    '#391BC8';
  const softStyle = getSoftStageBadgeStyle(stageColour, stageStr);

  return (
    <span
      className="stage-badge badge badge-sm shrink-0 border-0 px-2.5 py-1.5 text-xs font-medium"
      style={{
        backgroundColor: softStyle.backgroundColor,
        color: softStyle.color,
      }}
      title={stageName}
    >
      {stageName}
    </span>
  );
};

export default LeadContactSearchStageBadge;
