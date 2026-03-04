-- =============================================================================
-- Indexes for Clients.tsx, ClientHeader.tsx, InteractionsTab.tsx
-- =============================================================================
-- Add indexes for queries used in these components. Run in Supabase SQL Editor.
-- Safe to run multiple times (IF NOT EXISTS). Some indexes may already exist
-- from indexes_for_search_and_clients.sql, indexes_tenants_employee_and_users.sql,
-- or quick_interactions_optimization.sql.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. USERS (Clients, ClientHeader, InteractionsTab: auth_id, email, employee_id)
-- -----------------------------------------------------------------------------
-- .eq('auth_id', user.id), .eq('email', user.email), join on employee_id
CREATE INDEX IF NOT EXISTS idx_users_auth_id ON public.users (auth_id) WHERE auth_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_email ON public.users (email) WHERE email IS NOT NULL AND email <> '';
CREATE INDEX IF NOT EXISTS idx_users_employee_id ON public.users (employee_id) WHERE employee_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 2. MEETINGS (Clients: by lead + meeting_date, upcoming, reschedule)
-- -----------------------------------------------------------------------------
-- .eq('legacy_lead_id', x) / .eq('client_id', x), .gte('meeting_date', today), .order('meeting_date')
-- idx_meetings_client_id, idx_meetings_date, idx_meetings_legacy_lead_id may exist
CREATE INDEX IF NOT EXISTS idx_meetings_legacy_lead_id ON public.meetings (legacy_lead_id) WHERE legacy_lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_meetings_client_id ON public.meetings (client_id) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_meetings_meeting_date ON public.meetings (meeting_date);
CREATE INDEX IF NOT EXISTS idx_meetings_legacy_lead_date ON public.meetings (legacy_lead_id, meeting_date) WHERE legacy_lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_meetings_client_date ON public.meetings (client_id, meeting_date) WHERE client_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 3. EMAILS (InteractionsTab: by client_id / legacy_id, sent_at, message_id)
-- -----------------------------------------------------------------------------
-- .eq('client_id', x) / .eq('legacy_id', x), .order('sent_at'), .eq('message_id', x) for updates
CREATE INDEX IF NOT EXISTS idx_emails_client_id_sent_at ON public.emails (client_id, sent_at DESC) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_emails_legacy_id_sent_at ON public.emails (legacy_id, sent_at DESC) WHERE legacy_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_emails_message_id ON public.emails (message_id) WHERE message_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 4. WHATSAPP_MESSAGES (InteractionsTab: by lead_id / legacy_id, sent_at)
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_lead_id_sent_at ON public.whatsapp_messages (lead_id, sent_at DESC) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_legacy_id_sent_at ON public.whatsapp_messages (legacy_id, sent_at DESC) WHERE legacy_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 5. CALL_LOGS (InteractionsTab: by lead_id, cdate)
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_call_logs_lead_id_cdate ON public.call_logs (lead_id, cdate DESC) WHERE lead_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 6. LEADS_LEADINTERACTIONS (InteractionsTab: by lead_id, contact_id; order id desc)
-- -----------------------------------------------------------------------------
-- .eq('lead_id', x).eq('contact_id', y), .order('id', { ascending: false }).limit(1)
CREATE INDEX IF NOT EXISTS idx_leads_leadinteractions_lead_id ON public.leads_leadinteractions (lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_leadinteractions_lead_contact ON public.leads_leadinteractions (lead_id, contact_id) WHERE lead_id IS NOT NULL AND contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_leadinteractions_id_desc ON public.leads_leadinteractions (id DESC);

-- -----------------------------------------------------------------------------
-- 7. MISC_LEADSOURCE (Clients, ClientHeader: active, order by order/name)
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_misc_leadsource_active ON public.misc_leadsource (active) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_misc_leadsource_order ON public.misc_leadsource ("order") WHERE "order" IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_misc_leadsource_name ON public.misc_leadsource (name) WHERE name IS NOT NULL AND name <> '';

-- -----------------------------------------------------------------------------
-- 8. MISC_LANGUAGE (Clients, InteractionsTab: order by name, eq id)
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_misc_language_name ON public.misc_language (name) WHERE name IS NOT NULL AND name <> '';

-- -----------------------------------------------------------------------------
-- 9. MISC_CATEGORY (Clients, ClientHeader: order by name, parent_id for join)
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_misc_category_name ON public.misc_category (name) WHERE name IS NOT NULL AND name <> '';
CREATE INDEX IF NOT EXISTS idx_misc_category_parent_id ON public.misc_category (parent_id) WHERE parent_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 10. MISC_COUNTRY (Clients: order by name, order)
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_misc_country_name ON public.misc_country (name) WHERE name IS NOT NULL AND name <> '';
CREATE INDEX IF NOT EXISTS idx_misc_country_order ON public.misc_country ("order") WHERE "order" IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 11. ACCOUNTING_CURRENCIES (ClientHeader: order by order)
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_accounting_currencies_order ON public.accounting_currencies ("order") WHERE "order" IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 12. MISC_EMAILTEMPLATE (InteractionsTab: active, order by name)
-- -----------------------------------------------------------------------------
-- active is text in this table; index for .eq('active', 't') lookups
CREATE INDEX IF NOT EXISTS idx_misc_emailtemplate_active ON public.misc_emailtemplate (active) WHERE (active = 't' OR active = 'true');
CREATE INDEX IF NOT EXISTS idx_misc_emailtemplate_name ON public.misc_emailtemplate (name) WHERE name IS NOT NULL AND name <> '';

-- -----------------------------------------------------------------------------
-- 13. EMAIL_TEMPLATES_PLACEMENT (InteractionsTab: order by name)
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_email_templates_placement_name ON public.email_templates_placement (name) WHERE name IS NOT NULL AND name <> '';

-- -----------------------------------------------------------------------------
-- 14. LEAD_STAGES (Clients: order by id)
-- -----------------------------------------------------------------------------
-- id is usually PK; composite (id) for ORDER BY id is redundant. Skip unless no PK.

-- -----------------------------------------------------------------------------
-- 15. TENANTS_MEETINGLOCATION (Clients: select with order)
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_tenants_meetinglocation_order ON public.tenants_meetinglocation ("order") WHERE "order" IS NOT NULL;

-- =============================================================================
-- Reference: which component uses which
-- =============================================================================
-- Clients.tsx:     users(auth_id,email), lead_leadcontact, leads_contact, leads, leads_lead,
--                  misc_leadsource, misc_language, misc_country, misc_category, lead_stages,
--                  tenants_employee, meetings(legacy_lead_id,client_id,meeting_date), tenants_meetinglocation
-- ClientHeader.tsx: tenants_employee, misc_leadsource, accounting_currencies, misc_category,
--                  lead_leadcontact(lead_id,main), leads_contact(id)
-- InteractionsTab: users(auth_id,employee_id), tenants_employee, whatsapp_messages(lead_id,legacy_id,sent_at),
--                  call_logs(lead_id,cdate), emails(client_id,legacy_id,sent_at,message_id),
--                  leads(id), leads_leadinteractions(lead_id,contact_id,id), lead_leadcontact(lead_id,contact_id),
--                  misc_language, misc_emailtemplate, email_templates_placement
