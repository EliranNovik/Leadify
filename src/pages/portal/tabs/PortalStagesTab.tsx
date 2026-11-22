import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import PortalSubEffortsTimeline from './PortalSubEffortsTimeline';
import PortalHandlingJourney from './PortalHandlingJourney';
import { buildPortalHandlingBoard } from './portalHandlingBoard';
import { getPortalTabHeaderCoverImage, PortalLoading, PortalTabFrame } from '../components/portalTheme';
import { usePortalTabData } from '../context/PortalTabDataContext';
import { findCurrentPortalSubEffort } from '../../../lib/portalSubEfforts';
import { translatePortalDynamicLabel } from '../i18n/portalDynamicLabels';

const PortalStagesTab: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { data, initialLoading } = usePortalTabData();
  const rows = data?.subEfforts ?? [];
  const folders = data?.subEffortFolders ?? [];
  const active = useMemo(() => findCurrentPortalSubEffort(rows), [rows]);
  const handling = useMemo(
    () => buildPortalHandlingBoard(data?.summary, i18n.language),
    [data?.summary, i18n.language],
  );
  const activeStageName = translatePortalDynamicLabel(
    i18n.language,
    active?.sub_effort_name,
    active?.sub_effort_name_he,
  );

  const emptyMessage =
    data?.subEffortsCategoryId == null && !data?.summary?.category
      ? t('stages.emptyNoCaseType')
      : t('stages.emptyNoStagesLinked');

  // The hero says where the case stands and nothing else; what to do here is plain from the page.
  const handlingStageName = handling
    ? t(
        handling.activeStageId === 1
          ? 'stages.handling.preparingTitle'
          : handling.activeStageId === 2
            ? 'stages.handling.waitingTitle'
            : 'stages.handling.finishingTitle',
      )
    : '';
  const subtitle = handling
    ? t('stages.handling.youAreHere', { stageName: handlingStageName })
    : activeStageName
    ? t('stages.subtitleCurrentStage', { stageName: activeStageName })
    : rows.length > 0 && rows.every((row) => row.active === false)
    ? t('stages.subtitleAllComplete')
    : undefined;

  if (initialLoading && !data) return <PortalLoading />;

  return (
    <PortalTabFrame
      title={t('stages.title')}
      subtitle={subtitle}
      headerCoverImage={getPortalTabHeaderCoverImage('stages')}
    >
      {handling ? <PortalHandlingJourney board={handling} /> : null}
      <div className={`mx-auto w-full max-w-4xl ${handling ? 'mt-8' : ''}`}>
        <PortalSubEffortsTimeline rows={rows} folders={folders} emptyMessage={emptyMessage} />
      </div>
    </PortalTabFrame>
  );
};

export default PortalStagesTab;
