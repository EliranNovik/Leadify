import React from 'react';
import { CLOCK_IN_GATE_VIDEOS } from '../lib/clockInGateVideoCatalog';
import {
  GateVideoMobileIconLauncher,
  GateVideoModal,
  GateVideoStripRow,
  GateVideoVerticalList,
  useGateVideoPlayer,
} from './GateVideoCards';

type ClockInGateVideosProps = {
  placement?: 'mobile' | 'desktop' | 'both';
  /** Desktop: horizontal strip (login hero) or vertical list (clock-in sidebar). */
  desktopLayout?: 'strip' | 'vertical';
  mobileTheme?: 'dark' | 'light';
};

const ClockInGateVideos: React.FC<ClockInGateVideosProps> = ({
  placement = 'both',
  desktopLayout = 'strip',
  mobileTheme = 'dark',
}) => {
  const { activeVideo, setActiveVideo, clearActiveVideo } = useGateVideoPlayer();
  const showMobile = placement === 'mobile' || placement === 'both';
  const showDesktop = placement === 'desktop' || placement === 'both';

  if (CLOCK_IN_GATE_VIDEOS.length === 0) return null;

  return (
    <>
      {showMobile && (
        <div className="pointer-events-auto w-full min-w-0" data-sheet-no-drag>
          <GateVideoMobileIconLauncher theme={mobileTheme} onPlay={setActiveVideo} />
        </div>
      )}

      {showDesktop && (
        <div className="pointer-events-auto w-full min-w-0" data-sheet-no-drag>
          {desktopLayout === 'vertical' ? (
            <GateVideoVerticalList theme="dark" onPlay={setActiveVideo} maxVisible={3} />
          ) : (
            <GateVideoStripRow theme="dark" onPlay={setActiveVideo} />
          )}
        </div>
      )}

      {activeVideo ? <GateVideoModal video={activeVideo} onClose={clearActiveVideo} /> : null}
    </>
  );
};

export default ClockInGateVideos;
