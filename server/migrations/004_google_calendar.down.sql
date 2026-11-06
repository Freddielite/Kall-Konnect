ALTER TABLE notifications DROP COLUMN IF EXISTS google_calendar_event_id;
ALTER TABLE users
  DROP COLUMN IF EXISTS google_calendar_refresh_token,
  DROP COLUMN IF EXISTS google_calendar_connected_at,
  DROP COLUMN IF EXISTS google_calendar_email;
