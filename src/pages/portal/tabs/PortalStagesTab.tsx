import React from 'react';
import PortalSubEffortsTimeline from './PortalSubEffortsTimeline';
import { getPortalTabHeaderCoverImage, PortalLoading, PortalTabFrame } from '../components/portalTheme';
import { usePortalTabData } from '../context/PortalTabDataContext';

const PortalStagesTab: React.FC = () => {
  const { data, initialLoading } = usePortalTabData();
  const rows = (data?.subEfforts ?? []) as Parameters<typeof PortalSubEffortsTimeline>[0]['rows'];

  if (initialLoading && !data) return <PortalLoading />;

  return (
    <PortalTabFrame
      title="Case stages"
      subtitle="Follow your case progress and view documents for each stage."
      headerCoverImage={getPortalTabHeaderCoverImage('stages')}
    >
      <PortalSubEffortsTimeline rows={rows} />
    </PortalTabFrame>
  );
};

export default PortalStagesTab;
