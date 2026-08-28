-- Google Calendar integration: a per-user OAuth grant, separate from
-- "Sign in with Google" (which only ever requested identity, not calendar
-- access). Users opt in explicitly via a "Connect Google Calendar" button
-- in Settings.

ALTER TABLE users
  ADD COLUMN google_calendar_refresh_token TEXT,
  ADD COLUMN google_calendar_connected_at TIMESTAMPTZ,
  ADD COLUMN google_calendar_email TEXT; -- the Google account they connected, shown in Settings (can differ from login email)

-- Tracks the Google Calendar event created for a reminder, so a reminder
-- that gets regenerated/updated later can PATCH the existing event instead
-- of creating a duplicate.
ALTER TABLE notifications
  ADD COLUMN google_calendar_event_id TEXT;
