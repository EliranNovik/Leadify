-- Firm logo / profile image (public URL in firm-profile-images bucket)
ALTER TABLE public.firms
  ADD COLUMN IF NOT EXISTS profile_image_url text;

COMMENT ON COLUMN public.firms.profile_image_url IS 'Public URL of firm profile/logo image (Storage bucket firm-profile-images).';
