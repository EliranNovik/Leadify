import React from 'react';
import { Client } from '../types/client';
import InfoTab from './client-tabs/InfoTab';
import RolesTab from './client-tabs/RolesTab';
import ContactInfoTab from './client-tabs/ContactInfoTab';
import MarketingTab from './client-tabs/MarketingTab';
import ExpertTab from './client-tabs/ExpertTab';
import MeetingTab from './client-tabs/MeetingTab';
import PriceOfferTab from './client-tabs/PriceOfferTab';
import InteractionsTab from './client-tabs/InteractionsTab';

interface TabContentProps {
  activeTab: string;
  client: Client;
}

const TabContent: React.FC<TabContentProps> = ({ activeTab, client }) => {
  return (
    <div className="flex-1 overflow-hidden">
      <div className="h-full overflow-y-auto overflow-x-hidden">
        {activeTab === 'info' && <InfoTab client={client} />}
        {activeTab === 'roles' && <RolesTab client={client} />}
        {activeTab === 'contact-info' && <ContactInfoTab client={client} />}
        {activeTab === 'marketing' && <MarketingTab client={client} />}
        {activeTab === 'expert' && <ExpertTab client={client} />}
        {activeTab === 'meeting' && <MeetingTab client={client} />}
        {activeTab === 'price-offer' && <PriceOfferTab client={client} />}
        {activeTab === 'interactions' && <InteractionsTab client={client} />}
      </div>
    </div>
  );
};

export default TabContent; 