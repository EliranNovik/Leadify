-- Simple EXPLAIN ANALYZE queries for the search function
-- Run these to see the query plan and performance

-- Test 1: Search by name
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM search_leads_unified('john', 10);

-- Test 2: Search by email
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM search_leads_unified('test@example.com', 10);

-- Test 3: Search by phone (digits only)
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM search_leads_unified('12345', 10);

-- Test 4: Search by lead number
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM search_leads_unified('123', 10);

