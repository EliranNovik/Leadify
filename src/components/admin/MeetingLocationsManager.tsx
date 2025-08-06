import React from 'react';
import GenericCRUDManager from './GenericCRUDManager';

const MeetingLocationsManager: React.FC = () => {
  const fields = [
    {
      name: 'name',
      label: 'Location Name',
      type: 'text' as const,
      required: true,
      placeholder: 'e.g., Room Meeting 101'
    },
    {
      name: 'is_physical_location',
      label: 'Physical Location',
      type: 'boolean' as const,
      required: false
    },
    {
      name: 'is_tlv_with_parking',
      label: 'TLV with Parking',
      type: 'boolean' as const,
      required: false
    },
    {
      name: 'physical_address_details',
      label: 'Physical Address Details',
      type: 'textarea' as const,
      required: false,
      placeholder: 'e.g., 5 יד חרוצים 10 קומה Yad Harutsim St. 10, 5th floor'
    },
    {
      name: 'parking_gap_minutes',
      label: 'Parking Gap (minutes)',
      type: 'number' as const,
      required: false,
      placeholder: 'e.g., 60'
    },
    {
      name: 'google_maps_link',
      label: 'Google Maps Link',
      type: 'text' as const,
      required: false,
      placeholder: 'e.g., https://goo.gl/maps/r9gH3Y24MjWJJmc46'
    },
    {
      name: 'waze_link',
      label: 'Waze Link',
      type: 'text' as const,
      required: false,
      placeholder: 'e.g., https://waze.com/...'
    },
    {
      name: 'allow_whatsapp_video',
      label: 'Allow WhatsApp Video',
      type: 'boolean' as const,
      required: false
    },
    {
      name: 'whatsapp_video_notes',
      label: 'WhatsApp Video Notes',
      type: 'text' as const,
      required: false,
      placeholder: 'e.g., Multiple at the same time'
    },
    {
      name: 'allow_zoom_assign_later',
      label: 'Allow Zoom Assign Later',
      type: 'boolean' as const,
      required: false
    },
    {
      name: 'zoom_assign_later_notes',
      label: 'Zoom Assign Later Notes',
      type: 'text' as const,
      required: false,
      placeholder: 'e.g., Notes for zoom assign later'
    },
    {
      name: 'allow_zoom_individual',
      label: 'Allow Zoom Individual',
      type: 'boolean' as const,
      required: false
    },
    {
      name: 'zoom_individual_notes',
      label: 'Zoom Individual Notes',
      type: 'text' as const,
      required: false,
      placeholder: 'e.g., Notes for individual zoom'
    },
    {
      name: 'default_link',
      label: 'Default Link',
      type: 'text' as const,
      required: false,
      placeholder: 'e.g., https://meet.jit.si/DeckerPexLevi'
    },
    {
      name: 'occupancy_gap',
      label: 'Occupancy Gap',
      type: 'text' as const,
      required: false,
      placeholder: 'e.g., Multiple at the same time'
    },
    {
      name: 'address_notes',
      label: 'Address Notes',
      type: 'textarea' as const,
      required: false,
      placeholder: 'e.g., Meeting instructions and notes',
      hideInTable: true
    },
    {
      name: 'order_value',
      label: 'Order Value',
      type: 'number' as const,
      required: false,
      placeholder: 'e.g., 1'
    },
    {
      name: 'is_active',
      label: 'Active',
      type: 'boolean' as const,
      required: false
    }
  ];

  return (
    <GenericCRUDManager
      tableName="meeting_locations"
      fields={fields}
      title="Meeting Location"
      description="Manage meeting locations and their configurations"
      pageSize={10}
    />
  );
};

export default MeetingLocationsManager; 