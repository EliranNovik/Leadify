-- Hebrew titles/descriptions for case stages + sub-categories (client portal).
-- Portal returns both English and Hebrew; the UI picks by locale.
-- Until rows are filled, the frontend also uses a translation catalog fallback.

ALTER TABLE public.sub_efforts
  ADD COLUMN IF NOT EXISTS name_he TEXT,
  ADD COLUMN IF NOT EXISTS description_he TEXT;

ALTER TABLE public.sub_category_efforts
  ADD COLUMN IF NOT EXISTS name_he TEXT,
  ADD COLUMN IF NOT EXISTS description_he TEXT;

COMMENT ON COLUMN public.sub_efforts.name_he IS
  'Optional Hebrew stage title for the client portal.';
COMMENT ON COLUMN public.sub_efforts.description_he IS
  'Optional Hebrew stage explanation shown in the portal about-stage modal.';
COMMENT ON COLUMN public.sub_category_efforts.name_he IS
  'Optional Hebrew sub-category label for the client portal.';
COMMENT ON COLUMN public.sub_category_efforts.description_he IS
  'Optional Hebrew sub-category description for the client portal.';

-- Seed Hebrew titles/descriptions from known English values (only fill empty cells).
UPDATE public.sub_efforts se
SET
  name_he = COALESCE(se.name_he, v.he_name),
  description_he = COALESCE(se.description_he, v.he_desc)
FROM (
  VALUES
    ('Completion of Documents', 'השלמת מסמכים', NULL),
    ('External Meetings & Appointments', 'פגישות ותורים חיצוניים', NULL),
    ('Additional archival Review & Missing Documents', 'בדיקה ארכיונית נוספת ומסמכים חסרים',
      'חיפושים בארכיונים, איתור מסמכים תומכים נוספים, בדיקות של מסמכים חסרים ובקשות להשלמת מסמכים לאחר ההגשה.'),
    ('Additional Archival Review & Missing Documents', 'בדיקה ארכיונית נוספת ומסמכים חסרים',
      'חיפושים בארכיונים, איתור מסמכים תומכים נוספים, בדיקות של מסמכים חסרים ובקשות להשלמת מסמכים לאחר ההגשה.'),
    ('Retention', 'ריטיינר', NULL),
    ('test 2', 'בדיקה 2', NULL),
    ('Sending invoice instructions', 'הנחיות לשליחת חשבונית', NULL),
    ('Court Order Process', 'הליך צו בית משפט', NULL),
    ('Police certificate order', 'הזמנת תעודת משטרה', NULL),
    ('Documents Legalization at the Embassy', 'אימות מסמכים בשגרירות', NULL)
) AS v(en_name, he_name, he_desc)
WHERE lower(trim(se.name)) = lower(trim(v.en_name))
  AND (se.name_he IS NULL OR (v.he_desc IS NOT NULL AND se.description_he IS NULL));

-- If description matches the known archival English text, store Hebrew even when title differs.
UPDATE public.sub_efforts
SET description_he = 'חיפושים בארכיונים, איתור מסמכים תומכים נוספים, בדיקות של מסמכים חסרים ובקשות להשלמת מסמכים לאחר ההגשה.'
WHERE description_he IS NULL
  AND lower(trim(description)) = lower(trim(
    'Archival searches, locating additional supporting documents, missing document investigations, and post-submission document completion requests.'
  ));

UPDATE public.sub_category_efforts sce
SET name_he = COALESCE(sce.name_he, v.he_name)
FROM (
  VALUES
    ('Retention communication', 'תקשורת שימור'),
    ('Retention representation', 'ייצוג שימור'),
    ('Retention client representation', 'ייצוג לקוח בשימור'),
    ('Retention sending invoice', 'שימור – שליחת חשבונית'),
    ('Retention Sending invoice', 'שימור – שליחת חשבונית')
) AS v(en_name, he_name)
WHERE lower(trim(sce.name)) = lower(trim(v.en_name))
  AND sce.name_he IS NULL;
