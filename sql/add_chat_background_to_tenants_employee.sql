-- Add chat_background_image_url column to tenants_employee table
-- This column stores the URL of the background image for the chat area

ALTER TABLE public.tenants_employee 
ADD COLUMN IF NOT EXISTS chat_background_image_url TEXT;

COMMENT ON COLUMN public.tenants_employee.chat_background_image_url IS 'URL of the background image for the chat area, stored in My-Profile bucket';

 