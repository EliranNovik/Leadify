import React, { useMemo } from 'react';
import PortalSubEffortsTimeline from './PortalSubEffortsTimeline';
import { getPortalTabHeaderCoverImage, PortalLoading, PortalTabFrame } from '../components/portalTheme';
import { usePortalTabData } from '../context/PortalTabDataContext';
import { findCurrentPortalSubEffort } from '../../../lib/portalSubEfforts';

const PortalStagesTab: React.FC = () => {
  const { data, initialLoading } = usePortalTabData();
  const rows = data?.subEfforts ?? [];
  const folders = data?.subEffortFolders ?? [];
  const active = useMemo(() => findCurrentPortalSubEffort(rows), [rows]);

  const emptyMessage =
    data?.subEffortsCategoryId == null && !data?.summary?.category
      ? 'Case stages will appear here once your case type is set on your file.'
      : 'No case stages are linked to your case type yet.';

  const subtitle = active?.sub_effort_name?.trim()
    ? `Current stage: ${active.sub_effort_name.trim()}. Follow your workflow and view documents for each stage.`
    : rows.length > 0 && rows.every((row) => row.active === false)
      ? 'All stages are complete. Review your workflow and documents below.'
      : 'Follow your case progress and view documents for each stage.';

  if (initialLoading && !data) return <PortalLoading />;

  return (
    <PortalTabFrame
      title="Case Status"
      subtitle={subtitle}
      headerCoverImage={getPortalTabHeaderCoverImage('stages')}
    >
      <PortalSubEffortsTimeline rows={rows} folders={folders} emptyMessage={emptyMessage} />
    </PortalTabFrame>
  );
};

export default PortalStagesTab;
