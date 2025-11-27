-- Basic manual test queries for the unified search function.
-- Adjust the sample inputs below to cover edge cases in your environment.

-- 1. Exact lead number (new lead)
SELECT * FROM public.search_leads_unified('L123456', 5);

-- 2. Exact legacy lead number (legacy id)
SELECT * FROM public.search_leads_unified('987654', 5);

-- 3. Name search (prefix)
SELECT * FROM public.search_leads_unified('john', 5);

-- 4. Email search
SELECT * FROM public.search_leads_unified('client@example.com', 5);

-- 5. Phone number search (full number or tail digits)
SELECT * FROM public.search_leads_unified('+972-54-123-4567', 5);

-- 6. Contact search (should surface linked lead)
SELECT * FROM public.search_leads_unified('assistant', 5);

