import React, { useEffect, useState } from 'react';
import { portalGetSubEfforts } from '../../../lib/portalApi';
import PortalSubEffortsTimeline from './PortalSubEffortsTimeline';
import { getPortalTabHeaderCoverImage, PortalLoading, PortalTabFrame } from '../components/portalTheme';

const PortalStagesTab: React.FC = () => {
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const data = await portalGetSubEfforts();
        setRows(data?.rows ?? []);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <PortalLoading />;

  return (
    <PortalTabFrame
      title="Case stages"
      subtitle="Follow your case progress and view documents for each stage."
      headerCoverImage={getPortalTabHeaderCoverImage('stages')}
    >
      <PortalSubEffortsTimeline rows={rows as Parameters<typeof PortalSubEffortsTimeline>[0]['rows']} />
    </PortalTabFrame>
  );
};

export default PortalStagesTab;
