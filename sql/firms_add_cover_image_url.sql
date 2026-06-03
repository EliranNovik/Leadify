-- Firm header / banner background (public URL in firm-profile-images bucket)
ALTER TABLE public.firms
  ADD COLUMN IF NOT EXISTS cover_image_url text;

COMMENT ON COLUMN public.firms.cover_image_url IS 'Public URL of firm profile header cover image (falls back to default stock cover when null).';
