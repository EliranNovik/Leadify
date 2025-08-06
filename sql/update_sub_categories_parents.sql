-- Update sub_categories parent_id relationships
-- This script should be run after both main_categories and sub_categories tables are created

-- Austria sub-categories
UPDATE sub_categories SET parent_id = (SELECT id FROM main_categories WHERE name = 'Austria') 
WHERE name IN ('Left bef. 1933/Citiz', 'Lived bef 1933,le af', 'Extra Family Member', 'Labor Camps or DPC', 'Undefined', 'Paid meeting')
AND parent_id IS NULL;

-- Germany sub-categories
UPDATE sub_categories SET parent_id = (SELECT id FROM main_categories WHERE name = 'Germany') 
WHERE name IN ('Undefined', 'Extra Family Member', 'Left bef. 1933/Citiz', 'Lived bef 1933,le af', 'Passports for childr', 'Feasibility', 'Paid meeting')
AND parent_id IS NULL;

-- Portugal sub-categories
UPDATE sub_categories SET parent_id = (SELECT id FROM main_categories WHERE name = 'Portugal') 
WHERE name IN ('Port. for non Jewish', 'Portugal Family', 'Portugal/Spain gener', 'Portugal for descend')
AND parent_id IS NULL;

-- Immigration Israel sub-categories
UPDATE sub_categories SET parent_id = (SELECT id FROM main_categories WHERE name = 'Immigration Israel') 
WHERE name IN ('Aliyah/A1', 'Asylum Seekers', 'B1 Expert worker vis', 'B1 for caregivers', 'B1 regular work visa', 'B2 Tourist visa', 'Elderly Parent', 
               'Extra Family Member', 'IDF exemption matter', 'Joint life/Family r', 'Parent of IDF sold', 'A2 Student visa', 'A3 Clergy visa', 
               'A4 complimentary vis', 'A5 temporary resid.v', 'Permanent residency', 'West Bank Matters', 'East Jerusalem Citiz', 'Proxy marriage for s', 
               'Entry into Israel', 'Entry into the Wes', 'Humanitarian visas', 'Paternity tests', 'Visas for Palestinia', 'Appeals to MOI', 
               'Special appeals trib', 'Detail Change', 'District court petit', 'IDF ForeignVolunteer', 'Supreme court appeal', 'Paid meeting', 
               'Status in Israel', 'Family reunification', 'Feasibility')
AND parent_id IS NULL;

-- USA sub-categories
UPDATE sub_categories SET parent_id = (SELECT id FROM main_categories WHERE name = 'USA') 
WHERE name IN ('Paid meeting')
AND parent_id IS NULL;

-- Poland sub-categories
UPDATE sub_categories SET parent_id = (SELECT id FROM main_categories WHERE name = 'Poland') 
WHERE name IN ('Feasibility', 'Poland', 'Paid meeting')
AND parent_id IS NULL;

-- Commer/Civil/Adm/Fam sub-categories
UPDATE sub_categories SET parent_id = (SELECT id FROM main_categories WHERE name = 'Commer/Civil/Adm/Fam') 
WHERE name IN ('Probate order', 'Real estate and prop', 'Intern. Debt collect', 'Labor law', 'Non imm. appeals/pet', 'Arnona', 'Libel \\ Slander', 
               'Gun license', 'Political Party regi', 'Credit ranking', 'Civil litigation', 'Israeli debt collect', 'DNA for child suppor', 
               'Small claims', 'Tax Law', 'Hi-Tech', 'Undefined', 'Feasibility', 'Paid meeting', 'Corporate law')
AND parent_id IS NULL;

-- Small without meetin sub-categories
UPDATE sub_categories SET parent_id = (SELECT id FROM main_categories WHERE name = 'Small without meetin') 
WHERE name IN ('Doc. Acquisitions', 'FBI background check', 'Notarizations', 'Notarized translat', 'Proxy marriages', 'Disabled Parking', 
               'Utah Marriage', 'Enduring POAs of 5K', 'Legal Opinion', 'Regular POAs', 'Undefined', 'Feasibility')
AND parent_id IS NULL;

-- Other Citizenships sub-categories
UPDATE sub_categories SET parent_id = (SELECT id FROM main_categories WHERE name = 'Other Citizenships') 
WHERE name IN ('Door to Romania', 'Other Citizenships', 'France', 'Romania', 'Hungary', 'Greece', 'Bulgaria', 'Lithuania', 'Russian', 'Holland', 'Slovakia', 'UK')
AND parent_id IS NULL;

-- Eligibility Checker sub-categories
UPDATE sub_categories SET parent_id = (SELECT id FROM main_categories WHERE name = 'Eligibility Checker') 
WHERE name IN ('German\\Austria')
AND parent_id IS NULL;

-- German\Austrian sub-categories
UPDATE sub_categories SET parent_id = (SELECT id FROM main_categories WHERE name = 'German\Austrian') 
WHERE name IN ('German\\Austrian')
AND parent_id IS NULL;

-- other sub-categories
UPDATE sub_categories SET parent_id = (SELECT id FROM main_categories WHERE name = 'other') 
WHERE name IN ('Intellectual Propert', 'Transportation law', 'Bankruptcy', 'Class Actions', 'Dubai', 'Canada', 'Education Law', 
               'Administrative Law', 'Custody', 'Marriage', 'Negative BDI', 'Psychiatric hospital', 'Subsidiary', 'Undefined')
AND parent_id IS NULL; 