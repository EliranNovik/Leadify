-- Handling roles and handling stages.
--
-- Completion Coordinator is the existing retention handler (active_handler_type = 1,
-- column retainer_handler_id). The other handling roles are new employee-id columns.
-- Case Monitoring Coordinator is the existing client support role (active_handler_type = 3,
-- column client_support_id) and belongs to handling stage 2.
--
-- active_handler_type
--   1  Completion Coordinator         retainer_handler_id                 stage 3, client communication
--   2  Handler                        case_handler_id                     (no handling stage)
--   3  Case Monitoring Coordinator    client_support_id                   stage 2, client communication
--   4  Submission Manager             submission_manager_id               stage 1
--   6  Digital Case Coordinator       digital_case_coordinator_id         stage 1
--   7  Document Procurement Coord.    document_procurement_coordinator_id stage 1
--   8  Certification Coordinator      certification_coordinator_id        stage 1
--   10 Authorities Coordinator        authorities_coordinator_id          stage 3
--
-- Stage 2 client communication is the Case Monitoring Coordinator.
-- Stage 3 client communication is the Completion Coordinator.
-- A BEFORE trigger writes handling_stage_id whenever active_handler_type changes,
-- so pipeline switches stay on the right stage even when the app only updates the type.
--
-- Keep the seed rows in step with src/lib/handlingRoles.ts.

BEGIN;

CREATE TABLE IF NOT EXISTS public.handling_stages (
  id smallint PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  short_label text NOT NULL,
  description text NOT NULL,
  sort_order smallint NOT NULL
);

COMMENT ON TABLE public.handling_stages IS
  'Under-stages of handling. The stage on a lead follows whichever handling role is the active worker.';

CREATE TABLE IF NOT EXISTS public.handling_roles (
  active_type smallint PRIMARY KEY,
  code text NOT NULL UNIQUE,
  title text NOT NULL,
  short_label text NOT NULL,
  focus text NOT NULL,
  responsibilities text NOT NULL,
  stage_id smallint NULL REFERENCES public.handling_stages (id),
  communicates_with_client boolean NOT NULL DEFAULT false,
  lead_column text NOT NULL,
  sort_order smallint NOT NULL
);

COMMENT ON TABLE public.handling_roles IS
  'Handling roles that can be the active worker. active_type is leads.active_handler_type. stage_id is the handling stage that role turns on. communicates_with_client marks the one role that speaks to the client during that stage.';

INSERT INTO public.handling_stages (id, code, name, short_label, description, sort_order)
VALUES
  (1, 'app_prep_submission', 'Application Preparation and Submission', 'App. Prep. & Submission',
   'Prepare the citizenship application and submit it. This stage covers department oversight, application handling, scanning and file management, collecting documents, and notarization.',
   1),
  (2, 'wait_monitor', 'Waiting and Monitoring', 'Wait & Monitor',
   'Wait and follow the case until the authorities ask for additional documentation. This stage is client relations and case follow-up.',
   2),
  (3, 'add_docs_citizenship', 'Additional Documentation and Obtaining Citizenship', 'Add. Docs & Obt. Citizenship',
   'Finish additional documentation and obtain citizenship. This stage covers liaison with the Austrian and German authorities, completing the file, and coordinating with the client.',
   3)
ON CONFLICT (id) DO UPDATE SET
  code = EXCLUDED.code,
  name = EXCLUDED.name,
  short_label = EXCLUDED.short_label,
  description = EXCLUDED.description,
  sort_order = EXCLUDED.sort_order;

INSERT INTO public.handling_roles (
  active_type, code, title, short_label, focus, responsibilities,
  stage_id, communicates_with_client, lead_column, sort_order
)
VALUES
  (2, 'handler', 'Handler', 'Handler', 'Case handler',
   'The case handler assigned on the lead. This role is outside the three handling stages.',
   NULL, false, 'case_handler_id', 10),
  (4, 'submission_manager', 'Submission Manager', 'Submission Mgr', 'Department management',
   'Runs the submissions department and oversees how applications are prepared and filed.',
   1, false, 'submission_manager_id', 20),
  (6, 'digital_case_coordinator', 'Digital Case Coordinator', 'Digital Case', 'Document scanning and file management',
   'Scans documents and keeps the digital case file in order.',
   1, false, 'digital_case_coordinator_id', 40),
  (7, 'document_procurement_coordinator', 'Document Procurement Coordinator', 'Doc Procurement', 'Document collection',
   'Collects the documents the application needs. Assigned per case.',
   1, false, 'document_procurement_coordinator_id', 50),
  (8, 'certification_coordinator', 'Certification Coordinator', 'Certification', 'Notarization and authentication',
   'Arranges notarization and authentication of documents.',
   1, false, 'certification_coordinator_id', 60),
  (10, 'authorities_coordinator', 'Authorities Coordinator', 'Authorities', 'Liaison with Austrian and German authorities',
   'Liaises with the Austrian and German authorities on the case.',
   3, false, 'authorities_coordinator_id', 80),
  (1, 'completion_coordinator', 'Completion Coordinator', 'Completion', 'Documentation completion and client coordination',
   'Completes the remaining documentation and coordinates with the client through to citizenship. Responsible for client communication during additional documentation and obtaining citizenship.',
   3, true, 'retainer_handler_id', 90),
  (3, 'client_support', 'Case Monitoring Coordinator', 'Case Monitoring', 'Client relations and case follow-up',
   'Follows the case while it waits with the authorities and keeps the client updated. Responsible for client communication during waiting and monitoring.',
   2, true, 'client_support_id', 70)
ON CONFLICT (active_type) DO UPDATE SET
  code = EXCLUDED.code,
  title = EXCLUDED.title,
  short_label = EXCLUDED.short_label,
  focus = EXCLUDED.focus,
  responsibilities = EXCLUDED.responsibilities,
  stage_id = EXCLUDED.stage_id,
  communicates_with_client = EXCLUDED.communicates_with_client,
  lead_column = EXCLUDED.lead_column,
  sort_order = EXCLUDED.sort_order;

-- Employee id columns. Completion coordinator reuses retainer_handler_id.
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS submission_manager_id bigint REFERENCES public.tenants_employee (id),
  ADD COLUMN IF NOT EXISTS digital_case_coordinator_id bigint REFERENCES public.tenants_employee (id),
  ADD COLUMN IF NOT EXISTS document_procurement_coordinator_id bigint REFERENCES public.tenants_employee (id),
  ADD COLUMN IF NOT EXISTS certification_coordinator_id bigint REFERENCES public.tenants_employee (id),
  ADD COLUMN IF NOT EXISTS authorities_coordinator_id bigint REFERENCES public.tenants_employee (id),
  ADD COLUMN IF NOT EXISTS handling_stage_id smallint REFERENCES public.handling_stages (id);

ALTER TABLE public.leads_lead
  ADD COLUMN IF NOT EXISTS submission_manager_id bigint REFERENCES public.tenants_employee (id),
  ADD COLUMN IF NOT EXISTS digital_case_coordinator_id bigint REFERENCES public.tenants_employee (id),
  ADD COLUMN IF NOT EXISTS document_procurement_coordinator_id bigint REFERENCES public.tenants_employee (id),
  ADD COLUMN IF NOT EXISTS certification_coordinator_id bigint REFERENCES public.tenants_employee (id),
  ADD COLUMN IF NOT EXISTS authorities_coordinator_id bigint REFERENCES public.tenants_employee (id),
  ADD COLUMN IF NOT EXISTS handling_stage_id smallint REFERENCES public.handling_stages (id);

COMMENT ON COLUMN public.leads.submission_manager_id IS 'Submission Manager (handling stage 1).';
COMMENT ON COLUMN public.leads.digital_case_coordinator_id IS 'Digital Case Coordinator (handling stage 1).';
COMMENT ON COLUMN public.leads.document_procurement_coordinator_id IS 'Document Procurement Coordinator (handling stage 1).';
COMMENT ON COLUMN public.leads.certification_coordinator_id IS 'Certification Coordinator (handling stage 1).';
COMMENT ON COLUMN public.leads.client_support_id IS 'Case Monitoring Coordinator (formerly client support). Client communication for handling stage 2.';
COMMENT ON COLUMN public.leads.authorities_coordinator_id IS 'Authorities Coordinator (handling stage 3).';
COMMENT ON COLUMN public.leads.handling_stage_id IS 'Handling under-stage. Set from active_handler_type by sync_lead_handling_stage.';
COMMENT ON COLUMN public.leads.retainer_handler_id IS 'Completion Coordinator (formerly retention handler). Client communication for handling stage 3.';

COMMENT ON COLUMN public.leads_lead.submission_manager_id IS 'Submission Manager (handling stage 1).';
COMMENT ON COLUMN public.leads_lead.digital_case_coordinator_id IS 'Digital Case Coordinator (handling stage 1).';
COMMENT ON COLUMN public.leads_lead.document_procurement_coordinator_id IS 'Document Procurement Coordinator (handling stage 1).';
COMMENT ON COLUMN public.leads_lead.certification_coordinator_id IS 'Certification Coordinator (handling stage 1).';
COMMENT ON COLUMN public.leads_lead.client_support_id IS 'Case Monitoring Coordinator (formerly client support). Client communication for handling stage 2.';
COMMENT ON COLUMN public.leads_lead.authorities_coordinator_id IS 'Authorities Coordinator (handling stage 3).';
COMMENT ON COLUMN public.leads_lead.handling_stage_id IS 'Handling under-stage. Set from active_handler_type by sync_lead_handling_stage.';
COMMENT ON COLUMN public.leads_lead.retainer_handler_id IS 'Completion Coordinator (formerly retention handler). Client communication for handling stage 3.';

COMMENT ON COLUMN public.leads.active_handler_type IS
  'Active worker: 1=completion coordinator, 2=handler, 3=case monitoring coordinator, 4=submission manager, 6=digital case coordinator, 7=document procurement coordinator, 8=certification coordinator, 10=authorities coordinator';
COMMENT ON COLUMN public.leads_lead.active_handler_type IS
  'Active worker: 1=completion coordinator, 2=handler, 3=case monitoring coordinator, 4=submission manager, 6=digital case coordinator, 7=document procurement coordinator, 8=certification coordinator, 10=authorities coordinator';

CREATE OR REPLACE FUNCTION public.sync_lead_handling_stage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_stage smallint;
  v_category text;
  v_main text;
BEGIN
  v_stage := CASE NEW.active_handler_type
    WHEN 1 THEN 3
    WHEN 3 THEN 2
    WHEN 4 THEN 1
    WHEN 6 THEN 1
    WHEN 7 THEN 1
    WHEN 8 THEN 1
    WHEN 10 THEN 3
    ELSE NULL
  END;

  -- Handler takes the stage-1 place of the removed Application Manager
  -- on Austrian and German citizenship leads.
  IF NEW.active_handler_type = 2 AND NEW.category_id IS NOT NULL THEN
    SELECT lower(btrim(category.name)), lower(btrim(main.name))
      INTO v_category, v_main
    FROM public.misc_category AS category
    LEFT JOIN public.misc_maincategory AS main ON main.id = category.parent_id
    WHERE category.id = NEW.category_id;
    IF v_category IN ('austrian citizenship', 'german citizenship', 'austria', 'germany')
       OR v_main IN ('austrian citizenship', 'german citizenship', 'austria', 'germany') THEN
      v_stage := 1;
    END IF;
  END IF;

  IF TG_OP = 'INSERT'
     OR NEW.active_handler_type IS DISTINCT FROM OLD.active_handler_type
     OR NEW.category_id IS DISTINCT FROM OLD.category_id THEN
    NEW.handling_stage_id := v_stage;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS leads_sync_handling_stage ON public.leads;
CREATE TRIGGER leads_sync_handling_stage
  BEFORE INSERT OR UPDATE OF active_handler_type, category_id
  ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_lead_handling_stage();

DROP TRIGGER IF EXISTS leads_lead_sync_handling_stage ON public.leads_lead;
CREATE TRIGGER leads_lead_sync_handling_stage
  BEFORE INSERT OR UPDATE OF active_handler_type, category_id
  ON public.leads_lead
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_lead_handling_stage();

-- If an earlier draft added a separate case-monitoring column, keep that person on client support, then drop it.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'leads' AND column_name = 'case_monitoring_coordinator_id'
  ) THEN
    UPDATE public.leads
    SET client_support_id = case_monitoring_coordinator_id
    WHERE client_support_id IS NULL AND case_monitoring_coordinator_id IS NOT NULL;
    UPDATE public.leads SET active_handler_type = 3 WHERE active_handler_type = 9;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'leads_lead' AND column_name = 'case_monitoring_coordinator_id'
  ) THEN
    UPDATE public.leads_lead
    SET client_support_id = case_monitoring_coordinator_id
    WHERE client_support_id IS NULL AND case_monitoring_coordinator_id IS NOT NULL;
    UPDATE public.leads_lead SET active_handler_type = 3 WHERE active_handler_type = 9;
  END IF;
END $$;
ALTER TABLE public.leads DROP COLUMN IF EXISTS case_monitoring_coordinator_id;
ALTER TABLE public.leads_lead DROP COLUMN IF EXISTS case_monitoring_coordinator_id;
DELETE FROM public.handling_roles WHERE active_type = 9;
DELETE FROM public.handling_roles WHERE active_type = 5 OR code = 'application_manager';
ALTER TABLE public.leads DROP COLUMN IF EXISTS application_manager_id;
ALTER TABLE public.leads_lead DROP COLUMN IF EXISTS application_manager_id;

-- Completion coordinator (type 1) is stage 3. Case monitoring coordinator (type 3) is stage 2.
UPDATE public.leads
SET handling_stage_id = CASE active_handler_type WHEN 1 THEN 3 WHEN 3 THEN 2 ELSE handling_stage_id END
WHERE active_handler_type IN (1, 3)
  AND handling_stage_id IS DISTINCT FROM CASE active_handler_type WHEN 1 THEN 3 WHEN 3 THEN 2 END;

UPDATE public.leads_lead
SET handling_stage_id = CASE active_handler_type WHEN 1 THEN 3 WHEN 3 THEN 2 ELSE handling_stage_id END
WHERE active_handler_type IN (1, 3)
  AND handling_stage_id IS DISTINCT FROM CASE active_handler_type WHEN 1 THEN 3 WHEN 3 THEN 2 END;

ALTER TABLE public.handling_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.handling_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS handling_stages_authenticated_select ON public.handling_stages;
CREATE POLICY handling_stages_authenticated_select ON public.handling_stages
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS handling_roles_authenticated_select ON public.handling_roles;
CREATE POLICY handling_roles_authenticated_select ON public.handling_roles
  FOR SELECT TO authenticated USING (true);

GRANT SELECT ON public.handling_stages TO authenticated;
GRANT SELECT ON public.handling_roles TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
