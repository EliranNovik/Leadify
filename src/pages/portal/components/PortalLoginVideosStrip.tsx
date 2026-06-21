import React from 'react';
import { CLOCK_IN_GATE_VIDEOS } from '../../../lib/clockInGateVideoCatalog';
import {
  GateVideoMobileIconLauncher,
  GateVideoModal,
  GateVideoStripRow,
  useGateVideoPlayer,
} from '../../../components/GateVideoCards';

type Props = {
  /** Desktop: horizontal strip on video panel. Mobile: icon launcher below sign-in form. */
  variant?: 'desktop' | 'mobile';
};

/** YouTube video row for the portal login page. */
const PortalLoginVideosStrip: React.FC<Props> = ({ variant = 'desktop' }) => {
  const { activeVideo, setActiveVideo, clearActiveVideo } = useGateVideoPlayer();

  if (CLOCK_IN_GATE_VIDEOS.length === 0) return null;

  const theme = variant === 'mobile' ? 'light' : 'dark';

  return (
    <>
      <div className="pointer-events-auto w-full min-w-0">
        {variant === 'mobile' ? (
          <GateVideoMobileIconLauncher theme={theme} onPlay={setActiveVideo} />
        ) : (
          <GateVideoStripRow theme={theme} onPlay={setActiveVideo} />
        )}
      </div>
      {activeVideo ? <GateVideoModal video={activeVideo} onClose={clearActiveVideo} /> : null}
    </>
  );
};

export default PortalLoginVideosStrip;
