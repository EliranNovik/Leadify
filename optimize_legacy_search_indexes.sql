-- Optimize Legacy Lead Search Performance (Including Hebrew Support)
-- This script adds indexes to speed up search queries on the leads_lead table

-- 0. Create Hebrew text search configuration if it doesn't exist
-- Note: This requires superuser privileges. If you don't have them, skip this section.
-- CREATE TEXT SEARCH CONFIGURATION hebrew (COPY = simple);
-- ALTER TEXT SEARCH CONFIGURATION hebrew ALTER MAPPING FOR asciiword, asciihword, hword_asciipart, word, hword, hword_part WITH hebrew_stem;

-- 1. Add indexes for text search fields with Hebrew support
-- Use 'simple' text search configuration for Hebrew compatibility
CREATE INDEX IF NOT EXISTS idx_leads_lead_name_gin ON public.leads_lead USING gin(to_tsvector('simple', name));
CREATE INDEX IF NOT EXISTS idx_leads_lead_topic_gin ON public.leads_lead USING gin(to_tsvector('simple', topic));

-- 2. Add indexes for exact matches (faster than GIN for exact searches)
-- Hebrew text should be stored as-is for exact matching
CREATE INDEX IF NOT EXISTS idx_leads_lead_name_lower ON public.leads_lead (lower(name));
CREATE INDEX IF NOT EXISTS idx_leads_lead_topic_lower ON public.leads_lead (lower(topic));
CREATE INDEX IF NOT EXISTS idx_leads_lead_email_lower ON public.leads_lead (lower(email));

-- 3. Add Hebrew-specific text search indexes
-- Use 'simple' configuration for Hebrew text (more compatible)
CREATE INDEX IF NOT EXISTS idx_leads_lead_name_hebrew ON public.leads_lead USING gin(to_tsvector('simple', name));
CREATE INDEX IF NOT EXISTS idx_leads_lead_topic_hebrew ON public.leads_lead USING gin(to_tsvector('simple', topic));

-- 4. Add indexes for phone number searches
CREATE INDEX IF NOT EXISTS idx_leads_lead_phone ON public.leads_lead (phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_lead_mobile ON public.leads_lead (mobile) WHERE mobile IS NOT NULL;

-- 4. Add composite indexes for common search patterns
CREATE INDEX IF NOT EXISTS idx_leads_lead_name_topic ON public.leads_lead (name, topic);
CREATE INDEX IF NOT EXISTS idx_leads_lead_cdate_desc ON public.leads_lead (cdate DESC);

-- 5. Add partial indexes for active leads (if you have a status field)
-- CREATE INDEX IF NOT EXISTS idx_leads_lead_active ON public.leads_lead (id) WHERE status != 'inactive';

-- 6. Add indexes for foreign key lookups
CREATE INDEX IF NOT EXISTS idx_leads_lead_stage ON public.leads_lead (stage);
CREATE INDEX IF NOT EXISTS idx_leads_lead_category_id ON public.leads_lead (category_id);

-- 7. Optimize the leads_contact table for contact searches
CREATE INDEX IF NOT EXISTS idx_leads_contact_name_lower ON public.leads_contact (lower(name));
CREATE INDEX IF NOT EXISTS idx_leads_contact_email_lower ON public.leads_contact (lower(email));
CREATE INDEX IF NOT EXISTS idx_leads_contact_phone ON public.leads_contact (phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_contact_mobile ON public.leads_contact (mobile) WHERE mobile IS NOT NULL;

-- 8. Optimize the lead_leadcontact junction table
CREATE INDEX IF NOT EXISTS idx_lead_leadcontact_lead_id ON public.lead_leadcontact (lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_leadcontact_contact_id ON public.lead_leadcontact (contact_id);

-- 9. Grant permissions
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;

-- 10. Update table statistics for better query planning
ANALYZE public.leads_lead;
ANALYZE public.leads_contact;
ANALYZE public.lead_leadcontact;

-- 11. Create a materialized view for frequently searched data (optional)
-- This can be refreshed periodically for even faster searches
CREATE MATERIALIZED VIEW IF NOT EXISTS leads_search_cache AS
SELECT 
    id,
    name,
    email,
    phone,
    mobile,
    topic,
    stage,
    cdate,
    lead_number,
    lower(name) as name_lower,
    lower(topic) as topic_lower,
    lower(email) as email_lower,
    -- Add Hebrew text search vectors (using simple configuration)
    to_tsvector('simple', name) as name_tsvector,
    to_tsvector('simple', topic) as topic_tsvector,
    to_tsvector('simple', name) as name_hebrew_tsvector,
    to_tsvector('simple', topic) as topic_hebrew_tsvector
FROM public.leads_lead
WHERE name IS NOT NULL OR topic IS NOT NULL OR email IS NOT NULL;

-- Create index on the materialized view
CREATE INDEX IF NOT EXISTS idx_leads_search_cache_name ON public.leads_search_cache (name_lower);
CREATE INDEX IF NOT EXISTS idx_leads_search_cache_topic ON public.leads_search_cache (topic_lower);
CREATE INDEX IF NOT EXISTS idx_leads_search_cache_email ON public.leads_search_cache (email_lower);
-- Add Hebrew text search indexes
CREATE INDEX IF NOT EXISTS idx_leads_search_cache_name_ts ON public.leads_search_cache USING gin(name_tsvector);
CREATE INDEX IF NOT EXISTS idx_leads_search_cache_topic_ts ON public.leads_search_cache USING gin(topic_tsvector);
CREATE INDEX IF NOT EXISTS idx_leads_search_cache_name_hebrew ON public.leads_search_cache USING gin(name_hebrew_tsvector);
CREATE INDEX IF NOT EXISTS idx_leads_search_cache_topic_hebrew ON public.leads_search_cache USING gin(topic_hebrew_tsvector);

-- Function to refresh the materialized view
CREATE OR REPLACE FUNCTION refresh_leads_search_cache()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.leads_search_cache;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions for the materialized view
GRANT SELECT ON public.leads_search_cache TO authenticated;
GRANT EXECUTE ON FUNCTION refresh_leads_search_cache() TO authenticated;

-- 12. Create optimized search functions with Hebrew support
CREATE OR REPLACE FUNCTION search_leads_optimized(
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
        -- Exact matches (highest priority)
        ll.name ILIKE search_term OR
        ll.topic ILIKE search_term OR
        ll.email ILIKE search_term OR
        -- Partial matches
        ll.name ILIKE '%' || search_term || '%' OR
        ll.topic ILIKE '%' || search_term || '%' OR
        ll.email ILIKE '%' || search_term || '%' OR
        -- Hebrew text search (using simple configuration)
        to_tsvector('simple', ll.name) @@ plainto_tsquery('simple', search_term) OR
        to_tsvector('simple', ll.topic) @@ plainto_tsquery('simple', search_term)
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
GRANT EXECUTE ON FUNCTION search_leads_optimized(TEXT, INTEGER) TO authenticated;

-- 13. Create phone search function
CREATE OR REPLACE FUNCTION search_leads_by_phone(
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
GRANT EXECUTE ON FUNCTION search_leads_by_phone(TEXT, INTEGER) TO authenticated;
