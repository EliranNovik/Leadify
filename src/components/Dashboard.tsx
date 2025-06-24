import React from 'react';
import Meetings from './Meetings';
import AISuggestions from './AISuggestions';
import OverdueFollowups from './OverdueFollowups';

const Dashboard: React.FC = () => {
    return (
        <div className="p-4 md:p-6 space-y-8">
            {/* AI Suggestions */}
            <AISuggestions />

            {/* Meetings Component */}
            <div className='my-8'>
              <Meetings />
            </div>

            {/* Overdue Follow-ups */}
            <OverdueFollowups />
        </div>
    );
};

export default Dashboard; 