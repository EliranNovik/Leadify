import React from 'react';
import Meetings from './Meetings';
import AISuggestions from './AISuggestions';
import OverdueFollowups from './OverdueFollowups';

const Dashboard: React.FC = () => {
    return (
        <div className="p-4 md:p-6 space-y-8">
            {/* AI Suggestions */}
            <div className="glass-card">
              <AISuggestions />
            </div>

            {/* Meetings Component */}
            <div className='my-8 glass-card'>
              <Meetings />
            </div>

            {/* Overdue Follow-ups */}
            <div className="glass-card">
              <OverdueFollowups />
            </div>
        </div>
    );
};

// Glassy card style
// Add this style globally or in the component
<style>{`
  .glass-card {
    background: rgba(255,255,255,0.60);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border-radius: 1rem;
    box-shadow: 0 4px 24px 0 rgba(0,0,0,0.08), 0 1.5px 8px 0 rgba(0,0,0,0.04);
    padding: 1.5rem;
  }
`}</style>

export default Dashboard; 