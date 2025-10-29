-- Simplified Legacy Lead Search Optimization (Hebrew Compatible)
-- This script adds essential indexes for fast search queries

-- 1. Basic text search indexes (works with Hebrew and English)
CREATE INDEX IF NOT EXISTS idx_leads_lead_name_gin ON public.leads_lead USING gin(to_tsvector('simple', name));
CREATE INDEX IF NOT EXISTS idx_leads_lead_topic_gin ON public.leads_lead USING gin(to_tsvector('simple', topic));

-- 2. Exact match indexes (case-insensitive)
CREATE INDEX IF NOT EXISTS idx_leads_lead_name_lower ON public.leads_lead (lower(name));
CREATE INDEX IF NOT EXISTS idx_leads_lead_topic_lower ON public.leads_lead (lower(topic));
CREATE INDEX IF NOT EXISTS idx_leads_lead_email_lower ON public.leads_lead (lower(email));

-- 3. Phone number indexes
CREATE INDEX IF NOT EXISTS idx_leads_lead_phone ON public.leads_lead (phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_lead_mobile ON public.leads_lead (mobile) WHERE mobile IS NOT NULL;

-- 4. Composite indexes for common patterns
CREATE INDEX IF NOT EXISTS idx_leads_lead_name_topic ON public.leads_lead (name, topic);
CREATE INDEX IF NOT EXISTS idx_leads_lead_cdate_desc ON public.leads_lead (cdate DESC);

-- 5. Stage foreign key index for joins
CREATE INDEX IF NOT EXISTS idx_leads_lead_stage ON public.leads_lead (stage) WHERE stage IS NOT NULL;

-- 6. Lead stages table indexes
CREATE INDEX IF NOT EXISTS idx_lead_stages_id ON public.lead_stages (id);
CREATE INDEX IF NOT EXISTS idx_lead_stages_name ON public.lead_stages (name);

-- 7. Legacy contacts table indexes
CREATE INDEX IF NOT EXISTS idx_leads_contact_name_lower ON public.leads_contact (lower(name));
CREATE INDEX IF NOT EXISTS idx_leads_contact_email_lower ON public.leads_contact (lower(email));
CREATE INDEX IF NOT EXISTS idx_leads_contact_phone ON public.leads_contact (phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_contact_mobile ON public.leads_contact (mobile) WHERE mobile IS NOT NULL;

-- 8. Junction table indexes
CREATE INDEX IF NOT EXISTS idx_lead_leadcontact_lead_id ON public.lead_leadcontact (lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_leadcontact_contact_id ON public.lead_leadcontact (contact_id);

-- 9. Grant permissions
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;

-- 10. Update statistics for better query planning
ANALYZE public.leads_lead;
ANALYZE public.leads_contact;
ANALYZE public.lead_leadcontact;
ANALYZE public.lead_stages;

-- 11. Drop existing function first (due to return type change)
DROP FUNCTION IF EXISTS search_leads_simple(TEXT, INTEGER);

-- 12. Simple optimized search function with stage join (Hebrew compatible)
CREATE OR REPLACE FUNCTION search_leads_simple(
    search_term TEXT,
    limit_count INTEGER DEFAULT 10
)
RETURNS TABLE (
    id BIGINT,
    name TEXT,
    email TEXT,
    phone TEXT,
    mobile TEXT,
    topic TEXT,
    stage_name TEXT,
    cdate TIMESTAMP WITH TIME ZONE,
    lead_number BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ll.id,
        ll.name,
        ll.email,
        ll.phone,
        ll.mobile,
        ll.topic,
        ls.name as stage_name,
        ll.cdate,
        ll.lead_number
    FROM public.leads_lead ll
    LEFT JOIN public.lead_stages ls ON ll.stage = ls.id
    WHERE 
        -- Exact matches (highest priority)
        ll.name ILIKE search_term OR
        ll.topic ILIKE search_term OR
        ll.email ILIKE search_term OR
        -- Partial matches
        ll.name ILIKE '%' || search_term || '%' OR
        ll.topic ILIKE '%' || search_term || '%' OR
        ll.email ILIKE '%' || search_term || '%'
    ORDER BY 
        CASE 
            WHEN ll.name ILIKE search_term THEN 1
            WHEN ll.name ILIKE search_term || '%' THEN 2
            WHEN ll.topic ILIKE search_term THEN 3
            WHEN ll.email ILIKE search_term THEN 4
            WHEN ll.name ILIKE '%' || search_term || '%' THEN 5
            WHEN ll.topic ILIKE '%' || search_term || '%' THEN 6
            ELSE 7
        END,
        ll.cdate DESC
    LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions for the search function
GRANT EXECUTE ON FUNCTION search_leads_simple(TEXT, INTEGER) TO authenticated;

-- 13. Phone search function
CREATE OR REPLACE FUNCTION search_leads_by_phone_simple(
    phone_digits TEXT,
    limit_count INTEGER DEFAULT 10
)
RETURNS TABLE (
    id BIGINT,
    name TEXT,
    email TEXT,
    phone TEXT,
    mobile TEXT,
    topic TEXT,
    stage BIGINT,
    cdate TIMESTAMP WITH TIME ZONE,
    lead_number BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ll.id,
        ll.name,
        ll.email,
        ll.phone,
        ll.mobile,
        ll.topic,
        ll.stage,
        ll.cdate,
        ll.lead_number
    FROM public.leads_lead ll
    WHERE 
        ll.phone LIKE '%' || phone_digits || '%' OR
        ll.mobile LIKE '%' || phone_digits || '%'
    ORDER BY 
        CASE 
            WHEN ll.phone LIKE '%' || phone_digits THEN 1
            WHEN ll.mobile LIKE '%' || phone_digits THEN 2
            ELSE 3
        END,
        ll.cdate DESC
    LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions for the phone search function
GRANT EXECUTE ON FUNCTION search_leads_by_phone_simple(TEXT, INTEGER) TO authenticated;
