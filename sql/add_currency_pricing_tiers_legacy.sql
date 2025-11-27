-- Add separate pricing tier columns for USD and NIS to legacy contract_templates table
-- USD column will be used for USD, GBP, and EUR (same pricing, different symbols)
-- NIS column will be used for Israeli Shekel only

ALTER TABLE public.misc_contracttemplate
ADD COLUMN IF NOT EXISTS default_pricing_tiers_usd JSONB NULL DEFAULT '{"1": 2500, "2": 2400, "3": 2300, "4-7": 2200, "8-9": 2100, "10-15": 2000, "16+": 1900}'::jsonb;

ALTER TABLE public.misc_contracttemplate
ADD COLUMN IF NOT EXISTS default_pricing_tiers_nis JSONB NULL DEFAULT '{"1": 9000, "2": 8500, "3": 8000, "4-7": 7500, "8-9": 7000, "10-15": 6500, "16+": 6000}'::jsonb;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_misc_contracttemplate_pricing_tiers_usd ON public.misc_contracttemplate USING gin (default_pricing_tiers_usd);
CREATE INDEX IF NOT EXISTS idx_misc_contracttemplate_pricing_tiers_nis ON public.misc_contracttemplate USING gin (default_pricing_tiers_nis);

