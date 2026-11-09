-- On Austrian Citizenship and German Citizenship leads, the Handler owns
-- handling stage 1 (Application Preparation and Submission), the place the
-- removed Application Manager held. Other categories leave the handler with
-- no handling stage.

BEGIN;

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

UPDATE public.leads AS lead
SET handling_stage_id = 1
FROM public.misc_category AS category
LEFT JOIN public.misc_maincategory AS main ON main.id = category.parent_id
WHERE lead.category_id = category.id
  AND lead.active_handler_type = 2
  AND (
    lower(btrim(category.name)) IN ('austrian citizenship', 'german citizenship', 'austria', 'germany')
    OR lower(btrim(main.name)) IN ('austrian citizenship', 'german citizenship', 'austria', 'germany')
  )
  AND lead.handling_stage_id IS DISTINCT FROM 1;

UPDATE public.leads_lead AS lead
SET handling_stage_id = 1
FROM public.misc_category AS category
LEFT JOIN public.misc_maincategory AS main ON main.id = category.parent_id
WHERE lead.category_id = category.id
  AND lead.active_handler_type = 2
  AND (
    lower(btrim(category.name)) IN ('austrian citizenship', 'german citizenship', 'austria', 'germany')
    OR lower(btrim(main.name)) IN ('austrian citizenship', 'german citizenship', 'austria', 'germany')
  )
  AND lead.handling_stage_id IS DISTINCT FROM 1;

COMMIT;

NOTIFY pgrst, 'reload schema';
