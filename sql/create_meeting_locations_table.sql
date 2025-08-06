-- Create meeting_locations table
CREATE TABLE IF NOT EXISTS meeting_locations (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    
    -- Basic Information
    name VARCHAR(255) NOT NULL, -- Location name (e.g., "Room Meeting 101", "TLV", "JRSLM")
    
    -- Location Type
    is_physical_location BOOLEAN DEFAULT false, -- Distinguish between physical and virtual locations
    is_tlv_with_parking BOOLEAN DEFAULT false, -- Special flag for TLV with parking option
    
    -- Physical Location Details
    physical_address_details TEXT, -- Full address and instructions in Hebrew/English
    parking_gap_minutes INTEGER, -- For "60 minutes gap" or similar timing
    google_maps_link TEXT, -- Google Maps URL
    waze_link TEXT, -- Waze navigation URL
    
    -- Virtual Meeting Options
    allow_whatsapp_video BOOLEAN DEFAULT false,
    whatsapp_video_notes VARCHAR(255), -- For "Multiple at the same time"
    allow_zoom_assign_later BOOLEAN DEFAULT false,
    zoom_assign_later_notes VARCHAR(255),
    allow_zoom_individual BOOLEAN DEFAULT false,
    zoom_individual_notes VARCHAR(255),
    
    -- Meeting Configuration
    default_link TEXT, -- Default meeting link (Zoom, Teams, etc.)
    occupancy_gap VARCHAR(100) DEFAULT 'Multiple at the same time', -- Occupancy type
    address_notes TEXT, -- General notes and instructions
    
    -- Organization
    firm_id UUID, -- Can be linked to firms table later if needed
    order_value INTEGER DEFAULT 0, -- Display order
    
    -- Status
    is_active BOOLEAN DEFAULT true NOT NULL,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id),
    updated_by UUID REFERENCES auth.users(id)
);

-- Add RLS policies
ALTER TABLE meeting_locations ENABLE ROW LEVEL SECURITY;

-- Policy for users to view meeting_locations
CREATE POLICY "Users can view meeting_locations" ON meeting_locations
    FOR SELECT USING (true);

-- Policy for authenticated users to insert meeting_locations
CREATE POLICY "Authenticated users can insert meeting_locations" ON meeting_locations
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Policy for authenticated users to update meeting_locations
CREATE POLICY "Authenticated users can update meeting_locations" ON meeting_locations
    FOR UPDATE USING (auth.uid() IS NOT NULL);

-- Policy for authenticated users to delete meeting_locations
CREATE POLICY "Authenticated users can delete meeting_locations" ON meeting_locations
    FOR DELETE USING (auth.uid() IS NOT NULL);

-- Create indexes for better performance
CREATE INDEX idx_meeting_locations_name ON meeting_locations(name);
CREATE INDEX idx_meeting_locations_firm_id ON meeting_locations(firm_id);
CREATE INDEX idx_meeting_locations_is_active ON meeting_locations(is_active);
CREATE INDEX idx_meeting_locations_order_value ON meeting_locations(order_value);
CREATE INDEX idx_meeting_locations_is_physical_location ON meeting_locations(is_physical_location);

-- Insert meeting locations data from screenshots
INSERT INTO meeting_locations (name, is_physical_location, is_tlv_with_parking, physical_address_details, parking_gap_minutes, google_maps_link, waze_link, default_link, occupancy_gap, address_notes, order_value, is_active) VALUES
    -- Room Meeting 101 (Virtual)
    ('Room Meeting 101', false, false, NULL, NULL, NULL, NULL, 'https://meet.jit.si/DeckerPexLevi', 'Multiple at the same time', 
     'במידה ומתעוררות בעיות התחברות - אנא צרו עמנו קשר בהקדם על מנת שנמצא פתרון. מאחר ומטרת פגישת הזום היא לדמות ככל האפשר פגישה מכובדת פנים מול פנים במשרד (בהתאם לכללי האתיקה של לשכת עורכי הדין), נבקש למצוא מקום שקט ללא הסחות דעת, ולודא שהמסך, והרמקולים, עובדים (מהניסיון שלנו פגישות בפורמט זה הן יותר אפקטיביות).

If there are any connection issues, please contact us as soon as possible so we could find a solution. Since the purpose of the Zoom meeting is to simulate, as much as possible, a respectful face-to-face meeting in the office, we kindly request to find a quiet location without distractions, and to ensure that the screen and speakers are functioning properly (based on our experience, meetings in this format are more effective).', 1, TRUE),
    
    -- Room Meeting 102 (Virtual)
    ('Room Meeting 102', false, false, NULL, NULL, NULL, NULL, 'https://meet.jit.si/RoomMeeting2', 'Multiple at the same time',
     'במידה ומתעוררות בעיות התחברות - אנא צרו עמנו קשר בהקדם על מנת שנמצא פתרון. מאחר ומטרת פגישת הזום היא לדמות ככל האפשר פגישה מכובדת פנים מול פנים במשרד (בהתאם לכללי האתיקה של לשכת עורכי הדין), נבקש למצוא מקום שקט ללא הסחות דעת, ולודא שהמסך, והרמקולים, עובדים (מהניסיון שלנו פגישות בפורמט זה הן יותר אפקטיביות).

If there are any connection issues, please contact us as soon as possible so we could find a solution. Since the purpose of the Zoom meeting is to simulate, as much as possible, a respectful face-to-face meeting in the office, we kindly request to find a quiet location without distractions, and to ensure that the screen and speakers are functioning properly (based on our experience, meetings in this format are more effective).', 2, TRUE),
    
    -- Virtual Meeting Options
    ('Client''s home', false, false, NULL, NULL, NULL, NULL, NULL, 'Multiple at the same time', '-', 3, TRUE),
    ('Client''s Zoom link', false, false, NULL, NULL, NULL, NULL, NULL, 'Multiple at the same time', '-', 4, TRUE),
    ('e-mail meeting', false, false, NULL, NULL, NULL, NULL, NULL, 'Multiple at the same time', '-', 5, TRUE),
    ('Facetime', false, false, NULL, NULL, NULL, NULL, NULL, 'Multiple at the same time', '-', 6, TRUE),
    ('Phone call', false, false, NULL, NULL, NULL, NULL, NULL, 'Multiple at the same time', '-', 7, TRUE),
    ('Teams', false, false, NULL, NULL, NULL, NULL, NULL, 'Multiple at the same time', '-', 8, TRUE),
    
    -- Physical Locations
    ('Frontal meeting OOO', true, false, '[whenever we set a frontal meeting outside the office - it''s the scheduler''s/ manager''s responsibility to notify the client accordingly]', NULL, NULL, NULL, NULL, 'Multiple at the same time', NULL, 9, TRUE),
    
    ('JRSLM', true, false, '5 יד חרוצים 10 קומה Yad Harutsim St. 10, 5th floor', NULL, 'https://goo.gl/maps/r9gH3Y24MjWJJmc46', NULL, NULL, 'Multiple at the same time', NULL, 10, TRUE),
    
    ('Nirit Flaishman offi', true, false, 'דב הוז 30, קרית אונו, ישראל', NULL, 'https://goo.gl/maps/E5g15Yu66fehHs2a9', NULL, NULL, 'Multiple at the same time', NULL, 11, TRUE),
    
    ('TLV', true, false, 'דרך מנחם בגין 150, תל אביב-יפו, קומה 8 Derech Menachem Begin 150, Tel Aviv-Yafo, 8th floor', NULL, 'https://goo.gl/maps/ysCnmxS7tAhECoR79', NULL, NULL, 'Multiple at the same time', NULL, 12, TRUE),
    
    -- TLV with Parking (Special configuration)
    ('TLV with parking', true, true, 'Menachem Begin Road 150, WE Tower, 8th Floor, Tel Aviv.

Access to the 8th floor is via the elevators on the B side in the lobby.

Parking Location: WE Tower Parking Lot, Level -3, Parking Spot 3058. The entrance to the parking lot is on the right, immediately after the building at 150 Menachem Begin Road.', 60, 'https://maps.app.goo.gl/VH27A35v1kcMt3ty5', 'https://waze.com/ul/hsv8wrzc5j', NULL, 'Multiple at the same time', NULL, 13, TRUE);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_meeting_locations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_meeting_locations_updated_at
    BEFORE UPDATE ON meeting_locations
    FOR EACH ROW
    EXECUTE FUNCTION update_meeting_locations_updated_at(); 