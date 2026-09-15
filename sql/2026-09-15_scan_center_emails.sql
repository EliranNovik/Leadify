-- Smart Scan inbox: keep scancenter@lawoffice.org.il lookups off the 5M-row seq scan.
-- For a live production table, prefer CREATE INDEX CONCURRENTLY of the same definition
-- (cannot run CONCURRENTLY inside a transaction).

CREATE INDEX IF NOT EXISTS idx_emails_scan_center_sent_at
ON public.emails (sent_at DESC)
WHERE lower(coalesce(sender_email, '')) = 'scancenter@lawoffice.org.il'
   OR position('scancenter@lawoffice.org.il' in lower(coalesce(recipient_list, ''))) > 0;

-- Authenticated staff can read unmatched Scan Center rows (Graph persist stores user_id NULL).
DROP POLICY IF EXISTS "staff_select_scan_center_emails" ON public.emails;
CREATE POLICY "staff_select_scan_center_emails"
  ON public.emails
  FOR SELECT
  TO authenticated
  USING (
    lower(coalesce(sender_email, '')) = 'scancenter@lawoffice.org.il'
    OR position('scancenter@lawoffice.org.il' in lower(coalesce(recipient_list, ''))) > 0
  );
