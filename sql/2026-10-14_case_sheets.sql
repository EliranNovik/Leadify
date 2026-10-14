-- Case Handling tab: a spreadsheet per lead that handlers edit together.
--
-- Why cells are rows rather than one JSON blob
-- -------------------------------------------
-- The tab autosaves. If the sheet were a single JSONB document (or the uploaded .xlsx itself), then
-- two handlers editing at the same time would each save a whole copy, and the later save would wipe
-- out everything the other had typed — not just the cell they touched. One row per cell means a save
-- only writes the cells that actually changed, so concurrent edits to different cells both survive
-- and only the same cell resolves to whoever typed last.
--
-- It also gives Realtime something useful to publish: subscribers receive the changed cell rather
-- than being told to refetch the entire sheet, and `updated_by` on each cell doubles as the audit
-- trail a case file needs.
--
-- The uploaded workbook is not the source of truth. It is parsed once on import and then only ever
-- regenerated for download, so Excel is an interchange format here, not storage.

BEGIN;

/*
 * Leads live in two tables: `leads` (uuid) for current records and `leads_lead` (bigint) for the
 * legacy ones, and a client id of `legacy_123` means the latter. Same dual-key shape as
 * lead_helper_handlers, including no FK on the legacy side because the rest of the schema does not
 * constrain against `leads_lead`.
 */
CREATE TABLE IF NOT EXISTS public.case_sheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  new_lead_id uuid NULL REFERENCES public.leads (id) ON DELETE CASCADE,
  legacy_lead_id bigint NULL,
  name text NOT NULL DEFAULT 'Case Handling',
  /*
   * Header labels, in column order. Held here rather than as a row of cells so an empty sheet still
   * has named columns, and so renaming a header never collides with a cell edit.
   */
  columns jsonb NOT NULL DEFAULT '[]'::jsonb,
  /* Kept so a sheet remembers its blank trailing rows; cells alone cannot express an empty row. */
  row_count integer NOT NULL DEFAULT 0,
  /* Provenance only: the name of the workbook this was imported from, if any. */
  source_filename text NULL,
  /*
   * Right-to-left, for a Hebrew or Arabic sheet. Excel records this per workbook, so it belongs to
   * the sheet rather than to any cell: it mirrors the column order, putting column A on the right.
   */
  rtl boolean NOT NULL DEFAULT false,
  /*
   * Whole-row and whole-column fills, keyed by index as text: {"3": "#fef08a"}.
   *
   * Held here rather than as cell rows because they are properties of the row or column, not of the
   * cells in it — colouring a row must not have to write a cell for every column, nor fight with
   * whatever a handler is typing in one of them.
   *
   * The values are validated on the way in and again when they are read, so a bad value in this
   * column can never reach a style attribute in the browser.
   */
  row_colors jsonb NOT NULL DEFAULT '{}'::jsonb,
  column_colors jsonb NOT NULL DEFAULT '{}'::jsonb,
  /*
   * Hand-resized row heights and column widths in pixels, keyed the same way: {"3": 120}. Only the
   * ones a handler actually dragged are stored, so the default size can be changed later without
   * having to rewrite every sheet. Clamped on the way in and again when read.
   */
  row_heights jsonb NOT NULL DEFAULT '{}'::jsonb,
  column_widths jsonb NOT NULL DEFAULT '{}'::jsonb,
  /*
   * Where this sheet sits in the case's row of tabs, the way a workbook orders its sheets.
   *
   * Not unique, and ties fall back to `created_at`: two handlers adding a tab at the same moment
   * would otherwise have one of their inserts fail, and an extra tab in an unexpected place is a
   * far better outcome than a sheet that could not be created.
   */
  tab_position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NULL,
  CONSTRAINT case_sheets_one_lead CHECK (
    (new_lead_id IS NOT NULL AND legacy_lead_id IS NULL)
    OR (new_lead_id IS NULL AND legacy_lead_id IS NOT NULL)
  ),
  CONSTRAINT case_sheets_row_count_sane CHECK (row_count >= 0 AND row_count <= 20000)
);

/*
 * A case has as many sheets as the workbook it came from has tabs.
 *
 * These were unique at first, when a case had exactly one sheet. They are plain now: an uploaded
 * workbook brings a sheet per tab, and a handler can add more. The tab strip is what keeps them
 * distinguishable, so nothing is lost by letting a lead own several.
 */
CREATE INDEX IF NOT EXISTS idx_case_sheets_new_lead ON public.case_sheets (new_lead_id)
  WHERE new_lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_case_sheets_legacy_lead ON public.case_sheets (legacy_lead_id)
  WHERE legacy_lead_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.case_sheet_cells (
  sheet_id uuid NOT NULL REFERENCES public.case_sheets (id) ON DELETE CASCADE,
  row_index integer NOT NULL,
  col_index integer NOT NULL,
  /*
   * Text, deliberately. A handler typing an ID number, a date or a case reference should get back
   * exactly what they typed; numeric coercion is what turns "007" into 7 and a reference into a
   * date. Anything that needs to be a number is converted on export instead.
   */
  value text NOT NULL DEFAULT '',
  /*
   * Formatting, as columns rather than a jsonb blob, so Realtime publishes a change to a cell's
   * style the same way it publishes a change to its text and the client needs no special case.
   *
   * `highlight`, `text_color`, `font_size` and `align` are nullable because null means "the sheet
   * default" — storing the default explicitly would make every cell look formatted to the toolbar.
   */
  bold boolean NOT NULL DEFAULT false,
  italic boolean NOT NULL DEFAULT false,
  underline boolean NOT NULL DEFAULT false,
  /* Background fill. */
  highlight text NULL,
  /* Text colour, kept separate so a cell can be recoloured without disturbing its fill. */
  text_color text NULL,
  font_size smallint NULL,
  align text NULL,
  /*
   * Explicit cell borders, one flag per edge, which is how a handler draws the row and column lines
   * Excel calls borders. Four booleans rather than one packed value so "add a bottom line" is a
   * single-column write that cannot disturb the other three edges.
   */
  border_top boolean NOT NULL DEFAULT false,
  border_right boolean NOT NULL DEFAULT false,
  border_bottom boolean NOT NULL DEFAULT false,
  border_left boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NULL,
  /* The composite key is what makes a save an upsert per cell, and the conflict target for it. */
  PRIMARY KEY (sheet_id, row_index, col_index),
  CONSTRAINT case_sheet_cells_bounds CHECK (
    row_index >= 0 AND row_index <= 20000 AND col_index >= 0 AND col_index <= 512
  ),
  /* A cell is bounded so one paste cannot put a megabyte into a single square. */
  CONSTRAINT case_sheet_cells_value_len CHECK (char_length(value) <= 8192),
  /*
   * Any colour, but strictly a six-digit hex one.
   *
   * The toolbar offers a small palette, but an uploaded workbook arrives with whatever colours its
   * author chose, and forcing those into six swatches would misrepresent the handler's own file.
   * The shape is pinned because this value ends up inside a style attribute in the browser, and a
   * strict hex pattern cannot carry anything else.
   */
  CONSTRAINT case_sheet_cells_highlight_hex CHECK (
    highlight IS NULL OR highlight ~ '^#[0-9a-f]{6}$'
  ),
  CONSTRAINT case_sheet_cells_text_color_hex CHECK (
    text_color IS NULL OR text_color ~ '^#[0-9a-f]{6}$'
  ),
  CONSTRAINT case_sheet_cells_font_size_palette CHECK (
    font_size IS NULL OR font_size IN (11, 12, 14, 16, 20, 24)
  ),
  /*
   * NULL means "follow the sheet", which is not the same as 'left': a right-to-left sheet reads from
   * the right, so an unset cell there must stay right-aligned. Only an explicit choice is stored.
   */
  CONSTRAINT case_sheet_cells_align_values CHECK (
    align IS NULL OR align IN ('left', 'center', 'right')
  )
);

/*
 * The formatting columns arrived after the table, so they are added separately for anyone who has
 * already run this file. Both halves are idempotent, so running the whole migration again is safe.
 */
ALTER TABLE public.case_sheet_cells
  ADD COLUMN IF NOT EXISTS bold boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS italic boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS underline boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS highlight text NULL,
  ADD COLUMN IF NOT EXISTS text_color text NULL,
  ADD COLUMN IF NOT EXISTS font_size smallint NULL,
  ADD COLUMN IF NOT EXISTS align text NULL,
  ADD COLUMN IF NOT EXISTS border_top boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS border_right boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS border_bottom boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS border_left boolean NOT NULL DEFAULT false;

ALTER TABLE public.case_sheets
  ADD COLUMN IF NOT EXISTS tab_position integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rtl boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS row_colors jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS column_colors jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS row_heights jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS column_widths jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  /*
   * An earlier version of this file restricted highlights to six named colours. Imported workbooks
   * bring their own, so the palette constraint gives way to a hex-shape one.
   */
  ALTER TABLE public.case_sheet_cells
    DROP CONSTRAINT IF EXISTS case_sheet_cells_highlight_palette;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'case_sheet_cells_highlight_hex'
      AND conrelid = 'public.case_sheet_cells'::regclass
  ) THEN
    ALTER TABLE public.case_sheet_cells ADD CONSTRAINT case_sheet_cells_highlight_hex CHECK (
      highlight IS NULL OR highlight ~ '^#[0-9a-f]{6}$'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'case_sheet_cells_text_color_hex'
      AND conrelid = 'public.case_sheet_cells'::regclass
  ) THEN
    ALTER TABLE public.case_sheet_cells ADD CONSTRAINT case_sheet_cells_text_color_hex CHECK (
      text_color IS NULL OR text_color ~ '^#[0-9a-f]{6}$'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'case_sheet_cells_font_size_palette'
      AND conrelid = 'public.case_sheet_cells'::regclass
  ) THEN
    ALTER TABLE public.case_sheet_cells ADD CONSTRAINT case_sheet_cells_font_size_palette CHECK (
      font_size IS NULL OR font_size IN (11, 12, 14, 16, 20, 24)
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'case_sheet_cells_align_values'
      AND conrelid = 'public.case_sheet_cells'::regclass
  ) THEN
    ALTER TABLE public.case_sheet_cells ADD CONSTRAINT case_sheet_cells_align_values CHECK (
      align IS NULL OR align IN ('left', 'center', 'right')
    );
  END IF;
END $$;

/*
 * An earlier version of this file made these indexes unique, to enforce one sheet per lead. A case
 * can have several now — one per tab — so the uniqueness has to come back off, and an index cannot
 * be altered from unique to plain in place.
 */
DO $$
DECLARE
  target text;
  col text;
BEGIN
  FOR target, col IN
    SELECT * FROM (VALUES
      ('idx_case_sheets_new_lead', 'new_lead_id'),
      ('idx_case_sheets_legacy_lead', 'legacy_lead_id')
    ) AS candidates(name, column_name)
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_index i
        JOIN pg_class c ON c.oid = i.indexrelid
       WHERE c.relname = target AND i.indisunique
    ) THEN
      EXECUTE format('DROP INDEX IF EXISTS public.%I', target);
      EXECUTE format(
        'CREATE INDEX %I ON public.case_sheets (%I) WHERE %I IS NOT NULL',
        target, col, col
      );
    END IF;
  END LOOP;
END $$;

/* Ordering the tab strip, which reads every sheet for one lead. */
CREATE INDEX IF NOT EXISTS idx_case_sheets_new_lead_tab
  ON public.case_sheets (new_lead_id, tab_position, created_at)
  WHERE new_lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_case_sheets_legacy_lead_tab
  ON public.case_sheets (legacy_lead_id, tab_position, created_at)
  WHERE legacy_lead_id IS NOT NULL;

/* Loading a sheet reads every cell for it, which is exactly this index. */
CREATE INDEX IF NOT EXISTS idx_case_sheet_cells_sheet ON public.case_sheet_cells (sheet_id);

COMMENT ON TABLE public.case_sheets IS
  'One editable spreadsheet per lead for the Case Handling tab. Cells live in case_sheet_cells.';
COMMENT ON COLUMN public.case_sheets.columns IS
  'Header labels in column order. Cells are addressed by col_index into this array.';
COMMENT ON COLUMN public.case_sheets.rtl IS
  'Right-to-left sheet, mirroring the column order. Taken from the uploaded workbook where it says so.';
COMMENT ON COLUMN public.case_sheets.row_colors IS
  'Whole-row fills keyed by row index as text. A cell highlight takes precedence over this.';
COMMENT ON TABLE public.case_sheet_cells IS
  'One row per non-empty cell. Saves upsert only changed cells so concurrent handlers do not overwrite each other.';

-- Touch the parent whenever a cell changes, so the tab can show "last edited by X" without
-- scanning every cell, and so a stale open tab can tell that it has fallen behind.
CREATE OR REPLACE FUNCTION public.case_sheets_touch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target uuid;
  actor text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target := OLD.sheet_id;
    actor := OLD.updated_by;
  ELSE
    target := NEW.sheet_id;
    actor := NEW.updated_by;
  END IF;

  UPDATE public.case_sheets
     SET updated_at = now(),
         updated_by = COALESCE(actor, updated_by)
   WHERE id = target;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_case_sheet_cells_touch ON public.case_sheet_cells;
CREATE TRIGGER trg_case_sheet_cells_touch
AFTER INSERT OR UPDATE OR DELETE ON public.case_sheet_cells
FOR EACH ROW EXECUTE FUNCTION public.case_sheets_touch();

ALTER TABLE public.case_sheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_sheet_cells ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS case_sheets_authenticated_all ON public.case_sheets;
CREATE POLICY case_sheets_authenticated_all ON public.case_sheets
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS case_sheet_cells_authenticated_all ON public.case_sheet_cells;
CREATE POLICY case_sheet_cells_authenticated_all ON public.case_sheet_cells
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_sheets TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_sheet_cells TO authenticated;

-- Realtime: subscribers get the individual changed cell. REPLICA IDENTITY FULL so a DELETE payload
-- carries which cell was cleared, which the default (primary key only) would still give us — but it
-- also lets subscribers ignore their own echo by comparing updated_by.
ALTER TABLE public.case_sheet_cells REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'case_sheet_cells'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.case_sheet_cells;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'case_sheets'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.case_sheets;
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verification — both should return no rows.
--
-- A sheet attached to neither lead table, or to both:
-- SELECT id FROM public.case_sheets
--  WHERE (new_lead_id IS NULL AND legacy_lead_id IS NULL)
--     OR (new_lead_id IS NOT NULL AND legacy_lead_id IS NOT NULL);
--
-- Cells pointing at a sheet that no longer exists:
-- SELECT c.sheet_id FROM public.case_sheet_cells c
--   LEFT JOIN public.case_sheets s ON s.id = c.sheet_id
--  WHERE s.id IS NULL;

-- Rollback
-- DROP TRIGGER IF EXISTS trg_case_sheet_cells_touch ON public.case_sheet_cells;
-- DROP FUNCTION IF EXISTS public.case_sheets_touch();
-- ALTER PUBLICATION supabase_realtime DROP TABLE public.case_sheet_cells;
-- ALTER PUBLICATION supabase_realtime DROP TABLE public.case_sheets;
-- DROP TABLE IF EXISTS public.case_sheet_cells;
-- DROP TABLE IF EXISTS public.case_sheets;
