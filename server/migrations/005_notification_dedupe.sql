-- Notification de-duplication.
--
-- Background: generateNotifications() used to guard against duplicates with
--   WHERE sent_at IS NULL AND scheduled_for >= now()
-- but nothing in the codebase ever wrote sent_at, and scheduled_for was
-- always exactly now()+1day — so by the time the next daily run happened the
-- guard row had already fallen out of the window. Result: a fresh row per
-- contact per day, forever, until the bell's LIMIT 20 was entirely one
-- person. The job now dedupes on the most recent created_at per contact
-- instead; this index makes that lookup cheap.

CREATE INDEX IF NOT EXISTS idx_notifications_user_contact_created
  ON notifications (user_id, contact_id, created_at DESC);

-- Partial index for the unread-count path (the bell reads it on every load).
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications (user_id, scheduled_for DESC)
  WHERE read_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- One-time cleanup of the backlog the old logic produced.
--
-- DESTRUCTIVE — deletes rows. It only touches *duplicates*: for each
-- (user_id, contact_id, type) it keeps the newest notification and removes
-- the older unread ones. Anything already read is left alone, and every
-- contact keeps at least one row, so nothing a user has actually seen or
-- acted on disappears.
--
-- If you'd rather keep the history, delete this block before running
-- `npm run migrate` — the index above is the only part the new job needs.
-- ─────────────────────────────────────────────────────────────────────────

DELETE FROM notifications n
USING (
  SELECT id,
         row_number() OVER (
           PARTITION BY user_id, contact_id, type
           ORDER BY created_at DESC
         ) AS rn
  FROM notifications
  WHERE read_at IS NULL
    -- PARTITION BY treats NULLs as equal, so a null contact_id would make
    -- every such row for a user look like a duplicate of the others.
    -- Nothing creates those today, but don't let a future type get eaten.
    AND contact_id IS NOT NULL
) ranked
WHERE n.id = ranked.id
  AND ranked.rn > 1;
