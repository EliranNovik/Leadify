-- Region highlights for document_file_comments (image / PDF page rectangles).
-- Coordinates are normalized 0–1 relative to the media (or PDF page) box.

ALTER TABLE public.document_file_comments
  ADD COLUMN IF NOT EXISTS highlight jsonb NULL;

COMMENT ON COLUMN public.document_file_comments.highlight IS
  'Optional region highlight: { x, y, w, h } in 0–1 coords; optional page (1-based) for PDFs.';

CREATE INDEX IF NOT EXISTS idx_document_file_comments_has_highlight
  ON public.document_file_comments ((highlight IS NOT NULL))
  WHERE highlight IS NOT NULL;
