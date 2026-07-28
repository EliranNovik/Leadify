-- Keep leads / leads_lead.subcontractor_fee = SUM(lead_subcontractor_fees.amount)
-- so the Total badge Net / fee badge stay correct without frontend scalar writes.

CREATE OR REPLACE FUNCTION public.sync_lead_subcontractor_fee_scalar(p_new_lead_id uuid, p_legacy_lead_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_sum numeric(14, 2);
BEGIN
  IF p_new_lead_id IS NOT NULL THEN
    SELECT COALESCE(SUM(amount), 0)
      INTO v_sum
    FROM public.lead_subcontractor_fees
    WHERE new_lead_id = p_new_lead_id;

    UPDATE public.leads
    SET subcontractor_fee = v_sum
    WHERE id = p_new_lead_id
      AND COALESCE(subcontractor_fee, 0) IS DISTINCT FROM v_sum;
    RETURN;
  END IF;

  IF p_legacy_lead_id IS NOT NULL THEN
    SELECT COALESCE(SUM(amount), 0)
      INTO v_sum
    FROM public.lead_subcontractor_fees
    WHERE legacy_lead_id = p_legacy_lead_id;

    UPDATE public.leads_lead
    SET subcontractor_fee = v_sum
    WHERE id = p_legacy_lead_id
      AND COALESCE(subcontractor_fee, 0) IS DISTINCT FROM v_sum;
  END IF;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.trg_lead_subcontractor_fees_sync_scalar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.sync_lead_subcontractor_fee_scalar(OLD.new_lead_id, OLD.legacy_lead_id);
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE'
     AND (
       OLD.new_lead_id IS DISTINCT FROM NEW.new_lead_id
       OR OLD.legacy_lead_id IS DISTINCT FROM NEW.legacy_lead_id
     )
  THEN
    PERFORM public.sync_lead_subcontractor_fee_scalar(OLD.new_lead_id, OLD.legacy_lead_id);
  END IF;

  PERFORM public.sync_lead_subcontractor_fee_scalar(NEW.new_lead_id, NEW.legacy_lead_id);
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_lead_subcontractor_fees_sync_scalar
  ON public.lead_subcontractor_fees;

CREATE TRIGGER trg_lead_subcontractor_fees_sync_scalar
AFTER INSERT OR UPDATE OR DELETE ON public.lead_subcontractor_fees
FOR EACH ROW
EXECUTE FUNCTION public.trg_lead_subcontractor_fees_sync_scalar();

-- One-time backfill from existing fee rows
UPDATE public.leads l
SET subcontractor_fee = s.fee_sum
FROM (
  SELECT new_lead_id, COALESCE(SUM(amount), 0) AS fee_sum
  FROM public.lead_subcontractor_fees
  WHERE new_lead_id IS NOT NULL
  GROUP BY new_lead_id
) s
WHERE l.id = s.new_lead_id
  AND COALESCE(l.subcontractor_fee, 0) IS DISTINCT FROM s.fee_sum;

UPDATE public.leads_lead l
SET subcontractor_fee = s.fee_sum
FROM (
  SELECT legacy_lead_id, COALESCE(SUM(amount), 0) AS fee_sum
  FROM public.lead_subcontractor_fees
  WHERE legacy_lead_id IS NOT NULL
  GROUP BY legacy_lead_id
) s
WHERE l.id = s.legacy_lead_id
  AND COALESCE(l.subcontractor_fee, 0) IS DISTINCT FROM s.fee_sum;

-- Live updates for the CRM header / finances UI
DO $pub$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.lead_subcontractor_fees;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
  END;
END;
$pub$;

COMMENT ON FUNCTION public.sync_lead_subcontractor_fee_scalar(uuid, bigint) IS
  'Sets leads.subcontractor_fee / leads_lead.subcontractor_fee = SUM(lead_subcontractor_fees.amount)';
