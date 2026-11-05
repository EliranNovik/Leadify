import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import PortalSubEffortsTimeline from './PortalSubEffortsTimeline';
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
  const subtitle = activeStageName
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
      <PortalSubEffortsTimeline rows={rows} folders={folders} emptyMessage={emptyMessage} />
    </PortalTabFrame>
  );
};

export default PortalStagesTab;
