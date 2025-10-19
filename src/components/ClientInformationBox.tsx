import React, { useState, useEffect } from 'react';
import { UserIcon } from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';

interface ClientInformationBoxProps {
  selectedClient: any;
}

const ClientInformationBox: React.FC<ClientInformationBoxProps> = ({ selectedClient }) => {
  const [legacyContactInfo, setLegacyContactInfo] = useState<{email: string | null, phone: string | null}>({
    email: null,
    phone: null
  });

  // Fetch contact info for legacy leads
  useEffect(() => {
    const fetchLegacyContactInfo = async () => {
      if (!selectedClient) return;
      
      const isLegacyLead = selectedClient?.lead_type === 'legacy' || selectedClient?.id?.toString().startsWith('legacy_');
      
      if (isLegacyLead) {
        const legacyId = selectedClient.id.toString().replace('legacy_', '');
        
        try {
          // For legacy leads, we need to get the main contact from leads_contact table
          // via the lead_leadcontact relationship
          // First try to get the main contact
          const { data: leadContacts, error: leadContactsError } = await supabase
            .from('lead_leadcontact')
            .select(`
              main,
              contact_id
            `)
            .eq('lead_id', legacyId)
            .eq('main', 'true'); // Get the main contact
          
          if (leadContactsError) {
            console.error('Error fetching legacy lead contacts:', leadContactsError);
            return;
          }
          
          console.log('🔍 ClientInformationBox - Lead contacts query result:', { leadContacts, leadContactsError });
          
          if (leadContacts && leadContacts.length > 0) {
            const mainContactId = leadContacts[0].contact_id;
            console.log('🔍 ClientInformationBox - Main contact ID found:', mainContactId);
            
            // Fetch the contact details
            const { data: contactData, error: contactError } = await supabase
              .from('leads_contact')
              .select('email, phone')
              .eq('id', mainContactId)
              .single();
            
            if (!contactError && contactData) {
              console.log('🔍 ClientInformationBox - Setting legacy contact info:', contactData);
              setLegacyContactInfo({
                email: contactData.email,
                phone: contactData.phone
              });
            } else {
              console.log('🔍 ClientInformationBox - No contact data found:', { contactError, contactData });
            }
          } else {
            console.log('🔍 ClientInformationBox - No main contact found, trying to get any contact');
            
            // Try to get any contact for this lead
            const { data: anyLeadContacts, error: anyLeadContactsError } = await supabase
              .from('lead_leadcontact')
              .select(`
                main,
                contact_id
              `)
              .eq('lead_id', legacyId)
              .limit(1);
            
            if (!anyLeadContactsError && anyLeadContacts && anyLeadContacts.length > 0) {
              const contactId = anyLeadContacts[0].contact_id;
              console.log('🔍 ClientInformationBox - Found any contact ID:', contactId);
              
              const { data: contactData, error: contactError } = await supabase
                .from('leads_contact')
                .select('email, phone')
                .eq('id', contactId)
                .single();
              
              if (!contactError && contactData) {
                console.log('🔍 ClientInformationBox - Setting any contact info:', contactData);
                setLegacyContactInfo({
                  email: contactData.email,
                  phone: contactData.phone
                });
              } else {
                console.log('🔍 ClientInformationBox - No contact data found for any contact:', { contactError, contactData });
              }
            } else {
              // Final fallback to leads_lead table
              const { data: legacyData, error } = await supabase
                .from('leads_lead')
                .select('email, phone')
                .eq('id', legacyId)
                .single();
              
              if (!error && legacyData) {
                console.log('🔍 ClientInformationBox - Setting final fallback legacy contact info:', legacyData);
                setLegacyContactInfo({
                  email: legacyData.email,
                  phone: legacyData.phone
                });
              } else {
                console.log('🔍 ClientInformationBox - No final fallback data found:', { error, legacyData });
              }
            }
          }
        } catch (error) {
          console.error('Error fetching legacy contact info:', error);
        }
      }
    };

    fetchLegacyContactInfo();
  }, [selectedClient]);

  // Get the display values - use legacy contact info if available, otherwise use client data
  const displayEmail = legacyContactInfo.email || selectedClient?.email;
  const displayPhone = legacyContactInfo.phone || selectedClient?.phone;
  
  // Debug logging
  console.log('🔍 ClientInformationBox - Contact display logic:', {
    selectedClientId: selectedClient?.id,
    legacyContactInfo,
    selectedClientEmail: selectedClient?.email,
    selectedClientPhone: selectedClient?.phone,
    displayEmail,
    displayPhone
  });
  return (
    <div className="text-black">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: '#391BC8' }}>
          <UserIcon className="w-5 h-5 text-white" />
        </div>
        <div className="flex flex-col flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold text-gray-900">
              {selectedClient ? (() => {
                // Use manual_id if available, otherwise use lead_number or id
                let displayNumber = selectedClient.manual_id || selectedClient.lead_number || selectedClient.id || '---';
                
                // Debug logging
                console.log('🔍 ClientInformationBox - Lead number logic:', {
                  id: selectedClient.id,
                  idString: selectedClient.id?.toString(),
                  isLegacy: selectedClient.id?.toString().startsWith('legacy_'),
                  stage: selectedClient.stage,
                  stageType: typeof selectedClient.stage,
                  manual_id: selectedClient.manual_id,
                  lead_number: selectedClient.lead_number,
                  displayNumber: displayNumber
                });
                
                // Add "C" prefix for legacy leads with stage "100" (Success) or higher (after stage 60)
                const isLegacyLead = selectedClient.id?.toString().startsWith('legacy_');
                const isSuccessStage = selectedClient.stage === '100' || selectedClient.stage === 100;
                
                if (isLegacyLead && isSuccessStage) {
                  console.log('🔍 Adding C prefix to:', displayNumber);
                  displayNumber = `C${displayNumber}`;
                }
                
                return displayNumber;
              })() : '---'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-2xl font-bold text-gray-700 truncate max-w-[200px]">
              {selectedClient ? (selectedClient.name || '---') : '---'}
            </span>
            {selectedClient?.language && (
              <span className="px-3 py-1 text-sm font-semibold text-white bg-gradient-to-r from-pink-500 via-purple-500 to-purple-600 rounded-full">
                {selectedClient.language}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {/* Email */}
        <div className="flex justify-between items-center pb-2 border-b border-gray-200 last:border-b-0">
          <p className="text-sm font-medium uppercase tracking-wide bg-gradient-to-r from-purple-500 to-purple-600 text-transparent bg-clip-text">Email</p>
          <a href={displayEmail ? `mailto:${displayEmail}` : undefined} className="text-sm text-gray-900 text-right break-all">
            {displayEmail || '---'}
          </a>
        </div>

        {/* Phone */}
        <div className="flex justify-between items-center pb-2 border-b border-gray-200 last:border-b-0">
          <p className="text-sm font-medium uppercase tracking-wide bg-gradient-to-r from-purple-500 to-purple-600 text-transparent bg-clip-text">Phone</p>
          <a href={displayPhone ? `tel:${displayPhone}` : undefined} className="text-sm text-gray-900 text-right">
            {displayPhone || '---'}
          </a>
        </div>

        {/* Category */}
        <div className="flex justify-between items-center pb-2 border-b border-gray-200 last:border-b-0">
          <p className="text-sm font-medium uppercase tracking-wide bg-gradient-to-r from-purple-500 to-purple-600 text-transparent bg-clip-text">Category</p>
          <p className="text-sm text-gray-900 text-right">
            {selectedClient ? (selectedClient.category || 'Not specified') : 'Not specified'}
          </p>
        </div>

        {/* Topic */}
        <div className="flex justify-between items-center pb-2 border-b border-gray-200 last:border-b-0">
          <p className="text-sm font-medium uppercase tracking-wide bg-gradient-to-r from-purple-500 to-purple-600 text-transparent bg-clip-text">Topic</p>
          <p className="text-sm text-gray-900 text-right">
            {selectedClient ? (selectedClient.topic || 'German Citizenship') : 'German Citizenship'}
          </p>
        </div>
      </div>
    </div>
  );
};

export default ClientInformationBox;
