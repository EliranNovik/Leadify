import React from 'react';
import ExternalUserLeadSearchPage from '../pages/ExternalUserLeadSearchPage';

/**
 * Component that wraps ExternalUserLeadSearchPage functionality for external users
 * This provides the full lead search functionality within the Dashboard with modal view
 */
const ExternalUserLeadSearch: React.FC = () => {
    return (
        <div className="w-full">
            <ExternalUserLeadSearchPage />
        </div>
    );
};

export default ExternalUserLeadSearch;
