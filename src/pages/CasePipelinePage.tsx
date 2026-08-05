import React from 'react';
import CasePipelineView from '../components/CasePipelineView';

/**
 * Standalone route for the case pipeline. The same view is also mounted inside the Manager and
 * Helper tabs of the Closer/Scheduler pipeline page, which supplies its own header and tabs.
 */
const CasePipelinePage: React.FC = () => <CasePipelineView />;

export default CasePipelinePage;
