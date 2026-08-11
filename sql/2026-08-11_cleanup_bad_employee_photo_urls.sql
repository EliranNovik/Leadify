-- Null out employee photo_url / photo values that are profile pages or non-image paths.
-- These cause browser ORB / NS_BINDING_ABORTED noise and broken avatars.
-- Run in Supabase SQL editor. Review the SELECT preview first if desired.

-- Preview (optional):
-- SELECT id, display_name, photo_url, photo
-- FROM public.tenants_employee
-- WHERE
--   (
--     photo_url IS NOT NULL AND btrim(photo_url) <> ''
--     AND (
--       photo_url ~ '/$'
--       OR photo_url ~* '/en/'
--       OR photo_url ~* 'advocate-[a-z0-9-]+/?$'
--       OR (
--         photo_url ~* '^https?://'
--         AND photo_url !~* '\.(jpe?g|png|gif|webp|avif|bmp|svg)(\?|#|$)'
--         AND photo_url !~* '/storage/v1/object/'
--       )
--     )
--   )
--   OR (
--     photo IS NOT NULL AND btrim(photo) <> ''
--     AND (
--       photo ~ '/$'
--       OR photo ~* '/en/'
--       OR photo ~* 'advocate-[a-z0-9-]+/?$'
--       OR (
--         photo ~* '^https?://'
--         AND photo !~* '\.(jpe?g|png|gif|webp|avif|bmp|svg)(\?|#|$)'
--         AND photo !~* '/storage/v1/object/'
--       )
--     )
--   );

UPDATE public.tenants_employee
SET photo_url = NULL
WHERE photo_url IS NOT NULL
  AND btrim(photo_url) <> ''
  AND (
    photo_url ~ '/$'
    OR photo_url ~* '/en/'
    OR photo_url ~* 'advocate-[a-z0-9-]+/?$'
    OR (
      photo_url ~* '^https?://'
      AND photo_url !~* '\.(jpe?g|png|gif|webp|avif|bmp|svg)(\?|#|$)'
      AND photo_url !~* '/storage/v1/object/'
    )
  );

UPDATE public.tenants_employee
SET photo = NULL
WHERE photo IS NOT NULL
  AND btrim(photo) <> ''
  AND (
    photo ~ '/$'
    OR photo ~* '/en/'
    OR photo ~* 'advocate-[a-z0-9-]+/?$'
    OR (
      photo ~* '^https?://'
      AND photo !~* '\.(jpe?g|png|gif|webp|avif|bmp|svg)(\?|#|$)'
      AND photo !~* '/storage/v1/object/'
    )
  );
