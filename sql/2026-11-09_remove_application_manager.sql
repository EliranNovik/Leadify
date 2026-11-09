-- Remove the Application Manager handling role.
--
-- Cases that had this role as the active worker stay in handling stage 1
-- by moving to Submission Manager (active_handler_type 4). The employee
-- stored on application_manager_id is cleared with the column.

BEGIN;

UPDATE public.leads
SET active_handler_type = 4
WHERE active_handler_type = 5;

UPDATE public.leads_lead
SET active_handler_type = 4
WHERE active_handler_type = 5;

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

DELETE FROM public.handling_roles
WHERE active_type = 5 OR code = 'application_manager';

ALTER TABLE public.leads DROP COLUMN IF EXISTS application_manager_id;
ALTER TABLE public.leads_lead DROP COLUMN IF EXISTS application_manager_id;

COMMENT ON COLUMN public.leads.active_handler_type IS
  'Active worker: 1=completion coordinator, 2=handler, 3=case monitoring coordinator, 4=submission manager, 6=digital case coordinator, 7=document procurement coordinator, 8=certification coordinator, 10=authorities coordinator';
COMMENT ON COLUMN public.leads_lead.active_handler_type IS
  'Active worker: 1=completion coordinator, 2=handler, 3=case monitoring coordinator, 4=submission manager, 6=digital case coordinator, 7=document procurement coordinator, 8=certification coordinator, 10=authorities coordinator';

COMMIT;

NOTIFY pgrst, 'reload schema';
