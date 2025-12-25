-- Delete emails associated with contacts/leads that have @lawoffice.org.il email domain

DELETE FROM emails
WHERE id IN (
    -- Emails with contacts that have @lawoffice.org.il
    SELECT e.id
    FROM emails e
    INNER JOIN leads_contact c ON e.contact_id = c.id
    WHERE c.email ILIKE '%@lawoffice.org.il'
    
    UNION
    
    -- Emails with new leads that have @lawoffice.org.il
    SELECT e.id
    FROM emails e
    INNER JOIN leads l ON e.client_id = l.id
    WHERE l.email ILIKE '%@lawoffice.org.il'
    
    UNION
    
    -- Emails with legacy leads that have @lawoffice.org.il
    SELECT e.id
    FROM emails e
    INNER JOIN leads_lead ll ON e.legacy_id = ll.id
    WHERE ll.email ILIKE '%@lawoffice.org.il'
);
