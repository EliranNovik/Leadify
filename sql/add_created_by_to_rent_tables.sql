-- Run if rent tables already exist without created_by on rent_offices

ALTER TABLE public.rent_offices
    ADD COLUMN IF NOT EXISTS created_by uuid NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'rent_offices_created_by_fkey'
    ) THEN
        ALTER TABLE public.rent_offices
            ADD CONSTRAINT rent_offices_created_by_fkey
            FOREIGN KEY (created_by)
            REFERENCES auth.users (id)
            ON DELETE SET NULL;
    END IF;
END $$;

ALTER TABLE public.office_rent_expense
    ADD COLUMN IF NOT EXISTS created_by uuid NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'office_rent_expense_created_by_fkey'
    ) THEN
        ALTER TABLE public.office_rent_expense
            ADD CONSTRAINT office_rent_expense_created_by_fkey
            FOREIGN KEY (created_by)
            REFERENCES auth.users (id)
            ON DELETE SET NULL;
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.set_rent_offices_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.created_by IS NULL THEN
            NEW.created_by := auth.uid();
        END IF;
        IF NEW.created_at IS NULL THEN
            NEW.created_at := now();
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rent_offices_audit ON public.rent_offices;
CREATE TRIGGER trg_rent_offices_audit
    BEFORE INSERT ON public.rent_offices
    FOR EACH ROW
    EXECUTE FUNCTION public.set_rent_offices_audit();

CREATE OR REPLACE FUNCTION public.set_office_rent_expense_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.created_by IS NULL THEN
            NEW.created_by := auth.uid();
        END IF;
        IF NEW.created_at IS NULL THEN
            NEW.created_at := now();
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_office_rent_expense_audit ON public.office_rent_expense;
CREATE TRIGGER trg_office_rent_expense_audit
    BEFORE INSERT ON public.office_rent_expense
    FOR EACH ROW
    EXECUTE FUNCTION public.set_office_rent_expense_audit();
