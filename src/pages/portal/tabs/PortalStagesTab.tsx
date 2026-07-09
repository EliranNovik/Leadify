import React from 'react';
import PortalSubEffortsTimeline from './PortalSubEffortsTimeline';
import { getPortalTabHeaderCoverImage, PortalLoading, PortalTabFrame } from '../components/portalTheme';
import { usePortalTabData } from '../context/PortalTabDataContext';

const PortalStagesTab: React.FC = () => {
  const { data, initialLoading } = usePortalTabData();
  const rows = data?.subEfforts ?? [];

  const emptyMessage =
    data?.subEffortsCategoryId == null && !data?.summary?.category
      ? 'Case stages will appear here once your case type is set on your file.'
      : 'No case stages are linked to your case type yet.';

  if (initialLoading && !data) return <PortalLoading />;

  return (
    <PortalTabFrame
      title="Case stages"
      subtitle="Follow your case progress and view documents for each stage."
      headerCoverImage={getPortalTabHeaderCoverImage('stages')}
    >
      <PortalSubEffortsTimeline rows={rows} emptyMessage={emptyMessage} />
    </PortalTabFrame>
  );
};

export default PortalStagesTab;
