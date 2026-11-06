-- Per-user timezone, so reminders arrive at each person's own reminder
-- time instead of one global CRON_TIMEZONE hour.
--
-- timezone: IANA name (Africa/Lagos), captured from the browser at signup
--   and refreshed on app load. NULL until the user next opens the app; the
--   job falls back to CRON_TIMEZONE for them, which is today's behaviour.
-- reminders_processed_on: the user's LOCAL date on which the reminder job
--   last finished for them. Makes the job idempotent per local day and lets
--   it run every 15 minutes without re-querying users already done.
ALTER TABLE users ADD COLUMN timezone TEXT;
ALTER TABLE user_preferences ADD COLUMN reminders_processed_on DATE;
